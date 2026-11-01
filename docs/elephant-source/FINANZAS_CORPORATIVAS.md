# Finanzas corporativas de Big Elephant

Contabilidad, gastos, proveedores, bancos y caja de **IRON ELEPHANT CONSULTING, S.L.** (la empresa que vende el SaaS).
Vive en el **plano de control** del Core (`server/finance/`) y se usa desde el CRM (admin.bigelephant.es). Los tenants
son clientes de Big Elephant y nada más: el módulo nunca lee ni escribe sus bases.

Estado: **fase 1A (libro contable)**, **fase 1B (operaciones)**, **fase 2 (Stripe y conciliación)**, **fase 3
(gestoría e impuestos)** y **fase 4 (control diario, informes y análisis)** implementadas. Migraciones
`db/crm/migrations/0033_finance_ledger.sql`, `0035_finance_operations.sql`, `0036_finance_stripe.sql`,
`0037_finance_tax.sql` y `0038_finance_analysis.sql`.

## Arquitectura

| Pieza | Fichero | Qué hace |
|---|---|---|
| Tipos y errores | `server/finance/types.ts` | Modelo del libro (cuentas, ejercicios, periodos, asientos, líneas) y `FinanceError` con su estado HTTP |
| Reglas puras | `server/finance/rules.ts` | Validación y cuadre, asiento de factura y rectificativa, reversión, regularización, cierre y apertura, sumas y saldos, mayor, CSV |
| Almacén | `server/finance/store.ts` | `MemoryFinanceStore` (pruebas) y `MysqlFinanceStore`; `finTablesReady` |
| Servicio | `server/finance/service.ts` | Orquesta, audita cada escritura y sincroniza las facturas emitidas (solo lectura de `server/invoicing`) |
| Permisos | `server/finance/permissions.ts` | Un ámbito `finance:*` por capacidad, registro de denegaciones (ver abajo) |
| API | `server/finance/api.ts`, `server/finance/http.ts` | `/cp/v1/finance/*` con zod; errores `{ error, message }` en español |
| Tipos 1B | `server/finance/opsTypes.ts` | Centros de coste, categorías, proveedores, gastos, pagos, documentos, recurrentes, bancos, extractos, movimientos y caja |
| Reglas puras 1B | `server/finance/opsRules.ts` | Cálculo fiscal del gasto, asientos de gasto/pago/banco/caja, recurrentes, Norma 43, CaixaBank, CSV, duplicados, sugerencias, NIF, IBAN, firma de documentos |
| Almacén 1B | `server/finance/opsStore.ts` | `MemoryFinanceOpsStore` y `MysqlFinanceOpsStore`; `finOpsTablesReady` |
| Servicio 1B | `server/finance/opsService.ts` | Operaciones; contabiliza SIEMPRE con `postGenerated`/`reverse` del libro |
| API 1B | `server/finance/opsApi.ts` | Rutas de operaciones montadas en el mismo router |
| Tarea 1B | `server/finance/recurringScheduler.ts` | Borradores de gastos recurrentes (interruptor `CP_FINANCE_RECURRING_ENABLED`, apagado) |
| Tipos 2 | `server/finance/stripeTypes.ts` | Transacciones de saldo, payouts, importaciones, configuración de Stripe y punto de extensión `StripeBalanceSource` |
| Reglas puras 2 | `server/finance/stripeRules.ts` | Lectura de los informes CSV de Stripe, tipos, asientos de cobro/comisión/reembolso/disputa/payout, transferencias, incidencias, sugerencias y estado de conciliación |
| Almacén 2 | `server/finance/stripeStore.ts` | `MemoryFinanceStripeStore` y `MysqlFinanceStripeStore`; `finStripeTablesReady`; lectura de `stripe_invoices` |
| Servicio 2 | `server/finance/stripeService.ts` | Importación, contabilización, payouts, resumen y conciliación; extensión de la conciliación bancaria de 1B |
| API 2 | `server/finance/stripeApi.ts` | `/finance/stripe/*` y `/finance/reconciliation/*` |

Arranque (`server/controlPlane/main.ts`): el libro se monta solo con CRM y con las tablas de 0033 (`finTablesReady`); si
no, log `{ ctx: "Finance", mounted: false, reason: "migration_0033_missing" }`. Las operaciones, además, con las tablas
de 0035 (`finOpsTablesReady`); si no, `{ ctx: "FinanceOps", mounted: false, reason: "migration_0035_missing" }` y el libro
funciona igual. La parte de Stripe, con las tablas de 0036 (`finStripeTablesReady`); si no,
`{ ctx: "FinanceStripe", mounted: false, reason: "migration_0036_missing" }` y el resto funciona igual. Datos solo en la
BD del CRM, tablas `fin_*`.

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
| `GET /finance/suppliers?q&active&limit≤500&offset` · `POST` · `GET|PATCH /:id` | lectura · proveedores | `{ items, total }` · `{ item }` |
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
(sin regularización, cierre ni apertura); con 0035, además saldos de bancos y caja (desde el libro, por cuenta),
acreedores pendientes (saldo acreedor de 400 y 410) e IVA soportado del trimestre (472). Sin 0035 esos campos son `null`.

## Fase 2: Stripe como TPV principal y conciliación

### Origen único de cada hecho

| Hecho | Origen contable (`source_key`) | Solo referencia (nunca contabiliza) |
|---|---|---|
| Factura emitida | `server/invoicing` (fase 1A, `invoice:<id>`) | — |
| Cobro con Stripe (bruto, comisión, neto) | Transacción de saldo importada (`stripe-txn:<txn>`) | `commercial_events`, `stripe_invoices`, `billing_charge_payments` |
| Reembolso, disputa, comisiones de Stripe | Transacción de saldo (`stripe-txn:<txn>`) | `commercial_events`, `stripe_charge_adjustments` |
| Liquidación al banco (payout) | Payout (`stripe-payout:<po>`, fecha de llegada); fallido → `reverse:<id>` | — |
| Llegada del payout al banco | Se **vincula** el movimiento al asiento del payout: sin asiento | — |
| Cobro de factura por transferencia | Movimiento conciliado `invoice_payment` (`bankmov:<id>`: Debe 572000NN / Haber 430) | `paymentStatus` de la factura |

Nunca se contabiliza desde el webhook ni desde `commercial_events`; `order.dunning_notice` se ignora. El módulo no
escribe nada de `server/stripe`, `server/invoicing` ni `server/commercialEvents`: solo lee `invoices` (por
`paymentRef = stripe:in:<id>`) y `stripe_invoices` (para explicar un cobro sin factura propia).

### Importación

Dos informes CSV del panel de Stripe (Informes): **«Balance change from activity – itemized»** (o el export clásico
«Itemized balance transactions») y **«Payouts – itemized»**. Las cabeceras se reconocen por nombre (sin distinguir
mayúsculas, espacios, paréntesis ni guiones bajos: `Created (UTC)` = `created_utc`), los importes vienen en unidad mayor
con punto decimal y se guardan en céntimos con el signo de Stripe (neto = bruto − comisión, si no cuadra la fila se
rechaza con aviso), y las fechas UTC se pasan a Europe/Madrid. Cada fichero se importa una sola vez por tipo (sha256);
cada transacción y cada payout una sola vez (`UNIQUE(provider, id)`): un fichero solapado cuenta duplicados y un payout
ya conocido refresca su estado (y su llegada mientras no tenga asiento). Las monedas distintas del euro se importan como
pendientes con la incidencia `currency` y no se contabilizan. Una fila de payout del informe de saldo da de alta el
payout; una de `payout_reversal`, lo marca fallido.

Tipos normalizados: `charge`, `refund`, `refund_failure`, `dispute`, `dispute_reversal`, `stripe_fee` (fee,
stripe_fee, network_cost, tax), `payout`, `payout_reversal` y `other` (transferencias de Connect, recargas, ajustes sin
disputa…: incidencia `unsupported`, no se contabilizan solas; el operador las lleva con un asiento manual).

Punto de extensión: `StripeBalanceSource` (lector por API). No se implementa en esta fase; iría detrás de un
interruptor nuevo apagado, `CP_FINANCE_STRIPE_SYNC_ENABLED`, con una clave restringida de solo lectura en variable de
entorno, y devolvería lo mismo que los lectores de CSV.

### Asientos (diario STR, origen `stripe`)

Una sola fórmula con los importes con signo de Stripe: **Debe 5720 neto · Debe 626 comisión · Haber contrapartida
bruto** (los negativos cambian de lado). Contrapartida: 430 en cobros y reembolsos (con la empresa de la factura propia
en la línea), la cuenta de disputas configurada (430 o 436) en disputas y 626 en los cargos de Stripe por otros
servicios. Fecha = la del cobro (`created`).

