# Activación de Postmark en `live`: procedimiento único

**Estado (21/10/2026):**
- El código del proveedor Postmark está desplegado (`aa79d4b`).
- La puerta del CRM tiene ya la excepción para su webhook (CRM PR #29, apagada por defecto).
- **No hay cuenta, token ni DNS de Postmark.**
- `MAIL_MODE=off`: no sale ningún correo.

Los pasos **[TÚ]** solo los puede hacer el propietario, porque requieren su cuenta de Postmark y el panel DNS. El resto lo hace el equipo técnico.

## 0. DNS actual de `bigelephant.es` (comprobado el 21/10/2026, solo lectura)

| Registro | Valor | Qué se hace |
|---|---|---|
| NS | `ns*.gestiondecuenta.com` | Aquí se editan los registros |
| MX | `mail.bigelephant.es` (prioridad 10) | **No se toca** (correo entrante) |
| TXT `@` (SPF) | `v=spf1 a mx ~all` | **No se toca**: Postmark alinea SPF con su propio Return-Path (paso 2) |
| TXT `@` | `brevo-code:…` | No se toca |
| TXT `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | No se toca ahora (paso 9) |
| DKIM | `brevo1`, `brevo2`, `default._domainkey` | No se tocan: el DKIM de Postmark usa **otro selector** |

**Regla:** solo se **añaden** dos registros nuevos (DKIM y `pm-bounces`). No se modifica ni se borra ningún registro existente.

## 1. **[TÚ]** Alta de la cuenta y del servidor

1. Alta en postmarkapp.com con un correo corporativo.
2. **Servers → Create server** «Elephant Source live», con el flujo **Transactional** (`outbound`).
3. Postmark revisa las cuentas nuevas: hasta que la aprueba, solo envía a direcciones del propio dominio. Hay que pedir la aprobación (**Request approval**), describiendo el uso: correo transaccional de una plataforma SaaS, sin marketing.

## 2. **[TÚ]** Dominio remitente

1. **Sender Signatures → Domains → Add domain** `bigelephant.es`.
2. Postmark muestra dos registros. Añadirlos en `gestiondecuenta.com`:

   | Nombre | Tipo | Valor | TTL |
   |---|---|---|---|
   | `<selector>pm._domainkey` (el que muestre Postmark, p. ej. `20261021123456pm._domainkey`) | TXT | `k=rsa; p=…` (copiar entero) | 3600 |
   | `pm-bounces` | CNAME | `pm.mtasv.net` | 3600 |

3. En Postmark, **Verify** en DKIM y en Return-Path. Las dos comprobaciones deben quedar en verde.

**Comprobación (cualquiera puede hacerla):**
```powershell
Resolve-DnsName <selector>pm._domainkey.bigelephant.es -Type TXT -Server 1.1.1.1
Resolve-DnsName pm-bounces.bigelephant.es -Type CNAME -Server 1.1.1.1   # → pm.mtasv.net
Resolve-DnsName bigelephant.es -Type TXT -Server 1.1.1.1                 # el SPF sigue igual
```

## 3. **[TÚ]** Token del servidor

**Servers → Elephant Source live → API Tokens.** Copiar el *Server API token* **directamente en Railway**, sin pegarlo en ningún chat ni documento:
- Railway → `live` → `controlplane` → Variables → `POSTMARK_SERVER_TOKEN` (sin desplegar);
- Railway → `live` → `core` → Variables → `POSTMARK_SERVER_TOKEN` (sin desplegar).

Por CLI, con `--skip-deploys`:
```
railway variables -s controlplane -e live --skip-deploys --set "POSTMARK_SERVER_TOKEN=<token>"
railway variables -s core -e live --skip-deploys --set "POSTMARK_SERVER_TOKEN=<token>"
```

## 4. Variables de Railway (equipo técnico; ningún valor secreto en texto)

| Servicio | Variable | Valor |
|---|---|---|
| controlplane y core | `MAIL_PROVIDER` | `postmark` |
| controlplane y core | `MAIL_SENDING_DOMAIN` | `bigelephant.es` (remitente `no-reply@bigelephant.es`) |
| controlplane y core | `MAIL_MODE` | `sandbox` (fase de pruebas) |
| controlplane y core | `MAIL_SANDBOX_ALLOWLIST` | Los buzones del propietario y del equipo, separados por comas |
| controlplane | `POSTMARK_WEBHOOK_TOKEN` | Generado en el propio paso (32 caracteres o más), nunca mostrado |
| controlplane | `CP_ALERT_EMAIL` | Buzón del equipo para avisos internos (máximo 5, separados por comas) |
| crm | `POSTMARK_WEBHOOK_PUBLIC` | `1` (necesita el CRM con el PR #29 desplegado) |

## 5. **[TÚ]** Webhook en Postmark

1. **Servers → Elephant Source live → Default Transactional Stream → Webhooks → Add webhook.**
2. URL: `https://elephant-source-crm-live.up.railway.app/cp/v1/mail/postmark/webhook`. Pasará a `https://admin.bigelephant.es/…` con el traslado de dominios.
3. **Custom HTTP header:** `x-elephant-webhook-token` con el valor de `POSTMARK_WEBHOOK_TOKEN`. El equipo técnico lo deja preparado en Railway, donde se puede leer directamente, sin que circule por ningún chat.
4. Eventos: **Delivery**, **Bounce** y **Spam complaint**.
5. **Send test**: debe responder 200. Una respuesta 401 indica que el token o el despliegue del paso 6 no coinciden.

## 6. Despliegue (equipo técnico)

`controlplane` y `core` con su commit actual, y `crm` con la versión que incluye el PR #29. Comprobación en el arranque del `controlplane`:
```
ctx="Mail" mode="sandbox" provider="postmark" … postmarkWebhook=true
```
Debe aparecer sin `providerProblem`.

## 7. Prueba de entrega (modo `sandbox`, solo buzones autorizados)

1. **Prueba del proveedor:** Postmark → Servers → **Send test email** a un buzón propio. En las cabeceras del mensaje recibido deben aparecer `spf=pass` (por `pm-bounces`), `dkim=pass` (`d=bigelephant.es`) y `dmarc=pass`.
2. **Prueba de la plataforma, con disparadores reales:**
   - **Aviso de seguridad:** cambiar la contraseña del operador propio en el CRM, lo que envía `security_notice`.
   - **Aviso interno:** una incidencia de prueba en Operación SaaS, que avisa a `CP_ALERT_EMAIL`.
3. **Comprobar en cada envío:**
   - `mail_outbox` con estado `accepted` y, tras el webhook, `delivered`;
   - Postmark → Activity con **Delivered**;
   - en los registros del `controlplane`, el webhook `Delivery` recibido y aplicado;
   - **el contenido:** que no aparece ningún token ni enlace de otra empresa (los enlaces de acceso van firmados y son de un solo uso).
4. **Rebote controlado:** un envío a una dirección inexistente de un dominio propio y autorizado. Debe llegar el webhook `Bounce`, el mensaje pasa a `bounced` y la dirección queda suprimida para envíos posteriores (rebote definitivo).

## 8. Activación (decisión del propietario)

Con todo lo anterior en verde y los textos legales publicados:
- **controlplane y core:** `MAIL_MODE=live` y `MAIL_LIVE_AUTHORIZED=1`;
- **despliegue:** el arranque muestra `mode="live"`. Sin `MAIL_LIVE_AUTHORIZED=1`, la plataforma degrada `live` a `off` (`live_not_authorized`).

**Reparto con Stripe (sin duplicados):** Stripe envía los recibos y las facturas; la plataforma, el resto (`COMUNICACIONES_LANZAMIENTO.md` §1).

## 9. Después de 2 a 4 semanas

Revisar los informes DMARC. Si todo el correo legítimo pasa, endurecer `_dmarc` a `p=quarantine`. Si Brevo ya no se usa, se pueden retirar sus registros (`brevo1`, `brevo2`, `brevo-code`) y cambiar `rua`.

## Marcha atrás

`MAIL_MODE=off` en `controlplane` y `core` y redespliegue: no sale ningún correo y la bandeja de salida conserva lo pendiente. Los registros DNS añadidos no afectan a nada más y se pueden dejar.
