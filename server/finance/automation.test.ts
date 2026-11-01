/**
 * Automatización contable e integridad con el caso de Nextair (datos sintéticos): 1.000 € + 21 % IVA cobrados por
 * Stripe el 01/11/2026. Comprueba el estado real de producción (cobro confirmado, sin factura expedida, sin ejercicio y
 * con la clave de Stripe sin permiso de lectura de saldo) y lo que pasa cuando la fuente se sincroniza: un solo asiento
 * por hecho, repeticiones sin duplicados y el panel distinguiendo valor, cero, pendiente y no disponible.
 */
import { describe, expect, it } from "vitest";
import { chargeInstant } from "../external/schedule";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import { InvoicingService } from "../invoicing/service";
import { MemoryInvoicingStore } from "../invoicing/store";
import { ISSUER } from "../stripe/issuer";
import { FinanceAnalysisService } from "./analysisService";
import { MemoryFinanceAnalysisStore } from "./analysisStore";
import { FINANCE_AUTOMATION_ACTOR, FinanceAutomation, SEEDED_TAX_NOTES } from "./automation";
import { FinanceIntegrity } from "./integrity";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore } from "./opsStore";
import { ownInvoicesFromStore } from "./ownInvoices";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import type { StripeApiReadResult } from "./stripeBalanceApi";
import { FinanceStripeService } from "./stripeService";
import { MemoryFinanceStripeStore } from "./stripeStore";
import type { ParsedStripeTxn } from "./stripeTypes";
import { FinanceTaxService } from "./taxService";
import { MemoryFinanceTaxStore } from "./taxStore";
import { seededOps, seededPlan } from "./testkit";

const TZ = "Europe/Madrid";
const FIRST = chargeInstant("2026-11-01", 8, TZ);
const PAID_AT = FIRST + 67 * 60_000; // 09:07 de Madrid
const NOW = FIRST + 3 * 3_600_000;
const STRIPE_INVOICE = "in_sintetico_nov";

const external: ExternalSubscription = { id: 1, contractId: 4, companyId: 7, serviceKey: "skinet", serviceName: "SkiNet — Servicio tecnológico gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", billingDay: 1, billingHour: 8, timezone: TZ, graceDays: 5, firstChargeAt: FIRST, externalRef: "skicenter:nextair", status: "active", graceUntil: null } as unknown as ExternalSubscription;
const paidEvent: ExternalEvent = {
  id: 18,
  externalId: 1,
  kind: "invoice_paid",
  ref: STRIPE_INVOICE,
  detail: { tax: 21_000, number: "SINT-0002", period: "noviembre de 2026", currency: "EUR", subtotal: 100_000, taxCents: 21_000, baseCents: 100_000, companyId: 7, periodEnd: FIRST + 30 * 86_400_000, amountPaid: 121_000, billingRef: "external:1", paymentRef: `stripe:in:${STRIPE_INVOICE}`, totalCents: 121_000, periodStart: FIRST },
  actor: "system:stripe",
  at: PAID_AT,
};

const charge: ParsedStripeTxn = { balanceTransactionId: "txn_sint_1", type: "charge", rawType: "charge", createdTs: PAID_AT, createdOn: "2026-11-01", availableOn: "2026-11-08", currency: "EUR", grossCents: 121_000, feeCents: 1_840, netCents: 119_160, sourceId: "ch_sint_1", description: "Subscription update", customerId: "cus_sint", customerEmail: null, chargeId: "ch_sint_1", paymentIntentId: "pi_sint_1", stripeInvoiceId: STRIPE_INVOICE, stripePayoutId: null, payoutArrivalOn: null };

const denied: StripeApiReadResult = { status: "permission_missing", missing: ["balance_read", "payout_read"], message: "Permission denied", txns: [], payouts: [], truncated: false };
const granted = (txns: ParsedStripeTxn[] = [charge]): StripeApiReadResult => ({ status: "ok", missing: [], message: null, txns, payouts: [], truncated: false });

