/**
 * Copias en dos ubicaciones independientes y recuperación total desde el destino EXTERNO, con MySQL
 * real (opt-in) y, si se indican, dos MinIO (uno simula el almacenamiento de Railway y otro el externo):
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:…@127.0.0.1:3454/registry_test \
 *   BACKUP_TEST_S3A_URL=http://usuario:clave@127.0.0.1:3455 \   (opcional: primario + medios en MinIO)
 *   BACKUP_TEST_S3B_URL=http://usuario:clave@127.0.0.1:3456 \   (opcional: secundario en otro MinIO)
 *   DR_TEST_NEW_SERVER_URL=mysql://root:…@127.0.0.1:3457/x \     (opcional: servidor MySQL nuevo distinto)
 *     pnpm vitest run server/backupExternal.mysql.test.ts
 *
 * Sin MinIO, ambos destinos son directorios (la lógica es la misma; las pruebas de credenciales
 * erróneas del proveedor S3 se omiten). Recorre: copia de A, B, registro, CRM y ficheros a ambos
 * destinos con verificación; secundario caído y con credenciales erróneas (el primario no se ve
 * afectado y salta la alerta); pérdida del primario y restauración de A desde el secundario (datos y
 * ficheros) con B intacta; objeto alterado y copia incompleta (fallo controlado sin crear nada);
 * retención independiente del secundario; y pérdida TOTAL (bases, usuarios, primario y medios) con
 * reconstrucción desde el secundario a bases nuevas y la aplicación real sirviendo de nuevo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import express from "express";
import mysql from "mysql2/promise";
import { CreateBucketCommand, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
import {
  FsBackupStorage,
  FsMediaSource,
  FsMediaTarget,
  S3BackupStorage,
  S3MediaSource,
  S3MediaTarget,
  type BackupStorage,
  type MediaTarget,
} from "./_core/ops/backupStorage";
import { MysqlBackupInventory } from "./_core/ops/backupInventory";
import { MysqlBackupCopyLedger } from "./_core/ops/backupCopies";
import { restoreTenantFiles, runBackupJob, type MediaSource, type SecondaryTarget } from "./_core/ops/backupJob";
import { latestManifestKey, restorePlatformDatabase, restoreTenant, restoredUserFor } from "./_core/ops/backupRestore";
import { applyBackupRetention, applyCopyRetention } from "./_core/ops/backupRetention";
import { buildRecoveryPackage, readRecoveryPackage } from "./_core/ops/recoveryPackage";
import { rebuildPlatform } from "./_core/ops/disasterRecovery";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { runAlerts } from "./_core/ops/alerts";

const URL_A = process.env.REGISTRY_TEST_DATABASE_URL;
const S3A = process.env.BACKUP_TEST_S3A_URL;
const S3B = process.env.BACKUP_TEST_S3B_URL;
const NEW_SERVER = process.env.DR_TEST_NEW_SERVER_URL;
const OP: Actor = { type: "operator", id: "prueba-dr" };

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

function s3Of(url: string) {
  const u = new URL(url);
  const cfg = { endpoint: `${u.protocol}//${u.host}`, region: "us-east-1", accessKeyId: decodeURIComponent(u.username), secretAccessKey: decodeURIComponent(u.password) };
  return { cfg, client: new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } }) };
}

async function ensureBucket(client: S3Client, bucket: string) {
  await client.send(new CreateBucketCommand({ Bucket: bucket })).catch((e: { name?: string }) => {
    if (e?.name !== "BucketAlreadyOwnedByYou" && e?.name !== "BucketAlreadyExists") throw e;
  });
}

async function emptyBucket(client: S3Client, bucket: string, prefix = "") {
  for (;;) {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const keys = (r.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (!keys.length) return;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
  }
}

describe.skipIf(!URL_A)("copias en dos ubicaciones y recuperación total desde el destino externo", () => {
  const run = crypto.randomBytes(3).toString("hex");
  const A = `dra-${run}`;
  const B = `drb-${run}`;
  const REG = `drreg_${run}`;
  const CRM = `drcrm_${run}`;
  const REG2 = `drreg2_${run}`;
  const CRM2 = `drcrm2_${run}`;
  const PASS = { [A]: `clave-A-${run}`, [B]: `clave-B-${run}` };
  const prefix = `dr-${run}/`;
  const NEW_URL = NEW_SERVER ?? URL_A!;

  // Claves que vivirían en la carpeta privada del propietario
  const BACKUP_KEYS = `bk1:${crypto.randomBytes(32).toString("base64")}`;
  const ring = backupKeyringFromEnv({ BACKUP_KEYS, BACKUP_ACTIVE_KEY_ID: "bk1" } as NodeJS.ProcessEnv);
  const REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;

  let admin: mysql.Pool;
  let regPool: mysql.Pool;
  let store: MysqlTenantRegistryStore;
  let svc: TenantRegistryService;
  let servers: DatabaseServers;
  let inventory: MysqlBackupInventory;
  let copies: MysqlBackupCopyLedger;
  let primary: BackupStorage;
  let secondary: BackupStorage;
  let media: MediaSource;
  let newMedia: MediaTarget;
  let readNewMedia: (key: string) => Promise<Buffer | null>;
  let wipePrimary: () => Promise<void>;
  let wipeMedia: () => Promise<void>;
  let secondaryRaw: { get: (k: string) => Promise<Buffer | null>; put: (k: string, b: Buffer) => Promise<void>; del: (k: string) => Promise<void> };
  let work: string;
  const original: Record<string, Buffer> = {};
  const measures: Record<string, unknown> = {};

  const tenantConn = async (id: string) => mysql.createConnection({ uri: (await svc.getActiveDsn(id))! });
  const checksum = async (c: mysql.Connection, t: string) => String(((await c.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${t}\``))[0] as mysql.RowDataPacket[])[0].Checksum);
  const dbExists = async (pool: mysql.Pool, db: string) => ((await pool.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [db]))[0] as unknown[]).length > 0;
  const countDbs = async (like: string) => Number(((await admin.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?", [like]))[0] as mysql.RowDataPacket[])[0].n);
  const secTarget = (storage: BackupStorage | null, timeoutMs = 20_000, reason?: string): SecondaryTarget => ({ storage, copies, timeoutMs, unavailableReason: reason });
  const job = (extra: Partial<Parameters<typeof runBackupJob>[0]> = {}) =>
    runBackupJob({
      reader: store,
      tenantDsn: (id) => svc.getActiveDsn(id),
      registryDsn: withDb(URL_A!, REG),
      crmDsn: withDb(URL_A!, CRM),
      storage: primary,
      ring,
      inventory,
      media,
      copies,
      tmpDir: work,
      ...extra,
    });

  beforeAll(async () => {
    process.env.REGISTRY_KEYS = REGISTRY_KEYS;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    admin = mysql.createPool({ uri: URL_A!, connectionLimit: 4, multipleStatements: true });
    work = fs.mkdtempSync(path.join(os.tmpdir(), "es-dr-"));

    // Destinos: MinIO si se indican; si no, directorios
    if (S3A && S3B) {
      const a = s3Of(S3A);
      const b = s3Of(S3B);
      await ensureBucket(a.client, "backups");
      await ensureBucket(a.client, "media");
      await ensureBucket(a.client, "media-nueva");
      await ensureBucket(b.client, "external");
      primary = new S3BackupStorage({ ...a.cfg, bucket: "backups", prefix });
      secondary = new S3BackupStorage({ ...b.cfg, bucket: "external", prefix });
      media = new S3MediaSource({ ...a.cfg, bucket: "media" });
      newMedia = new S3MediaTarget({ ...a.cfg, bucket: "media-nueva" });
      readNewMedia = async (k) => (await new S3BackupStorage({ ...a.cfg, bucket: "media-nueva" }).getBuffer(k));
      wipePrimary = () => emptyBucket(a.client, "backups", prefix);
      wipeMedia = async () => {
        for (const id of [A, B]) await emptyBucket(a.client, "media", `t/${id}/`);
      };
      const raw = new S3BackupStorage({ ...b.cfg, bucket: "external", prefix });
      secondaryRaw = { get: (k) => raw.getBuffer(k), put: (k, x) => raw.putBuffer(k, x), del: (k) => raw.delete(k) };
      for (const id of [A, B]) {
        await a.client.send(new PutObjectCommand({ Bucket: "media", Key: `t/${id}/img/logo.png`, Body: crypto.randomBytes(4096) }));
        await a.client.send(new PutObjectCommand({ Bucket: "media", Key: `t/${id}/contrato.pdf`, Body: `pdf de ${id}` }));
      }
      const srcA = new S3BackupStorage({ ...a.cfg, bucket: "media" });
      for (const id of [A, B]) for (const k of [`t/${id}/img/logo.png`, `t/${id}/contrato.pdf`]) original[k] = (await srcA.getBuffer(k))!;
    } else {
      const pDir = path.join(work, "primario");
      const sDir = path.join(work, "externo");
      const mDir = path.join(work, "medios");
      const nDir = path.join(work, "medios-nuevos");
      primary = new FsBackupStorage(pDir);
      secondary = new FsBackupStorage(sDir);
      media = new FsMediaSource(mDir);
      newMedia = new FsMediaTarget(nDir);
      readNewMedia = async (k) => new FsBackupStorage(nDir).getBuffer(k);
      wipePrimary = async () => fs.rmSync(pDir, { recursive: true, force: true });
      wipeMedia = async () => fs.rmSync(mDir, { recursive: true, force: true });
      const raw = new FsBackupStorage(sDir);
      secondaryRaw = { get: (k) => raw.getBuffer(k), put: (k, x) => raw.putBuffer(k, x), del: (k) => raw.delete(k) };
      for (const id of [A, B]) {
        fs.mkdirSync(path.join(mDir, "t", id, "img"), { recursive: true });
        original[`t/${id}/img/logo.png`] = crypto.randomBytes(4096);
        original[`t/${id}/contrato.pdf`] = Buffer.from(`pdf de ${id}`);
        fs.writeFileSync(path.join(mDir, "t", id, "img", "logo.png"), original[`t/${id}/img/logo.png`]);
        fs.writeFileSync(path.join(mDir, "t", id, "contrato.pdf"), original[`t/${id}/contrato.pdf`]);
      }
    }

    // Registro con todas sus migraciones (incluida 0011) y CRM sintético
    await admin.query(`CREATE DATABASE \`${REG}\``);
    regPool = mysql.createPool({ uri: withDb(URL_A!, REG), connectionLimit: 4, multipleStatements: true });
    const mig = await migrateRegistry(regPool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(mig.applied).toContain("0011");
    await admin.query(`CREATE DATABASE \`${CRM}\``);
    const crm = await mysql.createConnection({ uri: withDb(URL_A!, CRM), multipleStatements: true });
    await crm.query("CREATE TABLE crm_companies (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL); INSERT INTO crm_companies (name) VALUES ('Empresa Uno'), ('Empresa Dos');");
    await crm.end();

    store = new MysqlTenantRegistryStore(regPool);
    svc = new TenantRegistryService(store, () => keyringFromEnv(process.env));
    inventory = new MysqlBackupInventory(regPool);
    copies = new MysqlBackupCopyLedger(regPool);
    expect(await copies.ready()).toBe(true);

    const a = new URL(URL_A!);
    servers = new DatabaseServers({ servers: [{ alias: "srv-a", host: a.hostname, port: Number(a.port || 3306), adminUrlEnv: "DR_ADMIN_A" }], placement: "least_used" }, { DR_ADMIN_A: URL_A! } as NodeJS.ProcessEnv);
    const prov = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new MultiServerDatabaseProvisioner(servers, { usage: () => registryServerUsage(regPool) }),
      schema: new MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
      seeder: new MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      store: new MysqlProvisioningStore(regPool),
    });
    for (const [id, n] of [
      [A, 5],
      [B, 3],
    ] as const) {
      const r = await prov.run({ tenantId: id, displayName: `Empresa ${id}`, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.example" }, OP);
      expect(r.status).toBe("completed");
      const c = await tenantConn(id);
      await c.query("CREATE TABLE dr_probe (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(50) NOT NULL)");
      for (let i = 1; i <= n; i++) await c.query("INSERT INTO dr_probe (v) VALUES (?)", [`${id} fila ${i}`]);
      await c.query("INSERT INTO categories (slug, name, isActive) VALUES (?, ?, 1)", [`cat-${id}`, `Categoría de ${id}`]);
      await c.query("UPDATE users SET passwordHash = ? WHERE email = ?", [await bcrypt.hash(PASS[id], 4), `admin@${id}.example`]);
      await c.end();
    }
  }, 600_000);

  afterAll(async () => {
    const extra = NEW_SERVER ? mysql.createPool({ uri: NEW_SERVER, connectionLimit: 2 }) : null;
    for (const pool of extra ? [admin, extra] : [admin]) {
      const [dbs] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? OR SCHEMA_NAME LIKE ? OR SCHEMA_NAME IN (?, ?, ?, ?)",
        [`${databaseNameFor(A)}%`, `${databaseNameFor(B)}%`, REG, CRM, REG2, CRM2],
      );
      for (const r of dbs) {
        await pool.query(`DROP DATABASE IF EXISTS \`${r.n}\``).catch(() => undefined);
        if (/_r\d{14}$/.test(String(r.n))) await pool.query("DROP USER IF EXISTS ?@'%'", [restoredUserFor(String(r.n))]).catch(() => undefined);
      }
    }
    await extra?.end();
    for (const id of [A, B]) await admin.query("DROP USER IF EXISTS ?@'%'", [userNameFor(id)]).catch(() => undefined);
    await servers?.end();
    await regPool?.end().catch(() => undefined);
    await admin?.end();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("cada copia (A, B, ficheros, registro, CRM y paquete de recuperación) queda en ambos destinos, verificada", async () => {
    const t0 = Date.now();
    const rep = await job({
      secondary: secTarget(secondary),
      recovery: (_r, runId) =>
        buildRecoveryPackage({
          runId,
          now: Date.now(),
          env: { ...process.env, BACKUP_KEYS, REGISTRY_ADMIN_DATABASE_URL: withDb(URL_A!, REG), PROVISIONING_DB_ADMIN_URL: URL_A! },
          reader: store,
          registry: { database: REG, schemaVersion: "0011" },
          crm: { configured: true, database: CRM },
          destinations: { primary, secondary },
          ring,
          retention: { primary: { daily: 30, weekly: 12, monthly: 12 }, secondary: { daily: 30, weekly: 12, monthly: 12 } },
          latest: async (dest, id) => {
            const r = dest === "primary" ? (await inventory.list({ targetKind: "tenant", targetId: id, status: "ok", limit: 1 }))[0] : (await copies.list({ destination: "secondary", targetKind: "tenant", targetId: id, status: "ok", limit: 1 }))[0];
            return r ? { manifestKey: r.manifestKey, createdAt: r.finishedAt } : null;
          },
        }),
    });
    measures.firstRunMs = Date.now() - t0;
    measures.firstRunBytes = rep.metrics.bytes;
    expect(rep.results.map((r) => `${r.kind}:${r.id}:${r.status}:${r.secondary?.status}`)).toEqual([
      `tenant:${A}:ok:ok`,
      `files:${A}:ok:ok`,
      `tenant:${B}:ok:ok`,
      `files:${B}:ok:ok`,
      "registry:registry:ok:ok",
      "crm:crm:ok:ok",
      "config:recovery:ok:ok",
    ]);
    expect(rep.ok).toBe(true);
    expect(rep.secondary).toMatchObject({ ok: true, failed: 0, copied: 7 });

    // Mismo objeto (SHA-256) en ambos destinos y estado por destino en el inventario
    const ta = (await inventory.list({ targetKind: "tenant", targetId: A, limit: 1 }))[0];
    const ca = (await copies.list({ destination: "secondary", targetKind: "tenant", targetId: A, limit: 1 }))[0];
    expect(ca).toMatchObject({ backupId: ta.id, status: "ok", location: ta.location, manifestKey: ta.manifestKey, sha256: ta.sha256, bytes: ta.bytes });
    expect((await secondary.hash(ta.location!)).sha256).toBe(ta.sha256);
    expect((await secondary.getBuffer(ta.manifestKey!))!.equals((await primary.getBuffer(ta.manifestKey!))!)).toBe(true);
    expect(ca.storage).not.toMatch(/minio_ci|clave|secret/i);

    // Paquete de recuperación en el externo: sin secretos, con empresas y ubicación de sus copias
    const pkg = (await readRecoveryPackage(secondary, ring))!;
    const text = JSON.stringify(pkg);
    for (const secret of [BACKUP_KEYS.split(":")[1], REGISTRY_KEYS.split(":")[1], new URL(URL_A!).password]) expect(text).not.toContain(secret);
    expect(pkg.tenants.map((t) => t.id)).toEqual([A, B]);
    expect(pkg.tenants[0].latest.secondary?.manifestKey).toBe(ta.manifestKey);
    expect(pkg.databases.servers).toEqual([{ alias: new URL(URL_A!).hostname, host: new URL(URL_A!).hostname, port: Number(new URL(URL_A!).port || 3306), adminUrlEnv: "PROVISIONING_DB_ADMIN_URL" }]);
    expect(pkg.services.map((s) => s.service)).toContain("backup-job");
    expect(pkg.backupJobEnvironment.BACKUP_KEYS).toBe(true);
  }, 300_000);

  it("secundario caído o con credenciales erróneas: el primario se copia igual; fallo registrado y alerta", async () => {
    const down = new S3BackupStorage({ bucket: "x", region: "us-east-1", endpoint: "http://127.0.0.1:1", accessKeyId: "nadie", secretAccessKey: "nada" }); // gitleaks:allow
    const t0 = Date.now();
    const rep = await job({ only: [B], includePlatform: false, secondary: secTarget(down, 15_000) });
    measures.secondaryDownMs = Date.now() - t0;
    expect(rep.ok).toBe(true);
    expect(rep.results.map((r) => `${r.kind}:${r.status}:${r.secondary?.status}`)).toEqual(["tenant:ok:failed", "files:ok:failed"]);
    expect(rep.secondary).toMatchObject({ ok: false, failed: 2 });
    const bInv = (await inventory.list({ targetKind: "tenant", targetId: B, limit: 1 }))[0];
    expect(bInv.status).toBe("ok");
    expect((await primary.hash(bInv.location!)).sha256).toBe(bInv.sha256);

    if (S3B) {
      const b = s3Of(S3B);
      const wrong = new S3BackupStorage({ ...b.cfg, secretAccessKey: "clave-incorrecta-000", bucket: "external", prefix }); // gitleaks:allow
      const r2 = await job({ only: [B], includePlatform: false, secondary: secTarget(wrong) });
      expect(r2.ok).toBe(true);
      expect(r2.results[0].secondary?.status).toBe("failed");
      expect(r2.results[0].secondary?.error).not.toContain("clave-incorrecta");
    }
    // Configuración incompleta: fallo del secundario sin intentar nada
    const r3 = await job({ only: [B], includePlatform: false, media: undefined, secondary: secTarget(null, 1000, "Destino secundario mal configurado: Faltan BACKUP_SECONDARY_S3_BUCKET") });
    expect(r3.ok).toBe(true);
    expect(r3.results[0].secondary).toMatchObject({ status: "failed", error: expect.stringContaining("BACKUP_SECONDARY_S3_BUCKET") });

    const incidents = new IncidentService(new MemoryIncidentStore());
    const alerts = await runAlerts({
      reader: store,
      incidents,
      lastBackupAt: () => inventory.lastSuccess("tenant"),
      secondaryBackups: { lastSuccessAt: () => copies.lastSuccess("secondary", "tenant"), latestAttempts: () => copies.latestAttempts("secondary") },
    });
    expect(alerts.active).toContain(`backup.secondary_failed:tenant:${B}`);
    expect(alerts.active.filter((k) => k.startsWith("backup.stale"))).toEqual([]);
    // Retraso: dentro de 3 días ambas empresas están sin copia reciente en el secundario
    const later = await runAlerts({
      reader: store,
      incidents,
      lastBackupAt: async () => ({ [A]: Date.now() + 3 * 86_400_000, [B]: Date.now() + 3 * 86_400_000 }),
      now: () => Date.now() + 3 * 86_400_000,
      secondaryBackups: { lastSuccessAt: () => copies.lastSuccess("secondary", "tenant"), latestAttempts: () => copies.latestAttempts("secondary"), maxAgeMs: 3_600_000 },
    });
    expect(later.active).toEqual(expect.arrayContaining([`backup.secondary_stale:${A}`, `backup.secondary_stale:${B}`]));

    // Se recupera: una ejecución correcta cierra el fallo
    const ok = await job({ only: [B], includePlatform: false, secondary: secTarget(secondary) });
    expect(ok.secondary).toMatchObject({ ok: true });
    const again = await runAlerts({ reader: store, incidents, secondaryBackups: { lastSuccessAt: () => copies.lastSuccess("secondary", "tenant"), latestAttempts: () => copies.latestAttempts("secondary") } });
    expect(again.active.filter((k) => k.startsWith("backup.secondary_failed"))).toEqual([]);
  }, 300_000);

  it("pérdida del primario: A se restaura desde el secundario (datos y ficheros), con registro de la operación; B intacta", async () => {
    const bConn = await tenantConn(B);
    const bBefore = await checksum(bConn, "dr_probe");
    const bDsn = await svc.getActiveDsn(B);
    await bConn.end();
    const aConn = await tenantConn(A);
    await aConn.query("DELETE FROM dr_probe WHERE id > 1");
    await aConn.end();

    await wipePrimary();
    expect(await primary.list("tenants/")).toEqual([]);
    // Desde el primario ya no se puede
    await expect(restoreTenant({ storage: primary, ring, inventory, copies, servers, registry: svc, reader: store, tmpDir: work }, { tenantId: A, actor: OP })).rejects.toThrow();

    const t0 = Date.now();
    const rep = await restoreTenant(
      { storage: secondary, ring, inventory, copies, servers, registry: svc, reader: store, tmpDir: work },
      { tenantId: A, source: "secondary", switch: true, actor: OP },
    );
    measures.restoreTenantFromSecondaryMs = Date.now() - t0;
    expect(rep).toMatchObject({ source: "secondary", switched: true, verification: { ok: true, problems: [] } });
    const c = await tenantConn(A);
    const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT v FROM dr_probe ORDER BY id");
    expect(rows.map((r) => r.v)).toEqual([1, 2, 3, 4, 5].map((i) => `${A} fila ${i}`));
    await c.end();

    const out = path.join(work, "ficheros-A");
    const f = await restoreTenantFiles({ storage: secondary, ring, copies, source: "secondary", actor: "operator:prueba-dr" }, A, out);
    expect(f).toMatchObject({ files: 2, source: "secondary" });
    expect(fs.readFileSync(path.join(out, "t", A, "img", "logo.png")).equals(original[`t/${A}/img/logo.png`])).toBe(true);
    expect(fs.existsSync(path.join(out, "t", B))).toBe(false);

    // B no cambia
    expect(await svc.getActiveDsn(B)).toBe(bDsn);
    const b2 = await tenantConn(B);
    expect(await checksum(b2, "dr_probe")).toBe(bBefore);
    await b2.end();

    const log = await copies.listRestores(10);
    expect(log.find((r) => r.targetKind === "tenant" && r.targetId === A && r.status === "ok")).toMatchObject({ source: "secondary", verified: true, switched: true, databaseName: rep.database });
    expect(log.find((r) => r.targetKind === "files" && r.targetId === A)).toMatchObject({ status: "ok", filesCount: 2 });
  }, 300_000);

  it("copia alterada o incompleta en el secundario: fallo controlado, sin crear base y con constancia", async () => {
    const latest = (await copies.list({ destination: "secondary", targetKind: "crm", targetId: "crm", status: "ok", limit: 1 }))[0];
    const obj = (await secondaryRaw.get(latest.location!))!;
    const bad = Buffer.from(obj);
    bad[bad.length - 30] ^= 0xff;
    await secondaryRaw.put(latest.location!, bad);
    const target = `${CRM}_alt`;
    await expect(restorePlatformDatabase({ storage: secondary, ring, inventory, copies }, { kind: "crm", source: "secondary", adminUrl: URL_A!, database: target, tmpDir: work })).rejects.toThrow(/SHA-256/);
    expect(await dbExists(admin, target)).toBe(false);

    await secondaryRaw.del(latest.location!);
    await expect(restorePlatformDatabase({ storage: secondary, ring, inventory, copies }, { kind: "crm", source: "secondary", adminUrl: URL_A!, database: target, tmpDir: work })).rejects.toThrow(/no existe/);
    expect(await dbExists(admin, target)).toBe(false);
    // Manifiesto alterado
    await secondaryRaw.put(latest.location!, obj);
    const man = (await secondaryRaw.get(latest.manifestKey!))!;
    const m = JSON.parse(man.toString());
    m.tables.crm_companies.rows = 1;
    await secondaryRaw.put(latest.manifestKey!, Buffer.from(JSON.stringify(m)));
    await expect(restorePlatformDatabase({ storage: secondary, ring, inventory, copies }, { kind: "crm", source: "secondary", adminUrl: URL_A!, database: target, tmpDir: work })).rejects.toThrow(/alterado/);
    await secondaryRaw.put(latest.manifestKey!, man);
    // Clave de copias equivocada (no la de la carpeta privada)
    const otherRing = backupKeyringFromEnv({ BACKUP_KEYS: `bk1:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "bk1" } as NodeJS.ProcessEnv);
    await expect(restorePlatformDatabase({ storage: secondary, ring: otherRing, inventory, copies }, { kind: "crm", source: "secondary", adminUrl: URL_A!, database: target, tmpDir: work })).rejects.toThrow(/alterado|firma/);
    expect(await dbExists(admin, target)).toBe(false);
    const failed = (await copies.listRestores(10)).filter((r) => r.targetKind === "crm" && r.status === "failed");
    expect(failed.length).toBeGreaterThanOrEqual(4);

    // Restaurada la copia buena, vuelve a funcionar
    const ok = await restorePlatformDatabase({ storage: secondary, ring, inventory, copies }, { kind: "crm", source: "secondary", adminUrl: URL_A!, database: target, tmpDir: work });
    expect(ok.verification.ok).toBe(true);
    await admin.query(`DROP DATABASE \`${target}\``);
  }, 300_000);

  it("retención independiente por destino: simulación primero; el primario podado no afecta al secundario", async () => {
    // Dos copias más de A para tener candidatos en el mismo día (política mínima de prueba)
    for (let i = 0; i < 2; i++) await job({ only: [A], includePlatform: false, media: undefined, secondary: secTarget(secondary) });
    const policy = { daily: 1, weekly: 0, monthly: 0 };
    const before = (await copies.list({ destination: "secondary", targetKind: "tenant", targetId: A, status: "ok", limit: 50 })).length;
    const sim = await applyCopyRetention({ copies, storage: secondary, destination: "secondary" }, { policy });
    expect(sim.applied).toBe(false);
    expect(sim.toDelete.length).toBeGreaterThan(0);
    expect((await copies.list({ destination: "secondary", targetKind: "tenant", targetId: A, status: "ok", limit: 50 })).length).toBe(before);

    // Retención del primario: no toca el secundario
    const pr = await applyBackupRetention({ inventory, storage: primary }, { apply: true, policy });
    expect(pr.deleted).toBeGreaterThan(0);
    expect((await copies.list({ destination: "secondary", targetKind: "tenant", targetId: A, status: "ok", limit: 50 })).length).toBe(before);
    // Una copia ya podada en el primario sigue restaurándose desde el secundario
    const prunedHere = (await inventory.list({ targetKind: "tenant", targetId: A, status: "pruned", limit: 50 }))[0];
    expect(prunedHere).toBeTruthy();
    const fromSec = await restoreTenant({ storage: secondary, ring, inventory, copies, servers, registry: svc, reader: store, tmpDir: work }, { tenantId: A, backupId: prunedHere.id, source: "secondary", actor: OP });
    expect(fromSec).toMatchObject({ switched: false, verification: { ok: true }, backup: { inventoryId: prunedHere.id } });
    await expect(restoreTenant({ storage: primary, ring, inventory, copies, servers, registry: svc, reader: store, tmpDir: work }, { tenantId: A, backupId: prunedHere.id, actor: OP })).rejects.toThrow(/no es válida/);

    // Aplicada en el secundario: conserva la más reciente de cada destino (verificada antes de borrar)
    const ap = await applyCopyRetention({ copies, storage: secondary, destination: "secondary" }, { apply: true, policy });
    expect(ap.skipped).toEqual([]);
    expect(ap.deleted).toBe(sim.toDelete.length);
    const left = await copies.list({ destination: "secondary", targetKind: "tenant", targetId: A, status: "ok", limit: 50 });
    expect(left.length).toBe(1);
    expect((await secondary.hash(left[0].location!)).sha256).toBe(left[0].sha256);
    for (const v of sim.toDelete) if (v.location) expect(await secondary.getBuffer(v.location)).toBeNull();
  }, 300_000);

  it("pérdida TOTAL: se reconstruye registro + CRM + 2 empresas + ficheros desde el externo y la aplicación sirve", async () => {
    // Copia completa y actual en ambos destinos (tras la restauración de A)
    const pre = await job({ secondary: secTarget(secondary) });
    expect(pre.ok && pre.secondary?.ok).toBe(true);
    const lastCopyAt = Date.now();

    // «Pierdo» todo: bases (registro, CRM, empresas), usuarios, almacenamiento primario y medios
    const tLoss = Date.now();
    await regPool.end();
    const [dbs] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? OR SCHEMA_NAME LIKE ? OR SCHEMA_NAME IN (?, ?)",
      [`${databaseNameFor(A)}%`, `${databaseNameFor(B)}%`, REG, CRM],
    );
    // Solo los usuarios de ESTA prueba (los de las bases restauradas y los del alta)
    const users = [userNameFor(A), userNameFor(B), ...dbs.map((r) => String(r.n)).filter((n) => /_r\d{14}$/.test(n)).map(restoredUserFor)];
    for (const r of dbs) await admin.query(`DROP DATABASE \`${r.n}\``);
    for (const u of users) await admin.query("DROP USER IF EXISTS ?@'%'", [u]);
    await wipePrimary();
    await wipeMedia();
    expect(await countDbs(`${databaseNameFor(A)}%`)).toBe(0);

    // Detección simulada: el registro no responde y el primario está vacío
    const tDetect = Date.now();
    await expect(mysql.createConnection({ uri: withDb(URL_A!, REG) })).rejects.toThrow();
    expect(await primary.list("")).toEqual([]);
    const detectMs = Date.now() - tDetect;

    // Reconstrucción desde el externo a un servidor «nuevo», con solo las claves de la carpeta privada
    const n = new URL(NEW_URL);
    const newServers = new DatabaseServers({ servers: [{ alias: "srv-nuevo", host: n.hostname, port: Number(n.port || 3306), adminUrlEnv: "DR_NEW_ADMIN" }], placement: "least_used" }, { DR_NEW_ADMIN: NEW_URL } as NodeJS.ProcessEnv);
    const rep = await rebuildPlatform({
      storage: secondary,
      source: "secondary",
      ring: backupKeyringFromEnv({ BACKUP_KEYS, BACKUP_ACTIVE_KEY_ID: "bk1" } as NodeJS.ProcessEnv),
      registryRing: () => keyringFromEnv({ REGISTRY_KEYS, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv),
      adminUrl: NEW_URL,
      registryDatabase: REG2,
      crmDatabase: CRM2,
      servers: newServers,
      serverAlias: "srv-nuevo",
      media: newMedia,
      registryMigrationsDir: path.resolve(__dirname, "../db/registry"),
      actor: OP,
      tmpDir: work,
    });
    await newServers.end();
    expect(rep.phases.filter((p) => !p.ok)).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.tenants.map((t) => `${t.id}:${t.ok}:${t.files}`)).toEqual([`${A}:true:2`, `${B}:true:2`]);
    expect(rep.recoveryPackage?.tenants).toBe(2);

    // Ficheros en el bucket de medios nuevo, idénticos y por empresa
    for (const [k, v] of Object.entries(original)) expect((await readNewMedia(k))!.equals(v)).toBe(true);

    // Datos: A con sus 5 filas (estado restaurado antes de la última copia), B con sus 3; CRM íntegro
    const newAdmin = mysql.createPool({ uri: NEW_URL, connectionLimit: 2 });
    const [crmRows] = await newAdmin.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${CRM2}\`.crm_companies`);
    expect(Number(crmRows[0].n)).toBe(2);
    const reg2 = mysql.createPool({ uri: withDb(NEW_URL, REG2), connectionLimit: 2 });
    const store2 = new MysqlTenantRegistryStore(reg2);
    const svc2 = new TenantRegistryService(store2, () => keyringFromEnv({ REGISTRY_KEYS, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv));
    for (const [id, n2] of [
      [A, 5],
      [B, 3],
    ] as const) {
      const c = await mysql.createConnection({ uri: (await svc2.getActiveDsn(id))! });
      const [r] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM dr_probe");
      expect(Number(r[0].n)).toBe(n2);
      await c.end();
    }
    const restores = await new MysqlBackupCopyLedger(reg2).listRestores(50);
    expect(restores.filter((r) => r.startedAt >= tLoss && r.status === "ok").map((r) => r.targetKind).sort()).toEqual(["crm", "files", "files", "registry", "tenant", "tenant"]);
    await reg2.end();
    await newAdmin.end();

    // La aplicación real arranca contra el registro reconstruido y sirve a cada empresa por su host
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = withDb(NEW_URL, REG2);
    process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
    process.env.JWT_SECRET = "jwt-secret-de-prueba-" + run;
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
    const tApp = Date.now();
    const { createTenantRuntime } = await import("./_core/tenantRegistry/runtime");
    const { resolveTenantMiddleware, bindTenantMiddleware } = await import("./_core/tenantRegistry/tenantMiddleware");
    const { createLocalAuthRouter } = await import("./localAuth");
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const { appRouter } = await import("./routers");
    const { createLocalContext } = await import("./_core/context.local");
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    const { configureModuleAccess, getModuleAccess } = await import("./_core/modules/runtime");
    const { registerBuiltinModules } = await import("./_core/modules/builtin");
    const { moduleRouteGuard } = await import("./_core/modules/routeGuard");
    const rt = createTenantRuntime(process.env, { pollMs: 3_600_000 })!;
    registerBuiltinModules();
    configureModuleAccess(rt.entitlements);
    const app = express();
    app.use(resolveTenantMiddleware(rt.resolver, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    app.use(createLocalAuthRouter());
    app.use("/api/trpc", moduleRouteGuard(getModuleAccess));
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: createLocalContext }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (host: string, method: string, p: string, body?: unknown) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => {
            let json: any = null;
            try {
              json = JSON.parse(b);
            } catch {
              /* texto */
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
      });
    try {
      for (const id of [A, B]) {
        const host = `${id}.elephantsource.example`;
        const cats = await call(host, "GET", "/api/trpc/public.getCategories");
        expect(cats.status).toBe(200);
        expect((cats.json.result.data.json as any[]).map((c) => c.slug)).toEqual([`cat-${id}`]);
        const login = await call(host, "POST", "/api/auth/login", { email: `admin@${id}.example`, password: PASS[id] });
        expect(login.status).toBe(200);
      }
      expect((await call(`${A}.elephantsource.example`, "POST", "/api/auth/login", { email: `admin@${B}.example`, password: PASS[B] })).status).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await closeAllDatabases();
      await rt.close();
      delete process.env.TENANT_MODE;
    }
    const appMs = Date.now() - tApp;

    measures.rebuild = {
      detectSimulatedMs: detectMs,
      rebuildMs: rep.totalMs,
      phases: rep.phases.map((p) => `${p.phase}: ${p.ms} ms`),
      appStartAndVerifyMs: appMs,
      lossToServingMs: Date.now() - tLoss,
      lastValidCopyAgeAtLossMs: tLoss - lastCopyAt,
      copies: rep.copies,
      bytesLastRun: pre.metrics.bytes,
      lastRunMs: pre.metrics.durationMs,
    };
    console.log(JSON.stringify({ ctx: "medidas-dr", storage: S3A ? "minio" : "fs", newServer: !!NEW_SERVER, ...measures }));
  }, 600_000);
});
