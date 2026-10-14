/**
 * Aplica las migraciones del registro de tenants (db/registry/*.sql).
 *
 *   REGISTRY_ADMIN_DATABASE_URL=mysql://… tsx scripts/registry-migrate.ts          # plan (no escribe)
 *   REGISTRY_ADMIN_DATABASE_URL=mysql://… tsx scripts/registry-migrate.ts --execute
 *
 * La BD del registro debe existir y estar vacía o en una versión anterior. Haz copia antes de ejecutar.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { migrateRegistry, RegistryMigrationError } from "../server/_core/tenantRegistry/migrate";

// El paquete es ESM ("type": "module"): no existe __dirname.
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/registry");

async function main() {
  const url = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!url) {
    console.error("Falta REGISTRY_ADMIN_DATABASE_URL");
    process.exit(2);
  }
  const execute = process.argv.includes("--execute");
  const pool = mysql.createPool({ uri: url, connectionLimit: 1, multipleStatements: true });
  try {
    const r = await migrateRegistry(pool, MIGRATIONS_DIR, { dryRun: !execute });
    console.log(JSON.stringify(r, null, 2));
    if (r.dryRun && r.incomplete.length) {
      console.error(`AVISO: versiones registradas pero incompletas: ${r.incomplete.join(", ")} (se reaplicarán con --execute)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  if (e instanceof RegistryMigrationError) {
    console.error(`${e.name} [${e.code}]: ${e.message}`);
    for (const i of e.issues) console.error(`  - ${i.version} ${i.kind}: ${i.object}`);
  } else {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : "error");
  }
  process.exit(1);
});
