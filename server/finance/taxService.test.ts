/**
 * Servicio de la fase 3 (gestoría e impuestos) en memoria, de punta a punta sobre el libro, los gastos, Stripe y la
 * facturación propia reales del módulo: configuración con historial, calendario idempotente, 303 con su liquidación
 * (asiento `tax:303:<año>:<periodo>`), datos cambiados después de presentar (`stale` sin pisar lo presentado),
 * compensación entre trimestres, reapertura, pago, nóminas, aplazamientos, expedientes, 200 con ajustes, avisos,
 * libros registro y ZIP para la gestoría. Solo datos sintéticos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { lineOf, totals } from "../invoicing/rules";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { FiscalParty } from "../invoicing/types";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { FinanceTaxService } from "./taxService";
import { MemoryFinanceTaxStore } from "./taxStore";
import { fiscalInvoicesFromStore } from "./taxSources";
import { runTaxReminders } from "./taxReminders";
import { seededOps, seededPlan } from "./testkit";
import type { EntryDraft } from "./types";

const ACTOR = { by: "operator:luis", requestId: "req-tax" };
const T = Date.UTC(2026, 9, 30, 10); // 30/10/2026
const PDF = Buffer.from("%PDF-1.4\n% justificante sintético\n").toString("base64");
const ES: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const DE: FiscalParty = { legalName: "Kunde GmbH", taxId: "DE123456789", address: "Straße 1", postalCode: "10115", city: "Berlin", country: "DE" };

async function setup(now = T) {
  let clock = now;
  const ledger = new MemoryFinanceStore(seededPlan());
  const invoices = new MemoryInvoicingStore();
  const finance = new FinanceService({ store: ledger, invoices, now: () => clock });
  for (const y of [2025, 2026]) await finance.createFiscalYear(y, ACTOR);
  const opsStore = new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => clock });
  const store = new MemoryFinanceTaxStore();
  const stripeTxns: Array<Record<string, unknown>> = [];
  const tax = new FinanceTaxService({
    store,
    finance,
    ledger,
    ops: opsStore,
    documents: ops,
    invoices: fiscalInvoicesFromStore(invoices),
    stripe: { listTransactions: async () => ({ items: stripeTxns as never, total: stripeTxns.length }) },
    issuer: { legalName: "EMPRESA DE PRUEBA, S.L.", taxId: "B00000000" },
    now: () => clock,
  });
  ops.useTaxDocumentOwners((t, id) => tax.documentOwnerExists(t, id));
  const bank = await ops.createBankAccount({ name: "Banco de pruebas" }, ACTOR);
  const cats = await opsStore.listCategories();
  const cat = (account: string) => cats.find((c) => c.accountCode === account)!.id;
  const supplier = await ops.createSupplier({ name: "Hosting Nube SL", taxId: "B12345674" }, ACTOR);
  const issue = async (key: string, date: string, base: number, rate: number, customer: FiscalParty) => {
    const lines = [lineOf(1, "Plan", 1, base, rate)];
    const { invoice } = await invoices.insertDraft({ sourceKey: key, kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: date, periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer, notes: null, createdBy: "t", createdAt: clock, lines });
    return invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: date, issuer: ES, customer, issuedBy: "t", issuedAt: clock });
  };
  const expense = async (p: { date: string; base: number; rate?: number; account?: string; withholding?: number; number: string; deductible?: number }) => {
    const e = await ops.createExpense({ kind: "invoice", supplierId: supplier.id, categoryId: cat(p.account ?? "629"), invoiceNumber: p.number, invoiceDate: p.date, description: "Gasto de prueba", baseCents: p.base, taxRateBp: p.rate ?? 2100, withholdingRateBp: p.withholding ?? 0, deductibleBp: p.deductible ?? 10_000 }, ACTOR);
    return ops.registerExpense(e.id, ACTOR);
  };
  /** Comisión de Stripe con inversión del sujeto pasivo (como la contabiliza la fase 2). */
  const stripeFee = (id: string, date: string, fee: number, vat: number): EntryDraft => ({
    journalCode: "STR",
    date,
    description: `Stripe ${id}`,
    origin: "stripe",
    sourceKey: `stripe-txn:${id}`,
    lines: [
      { accountCode: "5720", debitCents: 10_000 - fee, creditCents: 0 },
      { accountCode: "626", debitCents: fee, creditCents: 0 },
      { accountCode: "430", debitCents: 0, creditCents: 10_000 },
      { accountCode: "472", debitCents: vat, creditCents: 0, taxRateBp: 2100, taxBaseCents: fee },
      { accountCode: "477", debitCents: 0, creditCents: vat, taxRateBp: 2100, taxBaseCents: fee },
    ],
  });
  return { tax, store, finance, ledger, ops, opsStore, bank, issue, expense, stripeFee, stripeTxns, invoices, setNow: (t: number) => (clock = t) };
}

