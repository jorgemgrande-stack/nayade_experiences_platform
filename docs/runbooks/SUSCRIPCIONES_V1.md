# Suscripciones v1 y facturación en modo sombra

**Estado:** implementado en el plano de control (no desplegado). **Modo único: sombra.** Calcula, registra y compara. **Nunca** cobra, emite facturas fiscales ni concede o retira licencias.

**Diseño:** `docs/architecture/SUSCRIPCIONES_PRECIOS_CONTRATADOS.md` (fase 5).

## 1. Qué hay

| Pieza | Dónde | Qué hace |
|---|---|---|
| Migración CRM 0006 | `db/crm/migrations/0006_subscriptions.sql` | 7 tablas aditivas en la BD del CRM: suscripciones, partidas, historial, consumos, facturas sombra, cobros simulados y webhooks simulados |
| Modelo y cálculo | `server/subscriptions/{types,pricing}.ts` | Periodos en UTC con día de anclaje, importes en céntimos, impuesto incluido o añadido, descuentos, prorrateo y huella del cálculo |
| Persistencia | `server/subscriptions/store.ts` | Memoria y MySQL. Toda mutación es **una transacción** con bloqueo y versión |
| Operaciones | `server/subscriptions/service.ts` | Alta, cambio de plan, extensiones, módulos sectoriales, servicios, consumos, cancelación programada, reactivación, cambio de periodicidad y renovaciones (a demanda) |
| Facturación sombra | `server/subscriptions/shadow.ts` | Renovación, prorrateos, servicios y consumos del periodo vigente; idempotente; comparación con el contrato |
| Cobros simulados | `server/subscriptions/shadowPayments.ts` | Máquina de estados de cobro con un **proveedor simulado** (sin red) y webhooks idempotentes. **No se expone en la API.** |
| API | `server/subscriptions/api.ts` → `/cp/v1/subscriptions/*` | Ámbitos `subscriptions:read` y `subscriptions:write` |

