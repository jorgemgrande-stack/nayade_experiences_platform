# Correo transaccional con Brevo (Core y plano de control)

Estado: **preparado, apagado por defecto** (`MAIL_MODE=off`). No hay clave de Brevo en el repositorio; el propietario la pondrá en Railway como `BREVO_API_KEY` (servicios core y controlplane). El dominio de envío previsto, `bigelephant.es`, **aún no está autenticado en Brevo**.

## 1. Inspección previa (estado antes de este cambio)

| Pieza | Qué había | Observaciones |
|---|---|---|
| `server/mailer.ts` (`sendEmail`) | Envío directo a `POST https://api.brevo.com/v3/smtp/email` con `BREVO_API_KEY`; SMTP (nodemailer) como respaldo en single. En multi, remitente `PLATFORM_MAIL_FROM` o el `email_from_address` de la empresa, Reply-To de la empresa, sin SMTP global. | Sin cola, sin reintentos, sin idempotencia, sin modo seguro: con la clave puesta, todo sale a cualquier destinatario. La empresa podía poner como From cualquier dirección (`email_from_address`). |
| `server/emailManager.ts` (`sendManagedEmail`) | Plantillas activables, preferencias del cliente, registro en `email_comm_log`. Llama a `sendEmail`. | Copias (cc) como texto separado por comas. |
| `server/emailAutomationJob.ts` | Cola de correos programados por empresa (`email_scheduled_jobs`), cada 10 min, política `per-tenant`. | Reintenta sus propios trabajos; no el envío en sí. |
| `server/tenantBrand.ts` | Marca y comunicaciones por empresa (`brand_name`, `email_from_*`, `email_reply_to`). | En multi nunca usa los respaldos de Náyade. |
| `server/emailTemplates.ts` | Plantillas del Core (invitación, recuperación, presupuesto, reservas, anulaciones, TPV…) con la marca y el host de la empresa en multi (`publicBaseUrl`/`getTrustedBaseUrl`). | Se mantienen. |
| `server/trials/emailNotifier.ts` | Avisos de la prueba por un puerto (SMTP genérico + memoria) con `CP_TRIAL_EMAIL_MODE` off/sandbox/live. | Sin persistencia ni reintentos. Se mantiene como alternativa si no hay bandeja de plataforma. |
| `server/orchestrator/` | Eventos de contratación, pago de prueba, impago y cancelación. | **Ningún aviso por correo.** |
| `server/crm/activation.ts` (alta asistida) | Crea la plataforma y el administrador. | **El token de invitación no se enviaba a nadie.** |
| Otros envíos | `commercialEmailService` (buzón comercial propio de la empresa con su SMTP), `operatorSetup` (recuperación de contraseña de operadores internos, `CP_RESET_SMTP_URL`). | Fuera de alcance: no son correo transaccional de plataforma. Sin cambios. |
| Errores y registros | `opsLog` con direcciones enmascaradas; `recordFailure("mail.send_failed")` alimenta alertas. | Se reutilizan. |

## 2. Arquitectura

```
Core (por empresa)                                   Plano de control (plataforma)
sendEmail() ─► server/mail/tenantMail.ts             PlatformMailer (server/mail/platform.ts)
               │  remitente de plataforma,             │  prueba (TrialNotifier), alta asistida,
               │  guarda de enlaces (multi)            │  pedidos (OrderNotifier)
               ▼                                       ▼
         MailService (server/mail/service.ts) — política, idempotencia, límites, reintentos, eventos
               │                                       │
     mail_outbox de la EMPRESA                  mail_outbox del CRM comercial
     (db/migrations/0010_mail_outbox)           (db/crm/migrations/0011_platform_mail_outbox)
               │                                       │
               └──────────► MailProviderPort ◄─────────┘
                            Brevo API v3 | SMTP | memoria (pruebas)

Brevo ──webhook──► POST /cp/v1/mail/brevo/webhook (plano de control)
                   ├─ referencia «es1.p.<empresa>.<id>» → bandeja del CRM
                   └─ referencia «es1.t.<empresa>.<id>» → base de ESA empresa (DSN del registro)
```

