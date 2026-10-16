/**
 * Carga el catálogo oficial de Elephant Source v1 en la BD del CRM (catálogo comercial).
 *
 *   CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/seed-elephant-source.ts            # simulación (no escribe)
 *   CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/seed-elephant-source.ts --apply \
 *       [--confirm-database <nombre>]                                                                    # escribe
 *
 * - Requiere la migración 0008 aplicada (tipo «capability»).
 * - Por defecto SOLO simula. Con `--apply` sobre una BD que no sea local exige
 *   `--confirm-database <nombre>` (como el ejecutor de migraciones).
 * - Idempotente; nunca despublica ni borra; todo queda auditado con el autor de la semilla.
 * - Nunca imprime la URL ni credenciales.
 */
import mysql from "mysql2/promise";
import { BUILTIN_MODULES } from "../../server/_core/modules/builtin";
import { seedElephantSource } from "../../server/catalog/seed";
import { WebAdminService } from "../../server/web/service";
import { MysqlWebStore } from "../../server/web/store";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};

async function main() {
  const url = process.env.CATALOG_DATABASE_URL;
  if (!url) fail("Falta CATALOG_DATABASE_URL (BD del CRM).");
  const u = new URL(url!);
  const dbName = u.pathname.replace(/^\//, "");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const apply = flag("--apply");
  if (apply && !isLocal && value("--confirm-database") !== dbName) fail(`Base de datos remota: añade --confirm-database ${dbName} para confirmar que es la correcta.`);
  const pool = mysql.createPool({ uri: url!, connectionLimit: 3 });
  try {
    // Comparar un ENUM con un valor que no admite no da error: se mira el tipo real de la columna
    const ready = await pool
      .query<mysql.RowDataPacket[]>("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'web_entries' AND COLUMN_NAME = 'kind'")
      .then(([rows]) => String(rows[0]?.t ?? "").includes("'capability'"), () => false);
    if (!ready) fail("La BD no tiene el catálogo comercial con la migración 0008 (tipo «capability»). Aplica antes las migraciones del CRM.");
    const store = new MysqlWebStore(pool);
    const svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
    const report = await seedElephantSource(svc, store, { dryRun: !apply });
    console.log(JSON.stringify({ database: dbName, ...report, created: report.created.length, updated: report.updated, published: report.published.length, pricesApproved: report.pricesApproved.length }, null, 2));
    if (!apply) console.log("Simulación: no se ha escrito nada. Repite con --apply para aplicarlo.");
    if (report.conflicts.length) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

void main();
