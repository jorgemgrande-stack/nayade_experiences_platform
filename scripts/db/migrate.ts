/**
 * Ejecutor explícito de migraciones (fuera del arranque de la aplicación).
 *
 *   pnpm exec tsx scripts/db/migrate.ts verify
 *   pnpm exec tsx scripts/db/migrate.ts status
 *   pnpm exec tsx scripts/db/migrate.ts up   [--to 0007] [--apply]
 *   pnpm exec tsx scripts/db/migrate.ts down [--steps 1] [--apply]
 *
 * Conexión: MIGRATE_DATABASE_URL (nunca se imprime).
 *
 * Garantías:
 *  - `verify` y `status` no escriben nada.
 *  - `up`/`down` son *dry-run* salvo `--apply`. Sobre una base de datos que no sea local,
 *    además exigen `--confirm-database <nombre>` (evita ejecutar contra la BD equivocada).
 *  - Bloqueo de sesión (GET_LOCK): no corren dos ejecutores a la vez.
 *  - Inmutabilidad: si una migración ya aplicada cambió de contenido, se aborta.
 *  - Un fallo detiene la ejecución y sale con código 1: nunca se traga.
 */
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements, validateMigrations, type Migration } from "./migrationLib";

const args = process.argv.slice(2);
const command = args[0] ?? "status";
const flag = (n: string) => args.includes(n);
const value = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

const DIR = path.resolve(process.cwd(), value("--dir") ?? "db/migrations");
const TABLE = "__elephant_migrations";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const { migrations, errors: loadErrors } = loadMigrations(DIR);
  const errors = [...loadErrors, ...validateMigrations(migrations)];

  if (command === "verify") {
    if (errors.length) {
      console.error(`✗ ${errors.length} problema(s) en ${path.relative(process.cwd(), DIR)}:`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`✓ ${migrations.length} migración(es) válidas en ${path.relative(process.cwd(), DIR)}`);
    return;
  }

  if (errors.length) {
    console.error("Las migraciones no superan la verificación; corrige antes de continuar:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) fail("Falta MIGRATE_DATABASE_URL.");
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(u.hostname);

  const conn = await mysql.createConnection({ uri: url });
  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
         id VARCHAR(128) NOT NULL PRIMARY KEY,
         checksum CHAR(64) NOT NULL,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         duration_ms INT NOT NULL DEFAULT 0
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT id, checksum FROM \`${TABLE}\` ORDER BY id`);
    const applied = new Map<string, string>(rows.map((r) => [r.id as string, r.checksum as string]));

    // Inmutabilidad de lo ya aplicado
    for (const m of migrations) {
      const c = applied.get(m.id);
      if (c && c !== m.checksum) fail(`✗ ${m.id} ya estaba aplicada y su contenido cambió (checksum distinto). Crea una migración nueva.`);
    }
    for (const id of applied.keys()) {
      if (!migrations.some((m) => m.id === id)) fail(`✗ ${id} figura como aplicada pero no existe en ${DIR}.`);
    }

    const pending = migrations.filter((m) => !applied.has(m.id));

    if (command === "status") {
      console.log(`Base de datos: ${dbName} (${isLocal ? "local" : "remota"})`);
      console.log(`Aplicadas: ${applied.size} · pendientes: ${pending.length}`);
      for (const m of pending) console.log(`  · pendiente ${m.id}${m.irreversible ? " (irreversible)" : ""}`);
      return;
    }

    const apply = flag("--apply");
    if (apply && !isLocal && value("--confirm-database") !== dbName) {
      fail(`Base de datos remota: añade --confirm-database ${dbName} para confirmar que es la correcta.`);
    }

    const [[lock]] = (await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('elephant_migrations', 10) AS l")) as any;
    if (lock?.l !== 1) fail("No se obtuvo el bloqueo de migraciones: otro ejecutor está en marcha.");

    try {
      if (command === "up") {
        const to = value("--to");
        const todo = to ? pending.filter((m) => m.id <= `${to}_￿`) : pending;
        console.log(`${apply ? "Aplicando" : "[dry-run] Aplicaría"} ${todo.length} migración(es) en ${dbName}`);
        for (const m of todo) await runUp(conn, m, apply);
      } else if (command === "down") {
        const steps = Number(value("--steps") ?? 1);
        const todo = migrations.filter((m) => applied.has(m.id)).slice(-steps).reverse();
        for (const m of todo) {
          if (!m.down) fail(`✗ ${m.id} es irreversible: no se puede revertir.`);
        }
        console.log(`${apply ? "Revirtiendo" : "[dry-run] Revertiría"} ${todo.length} migración(es) en ${dbName}`);
        for (const m of todo) await runDown(conn, m, apply);
      } else {
        fail(`Comando desconocido: ${command}`);
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK('elephant_migrations')");
    }
  } finally {
    await conn.end();
  }
}

async function runUp(conn: mysql.Connection, m: Migration, apply: boolean) {
  const stmts = splitStatements(m.up);
  console.log(`  ${apply ? "→" : "·"} ${m.id} (${stmts.length} sentencia(s))`);
  if (!apply) return;
  const t0 = Date.now();
  for (const [i, s] of stmts.entries()) {
    try {
      await conn.query(s);
    } catch (e) {
      fail(`✗ ${m.id}: falló la sentencia ${i + 1}/${stmts.length}: ${(e as Error).message}\n  Las anteriores de este fichero ya se ejecutaron; revisa y corrige (no se registra como aplicada).`);
    }
  }
  await conn.query(`INSERT INTO \`${TABLE}\` (id, checksum, duration_ms) VALUES (?, ?, ?)`, [m.id, m.checksum, Date.now() - t0]);
}

async function runDown(conn: mysql.Connection, m: Migration, apply: boolean) {
  const stmts = splitStatements(m.down!);
  console.log(`  ${apply ? "←" : "·"} ${m.id} (${stmts.length} sentencia(s))`);
  if (!apply) return;
  for (const [i, s] of stmts.entries()) {
    try {
      await conn.query(s);
    } catch (e) {
      fail(`✗ ${m.id}.down: falló la sentencia ${i + 1}/${stmts.length}: ${(e as Error).message}`);
    }
  }
  await conn.query(`DELETE FROM \`${TABLE}\` WHERE id = ?`, [m.id]);
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
