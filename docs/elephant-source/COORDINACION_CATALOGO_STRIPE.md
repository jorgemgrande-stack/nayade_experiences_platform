# Coordinación: ventana de Catálogo y ventana de Stripe (Elephant Net + Core)

Documento vivo entre las dos ventanas. Cada ventana edita **solo su sección** y añade entradas fechadas al registro; nadie reescribe lo de la otra. El contrato técnico es [CONTRATO_CATALOGO_COMERCIAL_STRIPE.md](CONTRATO_CATALOGO_COMERCIAL_STRIPE.md) (v3); este documento solo dice quién hace qué y en qué punto está.

Estado a 27/10/2026: la política Elephant Net + Core está implementada y desplegada **apagada** (`commercialPolicy` desactivada en live y production). Ninguna suscripción real cambia.

## 1. Reparto

| Área | Responsable | La otra ventana |
|---|---|---|
| Catálogo, fichas, reglas, cotizador comercial (`server/catalog/**`, `server/web/**`), web y CRM de catálogo | Catálogo | No lo reconstruye; pide cambios aquí o por mensaje |
| Cobros: pasarela, Checkout, compras, cambios de plan, conciliación, fiscalidad (`server/stripe/**`, `server/orchestrator/**`, `server/subscriptions/**`, `server/controlPlane/**` de cobro) | Stripe | No lo toca; avisa antes de fusionar algo que lo afecte |
| Pruebas de sandbox (`scripts/catalog/netCoreStripeSandbox.ts`) | Stripe las ejecuta y adapta | Catálogo mantiene los importes esperados |
| Encender la política | Ninguna sola: requiere §5 completo y autorización de Jorge | — |

## 2. Lo que el catálogo ya entrega (Core #383, #387; CRM #73, #74; web #23, #24)

- **Reglas** (`server/catalog/commercial/policy.ts`, `rules.ts`): Essential incluido en cada Net completo; ampliación a Business +50 €/mes o +480 €/año; Enterprise +170 €/mes (anual por presupuesto); Net adicional −29 €/mes; mismo Net duplicado = error; sin cuota anual de Essential si va incluido.
- **Cotización** (`commercialQuote.ts`), campos que Stripe debe consumir:
  - `policyVersion`: huella inmutable (16 hex) de la política aplicada.
  - `lines[].status`: `included_in_net` (0 €, forzada a mensual), `core_upgrade` (diferencia de tarifas), `net_additional` (precio − 2900).
  - `discounts.coreIncludedCents`, `netCore { nets, corePlan, providedBy }`.
  - `contractModel`: `"legacy"` = sin composición (importes históricos); `"composite"` = los Net ya contratados también aportan Core; sin valor = solo los Net nuevos componen.
- **Auditoría** (`integrity.ts`, `coreAudit`): `coreCobradoDosVeces`, `netConCoreAparte`, `netSinCore`, expuesta en `commercial-integrity` como `coreUnico`.
- **Simulaciones** (`GET /web/commercial/net-simulations`): 7 escenarios por Net, 0 incidencias en live.
- **Pruebas existentes a reutilizar**: `server/netCoreIncluded.test.ts`, `server/commercialQuote.test.ts`, `server/commercialIntegrity.test.ts`, `server/commercialCatalog.test.ts`.

## 3. Comparación del código de cobro con la v3 (27/10/2026)

Búsqueda en `server/` fuera de `catalog/` y `web/`: no aparecen `net_inclusion`, `totalExcludingTax`, `included_in_net`, `core_upgrade`, `net_additional`, `policyVersion`, `contractModel`, `providedBy` ni `proration_date`. Es decir, **P0-A … P0-J (v3 §8) están sin empezar** en el lado de cobro. Core #388 (espacios de nombres por modo) no los cubre.

## 4. Sección de la ventana de Stripe

_Pendiente de completar por la ventana de Stripe: estado de P0-A … P0-J, PR, mecánica elegida y resultados del sandbox._

## 5. Pruebas que faltan para autorizar la activación

Unitarias con `FakeStripeGateway` (v3 §9, U1–U20) y sandbox con *test clocks* (S1–S5 de la v2 y S-N1 … S-N8). Las decisivas:

| Prueba | Qué decide |
|---|---|
| S-N2 prorrateo del cupón en subida a mitad de periodo | Cupón (A) si da (79 − 29) × f; tarifas derivadas (B) si da 79 × f − 29 |
| S-N1 / U3 neto tras cupón = `firstPeriodNetCents` y base fiscal | Aceptado = cobrado |
| S-N5 renovaciones 13 meses (Business anual + Net + Net adicional) | Sin duplicados ni importes desviados |
| U8 / U9 / U10 / U11 / U12 cambios de plan y Nets | Vía de cambio de plan (P0-J) |
| U15 tarifas republicadas tras contratar | Precio contractual protegido |
| U16 / U17 histórico y política apagada | Contratos históricos intactos |
| U18 / U19 / S-N7 idempotencia, fallo de pago y 3DS | Sin cobros dobles ni capacidades sin pago |

## 6. Bloqueos externos

- **Clave de sandbox de Stripe** (`ES_SANDBOX_STRIPE_KEY`, `sk_test_` o `rk_test_`): no existe en ningún entorno; la facilita Jorge a la ventana de Stripe. Sin ella no se ejecuta ninguna prueba S-*.
- **Production**: `CP_STRIPE_MODE=live` con `CP_STRIPE_NAMESPACE=beta` impide arrancar el plano de control; cada publicación vuelve atrás. La cambia Jorge. Mientras tanto, conviene no fusionar en integración salvo lo imprescindible.

## 7. Registro

- 27/10/2026 · Catálogo: documento creado; encargo de validación de cobros reenviado a la ventana de Stripe.
