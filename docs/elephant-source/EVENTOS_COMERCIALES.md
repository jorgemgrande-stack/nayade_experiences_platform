# Registro central de eventos comerciales

Primer PR del roadmap de trazabilidad (`ROADMAP_TRAZABILIDAD_COMERCIAL.md`, sección 9, PR 2 y 3).

| Pieza | Dónde está |
|---|---|
| Código | `server/commercialEvents/` |
| Migración | `db/crm/migrations/0014_commercial_events.sql` |
| Lectura | `GET /cp/v1/commercial-events` |

El registro **no envía nada ni decide nada**. Deja constancia, una sola vez, de cada hecho del circuito comercial, en la misma transacción que el cambio de estado que lo produce. Sobre él se construirán:
- la traza de una operación;
- el motor de transiciones temporales;
- el despachador de notificaciones (que reutilizará la cola de correo existente; no hay una segunda cola).

## 1. Qué se registra

| Familia | Tipos | Lo escribe |
|---|---|---|
| Prueba | `trial.requested`, `trial.verified`, `trial.started`, `trial.provisioning_failed`, `trial.extended`, `trial.expired`, `trial.suspended`, `trial.reactivated`, `trial.converted`, `trial.rejected`, `trial.cancelled` | `MysqlTrialStore` (insert, transition) |
| Contratación | `order.created`, `order.quoted`, `order.contracted`, `order.confirmed`, `order.subscribed`, `order.licensed`, `order.activated`, `order.rejected`, `order.superseded` | `MysqlOrderStore` (insert, transition) |
| Impago y ciclo de vida del pedido | `order.past_due`, `order.suspended`, `order.recovered`, `order.cancel_scheduled`, `order.reactivated`, `order.cancelled` | ídem |
| Cobro (alta o cambio) | `payment.requested`, `payment.succeeded`, `payment.failed` | `MysqlOrderStore` (insertPayment, paymentEvent) |
| Renovación | `renewal.requested`, `renewal.paid`, `renewal.failed` | ídem, con pagos de `purpose = renewal` |
| Suscripción | `subscription.created`, `subscription.plan_changed`, `subscription.module_added`, `subscription.module_removed`, `subscription.interval_change_scheduled`, `subscription.cancel_scheduled`, `subscription.cancel_undone`, `subscription.reactivated`, `subscription.trial_ended`, `subscription.trial_converted`, `subscription.renewed`, `subscription.canceled` | `MysqlSubscriptionStore` (create, mutate) |
| Reembolso y disputa | `refund.recorded`, `coverage.lost`, `coverage.restored`, `dispute.status_changed` | `MysqlStripeStore.upsertAdjustment` |

**Cambio de plan y compra de módulos.**
- La compra o el cambio quedan en `order.activated` de un pedido `kind = change`. Su `data` lleva el plan, la periodicidad y las claves de los módulos (`items`, con `x<cantidad>` si la cantidad no es 1).
- El efecto real sobre la suscripción queda en `subscription.plan_changed`, `subscription.module_added` y `subscription.module_removed`.
- La vía directa del operador (`POST /subscriptions/:id/items`) también deja `subscription.module_added`.

**Lo que no produce evento:**
- las anotaciones sin cambio de estado (paso fallido, contrato redactado, aviso encolado, reenvío del enlace de verificación);
- la resolución manual de una retención (`resolveHolds`), que queda pendiente.

## 2. Forma de un evento

