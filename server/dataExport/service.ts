/**
 * Exportación de datos de la empresa (fase F; decisión D): ZIP con CSV, JSON y ficheros, solo para el
 * PROPIETARIO, enlace firmado de 24 h, registro de cada solicitud, enlace emitido y descarga (`data_exports`,
 * db/migrations/0011 y 0012). Disponible también en solo lectura (los 30 días tras el fin del periodo pagado).
 *
 *  - TRABAJO ASÍNCRONO: la petición solo registra la solicitud (`pending`). La genera un trabajo (job
 *    `data-export` y un primer intento inmediato tras pedirla), que la RECLAMA con un arriendo (`heartbeat_at`):
 *    si el proceso se reinicia, el arriendo caduca y otro intento la retoma (hasta MAX_ATTEMPTS). Una sola
 *    generación a la vez por proceso (DATA_EXPORT_CONCURRENCY).
 *  - STREAMING: el ZIP se escribe en un temporal (./build.ts) leyendo las tablas por lotes en una instantánea
 *    coherente y se sube en streaming (FileService.putFile): la memoria no depende del tamaño de la empresa.
 *  - Sin duplicados: el ZIP tiene como propietario `export:<id>`; antes de subir se retiran los de intentos
 *    anteriores y, si la fila ya no está en curso al terminar, se retira el recién subido.
 *  - Límites por empresa: una en curso (la BD lo garantiza), DATA_EXPORT_DAILY_LIMIT solicitudes al día, tamaño
 *    máximo (DATA_EXPORT_MAX_MB, por defecto 1024; con excepción por empresa en DATA_EXPORT_MAX_MB_OVERRIDES) y
 *    cuotas del gestor de recursos (data_export.runs y data_export.bytes), donde además se registra consumo y
 *    duración.
 *  - Temporales en un directorio propio (0700/0600) que se borra al terminar; los que queden de un proceso
 *    caído se retiran pasadas TEMP_MAX_AGE_MS. Los ZIP entregados NUNCA se borran automáticamente.
 *  - Exportación INCOMPLETA (ficheros registrados que no estaban en el almacenamiento): queda lista con
 *    `warning`, «INCOMPLETA» en el LÉEME y en el manifiesto: nunca como completa.
 *  - Al terminar se avisa por correo a quien la pidió (`notify`): «disponible» o «fallida», sin el enlace.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { opsLog } from "../_core/ops/log";
import { Metrics } from "../_core/metering";
import { writeExport, ExportTooLargeError, type ExportFile, type ExportSource } from "./build";

export type DataExportStatus = "pending" | "ready" | "failed";
export interface DataExport {
  id: number;
  requestedBy: number;
  status: DataExportStatus;
  objectId: string | null;
  sizeBytes: number | null;
  tableCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  /** Motivo del fallo (solo `failed`). */
  error: string | null;
  /** Aviso de exportación incompleta (solo `ready`), o null si está completa. */
  warning: string | null;
  requestedAt: number;
  completedAt: number | null;
  expiresAt: number | null;
  linkCount: number;
  downloadCount: number;
  lastDownloadAt: number | null;
  /** Intentos de generación y arriendo del trabajo (0012). */
  attempts: number;
  startedAt: number | null;
  heartbeatAt: number | null;
  durationMs: number | null;
  uncompressedBytes: number | null;
  missingFiles: number | null;
}

export class DataExportError extends Error {
  constructor(
    readonly code: "forbidden" | "conflict" | "not_found" | "invalid_state" | "unavailable" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "DataExportError";
  }
}

export interface ReadyResult {
  objectId: string;
  sizeBytes: number;
  tableCount: number;
  rowCount: number;
  fileCount: number;
  expiresAt: number;
  warning?: string | null;
  durationMs?: number;
  uncompressedBytes?: number;
  missingFiles?: number;
}

