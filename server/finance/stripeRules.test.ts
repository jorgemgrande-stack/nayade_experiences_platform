/**
 * Reglas puras de la fase 2 (Stripe): lectura de los dos informes CSV (cabeceras por nombre, importes, fechas en
 * Madrid, filas ilegibles), tipos normalizados, asientos de cobro, comisión (exenta y con inversión del sujeto pasivo),
 * reembolso con y sin devolución de comisión, disputa perdida y ganada, comisiones de Stripe y payout, incidencias,
 * sugerencias banco ↔ payout / factura y estado de la conciliación por factura. Solo datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import { validateEntry } from "./rules";
import {
  businessDaysBetween,
  invoiceTransferEntry,
  normalizeHeader,
  normalizeStripeType,
  parseBalanceCsv,
  parsePayoutsCsv,
  parseStripeDate,
  reconciliationStatus,
  stripePayoutEntry,
  stripeTxnEntry,
  suggestStripeMatches,
  txnIssue,
} from "./stripeRules";
import { DEFAULT_STRIPE_SETTINGS, type ParsedStripeTxn } from "./stripeTypes";
import { seededPlan, stripeBalanceSample, stripeLegacySample, stripePayoutsSample } from "./testkit";
import type { Account } from "./types";

const accounts = new Map<string, Account>(seededPlan().accounts.map((a, i) => [a.code, { ...a, id: i + 1 }]));
accounts.set("57200001", { id: 999, code: "57200001", name: "Banco", type: "asset", parentCode: "572", isPostable: true, active: true, createdAt: 0 });
const EXEMPT = DEFAULT_STRIPE_SETTINGS;
const RC = { ...DEFAULT_STRIPE_SETTINGS, stripeFeeVat: "reverse_charge" as const, feeVatRateBp: 2100 };
const INV = { id: 1, number: "EB-2026-0001", companyId: 9, totalCents: 12_100 };
/** Líneas como «D 5720 11712» / «H 430 12100 #9» para comparar de un vistazo. */
const lines = (d: ReturnType<typeof stripeTxnEntry>) => {
  validateEntry(d, accounts);
  return d.lines.map((l) => `${l.debitCents ? "D" : "H"} ${l.accountCode} ${l.debitCents || l.creditCents}${l.companyId ? ` #${l.companyId}` : ""}`);
};
const txn = (o: Partial<ParsedStripeTxn>): ParsedStripeTxn => ({
  balanceTransactionId: "txn_x",
  type: "charge",
  rawType: "charge",
  createdTs: null,
  createdOn: "2026-10-05",
  availableOn: null,
  currency: "EUR",
  grossCents: 12_100,
  feeCents: 388,
  netCents: 11_712,
  sourceId: null,
  description: null,
  customerId: null,
  customerEmail: null,
  chargeId: "ch_x",
  paymentIntentId: null,
  stripeInvoiceId: null,
  stripePayoutId: null,
  payoutArrivalOn: null,
  ...o,
});

describe("lectura de los informes de Stripe", () => {
  it("cabeceras por nombre: insensibles a mayúsculas, espacios, paréntesis y guiones bajos", () => {
    expect(normalizeHeader("Created (UTC)")).toBe(normalizeHeader("created_utc"));
    expect(normalizeHeader("﻿Available On (UTC)")).toBe("availableonutc");
  });

  it("fechas: UTC → Madrid (un cobro a las 23:30 UTC del 31/10 es del 1/11); sin hora o local, tal cual", () => {
    expect(parseStripeDate("2026-10-31 23:30", true)).toEqual({ date: "2026-11-01", ts: Date.UTC(2026, 9, 31, 23, 30) });
    expect(parseStripeDate("2026-07-31T22:30:00Z", false)!.date).toBe("2026-08-01");
    expect(parseStripeDate("2026-10-31 23:30", false)).toEqual({ date: "2026-10-31", ts: null });
    expect(parseStripeDate("2026-10-05", true)).toEqual({ date: "2026-10-05", ts: null });
    expect(parseStripeDate("1791763200", true)!.date).toBe("2026-10-12");
    expect(parseStripeDate("05/10/2026", true)).toBeNull();
    expect(parseStripeDate("2026-02-30", true)).toBeNull();
  });

  it("«Balance change from activity – itemized»: tipos, céntimos, fechas, payout y avisos", () => {
    const { rows, problems } = parseBalanceCsv(stripeBalanceSample());
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.balanceTransactionId, r.type])).toEqual([
      ["txn_test_c1", "charge"],
      ["txn_test_c2", "charge"],
      ["txn_test_r2", "refund"],
      ["txn_test_f1", "stripe_fee"],
      ["txn_test_p1", "payout"],
      ["txn_test_d1", "dispute"],
      ["txn_test_d2", "dispute_reversal"],
      ["txn_test_usd", "charge"],
      ["txn_test_t1", "other"],
    ]);
    expect(rows[0]).toMatchObject({ createdOn: "2026-10-05", availableOn: "2026-10-07", currency: "EUR", grossCents: 12_100, feeCents: 388, netCents: 11_712, chargeId: "ch_test_1", stripeInvoiceId: "in_test_1", stripePayoutId: "po_test_1", customerEmail: "facturacion@cliente-a.example", payoutArrivalOn: null });
    expect(rows[4]).toMatchObject({ stripePayoutId: "po_test_1", payoutArrivalOn: "2026-10-08", grossCents: -11_350 });
    expect(rows[7].currency).toBe("USD");
  });

  it("export clásico: «Amount», «Type», «Created (UTC)», miles con coma, ajustes de disputa y filas rotas", () => {
    const { rows, problems } = parseBalanceCsv(stripeLegacySample());
    expect(rows.map((r) => [r.balanceTransactionId, r.type, r.grossCents, r.createdOn])).toEqual([
      ["txn_test_l1", "charge", 121_000, "2026-11-01"],
      ["txn_test_l2", "dispute", -5_000, "2026-10-30"],
      ["txn_test_l3", "other", -200, "2026-10-30"],
    ]);
    expect(rows[0]).toMatchObject({ stripePayoutId: "po_test_l", chargeId: "ch_test_l1", netCents: 119_281 });
    expect(problems).toEqual([{ line: 5, message: "Importe no reconocido (bruto, comisión o neto)" }]);
  });

  it("columnas que faltan, neto que no cuadra y repetidas: avisos o rechazo", () => {
    expect(() => parseBalanceCsv("fecha;importe\n2026-10-01;3")).toThrow(/faltan las columnas balancetransactionid, createdutc, currency, gross, fee, net, reportingcategory/);
    const h = "id,created_utc,currency,amount,fee,net,type";
    const r = parseBalanceCsv(`${h}\ntxn_a,2026-10-01 10:00,eur,10.00,1.00,8.00,charge\ntxn_b,2026-10-01 10:00,eur,10.00,1.00,9.00,charge\ntxn_b,2026-10-01 10:00,eur,10.00,1.00,9.00,charge\n,2026-10-01,eur,1,0,1,charge`);
    expect(r.rows.map((x) => x.balanceTransactionId)).toEqual(["txn_b"]);
    expect(r.problems.map((p) => p.line)).toEqual([2, 4, 5]);
    expect(r.problems[0].message).toMatch(/neto/);
    expect(r.problems[1].message).toMatch(/repetida/);
  });

  it("CSV con «;», comillas, comas y saltos de línea dentro de un concepto", () => {
    const text = 'id;created_utc;currency;amount;fee;net;type;description\r\ntxn_q;2026-10-02 10:00;eur;5.00;0.00;5.00;charge;"Línea 1, con coma\nlínea 2 ""citada"""\r\n';
    const { rows } = parseBalanceCsv(text);
    expect(rows[0].description).toBe('Línea 1, con coma\nlínea 2 "citada"');
  });

  it("«Payouts – itemized»: importe positivo, llegada, y la reversión marca el payout como fallido", () => {
    const { rows, problems } = parsePayoutsCsv(stripePayoutsSample());
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { payoutId: "po_test_1", createdOn: null, arrivalOn: "2026-10-08", currency: "EUR", amountCents: 11_350, feeCents: 0, status: "paid", description: "STRIPE PAYOUT" },
      { payoutId: "po_test_9", createdOn: null, arrivalOn: "2026-10-12", currency: "EUR", amountCents: 4_000, feeCents: 0, status: "failed", description: "STRIPE PAYOUT" },
    ]);
    const legacy = parsePayoutsCsv("id,Amount,Currency,Arrival Date (UTC),Status\npo_a,25.00,eur,2026-10-09,in_transit\npo_b,10.00,eur,2026-10-09,raro\nxx,1,eur,2026-10-09,paid");
    expect(legacy.rows).toEqual([{ payoutId: "po_a", createdOn: null, arrivalOn: "2026-10-09", currency: "EUR", amountCents: 2_500, feeCents: 0, status: "in_transit", description: null }]);
    expect(legacy.problems.map((p) => p.line)).toEqual([3, 4]);
    expect(() => parsePayoutsCsv(stripeBalanceSample())).toThrow(/faltan las columnas/);
  });

  it("tipos normalizados", () => {
    expect(normalizeStripeType("payment", 1, null)).toBe("charge");
    expect(normalizeStripeType("payment_refund", -1, null)).toBe("refund");
    expect(normalizeStripeType("refund_failure", 1, null)).toBe("refund_failure");
    expect(normalizeStripeType("adjustment", 100, "Chargeback reversal")).toBe("dispute_reversal");
    expect(normalizeStripeType("adjustment", -100, "Corrección")).toBe("other");
    expect(normalizeStripeType("Stripe Fee", -1, null)).toBe("stripe_fee");
    expect(normalizeStripeType("network_cost", -1, null)).toBe("stripe_fee");
    expect(normalizeStripeType("tax", -1, null)).toBe("stripe_fee");
    expect(normalizeStripeType("payout_failure", 1, null)).toBe("payout_reversal");
    expect(normalizeStripeType("payout_cancel", 1, null)).toBe("payout_reversal");
    expect(normalizeStripeType("topup", 1, null)).toBe("other");
  });
});

