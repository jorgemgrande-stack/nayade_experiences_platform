# Checkout unificado de la web pública (10/11/2026)

Decisión de Jorge: la compra en línea contrata un **plan Elephant Core obligatorio** junto con las soluciones Net y
las extensiones Connect habilitadas para la venta en línea (ejemplo: Essential 29 € + Social Token Net 59 € = 88 €/mes
más impuestos), en **una** Checkout Session y **una** suscripción de Stripe. El checkout no es exclusivo de ningún producto.

Código: `server/stripe/publicCart.ts` (validación del carrito), `server/stripe/selfService.ts` (rutas públicas),
`server/stripe/checkout.ts` y `checkoutLines.ts` (sesión con todas las partidas, ya existentes), procesador de eventos y
webhook (ya existentes). Pruebas: `server/controlPlane.publicCheckout.test.ts` y `server/stripe/selfService.test.ts`.

## Interruptores (todos apagados en production)

| Variable (servicio `controlplane`) | Efecto | Valor en production |
|---|---|---|
| `CP_PUBLIC_SELF_SERVICE_ENABLED=1` | Monta `/offer`, `/quote` y `/start` | sin definir (404) |
| `CP_PUBLIC_CHECKOUT_PRODUCTS` | Lista blanca de productos comprables además del plan (claves separadas por comas) | vacía: solo el plan |
| `CP_PUBLIC_CHECKOUT_ENABLED=1` | `/status` (página de retorno) | ya activo |

El autoservicio necesita además Checkout montado (`CP_STRIPE_CHECKOUT_ENABLED=1`, URLs de vuelta y, en live, política
fiscal), `CP_TERMS_VERSION` y los orígenes de la captación pública.

## Contrato de la API (base `/cp/v1/public/checkout`)

Todas las rutas exigen `Origin` permitido y responden `Cache-Control: no-store`. Errores:
`{ error, message, product? }` (el `message` está en español y se puede mostrar).

### `GET /offer`
Planes y productos que pasan TODAS las reglas: lista blanca; «available»; no heredado (`catalog.legacy` ni antigua
extensión de Net); no interno; familia comprable y no ampliación por cantidad; oferta inmediata con Checkout; precio
aprobado enlazado a un Price activo.

`200 { enabled, plans: [{ key, name, family, monthlyCents, yearlyCents, dependencies, bundleOf }], products: [...], currency: "EUR", taxIncluded: false, catalogVersion }`

### `POST /quote`
`{ plan, interval: "month"|"year", products?: [claves] (≤19), buyer?: { type, country, postalCode?, taxId? } }`

`200 { ok, catalogVersion, currency, plan, lines: [{ key, name, family, quantity, unitCents, amountCents, interval }], totals: { firstChargeNetCents, monthlyNetCents, yearlyNetCents }, tax: { treatment, estimatedRateBp, estimatedTaxCents, estimatedGrossCents, final: false }, eligibility? }`