| Campo | Contenido |
|---|---|
| `event_key` | Clave única del hecho (idempotencia). Ver la sección 3 |
| `type`, `schema_version` | Tipo del catálogo y versión del esquema (1) |
| `environment` | `test` o `live`: el modo comercial del proceso (`CP_STRIPE_MODE=live` → `live`; si no, `test`) |
| `source` | `system`, `operator`, `customer` o `stripe` |
| `actor` | Quién lo hizo, tal como lo registra el almacén |
| `causation_id` | Causa externa, p. ej. `stripe:evt_…` para todo lo que ocurre al procesar un evento firmado de Stripe |
| `correlation_id` | La operación: `order:N`, `trial:N` o `subscription:N` |
| `aggregate_type`, `aggregate_id`, `aggregate_version` | Qué cambió y su versión tras el cambio |
| `tenant_id`, `company_id`, `order_id`, `subscription_id`, `trial_id`, `payment_id` | Identificadores para filtrar y unir |
| `stripe_ref` | Objeto de Stripe: `inv:in_…` en pagos, `ch_…` en cargos |
| `from_state`, `to_state` | Transición |
| `data_json` | Datos del hecho, limpios |
| `occurred_at` | Cuándo ocurrió |
| `dispatch_status` | Para el futuro despachador (`pending` por defecto) |

**Sin datos personales.** `data` pasa por `cleanData`:
- descarta claves con aspecto de dato personal (correo, nombre, teléfono, dirección, NIF, token, IP…);
- descarta todo texto que no sea un código (frases con espacios, correos);
- lo mismo con los motivos escritos por personas.

Las pruebas comprueban que no se cuela el correo, el nombre de contacto ni el de la empresa.

## 3. Garantías

**Atomicidad (transactional outbox).** Cada almacén llama a `CommercialEventSink.append(tx, …)` con **su** conexión, dentro de **su** transacción.
- Si el registro falla, el cambio de estado se deshace, y al revés.
- Probado contra MySQL: un registro que falla deja el pedido, su historial y sus pagos intactos.

**Idempotencia.** `uq_commercial_event_key` con `ON DUPLICATE KEY UPDATE id = id`: un hecho ya registrado no añade fila ni deshace la transacción que lo repite. Formato de las claves:

| Agregado | Clave |
|---|---|
| Pedido, prueba y suscripción | `<agregado>:<id>:v<versión>:<acción>`. La versión ya es única por la versión optimista de cada almacén |
| Pago | `payment:<id>:<estado>`: un estado alcanzado una vez |
| Cargo | `charge:<id>:refunded:<importe acumulado>`, `charge:<id>:dispute:<estado>`, y `coverage_lost` / `coverage_restored` con el instante, solo en la transición real |

**Reintentos y duplicados de Stripe.** No producen hechos nuevos, por tres capas:
1. `stripe_events` procesa cada evento una vez.
2. `commercial_payment_events` aplica cada evento del proveedor una vez.
3. Las transiciones son condicionales (versión esperada y `FOR UPDATE`), y la clave del registro es la última barrera.

Probado con cinco entregas simultáneas del mismo pago: un solo `payment.succeeded`, un solo `order.activated` y ninguna clave repetida.

**Fuera de orden.**
- El procesador de Stripe ya relee el objeto en la API y aplica su estado actual, nunca el del evento.
- El registro guarda lo que de verdad cambió, con `aggregate_version` para ordenar los hechos de cada agregado y el `id` de fila como orden global de escritura.
- Un consumidor ordena por `(aggregate_type, aggregate_id, aggregate_version)` y detecta huecos.

**Separación de tenants.**
- Cada fila lleva `tenant_id` y `company_id`.
- La API de lectura exige acotar por operación, empresa, tenant, pedido, suscripción o prueba: no hay listado global.

**Separación de entornos.**
- Cada fila lleva `environment` (`ENUM('test','live')`), y las lecturas solo ven el propio.
- Al arrancar, si la BD tiene filas del otro entorno, el registro **no se monta** (`environment_mismatch` en el log `CommercialEvents`). Es la misma idea que el prefijo de entorno guardado de Stripe.

**Compatibilidad.**
- El registro es un parámetro opcional de los cuatro almacenes MySQL y de sus versiones en memoria.
- Sin la migración 0014 no se monta (`migration_0014_missing`) y todo funciona exactamente igual que antes.
- No cambia ninguna ruta existente, ninguna respuesta ni ningún correo. `orderNotifier` sigue igual.