- Cobro: Debe 5720 neto · Debe 626 comisión · Haber 430 bruto.
- Reembolso: Debe 430 · Haber 5720; con comisión devuelta, además Haber 626.
- Disputa perdida: Debe 430/436 · Debe 626 (comisión de disputa) · Haber 5720. Ganada: exactamente el inverso (y la
  retención queda revisada sola).
- Comisiones y servicios de Stripe: Debe 626 · Haber 5720.
- Payout: Debe 572000NN de la cuenta configurada · Haber 5720, fecha de llegada. Fallido o cancelado con asiento:
  reversión (fecha del fallo); sin asiento: no se contabiliza (las filas quedan `ignored`).

**IVA de las comisiones de Stripe: decisión pendiente para la gestoría.** Stripe (Stripe Payments Europe, Ltd.,
Irlanda) no repercute IVA en sus comisiones de procesamiento. Hay dos lecturas: servicios financieros exentos (art. 20.Uno.18.º
LIVA y art. 135.1.d de la Directiva) o prestación de servicios de un proveedor de la UE sujeta con **inversión del
sujeto pasivo** (art. 84.Uno.2.º LIVA: autoliquidación Debe 472 / Haber 477 al tipo general, que se declara en el 303 y,
si procede, en el 349). La configuración `stripeFeeVat` lo deja en `exempt` por defecto; si la gestoría decide
`reverse_charge`, el administrador lo cambia (`feeVatRateBp`, 2100) y los asientos posteriores llevan las dos líneas de
IVA sobre la comisión (sin efecto en el saldo). Los asientos ya contabilizados no cambian (se corrigen con reversión).

Saldo de **5720 = saldo pendiente de liquidar en Stripe**. El resumen lo compara con el neto de las transacciones en
euros importadas: la diferencia es lo importado sin contabilizar (tipos no soportados, errores) o lo anterior a la
primera importación (que se registra con un asiento manual de apertura).

### Conciliación

- **Por factura** (fechas del §3: factura, cobro, disponibilidad, payout y banco): factura → cobros de Stripe
  (`invoice_id` de Stripe = `paymentRef` `stripe:in:<id>`; los reembolsos y disputas heredan la factura de su cobro) →
  comisión → payout → movimiento bancario, y las transferencias conciliadas. Estados `pendiente_cobro`, `cobrada`,
  `liquidada`, `en_banco`, `incidencia` (reembolso, disputa o importe distinto sin revisar). Un cobro que no casa queda
  con la incidencia `no_invoice` (430 sin empresa): no se inventa el cliente.
- **Por payout:** transacciones incluidas (`automatic_payout_id`), su suma frente al importe (diferencia visible;
  `null` si no hay transacciones importadas de ese payout) y el movimiento bancario vinculado.
- **Sugerencias** de un abono: payouts sin movimiento con importe exacto y llegada a ±3 días hábiles (o «STRIPE» en el
  concepto), y facturas propias pendientes por importe exacto, número o cliente en el concepto.
- **Acciones:** vincular/desvincular payout ↔ movimiento (sin asiento; un movimiento por payout y un payout por
  movimiento, también en carrera), `invoice_payment` para transferencias (no supera lo pendiente: total − cobros de
  Stripe − transferencias; la comprobación, la reserva del movimiento y el asiento van con el cerrojo
  `GET_LOCK('fin-invoice-<id>')`: dos transferencias simultáneas que juntas superan lo pendiente → la segunda recibe
  `exceeds_pending`), marcar una incidencia como revisada con nota.
- **Facturas propias sin tope:** se leen de la tabla `invoices` en solo lectura (`server/finance/ownInvoices.ts`,
  `MysqlOwnInvoiceDirectory`, del mismo entorno test/live que la facturación): por `payment_ref`, por id, paginadas y
  candidatas a un cobro (no cobradas del último año, las 500 más recientes con total suficiente).

### Redsys

**No se implementa:** Big Elephant no cobra con Redsys (el Redsys del repositorio es de los tenants, que son clientes y
no forman parte de esta contabilidad). Si algún día se usara, la columna `provider` de transacciones y payouts admite
otra pasarela; bastaría con un lector de su informe que produzca las mismas filas y con su subcuenta de tesorería.

### API de la fase 2

| Ruta | Permiso | Respuesta |
|---|---|---|
| `GET /finance/stripe/settings` | lectura | `{ item:{stripeFeeVat,feeVatRateBp,stripePayoutBankAccountId,disputeAccountCode,updatedBy,updatedAt} }` |
| `PATCH /finance/stripe/settings` | configuración | `{ item }` |
| `POST /finance/stripe/imports {kind,filename,contentBase64}` · `GET` | gestión · lectura | `{ item:{id,kind,filename,sha256,rows,inserted,duplicates,refreshed,nonEur,errors,problems[{line,message}],importedBy,createdAt} }` · `{ items, total }` |
| `GET /finance/stripe/transactions?type&status&from&to&payout&issue=open&q&limit&offset` | lectura | `{ items, total }` |
| `POST /finance/stripe/post {until?}` | contabilizar | `{ posted, skipped, errors[{transactionId,message}], truncated }` |
| `GET /finance/stripe/payouts?status&from&to&limit&offset` | lectura | `{ items, total }` |
| `GET /finance/stripe/summary` | lectura | ver el informe de la fase |
| `GET /finance/reconciliation/invoices?status&from&to&q&limit&offset` | lectura | `{ items, total }` |
| `GET /finance/reconciliation/payouts/:id` | lectura | `{ item }` |
| `POST /finance/reconciliation/payouts/:id/link-bank {bankMovementId}` · `/unlink-bank` | contabilizar | `{ item }` |
| `POST /finance/reconciliation/transactions/:id/review {note}` | contabilizar | `{ item }` |

`/finance/bank-movements/:id/suggestions` añade `{type:"stripe_payout",payoutId,stripePayoutId,date,amountCents,reasons}`
y `{type:"invoice",invoiceId,invoiceNumber,customerName,date,amountCents,reasons}`; `/match` admite
`{type:"stripe_payout",payoutId}` (sin asiento) y `{type:"invoice_payment",invoiceId}`. `/finance/summary` añade
`stripeBalanceCents` (5720 desde el libro; `null` sin la fase 2).

## Fase 3: gestoría e impuestos

Límite inviolable: **el sistema nunca presenta nada** ante la AEAT, la Seguridad Social ni ningún organismo, ni ordena
pagos tributarios. Calcula borradores trazables, lleva el calendario y registra lo que el operador **declara** haber
presentado o pagado (con su justificante). Texto visible en cada modelo: «Borrador calculado por el sistema. Revísalo
con tu gestoría: el sistema no presenta declaraciones.»

| Pieza | Fichero | Qué hace |
|---|---|---|
| Tipos 3 | `server/finance/taxTypes.ts` | Configuración fiscal, borradores (casillas, detalle de origen, declarados), obligaciones, nóminas, aplazamientos, expedientes y ajustes del 200 |
| Reglas puras 3 | `server/finance/taxRules.ts` | Calendario (vencimientos y traslado a hábil), aplicabilidad, modelos 303/390/349/347/111/190/115/180/200/202 y seguros sociales, huella y diferencias, avisos, asientos, libros registro y CSV de los borradores |
| Almacén 3 | `server/finance/taxStore.ts` | `MemoryFinanceTaxStore` y `MysqlFinanceTaxStore`; `finTaxTablesReady` |
| Facturas fiscales | `server/finance/taxSources.ts` | Lectura (solo lectura) de `invoices`/`invoice_lines` por fecha de expedición, sin el tope de 500 del almacén de la facturación |
| Servicio 3 | `server/finance/taxService.ts` | Orquesta, audita, contabiliza por `postGenerated`/`reverse` y exporta el ZIP |
| API 3 | `server/finance/taxApi.ts` | `/finance/tax/*` con las formas del anexo CRM-ESPERA-FASE3 |
| Avisos 3 | `server/finance/taxReminders.ts` | Alerta `admin.tax_deadline` (n.º 43 del catálogo) en el ciclo de alertas, con `CP_FINANCE_TAX_REMINDERS_ENABLED=1` (apagado) |

Arranque: con las tablas de 0037 (`finTaxTablesReady`) y las operaciones montadas; si no,
`{ ctx: "FinanceTax", mounted: false, reason: "migration_0037_missing" }` y `/finance/tax/*` responde 404 (el CRM oculta
el grupo GESTORÍA E IMPUESTOS). Los justificantes se guardan en `fin_documents` con propietario `tax_obligation`,
`payroll` o `tax_dossier` (la columna es VARCHAR; el servicio de operaciones comprueba que el propietario existe).

### Reutilizado del módulo de gestoría del tenant (copiado y adaptado, nunca importado: usa `legacyDb`)

- `obligationSpecs`, `addMonthsISO` (server/routers/gestoria.ts) → `obligationSpecs` y `addMonthsISO` puros, con
  vencimientos reales y sin desbordar el mes.
