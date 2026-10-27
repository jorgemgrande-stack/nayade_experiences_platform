# Suscripciones con cobro en Stripe desde el CRM

Comercial → Suscripciones y Comercial → Contrataciones forman un solo circuito. No hay otro motor de suscripciones, facturación ni webhooks: se reutilizan los pedidos del orquestador, Stripe Checkout y Billing, el procesador de eventos, la conciliación y las licencias.

## Circuito

1. **CRM → «Contratar con cobro en Stripe»** (Suscripciones). El comercial elige empresa, plan, periodicidad, módulos y usuarios, sedes o almacenamiento. El CRM muestra el precio aprobado y llama a `POST /cp/v1/orders` (`companyId` + `request`). El servidor cotiza con el catálogo aprobado: el navegador nunca fija importes.
2. **Contrataciones → aceptación** (`POST /orders/:id/accept`): el pedido pasa a `contracted`.
3. **Contrataciones → «Generar enlace de pago»** (`POST /stripe/orders/:id/checkout`). Se crea el Customer de la empresa y una Checkout Session en modo suscripción con todas las partidas (ver «Suscripciones modulares»).
4. **El cliente paga en Stripe.** Hasta ese momento no se cobra nada.
5. **Webhook firmado** (`checkout.session.completed`, `invoice.paid`…). El procesador relee el objeto en Stripe; el pedido se confirma, se aprovisiona la empresa, nace la suscripción interna y se conceden las licencias.
6. **Renovaciones:** Stripe cobra cada periodo. Cada `invoice.paid` se registra como renovación y avanza el periodo de la suscripción (`orchestrator.renew`). Los impagos, cancelaciones, reembolsos y disputas llegan por los mismos eventos y por la conciliación.

## Origen del cobro de una suscripción

`GET /subscriptions` y `GET /subscriptions/:id` devuelven `billing` (`server/orchestrator/subscriptionBilling.ts`):

- `{ source: "stripe", mode, orderId, orderReference, orderState, graceEndsAt, lastPayment }` cuando algún pedido de la suscripción tiene cobros verificados en Stripe. Es el mismo criterio que usa el orquestador (`isStripeProvider`).
- `{ source: "shadow" }` en cualquier otro caso: pruebas gratuitas, altas manuales o activaciones por aprobación administrativa.

Sobre una suscripción cobrada en Stripe, la API rechaza las operaciones de simulación con `409 invalid_state` y `details.reason: "stripe_billed"`. Son estas: renovaciones manuales, facturación sombra, cambios de plan, partidas o periodicidad, cancelación y reactivación. Los cambios se hacen en Stripe (Customer Portal o Dashboard) o con un pedido de cambio. El orquestador sigue aplicando sus efectos internamente.

## Garantías contra duplicados

| Riesgo | Protección |
|---|---|
| Doble clic o reintento al crear | Clave de idempotencia por formulario abierto: el mismo envío devuelve el mismo pedido |
| Segunda contratación para la misma empresa | El CRM avisa de la contratación viva y no deja crear otra; el servidor rechaza un alta nueva si la empresa ya tiene una suscripción viva |
| Dos enlaces de pago para un pedido | Como mucho una sesión abierta por pedido (se reutiliza), y una sesión completada impide abrir otra |
| Webhook repetido o fuera de orden | Eventos registrados una vez; el efecto se calcula releyendo el objeto en Stripe |
| Cobro duplicado por factura | Pago con clave idempotente por factura (`stripe:inv:<id>`) |

## Suscripciones modulares (fase 2)

Una contratación es **una sola suscripción de Stripe** con el plan Elephant Core y cada módulo o ampliación como partida. No hay otro motor: Checkout, procesador de eventos, conciliación y compras son los de siempre.

### Alta por Checkout

`server/stripe/checkoutLines.ts` construye las partidas a partir del **presupuesto del servidor** (cotizador con el catálogo publicado):

- Cada línea cobrada usa el Price enlazado (`stripe_prices`) de su precio aprobado y de **su** periodicidad, con su cantidad (usuarios, sedes o almacenamiento adicionales).
- Antes de abrir el pago se comprueba que cada Price real de Stripe tiene el importe aprobado y que la suma es el importe del contrato del pedido. Nunca se inventa ni se ajusta un importe.
- Solo el plan → la misma sesión de antes (mismos parámetros).

