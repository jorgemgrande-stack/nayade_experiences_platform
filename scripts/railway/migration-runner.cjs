/**
 * Lanzador de los ejecutores de migraciones DENTRO del contenedor del plano de control (red privada de Railway).
 * Usa PROVISIONING_DB_ADMIN_URL del propio contenedor y nunca imprime URL ni credenciales.
 * Se ejecuta desde el paquete que genera scripts/railway/build-migration-bundle.sh (carpeta /app/.mig).
 *
 *   node run.cjs registry plan|apply        registro (es_registry): plan = simulación; apply = aplica las pendientes
 *   node run.cjs crm status|plan|apply      CRM (es_crm): estado del registro de migraciones, simulación o aplicación
 *
 *   … [--database <copia>]                   ENSAYO sobre una copia restaurada: solo bases «*_drill_*»
 *
 * «apply» sobre las bases reales exige autorización expresa del propietario (docs/elephant-source/DESPLIEGUE_LIVE.md). Los ejecutores
 * piden además confirmar el nombre de la base (--confirm-database).
 */
const { spawnSync } = require("child_process");
const [lane, mode] = process.argv.slice(2);
// Ensayo: una copia restaurada (nunca otra base real). Sin --database, la base real del carril
const i = process.argv.indexOf("--database");
const override = i > 0 ? process.argv[i + 1] : null;
if (override !== null && !/^es_(registry|crm)_drill_[a-z0-9_]{1,40}$/.test(override || "")) {
  console.error("--database solo admite copias de ensayo es_registry_drill_* o es_crm_drill_*");
  process.exit(2);
}
if (override && !override.startsWith(lane === "registry" ? "es_registry_drill_" : "es_crm_drill_")) {
  console.error("la copia de ensayo no corresponde al carril");
  process.exit(2);
}
const withDb = (url, db) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const admin = process.env.PROVISIONING_DB_ADMIN_URL;
let r;
if (lane === "registry") {
  const env = { ...process.env, REGISTRY_MIGRATE_URL: withDb(admin, override || "es_registry") };
  const args = ["scripts/registry-migrate.mjs", ...(mode === "apply" ? ["--execute", "--confirm-database", override || "es_registry", "--allow-remote"] : [])];
  r = spawnSync("node", args, { cwd: "/app/.mig", env, encoding: "utf8" });
} else if (lane === "crm") {
  const env = { ...process.env, MIGRATE_DATABASE_URL: withDb(admin, override || "es_crm") };
  const cmd = mode === "status" ? ["status"] : ["up"];
  const args = ["scripts/migrate.mjs", ...cmd, "--dir", "db/crm/migrations", ...(mode === "apply" ? ["--apply", "--confirm-database", override || "es_crm", "--allow-remote"] : [])];
  r = spawnSync("node", args, { cwd: "/app/.mig", env, encoding: "utf8" });
} else {
  console.error("carril desconocido");
  process.exit(2);
}
const scrub = (s) => (s || "").replace(/mysql:\/\/[^\s"']+/g, "mysql://***");
process.stdout.write(scrub(r.stdout));
process.stderr.write(scrub(r.stderr));
process.exit(r.status ?? 1);