- `compute303`/`lines303`, `compute111`/`lines111`, `computeCorporate`/`lines200` (server/gestoriaTax.ts) → modelos en
  céntimos con detalle de origen por asiento, factura, gasto o nómina. El IVA sale del **libro** (líneas 477/472 con su
  tipo y base), no de las facturas, para que la inversión del sujeto pasivo de Stripe y las reversiones cuenten.
- `buildDossierZip` (server/gestoriaDossier.ts) → `exportZip` con `jszip` (ya en el repositorio).
- Esquema de `tax_obligations`, `tax_deferrals`, `tax_dossiers` y `last_reminder_days` (drizzle 0112–0116) →
  `fin_tax_*` con céntimos, fechas DATE, huella y bitácora de solo inserción; patrón `lastReminderDays` de
  server/taxReminderJob.ts para los avisos.

### Configuración fiscal

Una fila (`fin_tax_settings`) que solo guarda el administrador; mientras no existe, `GET /tax/settings` devuelve
`item: null` y `defaults` (valores neutros con la razón social y el NIF del emisor precargados en tiempo de ejecución
desde `server/stripe/issuer.ts`; la migración no contiene datos reales). Cada versión queda en `fin_tax_settings_log`
(la primera, con los valores por defecto como «antes»). Solo ejercicio natural (`fiscalYearStartMonth = 1`); IVA mensual
solo con REDEME. Campos además de los del contrato: `vat390Exempt` (exoneración del 390), `openingVatCompensationCents`
(cuotas a compensar previas al sistema, casilla 110 del primer 303 sin anterior), `stripeVatId` (NIF-IVA de Stripe para
el 349) y `extraHolidays` (festivos autonómicos o locales).

### Calendario y vencimientos

`POST /tax/calendar/generate {year}` crea las obligaciones que activa la configuración (`obligation:<modelo>:<año>:<periodo>`,
única; una fila por sentencia, así que dos generaciones simultáneas no duplican ni se bloquean). Las que dejaron de aplicar
y siguen pendientes pasan a `no_aplica` con su motivo. Lo que no aplica no se crea y se explica en `notApplicable`.

| Modelo | Periodos | Vencimiento (sin trasladar) |
|---|---|---|
| 303 | 1T–4T (o 01–12 con REDEME) | 20 de abril, julio y octubre; 4T, 30 de enero. Mensual: día 30 del mes siguiente (enero, fin de febrero; diciembre, 30 de enero) |
| 111, 115 | 1T–4T | 20 de abril, julio y octubre; **4T, 20 de enero** |
| 349 | 1T–4T | como el 303 trimestral |
| 390 | ANUAL | 30 de enero |
| 190, 180 | ANUAL | 31 de enero |
| 347 | ANUAL | último día de febrero |
| 200 | ANUAL | 25 de julio del año siguiente |
| 202 | 1P, 2P, 3P | 20 de abril, octubre y diciembre del propio ejercicio |
| SS (seguros sociales, RLC) | 01–12 | último día del mes siguiente |

Si el último día es sábado, domingo, festivo nacional fijo (1/1, 6/1, 1/5, 15/8, 12/10, 1/11, 6/12, 8/12, 25/12),
Viernes Santo o un festivo de `extraHolidays`, pasa al primer día hábil siguiente.

### Ciclo de una obligación

`pendiente` → **calcular** → `borrador` (o `no_aplica` si los datos dicen que no hay que presentarlo: 347/349 sin terceros,
202 sin cuota) → **revisar** → `revisado` → **presentar** (fecha, número de justificante o CSV, PDF opcional en el mismo
cuerpo) → `presentado` | `domiciliado` | `a_compensar` | `sin_actividad` → **pagar** → `pagado`. También `aplazado` al
registrar un aplazamiento y **marcar** `a_compensar`/`sin_actividad`. Cada paso deja fila en `fin_tax_obligation_log` y
en `fin_audit_log`.

- **Huella y `stale`:** cada borrador guarda su JSON y su sha256 (sin la fecha de cálculo). Recalcular una obligación
  revisada o presentada **no** sobrescribe el borrador: si la huella cambió, marca `stale` con la diferencia por casilla
  (`staleDiff`). Con `force`, un revisado (no congelado) vuelve a borrador. No se presenta con `stale`.
- **Liquidación del IVA al presentar el 303** (diario IMP, último día del periodo, `tax:303:<año>:<periodo>`): Debe 477
  (devengado) · Haber 472 (deducible) · Haber 4700 (compensación aplicada) · Haber 4750 (a ingresar) o Debe 4700 (a
  compensar o a devolver). Deja 472/477 del periodo a cero.
- **Pago:** Debe 4750 (303), 4751 (111 y 115), 4752 (200), 473 (202) o 476 (seguros sociales) · Haber banco
  (`tax-payment:<obligación>`). Los modelos informativos (390, 349, 347, 190, 180) no tienen pago.
- **Reapertura** (`finance:sensitive`): de presentado sin pago a borrador, revirtiendo la liquidación. Un trimestre
  congelado no se reabre; una obligación pagada tampoco.
- **Cierre del trimestre fiscal** (`POST /tax/quarters/:year/:quarter/close {closePeriods?}`, `finance:sensitive`): exige todo
  presentado, congela las obligaciones del trimestre y, si se pide, cierra los tres periodos contables (fase 1A).

### Modelos

- **303:** 01–09 por tipo (4, 10, 21 %), 10/11 adquisiciones intracomunitarias de servicios (comisiones de Stripe con ISP,
  origen `stripe`), 14/15 modificaciones (facturas rectificativas y reversiones de otro periodo), 27, 28/29 deducible
  interior (base proporcional a la parte deducible), 36/37 deducible intracomunitario, 40/41 rectificación de deducciones,
  45, 46, 59 (servicios a clientes de la UE con NIF-IVA, al 0 %), 120 (no sujetas por localización: fuera de la UE), 64,
  66, 110/78/87 (compensación arrastrada del 303 anterior), 69 y 71. Sin prorrata. Sin asientos en el periodo: «sin
  datos» (null).
- **390:** suma anual de las casillas de los 303 (presentados: lo guardado; el resto, calculado) con prefijo `303.`.
- **349:** clave S (facturas al 0 % a clientes de la UE con NIF-IVA) e I (comisiones de Stripe con ISP y gastos de
  proveedores de la UE); rectificativas restan; aviso si pasa de 50.000 € (presentación mensual).
- **347:** terceros con más de 3.005,06 € al año IVA incluido; A compras (gastos registrados), B ventas (facturas), con
  desglose trimestral; excluye terceros fuera de España y operaciones con retención; rectificativas restan.
- **111 / 190:** nóminas registradas (mes de devengo) y gastos con retención que no son alquileres; con empleados y un mes
  sin nómina, «sin datos». **115 / 180:** gastos de la cuenta 621 con retención. Los trabajadores van por alias.
- **Seguros sociales:** cuota de la empresa y del trabajador de las nóminas registradas del mes.
- **200:** resultado contable (grupos 6 y 7 sin regularización ni cierre), aumento por el 630, ajustes manuales,
  compensación de bases negativas (las más antiguas primero; límite del 70 % por encima de 1 M€ de base previa; sin límite
  los tres primeros ejercicios de una entidad nueva), cuota al tipo configurado (15 % el primer ejercicio con base
  positiva y el siguiente si se indica `newEntityFirstProfitYear`), deducciones, retenciones (473 que no son pagos
  fraccionados, más las manuales) y 202 pagados. Las bases negativas pendientes pasan al 200 siguiente.
- **202:** art. 40.2, 18 % de (cuota íntegra − deducciones − retenciones) del último 200 vencido (abril: año −2; octubre y
  diciembre: año −1); sin ese 200 en el sistema, «sin datos»; sin cuota positiva, no aplica. Art. 40.3: 5/7 del tipo
  redondeado por defecto sobre el resultado acumulado (3, 9 y 11 meses), menos retenciones y pagos anteriores.

### Nóminas, aplazamientos, expedientes y avisos

- **Nóminas** (`fin_payrolls`, una por mes y alias; se rechaza un alias con forma de DNI o NIE): líquido = bruto − IRPF −
  SS del trabajador. Asiento `payroll:<id>` (NOM, último día del mes): Debe 640 y 642 · Haber 4751, 476 y 465. Pago
  `payroll-payment:<id>`: Debe 465 · Haber banco. En borrador se pueden sustituir; registradas, no.
- **Aplazamientos:** sobre una obligación presentada y sin pagar (pasa a `aplazado`); las cuotas suman el principal. Cada
  cuota pagada: Debe cuenta del modelo (principal) · Debe 669 (lo pagado de más = intereses) · Haber banco
  (`tax-deferral:<id>:<n>`). Estados: solicitado, concedido, denegado, en_curso, pagado, cancelado.
