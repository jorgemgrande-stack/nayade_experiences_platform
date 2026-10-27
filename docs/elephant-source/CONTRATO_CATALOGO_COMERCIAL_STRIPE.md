# Contrato técnico v2: ventana de Stripe y catálogo comercial unificado

Destinatario: la sesión responsable de Stripe, pedidos y suscripciones de Elephant Source.

**Base leída**
- Core: `origin/integration/elephant-source` en `ada7a677`. Incluye la fusión de #375 (`425bc642`, «plan, módulos y ampliaciones en una única suscripción de Stripe»).
- CRM: `origin/integration/elephant-source` en `86e1dfc`. Incluye #68 (`4ae445e`) y #70 (`9492b71`).

**Sustituye** a la v1 de este mismo fichero (escrita sobre `ea661a1a`; queda en el historial de git). Las reglas comerciales preparadas están en `server/catalog/commercial/rules.ts`.

Es un documento de coordinación: no cambia código, Stripe ni bases de datos. Todas las referencias `fichero:línea` son del Core en `ada7a677`, salvo las que empiezan por `CRM:`.
Fecha: 27/10/2026.

**Qué no cambia.** El cotizador nuevo (`quoteResponse`/`commercialQuote`, `server/catalog/commercial/commercialQuote.ts`) no ha cambiado desde `ea661a1a`. Entre los ficheros del catálogo, solo cambió `importSpecs.ts`.

**Interruptor.** `commercialPolicy` sigue apagado: `WebAdminService` se construye sin él en `server/controlPlane/api.ts:515-527`, y `grep COMMERCIAL_POLICY` sigue sin resultados.

---

## 0. Qué ha cambiado desde la v1 (resumen)

**#375 (Core)**

1. **Checkout modular.** El Checkout cobra plan, módulos y ampliaciones en **una sola suscripción de Stripe**.
   - Las partidas salen de `planCheckoutLines` (`server/stripe/checkoutLines.ts:67-125`), con el presupuesto del servidor.
   - Se comprueban los Prices **reales** de Stripe (`:94-101`), el importe del contrato (`:107-111`) y el primer cobro (`:113-116`).
2. **Plan anual con partidas solo mensuales.**
   - El primer mes va como importe único en el mismo pago (`checkout.ts:230-238`).
   - Después, `DeferredItemsService.attach` (`server/stripe/deferredItems.ts:48-120`) añade esas partidas sin prorrateo. Lo llama `events.ts:598-605`, y la conciliación lo reintenta.
   - Las suscripciones nuevas nacen en modo `flexible` (`gateway.ts:497-500`).
3. **Nuevo campo `OrderQuote.firstPeriodNetCents`** (`server/orchestrator/types.ts:74-78`; se calcula en `service.ts:369`). El procesador lo exige a la primera factura (`events.ts:495`).
4. **Compras y reducciones con la periodicidad de cada partida** (`purchases.ts:243-248, 443-450`) y `intervalCompatible` (`multipart.ts:42-44`).
5. **Vía de operador para el CRM:** `POST /commerce/companies/:companyId/{purchases,reductions}[/preview]` (`purchasesApi.ts:100-123`). Usa el mismo motor y la misma idempotencia.
6. **Un quinto consumidor de `quote()` antiguo:** `serverQuote` (`api.ts:1646`), que alimenta el Checkout y `DeferredItemsService`.

**CRM #68 y #70**

7. «Contratar con cobro en Stripe» con módulos y cantidades. El CRM muestra el presupuesto de `POST /web/quote` (`CRM:src/pages/Subscriptions.tsx:489-496`; `CRM:src/orders.ts:446-458`) y crea el pedido con `POST /orders`.
8. Ficha de una suscripción de Stripe: altas y bajas con vista previa del prorrateo y confirmación (`CRM:src/pages/Subscriptions.tsx:1117-1185`).

**El prorrateo sigue sin fijarse ni cotejarse** (§2).

---

## 1. Tabla v1 → estado actual

Leyenda: **V** = vigente (con la referencia actualizada) · **C** = cambiado · **R** = resuelto por #375/#68/#70 · **O** = obsoleto.

