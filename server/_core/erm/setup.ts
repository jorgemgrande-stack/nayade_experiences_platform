/**
 * Base de medición del Resource Manager (`es_erm`), creada de forma IDEMPOTENTE dentro de la red privada
 * (restore-drill → `backup-job erm-setup`), como se hizo a mano en live el 21/10/2026:
 *  - base `es_erm` con `usage_hourly` (`db/erm/0000_usage.sql`): solo cantidades agregadas por hora, sin datos personales;
 *  - usuario `es_erm` con SOLO `SELECT, INSERT, UPDATE` sobre `es_erm.usage_hourly` (ni DELETE, ni DDL, ni otras bases);
 *  - la contraseña llega por variable de entorno (referencia a `MySQL.ES_ERM_PASSWORD`) y nunca se imprime.
 * Sonda final con el usuario `es_erm`: escribe y lee dentro de una transacción que se deshace (sin restos) y comprueba
 * que `DELETE`, DDL y el registro le están denegados. Sin `apply` solo informa de lo que haría.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

export const ERM_DATABASE = "es_erm";
export const ERM_USER = "es_erm";

export interface ErmSetupResult {
  database: "exists" | "created" | "would_create";
  table: "exists" | "created" | "would_create";
  user: "exists" | "created" | "would_create";
  grants: "ok" | "applied" | "would_apply" | "excess";
  probe: { write: boolean; deleteDenied: boolean; ddlDenied: boolean; otherDbDenied: boolean } | null;
  /** Consumo agregado de las últimas 24 h por empresa (solo en simulación y con la tabla creada): prueba de que llega. */
  last24h?: Array<{ tenant: string; metrics: number; rows: number; lastHour: string }>;
}

/**
 * DDL de la tabla, EN EL CÓDIGO: la imagen de restore-drill no lleva `db/erm/` (production falló al buscar el fichero,
 * 24/10/2026). Una prueba exige que coincida con `db/erm/0000_usage.sql`, que sigue siendo la referencia.
 */
export const USAGE_TABLE_DDL = `CREATE TABLE IF NOT EXISTS usage_hourly (
  tenant_id  VARCHAR(63)  NOT NULL,
  metric     VARCHAR(64)  NOT NULL,
  hour_start TIMESTAMP(3) NOT NULL,
  quantity   DOUBLE       NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, metric, hour_start),
  KEY idx_usage_metric_hour (metric, hour_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** DDL del fichero de referencia sin comentarios (para comprobar que el del código coincide). */
export function usageTableDdlFromFile(root = process.cwd()): string {
  const raw = fs.readFileSync(path.resolve(root, "db/erm/0000_usage.sql"), "utf8");
  return raw
    .replace(/^--.*$/gm, "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(";\n");
}

/** ¿Los permisos del usuario son exactamente los esperados? (lista de SHOW GRANTS) */
export function grantsState(grants: string[]): "ok" | "missing" | "excess" {
  const norm = grants.map((g) => g.replace(/`/g, "").replace(/\s+/g, " ").toUpperCase());
  const onTable = norm.filter((g) => g.includes(` ON ${ERM_DATABASE.toUpperCase()}.USAGE_HOURLY TO `));
  const others = norm.filter((g) => !g.startsWith("GRANT USAGE ON *.*") && !g.includes(` ON ${ERM_DATABASE.toUpperCase()}.USAGE_HOURLY TO `));
  if (others.length) return "excess";
  if (!onTable.length) return "missing";
  const privs = new Set(
    onTable
      .flatMap((g) => g.slice("GRANT ".length, g.indexOf(" ON ")).split(","))
      .map((p) => p.trim()),
  );
  if (Array.from(privs).some((p) => !["SELECT", "INSERT", "UPDATE"].includes(p))) return "excess";
  return ["SELECT", "INSERT", "UPDATE"].every((p) => privs.has(p)) ? "ok" : "missing";
}

