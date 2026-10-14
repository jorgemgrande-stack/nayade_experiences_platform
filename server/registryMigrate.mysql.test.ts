/**
 * Aplicador de migraciones del registro contra MySQL real (opt-in; BD aislada creada y borrada aquí).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { listRegistryMigrations, migrateRegistry, RegistryMigrationError } from "./_core/tenantRegistry/migrate";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const DB = "registry_migrate_test";
const DIR = path.resolve(__dirname, "../db/registry");

d("migraciones del registro (MySQL)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: url!, connectionLimit: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const u = new URL(url!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 1, multipleStatements: true });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("plan no escribe; ejecución aplica todo; repetir no hace nada", async () => {
    const files = listRegistryMigrations(DIR);
    const last = files[files.length - 1].version;

    const plan = await migrateRegistry(pool, DIR);
    expect(plan).toMatchObject({ current: null, dryRun: true, applied: [] });
    expect(plan.pending).toHaveLength(files.length);
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES");
    expect(t).toHaveLength(0);

    const run = await migrateRegistry(pool, DIR, { dryRun: false });
    expect(run.applied).toHaveLength(files.length);
    const [v] = await pool.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k='schema_version'");
    expect(v[0].v).toBe(last);

    const again = await migrateRegistry(pool, DIR, { dryRun: false });
    expect(again).toMatchObject({ current: last, pending: [], applied: [] });
  });

  it("detecta huecos y migraciones fallidas sin dejar la cadena a medias", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "regmig-"));
    fs.writeFileSync(path.join(tmp, "0000_a.sql"), "SELECT 1;");
    fs.writeFileSync(path.join(tmp, "0002_c.sql"), "SELECT 1;");
    expect(() => listRegistryMigrations(tmp)).toThrow(RegistryMigrationError);
    fs.writeFileSync(path.join(tmp, "0001_b.sql"), "SELECT 1;");
    fs.rmSync(path.join(tmp, "0002_c.sql"));
    fs.writeFileSync(path.join(tmp, "0001_b.sql"), "THIS IS NOT SQL;");

    const fresh = `${DB}_b`;
    await admin.query(`DROP DATABASE IF EXISTS ${fresh}`);
    await admin.query(`CREATE DATABASE ${fresh}`);
    const u = new URL(url!);
    u.pathname = `/${fresh}`;
    const p2 = mysql.createPool({ uri: u.toString(), connectionLimit: 1, multipleStatements: true });
    try {
      fs.copyFileSync(path.join(DIR, "0000_registry.sql"), path.join(tmp, "0000_a.sql"));
      await expect(migrateRegistry(p2, tmp, { dryRun: false })).rejects.toMatchObject({ code: "failed" });
      const [v] = await p2.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k='schema_version'");
      expect(v[0].v).toBe("0000"); // 0000 aplicada; 0001 fallida no avanza la versión
    } finally {
      await p2.end();
      await admin.query(`DROP DATABASE IF EXISTS ${fresh}`);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