| v1 | Afirmación o adaptación | Estado | Detalle y referencias actuales |
|---|---|---|---|
| §0 | Web y CRM cotizan con `quoteResponse` | V | `server/web/publicSite.ts:97`, `server/web/api.ts:124-129` (sin cambios). El CRM #68/#70 lo usa para mostrar lo que se cobrará. |
| §0 | Contratos del CRM con `quote()` | V | `api.ts:1339` (`crmQuote`). |
| §0 | Orquestador con `quote()` | V | `api.ts:1556`. |
| §0 | Compras con `quote()` | V | `api.ts:1706`. |
| §0 | — (nuevo) Checkout y partidas diferidas con `quote()` | C | `serverQuote`, `api.ts:1646-1648`. Son **cinco** consumidores, no cuatro. |
| §0 | Licencias, límites y organización sin política | V | `api.ts:1389, 1453, 1501, 1538`. |
| §0 | Checkout solo del plan | **R** | Ahora plan, módulos y ampliaciones: `checkout.ts:228`, `checkoutLines.ts`. Solo plan sin cotizador: `checkout.ts:471-491`. |
| §0 | Interruptor apagado, sin variable | V | `api.ts:515-527`; `service.ts:123, 265, 386`. |
| §0 | Proyección congelada al publicar | V | `server/web/service.ts:265, 386`. |
| §1.1-1.2 | Petición sin incluidos; instantánea `included` | V | Sin implementar. |
| §1.3 | Partida interna `plan_inclusion` | V | `PriceSource` sigue sin ese valor (`server/subscriptions/types.ts:15`). |
| §1.4-1.5 | Excedente a precio de catálogo; `employees` sin métrica | V | `LIMIT_METRICS = users, sites, storage_gb` (`server/_core/limits/store.ts:13`). |
| §2 | `OrderQuote` sin líneas | C | Añade `firstPeriodNetCents` (`types.ts:74-78`), pero sigue sin `lines`, `pricingHash`, `policyId` ni `included` (`service.ts:364-374`). |
| §2 | `stepContract` vuelve a cotizar | V | `service.ts:404-405`. Además, `deferredItems.ts:55` vuelve a cotizar **al activar** (R-B, §6). |
| §3.1 | Cupón para `bundle_adjusted` | V | No hay cupones en `server/stripe` (`grep coupon\|discounts` sin resultados). Hoy, una línea `bundle_adjusted` haría saltar `conflict` en `checkoutLines.ts:84`. |
| §3.3 | La compra no puede borrar partidas | V | `purchases.ts:265`. |
| §4 | La licencia sale de las partidas vivas | V | `server/licensing/service.ts:79-111` (sin cambios). |
| §4.4 | `addsNoCapability` con la instantánea | V | `service.ts:457-461`. |
| §5.1-5.2 | Absorción en subidas; conservar o soltar en bajadas | V | `applyChange` en `service.ts:575-642`. |
| §5.3 | `applyExternalPlanChange` con `items: []` | V | `service.ts:755`. |
| §5.4 | `amountDue` por periodos completos | V | `service.ts:464-469`. |
| §5 | Checkout rechaza pedidos `change` | V | `checkout.ts:221`; `CRM:src/orders.ts:465-466`. |
| §6.1 | Una sola periodicidad por pedido cobrado | **O/R** | #375 permite mezclar en **una** suscripción en modo `flexible` (primer mes como importe único y partidas diferidas). Sigue prohibida una partida **anual** con plan **mensual** (`checkoutLines.ts:76`). |
| §6.2 | `mkLine` fuerza `month` | V | `commercialQuote.ts:107-109`. Ahora el efecto es otro (§3, P0-5): con #375 se cobraría, pero en mensual aunque exista tarifa anual. |
| §6.3 | Opciones D11 (a/b/c) | **R (de hecho)** | #375 implanta una opción (d) que la v1 no recogía: suscripción única `flexible`. `purchases.context` sigue exigiendo una sola suscripción (`purchases.ts:189-190`). Falta la ratificación del propietario y verificar en sandbox la fecha del primer cobro mensual diferido (`SUSCRIPCIONES_COBRO_STRIPE.md:95`). |
| §7 | Prorrateo calculado por Stripe | V | Vista previa: `purchases.ts:282-288` → `gateway.ts:572-580`. Aplicación: `purchases.ts:339-345` → `gateway.ts:557-571`. |
| §7 | Delta por línea, no por `recurring` | V | `purchases.ts:238-259`. |
| §7 | Reducciones sin prorrateo | V | `purchases.ts:540-559` (`prorationBehavior: "none"`). |
| §7 | Solo se coteja el pago `initial` | V | `events.ts:490, 495`. Los pagos `change` se registran sin comparar. |
| §7.3 | Sin `proration_date` | **V** | `grep proration_date\|prorationDate` en `server/` y `client/`: sin resultados. §2 trae el diseño completo. |
| §8 | Inclusiones sin línea en Stripe; excluirlas de `contractedItems` | V | `contractedItems` en `api.ts:1655-1663`: cuenta las familias `core_plan`, `extension` e `industry_module`, así que una `plan_inclusion` de esas familias daría `items_drift`. |
| §9 | Sin cobro por consumo | V | Sin meters. Un producto `service` (implantación) no tiene Price mensual o anual: `checkoutLines.ts:81-82` lo deja en `unavailable`. |
| §10 P0-1 | Inyectar el cotizador comercial | C | Ahora en **cinco** puntos (§3). |
| §10 P0-2 | Instantánea | V | — |
| §10 P0-3 | `expected` en `POST /orders` | V | El CRM #68/#70 no envía lo que mostró: solo `request` e `idempotencyKey` (`CRM:src/orders.ts:496-501`). |
| §10 P0-4 | Recotizar y comparar al cobrar | **R parcial** | `checkoutLines.ts:84, 97-98, 109-116` compara importes (no un `pricingHash`) y bloquea con `conflict`. No hay comprobación equivalente en las compras (§2). |
| §10 P0-7 | Una sola periodicidad | O | Ver §6.1. Ahora toca alinear `mkLine` con `pickPrice` y con las partidas diferidas. |
| §10 P1-10 | `proration_date` e importe esperado | **Sube a P0** | Las compras ya se usan desde el panel del Core (`client/src/pages/admin/subscription/ModulesPage.tsx:103-104`) y desde el CRM #70. |
| §10 P2 | `panelCatalog`, cupos, `employees`, metadatos | V | Sin cambios. |
| §11 | C1-C5 y pruebas 1-10 | C | Prueba 7 obsoleta; se añaden C6-C8 (§5). |
| R1 | Prorrateo no fijado | **V, más expuesto** | Tres entradas: panel del Core, CRM (operador) y API. Ver §6, R-A. |
| R2 | Contrato o especificaciones con otra cotización | V, ampliado | `service.ts:404, 494-511`, más `deferredItems.ts:55, 64` (R-B). |
| R3 | Apagar no es instantáneo | V | Más un efecto nuevo: el CRM mostraría `quoteResponse` y cobraría `quote()` (R-E). |
| R4 | Portal con `items: []` | V | `service.ts:755`; portal sin `subscription_update`. |
| R5 | Mensual forzado | C | Ver la fila de §6.2. |
| R6 | Comparar por `catalogVersion` | V | `checkoutLines` ya compara importes, que es lo correcto. |

