/**
 * Servicio de Stripe (fase 2) en memoria sobre el libro (1A) y las operaciones (1B): importación idempotente,
 * contabilización idempotente de cobros, reembolsos, disputas, comisiones y payouts, payout fallido (reversión), saldo
 * de 5720 frente a los informes, vínculo payout ↔ banco SIN asiento, cobro de factura por transferencia, vistas de
 * conciliación, incidencias y configuración. Solo datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import { lineOf, totals } from "../invoicing/rules";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { FiscalParty, NewInvoice } from "../invoicing/types";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { FinanceStripeService } from "./stripeService";
import { ownInvoicesFromStore } from "./ownInvoices";
import { MemoryFinanceStripeStore } from "./stripeStore";
import { seededOps, seededPlan, stripeBalanceSample, stripePayoutsSample } from "./testkit";

const T0 = Date.UTC(2026, 9, 30, 10);
const ACTOR = { by: "operator:luis", requestId: "req-stripe" };
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const b64 = (s: string) => Buffer.from(s).toString("base64");
const MAPPING = { delimiter: ";" as const, headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd" as const, decimal: "," as const };

async function setup() {
  const ledger = new MemoryFinanceStore(seededPlan());
  const finance = new FinanceService({ store: ledger, now: () => T0 });
  await finance.createFiscalYear(2026, ACTOR);
  const opsStore = new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => T0 });
  const bank = await ops.createBankAccount({ name: "CaixaBank principal", iban: "ES9121000418450200051332" }, ACTOR);
  const invoices = new MemoryInvoicingStore();
  const issue = async (sourceKey: string, lines: NewInvoice["lines"], issueDate: string, paymentRef: string | null) => {
    const { invoice } = await invoices.insertDraft({ sourceKey, kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: issueDate, periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: T0, lines });
    const inv = await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate, issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: T0 });
    return paymentRef ? invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef, paidAt: T0 }, T0) : inv;
  };
  const inv1 = await issue("external:1:2026-10", [lineOf(1, "Plan Elephant Core", 1, 10_000, 2100)], "2026-10-01", "stripe:in:in_test_1");
  const inv2 = await issue("charge:5", [lineOf(1, "Implantación", 1, 25_000, 2100)], "2026-10-02", null);
  const store = new MemoryFinanceStripeStore();
  const stripe = new FinanceStripeService({ store, finance, ops: opsStore, ledger, invoices: ownInvoicesFromStore(invoices), now: () => T0 });
  ops.useReconciliation(stripe);
  const entries = async () => (await ledger.listEntries({ limit: 200 })).items;
  const balance = async (code: string) => (await finance.ledger(code, "2026-01-01", "2026-12-31")).closingCents;
  const txn = async (id: string) => (await stripe.transactions({ q: id, limit: 10 })).items.find((t) => t.balanceTransactionId === id)!;
  const statement = async (rows: string[], name = "extracto.csv") => ops.importStatement({ bankAccountId: bank.id, format: "csv", filename: name, contentBase64: b64(["Fecha;Importe;Concepto", ...rows].join("\n")), mapping: MAPPING }, ACTOR);
  return { ledger, finance, ops, opsStore, bank, invoices, inv1, inv2, store, stripe, entries, balance, txn, statement };
}

describe("importación", () => {
  it("un fichero una sola vez; las transacciones ya conocidas cuentan como duplicadas; avisos de moneda", async () => {
    const { stripe, store } = await setup();
    const imp = await stripe.importFile({ kind: "balance", filename: "balance_change_from_activity_itemized.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    expect(imp).toMatchObject({ kind: "balance", rows: 9, inserted: 9, duplicates: 0, nonEur: 1, errors: 0, problems: [] });
    await expect(stripe.importFile({ kind: "balance", filename: "otra vez.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    const again = await stripe.importFile({ kind: "balance", filename: "solapado.csv", contentBase64: b64(`${stripeBalanceSample()}\n`) }, ACTOR);
    expect(again).toMatchObject({ inserted: 0, duplicates: 9 });
    expect(store.txns).toHaveLength(9);
    expect(store.txns.find((t) => t.balanceTransactionId === "txn_test_usd")).toMatchObject({ status: "pending", issue: "currency" });
    expect(store.txns.find((t) => t.balanceTransactionId === "txn_test_t1")).toMatchObject({ status: "pending", issue: "unsupported" });
    // La fila de payout da de alta su payout (origen saldo)
    expect(store.payouts).toEqual([expect.objectContaining({ payoutId: "po_test_1", amountCents: 11_350, arrivalOn: "2026-10-08", status: "paid", origin: "balance" })]);
    await expect(stripe.importFile({ kind: "payouts", filename: "x.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(stripe.importFile({ kind: "balance", filename: "x.csv", contentBase64: "no es base64!" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    expect((await stripe.imports()).map((i) => i.id)).toEqual([2, 1]);
  });

  it("informe de payouts: conocidos sin cambios = duplicados; nuevos se insertan; el fallido queda «failed»", async () => {
    const { stripe, store } = await setup();
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    const imp = await stripe.importFile({ kind: "payouts", filename: "payouts.csv", contentBase64: b64(stripePayoutsSample()) }, ACTOR);
    expect(imp).toMatchObject({ rows: 2, inserted: 1, duplicates: 1, refreshed: 0 });
    expect(store.payouts.find((p) => p.payoutId === "po_test_9")).toMatchObject({ status: "failed", origin: "report" });
  });
});

describe("contabilización", () => {
  it("cobros, reembolso, comisión, disputa perdida y ganada y payout; idempotente; saldo 5720 frente al informe", async () => {
    const { stripe, entries, balance, txn, bank, inv1 } = await setup();
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);

    // Sin cuenta bancaria configurada el payout no se contabiliza (error explicado), el resto sí
    const first = await stripe.post("2026-10-31", ACTOR);
    expect(first).toMatchObject({ posted: 6, skipped: 1, truncated: false });
    expect(first.errors).toEqual([{ transactionId: "po_test_1", message: "Configura la cuenta bancaria a la que llegan los payouts de Stripe" }]);
    expect(await txn("txn_test_c1")).toMatchObject({ status: "posted", ownInvoiceId: inv1.id, ownInvoiceNumber: inv1.number, issue: null, payoutArrivalOn: "2026-10-08" });
    expect(await txn("txn_test_c2")).toMatchObject({ status: "posted", ownInvoiceId: null, issue: "no_invoice" });
    expect(await txn("txn_test_r2")).toMatchObject({ status: "posted", issue: "refund" });
    // Disputa: hereda la factura; ganada → su retención queda revisada sola
    expect(await txn("txn_test_d1")).toMatchObject({ ownInvoiceId: inv1.id, issue: "dispute", issueNote: "Disputa ganada (txn_test_d2)" });
    expect(await txn("txn_test_d2")).toMatchObject({ ownInvoiceId: inv1.id, issue: null });
    expect(await txn("txn_test_p1")).toMatchObject({ status: "pending", entryId: null });
    expect(await txn("txn_test_t1")).toMatchObject({ status: "pending", issue: "unsupported" });

    const c1 = (await entries()).find((e) => e.sourceKey === "stripe-txn:txn_test_c1")!;
    expect(c1).toMatchObject({ journalCode: "STR", origin: "stripe", date: "2026-10-05", status: "posted" });
    expect(c1.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.companyId])).toEqual([
      ["5720", 11_712, 0, null],
      ["626", 388, 0, null],
      ["430", 0, 12_100, 9],
    ]);

    await stripe.saveSettings({ stripePayoutBankAccountId: bank.id }, ACTOR);
    const second = await stripe.post("2026-10-31", ACTOR);
    expect(second).toMatchObject({ posted: 1, errors: [] });
    expect(await txn("txn_test_p1")).toMatchObject({ status: "posted", payoutId: 1 });
    const payout = (await entries()).find((e) => e.sourceKey === "stripe-payout:po_test_1")!;
    expect(payout).toMatchObject({ date: "2026-10-08", journalCode: "STR" });
    expect(payout.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      [bank.accountCode, 11_350, 0],
      ["5720", 0, 11_350],
    ]);

    // Doble contabilización: nada nuevo
    const n = (await entries()).length;
    expect(await stripe.post("2026-10-31", ACTOR)).toMatchObject({ posted: 0, errors: [] });
    expect((await entries()).length).toBe(n);

    // 5720: todo lo contabilizado se compensa; la transferencia de Connect (−5 €) queda como diferencia visible
    expect(await balance("5720")).toBe(0);
    expect(await balance("626")).toBe(388 + 212 + 150);
    const s = await stripe.summary();
    expect(s).toMatchObject({ balancePendingCents: 0, importedBalanceCents: -500, balanceDifferenceCents: 500, grossMonthCents: 18_150, refundsMonthCents: 6_050, payoutsMonthCents: 11_350, payoutsWithoutBank: 1, disputesOpen: 0, lastImportAt: T0 });
    expect(s.feesMonthCents).toBe(388 + 212 + 150);
    expect(s.netMonthCents).toBe(11_712 + 5_838 - 6_050 - 150 - 500);
    // Abiertas: cobro sin factura, reembolso y la transferencia no soportada (la de dólares es de otro mes, pero cuenta)
    expect(s.unmatchedTransactions).toBe(4);
  });

  it("fecha hasta: lo posterior espera; periodo cerrado = error recuperable", async () => {
    const { stripe, finance, txn } = await setup();
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    expect((await stripe.post("2026-10-05", ACTOR)).posted).toBe(1);
    expect(await txn("txn_test_c2")).toMatchObject({ status: "pending" });
    await finance.setPeriodStatus(2026, 10, "closed", ACTOR);
    const r = await stripe.post("2026-10-06", ACTOR);
    expect(r.errors.map((e) => e.transactionId)).toEqual(["txn_test_c2"]);
    expect(await txn("txn_test_c2")).toMatchObject({ status: "error" });
    expect((await txn("txn_test_c2")).issueDetail).toMatch(/^No se pudo contabilizar/);
    await finance.setPeriodStatus(2026, 10, "open", ACTOR);
    expect((await stripe.post("2026-10-06", ACTOR)).posted).toBe(1);
    expect(await txn("txn_test_c2")).toMatchObject({ status: "posted", issue: "no_invoice" });
    await expect(stripe.post("31/10/2026", ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("comisiones con inversión del sujeto pasivo según la configuración (472/477)", async () => {
    const { stripe, balance } = await setup();
    await stripe.saveSettings({ stripeFeeVat: "reverse_charge", feeVatRateBp: 2100 }, ACTOR);
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    await stripe.post("2026-10-31", ACTOR);
    // 21 % de 3,88 + 2,12 + 1,50 + 15,00 − 15,00 (disputa ganada devuelve la comisión)
    const vat = 81 + 45 + 32 + 315 - 315;
    expect(await balance("472")).toBe(vat);
    expect(await balance("477")).toBe(-vat);
  });

  it("payout fallido: si ya estaba contabilizado se revierte; si no, no se contabiliza", async () => {
    const { stripe, bank, entries, balance, txn } = await setup();
    await stripe.saveSettings({ stripePayoutBankAccountId: bank.id }, ACTOR);
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    await stripe.post("2026-10-31", ACTOR);
    expect(await balance(bank.accountCode)).toBe(11_350);
    const failure = ["balance_transaction_id,created_utc,currency,gross,fee,net,reporting_category,source_id,description", "txn_test_pf,2026-10-09 09:00:00,eur,113.50,0.00,113.50,payout_reversal,po_test_1,Payout failure"].join("\n");
    await stripe.importFile({ kind: "balance", filename: "fallo.csv", contentBase64: b64(failure) }, ACTOR);
    const r = await stripe.post("2026-10-31", ACTOR);
    expect(r).toMatchObject({ posted: 1, errors: [] });
    const reversal = (await entries()).find((e) => e.origin === "reversal")!;
    expect(reversal).toMatchObject({ date: "2026-10-09" });
    expect(await balance(bank.accountCode)).toBe(0);
    expect(await balance("5720")).toBe(11_350);
    expect(await txn("txn_test_pf")).toMatchObject({ status: "posted", entryId: reversal.id });
    expect((await stripe.payouts({})).items[0]).toMatchObject({ status: "failed", reversalEntryId: reversal.id });
    expect((await stripe.post("2026-10-31", ACTOR)).posted).toBe(0);

    // po_test_9 llega ya fallido en el informe de payouts: nunca tiene asiento
    await stripe.importFile({ kind: "payouts", filename: "p.csv", contentBase64: b64(stripePayoutsSample()) }, ACTOR);
    await stripe.post("2026-10-31", ACTOR);
    expect((await stripe.payouts({ status: "failed" })).items.find((p) => p.stripePayoutId === "po_test_9")).toMatchObject({ entryId: null, reversalEntryId: null });
  });
});

describe("conciliación", () => {
  it("payout ↔ movimiento bancario: sugerencia, vínculo SIN asiento, vistas y desvínculo", async () => {
    const { stripe, ops, bank, entries, statement } = await setup();
    await stripe.saveSettings({ stripePayoutBankAccountId: bank.id }, ACTOR);
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    await stripe.post("2026-10-31", ACTOR);
    await statement(["2026-10-09;113,50;STRIPE PAYMENTS EUROPE LTD", "2026-10-15;302,50;TRANSF NEXTAIR EB-2026-0002", "2026-10-16;-10,00;COMISION"]);
    const movs = (await ops.movements({})).items;
    const payoutMov = movs.find((m) => m.amountCents === 11_350)!;
    const sugg = await ops.suggestions(payoutMov.id);
    expect(sugg[0]).toMatchObject({ type: "stripe_payout", payoutId: 1, stripePayoutId: "po_test_1", amountCents: 11_350, date: "2026-10-08" });
    expect(await ops.suggestions(movs.find((m) => m.amountCents === -1_000)!.id)).toEqual([]);

    const n = (await entries()).length;
    const linked = await ops.match(payoutMov.id, { type: "stripe_payout", payoutId: 1 }, ACTOR);
    expect(linked).toMatchObject({ status: "matched", matchType: "stripe_payout", matchId: 1, entryId: null });
    expect((await entries()).length).toBe(n);
    const view = await stripe.reconciliationPayout(1);
    expect(view).toMatchObject({ stripePayoutId: "po_test_1", amountCents: 11_350, transactionsCount: 4, transactionsCents: 11_350, differenceCents: 0, bankMovementId: payoutMov.id, bankBookingDate: "2026-10-09" });
    expect(view.transactions.map((t) => t.balanceTransactionId)).toEqual(["txn_test_c1", "txn_test_c2", "txn_test_r2", "txn_test_f1", "txn_test_p1"]);
    expect(view.bankMovement).toMatchObject({ id: payoutMov.id, amountCents: 11_350, bookingDate: "2026-10-09" });
    expect((await stripe.summary()).payoutsWithoutBank).toBe(0);
    await expect(stripe.linkBank(1, payoutMov.id, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });

    // Desvincular por el movimiento (operaciones) o por el payout: el libro no cambia
    await ops.unmatch(payoutMov.id, ACTOR);
    expect((await stripe.reconciliationPayout(1)).bankMovementId).toBeNull();
    expect((await ops.movements({})).items.find((m) => m.id === payoutMov.id)).toMatchObject({ status: "pending", matchType: null });
    await stripe.linkBank(1, payoutMov.id, ACTOR);
    await stripe.unlinkBank(1, ACTOR);
    expect((await entries()).length).toBe(n);
    expect((await ops.movements({ status: "pending" })).total).toBe(3);

    // Importe distinto, otra cuenta o payout inexistente: rechazos
    await expect(stripe.linkBank(1, movs.find((m) => m.amountCents === 30_250)!.id, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(stripe.linkBank(99, payoutMov.id, ACTOR)).rejects.toMatchObject({ code: "not_found" });
  });

  it("cobro de factura por transferencia (invoice_payment, bankmov:<id>) y vista por factura con fechas", async () => {
    const { stripe, ops, bank, inv1, inv2, entries, statement } = await setup();
    await stripe.saveSettings({ stripePayoutBankAccountId: bank.id }, ACTOR);
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    await stripe.post("2026-10-31", ACTOR);
    await statement(["2026-10-09;113,50;STRIPE PAYMENTS EUROPE LTD", "2026-10-15;302,50;TRANSF NEXTAIR EB-2026-0002"]);
    const movs = (await ops.movements({})).items;
    const transfer = movs.find((m) => m.amountCents === 30_250)!;
    expect((await ops.suggestions(transfer.id))[0]).toMatchObject({ type: "invoice", invoiceId: inv2.id, invoiceNumber: inv2.number, amountCents: 30_250 });
    const matched = await ops.match(transfer.id, { type: "invoice_payment", invoiceId: inv2.id }, ACTOR);
    expect(matched).toMatchObject({ matchType: "invoice_payment", matchId: inv2.id });
    const e = (await entries()).find((x) => x.sourceKey === `bankmov:${transfer.id}`)!;
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.companyId])).toEqual([
      [bank.accountCode, 30_250, 0, null],
      ["430", 0, 30_250, 9],
    ]);
    // Ya cobrada: otra transferencia no cabe
    await expect(stripe.invoiceForTransfer(inv2.id)).rejects.toMatchObject({ code: "exceeds_pending" });

    await ops.match(movs.find((m) => m.amountCents === 11_350)!.id, { type: "stripe_payout", payoutId: 1 }, ACTOR);
    const view = await stripe.reconciliationInvoices({});
    expect(view.total).toBe(2);
    const v2 = view.items.find((x) => x.invoiceId === inv2.id)!;
    expect(v2).toMatchObject({ status: "en_banco", collectedCents: 30_250, transfers: [{ bankMovementId: transfer.id, bookingDate: "2026-10-15", amountCents: 30_250, entryId: e.id }] });
    expect(v2.dates).toEqual({ invoiceDate: "2026-10-02", chargeDate: "2026-10-15", availableOn: null, payoutDate: null, bankDate: "2026-10-15" });
    const v1 = view.items.find((x) => x.invoiceId === inv1.id)!;
    // Cobro, disputa y disputa ganada: el dinero de la reversión va en po_test_2 (aún sin liquidar) → cobrada
    expect(v1).toMatchObject({ status: "cobrada", collectedCents: 12_100, feesCents: 388, issues: [] });
    expect(v1.dates).toEqual({ invoiceDate: "2026-10-01", chargeDate: "2026-10-05", availableOn: "2026-10-25", payoutDate: "2026-10-08", bankDate: "2026-10-09" });
    expect(v1.charges[0].payout).toMatchObject({ stripePayoutId: "po_test_1", bankBookingDate: "2026-10-09" });
    expect((await stripe.reconciliationInvoices({ status: "en_banco" })).items.map((x) => x.invoiceId)).toEqual([inv2.id]);
    expect((await stripe.reconciliationInvoices({ q: "0002" })).total).toBe(1);

    // Desvincular la transferencia revierte su asiento
    await ops.unmatch(transfer.id, ACTOR);
    expect((await entries()).some((x) => x.origin === "reversal")).toBe(true);
    expect((await stripe.reconciliationInvoices({})).items.find((x) => x.invoiceId === inv2.id)!.status).toBe("pendiente_cobro");
  });

  it("incidencias: revisar con nota (una vez); cobro sin factura sigue sin cliente", async () => {
    const { stripe, txn } = await setup();
    await stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    await stripe.post("2026-10-31", ACTOR);
    const c2 = await txn("txn_test_c2");
    expect((await stripe.transactions({ openIssue: true })).total).toBe(4);
    await expect(stripe.reviewTransaction(c2.id, "no", ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await stripe.reviewTransaction(c2.id, "Cargo de prueba devuelto el mismo día", ACTOR)).toMatchObject({ issue: "no_invoice", issueNote: "Cargo de prueba devuelto el mismo día", issueReviewedBy: "operator:luis", ownInvoiceId: null });
    await expect(stripe.reviewTransaction(c2.id, "Otra vez", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(stripe.reviewTransaction((await txn("txn_test_c1")).id, "Sin incidencia", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await stripe.transactions({ openIssue: true })).total).toBe(3);
    expect((await stripe.transactions({ payout: "po_test_1" })).total).toBe(5);
    expect((await stripe.transactions({ payout: "1" })).total).toBe(5);
    expect((await stripe.transactions({ type: "dispute" })).items.map((t) => t.balanceTransactionId)).toEqual(["txn_test_d1"]);
  });

  it("configuración: valida la cuenta de disputas y el banco; se audita", async () => {
    const { stripe, ledger, bank } = await setup();
    expect(await stripe.settings()).toMatchObject({ stripeFeeVat: "exempt", feeVatRateBp: 2100, stripePayoutBankAccountId: null, disputeAccountCode: "430" });
    expect(await stripe.saveSettings({ disputeAccountCode: "436", stripePayoutBankAccountId: bank.id }, ACTOR)).toMatchObject({ disputeAccountCode: "436", stripePayoutBankAccountId: bank.id, updatedBy: "operator:luis", stripeFeeVat: "exempt" });
    await expect(stripe.saveSettings({ disputeAccountCode: "705" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(stripe.saveSettings({ stripePayoutBankAccountId: 99 }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    expect((await ledger.lastAudit("stripe.settings"))?.summary).toMatchObject({ disputeAccountCode: "436" });
  });
});

describe("volumen y concurrencia", () => {
  it("más de 500 facturas: la vista por factura las recorre todas (también con filtro de estado)", async () => {
    const { stripe, invoices } = await setup();
    const PARTY2 = { ...PARTY, legalName: "Cliente Volumen SL" };
    for (let n = 0; n < 520; n++) {
      const lines = [lineOf(1, "Plan", 1, 1_000 + n, 2100)];
      const { invoice } = await invoices.insertDraft({ sourceKey: `vol:${n}`, kind: "invoice", paymentStatus: "pending", companyId: 11, billingRef: "external:9", paymentRef: null, originalInvoiceId: null, operationDate: "2026-09-15", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY2, notes: null, createdBy: "t", createdAt: T0, lines });
      await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: "2026-09-15", issuer: PARTY, customer: PARTY2, issuedBy: "t", issuedAt: T0 });
    }
    expect((await stripe.reconciliationInvoices({ limit: 10 })).total).toBe(522);
    const pending = await stripe.reconciliationInvoices({ status: "pendiente_cobro", limit: 10, offset: 515 });
    expect(pending.total).toBe(522);
    expect(pending.items).toHaveLength(7);
    expect((await stripe.reconciliationInvoices({ q: "volumen", limit: 1 })).total).toBe(520);
  });

  it("dos transferencias simultáneas a la misma factura que juntas superan lo pendiente: solo una pasa", async () => {
    const { ops, inv2, entries, statement } = await setup();
    await statement(["2026-10-15;200,00;TRANSF A", "2026-10-15;150,00;TRANSF B"]);
    const movs = (await ops.movements({})).items;
    const n = (await entries()).length;
    const race = await Promise.allSettled(movs.map((m) => ops.match(m.id, { type: "invoice_payment", invoiceId: inv2.id }, ACTOR)));
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((race.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "exceeds_pending" });
    expect((await entries()).length).toBe(n + 1);
    expect((await ops.movements({ status: "pending" })).total).toBe(1);
  });
});
