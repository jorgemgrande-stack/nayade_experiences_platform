# Finanzas corporativas de Big Elephant

Contabilidad, gastos, proveedores, bancos y caja de **IRON ELEPHANT CONSULTING, S.L.** (la empresa que vende el SaaS).
Vive en el **plano de control** del Core (`server/finance/`) y se usa desde el CRM (admin.bigelephant.es). Los tenants
son clientes de Big Elephant y nada más: el módulo nunca lee ni escribe sus bases.

Estado: **fase 1A (libro contable)** implementada. Migración `db/crm/migrations/0033_finance_ledger.sql`.

## Arquitectura

| Pieza | Fichero | Qué hace |
|---|---|---|
| Tipos y errores | `server/finance/types.ts` | Modelo (cuentas, ejercicios, periodos, asientos, líneas) y `FinanceError` con su estado HTTP |
| Reglas puras | `server/finance/rules.ts` | Validación y cuadre, asiento de factura y rectificativa, reversión, regularización, cierre y apertura, sumas y saldos, mayor, CSV |
| Almacén | `server/finance/store.ts` | `MemoryFinanceStore` (pruebas) y `MysqlFinanceStore`; `finTablesReady` |
| Servicio | `server/finance/service.ts` | Orquesta, audita cada escritura y sincroniza las facturas emitidas (solo lectura de `server/invoicing`) |
| Permisos | `server/finance/permissions.ts` | Una constante por capacidad (provisional, ver abajo) |
| API | `server/finance/api.ts` | `/cp/v1/finance/*` con zod; errores `{ error, message }` en español |

Arranque (`server/controlPlane/main.ts`): se monta solo con CRM y con las tablas de 0033 (`finTablesReady`); si no, log
`{ ctx: "Finance", mounted: false, reason: "migration_0033_missing" }`. Datos solo en la BD del CRM, tablas `fin_*`.

## Reglas contables

- **Partida doble:** cada línea lleva debe XOR haber > 0 (también como `CHECK` en la BD); un asiento contabilizado
  cuadra (Σdebe = Σhaber > 0), sus cuentas existen, están activas y son imputables (las de mayor con subcuentas, como
  `572`, `470` o `475`, no lo son), y su fecha cae en un periodo abierto de un ejercicio abierto.
- **Importes** en céntimos (`BIGINT`), tipos en puntos básicos, fechas contables `DATE` «AAAA-MM-DD» (Europe/Madrid).
- **Numeración:** correlativa por ejercicio, asignada al **contabilizar** (los borradores no tienen número; un borrador
  anulado no consume número). La fila del ejercicio se bloquea (`SELECT … FOR UPDATE`) al contabilizar y al cerrar o
  reabrir periodos: no hay huecos ni carreras con un cierre.
- **Inmutabilidad:** un asiento contabilizado no se edita ni se borra; se corrige con su **reversión** (asiento espejo
  con debe y haber intercambiados, `origin = reversal`, enlazado en los dos sentidos) y, si hace falta, uno nuevo. Una
  reversión no se revierte, ni la regularización, el cierre o la apertura. Los borradores se **anulan** (`void`). No hay
  `DELETE`, `TRUNCATE` ni `DROP` en el código.
- **Factura emitida** (expedida en `server/invoicing`): Debe 430 total · Haber 705 base · Haber 477 cuota, una línea de
  705 y 477 por tipo de IVA (con `tax_rate_bp` y `tax_base_cents`) y la empresa del CRM como referencia en cada línea.
  La **rectificativa** (importes negativos) usa las mismas cuentas con debe y haber intercambiados. Diario VEN.
  **Fecha del asiento = fecha de expedición** (decisión: la rectificativa conserva la fecha de operación de la factura
  original, que puede estar en un periodo ya cerrado; la fecha de operación queda en la descripción del asiento).
- **Regularización y cierre** (`POST /finance/fiscal-years/:year/close`, idempotente): exige los doce periodos cerrados
  y ningún borrador; contabiliza el 31/12 la regularización (grupos 6 y 7 contra 129, diario REG) y el cierre (todas las
  cuentas con saldo, diario CIE), da de alta el ejercicio siguiente si no existe, contabiliza la apertura (espejo del
  cierre, 1/1, diario APE; exige enero abierto) y marca el ejercicio cerrado. Un ejercicio cerrado no reabre periodos.
- **Saldos de apertura iniciales:** nunca se inventan; se registran con un asiento manual en el diario APE.
- **Sumas y saldos y mayor:** solo asientos contabilizados. Mayor de una cuenta imputable = esa cuenta exacta (5720 Stripe
  no incluye los bancos 572000NN); de una cuenta de mayor = ella y sus subcuentas; con saldo anterior y acumulado.
  `excludeClosing=1` en sumas y saldos quita el asiento de cierre (muestra los saldos finales del ejercicio).
- **CSV:** separador «;», BOM UTF-8, CRLF, euros con coma decimal sin separador de miles, fechas DD/MM/AAAA y celdas de
  texto neutralizadas frente a fórmulas.
