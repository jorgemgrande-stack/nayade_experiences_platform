/**
 * Restauración local y aislada de la copia de UNA empresa (sin registro, sin Railway).
 * Guía: docs/runbooks/RESTAURACION_LOCAL_AISLADA.md
 *
 *   npx tsx scripts/restoreTenantLocal.ts --list <empresa>
 *   npx tsx scripts/restoreTenantLocal.ts --manifest <tenants/<empresa>/AAAA/MM/....manifest.json> \
 *       --admin-url-env LOCAL_MYSQL_ADMIN_URL --database <base_nueva> [--apply]
 *
 * Las claves (BACKUP_KEYS, BACKUP_S3_*...) solo se leen del entorno; nada se escribe en disco ni en el bucket.
 */
import { backupKeyringFromEnv } from "../server/_core/ops/backupCrypto";
import { backupStorageFromEnv } from "../server/_core/ops/backupStorage";
import { assertIsolatedEnv, listTenantCopies, readOnlyStorage, restoreTenantLocal } from "../server/_core/ops/restoreLocal";
import { safeError } from "../server/_core/ops/backupInventory";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const die = (m: string): never => {
  console.error(`Error: ${m}`);
  process.exit(1);
};

async function main() {
  assertIsolatedEnv(process.env);
  const s = backupStorageFromEnv(process.env);
  if (!s.storage) return die(s.reason);
  const storage = readOnlyStorage(s.storage);

  const list = opt("--list");
  if (list) {
    for (const o of await listTenantCopies(storage, list)) console.log(`${o.bytes}\t${o.key}`);
    return;
  }
  const manifestKey = opt("--manifest") ?? die("Falta --list <empresa> o --manifest <clave>");
  const envName = opt("--admin-url-env") ?? die("Falta --admin-url-env <VARIABLE> (URL del MySQL local)");
  const adminUrl = process.env[envName] ?? die(`La variable ${envName} no está definida`);
  const database = opt("--database") ?? die("Falta --database <base nueva>");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(database)) die("Nombre de base no válido");
  const apply = argv.includes("--apply");
  const rep = await restoreTenantLocal({ storage, ring: backupKeyringFromEnv(process.env), env: process.env }, { manifestKey, adminUrl, database, apply });
  console.log(JSON.stringify(rep, null, 2));
  if (!apply) console.log("[simulacion] usa --apply para crear la base nueva en el MySQL local");
  if (rep.verificacion && !rep.verificacion.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`Error: ${safeError(e)}`);
  process.exit(1);
});
