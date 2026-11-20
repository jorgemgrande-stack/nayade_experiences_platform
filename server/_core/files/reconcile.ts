/**
 * Reconciliación del almacenamiento de la empresa en curso: detecta los objetos HUÉRFANOS (ficheros activos que ninguna
 * fila de la base de datos referencia) y permite retirarlos de forma segura.
 *
 * Principios:
 *  - Solo la empresa en curso: cada empresa tiene su propia base de datos y su prefijo de bucket (`objectRoot()`);
 *    un objeto cuya clave no esté bajo ese prefijo se clasifica como «ajeno» y no se toca nunca.
 *  - «Huérfano» = cero referencias en CUALQUIER columna de texto de la base de la empresa (id del objeto, URL del Core o
 *    clave del bucket, que contienen el id). No se decide por nombre ni por huella SHA-256: dos recursos que comparten un
 *    mismo objeto lo mantienen referenciado, y un duplicado exacto referenciado por otra fila NO se borra.
 *  - Solo categorías con vida propia conocida (`RECONCILABLE_CATEGORIES`); el resto se cuenta pero no se propone.
 *  - Una subida en curso (`pending`) o reciente (gracia, 24 h por defecto) está protegida.
 *  - Dos pasos: `plan()` (solo lectura, devuelve el informe y una huella del conjunto) y `apply()` (exige esa huella y la
 *    lista explícita de ids; recalcula todo y vuelve a comprobar las referencias bajo bloqueo justo antes de borrar).
 *  - Cada borrado deja la fila (`status = deleted`, `deleted_at`, `error` con el motivo y quién) y un log operativo.
 *    El consumo se calcula de las filas activas, así que baja solo.
 *  - Si el proveedor falla al retirar los bytes, la fila queda `deleted` sin `bytes_removed_at` y `retryRemovals()` lo reintenta.
 */
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { legacyPool } from "../legacyDb";
import { opsLog } from "../ops/log";
import { OBJECT_ID_RE, fileService, objectIdFromUrl, objectRoot, type FileService } from "./service";

/** Categorías con una fuente de referencias conocida: solo estas pueden proponerse para borrado. */
export const RECONCILABLE_CATEGORIES: readonly string[] = ["learning-content", "media"];
export const DEFAULT_GRACE_MS = 24 * 3600 * 1000;
export const MIN_GRACE_MS = 10 * 60 * 1000;
export const MAX_APPLY = 200;
const SCAN_BATCH = 120;
const COLUMNS_TTL_MS = 60_000;
const NEVER_COUNTED = "data-export";

export class ReconcileError extends Error {
  constructor(readonly code: "PLAN_STALE" | "BAD_REQUEST" | "SCAN_FAILED", message: string) {
    super(message);
    this.name = "ReconcileError";
  }
}

export interface ObjectLite {
  objectId: string;
  storageKey: string;
  category: string;
  status: string;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  createdAt: number;
}

export interface OrphanEntry extends ObjectLite {
  fingerprint: string;
  /** ¿Otro objeto referenciado tiene exactamente la misma huella? (solo informativo: no decide el borrado) */
  sameHashAsReferenced: boolean;
}

export interface CategorySummary {
  objects: number;
  bytes: number;
  scanned: boolean;
  referenced: number;
  shared: number;
  orphans: number;
  orphanBytes: number;
  protected: number;
  protectedBytes: number;
  foreign: number;
}

export interface ReconcileReport {
  generatedAt: number;
  graceMs: number;
  scannedColumns: number;
  totals: { objects: number; bytes: number };
  byCategory: Record<string, CategorySummary>;
  orphans: OrphanEntry[];
  orphanBytes: number;
  /** Hay más huérfanos de los listados (límite por ejecución). */
  truncated: boolean;
  protected: Array<ObjectLite & { reason: "pending" | "recent" }>;
  shared: Array<{ objectId: string; category: string; refs: string[] }>;
  /** Objetos referenciados cuyo contenido falta en el proveedor o no mide lo registrado. */
  missing: Array<{ objectId: string; category: string; reason: "absent" | "size_mismatch" | "provider_error" }>;
  /** Huella del conjunto de huérfanos listados: `apply()` la exige. */
  planHash: string;
}

