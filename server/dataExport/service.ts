/**
 * Exportación de datos de la empresa (fase F; decisión D): ZIP con CSV, JSON y ficheros, solo para el
 * PROPIETARIO, enlace firmado de 24 h, registro de cada solicitud, enlace emitido y descarga (`data_exports`,
 * db/migrations/0011). Disponible también en solo lectura (los 30 días tras el fin del periodo pagado).
 *
 *  - Una exportación en curso por empresa (la BD lo garantiza). Se genera en segundo plano.
 *  - Tamaño controlado (DATA_EXPORT_MAX_MB, por defecto 1024): por encima no se genera nada y se avisa.
 *  - El ZIP se guarda como fichero privado de la empresa (categoría `data-export`, fuera del almacenamiento
 *    contratado) y NUNCA se borra automáticamente (tampoco su registro).
 *  - Sin secretos (./build.ts) y sin datos de otra empresa: todo se lee de la BD de la empresa en curso.
 *  - Exportación INCOMPLETA (ficheros registrados que no estaban en el almacenamiento): queda lista, pero con
 *    `warning` (en la columna `error` de una fila `ready`), en el LÉEME y en el manifiesto: nunca como completa.
 *  - Una generación interrumpida (reinicio del contenedor) no bloquea para siempre: pasadas STALE_PENDING_MS
 *    se marca como fallida al volver a pedir o listar.
 *  - Al terminar se avisa por correo a quien la pidió (`notify`): «disponible» o «fallida», sin el enlace.
 */
import type mysql from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { opsLog } from "../_core/ops/log";
import { buildExport, ExportTooLargeError, type ExportFile, type ExportSource, type TableDump } from "./build";

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
}

export class DataExportError extends Error {
  constructor(
    readonly code: "forbidden" | "conflict" | "not_found" | "invalid_state" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DataExportError";
  }
}

export interface DataExportStore {
  /** `conflict` si ya hay una en curso. `unavailable` sin la migración 0011. */
  insertPending(requestedBy: number, now: number): Promise<DataExport>;
  get(id: number): Promise<DataExport | null>;
  list(limit: number): Promise<DataExport[]>;
  markReady(id: number, r: ReadyResult, now: number): Promise<void>;
  markFailed(id: number, error: string, now: number): Promise<void>;
  /** Marca como fallidas las `pending` pedidas antes de `before` (generación interrumpida). Devuelve cuántas. */
  failStale(before: number, error: string, now: number): Promise<number>;
  linkIssued(id: number, now: number): Promise<void>;
  /** Descarga de un ZIP de exportación (por id del fichero). false si el fichero no es de una exportación. */
  downloaded(objectId: string, now: number): Promise<boolean>;
}

export interface ReadyResult {
  objectId: string;
  sizeBytes: number;
  tableCount: number;
  rowCount: number;
  fileCount: number;
  expiresAt: number;
  warning?: string | null;
}

export const EXPORT_LINK_TTL_MS = 24 * 3600_000;
/** Una generación «en curso» más antigua que esto se da por interrumpida (ninguna legítima tarda tanto). */
export const STALE_PENDING_MS = 3 * 3600_000;
export const INTERRUPTED_MESSAGE = "La generación se interrumpió antes de terminar. Solicita una nueva exportación.";

export interface ExportNotice {
  kind: "ready" | "failed";
  export: DataExport;
  to: { email: string; name: string | null };
}
export const exportMaxBytes = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.DATA_EXPORT_MAX_MB);
  return (Number.isFinite(n) && n > 0 ? Math.min(n, 4096) : 1024) * 1048576;
};

export interface DataExportDeps {
  store: DataExportStore;
  source: ExportSource;
  /** Guarda el ZIP como fichero privado de la empresa; devuelve su id. */
  saveZip: (zip: Buffer, name: string, uploadedBy: number) => Promise<string>;
  /** Enlace firmado al fichero con esa validez (segundos). */
  signedLink: (objectId: string, ttlSeconds: number) => string;
  tenantId: string;
  /** Aviso por correo al terminar (a quien la pidió). Un fallo del aviso no cambia el resultado. */
  notify?: (n: ExportNotice) => Promise<void>;
  maxBytes?: number;
  now?: () => number;
}

const missingWarning = (n: number) =>
  `${n === 1 ? "1 fichero registrado no estaba" : `${n} ficheros registrados no estaban`} en el almacenamiento y no se ${n === 1 ? "ha" : "han"} incluido: la exportación está incompleta (el detalle está en manifest.json). Contacta con soporte.`;