| Configuración | Qué se cobra en Checkout | Después |
|---|---|---|
| Plan mensual + módulos + ampliaciones | Todas las partidas, mensuales | Stripe cobra todo cada mes |
| Plan anual + módulos con tarifa anual | Todas las partidas, anuales | Stripe cobra todo cada año |
| Plan anual + partidas solo mensuales (módulo sin tarifa anual, usuarios, sedes, almacenamiento) | Lo anual como partidas recurrentes + **el primer mes** de lo mensual como importe único, en el mismo pago | Al activarse el pedido, las partidas mensuales se añaden sin prorrateo a la misma suscripción y Stripe las cobra cada mes |

Stripe Checkout no crea suscripciones con periodicidades mixtas. Por eso la tercera fila se resuelve en dos pasos. El primer pago cubre todo lo contratado, así que no se concede ningún derecho sin cobrar. Después, `server/stripe/deferredItems.ts` añade las partidas mensuales a la suscripción:

- Lo hace al procesar la activación (procesador de eventos), con un registro idempotente en `stripe_subscription_changes`: un pedido, un cambio.
- Si Stripe no responde, la conciliación de compras lo reenvía con la misma clave. Hay alertas `stripe.deferred_items_pending` y `stripe.deferred_items_blocked`.
- Las suscripciones que crea Checkout están en modo de facturación `flexible`, que Stripe exige para mezclar periodicidades. Una suscripción en modo `classic` nunca se toca.

El pedido guarda el neto del primer periodo (`quote.firstPeriodNetCents` = anual + un mes). El procesador exige ese importe a la primera factura; en un pedido anterior sigue siendo el importe del contrato.

La renovación mensual se registra como pago de renovación y no adelanta el periodo anual de la suscripción interna. El motor interno ya llevaba la periodicidad de cada partida.

### Altas y bajas posteriores (prorrateo)

El motor de compras (`server/stripe/purchases.ts`) usa ahora el precio de la periodicidad de cada partida. Un módulo mensual se puede añadir o quitar en un plan anual si la suscripción de Stripe está en modo `flexible`; si no, se explica y no se toca Stripe.

- **Alta o aumento:** Stripe cobra el prorrateo del periodo de la partida y aplica el cambio solo si el cobro se completa. Los derechos se conceden con el cobro verificado.
- **Baja o reducción:** Stripe deja de cobrar la partida sin abonos. El derecho dura hasta el fin del periodo **de esa partida**, de modo que un módulo mensual de un plan anual se va al acabar su mes.

Los operadores usan el mismo motor desde el CRM. La empresa se traduce a su tenant en el servidor y aplican los mismos importes, la misma idempotencia y el mismo interruptor `CP_COMMERCE_PURCHASES_ENABLED`:

```
POST /cp/v1/commerce/companies/:companyId/purchases/preview    orders:write
POST /cp/v1/commerce/companies/:companyId/purchases            orders:write  (idempotencyKey)
POST /cp/v1/commerce/companies/:companyId/reductions/preview   orders:write
POST /cp/v1/commerce/companies/:companyId/reductions           orders:write  (idempotencyKey)
```

### Qué no se cobra por Checkout

- Planes de propuesta comercial (Enterprise).
- Productos sin precio enlazado en Stripe: «bajo solicitud», «próximamente» o sin sincronizar. Solo los productos `available` tienen Price.
- Líneas presupuestadas aparte, productos internos de pruebas y más de 20 partidas (límite de Stripe).

En esos casos el servidor y el CRM explican el motivo y no abren el pago. La contratación se activa con aprobación administrativa o sin esas partidas.

### Pruebas

`server/controlPlane.modularSubscriptions.test.ts` usa la aplicación real del plano de control, el doble de Stripe y firmas reales del SDK. Cubre:

- Plan mensual con módulo y usuarios.
- Plan anual con módulo anual, módulo mensual y usuarios: primer mes en el mismo pago, partidas añadidas sin prorrateo y renovación mensual.
- Altas y bajas posteriores desde el CRM con prorrateo.
- Webhooks repetidos.
- Producto sin precio enlazado, suscripción en modo clásico y aislamiento entre empresas.

**Pendiente de comprobar en el sandbox real:** en qué fecha cobra Stripe por primera vez una partida mensual añadida a una suscripción anual en modo `flexible`. Debería ser al mes del alta, porque el primer mes ya se cobró como importe único.
