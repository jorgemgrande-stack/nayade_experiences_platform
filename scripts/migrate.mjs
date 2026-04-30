/**
 * migrate.mjs — Aplica migraciones SQL pendientes contra la base de datos.
 * Ejecuta las sentencias de cada archivo SQL registrado en drizzle/meta/_journal.json
 * que aún no están en la tabla __drizzle_migrations de la BD.
 *
 * Uso: node scripts/migrate.mjs
 * Compatible con Node 18+ sin TypeScript ni drizzle-kit.
 */

import mysql from "mysql2/promise";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[migrate] DATABASE_URL no configurada — abortando");
  process.exit(1);
}

const conn = await mysql.createConnection(dbUrl);

// Crear tabla de control de migraciones si no existe (igual que drizzle-kit)
await conn.execute(`
  CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
    \`id\`         INT AUTO_INCREMENT PRIMARY KEY,
    \`hash\`       TEXT NOT NULL,
    \`created_at\` BIGINT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

// Leer journal
const journalPath = join(root, "drizzle", "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8"));

// Migraciones ya aplicadas
const [applied] = await conn.execute("SELECT `hash` FROM `__drizzle_migrations`");
const appliedSet = new Set(applied.map(r => r.hash));

let ran = 0;
for (const entry of journal.entries) {
  if (appliedSet.has(entry.tag)) continue;

  const sqlPath = join(root, "drizzle", `${entry.tag}.sql`);
  if (!existsSync(sqlPath)) {
    console.warn(`[migrate] Archivo no encontrado, saltando: ${entry.tag}.sql`);
    continue;
  }

  const raw = readFileSync(sqlPath, "utf8");
  // drizzle-kit usa --> statement-breakpoint para separar sentencias
  const statements = raw
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  console.log(`[migrate] Aplicando: ${entry.tag} (${statements.length} sentencias)`);

  for (const stmt of statements) {
    try {
      await conn.execute(stmt);
    } catch (err) {
      // Errores no fatales: columna/tabla ya existe, índice duplicado
      const ignorable = [
        1060, // Duplicate column name
        1061, // Duplicate key name
        1050, // Table already exists
        1091, // Can't DROP, doesn't exist (ignorar en rollbacks parciales)
      ];
      if (ignorable.includes(err.errno)) {
        console.warn(`[migrate]   ⚠ Ignorado (${err.errno}): ${err.sqlMessage}`);
      } else {
        console.error(`[migrate]   ✗ Error en sentencia: ${err.message}`);
        console.error(`[migrate]   SQL: ${stmt.slice(0, 200)}`);
        await conn.end();
        process.exit(1);
      }
    }
  }

  await conn.execute(
    "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
    [entry.tag, entry.when]
  );
  console.log(`[migrate]   ✓ ${entry.tag}`);
  ran++;
}

if (ran === 0) {
  console.log("[migrate] No hay migraciones pendientes.");
} else {
  console.log(`[migrate] ${ran} migración(es) aplicada(s) correctamente.`);
}

await conn.end();
