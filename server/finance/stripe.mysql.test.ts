/**
 * Stripe (fase 2) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y retirada aquí, con todas
 * las migraciones del CRM): importación con doble fichero y solapes, contabilización repetida y simultánea sin
 * duplicar asientos, payout vinculado al banco SIN asiento nuevo (también con vínculos simultáneos), payout fallido,
 * cobro de factura propia por transferencia, configuración y fechas sin desplazamiento. Solo datos sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { lineOf, totals } from "../invoicing/rules";
import { MysqlInvoicingStore } from "../invoicing/store";
import type { FiscalParty } from "../invoicing/types";
import { FinanceOpsService } from "./opsService";
import { MysqlFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MysqlFinanceStore } from "./store";
import { FinanceStripeService } from "./stripeService";
import { MysqlFinanceStripeStore, MysqlStripeInvoiceDirectory, finStripeTablesReady } from "./stripeStore";
import { MysqlOwnInvoiceDirectory, mysqlKeyedLock } from "./ownInvoices";
import { stripeBalanceSample, stripePayoutsSample } from "./testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "finance_stripe_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 9, 30, 10);
const ACTOR = { by: "operator:luis", requestId: "req-stripe-mysql" };
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const b64 = (s: string) => Buffer.from(s).toString("base64");

describe.skipIf(!URL_)("Stripe y conciliación con MySQL real (CRM 0036)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let ledger: MysqlFinanceStore;
  let finance: FinanceService;
  let ops: FinanceOpsService;
  let opsStore: MysqlFinanceOpsStore;
  let stripe: FinanceStripeService;
  let bankId: number;
  let bankCode: string;
  let invoiceIds: number[] = [];
  const count = async (sql: string, args: unknown[] = []) => Number(((await pool.query<mysql.RowDataPacket[]>(sql, args))[0][0] as { n: number }).n);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    expect(await finStripeTablesReady(pool)).toBe(false);
    for (const m of loadMigrations(DIR).migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await finStripeTablesReady(pool)).toBe(true);
    ledger = new MysqlFinanceStore(pool);
    finance = new FinanceService({ store: ledger, now: () => T });
    await finance.createFiscalYear(2026, ACTOR);
    opsStore = new MysqlFinanceOpsStore(pool);
    ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => T });
    const bank = await ops.createBankAccount({ name: "CaixaBank principal" }, ACTOR);
    bankId = bank.id;
    bankCode = bank.accountCode;
    const invoices = new MysqlInvoicingStore(pool, "test");
    for (const [key, base, ref, date] of [["external:1:2026-10", 10_000, "stripe:in:in_test_1", "2026-10-01"], ["charge:5", 25_000, null, "2026-10-02"]] as const) {
      const lines = [lineOf(1, "Servicio", 1, base, 2100)];
      const { invoice } = await invoices.insertDraft({ sourceKey: key, kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: date, periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: T, lines });
      await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: date, issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: T });
      if (ref) await invoices.setPayment(invoice.id, { paymentStatus: "paid", paymentRef: ref, paidAt: T }, T);
      invoiceIds.push(invoice.id);
    }
    stripe = new FinanceStripeService({ store: new MysqlFinanceStripeStore(pool), finance, ops: opsStore, ledger, invoices: new MysqlOwnInvoiceDirectory(pool, "test"), stripeInvoices: new MysqlStripeInvoiceDirectory(pool), lock: mysqlKeyedLock(pool), now: () => T });
    ops.useReconciliation(stripe);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("configuración: valores por defecto sin fila, guardado con upsert y la FK al banco", async () => {
    expect(await stripe.settings()).toMatchObject({ stripeFeeVat: "exempt", feeVatRateBp: 2100, stripePayoutBankAccountId: null, disputeAccountCode: "430", updatedBy: null });
    await stripe.saveSettings({ disputeAccountCode: "436" }, ACTOR);
    expect(await stripe.saveSettings({ disputeAccountCode: "430", stripePayoutBankAccountId: bankId }, ACTOR)).toMatchObject({ disputeAccountCode: "430", stripePayoutBankAccountId: bankId, updatedBy: "operator:luis", updatedAt: T });
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_settings")).toBe(1);
  });

  it("doble importación: el mismo fichero → 409 (también en carrera); el solapado no duplica transacciones ni payouts", async () => {
    const body = { kind: "balance" as const, filename: "balance.csv", contentBase64: b64(stripeBalanceSample()) };
    const race = await Promise.allSettled([stripe.importFile(body, ACTOR), stripe.importFile(body, ACTOR), stripe.importFile(body, ACTOR)]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "conflict")).toBe(true);
    const again = await stripe.importFile({ ...body, filename: "solapado.csv", contentBase64: b64(`${stripeBalanceSample()}\n\n`) }, ACTOR);
    expect(again).toMatchObject({ rows: 9, inserted: 0, duplicates: 9 });
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_transactions")).toBe(9);
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_payouts")).toBe(1);
    const t = (await stripe.transactions({ q: "txn_test_c1" })).items[0];
    expect(t).toMatchObject({ createdOn: "2026-10-05", availableOn: "2026-10-07", grossCents: 12_100, feeCents: 388, netCents: 11_712, currency: "EUR", stripePayoutId: "po_test_1", invoiceRef: "in_test_1" });
    const p = await stripe.importFile({ kind: "payouts", filename: "payouts.csv", contentBase64: b64(stripePayoutsSample()) }, ACTOR);
    expect(p).toMatchObject({ inserted: 1, duplicates: 1, refreshed: 0 });
    expect((await stripe.payouts({ status: "failed" })).items.map((x) => x.stripePayoutId)).toEqual(["po_test_9"]);
  });

  it("doble contabilización (también simultánea): un asiento por hecho; 5720 cuadra con el informe salvo lo no soportado", async () => {
    const runs = await Promise.allSettled([stripe.post("2026-10-31", ACTOR), stripe.post("2026-10-31", ACTOR), stripe.post("2026-10-31", ACTOR)]);
    expect(runs.every((r) => r.status === "fulfilled")).toBe(true);
    const created = runs.reduce((a, r) => a + (r as PromiseFulfilledResult<{ posted: number }>).value.posted, 0);
    expect(created).toBe(7);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries WHERE origin = 'stripe'")).toBe(7);
    expect(await stripe.post("2026-10-31", ACTOR)).toMatchObject({ posted: 0, errors: [] });
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries WHERE origin = 'stripe'")).toBe(7);
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_transactions WHERE status = 'posted' AND entry_id IS NOT NULL")).toBe(7);
    const c1 = (await stripe.transactions({ q: "txn_test_c1" })).items[0];
    expect(c1).toMatchObject({ status: "posted", ownInvoiceId: invoiceIds[0], issue: null });
    const entry = await finance.getEntry(c1.entryId!);
    expect(entry).toMatchObject({ date: "2026-10-05", journalCode: "STR", sourceKey: "stripe-txn:txn_test_c1" });
    const s = await stripe.summary();
    expect(s).toMatchObject({ balancePendingCents: 0, importedBalanceCents: -500, balanceDifferenceCents: 500, payoutsWithoutBank: 1, disputesOpen: 0, unmatchedTransactions: 4 });
  });

  it("payout ↔ banco: vínculo SIN asiento nuevo; dos vínculos simultáneos del mismo movimiento → gana uno", async () => {
    await ops.importStatement({ bankAccountId: bankId, format: "csv", filename: "e.csv", contentBase64: b64("Fecha;Importe;Concepto\n2026-10-09;113,50;STRIPE PAYMENTS EUROPE\n2026-10-15;302,50;TRANSF NEXTAIR EB"), mapping: { delimiter: ";", headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd", decimal: "," } }, ACTOR);
    const movs = (await ops.movements({})).items;
    const mov = movs.find((m) => m.amountCents === 11_350)!;
    expect((await ops.suggestions(mov.id))[0]).toMatchObject({ type: "stripe_payout", stripePayoutId: "po_test_1" });
    const before = await count("SELECT COUNT(*) AS n FROM fin_entries");
    const payout = (await stripe.payouts({ status: "paid" })).items[0];
    const race = await Promise.allSettled([stripe.linkBank(payout.id, mov.id, ACTOR), ops.match(mov.id, { type: "stripe_payout", payoutId: payout.id }, ACTOR), stripe.linkBank(payout.id, mov.id, ACTOR)]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries")).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_payouts WHERE bank_movement_id = ?", [mov.id])).toBe(1);
    expect((await opsStore.getMovement(mov.id))!).toMatchObject({ status: "matched", matchType: "stripe_payout", matchId: payout.id, entryId: null });
    expect(await stripe.reconciliationPayout(payout.id)).toMatchObject({ bankMovementId: mov.id, bankBookingDate: "2026-10-09", differenceCents: 0 });
    // Desvincular y volver a vincular tampoco toca el libro
    await ops.unmatch(mov.id, ACTOR);
    expect((await opsStore.getMovement(mov.id))!.status).toBe("pending");
    await ops.match(mov.id, { type: "stripe_payout", payoutId: payout.id }, ACTOR);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries")).toBe(before);
    expect((await stripe.summary()).payoutsWithoutBank).toBe(0);

    // Cobro de la factura sin Stripe por transferencia: asiento bankmov:<id> contra 430
    const transfer = movs.find((m) => m.amountCents === 30_250)!;
    await ops.match(transfer.id, { type: "invoice_payment", invoiceId: invoiceIds[1] }, ACTOR);
    const e = (await ledger.bySource(`bankmov:${transfer.id}`))!;
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.companyId])).toEqual([
      [bankCode, 30_250, 0, null],
      ["430", 0, 30_250, 9],
    ]);
    const view = await stripe.reconciliationInvoices({});
    expect(view.items.find((x) => x.invoiceId === invoiceIds[1])).toMatchObject({ status: "en_banco", collectedCents: 30_250 });
    expect(view.items.find((x) => x.invoiceId === invoiceIds[0])).toMatchObject({ collectedCents: 12_100, dates: { invoiceDate: "2026-10-01", chargeDate: "2026-10-05", payoutDate: "2026-10-08", bankDate: "2026-10-09" } });
  });

  it("payout fallido después de contabilizado: reversión una sola vez", async () => {
    const failure = ["balance_transaction_id,created_utc,currency,gross,fee,net,reporting_category,source_id,description", "txn_test_pf,2026-10-09 09:00:00,eur,113.50,0.00,113.50,payout_reversal,po_test_1,Payout failure"].join("\n");
    await stripe.importFile({ kind: "balance", filename: "fallo.csv", contentBase64: b64(failure) }, ACTOR);
    const r = await Promise.all([stripe.post("2026-10-31", ACTOR), stripe.post("2026-10-31", ACTOR)]);
    expect(r[0].posted + r[1].posted).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries WHERE origin = 'reversal' AND description LIKE '%Payout po_test_1%'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_payouts WHERE payout_id = 'po_test_1' AND status = 'failed' AND reversal_entry_id IS NOT NULL")).toBe(1);
    expect(await stripe.ledgerBalance()).toBe(11_350);
  });
  it("cobros por transferencia simultáneos a la misma factura que juntos superan lo pendiente: solo uno pasa (409)", async () => {
    const invoices = new MysqlInvoicingStore(pool, "test");
    const lines = [lineOf(1, "Consultoría", 1, 10_000, 2100)];
    const { invoice } = await invoices.insertDraft({ sourceKey: "charge:77", kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "charge:77", paymentRef: null, originalInvoiceId: null, operationDate: "2026-10-20", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: T, lines });
    await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: "2026-10-20", issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: T });
    await ops.importStatement({ bankAccountId: bankId, format: "csv", filename: "e2.csv", contentBase64: b64("Fecha;Importe;Concepto\n2026-10-21;80,00;TRANSF PARCIAL A\n2026-10-21;70,00;TRANSF PARCIAL B"), mapping: { delimiter: ";", headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd", decimal: "," } }, ACTOR);
    const movs = (await ops.movements({ status: "pending" })).items.filter((m) => m.amountCents === 8_000 || m.amountCents === 7_000);
    expect(movs).toHaveLength(2);
    const before = await count("SELECT COUNT(*) AS n FROM fin_entries");
    const race = await Promise.allSettled(movs.map((m) => ops.match(m.id, { type: "invoice_payment", invoiceId: invoice.id }, ACTOR)));
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = race.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "exceeds_pending" });
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries")).toBe(before + 1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_bank_movements WHERE match_type = 'invoice_payment' AND match_id = ?", [invoice.id])).toBe(1);
    // El movimiento perdedor sigue pendiente; lo que queda de la factura sí cabe
    const rest = await stripe.invoiceForTransfer(invoice.id);
    expect([4_100, 5_100]).toContain(rest.pendingCents);
  });

  it("facturas propias sin tope: lectura paginada desde la tabla (solo lectura)", async () => {
    const dir = new MysqlOwnInvoiceDirectory(pool, "test");
    const all = await dir.list({ limit: 500, offset: 0 });
    expect(all.total).toBe(3);
    const second = await dir.list({ limit: 1, offset: 1 });
    expect(second).toMatchObject({ total: 3, items: [all.items[1]] });
    expect((await dir.list({ limit: 10, offset: 0, q: "nextair" })).total).toBe(3);
    expect((await dir.byStripeIds(["in_test_1"])).map((o) => o.id)).toEqual([invoiceIds[0]]);
    expect(await dir.list({ limit: 10, offset: 0, from: "2026-10-02", to: "2026-10-02" })).toMatchObject({ total: 1, items: [{ id: invoiceIds[1], customerName: "NEXTAIR SL", totalCents: 30_250 }] });
    expect(await new MysqlOwnInvoiceDirectory(pool, "live").list({ limit: 10, offset: 0 })).toEqual({ items: [], total: 0 });
    const page = await stripe.reconciliationInvoices({ limit: 1, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });
});
