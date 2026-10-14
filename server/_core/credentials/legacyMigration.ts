/**
 * Migración del cifrado de campo de credenciales heredadas.
 *
 *  - Idempotente: los valores ya cifrados se omiten; repetirla no cambia nada.
 *  - Reanudable: cada fila se procesa de forma independiente; un fallo no deja filas a medias.
 *  - Segura ante concurrencia: la actualización solo se aplica si el valor sigue siendo el leído.
 *  - Verificada: antes de escribir se descifra el resultado y se compara con el original.
 *  - Auditable: devuelve (y opcionalmente persiste) un registro por fila SIN valores.
 *  - Reversible: `rollback` restaura el texto plano a partir del cifrado.
 */
import type mysql from "mysql2/promise";
import type { Keyring } from "./vault";
import {
  LEGACY_SECRET_FIELDS,
  LegacyCryptoError,
  decryptLegacy,
  encryptLegacy,
  isLegacyEncrypted,
  type LegacyTable,
} from "./legacyFields";

type Pool = Pick<mysql.Pool, "query">;

export type FieldState = "absent" | "empty" | "plaintext" | "encrypted" | "unreadable";
export type FieldAction = "encrypted" | "restored" | "skipped" | "conflict" | "error";

export interface FieldPlan {
  table: LegacyTable;
  key: string;
  state: FieldState;
}

export interface AuditEntry {
  at: number;
  actor: string;
  table: LegacyTable;
  key: string;
  action: FieldAction;
  keyId?: string;
  code?: string;
  dryRun: boolean;
}

export interface MigrationReport {
  dryRun: boolean;
  entries: AuditEntry[];
  summary: Record<FieldAction, number>;
}

const FIELDS = LEGACY_SECRET_FIELDS;

async function readValue(pool: Pool, table: LegacyTable, key: string): Promise<string | null | undefined> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT \`value\` FROM \`${table}\` WHERE \`key\` = ? LIMIT 1`, [key]);
  if (!rows.length) return undefined;
  return rows[0].value ?? null;
}

async function guardedUpdate(pool: Pool, table: LegacyTable, key: string, from: string, to: string): Promise<boolean> {
  const [res] = await pool.query<mysql.ResultSetHeader>(`UPDATE \`${table}\` SET \`value\` = ? WHERE \`key\` = ? AND \`value\` = ?`, [to, key, from]);
  return res.affectedRows === 1;
}

function emptySummary(): Record<FieldAction, number> {
  return { encrypted: 0, restored: 0, skipped: 0, conflict: 0, error: 0 };
}

/** Estado actual de cada campo (sin valores). */
export async function planLegacyCredentials(pool: Pool, ring: Keyring | null): Promise<FieldPlan[]> {
  const out: FieldPlan[] = [];
  for (const f of FIELDS) {
    const v = await readValue(pool, f.table, f.key);
    let state: FieldState;
    if (v === undefined) state = "absent";
    else if (v === null || v === "") state = "empty";
    else if (!isLegacyEncrypted(v)) state = "plaintext";
    else {
      try {
        decryptLegacy(v, f.table, f.key, ring);
        state = "encrypted";
      } catch {
        state = "unreadable";
      }
    }
    out.push({ table: f.table, key: f.key, state });
  }
  return out;
}

export async function ensureAuditTable(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS legacy_credential_audit (
       id INT AUTO_INCREMENT PRIMARY KEY,
       at BIGINT NOT NULL,
       actor VARCHAR(100) NOT NULL,
       table_name VARCHAR(40) NOT NULL,
       setting_key VARCHAR(100) NOT NULL,
       action VARCHAR(20) NOT NULL,
       key_id VARCHAR(60) NULL,
       code VARCHAR(40) NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

async function persistAudit(pool: Pool, entries: AuditEntry[]): Promise<void> {
  await ensureAuditTable(pool);
  for (const e of entries) {
    await pool.query(
      "INSERT INTO legacy_credential_audit (at, actor, table_name, setting_key, action, key_id, code) VALUES (?,?,?,?,?,?,?)",
      [e.at, e.actor, e.table, e.key, e.action, e.keyId ?? null, e.code ?? null],
    );
  }
}

export interface RunOptions {
  ring: Keyring;
  actor: string;
  /** Por defecto `true`: no escribe nada. */
  dryRun?: boolean;
  /** Persistir el registro de auditoría en la propia BD (solo si no es simulacro). */
  persistAudit?: boolean;
  now?: () => number;
}

/** Cifra los valores heredados en claro. */
export async function applyLegacyEncryption(pool: Pool, o: RunOptions): Promise<MigrationReport> {
  const dryRun = o.dryRun !== false;
  const now = o.now ?? Date.now;
  const entries: AuditEntry[] = [];
  const add = (f: { table: LegacyTable; key: string }, action: FieldAction, extra: Partial<AuditEntry> = {}) =>
    entries.push({ at: now(), actor: o.actor, table: f.table, key: f.key, action, dryRun, ...extra });

  for (const f of FIELDS) {
    try {
      const v = await readValue(pool, f.table, f.key);
      if (v === undefined || v === null || v === "" || isLegacyEncrypted(v)) {
        add(f, "skipped");
        continue;
      }
      const enc = encryptLegacy(v, f.table, f.key, o.ring);
      if (decryptLegacy(enc, f.table, f.key, o.ring) !== v) throw new LegacyCryptoError("corrupt");
      if (dryRun) {
        add(f, "encrypted", { keyId: o.ring.activeId });
        continue;
      }
      if (await guardedUpdate(pool, f.table, f.key, v, enc)) add(f, "encrypted", { keyId: o.ring.activeId });
      else add(f, "conflict");
    } catch (e) {
      add(f, "error", { code: e instanceof LegacyCryptoError ? e.code : "db_error" });
    }
  }
  return finish(pool, entries, dryRun, o.persistAudit);
}

/** Restaura el texto plano (reversión). */
export async function rollbackLegacyEncryption(pool: Pool, o: RunOptions): Promise<MigrationReport> {
  const dryRun = o.dryRun !== false;
  const now = o.now ?? Date.now;
  const entries: AuditEntry[] = [];
  const add = (f: { table: LegacyTable; key: string }, action: FieldAction, extra: Partial<AuditEntry> = {}) =>
    entries.push({ at: now(), actor: o.actor, table: f.table, key: f.key, action, dryRun, ...extra });

  for (const f of FIELDS) {
    try {
      const v = await readValue(pool, f.table, f.key);
      if (!v || !isLegacyEncrypted(v)) {
        add(f, "skipped");
        continue;
      }
      const plain = decryptLegacy(v, f.table, f.key, o.ring);
      if (dryRun) {
        add(f, "restored");
        continue;
      }
      if (await guardedUpdate(pool, f.table, f.key, v, plain)) add(f, "restored");
      else add(f, "conflict");
    } catch (e) {
      add(f, "error", { code: e instanceof LegacyCryptoError ? e.code : "db_error" });
    }
  }
  return finish(pool, entries, dryRun, o.persistAudit);
}

async function finish(pool: Pool, entries: AuditEntry[], dryRun: boolean, persist?: boolean): Promise<MigrationReport> {
  const summary = emptySummary();
  for (const e of entries) summary[e.action]++;
  if (persist && !dryRun) await persistAudit(pool, entries.filter((e) => e.action !== "skipped"));
  return { dryRun, entries, summary };
}
