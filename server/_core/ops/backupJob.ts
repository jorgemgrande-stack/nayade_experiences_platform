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
 * Destino secundario (opcional, `secondary`): tras la copia correcta en el primario, el MISMO objeto
 * cifrado y el MISMO manifiesto firmado se escriben en el secundario y se verifican por SHA-256; su
 * resultado queda en `backup_copies` (migración 0011). Un fallo o un retraso del secundario (tiempo
 * máximo) nunca invalida ni borra la copia primaria: se registra como fallo del secundario.
 *
 * Al final, si se indica `recovery`, se escribe el paquete de configuración para recuperación (sin
 * secretos) en cada destino.
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
import type { BackupStorage, MediaTarget } from "./backupStorage";
import { withTimeout } from "./backupStorage";
import type { BackupCopyLedger, BackupDestination, RestoreSource } from "./backupCopies";
import { writeRecoveryPackage, type RecoveryPackage } from "./recoveryPackage";
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

export interface SecondaryResult {
  status: "ok" | "failed";
  bytes?: number;
  durationMs: number;
  error?: string;
}

export interface TargetResult {
  kind: BackupTargetKind | "config";
  id: string;
  status: "ok" | "failed" | "skipped";
  inventoryId?: number;
  bytes?: number;
  durationMs: number;
  error?: string;
  /** Resultado en el destino secundario (si está configurado). */
  secondary?: SecondaryResult;
}

/** Destino secundario: almacenamiento (o el motivo por el que no está disponible) y su registro. */
export interface SecondaryTarget {
  storage: BackupStorage | null;
  /** Motivo si `storage` es null (configuración incompleta, migración 0011 ausente…). */
  unavailableReason?: string;
  copies: BackupCopyLedger | null;
  /** Tiempo máximo de cada operación de copia en el secundario (por defecto 10 min). */
  timeoutMs?: number;
}

interface Ctx {
  storage: BackupStorage;
  ring: Keyring;
  inventory: BackupInventory;
  runId: string;
  tmpDir: string;
  now: () => number;
  secondary?: SecondaryTarget;
}

const DEFAULT_SECONDARY_TIMEOUT_MS = 10 * 60_000;

/** Anota en `backup_copies` el resultado del secundario; nunca lanza. */
async function recordSecondary(
  c: Ctx,
  base: { backupId: number | null; kind: TargetResult["kind"]; id: string; startedAt: number },
  r: { ok: boolean; location?: string | null; manifestKey?: string | null; bytes?: number | null; sha256?: string | null; error?: string },
): Promise<SecondaryResult> {
  const finished = c.now();
  const s = c.secondary!;
  const result: SecondaryResult = r.ok
    ? { status: "ok", bytes: r.bytes ?? undefined, durationMs: finished - base.startedAt }
    : { status: "failed", durationMs: finished - base.startedAt, error: r.error ?? "Error" };
  if (s.copies) {
    try {
      await s.copies.record({
        backupId: base.backupId,
        destination: "secondary",
        runId: c.runId,
        targetKind: base.kind,
        targetId: base.id,
        status: r.ok ? "ok" : "failed",
        storage: s.storage?.describe() ?? null,
        location: r.location ?? null,
        manifestKey: r.manifestKey ?? null,
        bytes: r.bytes ?? null,
        sha256: r.sha256 ?? null,
        startedAt: base.startedAt,
        finishedAt: finished,
        error: r.ok ? null : (r.error ?? "Error"),
      });
    } catch (e) {
      return { status: "failed", durationMs: finished - base.startedAt, error: `No se pudo registrar el estado del secundario: ${safeError(e)}` };
    }
  }
  return result;
}

/**
 * Escribe en el secundario el mismo objeto cifrado y el mismo manifiesto que en el primario y los
 * verifica (SHA-256 del objeto, igualdad del manifiesto). Nunca lanza: devuelve el resultado.
 */