const box = (d: { boxes: Array<{ box: string; valueCents: number | null }> } | null, b: string) => d?.boxes.find((x) => x.box === b)?.valueCents;

describe("configuración fiscal", () => {
  it("sin guardar: null y valores neutros con el emisor precargado; al guardar, versión e historial; conflictos y validación", async () => {
    const { tax } = await setup();
    expect(await tax.storedSettings()).toBeNull();
    expect(tax.defaults()).toMatchObject({ configured: false, legalName: "EMPRESA DE PRUEBA, S.L.", taxId: "B00000000", vatRegime: "general", vatPeriod: "quarterly", corporateTaxRateBp: 2500, operations347: true, hasEmployees: false });
    const s = await tax.saveSettings({ hasEmployees: true, gestoriaEmail: "gestoria@ejemplo.example" }, ACTOR);
    expect(s).toMatchObject({ configured: true, version: 1, hasEmployees: true, legalName: "EMPRESA DE PRUEBA, S.L." });
    await expect(tax.saveSettings({ notes: "x", expectedVersion: 0 }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await expect(tax.saveSettings({ vatPeriod: "monthly" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(tax.saveSettings({ fiscalYearStartMonth: 7 }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(tax.saveSettings({ extraHolidays: ["2026-13-01"] }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await tax.saveSettings({ intraEuOperations: true, extraHolidays: ["2026-11-09", "2026-11-09"], expectedVersion: 1 }, ACTOR);
    const log = await tax.settingsLog();
    expect(log).toHaveLength(2);
    expect(log[0].after).toMatchObject({ intraEuOperations: true, extraHolidays: ["2026-11-09"], version: 2 });
    expect(log[1].before).toMatchObject({ configured: false, hasEmployees: false });
  });
});

describe("calendario", () => {
  it("generación idempotente según la configuración; lo que deja de aplicar pasa a «no aplica» con su motivo", async () => {
    const { tax } = await setup();
    const a = await tax.generateCalendar(2026, ACTOR);
    expect(a).toMatchObject({ created: 10, existing: 0 });
    expect(a.notApplicable.map((n) => n.model)).toContain("111");
    expect((await tax.generateCalendar(2026, ACTOR)).created).toBe(0);
    await tax.saveSettings({ hasEmployees: true }, ACTOR);
    const b = await tax.generateCalendar(2026, ACTOR);
    expect(b.created).toBe(4 + 1 + 12);
    expect(b.existing).toBe(10);
    await tax.saveSettings({ hasEmployees: false }, ACTOR);
    const c = await tax.generateCalendar(2026, ACTOR);
    expect(c.retired).toBe(17);
    const ss = (await tax.listObligations({ year: 2026, model: "SS" })).items;
    expect(ss.every((o) => o.status === "no_aplica")).toBe(true);
    const cal = await tax.calendar(2026);
    expect(cal.items.find((o) => o.key === "obligation:303:2026:4T")?.dueDate).toBe("2027-02-01");
    expect(cal.notApplicable.find((n) => n.model === "SS")?.reason).toMatch(/Sin empleados/);
    const detail = await tax.obligation(ss[0].id);
    expect(detail.log.map((l) => l.action)).toEqual(["generate", "not_applicable"]);
  });
});

describe("303 de punta a punta", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
    await ctx.tax.saveSettings({ intraEuOperations: true, stripeVatId: "IE3206488LH" }, ACTOR);
    await ctx.tax.generateCalendar(2026, ACTOR);
    await ctx.issue("external:1:2026-08", "2026-08-01", 100_000, 2100, ES);
    await ctx.issue("external:2:2026-08", "2026-08-02", 50_000, 0, DE);
    await ctx.finance.syncInvoices(ACTOR);
    await ctx.expense({ date: "2026-08-05", base: 20_000, number: "H-1" });
    await ctx.finance.postGenerated(ctx.stripeFee("txn_test_1", "2026-08-06", 388, 81), ACTOR);
  });
  const ob = async (key: string) => (await ctx.store.getObligationByKey(key))!;

  it("calcula, revisa, presenta con justificante (asiento de liquidación idempotente) y paga", async () => {
    const o = await ob("obligation:303:2026:3T");
    const c = await ctx.tax.calculate(o.id, ACTOR);
    expect(c.obligation.status).toBe("borrador");
    expect([box(c.draft, "07"), box(c.draft, "09"), box(c.draft, "10"), box(c.draft, "11"), box(c.draft, "28"), box(c.draft, "29"), box(c.draft, "36"), box(c.draft, "37"), box(c.draft, "59")]).toEqual([100_000, 21_000, 388, 81, 20_000, 4200, 388, 81, 50_000]);
    expect(c.draft!.resultCents).toBe(21_000 - 4200);
    await expect(ctx.tax.present(o.id, { presentedOn: "2026-10-31", receiptNumber: "X" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await ctx.tax.review(o.id, ACTOR);
    const p = await ctx.tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "2026-303-ABC", document: { filename: "justificante.pdf", contentBase64: PDF } }, ACTOR);
    expect(p).toMatchObject({ status: "presentado", receiptRef: "2026-303-ABC", presentedAmountCents: 16_800, outcome: "a_ingresar" });
    const settlement = await ctx.finance.getEntry(p.settlementEntryId!);
    expect(settlement).toMatchObject({ sourceKey: "tax:303:2026:3T", date: "2026-09-30", journalCode: "IMP", origin: "tax" });
    expect(settlement.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["477", 21_081, 0],
      ["472", 0, 4281],
      ["4750", 0, 16_800],
    ]);
    // 472 y 477 del trimestre quedan a cero: la liquidación no vuelve a contar en un nuevo cálculo
    const tb = await ctx.finance.trialBalance("2026-07-01", "2026-09-30");
    expect(tb.items.filter((r) => r.code === "472" || r.code === "477").map((r) => r.balanceCents)).toEqual([0, 0]);
    expect((await ctx.ops.documents("tax_obligation", o.id)).map((d) => d.mime)).toEqual(["application/pdf"]);
    await expect(ctx.tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "otra" }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    // La liquidación es idempotente por su clave de origen
    expect((await ctx.finance.postGenerated({ ...settlement, lines: settlement.lines }, ACTOR)).created).toBe(false);
    const paid = await ctx.tax.pay(o.id, { paidOn: "2026-10-20", bankAccountId: ctx.bank.id }, ACTOR);
    expect(paid).toMatchObject({ status: "pagado", paidAmountCents: 16_800 });
    const payment = await ctx.finance.getEntry(paid.paymentEntryId!);
    expect(payment.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["4750", 16_800, 0],
      [ctx.bank.accountCode, 0, 16_800],
    ]);
    await expect(ctx.tax.pay(o.id, { paidOn: "2026-10-20", bankAccountId: ctx.bank.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await ctx.tax.obligation(o.id)).log.map((l) => l.action)).toEqual(["generate", "calculate", "review", "present", "pay"]);
  });

  it("datos que cambian después de presentar: `stale` con la diferencia y sin pisar lo presentado; reapertura revierte la liquidación", async () => {
    const o = await ob("obligation:303:2026:3T");
    await ctx.tax.calculate(o.id, ACTOR);
    const p = await ctx.tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "R-1" }, ACTOR);
    const hash = p.draftHash;
    await ctx.expense({ date: "2026-09-10", base: 10_000, number: "H-2" });
    const r = await ctx.tax.calculate(o.id, ACTOR);
    expect(r.obligation.stale).toBe(true);
    expect(r.obligation.draftHash).toBe(hash);
    expect(r.obligation.presentedAmountCents).toBe(16_800);
    expect(r.stale).toMatchObject({ resultBefore: 16_800, resultAfter: 16_800 - 2100 });
    expect(r.stale!.differences.find((d) => d.box === "29")).toMatchObject({ before: 4200, after: 6300 });
    expect((await ctx.store.getDraft(o.id))!.hash).toBe(hash);
    await expect(ctx.tax.reopen(o.id, "x", ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const re = await ctx.tax.reopen(o.id, "Falta una factura de hosting", ACTOR);
    expect(re).toMatchObject({ status: "borrador", settlementEntryId: null, receiptRef: null });
    const reversed = await ctx.finance.getEntry(p.settlementEntryId!);
    expect(reversed.reversedByEntryId).not.toBeNull();
    const again = await ctx.tax.calculate(o.id, ACTOR);
    expect(again.draft!.resultCents).toBe(14_700);
    // Presentar de nuevo: la liquidación ya existía (y está revertida) con su clave: no se duplica
    await expect(ctx.tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "R-2" }, ACTOR)).resolves.toMatchObject({ status: "presentado" });
  });

  it("compensación entre trimestres: un 2T negativo presentado a compensar se arrastra al 3T", async () => {
    await ctx.expense({ date: "2026-05-05", base: 50_000, number: "H-0" });
    const q2 = await ob("obligation:303:2026:2T");
    const d2 = await ctx.tax.calculate(q2.id, ACTOR);
    expect(d2.draft!.resultCents).toBe(-10_500);
    expect(d2.draft!.outcome).toBe("a_compensar");
    const p2 = await ctx.tax.present(q2.id, { presentedOn: "2026-07-20", receiptNumber: "2T" }, ACTOR);
    expect(p2.status).toBe("a_compensar");
    expect((await ctx.finance.getEntry(p2.settlementEntryId!)).lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["472", 0, 10_500],
      ["4700", 10_500, 0],
    ]);
    const q3 = await ob("obligation:303:2026:3T");
    const d3 = (await ctx.tax.calculate(q3.id, ACTOR)).draft!;
    expect([box(d3, "110"), box(d3, "78"), box(d3, "87"), box(d3, "71")]).toEqual([10_500, 10_500, 0, 16_800 - 10_500]);
    const p3 = await ctx.tax.present(q3.id, { presentedOn: "2026-10-20", receiptNumber: "3T" }, ACTOR);
    expect((await ctx.finance.getEntry(p3.settlementEntryId!)).lines.find((l) => l.accountCode === "4700")).toMatchObject({ creditCents: 10_500 });
  });

  it("349 del trimestre (S al cliente alemán, I a Stripe con su NIF-IVA), libros registro y vista previa sin guardar", async () => {
    const d = await ctx.tax.preview("349", 2026, "3T");
    expect(d.declarants.map((x) => [x.key, x.taxId, x.amountCents])).toEqual([
      ["I", "IE3206488LH", 388],
      ["S", "DE123456789", 50_000],
    ]);
    expect((await ctx.store.getDraft((await ob("obligation:349:2026:3T")).id))).toBeNull();
    ctx.stripeTxns.push({ type: "charge", createdOn: "2026-08-07", balanceTransactionId: "txn_test_c2", description: "Cobro sin factura", grossCents: 6050, currency: "EUR", issue: "no_invoice" });
    const issued = await ctx.tax.issuedRegisterCsv("2026-07-01", "2026-09-30");
    expect(issued.csv).toMatch(/EB-/);
    expect(issued.incidents).toBe(1);
    expect(issued.csv).toContain("txn_test_c2");
    const received = await ctx.tax.receivedRegisterCsv("2026-07-01", "2026-09-30");
    expect(received.csv).toContain("H-1");
    expect(received.csv).toMatch(/STRIPE-2026-08;F1;Stripe Payments Europe.*;IE3206488LH;IE;3,88;21,00;0,81;0,81;0,00;3,88;;Sí/);
    await expect(ctx.tax.receivedRegisterCsv("2025-01-01", "2026-09-30")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("ZIP para la gestoría: libros, borradores guardados, calendario y listado de documentos", async () => {
    const o = await ob("obligation:303:2026:3T");
    await ctx.tax.calculate(o.id, ACTOR);
    const out = await ctx.tax.exportZip("2026-07-01", "2026-09-30");
    const zip = await JSZip.loadAsync(out.buffer);
    expect(Object.keys(zip.files).sort()).toEqual(["LEEME.txt", "documentos.csv", "libro-diario.csv", "libro-registro-expedidas.csv", "libro-registro-recibidas.csv", "modelos/", "modelos/303-2026-3T.csv", "obligaciones.csv", "sumas-y-saldos.csv"]);
    expect(await zip.file("modelos/303-2026-3T.csv")!.async("string")).toContain("no presenta declaraciones");
    expect(await zip.file("LEEME.txt")!.async("string")).toContain("EMPRESA DE PRUEBA, S.L.");
  });
});

describe("nóminas, 111, seguros sociales y aplazamientos", () => {
  it("nómina: alias sin DNI, cuadre, asiento y pago; el 111 las recoge y sin nóminas de un mes queda sin datos", async () => {
    const { tax, bank, finance } = await setup();
    await tax.saveSettings({ hasEmployees: true }, ACTOR);
    await tax.generateCalendar(2026, ACTOR);
    const base = { grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, netCents: 235_500 };
    await expect(tax.savePayroll({ period: "2026-07", employeeAlias: "12345678Z", ...base }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(tax.savePayroll({ period: "2026-07", employeeAlias: "dev-1", ...base, netCents: 1 }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const a = await tax.savePayroll({ period: "2026-07", employeeAlias: "dev-1", ...base, paymentDate: "2026-07-31" }, ACTOR);
    expect(a.created).toBe(true);
    expect((await tax.savePayroll({ period: "2026-07", employeeAlias: "dev-1", ...base, notes: "corregida" }, ACTOR)).created).toBe(false);
    const posted = await tax.postPayroll(a.payroll.id, ACTOR);
    expect(posted.status).toBe("posted");
    await expect(tax.savePayroll({ period: "2026-07", employeeAlias: "dev-1", ...base }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await expect(tax.postPayroll(a.payroll.id, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    const paid = await tax.payPayroll(a.payroll.id, { paidOn: "2026-07-31", bankAccountId: bank.id }, ACTOR);
    expect((await finance.getEntry(paid.paymentEntryId!)).lines.map((l) => l.accountCode)).toEqual(["465", bank.accountCode]);
    const q = await tax.preview("111", 2026, "3T");
    expect(q.hasData).toBe(false);
    for (const m of ["2026-08", "2026-09"]) await tax.postPayroll((await tax.savePayroll({ period: m, employeeAlias: "dev-1", ...base }, ACTOR)).payroll.id, ACTOR);
    const full = await tax.preview("111", 2026, "3T");
    expect([box(full, "02"), box(full, "03"), box(full, "30")]).toEqual([900_000, 135_000, 135_000]);
    expect(box(await tax.preview("SS", 2026, "07"), "total")).toBe(115_500);
  });

  it("aplazamiento sobre un 111 presentado: cuotas con intereses y, al pagar la última, obligación pagada", async () => {
    const { tax, bank, store, finance, expense } = await setup();
    await tax.saveSettings({ hasProfessionalWithholdings: true }, ACTOR);
    await tax.generateCalendar(2026, ACTOR);
    await expense({ date: "2026-08-04", base: 100_000, account: "623", withholding: 1500, number: "AS-1" });
    const o = (await store.getObligationByKey("obligation:111:2026:3T"))!;
    expect((await tax.calculate(o.id, ACTOR)).draft!.resultCents).toBe(15_000);
    await expect(tax.createDeferral({ obligationId: o.id, principalCents: 15_000, requestedOn: "2026-10-20", installments: [{ n: 1, dueDate: "2026-11-20", amountCents: 15_000 }] }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    await tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "111-3T" }, ACTOR);
    await expect(tax.createDeferral({ obligationId: o.id, principalCents: 15_000, requestedOn: "2026-10-20", installments: [{ n: 1, dueDate: "2026-11-20", amountCents: 10_000 }] }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const d = await tax.createDeferral({ obligationId: o.id, principalCents: 15_000, interestCents: 120, reference: "APL-1", requestedOn: "2026-10-20", installments: [{ n: 1, dueDate: "2026-11-20", amountCents: 7500 }, { n: 2, dueDate: "2026-12-20", amountCents: 7500 }] }, ACTOR);
    expect((await store.getObligation(o.id))!.status).toBe("aplazado");
    const one = await tax.payInstallment(d.id, 1, { paidOn: "2026-10-30", bankAccountId: bank.id, amountCents: 7560 }, ACTOR);
    expect(one.status).toBe("en_curso");
    expect((await finance.getEntry(one.installments[0].entryId!)).lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["4751", 7500, 0],
      ["669", 60, 0],
      [bank.accountCode, 0, 7560],
    ]);
    await expect(tax.payInstallment(d.id, 1, { paidOn: "2026-10-30", bankAccountId: bank.id }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    const two = await tax.payInstallment(d.id, 2, { paidOn: "2026-10-30", bankAccountId: bank.id }, ACTOR);
    expect(two.status).toBe("pagado");
    expect((await store.getObligation(o.id))!.status).toBe("pagado");
  });
});

describe("expedientes, Sociedades y avisos", () => {
  it("expediente con bitácora, cambio de estado y documento adjunto", async () => {
    const { tax, ops } = await setup();
    const d = await tax.createDossier({ kind: "requerimiento", agency: "AEAT", reference: "REQ-1", subject: "Requerimiento de información del 303", notifiedOn: "2026-10-01", responseDueOn: "2026-10-20" }, ACTOR);
    await tax.patchDossier(d.id, { status: "respondido" }, ACTOR);
    await tax.addDossierNote(d.id, "Enviada la documentación por sede electrónica", ACTOR);
    await ops.uploadDocument({ ownerType: "tax_dossier", ownerId: d.id, filename: "respuesta.pdf", contentBase64: PDF }, ACTOR);
    await expect(ops.uploadDocument({ ownerType: "tax_dossier", ownerId: 999, filename: "x.pdf", contentBase64: PDF }, ACTOR)).rejects.toMatchObject({ code: "not_found" });
    const full = await tax.dossier(d.id);
    expect(full.log.map((l) => l.action)).toEqual(["create", "status", "note"]);
    expect(full.documents).toHaveLength(1);
    await tax.patchDossier(d.id, { status: "cerrado" }, ACTOR);
    expect((await tax.dossier(d.id)).dossier.closedAt).not.toBeNull();
  });

  it("200 con ajustes (sustituir uno anula el anterior) y 202 por el art. 40.2 desde el 200 guardado", async () => {
    const { tax, finance, store } = await setup();
    await finance.createManual({ date: "2025-06-30", journal: "GEN", description: "Ingresos de prueba", lines: [{ accountCode: "430", debitCents: 10_000_000, creditCents: 0 }, { accountCode: "705", debitCents: 0, creditCents: 10_000_000 }], post: true }, ACTOR);
    await tax.generateCalendar(2025, ACTOR);
    await tax.generateCalendar(2026, ACTOR);
    const adj = await tax.saveAdjustment(2025, { kind: "negative_base", description: "BIN 2023", amountCents: 2_000_000, originYear: 2023 }, ACTOR);
    await expect(tax.saveAdjustment(2025, { kind: "negative_base", description: "Sin año", amountCents: 1 }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await tax.saveAdjustment(2025, { id: adj!.id, kind: "negative_base", description: "BIN 2023 corregida", amountCents: 3_000_000, originYear: 2023 }, ACTOR);
    const c = await tax.corporate(2025);
    expect(c.adjustments.filter((a) => a.status === "active").map((a) => a.amountCents)).toEqual([3_000_000]);
    expect([box(c.draft, "00501"), box(c.draft, "00547"), box(c.draft, "00552"), box(c.draft, "00562")]).toEqual([10_000_000, 3_000_000, 7_000_000, 1_750_000]);
    const o200 = (await store.getObligationByKey("obligation:200:2025:ANUAL"))!;
    await tax.calculate(o200.id, ACTOR);
    const p = await tax.preview("202", 2026, "2P");
    expect(p.resultCents).toBe(315_000);
    expect((await tax.preview("202", 2026, "1P")).hasData).toBe(false);
  });

  it("avisos de vencimiento: cada umbral una sola vez; el ciclo lanza una alerta por aviso", async () => {
    const { tax, setNow } = await setup(Date.UTC(2026, 9, 6, 10)); // 06/10/2026: el 303 3T vence el 20/10 (14 días)
    await tax.generateCalendar(2026, ACTOR);
    const raised: Array<{ id: string; key: string }> = [];
    const raise = async (id: string, f: { key: string }) => void raised.push({ id, key: f.key });
    expect(await runTaxReminders(tax, raise)).toBe(2); // 303 3T y 202 2P
    expect(await runTaxReminders(tax, raise)).toBe(0);
    setNow(Date.UTC(2026, 9, 14, 10));
    expect(await runTaxReminders(tax, raise)).toBe(2);
    expect(raised.map((r) => r.key).sort()).toEqual(["tax:obligation:202:2026:2P:15", "tax:obligation:202:2026:2P:7", "tax:obligation:303:2026:3T:15", "tax:obligation:303:2026:3T:7"]);
    expect(raised.every((r) => r.id === "admin.tax_deadline")).toBe(true);
    const dash = await tax.dashboard();
    expect(dash.settingsMissing).toBe(true);
    expect(dash.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["sin_configuracion", "vence_pronto", "vencida"]));
  });
});
