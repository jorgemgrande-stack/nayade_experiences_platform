# Finanzas corporativas de Big Elephant

Contabilidad, gastos, proveedores, bancos y caja de **IRON ELEPHANT CONSULTING, S.L.** (la empresa que vende el SaaS).
Vive en el **plano de control** del Core (`server/finance/`) y se usa desde el CRM (admin.bigelephant.es). Los tenants
son clientes de Big Elephant y nada más: el módulo nunca lee ni escribe sus bases.

Estado: **fase 1A (libro contable)** y **fase 1B (operaciones)** implementadas. Migraciones
`db/crm/migrations/0033_finance_ledger.sql` y `db/crm/migrations/0034_finance_operations.sql`.

## Arquitectura

| Pieza | Fichero | Qué hace |
|---|---|---|
| Tipos y errores | `server/finance/types.ts` | Modelo del libro (cuentas, ejercicios, periodos, asientos, líneas) y `FinanceError` con su estado HTTP |
| Reglas puras | `server/finance/rules.ts` | Validación y cuadre, asiento de factura y rectificativa, reversión, regularización, cierre y apertura, sumas y saldos, mayor, CSV |
| Almacén | `server/finance/store.ts` | `MemoryFinanceStore` (pruebas) y `MysqlFinanceStore`; `finTablesReady` |
| Servicio | `server/finance/service.ts` | Orquesta, audita cada escritura y sincroniza las facturas emitidas (solo lectura de `server/invoicing`) |
| Permisos | `server/finance/permissions.ts` | Una constante por capacidad (provisional, ver abajo) |
| API | `server/finance/api.ts`, `server/finance/http.ts` | `/cp/v1/finance/*` con zod; errores `{ error, message }` en español |
| Tipos 1B | `server/finance/opsTypes.ts` | Centros de coste, categorías, proveedores, gastos, pagos, documentos, recurrentes, bancos, extractos, movimientos y caja |
| Reglas puras 1B | `server/finance/opsRules.ts` | Cálculo fiscal del gasto, asientos de gasto/pago/banco/caja, recurrentes, Norma 43, CaixaBank, CSV, duplicados, sugerencias, NIF, IBAN, firma de documentos |
| Almacén 1B | `server/finance/opsStore.ts` | `MemoryFinanceOpsStore` y `MysqlFinanceOpsStore`; `finOpsTablesReady` |
| Servicio 1B | `server/finance/opsService.ts` | Operaciones; contabiliza SIEMPRE con `postGenerated`/`reverse` del libro |
| API 1B | `server/finance/opsApi.ts` | Rutas de operaciones montadas en el mismo router |
| Tarea 1B | `server/finance/recurringScheduler.ts` | Borradores de gastos recurrentes (interruptor `CP_FINANCE_RECURRING_ENABLED`, apagado) |

Arranque (`server/controlPlane/main.ts`): el libro se monta solo con CRM y con las tablas de 0033 (`finTablesReady`); si
no, log `{ ctx: "Finance", mounted: false, reason: "migration_0033_missing" }`. Las operaciones, además, con las tablas
de 0034 (`finOpsTablesReady`); si no, `{ ctx: "FinanceOps", mounted: false, reason: "migration_0034_missing" }` y el libro
funciona igual. Datos solo en la BD del CRM, tablas `fin_*`.

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
  el tipo de su cuenta de 3 dígitos (bancos `572000NN`, cajas `570000NN`; proveedores con 400/410 y el proveedor en la
  línea).

### Operaciones (fase 1B)

- **Gasto (factura recibida):** el servidor calcula siempre cuota, parte deducible, retención y total desde la base y los
  tipos (`expenseAmounts`; cuota con `taxOf` de la facturación propia sobre el valor absoluto, así la rectificativa es la
  factura en negativo al céntimo). Al **registrarlo** (diario COM, fecha = devengo o, si no hay, fecha de la factura):
  Debe cuenta de la categoría (base + cuota NO deducible) · Debe 472 (cuota deducible) · Haber 4751 (retención) ·
  Haber 400/410 del proveedor (total − retención). La **rectificativa** llega con la base NEGATIVA y sale invertida;
  debe referirse a una factura registrada del mismo proveedor. Un borrador se edita; un registrado no.
