/**
 * Servicio de operaciones (fase 1B) en memoria sobre el libro de la fase 1A: catálogos, proveedores, gastos con su
 * asiento, pagos, documentos, recurrentes, bancos, extractos, conciliación y caja. Sobre todo, las reglas de UNICIDAD
 * del hecho económico: pago manual + movimiento vinculado = un solo asiento; movimiento que crea el pago =
 * `bankmov:<id>`; desvincular revierte solo lo que creó el vínculo; anular un gasto exige revertir antes sus pagos;
 * un extracto no se importa dos veces.
 */
import { describe, expect, it } from "vitest";
import { FinanceOpsService } from "./opsService";
import { FINANCE_RECURRING_LOCK, financeRecurringTick, startFinanceRecurringScheduler } from "./recurringScheduler";
import { memoryLock } from "../trials/scheduler";
import { MemoryFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { n43, norma43Sample, seededOps, seededPlan } from "./testkit";

const T0 = Date.UTC(2026, 9, 30, 10); // 30/10/2026
const ACTOR = { by: "operator:luis", requestId: "req-ops" };
const IBAN = "ES9121000418450200051332";
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

async function setup() {
  const ledger = new MemoryFinanceStore(seededPlan());
  let now = T0;
  const finance = new FinanceService({ store: ledger, now: () => now });
  await finance.createFiscalYear(2026, ACTOR);
  const store = new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store, finance, ledger, now: () => now });
  const cat = (await ops.categories()).find((c) => c.name === "Hosting e infraestructura en la nube")!;
  const supplier = await ops.createSupplier({ name: "Hosting Nube SL", taxId: "B12345674", paymentTermsDays: 30, defaultCategoryId: cat.id }, ACTOR);
  const bank = await ops.createBankAccount({ name: "CaixaBank principal", iban: IBAN, bankName: "CaixaBank", openingDate: "2026-01-01" }, ACTOR);
  const newExpense = (o: Partial<Parameters<FinanceOpsService["createExpense"]>[0]> = {}) => ops.createExpense({ kind: "invoice", supplierId: supplier.id, categoryId: cat.id, invoiceNumber: "F-2026-10", invoiceDate: "2026-10-01", description: "Servidores octubre", baseCents: 100_000, taxRateBp: 2100, ...o }, ACTOR);
  const entries = async () => (await ledger.listEntries({ limit: 200 })).items;
  const balance = async (code: string) => (await finance.ledger(code, "2026-01-01", "2026-12-31")).closingCents;
  return { ledger, finance, store, ops, cat, supplier, bank, newExpense, entries, balance, setNow: (t: number) => (now = t) };
}