---

## 2. Prorrateo (prioritario)

### 2.1 Estado actual exacto

| Paso | Código | Llamada a Stripe | `proration_date` | ¿Se compara el importe? |
|---|---|---|---|---|
| Vista previa de compra | `purchases.ts:282-288` | `invoices.createPreview({ subscription, subscription_details: { items, proration_behavior: "always_invoice" } })` (`gateway.ts:572-577`) | **No** | Devuelve `amountDue` (= `amount_due`), `subtotal` y `taxCents`. No se guarda nada. |
| Compra | `purchases.ts:294-336` → `send` (`:339-373`) | `subscriptions.update` con `proration_behavior: always_invoice`, `payment_behavior: pending_if_incomplete` y clave `es-<ns>-order-<id>-items-v1` (`gateway.ts:557-566`) | **No** | **No.** `PurchaseInput` (`purchases.ts:53-58`) y el esquema `body` con `.strict()` (`purchasesApi.ts:33-40`) no admiten un importe. `changes.setInvoice` guarda `inv.total` (`purchases.ts:362`), pero nadie lo compara. |
| Webhook del cobro | `events.ts:485-523` | — | — | Con `purpose = "change"` (`:490`) se registra el pago sin cotejarlo. Solo `initial` se compara (`:495`). |
| Vista previa y aplicación de una reducción | `purchases.ts:487-492, 501-559` | `subscriptions.update` con `proration_behavior: none` y `error_if_incomplete` | No aplica | No hay cobro ni abono. Lo aceptado es la fecha `effectiveAt` y las líneas. |
| Partidas diferidas (plan anual) | `deferredItems.ts:104-108` | `subscriptions.update` con `proration_behavior: none` | No aplica | El primer mes ya se cobró en el Checkout. |

**CRM #70** (`CRM:src/pages/Subscriptions.tsx:1153-1185`):
1. `calc()` pide la vista previa.
2. `confirmAction` muestra «Stripe cobrará ahora X de prorrateo».
3. `apply()` envía `{ idempotencyKey, ...body }` **sin** importe ni fecha.

La clave se genera en cada vista previa (`:1159`), así que reintentar la confirmación no cobra dos veces. Aun así, **Stripe recalcula el prorrateo en el momento de aplicar**.

**Panel del Core.** Sigue el mismo patrón: `subscriptionRouter.ts:118-124` → `commerceClient.ts:94-95`.

**Consecuencias**
- El importe cobrado puede diferir del mostrado.
- Entre dos llamadas seguidas la diferencia es de céntimos, porque Stripe prorratea por segundos.
- No hay cota si entre la vista previa y la aplicación cambian:
  - el periodo (renovación);
  - el impuesto (dirección o NIF del cliente);
  - el saldo del cliente;
  - un descuento puesto desde el Dashboard;
  - el Price enlazado.
- En la vía del CRM es un **operador** quien acepta, con la tarjeta del cliente. La cifra aceptada no queda registrada en ningún sitio.

**Doble de pruebas.** `FakeStripeGateway` prorratea con su reloj (`testing.ts:133`, `at = this.nowSec()`) y sobre el periodo de la **suscripción** (`:134-135`), no sobre el de la partida. En modo `flexible`, Stripe usa el periodo de cada partida. Hoy ninguna prueba avanza el reloj entre la vista previa y la compra.

### 2.2 Diseño

**Invariante.** La cifra que Stripe cobra es la aceptada (neto, impuesto y total), calculada con el **mismo** `proration_date`. Si Stripe calculara otra, **no se cobra**: se devuelve `conflict` con la cifra nueva, para que se acepte de forma explícita.

**A. Vista previa (`ModulePurchaseService.preview`)**
1. `prorationDate = floor(now/1000)`. Debe cumplir `sub.currentPeriodStart ≤ prorationDate < sub.currentPeriodEnd`. Si no, `conflict` («se está renovando»).
2. Llamar a `createPreview` con `subscription_details.proration_date = prorationDate`.
3. Devolver además:
   - `prorationDate`;
   - `subtotalCents`, `taxCents`, `totalCents` y `amountDueCents`;
   - `expiresAt` = ahora + TTL. Propuesta: 15 minutos (decisión del propietario). Siempre muy por debajo de las 23 h del `pending_update` y de las 24 h de idempotencia de Stripe;
   - `quoteToken`.
4. `quoteToken` = `base64url(payload) + "." + HMAC-SHA256(secreto, payload)`. El `payload` lleva:
   - versión, `tenantId`, `currentOrderId` y `subscriptionId`;
   - `items` (operaciones normalizadas y ordenadas) y `expectedItems`;
   - `prices` (`stripePriceId` → `unitAmountCents`);
   - `prorationDate`, `currency`, `subtotal`, `tax`, `total` y `amountDue`;
   - `iat` y `exp`.
