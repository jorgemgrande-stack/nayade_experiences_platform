/**
 * Cola del despachador de notificaciones sobre `commercial_events` (0015) contra MySQL real (opt-in,
 * REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada aquí): dos réplicas que reservan a la vez nunca toman
 * el mismo evento; la reserva caduca y otro lo retoma; el resultado y los intentos quedan guardados; cada entorno
 * solo ve los suyos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlCommercialEventLog } from "./commercialEvents/log";
import type { CommercialEventDraft } from "./commercialEvents/types";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "notifications_queue_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const NOW = Date.UTC(2026, 9, 20, 9);

const ev = (key: string): CommercialEventDraft => ({
  key,
  type: "subscription.module_added",
  aggregate: { type: "subscription", id: "1", version: 1 },
  correlationId: "subscription:1",
  tenantId: "acme",
  companyId: 1,
  orderId: null,
  subscriptionId: 1,
  trialId: null,
  paymentId: null,
  stripeRef: null,
  fromState: null,
  toState: null,
  actor: "system:test",
  occurredAt: NOW,
  data: {},
});

describe.skipIf(!URL_)("cola de notificaciones con MySQL real (commercial_events)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    for (const m of loadMigrations(DIR).migrations) for (const s of splitStatements(m.up)) await pool.query(s);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("reserva sin solapes entre réplicas, caducidad de la reserva, resultado guardado y entornos separados", async () => {
    const a = new MysqlCommercialEventLog(pool, "test");
    const b = new MysqlCommercialEventLog(pool, "test");
    await a.append(null, Array.from({ length: 10 }, (_, i) => ev(`q${i}`)));
    const [ra, rb] = await Promise.all([a.claimDispatch(NOW, 10, 60_000), b.claimDispatch(NOW, 10, 60_000)]);
    const ids = [...ra, ...rb].map((e) => e.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    // Reservados: nadie más los toma hasta que caduque la reserva
    expect(await a.claimDispatch(NOW + 1, 10, 60_000)).toEqual([]);
    const first = ra[0] ?? rb[0];
    await a.finishDispatch(first.id, { status: "done", attempts: 1, nextAttemptAt: null });
    const second = (ra[1] ?? rb[1])!;
    await a.finishDispatch(second.id, { status: "pending", attempts: 1, nextAttemptAt: NOW + 120_000 });
    const after = await a.claimDispatch(NOW + 61_000, 20, 60_000);
    expect(after.map((e) => e.id)).not.toContain(first.id);
    expect(after.map((e) => e.id)).not.toContain(second.id);
    expect(after).toHaveLength(8);
    const retry = await a.claimDispatch(NOW + 121_000, 20, 60_000);
    expect(retry.find((e) => e.id === second.id)?.dispatchAttempts).toBe(1);
    expect((await a.list({})).find((e) => e.id === first.id)?.dispatchStatus).toBe("done");
    // Otro entorno no ve ni toma estos eventos
    expect(await new MysqlCommercialEventLog(pool, "live").claimDispatch(NOW + 10_000_000, 20, 1)).toEqual([]);
  });
});