export interface DataExportStore {
  /** `conflict` si ya hay una en curso. `unavailable` sin la migración 0011. */
  insertPending(requestedBy: number, now: number): Promise<DataExport>;
  get(id: number): Promise<DataExport | null>;
  list(limit: number): Promise<DataExport[]>;
  /** Solicitudes desde `since` (límite diario por empresa). */
  countSince(since: number): Promise<number>;
  /**
   * Reclama la exportación en curso más antigua que nadie esté generando (sin latido o con el latido anterior a
   * `staleBefore`) y con intentos por debajo de `maxAttempts`: suma un intento y fija el latido. null si no hay.
   */
  claim(now: number, staleBefore: number, maxAttempts: number): Promise<DataExport | null>;
  heartbeat(id: number, now: number): Promise<void>;
  /** Devuelve la fila a la cola (fallo transitorio): se reintentará cuando caduque el latido. */
  release(id: number, now: number): Promise<void>;
  /** true si estaba en curso y queda lista. */
  markReady(id: number, r: ReadyResult, now: number): Promise<boolean>;
  markFailed(id: number, error: string, now: number): Promise<boolean>;
  /** Marca como fallidas las que agotaron sus intentos y llevan sin latido desde `staleBefore`. Devuelve sus ids. */
  failExhausted(staleBefore: number, maxAttempts: number, error: string, now: number): Promise<number[]>;
  linkIssued(id: number, now: number): Promise<void>;
  /** Descarga de un ZIP de exportación (por id del fichero). false si el fichero no es de una exportación. */
  downloaded(objectId: string, now: number): Promise<boolean>;
}

export const EXPORT_LINK_TTL_MS = 24 * 3600_000;
/** Un intento cuyo latido lleva más que esto sin renovarse se da por interrumpido (reinicio). */
export const LEASE_MS = 5 * 60_000;
export const HEARTBEAT_MS = 60_000;
export const MAX_ATTEMPTS = 3;
export const TEMP_MAX_AGE_MS = 6 * 3600_000;
export const INTERRUPTED_MESSAGE = "La generación se interrumpió varias veces antes de terminar. Solicita una nueva exportación o contacta con soporte.";
const MB = 1048576;

export const exportMaxBytes = (env: NodeJS.ProcessEnv = process.env, tenantId?: string) => {
  const n = Number(env.DATA_EXPORT_MAX_MB);
  let mb = Number.isFinite(n) && n > 0 ? n : 1024;
  // Excepción autorizada por empresa (procedimiento de exportaciones grandes): «empresa:MB,otra:MB»
  if (tenantId)
    for (const part of (env.DATA_EXPORT_MAX_MB_OVERRIDES ?? "").split(",")) {
      const [t, v] = part.split(":").map((s) => s.trim());
      if (t === tenantId && Number(v) > 0) mb = Number(v);
    }
  // Techo: la categoría `data-export` y una sola subida al proveedor
  return Math.min(mb, 4096) * MB;
};
export const exportDailyLimit = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.DATA_EXPORT_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 3;
};
export const exportConcurrency = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.DATA_EXPORT_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 4) : 1;
};

export interface ExportNotice {
  kind: "ready" | "failed";
  export: DataExport;
  to: { email: string; name: string | null };
}

/** Origen abierto para una generación (una instantánea coherente) y su cierre. */
export type OpenedSource = ExportSource & { close?(): Promise<void>; estimate?(): Promise<number> };

export interface DataExportDeps {
  store: DataExportStore;
  /** Abre el origen de datos para una generación (en Mysql: conexión propia con instantánea coherente). */
  openSource: () => Promise<OpenedSource>;
  /** Sube el ZIP (fichero del disco) como fichero privado de la empresa con ese propietario; devuelve su id. */
  saveZip: (z: { filePath: string; sizeBytes: number; sha256: string; name: string; uploadedBy: number; owner: string }) => Promise<string>;
  /** Ficheros ya subidos con ese propietario (intentos anteriores) y su retirada. */
  listOwned?: (owner: string) => Promise<string[]>;
  removeObject?: (objectId: string) => Promise<void>;
  /** Enlace firmado al fichero con esa validez (segundos). */
  signedLink: (objectId: string, ttlSeconds: number) => string;
  /** Datos de quien pidió la exportación (para el aviso). */
  requester?: (userId: number) => Promise<{ email: string; name: string | null } | null>;
  tenantId: string;
  /** Aviso por correo al terminar. Un fallo del aviso no cambia el resultado. */
  notify?: (n: ExportNotice) => Promise<void>;
  /** Gestor de recursos: comprobación de cuota (lanza si se superaría) y registro de consumo. */
  quota?: (metric: string, quantity: number) => Promise<void>;
  meter?: (metric: string, quantity: number, unit: string) => void;
  /** Directorio de temporales y espacio libre en él. */
  tmpRoot?: string;
  freeBytes?: (dir: string) => Promise<number | null>;
  maxBytes?: number;
  dailyLimit?: number;
  now?: () => number;
}

