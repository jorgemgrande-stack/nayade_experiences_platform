/**
 * ENSAYO del procedimiento de migración 0011–0013 (PLAN_PUBLICACION.md, fases 2 y 3) en un entorno AISLADO con
 * datos ANONIMIZADOS, con las mismas piezas que se usarán en producción (opt-in, REGISTRY_TEST_DATABASE_URL):
 *
 *  1. Registro y dos empresas creadas con el esquema de ANTES de la exportación (baseline + 0001–0010), como las
 *     empresas comerciales actuales, con datos sintéticos y anonimizados.
 *  2. Copia de seguridad cifrada de cada empresa (runBackupJob) e inventario.
 *  3. Simulación (migrateAllTenants sin aplicar): pendientes exactamente 0011, 0012 y 0013 en cada empresa.
 *  4. Aplicación con canario y verificación (check-data-exports): ok en todas; los datos de negocio, idénticos.
 *  5. La exportación funciona sobre el esquema migrado.
 *  6. Reversión A: `scripts/db/migrate.ts down --steps 3` en una empresa → sin 0011–0013, datos idénticos;
 *     y se vuelve a aplicar.
 *  7. Reversión B: restauración de la copia del paso 2 en base nueva y conmutación → esquema y datos de antes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";
import { MysqlTenantRegistryStore } from "./_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { ProvisioningService } from "./_core/provisioning/service";
import { MysqlProvisioningStore, MysqlSchemaApplier, MysqlTenantSeeder, databaseNameFor, userNameFor } from "./_core/provisioning/mysqlAdapters";
import { DatabaseServers, MultiServerDatabaseProvisioner, registryServerUsage } from "./_core/provisioning/servers";
import { EntitlementAdmin } from "./_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "./_core/erm/mysqlQuotas";
import { backupKeyringFromEnv } from "./_core/ops/backupCrypto";
import { FsBackupStorage } from "./_core/ops/backupStorage";
import { MysqlBackupInventory } from "./_core/ops/backupInventory";
import { runBackupJob } from "./_core/ops/backupJob";
import { restoreTenant, restoredUserFor } from "./_core/ops/backupRestore";
import { migrateAllTenants } from "./_core/ops/tenantMigrations";
import { dataExportSchemaStatus } from "./_core/ops/dataExportCheck";
import { MAX_ATTEMPTS, MysqlDataExportStore } from "./dataExport/service";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP: Actor = { type: "operator", id: "ensayo" };
const ROOT = path.resolve(__dirname, "..");
const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

/** Tablas de negocio con datos anonimizados cuyo contenido no debe cambiar al migrar. */
const BUSINESS = ["users", "clients", "leads"];