function setup() {
  let now = NOW;
  const clock = () => now;
  const ledger = new MemoryFinanceStore(seededPlan());
  const invoicesStore = new MemoryInvoicingStore();
  const finance = new FinanceService({ store: ledger, invoices: invoicesStore, now: clock });
  const opsStore = new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: clock });
  const stripeStore = new MemoryFinanceStripeStore();
  const own = ownInvoicesFromStore(invoicesStore);
  const stripe = new FinanceStripeService({ store: stripeStore, finance, ops: opsStore, ledger, invoices: own, now: clock });
  ops.useReconciliation(stripe);
  const tax = new FinanceTaxService({ store: new MemoryFinanceTaxStore(), finance, ledger, ops: opsStore, documents: ops, stripe: stripeStore, issuer: { legalName: ISSUER.legalName, taxId: ISSUER.taxId }, now: clock });
  const events = [paidEvent];
  const ext = { list: async () => [external], events: async (id: number) => events.filter((e) => e.externalId === id) };
  const invoicing = new InvoicingService({ store: invoicesStore, external: ext, company: async () => ({ name: "Nextair", legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "18006", city: "Granada", country: "ES", billingEmail: null }), issuer: { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: "Calle", postalCode: "28002", city: "Madrid", country: "ES" }, seriesCode: "EB", issueEnabled: false, now: clock });
  let read: StripeApiReadResult = denied;
  const reads: number[] = [];
  const automation = new FinanceAutomation({ finance, ledger, stripe, stripeApi: { read: async (since) => (reads.push(since), read) }, tax, invoicing, issuer: { legalName: ISSUER.legalName, taxId: ISSUER.taxId }, now: clock });
  const integrity = new FinanceIntegrity({ finance, ledger, ops: opsStore, external: ext, invoices: own, invoiceStore: invoicesStore, issueEnabled: false, stripe: { service: stripe, store: stripeStore }, tax, automation, now: clock });
  const analysis = new FinanceAnalysisService({ store: new MemoryFinanceAnalysisStore({ ledger, ops: opsStore, stripe: stripeStore }), finance, ledger, ops: opsStore, stripe: { service: stripe, store: stripeStore }, tax, invoices: own, integrity, now: clock });
  return { ledger, finance, ops, opsStore, stripe, stripeStore, tax, invoicesStore, events, automation, integrity, analysis, reads, setRead: (r: StripeApiReadResult) => (read = r), at: (t: number) => (now = t) };
}

const codes = (xs: Array<{ code: string }>) => xs.map((x) => x.code);

