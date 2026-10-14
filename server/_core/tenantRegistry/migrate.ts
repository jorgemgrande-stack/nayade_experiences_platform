/**
 * Aplicador de migraciones del registro (`db/registry/NNNN_*.sql`).
 *
 *  - Ordenado por número; sin huecos (0000, 0001, …).
 *  - Estado en `registry_meta.schema_version`; solo se aplican las posteriores a la actual.
 *  - Cada fichero es idempotente (`IF NOT EXISTS`) y fija su propia versión; se verifica tras aplicar.
 *  - Por defecto es un plan (no escribe). Una migración fallida detiene la cadena.
 */
import fs from "node:fs";
import path from "node:path";
import type mysql from "mysql2/promise";

export interface RegistryMigrationFile {
  version: string;
  file: string;
}

export interface RegistryMigrationResult {
  current: string | null;
  target: string | null;
  pending: string[];
  applied: string[];
  dryRun: boolean;
}

export class RegistryMigrationError extends Error {
  constructor(
    public readonly code: "gap" | "no_files" | "failed" | "version_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "RegistryMigrationError";
  }
}

export function listRegistryMigrations(dir: string): RegistryMigrationFile[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(f))
    .sort()
    .map((f) => ({ version: f.slice(0, 4), file: path.join(dir, f) }));
  if (files.length === 0) throw new RegistryMigrationError("no_files", "No hay migraciones del registro");
  files.forEach((f, i) => {
    if (Number(f.version) !== i) throw new RegistryMigrationError("gap", `Falta la migración ${String(i).padStart(4, "0")}`);
  });
  return files;
}

async function currentVersion(pool: Pick<mysql.Pool, "query">): Promise<string | null> {
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'");
    return rows[0]?.v ?? null;
  } catch (e: any) {
    if (e?.code === "ER_NO_SUCH_TABLE") return null;
    throw e;
  }
}

/** `pool` debe permitir `multipleStatements`. */
export async function migrateRegistry(
  pool: Pick<mysql.Pool, "query">,
  dir: string,
  opts: { dryRun?: boolean } = {},
): Promise<RegistryMigrationResult> {
  const dryRun = opts.dryRun !== false;
  const files = listRegistryMigrations(dir);
  const current = await currentVersion(pool);
  const pending = files.filter((f) => current === null || f.version > current);
  const result: RegistryMigrationResult = {
    current,
    target: files[files.length - 1].version,
    pending: pending.map((f) => f.version),
    applied: [],
    dryRun,
  };
  if (dryRun) return result;

  for (const f of pending) {
    const ddl = fs.readFileSync(f.file, "utf8").replace(/^--.*$/gm, "");
    try {
      await pool.query(ddl);
    } catch (e: any) {
      throw new RegistryMigrationError("failed", `Migración ${f.version} fallida: ${e?.code ?? "error"}`);
    }
    const now = await currentVersion(pool);
    if (now !== f.version) {
      throw new RegistryMigrationError("version_mismatch", `Tras ${f.version} la versión es ${now ?? "ninguna"}`);
    }
    result.applied.push(f.version);
  }
  return result;
}
