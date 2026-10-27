/**
 * Almacén de servicios externos contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada aquí,
 * con las migraciones del CRM hasta la 0026): una contratación por contrato, objetos de Stripe enlazados una sola vez,
 * actualización optimista, aceptación de un solo uso, eventos idempotentes por referencia, filas de otro modo invisibles
 * e ida y vuelta de la migración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlExternalStore, type NewExternal } from "./store";
import { ExternalError } from "./types";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "external_services_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 9, 27, 9);

const base = (contractId: number): NewExternal => ({
  contractId,
  companyId: 7,
  serviceKey: "skinet",
  serviceName: "SkiNet",
  amountCents: 100_000,
  currency: "EUR",
  taxRateBp: 2100,
  interval: "month",
  billingDay: 1,
  billingHour: 8,
  timezone: "Europe/Madrid",
  graceDays: 5,
  firstChargeAt: Date.UTC(2026, 10, 1, 7),
  externalRef: "skicenter:nextair",
  status: "awaiting_acceptance",
  stripeCustomerId: null,
  stripeSetupSessionId: null,
  stripePaymentMethodId: null,
  stripeSubscriptionId: null,
  stripeTestClockId: null,
  lastInvoiceId: null,
  lastInvoiceStatus: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  graceUntil: null,
  decisionReason: null,
  createdBy: "operator:test",
  createdAt: T,
});

describe.skipIf(!URL_)("servicios externos con MySQL real (CRM 0026)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let test: MysqlExternalStore;
  let live: MysqlExternalStore;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0026_external_services");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
    test = new MysqlExternalStore(pool, "test");
    live = new MysqlExternalStore(pool, "live");
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("una contratación por contrato; actualización optimista; Stripe enlazado una sola vez; modos separados", async () => {
    const a = await test.insert(base(101));
    expect(a).toMatchObject({ id: expect.any(Number), version: 1, amountCents: 100_000, firstChargeAt: Date.UTC(2026, 10, 1, 7), status: "awaiting_acceptance" });
    await expect(test.insert(base(101))).rejects.toBeInstanceOf(ExternalError);
    const u = await test.update(a.id, 1, { status: "scheduled", stripeSubscriptionId: "sub_test_1", stripeSetupSessionId: "cs_test_1" }, T + 1);
    expect(u).toMatchObject({ version: 2, status: "scheduled", stripeSubscriptionId: "sub_test_1" });
    await expect(test.update(a.id, 1, { status: "active" }, T + 2)).rejects.toMatchObject({ code: "conflict" });
    const b = await test.insert(base(102));
    await expect(test.update(b.id, 1, { stripeSubscriptionId: "sub_test_1" }, T + 3)).rejects.toMatchObject({ code: "conflict" });
    expect((await test.byStripeSubscription("sub_test_1"))!.id).toBe(a.id);
    expect((await test.bySetupSession("cs_test_1"))!.id).toBe(a.id);
    // Las filas de pruebas no existen para el entorno live
    expect(await live.get(a.id)).toBeNull();
    expect(await live.list()).toEqual([]);
  });

  it("aceptación de un solo uso y eventos idempotentes por referencia", async () => {
    const acc = await test.insertAcceptance({ contractId: 101, contractVersion: 1, documentSha256: "a".repeat(64), tokenSha256: "b".repeat(64), status: "pending", signerName: "Laura", signerEmail: "laura@nextair.example", signerRole: null, signerTaxId: null, acceptedName: null, acceptedTaxId: null, acceptedAt: null, acceptedIpHash: null, acceptedUserAgent: null, consentText: null, expiresAt: T + 86_400_000, createdBy: "operator:test", createdAt: T });
    expect((await test.acceptanceByToken("b".repeat(64)))!.id).toBe(acc.id);
    const ev = { acceptedName: "Laura", acceptedTaxId: null, acceptedAt: T + 5, acceptedIpHash: "c".repeat(64), acceptedUserAgent: "Prueba", consentText: "Acepto" };
    expect(await test.markAccepted(acc.id, ev)).toBe(true);
    expect(await test.markAccepted(acc.id, ev)).toBe(false);
    expect((await test.acceptances(101))[0]).toMatchObject({ status: "accepted", acceptedName: "Laura", acceptedAt: T + 5 });
    const x = (await test.byContract(101))!;
    expect(await test.event({ externalId: x.id, kind: "invoice_paid", ref: "in_1", detail: { amountPaid: 121_000 }, actor: "system:stripe", at: T })).toEqual({ created: true });
    expect(await test.event({ externalId: x.id, kind: "invoice_paid", ref: "in_1", detail: { amountPaid: 121_000 }, actor: "system:stripe", at: T })).toEqual({ created: false });
    expect((await test.events(x.id))[0]).toMatchObject({ kind: "invoice_paid", ref: "in_1", detail: { amountPaid: 121_000 } });
  });

  it("ida y vuelta de la migración", async () => {
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0026_external_services")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'external_subscriptions'");
    expect(t).toHaveLength(0);
    for (const s of splitStatements(m.up)) await pool.query(s);
  });
});
