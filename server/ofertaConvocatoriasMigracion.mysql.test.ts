/**
 * Migraciones de «bajo petición» (0069) y convocatorias (si existen) arriba / abajo / arriba con el ejecutor real
 * (scripts/db/migrate.ts) sobre una BD nueva creada desde la baseline (opt-in, REGISTRY_TEST_DATABASE_URL; la BD se
 * crea y se borra aquí). Los productos que ya existían quedan «precio fijo» sin tocar nada más.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/tsx/dist/cli.mjs");
const MINE = fs.readdirSync(path.join(ROOT, "db/migrations")).filter((f) => /^\d{4}_(experiences_offer_mode|product_editions)\.sql$/.test(f)).sort();

type Run = { status: number | null; stdout: string; stderr: string };
const cli = (dbUrl: string, args: string[]): Promise<Run> =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [TSX, "scripts/db/migrate.ts", ...args], { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: dbUrl } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (b) => (stdout += b));
    p.stderr.on("data", (b) => (stderr += b));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });

d("migraciones 0069/0070 arriba, abajo, arriba (BD nueva desde la baseline)", () => {
  const DB = "mig_oferta_conv";
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let dbUrl = "";
  const q = async (sql: string, p: unknown[] = []) => (await pool.query<mysql.RowDataPacket[]>(sql, p))[0];
  const cols = async (t: string) => (await q("SELECT COLUMN_NAME AS c, COLUMN_DEFAULT AS d, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t])).map((r) => r.c as string);
  const hasTable = async (t: string) => (await q("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t]))[0].n === 1;
  const run = (args: string[]) => cli(dbUrl, [...args, "--dir", "db/migrations", "--apply", "--confirm-database", DB]);

  beforeAll(async () => {
    const u = new URL(url!);
    u.pathname = "/";
    admin = mysql.createPool({ uri: u.toString(), connectionLimit: 2, multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    u.pathname = `/${DB}`;
    dbUrl = u.toString();
    pool = mysql.createPool({ uri: dbUrl, connectionLimit: 2, multipleStatements: true });
    await pool.query(fs.readFileSync(path.join(ROOT, "db/baseline/0000_baseline.sql"), "utf8"));
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("el carril de migraciones está completo y sin huecos", async () => {
    const r = await cli(dbUrl, ["verify", "--dir", "db/migrations"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(MINE.length).toBeGreaterThan(0);
  });

  it("arriba: columnas y tablas nuevas; un producto existente queda a precio fijo", async () => {
    // Un producto «de siempre», creado antes de la migración (con el esquema de la baseline)
    await q("INSERT INTO experiences (slug, title, categoryId, locationId, basePrice) VALUES ('antiguo', 'Producto antiguo', 1, 1, 30.00)");
    const up = await run(["up"]);
    expect(up.status, up.stdout + up.stderr).toBe(0);
    expect(await cols("experiences")).toEqual(expect.arrayContaining(["offer_mode", "request_cta_label"]));
    const [old] = await q("SELECT offer_mode AS m, request_cta_label AS c, basePrice FROM experiences WHERE slug = 'antiguo'");
    expect([old.m, old.c, Number(old.basePrice)]).toEqual(["fixed", null, 30]);
    if (MINE.some((f) => f.includes("product_editions"))) {
      expect(await hasTable("product_editions")).toBe(true);
      expect(await hasTable("edition_enrollments")).toBe(true);
    }
    // El valor por defecto es «precio fijo» y el modo solo admite los tres valores
    await q("INSERT INTO experiences (slug, title, categoryId, locationId, basePrice) VALUES ('nuevo', 'Nuevo', 1, 1, 10.00)");
    expect((await q("SELECT offer_mode AS m FROM experiences WHERE slug = 'nuevo'"))[0].m).toBe("fixed");
    await expect(q("INSERT INTO experiences (slug, title, categoryId, locationId, basePrice, offer_mode) VALUES ('x', 'X', 1, 1, 1, 'otro')")).rejects.toThrow();
  }, 180_000);

  it("abajo: se quitan solo lo añadido y el producto existente se conserva", async () => {
    const down = await run(["down", "--steps", String(MINE.length)]);
    expect(down.status, down.stdout + down.stderr).toBe(0);
    expect(await cols("experiences")).not.toContain("offer_mode");
    expect(await cols("experiences")).not.toContain("request_cta_label");
    expect(await hasTable("product_editions")).toBe(false);
    expect(await hasTable("edition_enrollments")).toBe(false);
    expect((await q("SELECT COUNT(*) AS n FROM experiences WHERE slug IN ('antiguo','nuevo')"))[0].n).toBe(2);
  }, 180_000);

  it("arriba otra vez: idempotente y el producto existente vuelve a quedar a precio fijo", async () => {
    const up = await run(["up"]);
    expect(up.status, up.stdout + up.stderr).toBe(0);
    expect((await q("SELECT offer_mode AS m FROM experiences WHERE slug = 'antiguo'"))[0].m).toBe("fixed");
    const again = await run(["up"]);
    expect(again.status, again.stdout + again.stderr).toBe(0);
  }, 180_000);
});