export interface ApplyResult {
  requested: number;
  deleted: number;
  freedBytes: number;
  pendingRemoval: number;
  skipped: Array<{ objectId: string; reason: string }>;
  deletedIds: string[];
}

interface Deps {
  pool?: () => mysql.Pool;
  files?: () => FileService;
  now?: () => number;
}

const q = (name: string) => `\`${name.replace(/`/g, "``")}\``;

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const mine = items[i++];
      await fn(mine);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const chunks = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export const fingerprintOf = (o: Pick<ObjectLite, "objectId" | "sha256" | "sizeBytes" | "storageKey">) =>
  crypto.createHash("sha256").update(`${o.objectId}|${o.sha256}|${o.sizeBytes}|${o.storageKey}`).digest("hex");

/** Huella de un conjunto de objetos: depende de los ids y de su estado exacto (si algo cambió, deja de coincidir). */
export function planHashOf(fps: string[]): string {
  return crypto.createHash("sha256").update([...fps].sort().join("\n")).digest("hex");
}

/** Id de objeto contenido en una URL del Core o en una clave del bucket (`…/<id>.<ext>`); null si no es propio. */
export function objectIdFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const fromUrl = objectIdFromUrl(ref);
  if (fromUrl) return fromUrl;
  const base = ref.split("?")[0].split("/").pop() ?? "";
  const id = base.split(".")[0];
  return OBJECT_ID_RE.test(id) ? id : null;
}

export class StorageReconciler {
  private colCache: { at: number; cols: Array<{ t: string; c: string }> } | null = null;

  constructor(private deps: Deps = {}) {}

  private pool(): mysql.Pool {
    return (this.deps.pool ?? legacyPool)();
  }
  private files(): FileService {
    return (this.deps.files ?? fileService)();
  }
  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Columnas de texto de las tablas de la empresa (salvo `stored_objects`), con caché corta. */
  private async columns(): Promise<Array<{ t: string; c: string }>> {
    if (this.colCache && this.now() - this.colCache.at < COLUMNS_TTL_MS) return this.colCache.cols;
    const [rows] = await this.pool().query(
      `SELECT c.table_name AS t, c.column_name AS c
         FROM information_schema.columns c
         JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
        WHERE c.table_schema = DATABASE()
          AND c.data_type IN ('char','varchar','tinytext','text','mediumtext','longtext','json')
          AND (c.character_maximum_length IS NULL OR c.character_maximum_length >= 26)
          AND c.table_name <> 'stored_objects'
        ORDER BY c.table_name, c.ordinal_position`,
    );
    const cols = (rows as Array<Record<string, unknown>>).map((r) => ({ t: String(r.t ?? r.T), c: String(r.c ?? r.C) }));
    this.colCache = { at: this.now(), cols };
    return cols;
  }

