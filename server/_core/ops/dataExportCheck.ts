/**
 * Verificación (SOLO LECTURA) del esquema de la exportación de datos en la base de una empresa: tabla
 * `data_exports` (0011), columnas del trabajo asíncrono (0012) y de la retirada de ZIP (0013), y exportaciones en
 * curso. Se usa tras `migrate-tenants --apply` (backup-job `check-data-exports`) y en el plan de publicación.
 */
export interface DataExportSchemaStatus {
  table: boolean;
  jobColumns: boolean;
  purgeColumn: boolean;
  /** Migraciones de exportación que faltan (0011, 0012, 0013). */
  missing: string[];
  pending: number | null;
  ok: boolean;
}

type Query = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

export async function dataExportSchemaStatus(query: Query): Promise<DataExportSchemaStatus> {
  const cols = new Set(
    (await query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'data_exports'")).map((r) => String(r.c)),
  );
  const table = cols.size > 0;
  const jobColumns = ["attempts", "started_at", "heartbeat_at", "duration_ms", "uncompressed_bytes", "missing_files"].every((c) => cols.has(c));
  const purgeColumn = cols.has("purged_at");
  const missing = [...(table ? [] : ["0011_data_exports"]), ...(jobColumns ? [] : ["0012_data_export_jobs"]), ...(purgeColumn ? [] : ["0013_data_export_purge"])];
  const pending = table ? Number((await query("SELECT COUNT(*) AS n FROM data_exports WHERE status = 'pending'"))[0]?.n ?? 0) : null;
  return { table, jobColumns, purgeColumn, missing, pending, ok: missing.length === 0 };
}
