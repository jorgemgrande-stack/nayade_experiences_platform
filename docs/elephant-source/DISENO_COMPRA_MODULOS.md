# Fase 2 — Compra de módulos y ampliaciones: diseño técnico

Estado: **propuesta para validar** antes de los cambios estructurales.

Base: `integration/elephant-source` en `47f169b`.

Decisiones comerciales de partida (propietario):
1. Se venden módulos y ampliaciones de usuarios, sedes y almacenamiento.
2. Una sola suscripción de Stripe con partidas diferenciadas.
3. Las ampliaciones a mitad de periodo se prorratean.
4. Un módulo solo se activa con cobro confirmado o con una excepción auditada.
5. Las bajas son efectivas al final del periodo pagado.
6. La compra empieza en el panel del cliente. El Portal hace lo compatible y el operador, las excepciones.
7. La factura detalla módulo, cantidad, periodo, impuestos y abonos.

Tras cancelar: **30 días en solo lectura con exportación** y sin borrado.

---

## 1. Lo que ya existe (revisado, sin repetir auditorías)

| Pieza | Estado | Dónde |
|---|---|---|
| Catálogo | Hay 4 ampliaciones (`addon-user-essential` 6 €, `addon-user-business` 5 €, `addon-site-business` 12 €, `addon-storage-10gb` 5 €), **todas `on_request` y solo con precio mensual**. Hay unos 40 módulos Net y Connect, **ninguno `available`** (todos `coming_soon` u `on_request`) y solo con precio mensual. Los planes tienen precio mensual y anual | `server/catalog/elephantSourceV1.ts` |
| Cotizador | Calcula módulos (`items`) y ampliaciones por cantidad (`users`, `sites`, `storageGb` → unidades = ⌈exceso / paso⌉). Las ampliaciones solo con precio mensual | `server/catalog/quote.ts` |
| Partidas de suscripción | Instantánea inmutable con `quantity`, `priceKind`, `effectiveFrom` y `effectiveTo`. `addItem` (rechaza un producto ya contratado) y `removeItem` a fin de periodo. **No hay cambio de cantidad** | `server/subscriptions/*` |
| Pedido de cambio | `specs()` solo convierte `request.items`: **las ampliaciones por cantidad se cotizan, pero no se convierten en partida** | `server/orchestrator/service.ts` |
| Licencias | Las capacidades de cada módulo salen de sus partidas (`licensing.apply`) | `server/licensing/service.ts` |
| Límites | Sedes y entidades fiscales: plan + partidas (`organization.limits`). **Usuarios: el Core solo mira el plan** (`planSeats`); no ve los adicionales. **Almacenamiento: sin punto de control** (los cupos ERM son de consumo, no de capacidad) | `server/organization/service.ts`, `server/planSeats.ts`, `server/_core/erm` |
| Stripe | Solo los 4 precios de los planes (`SELF_SERVICE_PLANS`). Checkout con **una partida** de cantidad 1. Rechaza `change` y complementos. La pasarela no actualiza partidas. El procesador exige que los precios sean los del Checkout del pedido o un cambio de plan del Portal (#158) | `server/stripe/*` |
| Facturas | Una fila por factura cobrada (base, impuesto, total, reembolsado) y documento fiscal pendiente. **Sin líneas** | `stripe_invoices`, `fiscal_documents` (CRM 0016) |
| Fin de la suscripción | Vía interna: licencias `cancelled` (sin lectura). Stripe: `read_only`. La empresa queda `suspended` (#169) | `orchestrator.renew` / `applyExternalBilling` |

---

## 2. Modelo de partidas comerciales

**Una partida es una línea de la suscripción interna**, inmutable y con fechas de vigencia, como hoy, ampliada así:

| Campo nuevo | Para qué |
|---|---|
| `line_kind` | `plan` / `module` / `quantity` / `service` (deriva de la familia; explícito para la factura y para Stripe) |
| `metric` | Solo en `quantity`: `users` / `sites` / `storage_gb` |
| `stripe_item_ref` | Partida de la suscripción de Stripe (`si_…`), en `stripe_subscription_items` |

**Cambio de cantidad** (`SubscriptionService.changeQuantity`, nuevo):
- **Subida:** cierra la partida vigente (`effectiveTo = ahora`) y abre otra con la cantidad nueva (`effectiveFrom = ahora`), en la misma transacción y con su evento `quantity_changed`.
- **Bajada:** programa la partida nueva desde el fin del periodo. Nunca se acorta lo pagado.

**Tabla nueva** `stripe_subscription_items` (CRM 0017): `stripe_item_id`, `stripe_subscription_id`, `subscription_item_id`, `stripe_price_id`, `quantity`, `livemode` y `synced_at`. Es la correspondencia exacta, por partida, con Stripe.

---

## 3. Precios en Stripe

- **Un Price por precio aprobado** (`web_prices`), como los planes: `lookup_key` `es:<producto>:<kind>:<moneda>:v<id>`.
- **Una sola suscripción exige que todas sus partidas tengan la misma periodicidad.** Un cliente anual necesita precios anuales de cada módulo y ampliación, y hoy no existen.
- El catálogo de Stripe sigue siendo de **solo lectura para el servicio**: `planCatalogWrites` lista los Products y Prices nuevos y los aplica una persona, como hasta ahora. `syncCatalog` los enlaza.

---

## 4. Circuito de compra (de la selección al cobro)

```
panel del cliente ──► POST /cp/v1/commerce/purchases  (desde el servidor del Core, con la empresa de la sesión)
                         │  1. presupuesto: módulo o cantidad + prorrateo (vista previa de Stripe o cálculo interno)
                         │  2. aceptación del cliente (versión de condiciones), pedido «change» idempotente
                         ▼
            ┌─────────── cobro ───────────┐
   Stripe   │ subscriptions.update con     │   Excepción   POST /orders/:id/approve (categoría, motivo, referencia;
            │ proration_behavior=always_    │               orders:approve). Igual que hoy, auditada
            │ invoice y payment_behavior=   │
            │ pending_if_incomplete         │
            └──────────────┬───────────────┘
                           ▼
   invoice.paid (firmado y releído) ─► el procesador comprueba que las líneas de la factura son las del pedido
                           ▼
   pago verificado «change» ─► applyChange (partidas) ─► licensing.apply (capacidades y límites) ─► activo
```

**Garantías:**
- **Sin activación sin cobro:** con `pending_if_incomplete`, Stripe solo aplica el cambio de partidas si la factura de prorrateo se cobra. Si no, la suscripción no cambia y el pedido sigue esperando.
- **Sin doble cobro:**
  - la llamada a Stripe lleva la clave `order:<id>:v<versión>`;
  - hay un solo cambio en curso por suscripción (ya garantizado en la BD);
  - cada pago se registra una vez por factura (`stripe:inv:<id>`).
- **Aislamiento:** la empresa sale de la sesión del Core en el servidor, nunca del cuerpo de la petición. El plano de control comprueba que el pedido, la suscripción y el cliente de Stripe son de esa empresa (igual que hoy con `es_order_id` y el cliente).
- **Idempotencia:** clave del pedido y clave de la llamada a Stripe. Repetir la compra devuelve el mismo pedido.

**Módulos `on_request`** solo por el operador (excepción tipificada). **`coming_soon`** no se venden.

---

## 5. Prorrateos

- **Stripe (test y live):** cálculo de Stripe por segundos, facturado al momento (`always_invoice`). La vista previa al cliente usa `invoices.createPreview` con los mismos parámetros.
- **Sin Stripe (pagos simulados, pruebas):** cálculo interno idéntico: `importe × segundos restantes / segundos del periodo`, redondeado al céntimo. Tiene pruebas contra casos de Stripe documentados.
- **Bajadas y bajas:** sin prorrateo ni abono (`proration_behavior=none`). Se aplican en Stripe en el momento, pero el cambio solo se nota en la **siguiente** factura. Internamente, la partida sigue vigente hasta el fin del periodo, así que el cliente conserva lo pagado.

---

## 6. Activación y baja de derechos

- **Módulos:** capacidades por partida, como hoy. La baja programada pone `validUntil` al fin del periodo. El motor temporal (#164) las da de baja a su hora (`licence_sync`).
- **Cantidades:** canal nuevo del plano de control a la empresa. Tabla del registro `tenant_entitlement_limits` (`tenant_id`, `metric`, `limit`, `source`, `valid_until`), escrita por `licensing.apply` (plan + partidas `quantity`). Aplicación en el Core:
  - **usuarios:** `planSeats` toma el límite de ahí si existe; si no, el del plan, como hoy;
  - **almacenamiento:** comprobación de capacidad en la subida de ficheros (hoy no existe);
  - **sedes:** `organization.limits`, como hoy.
- **Bajar por debajo del uso:** no se permite bajar usuarios o sedes por debajo de lo que la empresa ya usa (409 con el uso actual). Nunca se desactivan usuarios ni se borran ficheros por una bajada.

---

## 7. Renovaciones

- **Stripe:** la factura de ciclo incluye todas las partidas vigentes, y `invoice.paid` (ciclo) registra la renovación como hoy. El cambio nuevo es que se aplican las bajas programadas cuyo fin coincide.
- **Interna:** `applyRenewals`, como hoy; ya respeta `effectiveFrom` y `effectiveTo`.
- **Conciliación diaria** (solo lectura en Stripe): partidas internas vigentes frente a partidas de Stripe (precio y cantidad). Una diferencia es una alerta `stripe.items_drift` y nunca se corrige sola en live.

---

## 8. Facturación, reembolsos y abonos

- **Líneas de factura:** tabla `stripe_invoice_lines` (CRM 0018) con factura, partida, producto, cantidad, inicio y fin del periodo, base, impuesto y si es prorrateo. Se rellena al registrar la factura cobrada (#157), releyendo las líneas en Stripe. El documento fiscal (cola de #157) incluye ya las líneas.
- **Reembolsos:** como hoy por cargo (#157 crea la rectificativa pendiente, con impuesto proporcional). Lo nuevo es la rectificativa **por líneas** cuando el reembolso corresponde a líneas concretas (nota de crédito de Stripe con líneas).
- **Abono por baja:** no hay (decisión 5: la baja es a fin de periodo).
- **Stripe Tax y registros fiscales:** no se tocan. El impuesto de cada línea lo calcula Stripe y se contrasta con el esperado del escenario (#156).

---

## 9. Acceso tras cancelar: 30 días en solo lectura con exportación

| Momento | Licencias | Empresa (registro) |
|---|---|---|
| Fin del periodo pagado | `read_only`, con `validUntil = fin + 30 días`, **por los dos caminos** (interno y Stripe); hoy la vía interna deja `cancelled` | `suspended` (#169): panel sin escritura y web cerrada |
| Durante los 30 días | Lectura y **exportación** (ZIP con CSV y JSON por entidad, generado bajo petición del propietario, enlace firmado y caducable) | Igual |
| Día 30 | Licencias `cancelled`. El motor temporal señala `retention_review` (ya existe) | Sin cambio automático. Archivar o borrar sigue siendo manual, pendiente de validación legal |

La prueba e2e que hoy fija «sin lectura tras cancelar» se actualiza a la regla nueva, por decisión del propietario.

---

## 10. Eventos y trazabilidad

Tipos nuevos en el registro de eventos comerciales:

| Tipo | Cuándo |
|---|---|
| `purchase.requested` | Pedido de compra creado |
| `subscription.quantity_changed` | Cambio de cantidad, con antes y después |
| `subscription.module_removal_scheduled` | Baja de módulo programada |
| `entitlement.limit_changed` | Cambio de límite de usuarios, sedes o almacenamiento en el registro |
| `stripe.items_updated` | Cambio de partidas en Stripe, con la clave de la llamada |
| `invoice.lines_recorded` | Líneas de una factura registradas |
| `access.read_only_started` / `access.read_only_ended` | Inicio y fin de los 30 días de solo lectura |
| `export.requested` / `export.ready` | Exportación pedida y lista |

Todo con `correlationId` del pedido y `causationId` del evento de Stripe.

---

## 11. PR propuestos (en este orden; cada uno independiente, con pruebas y sin activar nada en live)

| # | PR | Migración | Depende de |
|---|---|---|---|
| 1 | **Solo lectura 30 días tras cancelar** (los dos caminos) y señal en el motor | — | — |
| 2 | **Modelo de partidas**: `line_kind`, `metric` y `changeQuantity` en las suscripciones; `specs()` convierte las ampliaciones por cantidad | CRM 0017 (columnas) | — |
| 3 | **Límites por cantidad hacia el Core**: `tenant_entitlement_limits`, `licensing.apply` los escribe, `planSeats` y la subida de ficheros los aplican | registro (nueva) | 2 |
| 4 | **Pasarela y catálogo de Stripe para partidas**: Prices de módulos y ampliaciones en `planCatalogWrites`, actualización de partidas en la pasarela, `stripe_subscription_items` y simulador | CRM 0018 | 2 |
| 5 | **Compra**: endpoint de compra (desde el servidor del Core), presupuesto con prorrateo, pedido `change` con partidas, cobro por `subscriptions.update` y verificación por factura | — | 2, 4 |
| 6 | **Bajas a fin de periodo y renovaciones** con partidas | — | 5 |
| 7 | **Líneas de factura, reembolsos por línea y conciliación** de partidas | CRM 0019 | 4, 5 |
| 8 | **Exportación** de datos en los 30 días | — | 1 |
| 9 | **E2E**: módulo → cobro (Stripe simulado) → activación → ampliación con prorrateo → renovación → bajada → cancelación → solo lectura → exportación | — | todos |

Ninguno aplica migraciones en production ni en live, ni escribe en Stripe live.

---

## 12. Decisiones que necesito antes de los PR 4–5

| # | Decisión | Por qué | Propuesta |
|---|---|---|---|
| A | **Precio anual de módulos y ampliaciones** | Stripe exige la misma periodicidad en todas las partidas de una suscripción; hoy solo hay precio mensual | Precio anual = 10 × mensual, como el descuento implícito de los planes (Essential: 279 € frente a 348 €). Mientras no se apruebe, los clientes anuales compran módulos por excepción del operador |
| B | **Qué módulos y ampliaciones pasan a `available`** (venta libre desde el panel) | Hoy ninguno lo está | Empezar por las 4 ampliaciones y por los módulos Connect con `tech: partial` que ya funcionan (People, Tax, Partners, POS, Deals, Finance Sync, Voice), si producto lo confirma |
| C | **Bajar por debajo del uso** | Usuarios o sedes ya en uso | Rechazar la bajada (409 con el uso actual). Nunca desactivar ni borrar |
| D | **Formato y alcance de la exportación** | Qué datos y en qué formato | ZIP con CSV y JSON de clientes, reservas, facturas, productos y ficheros. Enlace firmado de 24 h. Solo el propietario |

Mientras se deciden A y B, los PR 1 a 3 se pueden hacer sin depender de ellas.