  /**
   * Referencias a cada objeto: `tabla.columna` de todas las columnas de texto que contienen su id (id suelto, URL del
   * Core o clave del bucket). Un fallo de lectura aborta: sin conocer las referencias no se puede decidir nada.
   */
  async scanReferences(ids: string[]): Promise<{ refs: Map<string, string[]>; counts: Map<string, number>; columns: number }> {
    const refs = new Map<string, string[]>();
    const counts = new Map<string, number>();
    const clean = Array.from(new Set(ids)).filter((i) => OBJECT_ID_RE.test(i));
    if (!clean.length) return { refs, counts, columns: 0 };
    const cols = await this.columns();
    const tasks: Array<{ t: string; c: string; batch: string[] }> = [];
    for (const col of cols) for (const batch of chunks(clean, SCAN_BATCH)) tasks.push({ ...col, batch });
    await mapLimit(tasks, 6, async ({ t, c, batch }) => {
      const sums = batch.map((_, i) => `COALESCE(SUM(CAST(${q(c)} AS CHAR) LIKE ?), 0) AS c${i}`).join(", ");
      let row: Record<string, unknown> | undefined;
      try {
        const [res] = await this.pool().query(`SELECT ${sums} FROM ${q(t)}`, batch.map((id) => `%${id}%`));
        row = (res as Array<Record<string, unknown>>)[0];
      } catch (err) {
        throw new ReconcileError("SCAN_FAILED", `No se pudo leer ${t}.${c}: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
      }
      if (!row) return;
      batch.forEach((id, i) => {
        const n = Number(row![`c${i}`] ?? 0);
        if (n > 0) {
          const list = refs.get(id) ?? [];
          list.push(`${t}.${c}`);
          refs.set(id, list);
          counts.set(id, (counts.get(id) ?? 0) + n);
        }
      });
    });
    return { refs, counts, columns: cols.length };
  }

  private async loadObjects(where = "", params: unknown[] = []): Promise<ObjectLite[]> {
    const [rows] = await this.pool().query(
      `SELECT object_id, storage_key, category, status, size_bytes, sha256, original_name, created_at
         FROM stored_objects WHERE status IN ('pending','active') AND category <> ? ${where} ORDER BY created_at, object_id`,
      [NEVER_COUNTED, ...params],
    );
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      objectId: String(r.object_id),
      storageKey: String(r.storage_key),
      category: String(r.category),
      status: String(r.status),
      sizeBytes: Number(r.size_bytes),
      sha256: String(r.sha256),
      originalName: r.original_name == null ? null : String(r.original_name),
      createdAt: Number(r.created_at),
    }));
  }

  /** Informe previo (solo lectura): nunca modifica ni la base de datos ni el almacén. */
  async plan(o: { graceMs?: number; limit?: number; categories?: string[]; checkProvider?: boolean } = {}): Promise<ReconcileReport> {
    const grace = Math.max(MIN_GRACE_MS, o.graceMs ?? DEFAULT_GRACE_MS);
    const limit = Math.min(MAX_APPLY, Math.max(1, o.limit ?? MAX_APPLY));
    const cats = (o.categories?.length ? o.categories : [...RECONCILABLE_CATEGORIES]).filter((c) => RECONCILABLE_CATEGORIES.includes(c));
    const now = this.now();
    const root = objectRoot();
    const all = await this.loadObjects();
    const byCategory: Record<string, CategorySummary> = {};
    const sum = (cat: string) =>
      (byCategory[cat] ??= { objects: 0, bytes: 0, scanned: cats.includes(cat), referenced: 0, shared: 0, orphans: 0, orphanBytes: 0, protected: 0, protectedBytes: 0, foreign: 0 });
    for (const x of all) {
      const s = sum(x.category);
      s.objects++;
      s.bytes += x.sizeBytes;
    }
    const foreign = all.filter((x) => !x.storageKey.startsWith(root));
    for (const x of foreign) sum(x.category).foreign++;
    const own = all.filter((x) => x.storageKey.startsWith(root));
    const protectedList: ReconcileReport["protected"] = [];
    const scannable = own.filter((x) => cats.includes(x.category));
    const pendingOnes = scannable.filter((x) => x.status !== "active");
    for (const x of pendingOnes) {
      protectedList.push({ ...x, reason: "pending" });
      const s = sum(x.category);
      s.protected++;
      s.protectedBytes += x.sizeBytes;
    }
    const active = scannable.filter((x) => x.status === "active");
    const { refs, counts, columns } = await this.scanReferences(active.map((x) => x.objectId));
    const referenced: ObjectLite[] = [];
    const shared: ReconcileReport["shared"] = [];
    const orphansAll: OrphanEntry[] = [];
    const refHashes = new Set<string>();
    for (const x of active) {
      const r = refs.get(x.objectId);
      if (r?.length) {
        referenced.push(x);
        refHashes.add(x.sha256);
      }
    }
    for (const x of active) {
      const r = refs.get(x.objectId);
      const s = sum(x.category);
      if (r?.length) {
        s.referenced++;
        // «Compartido» = varias filas lo usan (dos recursos, dos entradas…), no solo varias columnas
        if ((counts.get(x.objectId) ?? 0) > 1) {
          s.shared++;
          shared.push({ objectId: x.objectId, category: x.category, refs: r.slice(0, 6) });
        }
        continue;
      }
      if (now - x.createdAt < grace) {
        protectedList.push({ ...x, reason: "recent" });
        s.protected++;
        s.protectedBytes += x.sizeBytes;
        continue;
      }
      s.orphans++;
      s.orphanBytes += x.sizeBytes;
      orphansAll.push({ ...x, fingerprint: fingerprintOf(x), sameHashAsReferenced: refHashes.has(x.sha256) });
    }
    orphansAll.sort((a, b) => b.sizeBytes - a.sizeBytes || a.objectId.localeCompare(b.objectId));
    const orphans = orphansAll.slice(0, limit);
    const missing: ReconcileReport["missing"] = [];
    if (o.checkProvider !== false) {
      const backend = this.files().storage;
      await mapLimit(referenced, 8, async (x) => {
        try {
          const st = await backend.stat(x.storageKey);
          if (!st) missing.push({ objectId: x.objectId, category: x.category, reason: "absent" });
          else if (st.bytes !== x.sizeBytes) missing.push({ objectId: x.objectId, category: x.category, reason: "size_mismatch" });
        } catch {
          missing.push({ objectId: x.objectId, category: x.category, reason: "provider_error" });
        }
      });
    }
    return {
      generatedAt: now,
      graceMs: grace,
      scannedColumns: columns,
      totals: { objects: all.length, bytes: all.reduce((a, x) => a + x.sizeBytes, 0) },
      byCategory,
      orphans,
      orphanBytes: orphans.reduce((a, x) => a + x.sizeBytes, 0),
      truncated: orphansAll.length > orphans.length,
      protected: protectedList,
      shared,
      missing: missing.sort((a, b) => a.objectId.localeCompare(b.objectId)),
      planHash: planHashOf(orphans.map((x) => x.fingerprint)),
    };
  }

  /** Retira los bytes de un objeto ya marcado `deleted` (objeto y ficha de metadatos) y anota cuándo. */
  private async removeBytes(row: { objectId: string; storageKey: string }): Promise<boolean> {
    try {
      const f = this.files();
      await f.storage.delete(row.storageKey);
      await f.storage.delete(f.sidecarKey(row.storageKey, row.objectId));
      const at = this.now();
      await this.pool().query("UPDATE stored_objects SET bytes_removed_at = ?, updated_at = ? WHERE object_id = ?", [at, at, row.objectId]);
      return true;
    } catch {
      opsLog("warn", "Storage", "reconcile_removal_deferred", { objectId: row.objectId });
      return false;
    }
  }

  /**
   * Marca como borrado UN objeto bajo bloqueo de fila y tras volver a comprobar su estado: es la única vía de borrado.
   * Devuelve el motivo si no se pudo.
   */
  private async deleteOne(objectId: string, why: string, o: { graceMs: number; categories: readonly string[]; recheckRefs: boolean }): Promise<{ ok: true; row: ObjectLite } | { ok: false; reason: string }> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rs] = await conn.query(
        "SELECT object_id, storage_key, category, status, size_bytes, sha256, original_name, created_at FROM stored_objects WHERE object_id = ? FOR UPDATE",
        [objectId],
      );
      const r = (rs as Array<Record<string, unknown>>)[0];
      if (!r) {
        await conn.rollback();
        return { ok: false, reason: "not_found" };
      }
      const row: ObjectLite = {
        objectId: String(r.object_id),
        storageKey: String(r.storage_key),
        category: String(r.category),
        status: String(r.status),
        sizeBytes: Number(r.size_bytes),
        sha256: String(r.sha256),
        originalName: r.original_name == null ? null : String(r.original_name),
        createdAt: Number(r.created_at),
      };
      const skip = async (reason: string) => {
        await conn.rollback();
        return { ok: false as const, reason };
      };
      if (!row.storageKey.startsWith(objectRoot())) return skip("foreign_tenant");
      if (row.status !== "active") return skip(`status_${row.status}`);
      if (!o.categories.includes(row.category)) return skip("category_not_reconcilable");
      if (this.now() - row.createdAt < o.graceMs) return skip("recent");
      // Última comprobación, ya con la fila bloqueada: las referencias «calientes» (formación y biblioteca del CMS)
      if (o.recheckRefs) {
        const cols = await this.columns();
        for (const [t, c] of [["learning_resources", "stored_object_id"], ["media_files", "url"], ["media_files", "fileKey"], ["media_files", "file_key"]] as const) {
          if (!cols.some((x) => x.t === t && x.c === c)) continue;
          const like = c === "stored_object_id" ? objectId : `%${objectId}%`;
          const [hit] = await conn.query(`SELECT 1 AS x FROM ${q(t)} WHERE ${q(c)} ${c === "stored_object_id" ? "=" : "LIKE"} ? LIMIT 1`, [like]);
          if ((hit as unknown[]).length) return skip("referenced");
        }
      }
      const at = this.now();
      const [upd] = await conn.query("UPDATE stored_objects SET status = 'deleted', deleted_at = ?, updated_at = ?, error = ? WHERE object_id = ? AND status = 'active'", [at, at, why.slice(0, 250), objectId]);
      if (Number((upd as { affectedRows?: number }).affectedRows ?? 0) !== 1) return skip("changed");
      await conn.commit();
      return { ok: true, row };
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Borra los huérfanos indicados. `planHash` es el del informe previo de ese mismo conjunto de ids: si algo cambió desde
   * entonces (objeto nuevo, referencia, tamaño…) la huella no coincide y no se borra nada.
   */
  async apply(o: { objectIds: string[]; planHash: string; graceMs?: number; actor?: string }): Promise<ApplyResult> {
    const ids = Array.from(new Set(o.objectIds));
    if (!ids.length) throw new ReconcileError("BAD_REQUEST", "Indica los objetos a eliminar.");
    if (ids.length > MAX_APPLY) throw new ReconcileError("BAD_REQUEST", `Máximo ${MAX_APPLY} objetos por ejecución.`);
    if (ids.some((i) => !OBJECT_ID_RE.test(i))) throw new ReconcileError("BAD_REQUEST", "Identificador de objeto no válido.");
    const grace = Math.max(MIN_GRACE_MS, o.graceMs ?? DEFAULT_GRACE_MS);
    const [rows] = await this.pool().query(
      `SELECT object_id, storage_key, category, status, size_bytes, sha256, original_name, created_at FROM stored_objects WHERE object_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    const byId = new Map<string, ObjectLite>();
    for (const r of rows as Array<Record<string, unknown>>) {
      byId.set(String(r.object_id), {
        objectId: String(r.object_id),
        storageKey: String(r.storage_key),
        category: String(r.category),
        status: String(r.status),
        sizeBytes: Number(r.size_bytes),
        sha256: String(r.sha256),
        originalName: r.original_name == null ? null : String(r.original_name),
        createdAt: Number(r.created_at),
      });
    }
    const fps = ids.map((id) => (byId.has(id) ? fingerprintOf(byId.get(id)!) : `missing:${id}`));
    if (planHashOf(fps) !== o.planHash) throw new ReconcileError("PLAN_STALE", "El informe previo ya no coincide con el estado actual. Genera uno nuevo y confírmalo.");
    // Segunda lectura completa de referencias justo antes de borrar
    const { refs } = await this.scanReferences(ids);
    const result: ApplyResult = { requested: ids.length, deleted: 0, freedBytes: 0, pendingRemoval: 0, skipped: [], deletedIds: [] };
    const actor = (o.actor ?? "admin").replace(/[^\w:.@-]/g, "").slice(0, 40);
    for (const id of ids) {
      if (refs.get(id)?.length) {
        result.skipped.push({ objectId: id, reason: "referenced" });
        continue;
      }
      const r = await this.deleteOne(id, `reconcile:orphan by ${actor}`, { graceMs: grace, categories: RECONCILABLE_CATEGORIES, recheckRefs: true });
      if (!r.ok) {
        result.skipped.push({ objectId: id, reason: r.reason });
        continue;
      }
      result.deleted++;
      result.freedBytes += r.row.sizeBytes;
      result.deletedIds.push(id);
      opsLog("info", "Storage", "reconcile_object_deleted", { objectId: id, category: r.row.category, sizeBytes: r.row.sizeBytes, actor });
      if (!(await this.removeBytes(r.row))) result.pendingRemoval++;
    }
    return result;
  }

  /** Reintenta retirar los bytes de objetos ya borrados cuyo proveedor falló antes. */
  async retryRemovals(limit = 100): Promise<{ retried: number; removed: number; failed: number }> {
    const [rows] = await this.pool().query(
      "SELECT object_id, storage_key FROM stored_objects WHERE status = 'deleted' AND bytes_removed_at IS NULL AND storage_key LIKE ? ORDER BY updated_at LIMIT ?",
      [`${objectRoot().replace(/[%_]/g, "\\$&")}%`, Math.min(500, Math.max(1, limit))],
    );
    let removed = 0;
    let failed = 0;
    const list = rows as Array<Record<string, unknown>>;
    for (const r of list) {
      if (await this.removeBytes({ objectId: String(r.object_id), storageKey: String(r.storage_key) })) removed++;
      else failed++;
    }
    return { retried: list.length, removed, failed };
  }

  /**
   * Para el borrado desde la biblioteca multimedia: si el objeto no tiene NINGUNA referencia (la fila de biblioteca ya
   * se retiró), se elimina; si otra cosa lo usa, se conserva. Nunca lanza por falta de objeto.
   */
  async releaseIfUnreferenced(ref: { url?: string | null; fileKey?: string | null }, actor = "biblioteca"): Promise<{ released: boolean; reason: string; objectId?: string; freedBytes?: number }> {
    const objectId = objectIdFromRef(ref.url) ?? objectIdFromRef(ref.fileKey);
    if (!objectId) return { released: false, reason: "no_object" };
    const { refs } = await this.scanReferences([objectId]);
    if (refs.get(objectId)?.length) return { released: false, reason: "referenced", objectId };
    const r = await this.deleteOne(objectId, `media-delete by ${actor}`.slice(0, 250), { graceMs: 0, categories: ["media"], recheckRefs: true });
    if (!r.ok) return { released: false, reason: r.reason, objectId };
    opsLog("info", "Storage", "media_object_released", { objectId, sizeBytes: r.row.sizeBytes, actor });
    await this.removeBytes(r.row);
    return { released: true, reason: "deleted", objectId, freedBytes: r.row.sizeBytes };
  }
}

let defaultReconciler: StorageReconciler | null = null;
export function storageReconciler(): StorageReconciler {
  return (defaultReconciler ??= new StorageReconciler());
}
/** Solo pruebas. */
export function setStorageReconcilerForTests(r: StorageReconciler | null): void {
  defaultReconciler = r;
}
