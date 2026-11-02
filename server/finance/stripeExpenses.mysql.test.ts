/**
 * Gastos automáticos de Stripe con MySQL real (CRM 0044): alta idempotente, filtro por origen, tratamiento del IVA una
 * sola vez y vínculo de la factura de Stripe. Se activa con REGISTRY_TEST_DATABASE_URL (base desechable).
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario } from "./fiscalTestkit";
import { finExpenseInvoiceRefReady } from "./opsStore";
import { stripeBalanceSample } from "./testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "finance_stripe_expenses_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");

describe.skipIf(!URL_)("gastos automáticos de Stripe con MySQL real (CRM 0044)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const st of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(st);
    for (const m of loadMigrations(DIR).migrations) for (const st of splitStatements(m.up)) await pool.query(st);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("alta, IVA decidido una sola vez y factura vinculada, sin duplicar gastos ni asientos", async () => {
    expect(await finExpenseInvoiceRefReady(pool)).toBe(true);
    const s = await fiscalScenario({ pool });
    await s.stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    expect(await s.stripe.post("2026-10-31", ACTOR)).toMatchObject({ errors: [], feeExpenses: { created: 5, classified: 0 }, pendingFeeVat: 5 });
    const list = async () => (await s.ops.listExpenses({ sourcePrefix: "stripe-fee:", limit: 100 })).items;
    const items = await list();
    expect(items).toHaveLength(5);
    expect(items.every((e) => e.status === "registered" && e.paymentStatus === "paid" && e.vatTreatment === null && e.supplierInvoiceRef === null)).toBe(true);
    // El filtro escapa el prefijo: «stripe_fee» no casa con «stripe-fee:»
    expect((await s.ops.listExpenses({ sourcePrefix: "stripe_fee", limit: 10 })).total).toBe(0);
    const entries = (await s.finance.listEntries({ limit: 500 })).total;
    expect((await s.stripe.post("2026-10-31", ACTOR)).feeExpenses).toBeUndefined();
    expect((await s.finance.listEntries({ limit: 500 })).total).toBe(entries);

    await s.stripe.createFeeVatRule({ feeKind: "*", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", issuerVatId: "IE9999999ZZ", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01" }, ACTOR);
    expect(await s.stripe.syncFeeExpenses(ACTOR)).toMatchObject({ created: 0, classified: 5, pendingFiscal: 0, errors: [] });
    expect(await s.stripe.syncFeeExpenses(ACTOR)).toMatchObject({ created: 0, classified: 0 });
    expect((await list()).every((e) => e.vatTreatment === "intra_eu_services" && e.reverseChargeRateBp === 2100)).toBe(true);

    const ids = items.map((e) => e.id);
    expect((await s.stripe.linkFeeInvoice({ expenseIds: ids, invoiceRef: "STRIPE-2026-10" }, ACTOR)).linked).toBe(5);
    expect((await s.stripe.linkFeeInvoice({ expenseIds: ids, invoiceRef: "STRIPE-2026-10" }, ACTOR)).linked).toBe(0);
    expect((await list()).every((e) => e.supplierInvoiceRef === "STRIPE-2026-10")).toBe(true);
  });
});
