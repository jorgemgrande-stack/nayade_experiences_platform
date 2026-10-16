/**
 * Inventario de copias de seguridad (registro, migración 0010: `backup_inventory`).
 *
 * Fuente de verdad de qué se copió, cuándo, dónde, con qué clave y con qué resultado. Lo usan el
 * trabajo de copia (escribe), la retención (marca `pruned`), la alerta `backup.stale` (última copia
 * correcta por empresa) y el plano de control (`/cp/v1/backups`).
 */
import type mysql from "mysql2/promise";

export type BackupTargetKind = "tenant" | "registry" | "crm" | "files";
export type BackupStatus = "running" | "ok" | "failed" | "pruned";

export interface BackupRecord {
  id: number;
  runId: string;
  targetKind: BackupTargetKind;
  targetId: string;
  status: BackupStatus;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  serverAlias: string | null;
  databaseName: string | null;
  schemaVersion: string | null;
  storageKind: string | null;
  location: string | null;
  manifestKey: string | null;
  bytes: number | null;
  sha256: string | null;
  keyId: string | null;
  tablesCount: number | null;
  rowsCount: number | null;
  error: string | null;
  prunedAt: number | null;
}

export type BackupStart = Pick<BackupRecord, "runId" | "targetKind" | "targetId" | "startedAt"> &
  Partial<Pick<BackupRecord, "serverAlias" | "databaseName" | "schemaVersion" | "storageKind">>;

export type BackupSuccess = Pick<BackupRecord, "finishedAt" | "location" | "manifestKey" | "bytes" | "sha256" | "keyId" | "tablesCount" | "rowsCount"> &
  Partial<Pick<BackupRecord, "schemaVersion">>;

export interface BackupListFilter {
  targetKind?: BackupTargetKind;
  targetId?: string;
  status?: BackupStatus;
  limit?: number;
}

export interface BackupInventory {
  start(s: BackupStart): Promise<number>;
  succeed(id: number, s: BackupSuccess): Promise<void>;
  fail(id: number, finishedAt: number, error: string): Promise<void>;
  markPruned(ids: number[], at: number): Promise<void>;
  get(id: number): Promise<BackupRecord | null>;
  list(f?: BackupListFilter): Promise<BackupRecord[]>;
  /** Última copia correcta (ms) de cada destino de un tipo. */
  lastSuccess(kind: BackupTargetKind): Promise<Record<string, number>>;
  /** Último intento (cualquier estado salvo `pruned`) de cada destino. */
  latestAttempts(): Promise<BackupRecord[]>;
}

/** Errores sin datos sensibles y acotados (sin DSN ni rutas con credenciales). */
export function safeError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return raw.replace(/mysql:\/\/[^\s]+/gi, "mysql://***").replace(/\b(password|secret|token)=\S+/gi, "$1=***").slice(0, 480);
}

const COLS = `id, run_id, target_kind, target_id, status, started_at, finished_at, duration_ms, server_alias, database_name,
  schema_version, storage_kind, location, manifest_key, bytes, sha256, key_id, tables_count, rows_count, error, pruned_at`;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function fromRow(r: mysql.RowDataPacket): BackupRecord {
  return {
    id: Number(r.id),
    runId: String(r.run_id),
    targetKind: r.target_kind,
    targetId: String(r.target_id),
    status: r.status,
    startedAt: Number(r.started_at),
    finishedAt: num(r.finished_at),
    durationMs: num(r.duration_ms),
    serverAlias: r.server_alias ?? null,
    databaseName: r.database_name ?? null,
    schemaVersion: r.schema_version ?? null,
    storageKind: r.storage_kind ?? null,
    location: r.location ?? null,
    manifestKey: r.manifest_key ?? null,
    bytes: num(r.bytes),
    sha256: r.sha256 ?? null,
    keyId: r.key_id ?? null,
    tablesCount: num(r.tables_count),
    rowsCount: num(r.rows_count),
    error: r.error ?? null,
    prunedAt: num(r.pruned_at),
  };
}

