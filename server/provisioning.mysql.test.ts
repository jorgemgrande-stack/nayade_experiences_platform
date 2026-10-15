/**
 * Aprovisionamiento extremo a extremo con MySQL real (opt-in): crea una BD nueva con usuario
 * propio, aplica el baseline completo, siembra administrador y marca, registra dominio,
 * licencias y cuotas, y comprueba que la resolución y el aislamiento funcionan.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/provisioning.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlTenantRegistryStore } from "./_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { TenantResolver } from "./_core/tenantRegistry/resolver";
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
import { loadMigrations } from "../scripts/db/migrationLib";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP: Actor = { type: "operator", id: "test" };
// Id único por ejecución: el registro de pruebas es persistente y el keyring, aleatorio
const ID = `prov-${crypto.randomBytes(3).toString("hex")}`;

async function runSql(pool: mysql.Pool, rel: string) {
  const ddl = fs.readFileSync(path.resolve(__dirname, rel), "utf8").replace(/^--.*$/gm, "");
  for (const stmt of ddl.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) await pool.query(stmt);
}

describe.skipIf(!URL_)("aprovisionamiento con MySQL real", () => {
  let admin: mysql.Pool;
  let prov: ProvisioningService;
  let store: MysqlTenantRegistryStore;
  let svc: TenantRegistryService;
  let host: string;
  let port: number;

  beforeAll(async () => {
    const u = new URL(URL_!);
    host = u.hostname;
    port = Number(u.port || 3306);
    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 5 });

    const [t] = await admin.query("SHOW TABLES LIKE 'tenants'");
    if (!(t as unknown[]).length) await runSql(admin, "../db/registry/0000_registry.sql");
    await admin.query("DROP TABLE IF EXISTS tenant_entitlements, tenant_quotas, tenant_provisioning");
    for (const f of ["0001_entitlements", "0002_quotas", "0003_provisioning"]) await runSql(admin, `../db/registry/${f}.sql`);
    await admin.query(`DROP DATABASE IF EXISTS \`${databaseNameFor(ID)}\``);

    store = new MysqlTenantRegistryStore(admin);
    const ring = keyringFromEnv({
      REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
      REGISTRY_ACTIVE_KEY_ID: "k1",
    } as NodeJS.ProcessEnv);
    svc = new TenantRegistryService(store, () => ring);

    prov = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new MysqlDatabaseProvisioner(admin, { host, port, alias: "test-server", userHost: "%" }),
      schema: new MysqlSchemaApplier({
        baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"),
        migrationsDir: path.resolve(__dirname, "../db/migrations"),
      }),
      seeder: new MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(admin),
      quotas: new QuotaAdmin(admin),
      store: new MysqlProvisioningStore(admin),
    });
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseNameFor(ID)}\``).catch(() => undefined);
      await admin.end();
    }
  });

  it("alta completa: BD nueva con baseline, admin, dominio activo, licencias y cuotas", async () => {
    const r = await prov.run(
      {
        tenantId: ID,
        displayName: "Prov Real",
        adminEmail: "admin@prov-real.example",
        platformDomain: "elephantsource.es",
        modules: ["hotel"],
        brand: { name: "Prov Real", primaryColor: "#112233" },
        templateId: "hotel",
        quotas: [{ metric: "email.sent", period: "day", limit: 100, enforcement: "hard" }],
      },
      OP,
    );
    expect(r.status).toBe("completed");
    expect(r.adminInviteToken).toMatch(/^[0-9a-f]{64}$/);

    // BD física con las 152 tablas del baseline (+ historial)
    const [tables] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?",
      [databaseNameFor(ID)],
    );
    expect(Number(tables[0].n)).toBeGreaterThanOrEqual(152);

    const t = await store.getTenant(ID);
    // Última migración del carril de la app (no fija: el carril crece)
    const appMigrations = loadMigrations(path.resolve(__dirname, "../db/migrations")).migrations;
    expect(t).toMatchObject({ status: "trial", baselineVersion: null, schemaVersion: appMigrations[appMigrations.length - 1].id });

    // El DSN registrado conecta con el usuario propio y solo ve su BD
    const dsn = (await svc.getActiveDsn(ID))!;
    const conn = await mysql.createConnection({ uri: dsn });
    try {
      const [u] = await conn.query<mysql.RowDataPacket[]>("SELECT email, role FROM users");
      expect(u).toEqual([{ email: "admin@prov-real.example", role: "admin" }]);
      const [s] = await conn.query<mysql.RowDataPacket[]>("SELECT value FROM system_settings WHERE `key` = 'brand_name'");
      expect(s[0].value).toBe("Prov Real");
      const [pg] = await conn.query<mysql.RowDataPacket[]>("SELECT slug, content FROM static_pages ORDER BY slug");
      expect(pg.map((p) => p.slug)).toEqual(expect.arrayContaining(["habitaciones", "inicio", "politica-de-privacidad"]));
      expect(pg.find((p) => p.slug === "inicio")!.content).toContain("Prov Real");
      const [mn] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM menu_items");
      expect(Number(mn[0].n)).toBeGreaterThan(3);
      // aislamiento de privilegios: no puede leer la BD del registro
      await expect(conn.query("SELECT * FROM registry_test.tenants")).rejects.toThrow();
    } finally {
      await conn.end();
    }

    // Resolución del subdominio de plataforma
    const resolved = await new TenantResolver(store).resolveHost(`${ID}.elephantsource.es`);
    expect(resolved.kind).toBe("resolved");

    const ent = await new EntitlementAdmin(admin).listEntitlements(ID);
    expect(ent.map((e) => e.moduleId)).toEqual(["hotel"]);
    expect(ent[0].validUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 86_400_000);
    expect(await new QuotaAdmin(admin).listQuotas(ID)).toHaveLength(1);
  }, 120_000);

  it("repetir el alta es idempotente", async () => {
    const r = await prov.run(
      { tenantId: ID, displayName: "Prov Real", adminEmail: "admin@prov-real.example", platformDomain: "elephantsource.es" },
      OP,
    );
    expect(r.status).toBe("completed");
    expect(await store.listDatabases(ID)).toHaveLength(1);
  });

  it("el estado del alta queda persistido y sin secretos", async () => {
    const [rows] = await admin.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_provisioning WHERE tenant_id = ?", [ID]);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/mysql:\/\//);
    expect(rows[0].status).toBe("completed");
  });
});
