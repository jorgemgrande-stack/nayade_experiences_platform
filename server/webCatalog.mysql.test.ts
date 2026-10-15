/**
 * Web comercial con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): migración 0004, concurrencia
 * optimista entre guardados simultáneos, historial, precios inmutables y restricciones de la BD.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DIR = path.resolve(__dirname, "../db/crm/migrations");

async function migrate(pool: mysql.Pool, direction: "up" | "down") {
  const { migrations, errors } = loadMigrations(DIR);
  if (errors.length) throw new Error(errors.join("; "));
  const list = direction === "up" ? migrations : [...migrations].reverse();
  for (const m of list) for (const s of splitStatements(direction === "up" ? m.up : m.down!)) await pool.query(s);
}

const plan = { name: "Business", technicalStatus: "available", activation: { kind: "plan", ref: "business" }, billingModel: "subscription", internal: { costCents: 500 } };

describe.skipIf(!URL_)("web comercial con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let svc: WebAdminService;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query("DROP DATABASE IF EXISTS web_test");
    await admin.query("CREATE DATABASE web_test CHARACTER SET utf8mb4");
    const u = new URL(URL_!);
    u.pathname = "/web_test";
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 6 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    await migrate(pool, "up");
    svc = new WebAdminService({ store: new MysqlWebStore(pool), refs: { moduleIds: ["hotel"], planIds: () => null } });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query("DROP DATABASE IF EXISTS web_test");
    await admin?.end();
  });

  it("dos guardados simultáneos sobre la misma versión: uno gana, el otro recibe conflicto", async () => {
    await svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan }, "a");
    const results = await Promise.allSettled([
      svc.save("product", "business", { draft: { ...plan, tagline: "A" }, expectedVersion: 1 }, "a"),
      svc.save("product", "business", { draft: { ...plan, tagline: "B" }, expectedVersion: 1 }, "b"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "version_conflict" } });
    const { versions, entry } = await svc.get("product", "business");
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(entry.draftVersion).toBe(2);
  });

  it("publicar, precios inmutables con historial y JSON público sin datos internos", async () => {
    await svc.publish("product", "business", 2, "jefa");
    const p1 = await svc.addPrice("business", { kind: "monthly", amountCents: 9900, taxRateBp: 2100 }, "a");
    await svc.approvePrice(p1.id, "jefa");
    const p2 = await svc.addPrice("business", { kind: "monthly", amountCents: 12900, taxRateBp: 2100, taxIncluded: true }, "a");
    await svc.approvePrice(p2.id, "jefa");
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT id, amount_cents, status FROM web_prices ORDER BY id");
    expect(rows.map((r) => [Number(r.amount_cents), r.status])).toEqual([
      [9900, "retired"],
      [12900, "approved"],
    ]);
    const site = await svc.site();
    expect(site.catalog.products[0].prices).toEqual([{ kind: "monthly", amountCents: 12900, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: true }]);
    const [[e]] = (await pool.query<mysql.RowDataPacket[]>("SELECT published FROM web_entries WHERE entry_key = 'business'")) as any;
    expect(JSON.stringify(e.published)).not.toContain("costCents");
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT action FROM web_events ORDER BY id");
    expect(ev.map((r) => r.action)).toEqual(expect.arrayContaining(["create", "save", "publish", "approve", "retire"]));
  });

  it("restricciones de la BD: clave única, importe no negativo y FK", async () => {
    await expect(svc.create({ kind: "product", key: "business", family: "core_plan", draft: plan }, "a")).rejects.toMatchObject({ code: "conflict" });
    await expect(pool.query("INSERT INTO web_prices (entry_id, kind, amount_cents, tax_rate_bp, created_at, created_by) VALUES (1, 'monthly', -5, 2100, 1, 'x')")).rejects.toBeTruthy();
    await expect(pool.query("INSERT INTO web_prices (entry_id, kind, amount_cents, tax_rate_bp, created_at, created_by) VALUES (99999, 'monthly', 5, 2100, 1, 'x')")).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
  });

  it("la migración 0004 se revierte y se vuelve a aplicar", async () => {
    await migrate(pool, "down");
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'web_%'");
    expect(t).toHaveLength(0);
    await migrate(pool, "up");
    const [t2] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'web_%'");
    expect(t2).toHaveLength(4);
  });
});
