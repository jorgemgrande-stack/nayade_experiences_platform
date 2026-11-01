/**
 * Operaciones de clientes externos contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada
 * aquí, con las migraciones del CRM hasta la 0041): JSON de líneas y ajustes, un periodo por operación y mes, un cargo
 * por periodo, actualización optimista, eventos idempotentes, modos separados e ida y vuelta de la migración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlOperationStore } from "./operationsStore";
import type { NewOperation, NewPeriod } from "./operations";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "external_operations_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 10, 15, 9);

const op: NewOperation = {
  companyId: 7,
  kind: "infrastructure",
  status: "draft",
  title: "Infraestructura gestionada",
  currency: "EUR",
  taxRateBp: 2100,
  lines: [
    { key: "srv", concept: "Servidor", category: "server", pricing: "fixed", quantity: 1, unitCents: 30_000 },
    { key: "rw", concept: "Railway", category: "railway", pricing: "variable", provider: "Railway", marginBp: 1500, capCents: 20_000 },
  ],
  adjustment: { type: "discount", mode: "percent", value: 1000, reason: "Piloto", authorizedBy: "operator:jefa" },
  dueDate: null,
  billingDay: 1,
  dueDays: 10,
  startPeriod: "2026-11",
  capCents: null,
  recipientName: null,
  recipientEmail: "it@cliente.example",
  notes: null,
  createdBy: "operator:test",
  createdAt: T,
};
const period = (operationId: number, p: string): NewPeriod => ({
  operationId,
  period: p,
  status: "draft",
  lines: [{ key: "srv", concept: "Servidor", category: "server", quantity: 1, unitCents: 30_000, amountCents: 30_000 }],
  usage: { rw: 1000 },
  baseCents: 30_000,
  adjustmentCents: -3_000,
  netCents: 27_000,
  taxCents: 5_670,
  totalCents: 32_670,
  dueDate: "2026-11-11",
  overCap: false,
  overCapAuthorized: null,
  chargeId: null,
  invoiceId: null,
  sentAt: null,
  sentTo: null,
  createdBy: "operator:test",
  createdAt: T,
});

describe.skipIf(!URL_)("operaciones de clientes externos con MySQL real (CRM 0041)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let test: MysqlOperationStore;
  let live: MysqlOperationStore;

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
    expect(all.map((m) => m.id)).toContain("0041_external_operations");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
    test = new MysqlOperationStore(pool, "test");
    live = new MysqlOperationStore(pool, "live");
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("operación con líneas y ajuste en JSON; actualización optimista; modos separados", async () => {
    const o = await test.insert(op);
    expect(o).toMatchObject({ version: 1, kind: "infrastructure", lines: op.lines, adjustment: op.adjustment, billingDay: 1, startPeriod: "2026-11", capCents: null });
    const u = await test.update(o.id, 1, { status: "active" }, T + 1);
    expect(u).toMatchObject({ version: 2, status: "active" });
    await expect(test.update(o.id, 1, { status: "canceled" }, T + 2)).rejects.toMatchObject({ code: "conflict" });
    expect(await live.get(o.id)).toBeNull();
    expect(await live.list()).toEqual([]);
    expect((await test.list({ companyId: 7 })).map((x) => x.id)).toEqual([o.id]);
  });

  it("un periodo por operación y mes; un cargo por periodo; eventos idempotentes", async () => {
    const o = await test.insert(op);
    const a = await test.insertPeriod(period(o.id, "2026-11"));
    expect(a.created).toBe(true);
    expect(a.period).toMatchObject({ usage: { rw: 1000 }, overCap: false, overCapAuthorized: null, lines: [{ key: "srv", amountCents: 30_000 }] });
    const again = await test.insertPeriod(period(o.id, "2026-11"));
    expect(again).toMatchObject({ created: false, period: { id: a.period.id } });
    const issued = await test.updatePeriod(a.period.id, 1, { status: "issued", chargeId: 501, invoiceId: 601, overCap: true, overCapAuthorized: { reason: "Pico", by: "operator:jefa", at: T } }, T + 1);
    expect(issued).toMatchObject({ status: "issued", chargeId: 501, overCap: true, overCapAuthorized: { reason: "Pico" } });
    const b = await test.insertPeriod(period(o.id, "2026-12"));
    await expect(test.updatePeriod(b.period.id, 1, { chargeId: 501 }, T + 2)).rejects.toMatchObject({ code: "conflict" });
    expect((await test.periods(o.id)).map((p) => p.period)).toEqual(["2026-12", "2026-11"]);
    expect(await test.event({ operationId: o.id, kind: "issued", ref: "2026-11", detail: { chargeId: 501 }, actor: "operator:jefa", at: T })).toEqual({ created: true });
    expect(await test.event({ operationId: o.id, kind: "issued", ref: "2026-11", detail: { chargeId: 501 }, actor: "operator:jefa", at: T })).toEqual({ created: false });
    expect(await test.event({ operationId: o.id, kind: "line_adjusted", ref: null, detail: { key: "srv" }, actor: "operator:jefa", at: T + 1 })).toEqual({ created: true });
    expect(await test.event({ operationId: o.id, kind: "line_adjusted", ref: null, detail: { key: "srv" }, actor: "operator:jefa", at: T + 2 })).toEqual({ created: true });
    expect((await test.events(o.id)).map((e) => e.kind)).toEqual(["issued", "line_adjusted", "line_adjusted"]);
  });

  it("ida y vuelta de la migración", async () => {
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0041_external_operations")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'external_operations'");
    expect(t).toHaveLength(0);
    const [c] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM external_subscriptions LIKE 'interval_count'");
    expect(c).toHaveLength(0);
    for (const s of splitStatements(m.up)) await pool.query(s);
  });
});
