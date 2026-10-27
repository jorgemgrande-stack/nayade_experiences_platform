# Contrato técnico — Ventana de Stripe ↔ Catálogo comercial unificado

Destinatario: la sesión responsable de Stripe, pedidos y suscripciones de Elephant Source.
Base leída: rama `integration/elephant-source` en `ea661a1a` (fusión del PR #374, catálogo comercial unificado). Documento de coordinación: no cambia código, Stripe ni bases de datos.
Fecha: 27/10/2026.

## 0. Situación de partida (verificada)

| Pieza | Qué usa hoy | Referencia |
|---|---|---|
| Cotizador web pública | `quoteResponse` (forma antigua + `commercial`) | `server/web/publicSite.ts:97` |
| Cotizador del CRM (`POST /cp/v1/web/quote`) | `quoteResponse` con `svc.commercialCatalog("published")` | `server/web/api.ts:124-129` |
| Simulador (`/web/commercial/simulate`) | `commercialQuote`, `previewPlanChange`, `recommendPlan` | `server/web/api.ts:131-157` |
| Contratos del CRM (`withConfiguration`) | `quote()` antiguo vía `crmQuote` | `server/controlPlane/api.ts:1338`, `server/crm/api.ts:428-466` |
| Orquestador de pedidos | `quote()` antiguo | `server/controlPlane/api.ts:1555` |
| Compras/reducciones desde el panel | `quote()` antiguo | `server/controlPlane/api.ts:1700` |
| Licencias, límites, organización | catálogo publicado (`quoteCatalogFromSite`), **sin política** | `server/controlPlane/api.ts:1388, 1452, 1500, 1537` |
| Checkout de Stripe | solo plan Essential/Business sin partidas | `server/stripe/checkout.ts:209-230` |

**Interruptor.** `WebAdminService({ commercialPolicy })` (`server/web/service.ts:118-123`). En producción se construye en `server/controlPlane/api.ts:515-525` **sin** `commercialPolicy`, es decir, apagado. No existe variable de entorno (`grep COMMERCIAL_POLICY|CP_COMMERCIAL` sin resultados): hoy solo se enciende cambiando código. Solo lo pasan las pruebas (`server/commercialCatalog.test.ts:41-43, 196, 213`).

**Dónde actúa.** `publicView(..., { policy })` (`server/web/schemas.ts:261-287`) elimina `quotaProposals` siempre. Si el interruptor está apagado, elimina también `inclusions`, `quoteOnRequest` y `bundleRule`. La proyección se **congela al publicar** (`service.ts:265`, `published: publicView(...)`), y el sitio publicado lee `e.published` tal cual (`service.ts:386`). Consecuencia: apagar el interruptor **no retira** reglas de productos publicados mientras estuvo encendido; hay que volver a publicarlos (ver §12, R3).

**Equivalencia.** Con política neutra (`isNeutral`, `server/catalog/commercial/fromCatalog.ts:53`), `quoteResponse` produce los mismos campos que `quote()`. Lo prueba el barrido de `server/commercialCatalog.test.ts:70-93`. Por eso hoy pedidos y cobros coinciden con lo que ven la web y el CRM.

---

## 1. Estructura de inclusiones por plan

### Hoy
- Tipo `PlanInclusion` (`server/catalog/commercial/policy.ts:14-28`): `plan`, `key`, `mode: "full" | "partial"` y `status`. Además `cap?: { metric: "employees"; base; plusExtraOf?: "users"; status }`, `overflowKey?` y `excludes?`.
- `inclusionsOf` (`commercialQuote.ts:74-84`): aplica herencia de planes (manda el plan más alto). Un paquete incluido completo incluye sus componentes.
- En `commercialQuote` (`commercialQuote.ts:130-158`):
  - lo incluido sale con `unitCents: 0` y estado `included_in_plan`;
  - lo parcial sale con estado `partially_included`;
  - si `employees` supera el tope (`base + usuarios por encima del cupo`), se añade la línea `overflowKey` a precio mensual de catálogo con estado `charged`;
  - lo incluido sale de `items` (`items.delete`) y entra en `owned` del `quote()` base (`:199`).
- Pedido: `CommercialOrder.request` es `QuoteRequest` (`server/orchestrator/types.ts:92`). `parseQuoteRequest` ya acepta `employees` (`server/catalog/request.ts:20, 25`), pero `quote()` lo ignora.
- Licencia: `LicensingService.preview` concede capacidades **solo por partidas vivas de la suscripción** (`server/licensing/service.ts:79-98`). No hay ninguna noción de inclusión.

### Contrato
1. **Petición del pedido:** `request.items` contiene solo lo que el cliente **elige** (nunca lo incluido). Si viene algo incluido, el pedido lo quita (como hace `commercialQuote`) y lo registra en la instantánea (§2). Con People parcial, `request.employees` es obligatorio cuando el plan tiene una inclusión con `cap`.
2. **Instantánea en el pedido:** `OrderQuote.included: Array<{ key, mode, cap?: { metric, value }, overflow: boolean }>`, calculado con `inclusionsOf` y los datos del pedido.
3. **Suscripción interna:** cada inclusión es una **partida a 0 €** con un origen de precio nuevo. Hoy `PriceSource = "catalog" | "contract" | "manual_review"` (`server/subscriptions/types.ts:15`) y hay que añadir `"plan_inclusion"`. Lleva `unitAmountCents: 0` y `priceId` nulo o sintético (decisión de esquema: hoy `ItemSpec.priceId` es obligatorio, `server/subscriptions/service.ts:27-32`). Su vigencia va **ligada a la partida del plan** (`effectiveTo` del plan).
4. **Excedente (overflow):** si se supera el tope, la partida es la del producto `overflowKey` a precio de catálogo (`priceSource: "catalog"`), nunca la parcial.
5. **Tope sin control técnico:** `employees` no es métrica de límite (`LIMIT_METRICS = ["users","sites","storage_gb"]`, `server/_core/limits/store.ts:13`). Hasta que exista, el tope de People es **solo declarativo**: se cobra lo que diga el pedido y no se detecta un exceso posterior.

## 2. Desglose del nuevo cotizador y qué persistir

Campos de `CommercialQuote` (`commercialQuote.ts:27-56`): `ok`, `catalogVersion`, `currency`, `errors`, `warnings`, `policy`, `pendingRules`, `plan`, `lines` (estados nuevos `included_in_plan`, `partially_included`, `bundle_adjusted`, `on_quote`), `recurring {monthlyCents, yearlyCents, annualizedCents}`, `initial {recurringCents, implementationKnown:false}`, `implementation[]` (siempre `amountCents: null`), `variableCosts[]`, `discounts {bundleCents, planInclusionCents, annualPlanCents}`, `taxes {...}`, `absorbedByPlan`, `bundleSavings`, `suggestions`, `capabilities`, `contractable`, `blocking`.

### Hoy en el pedido
`OrderQuote` (`types.ts:67-79`) guarda solo `catalogVersion`, `currency`, `contractAmountCents`, `firstPeriodCents`, `capabilities`, `blocking`, `onRequest` y `contractable` (`server/orchestrator/service.ts:359-375`). **No guarda las líneas.** El contrato sí las guarda, pero de **otra** cotización hecha más tarde en `stepContract` (`service.ts:403-404`, `configuration()` en `:377-393`). Se guarda en `quote_json` (`server/orchestrator/store.ts:217, 266`): es JSON y admite campos nuevos sin migración.

### Contrato: instantánea obligatoria en `OrderQuote`
| Campo | Por qué |
|---|---|
| `catalogVersion` (ya existe) | Trazabilidad. **No** sirve como única comprobación: es un hash de catálogo **y contenidos de la web** (`service.ts:413, 623`), así que cambia al editar un texto. |
| `policyId` (`commercial.policy`) y `pendingRules` | Debe ser `[]` para cobrar: una regla propuesta nunca llega a un cobro. |
| `lines` (clave, cantidad, `unitCents`, `amountCents`, `interval`, `status`) | Es lo que se cobra; Stripe se construye desde aquí. |
| `recurring`, `taxes`, `discounts` | Totales mostrados. |
| `included`, `absorbedByPlan` | Inclusiones (§1) y lo que deja de facturarse (§5). |
| `pricingHash` = sha256 de (`lines` normalizadas + `recurring` + `currency`) | Comparación robusta frente al recálculo (§10). |
| `shownTotals` (lo que envió el CRM o la web, opcional) | Verificación de «lo mostrado = lo cobrado» (§10). |
| `implementation`, `variableCosts` | Solo informativos: **no** se cobran por Stripe (§9). |

`stepContract` debe reutilizar la instantánea del pedido en vez de volver a cotizar (`service.ts:403`). Hoy una publicación entre `stepQuote` y `stepContract` puede dejar en el contrato unas líneas distintas de `o.quote.contractAmountCents`.

## 3. Reglas de paquetes

### Hoy
- `quote()`: un paquete sustituye a sus componentes elegidos (`server/catalog/quote.ts:206-224`) y marca `replaces` sobre lo ya contratado (`:235-241`). `bundleSavings` (`:283-288`) **no** se resta del total: es informativo, porque el precio del paquete ya es el descuento.
- Motor de suscripciones: `bundleReplaces` sustituye a los componentes al fin de su periodo (`server/subscriptions/service.ts:15-17, 353-357`).
- `commercialQuote` (`commercialQuote.ts:160-196`), cuando el paquete tiene componentes incluidos:
  - todos incluidos → línea a 0 €;
  - regla `catalog` → **error** (no se resuelve);
  - `min2` con un solo componente pendiente → se cobra ese componente suelto;
  - `min2` con dos o más → `bundle_adjusted`, con el importe proporcional `roundToEuro(precio_paquete × pendientes / total)` y los componentes `included_in_bundle`.
- `discounts.bundleCents` = ahorros de `quote()` + ajuste proporcional (`:254`).
- Regla por paquete: `catalog.bundleRule` en el borrador → `policy.bundleRules[key]` (`fromCatalog.ts:41`). La general publicada siempre es `catalog` (`fromCatalog.ts:47`).

### Contrato
1. **`bundle_adjusted` no tiene Price en Stripe.** `desiredCatalog` solo crea Prices de tarifas aprobadas (`server/stripe/catalog.ts:59-90`), y la especificación prohíbe inventar tarifas. Decisión propuesta: Price del paquete de catálogo + **cupón `amount_off` permanente en la partida** (`discounts` del subscription item) por `precio_catálogo − importe_ajustado`, con `metadata.es_reason = "bundle_min2"` y `es_catalog_version`. Así se conserva el enlace Price↔producto del que dependen `itemsDrift` (`server/stripe/invoiceLines.ts:101-115`) y `checkPrice` (`catalog.ts:96-106`). En la suscripción interna se usa `discount: { kind: "amount", value }`, que ya existe (`subscriptions/service.ts:62-67`).
2. **Componente suelto (`min2` con uno pendiente):** partida del componente con su Price normal.
3. **Absorción de módulos sueltos:** si el cliente ya pagaba componentes sueltos y contrata el paquete, se mantiene `bundleReplaces` a fin de periodo (sin solapes). En Stripe, la partida del componente se borra en ese mismo momento (programarlo con *subscription schedule* o borrarla en la renovación). Hoy `purchases.plan()` **rechaza** cualquier compra que borre partidas (`server/stripe/purchases.ts:246-247`), así que comprar un paquete teniendo componentes sueltos en Stripe se bloquea. Para el caso a fin de periodo hay que habilitar ese borrado.
4. `bundleSavings` y `discounts.*` **nunca** se restan en Stripe: son explicación, no importe.

## 4. Capacidades

### Hoy
- `quote()` devuelve las capacidades del plan, de lo elegido y de los componentes de paquetes (`quote.ts:299-301`). `commercialQuote` añade las de las líneas extra no `on_quote`, incluidas las incluidas en el plan (`commercialQuote.ts:232-234`).
- El pedido guarda `capabilities` (`service.ts:369`) y las usa para la confirmación heredada (`addsNoCapability`, `service.ts:456-460`).
- La licencia **no lee el pedido**: recalcula desde las partidas vivas (`licensing/service.ts:93-98`) y la herencia y los componentes del catálogo (`:84-90`). Los límites (`limitsFor`, `:156-185`) y la organización (`server/organization/service.ts:186-205`) usan las cuotas del plan **del catálogo**, sin `quotaOverrides`.

### Contrato
1. La fuente de derechos sigue siendo **la suscripción interna**. Con la partida `plan_inclusion` (§1.3), `LicensingService` concede las capacidades sin más cambios, porque `capsOf` ya recorre producto y paquete. Su `validUntil` sale del `effectiveTo` de esa partida (`capUntil`, `:102-111`).
2. Alternativa descartada: derivar inclusiones en `licensing` desde la política. Duplicaría el cálculo y haría que un cambio de catálogo publicado concediera o retirara derechos sin pedido.
3. **Cupos de Enterprise (`quotaOverrides`)**: `limitsFor` y `OrganizationService.limits` deben leer el cupo **de la instantánea del pedido o contrato**, no del catálogo. Hoy, con un cupo `null` («por contrato»), el límite queda `null`, es decir, sin tope. Mientras `quotaProposals` no se publique nunca (`schemas.ts:278`, siempre eliminado), esto no cambia nada.
4. `addsNoCapability` debe comparar contra las capacidades de la instantánea (incluidas las de inclusiones). Si no, una subida de plan que solo añade inclusiones podría confirmarse por herencia sin pago (§5).

## 5. Cambios de plan

### Hoy
- `previewPlanChange` (`commercialQuote.ts:321-351`) devuelve:
  - `gained`: pasan a estar incluidos y dejan de cobrarse;
  - `lost`: el cliente decide si los conserva;
  - `blockers`: sedes o sociedades de más;
  - las cotizaciones `current`, `keepingAll` y `droppingAll`.
  Solo lo usa el simulador.
- Orquestador `applyChange` (`service.ts:574-641`): cambia plan e intervalo. Añade los `items` nuevos y quita a fin de periodo los que ya no están (`:617-620`). No sabe nada de inclusiones.
- Motor: subida inmediata y bajada a fin de periodo **sin abonos** (D-S3) (`subscriptions/service.ts:315-327`; `docs/architecture/SUSCRIPCIONES_PRECIOS_CONTRATADOS.md:151`).
- Stripe: los cambios de plan solo llegan del Customer Portal (`applyExternalPlanChange`, `service.ts:732-761`). Esa ruta crea el pedido con `items: []` (`:754`). La configuración deseada del portal tiene `subscription_update.enabled: false` (`server/stripe/portal.ts:60, 76`). `checkout.ts:209` rechaza los pedidos `change`.

### Contrato
1. **Extensión pagada que pasa a estar incluida (subida, `gained`):**
   - interna: se cierra la partida pagada en el mismo instante que la subida y se crea la `plan_inclusion`;
   - Stripe: en la **misma** actualización con `proration_behavior: always_invoice` se borra la partida de pago y se cambia el Price del plan. El crédito prorrateado del módulo absorbido **compensa** el cargo de la subida.
   Es un crédito y no un reembolso: no contradice D-S3, que solo habla de bajadas. **Necesita aprobación del propietario (P2).**
2. **Incluida que deja de estarlo (bajada, `lost`):** se programa a fin de periodo junto a la bajada de plan.
   - Si el cliente elige conservarla (`keepingAll`), se crea la partida de pago desde ese momento con su Price de catálogo. Exige que el producto esté `available` y en `PURCHASABLE_FAMILIES` (`stripe/catalog.ts:53`). Si no lo está (por ejemplo `connect-pack-finance` si no se vende en línea), la bajada queda bloqueada con su motivo.
   - Si no la conserva, la capacidad caduca en el `effectiveTo` (solo lectura, nunca se borran datos).
3. **`applyExternalPlanChange` con `items: []`** debe pasar a `items` = los del pedido vigente. Hoy, si se encendiera el portal con complementos, `applyChange` daría de baja todos los complementos a fin de periodo (`:617-620`). Es un defecto latente, independiente del interruptor.
4. `amountDue` de un cambio (`service.ts:463-468`) es la diferencia de `firstPeriodCents`, que son periodos **completos** y no prorrateo. Solo sirve para pagos de prueba y para decidir la herencia. Con inclusiones, una subida puede tener `amountDue = 0` y añadir capacidades: la regla `addsNoCapability` la frena, pero solo si las capacidades del pedido incluyen las inclusiones (§4.4).

## 6. Periodicidades

### Hoy
- `quote()`: el plan usa su tarifa del intervalo (`quote.ts:148`). Los demás productos usan la anual si existe y si no la mensual, con aviso (`pickPrice`, `:348-354`; `:232-233`). Los complementos de cantidad son siempre mensuales (`:259-262`).
- `commercialQuote`: **todas** sus líneas extra (excedente de People, `bundle_adjusted`, componentes) usan `interval: "month"` y el precio **mensual** (`mkLine`, `commercialQuote.ts:107-109`; `monthly()`, `:62-64`), aunque el pedido sea anual y el producto tenga tarifa anual. `planInclusionCents` también suma mensualidades.
- Motor: admite intervalos mixtos (complemento mensual en plan anual), nunca más largos que el Core (`subscriptions/service.ts:90-97`).
- Stripe: una suscripción cobra un solo intervalo. Checkout solo plan (`checkout.ts:215-217`). `purchases.plan()` exige un Price del **mismo** intervalo que el pedido (`purchases.ts:219, 230-231`).
- Decisión **D11**: no aparece en este worktree (`grep D11` en `docs/`, `server/` y `scripts/` sin resultados). Se toma de la indicación del propietario como pendiente.

### Contrato
1. Hasta decidir D11, **un pedido cobrado en Stripe tiene una sola periodicidad**. El pedido se rechaza si alguna línea cobrada tiene `interval` distinto del plan. Esto incluye las líneas de `commercialQuote` forzadas a `month` en un plan anual.
2. `commercialQuote` debe dejar de forzar `month`: usar `pickPrice` del producto (como `quote()`) en `mkLine` para `overflowKey`, componentes y `bundle_adjusted`. Así el anual usa tarifa anual cuando exista. Sin ese cambio, en un plan anual el excedente de People se mostraría mensual y Stripe no lo podría cobrar en la misma suscripción.
3. Opciones D11 para el propietario: (a) prohibir la mezcla en Stripe (recomendado para empezar); (b) segunda suscripción de Stripe mensual por empresa (hoy `purchases.context` exige **exactamente una**, `purchases.ts:176-177`); (c) cobrar el complemento mensual ×12 en la anual (requiere una tarifa anual aprobada; nunca inventarla).

## 7. Prorrateos

### Hoy
- **Los calcula Stripe, no el cotizador.**
  - `purchases.preview` llama a `invoices.createPreview` con `proration_behavior: always_invoice` (`purchases.ts:264-270`; `gateway.ts:561-566`).
  - `purchase` aplica `updateSubscriptionItems` con `always_invoice` y `pending_if_incomplete` (`purchases.ts:321-327`; `gateway.ts:547-552`).
- «Before/after»:
  - `before = quote(request vigente)` y `after = quote(request + añadidos)` (`purchases.ts:214-218`);
  - solo cambian las líneas `addon` o las añadidas (`:225-241`);
  - `recurringDeltaCents` sale del precio aprobado × delta de unidades (`:240`);
  - si las unidades en Stripe no coinciden con las contratadas → `conflict` (`:237`);
  - nunca borra partidas (`:246-247`).
- Reducciones: a fin de periodo y **sin prorrateo ni abono** (`purchases.ts:466-481, 519-526`).
- `events.ts` registra el cobro del prorrateo como pago `change` (`events.ts:482`). **Solo** el pago `initial` se compara con el presupuesto (`events.ts:486`).
- **No se fija `proration_date`**: el importe previsualizado y el cobrado se calculan en instantes distintos (§12, R1).

### Contrato
1. El prorrateo lo sigue calculando Stripe. El cotizador aporta el **delta recurrente** y la lista exacta de Prices y cantidades.
2. `plan()` pasa a cotizar con `commercialQuote` (antes y después) y:
   - rechaza `add` de productos incluidos (hoy los trataría como compra normal: `commercialQuote` los convierte en línea a 0 €, pero `purchases` busca su Price y lo cobraría si el filtro de `:226-227` lo deja pasar, porque `add.includes(l.key)` es cierto);
   - salta las líneas con `unitCents === 0`, `included_in_plan`, `partially_included` y `on_quote`;
   - aplica el cupón de `bundle_adjusted` (§3);
   - calcula el delta como diferencia de `recurring` entre las dos cotizaciones, no por línea.
3. Fijar `proration_date` (tomado en la vista previa y devuelto al cliente) y exigir en `purchase` el `amountDueCents` visto. Rechazar con `conflict` si Stripe calcula otro importe al aplicar. Hoy `PurchaseInput` no lleva importe esperado (`purchases.ts:53-58`).

## 8. Extensiones incluidas en Stripe — decisión

**Elegida: sin línea de precio en Stripe y con metadatos en la suscripción.** `metadata.es_included = "connect-automations,extra-contracts-esign,..."` (≤ 500 caracteres; si no cabe, `es_included_hash` + referencia del pedido) y `metadata.es_catalog_version`.

Justificación:
- **Línea a 0 €:** exigiría crear un Price de 0 € por producto incluido. Contradice la regla «un Price = una tarifa aprobada» (`stripe/catalog.ts:9-11`), ensucia `checkPrice` y la sincronización (`planCatalogWrites`), y Stripe Tax genera líneas a 0 en cada factura. Además `desiredCatalog` exige exactamente un Price aprobado por kind (`catalog.ts:67, 83`).
- **Sin línea:** la factura de Stripe suma exactamente lo cobrado. El derecho lo da la suscripción interna (§4.1), que es la autoridad de licencias.
- **Cambio necesario:** `contractedItems` (`server/controlPlane/api.ts:1649-1657`) debe **excluir** las partidas `priceSource === "plan_inclusion"`. Si no, `checkItems` → `itemsDrift` (`events.ts:589-597`) avisará `stripe.items_drift` en cada evento.
- La factura del cliente (documento fiscal) puede listar «Incluido en tu plan» como texto informativo, nunca como línea con importe.

## 9. Consumos variables

### Hoy
- **No hay cobro por consumo en Stripe.**
  - `desiredCatalog` solo genera Prices recurrentes `monthly`/`yearly` (`catalog.ts:65, 76`; `checkPrice` exige `recurring`, `:100`).
  - `PURCHASABLE_FAMILIES = extension | industry_module` (`:53`).
  - No hay *meters* ni `usage_record` en `server/stripe`.
- Motor interno (modo sombra): familia `usage` con `recordUsage` (`subscriptions/service.ts:560-564`) y borrador de factura de consumos al cerrar el periodo (`server/subscriptions/shadow.ts:148-159`). No llega a Stripe.
- Cotizador: `variableCosts` es solo texto (`thirdPartyCosts`; `quote.ts:302-305`; `commercialQuote.ts:227-231`). Un producto `usage` cae en `no_price` en `quote()` (`:225-229`). `implementation` siempre lleva `amountCents: null`.

### Contrato
`variableCosts` e `implementation` **no** entran en ningún importe del pedido ni en Stripe. Si un día se cobran (IA de Copilot por encima del límite, firma avanzada), será con un circuito propio (Stripe Billing Meters o factura aparte) y una decisión explícita. Un pedido con `implementation[].amountCents !== null` debe rechazarse hasta entonces.

## 10. Adaptaciones priorizadas (importe cobrado = presupuesto mostrado, siempre)

**P0 — imprescindibles antes de encender**
1. **Inyectar el cotizador comercial en los cuatro consumidores**: orquestador (`api.ts:1555`), compras (`api.ts:1700`), contratos del CRM (`api.ts:1338`) y `quantityUnits`/`specs` (`service.ts:504-529`). Firma recomendada: `quote: (r) => quoteResponse(catalog, policy, r)` con `svc.commercialCatalog("published")`, el mismo origen que `web/api.ts:127`. `QuoteResponse` es compatible con `QuoteResult` salvo `lines[].status` (tipo ampliado), así que hay que revisar los `status` en `purchases.ts` y en `service.ts:527`.
2. **Instantánea en `OrderQuote`** (§2): `lines`, `recurring`, `taxes`, `included`, `pricingHash`, `policyId` y `pendingRules`. `stepContract` y `stepSubscribe` usan la instantánea, no una recotización.
3. **Verificación al crear el pedido:**
   - `POST /orders` acepta `expected: { catalogVersion, pricingHash | contractAmountCents, firstPeriodCents }` (lo mostrado);
   - `stepQuote` recalcula y, si difiere el **importe** (no solo la versión), lanza `OrderError("conflict")` y el CRM vuelve a cotizar;
   - con `catalogVersion` distinto e importes iguales, se acepta y se anota.
4. **Verificación al cobrar:**
   - antes de abrir Checkout o aplicar una compra, recotizar con el catálogo publicado y comparar `pricingHash` con la instantánea; si difiere → `conflict`, sin cobrar;
   - en Checkout, `line_items` = Prices de las líneas cobradas + cupones de `bundle_adjusted`, y la suma tiene que ser `contractAmountCents`. Hoy `checkout.ts:228` lo comprueba solo para el plan; hay que generalizarlo a la suma;
   - en `events.ts:486`, mantener `subtotal === contractAmountCents` para el pago inicial y extenderlo a mensual + anual cuando D11 permita mezclar.
5. **Partidas `plan_inclusion` en la suscripción interna** (§1.3) y su exclusión de `contractedItems` (§8).
6. **`purchases.plan()`** (§7.2): no comprar lo incluido, saltar líneas a 0 € y delta por `recurring`.
7. **Una sola periodicidad** cobrada en Stripe y `mkLine` con `pickPrice` (§6).

**P1 — necesarias para los cambios de plan y paquetes**
8. Absorción en subida (§5.1) y conservar o soltar en bajada (§5.2), con `previewPlanChange` como única fuente.
9. Cupón por `bundle_adjusted` (§3.1) y permitir el borrado de componentes absorbidos a fin de periodo (§3.3).
10. `proration_date` fijado e importe esperado en la compra (§7.3).
11. `addsNoCapability` con las capacidades de la instantánea (§4.4).
12. `applyExternalPlanChange` conservando `items` (§5.3).

**P2 — coherencia de producto**
13. `panelCatalog` (`server/commerce/panelCatalog.ts:44-64`): marcar `purchasable: false` y «Incluido en tu plan» para lo que incluye el plan de la empresa. Hoy lo ofrecería a precio completo.
14. `limitsFor` y `OrganizationService.limits` con los cupos de la instantánea (§4.3).
15. Métrica `employees` en límites y uso para controlar el tope de People (§1.5).
16. `metadata.es_included` y `es_catalog_version` en la suscripción de Stripe (§8).

## 11. Criterios de aceptación, pruebas mínimas y encendido

### Criterios
- C1. Con política **neutra**, el orquestador, las compras y los contratos dan **exactamente** los mismos importes y Prices que hoy (regresión con el barrido de `commercialCatalog.test.ts:77`, ampliada a `stepQuote` y `purchases.plan`).
- C2. Con política publicada no neutra, para cada caso de §11.2: `pricingHash` del pedido = el de `/web/quote` = el recalculado al cobrar, **y** la suma de Prices de Stripe (menos cupones) = `contractAmountCents`.
- C3. Ningún pedido con `pendingRules` no vacío ni con una línea `on_quote` llega a `contracted` por autoservicio.
- C4. Las licencias resultantes = `commercial.capabilities` del pedido.
- C5. `stripe.items_drift` sin avisos tras alta, compra, subida y bajada con inclusiones.

### Pruebas mínimas (sandbox de Stripe y BD de pruebas; nunca live)
1. Business mensual sin extras → idéntico a hoy.
2. Business + `connect-automations` pedido explícitamente → se quita, línea a 0 €, Stripe sin esa partida, capacidad concedida.
3. Business con `employees` ≤ tope, y con `employees` > tope → partida `connect-people` cobrada.
4. Paquete `min2` con dos componentes pendientes (cupón) y con uno (componente suelto); regla `catalog` con componente incluido → error.
5. Subida Essential→Business con `connect-automations` ya pagado → crédito por prorrateo y partida `plan_inclusion`.
6. Bajada Business→Essential con `keepingAll` y con `droppingAll` → importes a fin de periodo y capacidades caducadas.
7. Plan anual con excedente de People → rechazo por periodicidad mixta (hasta D11).
8. Desfase: publicar un precio entre la cotización del CRM y la creación o el cobro del pedido → `conflict`, sin cargo.
9. Compra con vista previa y aplicación separadas en el tiempo → mismo `amountDue` (con `proration_date`) o `conflict`.
10. Apagar el interruptor después de encenderlo → republicación obligatoria verificada (R3).

### Procedimiento de encendido
1. Fusionar P0 y P1 con el interruptor **apagado**. C1 tiene que pasar en CI y en `circuitoComercial.e2e.mysql.test.ts`.
2. Aprobar en los borradores solo las reglas decididas por el propietario (estado `approved`). `GET /web/commercial/review` sin bloqueos.
3. Cambio de código **aislado** (commit propio): `commercialPolicy: true` en `server/controlPlane/api.ts:515` (por ejemplo leyendo una variable `CP_COMMERCIAL_POLICY=true`, que hoy **no existe**). Verificar el despliegue antes de seguir.
4. **Volver a publicar** los planes y paquetes con reglas: hasta republicarlos, `e.published` no las lleva (`service.ts:265, 386`).
5. Ejecutar las pruebas 1-9 en sandbox con el catálogo publicado. Vigilar `stripe.items_drift` y los rechazos `conflict`.
6. Marcha atrás: interruptor apagado **y** republicación de esos productos (R3).

## 12. Riesgos y preguntas abiertas

### Riesgos detectados (con el interruptor APAGADO, hoy)
- **R1 — Compra desde el panel: el importe cobrado puede diferir del mostrado.** `preview` y `purchase` calculan el prorrateo en dos llamadas distintas a Stripe, sin `proration_date` (`gateway.ts:547-566`). `purchase` no recibe ni compara el importe visto (`purchases.ts:53-58, 276-317`). La diferencia suele ser de céntimos (prorrateo por segundos), pero no está acotada si cambia el día o un precio enlazado entre las dos llamadas. Los pagos `change` no se cotejan con nada (`events.ts:486` solo comprueba el `initial`).
- **R2 — El contrato puede guardar líneas distintas del importe del pedido.** `stepContract` vuelve a cotizar (`service.ts:403`) y mezcla esas líneas con `o.quote.contractAmountCents` de la cotización anterior. `specs()` toma el precio aprobado **en el momento de suscribir** (`priceFor`, `service.ts:493-503`). Si se publica una tarifa entre la cotización, el pago y el webhook, la suscripción interna guarda otro importe que el que cobró Stripe. Es poco probable, pero no hay ninguna comprobación.
- **R3 — Apagar el interruptor no es instantáneo.** Las reglas publicadas mientras estuvo encendido siguen en `e.published` hasta volver a publicar. Si eso ocurre con los cobros todavía en `quote()`, la web y el CRM mostrarían inclusiones (precio menor) que el pedido cobraría a precio completo.
- **R4 — Portal de Stripe:** `applyExternalPlanChange` crea el pedido con `items: []` (`service.ts:754`). Hoy no tiene efecto (portal sin `subscription_update`, Checkout solo plan). Si se habilita con complementos, los daría de baja a fin de periodo.
- **R5 — `commercialQuote` fuerza la periodicidad mensual en sus líneas extra** (`commercialQuote.ts:107-109`). En un plan anual con política activa, el total mostrado mezclaría mensual y anual y no se podría cobrar en una suscripción de Stripe.
- **R6 — Comparar por `catalogVersion`** rechazaría pedidos válidos con cada cambio de texto de la web: el hash incluye `content` (`service.ts:413, 623`). Hay que comparar importes (`pricingHash`).

### Preguntas para el propietario
1. **D11:** ¿se permite mezclar periodicidades en Stripe? (a) prohibir, (b) segunda suscripción o (c) tarifa anual del complemento.
2. Subida que absorbe extensiones pagadas: ¿crédito prorrateado inmediato (recomendado) o se sigue cobrando hasta fin de periodo?
3. `bundle_adjusted`: ¿cupón por partida (recomendado) o Price propio del paquete ajustado (nueva tarifa aprobada)?
4. People parcial: ¿quién declara `employees` en el pedido y qué pasa si el uso real supera el tope a mitad de periodo (aviso, cobro en la renovación o bloqueo)?
5. ¿Se venden en línea los productos que un plan deja de incluir al bajar (por ejemplo `connect-pack-finance`, `extra-accounting`), o la bajada exige gestor?
6. ¿Se crea la variable `CP_COMMERCIAL_POLICY` o se mantiene el encendido solo por código?
7. Cupos de Enterprise (`quotaProposals`): ¿se publicarán alguna vez? Hoy `publicView` los elimina siempre, aunque estén aprobados.
