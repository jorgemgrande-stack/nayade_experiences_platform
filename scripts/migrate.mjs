/**
 * migrate.mjs — Aplica únicamente migraciones pendientes.
 *
 * Estrategia para BD ya existente:
 *   Si __drizzle_migrations está vacía pero la BD ya tiene tablas (users),
 *   marca todas las migraciones previas como aplicadas SIN re-ejecutar su SQL
 *   (el schema ya existe), y solo ejecuta las genuinamente nuevas.
 *
 * Uso: node scripts/migrate.mjs
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

// Crear tabla de tracking si no existe
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

// Migraciones ya registradas en la tabla de tracking
const [appliedRows] = await conn.execute("SELECT `hash` FROM `__drizzle_migrations`");
const appliedSet = new Set(appliedRows.map(r => r.hash));

// ── Detección de BD ya existente ──────────────────────────────────────────────
// Si el tracking está vacío pero la BD ya tiene tablas, significa que las
// migraciones anteriores se aplicaron manualmente o con drizzle-kit sin tracking.
// En ese caso: marcamos todo lo previo como aplicado y solo ejecutamos lo nuevo.
if (appliedSet.size === 0) {
  const [existingTables] = await conn.execute("SHOW TABLES LIKE 'users'");
  if (existingTables.length > 0) {
    // BD ya bootstrapeada — registrar migraciones previas sin re-ejecutarlas
    const previous = journal.entries.slice(0, -1); // todas excepto la última
    for (const entry of previous) {
      await conn.execute(
        "INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        [entry.tag, entry.when]
      );
      appliedSet.add(entry.tag);
    }
    console.log(`[migrate] BD existente — ${previous.length} migraciones previas registradas sin re-ejecutar.`);
  }
}

// ── Aplicar migraciones pendientes ────────────────────────────────────────────
let ran = 0;
for (const entry of journal.entries) {
  if (appliedSet.has(entry.tag)) continue;

  const sqlPath = join(root, "drizzle", `${entry.tag}.sql`);
  if (!existsSync(sqlPath)) {
    console.warn(`[migrate] Archivo no encontrado, saltando: ${entry.tag}.sql`);
    // Registrar igualmente para no bloquear futuras migraciones
    await conn.execute(
      "INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
      [entry.tag, entry.when]
    );
    continue;
  }

  const raw = readFileSync(sqlPath, "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  console.log(`[migrate] Aplicando: ${entry.tag} (${statements.length} sentencias)`);

  let failed = false;
  for (const stmt of statements) {
    try {
      await conn.execute(stmt);
    } catch (err) {
      const ignorable = [
        1060, // Duplicate column name
        1061, // Duplicate key name
        1050, // Table already exists
        1091, // Can't DROP, doesn't exist
      ];
      if (ignorable.includes(err.errno)) {
        console.warn(`[migrate]   ⚠ Ignorado (${err.errno}): ${err.sqlMessage}`);
      } else {
        console.error(`[migrate]   ✗ Error fatal (${err.errno}): ${err.sqlMessage}`);
        console.error(`[migrate]   SQL: ${stmt.slice(0, 300)}`);
        failed = true;
        break;
      }
    }
  }

  if (failed) {
    await conn.end();
    process.exit(1);
  }

  await conn.execute(
    "INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
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