describe("asientos (contrato §2)", () => {
  it("cobro con comisión exenta: Debe 5720 neto · Debe 626 comisión · Haber 430 bruto (con la empresa de la factura)", () => {
    const d = stripeTxnEntry(txn({}), EXEMPT, INV);
    expect(d).toMatchObject({ journalCode: "STR", date: "2026-10-05", origin: "stripe", sourceKey: "stripe-txn:txn_x" });
    expect(lines(d)).toEqual(["D 5720 11712", "D 626 388", "H 430 12100 #9"]);
    expect(d.description).toContain("factura EB-2026-0001");
  });

  it("cobro con inversión del sujeto pasivo: además Debe 472 / Haber 477 al 21 % de la comisión", () => {
    const d = stripeTxnEntry(txn({}), RC, null);
    expect(lines(d)).toEqual(["D 5720 11712", "D 626 388", "H 430 12100", "D 472 81", "H 477 81"]);
    expect(d.lines[3]).toMatchObject({ taxRateBp: 2100, taxBaseCents: 388 });
  });

  it("reembolso sin devolución de comisión: Debe 430 · Haber 5720", () => {
    expect(lines(stripeTxnEntry(txn({ type: "refund", grossCents: -6_050, feeCents: 0, netCents: -6_050 }), RC, null))).toEqual(["H 5720 6050", "D 430 6050"]);
  });

  it("reembolso con comisión devuelta: Debe 430 · Haber 5720 neto · Haber 626 (e IVA invertido si procede)", () => {
    expect(lines(stripeTxnEntry(txn({ type: "refund", grossCents: -6_050, feeCents: -200, netCents: -5_850 }), EXEMPT, INV))).toEqual(["H 5720 5850", "H 626 200", "D 430 6050 #9"]);
    expect(lines(stripeTxnEntry(txn({ type: "refund", grossCents: -6_050, feeCents: -200, netCents: -5_850 }), RC, null))).toEqual(["H 5720 5850", "H 626 200", "D 430 6050", "H 472 42", "D 477 42"]);
  });

  it("disputa perdida: Debe 430 (o la de dudoso cobro configurada) · Debe 626 comisión · Haber 5720", () => {
    const lost = txn({ type: "dispute", grossCents: -12_100, feeCents: 1_500, netCents: -13_600 });
    expect(lines(stripeTxnEntry(lost, EXEMPT, INV))).toEqual(["H 5720 13600", "D 626 1500", "D 430 12100 #9"]);
    expect(lines(stripeTxnEntry(lost, { ...EXEMPT, disputeAccountCode: "436" }, INV))).toEqual(["H 5720 13600", "D 626 1500", "D 436 12100 #9"]);
  });

  it("disputa ganada: exactamente el inverso de la retención", () => {
    const won = txn({ type: "dispute_reversal", grossCents: 12_100, feeCents: -1_500, netCents: 13_600 });
    expect(lines(stripeTxnEntry(won, EXEMPT, INV))).toEqual(["D 5720 13600", "H 626 1500", "H 430 12100 #9"]);
  });

  it("comisiones y servicios de Stripe: Debe 626 · Haber 5720 (con inversión: IVA sobre el cargo)", () => {
    const fee = txn({ type: "stripe_fee", grossCents: -150, feeCents: 0, netCents: -150, chargeId: null });
    expect(lines(stripeTxnEntry(fee, EXEMPT, null))).toEqual(["H 5720 150", "D 626 150"]);
    expect(lines(stripeTxnEntry(fee, RC, null))).toEqual(["H 5720 150", "D 626 150", "D 472 32", "H 477 32"]);
  });

  it("payout: Debe 572000NN del banco · Haber 5720, fecha de llegada; ni payouts ni otras monedas por la vía de transacción", () => {
    const d = stripePayoutEntry({ payoutId: "po_x", arrivalOn: "2026-10-08", amountCents: 11_350, currency: "EUR" }, "57200001");
    expect(d).toMatchObject({ journalCode: "STR", date: "2026-10-08", sourceKey: "stripe-payout:po_x", origin: "stripe" });
    expect(lines(d)).toEqual(["D 57200001 11350", "H 5720 11350"]);
    expect(() => stripePayoutEntry({ payoutId: "po_x", arrivalOn: "2026-10-08", amountCents: 1, currency: "EUR" }, "5720")).toThrow(/propia de Stripe/);
    expect(() => stripeTxnEntry(txn({ type: "payout", grossCents: -100, feeCents: 0, netCents: -100 }), EXEMPT, null)).toThrow(/no se contabiliza con su propio asiento/);
    expect(() => stripeTxnEntry(txn({ currency: "USD" }), EXEMPT, null)).toThrow(/euros/);
    expect(() => stripeTxnEntry(txn({ netCents: 1 }), EXEMPT, null)).toThrow(/neto/);
  });

  it("cobro de factura por transferencia: Debe banco · Haber 430 con la empresa", () => {
    const d = invoiceTransferEntry({ amountCents: 30_250, bookingDate: "2026-10-15" }, "57200001", { id: 2, number: "EB-2026-0002", companyId: 9 }, "bankmov:7");
    expect(d).toMatchObject({ journalCode: "BAN", origin: "bank", sourceKey: "bankmov:7", date: "2026-10-15" });
    expect(lines(d)).toEqual(["D 57200001 30250", "H 430 30250 #9"]);
    expect(() => invoiceTransferEntry({ amountCents: -1, bookingDate: "2026-10-15" }, "57200001", { id: 2, number: null, companyId: null }, "bankmov:7")).toThrow(/abono/);
  });

  it("incidencias: cobro sin factura, importe distinto, reembolso, disputa, moneda y tipo no soportado", () => {
    expect(txnIssue(txn({}), INV)).toBeNull();
    expect(txnIssue(txn({}), null)).toBe("no_invoice");
    expect(txnIssue(txn({ grossCents: 10_000 }), INV)).toBe("amount_mismatch");
    expect(txnIssue(txn({ type: "refund" }), INV)).toBe("refund");
    expect(txnIssue(txn({ type: "dispute" }), INV)).toBe("dispute");
    expect(txnIssue(txn({ type: "dispute_reversal" }), INV)).toBeNull();
    expect(txnIssue(txn({ currency: "USD" }), INV)).toBe("currency");
    expect(txnIssue(txn({ type: "other" }), null)).toBe("unsupported");
  });
});