- **Pendiente de pago** = total − retención − pagos vigentes (`pendingCents`); estado `pending`/`partial`/`paid`.
- **Pago:** Debe 400/410 · Haber tesorería: banco `572000NN`, caja `570000NN` o Stripe `5720` (diario BAN, CAJ o STR).
  En una rectificativa el «pago» es una devolución (importe negativo, asiento invertido). No se paga más de lo pendiente:
  el pago (manual o desde la conciliación) se guarda en una transacción que bloquea la fila del gasto (`SELECT … FOR
  UPDATE`) y comprueba lo pendiente; si lo supera, `409 exceeds_pending` (dos pagos simultáneos no pasan los dos).
  Métodos `bank`, `direct_debit` y `card` exigen cuenta bancaria; `cash`, caja; `stripe` va a 5720.
- **Movimiento bancario contra cuenta** (comisión, impuesto, transferencia interna, nómina): abono → Debe banco · Haber
  contrapartida; cargo → al revés. Contra otra cuenta de tesorería solo como «transferencia interna».
- **Caja:** Debe/Haber 570000NN contra la contrapartida indicada (importe con signo: negativo = salida).
- **Anular un gasto registrado** revierte su asiento y exige que no tenga pagos vigentes (hay que revertirlos antes).
- **Fecha de las reversiones automáticas** (anular, revertir pago, desvincular): hoy, o la del asiento si es posterior;
  si cae en un periodo cerrado, la operación falla con `period_closed` y no cambia nada.

## Idempotencia y unicidad del hecho económico

Cada asiento generado lleva `source_key` única (índice único en la BD): `invoice:<id>`, `reverse:<entryId>`,
`regularization:<año>`, `closing:<año>`, `opening:<año>`, `expense:<id>`, `expense-payment:<id>`, `bankmov:<id>`
(tras desvincular y volver a conciliar, `bankmov:<id>:2`, `:3`…), `cash:<id>`. Los borradores recurrentes llevan
`recurring:<plantilla>:<periodo>` en el gasto (`AAAA-MM` mensual, `AAAA-T1…T4` trimestral, `AAAA` anual) y no
contabilizan. Repetir una sincronización, un registro, una reversión o un cierre devuelve lo que ya existe; dos
peticiones simultáneas del mismo hecho crean un solo asiento (probado contra MySQL real).

Reglas de la conciliación (probadas en memoria y contra MySQL):

- Un pago **registrado a mano** y después **vinculado** a su movimiento NO crea otro asiento (mismo importe y misma
  cuenta bancaria; si el pago se contabilizó contra otra tesorería, hay que revertirlo y conciliar el movimiento con el
  gasto).
- Si el movimiento **crea** el pago, el asiento es `bankmov:<id>`.
- **Desvincular** revierte el asiento solo si lo creó el vínculo (y deja el pago que creó como revertido); si solo se
  vinculó un pago manual, deshace el vínculo sin tocar el libro. Revertir un pago conciliado devuelve su movimiento a
  pendiente.
- Conciliar **reserva** el movimiento con un cambio de estado condicional: dos conciliaciones simultáneas no ganan las dos.
- **Extractos:** el mismo fichero dos veces en una cuenta → `409 conflict` (sha256 por cuenta); un extracto solapado
  cuenta como duplicados los movimientos ya importados (clave de duplicado única por cuenta: huella de los datos del
  movimiento + su número de aparición en el fichero, así dos comisiones idénticas del mismo día no se confunden). El
  fichero original se guarda como documento del extracto.

`POST /finance/sync/invoices` → `{ posted, skipped, errors[], truncated }`: contabiliza las facturas expedidas
(`issued` y `rectified`) sin asiento; una factura en un periodo cerrado queda en `errors` y entra al reabrirlo. Lee como
mucho 500 por estado y pasada (`truncated: true` = repetir). Usa el mismo almacén (y entorno `livemode`) que la
facturación propia montada.

## Extractos bancarios

- **Norma 43 (AEB 43):** registros 11 (cabecera de cuenta), 22 (movimiento: clave 1 = debe = cargo, importe negativo;
  2 = haber = abono, positivo), 23 (conceptos complementarios), 24 (divisa, se ignora), 33 (final de cuenta: se comprueba
  que número y totales al debe y al haber y el saldo final cuadran) y 88 (fin). Texto UTF-8 o Latin-1. Si la cuenta tiene
  IBAN español, el extracto debe ser de esa entidad, oficina y cuenta.
- **CaixaBank:** Excel o CSV exportado; funciones COPIADAS y adaptadas de `server/routers/bankMovements.ts` del tenant
  (`parseExcelDate`, `parseImporte`, `makeDuplicateKey`, `parseCaixaBankBuffer`), con importes en céntimos, «1.234,56»
  bien leído y fechas de celdas Excel independientes de la zona del proceso.
