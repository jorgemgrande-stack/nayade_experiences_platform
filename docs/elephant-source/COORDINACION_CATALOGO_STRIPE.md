# Coordinación: catálogo, validación de cobros Net + Core y ventana de Stripe

Documento vivo. Cada ventana edita **solo su sección** y añade entradas fechadas al registro; nadie reescribe lo de otra. El contrato técnico es [CONTRATO_CATALOGO_COMERCIAL_STRIPE.md](CONTRATO_CATALOGO_COMERCIAL_STRIPE.md) (v3); este documento dice quién hace qué y en qué punto está.

Estado a 27/10/2026: la política Elephant Net + Core está implementada y desplegada **apagada** (`commercialPolicy` desactivada en live y production). Ninguna suscripción real cambia.

## 1. Reparto

| Área | Responsable | Notas |
|---|---|---|
| Catálogo, fichas, reglas, cotizador comercial (`server/catalog/**`, `server/web/**`), web y CRM de catálogo | Ventana de Catálogo | |
| **Validación y adaptación de cobros de Net + Core** (contrato v3 §8 P0-A … P0-J, pruebas §9, sandbox) | **Ventana de Catálogo** (asignado por Jorge el 27/10/2026) | Reutiliza el cotizador y sus pruebas; no lo reconstruye |
| Stripe Live, servicios externos (Nextair), arranque y configuración de Stripe en production | Ventana de Stripe | Recibe aviso antes de fusionar nada en `server/stripe/**` u `server/orchestrator/**`, y da el visto bueno |
| Encender la política | Nadie solo: requiere §5 completo y autorización de Jorge | |

## 2. Lo que el catálogo ya entrega (Core #383, #387; CRM #73, #74; web #23, #24)

- **Reglas** (`server/catalog/commercial/policy.ts`, `rules.ts`): Essential incluido en cada Net completo; ampliación a Business +50 €/mes o +480 €/año; Enterprise +170 €/mes (anual por presupuesto); Net adicional −29 €/mes; mismo Net duplicado = error; sin cuota anual de Essential si va incluido.
- **Cotización** (`commercialQuote.ts`), campos que consume el cobro:
  - `policyVersion`: huella inmutable (16 hex) de la política aplicada.
  - `lines[].status`: `included_in_net` (0 €, forzada a mensual), `core_upgrade` (diferencia de tarifas), `net_additional` (precio − 2900).
  - `lines[].credit` (#392): tipo, importe, plan y periodicidad del crédito de Core por unidad.
  - `discounts.coreIncludedCents`, `netCore { nets, corePlan, providedBy }`.
  - `contractModel`: `"legacy"` = sin composición (importes históricos); `"composite"` = los Net ya contratados también aportan Core; sin valor = solo los Net nuevos componen.
- **Auditoría** (`integrity.ts`, `coreAudit`): `coreCobradoDosVeces`, `netConCoreAparte`, `netSinCore`, expuesta en `commercial-integrity` como `coreUnico`.
- **Simulaciones** (`GET /web/commercial/net-simulations`): 7 escenarios por Net, 0 incidencias en live.

## 3. Estado de las adaptaciones de cobro (v3 §8)

| Punto | Estado | PR |
|---|---|---|
| P0-A Neto después de descuentos en el cotejo del primer cobro y en la base fiscal | Hecho (sin cupones, idéntico a hoy) | #390 |
| P0-D Cupones en la pasarela (Checkout, cambios, vistas previas, `ensureCoupon`, doble de pruebas) | Hecho | #390 |
| P0-C Partidas del Checkout con los estados nuevos | Hecho | #392 |
| Precio contractual desde la instantánea y cotejo de cambios con crédito (§5-§6) | Hecho (módulo puro; aún sin enchufar a compras) | #392 |
| P0-B Instantánea en el pedido (`credit`, `netCore`, `policyVersion`, `providedBy` fijado) | Pendiente | |
| P0-F Partida interna `net_inclusion` (migración aislada) y `specs()` del orquestador | Pendiente | |
| P0-E Compras con crédito (`purchases.ts`) | Pendiente | |
| P0-G Conciliación de cupones (`itemsDrift`, `contractedItems`) | Pendiente | |
| P0-H Modelo por contrato en los pedidos (pasar `contractModel` guardado) | Pendiente (el cotizador ya lo admite) | |
| P0-I CRM muestra lo que se cobra | Pendiente | |
| P0-J Vía de cambio de plan (subida y bajada) | Pendiente | |

#390 y #392 están **sin fusionar**: la ventana de Stripe pidió esperar a que Nextair quede operativo en production.

## 4. Sección de la ventana de Stripe

_Para la ventana de Stripe: avisos sobre Stripe Live, Nextair y cualquier cambio en `server/stripe/**` que afecte a lo anterior._

## 5. Pruebas para autorizar la activación

| Prueba | Estado | Qué decide |
|---|---|---|
| U1–U7, U17 Checkout compuesto con las tarifas del catálogo | Pasan (doble de Stripe) | Partidas y créditos correctos |
| Aceptado = cobrado en el alta (neto tras cupón = presupuesto, IVA sobre el neto) | Pasa (doble) | |
| U8, U10 cambios a mitad de periodo con prorrateo fijado y cotejo previo | Pasan (doble) | |
| U15 tarifas republicadas tras contratar | Pasa | Precio contractual protegido |
| U16 contrato histórico | Pasa | Históricos intactos |
| Renovaciones con cupones por partida | Pasa (doble) | |
| **S-N2 prorrateo del cupón en sandbox** | **Bloqueada: sin clave de sandbox** | Cupón (A) si (79 − 29) × f; tarifas derivadas (B) si 79 × f − 29. El cotejo previo ya impide cobrar si Stripe hace B |
| **S-N1 cupón de sesión con varias partidas, S-N3 … S-N8** | **Bloqueadas: sin clave de sandbox** | Reparto del cupón, renovaciones reales de 13 meses, 3DS, `proration_date` en el pasado |
| U9, U11–U14, U18–U20 | Pendientes de P0-B/E/F/J | |

## 6. Bloqueos externos

- **Clave de sandbox de Stripe** (`ES_SANDBOX_STRIPE_KEY`, `sk_test_` o `rk_test_`): no existe en ningún entorno. La facilita Jorge. Sin ella no se ejecuta ninguna prueba S-* ni se decide la mecánica.

## 7. Registro

- 27/10/2026 · Catálogo: documento creado.
- 27/10/2026 · Jorge asigna a la ventana de Catálogo la validación y adaptación de cobros de Net + Core (la de Stripe sigue con Stripe Live y Nextair).
- 27/10/2026 · Catálogo: #390 (P0-A, P0-D) y #392 (P0-C, precio contractual, cotejo de cambios) abiertos; en espera de fusión por petición de la ventana de Stripe.
