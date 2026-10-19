# Facturación de Elephant Source en `live`: estado técnico y decisiones pendientes (19/10/2026)

**Para:** el propietario y su asesor fiscal.
**Alcance:** circuito de cobro y facturación de las suscripciones Essential y Business con Stripe live.

Complementa `FISCALIDAD_STRIPE.md`, donde están descritas DF-1 (resuelta) y DF-2 a DF-8. Aquí no se toma ninguna decisión fiscal ni se activa nada.

**Situación hoy:**
- Stripe live conectado.
- Checkout bloqueado (`tax_policy_pending`).
- Contratación pública cerrada.
- `MAIL_MODE=off`.
- 0 clientes, 0 suscripciones, 0 cobros.

## 1. Qué funciona y qué está pendiente, pieza a pieza

Comprobado con el código que corre en `live` (`b1e3786`, el mismo código de Stripe que la integración) y con lecturas de la cuenta real. Resultado de las pruebas automáticas: 272/272, incluidas las de MySQL 8.4 real.

| Pieza | Qué hace hoy el sistema | Estado |
|---|---|---|
| **Planes mensuales y anuales** | 4 precios live sin IVA (`tax_behavior=exclusive`), coincidentes con los `web_prices` 1–4: Essential 29 €/mes y 279 €/año; Business 79 €/mes y 759 €/año. Catálogo sincronizado: 4 enlazados, 0 discordancias | ✅ Listo |
| **IVA (Stripe Tax)** | Con `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive`: `automatic_tax`, NIF y dirección de facturación obligatorios, metadato `es_tax_treatment` y aviso legal. El pedido se confirma comparando el **subtotal** (sin IVA) con el neto del presupuesto; el pago se guarda por el importe cobrado (con IVA) | ⚠️ El código está listo, pero **la cuenta no tiene ningún registro fiscal en Stripe Tax** (ver H1) |
| **Facturas** | Las emite Stripe Invoicing por cada cobro (alta y renovación). Aviso «factura disponible» al cliente (con el correo encendido) remitiendo al Customer Portal | ⚠️ Pendiente DF-2 (quién emite la factura legal), DF-4 (series) y VeriFactu (D-12) |
| **Abonos / rectificativas** | Un reembolso o disputa se relee del cargo y se guarda en `stripe_charge_adjustments`. Total o disputa perdida → pedido retenido (suspendido). Parcial o disputa abierta → solo aviso. **No se genera ninguna nota de crédito ni factura rectificativa** | ❌ Pendiente D-10 |
| **Cambios de plan** | El código remite al Customer Portal, pero en el Portal live los cambios de plan están **desactivados**. Un cambio hecho a mano en el Dashboard se rechaza como discordancia («¿cambio de plan sin aplicar?») | ❌ No hay camino operativo (ver H2 y D-11) |
| **Cancelaciones** | Desde el Portal, a final de periodo, sin prorrateo y con motivo → cancelación programada en el pedido → fin. Deshacerla reactiva («Suscripción reactivada») | ✅ Listo |
| **Renovaciones** | `invoice.paid` con `subscription_cycle` → pago de renovación verificado, pedido renovado y aviso «renovación confirmada» y «factura disponible», idempotente por pago | ✅ Listo |
| **Impagos** | `invoice.payment_failed` o `past_due` → periodo de gracia, después suspensión. Pago recuperado → reactivación. Nunca se borran datos | ⚠️ El código está listo. Falta revisar en el Dashboard live **Revenue recovery** (Smart Retries y qué hacer tras el último intento); no se puede leer por la API |
| **Reembolsos** | Se hacen en el Dashboard de Stripe (la clave del sistema no puede reembolsar). El sistema los registra y aplica la retención descrita | ⚠️ Falta el procedimiento fiscal (D-10) |
| **Conciliación** | Cada minuto: recupera webhooks perdidos (`GET /v1/events`), reprocesa pendientes con espera creciente, relee suscripciones y cierra sesiones caducadas. Purga eventos terminados de más de 180 días. Probada en live: `200`, sin errores | ✅ Listo |
| **Webhook** | Firma verificada sobre el cuerpo original. Rechaza firma falsa (400), marca de tiempo antigua (400), cuerpo de más de 1 MB (413) y otro método (401 de la pasarela). Eventos del otro modo descartados. Registro único por evento | ✅ Listo. Pendiente una prueba con un evento real firmado (ver §4) |

## 2. Hallazgos técnicos

