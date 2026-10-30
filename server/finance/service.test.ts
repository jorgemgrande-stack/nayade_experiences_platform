/**
 * Servicio del libro con almacén en memoria: sincronización idempotente de facturas emitidas (incluida la
 * rectificativa), periodo cerrado, numeración correlativa, reversión idempotente, cierre del ejercicio y auditoría.
 */
import { describe, expect, it } from "vitest";
import { lineOf, totals } from "../invoicing/rules";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { FiscalParty, NewInvoice } from "../invoicing/types";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { seededPlan } from "./testkit";
import { FinanceError } from "./types";

const T0 = Date.UTC(2026, 9, 30, 10); // 30/10/2026
const ACTOR = { by: "operator:luis", requestId: "req-1" };
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const D = (accountCode: string, c: number) => ({ accountCode, debitCents: c, creditCents: 0 });
const H = (accountCode: string, c: number) => ({ accountCode, debitCents: 0, creditCents: c });

async function setup() {
  const store = new MemoryFinanceStore(seededPlan());
  const invoices = new MemoryInvoicingStore();
  let now = T0;
  const svc = new FinanceService({ store, invoices, now: () => now });
  await svc.createFiscalYear(2026, ACTOR);
  const issue = async (id: number, sourceKey: string, lines: NewInvoice["lines"], issueDate: string, kind: NewInvoice["kind"] = "invoice", originalInvoiceId: number | null = null) => {
    const { invoice } = await invoices.insertDraft({ sourceKey, kind, paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId, operationDate: issueDate, periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: T0, lines });
    expect(invoice.id).toBe(id);
    return invoices.issue({ id, seriesCode: kind === "rectification" ? "EBR" : "EB", issueDate, issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: T0 });
  };
  return { store, invoices, svc, issue, tick: (ms: number) => (now += ms) };
}

const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof FinanceError ? e.code : String(e)));