describe("conciliación (§4)", () => {
  it("días hábiles: de viernes a lunes es uno; mismo día, cero", () => {
    expect(businessDaysBetween("2026-10-09", "2026-10-12")).toBe(1);
    expect(businessDaysBetween("2026-10-12", "2026-10-09")).toBe(1);
    expect(businessDaysBetween("2026-10-08", "2026-10-08")).toBe(0);
    expect(businessDaysBetween("2026-10-08", "2026-10-15")).toBe(5);
  });

  it("sugerencias: payout por importe exacto y ±3 días hábiles (o «STRIPE» en el concepto); facturas pendientes", () => {
    const payouts = [
      { id: 1, payoutId: "po_a", arrivalOn: "2026-10-08", amountCents: 11_350 },
      { id: 2, payoutId: "po_b", arrivalOn: "2026-09-01", amountCents: 11_350 },
      { id: 3, payoutId: "po_c", arrivalOn: "2026-10-08", amountCents: 11_351 },
    ];
    const invoices = [
      { id: 7, number: "EB-2026-0002", customerName: "NEXTAIR SL", issueDate: "2026-10-01", pendingCents: 30_250 },
      { id: 8, number: "EB-2026-0003", customerName: "Otra Empresa SL", issueDate: "2026-10-01", pendingCents: 11_350 },
    ];
    const plain = suggestStripeMatches({ amountCents: 11_350, bookingDate: "2026-10-12", description: "ABONO TRANSFERENCIA", counterparty: null, reference: null }, payouts, invoices);
    expect(plain.map((s) => (s.type === "stripe_payout" ? `payout:${s.payoutId}` : `factura:${s.invoiceId}`))).toEqual(["payout:1", "factura:8"]);
    const stripe = suggestStripeMatches({ amountCents: 11_350, bookingDate: "2026-10-12", description: "STRIPE PAYMENTS EUROPE", counterparty: null, reference: null }, payouts, []);
    expect(stripe.map((s) => (s.type === "stripe_payout" ? s.payoutId : 0))).toEqual([1, 2]);
    expect(stripe[0].reasons).toEqual(["Importe exacto", "Llegada a 2 días hábiles", "«STRIPE» en el concepto"]);
    const named = suggestStripeMatches({ amountCents: 10_000, bookingDate: "2026-10-15", description: "TRANSF NEXTAIR PAGO EB-2026-0002", counterparty: null, reference: null }, payouts, invoices);
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ type: "invoice", invoiceId: 7, reasons: ["Número de factura en el concepto", "Cliente en el concepto"] });
    expect(suggestStripeMatches({ amountCents: -11_350, bookingDate: "2026-10-12", description: "STRIPE", counterparty: null, reference: null }, payouts, invoices)).toEqual([]);
  });

  it("estado por factura: pendiente_cobro → cobrada → liquidada → en_banco, e incidencia hasta revisarla", () => {
    const base = { totalCents: 12_100, transfersCents: 0, reviewed: true };
    const c = (o: Partial<{ type: "charge" | "refund" | "dispute"; grossCents: number; payoutPosted: boolean; payoutInBank: boolean }> = {}) => ({ type: "charge" as const, grossCents: 12_100, payoutPosted: false, payoutInBank: false, ...o });
    expect(reconciliationStatus({ ...base, stripe: [] })).toBe("pendiente_cobro");
    expect(reconciliationStatus({ ...base, stripe: [c()] })).toBe("cobrada");
    expect(reconciliationStatus({ ...base, stripe: [c({ payoutPosted: true })] })).toBe("liquidada");
    expect(reconciliationStatus({ ...base, stripe: [c({ payoutPosted: true, payoutInBank: true })] })).toBe("en_banco");
    expect(reconciliationStatus({ ...base, stripe: [], transfersCents: 12_100 })).toBe("en_banco");
    expect(reconciliationStatus({ ...base, reviewed: false, stripe: [c({ grossCents: 10_000 })] })).toBe("incidencia");
    expect(reconciliationStatus({ ...base, reviewed: false, stripe: [c(), c({ type: "refund", grossCents: -12_100 })] })).toBe("incidencia");
    expect(reconciliationStatus({ ...base, reviewed: true, stripe: [c(), c({ type: "refund", grossCents: -12_100 })] })).toBe("pendiente_cobro");
  });
});