export const EXPORT_METRICS = { RUNS: Metrics.DATA_EXPORT_RUNS, BYTES: Metrics.DATA_EXPORT_BYTES, MS: Metrics.DATA_EXPORT_MS } as const;

/** Huecos de generación por proceso (todas las empresas): una exportación grande no acapara el servidor. */
const slots = { used: 0 };
let lastSweep = 0;

const permanent = (e: unknown) =>
  e instanceof ExportTooLargeError || (e as { name?: string })?.name === "QuotaExceededError" || (e as { name?: string })?.name === "FileValidationError" || (e as { code?: string })?.code === "ENOSPC" || e instanceof NoSpaceError;

class NoSpaceError extends Error {
  constructor() {
    super("No hay espacio temporal suficiente para generar la exportación ahora. Inténtalo más tarde o contacta con soporte.");
    this.name = "NoSpaceError";
  }
}

const message = (e: unknown) =>
  e instanceof ExportTooLargeError || e instanceof NoSpaceError
    ? e.message
    : (e as { name?: string })?.name === "QuotaExceededError"
      ? "Se ha alcanzado el límite de exportaciones de tu empresa para este periodo. Inténtalo más adelante o contacta con soporte."
      : "No se pudo generar la exportación. Inténtalo de nuevo o contacta con soporte.";
const missingWarning = (n: number) =>
  `${n === 1 ? "1 fichero registrado no estaba" : `${n} ficheros registrados no estaban`} en el almacenamiento y no se ${n === 1 ? "ha" : "han"} incluido: la exportación está incompleta (el detalle está en manifest.json). Contacta con soporte.`;

export class DataExportService {
  private now: () => number;
  constructor(private d: DataExportDeps) {
    this.now = d.now ?? Date.now;
  }

  private get tmpRoot() {
    return this.d.tmpRoot ?? path.join(os.tmpdir(), "elephant-data-export");
  }

  /** Solicitud del propietario: solo la registra. La genera el trabajo (`processNext`). */
  async request(user: { id: number; isOwner: boolean }): Promise<DataExport> {
    if (!user.isOwner) throw new DataExportError("forbidden", "Solo la persona propietaria de la empresa puede exportar sus datos");
    const limit = this.d.dailyLimit ?? exportDailyLimit();
    if ((await this.d.store.countSince(this.now() - 24 * 3600_000)) >= limit)
      throw new DataExportError("rate_limited", `Puedes solicitar como mucho ${limit} exportaciones al día. Descarga la última o inténtalo mañana.`);
    if (this.d.quota) {
      try {
        await this.d.quota(EXPORT_METRICS.RUNS, 1);
      } catch (e) {
        if ((e as { name?: string })?.name === "QuotaExceededError") throw new DataExportError("rate_limited", message(e));
        throw e;
      }
    }
    const row = await this.d.store.insertPending(user.id, this.now());
    this.d.meter?.(EXPORT_METRICS.RUNS, 1, "count");
    opsLog("info", "DataExport", "requested", { tenantId: this.d.tenantId, exportId: row.id });
    return row;
  }

  async list(user: { isOwner: boolean }) {
    if (!user.isOwner) throw new DataExportError("forbidden", "Solo la persona propietaria de la empresa puede ver sus exportaciones");
    return this.d.store.list(20);
  }

  /** Enlace de descarga: solo de una exportación lista y dentro de sus 24 h (nunca más allá). */
  async link(user: { isOwner: boolean }, id: number): Promise<{ url: string; expiresAt: number }> {
    if (!user.isOwner) throw new DataExportError("forbidden", "Solo la persona propietaria de la empresa puede descargar sus datos");
    const row = await this.d.store.get(id);
    if (!row) throw new DataExportError("not_found", "Exportación no encontrada");
    if (row.status !== "ready" || !row.objectId || !row.expiresAt) throw new DataExportError("invalid_state", row.status === "pending" ? "La exportación aún se está generando" : "La exportación no se pudo generar");
    const left = Math.floor((row.expiresAt - this.now()) / 1000);
    if (left <= 0) throw new DataExportError("invalid_state", "El enlace de esta exportación caducó (24 h): solicita una nueva");
    await this.d.store.linkIssued(row.id, this.now());
    opsLog("info", "DataExport", "link_issued", { tenantId: this.d.tenantId, exportId: row.id });
    return { url: this.d.signedLink(row.objectId, Math.min(left, EXPORT_LINK_TTL_MS / 1000)), expiresAt: row.expiresAt };
  }

