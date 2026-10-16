/**
 * Trabajo de copia programable: en cada ejecución copia TODAS las empresas con base activa del
 * registro (cada una a su propio objeto), el propio registro y la BD del CRM comercial; y, si el
 * almacenamiento de medios está configurado, replica los ficheros de cada empresa.
 *
 * Por cada destino: volcado lógico consistente (backup.ts) → cifrado AES-256-GCM con la clave activa
 * (backupCrypto.ts) → subida → verificación de la subida (se vuelve a leer el objeto y se compara su
 * SHA-256) → manifiesto firmado → fila en el inventario. Un fallo en un destino no detiene los demás;
 * queda registrado con su error y el trabajo termina con código de error.
 *
 * Nada de esto restaura ni modifica bases: solo lee.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupDatabase, type BackupManifest } from "./backup";
import { decryptBuffer, encryptBuffer, encryptFile, signManifest, type Keyring } from "./backupCrypto";
import type { BackupInventory, BackupTargetKind } from "./backupInventory";
import { safeError } from "./backupInventory";
import type { BackupStorage } from "./backupStorage";
import type { TenantRegistryReader } from "../tenantRegistry/store";
import type { TenantStatus } from "../tenantRegistry/contract";

/** Estados de empresa cuya base se copia (todo lo que conserva datos y no está en alta o borrándose). */
export const BACKUP_TENANT_STATUSES: readonly TenantStatus[] = ["trial", "active", "grace", "suspended", "archived"];

export interface SignedBackupManifest {
  format: "elephant-backup";
  version: 2;
  runId: string;
  target: { kind: Exclude<BackupTargetKind, "files">; id: string };
  createdAt: string;
  database: string;
  serverAlias: string | null;
  schemaVersion: string | null;
  keyId: string;
  /** Objeto cifrado tal como está almacenado. */
  object: { key: string; bytes: number; sha256: string };
  /** Volcado SQL sin comprimir (SHA-256 que comprueba la restauración). */
  dump: { bytes: number; sha256: string };
  tables: BackupManifest["tables"];
  triggers: string[];
  mac: string;
}

/** Contexto autenticado del objeto: liga cada copia a su destino. */
export const backupAad = (kind: string, id: string) => `${kind}:${id}`;

const KIND_DIR: Record<Exclude<BackupTargetKind, "files">, string> = { tenant: "tenants", registry: "registry", crm: "crm" };

export function objectKeysFor(kind: Exclude<BackupTargetKind, "files">, id: string, at: number, runId: string) {
  const iso = new Date(at).toISOString();
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = `${KIND_DIR[kind]}/${id}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${stamp}-${runId.slice(0, 8)}`;
  return { object: `${base}.sql.gz.enc`, manifest: `${base}.manifest.json` };
}

export interface DbTarget {
  kind: Exclude<BackupTargetKind, "files">;
  id: string;
  dsn: string;
  serverAlias?: string | null;
  schemaVersion?: string | null;
}

export interface TargetResult {
  kind: BackupTargetKind;
  id: string;
  status: "ok" | "failed" | "skipped";
  inventoryId?: number;
  bytes?: number;
  durationMs: number;
  error?: string;
}

interface Ctx {
  storage: BackupStorage;
  ring: Keyring;
  inventory: BackupInventory;
  runId: string;
  tmpDir: string;
  now: () => number;
}

