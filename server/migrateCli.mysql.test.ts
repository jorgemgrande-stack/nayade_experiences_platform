/**
 * Ejecutor de migraciones (scripts/db/migrate.ts) de principio a fin contra MySQL real (opt-in,
 * REGISTRY_TEST_DATABASE_URL; BD aisladas creadas y borradas aquí): lectura sin escrituras,
 * identificación del destino, carril equivocado, concurrencia entre procesos, migraciones a medias
 * y compatibilidad con registros anteriores.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { checksum } from "../scripts/db/migrationLib";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/tsx/dist/cli.mjs");

type Run = { status: number | null; stdout: string; stderr: string };
function cli(dbUrl: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [TSX, "scripts/db/migrate.ts", ...args], {
      cwd: ROOT,
      env: { ...process.env, MIGRATE_DATABASE_URL: dbUrl },
    });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (b) => (stdout += b));
    p.stderr.on("data", (b) => (stderr += b));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function laneDir(name: string, files: Record<string, string>, requires = ["t_base"]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lane-${name}-`));
  fs.writeFileSync(path.join(dir, "lane.json"), JSON.stringify({ name, requires }));
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  return dir;
}

d("ejecutor de migraciones contra MySQL real", () => {
  let admin: mysql.Pool;
  const dbs: string[] = [];
  const dirs: string[] = [];

  async function freshDb(name: string, baseTables = ["t_base"]) {
    const db = `mig_cli_${name}`;
    dbs.push(db);
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.query(`CREATE DATABASE ${db}`);
    const u = new URL(url!);
    u.pathname = `/${db}`;
    const pool = mysql.createPool({ uri: u.toString(), connectionLimit: 2 });
    for (const t of baseTables) await pool.query(`CREATE TABLE ${t} (id INT PRIMARY KEY)`);
    return { db, url: u.toString(), pool };
  }
  const tables = async (pool: mysql.Pool) =>
    ((await pool.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"))[0]).map((r) => String(r.n)).sort();
  const dir = (name: string, files: Record<string, string>, requires?: string[]) => {
    const x = laneDir(name, files, requires);
    dirs.push(x);
    return x;
  };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: url!, connectionLimit: 2 });
  });
  afterAll(async () => {
    for (const db of dbs) await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin?.end();
    for (const x of dirs) fs.rmSync(x, { recursive: true, force: true });
  });

  it("status y dry-run no escriben nada; escribir exige identificar la BD", async () => {
    const t = await freshDb("lectura");
    const lane = dir("prueba", { "0001_uno.sql": "CREATE TABLE t_uno (id INT)", "0001_uno.down.sql": "DROP TABLE t_uno" });

    const st = await cli(t.url, ["status", "--dir", lane]);
    expect(st.status, st.stderr).toBe(0);
    expect(st.stdout).toMatch(/pendientes: 1/);
    const dry = await cli(t.url, ["up", "--dir", lane]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/\[dry-run\] Aplicaría 1/);
    expect(await tables(t.pool)).toEqual(["t_base"]);

    const noConfirm = await cli(t.url, ["up", "--dir", lane, "--apply"]);
    expect(noConfirm.status).toBe(1);
    expect(noConfirm.stderr).toMatch(`--confirm-database ${t.db}`);
    const wrong = await cli(t.url, ["up", "--dir", lane, "--apply", "--confirm-database", "produccion"]);
    expect(wrong.status).toBe(1);
    expect(await tables(t.pool)).toEqual(["t_base"]);

    const ok = await cli(t.url, ["up", "--dir", lane, "--apply", "--confirm-database", t.db]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(await tables(t.pool)).toEqual(["__elephant_migrations", "__elephant_migrations_meta", "t_base", "t_uno"]);
    const [meta] = await t.pool.query<mysql.RowDataPacket[]>("SELECT k, v FROM __elephant_migrations_meta");
    expect(meta.map((r) => [r.k, r.v])).toEqual([["lane", "prueba"]]);
    await t.pool.end();
  }, 60_000);

  it("sin --dir no hace nada; otro carril o una BD sin las tablas base se rechazan", async () => {
    const t = await freshDb("carril");
    const a = dir("prueba", { "0001_uno.sql": "CREATE TABLE t_uno (id INT)", "0001_uno.down.sql": "DROP TABLE t_uno" });
    expect((await cli(t.url, ["status"])).stderr).toMatch(/no hay carril por defecto/);
    expect((await cli(t.url, ["up", "--dir", a, "--apply", "--confirm-database", t.db])).status).toBe(0);

    const otro = dir("otro", { "0001_x.sql": "CREATE TABLE t_x (id INT)", "0001_x.down.sql": "DROP TABLE t_x" });
    const r = await cli(t.url, ["up", "--dir", otro, "--apply", "--confirm-database", t.db]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ligada al carril «prueba»/);

    const sinBase = await freshDb("sinbase", ["crm_companies"]);
    const r2 = await cli(sinBase.url, ["up", "--dir", a, "--apply", "--confirm-database", sinBase.db]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toMatch(/Faltan las tablas base/);
    expect(await tables(sinBase.pool)).toEqual(["crm_companies"]);
    await t.pool.end();
    await sinBase.pool.end();
  }, 60_000);

  it("dos ejecutores a la vez: la migración se aplica una sola vez y ambos terminan bien", async () => {
    const t = await freshDb("concurrencia");
    // Sin IF NOT EXISTS: si se aplicara dos veces, la segunda fallaría.
    const lane = dir("prueba", { "0001_lenta.sql": "SELECT SLEEP(1);\nCREATE TABLE t_lenta (id INT);", "0001_lenta.down.sql": "DROP TABLE t_lenta" });
    const args = ["up", "--dir", lane, "--apply", "--confirm-database", t.db];
    const [r1, r2] = await Promise.all([cli(t.url, args), cli(t.url, args)]);
    expect([r1.status, r2.status], r1.stderr + r2.stderr).toEqual([0, 0]);
    const applied = [r1.stdout, r2.stdout].map((s) => Number(/Aplicando (\d+)/.exec(s)?.[1])).sort();
    expect(applied).toEqual([0, 1]);
    const [rows] = await t.pool.query<mysql.RowDataPacket[]>("SELECT id FROM __elephant_migrations");
    expect(rows).toHaveLength(1);
    await t.pool.end();
  }, 60_000);

  it("una migración que falla a medias bloquea el carril hasta resolverla a mano", async () => {
    const t = await freshDb("parcial");
    const lane = dir("prueba", {
      "0001_rota.sql": "CREATE TABLE t_parcial (id INT);\nALTER TABLE no_existe ADD COLUMN x INT;",
      "0001_rota.down.sql": "DROP TABLE t_parcial",
    });
    const args = ["up", "--dir", lane, "--apply", "--confirm-database", t.db];
    const r = await cli(t.url, args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/sentencia 2\/2/);
    expect(r.stderr).toMatch(/a medias/);

    const again = await cli(t.url, args);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/up:0001_rota empezó y no terminó/);
    const st = await cli(t.url, ["status", "--dir", lane]);
    expect(st.status).toBe(1);

    // Una persona revisa, deshace lo que quedó y lo registra como no aplicada
    await t.pool.query("DROP TABLE t_parcial");
    const badId = await cli(t.url, ["resolve", "--dir", lane, "--id", "0001_otra", "--as", "not-applied", "--apply", "--confirm-database", t.db]);
    expect(badId.status).toBe(1);
    const res = await cli(t.url, ["resolve", "--dir", lane, "--id", "0001_rota", "--as", "not-applied", "--apply", "--confirm-database", t.db]);
    expect(res.status, res.stderr).toBe(0);

    // Corregida (no se había registrado, así que puede cambiar), se aplica limpia
    fs.writeFileSync(path.join(lane, "0001_rota.sql"), "CREATE TABLE t_parcial (id INT);");
    const fixed = await cli(t.url, args);
    expect(fixed.status, fixed.stderr).toBe(0);
    expect(await tables(t.pool)).toContain("t_parcial");
    await t.pool.end();
  }, 60_000);

  it("un registro anterior a esta versión (sin carril) sigue funcionando y queda ligado al aplicar", async () => {
    const t = await freshDb("legado");
    const one = "CREATE TABLE t_uno (id INT)";
    const lane = dir("prueba", {
      "0001_uno.sql": one,
      "0001_uno.down.sql": "DROP TABLE t_uno",
      "0002_dos.sql": "CREATE TABLE t_dos (id INT)",
      "0002_dos.down.sql": "DROP TABLE t_dos",
    });
    // Estado que dejaba el ejecutor anterior: solo la tabla de registro
    await t.pool.query(one);
    await t.pool.query(
      "CREATE TABLE __elephant_migrations (id VARCHAR(128) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, duration_ms INT NOT NULL DEFAULT 0)",
    );
    await t.pool.query("INSERT INTO __elephant_migrations (id, checksum) VALUES ('0001_uno', ?)", [checksum(one)]);

    const st = await cli(t.url, ["status", "--dir", lane]);
    expect(st.status, st.stderr).toBe(0);
    expect(st.stdout).toMatch(/Aplicadas: 1 · pendientes: 1 · BD aún sin ligar/);
    const up = await cli(t.url, ["up", "--dir", lane, "--apply", "--confirm-database", t.db]);
    expect(up.status, up.stderr).toBe(0);
    const [meta] = await t.pool.query<mysql.RowDataPacket[]>("SELECT v FROM __elephant_migrations_meta WHERE k = 'lane'");
    expect(meta[0].v).toBe("prueba");
    await t.pool.end();
  }, 60_000);

  it("el carril real db/migrations se aplica, se revierte y se vuelve a aplicar", async () => {
    // El carril se aplica sobre la baseline: 0004 amplía `reservations`, que aquí basta con que exista
    const t = await freshDb("app", ["users", "reservations"]);
    // 0005 amplía el ENUM `users.role`: la columna debe existir (como en la baseline)
    await t.pool.query("ALTER TABLE users ADD COLUMN `role` enum('user','admin') NOT NULL DEFAULT 'user'");
    const args = (cmd: string) => [cmd, "--dir", "db/migrations", "--apply", "--confirm-database", t.db];
    const up = await cli(t.url, args("up"));
    expect(up.status, up.stderr).toBe(0);
    const n = fs.readdirSync(path.join(ROOT, "db/migrations")).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).length;
    expect(up.stdout).toMatch(`Aplicando ${n} migración`);
    const down = await cli(t.url, [...args("down"), "--steps", String(n)]);
    expect(down.status, down.stderr).toBe(0);
    const again = await cli(t.url, args("up"));
    expect(again.status, again.stderr).toBe(0);
    const st = await cli(t.url, ["status", "--dir", "db/migrations"]);
    expect(st.stdout).toMatch(`Aplicadas: ${n} · pendientes: 0`);
    await t.pool.end();
  }, 60_000);
});