export async function runErmSetup(o: { admin: mysql.Pool; host: string; port: number; password: string | undefined; apply: boolean }): Promise<ErmSetupResult> {
  if (o.apply && (!o.password || o.password.length < 24)) throw new Error("ES_ERM_PASSWORD no está definida o es demasiado corta (mínimo 24 caracteres)");
  const [dbs] = await o.admin.query<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [ERM_DATABASE]);
  const hasDb = dbs.length > 0;
  const [tbl] = hasDb
    ? await o.admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usage_hourly'", [ERM_DATABASE])
    : [[] as mysql.RowDataPacket[]];
  const hasTable = (tbl as mysql.RowDataPacket[]).length > 0;
  const [usr] = await o.admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM mysql.user WHERE User = ? AND Host = '%'", [ERM_USER]);
  const hasUser = usr.length > 0;
  const currentGrants = hasUser ? ((await o.admin.query<mysql.RowDataPacket[]>(`SHOW GRANTS FOR '${ERM_USER}'@'%'`))[0].map((r) => String(Object.values(r)[0]))) : [];
  const gState = hasUser ? grantsState(currentGrants) : "missing";
  if (gState === "excess") {
    // Nunca se amplían ni se tocan permisos ajenos a lo esperado: lo decide una persona
    return { database: hasDb ? "exists" : "would_create", table: hasTable ? "exists" : "would_create", user: "exists", grants: "excess", probe: null };
  }
  if (!o.apply) {
    const last24h = hasTable
      ? (
          await o.admin.query<mysql.RowDataPacket[]>(
            `SELECT tenant_id, COUNT(DISTINCT metric) AS metrics, COUNT(*) AS n, MAX(hour_start) AS last FROM \`${ERM_DATABASE}\`.usage_hourly
              WHERE hour_start >= NOW() - INTERVAL 24 HOUR AND tenant_id <> '__sonda__' GROUP BY tenant_id ORDER BY tenant_id`,
          )
        )[0].map((r) => ({ tenant: String(r.tenant_id), metrics: Number(r.metrics), rows: Number(r.n), lastHour: new Date(r.last).toISOString() }))
      : undefined;
    return {
      database: hasDb ? "exists" : "would_create",
      table: hasTable ? "exists" : "would_create",
      user: hasUser ? "exists" : "would_create",
      grants: gState === "ok" ? "ok" : "would_apply",
      probe: null,
      ...(last24h ? { last24h } : {}),
    };
  }
  if (!hasDb) await o.admin.query(`CREATE DATABASE \`${ERM_DATABASE}\` CHARACTER SET utf8mb4`);
  if (!hasTable) {
    const c = await o.admin.getConnection();
    try {
      await c.query(`USE \`${ERM_DATABASE}\``);
      await c.query(USAGE_TABLE_DDL);
    } finally {
      c.release();
    }
  }
  // La contraseña del usuario es la de la variable (se fija en cada ejecución: así la referencia y la base coinciden)
  if (!hasUser) await o.admin.query(`CREATE USER '${ERM_USER}'@'%' IDENTIFIED BY ?`, [o.password]);
  else await o.admin.query(`ALTER USER '${ERM_USER}'@'%' IDENTIFIED BY ?`, [o.password]);
  if (gState !== "ok") await o.admin.query(`GRANT SELECT, INSERT, UPDATE ON \`${ERM_DATABASE}\`.\`usage_hourly\` TO '${ERM_USER}'@'%'`);

  // Sonda con el propio usuario es_erm
  const probe = await mysql.createConnection({ host: o.host, port: o.port, user: ERM_USER, password: o.password, database: ERM_DATABASE });
  const denied = async (sql: string) => {
    try {
      await probe.query(sql);
      return false;
    } catch (e) {
      return /denied|command denied|ER_TABLEACCESS_DENIED|ER_DBACCESS_DENIED|ER_SPECIFIC_ACCESS/i.test(String((e as { code?: string; message?: string }).code ?? "") + String((e as Error).message));
    }
  };
  let write = false;
  try {
    await probe.beginTransaction();
    await probe.query("INSERT INTO usage_hourly (tenant_id, metric, hour_start, quantity) VALUES ('__sonda__', 'erm.setup.probe', '2000-01-01 00:00:00', 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1");
    const [r] = await probe.query<mysql.RowDataPacket[]>("SELECT quantity FROM usage_hourly WHERE tenant_id = '__sonda__'");
    write = r.length === 1;
    await probe.rollback();
    const deleteDenied = await denied("DELETE FROM usage_hourly WHERE tenant_id = '__sonda__'");
    const ddlDenied = await denied("CREATE TABLE sonda_no_debe_existir (x INT)");
    const otherDbDenied = await denied("SELECT 1 FROM mysql.user LIMIT 1");
    return { database: hasDb ? "exists" : "created", table: hasTable ? "exists" : "created", user: hasUser ? "exists" : "created", grants: gState === "ok" ? "ok" : "applied", probe: { write, deleteDenied, ddlDenied, otherDbDenied } };
  } finally {
    await probe.end().catch(() => undefined);
  }
}
