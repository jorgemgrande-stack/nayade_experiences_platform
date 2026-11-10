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

Los importes son los de los Prices REALES de Stripe (se releen). Con un plan anual y un producto solo mensual, el
primer mes del producto va en el mismo pago y se renueva cada mes en la misma suscripción.

### `POST /start`
Cuerpo estricto (cualquier campo de más, p. ej. un importe, da `400 invalid_request`):
`{ idempotencyKey (uuid, uno por carrito), plan, interval, products?, buyer (obligatorio en live), company? (solo pruebas), admin: { name, email }, consents: { terms: true, privacy: true, termsVersion, privacyVersion?, precontractVersion?, immediateExecution? }, ticket (GET /cp/v1/public/form-ticket), website (trampa, vacío) }`

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
| 409 | `idempotency_mismatch` | La misma clave con otro carrito |
| 409 | `company_exists` | Ya hay una empresa con ese NIF (se amplía desde su panel) |
| 409 | `terms_outdated`, `consent_outdated` | Textos legales cambiados |
| 409 | `invalid_state`, `conflict` | Pago ya completado o sesión en conflicto: ir a la página de estado |
| 403 | `not_eligible` | Tipo de cliente o país no cobrable |
| 400 | `too_fast`, `invalid_ticket` | Recargar el ticket |
| 429 | `rate_email` | Demasiados intentos con el correo |
| 503 | `unavailable`, `terms_unpublished` | Venta cerrada, catálogo o Stripe sin sincronizar, Price de Stripe distinto del aprobado |

## Garantías
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
1. Verificación en sandbox completada.
2. `controlplane`: `CP_PUBLIC_CHECKOUT_PRODUCTS=social-token-net-complete` (u otras claves aprobadas). Con el
   autoservicio apagado no tiene efecto.
3. `controlplane`: `CP_PUBLIC_SELF_SERVICE_ENABLED=1` (se monta `/offer`, `/quote` y `/start`). Comprobar en el log
   `ctx: "Stripe"` → `selfService: true` y `publicProducts`.
4. Comprobar `GET /offer` y `POST /quote` (88 €) desde el origen de la web.
5. Web: `PUBLIC_CHECKOUT_*` para mostrar el carrito y el pago.
6. Apagado inmediato: quitar `CP_PUBLIC_SELF_SERVICE_ENABLED` (404 otra vez) o vaciar la lista blanca (solo plan).