- **CSV con mapeo:** `{ delimiter, headerRows, date, amount, description, balance|null, dateFormat, decimal }` (columnas
  desde 0). Se saltan las filas sin fecha (pies, totales) y las de importe cero; una fila con fecha e importe ilegible
  invalida el fichero indicando la línea.
- Hasta 10 MB y 20.000 movimientos por extracto.
- **Sugerencias** (`GET /finance/bank-movements/:id/suggestions`, inspiradas en `scoreCandidates` del tenant): pagos
  manuales sin movimiento con importe exacto, y gastos registrados con pendiente por importe exacto o con el proveedor (o
  el número de factura) en el concepto; puntuación por importe exacto, fecha a ±7 días y nombre; `reasons` en español.

## Documentos

Adjuntos de gastos, proveedores, extractos y asientos en `fin_documents` (MEDIUMBLOB; el plano de control no tiene S3).
Hasta 10 MB; el tipo se decide por la FIRMA del contenido (PDF, PNG, JPEG, XML, CSV), no por la extensión. Se sirven
solo por la API autenticada con `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` y CSP `sandbox`. Se
archivan, nunca se borran. El cuerpo JSON general del plano de control sigue limitado a 256 kB: `POST /finance/documents`
y `POST /finance/bank-imports` leen su cuerpo (hasta 15 MB en base64) en su propia ruta, después de comprobar el permiso.

## Gastos recurrentes

Plantillas (proveedor, categoría, centro, base, tipos, frecuencia mensual/trimestral/anual, día 1–28, inicio y fin).
`GET /finance/recurring/preview?until` y `POST /finance/recurring/run { until }` (como mucho un año por delante) generan
**borradores** de gasto, uno por plantilla y periodo; registrar sigue siendo una acción de una persona. La tarea
programada (`CP_FINANCE_RECURRING_ENABLED=1`, **apagada** por defecto) hace lo mismo hasta hoy cada seis horas, con el
cerrojo consultivo de MySQL `elephant_finance_recurring` (una réplica por tick) y el actor `system:finance-recurring`.

## Interfaz para las fases siguientes

```ts
// Asiento generado por un hecho económico, validado y contabilizado en la misma transacción; idempotente por source_key
svc.postGenerated(draft: EntryDraft, actor: FinanceActor): Promise<{ entry: Entry; created: boolean }>
// Reversión idempotente (reverse:<id>), fecha en periodo abierto y no anterior al original
svc.reverse(entryId: number, i: { date: string; reason: string }, actor: FinanceActor): Promise<{ entry: Entry; created: boolean }>
// ¿Se podría contabilizar ahora? (cuadre, cuentas y periodo abierto, sin guardar nada)
svc.checkPostable(draft: EntryDraft): Promise<void>
```

## API

**Fase 1A:** `GET /finance/accounts` · `POST /finance/accounts` · `PATCH /finance/accounts/:code` · `GET /finance/journals` ·
`GET|POST /finance/fiscal-years` · `POST /finance/periods/:year/:month/close|reopen` ·
`POST /finance/fiscal-years/:year/close` · `GET /finance/entries` (filtros `from to journal origin account status q`,
`limit offset sort dir`, respuesta `{ items, total }`) · `GET /finance/entries/:id` · `POST /finance/entries` ·
`POST /finance/entries/:id/post|void|reverse` · `GET /finance/ledger/:code` · `GET /finance/trial-balance` ·
`GET /finance/journal.csv` · `GET /finance/trial-balance.csv` · `POST /finance/sync/invoices` ·
`GET /finance/sync/status` · `GET /finance/summary`.

**Fase 1B** (formas exactas del anexo CRM-ESPERA; listas `{ items, total }`, catálogos `{ items }`, fichas `{ item }`):

