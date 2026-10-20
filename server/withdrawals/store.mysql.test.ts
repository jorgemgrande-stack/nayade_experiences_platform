/**
 * Registro de desistimientos (CRM 0022) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD temporal propia).
 * La BD impide dos solicitudes abiertas del mismo contrato y repetir una petición; cada paso queda en el historial.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlWithdrawalStore, WithdrawalConflictError, type WithdrawalDraft } from "./store";
import type { WithdrawalAssessment } from "./assessment";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `es_withdrawals_${process.pid}`;
const now = Date.UTC(2026, 9, 22, 10);

describe.skipIf(!URL_)("desistimientos con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let orderId = 0;
  const dir = path.resolve(__dirname, "../../db/crm/migrations");

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 6 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(dir);
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES ('Particular Ana', ?)`, [now])) as unknown as [{ insertId: number }];
    const [o] = (await pool.query(`INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, request_json, created_at, created_by) VALUES ('clave-desistimiento-orden', REPEAT('c', 64), 'new', 'active', ?, '{}', ?, 't')`, [c.insertId, now])) as unknown as [{ insertId: number }];
    orderId = o.insertId;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const assessment: WithdrawalAssessment = { applicability: "applicable", deadlineAt: now + 12 * 86_400_000, withinTerm: true, extended: false, immediateExecution: true, fullyPerformed: false, proportionalCents: 100, refundProposalCents: 3409, currency: "EUR", summary: "Dentro del plazo." };
  const draft = (key: string, ref: string): WithdrawalDraft => ({ reference: ref, idempotencyKey: key, orderId, contractOrderId: orderId, companyId: 1, tenantId: "particular-ana", channel: "platform", requestedBy: "user:5", contactEmail: "ana@example.com", statement: null, requestedAt: now, assessment });

  it("crea, repite sin duplicar, impide otra abierta del mismo contrato y deja el historial; cerrada, admite otra", async () => {
    const live = new MysqlWithdrawalStore(pool, "live");
    const a = await live.create(draft("wd-particular-ana-clave-0001", "DS-20261022-AAAAAA"), "customer:particular-ana/user:5");
    expect(a).toMatchObject({ created: true, request: { status: "received", version: 1, assessment: { refundProposalCents: 3409 } } });
    expect((await live.create(draft("wd-particular-ana-clave-0001", "DS-20261022-BBBBBB"), "x")).created).toBe(false);
    await expect(live.create(draft("wd-particular-ana-clave-0002", "DS-20261022-CCCCCC"), "x")).rejects.toBeInstanceOf(WithdrawalConflictError);
    // Dos peticiones simultáneas distintas: solo una queda abierta (columna generada única)
    await live.transition(a.request.id, 1, "rejected", { note: "Duplicada", refundReference: null, decidedBy: "operator:jorge", decidedAt: now + 1 }, { action: "reject", actor: "operator:jorge", note: "Duplicada", at: now + 1 });
    const both = await Promise.allSettled([live.create(draft("wd-particular-ana-clave-0003", "DS-20261022-DDDDDD"), "x"), live.create(draft("wd-particular-ana-clave-0004", "DS-20261022-EEEEEE"), "x")]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await live.events(a.request.id)).map((e) => [e.action, e.fromStatus, e.toStatus])).toEqual([
      ["requested", null, "received"],
      ["reject", "received", "rejected"],
    ]);
    await expect(live.transition(a.request.id, 1, "accepted", null, { action: "accept", actor: "x", note: null, at: now })).rejects.toBeInstanceOf(WithdrawalConflictError);
    // Cada modo, sus solicitudes
    expect(await new MysqlWithdrawalStore(pool, "test").list()).toEqual([]);
  });
});
