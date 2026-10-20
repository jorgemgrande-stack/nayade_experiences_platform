# Lanzamiento comercial de Elephant Source: guía de apertura

**Estado (20/10/2026):** preparado sin desplegar, porque Railway tiene pausados los despliegues. Ningún cambio de este documento está aplicado salvo que se indique.
**Alcance objetivo (decisión del propietario, 20/10/2026):** **B2B y B2C** en la Península y Baleares, en Canarias, Ceuta y Melilla, en la UE, en el Reino Unido y en otros países. Solo Essential y Business; los módulos siguen fuera de la venta.
**Cómo se abre:** por escenario (tipo de cliente × territorio) y por país, con el control de elegibilidad del PR #187. Lo que no esté validado por el asesor fiscal y, en B2C, por el jurídico, sigue **bloqueado para el cobro**. Ver `MATRIZ_FISCAL_INTERNACIONAL.md`.

## 1. Estado verificado (lectura)

| Pieza | Estado | Fuente |
|---|---|---|
| Precios de Stripe Live | 4 activos, `tax_behavior: exclusive` y sin duplicados: Essential 29 €/mes y 279 €/año; Business 79 €/mes y 759 €/año (IVA no incluido) | API de Stripe |
| Productos de Stripe Live | Sin `tax_code` propio: usan el de la cuenta, `txcd_10103001` (SaaS de uso empresarial) | API de Stripe |
| Stripe Tax | `status: active` y sede en Madrid, pero **ningún registro fiscal**: así no se cobra IVA | API de Stripe |
| Clientes y suscripciones | 0 | API de Stripe |
| Customer Portal | Cancelación a fin de periodo y cambios de plan desactivados. **Faltan las URL de condiciones y privacidad** | API de Stripe |
| Métodos de pago (por defecto) | Tarjeta, Link, Apple Pay, Amazon Pay, Klarna, Bancontact, Blik, EPS, MB Way, Pix, Kakao, Naver, Payco, Satispay, Samsung Pay | API de Stripe |
| Webhook de Live | `we_1USAv39RzfmCBuaiop8nwv1v`, activo. **Faltan 3 eventos** (§3) | API de Stripe |
| Railway `live` | Código anterior al 19/10. CRM en la 0013, registro en la 0011, 0 empresas. Dominios reales en `production` | Inventario de `rw-live` |
| Correo | Dominio autenticado en Brevo (DKIM `brevo1` y `brevo2`, `brevo-code`), DMARC `p=none`, SPF `v=spf1 a mx ~all`. En `live`: `MAIL_MODE=off` y sin proveedor | DNS público y variables |

## 2. Fiscalidad: apertura por escenarios (B2B y B2C internacional)

La matriz completa por jurisdicción está en **`MATRIZ_FISCAL_INTERNACIONAL.md`**: impuesto, inversión del sujeto pasivo, OSS, no sujeción, registros, umbrales y estado propuesto de cada fila.

| Decisión | Propuesta | Quién |
|---|---|---|
| DF-1 Emisor | IRON ELEPHANT CONSULTING, S.L., B26987875 (resuelta) | — |
| DF-3 Cálculo del impuesto | Stripe Tax con **registro de España**, más **OSS** si se escoge para B2C de la UE. Stripe no da de alta registros ni presenta declaraciones | Asesor y propietario |
| DF-5 ¿Particulares? | **Sí** (decisión del propietario), con desistimiento, precontractual, precio final y función de desistimiento resueltos (matriz, §3) | Jurídico |
| DF-6 Mercados | España, UE y fuera de la UE **por lista de países** validados | Asesor |
| DF-7 Canarias, Ceuta y Melilla | B2B: no sujeto a IVA (con menciones). B2C: bloqueado hasta analizar el IGIC y el IPSI | Asesor |
| DF-8 Precio publicado | Empresas: sin IVA. Particulares: **precio final** con el tipo del país (la consulta de elegibilidad lo calcula) | Propietario |
| **DF-2 Emisor de la factura legal** | Stripe Invoicing, **si el asesor confirma** su encaje con el reglamento de facturación, VERI\*FACTU, OSS y las menciones por escenario. Si no, un programa certificado | **Asesor fiscal** |
| DF-4 Series | Por decidir: una serie, o series por régimen (interior, intracomunitaria, OSS, exportación) más rectificativas | **Asesor fiscal** |
| Rectificativas | Hoy un reembolso deja una rectificativa `pending` en `fiscal_documents` y **no** crea nota de crédito en Stripe | Asesor y operación |