| Ruta | Permiso | Respuesta |
|---|---|---|
| `GET /finance/cost-centers` · `POST` · `PATCH /:id` | lectura · gestión | `{ items:[{id,code,name,active}] }` · `{ item }` |
| `GET /finance/categories` · `POST` · `PATCH /:id` | lectura · gestión | `{ items:[{id,name,accountCode,defaultTaxRateBp,active}] }` |
| `GET /finance/suppliers?q&active&limit≤500&offset` · `POST` · `GET|PATCH /:id` | lectura · gestión | `{ items, total }` · `{ item }` |
| `GET /finance/suppliers/:id/statement?from&to` | lectura | `{ expenses, payments, pendingCents, overdueCents, upcoming }` |
| `GET /finance/expenses?status&paymentStatus&supplier&category&costCenter&from&to&q&due=overdue&sort&dir&limit&offset` | lectura | `{ items, total }` con `supplierName, paidCents, pendingCents` |
| `POST /finance/expenses` · `PATCH /:id` (borrador) | gestión | `{ item }` |
| `GET /finance/expenses/:id` | lectura | `{ item, payments }` |
| `POST /finance/expenses/:id/register` · `/void {reason}` · `/payments` | contabilizar | `{ item }` · pago: `{ item, expense }` |
| `POST /finance/expense-payments/:id/reverse {reason}` | contabilizar | `{ item }` |
| `GET /finance/documents?ownerType&ownerId` · `POST` · `GET /:id/content` · `POST /:id/archive` | lectura · gestión | `{ items:[{id,filename,mime,sizeBytes,createdAt,archived,…}] }` |
| `GET /finance/recurring` · `POST` · `PATCH /:id` · `GET /preview?until` · `POST /run {until}` | lectura · gestión | `{ items }` · `{ created, skipped }` |
| `GET /finance/bank-accounts` · `POST` · `PATCH /:id` | lectura · gestión | `{ items:[{…,accountCode,balanceCents}] }` |
| `POST /finance/bank-imports` · `GET ?bankAccountId` | gestión · lectura | `{ item:{id,inserted,duplicates,rows,…} }` · `{ items }` |
| `GET /finance/bank-movements?bankAccountId&status&from&to&q&limit&offset` | lectura | `{ items, total }` |
| `GET /finance/bank-movements/:id/suggestions` | lectura | `{ items:[{type,expenseId,expensePaymentId,supplierName,invoiceNumber,date,amountCents,reasons}] }` |
| `POST /finance/bank-movements/:id/match` · `/unmatch` | contabilizar | `{ item }` |
| `POST /finance/bank-movements/:id/ignore` | gestión | `{ item }` |
| `GET|POST /finance/cash-accounts` | lectura · gestión | `{ items:[{id,name,accountCode,balanceCents}] }` |
| `GET /finance/cash-movements?cashAccountId&limit&offset` · `POST` | lectura · contabilizar | `{ items, total }` · `{ item }` |

Errores: 400 `invalid_input`, 403 (`forbidden`, `operator_session_required`, `forbidden_role`), 404 `not_found`, 409
(`period_closed`, `invalid_state`, `conflict`, `exceeds_pending`), 422 (`unbalanced`, `invalid_account`), 503 `unavailable`.

`/finance/summary`: ingresos y gastos devengados del mes y del año, IVA repercutido del trimestre y resultado del año
(sin regularización, cierre ni apertura); con 0034, además saldos de bancos y caja (desde el libro, por cuenta),
acreedores pendientes (saldo acreedor de 400 y 410) e IVA soportado del trimestre (472). Sin 0034 esos campos son `null`.

## Permisos (provisionales)

Añadir ámbitos nuevos toca ficheros críticos del plano de control, así que la fase 1 usa los existentes, centralizados
en `server/finance/permissions.ts`:

| Capacidad | Fase 1 |
|---|---|
| Consulta y exportaciones | `billing:read` |
| Gestión: centros, categorías, proveedores, borradores de gastos, documentos, recurrentes, cuentas bancarias y cajas, importar extractos, ignorar movimientos | `billing:write` |
| Contabilizar o revertir: asientos manuales, sincronizar facturas, registrar y anular gastos, pagos y su reversión, conciliar y desvincular, movimientos de caja | `billing:write` + sesión de operador (nunca un token de servicio) |
| Cerrar/reabrir periodos y cerrar ejercicios, plan contable (alta de ejercicios: solo `billing:write`) | `billing:write` + sesión de operador + rol `admin` o `superadmin` |

El alta de una cuenta bancaria o de una caja crea su subcuenta en el plan contable desde el servicio (alta derivada): no
exige el rol de administración que pide el alta manual de cuentas.

Plan: en una PR protegida aparte, ámbitos propios (`finance:read`, `finance:write`, `finance:close`) en
`server/controlPlane/auth.ts` y `operatorRoles.ts`, cambiando solo las constantes de `permissions.ts`.

## Fases siguientes

- **2 · Cobros y conciliación:** Stripe (cuenta 5720), cobros de facturas emitidas contra 430 (conciliación
  `invoice_payment`).
- **3 · Gestoría e impuestos:** libros registro, modelos (303, 111, 115, 390…), exportación para la gestoría.
- **4 · Análisis:** informes de resultados, tesorería y previsiones.