const message = (e: unknown) => (e instanceof ExportTooLargeError ? e.message : "No se pudo generar la exportación. Inténtalo de nuevo o contacta con soporte.");

export class DataExportService {
  private now: () => number;
  constructor(private d: DataExportDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Solicitud del propietario. Devuelve la fila `pending` y la generación (para esperarla en pruebas). */
  async request(user: { id: number; isOwner: boolean; email?: string | null; name?: string | null }): Promise<{ export: DataExport; done: Promise<void> }> {
    if (!user.isOwner) throw new DataExportError("forbidden", "Solo la persona propietaria de la empresa puede exportar sus datos");
    await this.recoverStale();
    const row = await this.d.store.insertPending(user.id, this.now());
    opsLog("info", "DataExport", "requested", { tenantId: this.d.tenantId, exportId: row.id });
    const email = (user.email ?? "").trim();
    return { export: row, done: this.generate(row, email ? { email, name: user.name ?? null } : null) };
  }

  private async recoverStale() {
    const n = await this.d.store.failStale(this.now() - STALE_PENDING_MS, INTERRUPTED_MESSAGE, this.now());
    if (n > 0) opsLog("warn", "DataExport", "interrupted", { tenantId: this.d.tenantId, count: n });
  }

  private async generate(row: DataExport, to: ExportNotice["to"] | null): Promise<void> {
    let kind: ExportNotice["kind"] = "ready";
    try {
      const built = await buildExport(this.d.source, { tenantId: this.d.tenantId, requestedBy: row.requestedBy, now: this.now(), maxBytes: this.d.maxBytes ?? exportMaxBytes() });
      const date = new Date(this.now()).toISOString().slice(0, 10);
      const objectId = await this.d.saveZip(built.zip, `exportacion-${this.d.tenantId}-${date}.zip`, row.requestedBy);
      const warning = built.missingFileCount > 0 ? missingWarning(built.missingFileCount) : null;
      await this.d.store.markReady(row.id, { objectId, sizeBytes: built.zip.length, tableCount: built.tableCount, rowCount: built.rowCount, fileCount: built.fileCount, expiresAt: this.now() + EXPORT_LINK_TTL_MS, warning }, this.now());
      opsLog(warning ? "warn" : "info", "DataExport", "ready", { tenantId: this.d.tenantId, exportId: row.id, bytes: built.zip.length, tables: built.tableCount, files: built.fileCount, missingFiles: built.missingFileCount });
    } catch (e) {
      kind = "failed";
      opsLog("error", "DataExport", "failed", { tenantId: this.d.tenantId, exportId: row.id, error: e instanceof Error ? e.name : "error" });
      await this.d.store.markFailed(row.id, message(e), this.now()).catch(() => undefined);
    }
    if (to && this.d.notify) await this.tell(kind, row.id, to);
  }

  /** Avisa solo si la fila terminó así de verdad (p. ej. no si otra solicitud la dio por interrumpida). */
  private async tell(kind: ExportNotice["kind"], id: number, to: ExportNotice["to"]) {
    try {
      const row = await this.d.store.get(id);
      if (row?.status === kind) await this.d.notify!({ kind, export: row, to });
    } catch (e) {
      opsLog("warn", "DataExport", "notify_failed", { tenantId: this.d.tenantId, exportId: id, kind, error: e instanceof Error ? e.name : "error" });
    }
  }

  async list(user: { isOwner: boolean }) {
    if (!user.isOwner) throw new DataExportError("forbidden", "Solo la persona propietaria de la empresa puede ver sus exportaciones");
    await this.recoverStale();
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
});
const missingTable = (e: unknown) => (e as { code?: string }).code === "ER_NO_SUCH_TABLE";

/** En la BD de la empresa en curso (cada empresa tiene la suya). */
export class MysqlDataExportStore implements DataExportStore {
  constructor(private pool: () => mysql.Pool) {}
  private async q<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (missingTable(e)) throw new DataExportError("unavailable", "La exportación aún no está disponible para esta empresa");
      throw e;
    }
  }
  async insertPending(requestedBy: number, now: number) {
    return this.q(async () => {
      try {
        const [r] = await this.pool().query<ResultSetHeader>("INSERT INTO data_exports (requested_by, status, requested_at) VALUES (?, 'pending', ?)", [requestedBy, now]);
        return (await this.get(r.insertId))!;
      } catch (e) {
        if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new DataExportError("conflict", "Ya hay una exportación en curso: espera a que termine");
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
  async markReady(id: number, r: ReadyResult, now: number) {
    // `error` de una fila lista guarda el aviso de exportación incompleta (sin migración nueva)
    await this.pool().query(
      "UPDATE data_exports SET status = 'ready', object_id = ?, size_bytes = ?, table_count = ?, row_count = ?, file_count = ?, expires_at = ?, completed_at = ?, error = ? WHERE id = ? AND status = 'pending'",
      [r.objectId, r.sizeBytes, r.tableCount, r.rowCount, r.fileCount, r.expiresAt, now, r.warning ? r.warning.slice(0, 300) : null, id],
    );
  }
  async failStale(before: number, error: string, now: number) {
    return this.q(async () => {
      const [r] = await this.pool().query<ResultSetHeader>("UPDATE data_exports SET status = 'failed', error = ?, completed_at = ? WHERE status = 'pending' AND requested_at < ?", [error.slice(0, 300), now, before]);
      return r.affectedRows;
    });
  }
  async markFailed(id: number, error: string, now: number) {
    await this.pool().query("UPDATE data_exports SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND status = 'pending'", [error.slice(0, 300), now, id]);
  }
  async linkIssued(id: number, now: number) {
    await this.pool().query("UPDATE data_exports SET link_count = link_count + 1, last_link_at = ? WHERE id = ?", [now, id]);
  }
  async downloaded(objectId: string, now: number) {
    try {
      const [r] = await this.pool().query<ResultSetHeader>("UPDATE data_exports SET download_count = download_count + 1, last_download_at = ? WHERE object_id = ?", [now, objectId]);
      return r.affectedRows > 0;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }
}

export class MemoryDataExportStore implements DataExportStore {
  rows: DataExport[] = [];
  async insertPending(requestedBy: number, now: number) {
    if (this.rows.some((r) => r.status === "pending")) throw new DataExportError("conflict", "Ya hay una exportación en curso: espera a que termine");
    const row: DataExport = { id: this.rows.length + 1, requestedBy, status: "pending", objectId: null, sizeBytes: null, tableCount: null, rowCount: null, fileCount: null, error: null, warning: null, requestedAt: now, completedAt: null, expiresAt: null, linkCount: 0, downloadCount: 0, lastDownloadAt: null };
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
  async markReady(id: number, r: ReadyResult, now: number) {
    const x = this.rows.find((y) => y.id === id && y.status === "pending");
    if (x) Object.assign(x, r, { status: "ready", completedAt: now, warning: r.warning ?? null });
  }
  async failStale(before: number, error: string, now: number) {
    const stale = this.rows.filter((y) => y.status === "pending" && y.requestedAt < before);
    for (const x of stale) Object.assign(x, { status: "failed", error, completedAt: now });
    return stale.length;
  }
  async markFailed(id: number, error: string, now: number) {
    const x = this.rows.find((y) => y.id === id && y.status === "pending");
    if (x) Object.assign(x, { status: "failed", error, completedAt: now });
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

/** Origen de los datos: la BD de la empresa en curso y sus ficheros activos (salvo exportaciones anteriores). */
export class MysqlExportSource implements ExportSource {
  constructor(
    private pool: () => mysql.Pool,
    private readFile: (storageKey: string) => Promise<Buffer | null>,
    private chunk = 2000,
  ) {}
  async tables() {
    const [rows] = await this.pool().query<Row[]>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
    return rows.map((r) => String(r.t));
  }
  async dump(table: string): Promise<TableDump> {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) throw new Error("Nombre de tabla no válido");
    const [cols] = await this.pool().query<Row[]>("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [table]);
    const columns = cols.map((r) => String(r.c));
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += this.chunk) {
      const [page] = await this.pool().query<Row[]>(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [this.chunk, offset]);
      rows.push(...page.map((r) => ({ ...r })));
      if (page.length < this.chunk) break;
    }
    return { name: table, columns, rows };
  }
  async files(): Promise<ExportFile[]> {
    try {
      const [rows] = await this.pool().query<Row[]>(
        "SELECT object_id, storage_key, category, content_type, size_bytes, original_name FROM stored_objects WHERE status = 'active' AND category <> 'data-export' ORDER BY created_at",
      );
      return rows.map((r) => ({
        objectId: String(r.object_id),
        category: String(r.category),
        contentType: String(r.content_type),
        sizeBytes: Number(r.size_bytes),
        originalName: (r.original_name as string | null) ?? null,
        read: async () => {
          const b = await this.readFile(String(r.storage_key));
          if (!b) throw new Error("Fichero no encontrado en el almacenamiento");
          return b;
        },
      }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }
}
