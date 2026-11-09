/**
 * Captación de la prueba gratuita contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada): responsable y
 * procedencia en la configuración, prueba de una plataforma, hitos del panel (una vez) con su evento comercial,
 * embudo por canal y el contador anónimo de la página (migración 0046).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { MysqlTrialFunnelCounter, countLandingStep, summarizeLanding } from "./trials/funnel";
import { MysqlCommercialEventLog } from "./commercialEvents/log";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "trials_captacion_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");

describe.skipIf(!URL_)("captación de la prueba con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let svc: TrialService;
  let clock = Date.UTC(2026, 10, 9, 10);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations } = loadMigrations(DIR);
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    const events = new MysqlCommercialEventLog(pool, "test");
    svc = new TrialService({ store: new MysqlTrialStore(pool, events), limits: { perIp24h: 100, perDomain30d: 100 }, now: () => clock });
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("responsable y procedencia se guardan; hitos una sola vez con su evento; embudo por canal", async () => {
    const r = await svc.register({
      email: "ana@talleres-gil.example",
      companyName: "Talleres Gil",
      configuration: { plan: "essential", addons: [] },
      profile: { fullName: "Ana Gil", sector: "industria", phone: "+34 600 000 001", country: "ES", termsAccepted: true, marketingConsent: false },
      attribution: { source: "linkedin", medium: "social" },
      idempotencyKey: "idem-captacion-0000000001",
    });
    const v = await svc.verify(r.trial.id, r.verificationToken!);
    const p = await svc.requestProvisioning(v.id, v.version, "op");
    const act = await svc.markProvisioned(p.id, p.version, "t1-talleres-gil", "prov");
    expect(act.configuration.profile).toMatchObject({ fullName: "Ana Gil", sector: "industria", marketingConsent: false });
    expect(act.configuration.attribution).toMatchObject({ source: "linkedin", medium: "social" });
    expect((await new MysqlTrialStore(pool).byTenant("t1-talleres-gil"))?.id).toBe(act.id);

    expect(await svc.recordMilestone("t1-talleres-gil", "first_access", null, "core:t1")).toEqual({ recorded: true, trialId: act.id });
    expect(await svc.recordMilestone("t1-talleres-gil", "first_access", null, "core:t1")).toEqual({ recorded: false, trialId: act.id });
    expect((await svc.recordMilestone("t1-talleres-gil", "first_action", "quote", "core:t1")).recorded).toBe(true);
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT type, data_json FROM commercial_events WHERE trial_id = ? ORDER BY id", [act.id]);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["trial.requested", "trial.started", "trial.first_access", "trial.first_action"]));
    expect(JSON.stringify(ev)).not.toMatch(/Ana Gil|600 000|ana@/);

    const rows = await new MysqlTrialStore(pool).funnel({ from: clock - 86_400_000, to: clock + 86_400_000 });
    expect(rows).toEqual([{ channel: "linkedin", sector: "industria", stages: expect.objectContaining({ submitted: 1, verified: 1, provisioned: 1, first_access: 1, first_action: 1, converted: 0 }) }]);
  });

  it("contador anónimo de la página por día y canal", async () => {
    const c = new MysqlTrialFunnelCounter(pool);
    await countLandingStep(c, "visit", { source: "google", medium: "cpc" }, clock);
    await countLandingStep(c, "visit", { source: "google", medium: "cpc" }, clock);
    await countLandingStep(c, "form_start", null, clock);
    const s = summarizeLanding(await c.counts({ from: "2026-11-01", to: "2026-11-30" }));
    expect(s.totals).toEqual({ visit: 2, form_start: 1 });
    expect(s.channels).toEqual([{ channel: "google", visit: 2, form_start: 0 }, { channel: "directo", visit: 0, form_start: 1 }]);
  });
});