describe("automatización contable: el estado real de Nextair el 01/11/2026", () => {
  it("sin permisos de lectura en la clave de Stripe: ejercicio, configuración fiscal y borrador, pero ningún importe inventado", async () => {
    const t = setup();
    const r = await t.automation.tick();
    expect(r.fiscalYear).toMatchObject({ status: "ok", changed: true });
    expect((await t.finance.fiscalYears()).map((y) => y.year)).toEqual([2026]);
    expect(r.taxSettings).toMatchObject({ status: "ok", validated: false, changed: true });
    expect(await t.tax.settings()).toMatchObject({ configured: true, legalName: "IRON ELEPHANT CONSULTING, S.L.", taxId: "B26987875", fiscalYearStartMonth: 1, validatedAt: null, notes: SEEDED_TAX_NOTES });
    // Borrador de noviembre, ya marcado como cobrado por el webhook; nunca expedido
    expect(r.invoiceDrafts).toMatchObject({ status: "ok", created: 1, payments: 1 });
    const drafts = await t.invoicesStore.list({});
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: "draft", number: null, paymentStatus: "paid", paymentRef: `stripe:in:${STRIPE_INVOICE}`, baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, operationDate: "2026-11-01" });
    expect(r.stripe).toMatchObject({ status: "unavailable", source: "permission_missing", missing: ["balance_read", "payout_read"] });
    expect(t.reads[0]).toBe(Math.floor(NOW / 1000) - 40 * 86_400);
    // Nada en el libro: el cobro está confirmado, pero sin factura expedida ni transacción de saldo no hay asiento
    expect((await t.ledger.listEntries({})).total).toBe(0);

    const alerts = await t.integrity.alerts();
    expect(codes(alerts)).toEqual(expect.arrayContaining(["stripe_source_unavailable", "confirmed_payment_unposted", "confirmed_payment_without_invoice", "invoice_drafts_due", "opening_entry_pending", "fiscal_config_unvalidated", "bank_not_configured"]));
    expect(codes(alerts)).not.toContain("automation_stale");
    expect(codes(alerts)).not.toContain("fiscal_year_missing");
    const unposted = alerts.find((a) => a.code === "confirmed_payment_unposted")!;
    expect(unposted).toMatchObject({ severity: "critical", count: 1, amountCents: 121_000, source: "Stripe → libro diario" });
    expect(unposted.action).toMatch(/permisos de lectura/);
    expect(alerts.find((a) => a.code === "stripe_source_unavailable")!.action).toMatch(/balance_read, payout_read/);
    expect(alerts.find((a) => a.code === "confirmed_payment_without_invoice")!.action).toMatch(/DF-2/);

    const o = await t.integrity.overview();
    const ind = (k: string) => o.indicators.find((i) => i.key === k)!;
    expect(o.definitive).toBe(false);
    expect(o.status).toMatchObject({ fiscalYear: "open", openingEntry: "pending", operationsPosted: 0, fiscalConfig: "pending_validation", banks: 0, stripeSource: "permission_missing", invoicingIssue: "disabled" });
    expect(ind("collected")).toMatchObject({ state: "pending", cents: 121_000, pendingCents: 121_000 });
    expect(ind("accruedRevenue")).toMatchObject({ state: "pending", cents: 0, pendingCents: 100_000 });
    expect(ind("invoicedIssued")).toMatchObject({ state: "pending", cents: 0, pendingCents: 121_000 });
    expect(ind("vatOutput")).toMatchObject({ state: "pending", cents: 0, pendingCents: 21_000 });
    expect(ind("stripeBalance")).toMatchObject({ state: "unavailable", cents: null });
    expect(ind("bankBalance")).toMatchObject({ state: "unavailable", cents: null });
    expect(ind("treasury")).toMatchObject({ state: "unavailable", cents: null });
    expect(ind("accruedExpenses")).toMatchObject({ state: "pending" });
    expect(ind("receivablePending")).toMatchObject({ state: "zero", cents: 0 });
    // Ningún indicador presenta un 0,00 € como cero real salvo que la fuente esté completa
    expect(o.indicators.filter((i) => i.state === "zero").map((i) => i.key)).toEqual(["receivablePending"]);
    expect(o.facts).toEqual([expect.objectContaining({ stripeInvoiceId: STRIPE_INVOICE, totalCents: 121_000, posted: false, invoiced: false })]);

    // El control diario de hoy no dice «sin alertas»; un día pasado solo lleva sus recuentos
    const daily = await t.analysis.daily();
    expect(codes(daily.alerts)).toEqual(expect.arrayContaining(["confirmed_payment_unposted", "stripe_source_unavailable"]));
    expect(daily.alerts.find((a) => a.code === "confirmed_payment_unposted")).toMatchObject({ source: "Stripe → libro diario", amountCents: 121_000 });
    expect(codes((await t.analysis.daily("2026-10-31")).alerts)).not.toContain("confirmed_payment_unposted");
  });

  it("repetir la pasada no crea nada nuevo y solo registra en la auditoría lo que cambia", async () => {
    const t = setup();
    await t.automation.tick();
    t.at(NOW + 15 * 60_000);
    const r = await t.automation.tick();
    expect(r.fiscalYear.changed).toBeUndefined();
    expect(r.taxSettings.changed).toBeUndefined();
    expect(r.invoiceDrafts).toMatchObject({ created: 0, payments: 0, changed: false });
    expect(await t.invoicesStore.list({})).toHaveLength(1);
    // La segunda pasada se registra (el estado de los pasos que la primera creó ya es otro); la tercera, idéntica, no
    const second = await t.ledger.lastAudit("automation.run");
    t.at(NOW + 30 * 60_000);
    await t.automation.tick();
    expect((await t.ledger.lastAudit("automation.run"))!.id).toBe(second!.id);
    t.at(NOW + 91 * 60_000);
    await t.automation.tick();
    expect((await t.ledger.lastAudit("automation.run"))!.id).not.toBe(second!.id);
  });

  it("impago sin recuperar, disputa (un aviso por cargo, con su último estado) y reembolso sin contabilizar", async () => {
    const t = setup();
    await t.automation.tick();
    const base = { externalId: 1, actor: "system:stripe" };
    const billing = { companyId: 7, billingRef: "external:1", paymentRef: "stripe:in:in_sint_dic", totalCents: 121_000, baseCents: 100_000, taxCents: 21_000, period: "diciembre de 2026" };
    t.events.push(
      { ...base, id: 30, kind: "invoice_payment_failed", ref: "in_sint_dic", detail: billing, at: NOW + 1 },
      { ...base, id: 31, kind: "charge_dispute", ref: "ch_sint_1:needs_response", detail: { ...paidEvent.detail, disputeStatus: "needs_response" }, at: NOW + 2 },
      { ...base, id: 32, kind: "charge_dispute", ref: "ch_sint_1:under_review", detail: { ...paidEvent.detail, disputeStatus: "under_review" }, at: NOW + 3 },
      { ...base, id: 33, kind: "charge_refunded", ref: "ch_sint_1:12100", detail: { ...paidEvent.detail, refundedDeltaCents: 12_100, refundedCents: 12_100, fullyRefunded: false }, at: NOW + 4 },
    );
    const alerts = await t.integrity.alerts();
    expect(alerts.find((a) => a.code === "payment_failed")).toMatchObject({ count: 1, amountCents: 121_000 });
    expect(alerts.find((a) => a.code === "dispute_open")).toMatchObject({ severity: "critical", count: 1 });
    expect(alerts.find((a) => a.code === "refund_unposted")).toMatchObject({ count: 1, amountCents: 12_100 });
    expect((await t.integrity.overview()).indicators.find((i) => i.key === "receivablePending")).toMatchObject({ state: "value", cents: 121_000 });
    // Cobrada después la misma factura: el impago deja de avisar; la disputa ganada se cierra
    t.events.push({ ...base, id: 34, kind: "invoice_paid", ref: "in_sint_dic", detail: billing, at: NOW + 5 }, { ...base, id: 35, kind: "charge_dispute", ref: "ch_sint_1:won", detail: { ...paidEvent.detail, disputeStatus: "won" }, at: NOW + 6 });
    expect(codes(await t.integrity.alerts())).not.toEqual(expect.arrayContaining(["payment_failed"]));
    expect(codes(await t.integrity.alerts())).not.toContain("dispute_open");
  });

  it("sin pasadas en dos horas, la automatización figura como parada", async () => {
    const t = setup();
    expect(codes(await t.integrity.alerts())).toContain("automation_stale");
    await t.automation.tick();
    t.at(NOW + 3 * 3_600_000);
    expect(codes(await t.integrity.alerts())).toContain("automation_stale");
  });
});

