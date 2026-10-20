# Proveedor de correo transaccional: Brevo o Postmark

**Estado (22/10/2026):** Postmark está implementado como alternativa (`server/mail/providers.ts` y `server/mail/webhook.ts`) detrás del mismo puerto que Brevo. La lógica de negocio (bandeja de salida, plantillas, idempotencia, reintentos y supresión) no cambia con el proveedor. **No hay credenciales de Postmark y no se envía nada real** (`MAIL_MODE` sigue en `off`).

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
