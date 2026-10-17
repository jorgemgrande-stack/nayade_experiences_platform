/**
 * Metadatos de los ficheros (`stored_objects`, migración db/migrations/0009) en la base de datos de la
 * empresa en curso. La empresa es implícita: cada empresa tiene su propia base de datos.
 */
import type mysql from "mysql2/promise";
import { legacyPool } from "./_core/legacyDb";

export type ObjectStatus = "pending" | "active" | "replaced" | "deleted" | "failed";

export interface StoredObjectRow {
  objectId: string;
  storageKey: string;
  visibility: "public" | "private";
  category: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  ownerType: string | null;
  ownerId: string | null;
  uploadedBy: number | null;
  status: ObjectStatus;
  replacesObjectId: string | null;
  replacedBy: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
  deletedAt: number | null;
  bytesRemovedAt: number | null;
}

export interface ObjectMetaStore {
  insert(row: StoredObjectRow): Promise<void>;
  update(objectId: string, patch: Partial<StoredObjectRow>): Promise<void>;
  get(objectId: string): Promise<StoredObjectRow | null>;
  getByKey(storageKey: string): Promise<StoredObjectRow | null>;
  /** Filas en esos estados con `updated_at` anterior a `before` y contenido aún en el bucket. */
  listStale(statuses: ObjectStatus[], before: number, limit?: number): Promise<StoredObjectRow[]>;
  /** ¿Qué claves de esta lista tienen fila? (detección de huérfanos del bucket). */
  knownKeys(keys: string[]): Promise<Set<string>>;
  /** Restauración: inserta o sustituye la fila de un objeto. */
  upsert(row: StoredObjectRow): Promise<void>;
}

const COLS: Array<[keyof StoredObjectRow, string]> = [
  ["objectId", "object_id"],
  ["storageKey", "storage_key"],
  ["visibility", "visibility"],
  ["category", "category"],
  ["contentType", "content_type"],
  ["sizeBytes", "size_bytes"],
  ["sha256", "sha256"],
  ["originalName", "original_name"],
  ["ownerType", "owner_type"],
  ["ownerId", "owner_id"],
  ["uploadedBy", "uploaded_by"],
  ["status", "status"],
  ["replacesObjectId", "replaces_object_id"],
  ["replacedBy", "replaced_by"],
  ["error", "error"],
  ["createdAt", "created_at"],
  ["updatedAt", "updated_at"],
  ["confirmedAt", "confirmed_at"],
  ["deletedAt", "deleted_at"],
  ["bytesRemovedAt", "bytes_removed_at"],
];
const NUMERIC = new Set<keyof StoredObjectRow>(["sizeBytes", "uploadedBy", "createdAt", "updatedAt", "confirmedAt", "deletedAt", "bytesRemovedAt"]);

function fromDb(r: Record<string, unknown>): StoredObjectRow {
  const out: Record<string, unknown> = {};
  for (const [js, col] of COLS) {
    const v = r[col];
    out[js] = v === null || v === undefined ? null : NUMERIC.has(js) ? Number(v) : v;
  }
  return out as unknown as StoredObjectRow;
}

export class MysqlObjectMetaStore implements ObjectMetaStore {
  /** Por defecto, el pool de la empresa en curso (resuelto en cada acceso). */
  constructor(private pool: () => mysql.Pool = () => legacyPool()) {}

  async insert(row: StoredObjectRow) {
    const cols = COLS.map(([, c]) => `\`${c}\``).join(", ");
    await this.pool().query(`INSERT INTO stored_objects (${cols}) VALUES (${COLS.map(() => "?").join(", ")})`, COLS.map(([k]) => row[k] ?? null));
  }
  async update(objectId: string, patch: Partial<StoredObjectRow>) {
    const sets = COLS.filter(([k]) => k !== "objectId" && k in patch);
    if (!sets.length) return;
    await this.pool().query(
      `UPDATE stored_objects SET ${sets.map(([, c]) => `\`${c}\` = ?`).join(", ")} WHERE object_id = ?`,
      [...sets.map(([k]) => (patch as Record<string, unknown>)[k] ?? null), objectId],
    );
  }
  async get(objectId: string) {
    const [rows] = await this.pool().query("SELECT * FROM stored_objects WHERE object_id = ? LIMIT 1", [objectId]);
    const r = (rows as Record<string, unknown>[])[0];
    return r ? fromDb(r) : null;
  }
  async getByKey(storageKey: string) {
    const [rows] = await this.pool().query("SELECT * FROM stored_objects WHERE storage_key = ? LIMIT 1", [storageKey]);
    const r = (rows as Record<string, unknown>[])[0];
    return r ? fromDb(r) : null;
  }
  async listStale(statuses: ObjectStatus[], before: number, limit = 500) {
    if (!statuses.length) return [];
    const [rows] = await this.pool().query(
      `SELECT * FROM stored_objects WHERE status IN (${statuses.map(() => "?").join(", ")}) AND updated_at < ? AND bytes_removed_at IS NULL ORDER BY updated_at LIMIT ?`,
      [...statuses, before, limit],
    );
    return (rows as Record<string, unknown>[]).map(fromDb);
  }
  async knownKeys(keys: string[]) {
    const out = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const [rows] = await this.pool().query(`SELECT storage_key FROM stored_objects WHERE storage_key IN (${chunk.map(() => "?").join(", ")})`, chunk);
      for (const r of rows as Array<{ storage_key: string }>) out.add(r.storage_key);
    }
    return out;
  }
  async upsert(row: StoredObjectRow) {
    const cols = COLS.map(([, c]) => `\`${c}\``).join(", ");
    const updates = COLS.filter(([k]) => k !== "objectId").map(([, c]) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
    await this.pool().query(
      `INSERT INTO stored_objects (${cols}) VALUES (${COLS.map(() => "?").join(", ")}) ON DUPLICATE KEY UPDATE ${updates}`,
      COLS.map(([k]) => row[k] ?? null),
    );
  }
}

/** Almacén en memoria (pruebas unitarias). */
export class MemoryObjectMetaStore implements ObjectMetaStore {
  rows = new Map<string, StoredObjectRow>();
  async insert(row: StoredObjectRow) {
    if (this.rows.has(row.objectId) || Array.from(this.rows.values()).some((r) => r.storageKey === row.storageKey)) throw new Error("Duplicado");
    this.rows.set(row.objectId, { ...row });
  }
  async update(objectId: string, patch: Partial<StoredObjectRow>) {
    const r = this.rows.get(objectId);
    if (r) this.rows.set(objectId, { ...r, ...patch });
  }
  async get(objectId: string) {
    const r = this.rows.get(objectId);
    return r ? { ...r } : null;
  }
  async getByKey(storageKey: string) {
    const r = Array.from(this.rows.values()).find((x) => x.storageKey === storageKey);
    return r ? { ...r } : null;
  }
  async listStale(statuses: ObjectStatus[], before: number) {
    return Array.from(this.rows.values()).filter((r) => statuses.includes(r.status) && r.updatedAt < before && r.bytesRemovedAt === null).map((r) => ({ ...r }));
  }
  async knownKeys(keys: string[]) {
    const all = new Set(Array.from(this.rows.values()).map((r) => r.storageKey));
    return new Set(keys.filter((k) => all.has(k)));
  }
  async upsert(row: StoredObjectRow) {
    this.rows.set(row.objectId, { ...row });
  }
}
