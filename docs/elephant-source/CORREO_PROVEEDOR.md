# Proveedor de correo transaccional: Brevo o Postmark

**Estado (20/10/2026):** Postmark está implementado como alternativa (`server/mail/providers.ts` y `server/mail/webhook.ts`) detrás del mismo puerto que Brevo. La lógica de negocio (bandeja de salida, plantillas, idempotencia, reintentos y supresión) no cambia con el proveedor. **No hay credenciales de Postmark y no se envía nada real** (`MAIL_MODE` sigue en `off`).

## Por qué

La IP compartida de Brevo ha estado en listas negras (SpamCop) y ya ha provocado rebotes. Postmark separa el flujo transaccional (`outbound`) del comercial y tiene buena reputación de entrega. El cambio se hace por configuración.

## Elegir el proveedor

| Variable | Valor |
|---|---|
| `MAIL_PROVIDER` | `postmark`, `brevo` o `smtp`. Con ella se usa **exactamente** ese proveedor, y sin sus credenciales no hay proveedor: nunca se cae a otro en silencio. El arranque lo indica en `ctx: Mail` (`providerProblem`). Sin ella: Brevo, después Postmark y después SMTP, según las credenciales que haya |
| `POSTMARK_SERVER_TOKEN` | Token del **servidor** de Postmark (secreto) |
| `POSTMARK_MESSAGE_STREAM` | Opcional; por defecto `outbound` (transaccional) |
| `POSTMARK_WEBHOOK_TOKEN` | Secreto de 32 caracteres o más para el webhook (cabecera `x-elephant-webhook-token`) |
| `MAIL_SENDING_DOMAIN` | `bigelephant.es`; el remitente es `no-reply@bigelephant.es` |

Las variables van en **controlplane** (bandeja de plataforma y webhook) y en **core** (bandeja de cada empresa).

## Configuración en Postmark (cuando haya cuenta)

1. **Servidor** «Elephant Source» con el flujo transaccional `outbound`. Copiar el *Server API token* en `POSTMARK_SERVER_TOKEN`.
2. **Sender Signature / dominio** `bigelephant.es`. Añadir en el DNS (sin tocar MX ni el SPF actual):
   - **DKIM:** registro TXT `XXXXXXXXpm._domainkey.bigelephant.es`, con el valor que muestre Postmark;
   - **Return-Path:** CNAME `pm-bounces.bigelephant.es` → `pm.mtasv.net`, para alinear SPF con DMARC.
3. **Webhook** del flujo `outbound` → `https://<dominio de crm de live>/cp/v1/mail/postmark/webhook`, con la cabecera personalizada `x-elephant-webhook-token: <POSTMARK_WEBHOOK_TOKEN>` y los eventos **Delivery, Bounce, Spam Complaint y Subscription Change**. No hacen falta Open ni Click: el seguimiento va desactivado.
4. Pedir la aprobación de la cuenta a Postmark (sale del modo de pruebas).

## Qué hace el código

| Aspecto | Comportamiento |
|---|---|
| Envío | `POST https://api.postmarkapp.com/email`, `TrackOpens: false` y `TrackLinks: None`. La referencia interna va en `Metadata` (en trozos de 80 caracteres) para enlazar los eventos |
| Errores | Se guarda solo el código (`postmark_<ErrorCode>` o `http_<estado>`), nunca el mensaje, que puede repetir direcciones. Son reintentables el 429, los 5xx, la red y el tiempo agotado; el resto, no |
| Adjuntos | Solo con contenido (Postmark no admite adjuntos por URL). La plataforma no usa adjuntos; el Core resuelve los suyos a contenido antes de enviar |
| Webhook | Mismo mecanismo que Brevo: cabecera propia comparada en tiempo constante (401 sin ella y 503 sin token configurado). Delivery → entregado; Bounce (duro, dirección no válida o bloqueo) → rebote con **supresión** del destinatario; SpamComplaint → queja; SubscriptionChange → baja. Un evento repetido no se aplica dos veces |
| Duplicados | La bandeja de salida es la garantía: una clave de idempotencia por mensaje |

## Para cambiar de Brevo a Postmark (con autorización, en live)

1. Configurar Postmark y el DNS (pasos 1 a 4). Esperar a que DKIM y Return-Path estén verificados.
2. En controlplane y core: `MAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN` y `POSTMARK_WEBHOOK_TOKEN`, y redesplegar.
3. Comprobar en el arranque `ctx: Mail` → `provider: "postmark"`, `postmarkWebhook: true` y sin `providerProblem`.
4. Con `MAIL_MODE=sandbox` y `MAIL_SANDBOX_ALLOWLIST` con buzones propios, enviar una prueba de cada plantilla y comprobar SPF, DKIM y DMARC en las cabeceras.
5. Solo entonces, `MAIL_MODE=live` y `MAIL_LIVE_AUTHORIZED=1` (**decisión tuya**).