**Reutiliza lo existente sin duplicarlo:**
- precios: `web_prices` del catálogo comercial (#77);
- empresas y contratos: CRM;
- licencias: solo un adaptador de **lectura** (`licencePlan`), que indica qué corresponderá cuando se autorice enlazarlo.

El motor de facturación v1 (`server/_core/billing`) **no se toca**.

## 2. Garantías y dónde se comprueban

| Garantía | Mecanismo | Prueba |
|---|---|---|
| Un cambio del catálogo no altera contratos anteriores | Cada partida guarda su instantánea; el importe nunca se actualiza; `price_id` con FK (el precio aceptado no se puede borrar) | `subscriptions.test.ts` (instantánea contractual) y `subscriptions.mysql.test.ts` (cambio retroactivo) |
| Solo se acepta lo publicado y aprobado | Producto publicado, precio `approved`, tipo coherente con la familia y la periodicidad, misma moneda | alta y validaciones |
| Dependencias y compatibilidad | Las del catálogo, en cada cambio | alta y extensiones |
| Dos operadores no se pisan | `expectedVersion` y `SELECT … FOR UPDATE`; el segundo recibe `409 version_conflict` | concurrencia (memoria y MySQL) |
| Todo o nada | Partidas, suscripción, versión y evento en la misma transacción | «un fallo a mitad…» (MySQL) |
| Una suscripción viva por contrato | Columna generada + `UNIQUE` | MySQL |
| Una factura sombra por periodo y concepto | `UNIQUE (subscription_id, kind, period_start, dedupe_key)` | 6 simulaciones simultáneas → 1 factura |
| Mismo periodo → mismo resultado | Huella de las entradas (`input_hash`); si no coincide se informa `drift` | idempotencia |
| Consumos sin duplicados | `UNIQUE (idempotency_key)` | consumos |
| Sin doble cobro tras un error de red | Clave por intento lógico; un resultado incierto se **consulta** con la misma clave | cobros simulados |
| `processing` no es pago ni fallo | Estado `processing`/`unknown`; la factura sigue `pending` | cobros simulados |
| Fallido ≠ pagado | `paid` solo con `succeeded` confirmado | cobros simulados |
| Webhook idempotente | El evento se marca procesado en la transacción de su efecto; si el efecto falla, el evento queda `failed` y se reprocesa | MySQL |
| Sin cobros tras cancelar | Una suscripción cancelada no se cobra; un pago tardío pasa a `review` y no la reactiva | cobros simulados |

## 3. Reglas de negocio aplicadas

Son decisiones por defecto, pendientes de confirmar (D-S3):

- **Subida de plan:** inmediata, con prorrateo de la diferencia (se descuenta la parte no consumida del plan anterior).
- **Bajada de plan y bajas de extensiones:** a fin de periodo y sin abonos.
- **Cancelación:** programada a fin de periodo, con motivo obligatorio. Al aplicarse se cierran las partidas.
- **Reactivación:**
  - con la cancelación solo programada, la deshace;
  - con la suscripción ya cancelada, abre un periodo nuevo con **las mismas condiciones contratadas** (no relee el catálogo).
- **Cambio de periodicidad:** a la próxima renovación, con un precio aprobado del nuevo tipo para cada partida recurrente.
- **Prueba:** hasta 60 días. El periodo en prueba no se factura.
- **Consumos:** se calculan cuando el periodo ha terminado.
- **Renovaciones:** **no se programan solas**. Se aplican a demanda (`POST /:id/renewals`).

## 4. API (`/cp/v1/subscriptions`)

| Método y ruta | Ámbito | Descripción |
|---|---|---|
| `GET /` | read | listado (filtros `companyId`, `status`) |
| `GET /offer` | read | productos publicados con precios aprobados |
| `POST /` | write | alta |
| `GET /:id` | read | detalle: partidas, historial, facturas sombra, contrato y plan de licencias simulado |
| `GET /:id/preview` | read | cálculo del periodo sin registrar |
| `POST /:id/plan` | write | cambio de plan |
| `POST /:id/items` | write | añadir extensión, módulo, servicio o consumo |
| `POST /:id/items/:itemId/remove` | write | quitar |
| `POST /:id/cancel` | write | cancelación programada |
| `POST /:id/reactivate` | write | reactivar o deshacer una cancelación |
| `POST /:id/interval` | write | cambio de periodicidad |
| `POST /:id/usage` | write | registrar consumo (idempotente) |
| `POST /:id/renewals` | write | aplicar las renovaciones vencidas (simulación) |
| `POST /:id/shadow` | write | registrar la simulación del periodo vigente (idempotente) |

**No existe ninguna ruta de cobro.**

**Roles:**
- superadministrador y administrador: lectura y escritura;
- comercial y solo lectura: solo lectura;
- soporte: sin acceso.

## 5. Activación y reversión (cuando se autorice desplegar el plano de control)

- **Activar:**
  1. aplicar la CRM 0006 con el ejecutor: `migrate.ts up --dir db/crm/migrations --apply --confirm-database <bd>`, tras una copia de seguridad;
  2. arrancar el plano de control. El log muestra `{"ctx":"Subscriptions","enabled":true,"mode":"shadow"}`.

  Sin la 0006, el plano de control arranca igual y no monta las rutas (`reason: migration_0006_missing`).
- **Revertir:**
  - **Código:** retirar el commit; sin la ruta montada no se usan las tablas.
  - **Esquema:** `migrate.ts down --dir db/crm/migrations --steps 1 --apply --confirm-database <bd>` elimina las 7 tablas.
  - **Datos:** esa reversión **borra** las suscripciones, su historial y las simulaciones. Exportarlas antes si hacen falta, o restaurar la copia.
- **Producción de Náyade:** no le afecta. Estas tablas viven en la BD del CRM del plano de control, que no existe en producción.

## 6. Qué falta y requiere autorización

- **Cobro real:** conectar un proveedor real (D-S2), datos fiscales y numeración de facturas.
- **Licencias:** enlazar `licencePlan` con las licencias reales (D-S7).
- **Transición:** migrar clientes existentes. **No se migra a nadie automáticamente** (clases A–D del diseño).
- **Renovaciones automáticas:** programarlas (hoy, solo a demanda).
