/**
 * Prueba gratuita autónoma contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada): búsqueda
 * por alias con el índice de correo abierto (comodines escapados), anotaciones sin cambio de versión,
 * filtros de la tarea programada, reenvío con rotación del token bajo concurrencia y exclusión entre
 * réplicas con GET_LOCK.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { TrialScheduler, mysqlAdvisoryLock, SCHEDULER_LOCK } from "./trials/scheduler";
import type { TrialNotifier } from "./trials/onboarding";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "trials_autonomia_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 16, 9);

describe.skipIf(!URL_)("prueba autónoma (reenvío y tarea programada) con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let other: mysql.Pool;
  let store: MysqlTrialStore;
  let clock = T0;
  let svc: TrialService;
  let n = 0;
  const key = () => `idem-aut-mysql-${String(++n).padStart(8, "0")}`;
  const reg = (email: string) => svc.register({ email, companyName: "Acme", configuration: { plan: "essential", addons: [] }, idempotencyKey: key(), ip: null });
  const notices: Array<{ trialId: number; daysLeft: number }> = [];
  const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async (_to, i) => void notices.push({ trialId: i.trialId, daysLeft: i.daysLeft }) };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 6 });
    other = mysql.createPool({ uri: u.toString(), connectionLimit: 2 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations } = loadMigrations(DIR);
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    store = new MysqlTrialStore(pool);
    svc = new TrialService({ store, now: () => clock, limits: { perIp24h: 100, perDomain30d: 100 } });
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await other?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  async function active(email: string, tenant: string) {
    const r = await reg(email);
    const v = await svc.verify(r.trial.id, r.verificationToken!);
    const p = await svc.requestProvisioning(v.id, v.version, "op");
    return svc.markProvisioned(p.id, p.version, tenant, "op");
  }

  it("alias +etiqueta: misma prueba abierta; los comodines de LIKE no se cuelan", async () => {
    await reg("ana+uno@acme.example");
    await expect(reg("ana+dos@acme.example")).rejects.toMatchObject({ code: "conflict" });
    await expect(reg("ana@acme.example")).rejects.toMatchObject({ code: "conflict" });
    // «a_a» no debe casar con «ana» ni «%» con todo
    expect((await reg("a_a@acme.example")).created).toBe(true);
    expect((await reg("a%@acme.example")).created).toBe(true);
    expect(await store.openByAlias("a%", "acme.example")).toMatchObject({ email: "a%@acme.example" });
    expect(await store.openByAlias("zz", "acme.example")).toBeNull();
  });

  it("solicitud caducada sin verificar: al registrarse otra vez se anula y se crea otra (índice de correo abierto liberado)", async () => {
    const a = await reg("rep@acme.example");
    clock += DAY + 1;
    const b = await reg("rep@acme.example");
    expect(b.created).toBe(true);
    expect((await store.get(a.trial.id))!.state).toBe("cancelled");
  });

  it("reenvío concurrente: un solo token nuevo; el anterior deja de valer", async () => {
    const r = await reg("conc@acme.example");
    clock += 5 * 60_000;
    const outs = await Promise.all(Array.from({ length: 5 }, () => svc.resendVerification({ email: "conc@acme.example" }, "web")));
    const fresh = outs.filter((o) => o.outcome === "resent");
    expect(fresh).toHaveLength(1);
    await expect(svc.verify(r.trial.id, r.verificationToken!)).rejects.toMatchObject({ code: "forbidden" });
    expect((await svc.verify(r.trial.id, fresh[0].verificationToken!)).state).toBe("verified");
    expect((await store.events(r.trial.id)).filter((e) => e.action === "resend_verification")).toHaveLength(1);
  });

  it("anotación de aviso: queda en el historial sin cambiar estado ni versión", async () => {
    const t = await active("nota@acme.example", "acme-nota");
    await store.note(t.id, { action: "notice_queued", detail: "expiry:1:3", actor: "test", at: clock });
    const after = (await store.get(t.id))!;
    expect(after.version).toBe(t.version);
    expect((await store.events(t.id)).at(-1)).toMatchObject({ action: "notice_queued", detail: "expiry:1:3", fromState: "active", toState: "active", version: t.version });
    expect(await svc.noticeQueued(t.id, "expiry:1:3")).toBe(true);
  });

  it("GET_LOCK: una réplica a la vez; se libera al terminar", async () => {
    const a = mysqlAdvisoryLock(pool);
    const b = mysqlAdvisoryLock(other);
    const release = await a.acquire(SCHEDULER_LOCK);
    expect(release).toBeTypeOf("function");
    expect(await b.acquire(SCHEDULER_LOCK)).toBeNull();
    await release!();
    const again = await b.acquire(SCHEDULER_LOCK);
    expect(again).toBeTypeOf("function");
    await again!();
  });

  it("tick en dos réplicas a la vez: un vencimiento, un aviso; solicitudes viejas sin verificar anuladas", async () => {
    const t = await active("tick@acme.example", "acme-tick");
    const stale = await reg("stale@acme.example");
    clock = T0 + 30 * DAY;
    const mk = (p: mysql.Pool) => new TrialScheduler({ store: new MysqlTrialStore(p), notify, lock: mysqlAdvisoryLock(p), now: () => clock, log: () => undefined });
    const outs = await Promise.all([mk(pool).tick(), mk(other).tick()]);
    const ran = outs.filter((o) => o.skipped === null);
    expect(ran.length).toBeGreaterThanOrEqual(1);
    expect((await store.get(t.id))!.state).toBe("expired");
    expect(notices.filter((x) => x.trialId === t.id)).toEqual([{ trialId: t.id, daysLeft: 0 }]);
    expect((await store.get(stale.trial.id))!.state).toBe("cancelled");
    // Otra pasada no repite nada
    expect(await mk(pool).tick()).toMatchObject({ expired: 0, noticesQueued: 0, verificationsExpired: 0 });
    expect(notices.filter((x) => x.trialId === t.id)).toHaveLength(1);
  });
});