## Postmark propio de cada empresa (correo transaccional del Core)

**Estado (08/11/2026):** implementado. Postmark es el proveedor elegido para Big Elephant (no Brevo). Cada empresa puede conectar **su propia cuenta** de Postmark para sus correos transaccionales; sin configurarla, todo sigue como hasta ahora (servicio de correo de la plataforma). No hay variables de entorno nuevas: las credenciales viven en la bóveda de cada empresa.

| Aspecto | Comportamiento |
|---|---|
| Credenciales | Proveedor `postmark` del almacén (`server/_core/credentials/catalog.ts`): `serverToken` (secreto), `messageStream` (por defecto `outbound`), `fromEmail` y `webhookToken` (secreto, lo genera la plataforma). Se leen en cada envío (`credentialFor`), nunca del entorno ni de otra empresa |
| Cuándo se usa | Solo si están el token y el remitente, el dominio del remitente es un dominio propio **verificado** de la empresa (el mismo o un subdominio suyo, nunca el dominio padre) **y** la última comprobación de ese token y flujo fue correcta con servidor **Live** y flujo **Transactional** (marca `verifiedFor`, cifrada). Cambiar el token o el flujo exige comprobar de nuevo. Si no, envío de siempre (`server/mail/tenantPostmark.ts`, `postmarkConfigFrom`) |
| Orden de proveedores | Postmark propio (solo transaccional) → SMTP propio → servicio central. Mismo motor: bandeja de salida, plantillas, idempotencia, reintentos, supresión y `MAIL_MODE` |
| Transaccional y marketing | Lista **explícita** de categorías transaccionales (`TRANSACTIONAL_CATEGORIES`): operativos, presupuestos, pagos, facturas, reembolsos, anulaciones, desistimientos, contratos y accesos. Cualquier otra (`marketing`, `survey`, `service_notice`, `legacy`, desconocidas) sale por el envío de siempre con su propia identidad. Las campañas de la empresa siguen en **Brevo marketing** (`server/brevoMarketing/*`), sin cambios |
| Seguimiento | Nunca aperturas ni clics: cada mensaje lleva `TrackOpens: false` y `TrackLinks: None` |
| Probador | `GET /server` y `GET /message-streams/{id}` (solo lectura). Solo es correcta con servidor *Live* y flujo transaccional (Sandbox, difusión, cuenta pendiente o token rechazado → no se activa). El token del servidor no permite leer dominios ni firmas (exigen el token de la cuenta, que no se pide) |
| Webhook | `POST https://<dominio de la empresa>/api/mail/postmark/webhook` (Core, fuera de `/api/trpc`; no cambia `server/authGuard.ts`). Lector propio de 256 KB montado antes del general (413 si pasa). Límite de peticiones por empresa e IP. Empresa por el dominio de la petición; cabecera `x-elephant-webhook-token` con el token **de esa empresa**, comparado en tiempo constante (503 sin token, 401 si no coincide). Solo aplica eventos de mensajes de esa empresa; idempotente (`mail_events`). Delivery → entregado; Bounce duro, dirección no válida → rebote con supresión; SpamComplaint → queja con supresión; SubscriptionChange (SuppressSending) → baja con supresión. Se suprime siempre el destinatario del mensaje (no la dirección del cuerpo del evento). La URL solo se muestra si la empresa tiene dominio público propio de la plataforma o suyo |
| Rechazo de la cuenta al enviar | Token revocado (401, código 10), cuenta pendiente (412) o remitente sin firmar (400, 401): la integración queda **no sana** (se borra la marca de comprobación y se registra la incidencia) y ese mismo mensaje sale en el acto por el envío de siempre con su identidad, sin duplicar (Postmark no lo aceptó). Los siguientes ya no intentan Postmark hasta volver a comprobar |
| Proveedor en la bandeja | `postmark_tenant` (distinto del Postmark de la plataforma), también al programar un reintento |
| Trazabilidad en el CRM | Ficha del cliente: tarjeta «Entrega de correos» (estado de cada envío) y aviso «Correo no entregado al cliente» si su dirección está suprimida o algún correo rebotó (`crm.clients.mailDelivery`, `server/mail/deliveryDb.ts`; solo categorías de cliente, nunca accesos, invitaciones ni avisos de seguridad de usuarios del panel). Sin tablas nuevas: `mail_outbox`, `mail_events` y `mail_suppressions` (0010) por la huella del correo |
| Panel | Ajustes → **Correo transaccional (Postmark)** (`/admin/configuracion/postmark`): pegar el token y el remitente, probar la conexión, ver el dominio, copiar la URL y la cabecera del webhook, generar su token (se muestra una vez), estado de los envíos y desconectar. Licencia: `comms-email` (notificaciones por email, incluida en Essential) |

### Activación de una empresa (lo hace la propia empresa)