5. **Secreto.** La variable `CP_PURCHASE_QUOTE_SECRET` **no existe**. Crearla es un cambio de infraestructura aislado (CLAUDE.md).
   - Alternativa sin secreto: guardar la vista previa en una tabla nueva y devolver su id. Exige una migración.
   - Recomendado: HMAC, que no cambia el esquema para la firma.

**B. Aplicación (`ModulePurchaseService.purchase`)**
1. Nueva entrada: `{ quoteToken, acceptedAmountDueCents }`. Hay que ampliar `PurchaseInput` y `body` en `purchasesApi.ts`, y también `subscriptionRouter.ts` y `commerceClient.ts`.
2. Mantener `replay` primero (`purchases.ts:299-300`): una repetición devuelve el mismo resultado sin volver a validar.
3. Verificar la firma con `timingSafeEqual`, la caducidad (si caducó, `conflict` con una vista previa nueva), el tenant y que `acceptedAmountDueCents === payload.amountDue`.
4. Llamar a `context()` y `plan()` como hoy. Si `p.items` y `p.expected` no son los del token, o si cambió algún `unitAmountCents` → `conflict`.
5. Comprobar que `prorationDate` sigue dentro del periodo vigente. Si hubo renovación → `conflict`.
6. **Recalcular justo antes de aplicar** con `createPreview` y el **mismo** `prorationDate`. Si difiere `subtotal`, `tax`, `total` o `amountDue` → `PurchaseError("conflict")` con `details.preview` (la vista previa nueva, con su token) y sin crear pedido ni cambio.
   - Hoy `PurchaseError` no tiene `details`: hay que añadirlo.
   - `purchasesApi.ts:56` debe devolver `409 { error: "conflict", preview }`.
7. Crear el pedido y el cambio. El cambio guarda `prorationDate`, `acceptedSubtotalCents`, `acceptedTaxCents`, `acceptedTotalCents` y `quoteHash` (sha256 del payload). Requiere una **migración** de `stripe_subscription_changes`: commit aislado, generado y revisado, nunca en el arranque.
8. `send` pasa `proration_date: change.prorationDate` en `subscriptions.update`. Los parámetros son estables porque salen de la fila guardada, así que la misma `idempotency_key` sigue siendo válida.
9. Tras la respuesta, si `invoice.subtotal`/`total` ≠ lo aceptado:
   - con la factura **abierta** (`pending_update`): `gateway.voidInvoice` (existe: `gateway.ts:238, 582`), que anula el cambio pendiente sin cobro, y se resuelve como `failed` con `conflict`;
   - si ya está **pagada**: alerta (C).

**C. Cotejo tras el cobro (`events.ts`)**

En `recordPaidInvoice` (`events.ts:485`), con `purpose === "change"`:
1. Buscar el cambio con `changes.ofSubscription(sub.id)` y `stripeInvoiceId === inv.id`.
2. Si existe y tiene importe aceptado, comparar `inv.subtotal` y `inv.total`.
3. Si difieren: `opsLog("error", …, "change_amount_mismatch")` y `recordFailure("stripe.change_amount_mismatch")`, una regla nueva en `alerts.ts`.
4. **No se lanza** `StripeMismatchError`: el cobro ya está hecho y bloquear los derechos de algo pagado es peor. El caso queda para revisión o reembolso manual.

**Pseudocódigo orientativo (sin aplicar)**
```ts
// purchases.ts — vista previa
const at = Math.floor(this.now() / 1000);
if (sub.currentPeriodStart == null || at < sub.currentPeriodStart || at >= (sub.currentPeriodEnd ?? 0)) throw new PurchaseError("conflict", "La suscripción se está renovando");
const inv = await gw.previewSubscriptionChange({ subscriptionId: sub.id, items: p.items, prorationBehavior: "always_invoice", prorationDate: at });
const payload = { v: 1, tenantId, orderId: current.id, sub: sub.id, items: norm(p.items), expected: norm(p.expected), prices: priceMap(p.lines), at, cur: inv.currency, sub_c: inv.subtotal, tax_c: inv.taxCents, tot_c: inv.total, due_c: inv.amountDue, exp: at + TTL };
return { ...hoy, prorationDate: at, totalCents: inv.total, expiresAt: payload.exp * 1000, quoteToken: sign(payload) };

// purchases.ts — compra (tras replay)
const t = verify(input.quoteToken);                     // firma, caducidad, tenant
if (input.acceptedAmountDueCents !== t.due_c) throw invalid_input;
const p = await this.plan(current, sub, input);          // como hoy
if (!sameOps(p, t)) throw conflict(await this.preview(...));
const again = await gw.previewSubscriptionChange({ ..., prorationDate: t.at });
if (!sameMoney(again, t)) throw conflict(await this.preview(...));   // sin crear pedido
// … pedido, cambio con { prorationDate: t.at, accepted*: t.*, quoteHash } …
// send(): updateSubscriptionItems({ ..., prorationDate: change.prorationDate }, change.idempotencyKey)
```
**Gateway** (`gateway.ts:96-102, 557-580`): campo opcional `prorationDate?: number` en `SubscriptionItemsChange`. Se traduce a `proration_date` en `subscriptions.update` y a `subscription_details.proration_date` en `createPreview`. `GwInvoicePreview` añade `total`.

**Doble** (`testing.ts:120-136, 167, 213`): `at = change.prorationDate ?? this.nowSec()`. Conviene además un modo que prorratee por el periodo de la partida (modo `flexible`) para no ocultar la diferencia de §2.1.

