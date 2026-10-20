/**
 * Lanzador de los ejecutores de migraciones DENTRO del contenedor del plano de control (red privada de Railway).
 * Usa PROVISIONING_DB_ADMIN_URL del propio contenedor y nunca imprime URL ni credenciales.
 * Se ejecuta desde el paquete que genera scripts/railway/build-migration-bundle.sh (carpeta /app/.mig).
 *
 *   node run.cjs registry plan|apply        registro (es_registry): plan = simulación; apply = aplica las pendientes
 *   node run.cjs crm status|plan|apply      CRM (es_crm): estado del registro de migraciones, simulación o aplicación
 *
 * «apply» exige autorización expresa del propietario (docs/elephant-source/DESPLIEGUE_LIVE.md). Los ejecutores
 * piden además confirmar el nombre de la base (--confirm-database).
 */
const { spawnSync } = require("child_process");
const [lane, mode] = process.argv.slice(2);
const withDb = (url, db) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = process.env.PROVISIONING_DB_ADMIN_URL;
let r;
if (lane === "registry") {
  const env = { ...process.env, REGISTRY_MIGRATE_URL: withDb(admin, "es_registry") };
  const args = ["scripts/registry-migrate.mjs", ...(mode === "apply" ? ["--execute", "--confirm-database", "es_registry", "--allow-remote"] : [])];
  r = spawnSync("node", args, { cwd: "/app/.mig", env, encoding: "utf8" });
} else if (lane === "crm") {
  const env = { ...process.env, MIGRATE_DATABASE_URL: withDb(admin, "es_crm") };
  const cmd = mode === "status" ? ["status"] : ["up"];
  const args = ["scripts/migrate.mjs", ...cmd, "--dir", "db/crm/migrations", ...(mode === "apply" ? ["--apply", "--confirm-database", "es_crm", "--allow-remote"] : [])];
  r = spawnSync("node", args, { cwd: "/app/.mig", env, encoding: "utf8" });
} else {
  console.error("carril desconocido");
  process.exit(2);
}
const scrub = (s) => (s || "").replace(/mysql:\/\/[^\s"']+/g, "mysql://***");
process.stdout.write(scrub(r.stdout));
process.stderr.write(scrub(r.stderr));
process.exit(r.status ?? 1);
