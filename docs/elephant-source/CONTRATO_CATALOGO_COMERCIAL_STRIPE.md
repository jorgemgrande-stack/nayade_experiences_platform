# Contrato técnico v3: ventana de Stripe, catálogo comercial y producto compuesto «Elephant Net completo con Elephant Core incluido»

Destinatario: la sesión responsable de Stripe, pedidos y suscripciones de Elephant Source.
Fecha: 27/10/2026. Documento de coordinación: no cambia código, Stripe ni bases de datos.

**Base leída**
- Core: `origin/integration/elephant-source` en `3462578d` (después de la v2, `09df3fba`). Entre `ada7a677` (base de la v2) y `3462578d` **no cambian** `checkoutLines.ts`, `deferredItems.ts`, `purchases.ts`, `checkout.ts`, `orchestrator/service.ts`, `licensing/service.ts` ni `commercialQuote.ts`. Sí cambian `controlPlane/api.ts` (+servicios externos, desplaza unas 10 líneas), `stripe/events.ts` (+servicios externos, unas 17 líneas) y `stripe/gateway.ts` (+`createSetupSession`, `createServiceSubscription`, relojes de prueba).
- CRM: `origin/integration/elephant-source` en `8372638` (#71 clientes externos, #72 revisión de reglas). `src/orders.ts` y `src/pages/Subscriptions.tsx` no cambian desde la v2.
- Código **sin fusionar** del producto compuesto: worktree `nayade_worktrees/catalogo-comercial`, rama `feat/net-core-incluido`, cambios sin commit en `server/catalog/commercial/{policy,commercialQuote,fromCatalog,checks}.ts` y `server/web/schemas.ts`. Las referencias a esos ficheros llevan el prefijo `WT:`; las del CRM, `CRM:`; el resto son del Core en `3462578d`.

**Sustituye** a la v2 (`docs/elephant-source/CONTRATO_CATALOGO_COMERCIAL_STRIPE.md`). Todo lo que la tabla del §1 marca como vigente sigue en vigor tal cual, incluido el diseño completo de prorrateo de la v2 §2 (que aquí no se repite: se aplica a los casos nuevos en el §5).

**Interruptor.** `commercialPolicy` sigue apagado: `WebAdminService` se construye sin él (`server/controlPlane/api.ts:523-535`). Con el interruptor apagado, ninguno de los cinco consumidores usa el cotizador comercial, así que **el producto compuesto no tiene hoy ningún efecto en cobros, pedidos ni licencias**.

---

## 1. Qué cambia respecto a la v2

### 1.1 Resumen

1. **Decisión de negocio (27/10/2026).** Las seis soluciones Elephant Net completas (`net_bundle`: `hotel-`, `ski-`, `travel-`, `restaurant-`, `care-` y `social-token-net-complete`) incluyen **Elephant Core Essential** (3 usuarios, 1 sede, capacidades de Essential) en su precio. Los `net_module` sueltos siguen exigiendo un plan Core. Lista fija en `WT:policy.ts:72`; regla por defecto en `WT:policy.ts:73`.
2. **Política.** Nuevo `CommercialPolicy.coreIncluded` (`WT:policy.ts:49`) con `NetCoreInclusion` (`WT:policy.ts:62-70`): `plan`, `status`, `upgrade: { kind: "difference" }` y `additional: { kind: "core_credit" }`. En `PROPOSED_POLICY` (`WT:policy.ts:115`): inclusión `approved`, ampliación y Net adicional `proposed`. `pendingRules` las enumera (`WT:policy.ts:119-127`). `isNeutral` deja de ser neutra con cualquier entrada (`WT:fromCatalog.ts:62`).
3. **Cotizador.** `composeNetCore` (`WT:commercialQuote.ts:128-189`) se aplica sobre las líneas de `quote()` (`:295`). Tres estados nuevos (`:22`):
   - `included_in_net`: plan igual o inferior al incluido, a 0 € (`:149-153`);
   - `core_upgrade`: plan superior, cobra la diferencia de tarifas aprobadas de la **misma periodicidad** (`:154-166`); sin regla aprobada, `on_quote`;
   - `net_additional`: cada Net adicional cobra su precio menos la tarifa **mensual** de Essential (`:170-187`); sin regla, `on_quote`.
   Nuevos campos: `discounts.coreIncludedCents` (`:337`) y `netCore = { nets, corePlan, providedBy }` (`:338`).
4. **Esquema y vista pública.** `catalog.coreIncluded` en el borrador (`WT:schemas.ts:172-179`). La proyección pública solo lo expone si está `approved`, y sus subreglas solo si lo están (`WT:schemas.ts:303-306`). `checks.ts:117` lo limita a `net_bundle`.
5. **Ejemplos de referencia** (tarifas aprobadas del catálogo, sin IVA): Essential 29 €/mes o 279 €/año; Business 79 €/mes o 759 €/año; Ski Net 99; Hotel Net 119; Travel 119; Care 69; Restaurant 59; Social Token 59 (todos los Net, solo mensual).
   - Ski Net + Essential = 99 €/mes (una sola cuota).
   - Ski Net + Business mensual = 99 + (79 − 29) = 149 €/mes.
   - Ski Net + Business anual = 99 €/mes + (759 − 279) = 480 €/año.
   - Ski + Hotel = 119 + (99 − 29) = 189 €/mes (aporta el Core el de mayor precio, Hotel).

### 1.2 Hallazgos sobre el código nuevo que condicionan Stripe

| # | Hallazgo | Referencia | Consecuencia |
|---|---|---|---|
| H1 | Con `interval: "year"` y plan incluido, la línea del plan queda **anual a 0 €**. No hay ninguna partida anual cobrada. | `WT:commercialQuote.ts:147-153` | `planCheckoutLines` dejaría `recurring` vacío y todo en `deferred`: el Checkout en modo suscripción no tiene partida recurrente. Hay que **normalizar a mensual** (P0-C). |
| H2 | `providedBy` es el primer Net de `owned` en orden de inserción, o el de mayor precio si no hay ninguno contratado. **No se guarda.** | `WT:commercialQuote.ts:138` | Con dos Net contratados, otra cotización podría elegir otro. Debe fijarse en la instantánea del pedido (P0-B). |
| H3 | (Resuelto en el cotizador con `contractModel`, §7.3.) Basta con que `owned` contenga un Net para que el plan pase a `included_in_net`. | `WT:commercialQuote.ts:133-136` | Un cliente **histórico** (Core + Net cobrados por separado) que recotice o compre vería su plan a 0 €. El modelo compuesto debe depender de la versión de política del pedido vigente, no solo de `owned` (§7, P0-H). |
| H4 | La diferencia y el crédito salen de `priceOf(...)` sobre el catálogo **publicado en ese momento**. | `WT:commercialQuote.ts:144, 170` | Una republicación de tarifas cambia la diferencia de futuras cotizaciones. Las contratadas se protegen con la instantánea (§6). |
| H5 | `net_additional` exige `l.interval === "month"`. | `WT:commercialQuote.ts:181` | Coherente con «Net solo mensual». Una tarifa anual de Net futura caería en `on_quote`. |
| H6 | Enterprise sigue en `quoteOnRequestPlans` y fuera de `SELF_SERVICE_PLANS` (`checkout.ts:224`). | `policy.ts` (PROPOSED), `checkout.ts:224` | Net + Enterprise nunca pasa por Checkout: va por contrato (`priceSource "contract"`). |

### 1.3 Vigencia de la v2

Leyenda: **V** = vigente · **C** = cambia o se amplía en la v3 · **O** = obsoleto.

| v2 | Contenido | Estado en v3 |
|---|---|---|
| §0 | Resumen #375, #68, #70 | V (referencias de `api.ts` y `events.ts` desplazadas, ver §8). |
| §1 | Tabla v1 → v2 | V. |
| §2.1-2.4 | Prorrateo fijado con `proration_date`, `quoteToken` HMAC, `acceptedAmountDueCents`, cotejo en `events.ts`, casos límite y pruebas S1-S5 | **V íntegro.** Se aplica a los casos compuestos en el §5. El TTL de 15 minutos sigue siendo una propuesta. |
| §3 P0-1 … P0-9 | Adaptaciones para encender la política | V. Se añaden P0-A … P0-J (§8). P0-4 (saltar las líneas a 0 €) se amplía a `included_in_net`. |
| §3 P1-10 | `bundle_adjusted` con cupón | **C.** La mecánica de cupón por partida del §2 la generaliza; el cupón de paquete pasa a usar la misma infraestructura. |
| §3 P1-11 … P2-19 | Absorción, `addsNoCapability`, portal, diferidas, `panelCatalog`, cupos, `employees`, metadatos, firma de reducciones | V. |
| §4 | Reglas pendientes (Enterprise, People, POS, paquetes, Copilot, implantación) | V. Se añade la fila del producto compuesto (§2). |
| §5 | C1-C8 y procedimiento | C: se añaden C9-C13 (§9) y los pasos del §10. |
| §6 | R-A … R-H | V. Se añaden R-I … R-N (§10). |

---

## 2. Modelo de suscripción del producto compuesto

### 2.1 Principios

1. **Un Price de Stripe = una tarifa aprobada del catálogo.** No se crea ningún Price «Business menos Essential» ni «Ski Net adicional». No se usa `price_data` recurrente: `events.ts:306` rechaza cualquier Price que no esté en el catálogo enlazado, y `itemsDrift` no podría resolverlo.
2. **El crédito de Core es un descuento explícito por partida**, con importe igual a una tarifa aprobada de Essential en la periodicidad de esa partida. Así se ve en la factura («Elephant Core Essential incluido en Ski Net Complete: −29,00 €»).
3. **El plan incluido existe en la suscripción interna** (lo necesitan las licencias y los límites, §3), pero **no tiene línea en Stripe**.
4. **Instantánea inmutable.** Tarifa, crédito, Net que aporta el Core y versión de la política quedan en el pedido y en las partidas. Una republicación no los toca (§6).

### 2.2 Representación por caso

Notación: `SI` = `subscription_items` (suscripción interna); `Stripe` = partidas de la suscripción de Stripe.

| Caso | SI (partidas vivas) | Stripe (partidas) | Crédito (cupón por partida) |
|---|---|---|---|
| (a) Net + Essential (incluido) | `essential` (`core_plan`, Price mensual aprobado 2900, **descuento 100 %**, origen `net_inclusion`) + `ski-net-complete` (`industry_module`, 9900) | Solo `ski-net-complete` ×1 (Price 9900/mes) | Ninguno |
| (b) Net + Business mensual | `business` (7900, descuento `amount` 2900, nota `core_upgrade`) + `ski-net-complete` (9900) | `business` (7900/mes) + `ski-net-complete` (9900/mes) | `business`: `amount_off` 2900, `duration: forever` |
| (b') Net + Business anual | `business` (75900 anual, descuento 27900) + `ski-net-complete` (9900 mensual) | `business` (75900/año) + `ski-net-complete` (9900/mes, partida diferida de #375) | `business`: `amount_off` 27900, `forever` |
| (c) Dos Net, plan incluido | `essential` (100 %, `net_inclusion`) + `hotel-net-complete` (11900) + `ski-net-complete` (9900, descuento 2900, `net_additional`) | `hotel` (11900) + `ski` (9900) | `ski`: `amount_off` 2900, `forever` |
| (c') Dos Net + Business mensual | `business` (−2900) + `hotel` + `ski` (−2900) | `business`, `hotel`, `ski` | Dos cupones por partida |
| (e) Net + Enterprise | Partidas por contrato (`priceSource "contract"`, ya existe en `types.ts:15`) | Fuera de Checkout (`checkout.ts:224`). Si algún día se cobra por Stripe, con Price por contrato. | No aplica |

**Cupones de Stripe (propuesta; hoy no existe ningún cupón en `server/stripe`).**
- Un cupón **por importe y periodicidad**, reutilizado por todos los clientes. Identificador determinista que incluye el importe, por ejemplo `es-<ns>-core-credit-essential-month-2900` y `es-<ns>-core-credit-essential-year-27900`.
- Parámetros: `amount_off`, `currency: eur`, `duration: forever`. `applies_to.products` = Business y los seis Net. Es una defensa adicional: el descuento va por partida (`items[].discounts`).
- Metadatos del cupón: `es_reason=core_included`, `es_core_plan=essential`, `es_interval`, `es_source_price_id` (id de `web_prices` de la tarifa de Essential) y `es_catalog_version`.
- En Stripe, el `amount_off` de un cupón **no se puede editar**. Si cambia la tarifa de Essential, se crea otro cupón y los contratados siguen con el suyo (§6).
- Metadatos de la suscripción: `es_core_provided_by=<netKey>`, `es_policy_id`, `es_policy_hash` y `es_catalog_version` (amplía v2 P2-18).

**Suscripción interna (`subscription_items`).**
- **El crédito va en `discount`**, que ya existe: `types.ts:17-24` y `:74`; columnas `discount_kind`, `discount_value`, `discount_ends_at` y `discount_note` en `db/crm/migrations/0006_subscriptions.sql:62-65`. `ItemSpec.discount` ya se acepta (`server/subscriptions/service.ts:27-32, 117`) y `pricing.ts:76-98` lo descuenta. **No hace falta migración** para el crédito.
  - Nota estructurada en `discount_note` (máx. 200): `core_credit;net=<key>;plan=essential;policy=<id>;v=<catalogVersion>`.
- **El plan incluido** necesita un marcador inequívoco de que no tiene línea en Stripe. Dos opciones:
  - **Recomendada:** nuevo valor `net_inclusion` en `PriceSource` (`types.ts:15`) y en el `ENUM` de `price_source` (`0006_subscriptions.sql:55`). Exige una **migración en commit aislado**, generada y revisada, nunca en el arranque. Además, `snapshot()` fija hoy `priceSource: "catalog"` (`service.ts:110`): hay que permitir que `ItemSpec` lo indique.
  - Alternativa sin migración: descuento `percent` 100 con nota `core_included;…` y regla «partida sin línea en Stripe = descuento del 100 % con esa nota». Es más frágil.
- La partida del plan incluido conserva `priceId` = la tarifa mensual aprobada de Essential. Así la factura simulada (shadow) y la reproducción del precio son exactas: bruto 2900, descuento 2900, neto 0.

### 2.3 (b) Ampliación a Business: diferencia sin inventar tarifas

**Mecánica A (recomendada): Price completo del plan + cupón por partida igual a Essential en la misma periodicidad.**

Ventajas:
- un solo Price por tarifa;
- conciliación por `priceId` como hoy;
- la factura muestra la tarifa completa y el crédito;
- la reproducción del precio es `Price − cupón`, los dos inmutables.

Implicaciones fiscales y de conciliación (todas son **P0** si se adopta A):
1. **Base imponible.** En Stripe, `invoice.subtotal` es **anterior** a los descuentos. Hoy:
   - el cotejo del primer cobro compara `inv.subtotal` con `firstPeriodNetCents` (`events.ts:512`), así que **fallaría con `StripeMismatchError`** en todo alta con crédito;
   - el documento fiscal toma `baseCents = inv.subtotal` (`server/stripe/fiscalDocuments.ts:72`), así que **declararía una base inflada**;
   - `GwInvoice` (`gateway.ts:112-135`) no expone `total_excluding_tax` ni `total_discount_amounts`, y `GwInvoiceLine.amount` (`gateway.ts:417`) es el importe **antes** de los descuentos de la línea.
   Hay que añadir `totalExcludingTax` y los descuentos por línea, y usarlos en `events.ts:512`, en `invoiceRecordOf` y en las líneas de factura.
2. **Stripe Tax** calcula el impuesto **después** del descuento. Es correcto fiscalmente: el IVA se aplica sobre 50 €, no sobre 79 €.
3. **Deriva de partidas (`items_drift`).** `contractedItems` (`api.ts:1666-1675`) cuenta las familias `core_plan`, `extension` e `industry_module` (`:1672`):
   - el plan incluido (`net_inclusion`) daría deriva, porque no tiene línea en Stripe: hay que **excluirlo**;
   - hay que comparar también el cupón de cada partida. `GwSubscriptionItem` (`gateway.ts:70-74`) no expone `discounts`: hay que añadirlo, y una partida sin el cupón esperado o con otro → `stripe.items_drift` con el motivo `discount`.
4. **Checkout admite un solo descuento por sesión** (`discounts` a nivel de sesión) y no admite descuentos por partida. **Verificar en la documentación y en sandbox.** Consecuencias:
   - un alta con **un** crédito puede llevar el cupón en la sesión (con `applies_to`);
   - un alta con **dos o más** créditos (por ejemplo, Business + segundo Net, o Business anual + Net mensual adicional) no cabe en un Checkout;
   - propuesta: tras el pago, un paso idempotente, como `DeferredItemsService.attach`, pasa el descuento de la sesión a **descuento por partida** (`subscriptions.update` con `items[].discounts`, `discounts: []` en la suscripción y `proration_behavior: none`). Ese servicio **no existe**: nombre propuesto `CoreCreditService.normalize`.
   - Mientras no esté verificado: **un solo crédito por Checkout**. El segundo Net se compra después por la vía de compras (§4) o lo contrata el gestor.
5. **Prorrateo de un `amount_off` por partida (riesgo R-J).** Hay que verificar en sandbox si Stripe prorratea el cupón en las líneas de prorrateo, es decir, si cobra `(79 − 29) × f` o `79 × f − 29`.
   - Si no lo prorratea de forma proporcional, la mecánica A **no sirve para subidas a mitad de periodo**: se usa B, o la subida se hace a fin de periodo.
   - En cualquier caso, el importe que se cobra es el que se previsualiza y acepta (v2 §2). Además, el servidor compara la vista previa con el prorrateo esperado por línea (± 1 céntimo por línea) y devuelve `conflict` si difiere.

**Mecánica B (alternativa): Prices derivados aprobados como tarifas propias.**
- Por ejemplo, «Ampliación a Business desde Elephant Net», 50 €/mes y 480 €/año, y «<Net> adicional», un Price por Net (99 − 29 = 70, y así con cada uno).
- Son 2 + 6 = 8 Prices por versión de tarifas.
- Ventajas: sin descuentos, `subtotal` = base, Checkout sin límite de cupones y prorrateo exacto.
- Inconvenientes:
  - **son tarifas nuevas que debe aprobar la dirección comercial** (este contrato no las crea);
  - hay que redefinirlas cada vez que cambie Essential o Business;
  - necesitan un `productKey` propio o un mapa de Price a partida para `itemsDrift`, licencias y `purchases`.
- Queda como plan de contingencia si R-J o el límite de cupones de Checkout no se resuelven.

**Mecánica C (descartada): `price_data` en línea con el importe de la diferencia.** Rompe `events.ts:306` (Price no enlazado), `planCheckoutLines` (`checkoutLines.ts:84-98`) e `itemsDrift`, y no deja rastro de la tarifa de origen.

### 2.4 (c) Net adicionales

Misma mecánica A: el Net adicional lleva su Price completo y un cupón mensual de 2900 en su partida.
- El Net que aporta el Core no lleva crédito. Se guarda en `netCore.providedBy` de la instantánea (H2) y en `es_core_provided_by` de la suscripción.
- Con varias unidades del mismo Net (`quantity > 1`), la parte adicional es una partida con otra cantidad del **mismo** Price. Stripe no admite el mismo Price dos veces en una suscripción (`checkoutLines.ts:91`), así que un `amount_off` sobre la partida se aplicaría una sola vez, no por unidad.
- **Propuesta:** no vender cantidades mayores que 1 de un Net completo por autoservicio; `quantity > 1` → `unsupported` (lo presupuesta el gestor).

### 2.5 (d) Periodicidad: Net mensual con plan anual

- **Net + Business anual** encaja en la suscripción única `flexible` de #375:
  - el plan anual con cupón anual va como partida recurrente del Checkout;
  - el primer mes del Net va como importe único (`checkout.ts:230-238`);
  - el Net mensual se añade después con `DeferredItemsService.attach` (`deferredItems.ts:48-120`).
  - Primer cobro neto = (75900 − 27900) + 9900 = 57900. Debe coincidir con `firstPeriodNetCents` **ya descontado** (P0-A).
- **Primer mes de un Net adicional con plan anual.** El importe único del primer mes debe ser el neto (P − 2900). Dos opciones:
  - un `oneTime` con importe derivado, pero `CheckoutLineItem.oneTime` (`gateway.ts:170`) es `price_data` y no deja rastro de la tarifa;
  - importe único completo y crédito en el mismo cupón de sesión, lo que choca con el límite de un cupón.
  - **Propuesta:** con plan anual, el segundo Net no entra en el alta (se compra después con prorrateo).
- **Net + Essential incluido con `interval: "year"`** (H1): no tiene sentido, porque no hay nada anual que cobrar. **Regla:** con el plan `included_in_net`, la periodicidad del pedido se fuerza a mensual. En el formulario, «anual» solo se ofrece si el plan es `core_upgrade`. El servidor rechaza (`invalid_input`) un pedido anual con plan incluido.
- `intervalCompatible` (`multipart.ts:42-44`) ya admite el Net mensual en una suscripción anual `flexible`. Las suscripciones `classic` antiguas no lo admiten (`purchases.ts:248`).

### 2.6 Fila nueva para la tabla de reglas (v2 §4)

| Regla | Estado en el código | Pedidos | Stripe | Licencias y límites |
|---|---|---|---|---|
| **Net completo con Core Essential incluido; ampliación por diferencia; Net adicional con crédito** | Inclusión `approved`; `upgrade` y `additional` en `proposed` (`WT:policy.ts:73, 115`); sin fusionar. | Instantánea con `netCore`, `coreIncludedCents`, estado por línea y la tarifa de origen del crédito. | Price completo + cupón `amount_off` por partida (A) o Prices derivados aprobados (B). El plan incluido no tiene línea. | Partida interna `essential` con `net_inclusion`: capacidades y cupos de Essential (§3). |

---

## 3. Licencias

**Cómo funciona hoy.**
- `LicensingService.preview` (`server/licensing/service.ts:70-140`) concede las capacidades de las **partidas vivas** de la suscripción interna: `capsOf` recorre `inherits` y `bundleOf` (`:84-90`) y concede por partida (`:91-99`).
- `limitsFor` (`:156-184`) toma los cupos **solo** de la partida `core_plan` (`:163`). Si no hay partida de plan, `base === undefined` y **no fija ningún límite** (`:173`). Es decir: un Net sin partida de plan daría la empresa **sin tope** de usuarios ni sedes, y sin las capacidades de Essential.
- Un `net_bundle` se contrata como `industry_module` (`server/subscriptions/ports.ts:76-77`). Sus capacidades sectoriales llegan por `bundleOf`; las de Core, no, porque `bundleOf` de los Net no incluye `essential` (`server/catalog/elephantSourceV1.ts:236-267`).

**Contrato.**
1. Toda suscripción con un Net completo bajo el modelo compuesto tiene **siempre una partida viva `core_plan`**:
   - `essential` con `net_inclusion` y descuento del 100 %, si el plan está incluido;
   - el plan ampliado (`business`) con su crédito.
   Con eso, `preview` concede las capacidades de Essential (o de Business) y `limitsFor` fija 3 usuarios y 1 sede (o los de Business), **sin cambiar el código de licencias**.
2. **No** se añade `essential` al `bundleOf` de los Net: duplicaría capacidades en un cliente con Business y no aportaría cupos (`limitsFor` solo lee `core_plan`).
3. El módulo sectorial se concede por la partida del Net, como hoy.
4. Una bajada de Business a Essential o un traspaso del Core **cierra y abre partidas** (`effectiveTo`/`effectiveFrom`), sin hueco. `capUntil` (`:101-110`) encadena las partidas programadas, así que las capacidades no caen en el cambio.
5. `addsNoCapability` (`orchestrator/service.ts:457-461`) debe tratar la partida `net_inclusion` como una que no añade cobro (v2 P1-12).

---

## 4. Cambios de plan

**Hoy no existe una vía en la plataforma para cambiar de plan sobre Stripe.**
- `checkout.ts:221` remite al Customer Portal.
- El portal no tiene `subscription_update` (v2 R-F).
- `planReduction` rechaza quitar el plan (`purchases.ts:425`).
- `ModulePurchaseService.plan` solo añade módulos y ampliaciones (`purchases.ts:205-279`).

**Propuesta.** Una operación de cambio de plan en `ModulePurchaseService`, con el mismo `context()`, idempotencia, `stripe_subscription_changes` y prorrateo fijado de la v2 §2. Hoy **no existe**; nombres propuestos: `planChangePreview` y `planChange`.

| Caso | Suscripción interna | Stripe | Cobro |
|---|---|---|---|
| Net + Essential → Business (subida, inmediata) | Cierra `essential` (`net_inclusion`) ahora; abre `business` (7900, descuento 2900) ahora. | Añade la partida `business` con el cupón de 2900 (`items[].discounts`), `always_invoice`, `pending_if_incomplete` y `proration_date` (v2 §2). | Prorrateo de **la diferencia**: (7900 − 2900) × fracción restante, previsualizado, aceptado y cotejado. Las capacidades de Business solo tras el cobro. |
| Net + Essential → Business **anual** | Igual, con el Price anual y el cupón de 27900. | Añadir una partida anual a una suscripción con ancla mensual (`flexible`). **Verificar en sandbox** qué periodo y qué prorrateo aplica Stripe (S-N4). | Propuesta hasta verificarlo: la subida a anual solo se ofrece **en la renovación mensual**, con un cargo completo de 48000. |
| Business → Essential (bajada, a fin de periodo) | `business.effectiveTo = fin de periodo`; nueva `essential` (`net_inclusion`) desde esa fecha. | Borrar la partida `business` (con su cupón) con `proration_behavior: none` y `error_if_incomplete`, como `reduce` (`purchases.ts:543`). | Sin cobro ni abono. El Net se conserva y el plan vuelve a quedar incluido. Hay que permitir este `remove` del plan solo en este caso, porque hoy se rechaza (`purchases.ts:425`). |
| Añadir un segundo Net | Nueva partida del Net con descuento 2900 (`net_additional`). | Añade la partida con el cupón mensual. `purchases.plan` debe usar el neto de la línea y el cupón (P0-E). | Prorrateo de (P − 2900) × fracción, con token. |
| Quitar el segundo Net (no aporta el Core) | `effectiveTo = fin de periodo`. | Borrar la partida y su cupón (`none`). | Sin cobro. |
| Cancelar el Net que **aporta** el Core teniendo otro (**traspaso**) | Al fin de periodo: cierra el Net que se va; cierra la partida del otro Net con descuento y abre una nueva **sin** descuento desde esa fecha; `providedBy` pasa al Net restante (o al de mayor precio si quedan varios). El plan sigue incluido o con su crédito. | En una sola actualización con `proration_behavior: none`: borrar la partida del Net que se va y quitar el cupón de la partida del que se queda (`items[{id, discounts: []}]`). Aplicado ahora, solo afecta a la factura del periodo siguiente. Metadato `es_core_provided_by` actualizado. | Sin prorrateo: el periodo en curso ya está pagado con el crédito. Desde la renovación, el Net restante paga su precio completo. Se avisa al cliente con el importe nuevo antes de confirmar. |
| Cancelar el único Net y conservar Core | Al fin de periodo: cierra el Net y la `essential` incluida; abre `essential` cobrada (2900) o quita el crédito de `business`. | Añadir la partida `essential` (Price 2900/mes) o quitar el cupón de `business`, con `none`. **Con Business anual:** se quita el cupón ahora, así que la próxima renovación anual se cobra completa; el resto del año ya pagado no se recalcula (decisión del propietario). | Sin prorrateo. Exige confirmar la nueva cuota. |
| Cancelar todo | Lo existente: baja a fin de periodo de la suscripción. | `cancel_at_period_end`. | Sin abono (salvo el desistimiento, flujo propio). |

**Reglas comunes.**
- Toda operación recalcula con la **instantánea del pedido vigente** y con la política de **su versión** (§6-7). Nunca con lo publicado hoy salvo para lo **nuevo** que se añade.
- Ningún cambio deja una suscripción interna sin `core_plan` vivo mientras haya un Net.
- Las reducciones y los traspasos, sin cobro, llevan también token de líneas y fecha efectiva (v2 P2-19). Aquí sube a **P1**, porque cambian el importe futuro.

---

## 5. Prorrateo aplicado a estos casos (v2 §2, vigente)

1. **Invariante (v2).** Se cobra exactamente lo aceptado (neto, impuesto, total y `amountDue`) con el mismo `proration_date`. Si Stripe calcula otra cosa → `conflict` con una vista previa nueva, sin cobro.
2. **El token cubre también los descuentos.** El `payload` del `quoteToken` añade, por partida, `couponId` y `amountOff` además de `stripePriceId → unitAmountCents`. Un cupón distinto entre la vista previa y la compra → `conflict`.
3. **Vista previa con los descuentos.** `previewSubscriptionChange` (`gateway.ts:769-777`) debe enviar `items[].discounts` y `proration_date`. `SubscriptionItemsChange` (`gateway.ts:95-101`) añade `discounts?` por partida y `prorationDate?`. `GwInvoicePreview` (`:103-110`) añade `total` y `totalExcludingTax`.
4. **Importe que se compara.** El neto aceptado es `totalExcludingTax` (después de descuentos), no `subtotal`. Se compara también `amountDue` (v2 R-G).
5. **Validez de 15 minutos (propuesta, sujeta a verificación técnica).** Es razonable con Stripe porque:
   - queda muy por debajo de la caducidad del `pending_update` (23 h, `purchases.ts:404-412`) y de las 24 h de las claves de idempotencia de Stripe;
   - el reintento con la misma clave y los mismos parámetros (que salen de la fila guardada, incluido `prorationDate`) devuelve el mismo resultado;
   - en 15 minutos el prorrateo por segundos solo varía céntimos, y ese margen lo elimina `proration_date`;
   - el riesgo real (renovación, impuesto, saldo o cupón cambiado) lo detectan la segunda vista previa y el `conflict`.
   Hay que verificar en sandbox que Stripe acepta un `proration_date` de hasta 15 minutos en el pasado en `subscriptions.update` y en `createPreview`, también en modo `flexible` (v2 S2).
6. **El cliente acepta el importe exacto.** La interfaz muestra neto, IVA y total, y el desglose «Business 79 € − Core Essential incluido 29 € = 50 €, prorrateado X días = Y €». La compra envía `acceptedAmountDueCents`. Si un operador del CRM acepta, queda en la auditoría (v2 §2.2).

| Caso | Qué se prorratea | Qué se acepta |
|---|---|---|
| Subida a Business | (7900 − 2900) × f, si R-J confirma el prorrateo del cupón; si no, mecánica B o subida a fin de periodo | `totalExcludingTax`, impuesto y `amountDue` de la vista previa con `proration_date` |
| Segundo Net | (P − 2900) × f | Ídem |
| Bajada o traspaso | Nada (`none`) | Líneas y `effectiveAt`; el token de las reducciones (P1) |
| Renovación entre la vista previa y la aplicación | — | `conflict` (v2 §2.3) |

---

## 6. Protección frente a cambios de precio

1. **Instantánea en el pedido** (amplía v2 P0-3): `OrderQuote` (`server/orchestrator/types.ts:66-83`; se construye en `service.ts:364-374`) añade:
   - `lines[]` con `status` (incluidos los tres nuevos), `interval`, `unitCents` y `amountCents`, y `credit: { kind: "core_included" | "core_upgrade" | "net_additional", cents, sourcePriceId, sourceInterval }`;
   - `netCore: { nets, corePlan, providedBy }`;
   - `discounts.coreIncludedCents`;
   - `policyId`, `policyHash` (hash canónico de `coreIncluded` y del resto de reglas aplicadas), `catalogVersion` (ya existe) y `pricingHash`.
2. **Partidas internas.** Llevan `priceId` (la versión aprobada de `web_prices`), `unitAmountCents` y el crédito en `discount`, con la nota estructurada del §2.2. Son instantáneas inmutables (`types.ts:52`): una renovación no recalcula precios.
   - `priceSource` se queda en `catalog` para las tarifas de catálogo, `net_inclusion` para el plan incluido y `contract` para Enterprise o acuerdos negociados.
   - **Una ampliación acordada** (la diferencia) queda fijada por la pareja Price + cupón con importes inmutables.
3. **Stripe.** El Price y el cupón **no se editan nunca**: una tarifa nueva crea otro Price (con otra `lookup_key`) y otro cupón. Las suscripciones contratadas siguen en los suyos.
   - La conciliación (`itemsDrift`) compara con los de la instantánea, no con los publicados.
   - Una partida con un Price retirado sigue siendo válida si es la de la instantánea. Hoy `events.ts:306` exige que el Price esté `active` en `listPrices()`; hay que **verificar** qué ocurre al retirar uno y, si hace falta, aceptar los Prices de la instantánea del pedido vigente.
4. **Reproducción del precio contractual.** Una función pura (propuesta; **no existe**), `contractualPrice(order)`, reconstruye cada línea desde la instantánea: `unitCents − credit.cents`, por periodicidad, con el `policyId` y la versión de catálogo guardados. No consulta el catálogo publicado. Se usa en la conciliación, en los cambios de plan (§4) y en el soporte.
5. **Lo nuevo en un contrato existente** (un segundo Net o una subida) se cotiza con las tarifas **vigentes**, y el crédito con la tarifa vigente de Essential. Lo ya contratado no se toca.

---

## 7. Compatibilidad con clientes existentes

1. **No se migran contratos.** Un pedido sin `policyId` o con una política sin `coreIncluded` es **histórico**: Core y Net en **dos cuotas**, calculadas con `quote()` como hoy.
2. **Cómo se distinguen.** Por la instantánea del pedido **vigente**: modelo compuesto si `quote.netCore` existe y `quote.policyId` apunta a una política con `coreIncluded`. La fecha de contratación no es el criterio, solo un dato de auditoría.
   - Hoy hay pocos pedidos con Net, porque los seis Net están `coming_soon` o `in_preparation` (`elephantSourceV1.ts:236-267`). Pero el motor de suscripciones admite pilotos `in_preparation` (`server/subscriptions/service.ts:82`).
   - Antes de encender, hay que hacer un inventario de solo lectura de suscripciones con `net_bundle` (no ejecutado en este contrato).
3. **El cotizador debe recibir el modelo del contrato** (corrige H3). **Ya implementado en el cotizador (PR #383):** el campo `contractModel` de la petición. Con `"legacy"` nunca compone, así que Core y Net siguen en dos cuotas. Con `"composite"` compone, también lo ya contratado. Sin indicar, un Net ya contratado no aporta Core: un cliente histórico no ve su plan a 0 €. A los pedidos les queda pasar el modelo guardado en el contrato. La nota original sigue a continuación. Hace falta una opción explícita, por ejemplo `req.coreModel: "compound" | "legacy"`, o una política histórica sin `coreIncluded` para los pedidos históricos. Con un pedido histórico, `owned` con un Net **no** activa `composeNetCore`. Si no, una compra de un cliente histórico recotizaría su plan a 0 €.
4. **Reproducción.** Los históricos se reproducen con `quote()` y su `catalogVersion`; los compuestos, con `contractualPrice` (§6.4).
5. **Paso voluntario al modelo compuesto** (cliente histórico que lo pide): es un pedido `change` que cierra la partida del plan cobrado y abre la `net_inclusion` **a fin de periodo**, y quita la partida del plan en Stripe (`none`). Es una decisión comercial (pregunta 3 del §10).
6. **Compras de clientes históricos** (por ejemplo, un segundo Net): por defecto, cálculo **histórico** (precio completo). Aplicarles el crédito es decisión del propietario.

---

## 8. Adaptaciones priorizadas

Siguen todas las de la v2 §3 (P0-1 … P2-19). Se añaden estas.

### P0: imprescindibles para encender el producto compuesto

- **P0-A. Neto después de descuentos en cobros y fiscalidad.** `GwInvoice` y `toInvoice` (`gateway.ts:112-135, 375-393`) y `toInvoiceLine` (`:417`) añaden `totalExcludingTax` y los descuentos por línea. Hay que usarlos en:
  - el cotejo del primer cobro (`events.ts:512`);
  - el documento fiscal (`fiscalDocuments.ts:72`, `baseCents`);
  - el registro de líneas de factura.
  Sin esto, la mecánica A rompe toda alta con crédito y declara una base errónea.
- **P0-B. Instantánea del producto compuesto** (§6.1) con `providedBy` fijado. Debe usarla también `planCheckoutLines` en lugar de volver a cotizar (v2 P0-3; `checkout.ts:460`, `deferredItems.ts:55`).
- **P0-C. `planCheckoutLines` con los estados nuevos** (`checkoutLines.ts:73-116`):
  - saltar `included_in_net`;
  - aceptar `core_upgrade` y `net_additional` comparando el **bruto** de la línea con el Price aprobado y el crédito con la tarifa de Essential (hoy `:84` daría `conflict`, porque `unitCents` es el neto);
  - `on_quote` → `unsupported`;
  - relajar la comprobación «el presupuesto empieza por el plan» (`:89`) cuando el plan está incluido;
  - recalcular `contract` y `first` (`:107-116`) con los netos;
  - rechazar un pedido anual con el plan incluido (H1);
  - como máximo un crédito por Checkout mientras no exista la normalización (§2.3, punto 4).
- **P0-D. Cupones en la pasarela.**
  - `CheckoutSessionInput` y `createCheckoutSession` (`gateway.ts:172-185, 685-700`) con `discounts`;
  - `SubscriptionItemsChange` y `updateSubscriptionItems`/`previewSubscriptionChange` (`:95-101, 754-777`) con `items[].discounts`;
  - `GwSubscriptionItem` (`:70-74`) con los descuentos leídos;
  - creación idempotente de los cupones con identificador determinista;
  - el doble `FakeStripeGateway` (`server/stripe/testing.ts`) debe aplicar `amount_off` por partida, con prorrateo, y `totalExcludingTax`.
- **P0-E. Compras con crédito** (`purchases.ts:205-279`). Hoy cobran `price.amountCents` del catálogo (`:244-246, 256-258`) y no conocen los cupones:
  - el delta debe ser el neto de la línea;
  - la partida nueva lleva su cupón;
  - `providedBy` sale de la instantánea;
  - `quantity > 1` de un Net → `unsupported`.
- **P0-F. Partida interna del plan incluido**: `PriceSource` `net_inclusion` (`types.ts:15`) y su migración (`0006_subscriptions.sql:55`, commit aislado). `ItemSpec` admite `priceSource`, porque `service.ts:110` lo fija hoy. Además, `specs()`/`priceFor` del orquestador (`orchestrator/service.ts:494-512`) generan la partida `essential` con descuento del 100 % y las partidas con crédito.
- **P0-G. Conciliación.** `contractedItems` (`api.ts:1666-1675`) excluye `net_inclusion`. `checkItems` (`events.ts:625-633`) e `itemsDrift` comparan los cupones por partida.
- **P0-H. Modelo por contrato en el cotizador** (H3, §7.3): los pedidos históricos nunca se recalculan con `composeNetCore`.
- **P0-I. Lo que muestra el CRM = lo que se cobra.**
  - `CRM:src/catalog.ts:64` no conoce los tres estados nuevos;
  - `:159-160` no los clasifica, y `:227` mostraría «Aparte» en `core_upgrade` y `net_additional`;
  - `stripeChargeSummary` (`CRM:src/orders.ts:446-458`) solo suma `charged`.
  Deben usarse los totales del servidor (v2 P0-8).
- **P0-J. Vía de cambio de plan** (§4): subida con prorrateo fijado y bajada con conservación del Net. Hoy no existe.

### P1

- **P1-K.** `CoreCreditService.normalize` (no existe): convierte el cupón de sesión en cupón por partida tras el Checkout y permite varios créditos en el alta.
- **P1-L.** Traspaso del Core y cancelación del único Net (§4), con aviso del importe nuevo y token de reducción.
- **P1-M.** Metadatos `es_core_provided_by`, `es_policy_id` y `es_policy_hash` en la suscripción de Stripe, y `contractualPrice` (§6.4).
- **P1-N.** La aceptación de Prices retirados de la instantánea en `events.ts:306` (§6.3), si la verificación lo exige.

### P2

- **P2-O.** `panelCatalog` (`server/commerce/panelCatalog.ts:42`) muestra «Elephant Core incluido en tu solución Net» y la diferencia de la subida.
- **P2-P.** Paso voluntario de clientes históricos al modelo compuesto (§7.5).
- **P2-Q.** Contingencia de la mecánica B (Prices derivados) si R-J no se resuelve.

---

## 9. Pruebas mínimas

**Unitarias e integración** (doble `FakeStripeGateway`; `server/commercialCatalog.test.ts`, `server/controlPlane.modulePurchase.test.ts` y `server/controlPlane.modularSubscriptions.test.ts`).

| # | Caso | Resultado esperado |
|---|---|---|
| U1 | Ski Net + Essential, mensual | Plan `included_in_net` 0 €; Checkout con una partida (Ski 9900); primer cobro neto 9900; la suscripción interna tiene `essential` (`net_inclusion`) y Ski; capacidades de Essential + Ski; límites de 3 usuarios y 1 sede. |
| U2 | Ski Net + Essential, anual | `invalid_input` (H1). |
| U3 | Ski Net + Business, mensual | `core_upgrade` 5000; Stripe: Business 7900 con cupón de 2900 + Ski 9900; `totalExcludingTax` = 14900 = `firstPeriodNetCents`; base fiscal 14900; sin `items_drift`. |
| U4 | Ski Net + Business, anual | Business 75900 con cupón de 27900; Ski diferido; primer cobro neto 57900; `attach` añade Ski sin prorrateo. |
| U5 | Ski Net + Enterprise | `on_quote` o contrato; Checkout `unsupported` (`checkout.ts:224`). |
| U6 | Ski + Hotel en el alta | `providedBy = hotel`; Ski `net_additional` 7000; total 18900. En el Checkout, un único cupón (o `unsupported` si hay dos créditos sin P1-K). |
| U7 | Net + extensiones (por ejemplo, `connect-*`) | Las extensiones se cobran a su Price sin crédito; `bundle_adjusted` y `included_in_plan` siguen la v2. |
| U8 | Subida Essential incluido → Business a mitad de periodo | Vista previa con `proration_date`; cobro = aceptado; partida `essential` cerrada y `business` abierta; capacidades de Business solo tras `invoice.paid`. |
| U9 | Bajada Business → Essential | Sin cobro; a fin de periodo el plan vuelve a estar incluido; el Net se conserva; las capacidades de Business caducan en esa fecha. |
| U10 | Añadir un segundo Net | Delta (P − 2900) × f; cupón en la partida; `providedBy` sin cambios. |
| U11 | Cancelar el Net que aporta el Core teniendo otro | El otro Net, sin cupón desde la renovación; `es_core_provided_by` actualizado; sin prorrateo. |
| U12 | Cancelar el único Net conservando Core | `essential` cobrada desde la renovación; confirmación del importe nuevo. |
| U13 | Implantación | Fuera de la cuota, del `contractAmountCents` y del `firstPeriodNetCents` (v2 §4). No bloquea el Checkout de la cuota. |
| U14 | Consumos (Copilot) | Ningún importe en la suscripción (v2 §4). |
| U15 | Republicar tarifas tras contratar | Renovación con el Price y el cupón de la instantánea; `contractualPrice` sin cambios; las nuevas contrataciones usan las tarifas nuevas. |
| U16 | Pedido histórico (sin `policyId`) con un Net | Core + Net en dos cuotas; una compra posterior no pone el plan a 0 € (H3). |
| U17 | Política neutra o interruptor apagado | Mismos importes y Prices que hoy (v2 C1), también con un Net en la petición. |
| U18 | Reintento con la misma `idempotencyKey` y doble clic | Una sola `subscriptions.update`. |
| U19 | Fallo de pago en una subida (`pending_if_incomplete`) | No se aplica nada; el `pending_update` caduca; sin capacidades de Business. |
| U20 | Factura de cambio pagada con un neto distinto del aceptado | Alerta `stripe.change_amount_mismatch` (v2 §2.2 C). |

**Sandbox de Stripe** (claves de prueba y *test clocks*; nunca live). Siguen S1-S5 de la v2 y se añaden:
- **S-N1:** Checkout de Ski + Business con cupón `applies_to` → factura con descuento por partida, impuesto sobre el neto y `total_excluding_tax` correcto.
- **S-N2:** prorrateo de un cupón `amount_off` por partida en una subida a mitad de periodo (R-J): ¿(79 − 29) × f o 79 × f − 29?
- **S-N3:** varios créditos tras el Checkout (`items[].discounts` con `proration_behavior: none`): sin factura inmediata, y la siguiente con los dos descuentos.
- **S-N4:** partida anual añadida a una suscripción mensual `flexible` (subida a Business anual): periodo y cargo.
- **S-N5:** renovaciones con un *test clock* durante 13 meses con Business anual + Net mensual + Net adicional: importes de cada factura, sin duplicar el primer mes (v2 R-C).
- **S-N6:** traspaso del Core (quitar el cupón con `none`): la factura siguiente, al precio completo.
- **S-N7:** tarjeta 3DS y rechazada en la subida (`4000002760003184`, `4000000000000341`).
- **S-N8:** `proration_date` 14 minutos en el pasado: aceptado.

---

## 10. Activación coordinada y riesgos

### Procedimiento

1. **Prerrequisitos de la v2, sin cambios:** prorrateo fijado en dos fases, su migración aislada, y P0-1 … P0-9 con el interruptor apagado.
2. Fusionar el código del worktree (`feat/net-core-incluido`) con el interruptor **apagado**. Comprobar U17 (neutralidad) en CI.
3. **Migración aislada** de `price_source` (`net_inclusion`): generada con `pnpm drizzle-kit generate` o en el circuito de migraciones del CRM, revisada y aplicada como paso explícito. Verificar el despliegue.
4. Fusionar P0-A … P0-J con el interruptor apagado, y P0-I en el CRM. Un despliegue verificado por paso.
5. Sandbox: S-N1 … S-N8. Si S-N2 o S-N3 fallan → mecánica B (requiere aprobar tarifas) o limitar las subidas a fin de periodo y el alta a un crédito.
6. Inventario de solo lectura de los clientes con Net (§7.2) y comunicación comercial.
7. Aprobar en los borradores `upgrade` y `additional`, que hoy están en `proposed`. Mientras sigan así, la ampliación y los Net adicionales salen `on_quote` y no se cobran por autoservicio (v2 C3). Comprobar que `GET /web/commercial/review` no tiene bloqueos.
8. Cambio aislado del interruptor (`CP_COMMERCIAL_POLICY`, que **no existe**; v2 §5). Republicar los Net y los planes. Vigilar `items_drift`, `deferred_items_*`, `change_amount_mismatch`, `conflict` y la nueva alerta de descuento.
9. Marcha atrás: interruptor apagado **y** republicación (v2 R-E). Los contratos compuestos ya firmados siguen con su instantánea.

### Criterios añadidos

| | Criterio |
|---|---|
| C9 | En cada alta compuesta: `totalExcludingTax` de la primera factura = `firstPeriodNetCents` = lo mostrado en la web y el CRM. |
| C10 | Ninguna suscripción con un Net vivo sin partida `core_plan` viva. Límites = cupos del plan (incluido o ampliado). |
| C11 | Sin `items_drift` (Prices y cupones) tras alta, subida, bajada, segundo Net y traspaso. |
| C12 | Una republicación de tarifas no altera ninguna factura de suscripciones existentes. |
| C13 | Los pedidos históricos dan los mismos importes antes y después de encender. |

### Riesgos nuevos (de más a menos grave)

- **R-I (alta):** base fiscal y cotejo antes de descuentos (`events.ts:512`, `fiscalDocuments.ts:72`). Con cupones y sin P0-A: altas bloqueadas por `StripeMismatchError` y documentos fiscales con una base inflada.
- **R-J (alta, sin verificar):** prorrateo de los cupones `amount_off` por partida en las subidas y en los Net adicionales a mitad de periodo. Puede cobrar menos de lo que dice la regla comercial.
- **R-K (alta):** licencias sin tope. Un Net sin partida `core_plan` deja la empresa sin límites (`licensing/service.ts:163, 173`) y sin las capacidades de Essential.
- **R-L (media-alta):** recálculo de históricos (H3). `owned` con un Net activa `composeNetCore` en clientes que pagan Core aparte.
- **R-M (media):** límite de un descuento por Checkout. Altas con varios créditos imposibles sin P1-K, o con un cupón de sesión que se aplicaría mal en periodicidades mixtas.
- **R-N (media):** el traspaso del Core sube la cuota del Net restante. Si no se avisa con el importe, habrá reclamaciones. Además, `providedBy` sin persistir (H2) podría quitar el crédito al Net equivocado.

### Preguntas para el propietario

1. ¿Mecánica A (cupón por partida) o B (Prices derivados aprobados como tarifas)?
2. ¿Aprobar `upgrade` y `additional`? Hoy están en `proposed`.
3. Clientes históricos: ¿pueden pasar al modelo compuesto? ¿Reciben el crédito en un segundo Net?
4. Business anual y cancelación del único Net: ¿se mantiene el crédito hasta la renovación anual (propuesta) o se cobra la parte proporcional?
5. ¿Se permite `quantity > 1` de un Net completo, o solo por presupuesto?
6. Siguen abiertas las preguntas de la v2 (D11, TTL de 15 minutos, `CP_PURCHASE_QUOTE_SECRET`, Copilot).