- **Expedientes** (requerimiento, comprobación, inspección, recurso, otro): organismo, referencia, asunto, fechas, estado
  (abierto, en_tramite, respondido, cerrado), obligación relacionada, documentos y bitácora de solo inserción.
- **Avisos:** a 15, 7 y 3 días del vencimiento de lo que sigue pendiente, borrador o revisado; el umbral avisado se guarda
  en la obligación con una escritura condicional (una sola vez también entre réplicas). Alerta administrativa
  `admin.tax_deadline` en el ciclo de alertas del plano de control **solo** con `CP_FINANCE_TAX_REMINDERS_ENABLED=1`.
  El panel (`/tax/dashboard`) muestra los avisos siempre.

### Libros registro y exportación

- `GET /tax/registers/issued.csv?from&to`: `registerCsv` de la facturación propia (sin modificarlo) más, al final, los
  cobros de Stripe sin factura propia como **incidencia** (no se inventan facturas).
- `GET /tax/registers/received.csv?from&to`: gastos registrados (F1, F2 tique, R1 rectificativa; cuota deducible,
  retención, rectificada) y una fila por mes con las comisiones de Stripe con ISP.
- `GET /tax/export.zip?from&to` (máximo un año): libro diario, sumas y saldos, libros registro, borradores guardados de las
  obligaciones del rango (CSV legibles), calendario y listado de documentos (sin su contenido). Sin datos personales.

### API de la fase 3 (`/cp/v1/finance/tax`, formas del anexo del CRM)

| Ruta | Permiso | Respuesta |
|---|---|---|
| `GET /tax/settings` | lectura | `{item: TaxSettings\|null, log:[{at, actor, changes:{campo:[antes, después]}, note}], defaults}` |
| `PATCH /tax/settings` | configuración | `{item}` |
| `GET /tax/dashboard` | lectura | `{asOf, hasEmployees, settingsMissing, quarter:{label}, upcoming, estimates, deferrals, dossiers, warnings}` |
| `GET /tax/calendar?year` · `POST /tax/calendar/generate` | lectura · operador | `{items, notApplicable}` · `{created, existing, retired, notApplicable}` |
| `GET /tax/obligations?year&model&status` · `GET /tax/obligations/:id` | lectura | `{items, total}` · `{item: Obligation & {draft, log, documents}}` |
| `POST /tax/obligations/:id/calculate\|review\|present\|pay\|mark` | operador | `{item}` |
| `POST /tax/obligations/:id/reopen` · `POST /tax/quarters/:year/:quarter/close` | sensible | `{item}` |
| `GET /tax/models/:model/preview?year&period` | lectura | Draft |
| `GET /tax/registers/issued.csv\|received.csv` · `GET /tax/export.zip` | exportar | CSV · ZIP |
| `GET\|POST /tax/payrolls` · `POST /tax/payrolls/:id/post\|pay` | lectura · contabilizar | `{items}` · `{item}` |
| `GET\|POST /tax/deferrals` · `PATCH /tax/deferrals/:id` · `POST /tax/deferrals/:id/installments/:n/pay` | lectura · operador | `{items}` · `{item}` |
| `GET\|POST /tax/dossiers` · `GET\|PATCH /tax/dossiers/:id` · `POST /tax/dossiers/:id/log` | lectura · operador | `{items}` · `{item: Dossier & {log, documents}}` |
| `GET /tax/corporate/:year` · `POST /tax/corporate/:year/adjustments` | lectura · operador | `{item}` |

«Operador» = `finance:tax` + sesión de operador (nunca un token de servicio); «configuración» = `finance:config`,
«sensible» = `finance:sensitive` y «exportar» = `finance:export` (ver «Permisos»).

### Decisiones fiscales que debe confirmar la gestoría

1. **Comisiones de Stripe:** exentas por defecto (servicios financieros); con `reverse_charge` (fase 2) se autoliquidan
   como adquisición intracomunitaria de servicios (303: 10/11 y 36/37; 349: clave I con `stripeVatId`). Confirmar cuál
   aplica y el NIF-IVA de Stripe Payments Europe.
2. **Proveedores de la UE sin IVA** (hosting, software): la fase 1B no autoliquida la ISP de los gastos; el 303 avisa y el
   349 los declara en la clave I. Confirmar si hay que registrar la autoliquidación con un asiento manual.
3. **Periodo del IVA:** devengado por fecha de expedición de la factura; soportado por fecha de devengo del gasto (o de
   factura). Las rectificativas van a 14/15 y 40/41 (no restan en las casillas por tipo).
4. **Retenciones (111/115):** por mes de devengo de la nómina y fecha de devengo del gasto, no por fecha de pago.
5. **111 y 115 del 4T vencen el 20 de enero** (el contrato decía «igual que el 303»); el 390 vence el **30** de enero.
6. **347:** importes con IVA por fecha de expedición o de factura recibida; no incluye cobros en metálico > 6.000 € ni
   subvenciones; se excluyen las operaciones con retención y con terceros extranjeros.
7. **349:** trimestral salvo aviso por superar 50.000 €; las rectificativas de otro periodo se declaran restando en el
   periodo actual (avisa si un operador queda en negativo).
8. **200:** tipo único configurado; no calcula los tipos reducidos de microempresas (Ley 7/2024), la reserva de
   capitalización ni la de nivelación; el asiento del gasto por impuesto (630/4752/473) lo registra la gestoría.
   Numeración de casillas del 200 y del 390 orientativa (el 390 se entrega como suma de las casillas del 303).
9. **202:** por defecto art. 40.2; el art. 40.3 sin el pago mínimo de las grandes empresas.
10. **Nóminas:** solo resúmenes por alias; el 190 no lleva NIF de los trabajadores (los añade la gestoría).
11. **Viernes Santo** se trata como festivo nacional; el resto de festivos autonómicos y locales, por configuración.
12. **303 mensual de julio:** vencimiento el 30 de agosto según la regla general implementada; confirmar con la gestoría.

## Fase 4: control diario, informes y análisis

Es LECTURA de las fases 1–3: los informes salen del libro (asientos contabilizados, agregados en la BD con `GROUP BY` por
mes, cuenta, origen, centro, proveedor y categoría; nunca se cargan todas las líneas), de las operaciones, de Stripe y de
la gestoría. No hay fuentes paralelas ni copias. Solo se guardan la **revisión diaria** (con bitácora) y la **marca de
coste directo** de las categorías. `null` = no disponible (nunca 0). Migración `0038_finance_analysis.sql`.

| Pieza | Fichero | Qué hace |
|---|---|---|
| Tipos 4 | `server/finance/analysisTypes.ts` | Hechos agregados del libro, tesorería, Stripe y transferencias por mes, revisión diaria y su bitácora |
| Reglas puras 4 | `server/finance/analysisRules.ts` | Periodos y comparativas, partidas del PGC (pérdidas y ganancias y balance con cuadre), tesorería por naturaleza, previsión, antigüedad, gastos agrupados, Revenue & Margin, conversión, coste directo, avisos y CSV |
| Almacén 4 | `server/finance/analysisStore.ts` | `MemoryFinanceAnalysisStore` y `MysqlFinanceAnalysisStore` (agregaciones en SQL, revisión única por día, nota con escritura condicional); `MysqlPaymentEventSource` (registro comercial en solo lectura); `finAnalysisTablesReady` |
| Servicio 4 | `server/finance/analysisService.ts` | Control diario y revisión, informes y análisis; consume las métricas comerciales sin recalcularlas |
| API 4 | `server/finance/analysisApi.ts` | `/finance/daily*`, `/finance/reports/*`, `/finance/analytics/*`; la marca de coste directo va en `PATCH /finance/categories/:id` (`opsApi.ts`) |

Arranque: con las tablas de 0038 (`finAnalysisTablesReady`) y las operaciones montadas; si no,
`{ ctx: "FinanceAnalysis", mounted: false, reason: "migration_0038_missing" }` y `/finance/daily` responde 404 (el CRM
oculta esas páginas con `hiddenRoutes`). Sin Stripe (0036), lo que depende de Stripe o de la conciliación por factura es
`null`; sin la gestoría (0037), las obligaciones fiscales son `null`.

### Decisiones

- **Cuenta de resultados:** asientos contabilizados sin regularización, cierre ni apertura. Partidas del modelo abreviado
  del PGC de pymes por el **prefijo más largo** de la cuenta (toda cuenta de los grupos 6 y 7 cae en una partida: el total
  coincide siempre con sumas y saldos). Importes con el signo de su efecto en el resultado (ingresos +, gastos −). Rango
  en meses completos (máximo 36); comparación con el periodo anterior de la misma duración (`compare=previous`) o con el
  mismo del año anterior (`compare=year`), periodo a periodo. Con `costCenter` solo cuentan las líneas imputadas a ese
  centro (las facturas emitidas no llevan centro). Desglose por cuenta en cada partida: el CRM enlaza al mayor
  (`/finance/ledger/:code?from&to`). Numeración de las partidas orientativa (1–18 y A.1–A.4).
