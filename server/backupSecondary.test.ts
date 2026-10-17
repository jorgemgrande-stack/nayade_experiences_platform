/**
 * Destino secundario de copias, paquete de recuperación sin secretos, retención independiente por
 * destino, alertas del secundario y estimación de almacenamiento (unitarias, sin MySQL).
 * La prueba completa con MySQL y dos MinIO está en `server/backupExternal.mysql.test.ts`.
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FsBackupStorage, secondaryBackupStorageFromEnv, withTimeout } from "./_core/ops/backupStorage";
import { MemoryBackupCopyLedger } from "./_core/ops/backupCopies";
import { applyCopyRetention, gfsPolicyFromEnv } from "./_core/ops/backupRetention";
import { assertNoSecrets, buildRecoveryPackage, readRecoveryPackage, writeRecoveryPackage } from "./_core/ops/recoveryPackage";
import { backupKeyringFromEnv } from "./_core/ops/backupCrypto";
import { estimateMonthly, steadyStateCopies } from "./_core/ops/backupEstimate";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { runAlerts } from "./_core/ops/alerts";

const S3_SECRET = "secreto-ficticio-0000000000"; // gitleaks:allow
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "es-bksec-"));
const ring = backupKeyringFromEnv({ BACKUP_KEYS: `bk1:${crypto.randomBytes(32).toString("base64")}`, BACKUP_ACTIVE_KEY_ID: "bk1" } as NodeJS.ProcessEnv);

describe("destino secundario desde variables", () => {
  it("sin variables: no configurado (todo como hoy)", () => {
    expect(secondaryBackupStorageFromEnv({ BACKUP_STORAGE: "fs", BACKUP_FS_DIR: "/x", BACKUP_SECONDARY_TIMEOUT_SECONDS: "60" } as NodeJS.ProcessEnv)).toMatchObject({ configured: false, storage: null });
  });
  it("incompleto: configurado pero no disponible, con el motivo en sus propios nombres", () => {
    const r = secondaryBackupStorageFromEnv({ BACKUP_SECONDARY_S3_BUCKET: "externo" } as NodeJS.ProcessEnv);
    expect(r).toMatchObject({ configured: true, storage: null });
    expect(r.reason).toContain("BACKUP_SECONDARY_S3_ACCESS_KEY");
    expect(r.reason).not.toMatch(/\bBACKUP_S3_/);
  });
  it("completo: S3 propio; la descripción no lleva credenciales", () => {
    const r = secondaryBackupStorageFromEnv({
      BACKUP_SECONDARY_S3_BUCKET: "externo",
      BACKUP_SECONDARY_S3_ACCESS_KEY: "acceso-ficticio",
      BACKUP_SECONDARY_S3_SECRET_KEY: S3_SECRET,
      BACKUP_SECONDARY_S3_ENDPOINT: "https://proveedor.example",
    } as NodeJS.ProcessEnv);
    expect(r.storage?.describe()).toBe("s3://externo/@proveedor.example");
    expect(r.storage?.describe()).not.toContain(S3_SECRET);
  });
  it("el mismo destino que el primario no es una ubicación independiente", () => {
    const r = secondaryBackupStorageFromEnv({ BACKUP_STORAGE: "fs", BACKUP_FS_DIR: path.resolve("/copias"), BACKUP_SECONDARY_STORAGE: "fs", BACKUP_SECONDARY_FS_DIR: path.resolve("/copias") } as NodeJS.ProcessEnv);
    expect(r).toMatchObject({ configured: true, storage: null });
    expect(r.reason).toMatch(/independiente/);
  });
  it("tiempo máximo: una operación colgada se rechaza", async () => {
    await expect(withTimeout(new Promise(() => undefined), 50, "Destino secundario")).rejects.toThrow(/sin respuesta/);
  });
});

describe("paquete de configuración para recuperación", () => {
  const env = {
    REGISTRY_ADMIN_DATABASE_URL: "mysql://es_cp:contrasena-ficticia-123@mysql.railway.internal:3306/es_registry", // gitleaks:allow
    BACKUP_KEYS: "bk1:" + Buffer.alloc(32, 7).toString("base64"),
    BACKUP_S3_SECRET_KEY: S3_SECRET,
    PROVISIONING_DB_SERVERS: JSON.stringify([{ alias: "mysql-a", host: "mysql.railway.internal", port: 3306, adminUrlEnv: "MYSQL_A_ADMIN_URL" }]),
    RAILWAY_PROJECT_ID: "00000000-0000-0000-0000-000000000000",
    ES_DEPLOY_COMMIT: "abc1234",
  } as NodeJS.ProcessEnv;
  const reader = {
    listTenants: async () => [{ id: "acme", displayName: "Acme", status: "active", schemaVersion: "0000_baseline" }] as never,
    getActiveDatabase: async () => ({ serverAlias: "mysql-a", state: "active" }) as never,
    listDomains: async () => [{ domain: "acme.elephantsource.example", kind: "platform", status: "active", isPrimary: true }] as never,
  };

  it("lleva nombres de variables, topología e ids, nunca valores secretos; se cifra y se lee", async () => {
    const pkg = await buildRecoveryPackage({
      runId: "r1",
      now: Date.parse("2026-10-17T00:00:00Z"),
      env,
      reader,
      registry: { database: "es_registry", schemaVersion: "0011" },
      crm: { configured: true, database: "es_crm" },
      destinations: { primary: new FsBackupStorage(tmp()), secondary: null },
      ring,
      retention: { primary: { daily: 30, weekly: 12, monthly: 12 } },
      latest: async () => ({ manifestKey: "tenants/acme/x.manifest.json", createdAt: 1 }),
    });
    const text = JSON.stringify(pkg);
    expect(text).not.toContain("contrasena-ficticia-123");
    expect(text).not.toContain(S3_SECRET);
    expect(text).not.toContain(Buffer.alloc(32, 7).toString("base64"));
    expect(pkg.deployment).toMatchObject({ commit: "abc1234", railway: { RAILWAY_PROJECT_ID: "00000000-0000-0000-0000-000000000000" } });
    expect(pkg.databases.servers).toEqual([{ alias: "mysql-a", host: "mysql.railway.internal", port: 3306, adminUrlEnv: "MYSQL_A_ADMIN_URL" }]);
    expect(pkg.backupJobEnvironment).toMatchObject({ BACKUP_KEYS: true, BACKUP_S3_SECRET_KEY: true, BACKUP_S3_BUCKET: false });
    expect(pkg.tenants[0]).toMatchObject({ id: "acme", serverAlias: "mysql-a", latest: { primary: { manifestKey: "tenants/acme/x.manifest.json" } } });
    expect(pkg.backups.keyIds).toEqual(["bk1"]);

    const st = new FsBackupStorage(tmp());
    const w = await writeRecoveryPackage(st, ring, pkg, Date.parse("2026-10-17T00:00:00Z"));
    expect(w.keys).toEqual(["recovery/2026/10/20261017.json.enc", "recovery/latest.json.enc"]);
    expect((await st.getBuffer("recovery/latest.json.enc"))!.toString("utf8")).not.toContain("acme");
    expect((await readRecoveryPackage(st, ring))?.tenants[0].id).toBe("acme");
  });

  it("rechaza un paquete con un secreto, una URL con credenciales o una clave privada", () => {
    expect(() => assertNoSecrets({ x: "contrasena-ficticia-123" }, env)).toThrow(/REGISTRY_ADMIN_DATABASE_URL/);
    expect(() => assertNoSecrets({ x: S3_SECRET }, env)).toThrow(/BACKUP_S3_SECRET_KEY/);
    expect(() => assertNoSecrets({ x: "https://u:p@host.example/x" }, {})).toThrow(/credenciales/);
    expect(() => assertNoSecrets({ x: "-----BEGIN RSA PRIVATE KEY-----" }, {})).toThrow(/privada/);
    expect(() => assertNoSecrets({ host: "mysql.railway.internal", db: "es_registry" }, env)).not.toThrow();
  });
});

describe("retención independiente del secundario", () => {
  const day = 86_400_000;
  async function seed() {
    const dir = tmp();
    const st = new FsBackupStorage(dir);
    const copies = new MemoryBackupCopyLedger();
    const base = Date.parse("2026-10-01T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      const key = `tenants/acme/2026/10/c${i}.sql.gz.enc`;
      const body = Buffer.from(`copia ${i}`);
      await st.putBuffer(key, body);
      await st.putBuffer(key.replace(".sql.gz.enc", ".manifest.json"), Buffer.from("{}"));
      await copies.record({
        backupId: i + 1, destination: "secondary", runId: `r${i}`, targetKind: "tenant", targetId: "acme", status: "ok", storage: "fs", location: key,
        manifestKey: key.replace(".sql.gz.enc", ".manifest.json"), bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex"),
        startedAt: base + i * day, finishedAt: base + i * day + 1000, error: null,
      });
    }
    return { st, copies, dir };
  }

  it("simulación por defecto: no borra nada; aplicada: borra solo en el secundario y marca pruned", async () => {
    const { st, copies } = await seed();
    const policy = { daily: 2, weekly: 0, monthly: 0 };
    const sim = await applyCopyRetention({ copies, storage: st, destination: "secondary" }, { policy });
    expect(sim).toMatchObject({ applied: false, deleted: 0 });
    expect(sim.toDelete).toHaveLength(3);
    expect(await st.list("tenants/")).toHaveLength(10);
    const ap = await applyCopyRetention({ copies, storage: st, destination: "secondary" }, { apply: true, policy });
    expect(ap.deleted).toBe(3);
    expect((await st.list("tenants/")).length).toBe(4);
    expect(copies.rows.filter((r) => r.status === "pruned")).toHaveLength(3);
  });

  it("si la copia más reciente no se puede verificar, no se borra nada de ese destino", async () => {
    const { st, copies } = await seed();
    await st.putBuffer("tenants/acme/2026/10/c4.sql.gz.enc", Buffer.from("alterada"));
    const ap = await applyCopyRetention({ copies, storage: st, destination: "secondary" }, { apply: true, policy: { daily: 1, weekly: 0, monthly: 0 } });
    expect(ap.deleted).toBe(0);
    expect(ap.skipped).toHaveLength(1);
    expect(await st.list("tenants/")).toHaveLength(10);
  });

  it("política propia del secundario desde BACKUP_SECONDARY_KEEP_*", () => {
    expect(gfsPolicyFromEnv({ BACKUP_KEEP_DAILY: "30", BACKUP_SECONDARY_KEEP_DAILY: "7" } as NodeJS.ProcessEnv, "BACKUP_SECONDARY_KEEP_")).toEqual({ daily: 7, weekly: 12, monthly: 12 });
  });
});

describe("alertas del secundario", () => {
  const reader = { listTenants: async () => [{ id: "acme", displayName: "Acme", status: "active" }] as never };
  it("sin intentos en el secundario no hay alertas (secundario no configurado)", async () => {
    const r = await runAlerts({ reader, incidents: new IncidentService(new MemoryIncidentStore()), secondaryBackups: { lastSuccessAt: async () => ({}), latestAttempts: async () => [] } });
    expect(r.active).toEqual([]);
  });
  it("fallo del último intento y retraso: alertas propias, sin afectar a backup.stale", async () => {
    const now = Date.now();
    const r = await runAlerts({
      reader,
      incidents: new IncidentService(new MemoryIncidentStore()),
      lastBackupAt: async () => ({ acme: now }),
      secondaryBackups: { lastSuccessAt: async () => ({ acme: now - 10 * 3_600_000 }), latestAttempts: async () => [{ targetKind: "tenant", targetId: "acme", status: "failed", error: "sin respuesta" }], maxAgeMs: 3_600_000 },
    });
    expect(r.active.sort()).toEqual(["backup.secondary_failed:tenant:acme", "backup.secondary_stale:acme"]);
  });
});

describe("estimación de almacenamiento y coste", () => {
  it("régimen estable con 30/12/12 y copias cada 15 min: unas 50 copias por destino", () => {
    const k = steadyStateCopies({ daily: 30, weekly: 12, monthly: 12 }, 96);
    expect(k).toBeGreaterThanOrEqual(45);
    expect(k).toBeLessThanOrEqual(55);
    expect(steadyStateCopies({ daily: 30, weekly: 12, monthly: 12 }, 1)).toBe(k);
  });
  it("fórmula: GB · precio + operaciones · precio", () => {
    const e = estimateMonthly({
      policy: { daily: 30, weekly: 12, monthly: 12 },
      runsPerDay: 96,
      databases: [{ kind: "tenant", id: "a", avgBytes: 1e6 }],
      filesBytes: 0,
      prices: { perGbMonth: 0.015, perMillionA: 4.5, perMillionB: 0.36 },
    });
    expect(e.opsA).toBe(96 * 30 * (2 + 2));
    expect(e.storedGb).toBeCloseTo((e.copiesPerTarget * 1e6) / 1e9, 6);
    expect(e.monthlyCost).toBeCloseTo(e.storedGb * 0.015 + (e.opsA / 1e6) * 4.5 + (e.opsB / 1e6) * 0.36, 9);
  });
});