- **Un mensaje por destinatario principal**, con su `tenant_id`. Las copias autorizadas viajan con él.
- **Idempotencia** por (empresa, clave). Claves de los avisos de plataforma: `trial:<id>:verification:<huella del token>`, `trial-welcome:<empresa>:<huella>`, `trial:<id>:expiry:<días>`, `assisted-welcome:<empresa>:<huella>`, `order:<id>:<acción>:<versión>` y, para los avisos de un cobro, `order:<id>:<categoría>:p<pago>` (ver §4). En el Core, si el llamante no da clave, se deriva del contenido (categoría + destinatario + asunto + cuerpo) en ventanas de 10 minutos: un doble clic no duplica.
- **Reintentos**: red, 429 y 5xx se reintentan con espera 1, 2, 4, 8… minutos (tope 1 h) hasta `MAIL_MAX_ATTEMPTS` (5); un 4xx es definitivo. Los dispara el envío siguiente de la empresa, la tarea `email-automation` (cada 10 min, por empresa) y, en el plano de control, un temporizador (`CP_MAIL_DRAIN_EVERY_SECONDS`, 60 s). Una reserva (`sending`) caducada se retoma.
- **Límites**: por empresa (`MAIL_RATE_TENANT_PER_HOUR`, 300/h) y por destinatario (`MAIL_RATE_RECIPIENT_PER_HOUR`, 8/h), contados en la base. Lo que no se envía por política queda como `skipped` con su motivo.
- **Supresiones por empresa**: rebote duro, dirección inválida, queja y baja suprimen la huella (SHA-256) del destinatario en la base de esa empresa (o en la del CRM, con su `tenant_id`). Otra empresa puede seguir escribiéndole.
- **Privacidad**: los registros llevan ids, categorías, estados y códigos; nunca direcciones, asuntos, cuerpos ni tokens. Al llegar a un estado final se borran cuerpo, adjuntos y direcciones completas; queda la dirección enmascarada (`p***@dominio`) y la huella.
- **Separación de identidad**: From siempre `<nombre comercial> <no-reply@{MAIL_SENDING_DOMAIN}>`; Reply-To de la empresa (`email_reply_to`, si no `email_reservations`, si no su `email_from_address`) o, en plataforma, `ELEPHANT_SUPPORT_EMAIL` si existe. El nombre se limpia (sin `<>@"`, saltos de línea…). El `email_from_address` de la empresa **no** se usa como From en el servicio nuevo (solo como Reply-To de respaldo): antes sí, y una empresa podía poner la dirección de otra. Un servicio ligado a una empresa rechaza mensajes y eventos de otra.
- **Guarda de enlaces (multi)**: un correo de empresa con enlaces a Náyade o al host global (`APP_URL`) distinto del de la empresa no se envía (`forbidden_link_host`).
- **Sin la migración** en la base de una empresa (o la 0011 en el CRM) no se envía nada (falla cerrado); el plano de control lo indica al arrancar (`ctx: "Mail"`).

### Estados (qué prueba cada uno)

| Estado | Significa | No significa |
|---|---|---|
| `pending` / `sending` | En la bandeja, por enviar o enviándose | — |
| `accepted` | **La API de Brevo aceptó** el mensaje (201 + `messageId`) | Que Brevo lo haya procesado ni que haya llegado |
| `delivered` | Evento `delivered`: **el servidor de destino aceptó** el mensaje | Que la persona lo haya visto |
| `soft_bounced` | Rebote temporal (Brevo reintenta por su cuenta) | Fallo definitivo |
| `bounced` | Rebote duro o dirección inválida (se suprime) | — |
| `blocked` | Brevo bloqueó el envío | — |
| `complained` | Marcado como spam (se suprime) | — |
| `failed` | Rechazo 4xx, reintentos agotados o sin proveedor | — |
| `skipped` | No se envió por política: `mode_off`, `sandbox_recipient_not_allowed`, `suppressed`, `rate_limited_*`, `sender_unavailable`, `forbidden_link_host` | — |