Los importes son los de los Prices REALES de Stripe (se releen). **Plan y productos con la misma periodicidad:** un plan
anual con un producto que solo tiene tarifa mensual se rechaza (`409 incompatible`, «… solo se contrata mensualmente:
elige el plan mensual»). Stripe admite suscripciones con periodicidades mixtas en modo flexible (API `2025-07-30.basil` o
posterior; el Core usa `2026-09-30.endive`), pero **no las crea desde una Checkout Session**
(https://docs.stripe.com/billing/subscriptions/mixed-interval, apartado «Limitations»). El Core tiene una vía para eso
(primer mes como importe único y la partida mensual añadida después, `deferredItems.ts`, que necesita escribir en la
suscripción), pero no se abre a la web sin validarla en el sandbox y sin la decisión de Jorge.

### `POST /start`
Cuerpo estricto (cualquier campo de más, p. ej. un importe, da `400 invalid_request`):
`{ idempotencyKey (uuid, uno por intento de compra: se conserva aunque el comprador cambie el carrito), plan, interval, products?, expectedFirstChargeNetCents? (el total de /quote, solo para comparar), buyer (obligatorio en live), company? (solo pruebas), admin: { name, email }, consents: { terms: true, privacy: true, termsVersion, privacyVersion?, precontractVersion?, immediateExecution? }, ticket (GET /cp/v1/public/form-ticket), website (trampa, vacío) }`

`200 { sessionId, url, expiresAt }`

### `GET /status?session_id=cs_…`
`{ state: pending_payment|payment_processing|provisioning|ready|failed|expired, message, accessUrl?, retryAfterSeconds? }`

### Códigos de error
| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `invalid_request` | Esquema incorrecto o campos de más |
| 400 | `plan_required` | Sin plan, o un producto en lugar del plan |
| 400 | `too_many_products` | Más de 19 productos |
| 409 | `plan_not_self_service` | El plan no se contrata en línea (p. ej. Enterprise) |
| 409 | `no_online` | Fuera de la lista blanca, bajo solicitud, próximamente, asistido, sin Price Live (`product`) |
| 409 | `legacy` | Producto retirado (el mensaje dice por cuál se sustituye) |
| 409 | `incompatible` | Paquete con su componente, dependencia o compatibilidad |
| 409 | `price_changed` | El total cambió desde /quote: volver a mostrar el presupuesto |
| 409 | `payment_in_progress` | Cambio de carrito con un pago ya completado o en curso: ir a la página de estado |
| 409 | `company_exists` | Ya hay una empresa con ese NIF (si es cliente, se amplía desde su panel) |
| 409 | `company_name_taken` | Ya hay una empresa con ese nombre |
| 409 | `not_contractable`, `idempotency_conflict` | El pedido no se pudo preparar (catálogo cambiado o clave reutilizada): revisar el carrito |
| 409 | `terms_outdated`, `consent_outdated` | Textos legales cambiados |
| 409 | `invalid_state`, `conflict` | Pago ya completado o sesión en conflicto: ir a la página de estado |
| 403 | `not_eligible` | Tipo de cliente o país no cobrable |
| 400 | `too_fast`, `invalid_ticket` | Recargar el ticket |
| 429 | `rate_email` | Demasiados intentos con el correo |
| 503 | `unavailable`, `terms_unpublished` (también un `StripeCheckoutError` «unavailable») | Venta cerrada, catálogo o Stripe sin sincronizar, Price de Stripe distinto del aprobado |

## Garantías
- Cambio de carrito con la misma clave (pedido abandonado que se convierte en otro):
  1. Se buscan los pedidos de esa clave (`ss-<uuid>` y sus variantes `ss-<uuid>-vN`) en la empresa creada en el primer intento.
  2. Si el mismo carrito ya tiene un pedido vivo, se devuelve su sesión (o se abre otra si caducó). No se crea nada.
  3. Si alguno de esos pedidos está confirmado, más allá de `contracted` o con una sesión **completada** en Stripe, no se
     toca nada y se responde `409 payment_in_progress` (lo confirmará el webhook).
  4. Si no, cada pedido sin pagar se cierra: se **caduca su sesión en Stripe** (`checkout.sessions.expire`; una sesión
     caducada ya no se puede pagar), se vuelve a comprobar que no se pagó justo antes (si se pagó, se conserva y se responde
     `payment_in_progress`) y se rechaza el pedido (contrato cancelado, nada activado).
  5. Se crea el pedido nuevo (`ss-<uuid>-vN`) para la MISMA empresa, sin otra ficha ni contacto, con su propia sesión.
  Nunca hay dos sesiones pagables a la vez para la misma clave: no puede haber dos cargos ni dos suscripciones. Si la
  caducidad falla en Stripe (por ejemplo, porque la sesión acaba de completarse), no se sigue.
- Dos envíos simultáneos con la misma clave se atienden uno tras otro y reciben la misma sesión.
- Ventana de exposición: la lista blanca, lo heredado y la modalidad se comprueban al iniciar o reanudar el pago. Una sesión
  ya abierta (como mucho 2 h) se puede pagar aunque el producto se retire mientras tanto; el cobro sí vuelve a comprobar el
  estado comercial, los Prices reales y el importe.
- El presupuesto (`/quote`) reutiliza durante 60 s la lectura de Prices de Stripe; el alta y el cobro los leen en vivo.
- El navegador solo envía claves. Importes, precios, compatibilidades, licencias y disponibilidad los decide el servidor.
- Sin dobles cargos: una clave = un pedido = como mucho una sesión abierta; un pedido pagado no abre otra sesión; un NIF
  ya registrado no crea otra empresa ni otra suscripción.
- Ninguna licencia antes del pago: el pedido queda `contracted` hasta que el procesador de eventos relee en Stripe la
  factura PAGADA con el importe del presupuesto (webhook firmado o conciliación). La vuelta del navegador no da acceso.

## Impuestos y datos de facturación
Precios sin IVA (`tax_behavior: exclusive`). En live (`CP_STRIPE_TAX_POLICY=stripe_tax_exclusive`) Stripe Tax calcula el
impuesto en la página de pago con la dirección y el NIF; a empresas se les exige NIF (fijado en el Customer si es
español válido o está verificado en VIES). La estimación de `/quote` es orientativa.

## Validación en el sandbox de Stripe (configuración humana)
1. Crear en el sandbox una clave restringida `rk_test_` con los permisos de `STRIPE_FASE_A.md` §5 (incluidos
   `charge_read` y `dispute_read`).
2. Crear el destino de webhooks con la URL del entorno de pruebas (`…/cp/v1/stripe/webhook`), versión
   `2026-09-30.endive`, carga snapshot y los eventos del §5; copiar su `whsec_`.
3. Crear en el sandbox los Products y Prices del plan de escrituras (`desiredCatalog`/`planCatalogWrites`) y
   sincronizarlos.
4. En el entorno de pruebas: `CP_STRIPE_MODE=test`, `CP_STRIPE_API_KEY`, `CP_STRIPE_WEBHOOK_SECRET`,
   `CP_STRIPE_CHECKOUT_ENABLED=1`, URLs de vuelta, `CP_TERMS_VERSION`, `CP_PUBLIC_CHECKOUT_ENABLED=1`,
   `CP_PUBLIC_SELF_SERVICE_ENABLED=1` y `CP_PUBLIC_CHECKOUT_PRODUCTS=social-token-net-complete`.
5. Pagar con la tarjeta de pruebas 4242 4242 4242 4242 y comprobar `/status` → `ready` y las licencias.

## Encendido en production (requiere la aprobación de Jorge)
0. Requisito del catálogo: los planes y productos publicados deben tener la oferta efectiva `modality: immediate` con
   `checkout: true` (en production, el 10/11/2026: Essential y Business sí; Social Token Net Complete sí). Sin ella, el
   plan o el producto no se vende en línea (`plan_not_self_service` / `no_online`).
1. Verificación en sandbox completada.
2. `controlplane`: `CP_PUBLIC_CHECKOUT_PRODUCTS=social-token-net-complete` (u otras claves aprobadas). Con el
   autoservicio apagado no tiene efecto. Una lista con claves no válidas se ignora entera (solo plan) y se avisa con
   `public_products_invalid` en el registro.
3. `controlplane`: `CP_PUBLIC_SELF_SERVICE_ENABLED=1` (se monta `/offer`, `/quote` y `/start`). Comprobar en el log
   `ctx: "Stripe"` → `selfService: true` y `publicProducts`.
4. Comprobar `GET /offer` y `POST /quote` (88 €) desde el origen de la web.
5. Web: `PUBLIC_CHECKOUT_*` para mostrar el carrito y el pago.
6. Apagado inmediato: quitar `CP_PUBLIC_SELF_SERVICE_ENABLED` (404 otra vez) o vaciar la lista blanca (solo plan).