describe("sincronización de facturas emitidas", () => {
  it("contabiliza cada factura expedida una sola vez (también la rectificativa) y lo audita", async () => {
    const { store, svc, invoices, issue } = await setup();
    await issue(1, "external:1:2026-03", [lineOf(1, "Plan", 1, 100_000, 2100), lineOf(2, "Curso", 1, 10_000, 1000)], "2026-03-02");
    await issue(2, "external:1:2026-04", [lineOf(1, "Plan", 1, 100_000, 2100)], "2026-04-02");
    await invoices.insertDraft({ sourceKey: "borrador", kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "x", paymentRef: null, originalInvoiceId: null, operationDate: "2026-05-01", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", baseCents: 1, taxCents: 0, totalCents: 1, customer: null, notes: null, createdBy: "t", createdAt: T0, lines: [lineOf(1, "x", 1, 1, 0)] });
    await issue(4, "rectify:2:-100000", [lineOf(1, "Rectificación", 1, -100_000, 2100)], "2026-04-20", "rectification", 2);
    await invoices.setStatus(2, "rectified", T0);

    expect(await svc.syncStatus()).toEqual({ lastRunAt: null, lastRunBy: null, pending: 3, synced: 0, lastResult: null });
    const first = await svc.syncInvoices(ACTOR);
    expect(first).toEqual({ posted: 3, skipped: 0, errors: [], truncated: false });
    const second = await svc.syncInvoices(ACTOR);
    expect(second).toEqual({ posted: 0, skipped: 3, errors: [], truncated: false });
    expect(store.entries).toHaveLength(3);

    // En orden de expedición: números 1, 2, 3 del ejercicio
    const byKey = new Map(store.entries.map((e) => [e.sourceKey, e]));
    expect(["invoice:1", "invoice:2", "invoice:4"].map((k) => byKey.get(k)!.number)).toEqual([1, 2, 3]);
    const rect = byKey.get("invoice:4")!;
    expect(rect).toMatchObject({ status: "posted", journalCode: "VEN", origin: "invoice", date: "2026-04-20" });
    expect(rect.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["430", 0, 121_000],
      ["705", 100_000, 0],
      ["477", 21_000, 0],
    ]);
    // Sumas y saldos: la rectificativa anula la factura de abril
    const tb = await svc.trialBalance("2026-01-01", "2026-12-31");
    expect(tb.items.find((r) => r.code === "705")?.balanceCents).toBe(-110_000);
    expect(tb.items.find((r) => r.code === "477")?.balanceCents).toBe(-22_000);
    expect(tb.items.find((r) => r.code === "430")?.balanceCents).toBe(132_000);

    expect(store.audit.filter((a) => a.action === "entry.generate")).toHaveLength(3);
    expect(store.audit.filter((a) => a.action === "sync.invoices").map((a) => a.summary)).toEqual([
      { posted: 3, skipped: 0, errors: 0, truncated: false },
      { posted: 0, skipped: 3, errors: 0, truncated: false },
    ]);
    expect(store.audit.every((a) => a.actor === "operator:luis" && a.requestId === "req-1")).toBe(true);
    expect(await svc.syncStatus()).toEqual({ lastRunAt: T0, lastRunBy: "operator:luis", pending: 0, synced: 3, lastResult: { posted: 0, skipped: 3, errors: 0, truncated: false } });
  });

  it("una factura en un periodo cerrado queda como error y entra al reabrirlo", async () => {
    const { svc, issue } = await setup();
    await issue(1, "a", [lineOf(1, "Plan", 1, 50_000, 2100)], "2026-02-10");
    await svc.setPeriodStatus(2026, 2, "closed", ACTOR);
    const r = await svc.syncInvoices(ACTOR);
    expect(r.posted).toBe(0);
    expect(r.errors).toEqual([{ invoiceId: 1, message: "Factura EB-2026-00001: El periodo 2026-02 está cerrado" }]);
    await svc.setPeriodStatus(2026, 2, "open", ACTOR);
    expect((await svc.syncInvoices(ACTOR)).posted).toBe(1);
  });

  it("sin facturación propia la sincronización no está disponible", async () => {
    const svc = new FinanceService({ store: new MemoryFinanceStore(seededPlan()), now: () => T0 });
    expect(await codeOf(svc.syncInvoices(ACTOR))).toBe("unavailable");
    expect(await svc.syncStatus()).toEqual({ lastRunAt: null, lastRunBy: null, pending: null, synced: 0, lastResult: null });
  });
});

describe("asientos manuales, numeración, periodos y reversión", () => {
  it("el número se asigna al contabilizar, correlativo; un borrador anulado no consume número", async () => {
    const { svc, store } = await setup();
    const a = await svc.createManual({ date: "2026-01-05", journal: "GEN", description: "Capital", lines: [D("551", 300_000), H("100", 300_000)] }, ACTOR);
    expect(a).toMatchObject({ status: "draft", number: null });
    const b = await svc.createManual({ date: "2026-01-06", journal: "COM", description: "Hosting", lines: [D("629", 10_000), D("472", 2_100), H("410", 12_100)], post: true }, ACTOR);
    expect(b).toMatchObject({ status: "posted", number: 1 });
    const c = await svc.createManual({ date: "2026-01-07", journal: "GEN", description: "Borrador", lines: [D("629", 1), H("410", 1)] }, ACTOR);
    await svc.voidDraft(c.id, "Duplicado", ACTOR);
    expect((await svc.post(a.id, ACTOR)).number).toBe(2);
    expect(await codeOf(svc.post(a.id, ACTOR))).toBe("invalid_state");
    expect(await codeOf(svc.post(c.id, ACTOR))).toBe("invalid_state");
    expect(await codeOf(svc.voidDraft(b.id, "No", ACTOR))).toBe("invalid_input");
    expect(await codeOf(svc.voidDraft(b.id, "No se anula", ACTOR))).toBe("invalid_state");
    expect(store.entries.map((e) => [e.status, e.number])).toEqual([
      ["posted", 2],
      ["posted", 1],
      ["void", null],
    ]);
    expect(store.audit.map((x) => x.action)).toEqual(["fiscal_year.create", "entry.create", "entry.create_posted", "entry.create", "entry.void", "entry.post"]);
  });

  it("rechaza descuadres, diarios del cierre, ejercicios sin alta y periodos cerrados", async () => {
    const { svc } = await setup();
    expect(await codeOf(svc.createManual({ date: "2026-03-01", journal: "GEN", description: "x", lines: [D("629", 100), H("410", 90)] }, ACTOR))).toBe("unbalanced");
    expect(await codeOf(svc.createManual({ date: "2026-03-01", journal: "REG", description: "x", lines: [D("629", 100), H("410", 100)] }, ACTOR))).toBe("invalid_input");
    expect(await codeOf(svc.createManual({ date: "2025-03-01", journal: "GEN", description: "x", lines: [D("629", 100), H("410", 100)] }, ACTOR))).toBe("invalid_state");
    const draft = await svc.createManual({ date: "2026-03-01", journal: "GEN", description: "x", lines: [D("629", 100), H("410", 100)] }, ACTOR);
    await svc.setPeriodStatus(2026, 3, "closed", ACTOR);
    expect(await codeOf(svc.post(draft.id, ACTOR))).toBe("period_closed");
    expect(await codeOf(svc.createManual({ date: "2026-03-02", journal: "GEN", description: "x", lines: [D("629", 100), H("410", 100)], post: true }, ACTOR))).toBe("period_closed");
    // Una cuenta desactivada después de crear el borrador impide contabilizarlo
    await svc.setPeriodStatus(2026, 3, "open", ACTOR);
    await svc.patchAccount("629", { active: false }, ACTOR);
    expect(await codeOf(svc.post(draft.id, ACTOR))).toBe("invalid_account");
  });

  it("reversión: asiento espejo enlazado, idempotente y sin revertir una reversión", async () => {
    const { svc, store } = await setup();
    const e = await svc.createManual({ date: "2026-06-10", journal: "COM", description: "Gasto", lines: [D("629", 5_000), H("410", 5_000)], post: true }, ACTOR);
    expect(await codeOf(svc.reverse(e.id, { date: "2026-06-09", reason: "Error de fecha" }, ACTOR))).toBe("invalid_input");
    const r1 = await svc.reverse(e.id, { date: "2026-06-12", reason: "Factura duplicada" }, ACTOR);
    expect(r1.created).toBe(true);
    expect(r1.entry).toMatchObject({ origin: "reversal", reversesEntryId: e.id, sourceKey: `reverse:${e.id}`, number: 2, status: "posted" });
    expect((await svc.getEntry(e.id)).reversedByEntryId).toBe(r1.entry.id);
    const r2 = await svc.reverse(e.id, { date: "2026-06-13", reason: "Otra vez" }, ACTOR);
    expect(r2).toMatchObject({ created: false, entry: { id: r1.entry.id } });
    expect(await codeOf(svc.reverse(r1.entry.id, { date: "2026-06-14", reason: "Deshacer" }, ACTOR))).toBe("invalid_state");
    expect(store.entries).toHaveLength(2);
    expect((await svc.ledger("629", "2026-01-01", "2026-12-31")).closingCents).toBe(0);
    expect(store.audit.filter((a) => a.action === "entry.reverse")).toHaveLength(1);
  });

  it("asiento generado (interfaz de la fase 1B): idempotente por clave de origen", async () => {
    const { svc, store } = await setup();
    const draft = { journalCode: "COM" as const, date: "2026-07-01", description: "Factura recibida F-1", origin: "expense" as const, sourceKey: "expense:1", lines: [D("629", 1_000), D("472", 210), H("410", 1_210)] };
    const a = await svc.postGenerated(draft, ACTOR);
    const b = await svc.postGenerated(draft, ACTOR);
    expect([a.created, b.created, a.entry.id === b.entry.id, a.entry.number]).toEqual([true, false, true, 1]);
    expect(await codeOf(svc.postGenerated({ ...draft, sourceKey: null }, ACTOR))).toBe("invalid_input");
    expect(await codeOf(svc.postGenerated({ ...draft, origin: "manual", sourceKey: "x:1" }, ACTOR))).toBe("invalid_input");
    expect(store.entries).toHaveLength(1);
  });
});

describe("plan contable", () => {
  it("subcuentas que heredan el tipo; sin cuenta madre o repetida, no", async () => {
    const { svc } = await setup();
    expect(await svc.createAccount({ code: "57200001", name: "BBVA" }, ACTOR)).toMatchObject({ code: "57200001", type: "asset", parentCode: "572", isPostable: true });
    expect(await codeOf(svc.createAccount({ code: "57200001", name: "Otra" }, ACTOR))).toBe("conflict");
    expect(await codeOf(svc.createAccount({ code: "9990001", name: "X" }, ACTOR))).toBe("invalid_account");
    expect(await codeOf(svc.createAccount({ code: "62900001", name: "X", type: "income" }, ACTOR))).toBe("invalid_input");
    expect(await svc.createAccount({ code: "280", name: "Amortización acumulada del inmovilizado intangible", type: "asset" }, ACTOR)).toMatchObject({ parentCode: null });
  });
});

describe("cierre del ejercicio", () => {
  it("exige los periodos cerrados; regulariza, cierra, abre el siguiente y es idempotente", async () => {
    const { svc, store } = await setup();
    await svc.createAccount({ code: "57200001", name: "Banco" }, ACTOR);
    await svc.createManual({ date: "2026-01-02", journal: "APE", description: "Apertura manual", lines: [D("57200001", 300_000), H("100", 300_000)], post: true }, ACTOR);
    await svc.createManual({ date: "2026-05-01", journal: "VEN", description: "Venta", lines: [D("430", 121_000), H("705", 100_000), H("477", 21_000)], post: true }, ACTOR);
    await svc.createManual({ date: "2026-06-01", journal: "COM", description: "Gasto", lines: [D("629", 40_000), H("57200001", 40_000)], post: true }, ACTOR);
    expect(await codeOf(svc.closeFiscalYear(2026, ACTOR))).toBe("invalid_state");
    for (let m = 1; m <= 12; m++) await svc.setPeriodStatus(2026, m, "closed", ACTOR);

    const out = await svc.closeFiscalYear(2026, ACTOR);
    expect(out.alreadyClosed).toBe(false);
    expect(out.fiscalYear.status).toBe("closed");
    expect(out.regularization!.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["629", 0, 40_000],
      ["705", 100_000, 0],
      ["129", 0, 60_000],
    ]);
    expect(out.closing!.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["100", 300_000, 0],
      ["129", 60_000, 0],
      ["430", 0, 121_000],
      ["477", 21_000, 0],
      ["57200001", 0, 260_000],
    ]);
    expect(out.opening).toMatchObject({ date: "2027-01-01", journalCode: "APE", year: 2027, number: 1 });
    expect([out.regularization!.number, out.closing!.number]).toEqual([4, 5]);
    // El ejercicio 2026 queda a cero y 2027 abre con los saldos del balance
    expect((await svc.trialBalance("2026-01-01", "2026-12-31")).items.every((r) => r.balanceCents === 0)).toBe(true);
    const open2027 = await svc.trialBalance("2027-01-01", "2027-01-01");
    expect(Object.fromEntries(open2027.items.map((r) => [r.code, r.balanceCents]))).toEqual({ "100": -300_000, "129": -60_000, "430": 121_000, "477": -21_000, "57200001": 260_000 });
    // Sumas y saldos del ejercicio sin el asiento de cierre: muestra los saldos finales
    const final = await svc.trialBalance("2026-01-01", "2026-12-31", true);
    expect(final.items.find((r) => r.code === "129")?.balanceCents).toBe(-60_000);

    const again = await svc.closeFiscalYear(2026, ACTOR);
    expect(again.alreadyClosed).toBe(true);
    expect(store.entries).toHaveLength(6);
    expect(await codeOf(svc.setPeriodStatus(2026, 12, "open", ACTOR))).toBe("invalid_state");
    expect((await svc.fiscalYears()).map((y) => [y.year, y.status])).toEqual([
      [2027, "open"],
      [2026, "closed"],
    ]);
    expect(store.audit.filter((a) => a.action === "fiscal_year.close")).toHaveLength(1);
  });

  it("no cierra con borradores pendientes", async () => {
    const { svc } = await setup();
    await svc.createManual({ date: "2026-05-01", journal: "GEN", description: "Pendiente", lines: [D("629", 100), H("410", 100)] }, ACTOR);
    for (let m = 1; m <= 12; m++) await svc.setPeriodStatus(2026, m, "closed", ACTOR);
    await expect(svc.closeFiscalYear(2026, ACTOR)).rejects.toThrow(/borrador/);
  });
});

describe("resumen", () => {
  it("ingresos y gastos devengados del mes y del año, IVA repercutido del trimestre y resultado; 1B en null", async () => {
    const { svc } = await setup();
    await svc.createManual({ date: "2026-02-01", journal: "VEN", description: "Venta feb", lines: [D("430", 12_100), H("705", 10_000), H("477", 2_100)], post: true }, ACTOR);
    await svc.createManual({ date: "2026-10-05", journal: "VEN", description: "Venta oct", lines: [D("430", 24_200), H("705", 20_000), H("477", 4_200)], post: true }, ACTOR);
    await svc.createManual({ date: "2026-10-06", journal: "COM", description: "Gasto oct", lines: [D("629", 5_000), H("410", 5_000)], post: true }, ACTOR);
    expect(await svc.summary()).toEqual({
      asOf: "2026-10-30",
      bankBalanceCents: null,
      cashBalanceCents: null,
      payablesCents: null,
      expensesMonthCents: 5_000,
      expensesYearCents: 5_000,
      incomeMonthCents: 20_000,
      incomeYearCents: 30_000,
      vatOutputQuarterCents: 4_200,
      vatInputQuarterCents: null,
      resultYearCents: 25_000,
      banks: null,
      cash: null,
    });
  });
});