/** Copia una base: volcado, cifrado, subida verificada, manifiesto firmado e inventario. */
export async function backupTarget(t: DbTarget, c: Ctx): Promise<TargetResult> {
  const started = c.now();
  const invId = await c.inventory.start({
    runId: c.runId,
    targetKind: t.kind,
    targetId: t.id,
    startedAt: started,
    serverAlias: t.serverAlias ?? null,
    databaseName: safeDbName(t.dsn),
    schemaVersion: t.schemaVersion ?? null,
    storageKind: c.storage.kind,
  });
  const keys = objectKeysFor(t.kind, t.id, started, c.runId);
  const work = fs.mkdtempSync(path.join(c.tmpDir, "es-bk-"));
  let uploaded = false;
  try {
    const dump = await backupDatabase(t.dsn, { tenantId: t.id, outDir: work, fileBase: "dump" });
    const enc = path.join(work, "dump.sql.gz.enc");
    const e = await encryptFile(path.join(work, "dump.sql.gz"), enc, c.ring, backupAad(t.kind, t.id));
    await c.storage.putFile(keys.object, enc);
    uploaded = true;
    // Verificación de la subida: se relee el objeto almacenado
    const remote = await c.storage.hash(keys.object);
    if (remote.sha256 !== e.sha256 || remote.bytes !== e.bytes) throw new Error("La copia almacenada no coincide con la subida (SHA-256)");

    const manifest = signManifest(
      {
        format: "elephant-backup" as const,
        version: 2 as const,
        runId: c.runId,
        target: { kind: t.kind, id: t.id },
        createdAt: new Date(started).toISOString(),
        database: dump.database,
        serverAlias: t.serverAlias ?? null,
        schemaVersion: t.schemaVersion ?? null,
        keyId: e.keyId,
        object: { key: keys.object, bytes: e.bytes, sha256: e.sha256 },
        dump: { bytes: dump.bytes, sha256: dump.sha256 },
        tables: dump.tables,
        triggers: dump.triggers ?? [],
      },
      c.ring,
    );
    const body = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    await c.storage.putBuffer(keys.manifest, body);
    const back = await c.storage.getBuffer(keys.manifest);
    if (!back || !back.equals(body)) throw new Error("El manifiesto almacenado no coincide con el subido");

    const finished = c.now();
    const rows = Object.values(dump.tables).reduce((n, x) => n + x.rows, 0);
    await c.inventory.succeed(invId, {
      finishedAt: finished,
      location: keys.object,
      manifestKey: keys.manifest,
      bytes: e.bytes,
      sha256: e.sha256,
      keyId: e.keyId,
      tablesCount: Object.keys(dump.tables).length,
      rowsCount: rows,
    });
    return { kind: t.kind, id: t.id, status: "ok", inventoryId: invId, bytes: e.bytes, durationMs: finished - started };
  } catch (err) {
    const msg = safeError(err);
    if (uploaded) await c.storage.delete(keys.object).catch(() => undefined);
    await c.storage.delete(keys.manifest).catch(() => undefined);
    const finished = c.now();
    await c.inventory.fail(invId, finished, msg);
    return { kind: t.kind, id: t.id, status: "failed", inventoryId: invId, durationMs: finished - started, error: msg };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function safeDbName(dsn: string): string | null {
  try {
    return new URL(dsn).pathname.slice(1) || null;
  } catch {
    return null;
  }
}

// ── Ficheros (medios) ───────────────────────────────────────────────────────

/** Origen de los ficheros de las empresas (el bucket de medios). */
export interface MediaSource {
  describe(): string;
  list(prefix: string): Promise<Array<{ key: string; bytes: number; etag?: string }>>;
  get(key: string): Promise<Buffer>;
}

export interface FilesIndexEntry {
  bytes: number;
  etag: string | null;
  sha256: string;
  object: string;
  copiedAt: string;
}

export interface FilesIndex {
  format: "elephant-files-index";
  version: 1;
  tenantId: string;
  updatedAt: string;
  entries: Record<string, FilesIndexEntry>;
}

export const filesIndexKey = (tenantId: string) => `files/${tenantId}/index.json.enc`;
const filesPrefix = (tenantId: string) => `t/${tenantId}/`;

export async function readFilesIndex(storage: BackupStorage, ring: Keyring, tenantId: string): Promise<FilesIndex | null> {
  const buf = await storage.getBuffer(filesIndexKey(tenantId));
  if (!buf) return null;
  return JSON.parse(decryptBuffer(buf, ring, backupAad("files-index", tenantId)).toString("utf8")) as FilesIndex;
}

/**
 * Réplica incremental y cifrada de los ficheros de una empresa (`t/<empresa>/…` del bucket de medios).
 * Solo añade: un fichero borrado en el origen se conserva en la copia. Un índice cifrado guarda qué
 * se copió (clave, tamaño, ETag, SHA-256).
 */
export async function backupTenantFiles(tenantId: string, media: MediaSource, c: Ctx): Promise<TargetResult> {
  const started = c.now();
  const invId = await c.inventory.start({ runId: c.runId, targetKind: "files", targetId: tenantId, startedAt: started, storageKind: c.storage.kind });
  try {
    const index: FilesIndex = (await readFilesIndex(c.storage, c.ring, tenantId)) ?? {
      format: "elephant-files-index",
      version: 1,
      tenantId,
      updatedAt: new Date(started).toISOString(),
      entries: {},
    };
    let copied = 0;
    let copiedBytes = 0;
    for (const o of await media.list(filesPrefix(tenantId))) {
      const prev = index.entries[o.key];
      if (prev && prev.bytes === o.bytes && (prev.etag ?? null) === (o.etag ?? null)) continue;
      const data = await media.get(o.key);
      const sha = crypto.createHash("sha256").update(data).digest("hex");
      const objKey = `files/${tenantId}/objects/${crypto.createHash("sha256").update(o.key).digest("hex").slice(0, 32)}-${sha.slice(0, 16)}.enc`;
      const enc = encryptBuffer(data, c.ring, backupAad("files", `${tenantId}:${o.key}`));
      await c.storage.putBuffer(objKey, enc);
      const remote = await c.storage.hash(objKey);
      if (remote.sha256 !== crypto.createHash("sha256").update(enc).digest("hex")) throw new Error("Fichero almacenado distinto del subido");
      index.entries[o.key] = { bytes: o.bytes, etag: o.etag ?? null, sha256: sha, object: objKey, copiedAt: new Date(c.now()).toISOString() };
      copied++;
      copiedBytes += enc.length;
    }
    index.updatedAt = new Date(c.now()).toISOString();
    const encIndex = encryptBuffer(Buffer.from(JSON.stringify(index), "utf8"), c.ring, backupAad("files-index", tenantId));
    await c.storage.putBuffer(filesIndexKey(tenantId), encIndex);
    const finished = c.now();
    await c.inventory.succeed(invId, {
      finishedAt: finished,
      location: filesIndexKey(tenantId),
      manifestKey: null,
      bytes: copiedBytes,
      sha256: crypto.createHash("sha256").update(encIndex).digest("hex"),
      keyId: c.ring.activeKeyId,
      tablesCount: Object.keys(index.entries).length,
      rowsCount: copied,
    });
    return { kind: "files", id: tenantId, status: "ok", inventoryId: invId, bytes: copiedBytes, durationMs: finished - started };
  } catch (err) {
    const msg = safeError(err);
    const finished = c.now();
    await c.inventory.fail(invId, finished, msg);
    return { kind: "files", id: tenantId, status: "failed", inventoryId: invId, durationMs: finished - started, error: msg };
  }
}

/** Recupera los ficheros de una empresa desde la réplica a un directorio local. */
export async function restoreTenantFiles(
  d: { storage: BackupStorage; ring: Keyring },
  tenantId: string,
  outDir: string,
): Promise<{ files: number; bytes: number }> {
  const index = await readFilesIndex(d.storage, d.ring, tenantId);
  if (!index) throw new Error("No hay réplica de ficheros para esa empresa");
  let files = 0;
  let bytes = 0;
  const root = path.resolve(outDir);
  for (const [key, e] of Object.entries(index.entries)) {
    const buf = await d.storage.getBuffer(e.object);
    if (!buf) throw new Error(`Falta el objeto de ${key}`);
    const plain = decryptBuffer(buf, d.ring, backupAad("files", `${tenantId}:${key}`));
    if (crypto.createHash("sha256").update(plain).digest("hex") !== e.sha256) throw new Error(`SHA-256 distinto en ${key}`);
    const dst = path.resolve(root, ...key.split("/"));
    if (!dst.startsWith(root + path.sep)) throw new Error("Clave de fichero no válida");
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, plain);
    files++;
    bytes += plain.length;
  }
  return { files, bytes };
}

// ── Ejecución completa ──────────────────────────────────────────────────────

export interface BackupJobDeps {
  reader: Pick<TenantRegistryReader, "listTenants" | "getActiveDatabase">;
  /** DSN activo de una empresa (descifrado del registro; nunca se registra). */
  tenantDsn: (tenantId: string) => Promise<string | null>;
  registryDsn?: string;
  crmDsn?: string;
  storage: BackupStorage;
  ring: Keyring;
  inventory: BackupInventory;
  media?: MediaSource;
  tmpDir?: string;
  now?: () => number;
  runId?: string;
  /** Limita las empresas (p. ej. una sola para una copia manual). */
  only?: string[];
  /** Incluir registro y CRM (por defecto sí). */
  includePlatform?: boolean;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface BackupJobReport {
  runId: string;
  startedAt: number;
  finishedAt: number;
  storage: string;
  keyId: string;
  ok: boolean;
  results: TargetResult[];
}

export async function runBackupJob(d: BackupJobDeps): Promise<BackupJobReport> {
  const now = d.now ?? Date.now;
  const c: Ctx = {
    storage: d.storage,
    ring: d.ring,
    inventory: d.inventory,
    runId: d.runId ?? crypto.randomUUID(),
    tmpDir: d.tmpDir ?? os.tmpdir(),
    now,
  };
  const log = d.log ?? (() => undefined);
  const startedAt = now();
  const results: TargetResult[] = [];
  const record = (r: TargetResult) => {
    results.push(r);
    log("backup_target", { runId: c.runId, kind: r.kind, id: r.id, status: r.status, bytes: r.bytes ?? null, durationMs: r.durationMs, error: r.error ?? null });
  };

  const tenants = (await d.reader.listTenants())
    .filter((t) => BACKUP_TENANT_STATUSES.includes(t.status))
    .filter((t) => !d.only || d.only.includes(t.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const t of tenants) {
    const t0 = now();
    let dsn: string | null = null;
    let alias: string | null = null;
    try {
      dsn = await d.tenantDsn(t.id);
      alias = (await d.reader.getActiveDatabase(t.id))?.serverAlias ?? null;
    } catch (e) {
      // Sin DSN legible (p. ej. clave del registro ausente): se registra como fallo
      const id = await c.inventory.start({ runId: c.runId, targetKind: "tenant", targetId: t.id, startedAt: t0, storageKind: c.storage.kind });
      const msg = safeError(e);
      await c.inventory.fail(id, now(), msg);
      record({ kind: "tenant", id: t.id, status: "failed", inventoryId: id, durationMs: now() - t0, error: msg });
      continue;
    }
    if (!dsn) {
      const id = await c.inventory.start({ runId: c.runId, targetKind: "tenant", targetId: t.id, startedAt: t0, storageKind: c.storage.kind });
      await c.inventory.fail(id, now(), "La empresa no tiene base de datos activa");
      record({ kind: "tenant", id: t.id, status: "failed", inventoryId: id, durationMs: now() - t0, error: "La empresa no tiene base de datos activa" });
      continue;
    }
    record(await backupTarget({ kind: "tenant", id: t.id, dsn, serverAlias: alias, schemaVersion: t.schemaVersion }, c));
    if (d.media) record(await backupTenantFiles(t.id, d.media, c));
  }

  if (d.includePlatform !== false) {
    if (d.registryDsn) record(await backupTarget({ kind: "registry", id: "registry", dsn: d.registryDsn }, c));
    else record({ kind: "registry", id: "registry", status: "skipped", durationMs: 0, error: "Sin URL del registro" });
    if (d.crmDsn) record(await backupTarget({ kind: "crm", id: "crm", dsn: d.crmDsn }, c));
    else record({ kind: "crm", id: "crm", status: "skipped", durationMs: 0, error: "CRM_DATABASE_URL no configurada" });
  }

  return {
    runId: c.runId,
    startedAt,
    finishedAt: now(),
    storage: d.storage.describe(),
    keyId: d.ring.activeKeyId,
    ok: results.every((r) => r.status !== "failed"),
    results,
  };
}
