/**
 * Aplica las migraciones del registro de tenants (db/registry/*.sql).
 *
 *   REGISTRY_ADMIN_DATABASE_URL=mysql://… tsx scripts/registry-migrate.ts          # plan (no escribe)
 *   REGISTRY_ADMIN_DATABASE_URL=mysql://… tsx scripts/registry-migrate.ts --execute
 *
 * La BD del registro debe existir y estar vacía o en una versión anterior. Haz copia antes de ejecutar.
 */
import path from "node:path";
import mysql from "mysql2/promise";
import { migrateRegistry } from "../server/_core/tenantRegistry/migrate";

async function main() {
  const url = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!url) {
    console.error("Falta REGISTRY_ADMIN_DATABASE_URL");
    process.exit(2);
  }
  const execute = process.argv.includes("--execute");
  const pool = mysql.createPool({ uri: url, connectionLimit: 1, multipleStatements: true });
  try {
    const r = await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: !execute });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : "error");
  process.exit(1);
});