«Recibido» solo lo puede confirmar **una persona en su buzón**: ningún estado lo afirma.

## 3. Variables

| Variable | Servicio | Uso |
|---|---|---|
| `BREVO_API_KEY` | core, controlplane | Clave de la API v3 (la pone el propietario). Sin ella: SMTP si `SMTP_HOST/USER/PASS`, o ningún proveedor (`failed: no_provider`). |
| `MAIL_MODE` | core, controlplane | `off` (por defecto) · `sandbox` · `live`. En single (Náyade) **sin `MAIL_MODE`** se mantiene el envío de siempre; al definirlo, pasa por el servicio nuevo. En multi siempre pasa por el servicio nuevo. |
| `MAIL_SANDBOX_ALLOWLIST` | core, controlplane | Direcciones (`persona@dominio`) o dominios exactos (`dominio`) autorizados en sandbox, separados por comas. Sin lista, sandbox → off. Un subdominio no cuenta. |
| `MAIL_LIVE_AUTHORIZED` | core, controlplane | `1` para permitir `live`. Sin ella, `live` → off (`live_not_authorized`). Solo la pone el propietario. |
| `MAIL_SENDING_DOMAIN` | core, controlplane | Dominio autenticado en Brevo (previsto `bigelephant.es`). Sin él, cualquier modo → off. |
| `ELEPHANT_SUPPORT_EMAIL` | controlplane | Reply-To y línea de soporte de los avisos de plataforma. Si falta, no se muestra. |
| `BREVO_WEBHOOK_TOKEN` | controlplane | Secreto (≥ 32 caracteres) que Brevo envía en la cabecera `x-elephant-webhook-token`. Sin él, el webhook responde 503. |
| `MAIL_RATE_TENANT_PER_HOUR`, `MAIL_RATE_RECIPIENT_PER_HOUR`, `MAIL_MAX_ATTEMPTS` | ambos | Límites (300, 8) e intentos (5). |
| `CP_MAIL_DRAIN_EVERY_SECONDS` | controlplane | Frecuencia de reintentos de la bandeja de plataforma (60). |
| `CP_TRIAL_VERIFY_URL`, `CP_TRIAL_PRICING_URL` | controlplane | Ya existían: enlaces de verificación y precios de la prueba. |

`PLATFORM_MAIL_FROM` y `CP_TRIAL_EMAIL_*` quedan para el envío heredado (sin bandeja). Con la bandeja de plataforma disponible, la prueba usa la bandeja.

## 4. Avisos y plantillas

Plantillas en español, transaccionales («No es publicidad»), con la marca de Elephant Source en los avisos de plataforma (`server/mail/templates.ts`) y la de la empresa en los del Core (`server/emailTemplates.ts`, que ya usan su marca y su host).

