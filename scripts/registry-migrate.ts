/**
 * Aplica las migraciones del registro de tenants (db/registry/*.sql).
 *
 *   REGISTRY_MIGRATE_URL=mysql://… tsx scripts/registry-migrate.ts                                 # plan (no escribe)
 *   REGISTRY_MIGRATE_URL=mysql://… tsx scripts/registry-migrate.ts --execute --confirm-database <bd> [--allow-remote] [--repair]
 *
 * - Variable propia (REGISTRY_MIGRATE_URL), distinta de la que usa el plano de control en marcha
 *   (REGISTRY_ADMIN_DATABASE_URL): migrar es un acto explícito, con su propio usuario.
 * - Ejecutar exige --confirm-database con el nombre real que devuelve el servidor (también en local);
 *   un destino remoto exige además --allow-remote.
 * - Bloqueo de sesión (GET_LOCK) en una conexión dedicada y lectura del estado DESPUÉS de obtenerlo:
 *   dos ejecuciones a la vez no se pisan.
 * - Versiones registradas con objetos ausentes: el plan las muestra; ejecutar se niega salvo --repair.
 *
 * La BD del registro debe existir y estar vacía o en una versión anterior. Haz copia antes de ejecutar.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { migrateRegistry, RegistryMigrationError } from "../server/_core/tenantRegistry/migrate";

// El paquete es ESM ("type": "module"): no existe __dirname.
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/registry");
const LOCK = "elephant_registry_migrate";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const value = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

function stop(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

async function main() {
  const url = process.env.REGISTRY_MIGRATE_URL;
  if (!url) {
    stop(
      process.env.REGISTRY_ADMIN_DATABASE_URL
        ? "Falta REGISTRY_MIGRATE_URL. Ya no se usa REGISTRY_ADMIN_DATABASE_URL (es la del plano de control en marcha): define la URL de migración de forma explícita."
        : "Falta REGISTRY_MIGRATE_URL",
    );
  }
  const execute = flag("--execute");
  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  let locked = false;
  try {
    const [[who]] = (await conn.query<mysql.RowDataPacket[]>("SELECT DATABASE() AS db, @@hostname AS host, @@port AS port")) as any;
    const db: string | null = who?.db ?? null;
    console.error(`Destino: BD «${db ?? "(ninguna)"}» en ${who?.host}:${who?.port}${execute ? "" : " · solo plan"}`);
    if (execute) {
      if (!db) stop("La URL no selecciona ninguna base de datos.");
      if (value("--confirm-database") !== db) stop(`Para ejecutar hay que identificar el destino: añade --confirm-database ${db}.`);
      const host = new URL(url).hostname;
      if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) && !flag("--allow-remote")) {
        stop(`Destino remoto (${host}): exige además --allow-remote, backup verificado y la autorización correspondiente.`);
      }
      const [[lock]] = (await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS l", [LOCK])) as any;
      if (lock?.l !== 1) stop("No se obtuvo el bloqueo: otra migración del registro está en marcha.", 1);
      locked = true;
    }
    const r = await migrateRegistry(conn, MIGRATIONS_DIR, { dryRun: !execute, repair: flag("--repair") });
    console.log(JSON.stringify(r, null, 2));
    if (r.dryRun && r.incomplete.length) {
      console.error(`AVISO: versiones registradas pero incompletas: ${r.incomplete.join(", ")} (revisa la causa; se reaplicarán solo con --execute --repair)`);
    }
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]).catch(() => undefined);
    await conn.end();
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