**CRM #70** (`CRM:src/pages/Subscriptions.tsx:1153-1185`):
- guardar `quoteToken`, `amountDueCents` y `expiresAt` de la vista previa;
- enviar `{ idempotencyKey, quoteToken, acceptedAmountDueCents, ...body }`;
- ante un `409 conflict` con `preview`, mostrar «El importe ha cambiado de X a Y» y pedir una **nueva** confirmación con una clave nueva;
- registrar en la auditoría del pedido que aceptó un operador (`actor` ya lleva `/crm`, `purchasesApi.ts:102`).

El panel del Core (`ModulesPage.tsx`) necesita el mismo flujo.

**Despliegue en dos fases**
1. Servidor que **acepta** el token como opcional, y clientes que lo envían.
2. Token **obligatorio**.

El esquema `.strict()` rechazaría campos nuevos si el CRM se adelantara al servidor.

### 2.3 Casos límite

| Caso | Comportamiento |
|---|---|
| Renovación entre la vista previa y la aplicación | `prorationDate < currentPeriodStart` → `conflict` con vista previa nueva. `purchases.ts:197-200` ya frena con la renovación interna vencida. |
| Partida mensual en un plan anual (`flexible`) | El periodo de la partida no es el de la suscripción. `GwSubscriptionItem` no expone periodos por partida (`gateway.ts:70-74`). Si Stripe rechaza el `proration_date` → error no reintentable → `conflict`. **Verificar en sandbox.** |
| Precio retirado o enlace inactivo | `plan()` → `unavailable` (`purchases.ts:242-250`). Un Price distinto → `conflict` (mapa de `prices` del token). |
| Cupón o descuento en Stripe (Dashboard) | Hoy no se usan desde el código. Si existe, entra en las dos vistas previas. Si vence o cambia entre ellas → `conflict`. |
| Impuestos | `taxCents` forma parte del token. Un cambio de dirección o NIF → `conflict`. El neto (`subtotal`) es la cifra fiscal del presupuesto; el `total` es lo cobrado. |
| Saldo a favor del cliente | Cambia `amount_due`, no `total`. Se compara `amountDue` porque es lo que se carga a la tarjeta → `conflict`. |
| `pending_if_incomplete` (3DS o fallo) | La factura abierta tiene el importe fijado. Al pagarla en la página de Stripe se cobra eso mismo. Caduca a las 23 h sin cobro (`purchases.ts:404-412`). C) coteja al pagarse. |
| Reintento o doble clic | `replay` por `idempotencyKey` (`purchases.ts:297-300`) y `idempotency_key` de Stripe por pedido. El cambio guarda `prorationDate`, así que los parámetros son idénticos. Si la llamada no es concluyente → `processing` y `sync` relee sin reenviar compras (solo reenvía reducciones, `:399`). |
| Reloj del servidor adelantado | `prorationDate` no puede ser futuro respecto a Stripe: usar el `now()` del servidor y aceptar el error de Stripe como `conflict`. |
| Token reutilizado para otra compra | Lleva `items`, `currentOrderId` y tenant. Tras aplicarse, el pedido vigente cambia → `conflict`. |

### 2.4 Pruebas que lo demuestran

**Unitarias e integración** (doble `FakeStripeGateway`; ficheros `server/controlPlane.modulePurchase.test.ts` y `server/controlPlane.modularSubscriptions.test.ts`):
1. Vista previa en `t0`, `fake.now += 2 días`, compra con token → el subtotal facturado es el de la vista previa. Exige `fake.calls` con `proration_date === t0`.
2. Sin token (fase 2) → 400. Token alterado → 400. Token caducado → 409 con `preview`.
3. Precio republicado entre la vista previa y la compra → 409. **Ninguna** llamada `subscriptions.update` en `fake.calls`.
4. `fake.invoiceTaxBp` cambiado entre la vista previa y la compra → 409 con la nueva cifra.
5. Renovación simulada (`currentPeriodStart` posterior a `prorationDate`) → 409.
6. Misma `idempotencyKey` dos veces → una sola `subscriptions.update`.
7. Factura de cambio pagada con un subtotal distinto del aceptado → pago registrado y alerta `stripe.change_amount_mismatch`.
8. Factura de cambio **abierta** con importe distinto → `voidInvoice` y estado `failed`, sin derechos.
9. CRM (`CRM:src/orders.test.ts` o un test nuevo): un 409 con `preview` pide reconfirmar y usa otra clave.

**Sandbox de Stripe** (claves de prueba y *test clocks*; nunca live):
- S1: vista previa → esperar 10 minutos → compra → `invoice.subtotal` y `total` idénticos.
- S2: módulo mensual en una suscripción anual `flexible` con `proration_date`. Comprobar que se acepta y qué periodo prorratea.
- S3: tarjeta 3DS (`4000002760003184`) → `pending_update` → pagar la factura alojada → importe igual.
- S4: tarjeta rechazada (`4000000000000341`) → nada aplicado y caducidad.
- S5: *test clock* que cruza la renovación entre la vista previa y la compra → `conflict`.

---

## 3. Adaptaciones para encender el catálogo comercial (actualizadas a #375)

### P0: imprescindibles antes de encender