  /**
   * Trabajo: cierra las que agotaron sus intentos, retira temporales caducados y genera la siguiente en cola (si
   * hay hueco en el proceso). Devuelve qué ha hecho. Nunca lanza.
   */
  async processNext(): Promise<"busy" | "idle" | "ready" | "failed" | "retry"> {
    try {
      await this.sweepTemp();
      const exhausted = await this.d.store.failExhausted(this.now() - LEASE_MS, MAX_ATTEMPTS, INTERRUPTED_MESSAGE, this.now());
      for (const id of exhausted) {
        opsLog("warn", "DataExport", "interrupted", { tenantId: this.d.tenantId, exportId: id });
        await this.tellById("failed", id);
      }
    } catch (e) {
      if (e instanceof DataExportError && e.code === "unavailable") return "idle";
      opsLog("error", "DataExport", "housekeeping_failed", { tenantId: this.d.tenantId, error: e instanceof Error ? e.name : "error" });
    }
    if (slots.used >= exportConcurrency()) return "busy";
    slots.used++;
    try {
      const row = await this.d.store.claim(this.now(), this.now() - LEASE_MS, MAX_ATTEMPTS).catch((e) => {
        if (e instanceof DataExportError && e.code === "unavailable") return null;
        throw e;
      });
      if (!row) return "idle";
      return await this.generate(row);
    } catch (e) {
      opsLog("error", "DataExport", "job_failed", { tenantId: this.d.tenantId, error: e instanceof Error ? e.name : "error" });
      return "idle";
    } finally {
      slots.used--;
    }
  }

