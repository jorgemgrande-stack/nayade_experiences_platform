/**
 * Aplicador de migraciones del registro contra MySQL real (opt-in; BD aislada creada y borrada aquí).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
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

  /** BD aislada adicional; se borra al terminar la prueba. */
  async function isolatedDb(suffix: string) {
    const name = `${DB}_${suffix}`;
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(url!);
    u.pathname = `/${name}`;
    const p = mysql.createPool({ uri: u.toString(), connectionLimit: 1, multipleStatements: true });
    return {
      name,
      url: u,
      pool: p,
      drop: async () => {
        await p.end();
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      },
    };
  }

  it("detecta una 0000 registrada pero incompleta (triggers ausentes o alterados) y la repara sin perder datos", async () => {
    const db = await isolatedDb("partial");
    try {
      const files = listRegistryMigrations(DIR);
      const last = files[files.length - 1].version;
      await migrateRegistry(db.pool, DIR, { dryRun: false });
      await db.pool.query("INSERT INTO tenants (id, display_name) VALUES ('t-audit', 'Auditoría')");
      await db.pool.query("INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action) VALUES ('t-audit', 'system', 'test', 'created')");

      // Estado que dejaba el fallo: versión registrada, triggers de auditoría ausentes o neutralizados.
      await db.pool.query("DROP TRIGGER trg_events_no_delete");
      await db.pool.query("DROP TRIGGER trg_events_no_update");
      await db.pool.query("CREATE TRIGGER trg_events_no_update BEFORE UPDATE ON tenant_events FOR EACH ROW SET @x = 1");

      const plan = await migrateRegistry(db.pool, DIR);
      expect(plan.current).toBe(last);
      expect(plan.incomplete).toEqual(["0000"]);
      expect(plan.issues).toEqual(
        expect.arrayContaining([
          { version: "0000", kind: "missing_trigger", object: "trg_events_no_delete" },
          { version: "0000", kind: "trigger_mismatch", object: "trg_events_no_update" },
        ]),
      );
      expect(plan.pending).toEqual(files.map((f) => f.version));

      // Sin --repair no se reaplica en cascada: se detiene sin tocar nada
      await expect(migrateRegistry(db.pool, DIR, { dryRun: false })).rejects.toMatchObject({ code: "incomplete" });
      const [still] = await db.pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'trg_events_no_delete'");
      expect(Number(still[0].n)).toBe(0);

      const fix = await migrateRegistry(db.pool, DIR, { dryRun: false, repair: true });
      expect(fix.applied).toEqual(files.map((f) => f.version));
      const again = await migrateRegistry(db.pool, DIR);
      expect(again).toMatchObject({ current: last, pending: [], incomplete: [], issues: [] });

      const [ev] = await db.pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM tenant_events");
      expect(Number(ev[0].n)).toBe(1); // datos intactos
      await expect(db.pool.query("UPDATE tenant_events SET action = 'x'")).rejects.toMatchObject({ sqlState: "45000" });
      await expect(db.pool.query("DELETE FROM tenant_events")).rejects.toMatchObject({ sqlState: "45000" });
    } finally {
      await db.drop();
    }
  });

  it("con un usuario sin SUPER y binlog activo falla explícitamente sin registrar la 0000 y se recupera después", async (ctx) => {
    const [vars] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT @@log_bin AS logBin, @@log_bin_trust_function_creators AS trust",
    );
    // Reproduce el fallo solo en las condiciones en que ocurre (las de MySQL por defecto, como en CI).
    if (!(Number(vars[0].logBin) === 1 && Number(vars[0].trust) === 0)) ctx.skip();

    const db = await isolatedDb("limited");
    const user = `regmig_${Date.now().toString(36)}`;
    const password = `p_${Math.random().toString(36).slice(2)}A9`;
    await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [user, password]);
    await admin.query(`GRANT ALL PRIVILEGES ON \`${db.name}\`.* TO ?@'%'`, [user]);
    const u = new URL(db.url.toString());
    u.username = user;
    u.password = password;
    const limited = mysql.createPool({ uri: u.toString(), connectionLimit: 1, multipleStatements: true });
    try {
      await expect(migrateRegistry(limited, DIR, { dryRun: false })).rejects.toMatchObject({
        name: "RegistryMigrationError",
        code: "privileges",
      });
      // La 0000 no consta como aplicada aunque su SQL la registre al principio.
      const [v] = await db.pool.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'");
      expect(v).toHaveLength(0);
      const [trg] = await db.pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()",
      );
      expect(Number(trg[0].n)).toBe(0);

      // Recuperación controlada: un administrador con privilegios suficientes completa la cadena.
      const files = listRegistryMigrations(DIR);
      const done = await migrateRegistry(db.pool, DIR, { dryRun: false });
      expect(done.applied).toEqual(files.map((f) => f.version));
      // El usuario limitado ya ve el registro íntegro y no tiene nada pendiente.
      const check = await migrateRegistry(limited, DIR);
      expect(check).toMatchObject({ current: files[files.length - 1].version, pending: [], incomplete: [] });
    } finally {
      await limited.end();
      await admin.query(`DROP USER IF EXISTS ?@'%'`, [user]);
      await db.drop();
    }
  });

  const root = path.resolve(__dirname, "..");
  const cliEnv = (env: Record<string, string>) => {
    const base = { ...process.env };
    delete base.REGISTRY_MIGRATE_URL;
    delete base.REGISTRY_ADMIN_DATABASE_URL;
    return { ...base, ...env };
  };
  const runCli = (env: Record<string, string>, args: string[]) =>
    spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/registry-migrate.ts", ...args], {
      cwd: root,
      env: cliEnv(env),
      encoding: "utf8",
      timeout: 60_000,
    });
  const runCliAsync = (env: Record<string, string>, args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/registry-migrate.ts", ...args], { cwd: root, env: cliEnv(env) });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (b) => (stdout += b));
      p.stderr.on("data", (b) => (stderr += b));
      p.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  it("el CLI no usa la URL del plano de control y exige identificar la BD para ejecutar", async () => {
    const db = await isolatedDb("guard");
    try {
      const old = runCli({ REGISTRY_ADMIN_DATABASE_URL: db.url.toString() }, ["--execute"]);
      expect(old.status).toBe(2);
      expect(old.stderr).toMatch(/Ya no se usa REGISTRY_ADMIN_DATABASE_URL/);
      const env = { REGISTRY_MIGRATE_URL: db.url.toString() };
      const noConfirm = runCli(env, ["--execute"]);
      expect(noConfirm.status).toBe(2);
      expect(noConfirm.stderr).toMatch(`--confirm-database ${db.name}`);
      const wrong = runCli(env, ["--execute", "--confirm-database", "registro_produccion"]);
      expect(wrong.status).toBe(2);
      const [t] = await db.pool.query<mysql.RowDataPacket[]>("SHOW TABLES");
      expect(t).toHaveLength(0);
    } finally {
      await db.drop();
    }
  });

  it("dos ejecuciones simultáneas: una aplica, la otra espera al bloqueo y no encuentra nada pendiente", async () => {
    const db = await isolatedDb("race");
    try {
      const files = listRegistryMigrations(DIR);
      const env = { REGISTRY_MIGRATE_URL: db.url.toString() };
      const args = ["--execute", "--confirm-database", db.name];
      const [a, b] = await Promise.all([runCliAsync(env, args), runCliAsync(env, args)]);
      expect([a.status, b.status], a.stderr + b.stderr).toEqual([0, 0]);
      const applied = [a, b].map((r) => JSON.parse(r.stdout).applied.length).sort((x, y) => x - y);
      expect(applied).toEqual([0, files.length]);
      const plan = runCli(env, []);
      expect(JSON.parse(plan.stdout)).toMatchObject({ current: files[files.length - 1].version, pending: [], incomplete: [] });
    } finally {
      await db.drop();
    }
  });

  it("el comando del runbook (scripts/registry-migrate.ts) planifica y ejecuta de principio a fin", async () => {
    const db = await isolatedDb("cli");
    const run = (args: string[]) => runCli({ REGISTRY_MIGRATE_URL: db.url.toString() }, args);
    try {
      const files = listRegistryMigrations(DIR);
      const plan = run([]);
      expect(plan.status, plan.stderr).toBe(0);
      expect(JSON.parse(plan.stdout)).toMatchObject({ dryRun: true, current: null, pending: files.map((f) => f.version) });

      const exec = run(["--execute", "--confirm-database", db.name]);
      expect(exec.status, exec.stderr).toBe(0);
      expect(JSON.parse(exec.stdout).applied).toEqual(files.map((f) => f.version));
      const [v] = await db.pool.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'");
      expect(v[0].v).toBe(files[files.length - 1].version);
    } finally {
      await db.drop();
    }
  });
});
