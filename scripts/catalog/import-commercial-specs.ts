/**
 * Carga las fichas comerciales y la política propuesta en los BORRADORES del catálogo comercial (nunca publica).
 *
 *   CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/import-commercial-specs.ts            # simulación (no escribe)
 *   CATALOG_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/catalog/import-commercial-specs.ts --apply \
 *       [--confirm-database <nombre>] [--only clave1,clave2]                                                # escribe borradores
 *
 * - Por defecto SOLO simula. Con `--apply` sobre una BD que no sea local exige `--confirm-database <nombre>`.
 * - Idempotente; cada borrador queda versionado y auditado. Publicar cada ficha es una decisión del CRM.
 * - Nunca imprime la URL ni credenciales.
 */
import mysql from "mysql2/promise";
import { BUILTIN_MODULES } from "../../server/_core/modules/builtin";
import { importCommercialSpecs } from "../../server/catalog/commercial/importSpecs";
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
    const store = new MysqlWebStore(pool);
    const svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
    const keys = value("--only")?.split(",").filter(Boolean);
    const report = await importCommercialSpecs(svc, store, { dryRun: !apply, keys });
    console.log(JSON.stringify({ database: dbName, ...report }, null, 2));
    if (!apply) console.log("Simulación: no se ha escrito nada. Repite con --apply para guardar los borradores (no se publica nada).");
    if (report.failed.length || report.missing.length) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

void main();