## 4. Migración y plan de recuperación

`0014_commercial_events` es aditiva: una tabla nueva, sin tocar ninguna existente. El verificador de migraciones no admite huecos, así que comparte número con `0014_stripe_buyer_profiles` (PR #153) y precede a `0015` (PR #157), ambos abiertos: el que se fusione después se renumera antes de aplicarse en ninguna BD (ninguna de las tres está aplicada todavía).

**Simulación** (dry-run por defecto, no escribe):

```bash
pnpm exec tsx scripts/db/migrate.ts verify --dir db/crm/migrations
MIGRATE_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/db/migrate.ts status --dir db/crm/migrations
MIGRATE_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations --to 0014
```

**Orden de despliegue:**
1. Aplicar la migración (`up … --to 0014 --apply --confirm-database <bd>`), como paso explícito y nunca al arrancar.
2. Desplegar el código.

Al revés también es seguro: el código sin la tabla no registra nada y lo indica en el log.

**Recuperación:**

| Caso | Qué hacer |
|---|---|
| Fallo del registro en producción | Revertir el despliegue del código; la tabla puede quedarse |
| Quitar la tabla | `down --steps 1` (`0014_commercial_events.down.sql`). Solo se pierde el registro de eventos; pedidos, pagos, pruebas, suscripciones, ajustes y sus historiales propios siguen siendo la fuente de verdad |
| Volver a crearla | `up`. El registro empieza vacío desde ese momento. No hay relleno retroactivo: los historiales propios conservan el pasado |

Probado contra MySQL: ida, vuelta (los datos de negocio siguen), sin tabla el registro no se monta, otra vez ida.

## 5. Lectura

```
GET /cp/v1/commercial-events?orderId=12
GET /cp/v1/commercial-events?correlationId=trial:4&types=trial.started,trial.converted
GET /cp/v1/commercial-events?tenantId=t1-abeto&afterId=500&limit=200
```

- Requiere el ámbito `ops:read`.
- Exige al menos un filtro de operación, empresa o tenant.
- Pagina hacia delante con `afterId`; `limit` vale como mucho 1000.

## 6. Contrato para las otras ventanas

Las ventanas 1 y 3 **no** escriben en esta tabla desde sus módulos. Cuando necesiten notificar, emitirán sus eventos con este mismo contrato (`CommercialEventDraft`: clave idempotente, tipo, agregado y versión, correlación, identificadores, transición y `data` sin datos personales), en la transacción de su propio cambio y a una tabla con la misma forma, o a esta a través de un `CommercialEventSink` que les pase el plano de control.

Tipos que se esperan de ellas (ver el roadmap, sección 5):

| Ventana | Tipos | Origen actual |
|---|---|---|
| V1 | `ticket.created`, `ticket.comment_added{visibility}`, `ticket.status_changed`, `ticket.assigned` | `support_ticket_events` |
| V3 | `security.*` | `cp_operator_events` |
| V3 | `tenant.status_changed` desglosado | `tenant_events` |
| V3 | `support.granted` / `support.revoked` / `support.session_started` | — |

Este PR no modifica ninguno de esos módulos.

## 7. Lo que queda para los siguientes PR

| Pieza | Qué hará |
|---|---|
| Motor de transiciones temporales (`feat/transiciones-temporales`) | Consume el estado (no el registro) para vencer pruebas, gracias y cancelaciones programadas. Escribe sus hechos por los mismos almacenes, así que quedan registrados sin código adicional |
| Despachador de notificaciones | Lee `dispatch_status = pending`, aplica el catálogo `es.*` y encola en `mail_outbox`. `MAIL_MODE` sigue en `off` |
| Traza unificada | `GET /trace/:correlationId`, uniendo las correlaciones de pedido, prueba y suscripción |
| Retención | Política de purga del registro, pendiente de la decisión de conservación (D-17) |
