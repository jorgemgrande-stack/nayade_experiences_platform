/**
 * Ejecutor explícito de migraciones (fuera del arranque de la aplicación).
 *
 *   pnpm exec tsx scripts/db/migrate.ts verify  --dir <carril>
 *   pnpm exec tsx scripts/db/migrate.ts status  --dir <carril>
 *   pnpm exec tsx scripts/db/migrate.ts up      --dir <carril> [--to 0007] [--apply --confirm-database <bd>] [--allow-remote]
 *   pnpm exec tsx scripts/db/migrate.ts down    --dir <carril> [--steps 1] [--apply --confirm-database <bd>] [--allow-remote]
 *   pnpm exec tsx scripts/db/migrate.ts resolve --dir <carril> --id <NNNN_nombre> --as applied|not-applied --apply --confirm-database <bd>
 *
 * Carriles: `db/migrations` (app) y `db/crm/migrations` (CRM), o un directorio con `lane.json`.
 * Conexión: MIGRATE_DATABASE_URL (nunca se imprime).
 *
 * Garantías:
 *  - `--dir` es obligatorio: no hay carril por defecto. La BD queda ligada a su carril y se exigen
 *    sus tablas base; otro carril sobre la misma BD se rechaza.
 *  - `verify`, `status` y el dry-run no escriben nada (ni siquiera crean el registro).
 *  - Escribir exige `--apply` y `--confirm-database <nombre>` igual al que devuelve el servidor,
 *    también en local. Un destino remoto exige además `--allow-remote`.
 *  - Bloqueo de sesión (GET_LOCK) y relectura del registro DESPUÉS de obtenerlo: dos ejecutores a la
 *    vez nunca aplican dos veces la misma migración.
 *  - Una migración que empieza queda marcada hasta terminar: si falla a medias, el ejecutor se
 *    niega a continuar hasta que una persona revise el esquema y la resuelva con `resolve`.
 *  - Inmutabilidad: si una migración ya aplicada cambió de contenido, se aborta. Huecos y registros
 *    de otro carril también abortan.
 *  - Un fallo detiene la ejecución y sale con código 1: nunca se traga.
 */
import path from "node:path";
import mysql from "mysql2/promise";
import {
  ledgerProblems,
  loadMigrations,
  resolveLane,
  splitStatements,
  targetProblem,
  validateMigrations,
  type LedgerState,
  type Migration,
} from "./migrationLib";

const args = process.argv.slice(2);
const command = args[0] ?? "status";
const flag = (n: string) => args.includes(n);
const value = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

const TABLE = "__elephant_migrations";
const META = "__elephant_migrations_meta";
const LOCK = "elephant_migrations";

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const { lane, error: laneError } = resolveLane(value("--dir"), process.cwd());
if (!lane) fail(laneError!);
const DIR = lane.dir;
const REL = path.relative(process.cwd(), DIR);

async function readState(conn: mysql.Connection): Promise<LedgerState> {
  const [t] = await conn.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  const tables = new Set(t.map((r) => String(r.n).toLowerCase()));
  const applied = new Map<string, string>();
  if (tables.has(TABLE)) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT id, checksum FROM \`${TABLE}\` ORDER BY id`);
    for (const r of rows) applied.set(String(r.id), String(r.checksum));
  }
  let laneName: string | null = null;
  let inProgress: string | null = null;
  if (tables.has(META)) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT k, v FROM \`${META}\``);
    for (const r of rows) {
      if (r.k === "lane") laneName = String(r.v);
      if (r.k === "in_progress") inProgress = String(r.v);
    }
  }
  return { applied, lane: laneName, inProgress, tables };
}

async function ensureLedger(conn: mysql.Connection) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
       id VARCHAR(128) NOT NULL PRIMARY KEY,
       checksum CHAR(64) NOT NULL,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       duration_ms INT NOT NULL DEFAULT 0
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await conn.query(
    `CREATE TABLE IF NOT EXISTS \`${META}\` (
       k VARCHAR(64) NOT NULL PRIMARY KEY,
       v VARCHAR(255) NOT NULL,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

const setMeta = (conn: mysql.Connection, k: string, v: string) =>
  conn.query(`INSERT INTO \`${META}\` (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [k, v]);
const clearMeta = (conn: mysql.Connection, k: string) => conn.query(`DELETE FROM \`${META}\` WHERE k = ?`, [k]);

