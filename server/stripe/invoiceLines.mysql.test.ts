/**
 * Líneas de factura contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada con las migraciones del CRM
 * hasta la 0019): idempotentes por línea; ligadas a su factura registrada y a su pedido; la BD impide reembolsar
 * en una línea más que su importe (y el reparto falla entero, sin dejar nada a medias); modos separados; ida y
 * vuelta de la migración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlCrmStore } from "../crm/mysqlStore";
import { CrmService } from "../crm/service";
import { MysqlOrderStore } from "../orchestrator/store";
import { MysqlStripeStore } from "./store";
import { MysqlInvoiceLineStore, type InvoiceLineRow } from "./invoiceLines";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_invoice_lines_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const NOW = Date.UTC(2026, 9, 20, 9);

describe.skipIf(!URL_)("líneas de factura con MySQL real (CRM 0019)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let orderId = 0;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 5 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0019_stripe_invoice_lines");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
    const company = await new CrmService({ store: new MysqlCrmStore(pool), now: () => NOW }).createCompany({ name: "Líneas SL" }, "operator:test");
    const { order } = await new MysqlOrderStore(pool).insert({
      idempotencyKey: "lineas-de-factura-0001",
      payloadHash: "h",
      kind: "new",
      state: "active",
      companyId: company.id,
      leadRequestId: null,
      trialId: null,
      previousOrderId: null,
      request: { plan: "essential", interval: "month", items: [] },
      quote: null,
      contractId: null,
      subscriptionId: null,
      tenantId: null,
      confirmation: null,
      graceEndsAt: null,
      attempts: 0,
      lastError: null,
      createdAt: NOW,
      createdBy: "operator:test",
    });
    orderId = order.id;
    await new MysqlStripeStore(pool, "test").upsertInvoiceRecord({
      stripeInvoiceId: "in_test_lines",
      orderId,
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: "sub_test_1",
      number: "ES-0001",
      status: "paid",
      billingReason: "subscription_update",
      purpose: "change",
      currency: "EUR",
      subtotalCents: 1500,
      taxCents: 315,
      totalCents: 1815,
      amountPaidCents: 1815,
      amountRefundedCents: 0,
      periodStart: NOW,
      customerCountry: "ES",
      customerPostalCode: "28001",
      buyerScenario: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const row = (id: string, amountCents: number, taxCents: number | null): InvoiceLineRow => ({
    stripeLineId: id,
    stripeInvoiceId: "in_test_lines",
    orderId,
    subscriptionItemId: "si_1",
    stripePriceId: "price_mod",
    webPriceId: 21,
    productKey: "connect-people",
    quantity: 1,
    amountCents,
    taxCents,
    proration: true,
    periodStart: NOW,
    periodEnd: NOW + 1,
    refundedCents: 0,
  });

  it("idempotente, con su factura y pedido; tope de reembolso por línea y reparto todo o nada; modos separados", async () => {
    const store = new MysqlInvoiceLineStore(pool, "test");
    expect(await store.upsertLines([row("il_a", 1000, 210), row("il_b", 500, 105)], NOW)).toBe(2);
    expect(await store.upsertLines([row("il_a", 1000, 210)], NOW)).toBe(0);
    await expect(store.upsertLines([{ ...row("il_x", 1, null), stripeInvoiceId: "in_no_existe" }], NOW)).rejects.toThrow();
    await store.addRefunded(new Map([["il_a", 1210], ["il_b", 100]]), NOW);
    // Pasarse en una línea falla y no deja aplicado nada del reparto
    await expect(store.addRefunded(new Map([["il_b", 100], ["il_a", 1]]), NOW)).rejects.toThrow();
    expect((await store.linesOf("in_test_lines")).map((l) => [l.stripeLineId, l.refundedCents])).toEqual([["il_a", 1210], ["il_b", 100]]);
    expect(await new MysqlInvoiceLineStore(pool, "live").linesOf("in_test_lines")).toEqual([]);
  });

  it("la migración 0019 se revierte y se vuelve a aplicar", async () => {
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0019_stripe_invoice_lines")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    await expect(new MysqlInvoiceLineStore(pool).linesOf("in_test_lines")).rejects.toThrow();
    for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await new MysqlInvoiceLineStore(pool).linesOf("in_test_lines")).toEqual([]);
  });
});
