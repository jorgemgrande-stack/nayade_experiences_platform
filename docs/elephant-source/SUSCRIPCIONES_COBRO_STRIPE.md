# Suscripciones con cobro en Stripe desde el CRM

Comercial → Suscripciones y Comercial → Contrataciones forman un solo circuito. No hay otro motor de suscripciones, facturación ni webhooks: se reutilizan los pedidos del orquestador, Stripe Checkout y Billing, el procesador de eventos, la conciliación y las licencias.

## Circuito

1. **CRM → «Contratar con cobro en Stripe»** (Suscripciones). El comercial elige empresa, plan, periodicidad y complementos. El CRM muestra el precio aprobado y llama a `POST /cp/v1/orders` (`companyId` + `request`). El servidor cotiza con el catálogo aprobado: el navegador nunca fija importes.
2. **Contrataciones → aceptación** (`POST /orders/:id/accept`): el pedido pasa a `contracted`.
3. **Contrataciones → «Generar enlace de pago»** (`POST /stripe/orders/:id/checkout`). Se crea el Customer de la empresa y una Checkout Session en modo suscripción.
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

## Límites actuales de Checkout

Solo se cobra con Checkout **Essential o Business, mensual o anual, sin complementos ni ampliaciones**. Lo demás no admite enlace de pago, y tanto el CRM (`checkoutScopeBlocker`) como el servidor (`server/stripe/checkout.ts`) lo explican. Así nunca se cobra un importe distinto del contratado. Esas contrataciones se activan con aprobación administrativa o se contrata solo el plan.

## Fase 2: plan y complementos en una única suscripción

Ya existe:

- Los complementos disponibles tienen sus Prices enlazados en Stripe (`desiredCatalog`, familias comprables).
- El procesador de eventos compara las partidas de la suscripción de Stripe con las contratadas (`checkItems` y `contractedItems`).
- La compra desde la plataforma ya cambia partidas en Stripe con cobro condicionado (`server/stripe/purchases.ts`).

Lo que falta:

1. `server/stripe/checkout.ts` (`start`): construir `line_items` con el Price del plan y uno por complemento (con su cantidad) a partir de `order.request.items`, en lugar de rechazarlos. El importe recurrente del presupuesto debe coincidir con la suma de los Prices de Stripe (generaliza la comprobación actual de `conflict`).
2. Las ampliaciones por cantidad (usuarios, sedes, almacenamiento) se cobran como cantidad del Price por unidad del complemento correspondiente.
3. **Periodicidad única:** una suscripción de Stripe cobra todas sus partidas con el mismo intervalo. Un complemento solo mensual en un plan anual seguiría bloqueado, con su motivo, hasta decidir si se cobra aparte.
4. Quitar la restricción de complementos en `checkoutScopeBlocker` (CRM) y en `checkout.ts`. Es la única regla de alcance de cada lado.
5. Pruebas: Checkout con varias partidas, factura pagada con las partidas esperadas, un complemento sin Price enlazado y la discordancia de importe.