async function replicateToSecondary(
  c: Ctx,
  x: { backupId: number; kind: Exclude<BackupTargetKind, "files">; id: string; objectKey: string; objectFile: string; sha256: string; bytes: number; manifestKey: string; manifest: Buffer },
): Promise<SecondaryResult> {
  const s = c.secondary!;
  const startedAt = c.now();
  const base = { backupId: x.backupId, kind: x.kind, id: x.id, startedAt };
  if (!s.storage) return recordSecondary(c, base, { ok: false, error: s.unavailableReason ?? "Destino secundario no disponible" });
  const st = s.storage;
  const timeout = s.timeoutMs ?? DEFAULT_SECONDARY_TIMEOUT_MS;
  try {
    await withTimeout(
      (async () => {
        await st.putFile(x.objectKey, x.objectFile);
        const remote = await st.hash(x.objectKey);
        if (remote.sha256 !== x.sha256 || remote.bytes !== x.bytes) throw new Error("La copia almacenada en el secundario no coincide con la subida (SHA-256)");
        await st.putBuffer(x.manifestKey, x.manifest);
        const back = await st.getBuffer(x.manifestKey);
        if (!back || !back.equals(x.manifest)) throw new Error("El manifiesto almacenado en el secundario no coincide con el subido");
      })(),
      timeout,
      "Destino secundario",
    );
    return recordSecondary(c, base, { ok: true, location: x.objectKey, manifestKey: x.manifestKey, bytes: x.bytes, sha256: x.sha256 });
  } catch (err) {
    // Sin restos a medias en el secundario (sin esperar si está caído)
    await withTimeout(Promise.allSettled([st.delete(x.manifestKey), st.delete(x.objectKey)]), 15_000, "Limpieza del secundario").catch(() => undefined);
    return recordSecondary(c, base, { ok: false, error: safeError(err) });
  }
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
    const result: TargetResult = { kind: t.kind, id: t.id, status: "ok", inventoryId: invId, bytes: e.bytes, durationMs: finished - started };
    // La copia primaria ya es válida: el secundario no puede invalidarla (replicateToSecondary no lanza)
    if (c.secondary) {
      result.secondary = await replicateToSecondary(c, {
        backupId: invId,
        kind: t.kind,
        id: t.id,
        objectKey: keys.object,
        objectFile: enc,
        sha256: e.sha256,
        bytes: e.bytes,
        manifestKey: keys.manifest,
        manifest: body,
      });
    }
    return result;
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

const emptyIndex = (tenantId: string, at: number): FilesIndex => ({
  format: "elephant-files-index",
  version: 1,
  tenantId,
  updatedAt: new Date(at).toISOString(),
  entries: {},
});

const sameFile = (prev: FilesIndexEntry | undefined, o: { bytes: number; etag?: string }) =>
  !!prev && prev.bytes === o.bytes && (prev.etag ?? null) === (o.etag ?? null);

/** Sube un objeto cifrado y verifica su SHA-256 en el almacenamiento. */
async function putVerified(storage: BackupStorage, key: string, enc: Buffer): Promise<void> {
  await storage.putBuffer(key, enc);
  const remote = await storage.hash(key);
  if (remote.sha256 !== crypto.createHash("sha256").update(enc).digest("hex")) throw new Error("Fichero almacenado distinto del subido");
}

/**
 * Réplica incremental y cifrada de los ficheros de una empresa (`t/<empresa>/…` del bucket de medios).
 * Solo añade: un fichero borrado en el origen se conserva en la copia. Un índice cifrado guarda qué
 * se copió (clave, tamaño, ETag, SHA-256).
 *
 * Con destino secundario, cada destino tiene su propio índice (`files/<empresa>/index.json.enc` en
 * cada almacenamiento): cada fichero se lee una sola vez del origen y se sube a los destinos que no lo
 * tienen. Un fallo del secundario lo deja fuera del resto de la pasada y no afecta al primario.
 */
export async function backupTenantFiles(tenantId: string, media: MediaSource, c: Ctx): Promise<TargetResult> {
  const started = c.now();
  const invId = await c.inventory.start({ runId: c.runId, targetKind: "files", targetId: tenantId, startedAt: started, storageKind: c.storage.kind });
  const sec = c.secondary;
  const secTimeout = sec?.timeoutMs ?? DEFAULT_SECONDARY_TIMEOUT_MS;
  let secIndex: FilesIndex | null = null;
  let secError: string | undefined = sec && !sec.storage ? (sec.unavailableReason ?? "Destino secundario no disponible") : undefined;
  let secCopied = 0;
  let secBytes = 0;
  if (sec?.storage) {
    try {
      secIndex = (await withTimeout(readFilesIndex(sec.storage, c.ring, tenantId), secTimeout, "Destino secundario")) ?? emptyIndex(tenantId, started);
    } catch (e) {
      secError = safeError(e);
    }
  }
  const secAlive = () => !!sec?.storage && !!secIndex && !secError;
  try {
    const index: FilesIndex = (await readFilesIndex(c.storage, c.ring, tenantId)) ?? emptyIndex(tenantId, started);
    let copied = 0;
    let copiedBytes = 0;
    for (const o of await media.list(filesPrefix(tenantId))) {
      const needPrimary = !sameFile(index.entries[o.key], o);
      const needSecondary = secAlive() && !sameFile(secIndex!.entries[o.key], o);
      if (!needPrimary && !needSecondary) continue;
      const data = await media.get(o.key);
      const sha = crypto.createHash("sha256").update(data).digest("hex");
      const objKey = `files/${tenantId}/objects/${crypto.createHash("sha256").update(o.key).digest("hex").slice(0, 32)}-${sha.slice(0, 16)}.enc`;
      const enc = encryptBuffer(data, c.ring, backupAad("files", `${tenantId}:${o.key}`));
      const entry: FilesIndexEntry = { bytes: o.bytes, etag: o.etag ?? null, sha256: sha, object: objKey, copiedAt: new Date(c.now()).toISOString() };
      if (needPrimary) {
        await putVerified(c.storage, objKey, enc);
        index.entries[o.key] = entry;
        copied++;
        copiedBytes += enc.length;
      }
      if (needSecondary) {
        try {
          await withTimeout(putVerified(sec!.storage!, objKey, enc), secTimeout, "Destino secundario");
          secIndex!.entries[o.key] = entry;
          secCopied++;
          secBytes += enc.length;
        } catch (e) {
          secError = safeError(e);
        }
      }
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
    const result: TargetResult = { kind: "files", id: tenantId, status: "ok", inventoryId: invId, bytes: copiedBytes, durationMs: finished - started };
    if (sec) {
      const base = { backupId: invId, kind: "files" as const, id: tenantId, startedAt: started };
      let secIndexSha: string | null = null;
      if (secAlive()) {
        try {
          secIndex!.updatedAt = new Date(c.now()).toISOString();
          const encSec = encryptBuffer(Buffer.from(JSON.stringify(secIndex), "utf8"), c.ring, backupAad("files-index", tenantId));
          await withTimeout(putVerified(sec.storage!, filesIndexKey(tenantId), encSec), secTimeout, "Destino secundario");
          secIndexSha = crypto.createHash("sha256").update(encSec).digest("hex");
        } catch (e) {
          secError = safeError(e);
        }
      }
      result.secondary = await recordSecondary(
        c,
        base,
        secError ? { ok: false, error: secError } : { ok: true, location: filesIndexKey(tenantId), bytes: secBytes, sha256: secIndexSha },
      );
      void secCopied;
    }
    return result;
  } catch (err) {
    const msg = safeError(err);
    const finished = c.now();
    await c.inventory.fail(invId, finished, msg);
    const result: TargetResult = { kind: "files", id: tenantId, status: "failed", inventoryId: invId, durationMs: finished - started, error: msg };
    if (sec) result.secondary = await recordSecondary(c, { backupId: invId, kind: "files", id: tenantId, startedAt: started }, { ok: false, error: secError ?? `Pasada interrumpida por un fallo del primario: ${msg}` });
    return result;
  }
}

/**
 * Recupera los ficheros de una empresa desde la réplica (del destino que se pase) a un directorio
 * local o, con `target`, al bucket de medios indicado (p. ej. el nuevo tras un desastre). Solo
 * escribe claves de ESA empresa (`t/<empresa>/…`); cada fichero se comprueba por SHA-256.
 */
export async function restoreTenantFiles(
  d: { storage: BackupStorage; ring: Keyring; copies?: BackupCopyLedger | null; source?: RestoreSource; actor?: string; now?: () => number },
  tenantId: string,
  out: string | MediaTarget,
): Promise<{ files: number; bytes: number; source: RestoreSource }> {
  const now = d.now ?? Date.now;
  const source = d.source ?? "primary";
  const logId = d.copies ? await d.copies.restoreStarted({ startedAt: now(), actor: d.actor ?? "operador", source, targetKind: "files", targetId: tenantId }).catch(() => null) : null;
  try {
    const index = await readFilesIndex(d.storage, d.ring, tenantId);
    if (!index) throw new Error("No hay réplica de ficheros para esa empresa");
    let files = 0;
    let bytes = 0;
    const root = typeof out === "string" ? path.resolve(out) : null;
    for (const [key, e] of Object.entries(index.entries)) {
      if (!key.startsWith(filesPrefix(tenantId))) throw new Error("Clave de fichero de otra empresa en la réplica");
      const buf = await d.storage.getBuffer(e.object);
      if (!buf) throw new Error(`Falta el objeto de ${key}`);
      const plain = decryptBuffer(buf, d.ring, backupAad("files", `${tenantId}:${key}`));
      if (crypto.createHash("sha256").update(plain).digest("hex") !== e.sha256) throw new Error(`SHA-256 distinto en ${key}`);
      if (root) {
        const dst = path.resolve(root, ...key.split("/"));
        if (!dst.startsWith(root + path.sep)) throw new Error("Clave de fichero no válida");
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, plain);
      } else await (out as MediaTarget).put(key, plain);
      files++;
      bytes += plain.length;
    }
    if (logId) await d.copies!.restoreFinished(logId, { finishedAt: now(), status: "ok", verified: true, filesCount: files }).catch(() => undefined);
    return { files, bytes, source };
  } catch (e) {
    if (logId) await d.copies!.restoreFinished(logId, { finishedAt: now(), status: "failed", verified: false, error: safeError(e) }).catch(() => undefined);
    throw e;
  }
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
  /** Destino secundario (opcional). Sin él, todo como siempre. */
  secondary?: SecondaryTarget;
  /** Registro de copias por destino (0011) para anotar el paquete de recuperación del primario. */
  copies?: BackupCopyLedger | null;
  /** Genera el paquete de configuración para recuperación (sin secretos) al final de la ejecución. */
  recovery?: (results: TargetResult[], runId: string) => Promise<RecoveryPackage>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface BackupJobReport {
  runId: string;
  startedAt: number;
  finishedAt: number;
  storage: string;
  keyId: string;
  /** Copias del destino PRIMARIO (lo que había antes del secundario). */
  ok: boolean;
  /** Estado del destino secundario: `null` si no está configurado. */
  secondary: { storage: string | null; ok: boolean; failed: number; copied: number; reason?: string } | null;
  /** Medidas de la ejecución (tamaño y duración), para estimar almacenamiento y coste. */
  metrics: { durationMs: number; bytes: Record<string, number>; durations: Record<string, number> };
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
    secondary: d.secondary,
  };
  const log = d.log ?? (() => undefined);
  const startedAt = now();
  const results: TargetResult[] = [];
  const record = (r: TargetResult) => {
    results.push(r);
    log("backup_target", {
      runId: c.runId,
      kind: r.kind,
      id: r.id,
      status: r.status,
      bytes: r.bytes ?? null,
      durationMs: r.durationMs,
      error: r.error ?? null,
      ...(r.secondary ? { secondary: r.secondary.status, secondaryMs: r.secondary.durationMs, secondaryError: r.secondary.error ?? null } : {}),
    });
    if (r.secondary?.status === "failed") log("secondary_failed", { runId: c.runId, kind: r.kind, id: r.id, error: r.secondary.error ?? null });
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

  if (d.recovery) record(await writeRecoveryEverywhere(d, c, results));

  const bytes: Record<string, number> = {};
  const durations: Record<string, number> = {};
  for (const r of results) {
    bytes[r.kind] = (bytes[r.kind] ?? 0) + (r.bytes ?? 0);
    durations[r.kind] = (durations[r.kind] ?? 0) + r.durationMs;
  }
  const secResults = results.map((r) => r.secondary).filter((x): x is SecondaryResult => !!x);
  return {
    runId: c.runId,
    startedAt,
    finishedAt: now(),
    storage: d.storage.describe(),
    keyId: d.ring.activeKeyId,
    ok: results.filter((r) => r.kind !== "config").every((r) => r.status !== "failed"),
    secondary: d.secondary
      ? {
          storage: d.secondary.storage?.describe() ?? null,
          ok: !!d.secondary.storage && secResults.every((s) => s.status === "ok"),
          failed: secResults.filter((s) => s.status === "failed").length,
          copied: secResults.filter((s) => s.status === "ok").length,
          ...(d.secondary.storage ? {} : { reason: d.secondary.unavailableReason ?? "Destino secundario no disponible" }),
        }
      : null,
    metrics: { durationMs: now() - startedAt, bytes, durations },
    results,
  };
}

/** Paquete de recuperación en el primario y (si hay) en el secundario; un fallo no invalida las copias. */
async function writeRecoveryEverywhere(d: BackupJobDeps, c: Ctx, results: TargetResult[]): Promise<TargetResult> {
  const t0 = c.now();
  let pkg: RecoveryPackage;
  try {
    pkg = await d.recovery!(results, c.runId);
  } catch (e) {
    return { kind: "config", id: "recovery", status: "failed", durationMs: c.now() - t0, error: safeError(e) };
  }
  const result: TargetResult = { kind: "config", id: "recovery", status: "ok", durationMs: 0 };
  try {
    const w = await writeRecoveryPackage(c.storage, c.ring, pkg, t0);
    result.bytes = w.bytes;
    await d.copies
      ?.record({ backupId: null, destination: "primary", runId: c.runId, targetKind: "config", targetId: "recovery", status: "ok", storage: c.storage.describe(), location: w.keys[0], manifestKey: null, bytes: w.bytes, sha256: null, startedAt: t0, finishedAt: c.now(), error: null })
      .catch(() => undefined);
  } catch (e) {
    Object.assign(result, { status: "failed", error: safeError(e) });
  }
  result.durationMs = c.now() - t0;
  const sec = c.secondary;
  if (sec) {
    const s0 = c.now();
    const base = { backupId: null, kind: "config" as const, id: "recovery", startedAt: s0 };
    if (!sec.storage) result.secondary = await recordSecondary(c, base, { ok: false, error: sec.unavailableReason ?? "Destino secundario no disponible" });
    else {
      try {
        const w = await withTimeout(writeRecoveryPackage(sec.storage, c.ring, pkg, t0), sec.timeoutMs ?? DEFAULT_SECONDARY_TIMEOUT_MS, "Destino secundario");
        result.secondary = await recordSecondary(c, base, { ok: true, location: w.keys[0], bytes: w.bytes });
      } catch (e) {
        result.secondary = await recordSecondary(c, base, { ok: false, error: safeError(e) });
      }
    }
  }
  return result;
}

export type { BackupDestination };