1. En Postmark: crear un servidor, con el flujo transaccional `outbound`, y firmar el dominio (DKIM y Return-Path) en *Sender Signatures*.
2. En Elephant Source: verificar ese dominio en **Dominios** (si no, el Postmark propio no se usa).
3. En **Correo transaccional (Postmark)**: pegar el *Server API token* y la dirección del remitente; **Probar conexión**.
4. **Generar token** del webhook y, en Postmark, crear el webhook del flujo con la URL mostrada, la cabecera `x-elephant-webhook-token` con ese token y los eventos Delivery, Bounce, Spam Complaint y Subscription Change (sin Open ni Click).
5. El envío real lo sigue gobernando `MAIL_MODE` de la instalación (off, sandbox o live autorizado).

## Política comercial del correo (aprobada el 08/11/2026)

**Postmark propio y SMTP propio son una capacidad de configuración incluida en los planes**, no un producto de pago. Están bajo la capacidad `comms-email` (nivel Essential), que Business y Enterprise heredan. Elephant Connect no tiene ningún producto de Postmark. Brevo sigue funcionando para las campañas de la empresa (Brevo marketing), sin ampliarse y sin presentarse como prioridad.

### Las tres vías de envío de cada empresa

| Vía | Quién la paga | Cómo la mide el Resource Manager |
|---|---|---|
| **Postmark propio** (solo transaccional, `/admin/configuracion/postmark`) | La empresa titular de la cuenta: Postmark le factura directamente | `email.own.sent` (`route: own_postmark`). Sin tarifa de la plataforma y sin cuota |
| **SMTP propio** (Ajustes → Integraciones, proveedor `mail_smtp`) | La empresa titular del servidor | `email.own.sent` (`route: own_smtp`). Sin tarifa de la plataforma y sin cuota |
| **Servicio de correo de la plataforma** (sin cuenta propia, categorías no transaccionales sin SMTP propio o **envío alternativo** cuando la cuenta propia falla) | Big Elephant | `email.sent` (`route: platform`). Lleva la tarifa de `costs.ts` y consume las cuotas vigentes (`quota.ts`, cuotas por empresa y de prueba) en los contadores compartidos (`usage_windows`) |

No hay límites nuevos: las cuotas de correo existentes se aplican solo al servicio de la plataforma.

### Medición (auditoría del 08/11/2026)

- **Antes:** `sendEmail` (`server/mailer.ts`) medía **todo** envío por la bandeja de salida como `email.sent` (`channel: outbox`), saliera por el Postmark propio, por el SMTP propio o por la plataforma. Además comprobaba (y reservaba) la cuota de la plataforma antes de cualquier envío. Es decir, el ERM imputaba a Big Elephant un coste que pagaba la empresa.
- **Ahora:** los puertos del proveedor de cada empresa (`server/mail/tenantMail.ts`) avisan de la vía de cada mensaje que el proveedor **acepta**. `sendEmail` mide una unidad por envío, como antes, con la vía real (`meteredMailRoute`). Si algún mensaje salió por la plataforma, cuenta `email.sent`. Si no, cuenta `email.own.sent` con la cuenta que lo aceptó. Sin aceptación (fallo, omitido o reintento), cuenta la vía prevista (`predictedMailRoute`). La cuota de la plataforma solo se comprueba cuando la vía prevista es la plataforma. Si la cuenta propia falla y el mensaje sale por la plataforma, se mide como de la plataforma, aunque no se haya reservado cuota antes.
- `email.own.sent` está en el catálogo de métricas del ERM (`tenantMetrics.ts`), pero no en los contadores de cuota (`SHARED_COUNTER_METRICS`) ni en el modelo de costes. `email.sent`, sus ventanas y sus umbrales no cambian de nombre ni de forma.
- La trazabilidad no cambia: la bandeja de salida guarda el proveedor real (`postmark_tenant`, `smtp` o el de la plataforma), y los webhooks registran entregas, rebotes, quejas y bajas (`email.delivered.30d` y `email.problems.30d`).

### Pendiente para la cuenta central (sin credenciales; no se ha hecho)

1. Alta de la cuenta de Postmark de la plataforma: servidor «Elephant Source» con flujo transaccional `outbound` y aprobación de la cuenta (salir del modo de pruebas).
2. DNS de `bigelephant.es`: DKIM (`XXXXXXXXpm._domainkey`, valor de Postmark) y Return-Path (CNAME `pm-bounces` → `pm.mtasv.net`), sin tocar MX ni el SPF actual.
3. Variables en controlplane y core: `MAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN` y `POSTMARK_WEBHOOK_TOKEN`, y el webhook de la plataforma (ver «Configuración en Postmark» y «Para cambiar de Brevo a Postmark»).
4. Actualizar la tarifa de `email.sent` en el modelo de costes (`ERM_COST_MODEL` o `costs.ts`) con la factura real de Postmark.

Hasta entonces, el servicio de la plataforma sigue con el proveedor configurado hoy en el entorno.