- **Balance:** saldos a la fecha sin los asientos de cierre y apertura (se anulan entre sí). Grupos 1, 2 y 3 con partida
  fija; grupos 4 y 5 según el signo del saldo de cada subcuenta (un banco en descubierto va a deudas a corto plazo; un
  cliente con saldo acreedor, a acreedores). Patrimonio neto con el resultado del ejercicio en curso (grupos 6 y 7 del
  año) y el pendiente de aplicar (129 y los grupos 6 y 7 de ejercicios anteriores sin regularizar). Tras la regularización
  el resultado aparece en 129. El cuadre (`check`) se muestra siempre.
- **Tesorería:** cuentas 57… (bancos 572000NN, caja 570000NN y Stripe 5720). Saldo inicial = saldo anterior + asientos
  del diario APE del rango (aperturas manuales). Entradas y salidas por cuenta (los traspasos entre cuentas de tesorería,
  como un payout, se cuentan en la cuenta y aparte como `internal…`). Por naturaleza, según la contrapartida del asiento:
  `customers` (43, 44, 438, 70), `suppliers` (40, 41), `taxes` (47 salvo 465/476, 63), `payroll` (465, 476, 64) y
  `other`. Identidad comprobada: saldo final − inicial = entradas − salidas.
- **Previsión (`isForecast: true`):** saldo de tesorería de hoy; cobros de facturas propias pendientes a 30 días de su
  fecha (las ya vencidas NO se proyectan: van en `excluded`); pagos de gastos registrados pendientes a su vencimiento (los
  vencidos, mañana); obligaciones fiscales con borrador «a ingresar» a su vencimiento (sin borrador, se listan sin importe).
- **Antigüedad:** cobros por cliente desde la fecha de la factura (las facturas propias no tienen vencimiento), con lo
  cobrado hasta la fecha pedida (Stripe y transferencias); pagos por proveedor desde el vencimiento (o la fecha de la
  factura), con los pagos hasta esa fecha. Tramos `current` (no vencido), `d0_30`, `d31_60`, `d61_90`, `d90_plus`.
- **Gastos:** grupo 6 del libro; por categoría (la del gasto cuyo asiento o reversión contiene la línea; el resto, por su
  cuenta «sin categoría»), por centro de coste o por proveedor.
- **Coste directo:** `fin_expense_categories.is_direct_cost` NULL = «según cuenta». Desde la parametrización fiscal
  (0039) la cuenta 626 **ya no** marca coste directo por sí sola: con NULL solo lo son las categorías de hosting o
  infraestructura (sugerencia por el nombre); el operador decide el resto con `PATCH /finance/categories/:id
  {isDirectCost}` (`null` vuelve a «según cuenta»). Las comisiones de Stripe van según `stripe_fees_treatment` (ver
  §Parametrización fiscal). La migración no escribe filas.
- **Revenue & Margin:** devengado = 70x del libro; cobrado = cobros de Stripe netos de reembolsos (bruto) + transferencias
  conciliadas; comisiones de Stripe = 626 de origen `stripe` (y su % sobre lo cobrado); margen bruto = devengado −
  comisiones − costes directos; estructura = resto del grupo 6; resultado = devengado + otros ingresos − grupo 6 (igual que
  la cuenta de resultados). Las métricas comerciales (MRR/ARR de `/revenue/metrics`, ventana de 30 días, y el top 10 de
  empresas por margen de `/resources/profitability`, 365 días) se consumen con las mismas funciones del plano de control,
  aparte y rotuladas «no contables»; la rentabilidad exige además `usage:read` (como su ruta).
- **Conversion Health:** cohorte por mes de la factura (porcentajes sobre el importe facturado): cobrado, liquidado
  (`liquidada` o `en_banco`) y en banco, con la cadena de conciliación de la fase 2; plazos medios con sus fechas (DSO
  factura→cobro, cobro→disponible —la última disponibilidad de los cobros positivos—, payout→banco). Por mes de la
  transacción: reembolsos y disputas netas sobre los cobros, cobros sin factura propia y tasa de pagos fallidos
  (`payment.failed` y `renewal.failed` frente a `payment.succeeded` y `renewal.paid` de `commercial_events`, del entorno
  comercial, en solo lectura y agregados en la BD; `order.dunning_notice` no cuenta). `/revenue/metrics` no publica embudo
  prueba → pago: `commercialFunnel: null`.
- **Control diario:** fecha por defecto hoy (Madrid). Facturas emitidas, cobros de Stripe, payouts con llegada y si están
  en banco, movimientos del día y pendientes de conciliar con antigüedad, gastos registrados ese día, pagos vencidos, de
  hoy y de 7 días, facturas pendientes de cobro con más de 30 días, incidencias de Stripe, obligaciones fiscales en 15 días
  y vencidas, y asientos en borrador; avisos derivados. **Revisión** idempotente: la primera guarda quién, cuándo, la nota y
  la instantánea de los recuentos; después solo cambia la nota (escritura condicional sobre la anterior: dos ediciones
  simultáneas no se pisan, la segunda recibe `conflict`), y cada paso queda en `fin_daily_review_log` y en
  `fin_audit_log` (`daily.review`, `daily.note`). Un día futuro no se revisa.
- **CSV:** `GET /finance/reports/:report.csv` para `pnl`, `balance`, `cashflow`, `aging`, `expenses`, `daily`,
  `revenue-margin` y `conversion-health` (mismos parámetros que su informe; «;», BOM, CRLF, euros con coma).

### API de la fase 4 (formas exactas)

| Ruta | Permiso | Respuesta |
|---|---|---|
| `GET /finance/daily?date` | lectura | `{date, today, counts, alerts, invoices, stripe, payouts, bank, expenses, receivables, tax, entries:{drafts}, review}` |
| `POST /finance/daily/:date/review {note?}` | contabilizar | `201` o `200` `{item: Review & {log}, created}` |
| `GET /finance/daily/reviews?from&to&limit&offset` | lectura | `{items: Review[], total}` |
| `GET /finance/reports/pnl?from&to&granularity&compare&costCenter` | lectura | `{from, to, granularity, costCenter, periods, compare, lines, result, notes}` |
| `GET /finance/reports/balance?date` | lectura | `{date, assets, equityAndLiabilities, check, result}` |
| `GET /finance/reports/cashflow?from&to&forecastDays` | lectura | `{from, to, accounts, totals, months, byNature, forecast}` |
| `GET /finance/reports/aging?side&date` | lectura | `{side, date, buckets, totals, parties, basis}` |
| `GET /finance/reports/expenses?from&to&groupBy&compare` | lectura | `{from, to, groupBy, months, compare, items, totals}` |
| `GET /finance/reports/:report.csv?…` | exportar | CSV |
| `GET /finance/analytics/revenue-margin?year` | lectura (+ `usage:read` para el top de empresas) | `{year, months, totals, ytd, definitions, commercial}` |
| `GET /finance/analytics/conversion-health?from&to` | lectura | `{from, to, asOf, months, totals, truncated, commercialFunnel, notes}` |
| `GET /finance/categories` · `PATCH /finance/categories/:id {…, isDirectCost}` | lectura · gestión | cada categoría con `isDirectCost` (bool o null) y `directCost` (resuelta) |

Valores: `granularity` = `month` | `quarter` | `year`; `compare` = `none` | `previous` | `year`; `forecastDays` = 0, 30,
60 o 90 (90 por defecto; 0 = sin previsión); `side` = `receivable` | `payable`; `groupBy` = `category` | `costCenter` |
`supplier`. Los ámbitos de cada palabra están en «Permisos». El detalle de cada objeto está en las pruebas de formas
(`server/finance/analysisApi.test.ts`).

## Parametrización fiscal (previa a los datos reales)

Regla de oro: **nada fiscal se presupone**. Si una regla no está configurada, el sistema avisa y no contabiliza a
ciegas; nunca elige por el operador. Migración `0039_finance_fiscal.sql` (aditiva: dos `ALTER TABLE … ADD COLUMN` NULL y
cinco tablas nuevas, sin escribir filas). Sin ella el arranque registra `{ctx:"FinanceFiscal", mounted:false,
reason:"migration_0039_missing"}`, todo funciona como antes y las rutas nuevas responden 404.