| # | Hallazgo | Riesgo | Propuesta |
|---|---|---|---|
| **H1** | Stripe Tax está **activo** (sede: Madrid, código de producto por defecto `txcd_10103001`, SaaS para empresas), pero con **0 registros fiscales**. Stripe solo calcula impuestos donde hay registro | Si se activara `stripe_tax_exclusive` hoy, **se cobraría sin IVA** a clientes españoles | Antes de la política fiscal: alta del registro de **España** en Stripe Tax y, si se vende a consumidores de la UE, de **OSS** (D-9). Comprobación: `GET /v1/tax/registrations` con el MCP (la clave del sistema no tiene ese permiso, a propósito) |
| **H2** | Cambios de plan sin camino: el Portal no los permite y el procesador rechaza los que no salen de un Checkout del pedido | Un cliente que quiera pasar de Essential a Business no puede hacerlo sin intervención técnica | Decidir la política (D-11) y entonces activar `subscription_update` en el Portal con su prorrateo, o definir un procedimiento del operador; requiere un cambio de código acotado en `verified()` |
| **H3** | Los reembolsos no generan nota de crédito ni rectificativa | Incumplimiento formal si la factura legal es la de Stripe | D-10 |
| **H4** | El Portal live no tiene las URL de condiciones y privacidad (`business_profile`) | El cliente no ve los textos legales en el Portal | Rellenarlas al publicar los textos legales |
| **H5** | La **aprobación administrativa** (operador con `orders:approve`) confirma y aprovisiona un pedido **sin pago** y sin exigir condiciones publicadas | Es un camino intencionado para altas asistidas, pero puede dar acceso sin cobro | Mantenerlo solo para casos excepcionales y documentados. Valorar exigir MFA obligatorio a ese rol (ventana de accesos) |
| **H6** | La conciliación (`CP_STRIPE_WORKER_ENABLED`) estaba apagada en `live` | Sin reintentos ni recuperación de webhooks perdidos | **Corregido** el 19/10 (`worker=true`) |
| **H7** | La primera clave restringida live no tenía Events, Charges ni Disputes | Fallaban la conciliación, los reembolsos y las disputas | **Corregido**: clave v2 con los 10 permisos; la anterior está revocada |

## 3. Decisiones pendientes para el propietario y el asesor fiscal

Nada de esto lo decide la parte técnica. Se indica qué hace falta una vez decidido.

| # | Decisión | Opciones | Qué implica técnicamente |
|---|---|---|---|
| DF-2 | Quién emite la factura legal | Stripe Invoicing / software propio o certificado | Con Stripe: prefijo, datos del emisor y pie legal en la cuenta. Con otro software: integración y Stripe solo como pasarela |
| DF-3 | Cálculo del IVA | Stripe Tax / tipos fijos / cálculo propio | Con Stripe Tax: `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive` (la única que admite el código) **y** el registro de H1 |
| DF-4 | Series de numeración | Una / por canal / una para rectificativas | Prefijo de facturas en la cuenta live |
| DF-5 | ¿Venta a consumidores? | Solo empresas / también consumidores | Si solo empresas: el NIF ya es obligatorio en Checkout. Si también consumidores: precios con IVA (DF-8), información precontractual y desistimiento |
| DF-6 | Mercados | España / UE / mundo | Países admitidos en Checkout; OSS |
| DF-7 | Canarias, Ceuta y Melilla | Admitir / excluir | Exclusión por código postal o tratamiento fuera del IVA |
| DF-8 | Precio publicado | Sin IVA (B2B) / con IVA (B2C) | Con IVA: nuevos Prices (un Price no cambia de `tax_behavior`) |
| **D-9** | Registros en Stripe Tax | España / España + OSS | Alta en el Dashboard live → Tax → Registrations. Es requisito de DF-3 |
| **D-10** | Reembolsos y abonos | Nota de crédito de Stripe por reembolso / rectificativa en el sistema emisor | Procedimiento del operador; si es en Stripe, los reembolsos se hacen desde la factura con nota de crédito |
| **D-11** | Cambios de plan | Inmediato con prorrateo / a final de periodo / solo por el equipo | Configuración del Portal y ajuste de código (H2) |
| **D-12** | VeriFactu | Software emisor que lo cumpla / Stripe con integración / otro | Afecta a DF-2: valorar si las facturas de Stripe cumplen la obligación aplicable a la empresa emisora |
| **D-13** | Recuperación de impagos | Reintentos de Stripe y política tras el último intento | Recomendado: marcar la suscripción como `unpaid` (conserva datos y suspende) |

## 4. Prueba pendiente: evento real firmado

La firma, el rechazo de peticiones inválidas, la idempotencia, los duplicados, el orden y los reintentos están cubiertos por pruebas automáticas y por la verificación en live.

Falta ver llegar a `live` un **evento real firmado por Stripe**. El mecanismo sin coste (crear y caducar al instante una sesión de Checkout: no hay cargo, cliente, factura ni suscripción) está **bloqueado por el sistema de permisos** como transacción real. Se respeta el bloqueo.

Opciones:
- el propietario autoriza esa operación concreta;
- se acepta que el primer evento real sea el del primer cobro autorizado.

## 5. Qué falta para el primer cobro real

1. Decisiones DF-2, DF-3, DF-5, D-9, D-10 y D-12 tomadas.
2. Registro fiscal en Stripe Tax (H1).
3. Textos legales aprobados y publicados (hoy son borradores). Después: `CP_TERMS_VERSION` y las URL del Portal (H4).
4. `CP_STRIPE_TAX_POLICY=stripe_tax_exclusive`, con autorización expresa.
5. `CP_STRIPE_CHECKOUT_ENABLED=1` para los enlaces del CRM, con autorización expresa. La contratación pública (`CP_PUBLIC_*`) es otra decisión.
6. Correo transaccional: SPF con Brevo, clave de Brevo en `live` y `MAIL_MODE` real.
7. Autorización del primer cobro.