  private async generate(row: DataExport): Promise<"ready" | "failed" | "retry"> {
    const started = this.now();
    const owner = `export:${row.id}`;
    const dir = path.join(this.tmpRoot, this.d.tenantId.replace(/[^a-z0-9-]/gi, "_"), `${row.id}-${row.attempts}`);
    const beat = setInterval(() => void this.d.store.heartbeat(row.id, this.now()).catch(() => undefined), HEARTBEAT_MS);
    beat.unref?.();
    let source: OpenedSource | null = null;
    try {
      const maxBytes = this.d.maxBytes ?? exportMaxBytes(process.env, this.d.tenantId);
      source = await this.d.openSource();
      // Antes de escribir nada: tamaño estimado frente al máximo, a la cuota y al espacio temporal
      const estimate = source.estimate ? await source.estimate() : 0;
      if (estimate > maxBytes) throw new ExportTooLargeError(estimate, maxBytes);
      if (this.d.quota) await this.d.quota(EXPORT_METRICS.BYTES, estimate);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const free = this.d.freeBytes ? await this.d.freeBytes(dir) : null;
      if (free !== null && free < estimate * 1.2 + 64 * MB) throw new NoSpaceError();
      const file = path.join(dir, "export.zip");
      const built = await writeExport(source, file, {
        tenantId: this.d.tenantId,
        requestedBy: row.requestedBy,
        now: this.now(),
        maxBytes,
        onProgress: () => this.d.store.heartbeat(row.id, this.now()),
      });
      await source.close?.();
      source = null;
      // Reintento: los ZIP que dejara un intento anterior se retiran antes de subir el nuevo (sin duplicados)
      if (this.d.listOwned && this.d.removeObject) for (const old of await this.d.listOwned(owner)) await this.d.removeObject(old);
      const date = new Date(this.now()).toISOString().slice(0, 10);
      const objectId = await this.d.saveZip({ filePath: file, sizeBytes: built.sizeBytes, sha256: built.sha256, name: `exportacion-${this.d.tenantId}-${date}.zip`, uploadedBy: row.requestedBy, owner });
      const warning = built.missingFileCount > 0 ? missingWarning(built.missingFileCount) : null;
      const durationMs = this.now() - started;
      const ok = await this.d.store.markReady(
        row.id,
        { objectId, sizeBytes: built.sizeBytes, tableCount: built.tableCount, rowCount: built.rowCount, fileCount: built.fileCount, expiresAt: this.now() + EXPORT_LINK_TTL_MS, warning, durationMs, uncompressedBytes: built.uncompressedBytes, missingFiles: built.missingFileCount },
        this.now(),
      );
      if (!ok) {
        // Ya no estaba en curso (se dio por interrumpida): no se deja un ZIP sin registro
        await this.d.removeObject?.(objectId).catch(() => undefined);
        opsLog("warn", "DataExport", "discarded", { tenantId: this.d.tenantId, exportId: row.id });
        return "failed";
      }
      this.d.meter?.(EXPORT_METRICS.BYTES, built.uncompressedBytes, "bytes");
      this.d.meter?.(EXPORT_METRICS.MS, durationMs, "ms");
      opsLog(warning ? "warn" : "info", "DataExport", "ready", { tenantId: this.d.tenantId, exportId: row.id, bytes: built.sizeBytes, uncompressed: built.uncompressedBytes, ms: durationMs, tables: built.tableCount, files: built.fileCount, missingFiles: built.missingFileCount, attempt: row.attempts });
      await this.tellById("ready", row.id);
      return "ready";
    } catch (e) {
      const durationMs = this.now() - started;
      this.d.meter?.(EXPORT_METRICS.MS, durationMs, "ms");
      if (!permanent(e) && row.attempts < MAX_ATTEMPTS) {
        // Fallo transitorio (almacenamiento, base de datos): vuelve a la cola y se reintenta al caducar el latido
        opsLog("warn", "DataExport", "retry", { tenantId: this.d.tenantId, exportId: row.id, attempt: row.attempts, error: e instanceof Error ? e.name : "error" });
        await this.d.store.release(row.id, this.now()).catch(() => undefined);
        return "retry";
      }
      opsLog("error", "DataExport", "failed", { tenantId: this.d.tenantId, exportId: row.id, attempt: row.attempts, error: e instanceof Error ? e.name : "error" });
      if (await this.d.store.markFailed(row.id, message(e), this.now()).catch(() => false)) await this.tellById("failed", row.id);
      return "failed";
    } finally {
      clearInterval(beat);
      await source?.close?.().catch(() => undefined);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Temporales de generaciones que ya no siguen (proceso caído): fuera pasadas TEMP_MAX_AGE_MS. */
  private async sweepTemp() {
    if (this.now() - lastSweep < 10 * 60_000) return;
    lastSweep = this.now();
    const root = this.tmpRoot;
    const tenants = await fs.readdir(root).catch(() => [] as string[]);
    for (const t of tenants) {
      for (const job of await fs.readdir(path.join(root, t)).catch(() => [] as string[])) {
        const p = path.join(root, t, job);
        const st = await fs.stat(p).catch(() => null);
        if (st && this.now() - st.mtimeMs > TEMP_MAX_AGE_MS) {
          await fs.rm(p, { recursive: true, force: true }).catch(() => undefined);
          opsLog("info", "DataExport", "temp_swept", { dir: `${t}/${job}` });
        }
      }
    }
  }

  /** Avisa solo si la fila terminó así de verdad y se sabe a quién. */
  private async tellById(kind: ExportNotice["kind"], id: number) {
    if (!this.d.notify || !this.d.requester) return;
    try {
      const row = await this.d.store.get(id);
      if (row?.status !== kind) return;
      const to = await this.d.requester(row.requestedBy);
      if (to?.email) await this.d.notify({ kind, export: row, to });
    } catch (e) {
      opsLog("warn", "DataExport", "notify_failed", { tenantId: this.d.tenantId, exportId: id, kind, error: e instanceof Error ? e.name : "error" });
    }
  }
}

/** Solo pruebas: huecos y barrido del proceso. */
export function _resetExportProcessForTests() {
  slots.used = 0;
  lastSweep = 0;
}

// ── Almacenes ────────────────────────────────────────────────────────────────

type Row = RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toExport = (r: Row): DataExport => ({
  id: Number(r.id),
  requestedBy: Number(r.requested_by),
  status: r.status as DataExportStatus,
  objectId: (r.object_id as string | null) ?? null,
  sizeBytes: num(r.size_bytes),
  tableCount: num(r.table_count),
  rowCount: num(r.row_count),
  fileCount: num(r.file_count),
  error: r.status === "failed" ? ((r.error as string | null) ?? null) : null,
  warning: r.status === "ready" ? ((r.error as string | null) ?? null) : null,
  requestedAt: Number(r.requested_at),
  completedAt: num(r.completed_at),
  expiresAt: num(r.expires_at),
  linkCount: Number(r.link_count),
  downloadCount: Number(r.download_count),
  lastDownloadAt: num(r.last_download_at),
  attempts: Number(r.attempts ?? 0),
  startedAt: num(r.started_at),
  heartbeatAt: num(r.heartbeat_at),
  durationMs: num(r.duration_ms),
  uncompressedBytes: num(r.uncompressed_bytes),
  missingFiles: num(r.missing_files),
});
const code = (e: unknown) => (e as { code?: string }).code;

/** En la BD de la empresa en curso (cada empresa tiene la suya). */
export class MysqlDataExportStore implements DataExportStore {
  constructor(private pool: () => mysql.Pool) {}
  private async q<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (code(e) === "ER_NO_SUCH_TABLE") throw new DataExportError("unavailable", "La exportación aún no está disponible para esta empresa");
      // Sin 0012 (columnas del trabajo): la base de la empresa está pendiente de actualizar
      if (code(e) === "ER_BAD_FIELD_ERROR") throw new DataExportError("unavailable", "La exportación está pendiente de una actualización de la base de datos de tu empresa. Contacta con soporte.");
      throw e;
    }
  }
  async insertPending(requestedBy: number, now: number) {
    return this.q(async () => {
      try {
        const [r] = await this.pool().query<ResultSetHeader>("INSERT INTO data_exports (requested_by, status, requested_at) VALUES (?, 'pending', ?)", [requestedBy, now]);
        return (await this.get(r.insertId))!;
      } catch (e) {
        if (code(e) === "ER_DUP_ENTRY") throw new DataExportError("conflict", "Ya hay una exportación en curso: espera a que termine");
        throw e;
      }
    });
  }
  async get(id: number) {
    return this.q(async () => {
      const [rows] = await this.pool().query<Row[]>("SELECT * FROM data_exports WHERE id = ?", [id]);
      return rows[0] ? toExport(rows[0]) : null;
    });
  }
  async list(limit: number) {
    return this.q(async () => (await this.pool().query<Row[]>("SELECT * FROM data_exports ORDER BY id DESC LIMIT ?", [limit]))[0].map(toExport));
  }
  async countSince(since: number) {
    return this.q(async () => Number((await this.pool().query<Row[]>("SELECT COUNT(*) AS n FROM data_exports WHERE requested_at >= ?", [since]))[0][0].n));
  }
  async claim(now: number, staleBefore: number, maxAttempts: number) {
    return this.q(async () => {
      const [cand] = await this.pool().query<Row[]>(
        "SELECT id FROM data_exports WHERE status = 'pending' AND attempts < ? AND (heartbeat_at IS NULL OR heartbeat_at < ?) ORDER BY requested_at LIMIT 1",
        [maxAttempts, staleBefore],
      );
      if (!cand[0]) return null;
      const [r] = await this.pool().query<ResultSetHeader>(
        "UPDATE data_exports SET attempts = attempts + 1, started_at = COALESCE(started_at, ?), heartbeat_at = ? WHERE id = ? AND status = 'pending' AND attempts < ? AND (heartbeat_at IS NULL OR heartbeat_at < ?)",
        [now, now, cand[0].id, maxAttempts, staleBefore],
      );
      return r.affectedRows === 1 ? this.get(Number(cand[0].id)) : null;
    });
  }
  async heartbeat(id: number, now: number) {
    await this.pool().query("UPDATE data_exports SET heartbeat_at = ? WHERE id = ? AND status = 'pending'", [now, id]);
  }
  async release(id: number, now: number) {
    await this.pool().query("UPDATE data_exports SET heartbeat_at = ? WHERE id = ? AND status = 'pending'", [now, id]);
  }
  async markReady(id: number, r: ReadyResult, now: number) {
    // `error` de una fila lista guarda el aviso de exportación incompleta
    const [res] = await this.pool().query<ResultSetHeader>(
      "UPDATE data_exports SET status = 'ready', object_id = ?, size_bytes = ?, table_count = ?, row_count = ?, file_count = ?, expires_at = ?, completed_at = ?, error = ?, duration_ms = ?, uncompressed_bytes = ?, missing_files = ? WHERE id = ? AND status = 'pending'",
      [r.objectId, r.sizeBytes, r.tableCount, r.rowCount, r.fileCount, r.expiresAt, now, r.warning ? r.warning.slice(0, 300) : null, r.durationMs ?? null, r.uncompressedBytes ?? null, r.missingFiles ?? null, id],
    );
    return res.affectedRows === 1;
  }
  async markFailed(id: number, error: string, now: number) {
    const [res] = await this.pool().query<ResultSetHeader>("UPDATE data_exports SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND status = 'pending'", [error.slice(0, 300), now, id]);
    return res.affectedRows === 1;
  }
  async failExhausted(staleBefore: number, maxAttempts: number, error: string, now: number) {
    return this.q(async () => {
      const [rows] = await this.pool().query<Row[]>("SELECT id FROM data_exports WHERE status = 'pending' AND attempts >= ? AND heartbeat_at < ?", [maxAttempts, staleBefore]);
      const ids: number[] = [];
      for (const r of rows) if (await this.markFailed(Number(r.id), error, now)) ids.push(Number(r.id));
      return ids;
    });
  }
  async linkIssued(id: number, now: number) {
    await this.pool().query("UPDATE data_exports SET link_count = link_count + 1, last_link_at = ? WHERE id = ?", [now, id]);
  }
  async downloaded(objectId: string, now: number) {
    try {
      const [r] = await this.pool().query<ResultSetHeader>("UPDATE data_exports SET download_count = download_count + 1, last_download_at = ? WHERE object_id = ?", [now, objectId]);
      return r.affectedRows > 0;
    } catch (e) {
      if (code(e) === "ER_NO_SUCH_TABLE") return false;
      throw e;
    }
  }
}