**Primera apertura propuesta** (lo que es claro, después del visto bueno del asesor; variables de `controlplane` en `live`, no aplicadas):
```
CP_STRIPE_TAX_POLICY=stripe_tax_exclusive
CP_STRIPE_FISCAL_SCENARIOS=business:es_mainland,business:es_special,business:eu,business:non_eu
CP_STRIPE_TAX_EXPECTATIONS=business:es_mainland=taxed,business:es_special=not_subject,business:eu=reverse_charge,business:non_eu=not_subject
CP_STRIPE_SCENARIO_COUNTRIES=business:non_eu=GB|CH|US|CA|AU|NO|AD
CP_CONSUMER_WITHDRAWAL=pending          (B2C cerrado hasta resolver la matriz, §3)
CP_TERMS_VERSION=<versión publicada>   CP_TERMS_URL=https://www.bigelephant.es/legal/condiciones
CP_PRIVACY_VERSION=<versión publicada> CP_PRIVACY_URL=https://www.bigelephant.es/legal/privacidad
```
**B2C:** se abre añadiendo `consumer:es_mainland` y `consumer:eu` con sus países y tipos (`CP_STRIPE_CONSUMER_RATES`), `CP_CONSUMER_WITHDRAWAL=immediate_execution_ack` y `CP_PRECONTRACT_VERSION`. Requiere **antes** la función de desistimiento (Directiva 2023/2673), que no existe todavía.