- **Plan contable:** se siembra un subconjunto del PGC de pymes (58 cuentas). Las subcuentas se crean por API y heredan
  el tipo de su cuenta de 3 dígitos (bancos `572000NN`; proveedores con 400/410 y el proveedor en la línea).

## Idempotencia

Cada asiento generado lleva `source_key` única (índice único en la BD): `invoice:<id>`, `reverse:<entryId>`,
`regularization:<año>`, `closing:<año>`, `opening:<año>` (y en 1B `expense:<id>`, `expense-payment:<id>`,
`bankmov:<id>`, `recurring:<tplId>:<AAAA-MM>`). Repetir una sincronización, una reversión o un cierre devuelve lo que ya
existe; dos peticiones simultáneas del mismo hecho crean un solo asiento (probado contra MySQL real).

`POST /finance/sync/invoices` → `{ posted, skipped, errors[], truncated }`: contabiliza las facturas expedidas
(`issued` y `rectified`) sin asiento; una factura en un periodo cerrado queda en `errors` y entra al reabrirlo. Lee como
mucho 500 por estado y pasada (`truncated: true` = repetir). Usa el mismo almacén (y entorno `livemode`) que la
facturación propia montada.

## Interfaz para las fases siguientes

```ts
// Asiento generado por un hecho económico, validado y contabilizado en la misma transacción; idempotente por source_key
svc.postGenerated(draft: EntryDraft, actor: FinanceActor): Promise<{ entry: Entry; created: boolean }>
// Reversión idempotente (reverse:<id>), fecha en periodo abierto y no anterior al original
svc.reverse(entryId: number, i: { date: string; reason: string }, actor: FinanceActor): Promise<{ entry: Entry; created: boolean }>
```

## API (fase 1A)

`GET /finance/accounts` · `POST /finance/accounts` · `PATCH /finance/accounts/:code` · `GET /finance/journals` ·
`GET|POST /finance/fiscal-years` · `POST /finance/periods/:year/:month/close|reopen` ·
`POST /finance/fiscal-years/:year/close` · `GET /finance/entries` (filtros `from to journal origin account status q`,
`limit offset sort dir`, respuesta `{ items, total }`) · `GET /finance/entries/:id` · `POST /finance/entries` ·
`POST /finance/entries/:id/post|void|reverse` · `GET /finance/ledger/:code` · `GET /finance/trial-balance` ·
`GET /finance/journal.csv` · `GET /finance/trial-balance.csv` · `POST /finance/sync/invoices` ·
`GET /finance/sync/status` · `GET /finance/summary`.

Errores: 400 `invalid_input`, 403 (`forbidden`, `operator_session_required`, `forbidden_role`), 404 `not_found`, 409
(`period_closed`, `invalid_state`, `conflict`), 422 (`unbalanced`, `invalid_account`), 503 `unavailable`.

`/finance/summary` en 1A: ingresos y gastos devengados del mes y del año, IVA repercutido del trimestre y resultado del
año, desde el libro (sin regularización, cierre ni apertura). Bancos, caja, acreedores pendientes e IVA soportado se
devuelven `null` hasta la fase 1B.

## Permisos (provisionales)

Añadir ámbitos nuevos toca ficheros críticos del plano de control, así que la fase 1 usa los existentes, centralizados
en `server/finance/permissions.ts`:

| Capacidad | Fase 1 |
|---|---|
| Consulta y exportaciones | `billing:read` |
| Gastos, proveedores, bancos, caja (1B) | `billing:write` |
| Contabilizar, revertir, asientos manuales, sincronizar facturas | `billing:write` + sesión de operador (nunca un token de servicio) |
| Cerrar/reabrir periodos y cerrar ejercicios, plan contable (alta de ejercicios: solo `billing:write`) | `billing:write` + sesión de operador + rol `admin` o `superadmin` |

Plan: en una PR protegida aparte, ámbitos propios (`finance:read`, `finance:write`, `finance:close`) en
`server/controlPlane/auth.ts` y `operatorRoles.ts`, cambiando solo las constantes de `permissions.ts`.

## Fases siguientes

- **1B · Operaciones (0034):** centros de coste, categorías de gasto, registro único de proveedores, gastos (facturas
  recibidas) con su asiento y pagos, documentos adjuntos en la BD, gastos recurrentes (interruptor nuevo
  `CP_FINANCE_RECURRING_ENABLED`, apagado), cuentas bancarias, importación de extractos (Norma 43, CaixaBank, CSV) con
  conciliación, caja; el resumen completa bancos, caja, acreedores e IVA soportado.
- **2 · Cobros y conciliación:** Stripe (cuenta 5720), cobros de facturas emitidas contra 430.
- **3 · Gestoría e impuestos:** libros registro, modelos (303, 111, 115, 390…), exportación para la gestoría.
- **4 · Análisis:** informes de resultados, tesorería y previsiones.
