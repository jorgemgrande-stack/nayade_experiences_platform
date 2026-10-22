/**
 * Prueba autónoma contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada): migración 0007,
 * unicidad en la BD (correo abierto, clave, tenant) también con altas simultáneas, versión y eventos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "trials_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");

describe.skipIf(!URL_)("prueba autónoma con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let svc: TrialService;
  const key = (n: number) => `idem-mysql-${String(n).padStart(10, "0")}`;

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
    svc = new TrialService({ store: new MysqlTrialStore(pool), limits: { perIp24h: 100, perDomain30d: 100 } });
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("altas simultáneas con el mismo correo: una sola prueba abierta (la BD decide)", async () => {
    const r = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => svc.register({ email: "carrera@acme.es", companyName: "Acme", configuration: { plan: null, addons: [] }, idempotencyKey: key(i) })),
    );
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason.code === "conflict")).toBe(true);
    const [n] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM trial_requests WHERE email = 'carrera@acme.es'");
    expect(Number(n[0].n)).toBe(1);
  });

  it("más altas simultáneas que conexiones del pool: todas terminan (sin bloqueo por agotamiento del pool)", async () => {
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    const small = mysql.createPool({ uri: u.toString(), connectionLimit: 2 });
    try {
      const s2 = new TrialService({ store: new MysqlTrialStore(small), limits: { perIp24h: 100, perDomain30d: 100 } });
      const all = Promise.all(Array.from({ length: 6 }, (_, i) => s2.register({ email: `pool${i}@pool${i}.example`, companyName: `Pool ${i}`, configuration: { plan: null, addons: [] }, idempotencyKey: key(200 + i) })));
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("bloqueo: el pool se agotó")), 10_000));
      const r = await Promise.race([all, timeout]);
      expect(r.every((x) => x.created)).toBe(true);
    } finally {
      await small.end();
    }
  }, 20_000);

  it("la misma clave a la vez: una alta y las demás devuelven la existente", async () => {
    const r = await Promise.all(Array.from({ length: 4 }, () => svc.register({ email: "idem@acme.es", companyName: "Acme", configuration: { plan: null, addons: [] }, idempotencyKey: key(50) })));
    expect(r.filter((x) => x.created)).toHaveLength(1);
    expect(new Set(r.map((x) => x.trial.id)).size).toBe(1);
  });

  it("flujo con versión y eventos en la misma transacción; un tenant, una prueba", async () => {
    const a = await svc.register({ email: "flujo@acme.es", companyName: "Acme", configuration: { plan: "business", addons: [] }, idempotencyKey: key(60) });
    const v = await svc.verify(a.trial.id, a.verificationToken!);
    const p = await svc.requestProvisioning(v.id, v.version, "op");
    const act = await svc.markProvisioned(p.id, p.version, "acme-flujo", "prov");
    expect(act.state).toBe("active");
    await expect(svc.cancel(act.id, p.version, "x", "op")).rejects.toMatchObject({ code: "conflict" });
    const b = await svc.register({ email: "otro@otro.es", companyName: "Otro", configuration: { plan: null, addons: [] }, idempotencyKey: key(61) });
    const vb = await svc.verify(b.trial.id, b.verificationToken!);
    const pb = await svc.requestProvisioning(vb.id, vb.version, "op");
    await expect(svc.markProvisioned(pb.id, pb.version, "acme-flujo", "prov")).rejects.toMatchObject({ code: "conflict" });
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT action, version FROM trial_events WHERE trial_id = ? ORDER BY id", [act.id]);
    expect(ev.map((e) => `${e.action}@${e.version}`)).toEqual(["registered@1", "verify@2", "request_provisioning@3", "provisioned@4"]);
    const [tok] = await pool.query<mysql.RowDataPacket[]>("SELECT verification_token_hash FROM trial_requests WHERE id = ?", [act.id]);
    expect(tok[0].verification_token_hash).toBeNull();
  });

  it("la migración 0007 se revierte y se vuelve a aplicar", async () => {
    const { migrations } = loadMigrations(DIR);
    const m = migrations.find((x) => x.id === "0007_trials")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'trial%'");
    expect(t).toHaveLength(0);
    for (const s of splitStatements(m.up)) await pool.query(s);
    const [t2] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'trial%'");
    expect(t2).toHaveLength(2);
  });
});