**Garantías del control de elegibilidad (PR #187):**
- un comprador no habilitado se rechaza **antes de crear** empresa, pedido o Customer;
- en live, el domicilio comprobado se fija en Stripe y Checkout no deja cambiarlo, así que el impuesto se calcula sobre él;
- NIF, NIE, CIF y NIF-IVA se comprueban por su forma, pero **no en VIES** (mejora propuesta para la inversión del sujeto pasivo);
- la alerta `invoice_tax_mismatch` sigue contrastando cada factura con el impuesto esperado.

## 3. Stripe Live: lo que se puede hacer hoy en el Dashboard (sin Railway)

1. **Stripe Tax → Registros → Añadir España**, IVA de régimen general. Sin este paso no se cobra IVA. Hacerlo después del visto bueno del asesor.
2. **Configuración → Facturación → Facturas:**
   - prefijo y numeración según DF-4;
   - datos del emisor: razón social, dirección y **NIF B26987875** (Tax ID de la cuenta, `es_cif`);
   - pie con «IRON ELEPHANT CONSULTING, S.L. · NIF B26987875 · Calle Corazón de María, 57, 1.º D, 28002 Madrid»;
   - activar **«Enviar facturas pagadas por correo»** y **«Enviar recibos de pago»**: Elephant no envía la factura, solo un aviso.
3. **Webhook `we_1USAv39RzfmCBuaiop8nwv1v` → añadir eventos:**
   - `customer.subscription.pending_update_applied`
   - `customer.subscription.pending_update_expired`
   - `invoice.voided`
4. **Customer Portal:** poner las URL de condiciones y privacidad, y mantener los cambios de plan desactivados en la apertura.
5. **Métodos de pago** (configuración por defecto): dejar **tarjeta, Link y Apple Pay** (Google Pay figura como no disponible en la cuenta: activarlo si Stripe lo permite). Desactivar Klarna, Amazon Pay, Bancontact, Blik, EPS, MB Way, Pix, Kakao, Naver, Payco, Satispay y Samsung Pay, que no encajan en una suscripción B2B en España. Opcional: domiciliación SEPA, que es asíncrona y el código ya la admite.
6. **Clave restringida `rk_live_` de `CP_STRIPE_API_KEY`.** Comprobar en Desarrolladores → Claves que es restringida y tiene exactamente:

| Recurso | Permiso |
|---|---|
| Customers | Escritura |
| Checkout Sessions | Escritura |
| Customer portal | Escritura |
| Prices, Products | Lectura |
| Subscriptions | Lectura. Escritura solo cuando se active la compra de módulos |
| Invoices | Lectura. Escritura solo si se anulan facturas desde la app; hoy no |
| Charges, Refunds, Disputes, Events, PaymentMethods | Lectura |
| Todo lo demás | Ninguno |

7. **Correos de Stripe al cliente** (Configuración → Correos de clientes): pago fallido, tarjeta a punto de caducar y recibo. Activarlos complementa los avisos propios.

## 4. Correo transaccional

**Recomendación:** mantener **Brevo** (ya integrado, con webhook de rebotes y supresión) en una **cuenta propia de Elephant**, separada de Náyade y Skicenter, con **IP dedicada** si el volumen lo justifica. La alternativa con el mismo código es SMTP genérico (`SMTP_HOST`, `SMTP_USER` y `SMTP_PASS`), por ejemplo Amazon SES o Postmark, pero pierde el webhook de rebotes.

**Riesgo abierto:** una IP compartida de Brevo (77.32.148.25) está en SpamCop y ya provocó un rebote a `soporte@bigelephant.es` (OVERNIGHT_5_OPERATIONS.md). Abrir incidencia con Brevo o pedir IP dedicada antes de enviar a clientes.

**DNS** (cambiarlos en el proveedor DNS, sin tocar MX):

| Registro | Valor | Estado |
|---|---|---|
| `bigelephant.es` TXT (SPF) | `v=spf1 a mx include:spf.brevo.com ~all` | Hoy no incluye a Brevo. DKIM ya alinea, pero así no falla SPF |
| `brevo1._domainkey` y `brevo2._domainkey` CNAME | `b1.bigelephant-es.dkim.brevo.com` y `b2.…` | Ya está |
| `_dmarc` TXT | Ahora `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`. **A las 2-4 semanas sin fallos:** `p=quarantine; pct=100` | Observación |

**Variables para el día de apertura** (en `controlplane` y `core`, salvo indicación):
- `BREVO_API_KEY` (secreto)
- `MAIL_SENDING_DOMAIN=bigelephant.es`, ya puesto
- `MAIL_MODE=live` y `MAIL_LIVE_AUTHORIZED=1`
- solo en `controlplane`:
  - `BREVO_WEBHOOK_TOKEN` (32 caracteres o más) y el webhook de Brevo apuntando a `https://<dominio de crm de live>/cp/v1/mail/brevo/webhook`, con la cabecera `x-elephant-webhook-token`;
  - `CP_NOTIFICATIONS_SINCE=<fecha de apertura>`.

**Antes de abrir:**
1. Un envío de cada plantilla a direcciones propias (Gmail, Outlook y un dominio corporativo).
2. Comprobar en las cabeceras SPF=pass, DKIM=pass y DMARC=pass.

**Flujos:**

| Flujo | Envía | Estado |
|---|---|---|
| Alta de empresa con enlace para crear la contraseña | Plano de control | Listo |
| Invitación de usuarios | Core | Listo; desde el PR #185, sin la copia global |
| Recuperación de contraseña de empresa | Core | Listo; desde el PR #185, sin la copia global |
| Recuperación de contraseña de operadores | Plano de control | Solo con `MAIL_MODE` distinto de `off` |
| Confirmación de contratación y de pago | Plano de control | Listo |
| Factura | **Stripe** (paso 2 del §3) | Elephant solo envía un aviso |
| Renovación cobrada e impago (día 0) | Plano de control | Listo |
| Recordatorios de impago de los días 3 y 6, y aviso previo a la renovación | — | **No existen.** Los cubren los correos de Stripe (paso 7 del §3) |
| Despachador de eventos | Plano de control | Sin tarea periódica: hay que llamar a `POST /cp/v1/notifications/dispatch` |

## 5. Dominios: matriz para el traslado de `production` a `live`

| Dominio | Servicio de `live` | Hoy | Variables de `live` |
|---|---|---|---|
| `www.bigelephant.es` | `web` | `production/web` | `web`: `PUBLIC_HOSTS="www.bigelephant.es bigelephant.es"` y `PUBLIC_ORIGIN=https://www.bigelephant.es`. `controlplane`: `CP_PUBLIC_ORIGINS=https://www.bigelephant.es`, y `CP_STRIPE_SUCCESS_URL`, `CP_STRIPE_CANCEL_URL` y `CP_STRIPE_PORTAL_RETURN_URL` en `https://www.bigelephant.es/…` |
| `bigelephant.es` | `web`, con redirección a `www` en el proveedor DNS (lo previsto); también se puede servir desde `web` | `production/web` | Igual que `www` |
| `admin.bigelephant.es` | `crm` | `production/crm` | `crm`: `OPERATOR_LOGIN_HOSTS=admin.bigelephant.es` (variable de la pasarela del CRM, que vive en su propio repositorio; en `production` ya está puesta). `controlplane`: añadir `https://admin.bigelephant.es` a `CP_ALLOWED_ORIGINS` |
| `app.bigelephant.es` | `core-gateway` | `production/core-gateway` | `core-gateway`: `APP_ENTRY_HOST=app.bigelephant.es` y `PUBLIC_HOSTS="app.bigelephant.es *.app.bigelephant.es"`. `core`: `CENTRAL_LOGIN_HOST=app.bigelephant.es` |
| `*.app.bigelephant.es` | `core-gateway` | `production/core-gateway` | `controlplane`: `CP_PLATFORM_DOMAINS=app.bigelephant.es,up.railway.app` y `CP_PLATFORM_TARGET`. Después, `scripts/railway/dominios-app.cjs --apply` con `ES_ENV=live` en cada alta |

**Comprobaciones previas al traslado:**
1. `live` desplegado con `8239625` y migrado. El arranque debe estar limpio y la web, el CRM y el Core deben responder en sus dominios técnicos.
2. **Bajar el TTL** de los registros a 300 s la víspera.
3. **No tocar** MX, SPF, `mail` ni DKIM.
4. En Railway: quitar el dominio de `production` y añadirlo en `live`. Railway da un CNAME y un TXT nuevos; cambiar ambos en el DNS y esperar al certificado.
5. **Cookies:** la de operador es `SameSite=Strict` y va en `Path=/cp/v1`, así que CRM y plano de control deben compartir origen a través de la pasarela `crm`. La de empresa usa `__Host-`.
6. **Login central:** necesita Referrer-Policy distinta de `no-referrer` (ya en el Caddyfile) y **una sola réplica del Core**.
7. El webhook de Stripe Live sigue en el dominio técnico de `crm` de `live`; no hace falta moverlo.
8. **Después:**
   - recorrido completo: web → presupuesto → login de operador → alta asistida → login central;
   - `node scripts/railway/smoke-empresas.cjs <id>` con cada empresa.
9. `production` (integración) se queda solo con sus dominios técnicos. Quitar de sus variables las referencias a `bigelephant.es`.

## 6. Orden el día que Railway reanude

1. Copia nueva y ensayo de restauración del registro y del CRM en bases nuevas (`rw-live drill`).
2. **Con autorización:**
   - migraciones del registro, 0012 y 0013;
   - `GRANT INSERT, UPDATE ON es_registry.tenant_usage TO 'es_core'@'%'`;
   - migraciones del CRM, de la 0014 a la 0019.
3. Despliegue de `8239625` (o posterior con #185) en `backup-job`, `restore-drill`, `controlplane`, `core`, `crm`, `web` y `core-gateway`, comprobando cada arranque.
4. Traslado de dominios (§5) y variables.
5. Publicar los textos legales aprobados y fijar `CP_TERMS_*` y `CP_PRIVACY_*`.
6. Correo (§4), con un envío de prueba a buzones propios.
7. **Apertura**, con confirmación expresa del propietario:
   - `CP_STRIPE_TAX_POLICY` y el resto del §2;
   - `CP_ORCHESTRATOR_ENABLED=1`, `CP_STRIPE_WORKER_ENABLED=1` y `CP_STRIPE_CHECKOUT_ENABLED=1`;
   - Essential y Business a «disponible» en el catálogo y publicar;
   - `CP_PUBLIC_SELF_SERVICE_ENABLED=1`;
   - primera compra real de Essential mensual con la propia empresa, reembolsable, para comprobar el cobro, el IVA del 21 %, la factura, el alta y el correo.
