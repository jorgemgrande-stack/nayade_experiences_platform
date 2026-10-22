/**
 * Estado de las copias por destino y registro de restauraciones (registro, migración 0011).
 *
 *  - `backup_copies`: una fila por copia escrita (o intentada) en un destino ADICIONAL al primario
 *    (hoy `secondary`, el almacenamiento externo), y por cada paquete de configuración para
 *    recuperación en cualquier destino (`target_kind = 'config'`, `backup_id` NULL). El primario
 *    sigue registrado en `backup_inventory` sin cambios: si no hay secundario, nada cambia.
 *  - `backup_restores`: una fila por restauración (origen, copia, base nueva, verificación,
 *    conmutación, resultado).
 *
 * Sin secretos: solo identificadores, ubicaciones relativas, huellas y descripciones sin credenciales.
 */
import type mysql from "mysql2/promise";

export type BackupDestination = "primary" | "secondary";
export type CopyTargetKind = "tenant" | "registry" | "crm" | "files" | "config";
export type CopyStatus = "ok" | "failed" | "pruned";

export interface BackupCopyRecord {
  id: number;
  backupId: number | null;
  destination: BackupDestination;
  runId: string;
  targetKind: CopyTargetKind;
  targetId: string;
  status: CopyStatus;
  storage: string | null;
  location: string | null;
  manifestKey: string | null;
  bytes: number | null;
  sha256: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  error: string | null;
  prunedAt: number | null;
}

export type BackupCopyInput = Omit<BackupCopyRecord, "id" | "durationMs" | "prunedAt">;

export interface CopyListFilter {
  destination: BackupDestination;
  targetKind?: CopyTargetKind;
  targetId?: string;
  status?: CopyStatus;
  limit?: number;
}

export type RestoreSource = BackupDestination;

export interface RestoreLogStart {
  startedAt: number;
  actor: string;
  source: RestoreSource;
  targetKind: CopyTargetKind;
  targetId: string;
  backupId?: number | null;
  manifestKey?: string | null;
  serverAlias?: string | null;
  databaseName?: string | null;
}

export interface RestoreLogEnd {
  finishedAt: number;
  status: "ok" | "failed";
  verified: boolean;
  switched?: boolean;
  databaseName?: string | null;
  filesCount?: number | null;
  error?: string | null;
}

export interface RestoreLogRecord extends RestoreLogStart {
  id: number;
  finishedAt: number | null;
  status: "running" | "ok" | "failed";
  verified: boolean;
  switched: boolean;
  filesCount: number | null;
  error: string | null;
}

export interface BackupCopyLedger {
  /** ¿Existe el esquema (migración 0011)? */
  ready(): Promise<boolean>;
  record(c: BackupCopyInput): Promise<number>;
  get(id: number): Promise<BackupCopyRecord | null>;
  list(f: CopyListFilter): Promise<BackupCopyRecord[]>;
  markPruned(ids: number[], at: number): Promise<void>;
  /** Última copia correcta (ms) de cada destino de un tipo en un destino de almacenamiento. */
  lastSuccess(destination: BackupDestination, kind: CopyTargetKind): Promise<Record<string, number>>;
  /** Último intento (no `pruned`) de cada destino en un almacenamiento. */
  latestAttempts(destination: BackupDestination): Promise<BackupCopyRecord[]>;
  restoreStarted(s: RestoreLogStart): Promise<number>;
  restoreFinished(id: number, e: RestoreLogEnd): Promise<void>;
  listRestores(limit?: number): Promise<RestoreLogRecord[]>;
}

const COLS = `id, backup_id, destination, run_id, target_kind, target_id, status, storage, location, manifest_key, bytes, sha256,
  started_at, finished_at, duration_ms, error, pruned_at`;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function fromRow(r: mysql.RowDataPacket): BackupCopyRecord {
  return {
    id: Number(r.id),
    backupId: num(r.backup_id),
    destination: r.destination,
    runId: String(r.run_id),
    targetKind: r.target_kind,
    targetId: String(r.target_id),
    status: r.status,
    storage: r.storage ?? null,
    location: r.location ?? null,
    manifestKey: r.manifest_key ?? null,
    bytes: num(r.bytes),
    sha256: r.sha256 ?? null,
    startedAt: Number(r.started_at),
    finishedAt: Number(r.finished_at),
    durationMs: Number(r.duration_ms),
    error: r.error ?? null,
    prunedAt: num(r.pruned_at),
  };
}

function restoreFromRow(r: mysql.RowDataPacket): RestoreLogRecord {
  return {
    id: Number(r.id),
    startedAt: Number(r.started_at),
    finishedAt: num(r.finished_at),
    actor: String(r.actor),
    source: r.source,
    targetKind: r.target_kind,
    targetId: String(r.target_id),
    backupId: num(r.backup_id),
    manifestKey: r.manifest_key ?? null,
    serverAlias: r.server_alias ?? null,
    databaseName: r.database_name ?? null,
    status: r.status,
    verified: !!Number(r.verified),
    switched: !!Number(r.switched),
    filesCount: num(r.files_count),
    error: r.error ?? null,
  };
}

export class MysqlBackupCopyLedger implements BackupCopyLedger {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async ready() {
    return this.pool.query("SELECT 1 FROM backup_copies LIMIT 0").then(
      () => this.pool.query("SELECT 1 FROM backup_restores LIMIT 0").then(() => true),
      () => false,
    ).catch(() => false);
  }