describe.skipIf(!URL_)("ensayo de migración 0011–0013 con copia y reversión (entorno aislado, datos anonimizados)", () => {
  const run = crypto.randomBytes(3).toString("hex");
  const A = `ens-a-${run}`;
  const B = `ens-b-${run}`;
  const REG = `ensreg_${run}`;
  const env = { ENS_ADMIN: URL_! } as NodeJS.ProcessEnv;
  let admin: mysql.Pool;
  let regPool: mysql.Pool;
  let store: MysqlTenantRegistryStore;
  let svc: TenantRegistryService;
  let servers: DatabaseServers;
  let inventory: MysqlBackupInventory;
  let storage: FsBackupStorage;
  let work: string;
  let preDir: string;
  /** Hasta la 0013: el ensayo es de 0011–0013 aunque después haya migraciones nuevas. */
  let exportDir: string;
  const ring = backupKeyringFromEnv({ BACKUP_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const before = new Map<string, Record<string, string>>();
  const full = () => new MysqlSchemaApplier({ baselinePath: path.join(ROOT, "db/baseline/0000_baseline.sql"), migrationsDir: exportDir });
  const conn = async (id: string) => mysql.createConnection({ uri: (await svc.getActiveDsn(id))! });
  const checksums = async (id: string) => {
    const c = await conn(id);
    try {
      const out: Record<string, string> = {};
      for (const t of BUSINESS) out[t] = String((await c.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${t}\``))[0][0].Checksum);
      return out;
    } finally {
      await c.end();
    }
  };
  const status = async (id: string) => {
    const c = await conn(id);
    try {
      return await dataExportSchemaStatus(async (q, p) => (await c.query(q, p))[0] as Array<Record<string, unknown>>);
    } finally {
      await c.end();
    }
  };
  /** Fila sintética: rellena las columnas obligatorias sin valor por defecto según su tipo. */
  const fillRow = async (c: mysql.Connection, table: string, values: Record<string, unknown>) => {
    const [cols] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME c, IS_NULLABLE n, COLUMN_DEFAULT d, DATA_TYPE t, EXTRA e, COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [table],
    );
    const row: Record<string, unknown> = { ...values };
    for (const col of cols) {
      if (col.c in row || col.n === "YES" || col.d !== null || /auto_increment|GENERATED/i.test(String(col.e))) continue;
      const t = String(col.t);
      row[col.c] = t === "enum" ? String(col.ct).match(/'([^']*)'/)![1] : /int|decimal|float|double/.test(t) ? 0 : /date|time/.test(t) ? new Date(Date.UTC(2026, 0, 1)) : t === "json" ? "{}" : "anon";
    }
    await c.query(`INSERT INTO \`${table}\` SET ?`, [row]);
  };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 3 });
    work = fs.mkdtempSync(path.join(os.tmpdir(), "es-ensayo-"));
    storage = new FsBackupStorage(path.join(work, "copias"));
    await admin.query(`CREATE DATABASE \`${REG}\``);
    regPool = mysql.createPool({ uri: withDb(URL_!, REG), connectionLimit: 4, multipleStatements: true });
    await migrateRegistry(regPool, path.join(ROOT, "db/registry"), { dryRun: false });
    store = new MysqlTenantRegistryStore(regPool);
    const regRing = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    svc = new TenantRegistryService(store, () => regRing);
    inventory = new MysqlBackupInventory(regPool);
    const u = new URL(URL_!);
    servers = new DatabaseServers({ servers: [{ alias: "srv", host: u.hostname, port: Number(u.port || 3306), adminUrlEnv: "ENS_ADMIN" }], placement: "least_used" }, env);

    // Esquema de las empresas comerciales ANTES de la exportación: baseline + 0001–0010
    preDir = path.join(work, "migraciones-previas");
    fs.mkdirSync(preDir);
    for (const f of fs.readdirSync(path.join(ROOT, "db/migrations")).filter((x) => /^00(0\d|10)_/.test(x))) fs.copyFileSync(path.join(ROOT, "db/migrations", f), path.join(preDir, f));
    exportDir = path.join(work, "migraciones-exportacion");
    fs.mkdirSync(exportDir);
    for (const f of fs.readdirSync(path.join(ROOT, "db/migrations")).filter((x) => /^00(0d|1[0-3])_/.test(x))) fs.copyFileSync(path.join(ROOT, "db/migrations", f), path.join(exportDir, f));
    const prov = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new MultiServerDatabaseProvisioner(servers, { usage: () => registryServerUsage(regPool) }),
      schema: new MysqlSchemaApplier({ baselinePath: path.join(ROOT, "db/baseline/0000_baseline.sql"), migrationsDir: preDir }),
      seeder: new MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      store: new MysqlProvisioningStore(regPool),
    });
    for (const id of [A, B]) {
      const r = await prov.run({ tenantId: id, displayName: id, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.example" }, OP);
      expect(r.status).toBe("completed");
      // Datos anonimizados: identificadores secuenciales, dominios .example, sin datos reales
      const c = await conn(id);
      for (let i = 1; i <= 40; i++) {
        const n = String(i).padStart(4, "0");
        await fillRow(c, "clients", { name: `Cliente ${n}`, email: `cliente${n}@anon.example` });
        await fillRow(c, "leads", { name: `Contacto ${n}`, email: `contacto${n}@anon.example` });
      }
      await c.end();
    }
  }, 300_000);

  afterAll(async () => {
    const [dbs] = await admin.query<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? OR SCHEMA_NAME LIKE ? OR SCHEMA_NAME = ?", [`${databaseNameFor(A)}%`, `${databaseNameFor(B)}%`, REG]);
    for (const r of dbs) {
      await admin.query(`DROP DATABASE IF EXISTS \`${r.n}\``).catch(() => undefined);
      if (/_r\d{14}$/.test(String(r.n))) await admin.query("DROP USER IF EXISTS ?@'%'", [restoredUserFor(String(r.n))]).catch(() => undefined);
    }
    for (const id of [A, B]) await admin.query("DROP USER IF EXISTS ?@'%'", [userNameFor(id)]).catch(() => undefined);
    await servers?.end();
    await regPool?.end();
    await admin?.end();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("1–2. punto de partida (sin 0011–0013) y copia de seguridad cifrada e inventariada de cada empresa", async () => {
    for (const id of [A, B]) {
      expect((await status(id)).missing).toEqual(["0011_data_exports", "0012_data_export_jobs", "0013_data_export_purge"]);
      before.set(id, await checksums(id));
    }
    const rep = await runBackupJob({ reader: store, tenantDsn: (id) => svc.getActiveDsn(id), storage, ring, inventory, tmpDir: work, only: [A, B], includePlatform: false });
    expect(rep.ok).toBe(true);
    expect(rep.results.filter((r) => r.kind === "tenant" && r.status === "ok").map((r) => r.id).sort()).toEqual([A, B].sort());
    for (const id of [A, B]) expect((await inventory.list({ targetKind: "tenant", targetId: id, status: "ok", limit: 1 })).length).toBe(1);
  }, 300_000);

  it("3. simulación: pendientes exactamente 0011, 0012 y 0013; no cambia nada", async () => {
    const res = await migrateAllTenants({ reader: store, registry: svc, schema: full(), actor: OP }, { only: [A, B] });
    for (const r of res) expect(r).toMatchObject({ outcome: "planned", pending: ["0011_data_exports", "0012_data_export_jobs", "0013_data_export_purge"] });
    for (const id of [A, B]) expect((await status(id)).ok).toBe(false);
  });

  it("4–5. aplicación con canario, verificación y datos idénticos; la exportación funciona", async () => {
    const res = await migrateAllTenants({ reader: store, registry: svc, schema: full(), actor: OP }, { apply: true, only: [A, B] });
    expect(res.map((r) => r.outcome)).toEqual(["migrated", "migrated"]);
    for (const id of [A, B]) {
      expect(await status(id)).toMatchObject({ ok: true, missing: [], pending: 0 });
      expect(await checksums(id)).toEqual(before.get(id));
    }
    const c = await conn(A);
    const pool = mysql.createPool({ uri: (await svc.getActiveDsn(A))!, connectionLimit: 2 });
    try {
      const s = new MysqlDataExportStore(() => pool);
      const e = await s.insertPending(1, 1000);
      expect((await s.claim(1000, 999, MAX_ATTEMPTS))?.id).toBe(e.id);
      expect(await s.markReady(e.id, { objectId: "x".repeat(26), sizeBytes: 1, tableCount: 1, rowCount: 1, fileCount: 0, expiresAt: 2000 }, 1500)).toBe(true);
      expect((await s.listPurgeable(1600, 3000, 10)).map((x) => x.id)).toEqual([e.id]);
      await pool.query("DELETE FROM data_exports");
    } finally {
      await pool.end();
      await c.end();
    }
    // Repetir la aplicación no hace nada (idempotente)
    const again = await migrateAllTenants({ reader: store, registry: svc, schema: full(), actor: OP }, { apply: true, only: [A, B] });
    expect(again.map((r) => r.outcome)).toEqual(["up_to_date", "up_to_date"]);
  }, 300_000);

  it("6. reversión A con scripts/db/migrate.ts down --steps 3: sin 0011–0013, datos idénticos; se vuelve a aplicar", async () => {
    const dsn = (await svc.getActiveDsn(A))!;
    const database = new URL(dsn).pathname.slice(1);
    const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/db/migrate.ts", "down", "--dir", "db/migrations", "--steps", "3", "--apply", "--confirm-database", database], {
      cwd: ROOT,
      env: { ...process.env, MIGRATE_DATABASE_URL: dsn },
      encoding: "utf8",
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect((await status(A)).missing).toEqual(["0011_data_exports", "0012_data_export_jobs", "0013_data_export_purge"]);
    expect(await checksums(A)).toEqual(before.get(A));
    const res = await migrateAllTenants({ reader: store, registry: svc, schema: full(), actor: OP }, { apply: true, only: [A] });
    expect(res[0].outcome).toBe("migrated");
    expect((await status(A)).ok).toBe(true);
  }, 300_000);

  it("7. reversión B restaurando la copia previa en base nueva y conmutando: esquema y datos de antes", async () => {
    const rep = await restoreTenant({ storage, ring, inventory, servers, registry: svc, reader: store, tmpDir: work }, { tenantId: B, switch: true, actor: OP });
    expect(rep.verification).toMatchObject({ ok: true, problems: [] });
    expect(rep.switched).toBe(true);
    expect((await status(B)).missing).toEqual(["0011_data_exports", "0012_data_export_jobs", "0013_data_export_purge"]);
    expect(await checksums(B)).toEqual(before.get(B));
    // A no se ve afectada
    expect((await status(A)).ok).toBe(true);
  }, 300_000);
});