| Pieza | Fichero | Qué hace |
|---|---|---|
| Reglas puras | `opsRules.ts`, `stripeRules.ts`, `taxRules.ts`, `analysisRules.ts` | Tratamiento del IVA del gasto y su autoliquidación, resolución del IVA de las comisiones de Stripe, 303/349/347/libro con el tratamiento, presets y escala del 200, reservas, asiento del 200, Revenue & Margin por tratamiento |
| Almacenes | `opsStore.ts`, `stripeStore.ts`, `taxStore.ts`, `analysisStore.ts` | Columnas y tablas de la 0039 (solo con `fiscal`: la presencia de la migración se comprueba al arrancar con `finFiscalTablesReady`) |
| Servicios | `opsService.ts`, `stripeService.ts`, `taxService.ts`, `analysisService.ts` | Validaciones, puertas, vista previa sin escrituras, asiento del 200 |
| Pruebas | `fiscalRules.test.ts`, `fiscalService.test.ts`, `fiscalApi.test.ts`, `fiscal.mysql.test.ts` | Reglas, servicios en memoria, API con permisos y formas, MySQL real (0039 sobre 0033–0038 y vista previa sin escrituras) |

### 0. Validación de la configuración fiscal (puerta para datos reales)
`fin_tax_settings.validated_at/validated_by/validation_note`. `POST /tax/settings/validate {note}` (finance:config, sesión
de operador) la marca validada con la gestoría (queda en `fin_tax_settings_log` y en la auditoría). **Cualquier**
`PATCH /tax/settings` posterior la anula en el mismo guardado (traza: historial y auditoría `tax.settings.invalidated`).
Mientras no esté validada, los borradores se calculan y se ven con el aviso `tax_config_not_validated` («Borrador ·
configuración fiscal sin validar», no entra en la huella), pero **revisar y presentar** responden 409
`tax_config_not_validated`; el panel fiscal lo avisa. El historial (`GET /tax/settings` → `log`) marca la validación y su
anulación (`validation: "validated" | "invalidated"`).

### 1. IVA de las comisiones de Stripe
Modo global `stripeFeeVat`: `unset` (por defecto con la 0039, si nadie ha guardado la configuración), `exempt`,
`reverse_charge`, `domestic` (la entidad de Stripe factura con IVA español: el IVA soportado sale de su factura registrada
como gasto) y `per_invoice` (lo da la factura mensual de comisiones registrada como gasto, con su tratamiento). Con
`domestic` y `per_invoice` la importación solo lleva la comisión a 626, sin líneas de IVA; el código siempre escribe el
valor explícito (la columna conserva su valor por defecto de la fase 2, que no se usa).

Reglas `fin_stripe_fee_vat_rules` por tipo de comisión (tipo normalizado o el del informe: `charge`, `refund`,
`stripe_fee`, `application_fee`, `adjustment`… o `*`), emisor (nombre, país, NIF-IVA), tratamiento, tipo, vigencia y
documento que lo justifica. Sin edición: se anulan (`POST /stripe/fee-vat-rules/:id/void`) y se crea otra. Resolución
para una transacción: la regla vigente en su fecha con el tipo exacto; si no, la de `*`; si no, el modo global (entre
varias vigentes, la de inicio más reciente). `reverse_charge` exige un emisor de otro Estado de la UE (español → 400
`invalid_rule`: es `domestic`) y el tipo.

Si el tratamiento resuelto es `unset` y la transacción tiene comisión, **no se contabiliza**: `POST /stripe/post` la deja
pendiente (`issueDetail` empieza por `fee_vat_unset`) y la cuenta en `pendingFeeVat`; `GET /stripe/settings` trae
`pendingFeeVatCount`; el control diario (`counts.stripeFeeVatUnset`, aviso `fee_vat_unset`), el panel fiscal y el borrador
del 303 del periodo lo avisan. La línea de IVA autoliquidado lleva la marca del emisor de la regla aplicada
(`emisor: Nombre (NIF-IVA)`): el 349 declara por emisor con ella (o, sin marca, con el NIF-IVA de Stripe de la
configuración fiscal).

**Factura de comisiones que liquida las importadas** (`settlesStripeFees`, columna `fin_expenses.settles_stripe_fees`): con
`per_invoice` o `domestic` la comisión ya está en 626 desde la importación, así que la factura de Stripe registrada como
gasto no la vuelve a llevar a 626. Solo se admite si el modo resuelto de las comisiones en su fecha de devengo (o de
factura) es `per_invoice` o `domestic` y el proveedor es la entidad de Stripe (nombre o razón social con «Stripe», o el
NIF-IVA de una regla de comisiones); si no, 400 `invalid_stripe_fee_invoice`. Es interior o de servicios
intracomunitarios (con `domestic`, solo interior), sin retención. Su asiento solo lleva el IVA:
- ISP (`intra_eu_services`): Debe 472 (y la parte no deducible a la cuenta de la categoría) · Haber 477 autoliquidado;
- interior (`domestic`): la comisión importada ya incluía el IVA español: Debe 472 · Haber 626 (la cuota deducible sale
  del gasto).

No hay cuenta de proveedor pendiente: al registrarla nace pagada (liquidada con el saldo de Stripe), sin pagos
(`payment_status = paid`; intentar pagarla responde 409). El 303, el 349, el libro de recibidas y el 347 la cuentan con
su base y cuota como cualquier factura recibida (es el documento fiscal); Revenue & Margin y la cuenta de resultados no
cambian por la base (el 626 viene de la importación). En modo `per_invoice`, si un mes tiene comisiones importadas y
ninguna factura `settlesStripeFees` registrada, el panel fiscal y el borrador del 303 avisan
`stripe_fee_invoice_missing`; si su base difiere de las comisiones importadas del mes (comisión de cada transacción en
euros y los cargos de Stripe por otros servicios) en más de 1 €, `stripe_fee_invoice_difference` con la diferencia.

**Vista previa** `POST /stripe/imports/preview` (finance:expenses, mismo cuerpo que `/stripe/imports`): lo que se leería,
lo ya importado, totales en euros por tipo, cómo se resolvería el IVA de cada comisión y hasta 50 asientos propuestos.
**Cero escrituras** (ni importación, ni transacciones, ni asientos, ni auditoría; probado contra MySQL). Es lo que se usa
con un CSV real en production antes de importarlo.

### 2. Gastos con inversión del sujeto pasivo y operaciones intracomunitarias
`fin_expenses.vat_treatment` (NULL = interior, como hasta ahora) y `reverse_charge_rate_bp`:

| Tratamiento | Factura | Asiento | 303 | 349 | 347 |
|---|---|---|---|---|---|
| `domestic` (o NULL) | con IVA | 472 por la cuota deducible | 28/29 | clave I si el proveedor es de la UE (como antes, con aviso de ISP sin autoliquidar a 0 %) | sí |
| `intra_eu_services` | sin IVA | autoliquidación Debe 472 / Haber 477 | 10/11 y 36/37 | clave I | no |
| `intra_eu_goods` | sin IVA | autoliquidación 472/477 | 10/11 y 36/37 | clave A | no |
| `reverse_charge_domestic` | sin IVA | autoliquidación 472/477 | 12/13 y 28/29 | no | sí |
| `non_eu_services` | sin IVA | autoliquidación 472/477 | 12/13 y 28/29 | no | (fuera de España: no) |
| `import` | IVA del DUA | 472 por la cuota del documento aduanero | 32/33 | no | no |
| `exempt` / `not_subject` | sin IVA | sin IVA | — | no | sí |

Con ISP la factura viene sin IVA (tipo 0) y el tipo de la autoliquidación es obligatorio (400 si falta); la parte no
deducible (`deductibleBp < 10000`) va a mayor gasto. Las líneas 472/477 llevan tipo y base; el 303 sabe que son ISP por
el tratamiento del gasto cuyo asiento las contiene (`expenseTreatmentsByEntries`). `intra_eu_*` exige proveedor de otro
Estado de la UE con NIF-IVA (400 `vat_id_required` si falta), y se vuelve a comprobar al registrar. La rectificativa sigue
el tratamiento de la factura que rectifica si no se indica otro. El libro de recibidas añade las columnas «Inversión del
sujeto pasivo» (ya existía) y «Tratamiento IVA». Las casillas 32/33 y 12/13 del 390 solo aparecen si hay importes (así la
huella de los borradores ya presentados no cambia). Los gastos registrados antes no cambian. Las plantillas de gastos
recurrentes no llevan tratamiento (otra tabla): su borrador nace interior y se ajusta antes de registrarlo.

### 3. Impuesto sobre Sociedades por ejercicio
`fin_tax_corporate_years` (régimen `general|nueva_creacion|erd|microempresa|otro`, tramos `[{uptoCents|null, rateBp}]` con
el último sin tope, cifra de negocios del ejercicio anterior, reserva de capitalización —incremento de fondos propios,
tasa y límite— y de nivelación) con versión optimista y bitácora `fin_tax_corporate_year_log` (antes/después).
`GET /tax/corporate/presets?year` propone, con su cita y «Propuesta: confírmala con tu gestoría»: general 25 %; nueva
creación 15 %; desde 2025, microempresa (cifra de negocios < 1 M€: 2025 21/22 %, 2026 20/21 %, 2027 19/21 %, 2028
18/20 %, después 17/20 %, primer tramo hasta 50.000 €) y entidad de reducida dimensión (< 10 M€: 2025 24 %, 2026 23 %,
2027 22 %, 2028 21 %, después 20 %). Se guardan los tramos, no el nombre.