| Aviso | Evento existente | Plantilla | Bandeja |
|---|---|---|---|
| Verificación de correo | Solicitud de prueba (`TrialNotifier.verification`) | `emailVerification` | plataforma |
| Activación de prueba | Prueba aprovisionada (`welcome`) | `trialActivated` (enlace al host de la empresa) | plataforma |
| Aviso de vencimiento | `expiryNotice` | `trialExpiry` | plataforma |
| Bienvenida a empresa invitada (alta asistida) | Contrato del CRM o pedido activado que crea la plataforma (`createContractActivation`) | `tenantWelcome` | plataforma |
| Confirmación de contratación | Pedido `activate` | `contractConfirmed` | plataforma |
| Confirmación de pago (live) | Pedido `confirm` con base `payment`, pago de Stripe live | `paymentConfirmed` | plataforma |
| Confirmación de pago de prueba | Pedido `confirm` con base `payment`, cualquier otro pago | `testPaymentConfirmed` («no se ha realizado ningún cargo real») | plataforma |
| Factura disponible | Cobro de Stripe verificado (alta, renovación o cambio) | `invoiceAvailable` | plataforma |
| Renovación cobrada | Aviso `payment_recorded` del orquestador con un pago `renewal` | `renewalConfirmed` | plataforma |
| Reactivación | Pedido `reactivate` (cancelación deshecha) o `payment_recovered` (impago regularizado) | `subscriptionReactivated` | plataforma |
| Solicitud de alta recibida | Pedido `sign` con la aceptación de la web (`web-terms:…`, contratación en línea) | `signupReceived` | plataforma |
| Impago | Pedido `payment_failed` | `paymentFailed` (fecha de fin de la gracia) | plataforma |
| Cancelación | Pedido `cancel` | `cancellation` | plataforma |
| Invitación a usuario | `sendInviteEmail` | `buildInviteHtml` (Core) | empresa |
| Recuperación de contraseña | `/api/auth/forgot-password` | `buildPasswordResetHtml` (Core) | empresa |
| Presupuesto enviado | `sendManagedEmail("quote")` | `buildQuoteHtml` (Core) | empresa |
| Notificaciones operativas | Resto de `sendEmail`/`sendManagedEmail` del Core | Las del Core; `tenantNotice` para avisos nuevos | empresa |
| Confirmación de alta (antigua) | Sustituida por «Solicitud de alta recibida» | `signupConfirmation` (preparada, sin conectar) | plataforma |

El aviso se encola **después** del cambio de estado ya guardado y su fallo solo se registra: la lógica de negocio no cambia.

### Categorías de la plataforma: cuándo y en qué modo

«Modo» es el modo de cobro del entorno (`CP_STRIPE_MODE`, el del orquestador), no `MAIL_MODE`: con `MAIL_MODE=off` (por defecto) **no sale ninguno** y todos quedan `skipped / mode_off`. Un pago se anuncia como REAL solo si el entorno es live **y** el pago es de Stripe live (proveedor `stripe`, modo `live` en `commercial_payments`); en cualquier otro caso sale el texto de prueba. Nunca sale el texto de prueba en live ni el real en pruebas.

| Categoría | Cuándo se envía | Live | Pruebas | Clave idempotente |
|---|---|---|---|---|
| `email_verification` | Solicitud (o reenvío) de prueba gratuita | sí | sí | `trial:<id>:verification:<huella>` |
| `trial_activated` | Prueba gratuita aprovisionada (enlace para crear la contraseña) | sí | sí | `trial-welcome:<empresa>:<huella>` |
| `trial_expiry` | 3 y 1 días antes del fin de la prueba, y al terminar | sí | sí | `trial:<id>:expiry:<fin>:<días>` |
| `tenant_welcome` | Alta asistida: plataforma creada (enlace de un solo uso para crear la contraseña) | sí | sí | `assisted-welcome:<empresa>:<huella>` |
| `signup_received` | Aceptación en la web de la contratación en línea, antes del pago (`sign` con `web-terms:`) | sí (sin mención a pruebas) | sí («entorno de pruebas») | `order:<id>:sign:<versión>` |
| `payment_confirmed` | Pago del alta verificado en Stripe live (`confirm`, base `payment`) | sí | **nunca** | `order:<id>:confirm:<versión>` |
| `test_payment_confirmed` | Pago del alta verificado de pruebas (simulado o `stripe_test`) | **nunca** | sí | `order:<id>:confirm:<versión>` |
| `invoice_available` | Cobro de Stripe verificado: alta, renovación o cambio. Sin enlace (la URL alojada de la factura no se guarda): remite al Customer Portal o a soporte | sí | sí («factura de prueba») | `order:<id>:invoice_available:p<pago>` |
| `renewal_confirmed` | Renovación cobrada (`payment_recorded`, pago `renewal`; Stripe o simulado) | sí | sí («cobro de PRUEBA») | `order:<id>:renewal_confirmed:p<pago>` |
| `subscription_reactivated` | `reactivate` (cancelación deshecha en Stripe) o `payment_recovered` (pago pendiente regularizado) | sí | sí | `order:<id>:<acción>:<versión>` |
| `contract_confirmed` | Pedido activado (`activate`) | sí | sí | `order:<id>:activate:<versión>` |
| `payment_failed` | Impago (`payment_failed`) | sí | sí | `order:<id>:payment_failed:<versión>` |
| `cancellation` | Cancelación programada (`cancel`) | sí | sí | `order:<id>:cancel:<versión>` |