1. **Prorrateo fijado y cotejado** (§2). No depende del interruptor: corrige un riesgo actual.
2. **Una sola fábrica de cotizador** para los **cinco** consumidores: `api.ts:1339` (CRM), `:1556` (orquestador), `:1646` (Checkout y partidas diferidas), `:1706` (compras), y también `quantityUnits` y `specs` (`service.ts:505-530`).
   - Con el interruptor apagado, `quoteResponse` con política neutra (equivalencia de `commercialCatalog.test.ts:70-93`).
   - Revisar los `status` ampliados donde hoy se filtra: `checkoutLines.ts:74-75`, `purchases.ts:231, 239`, `service.ts:528`, `deferredItems.ts:57` y `CRM:src/orders.ts:447`.
3. **Instantánea en `OrderQuote`** (`lines` con `interval` y `status`, `recurring`, `taxes`, `included`, `pricingHash`, `policyId`, `pendingRules`). Además de `stepContract` (`service.ts:404`), deben usarla:
   - `StripeCheckoutService.modularLines` (`checkout.ts:460`, que hoy vuelve a cotizar);
   - `DeferredItemsService.attach` (`deferredItems.ts:55`, que vuelve a cotizar **al activar**).

   Así, `planCheckoutLines` recibe las líneas del pedido, no las de otra cotización.
4. **`planCheckoutLines` con estados nuevos:**
   - saltar `included_in_plan` y `partially_included` (a 0 €: sin partida en Stripe; inclusión como partida interna, v1 §1.3 y §8);
   - mantener el salto de `included_in_bundle`;
   - `on_quote` → `unsupported`.

   Hoy una línea incluida (0 €) chocaría con el precio aprobado → `conflict` en `checkoutLines.ts:84`, y no se podría vender Business con inclusiones.
