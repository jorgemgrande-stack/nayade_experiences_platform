// Aplica drizzle/0124_site_maintenance_mode.sql contra la BD (solo datos,
// INSERT IGNORE — no altera esquema, no destructivo, seguro de re-ejecutar).
//
// Uso: railway run --service MySQL npx tsx scripts/apply-maintenance-mode-settings.ts

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const PUBLIC_DB =
  process.env.MYSQL_PUBLIC_URL ||
  process.env.MYSQL_URL ||
  process.env.DATABASE_PUBLIC_URL;
if (PUBLIC_DB) process.env.DATABASE_URL = PUBLIC_DB;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ABORTADO: falta DATABASE_URL en el entorno.");
    process.exit(1);
  }
  if (process.env.DATABASE_URL.includes(".railway.internal")) {
    console.error("ABORTADO: DATABASE_URL apunta al host interno (no resuelve fuera de la VPC). Falta MYSQL_PUBLIC_URL.");
    process.exit(1);
  }

  const mysql = (await import("mysql2/promise")).default;
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(__dirname, "..", "drizzle", "0124_site_maintenance_mode.sql");
  const sql = readFileSync(sqlPath, "utf8");

  await pool.query(sql);

  const [rows] = await pool.query(
    "SELECT `key`, `value`, `is_public` FROM `system_settings` WHERE `key` IN ('site_maintenance_mode_enabled', 'site_maintenance_message')"
  );
  console.log("Filas resultantes:");
  console.log(rows);

  await pool.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