El 200 configurado: base previa → reserva de capitalización (art. 25 LIS: menor de incremento × tasa y base previa ×
límite; casilla 01032; aviso permanente de dotar la reserva indisponible y mantener el incremento 3 años) → nivelación
(solo ERD/microempresa: hasta el 10 % de la base y 1 M€) → bases negativas (límite sobre la base previa) → base imponible
→ cuota por tramos (detalle de cada tramo en `details` y `brackets` en la API). Sin configurar: el tipo único de la
configuración fiscal de antes con el aviso `corporate_year_unset`, y el 200 no se puede revisar ni presentar (409
`corporate_year_unset`). Los pagos fraccionados del art. 40.3 siguen con el tipo de la configuración fiscal.

### 4. Asiento del Impuesto sobre Sociedades
`POST /tax/corporate/:year/entry` (finance:tax, operador) `{origin: system|manual|gestoria, date, currentTaxCents?,
deferredTaxCents?, withholdingsAndPaymentsCents?, note?, document?}`, diario **IMP** (no existen GES ni OPE), origen
`tax`: Debe 6300 (impuesto corriente) · Haber 473 (retenciones y pagos a cuenta, **hasta su saldo**; lo que exceda se
avisa) · Haber 4752 (a ingresar) o Debe 4709 (a devolver); diferido: gasto Debe 6301 · Haber 479; ingreso Debe 4740 ·
Haber 6301. `system` toma la cuota líquida (00592) y las retenciones y pagos fraccionados (00595 + 00598) del borrador;
`manual`/`gestoria` los teclea el operador (sin retenciones, el saldo de la 473) y se guarda la diferencia con el borrador.
Las cuentas que el plan sembrado no trae (6300, 6301, 474/4740 y 479) se dan de alta por código como subcuentas del PGC
al necesitarlas (auditadas; sin UPDATE). Registro `fin_tax_corporate_entries`: `tax:200:entry:<año>` y, tras revertir,
`tax:200:entry:<año>:<n>`; **uno vivo por ejercicio** (columna generada `live_year` con índice único). Corrección:
`POST /tax/corporate/:year/entry/reverse {reason}` (asiento espejo) y otro nuevo. Traza: documento en `fin_documents` con
propietario `tax_200_entry` (la columna admite 16 caracteres), bitácora de la obligación 200 (si existe) y auditoría.

### 5. Comisiones bancarias por naturaleza y análisis
`fin_analysis_settings` (una fila): `stripe_fees_treatment` `direct_cost` (por defecto: coste del cobro, en el margen) |
`structure` | `financial` (resultado financiero del análisis, fuera del margen) y el mapa de naturalezas → cuenta:
`servicio` 626, `cobro` 626, `financiera` 669, `intereses` 662, `custodia` 626 (editables; cuenta existente, activa,
imputable y del grupo 6). Conciliar un movimiento sin gasto acepta `nature` en lugar de `accountCode`
(`POST /bank-movements/:id/match {type, nature, description?}`): se resuelve a la cuenta configurada y la naturaleza queda
en la descripción del asiento («· naturaleza: …») y en la auditoría. Revenue & Margin añade `financialCostsCents`
(66x y, con `financial`, las comisiones de Stripe) y `stripeFeesTreatment`; la estructura ya no incluye los 66x. La
cuenta de resultados sigue el PGC (669/662 ya son resultado financiero).

### API de la parametrización fiscal (formas exactas)

| Ruta | Permiso | Petición | Respuesta |
|---|---|---|---|
| `POST /tax/settings/validate` | config + operador | `{note}` (3–500) | `{item: TaxSettings}` con `validatedAt, validatedBy, validationNote` |
| `GET /tax/corporate/presets?year` | read | — | `{items: [{key, regime, label, brackets, capReserveLimitBp, citation, notice}]}` |
| `PUT /tax/corporate/:year/config` | tax + operador | `{regime, brackets:[{uptoCents|null, rateBp}], netTurnoverCents?, capReserveEquityIncreaseCents?, capReserveRateBp?, capReserveLimitBp?, levellingReserveCents?, notes?, expectedVersion?}` | `{item: {year, regime, brackets, netTurnoverCents, capReserveEquityIncreaseCents, capReserveRateBp, capReserveLimitBp, levellingReserveCents, notes, configuredBy, configuredAt, version}}` |
| `POST /tax/corporate/:year/entry` | tax + operador | `{origin, date, currentTaxCents?, deferredTaxCents?, withholdingsAndPaymentsCents?, note?, document?:{filename, contentBase64}}` | 201 `{item: CorporateEntry, warnings: string[]}` |
| `POST /tax/corporate/:year/entry/reverse` | tax + operador | `{reason}` | `{item: CorporateEntry}` |
| `POST /stripe/imports/preview` | expenses | `{kind, filename, contentBase64}` | `{kind, filename, rows, parsed, skipped, warnings:[{line, message}], alreadyImported, previousImportId, duplicates, nonEur, sample, totals:{grossCents, feeCents, netCents, byType}, feeVat:{resolved, unset}|null, wouldPost:[{balanceTransactionId, date, description, lines:[{account, debitCents, creditCents}]}]}` |
| `GET /stripe/fee-vat-rules` | read | — | `{items: Rule[]}` |
| `POST /stripe/fee-vat-rules` | config + operador | `{feeKind, issuerName, issuerCountry, issuerVatId?, treatment, rateBp?, validFrom, validTo?, documentRef?, note?}` | 201 `{item: Rule}` |
| `POST /stripe/fee-vat-rules/:id/void` | config + operador | `{reason}` | `{item: Rule}` |
| `GET /analysis/settings` | read | — | `{item: {stripeFeesTreatment, bankFeeAccounts, natures:[{key, label, accountCode}], configuredBy, configuredAt}}` |
| `PATCH /analysis/settings` | config + operador | `{stripeFeesTreatment?, bankFeeAccounts?: {servicio?, cobro?, financiera?, intereses?, custodia?}}` | igual que el GET |

`Rule` = `{id, feeKind, issuerName, issuerCountry, issuerVatId, treatment, rateBp, validFrom, validTo, documentRef, note,
createdBy, createdAt, voidedBy, voidedAt, voidReason, active}`. `CorporateEntry` = `{entryId, entryNumber, origin,
currentTaxCents, deferredTaxCents, date, createdBy, createdAt, documentId, differenceFromDraftCents}` más `id, year,
sourceKey, withholdingsCents, draftCurrentTaxCents, note, reversalEntryId, reversedAt, reversedBy, reverseReason`.

Cambios en formas existentes (con la 0039): `GET /tax/settings` → `item` con `validatedAt, validatedBy, validationNote`;
los borradores (`draft` de una obligación, `/tax/models/:model/preview`, `/tax/corporate/:year`) añaden al principio de
`warnings` `{code:"tax_config_not_validated"}` mientras no esté validada; `GET /tax/corporate/:year` → `item` añade
`config, configLog, presets, capitalizationReserveCents, brackets:[{fromCents, uptoCents, rateBp, baseCents, quotaCents}],
entry, entryHistory`; `GET /stripe/settings` → `item.pendingFeeVatCount` y `stripeFeeVat` con los cinco valores;
`POST /stripe/post` → `pendingFeeVat`; `POST|PATCH /expenses` aceptan `vatTreatment, reverseChargeRateBp` y las fichas
los devuelven, igual que `settlesStripeFees` (boolean, falso por defecto); `POST /bank-movements/:id/match` acepta `{type, nature, description?}`; `GET /daily` → `counts` añade
`stripeFeeVatUnset`; `GET /analytics/revenue-margin` añade `stripeFeesTreatment` y `financialCostsCents` (meses, totales
y acumulado); el panel fiscal avisa `tax_config_not_validated` y `fee_vat_unset`. Avisos nuevos del panel fiscal y del 303: `stripe_fee_invoice_missing` y
`stripe_fee_invoice_difference`. Errores nuevos: 409 `tax_config_not_validated`, 409 `corporate_year_unset`, 400
`vat_id_required`, 400 `invalid_rule`, 400 `invalid_stripe_fee_invoice`.

## Automatización e integridad (01/11/2026)

Motivo: el primer cobro real (Nextair, 1.210 € el 01/11/2026) llegó a Stripe y al webhook, pero la contabilidad seguía a
cero. La cadena se cortaba en la factura propia: nadie lanzaba la generación de borradores (solo un botón), la
expedición está apagada hasta decidir DF-2, no había ejercicio dado de alta y la clave restringida de Stripe no tiene
permiso de lectura de saldo ni de payouts.

**Tarea automática** (`server/finance/automation.ts`, cada 15 minutos, una réplica con `GET_LOCK`, sin interruptor:
solo escribe en el libro propio y en borradores). Pasos idempotentes, el fallo de uno no detiene los demás:

