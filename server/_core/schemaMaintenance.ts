/**
 * Mantenimiento de esquema de la app (modo single), EXPLÍCITO y fuera del arranque.
 *
 *   node dist/index.js --schema-maintenance                                         # plan (solo lectura)
 *   node dist/index.js --schema-maintenance --apply --confirm-database <bd> [--allow-remote]
 *   (en desarrollo: pnpm exec tsx server/_core/index.ts --schema-maintenance …)
 *
 * Ejecuta, en el mismo orden que antes hacía el arranque, las migraciones de drizzle y los pasos
 * `ensure*` / semillas críticas. Garantías:
 *  - Sin `--apply` no escribe nada: informa del estado y de los pasos que ejecutaría.
 *  - `--apply` exige `--confirm-database` con el nombre real que devuelve el servidor (también en
 *    local) y `--allow-remote` si el destino no es local.
 *  - Bloqueo de sesión (GET_LOCK): dos mantenimientos a la vez no se pisan.
 *  - Los pasos heredados registran sus errores con console.error en lugar de lanzarlos: aquí se
 *    detectan, se detiene la secuencia en el primer paso que falla y se sale con código 1.
 *  - Al terminar se vuelve a comprobar el esquema; si sigue incompleto, código 1.
 */
import type mysql from "mysql2/promise";
import { checkAppSchema, describeSchemaReport, type SchemaReport } from "./schemaCheck";

export interface MaintenanceStep {
  name: string;
  run: () => Promise<void>;
}

export interface MaintenanceDeps {
  argv: string[];
  databaseUrl: string | undefined;
  connect: (url: string) => Promise<Pick<mysql.Connection, "query" | "end">>;
  steps: MaintenanceStep[];
  check?: (conn: Pick<mysql.Connection, "query">) => Promise<SchemaReport>;
  log?: (line: string) => void;
}

const LOCK = "nayade_schema_maintenance";
const LOOPBACK = ["127.0.0.1", "localhost", "::1", "[::1]"];

export const isSchemaMaintenanceCommand = (argv: string[]) => argv.includes("--schema-maintenance");

/** Devuelve el código de salida (0 = correcto). Nunca imprime la cadena de conexión. */
export async function runSchemaMaintenance(d: MaintenanceDeps): Promise<number> {
  const log = d.log ?? ((l: string) => console.log(l));
  const err = (l: string) => console.error(l);
  const check = d.check ?? ((c) => checkAppSchema(c));
  const has = (f: string) => d.argv.includes(f);
  const value = (f: string) => (has(f) ? d.argv[d.argv.indexOf(f) + 1] : undefined);
  const apply = has("--apply");

  if (!d.databaseUrl) {
    err("[Mantenimiento] Falta DATABASE_URL.");
    return 2;
  }
  const conn = await d.connect(d.databaseUrl);
  let locked = false;
  try {
    const [[who]] = (await conn.query("SELECT DATABASE() AS db, @@hostname AS host, @@port AS port")) as [mysql.RowDataPacket[], unknown];
    const db = (who?.db as string) ?? null;
    log(`[Mantenimiento] Destino: BD «${db ?? "(ninguna)"}» en ${who?.host}:${who?.port}${apply ? "" : " · solo lectura (plan)"}`);

    const before = await check(conn);
    for (const l of describeSchemaReport(before)) log(l);

    if (!apply) {
      log(`[Mantenimiento] [plan] Con --apply se ejecutarían ${d.steps.length} pasos en orden:`);
      d.steps.forEach((s, i) =>
        log(`  ${i + 1}. ${s.name}${s.name === "drizzle" ? ` (${before.pendingMigrations.length} migración(es) pendiente(s))` : " (idempotente: comprueba y crea/corrige lo que falte)"}`),
      );
      return 0;
    }

    if (!db) {
      err("[Mantenimiento] La URL no selecciona ninguna base de datos.");
      return 2;
    }
    if (value("--confirm-database") !== db) {
      err(`[Mantenimiento] Para escribir hay que identificar el destino: añade --confirm-database ${db}.`);
      return 2;
    }
    const host = new URL(d.databaseUrl).hostname;
    if (!LOOPBACK.includes(host) && !has("--allow-remote")) {
      err(`[Mantenimiento] Destino remoto (${host}): exige además --allow-remote, backup verificado y la autorización correspondiente.`);
      return 2;
    }
    const [[lock]] = (await conn.query("SELECT GET_LOCK(?, 10) AS l", [LOCK])) as [mysql.RowDataPacket[], unknown];
    if (lock?.l !== 1) {
      err("[Mantenimiento] No se obtuvo el bloqueo: otro mantenimiento de esquema está en marcha.");
      return 1;
    }
    locked = true;

    for (let i = 0; i < d.steps.length; i++) {
      const s = d.steps[i];
      log(`[Mantenimiento] → ${i + 1}/${d.steps.length} ${s.name}`);
      // Los pasos heredados tragan sus errores y los registran con console.error: se cuentan aquí.
      let errors = 0;
      const original = console.error;
      console.error = (...a: unknown[]) => {
        errors++;
        original(...a);
      };
      try {
        await s.run();
      } catch (e) {
        errors++;
        original(`[Mantenimiento] ${s.name} lanzó:`, (e as Error)?.message ?? e);
      } finally {
        console.error = original;
      }
      if (errors) {
        err(`[Mantenimiento] ✗ El paso «${s.name}» registró ${errors} error(es) (ver arriba). Se detiene: los pasos siguientes NO se han ejecutado.`);
        return 1;
      }
    }

    const after = await check(conn);
    for (const l of describeSchemaReport(after)) log(l);
    if (!after.ok) {
      err("[Mantenimiento] ✗ Tras el mantenimiento el esquema sigue incompleto: revisa antes de desplegar.");
      return 1;
    }
    log("[Mantenimiento] ✓ Mantenimiento completado.");
    return 0;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]).catch(() => undefined);
    await conn.end().catch(() => undefined);
  }
}

/** Política del arranque ante un esquema no al día: `warn` (por defecto), `strict` u `off`. */
export type SchemaCheckMode = "warn" | "strict" | "off";
export function schemaCheckMode(v: string | undefined): SchemaCheckMode {
  return v === "strict" || v === "off" ? v : "warn";
}