5. **`mkLine` con la tarifa de su periodicidad** (`commercialQuote.ts:107-109`): usar la anual si existe, como `pickPrice` en `quote.ts:348-354`. Si no la hay:
   - en un plan anual, la línea es mensual y va al circuito diferido (#375);
   - en un plan mensual, una línea anual sigue prohibida (`checkoutLines.ts:76`).

   `firstPeriodNetCents` y la comprobación de `events.ts:495` deben salir de `recurring` de la instantánea, con la misma fórmula: anual + un mes.
6. **Partidas `plan_inclusion`** en la suscripción interna y su exclusión de `contractedItems` (`api.ts:1655-1663`). Si no, `items_drift`.
7. **`purchases.plan()` y `planReduction()`:**
   - rechazar `add` de productos incluidos y `remove` de productos incluidos;
   - saltar las líneas a 0 €;
   - delta por `recurring`.
8. **Lo que muestra el CRM = lo que cobra el servidor.** `stripeChargeSummary` (`CRM:src/orders.ts:446-458`) solo suma `status === "charged"`: con la política encendida omitiría `bundle_adjusted` y el excedente. Debe usar los totales del servidor (`recurring` e `initial`) en lugar de sumar en el navegador.
9. **`POST /orders` con `expected`** (v1 P0-3): el CRM #68/#70 envía lo que mostró (`firstCents`, `monthlyCents`, `yearlyCents` o `pricingHash`). `stepQuote` rechaza con `conflict` si el importe difiere.

### P1: cambios de plan y paquetes

10. **`bundle_adjusted`:**
    - en el Checkout: Price del paquete + `discounts` del *line item* (cupón `amount_off`, `duration: forever`, metadatos `es_reason=bundle_min2`, `es_catalog_version`); hoy `CheckoutLineItem` (`gateway.ts:170`) no admite descuentos;
    - en las compras: el mismo cupón en `subscriptions.update` y en `createPreview`, para que el prorrateo lo refleje;
    - absorción de componentes a fin de periodo: requiere permitir borrados programados, que hoy rechaza `purchases.ts:265`.
11. Absorción en las subidas y conservar o soltar en las bajadas (v1 §5.1-5.2), con `previewPlanChange` como única fuente. La subida que absorbe un módulo mensual de un plan anual debe borrar esa partida en la misma actualización con `proration_date` (§2).
12. `addsNoCapability` (`service.ts:457-461`) con las capacidades de la instantánea.
13. `applyExternalPlanChange` (`service.ts:755`) conservando los `items` del pedido vigente.
14. **Partidas diferidas atadas a la instantánea** (P0-3) y regla de bloqueo: si `attach` termina `blocked`, alerta **y** retención de la renovación mensual (ver R-B).

### P2: coherencia de producto

15. `panelCatalog` (`server/commerce/panelCatalog.ts:44-64`) marca «Incluido en tu plan».
16. Cupos de la instantánea en `limitsFor` y `OrganizationService.limits`.
17. Métrica `employees`.
18. Metadatos `es_included` y `es_catalog_version` en la suscripción de Stripe.
19. Firma (token) también en las reducciones, para fijar las líneas y `effectiveAt` aceptados.

---

## 4. Reglas comerciales pendientes que la ventana tendrá que soportar

Sin precios ni límites inventados. Estado de cada regla en `PROPOSED_POLICY` (`server/catalog/commercial/policy.ts:56-85`).

| Regla | Estado en el código | Pedidos | Stripe | Licencias y límites |
|---|---|---|---|---|
| **Enterprise: 25 usuarios, 10 sedes y 3 sociedades incluidos** | `quotaOverrides` en `proposed` (`policy.ts:76-78`). `publicView` elimina siempre `quotaProposals`. Enterprise está en `quoteOnRequestPlans` y fuera de `SELF_SERVICE_PLANS` (`checkout.ts:224`). | Cupos en la instantánea (`OrderQuote.quotas`). Las cantidades por encima se presupuestan (`on_quote`). | Nada en Checkout. Si algún día se cobra en Stripe, con Price por contrato (`PriceSource "contract"` ya existe). | `limitsFor` y Organización deben leer los cupos de la instantánea. **Falta la métrica `fiscal_entities`** en `LIMIT_METRICS` (`store.ts:13`); hoy solo existe en el cotizador (`commercialQuote.ts:334-335`). |
| **People en Business: 15 empleados incluidos y ampliaciones** | Inclusión `partial` `approved` con tope `{ base: 15, plusExtraOf: "users" }` en `proposed` (`policy.ts:60-68`). Por encima → `overflowKey: connect-people` completo. | `request.employees` obligatorio con tope; hoy `quote()` lo ignora. Las compras no lo aceptan: `PurchaseInput` (`purchases.ts:53-58`) y el esquema `.strict()` (`purchasesApi.ts:33-40`). | Excedente = partida normal de `connect-people` a su Price, con `proration_date` si se compra a mitad de periodo. «Ampliaciones» por tramo de empleados: **no existe** producto ni precio; no inventarlos. | Métrica `employees` en límites y uso, y decisión sobre qué pasa al superar el tope a mitad de periodo (v1, pregunta 4). |
| **POS: caja básica incluida y funciones avanzadas como extensión** | **No hay regla** en la política. `PlanInclusion.partial` solo admite tope por `employees` (`policy.ts:14-28`), no por función. | Dos productos distintos (básico incluido y avanzado vendible) o ampliar `PlanInclusion` con «capacidades incluidas». | La parte avanzada es una partida con su Price aprobado. La básica no tiene línea. | La licencia concede por producto (`licensing/service.ts:84-98`). Hacen falta capacidades separadas para la caja básica y las avanzadas en `server/catalog/capabilities.ts`. |
| **Descuento de paquete solo sobre lo facturable** | `commercialQuote.ts:186-196` ya calcula sobre los componentes pendientes (`vp`) con tope `vp`. `bundleRule` `min2` en `proposed`. | Instantánea con `discounts.bundleCents` y la base de cálculo (componentes facturables). | El cupón `amount_off` se calcula **solo** con los componentes facturables y nunca sobre `included_in_plan`. El prorrateo de compras lo incluye (§3 P1-10). | Los componentes `included_in_bundle` conceden capacidades por el paquete (`capsOf`). |
| **Copilot: consumo limitado y medido por empresa** (límite sin decidir) | Inclusión Enterprise `approved` con «consumo por encima del límite» excluido (`policy.ts:74`). Capacidades `copilot-basic` y `copilot-advanced` en `planned` (`capabilities.ts:78, 97`). Sin meters en `server/stripe`. | `variableCosts` solo informativo. Ningún pedido lleva importe de consumo. | Ninguno hasta decidir. Después: Stripe Billing Meters o factura aparte, con un circuito propio. | Métrica de consumo por empresa (no existe) y límite configurable con valor `null` = **sin decidir** (bloquear o avisar es decisión del propietario). |
| **Implantación con contratación y presupuesto separados** | `implementation[].amountCents` siempre `null`. Un producto `service` no tiene Price recurrente y `checkoutLines.ts:81-82` lo bloquea como `unavailable`. | Pedido o documento propio, fuera de `contractAmountCents` y `firstPeriodNetCents`. La cuota recurrente **no** debe bloquearse por llevar implantación: hay que sacarla de las líneas del pedido de suscripción. | Factura única aparte (no en la suscripción) cuando haya importe aprobado. | Sin capacidades. |
| **Ampliaciones de Enterprise por presupuesto** | `quoteOnRequestPlans: ["enterprise"]` → líneas `on_quote`. | Rechazar en `purchases.plan()` las ampliaciones de un plan en `quoteOnRequestPlans`. Hoy calcularía usuarios o sedes a precio de catálogo **si** la empresa tuviera suscripción en Stripe (latente: Enterprise no pasa por Checkout). | Ninguno mientras no haya una tarifa aprobada. | Cupos del contrato (instantánea). |

---

## 5. Criterios de aceptación y encendido

### Criterios

| | Criterio |
|---|---|
| C1 | Con política **neutra**, orquestador, compras, contratos, Checkout y partidas diferidas dan **exactamente** los mismos importes y Prices que hoy. Barrido de `commercialCatalog.test.ts`, ampliado a `stepQuote`, `planCheckoutLines`, `DeferredItemsService.attach` y `purchases.plan`. |
| C2 | Con política publicada no neutra, en cada caso de prueba: `pricingHash` del pedido = el de `/web/quote` = el recalculado al cobrar. La suma de Prices de Stripe (menos cupones) = `contractAmountCents`, y la primera factura = `firstPeriodNetCents`. |
| C3 | Ningún pedido con `pendingRules` o líneas `on_quote` llega a `contracted` por autoservicio. |
| C4 | Las licencias = las capacidades de la instantánea. |
| C5 | Sin `stripe.items_drift` tras alta, compra, subida y bajada con inclusiones. |
| C6 (nuevo) | **Prorrateo**: en el 100 % de las pruebas, el subtotal y el total facturados en una compra = los aceptados, o bien `conflict` sin cobro. `stripe.change_amount_mismatch` = 0 en sandbox. |
| C7 (nuevo) | Partidas diferidas: la activación nunca vuelve a cotizar; un precio republicado entre el pago y la activación no deja una suscripción sin partidas mensuales. |
| C8 (nuevo) | Lo que muestra el CRM (`stripeChargeSummary`) = la primera factura y las renovaciones de Stripe. |

### Pruebas mínimas (sandbox y BD de pruebas)

- Las pruebas 1-6 y 8-10 de la v1 siguen.
- La 7 se sustituye por: plan anual con excedente de People → anual si hay tarifa anual; si no, mensual diferido. Primera factura = `firstPeriodNetCents`.
- Se añaden S1-S5 (§2.4) y la comprobación pendiente de #375: fecha del primer cobro de una partida mensual diferida (`SUSCRIPCIONES_COBRO_STRIPE.md:95`).

### Procedimiento de encendido

1. **Antes y con independencia del interruptor**, fusionar:
   - P0-1 (prorrateo) en dos fases: servidor tolerante → CRM y panel → token obligatorio;
   - su migración, en un commit aislado.

   Verificar el despliegue de cada paso.
2. Fusionar el resto de P0 y P1 con el interruptor **apagado**. C1 en CI y en `circuitoComercial.e2e.mysql.test.ts`.
3. Aprobar en los borradores solo las reglas decididas. `GET /web/commercial/review` sin bloqueos.
4. Cambio aislado: `commercialPolicy: true` en `api.ts:515-527`. Variable propuesta: `CP_COMMERCIAL_POLICY`, que hoy **no existe**.
5. **Volver a publicar** planes y paquetes con reglas (`service.ts:265, 386`).
6. Sandbox: pruebas, S1-S5 y C6-C8. Vigilar `items_drift`, `deferred_items_*`, `change_amount_mismatch` y los `conflict`.
7. Marcha atrás: interruptor apagado **y** republicación (R-E).

---

## 6. Riesgos actuales (interruptor apagado), de más a menos grave

- **R-A (alta): el prorrateo cobrado puede no ser el aceptado.**
  - Sin `proration_date` ni cotejo (`gateway.ts:557-580`; `purchases.ts:282-288, 339-345`; `events.ts:490-495`).
  - Hay tres puertas abiertas mientras `CP_COMMERCE_PURCHASES_ENABLED` esté activo: panel del Core, CRM #70 (un operador acepta con la tarjeta del cliente) y API.
  - Las diferencias habituales son de céntimos. No hay cota ante renovación, impuesto, saldo o descuento.
- **R-B (alta): partidas diferidas que pueden quedar sin cobrarse.**
  - `attach` vuelve a cotizar al activar (`deferredItems.ts:55, 64`), y `planCheckoutLines` exige que coincida con `order.quote` (`checkoutLines.ts:109-116`). Si se publica un precio entre el pago y la activación, termina `blocked`.
  - El pedido queda activo con derechos, pero Stripe **no** cobrará las partidas mensuales desde el segundo mes. Solo queda la alerta `stripe.deferred_items_blocked` (`alerts.ts:37-38`).
  - Mientras siga `pending`, tampoco se cobran.
- **R-C (media-alta): comportamiento de Stripe sin verificar en sandbox.**
  - Fecha del primer cobro de una partida mensual añadida con `proration_behavior: none` a una suscripción anual `flexible` (`SUSCRIPCIONES_COBRO_STRIPE.md:95`). Puede duplicar el primer mes o desalinear el ciclo.
  - El doble prorratea por el periodo de la suscripción, no por el de la partida (`testing.ts:133-136`), así que las pruebas actuales no lo detectarían.
- **R-D (media): contrato y suscripción interna con otra cotización.**
  - `stepContract` vuelve a cotizar (`service.ts:404-405`) y `specs()`/`priceFor` toman el precio aprobado al suscribir (`service.ts:494-511`).
  - Una publicación entre la cotización y el webhook deja la suscripción interna con un importe distinto del cobrado.
- **R-E (media, latente): encender o apagar el interruptor.**
  - Lo publicado queda congelado (`service.ts:265, 386`).
  - Con reglas publicadas, el CRM (#68/#70) mostraría `quoteResponse` (`/web/quote`) y cobraría `quote()`. Es la misma divergencia de la v1 (R3), ahora visible en el formulario «Contratar con cobro en Stripe».
- **R-F (media, latente): portal con `items: []`** (`service.ts:755`). Inactivo mientras el portal no tenga `subscription_update`.
- **R-G (baja): dos medidas distintas del importe.** La vista previa devuelve `amount_due` (`gateway.ts:577`, neto del saldo del cliente), y el cambio guarda `inv.total` (`purchases.ts:362`). Con un saldo a favor no coinciden. §2 compara las dos.
- **R-H (baja): drift solo de familias de producto.** `contractedItems` (`api.ts:1660`) no incluye las ampliaciones por cantidad (`addon`), así que un descuadre de usuarios o sedes en Stripe no se avisa por `items_drift`. Las compras sí lo detectan con `conflict` (`purchases.ts:254`).

### Preguntas para el propietario (actualizadas)

1. ¿Se ratifica la suscripción única `flexible` de #375 como decisión D11?
2. TTL de la vista previa de prorrateo (propuesta: 15 minutos) y si un operador del CRM puede aceptar en nombre del cliente sin aviso a este.
3. ¿Variable `CP_PURCHASE_QUOTE_SECRET` (HMAC) o una tabla de vistas previas?
4. Las preguntas 2-7 de la v1 siguen abiertas: absorción con crédito, cupón de paquete, tope de People, venta de lo que deja de incluirse, `CP_COMMERCIAL_POLICY` y cupos de Enterprise.
5. Copilot: límite por empresa y qué ocurre al alcanzarlo (bloquear, avisar o cobrar).
