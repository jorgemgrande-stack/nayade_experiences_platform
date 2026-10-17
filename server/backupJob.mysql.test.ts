/**
 * Copias por empresa con MySQL real (opt-in): trabajo completo (dos empresas, registro, CRM y
 * ficheros) sobre almacenamiento de ficheros, inventario, restauración individual en base nueva con
 * conmutación del registro, restauración del registro en base nueva, rechazo de copias alteradas y
 * empresas repartidas en dos servidores.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:…@127.0.0.1:3432/registry_test \
 *   BACKUP_TEST_SECOND_DATABASE_URL=mysql://root:…@127.0.0.1:3433/registry_test \   (opcional: segundo servidor)
 *     pnpm vitest run server/backupJob.mysql.test.ts
 *
 * Sin el segundo servidor, las dos empresas quedan en el mismo y se prueba todo lo demás.
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
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { ProvisioningService } from "./_core/provisioning/service";
import { MysqlProvisioningStore, MysqlSchemaApplier, MysqlTenantSeeder, databaseNameFor, userNameFor } from "./_core/provisioning/mysqlAdapters";
import { DatabaseServers, MultiServerDatabaseProvisioner, registryServerUsage } from "./_core/provisioning/servers";
import { EntitlementAdmin } from "./_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "./_core/erm/mysqlQuotas";
import { backupKeyringFromEnv, verifyManifest } from "./_core/ops/backupCrypto";
import { FsBackupStorage, FsMediaSource } from "./_core/ops/backupStorage";
import { MysqlBackupInventory } from "./_core/ops/backupInventory";
import { restoreTenantFiles, runBackupJob, type SignedBackupManifest } from "./_core/ops/backupJob";
import { restorePlatformDatabase, restoreTenant, restoredUserFor } from "./_core/ops/backupRestore";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { runAlerts } from "./_core/ops/alerts";

const URL_A = process.env.REGISTRY_TEST_DATABASE_URL;
const URL_B = process.env.BACKUP_TEST_SECOND_DATABASE_URL;
const OP: Actor = { type: "operator", id: "test" };

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

describe.skipIf(!URL_A)("copias por empresa con MySQL real", () => {
  const run = crypto.randomBytes(3).toString("hex");
  const A = `bka-${run}`;
  const B = `bkb-${run}`;
  const REG = `bkreg_${run}`;
  const REG_RESTORED = `bkreg_r_${run}`;
  const CRM = `bkcrm_${run}`;
  const twoServers = !!URL_B;
  const env = { BK_ADMIN_A: URL_A!, BK_ADMIN_B: URL_B ?? URL_A! } as NodeJS.ProcessEnv;

  let adminA: mysql.Pool;
  let adminB: mysql.Pool;
  let regPool: mysql.Pool;
  let store: MysqlTenantRegistryStore;
  let svc: TenantRegistryService;
  let servers: DatabaseServers;
  let inventory: MysqlBackupInventory;
  let storage: FsBackupStorage;
  let work: string;
  let mediaDir: string;
  const K1 = crypto.randomBytes(32).toString("base64");
  const ring = backupKeyringFromEnv({ BACKUP_KEYS: `k1:${K1}`, BACKUP_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  // Rotación: tras la copia, la clave activa pasa a k2 y k1 se conserva para descifrar lo anterior
  const rotated = backupKeyringFromEnv({ BACKUP_KEYS: `k1:${K1},k2:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "k2" } as NodeJS.ProcessEnv);

  const serverOf = async (pool: mysql.Pool, db: string) => {
    const [r] = await pool.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [db]);
    return r.length > 0;
  };
  const tenantConn = async (id: string) => mysql.createConnection({ uri: (await svc.getActiveDsn(id))! });
  const checksum = async (conn: mysql.Connection, table: string) => {
    const [r] = await conn.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${table}\``);
    return String(r[0].Checksum);
  };

  beforeAll(async () => {
    adminA = mysql.createPool({ uri: URL_A!, connectionLimit: 3 });
    adminB = mysql.createPool({ uri: URL_B ?? URL_A!, connectionLimit: 3 });
    work = fs.mkdtempSync(path.join(os.tmpdir(), "es-bkjob-"));
    mediaDir = path.join(work, "media");
    storage = new FsBackupStorage(path.join(work, "store"));

    // Registro propio y aislado, con todas sus migraciones (incluida 0010: inventario)
    await adminA.query(`CREATE DATABASE \`${REG}\``);
    regPool = mysql.createPool({ uri: withDb(URL_A!, REG), connectionLimit: 4, multipleStatements: true });
    const mig = await migrateRegistry(regPool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(mig.applied).toContain("0010");

    // CRM comercial sintético
    await adminA.query(`CREATE DATABASE \`${CRM}\``);
    const crm = await mysql.createConnection({ uri: withDb(URL_A!, CRM), multipleStatements: true });
    await crm.query(
      "CREATE TABLE crm_companies (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, tax_id VARCHAR(20)); " +
        "INSERT INTO crm_companies (name, tax_id) VALUES ('Empresa Uno', 'B00000001'), ('Empresa Dos', 'B00000002'), ('Empresa Tres', NULL);",
    );
    await crm.end();

    store = new MysqlTenantRegistryStore(regPool);
    const regRing = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    svc = new TenantRegistryService(store, () => regRing);
    inventory = new MysqlBackupInventory(regPool);

    const a = new URL(URL_A!);
    const b = new URL(URL_B ?? URL_A!);
    servers = new DatabaseServers(
      {
        servers: twoServers
          ? [
              { alias: "srv-a", host: a.hostname, port: Number(a.port || 3306), adminUrlEnv: "BK_ADMIN_A" },
              { alias: "srv-b", host: b.hostname, port: Number(b.port || 3306), adminUrlEnv: "BK_ADMIN_B" },
            ]
          : [{ alias: "srv-a", host: a.hostname, port: Number(a.port || 3306), adminUrlEnv: "BK_ADMIN_A" }],
        placement: "least_used",
      },
      env,
    );
    const migDir = fs.mkdtempSync(path.join(work, "mig-"));
    const prov = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new MultiServerDatabaseProvisioner(servers, { usage: () => registryServerUsage(regPool) }),
      schema: new MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: migDir }),
      seeder: new MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      store: new MysqlProvisioningStore(regPool),
    });
    for (const id of [A, B]) {
      const r = await prov.run({ tenantId: id, displayName: id, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.example" }, OP);
      expect(r.status).toBe("completed");
    }

    // Datos propios de cada empresa (con columna generada) y ficheros
    for (const [id, n] of [
      [A, 5],
      [B, 3],
    ] as const) {
      const c = await tenantConn(id);
      await c.query("CREATE TABLE bk_probe (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(50) NOT NULL, n INT NOT NULL, doble INT GENERATED ALWAYS AS (n * 2) STORED)");
      for (let i = 1; i <= n; i++) await c.query("INSERT INTO bk_probe (v, n) VALUES (?, ?)", [`${id} fila ${i} «ñ»`, i]);
      await c.end();
      fs.mkdirSync(path.join(mediaDir, "t", id, "img"), { recursive: true });
      fs.writeFileSync(path.join(mediaDir, "t", id, "img", "logo.png"), crypto.randomBytes(2048));
      fs.writeFileSync(path.join(mediaDir, "t", id, "contrato.pdf"), `pdf de ${id}`);
    }
    fs.mkdirSync(path.join(mediaDir, "t", "otra-empresa"), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "t", "otra-empresa", "x.txt"), "no se copia");
  }, 300_000);

  afterAll(async () => {
    for (const [pool, isB] of [
      [adminA, false],
      [adminB, true],
    ] as const) {
      if (!pool || (isB && !twoServers)) continue;
      const [dbs] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? OR SCHEMA_NAME LIKE ? OR SCHEMA_NAME IN (?, ?, ?, ?)",
        [`${databaseNameFor(A)}%`, `${databaseNameFor(B)}%`, REG, REG_RESTORED, CRM, `${CRM}_r`],
      );
      for (const r of dbs) {
        await pool.query(`DROP DATABASE IF EXISTS \`${r.n}\``).catch(() => undefined);
        if (/_r\d{14}$/.test(String(r.n))) await pool.query("DROP USER IF EXISTS ?@'%'", [restoredUserFor(String(r.n))]).catch(() => undefined);
      }
      for (const id of [A, B]) await pool.query("DROP USER IF EXISTS ?@'%'", [userNameFor(id)]).catch(() => undefined);
    }
    await servers?.end();
    await regPool?.end();
    await adminA?.end();
    if (adminB !== adminA) await adminB?.end();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("las empresas se reparten entre servidores (menos ocupado)", async () => {
    const a = await store.getActiveDatabase(A);
    const b = await store.getActiveDatabase(B);
    expect(a?.serverAlias).toBe("srv-a");
    expect(b?.serverAlias).toBe(twoServers ? "srv-b" : "srv-a");
    expect(await serverOf(adminA, databaseNameFor(A))).toBe(true);
    if (twoServers) {
      expect(await serverOf(adminB, databaseNameFor(B))).toBe(true);
      expect(await serverOf(adminA, databaseNameFor(B))).toBe(false);
    }
    expect(await registryServerUsage(regPool)).toEqual(twoServers ? { "srv-a": 1, "srv-b": 1 } : { "srv-a": 2 });
  });

  it("trabajo completo: cada empresa a su objeto, registro, CRM y ficheros; cifrado, verificado e inventariado", async () => {
    const rep = await runBackupJob({
      reader: store,
      tenantDsn: (id) => svc.getActiveDsn(id),
      registryDsn: withDb(URL_A!, REG),
      crmDsn: withDb(URL_A!, CRM),
      storage,
      ring,
      inventory,
      media: new FsMediaSource(mediaDir),
      tmpDir: work,
    });
    expect(rep.results.map((r) => `${r.kind}:${r.id}:${r.status}`)).toEqual([
      `tenant:${A}:ok`,
      `files:${A}:ok`,
      `tenant:${B}:ok`,
      `files:${B}:ok`,
      "registry:registry:ok",
      "crm:crm:ok",
    ]);
    expect(rep.ok).toBe(true);

    const rows = await inventory.list({ limit: 20 });
    expect(rows.every((r) => r.status === "ok" && r.keyId === "k1" && r.durationMs !== null && r.storageKind === "fs")).toBe(true);
    const ta = rows.find((r) => r.targetKind === "tenant" && r.targetId === A)!;
    const tb = rows.find((r) => r.targetKind === "tenant" && r.targetId === B)!;
    expect(ta).toMatchObject({ serverAlias: "srv-a", databaseName: databaseNameFor(A), schemaVersion: "0000_baseline" });
    expect(tb.serverAlias).toBe(twoServers ? "srv-b" : "srv-a");
    expect(ta.location).not.toBe(tb.location);
    expect(ta.location).toMatch(new RegExp(`^tenants/${A}/\\d{4}/\\d{2}/.+\\.sql\\.gz\\.enc$`));
    expect(ta.tablesCount).toBeGreaterThanOrEqual(150);

    // El objeto almacenado coincide con el inventario y no contiene SQL en claro
    const stored = fs.readFileSync(path.join(work, "store", ...ta.location!.split("/")));
    expect(crypto.createHash("sha256").update(stored).digest("hex")).toBe(ta.sha256);
    expect(stored.length).toBe(ta.bytes);
    expect(stored.subarray(0, 4).toString()).toBe("ESBK");
    const manifest = JSON.parse((await storage.getBuffer(ta.manifestKey!))!.toString()) as SignedBackupManifest;
    expect(verifyManifest(manifest, rotated).tables.bk_probe).toMatchObject({ rows: 5 });
    expect(manifest.triggers).toContain("reservations_set_public_token");

    // Ficheros: solo los de cada empresa; la segunda pasada es incremental
    const fa = rows.find((r) => r.targetKind === "files" && r.targetId === A)!;
    expect(fa).toMatchObject({ tablesCount: 2, rowsCount: 2 });
    const again = await runBackupJob({ reader: store, tenantDsn: (id) => svc.getActiveDsn(id), storage, ring, inventory, media: new FsMediaSource(mediaDir), tmpDir: work, only: [A], includePlatform: false });
    expect(again.results.find((r) => r.kind === "files")).toMatchObject({ status: "ok", bytes: 0 });

    // La alerta backup.stale queda satisfecha con el inventario
    const incidents = new IncidentService(new MemoryIncidentStore());
    const alerts = await runAlerts({ reader: store, incidents, lastBackupAt: () => inventory.lastSuccess("tenant") });
    expect(alerts.active.filter((k) => k.startsWith("backup.stale"))).toEqual([]);
    const later = await runAlerts({ reader: store, incidents, lastBackupAt: () => inventory.lastSuccess("tenant"), now: () => Date.now() + 3 * 86_400_000 });
    expect(later.active.filter((k) => k.startsWith("backup.stale")).sort()).toEqual([`backup.stale:${A}`, `backup.stale:${B}`]);
  }, 300_000);

  it("restauración individual de A: base nueva, verificada y conmutada; A recupera su estado y B no cambia", async () => {
    const bConn = await tenantConn(B);
    const bBefore = await checksum(bConn, "bk_probe");
    const bDsnBefore = await svc.getActiveDsn(B);
    await bConn.end();

    // Daño en A: borrado y modificación
    const aConn = await tenantConn(A);
    await aConn.query("DELETE FROM bk_probe WHERE id > 2");
    await aConn.query("UPDATE bk_probe SET v = 'ALTERADO'");
    await aConn.query("UPDATE users SET name = 'ALTERADO'");
    await aConn.end();
    const versionBefore = (await store.getTenant(A))!.registryVersion;
    const originalDb = databaseNameFor(A);

    // Rotación posterior a la copia: se restaura con el llavero nuevo (k1 sigue disponible)
    const rep = await restoreTenant(
      { storage, ring: rotated, inventory, servers, registry: svc, reader: store, tmpDir: work },
      { tenantId: A, switch: true, actor: OP },
    );
    expect(rep.verification).toMatchObject({ ok: true, problems: [] });
    expect(rep).toMatchObject({ switched: true, serverAlias: "srv-a" });
    expect(rep.database).toMatch(new RegExp(`^${originalDb}_r\\d{14}$`));
    expect(rep.backup.keyId).toBe("k1");
    expect(rep.registryVersion!).toBeGreaterThan(versionBefore);

    // El registro apunta a la base restaurada, con su usuario propio
    const dsn = (await svc.getActiveDsn(A))!;
    expect(new URL(dsn).pathname).toBe(`/${rep.database}`);
    expect(decodeURIComponent(new URL(dsn).username)).toBe(restoredUserFor(rep.database));
    const restored = await mysql.createConnection({ uri: dsn });
    const [probe] = await restored.query<mysql.RowDataPacket[]>("SELECT id, v, doble FROM bk_probe ORDER BY id");
    expect(probe.map((r) => r.v)).toEqual([1, 2, 3, 4, 5].map((i) => `${A} fila ${i} «ñ»`));
    expect(probe.map((r) => r.doble)).toEqual([2, 4, 6, 8, 10]);
    const [u] = await restored.query<mysql.RowDataPacket[]>("SELECT name FROM users");
    expect(u.every((r) => r.name !== "ALTERADO")).toBe(true);
    // El usuario propio no ve otras bases
    await expect(restored.query(`SELECT 1 FROM \`${originalDb}\`.bk_probe`)).rejects.toThrow();
    await restored.end();
    const [trg] = await adminA.query<mysql.RowDataPacket[]>("SELECT DEFINER AS d FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = 'reservations_set_public_token'", [rep.database]);
    expect(String(trg[0]?.d)).toBe(`${restoredUserFor(rep.database)}@%`);

    // La base original sigue intacta (con el daño) y retirada; B no cambia
    const [orig] = await adminA.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${originalDb}\`.bk_probe`);
    expect(Number(orig[0].n)).toBe(2);
    expect((await store.listDatabases(A)).map((d) => d.state).sort()).toEqual(["active", "retired"]);
    expect(await svc.getActiveDsn(B)).toBe(bDsnBefore);
    const bAfter = await tenantConn(B);
    expect(await checksum(bAfter, "bk_probe")).toBe(bBefore);
    await bAfter.end();
    const events = await store.listEvents(A, 10);
    expect(events.some((e) => e.action === "database.activated")).toBe(true);
  }, 300_000);

  it("B (en su servidor) se restaura en una base nueva sin conmutar: verificada y el registro no cambia", async () => {
    const before = (await store.getTenant(B))!.registryVersion;
    const dsnBefore = await svc.getActiveDsn(B);
    const rep = await restoreTenant({ storage, ring, inventory, servers, registry: svc, reader: store, tmpDir: work }, { tenantId: B, actor: OP });
    expect(rep).toMatchObject({ switched: false, serverAlias: twoServers ? "srv-b" : "srv-a", verification: { ok: true } });
    expect(await serverOf(twoServers ? adminB : adminA, rep.database)).toBe(true);
    if (twoServers) expect(await serverOf(adminA, rep.database)).toBe(false);
    expect((await store.getTenant(B))!.registryVersion).toBe(before);
    expect(await svc.getActiveDsn(B)).toBe(dsnBefore);
  }, 300_000);

  it("registro restaurado en una base nueva (sin el registro original: solo con el manifiesto)", async () => {
    const regCopy = (await inventory.list({ targetKind: "registry", status: "ok", limit: 1 }))[0];
    const rep = await restorePlatformDatabase(
      { storage, ring: rotated },
      { kind: "registry", manifestKey: regCopy.manifestKey!, adminUrl: URL_A!, database: REG_RESTORED, tmpDir: work },
    );
    expect(rep.verification).toMatchObject({ ok: true, problems: [] });
    const restoredPool = mysql.createPool({ uri: withDb(URL_A!, REG_RESTORED), connectionLimit: 1, multipleStatements: true });
    try {
      const [t] = await restoredPool.query<mysql.RowDataPacket[]>("SELECT id FROM tenants ORDER BY id");
      expect(t.map((r) => r.id)).toEqual([A, B]);
      // Integridad del registro restaurado (tablas y triggers de auditoría por versión): sin pendientes
      const plan = await migrateRegistry(restoredPool, path.resolve(__dirname, "../db/registry"));
      expect(plan).toMatchObject({ current: "0011", pending: [], incomplete: [] });
      await expect(restoredPool.query("DELETE FROM tenant_events")).rejects.toThrow(/solo anexado/);
    } finally {
      await restoredPool.end();
    }
    // Nunca sobre una base existente
    await expect(
      restorePlatformDatabase({ storage, ring }, { kind: "registry", manifestKey: regCopy.manifestKey!, adminUrl: URL_A!, database: REG_RESTORED, tmpDir: work }),
    ).rejects.toThrow(/ya existe/);
  }, 300_000);

  it("manifiesto u objeto alterados: se rechazan antes de crear nada", async () => {
    const crmCopy = (await inventory.list({ targetKind: "crm", status: "ok", limit: 1 }))[0];
    const original = (await storage.getBuffer(crmCopy.manifestKey!))!;
    const m = JSON.parse(original.toString());
    m.tables.crm_companies.rows = 99;
    await storage.putBuffer(crmCopy.manifestKey!, Buffer.from(JSON.stringify(m)));
    await expect(
      restorePlatformDatabase({ storage, ring, inventory }, { kind: "crm", adminUrl: URL_A!, database: `${CRM}_r`, tmpDir: work }),
    ).rejects.toThrow(/alterado/);
    expect(await serverOf(adminA, `${CRM}_r`)).toBe(false);

    await storage.putBuffer(crmCopy.manifestKey!, original);
    const objPath = path.join(work, "store", ...crmCopy.location!.split("/"));
    const obj = fs.readFileSync(objPath);
    obj[obj.length - 40] ^= 0xff;
    fs.writeFileSync(objPath, obj);
    await expect(
      restorePlatformDatabase({ storage, ring, inventory }, { kind: "crm", adminUrl: URL_A!, database: `${CRM}_r`, tmpDir: work }),
    ).rejects.toThrow(/SHA-256/);
    expect(await serverOf(adminA, `${CRM}_r`)).toBe(false);
  }, 120_000);

  it("ficheros de una empresa: se recuperan idénticos y solo los suyos", async () => {
    const out = path.join(work, "files-out");
    const r = await restoreTenantFiles({ storage, ring: rotated }, A, out);
    expect(r.files).toBe(2);
    expect(fs.readFileSync(path.join(out, "t", A, "contrato.pdf"), "utf8")).toBe(`pdf de ${A}`);
    expect(fs.readFileSync(path.join(out, "t", A, "img", "logo.png")).equals(fs.readFileSync(path.join(mediaDir, "t", A, "img", "logo.png")))).toBe(true);
    expect(fs.existsSync(path.join(out, "t", "otra-empresa"))).toBe(false);
    expect(fs.existsSync(path.join(out, "t", B))).toBe(false);
  });
});