export class MysqlBackupInventory implements BackupInventory {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async start(s: BackupStart) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO backup_inventory (run_id, target_kind, target_id, status, started_at, server_alias, database_name, schema_version, storage_kind)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      [s.runId, s.targetKind, s.targetId, s.startedAt, s.serverAlias ?? null, s.databaseName ?? null, s.schemaVersion ?? null, s.storageKind ?? null],
    );
    return r.insertId;
  }

  async succeed(id: number, s: BackupSuccess) {
    await this.pool.query(
      `UPDATE backup_inventory SET status = 'ok', finished_at = ?, duration_ms = ? - started_at, location = ?, manifest_key = ?, bytes = ?,
         sha256 = ?, key_id = ?, tables_count = ?, rows_count = ?, schema_version = COALESCE(?, schema_version), error = NULL
       WHERE id = ? AND status = 'running'`,
      [s.finishedAt, s.finishedAt, s.location, s.manifestKey, s.bytes, s.sha256, s.keyId, s.tablesCount, s.rowsCount, s.schemaVersion ?? null, id],
    );
  }

  async fail(id: number, finishedAt: number, error: string) {
    await this.pool.query(
      "UPDATE backup_inventory SET status = 'failed', finished_at = ?, duration_ms = ? - started_at, error = ? WHERE id = ? AND status = 'running'",
      [finishedAt, finishedAt, error.slice(0, 500), id],
    );
  }

  async markPruned(ids: number[], at: number) {
    if (!ids.length) return;
    await this.pool.query("UPDATE backup_inventory SET status = 'pruned', pruned_at = ? WHERE id IN (?) AND status = 'ok'", [at, ids]);
  }

  async get(id: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT ${COLS} FROM backup_inventory WHERE id = ?`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async list(f: BackupListFilter = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.targetKind) (where.push("target_kind = ?"), args.push(f.targetKind));
    if (f.targetId) (where.push("target_id = ?"), args.push(f.targetId));
    if (f.status) (where.push("status = ?"), args.push(f.status));
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT ${COLS} FROM backup_inventory ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY started_at DESC, id DESC LIMIT ?`,
      [...args, Math.min(Math.max(f.limit ?? 100, 1), 5000)],
    );
    return rows.map(fromRow);
  }

  async lastSuccess(kind: BackupTargetKind) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT target_id, MAX(finished_at) AS last FROM backup_inventory WHERE target_kind = ? AND status = 'ok' GROUP BY target_id",
      [kind],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.target_id)] = Number(r.last);
    return out;
  }

  async latestAttempts() {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT ${COLS} FROM backup_inventory b WHERE b.id = (
         SELECT b2.id FROM backup_inventory b2 WHERE b2.target_kind = b.target_kind AND b2.target_id = b.target_id AND b2.status <> 'pruned'
         ORDER BY b2.started_at DESC, b2.id DESC LIMIT 1)`,
    );
    return rows.map(fromRow);
  }
}

export class MemoryBackupInventory implements BackupInventory {
  rows: BackupRecord[] = [];
  private seq = 0;
  async start(s: BackupStart) {
    const id = ++this.seq;
    this.rows.push({
      id,
      runId: s.runId,
      targetKind: s.targetKind,
      targetId: s.targetId,
      status: "running",
      startedAt: s.startedAt,
      finishedAt: null,
      durationMs: null,
      serverAlias: s.serverAlias ?? null,
      databaseName: s.databaseName ?? null,
      schemaVersion: s.schemaVersion ?? null,
      storageKind: s.storageKind ?? null,
      location: null,
      manifestKey: null,
      bytes: null,
      sha256: null,
      keyId: null,
      tablesCount: null,
      rowsCount: null,
      error: null,
      prunedAt: null,
    });
    return id;
  }
  async succeed(id: number, s: BackupSuccess) {
    const r = this.rows.find((x) => x.id === id && x.status === "running");
    if (r) Object.assign(r, { ...s, schemaVersion: s.schemaVersion ?? r.schemaVersion, status: "ok", durationMs: s.finishedAt! - r.startedAt, error: null });
  }
  async fail(id: number, finishedAt: number, error: string) {
    const r = this.rows.find((x) => x.id === id && x.status === "running");
    if (r) Object.assign(r, { status: "failed", finishedAt, durationMs: finishedAt - r.startedAt, error });
  }
  async markPruned(ids: number[], at: number) {
    for (const r of this.rows) if (ids.includes(r.id) && r.status === "ok") Object.assign(r, { status: "pruned", prunedAt: at });
  }
  async get(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(f: BackupListFilter = {}) {
    return this.rows
      .filter((r) => (!f.targetKind || r.targetKind === f.targetKind) && (!f.targetId || r.targetId === f.targetId) && (!f.status || r.status === f.status))
      .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
      .slice(0, f.limit ?? 100);
  }
  async lastSuccess(kind: BackupTargetKind) {
    const out: Record<string, number> = {};
    for (const r of this.rows) if (r.targetKind === kind && r.status === "ok" && r.finishedAt) out[r.targetId] = Math.max(out[r.targetId] ?? 0, r.finishedAt);
    return out;
  }
  async latestAttempts() {
    const m = new Map<string, BackupRecord>();
    for (const r of [...this.rows].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id)) if (r.status !== "pruned") m.set(`${r.targetKind}:${r.targetId}`, r);
    return Array.from(m.values());
  }
}
