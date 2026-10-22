/**
 * Presupuesto de conexiones de los pools de empresa con MySQL REAL (opt-in, REGISTRY_TEST_DATABASE_URL).
 *
 * 20 empresas ficticias (una base de datos cada una, con su identificador dentro) y cientos de tareas
 * concurrentes por el mismo camino que una petición (`withTenantDb` + acceso heredado `legacyPool()`).
 * Las conexiones de las empresas usan un usuario MySQL propio de la prueba para contarlas en
 * `information_schema.PROCESSLIST` sin mezclar las del propio test:
 *  - El total observado en el servidor nunca supera el presupuesto.
 *  - Ninguna tarea ve la base de datos de otra empresa; sin errores no controlados.
 *  - Las conexiones ociosas se cierran (idleTimeout/maxIdle) y los pools inactivos se cierran.
 * Como referencia se repite la misma carga con la configuración anterior (10 por empresa, sin
 * presupuesto ni cierre de ociosas) y se informa del pico de conexiones de ambas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const N = 20;
const USER = `pool_${run}`;
const PASS = crypto.randomBytes(12).toString("hex");
const dbName = (i: number) => `pool_${run}_e${i}`;

describe.skipIf(!URL_)("presupuesto de conexiones con MySQL real (20 empresas)", () => {
  let admin: mysql.Pool;
  let dbr: typeof import("./_core/dbRegistry");
  let legacy: typeof import("./_core/legacyDb");
  const ENV = { ...process.env };
  const report: string[] = [];
  let DbErr: typeof import("./_core/dbRegistry").DbCapacityError;

  const tenantConns = async () =>
    Number((await admin.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = ?", [USER]))[0][0].n);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASS}'`);
    for (let i = 0; i < N; i++) {
      await admin.query(`CREATE DATABASE \`${dbName(i)}\``);
      await admin.query(`CREATE TABLE \`${dbName(i)}\`.ident (v VARCHAR(64) NOT NULL)`);
      await admin.query(`INSERT INTO \`${dbName(i)}\`.ident (v) VALUES (?)`, [`e${i}`]);
      await admin.query(`GRANT SELECT ON \`${dbName(i)}\`.* TO '${USER}'@'%'`);
    }
    process.env.TENANT_MODE = "multi";
    dbr = await import("./_core/dbRegistry");
    DbErr = dbr.DbCapacityError;
    legacy = await import("./_core/legacyDb");
  }, 120_000);

  afterAll(async () => {
    await dbr?.closeAllDatabases();
    dbr?._resetRegistryForTests();
    process.env = { ...ENV };
    if (!admin) return;
    for (let i = 0; i < N; i++) await admin.query(`DROP DATABASE IF EXISTS \`${dbName(i)}\``);
    await admin.query(`DROP USER IF EXISTS '${USER}'@'%'`);
    await admin.end();
    // eslint-disable-next-line no-console
    console.log(["", "CONEXIONES DE EMPRESA (MySQL real, 20 empresas)", ...report.map((r) => `- ${r}`)].join("\n"));
  }, 120_000);

  /** Configura la política, ejecuta la carga y devuelve el pico de conexiones observado en el servidor. */
  async function load(env: Record<string, string>, tasks: number) {
    await dbr.closeAllDatabases();
    dbr._resetRegistryForTests();
    for (const k of Object.keys(process.env)) if (k.startsWith("DB_TENANT_")) delete process.env[k];
    Object.assign(process.env, env);
    // Parte de cero: las conexiones de la carga anterior ya cerradas también en el servidor
    for (let i = 0; i < 80 && (await tenantConns()) > 0; i++) await new Promise((r) => setTimeout(r, 125));
    expect(await tenantConns()).toBe(0);
    const base = new URL(URL_!);
    dbr.setConnectionResolver((id) => {
      const i = Number(id.slice(1));
      return `mysql://${USER}:${PASS}@${base.hostname}:${base.port || 3306}/${dbName(i)}`;
    });
    let peak = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        peak = Math.max(peak, await tenantConns());
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    const errors: string[] = [];
    const crosses: string[] = [];
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: tasks }, (_, k) => `e${k % N}`).map((id) =>
        dbr
          .withTenantDb(id, async () => {
            // Varias consultas en paralelo por tarea: fuerza a usar más de una conexión por pool
            const rows = await Promise.all(
              [0, 1, 2].map(() => legacy.legacyPool().query<mysql.RowDataPacket[]>("SELECT v, SLEEP(0.005) AS s FROM ident").then(([r]) => r[0].v as string)),
            );
            for (const v of rows) if (v !== id) crosses.push(`${id}→${v}`);
          })
          .catch((e) => void errors.push(e instanceof DbErr ? "DbCapacityError" : String((e as { code?: string })?.code ?? (e as Error)?.name))),
      ),
    );
    const ms = Math.round(performance.now() - t0);
    sampling = false;
    await sampler;
    return { peak, errors, crosses, ms, stats: dbr.getTenantPoolStats() };
  }

  it("con presupuesto: el total en el servidor no supera el presupuesto, sin cruces ni errores", async () => {
    const BUDGET = 24; // 6 pools de 4
    const r = await load(
      { DB_TENANT_POOL_CONNECTIONS: "4", DB_TENANT_CONNECTION_BUDGET: String(BUDGET), DB_TENANT_BUDGET_WAIT_MS: "20000", DB_TENANT_POOL_IDLE_TIMEOUT_MS: "1000", DB_TENANT_POOL_MAX_IDLE: "0", DB_TENANT_POOL_INACTIVE_MS: "60000" },
      600,
    );
    report.push(
      `Con presupuesto ${BUDGET} (4 por empresa): pico ${r.peak} conexiones en el servidor, 600 tareas en ${r.ms} ms, esperas ${r.stats.totals.waits}, expulsiones LRU ${r.stats.totals.evictedLru}, rechazos ${r.stats.totals.waitTimeouts}`,
    );
    expect(r.crosses).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.peak).toBeGreaterThan(0);
    expect(r.peak).toBeLessThanOrEqual(BUDGET);
    expect(r.stats.totals.peakReserved).toBeLessThanOrEqual(BUDGET);

    // Ociosas: con maxIdle 0 e idleTimeout 1 s, las conexiones se cierran solas aunque los pools sigan abiertos
    expect(dbr.getTenantPoolStats().pools).toBeGreaterThan(0);
    let open = await tenantConns();
    for (let i = 0; i < 40 && open > 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
      open = await tenantConns();
    }
    report.push(`Conexiones ociosas tras la carga (idleTimeout 1 s, maxIdle 0): ${open}`);
    expect(open).toBe(0);

    // Inactividad: los pools sin actividad se cierran y devuelven su reserva
    const closed = dbr.sweepInactivePools(Date.now() + 61_000);
    expect(closed).toBeGreaterThan(0);
    expect(dbr.getTenantPoolStats()).toMatchObject({ pools: 0, connectionsReserved: 0 });
  }, 180_000);

  it("referencia: la configuración anterior (10 por empresa, sin presupuesto) abre muchas más", async () => {
    const [mc] = await admin.query<mysql.RowDataPacket[]>("SELECT @@max_connections AS m");
    const r = await load(
      { DB_TENANT_POOL_CONNECTIONS: "10", DB_TENANT_CONNECTION_BUDGET: "100000", DB_TENANT_POOLS_MAX: "50", DB_TENANT_POOL_MAX_IDLE: "10", DB_TENANT_POOL_IDLE_TIMEOUT_MS: "60000" },
      600,
    );
    const codes = Array.from(new Set(r.errors)).join(", ") || "ninguno";
    report.push(`Configuración anterior (10 por empresa, sin presupuesto): pico ${r.peak} conexiones (max_connections ${mc[0].m}), 600 tareas en ${r.ms} ms, errores ${r.errors.length} (${codes})`);
    expect(r.crosses).toEqual([]);
    // Sin presupuesto el pico depende solo de la carga: supera con creces el presupuesto de 24
    expect(r.peak).toBeGreaterThan(24);
  }, 180_000);

  it("presupuesto mínimo y espera corta: los rechazos son controlados (DbCapacityError), nunca por encima", async () => {
    const r = await load({ DB_TENANT_POOL_CONNECTIONS: "3", DB_TENANT_CONNECTION_BUDGET: "6", DB_TENANT_BUDGET_WAIT_MS: "50" }, 200);
    report.push(`Presupuesto 6 con espera de 50 ms: pico ${r.peak}, rechazos controlados ${r.errors.length} de 200`);
    expect(r.crosses).toEqual([]);
    expect(new Set(r.errors)).toEqual(r.errors.length ? new Set(["DbCapacityError"]) : new Set());
    expect(r.peak).toBeLessThanOrEqual(6);
  }, 180_000);
});