async function main() {
  const { migrations, errors: loadErrors } = loadMigrations(DIR);
  const errors = [...loadErrors, ...validateMigrations(migrations)];

  if (command === "verify") {
    if (errors.length) {
      console.error(`✗ ${errors.length} problema(s) en ${REL}:`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`✓ ${migrations.length} migración(es) válidas en ${REL} (carril ${lane!.name})`);
    return;
  }
  if (!["status", "up", "down", "resolve"].includes(command)) fail(`Comando desconocido: ${command}`);

  if (errors.length) {
    console.error("Las migraciones no superan la verificación; corrige antes de continuar:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) fail("Falta MIGRATE_DATABASE_URL.");
  const urlHost = new URL(url).hostname;
  const apply = command !== "status" && flag("--apply");

  const conn = await mysql.createConnection({ uri: url });
  try {
    const [[who]] = (await conn.query<mysql.RowDataPacket[]>("SELECT DATABASE() AS db, @@hostname AS host, @@port AS port, VERSION() AS v")) as any;
    const actualDb: string | null = who?.db ?? null;
    console.log(`Destino: BD «${actualDb ?? "(ninguna)"}» en ${who?.host}:${who?.port} (MySQL ${who?.v}) · carril «${lane!.name}» (${REL})${apply ? "" : " · solo lectura"}`);

    const problem = targetProblem({ apply, confirm: value("--confirm-database"), actualDb, urlHost, allowRemote: flag("--allow-remote") });
    if (problem) fail(problem);

    if (apply) {
      const [[lock]] = (await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS l", [LOCK])) as any;
      if (lock?.l !== 1) fail("No se obtuvo el bloqueo de migraciones: otro ejecutor está en marcha.");
    }
    try {
      // Siempre después del bloqueo: lo que otro ejecutor haya aplicado mientras esperábamos cuenta.
      const state = await readState(conn);
      const resolving = command === "resolve";
      const problems = ledgerProblems(migrations, resolving ? { ...state, inProgress: null } : state, lane!);
      const pending = migrations.filter((m) => !state.applied.has(m.id));

      if (command === "status") {
        console.log(`Aplicadas: ${state.applied.size} · pendientes: ${pending.length}${state.lane ? "" : " · BD aún sin ligar a un carril"}`);
        for (const m of pending) console.log(`  · pendiente ${m.id}${m.irreversible ? " (irreversible)" : ""}`);
        if (problems.length) {
          console.error(`✗ ${problems.length} problema(s) de integridad:`);
          for (const p of problems) console.error(`  - ${p}`);
          process.exit(1);
        }
        return;
      }
      if (problems.length) {
        console.error(`✗ No se continúa: ${problems.length} problema(s) de integridad:`);
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
      }

      if (apply) {
        await ensureLedger(conn);
        if (!state.lane) await setMeta(conn, "lane", lane!.name);
      }

      if (command === "resolve") {
        await resolve(conn, state, apply);
      } else if (command === "up") {
        const to = value("--to");
        const todo = to ? pending.filter((m) => m.id <= `${to}_￿`) : pending;
        console.log(`${apply ? "Aplicando" : "[dry-run] Aplicaría"} ${todo.length} migración(es) en ${actualDb}`);
        for (const m of todo) await runUp(conn, m, apply);
      } else {
        const steps = Number(value("--steps") ?? 1);
        if (!Number.isInteger(steps) || steps < 1) fail("--steps debe ser un entero ≥ 1");
        const todo = migrations.filter((m) => state.applied.has(m.id)).slice(-steps).reverse();
        for (const m of todo) {
          if (!m.down) fail(`✗ ${m.id} es irreversible: no se puede revertir.`);
        }
        console.log(`${apply ? "Revirtiendo" : "[dry-run] Revertiría"} ${todo.length} migración(es) en ${actualDb}`);
        for (const m of todo) await runDown(conn, m, apply);
      }
    } finally {
      if (apply) await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]);
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
  await setMeta(conn, "in_progress", `up:${m.id}`);
  for (const [i, s] of stmts.entries()) {
    try {
      await conn.query(s);
    } catch (e) {
      fail(
        `✗ ${m.id}: falló la sentencia ${i + 1}/${stmts.length}: ${(e as Error).message}\n` +
          `  Las ${i} anteriores de este fichero ya se ejecutaron y NO se registra como aplicada. La BD queda marcada\n` +
          `  como «a medias» (up:${m.id}): revisa el esquema y usa «resolve --id ${m.id} --as applied|not-applied».`,
      );
    }
  }
  await conn.query(`INSERT INTO \`${TABLE}\` (id, checksum, duration_ms) VALUES (?, ?, ?)`, [m.id, m.checksum, Date.now() - t0]);
  await clearMeta(conn, "in_progress");
}

async function runDown(conn: mysql.Connection, m: Migration, apply: boolean) {
  const stmts = splitStatements(m.down!);
  console.log(`  ${apply ? "←" : "·"} ${m.id} (${stmts.length} sentencia(s))`);
  if (!apply) return;
  await setMeta(conn, "in_progress", `down:${m.id}`);
  for (const [i, s] of stmts.entries()) {
    try {
      await conn.query(s);
    } catch (e) {
      fail(
        `✗ ${m.id}.down: falló la sentencia ${i + 1}/${stmts.length}: ${(e as Error).message}\n` +
          `  La BD queda marcada como «a medias» (down:${m.id}): revisa el esquema y usa «resolve --id ${m.id} --as applied|not-applied».`,
      );
    }
  }
  await conn.query(`DELETE FROM \`${TABLE}\` WHERE id = ?`, [m.id]);
  await clearMeta(conn, "in_progress");
}

/** Registra a mano el resultado de una migración que quedó a medias (tras revisar el esquema). */
async function resolve(conn: mysql.Connection, state: LedgerState, apply: boolean) {
  const id = value("--id");
  const as = value("--as");
  if (!state.inProgress) fail("No hay ninguna migración a medias que resolver.");
  const [, stuck] = state.inProgress.split(":");
  if (id !== stuck) fail(`La migración a medias es ${stuck}: indica --id ${stuck}.`);
  if (as !== "applied" && as !== "not-applied") fail("Indica --as applied (el esquema ya tiene la migración completa) o --as not-applied (no queda nada de ella).");
  const { migrations } = loadMigrations(DIR);
  const m = migrations.find((x) => x.id === id);
  if (!m) fail(`${id} no existe en ${REL}.`);
  console.log(`${apply ? "Resolviendo" : "[dry-run] Resolvería"} ${state.inProgress} como «${as}»`);
  if (!apply) return;
  if (as === "applied") {
    await conn.query(`INSERT INTO \`${TABLE}\` (id, checksum, duration_ms) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum)`, [m.id, m.checksum]);
  } else {
    await conn.query(`DELETE FROM \`${TABLE}\` WHERE id = ?`, [m.id]);
  }
  await clearMeta(conn, "in_progress");
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