  async record(c: BackupCopyInput) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO backup_copies (backup_id, destination, run_id, target_kind, target_id, status, storage, location, manifest_key, bytes, sha256,
         started_at, finished_at, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.backupId,
        c.destination,
        c.runId,
        c.targetKind,
        c.targetId,
        c.status,
        c.storage?.slice(0, 200) ?? null,
        c.location,
        c.manifestKey,
        c.bytes,
        c.sha256,
        c.startedAt,
        c.finishedAt,
        Math.max(0, c.finishedAt - c.startedAt),
        c.error?.slice(0, 500) ?? null,
      ],
    );
    return r.insertId;
  }

  async get(id: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT ${COLS} FROM backup_copies WHERE id = ?`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async list(f: CopyListFilter) {
    const where = ["destination = ?"];
    const args: unknown[] = [f.destination];
    if (f.targetKind) (where.push("target_kind = ?"), args.push(f.targetKind));
    if (f.targetId) (where.push("target_id = ?"), args.push(f.targetId));
    if (f.status) (where.push("status = ?"), args.push(f.status));
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT ${COLS} FROM backup_copies WHERE ${where.join(" AND ")} ORDER BY started_at DESC, id DESC LIMIT ?`,
      [...args, Math.min(Math.max(f.limit ?? 100, 1), 5000)],
    );
    return rows.map(fromRow);
  }

  async markPruned(ids: number[], at: number) {
    if (!ids.length) return;
    await this.pool.query("UPDATE backup_copies SET status = 'pruned', pruned_at = ? WHERE id IN (?) AND status = 'ok'", [at, ids]);
  }

  async lastSuccess(destination: BackupDestination, kind: CopyTargetKind) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT target_id, MAX(finished_at) AS last FROM backup_copies WHERE destination = ? AND target_kind = ? AND status IN ('ok','pruned') GROUP BY target_id",
      [destination, kind],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.target_id)] = Number(r.last);
    return out;
  }

  async latestAttempts(destination: BackupDestination) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT ${COLS} FROM backup_copies b WHERE b.destination = ? AND b.id = (
         SELECT b2.id FROM backup_copies b2 WHERE b2.destination = b.destination AND b2.target_kind = b.target_kind AND b2.target_id = b.target_id
           AND b2.status <> 'pruned' ORDER BY b2.started_at DESC, b2.id DESC LIMIT 1)`,
      [destination],
    );
    return rows.map(fromRow);
  }

  async restoreStarted(s: RestoreLogStart) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO backup_restores (started_at, actor, source, target_kind, target_id, backup_id, manifest_key, server_alias, database_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`,
      [s.startedAt, s.actor.slice(0, 100), s.source, s.targetKind, s.targetId, s.backupId ?? null, s.manifestKey ?? null, s.serverAlias ?? null, s.databaseName ?? null],
    );
    return r.insertId;
  }

  async restoreFinished(id: number, e: RestoreLogEnd) {
    await this.pool.query(
      `UPDATE backup_restores SET finished_at = ?, status = ?, verified = ?, switched = ?, database_name = COALESCE(?, database_name),
         files_count = ?, error = ? WHERE id = ?`,
      [e.finishedAt, e.status, e.verified ? 1 : 0, e.switched ? 1 : 0, e.databaseName ?? null, e.filesCount ?? null, e.error?.slice(0, 500) ?? null, id],
    );
  }

  async listRestores(limit = 50) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM backup_restores ORDER BY started_at DESC, id DESC LIMIT ?",
      [Math.min(Math.max(limit, 1), 1000)],
    );
    return rows.map(restoreFromRow);
  }
}

export class MemoryBackupCopyLedger implements BackupCopyLedger {
  rows: BackupCopyRecord[] = [];
  restores: RestoreLogRecord[] = [];
  private seq = 0;
  async ready() {
    return true;
  }
  async record(c: BackupCopyInput) {
    const id = ++this.seq;
    this.rows.push({ ...c, id, durationMs: Math.max(0, c.finishedAt - c.startedAt), prunedAt: null });
    return id;
  }
  async get(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(f: CopyListFilter) {
    return this.rows
      .filter((r) => r.destination === f.destination && (!f.targetKind || r.targetKind === f.targetKind) && (!f.targetId || r.targetId === f.targetId) && (!f.status || r.status === f.status))
      .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
      .slice(0, f.limit ?? 100);
  }
  async markPruned(ids: number[], at: number) {
    for (const r of this.rows) if (ids.includes(r.id) && r.status === "ok") Object.assign(r, { status: "pruned", prunedAt: at });
  }
  async lastSuccess(destination: BackupDestination, kind: CopyTargetKind) {
    const out: Record<string, number> = {};
    for (const r of this.rows) if (r.destination === destination && r.targetKind === kind && r.status !== "failed") out[r.targetId] = Math.max(out[r.targetId] ?? 0, r.finishedAt);
    return out;
  }
  async latestAttempts(destination: BackupDestination) {
    const m = new Map<string, BackupCopyRecord>();
    for (const r of [...this.rows].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id)) {
      if (r.destination === destination && r.status !== "pruned") m.set(`${r.targetKind}:${r.targetId}`, r);
    }
    return Array.from(m.values());
  }
  async restoreStarted(s: RestoreLogStart) {
    const id = this.restores.length + 1;
    this.restores.push({ backupId: null, manifestKey: null, serverAlias: null, databaseName: null, ...s, id, finishedAt: null, status: "running", verified: false, switched: false, filesCount: null, error: null });
    return id;
  }
  async restoreFinished(id: number, e: RestoreLogEnd) {
    const r = this.restores.find((x) => x.id === id);
    if (r) Object.assign(r, { ...e, switched: !!e.switched, databaseName: e.databaseName ?? r.databaseName, filesCount: e.filesCount ?? null, error: e.error ?? null });
  }
  async listRestores(limit = 50) {
    return [...this.restores].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id).slice(0, limit);
  }
}