1. Ejercicio: si no hay ninguno, da de alta el del año en curso (sin saldos; la apertura queda pendiente).
2. Configuración fiscal: si nadie la ha guardado, guarda los datos confirmados del emisor (razón social, NIF, ejercicio
   natural) con lo que falta por confirmar en las notas. Queda **sin validar**.
3. Borradores de factura de los servicios externos y su estado de cobro (`InvoicingService.generateExternal`). Nunca expide.
4. Facturas expedidas al libro (`invoice:<id>`), solo si hay pendientes.
5. Stripe por API (`server/finance/stripeBalanceApi.ts`): GET de transacciones de saldo, payouts y la factura de cada cobro
   (por su PaymentIntent) con la clave del plano de control; se importan con la misma deduplicación que el CSV
   (`stripe-txn:<id>`, `stripe-payout:<id>`; una lectura idéntica no crea otra importación) y se contabiliza lo pendiente.
   Sin permisos, el paso queda `unavailable` con los permisos que faltan (`balance_read`, `payout_read`). El CSV sigue
   como vía complementaria de conciliación y recuperación.

Cada pasada se guarda en la auditoría (`automation.run`) si cambia algo o cada hora.

**Integridad** (`server/finance/integrity.ts`, solo lectura). Contrasta los hechos confirmados por el webhook
(`external_subscription_events`: `invoice_paid`, `invoice_payment_failed`, `charge_refunded`, `charge_dispute`) con la
factura propia, la transacción de Stripe contabilizada, el ejercicio, la apertura, la configuración fiscal, los bancos,
los gastos y la última pasada. Sus incidencias (con `source`, `action` y `amountCents`) se suman a las del control diario
de hoy: `automation_stale`, `automation_errors`, `stripe_source_unavailable`, `confirmed_payment_unposted`,
`confirmed_payment_without_invoice`, `invoice_drafts_due`, `payment_failed`, `subscription_overdue`, `refund_unposted`,
`dispute_open`, `fiscal_year_missing`, `opening_entry_pending`, `fiscal_config_missing`, `fiscal_config_unvalidated`,
`bank_not_configured`, `bank_without_statements`, `expenses_unposted`, `expenses_uncategorized` y
`stripe_ledger_difference`.

`GET /finance/overview` (`finance:read`): doce indicadores (ingresos devengados, facturación emitida, cobros recibidos y
pendientes, saldo en Stripe, saldo bancario, gastos devengados y pagados, IVA repercutido y soportado, resultado y
tesorería) con `state`: `value`, `zero` (cero real: la fuente está completa), `pending` (hay hechos confirmados sin
llevar al libro o a la factura, en `pendingCents`) o `unavailable` (falta la fuente). Además el estado del ejercicio, la
apertura, la configuración fiscal, los bancos, la fuente de Stripe y la expedición, las listas `pendingSync` y
`unavailable`, los cobros confirmados del año y `definitive` (false mientras falte la apertura o haya algo pendiente).

**Comisión de Stripe con el IVA sin decidir (02/11/2026).** El cobro ya no espera a esa decisión. Se contabiliza
`stripe-txn:<id>` con Debe 5720 (neto), Debe **555** (comisión, sin IVA) y Haber 430 (bruto), y la transacción queda
marcada `fee_vat_pending`. Cuando hay regla o modo global decidido, `classifyProvisionalFees` (en cada contabilización)
genera `stripe-fee-class:<id>`: Debe 626 / Haber 555 y, con inversión del sujeto pasivo, la autoliquidación 472 / 477.
La fecha es la del cobro si su periodo sigue abierto; si no, la de ese día. El asiento del cobro no se toca. El control
diario sigue avisando (`fee_vat_unset`) y el panel muestra la 555 como «provisional». Un payout llegado sin cuenta
bancaria de destino no se contabiliza ni se da por recibido: queda pendiente (`payout_awaiting_bank`).

## Permisos

Cada capacidad tiene su ámbito propio (`finance:*`, en `server/controlPlane/auth.ts`), centralizado en
`server/finance/permissions.ts` y exigido siempre en el servidor; el CRM solo oculta lo que no se puede.
`server/finance/permissions.test.ts` recorre el router completo y falla si alguna ruta de `/finance` queda sin ámbito o
exige uno distinto del previsto en su tabla de rutas.

| Ámbito | Capacidad | Además | Rutas |
|---|---|---|---|
| `finance:read` | Consulta financiera | — | Todos los `GET` salvo exportaciones (libro, operaciones, Stripe y conciliación, gestoría, control diario, informes y análisis; el top de empresas por rentabilidad exige además `usage:read`) |
| `finance:expenses` | Gestión de gastos | — | Centros de coste y categorías (también la marca de coste directo), borradores de gastos, documentos, recurrentes (y su ejecución), cuentas bancarias y cajas, importar extractos e informes de Stripe, ignorar movimientos |
| `finance:suppliers` | Gestión de proveedores | — | `POST /suppliers` · `PATCH /suppliers/:id` |
| `finance:post` | Contabilización | sesión de operador | Asientos manuales, contabilizar, anular borradores y revertir, sincronizar facturas, registrar y anular gastos, pagos y su reversión, conciliar y desvincular (bancos, payouts, cobros), movimientos de caja, contabilizar Stripe, revisar incidencias, nóminas (alta, asiento y pago), revisión diaria |
| `finance:tax` | Gestión fiscal (gestoría) | sesión de operador | Generar el calendario, calcular, revisar, presentar (registro), pagar y marcar obligaciones, aplazamientos y sus cuotas, expedientes, ajustes del 200 |
| `finance:config` | Configuración | sesión de operador | Plan contable (`POST /accounts`, `PATCH /accounts/:code`), alta de ejercicios, configuración de Stripe y configuración fiscal |
| `finance:export` | Exportaciones | — | `journal.csv`, `trial-balance.csv`, `reports/:report.csv`, libros registro (`tax/registers/*.csv`) y `tax/export.zip` |
| `finance:sensitive` | Operaciones sensibles | sesión de operador | Cerrar y reabrir periodos, cerrar ejercicios, cerrar el trimestre fiscal y reabrir obligaciones presentadas |

«Sesión de operador» = solo personas con cookie de operador; nunca un token de servicio ni una sesión SSO. Las
capacidades sin esa marca admiten también tokens de servicio que tengan el ámbito. **Tokens de servicio: sin acceso a
finanzas por defecto**; ninguno lo tiene hoy y solo se concedería, con el ámbito mínimo, a una integración existente e
identificada que lo necesite.

El alta de una cuenta bancaria o de una caja crea su subcuenta en el plan contable desde el servicio (alta derivada):
basta `finance:expenses`, sin `finance:config`.

**Reparto por rol** (`server/controlPlane/operatorRoles.ts`; antes todo dependía de `billing:read`/`billing:write` y de
los roles `admin|superadmin` para cierres y configuración):

| Rol | Antes | Después |
|---|---|---|
| `superadmin` | todo (billing:read + billing:write + rol) | los ocho `finance:*` |
| `admin` | todo (billing:read + billing:write + rol) | los ocho `finance:*` |
| `sales` (comercial) | consulta y exportaciones (billing:read) | ninguno: conserva la consulta comercial (facturación, cobros, métricas) con `billing:read`, sin contabilidad, gestoría ni exportaciones |
| `readonly` | consulta y exportaciones (billing:read) | `finance:read` (pierde las exportaciones CSV/ZIP) |
| `support` | nada | nada |

La facturación (`billing:*`: facturas, cobros, cobros en riesgo, tarifas) no cambia: ver finanzas ya no depende de
`billing:*` ni ver facturación de `finance:*`.

**Denegaciones registradas:** cada 403 de `/finance` deja una línea en el log estructurado
`{ctx:"Finance", event:"permission_denied", method, route, scope, reason, actorType, actorId, requestId}`, con el patrón
de la ruta (sin identificadores) y sin cuerpo ni parámetros. `reason` = `missing_scope` | `operator_session_required`.

## Fases siguientes

- **2 · Cobros y conciliación:** implementada (ver arriba). Pendiente: lector por API de Stripe (punto de extensión).
- **3 · Gestoría e impuestos:** implementada (ver arriba). La autoliquidación de la ISP de los gastos y el asiento del
  Impuesto sobre Sociedades llegan con la parametrización fiscal (0039). Pendiente: ejercicio no natural, 303 mensual
  afinado, tratamiento del IVA en las plantillas de gastos recurrentes y el art. 40.3 con escala por tramos.
- **4 · Análisis:** implementada (ver arriba). Pendiente: embudo comercial prueba → pago cuando `/revenue/metrics` lo
  publique, y vencimiento propio de las facturas emitidas (hoy la antigüedad y la previsión cuentan desde su fecha).
