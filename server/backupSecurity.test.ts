/**
 * Copias de seguridad (sin MySQL): cifrado y descifrado, rotación de claves, manifiesto alterado,
 * retención 30/12/12, almacenamiento, varios servidores MySQL, inventario en el plano de control y
 * alerta `backup.stale`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  BackupCryptoError,
  backupKeyringFromEnv,
  decryptBuffer,
  decryptFile,
  encryptBuffer,
  encryptFile,
  readHeader,
  signManifest,
  verifyManifest,
} from "./_core/ops/backupCrypto";
import { FsBackupStorage, assertObjectKey, backupStorageFromEnv, mediaSourceFromEnv } from "./_core/ops/backupStorage";
import { MemoryBackupInventory, safeError } from "./_core/ops/backupInventory";
import { DEFAULT_GFS, applyBackupRetention, gfsPolicyFromEnv, selectGfsToDelete } from "./_core/ops/backupRetention";
import { chooseServer, parseDatabaseServers } from "./_core/provisioning/servers";
import { portableTriggerSql } from "./_core/ops/backup";
import { objectKeysFor, runBackupJob } from "./_core/ops/backupJob";
import { restoredDatabaseName, restoredUserFor } from "./_core/ops/backupRestore";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";
import { runAlerts } from "./_core/ops/alerts";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";

const key = () => crypto.randomBytes(32).toString("base64");
const ringOf = (keys: Record<string, string>, active: string) =>
  backupKeyringFromEnv({ BACKUP_KEYS: Object.entries(keys).map(([k, v]) => `${k}:${v}`).join(","), BACKUP_ACTIVE_KEY_ID: active } as NodeJS.ProcessEnv);
const DAY = 86_400_000;

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "es-bksec-"));
});
afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("cifrado de copias", () => {
  const K1 = key();
  const ring = ringOf({ k1: K1 }, "k1");

  it("cifra y descifra (fichero grande y vacío); el objeto no contiene el texto en claro", async () => {
    for (const size of [256 * 1024 + 7, 0]) {
      const src = path.join(tmp, `plain-${size}`);
      const plain = Buffer.concat([Buffer.from("CREATE TABLE secreta; INSERT INTO clientes VALUES ('Ñandú')"), crypto.randomBytes(size)]);
      fs.writeFileSync(src, plain);
      const enc = path.join(tmp, `enc-${size}`);
      const r = await encryptFile(src, enc, ring, "tenant:acme");
      const stored = fs.readFileSync(enc);
      expect(r.keyId).toBe("k1");
      expect(r.bytes).toBe(stored.length);
      expect(r.sha256).toBe(crypto.createHash("sha256").update(stored).digest("hex"));
      expect(stored.includes(Buffer.from("CREATE TABLE"))).toBe(false);
      expect(readHeader(enc).keyId).toBe("k1");
      const out = path.join(tmp, `dec-${size}`);
      await decryptFile(enc, out, ring, "tenant:acme");
      expect(fs.readFileSync(out).equals(plain)).toBe(true);
    }
  });

  it("rechaza otro destino (AAD), un byte alterado, un objeto truncado y una clave ausente", async () => {
    const src = path.join(tmp, "p2");
    fs.writeFileSync(src, crypto.randomBytes(5000));
    const enc = path.join(tmp, "e2");
    await encryptFile(src, enc, ring, "tenant:acme");
    const out = path.join(tmp, "d2");
    await expect(decryptFile(enc, out, ring, "tenant:otra")).rejects.toThrow(/autenticar/);
    expect(fs.existsSync(out)).toBe(false);

    const bad = Buffer.from(fs.readFileSync(enc));
    bad[bad.length - 100] ^= 0x01;
    fs.writeFileSync(path.join(tmp, "e2bad"), bad);
    await expect(decryptFile(path.join(tmp, "e2bad"), out, ring, "tenant:acme")).rejects.toThrow(BackupCryptoError);
    expect(fs.existsSync(out)).toBe(false);

    fs.writeFileSync(path.join(tmp, "e2trunc"), fs.readFileSync(enc).subarray(0, 30));
    await expect(decryptFile(path.join(tmp, "e2trunc"), out, ring, "tenant:acme")).rejects.toThrow(BackupCryptoError);

    const other = ringOf({ k9: key() }, "k9");
    await expect(decryptFile(enc, out, other, "tenant:acme")).rejects.toThrow(/k1 no está en BACKUP_KEYS/);
    expect(() => decryptBuffer(encryptBuffer(Buffer.from("x"), ring, "a"), ring, "b")).toThrow(/autenticar/);
  });

  it("rotación: la clave activa cifra lo nuevo y las antiguas siguen descifrando lo anterior", async () => {
    const src = path.join(tmp, "p3");
    fs.writeFileSync(src, "contenido de prueba");
    const old = path.join(tmp, "e3-old");
    await encryptFile(src, old, ring, "registry:registry");

    const rotated = ringOf({ k1: K1, k2: key() }, "k2");
    const fresh = path.join(tmp, "e3-new");
    expect((await encryptFile(src, fresh, rotated, "registry:registry")).keyId).toBe("k2");
    expect(readHeader(old).keyId).toBe("k1");
    expect((await decryptFile(old, path.join(tmp, "d3a"), rotated, "registry:registry")).keyId).toBe("k1");
    expect((await decryptFile(fresh, path.join(tmp, "d3b"), rotated, "registry:registry")).keyId).toBe("k2");
    // Retirar k1 del llavero deja las copias antiguas sin descifrar: hay que conservarla mientras existan
    const withoutK1 = ringOf({ k2: rotated.keys.get("k2")!.toString("base64") }, "k2");
    await expect(decryptFile(old, path.join(tmp, "d3c"), withoutK1, "registry:registry")).rejects.toThrow(/k1/);
  });

  it("llavero: errores con el nombre de las variables de copias", () => {
    expect(() => backupKeyringFromEnv({} as NodeJS.ProcessEnv)).toThrow(/BACKUP_KEYS/);
    expect(() => backupKeyringFromEnv({ BACKUP_KEYS: `k1:${key()}`, BACKUP_ACTIVE_KEY_ID: "k2" } as NodeJS.ProcessEnv)).toThrow(/BACKUP_ACTIVE_KEY_ID/);
    expect(() => backupKeyringFromEnv({ BACKUP_KEYS: "k1:corta", BACKUP_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv)).toThrow(/32 bytes/);
  });

  it("manifiesto firmado: cualquier alteración se rechaza", () => {
    const rotated = ringOf({ k1: K1, k2: key() }, "k2");
    const m = signManifest({ keyId: "k1", target: { kind: "tenant", id: "acme" }, tables: { users: { rows: 3, checksum: "123" } }, object: { sha256: "ab" } }, rotated);
    expect(verifyManifest(JSON.parse(JSON.stringify(m)), rotated)).toBeTruthy();
    // El orden de las claves no importa (JSON canónico)
    const reordered = { object: m.object, mac: m.mac, tables: m.tables, target: m.target, keyId: m.keyId };
    expect(() => verifyManifest(reordered, rotated)).not.toThrow();

    const t1 = JSON.parse(JSON.stringify(m));
    t1.tables.users.rows = 4;
    expect(() => verifyManifest(t1, rotated)).toThrow(/alterado/);
    const t2 = JSON.parse(JSON.stringify(m));
    t2.target.id = "otra";
    expect(() => verifyManifest(t2, rotated)).toThrow(/alterado/);
    const t3 = JSON.parse(JSON.stringify(m));
    t3.keyId = "k2"; // firmar con otra clave no sirve
    expect(() => verifyManifest(t3, rotated)).toThrow(/alterado/);
    const t4 = JSON.parse(JSON.stringify(m));
    delete t4.mac;
    expect(() => verifyManifest(t4, rotated)).toThrow(/sin firma/);
  });
});

describe("retención 30 diarias / 12 semanales / 12 mensuales", () => {
  const NOW = Date.UTC(2026, 9, 16, 12);

  it("conserva las 30 diarias más recientes, una por semana y por mes, y nada más", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, at: NOW - i * DAY }));
    const del = selectGfsToDelete(items.slice().reverse(), DEFAULT_GFS);
    const kept = items.filter((x) => !del.some((d) => d.id === x.id));
    expect(kept.length).toBeLessThanOrEqual(30 + 12 + 12);
    for (let i = 0; i < 30; i++) expect(kept.some((k) => k.id === i + 1)).toBe(true);
    const months = new Set(kept.map((k) => new Date(k.at).toISOString().slice(0, 7)));
    expect(months.size).toBe(12);
    // Nada más antiguo que 12 meses
    const oldest = Math.min(...kept.map((k) => k.at));
    expect(NOW - oldest).toBeLessThan(366 * DAY);
    // Semanales: 12 semanas distintas cubiertas aunque estén fuera de las 30 diarias
    expect(kept.filter((k) => NOW - k.at > 30 * DAY && NOW - k.at < 84 * DAY).length).toBeGreaterThanOrEqual(6);
  });

  it("nunca borra la única copia válida (ni con política 0/0/0) y conserva la más reciente", () => {
    expect(selectGfsToDelete([{ id: 1, at: NOW - 900 * DAY }], { daily: 0, weekly: 0, monthly: 0 })).toEqual([]);
    const two = [
      { id: 1, at: NOW - 10 * DAY },
      { id: 2, at: NOW - DAY },
    ];
    expect(selectGfsToDelete(two, { daily: 0, weekly: 0, monthly: 0 }).map((x) => x.id)).toEqual([1]);
    // Varias copias el mismo día: solo la última del día cuenta como diaria
    const sameDay = [
      { id: 1, at: NOW - 3_600_000 * 3 },
      { id: 2, at: NOW - 3_600_000 * 2 },
      { id: 3, at: NOW - 3_600_000 },
    ];
    expect(selectGfsToDelete(sameDay, { daily: 30, weekly: 0, monthly: 0 }).map((x) => x.id).sort()).toEqual([1, 2]);
  });

  it("política configurable por variables, con validación", () => {
    expect(gfsPolicyFromEnv({} as NodeJS.ProcessEnv)).toEqual({ daily: 30, weekly: 12, monthly: 12 });
    expect(gfsPolicyFromEnv({ BACKUP_KEEP_DAILY: "7", BACKUP_KEEP_WEEKLY: "4", BACKUP_KEEP_MONTHLY: "24" } as NodeJS.ProcessEnv)).toEqual({ daily: 7, weekly: 4, monthly: 24 });
    expect(() => gfsPolicyFromEnv({ BACKUP_KEEP_DAILY: "-1" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("se aplica al almacenamiento y al inventario; las fallidas no se tocan; un borrado fallido no se marca", async () => {
    const root = fs.mkdtempSync(path.join(tmp, "ret-"));
    const storage = new FsBackupStorage(root);
    const inv = new MemoryBackupInventory();
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) {
      const at = NOW - i * DAY;
      const keys = objectKeysFor("tenant", "acme", at, `run-${i}-xxxxxxxx`);
      await storage.putBuffer(keys.object, Buffer.from("x"));
      await storage.putBuffer(keys.manifest, Buffer.from("{}"));
      const id = await inv.start({ runId: `r${i}`, targetKind: "tenant", targetId: "acme", startedAt: at - 1000 });
      await inv.succeed(id, { finishedAt: at, location: keys.object, manifestKey: keys.manifest, bytes: 1, sha256: "a".repeat(64), keyId: "k1", tablesCount: 1, rowsCount: 1 });
      ids.push(id);
    }
    const failed = await inv.start({ runId: "rf", targetKind: "tenant", targetId: "acme", startedAt: NOW - 100 * DAY });
    await inv.fail(failed, NOW - 100 * DAY + 5, "fallo");
    const policy = { daily: 5, weekly: 0, monthly: 0 };

    const dry = await applyBackupRetention({ inventory: inv, storage }, { policy, now: NOW });
    expect(dry.toDelete.length).toBe(35);
    expect((await storage.list("tenants/acme/")).length).toBe(80);

    const applied = await applyBackupRetention({ inventory: inv, storage }, { apply: true, policy, now: NOW });
    expect(applied.deleted).toBe(35);
    expect((await storage.list("tenants/acme/")).length).toBe(10);
    expect((await inv.list({ status: "ok" })).map((r) => r.id).sort((a, b) => a - b)).toEqual(ids.slice(0, 5));
    expect((await inv.get(failed))!.status).toBe("failed");

    // Si el almacenamiento falla al borrar, la fila sigue `ok` y se informa
    const broken = Object.assign(Object.create(storage), { delete: async () => Promise.reject(new Error("sin permiso")) });
    const r = await applyBackupRetention({ inventory: inv, storage: broken }, { apply: true, policy: { daily: 1, weekly: 0, monthly: 0 }, now: NOW });
    expect(r.deleted).toBe(0);
    expect(r.errors.length).toBe(4);
    expect((await inv.list({ status: "ok" })).length).toBe(5);
  });
});

describe("almacenamiento", () => {
  it("ninguno se da por disponible sin configuración explícita", () => {
    expect(backupStorageFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({ storage: null, reason: expect.stringMatching(/BACKUP_STORAGE/) });
    expect(backupStorageFromEnv({ BACKUP_STORAGE: "s3", BACKUP_S3_BUCKET: "b" } as NodeJS.ProcessEnv)).toMatchObject({ storage: null, reason: expect.stringMatching(/BACKUP_S3_ACCESS_KEY/) });
    expect(backupStorageFromEnv({ BACKUP_STORAGE: "fs", BACKUP_FS_DIR: "relativo" } as NodeJS.ProcessEnv)).toMatchObject({ storage: null });
    const s3 = backupStorageFromEnv({
      BACKUP_STORAGE: "s3",
      BACKUP_S3_BUCKET: "copias",
      BACKUP_S3_ACCESS_KEY: "AKIAFICTICIA", // gitleaks:allow
      BACKUP_S3_SECRET_KEY: "valor-ficticio-de-prueba", // gitleaks:allow
      BACKUP_S3_ENDPOINT: "https://cuenta.r2.example",
      BACKUP_S3_PREFIX: "elephant",
    } as NodeJS.ProcessEnv);
    expect(s3.storage?.kind).toBe("s3");
    // La descripción no lleva credenciales
    expect(s3.storage!.describe()).toBe("s3://copias/elephant/@cuenta.r2.example");
    expect(mediaSourceFromEnv({ S3_BUCKET: "m" } as NodeJS.ProcessEnv).media).toBeNull();
    expect(mediaSourceFromEnv({ BACKUP_MEDIA: "1", S3_BUCKET: "m" } as NodeJS.ProcessEnv)).toMatchObject({ media: null, reason: expect.stringMatching(/S3_ACCESS_KEY/) });
  });

  it("claves de objeto: sin escapar del directorio", async () => {
    for (const k of ["../x", "a/../b", "/abs", "a\\b", "a//b", ""]) expect(() => assertObjectKey(k)).toThrow();
    const st = new FsBackupStorage(path.join(tmp, "st"));
    await st.putBuffer("tenants/a/x.enc", Buffer.from("hola"));
    expect(await st.hash("tenants/a/x.enc")).toEqual({ sha256: crypto.createHash("sha256").update("hola").digest("hex"), bytes: 4 });
    expect(await st.getBuffer("tenants/a/nada")).toBeNull();
    expect((await st.list("tenants/")).map((o) => o.key)).toEqual(["tenants/a/x.enc"]);
  });

  it("errores del inventario sin credenciales", () => {
    expect(safeError(new Error("conectando a mysql://u:clave@h:3306/db falló password=abc"))).toBe("Error: conectando a mysql://*** falló password=***"); // gitleaks:allow
  });
});

describe("triggers portables y nombres de restauración", () => {
  it("quita DEFINER y el nombre de la BD de origen", () => {
    const sql =
      "CREATE DEFINER=`esu_0123456789abcdef`@`%` TRIGGER IF NOT EXISTS `es_acme`.`reservations_set_public_token` BEFORE INSERT ON `es_acme`.`reservations` FOR EACH ROW SET NEW.public_token = 1";
    expect(portableTriggerSql(sql, "es_acme")).toBe(
      "CREATE TRIGGER IF NOT EXISTS `reservations_set_public_token` BEFORE INSERT ON `reservations` FOR EACH ROW SET NEW.public_token = 1",
    );
    expect(portableTriggerSql("CREATE DEFINER=`root`@`localhost` TRIGGER t BEFORE UPDATE ON x FOR EACH ROW SET @a = 1", "db")).toBe(
      "CREATE TRIGGER t BEFORE UPDATE ON x FOR EACH ROW SET @a = 1",
    );
  });

  it("base restaurada con nombre nuevo y usuario propio acotado", () => {
    const db = restoredDatabaseName("acme-hotel", Date.UTC(2026, 9, 16, 3, 4, 5));
    expect(db).toBe("es_acme_hotel_r20261016030405");
    expect(restoredUserFor(db)).toMatch(/^esr_[0-9a-f]{16}$/);
    expect(() => restoredDatabaseName("a".repeat(60), Date.now())).toThrow();
  });
});

describe("varios servidores MySQL", () => {
  const two = JSON.stringify([
    { alias: "mysql-a", host: "mysql-a.internal", port: 3306, adminUrlEnv: "MYSQL_A_ADMIN_URL" },
    { alias: "mysql-b", host: "mysql-b.internal", port: 3307, adminUrlEnv: "MYSQL_B_ADMIN_URL", maxTenants: 2 },
  ]);

  it("lee la lista de servidores y rechaza credenciales en claro", () => {
    const cfg = parseDatabaseServers({ PROVISIONING_DB_SERVERS: two } as NodeJS.ProcessEnv)!;
    expect(cfg.placement).toBe("least_used");
    expect(cfg.servers.map((s) => s.alias)).toEqual(["mysql-a", "mysql-b"]);
    const bad = (v: unknown, extra: Record<string, string> = {}) => () => parseDatabaseServers({ PROVISIONING_DB_SERVERS: JSON.stringify(v), ...extra } as NodeJS.ProcessEnv);
    expect(bad([{ alias: "a", host: "h", adminUrlEnv: "A", adminUrl: "mysql://root:x@h/" }])).toThrow(/no admitido/);
    expect(bad([{ alias: "a", host: "h", adminUrlEnv: "mysql://root:x@h/" }])).toThrow(/NOMBRE/);
    expect(bad([{ alias: "a", host: "root:x@h", adminUrlEnv: "A" }])).toThrow(/host/);
    expect(bad([{ alias: "a", host: "h", adminUrlEnv: "A" }, { alias: "a", host: "h2", adminUrlEnv: "B" }])).toThrow(/repetido/);
    expect(bad([])).toThrow();
    expect(() => parseDatabaseServers({ PROVISIONING_DB_SERVERS: "{" } as NodeJS.ProcessEnv)).toThrow(/JSON/);
    expect(bad([{ alias: "a", host: "h", adminUrlEnv: "A" }], { PROVISIONING_DB_DEFAULT_SERVER: "z" })).toThrow(/DEFAULT_SERVER/);
    expect(() => parseDatabaseServers({ PROVISIONING_DB_SERVERS: two, PROVISIONING_DB_PLACEMENT: "azar" } as NodeJS.ProcessEnv)).toThrow(/PLACEMENT/);
    // Compatibilidad: un único servidor con PROVISIONING_DB_ADMIN_URL
    const legacy = parseDatabaseServers({ PROVISIONING_DB_ADMIN_URL: "mysql://admin:ficticia@db.internal:3310/x", PROVISIONING_DB_ALIAS: "principal" } as NodeJS.ProcessEnv)!; // gitleaks:allow
    expect(legacy.servers).toEqual([{ alias: "principal", host: "db.internal", port: 3310, adminUrlEnv: "PROVISIONING_DB_ADMIN_URL" }]);
    expect(parseDatabaseServers({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("colocación: menos ocupado, tope, servidor cerrado, explícito", () => {
    const cfg = parseDatabaseServers({ PROVISIONING_DB_SERVERS: two } as NodeJS.ProcessEnv)!;
    expect(chooseServer(cfg, {})).toBe("mysql-a");
    expect(chooseServer(cfg, { "mysql-a": 1 })).toBe("mysql-b");
    expect(chooseServer(cfg, { "mysql-a": 5, "mysql-b": 2 })).toBe("mysql-a"); // b está lleno
    expect(chooseServer(cfg, {}, "mysql-b")).toBe("mysql-b");
    expect(() => chooseServer(cfg, {}, "mysql-z")).toThrow(/desconocido/);
    const closed = { ...cfg, servers: cfg.servers.map((s) => ({ ...s, acceptsNew: false })) };
    expect(() => chooseServer(closed, {})).toThrow(/Ningún servidor/);
    const explicit = parseDatabaseServers({ PROVISIONING_DB_SERVERS: two, PROVISIONING_DB_PLACEMENT: "explicit" } as NodeJS.ProcessEnv)!;
    expect(() => chooseServer(explicit, {})).toThrow(/explícita/);
    expect(chooseServer({ ...explicit, defaultAlias: "mysql-b" }, {})).toBe("mysql-b");
  });
});

describe("trabajo, inventario, alerta y plano de control", () => {
  const OP: Actor = { type: "operator", id: "test" };
  const OPS = "bk-ops-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const READER = "bk-read-token-bbbbbbbbbbbbbbbbbbbbbbbbbbb";
  let server: http.Server;
  let port: number;
  const inv = new MemoryBackupInventory();
  const reg = new MemoryTenantRegistryStore();
  const registry = new TenantRegistryService(reg, () =>
    keyringFromEnv({ REGISTRY_KEYS: `k1:${key()}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv),
  );
  const NOW = Date.now();

  beforeAll(async () => {
    for (const id of ["fresca", "vieja", "nunca"]) {
      await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
      await registry.setStatus(id, "trial", OP);
    }
    await registry.createTenant({ id: "en-alta", displayName: "En alta" }, OP);
    const ok = async (id: string, at: number) => {
      const r = await inv.start({ runId: "r", targetKind: "tenant", targetId: id, startedAt: at - 5000, serverAlias: "mysql-a" });
      await inv.succeed(r, { finishedAt: at, location: `tenants/${id}/x.sql.gz.enc`, manifestKey: `tenants/${id}/x.manifest.json`, bytes: 10, sha256: "a".repeat(64), keyId: "k1", tablesCount: 3, rowsCount: 9 });
    };
    await ok("fresca", NOW - 2 * 3_600_000);
    await ok("vieja", NOW - 5 * DAY);
    const f = await inv.start({ runId: "r2", targetKind: "tenant", targetId: "vieja", startedAt: NOW - 3_600_000 });
    await inv.fail(f, NOW - 3_500_000, "Error: ECONNREFUSED");
    await ok("registry", NOW - 3_600_000);
    (inv.rows[inv.rows.length - 1] as { targetKind: string }).targetKind = "registry";

    server = http.createServer(
      createControlPlaneApp({
        tokens: [
          { id: "ops", sha256: hashToken(OPS), scopes: ["ops:read", "tenants:read"] },
          { id: "reader", sha256: hashToken(READER), scopes: ["tenants:read"] },
        ],
        registry,
        reader: reg,
        entitlements: { listEntitlements: async () => [], grant: async () => undefined as never, setStatus: async () => undefined as never, revoke: async () => undefined as never },
        quotas: { listQuotas: async () => [], set: async () => undefined as never, remove: async () => undefined as never },
        platformTarget: "edge.example.com",
        backups: { inventory: inv, maxAgeMs: 36 * 3_600_000 },
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = (p: string, token: string) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/cp/v1${p}`, headers: { authorization: `Bearer ${token}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      });
      req.on("error", reject);
      req.end();
    });

  it("GET /backups: quién tiene copia reciente, la última y los errores", async () => {
    const r = await call("/backups", OPS);
    expect(r.status).toBe(200);
    expect(r.json.summary).toEqual({ tenants: 3, fresh: 1, stale: 1, never: 1, lastAttemptFailed: 1 });
    const by = Object.fromEntries(r.json.tenants.map((t: any) => [t.tenantId, t]));
    expect(by.fresca).toMatchObject({ fresh: true, lastAttempt: { status: "ok", serverAlias: "mysql-a", keyId: "k1" } });
    expect(by.vieja).toMatchObject({ fresh: false, lastError: "Error: ECONNREFUSED", lastAttempt: { status: "failed" } });
    expect(by.nunca).toMatchObject({ fresh: false, lastSuccessAt: null, lastAttempt: null });
    expect(by["en-alta"]).toBeUndefined();
    // Las peores primero
    expect(r.json.tenants[0].fresh).toBe(false);
    expect(r.json.platform.registry.fresh).toBe(true);
    expect(r.json.platform.crm).toMatchObject({ fresh: false, lastSuccessAt: null });
    expect(JSON.stringify(r.json)).not.toMatch(/mysql:\/\//);
  });

  it("GET /tenants/:id/backups y ámbito ops:read", async () => {
    const r = await call("/tenants/vieja/backups", OPS);
    expect(r.status).toBe(200);
    expect(r.json.backups.map((b: any) => b.status)).toEqual(["failed", "ok"]);
    expect(r.json).toMatchObject({ tenantId: "vieja", fresh: false });
    expect((await call("/backups", READER)).status).toBe(403);
    expect((await call("/tenants/vieja/backups", READER)).status).toBe(403);
    expect((await call("/tenants/NO%20VALIDO/backups", OPS)).status).toBe(400);
  });

  it("la alerta backup.stale usa la última copia correcta del inventario", async () => {
    const incidents = new IncidentService(new MemoryIncidentStore());
    const r = await runAlerts({ reader: reg, incidents, lastBackupAt: () => inv.lastSuccess("tenant"), backupMaxAgeMs: 36 * 3_600_000, now: () => NOW });
    expect(r.active.filter((k) => k.startsWith("backup.stale")).sort()).toEqual(["backup.stale:nunca", "backup.stale:vieja"]);
    const open = await incidents.list({ status: "open" });
    expect(open.find((i) => i.dedupeKey === "backup.stale:vieja")?.severity).toBe("critical");
  });

  it("el trabajo registra como fallida una empresa sin base activa y no detiene el resto", async () => {
    const local = new MemoryBackupInventory();
    const rep = await runBackupJob({
      reader: reg,
      tenantDsn: async () => null,
      storage: new FsBackupStorage(path.join(tmp, "job")),
      ring: ringOf({ k1: key() }, "k1"),
      inventory: local,
      includePlatform: true,
    });
    expect(rep.ok).toBe(false);
    expect(rep.results.filter((r) => r.kind === "tenant").map((r) => [r.id, r.status])).toEqual([
      ["fresca", "failed"],
      ["nunca", "failed"],
      ["vieja", "failed"],
    ]);
    expect(rep.results.filter((r) => r.kind !== "tenant").map((r) => [r.id, r.status])).toEqual([
      ["registry", "skipped"],
      ["crm", "skipped"],
    ]);
    expect((await local.list({ status: "failed" })).every((r) => r.error === "La empresa no tiene base de datos activa")).toBe(true);
  });
});