- Las claves de un cobro usan el id del pago (la versión del pedido no cambia al registrarlo): el mismo evento de Stripe repetido, la conciliación o un doble procesamiento no envían dos correos. El orquestador emite `payment_recorded` (aviso sin cambio de estado) solo para cobros verificados de renovación o cambio del modo del entorno; el procesador de Stripe lo llama solo cuando el pago se registra por primera vez.
- Ningún correo lleva contraseñas: la bienvenida solo lleva el enlace personal de un solo uso para crearla.
- Importes: el cobrado según Stripe, sin desglose de impuestos (los precios son sin IVA y la política fiscal está pendiente). Ningún texto afirma que la factura de Stripe sea una factura fiscal completa.
- Remitente: `Elephant Source <no-reply@{MAIL_SENDING_DOMAIN}>`; Reply-To y línea de soporte: `ELEPHANT_SUPPORT_EMAIL` (previsto `soporte@bigelephant.es`).
- «Prueba gratuita» en `email_verification`, `trial_*` es el nombre del producto (la prueba gratuita de la plataforma), no el modo pruebas: es correcto en live.
- Un pedido con impago que paga la renovación recibe, por diseño, `renewal_confirmed`, `invoice_available` y `subscription_reactivated` (tres avisos de hechos distintos).

## 5. Webhook de Brevo

