/**
 * Migraciones por módulo sobre la BD de un tenant.
 *
 * Cada módulo trae sus migraciones (`NNNN_nombre.sql`) y se aplican por tenant, con su propio
 * historial (`__elephant_module_migrations`), de forma independiente de las del Core.
 *
 * Garantías: dry-run por defecto; bloqueo de sesión por módulo; migraciones ya aplicadas
 * inmutables (checksum); un fallo detiene la ejecución; sentencias destructivas exigen la marca
 * `-- allow-destructive` en el propio fichero (misma convención que db/migrations).
 */
import path from "node:path";
import type mysql from "mysql2/promise";
import { loadMigrations, splitStatements, validateMigrations, type Migration } from "../../../scripts/db/migrationLib";
import { ModuleError, type ModuleManifest } from "./contract";

const TABLE = "__elephant_module_migrations";

export interface ModuleMigrationPlan {
  moduleId: string;
  pending: Migration[];
  applied: string[];
}

export async function ensureHistoryTable(pool: Pick<mysql.Pool, "query">): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       module_id    VARCHAR(32)  NOT NULL,
       migration_id VARCHAR(100) NOT NULL,
       checksum     CHAR(64)     NOT NULL,
       applied_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (module_id, migration_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

export async function planModuleMigrations(
  pool: Pick<mysql.Pool, "query">,
  manifest: ModuleManifest,
  moduleRoot: string,
): Promise<ModuleMigrationPlan> {
  if (!manifest.migrationsDir) return { moduleId: manifest.id, pending: [], applied: [] };
  const dir = path.resolve(moduleRoot, manifest.migrationsDir);
  const { migrations, errors } = loadMigrations(dir);
  const problems = [...errors, ...validateMigrations(migrations)];
  if (problems.length) throw new ModuleError("invalid_manifest", `${manifest.id}: ${problems.join("; ")}`);

  await ensureHistoryTable(pool);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT migration_id, checksum FROM ${TABLE} WHERE module_id = ?`,
    [manifest.id],
  );
  const applied = new Map<string, string>(rows.map((r) => [r.migration_id as string, r.checksum as string]));
  for (const m of migrations) {
    const sum = applied.get(m.id);
    if (sum && sum !== m.checksum) {
      throw new ModuleError("invalid_manifest", `${manifest.id}: la migración ${m.id} ya aplicada ha cambiado`);
    }
  }
  return {
    moduleId: manifest.id,
    pending: migrations.filter((m) => !applied.has(m.id)),
    applied: Array.from(applied.keys()).sort(),
  };
}

export async function applyModuleMigrations(
  pool: mysql.Pool,
  manifest: ModuleManifest,
  moduleRoot: string,
  opts: { apply?: boolean } = {},
): Promise<ModuleMigrationPlan & { ran: string[] }> {
  const plan = await planModuleMigrations(pool, manifest, moduleRoot);
  if (!opts.apply || plan.pending.length === 0) return { ...plan, ran: [] };

  const conn = await pool.getConnection();
  const lock = `es_mod_${manifest.id}`;
  const ran: string[] = [];
  try {
    const [l] = await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 5) AS got", [lock]);
    if (!l[0]?.got) throw new ModuleError("invalid_manifest", `${manifest.id}: otra ejecución de migraciones está en curso`);
    try {
      for (const m of plan.pending) {
        for (const stmt of splitStatements(m.up)) await conn.query(stmt);
        await conn.query(`INSERT INTO ${TABLE} (module_id, migration_id, checksum) VALUES (?,?,?)`, [
          manifest.id,
          m.id,
          m.checksum,
        ]);
        ran.push(m.id);
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [lock]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
  return { ...plan, ran };
}