describe("catálogos y proveedores", () => {
  it("siembra de 0034 (categorías y centro General), altas, duplicados y validaciones", async () => {
    const { ops, supplier } = await setup();
    expect((await ops.costCenters()).map((c) => c.code)).toEqual(["GENERAL"]);
    const cats = await ops.categories();
    expect(cats).toHaveLength(19);
    expect(cats.find((c) => c.name === "Comisiones bancarias")).toMatchObject({ accountCode: "626", defaultTaxRateBp: 0 });
    expect(await ops.createCostCenter({ code: "marketing", name: "Marketing" }, ACTOR)).toMatchObject({ code: "MARKETING", active: true });
    await expect(ops.createCostCenter({ code: "MARKETING", name: "Otro" }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await expect(ops.createCategory({ name: "Cobros", accountCode: "705" }, ACTOR)).rejects.toMatchObject({ code: "invalid_account" });
    await expect(ops.createCategory({ name: "Inexistente", accountCode: "699" }, ACTOR)).rejects.toMatchObject({ code: "invalid_account" });
    expect(await ops.createCategory({ name: "Dietas", accountCode: "629", defaultTaxRateBp: 1000 }, ACTOR)).toMatchObject({ accountCode: "629", defaultTaxRateBp: 1000 });

    expect(supplier).toMatchObject({ taxId: "B12345674", accountCode: "410", country: "ES", active: true });
    await expect(ops.createSupplier({ name: "Duplicado", taxId: "b-12345674" }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await expect(ops.createSupplier({ name: "Malo", taxId: "B12345675" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(ops.createSupplier({ name: "IBAN malo", iban: "ES9121000418450200051333" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await ops.createSupplier({ name: "AWS EMEA", country: "LU", taxId: "LU26375245", iban: "LU280019400644750000", accountCode: "400" }, ACTOR)).toMatchObject({ country: "LU", accountCode: "400" });
    expect((await ops.patchSupplier(supplier.id, { active: false }, ACTOR)).active).toBe(false);
    expect((await ops.suppliers({ active: true })).total).toBe(1);
    expect((await ops.suppliers({ q: "nube" })).items[0].id).toBe(supplier.id);
  });

  it("alta de banco y de caja: subcuentas 572000NN y 570000NN en el plan contable (sin rol de administración)", async () => {
    const { ops, ledger, bank } = await setup();
    expect(bank).toMatchObject({ accountCode: "57200001", iban: IBAN, balanceCents: 0 });
    const second = await ops.createBankAccount({ name: "BBVA" }, ACTOR);
    expect(second.accountCode).toBe("57200002");
    await expect(ops.createBankAccount({ name: "Repetido", iban: "ES91 2100 0418 4502 0005 1332" }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    const cash = await ops.createCashAccount({ name: "Caja oficina" }, ACTOR);
    expect(cash.accountCode).toBe("57000001");
    const plan = await ledger.listAccounts();
    expect(plan.find((a) => a.code === "57200001")).toMatchObject({ parentCode: "572", type: "asset", isPostable: true, name: "Banco: CaixaBank principal" });
    expect(plan.find((a) => a.code === "57000001")).toMatchObject({ parentCode: "570", name: "Caja: Caja oficina" });
  });
});

describe("gastos: borrador, registro, rectificativa y anulación", () => {
  it("el servidor calcula importes; registrar contabiliza expense:<id> una sola vez", async () => {
    const { ops, newExpense, entries } = await setup();
    const e = await newExpense({ withholdingRateBp: 1500, deductibleBp: 10_000 });
    expect(e).toMatchObject({ status: "draft", taxCents: 21_000, withholdingCents: 15_000, totalCents: 121_000, paidCents: 0, dueDate: "2026-10-31", paymentStatus: "pending" });
    expect(ops.expenseDto(e).pendingCents).toBe(106_000);
    const edited = await ops.patchExpense(e.id, { baseCents: 200_000 }, ACTOR);
    expect(edited).toMatchObject({ taxCents: 42_000, totalCents: 242_000, withholdingCents: 30_000 });
    const r1 = await ops.registerExpense(e.id, ACTOR);
    expect(r1).toMatchObject({ status: "registered", registeredBy: "operator:luis" });
    const r2 = await ops.registerExpense(e.id, ACTOR);
    expect(r2.entryId).toBe(r1.entryId);
    const all = await entries();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ sourceKey: `expense:${e.id}`, origin: "expense", journalCode: "COM", status: "posted", date: "2026-10-01" });
    expect(all[0].lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["629", 200_000, 0],
      ["472", 42_000, 0],
      ["4751", 0, 30_000],
      ["410", 0, 212_000],
    ]);
    await expect(ops.patchExpense(e.id, { baseCents: 1 }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("una factura por proveedor y número mientras no esté anulada; sin número no se registra", async () => {
    const { ops, newExpense } = await setup();
    const e = await newExpense();
    await expect(newExpense()).rejects.toMatchObject({ code: "conflict" });
    await ops.voidExpense(e.id, "Importe equivocado", ACTOR);
    expect((await newExpense()).status).toBe("draft");
    const noNumber = await newExpense({ invoiceNumber: null });
    await expect(ops.registerExpense(noNumber.id, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const ticket = await ops.createExpense({ kind: "ticket", categoryId: noNumber.categoryId, invoiceDate: "2026-10-02", description: "Taxi", baseCents: 1_000, taxRateBp: 1000 }, ACTOR);
    expect((await ops.registerExpense(ticket.id, ACTOR)).status).toBe("registered");
    await expect(newExpense({ baseCents: -5 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rectificativa con base NEGATIVA: asiento invertido y devolución (pago negativo)", async () => {
    const { ops, newExpense, bank, ledger, balance } = await setup();
    const orig = await ops.registerExpense((await newExpense()).id, ACTOR);
    await expect(ops.createExpense({ kind: "rectification", supplierId: orig.supplierId, categoryId: orig.categoryId, invoiceNumber: "R-1", invoiceDate: "2026-10-10", description: "Abono", baseCents: 20_000, taxRateBp: 2100, rectifiesExpenseId: orig.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const rect = await ops.createExpense({ kind: "rectification", supplierId: orig.supplierId, categoryId: orig.categoryId, invoiceNumber: "R-1", invoiceDate: "2026-10-10", description: "Abono", baseCents: -20_000, taxRateBp: 2100, rectifiesExpenseId: orig.id }, ACTOR);
    expect(rect).toMatchObject({ taxCents: -4_200, totalCents: -24_200 });
    const reg = await ops.registerExpense(rect.id, ACTOR);
    const entry = (await ledger.getEntry(reg.entryId!))!;
    expect(entry.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["629", 0, 20_000],
      ["472", 0, 4_200],
      ["410", 24_200, 0],
    ]);
    await expect(ops.addPayment(rect.id, { paidOn: "2026-10-12", amountCents: 24_200, method: "bank", bankAccountId: bank.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const refund = await ops.addPayment(rect.id, { paidOn: "2026-10-12", amountCents: -24_200, method: "bank", bankAccountId: bank.id }, ACTOR);
    expect(refund.expense).toMatchObject({ paymentStatus: "paid", pendingCents: 0 });
    expect(await balance("57200001")).toBe(24_200);
  });
});

describe("pagos", () => {
  it("pago manual expense-payment:<id>; parcial y total; no se paga de más; anular exige revertir los pagos", async () => {
    const { ops, newExpense, bank, entries, balance } = await setup();
    const e = await ops.registerExpense((await newExpense()).id, ACTOR);
    await expect(ops.addPayment(e.id, { paidOn: "2026-10-15", amountCents: 121_001, method: "bank", bankAccountId: bank.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(ops.addPayment(e.id, { paidOn: "2026-10-15", amountCents: 100, method: "bank" }, ACTOR)).rejects.toMatchObject({ message: "Elige la cuenta bancaria del pago" });
    const p1 = await ops.addPayment(e.id, { paidOn: "2026-10-15", amountCents: 21_000, method: "bank", bankAccountId: bank.id, reference: "TR-1" }, ACTOR);
    expect(p1.expense).toMatchObject({ paymentStatus: "partial", paidCents: 21_000, pendingCents: 100_000 });
    expect(p1.item).toMatchObject({ status: "posted", method: "bank", bankAccountId: bank.id, bankMovementId: null });
    const p2 = await ops.addPayment(e.id, { paidOn: "2026-10-16", amountCents: 100_000, method: "stripe" }, ACTOR);
    expect(p2.expense).toMatchObject({ paymentStatus: "paid", pendingCents: 0 });
    const payEntries = (await entries()).filter((x) => x.origin === "expense_payment");
    expect(payEntries.map((x) => [x.sourceKey, x.journalCode])).toEqual(expect.arrayContaining([[`expense-payment:${p1.item.id}`, "BAN"], [`expense-payment:${p2.item.id}`, "STR"]]));
    expect(await balance("410")).toBe(0);
    expect(await balance("57200001")).toBe(-21_000);

    await expect(ops.voidExpense(e.id, "Duplicada", ACTOR)).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/reviértelos/) });
    expect(await ops.reversePayment(p1.item.id, "Error de importe", ACTOR)).toMatchObject({ status: "reversed", reversedBy: "operator:luis" });
    await expect(ops.reversePayment(p1.item.id, "Otra vez", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    await ops.reversePayment(p2.item.id, "Error", ACTOR);
    expect((await ops.expense(e.id)).paymentStatus).toBe("pending");
    const voided = await ops.voidExpense(e.id, "Factura duplicada", ACTOR);
    expect(voided).toMatchObject({ status: "void", voidReason: "Factura duplicada" });
    // Todo revertido: el libro queda a cero en las cuentas tocadas
    for (const code of ["410", "629", "472", "57200001", "5720"]) expect(await balance(code)).toBe(0);
    const all = await entries();
    expect(all.filter((x) => x.origin === "reversal")).toHaveLength(3);
    expect(all.filter((x) => x.status === "posted" && x.origin !== "reversal").every((x) => x.reversedByEntryId !== null)).toBe(true);
  });

  it("periodo cerrado: el pago no se guarda vigente y no hay asiento", async () => {
    const { ops, finance, newExpense, bank, store } = await setup();
    const e = await ops.registerExpense((await newExpense()).id, ACTOR);
    await finance.setPeriodStatus(2026, 9, "closed", ACTOR);
    await expect(ops.addPayment(e.id, { paidOn: "2026-09-30", amountCents: 1_000, method: "bank", bankAccountId: bank.id }, ACTOR)).rejects.toMatchObject({ code: "period_closed" });
    expect(store.payments).toHaveLength(0);
    expect((await ops.expense(e.id)).paidCents).toBe(0);
  });
});

describe("bancos: extractos, conciliación y unicidad del hecho económico", () => {
  async function imported() {
    const s = await setup();
    const imp = await s.ops.importStatement({ bankAccountId: s.bank.id, format: "norma43", filename: "octubre.n43", contentBase64: b64(norma43Sample()) }, ACTOR);
    const movs = (await s.ops.movements({ bankAccountId: s.bank.id, limit: 50 })).items.sort((a, b) => a.id - b.id);
    return { ...s, imp, movs };
  }

  it("Norma 43: importa, guarda el fichero; el mismo extracto dos veces → conflict; solapado → duplicados", async () => {
    const { ops, bank, imp, movs, store } = await imported();
    expect(imp).toMatchObject({ rows: 4, inserted: 4, duplicates: 0, format: "norma43", importedBy: "operator:luis" });
    expect(movs.map((m) => [m.amountCents, m.status])).toEqual([
      [-350, "pending"],
      [-121_000, "pending"],
      [250_000, "pending"],
      [-350, "pending"],
    ]);
    expect(await ops.documents("bank_import", imp.id)).toHaveLength(1);
    await expect(ops.importStatement({ bankAccountId: bank.id, format: "norma43", filename: "otra-vez.n43", contentBase64: b64(norma43Sample()) }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    // Mismo contenido con otro final de línea: otro sha256, mismos movimientos → todos duplicados
    const again = await ops.importStatement({ bankAccountId: bank.id, format: "norma43", filename: "lf.n43", contentBase64: b64(norma43Sample().replace(/\r\n/g, "\n")) }, ACTOR);
    expect(again).toMatchObject({ rows: 4, inserted: 0, duplicates: 4 });
    expect(store.movements).toHaveLength(4);
    // El extracto de otra cuenta se rechaza
    const other = await ops.createBankAccount({ name: "Otra", iban: "GB82WEST12345698765432" }, ACTOR);
    expect((await ops.importStatement({ bankAccountId: other.id, format: "norma43", filename: "x.n43", contentBase64: b64(norma43Sample()) }, ACTOR)).inserted).toBe(4);
    const es = await ops.createBankAccount({ name: "ES otra", iban: "ES7921000813610123456789" }, ACTOR);
    await expect(ops.importStatement({ bankAccountId: es.id, format: "norma43", filename: "x.n43", contentBase64: b64(norma43Sample()) }, ACTOR)).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/es de la cuenta/) });
  });

  it("pago a mano y DESPUÉS su movimiento: vincular no crea asiento; desvincular no revierte nada", async () => {
    const { ops, newExpense, bank, movs, entries } = await imported();
    const e = await ops.registerExpense((await newExpense()).id, ACTOR);
    const pay = await ops.addPayment(e.id, { paidOn: "2026-10-04", amountCents: 121_000, method: "bank", bankAccountId: bank.id }, ACTOR);
    const mov = movs[1];
    const sug = await ops.suggestions(mov.id);
    expect(sug[0]).toMatchObject({ type: "expense_payment", expensePaymentId: pay.item.id, expenseId: e.id, supplierName: "Hosting Nube SL", amountCents: 121_000 });
    expect(sug[0].reasons).toContain("Importe exacto");
    const before = (await entries()).length;
    const matched = await ops.match(mov.id, { type: "expense_payment", expensePaymentId: pay.item.id }, ACTOR);
    expect(matched).toMatchObject({ status: "matched", matchType: "expense_payment", matchId: pay.item.id, entryId: null });
    expect((await entries()).length).toBe(before);
    expect((await ops.expenseWithPayments(e.id)).payments[0].bankMovementId).toBe(mov.id);
    // Un segundo movimiento no puede tomar el mismo pago
    await expect(ops.match(movs[3].id, { type: "expense_payment", expensePaymentId: pay.item.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    const un = await ops.unmatch(mov.id, ACTOR);
    expect(un).toMatchObject({ status: "pending", matchId: null, matchType: null });
    expect((await entries()).length).toBe(before);
    expect((await ops.expenseWithPayments(e.id)).payments[0]).toMatchObject({ status: "posted", bankMovementId: null });
    expect((await ops.expense(e.id)).paymentStatus).toBe("paid");
  });

  it("el movimiento CREA el pago: asiento bankmov:<id>; desvincular lo revierte; volver a conciliar usa bankmov:<id>:2", async () => {
    const { ops, newExpense, movs, ledger, balance } = await imported();
    const e = await ops.registerExpense((await newExpense()).id, ACTOR);
    const mov = movs[1];
    expect((await ops.suggestions(mov.id))[0]).toMatchObject({ type: "expense", expenseId: e.id, expensePaymentId: null });
    const m1 = await ops.match(mov.id, { type: "expense_payment", expenseId: e.id }, ACTOR);
    expect(m1).toMatchObject({ status: "matched", matchType: "expense_payment", matchCount: 1 });
    const entry = (await ledger.getEntry(m1.entryId!))!;
    expect(entry).toMatchObject({ sourceKey: `bankmov:${mov.id}`, origin: "expense_payment", journalCode: "BAN", date: "2026-10-05" });
    const { payments } = await ops.expenseWithPayments(e.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ id: m1.matchId, bankMovementId: mov.id, entryId: entry.id, amountCents: 121_000, method: "bank" });
    expect((await ops.expense(e.id)).paymentStatus).toBe("paid");
    // Dos veces el mismo movimiento: no
    await expect(ops.match(mov.id, { type: "expense_payment", expenseId: e.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });

    const un = await ops.unmatch(mov.id, ACTOR);
    expect(un.status).toBe("pending");
    expect((await ledger.getEntry(entry.id))!.reversedByEntryId).not.toBeNull();
    expect((await ledger.bySource(`reverse:${entry.id}`))!.origin).toBe("reversal");
    expect((await ops.expenseWithPayments(e.id)).payments[0].status).toBe("reversed");
    expect((await ops.expense(e.id)).paymentStatus).toBe("pending");
    expect(await balance("410")).toBe(-121_000);

    const m2 = await ops.match(mov.id, { type: "expense_payment", expenseId: e.id }, ACTOR);
    expect((await ledger.getEntry(m2.entryId!))!.sourceKey).toBe(`bankmov:${mov.id}:2`);
    // Revertir el pago desde el gasto devuelve el movimiento a pendiente
    await ops.reversePayment(m2.matchId!, "Pago equivocado", ACTOR);
    expect((await ops.movements({ bankAccountId: mov.bankAccountId, status: "pending" })).items.map((m) => m.id)).toContain(mov.id);
  });

  it("movimiento sin gasto contra cuenta (comisión 626), ignorar y volver a pendiente", async () => {
    const { ops, movs, ledger, balance } = await imported();
    await expect(ops.match(movs[0].id, { type: "other", accountCode: "57200001" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const m = await ops.match(movs[0].id, { type: "other", accountCode: "626", description: "Comisión de mantenimiento" }, ACTOR);
    expect((await ledger.getEntry(m.entryId!))!).toMatchObject({ sourceKey: `bankmov:${movs[0].id}`, origin: "bank", journalCode: "BAN" });
    expect(await balance("626")).toBe(350);
    await ops.unmatch(movs[0].id, ACTOR);
    expect(await balance("626")).toBe(0);
    expect((await ops.ignore(movs[2].id, ACTOR)).status).toBe("ignored");
    await expect(ops.match(movs[2].id, { type: "other", accountCode: "759" }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await ops.unmatch(movs[2].id, ACTOR)).status).toBe("pending");
    // Cuenta inexistente: no se reserva el movimiento
    await expect(ops.match(movs[2].id, { type: "other", accountCode: "999" }, ACTOR)).rejects.toMatchObject({ code: "invalid_account" });
    expect((await ops.movements({ status: "pending" })).total).toBe(4);
  });

  it("CSV con mapeo y CaixaBank pasan por la misma importación", async () => {
    const { ops } = await setup();
    const b = await ops.createBankAccount({ name: "Sin IBAN" }, ACTOR);
    const csv = "Fecha;Concepto;Importe\n05/10/2026;COMISION;-3,50\n06/10/2026;COBRO;100,00\n";
    const imp = await ops.importStatement({ bankAccountId: b.id, format: "csv", filename: "e.csv", contentBase64: b64(csv), mapping: { delimiter: ";", headerRows: 1, date: 0, amount: 2, description: 1, balance: null, dateFormat: "dd/mm/yyyy", decimal: "," } }, ACTOR);
    expect(imp).toMatchObject({ rows: 2, inserted: 2 });
    await expect(ops.importStatement({ bankAccountId: b.id, format: "csv", filename: "e2.csv", contentBase64: b64(csv + "\n") }, ACTOR)).rejects.toMatchObject({ message: "Para un CSV indica el mapeo de columnas" });
    const caixa = await ops.importStatement({ bankAccountId: b.id, format: "caixabank", filename: "c.csv", contentBase64: b64("Fecha;Movimiento;Importe;Saldo\n07/10/2026;RECIBO;-10,00;86,50\n") }, ACTOR);
    expect(caixa).toMatchObject({ rows: 1, inserted: 1 });
  });
});

describe("caja, documentos, recurrentes, resumen y auditoría", () => {
  it("caja: movimiento contabilizado cash:<id> contra la contrapartida; saldo desde el libro", async () => {
    const { ops, ledger, bank } = await setup();
    const cash = await ops.createCashAccount({ name: "Caja oficina" }, ACTOR);
    const m = await ops.createCashMovement({ cashAccountId: cash.id, movedOn: "2026-10-03", amountCents: 20_000, description: "Retirada del banco", counterpartAccountCode: bank.accountCode }, ACTOR);
    expect((await ledger.getEntry(m.entryId!))!).toMatchObject({ sourceKey: `cash:${m.id}`, journalCode: "CAJ", origin: "cash" });
    await ops.createCashMovement({ cashAccountId: cash.id, movedOn: "2026-10-04", amountCents: -1_500, description: "Mensajería", counterpartAccountCode: "624" }, ACTOR);
    expect((await ops.cashAccounts())[0].balanceCents).toBe(18_500);
    expect((await ops.cashMovements({ cashAccountId: cash.id })).total).toBe(2);
    await expect(ops.createCashMovement({ cashAccountId: cash.id, movedOn: "2026-10-04", amountCents: 100, description: "x", counterpartAccountCode: "572" }, ACTOR)).rejects.toMatchObject({ code: "invalid_account" });
    expect((await ops.cashMovements({})).total).toBe(2);
  });

  it("documentos: firma del contenido, 10 MB, dueño existente, archivar sin borrar", async () => {
    const { ops, newExpense } = await setup();
    const e = await newExpense();
    const doc = await ops.uploadDocument({ ownerType: "expense", ownerId: e.id, filename: "factura.pdf", contentBase64: b64("%PDF-1.4 contenido") }, ACTOR);
    expect(doc).toMatchObject({ mime: "application/pdf", sizeBytes: 18, archived: false, uploadedBy: "operator:luis" });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(ops.uploadDocument({ ownerType: "expense", ownerId: e.id, filename: "virus.pdf", contentBase64: b64("MZ\u0000\u0001") }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(ops.uploadDocument({ ownerType: "supplier", ownerId: 999, filename: "a.pdf", contentBase64: b64("%PDF-1") }, ACTOR)).rejects.toMatchObject({ code: "not_found" });
    await expect(ops.uploadDocument({ ownerType: "expense", ownerId: e.id, filename: "a.pdf", contentBase64: "no es base64!" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(ops.uploadDocument({ ownerType: "expense", ownerId: e.id, filename: "big.pdf", contentBase64: b64(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024)])) }, ACTOR)).rejects.toMatchObject({ message: expect.stringMatching(/10 MB/) });
    const { content } = await ops.documentContent(doc.id);
    expect(content.toString()).toBe("%PDF-1.4 contenido");
    expect((await ops.archiveDocument(doc.id, ACTOR)).archived).toBe(true);
    expect(await ops.documents("expense", e.id)).toHaveLength(1);
  });

  it("recurrentes: vista previa, borradores idempotentes por periodo y próxima fecha", async () => {
    const { ops, supplier, cat } = await setup();
    const t = await ops.createRecurring({ supplierId: supplier.id, categoryId: cat.id, description: "Servidor dedicado", baseCents: 5_000, taxRateBp: 2100, frequency: "monthly", dayOfMonth: 1, startDate: "2026-08-15" }, ACTOR);
    expect(t).toMatchObject({ nextDate: "2026-09-01", active: true });
    const pre = await ops.previewRecurring("2026-11-30");
    expect(pre.map((p) => [p.date, p.sourceKey, p.exists, p.totalCents])).toEqual([
      ["2026-09-01", `recurring:${t.id}:2026-09`, false, 6_050],
      ["2026-10-01", `recurring:${t.id}:2026-10`, false, 6_050],
      ["2026-11-01", `recurring:${t.id}:2026-11`, false, 6_050],
    ]);
    expect(await ops.runRecurring("2026-10-30", ACTOR)).toEqual({ created: 2, skipped: 0 });
    expect(await ops.runRecurring("2026-10-30", ACTOR)).toEqual({ created: 0, skipped: 2 });
    const drafts = (await ops.listExpenses({ status: "draft" })).items;
    expect(drafts.map((d) => [d.invoiceDate, d.dueDate, d.description, d.invoiceNumber])).toEqual(
      expect.arrayContaining([
        ["2026-09-01", "2026-10-01", "Servidor dedicado · 2026-09", null],
        ["2026-10-01", "2026-10-31", "Servidor dedicado · 2026-10", null],
      ]),
    );
    expect((await ops.recurring())[0].nextDate).toBe("2026-11-01");
    expect((await ops.previewRecurring("2026-11-30")).map((p) => p.exists)).toEqual([true, true, false]);
    await expect(ops.previewRecurring("2028-01-01")).rejects.toMatchObject({ code: "invalid_input" });
    expect((await ops.patchRecurring(t.id, { active: false }, ACTOR)).active).toBe(false);
    expect(await ops.runRecurring("2026-11-30", ACTOR)).toEqual({ created: 0, skipped: 0 });
  });

  it("resumen completo desde el libro: bancos, caja, acreedores, IVA soportado del trimestre", async () => {
    const { ops, newExpense, bank, finance } = await setup();
    await finance.createManual({ date: "2026-01-01", journal: "APE", description: "Apertura", lines: [{ accountCode: "57200001", debitCents: 500_000, creditCents: 0 }, { accountCode: "100", debitCents: 0, creditCents: 500_000 }], post: true }, ACTOR);
    const e = await ops.registerExpense((await newExpense()).id, ACTOR);
    await ops.addPayment(e.id, { paidOn: "2026-10-20", amountCents: 21_000, method: "bank", bankAccountId: bank.id }, ACTOR);
    const s = await ops.summary();
    expect(s).toMatchObject({ asOf: "2026-10-30", bankBalanceCents: 479_000, cashBalanceCents: 0, payablesCents: 100_000, vatInputQuarterCents: 21_000, expensesMonthCents: 100_000, banks: [{ id: bank.id, name: "CaixaBank principal", accountCode: "57200001", balanceCents: 479_000 }], cash: [] });
    expect((await ops.bankAccounts())[0].balanceCents).toBe(479_000);
    const st = await ops.supplierStatement(e.supplierId!);
    expect(st).toMatchObject({ pendingCents: 100_000, overdueCents: 0, upcoming: [{ expenseId: e.id, invoiceNumber: "F-2026-10", dueDate: "2026-10-31", pendingCents: 100_000 }] });
    expect(st.expenses[0]).toMatchObject({ supplierName: "Hosting Nube SL", paidCents: 21_000, pendingCents: 100_000 });
    expect(st.payments).toHaveLength(1);
    expect((await ops.listExpenses({ due: "overdue" })).total).toBe(0);
  });

  it("auditoría: cada escritura deja su fila con actor y correlación", async () => {
    const { ops, newExpense, ledger } = await setup();
    const e = await newExpense();
    await ops.registerExpense(e.id, ACTOR);
    const actions = new Set(ledger.audit.map((a) => a.action));
    for (const a of ["supplier.create", "account.create", "bank_account.create", "expense.create", "expense.register", "entry.generate"]) expect(actions.has(a)).toBe(true);
    expect(ledger.audit.every((a) => a.actor === "operator:luis" && a.requestId === "req-ops")).toBe(true);
  });

  it("dos ficheros Norma 43 de cuentas distintas sin IBAN: se exige el IBAN", async () => {
    const { ops } = await setup();
    const b = await ops.createBankAccount({ name: "Sin IBAN" }, ACTOR);
    const other = n43.r11({ open: 0 }).replace("0200051332", "0200051333");
    const two = [norma43Sample().split("\r\n").slice(0, -1).join("\r\n"), other, n43.r33({ nd: 0, d: 0, nc: 0, c: 0, close: 0 }).replace("0200051332", "0200051333"), n43.r88(1)].join("\r\n");
    await expect(ops.importStatement({ bankAccountId: b.id, format: "norma43", filename: "dos.n43", contentBase64: b64(two) }, ACTOR)).rejects.toMatchObject({ message: expect.stringMatching(/varias cuentas/) });
  });
});

describe("tarea programada de recurrentes (CP_FINANCE_RECURRING_ENABLED, apagada por defecto)", () => {
  it("apagada sin el interruptor; con él, genera borradores bajo el cerrojo y una réplica ocupada no hace nada", async () => {
    const { ops, supplier, cat } = await setup();
    await ops.createRecurring({ supplierId: supplier.id, categoryId: cat.id, description: "Licencias", baseCents: 1_000, taxRateBp: 2100, frequency: "monthly", dayOfMonth: 1, startDate: "2026-10-01" }, ACTOR);
    const lock = memoryLock();
    const logs: Array<Record<string, unknown>> = [];
    const off = startFinanceRecurringScheduler({ ops, lock, env: {}, log: (d) => logs.push(d) });
    expect(off.enabled).toBe(false);
    expect(logs[0]).toMatchObject({ enabled: false });
    const timers = { setInterval: (() => 1) as unknown as typeof setInterval, clearInterval: (() => undefined) as typeof clearInterval, setTimeout: (() => 2) as unknown as typeof setTimeout, clearTimeout: (() => undefined) as typeof clearTimeout };
    const on = startFinanceRecurringScheduler({ ops, lock, env: { CP_FINANCE_RECURRING_ENABLED: "1" }, timers, log: (d) => logs.push(d) });
    expect(on.enabled).toBe(true);
    const release = await lock.acquire(FINANCE_RECURRING_LOCK);
    expect(await financeRecurringTick(ops, lock)).toBeNull();
    await release!();
    expect(await financeRecurringTick(ops, lock)).toEqual({ created: 1, skipped: 0 });
    await on.tick();
    expect((await ops.listExpenses({ status: "draft" })).items.map((e) => [e.sourceKey, e.createdBy])).toEqual([[expect.stringMatching(/^recurring:\d+:2026-10$/), "system:finance-recurring"]]);
    on.stop();
  });
});
