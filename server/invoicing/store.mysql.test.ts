/**
 * Facturación propia contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada aquí, con todas
 * las migraciones del CRM): una factura por hecho, numeración correlativa por serie y año con huella encadenada (también
 * con expediciones simultáneas), estado de cobro aparte, entornos separados e ida y vuelta de la migración 0027.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { lineOf, totals } from "./rules";
import { MysqlInvoicingStore } from "./store";
import { MysqlChargeStore } from "./charges";
import type { FiscalParty, NewInvoice } from "./types";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "invoicing_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 10, 1, 7);
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const ISSUER: FiscalParty = { legalName: "IRON ELEPHANT CONSULTING, S.L.", taxId: "B26987875", address: "Calle Corazón de María, 57, 1.º D", postalCode: "28002", city: "Madrid", country: "ES" };

const draft = (month: string): NewInvoice => {
  const lines = [lineOf(1, `SkiNet — ${month}`, 1, 100_000, 2100)];
  return { sourceKey: `external:1:${month}`, kind: "invoice", paymentStatus: "pending", companyId: 7, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: `${month}-01`, periodStart: T, periodEnd: T + 30 * 86_400_000, periodLabel: month, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "operator:test", createdAt: T, lines };
};

describe.skipIf(!URL_)("facturación propia con MySQL real (CRM 0027)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let test: MysqlInvoicingStore;
  let live: MysqlInvoicingStore;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 6 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0027_invoicing");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
    test = new MysqlInvoicingStore(pool, "test");
    live = new MysqlInvoicingStore(pool, "live");
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("una factura por hecho, con sus líneas; entornos separados", async () => {
    const a = await test.insertDraft(draft("2026-11"));
    expect(a.created).toBe(true);
    expect(a.invoice).toMatchObject({ status: "draft", number: null, baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, customer: PARTY, lines: [{ position: 1, baseCents: 100_000, taxCents: 21_000 }] });
    const again = await test.insertDraft(draft("2026-11"));
    expect(again).toMatchObject({ created: false, invoice: { id: a.invoice.id } });
    expect(await live.get(a.invoice.id)).toBeNull();
    expect((await live.insertDraft(draft("2026-11"))).created).toBe(true);
  });

  it("numeración correlativa y huella encadenada, también con expediciones simultáneas", async () => {
    const ids = [];
    for (const m of ["2026-12", "2027-01", "2027-02", "2027-03"]) ids.push((await test.insertDraft(draft(m))).invoice.id);
    const first = (await test.list({ status: "draft" })).find((x) => x.sourceKey === "external:1:2026-11")!;
    const issued = await Promise.all([first.id, ...ids].map((id) => test.issue({ id, seriesCode: "EB", issueDate: "2026-12-01", issuer: ISSUER, customer: PARTY, issuedBy: "operator:test", issuedAt: T })));
    const numbers = issued.map((x) => x.number).sort();
    expect(numbers).toEqual(["EB-2026-00001", "EB-2026-00002", "EB-2026-00003", "EB-2026-00004", "EB-2026-00005"]);
    const byNumber = [...issued].sort((a, b) => a.number!.localeCompare(b.number!));
    expect(byNumber[0].previousHash).toBeNull();
    for (let i = 1; i < byNumber.length; i++) expect(byNumber[i].previousHash).toBe(byNumber[i - 1].hash);
    await expect(test.issue({ id: first.id, seriesCode: "EB", issueDate: "2026-12-01", issuer: ISSUER, customer: PARTY, issuedBy: "x", issuedAt: T })).rejects.toMatchObject({ code: "invalid_state" });
    // Otro año: otra numeración
    const n = (await test.insertDraft(draft("2027-04"))).invoice.id;
    expect((await test.issue({ id: n, seriesCode: "EB", issueDate: "2027-04-01", issuer: ISSUER, customer: PARTY, issuedBy: "x", issuedAt: T })).number).toBe("EB-2027-00001");
  });

  it("cargos (0028): idempotentes por clave, cambio optimista y entornos separados", async () => {
    const charges = new MysqlChargeStore(pool, "test");
    const base = { companyId: 7, kind: "variable_cost" as const, agreementRef: null, billingRef: "external:1", concept: "Telefonía", currency: "EUR", amountCents: 14_197, taxRateBp: 2100, dueDate: "2026-11-30", method: "payment_link" as const, mandateRef: null, detail: { provider: "Netelip", costCents: 12_345, marginBp: 1500 }, idempotencyKey: "k-1", createdBy: "operator:test", createdAt: T };
    const a = await charges.insert(base);
    expect(a.charge).toMatchObject({ status: "draft", amountCents: 14_197, detail: { provider: "Netelip", costCents: 12_345, marginBp: 1500 }, invoiceId: null, version: 1 });
    expect(await charges.insert({ ...base, amountCents: 1 })).toMatchObject({ created: false, charge: { id: a.charge.id, amountCents: 14_197 } });
    const u = await charges.update(a.charge.id, 1, { status: "approved", invoiceId: 42, decidedBy: "operator:jorge", decidedAt: T + 1 }, T + 1);
    expect(u).toMatchObject({ status: "approved", invoiceId: 42, decidedBy: "operator:jorge", version: 2 });
    await expect(charges.update(a.charge.id, 1, { status: "cancelled" }, T + 2)).rejects.toMatchObject({ code: "conflict" });
    expect(await new MysqlChargeStore(pool, "live").get(a.charge.id)).toBeNull();
    expect((await charges.list({ status: "approved" })).map((c) => c.id)).toEqual([a.charge.id]);
  });

  it("el estado de cobro va aparte y no toca lo expedido", async () => {
    const inv = (await test.list({ billingRef: "external:1", status: "issued" }))[0];
    const p = await test.setPayment(inv.id, { paymentStatus: "paid", paymentRef: "stripe:in:in_1", paidAt: T + 1 }, T + 2);
    expect(p).toMatchObject({ status: "issued", number: inv.number, hash: inv.hash, paymentStatus: "paid", paymentRef: "stripe:in:in_1" });
  });

  it("una expedida pasa a rectificada una sola vez; un borrador no", async () => {
    const inv = (await test.list({ billingRef: "external:1", status: "issued" }))[0];
    expect(await test.setStatus(inv.id, "rectified", T + 3)).toMatchObject({ status: "rectified", number: inv.number, hash: inv.hash });
    await expect(test.setStatus(inv.id, "rectified", T + 4)).rejects.toMatchObject({ code: "invalid_state" });
    const d = (await test.insertDraft(draft("2027-09"))).invoice;
    await expect(test.setStatus(d.id, "rectified", T + 5)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("la migración 0027 es irreversible a propósito (conservación legal de las facturas)", () => {
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0027_invoicing")!;
    expect(m.irreversible).toBe(true);
    expect(m.down).toBeNull();
  });
});