export class MemoryDataExportStore implements DataExportStore {
  rows: DataExport[] = [];
  async insertPending(requestedBy: number, now: number) {
    if (this.rows.some((r) => r.status === "pending")) throw new DataExportError("conflict", "Ya hay una exportación en curso: espera a que termine");
    const row: DataExport = {
      id: this.rows.length + 1, requestedBy, status: "pending", objectId: null, sizeBytes: null, tableCount: null, rowCount: null, fileCount: null, error: null, warning: null, requestedAt: now,
      completedAt: null, expiresAt: null, linkCount: 0, downloadCount: 0, lastDownloadAt: null, attempts: 0, startedAt: null, heartbeatAt: null, durationMs: null, uncompressedBytes: null, missingFiles: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async list(limit: number) {
    return this.rows.slice().reverse().slice(0, limit).map((r) => ({ ...r }));
  }
  async countSince(since: number) {
    return this.rows.filter((r) => r.requestedAt >= since).length;
  }
  async claim(now: number, staleBefore: number, maxAttempts: number) {
    const x = this.rows.find((r) => r.status === "pending" && r.attempts < maxAttempts && (r.heartbeatAt === null || r.heartbeatAt < staleBefore));
    if (!x) return null;
    Object.assign(x, { attempts: x.attempts + 1, startedAt: x.startedAt ?? now, heartbeatAt: now });
    return { ...x };
  }
  async heartbeat(id: number, now: number) {
    const x = this.rows.find((y) => y.id === id && y.status === "pending");
    if (x) x.heartbeatAt = now;
  }
  async release(id: number, now: number) {
    await this.heartbeat(id, now);
  }
  async markReady(id: number, r: ReadyResult, now: number) {
    const x = this.rows.find((y) => y.id === id && y.status === "pending");
    if (!x) return false;
    Object.assign(x, { objectId: r.objectId, sizeBytes: r.sizeBytes, tableCount: r.tableCount, rowCount: r.rowCount, fileCount: r.fileCount, expiresAt: r.expiresAt, status: "ready", completedAt: now, warning: r.warning ?? null, durationMs: r.durationMs ?? null, uncompressedBytes: r.uncompressedBytes ?? null, missingFiles: r.missingFiles ?? null });
    return true;
  }
  async markFailed(id: number, error: string, now: number) {
    const x = this.rows.find((y) => y.id === id && y.status === "pending");
    if (!x) return false;
    Object.assign(x, { status: "failed", error, completedAt: now });
    return true;
  }
  async failExhausted(staleBefore: number, maxAttempts: number, error: string, now: number) {
    const ids: number[] = [];
    for (const x of this.rows.filter((r) => r.status === "pending" && r.attempts >= maxAttempts && r.heartbeatAt !== null && r.heartbeatAt < staleBefore)) {
      Object.assign(x, { status: "failed", error, completedAt: now });
      ids.push(x.id);
    }
    return ids;
  }
  async linkIssued(id: number) {
    const x = this.rows.find((y) => y.id === id);
    if (x) x.linkCount++;
  }
  async downloaded(objectId: string, now: number) {
    const x = this.rows.find((y) => y.objectId === objectId);
    if (!x) return false;
    x.downloadCount++;
    x.lastDownloadAt = now;
    return true;
  }
}

/**
 * Origen de los datos: la BD de la empresa en curso y sus ficheros activos (salvo exportaciones anteriores). Una
 * conexión propia con una INSTANTÁNEA COHERENTE (REPEATABLE READ, solo lectura): todas las tablas y las dos
 * pasadas (CSV y JSON) ven los mismos datos. Las filas se leen por lotes (por clave primaria cuando es simple).
 */
export class MysqlExportSource implements OpenedSource {
  private conn: mysql.PoolConnection | null = null;
  constructor(
    private pool: () => mysql.Pool,
    private openFile: (storageKey: string) => Promise<NodeJS.ReadableStream | Buffer | null>,
    private chunk = 1000,
  ) {}
  async open(): Promise<this> {
    this.conn = await this.pool().getConnection();
    await this.conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await this.conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    return this;
  }
  private c() {
    if (!this.conn) throw new Error("Origen no abierto");
    return this.conn;
  }
  async close() {
    const c = this.conn;
    this.conn = null;
    if (!c) return;
    await c.query("COMMIT").catch(() => undefined);
    c.release();
  }
  async tables() {
    const [rows] = await this.c().query<Row[]>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
    return rows.map((r) => String(r.t));
  }
  /** Tamaño aproximado (datos de las tablas + ficheros declarados), para decidir antes de escribir. */
  async estimate() {
    const [t] = await this.c().query<Row[]>("SELECT COALESCE(SUM(DATA_LENGTH), 0) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
    let files = 0;
    try {
      const [f] = await this.c().query<Row[]>("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM stored_objects WHERE status = 'active' AND category <> 'data-export'");
      files = Number(f[0].n);
    } catch (e) {
      if (code(e) !== "ER_NO_SUCH_TABLE") throw e;
    }
    return Number(t[0].n) + files;
  }
  private assertName(table: string) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) throw new Error("Nombre de tabla no válido");
  }
  async columns(table: string) {
    this.assertName(table);
    const [cols] = await this.c().query<Row[]>("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [table]);
    return cols.map((r) => String(r.c));
  }
  async *rows(table: string): AsyncIterable<Array<Record<string, unknown>>> {
    this.assertName(table);
    const [pk] = await this.c().query<Row[]>(
      "SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
      [table],
    );
    const keys = pk.map((r) => String(r.c));
    if (keys.length === 1) {
      // Por clave primaria (sin OFFSET): coste constante por lote aunque la tabla sea muy grande
      const k = keys[0];
      let last: unknown = undefined;
      for (;;) {
        const [page] = await this.c().query<Row[]>(
          last === undefined ? `SELECT * FROM \`${table}\` ORDER BY \`${k}\` LIMIT ?` : `SELECT * FROM \`${table}\` WHERE \`${k}\` > ? ORDER BY \`${k}\` LIMIT ?`,
          last === undefined ? [this.chunk] : [last, this.chunk],
        );
        if (page.length) yield page.map((r) => ({ ...r }));
        if (page.length < this.chunk) return;
        last = page[page.length - 1][k];
      }
    }
    const order = keys.length ? ` ORDER BY ${keys.map((k) => `\`${k}\``).join(", ")}` : "";
    for (let offset = 0; ; offset += this.chunk) {
      const [page] = await this.c().query<Row[]>(`SELECT * FROM \`${table}\`${order} LIMIT ? OFFSET ?`, [this.chunk, offset]);
      if (page.length) yield page.map((r) => ({ ...r }));
      if (page.length < this.chunk) return;
    }
  }
  async files(): Promise<ExportFile[]> {
    try {
      const [rows] = await this.c().query<Row[]>(
        "SELECT object_id, storage_key, category, content_type, size_bytes, original_name FROM stored_objects WHERE status = 'active' AND category <> 'data-export' ORDER BY created_at",
      );
      return rows.map((r) => ({
        objectId: String(r.object_id),
        category: String(r.category),
        contentType: String(r.content_type),
        sizeBytes: Number(r.size_bytes),
        originalName: (r.original_name as string | null) ?? null,
        open: async () => {
          const { Readable } = await import("node:stream");
          const s = await this.openFile(String(r.storage_key));
          if (!s) throw new Error("Fichero no encontrado en el almacenamiento");
          return Buffer.isBuffer(s) ? Readable.from([s]) : (s as import("node:stream").Readable);
        },
      }));
    } catch (e) {
      if (code(e) === "ER_NO_SUCH_TABLE") return [];
      throw e;
    }
  }
}
