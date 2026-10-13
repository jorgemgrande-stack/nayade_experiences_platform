/**
 * Operaciones con MySQL real (opt-in): migraciones por tenant con canario, diagnóstico y
 * copia/restauración de un tenant aprovisionado.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlTenantRegistryStore } from "./_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { ProvisioningService } from "./_core/provisioning/service";
import {
  MysqlDatabaseProvisioner,
  MysqlProvisioningStore,
  MysqlSchemaApplier,
  MysqlTenantSeeder,
  databaseNameFor,
} from "./_core/provisioning/mysqlAdapters";
import { EntitlementAdmin } from "./_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "./_core/erm/mysqlQuotas";
import { migrateAllTenants } from "./_core/ops/tenantMigrations";
import { diagnoseTenant } from "./_core/ops/diagnostics";
import { backupDatabase, verifyBackup } from "./_core/ops/backup";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP: Actor = { type: "operator", id: "test" };

describe.skipIf(!URL_)("operaciones multi-tenant con MySQL real", () => {
  let admin: mysql.Pool;
  let store: MysqlTenantRegistryStore;
  let svc: TenantRegistryService;
  let migDir: string;
  let schema: MysqlSchemaApplier;
  let outDir: string;
  const run = crypto.randomBytes(3).toString("hex");
  const A = `ops-a-${run}`;
  const B = `ops-b-${run}`;

  beforeAll(async () => {
    const u = new URL(URL_!);
    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 6 });
    const [t] = await admin.query("SHOW TABLES LIKE 'tenant_provisioning'");
    if (!(t as unknown[]).length) {
      for (const f of ["0000_registry", "0001_entitlements", "0002_quotas", "0003_provisioning"]) {
        const ddl = fs.readFileSync(path.resolve(__dirname, `../db/registry/${f}.sql`), "utf8").replace(/^--.*$/gm, "");
        for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await admin.query(s).catch(() => undefined);
      }
    }
    store = new MysqlTenantRegistryStore(admin);
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    svc = new TenantRegistryService(store, () => ring);

    migDir = fs.mkdtempSync(path.join(os.tmpdir(), "es-mig-"));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "es-bk-"));
    schema = new MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: migDir });
    const prov = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema,
      seeder: new MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(admin),
      quotas: new QuotaAdmin(admin),
      store: new MysqlProvisioningStore(admin),
    });
    for (const id of [A, B]) {
      const r = await prov.run({ tenantId: id, displayName: id, adminEmail: `a@${id}.example`, platformDomain: "elephantsource.es" }, OP);
      expect(r.status).toBe("completed");
    }
  }, 180_000);

  afterAll(async () => {
    for (const id of [A, B]) await admin?.query(`DROP DATABASE IF EXISTS \`${databaseNameFor(id)}\``).catch(() => undefined);
    await admin?.end();
    for (const d of [migDir, outDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  it("dry-run informa de pendientes sin tocar nada; apply migra a todos con canario", async () => {
    fs.writeFileSync(path.join(migDir, "0001_ops_marker.sql"), "CREATE TABLE ops_marker (id INT PRIMARY KEY, note VARCHAR(20));\n");
    fs.writeFileSync(path.join(migDir, "0001_ops_marker.down.sql"), "DROP TABLE ops_marker;\n");
    const deps = { reader: store, registry: svc, schema, actor: OP };

    const plan = await migrateAllTenants(deps, { only: [A, B] });
    expect(plan.map((r) => r.outcome)).toEqual(["planned", "planned"]);
    expect(plan[0].pending).toEqual(["0001_ops_marker"]);

    const done = await migrateAllTenants(deps, { apply: true, only: [A, B] });
    expect(done.map((r) => r.outcome).sort()).toEqual(["migrated", "migrated"]);
    expect((await store.getTenant(A))!.schemaVersion).toBe("0001_ops_marker");

    const again = await migrateAllTenants(deps, { apply: true, only: [A, B] });
    expect(again.every((r) => r.outcome === "up_to_date")).toBe(true);
  }, 120_000);

  it("una migración defectuosa en el canario detiene al resto", async () => {
    fs.writeFileSync(path.join(migDir, "0002_rota.sql"), "ALTER TABLE tabla_que_no_existe ADD COLUMN x INT;\n");
    fs.writeFileSync(path.join(migDir, "0002_rota.down.sql"), "SELECT 1;\n");
    const res = await migrateAllTenants({ reader: store, registry: svc, schema, actor: OP }, { apply: true, only: [A, B] });
    expect(res[0].outcome).toBe("failed");
    expect(res[1]).toMatchObject({ outcome: "skipped", error: "canario fallido" });
    // el esquema registrado de ninguno cambia
    expect((await store.getTenant(A))!.schemaVersion).toBe("0001_ops_marker");
    fs.rmSync(path.join(migDir, "0002_rota.sql"));
    fs.rmSync(path.join(migDir, "0002_rota.down.sql"));
  }, 120_000);

  it("diagnóstico: informe sin secretos y detecta esquema desactualizado", async () => {
    const ok = await diagnoseTenant({ reader: store, registry: svc, expectedSchemaVersion: "0001_ops_marker" }, A);
    expect(ok.ok).toBe(true);
    expect(ok.checks.find((c) => c.name === "database_reachable")?.ok).toBe(true);
    expect(ok.checks.find((c) => c.name === "schema_up_to_date")?.ok).toBe(true);
    expect(JSON.stringify(ok)).not.toMatch(/mysql:\/\//);

    const stale = await diagnoseTenant({ reader: store, registry: svc, expectedSchemaVersion: "0009_futura" }, A);
    expect(stale.ok).toBe(false);
    expect(stale.checks.find((c) => c.name === "schema_up_to_date")?.ok).toBe(false);

    const missing = await diagnoseTenant({ reader: store, registry: svc }, "no-existe");
    expect(missing.ok).toBe(false);
  });

  it("copia de un tenant aprovisionado y restauración verificada", async () => {
    const dsn = (await svc.getActiveDsn(A))!;
    const m = await backupDatabase(dsn, { tenantId: A, outDir });
    expect(Object.keys(m.tables).length).toBeGreaterThanOrEqual(153); // baseline + historial + marcador
    expect(m.tables.users.rows).toBe(1);

    const scratch = `bk_ops_${run}`;
    await admin.query(`CREATE DATABASE \`${scratch}\``);
    try {
      const u = new URL(URL_!);
      u.pathname = `/${scratch}`;
      const rep = await verifyBackup(u.toString(), path.join(outDir, m.file.replace(/\.sql\.gz$/, ".manifest.json")));
      expect(rep).toMatchObject({ ok: true, problems: [] });
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
    }
  }, 180_000);
});