describe("automatización contable: con la fuente de Stripe sincronizada", () => {
  it("contabiliza el cobro una sola vez (bruto, comisión y neto) y el panel lo refleja", async () => {
    const t = setup();
    await t.automation.tick();
    t.setRead(granted());
    t.at(NOW + 15 * 60_000);
    const r = await t.automation.tick();
    expect(r.stripe).toMatchObject({ status: "ok", source: "ok", inserted: 1, posted: 1 });
    const entries = (await t.ledger.listEntries({})).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceKey: "stripe-txn:txn_sint_1", journalCode: "STR", date: "2026-11-01", status: "posted" });
    const lines = entries[0].lines.map((l) => [l.accountCode, l.debitCents, l.creditCents]);
    expect(lines).toEqual(expect.arrayContaining([["5720", 119_160, 0], ["626", 1_840, 0], ["430", 0, 121_000]]));

    // La misma lectura otra vez, y otra con una transacción nueva: el cobro no se duplica
    t.at(NOW + 30 * 60_000);
    await t.automation.tick();
    const refund: ParsedStripeTxn = { ...charge, balanceTransactionId: "txn_sint_2", type: "refund", rawType: "refund", grossCents: -12_100, feeCents: 0, netCents: -12_100, sourceId: "re_sint_1", description: "Reembolso parcial sintético" };
    t.setRead(granted([charge, refund]));
    t.at(NOW + 45 * 60_000);
    const r3 = await t.automation.tick();
    expect(r3.stripe).toMatchObject({ inserted: 1, posted: 1 });
    expect((await t.ledger.listEntries({})).items.map((e) => e.sourceKey).sort()).toEqual(["stripe-txn:txn_sint_1", "stripe-txn:txn_sint_2"]);
    expect((await t.stripeStore.listImports(10)).filter((i) => i.kind === "balance")).toHaveLength(2);

    const alerts = await t.integrity.alerts();
    expect(codes(alerts)).not.toContain("confirmed_payment_unposted");
    expect(codes(alerts)).not.toContain("stripe_source_unavailable");
    // Sin factura expedida (DF-2) la incidencia sigue: el ingreso no está en el libro
    expect(codes(alerts)).toContain("confirmed_payment_without_invoice");
    const o = await t.integrity.overview();
    const ind = (k: string) => o.indicators.find((i) => i.key === k)!;
    expect(ind("collected")).toMatchObject({ state: "value", cents: 121_000 });
    expect(ind("stripeBalance")).toMatchObject({ state: "value", cents: 119_160 - 12_100 });
    expect(ind("accruedRevenue")).toMatchObject({ state: "pending", cents: 0 });
    expect(o.facts[0]).toMatchObject({ posted: true, invoiced: false });
  });

  it("un informe CSV con la misma transacción después de la API no la duplica", async () => {
    const t = setup();
    t.setRead(granted());
    await t.automation.tick();
    const csv = ["id,Type,Created (UTC),Available On (UTC),Amount,Fee,Net,Currency,Description,Source,Invoice ID", `txn_sint_1,charge,2026-11-01 08:07,2026-11-08 00:00,1210.00,18.40,1191.60,eur,Subscription update,ch_sint_1,${STRIPE_INVOICE}`].join("\n");
    const imp = await t.stripe.importFile({ kind: "balance", filename: "balance.csv", contentBase64: Buffer.from(csv).toString("base64") }, FINANCE_AUTOMATION_ACTOR);
    expect(imp).toMatchObject({ inserted: 0, duplicates: 1 });
    await t.stripe.post("2026-11-01", FINANCE_AUTOMATION_ACTOR);
    expect((await t.ledger.listEntries({})).total).toBe(1);
  });
});
