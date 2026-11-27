/**
 * Restauración local aislada con MySQL real (opt-in) y almacenamiento de ficheros.
 *
 *   RESTORE_LOCAL_TEST_ADMIN_URL=mysql://root:…@127.0.0.1:33981/ pnpm vitest run server/restoreLocal.mysql.test.ts
 *
 * Las pruebas de rechazo (host, entorno, solo lectura) no necesitan MySQL y corren siempre.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import { backupKeyringFromEnv } from "./_core/ops/backupCrypto";
import { FsBackupStorage } from "./_core/ops/backupStorage";
import { MemoryBackupInventory } from "./_core/ops/backupInventory";
import { backupTarget } from "./_core/ops/backupJob";
import {
  assertIsolatedEnv,
  assertLocalMysqlUrl,
  listTenantCopies,
  readOnlyStorage,
  restoreTenantLocal,
  tenantOfManifestKey,
} from "./_core/ops/restoreLocal";

const ADMIN = process.env.RESTORE_LOCAL_TEST_ADMIN_URL;
const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

describe("rechazos sin MySQL", () => {
  it("rechaza hosts que no son locales", () => {
    for (const h of [
      "mysql://u:p@mysql.railway.internal:3306/x",
      "mysql://u:p@roundhouse.proxy.rlwy.net:1234/x",
      "mysql://u:p@monorail.rlwy.net:1234/x",
      "mysql://u:p@db.example.com:3306/x",
      "mysql://u:p@10.0.0.5:3306/x",
      "mysql://u:p@localhost.evil.com:3306/x",
      "mysql://u:p@127.0.0.1:3306/x?host=db.example.com",
    ]) {
      expect(() => assertLocalMysqlUrl(h), h).toThrow(/rechazado|no es válida/);
    }
  });
  it("acepta localhost, 127.0.0.1 y ::1", () => {
    for (const h of ["mysql://root:p@localhost:3306/", "mysql://root:p@127.0.0.1:3306/", "mysql://root:p@[::1]:3306/"]) {
      expect(() => assertLocalMysqlUrl(h), h).not.toThrow();
    }
  });
  it("falla si hay variables de production definidas", () => {
    expect(() => assertIsolatedEnv({ REGISTRY_ADMIN_DATABASE_URL: "mysql://x" } as NodeJS.ProcessEnv)).toThrow(/no aislado.*REGISTRY_ADMIN_DATABASE_URL/);
    expect(() => assertIsolatedEnv({ CRM_DATABASE_URL: "x" } as NodeJS.ProcessEnv)).toThrow(/CRM_DATABASE_URL/);
    expect(() => assertIsolatedEnv({ BACKUP_KEYS: "k:v", PATH: "/bin" } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it("el script falla con REGISTRY_ADMIN_DATABASE_URL definida, sin mostrar su valor", () => {
    const tsx = require.resolve("tsx/cli");
    let out = "";
    try {
      execFileSync(process.execPath, [tsx, path.resolve(__dirname, "../scripts/restoreTenantLocal.ts"), "--list", "acme"], {
        env: { ...process.env, REGISTRY_ADMIN_DATABASE_URL: "mysql://root:SECRETO-XYZ@prod.example:3306/x" },
        stdio: "pipe",
      });
      throw new Error("debía fallar");
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
      expect(err.status).toBe(1);
      out = String(err.stderr) + String(err.stdout);
    }
    expect(out).toMatch(/no aislado/);
    expect(out).not.toContain("SECRETO-XYZ");
  });
  it("la clave de manifiesto debe ser de una empresa", () => {
    expect(tenantOfManifestKey("tenants/acme/2026/11/20261127T100000Z-abcd1234.manifest.json")).toBe("acme");
    expect(() => tenantOfManifestKey("registry/registry/2026/11/x.manifest.json")).toThrow();
    expect(() => tenantOfManifestKey("tenants/../2026/11/x.manifest.json")).toThrow();
  });
});

describe.skipIf(!ADMIN)("restauración local con MySQL real", () => {
  const run = crypto.randomBytes(3).toString("hex");
  const T = `loc-${run}`;
  const SRC = `rl_src_${run}`;
  const DEST = `rl_dest_${run}`;
  const K1 = crypto.randomBytes(32).toString("base64");
  const ring = backupKeyringFromEnv({ BACKUP_KEYS: `k1:${K1}`, BACKUP_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  let work: string;
  let storeDir: string;
  let storage: FsBackupStorage;
  let manifestKey: string;
  const env = { BACKUP_KEYS: `k1:${K1}`, PATH: "/bin" } as NodeJS.ProcessEnv;
  let admin: mysql.Connection;

  const snapshot = () =>
    fs
      .readdirSync(storeDir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const f = path.join(e.parentPath ?? (e as unknown as { path: string }).path, e.name);
        return `${f}:${crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`;
      })
      .sort();

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "es-rl-test-"));
    storeDir = path.join(work, "store");
    storage = new FsBackupStorage(storeDir);
    admin = await mysql.createConnection({ uri: ADMIN! });
    await admin.query(`CREATE DATABASE \`${SRC}\``);
    const c = await mysql.createConnection({ uri: withDb(ADMIN!, SRC) });
    await c.query("CREATE TABLE probe (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(50) NOT NULL, n INT NOT NULL, doble INT GENERATED ALWAYS AS (n * 2) STORED)");
    for (let i = 1; i <= 7; i++) await c.query("INSERT INTO probe (v, n) VALUES (?, ?)", [`DATO-CONFIDENCIAL-${i} «ñ»`, i]);
    await c.end();
    const r = await backupTarget(
      { kind: "tenant", id: T, dsn: withDb(ADMIN!, SRC) },
      { storage, ring, inventory: new MemoryBackupInventory(), runId: crypto.randomUUID(), tmpDir: work, now: Date.now },
    );
    expect(r.status).toBe("ok");
    manifestKey = (await listTenantCopies(storage, T))[0].key;
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS \`${SRC}\``).catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS \`${DEST}\``).catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("simulación: verifica firma y SHA-256 sin crear la base, y sin escribir en el almacenamiento", async () => {
    const before = snapshot();
    const rep = await restoreTenantLocal({ storage, ring, env }, { manifestKey, adminUrl: ADMIN!, database: DEST, apply: false });
    expect(rep.simulacion).toBe(true);
    expect(rep.copia).toMatchObject({ tablas: 1, filas: 7, firmaYSha256: "ok" });
    const [dbs] = await admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [DEST]);
    expect(dbs.length).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("restaura en base nueva local, verifica filas y checksum, no imprime secretos ni datos", async () => {
    const before = snapshot();
    const rep = await restoreTenantLocal({ storage, ring, env }, { manifestKey, adminUrl: ADMIN!, database: DEST, apply: true });
    expect(rep.verificacion).toMatchObject({ ok: true, tablas: 1, filas: 7, problemas: [] });
    expect(rep.aislamiento.conexionBucleLocal).toBe(true);
    const text = JSON.stringify(rep);
    expect(text).not.toContain(K1);
    expect(text).not.toContain("DATO-CONFIDENCIAL");
    expect(text).not.toMatch(/mysql:\/\//);
    const c = await mysql.createConnection({ uri: withDb(ADMIN!, DEST) });
    const [r] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, SUM(doble) AS d FROM probe");
    await c.end();
    expect(Number(r[0].n)).toBe(7);
    expect(Number(r[0].d)).toBe(56);
    expect(snapshot()).toEqual(before);
  });

  it("no sobrescribe: una base existente se rechaza", async () => {
    await expect(restoreTenantLocal({ storage, ring, env }, { manifestKey, adminUrl: ADMIN!, database: DEST, apply: true })).rejects.toThrow(/ya existe/);
  });

  it("rechaza el host no local antes de leer nada", async () => {
    await expect(
      restoreTenantLocal({ storage, ring, env }, { manifestKey, adminUrl: "mysql://u:p@mysql.railway.internal:3306/", database: "rl_x", apply: true }),
    ).rejects.toThrow(/Railway/);
  });

  it("rechaza un manifiesto manipulado", async () => {
    const file = path.join(storeDir, ...manifestKey.split("/"));
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    m.tables.probe.rows = 999;
    const tampered = manifestKey.replace(".manifest.json", "-x.manifest.json");
    storage.putBuffer(tampered, Buffer.from(JSON.stringify(m)));
    await expect(restoreTenantLocal({ storage, ring, env }, { manifestKey: tampered, adminUrl: ADMIN!, database: `${DEST}_t`, apply: false })).rejects.toThrow();
    await expect(restoreTenantLocal({ storage, ring, env }, { manifestKey: tampered, adminUrl: ADMIN!, database: `${DEST}_t`, apply: true })).rejects.toThrow();
    const [dbs] = await admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [`${DEST}_t`]);
    expect(dbs.length).toBe(0);
  });

  it("rechaza una copia presentada como de otra empresa (AAD / destino)", async () => {
    const otherKey = manifestKey.replace(`tenants/${T}/`, `tenants/otra-${run}/`);
    const body = fs.readFileSync(path.join(storeDir, ...manifestKey.split("/")));
    await storage.putBuffer(otherKey, body);
    await expect(restoreTenantLocal({ storage, ring, env }, { manifestKey: otherKey, adminUrl: ADMIN!, database: `${DEST}_o`, apply: false })).rejects.toThrow();
  });

  it("el almacenamiento de solo lectura rechaza escrituras", async () => {
    const ro = readOnlyStorage(storage);
    await expect(Promise.resolve().then(() => ro.putBuffer("tenants/x/a", Buffer.from("x")))).rejects.toThrow(/solo lectura/);
    await expect(Promise.resolve().then(() => ro.delete(manifestKey))).rejects.toThrow(/solo lectura/);
  });
});