- URL: `https://<plano de control>/cp/v1/mail/brevo/webhook` (POST, JSON; también en lote).
- **Autenticidad (único mecanismo implementado, documentado oficialmente)**: cabeceras propias que Brevo añade a cada llamada, definidas al crear el webhook (campo `headers` de `POST /v3/webhooks`).
  - Fuente: <https://developers.brevo.com/docs/secured-webhooks> («Brevo envía esas cabeceras con cada evento»; admite varias) y <https://developers.brevo.com/reference/create-webhook> (`headers: [{ key, value }]`, «Custom headers to be send with webhooks»).
  - Brevo **no documenta firma HMAC**. Las otras opciones oficiales (usuario y contraseña en la URL, `auth` de tipo bearer, lista de IP de <https://help.brevo.com/hc/en-us/articles/208848409>) no se usan; la del bearer no documenta en qué cabecera llega el token.
- Sin `BREVO_WEBHOOK_TOKEN` → 503; cabecera ausente o distinta → 401. En ambos casos **no cambia nada**.
- Eventos tratados (formato: <https://developers.brevo.com/docs/transactional-webhooks>): `delivered`, `soft_bounce`, `hard_bounce`, `invalid_email`, `blocked`, `spam`, `unsubscribed`, `deferred`, `error`. Aperturas y clics se ignoran. Cada evento se aplica una vez (huella del evento) y los estados nunca retroceden (un `delivered` tardío no deshace una queja).
- El mensaje se localiza por la referencia que viaja en `X-Mailin-custom` (`es1.<t|p>.<empresa>.<id>`, sin datos personales) y se exige que el `message-id` coincida con el guardado.

Alta del webhook (la hace el propietario con la clave; ejemplo sin valores reales):

```bash
curl -X POST https://api.brevo.com/v3/webhooks \
  -H "api-key: $BREVO_API_KEY" -H "content-type: application/json" \
  -d '{"type":"transactional","url":"https://<plano de control>/cp/v1/mail/brevo/webhook",
       "events":["delivered","hardBounce","softBounce","blocked","spam","invalid","unsubscribed","deferred"],
       "headers":[{"key":"x-elephant-webhook-token","value":"<BREVO_WEBHOOK_TOKEN>"}]}'
```

## 6. Diagnóstico de la cuenta (sin enviar)

- Comando: `BREVO_API_KEY=… MAIL_SENDING_DOMAIN=bigelephant.es pnpm exec tsx scripts/mail/brevo-diagnose.ts` (salida 0 = dominio autenticado y transaccional activo).
- Plano de control: `GET /cp/v1/mail/diagnostics` (alcance `ops:read`): modo efectivo, motivo de degradación, dominio, webhook configurado y el diagnóstico del proveedor.
- Endpoints oficiales de solo lectura que usa:
  - `GET /v3/account` — <https://developers.brevo.com/reference/get-account> (`relay.enabled` = envío transaccional activo; planes y créditos).
  - `GET /v3/senders` — <https://developers.brevo.com/reference/get-senders>.
  - `GET /v3/senders/domains` — <https://developers.brevo.com/reference/get-domains> (`authenticated`, `verified`).
  - `GET /v3/senders/domains/{dominio}` — <https://developers.brevo.com/reference/get-domain-configuration> (`dns_records.brevo_code`, `dkim_record`, `dmarc_record` con su `status`).
- No devuelve el correo de acceso de la cuenta ni los valores de los registros DNS.

## 7. Plan DNS para autenticar `bigelephant.es` (lo aplica el propietario)

No tocar los registros **MX** ni el DKIM existente **`default._domainkey`**.

**Estado actual (DNS público, leído el 18/10/2026; no se ha aplicado nada):**

| Registro | Nombre | Valor publicado | Lo que exige Brevo | Estado |
|---|---|---|---|---|
| SPF (TXT) | `bigelephant.es` | `v=spf1 a mx ~all` | Que autorice a Brevo: `include:spf.brevo.com` | **No incluye Brevo** |
| DKIM 1 (CNAME) | `brevo1._domainkey.bigelephant.es` | `b1.bigelephant-es.dkim.brevo.com` | Ese CNAME | Publicado |
| DKIM 2 (CNAME) | `brevo2._domainkey.bigelephant.es` | `b2.bigelephant-es.dkim.brevo.com` | Ese CNAME | Publicado |
| DMARC (TXT) | `_dmarc.bigelephant.es` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | Un DMARC (cualquier política) | Publicado, solo observación |
| Código de Brevo (TXT) | `bigelephant.es` | — (comprobar en el panel) | `brevo-code:…` | Comprobar en el panel o con el diagnóstico |

**Cambio recomendado de SPF (lo aplica el propietario):** sustituir el registro SPF por **uno solo** que añada Brevo sin quitar nada de lo existente:

```
bigelephant.es.  TXT  "v=spf1 a mx include:spf.brevo.com ~all"
```

Nunca publicar dos registros `v=spf1` (invalida el SPF). El `include` suma una consulta DNS (quedan muy por debajo del límite de 10). Con IP compartida, Brevo firma con DKIM y usa su propio Return-Path, así que el DKIM alineado es lo que hace pasar DMARC; el `include` deja además el SPF coherente si Brevo envía con el dominio propio (p. ej. IP dedicada o Return-Path personalizado).

**Evolución recomendada de DMARC** (solo cuando los informes `rua` muestren que todo el correo legítimo pasa — Brevo, el buzón del dominio y cualquier otro remitente —, con al menos 2–4 semanas en cada paso):

1. Ahora: `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` (observación; se mantiene).
2. `v=DMARC1; p=quarantine; pct=25; rua=mailto:rua@dmarc.brevo.com` → subir `pct` a 50 y 100.
3. `v=DMARC1; p=reject; rua=mailto:rua@dmarc.brevo.com` (con `adkim=r; aspf=r`, los valores por defecto).

Si el propietario quiere recibir también los informes, puede añadir su propia dirección a `rua` (separada por comas). Antes de endurecer la política, comprobar que el servidor de correo del dominio (registros `a`/`mx` del SPF y `default._domainkey`) firma y pasa DMARC.

1. Panel de Brevo → **Remitentes, dominios e IP dedicadas → Dominios → Añadir un dominio** → `bigelephant.es` → elegir **autenticación manual** (si el asistente propone sustituir un DMARC existente, cancelar y seguir en manual). El panel muestra los valores exactos; también los devuelve `GET /v3/senders/domains/bigelephant.es` (`dns_records`).
2. Registros que pide Brevo (según la API oficial, `dns_records` contiene exactamente estos tres):
   - **`brevo_code`**: TXT en la raíz con el valor `brevo-code:…` del panel.
   - **`dkim_record`**: el registro DKIM con el nombre de selector y el valor que muestre el panel (distinto de `default._domainkey`, que se conserva).
   - **`dmarc_record`**: TXT `_dmarc`. Valor inicial propuesto: `v=DMARC1; p=none; rua=mailto:<dirección de informes que decida el propietario>`. Sin dirección decidida, `v=DMARC1; p=none` sin `rua`. Si ya existe un `_dmarc`, se mantiene uno solo (no duplicar).
3. **SPF**: aplicar el cambio recomendado de arriba (`v=spf1 a mx include:spf.brevo.com ~all`, un único registro). La respuesta oficial de `get-domain-configuration` no incluye SPF, así que el diagnóstico no lo comprueba: verificarlo con una consulta DNS pública (`TXT bigelephant.es`).
4. Pulsar **Autenticar este dominio** en el panel (o `PUT /v3/senders/domains/bigelephant.es/authenticate`, <https://developers.brevo.com/reference/authenticate-domain>). La propagación puede tardar.
5. Comprobar con `scripts/mail/brevo-diagnose.ts`: `sendingDomain.authenticated = true` y `records.*.ok = true`.

## 8. Puesta en marcha y prueba real con destinatarios autorizados

Requiere autorización del propietario para cada paso que toca Railway o envía correo.

1. Migraciones (nunca en el arranque): `db/migrations/0010_mail_outbox` en cada base de empresa EXISTENTE (las empresas nuevas la reciben al aprovisionarse, que aplica `db/migrations`) y `db/crm/migrations/0011_platform_mail_outbox` en la del CRM, con el procedimiento de `db/migrations/README.md` (`verify`, `up` en seco, `up --apply --confirm-database …`). Reversión: `down --steps 1`.
2. Variables en Railway (core y controlplane): `BREVO_API_KEY`, `MAIL_SENDING_DOMAIN=bigelephant.es`, `MAIL_MODE=sandbox`, `MAIL_SANDBOX_ALLOWLIST=<direcciones del equipo autorizadas por el propietario>`; en controlplane además `BREVO_WEBHOOK_TOKEN` y, si se quiere, `ELEPHANT_SUPPORT_EMAIL`.
3. Arranque del plano de control: la línea `{"ctx":"Mail", "outbox":true, "mode":"sandbox", …}` sin `degradedReason`.
4. Diagnóstico: `GET /cp/v1/mail/diagnostics` → dominio autenticado y transaccional activo.
5. Alta del webhook (sección 5).
6. Prueba: con una dirección autorizada, solicitar una prueba gratuita o una recuperación de contraseña en una empresa de prueba. Comprobar en la base: `accepted` (la API aceptó) → `delivered` (evento del webhook: el servidor de destino lo aceptó). **Confirmar a mano en el buzón** que ha llegado, con el remitente `<nombre> <no-reply@bigelephant.es>`, el Reply-To correcto y los enlaces al host de la empresa.
7. Probar también una dirección **no** autorizada: debe quedar `skipped / sandbox_recipient_not_allowed` y no recibir nada.
8. Solo con autorización expresa: `MAIL_MODE=live` + `MAIL_LIVE_AUTHORIZED=1`.

Apagado inmediato: `MAIL_MODE=off` (lo pendiente no sale; al reintentarse queda `skipped`).
