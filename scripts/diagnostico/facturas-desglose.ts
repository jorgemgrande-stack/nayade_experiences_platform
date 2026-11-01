/**
 * Diagnóstico (SOLO LECTURA) del desglose fiscal de las facturas emitidas de UNA empresa:
 *  - facturas en las que base + IVA no suman el total;
 *  - facturas de varios tipos de IVA sin desglose por tipo guardado;
 *  - facturas de presupuestos con descuento.
 *
 *   pnpm exec tsx scripts/diagnostico/facturas-desglose.ts --tenant <empresa>
 *   pnpm exec tsx scripts/diagnostico/facturas-desglose.ts --dsn-env VAR      (BD indicada en esa variable)
 *   … [--json]                                                               (salida en JSON)
 *
 * Conexión con --tenant: REGISTRY_ADMIN_DATABASE_URL + REGISTRY_KEYS/REGISTRY_ACTIVE_KEY_ID (DSN de la
 * empresa en el registro). El DSN nunca se pasa como argumento ni se imprime.
 *
 * Garantías: NUNCA escribe. Lee en una transacción de solo lectura (`START TRANSACTION READ ONLY`) y la
 * sesión se marca de solo lectura; no modifica ni regenera ningún documento fiscal. La salida no incluye
 * datos de clientes (solo número, fecha, importes y señales).
 */
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../../server/_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../../server/_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "../../server/_core/tenantRegistry/service";
import { diagnoseInvoices, formatDiagnosis } from "../../server/invoiceBreakdownDiagnosis";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function tenantDsn(tenant: string): Promise<string> {
  const url = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!url) die("Falta REGISTRY_ADMIN_DATABASE_URL");
  const pool = mysql.createPool({ uri: url, connectionLimit: 1 });
  try {
    const ring = keyringFromEnv(process.env);
    const dsn = await new TenantRegistryService(new MysqlTenantRegistryStore(pool), () => ring).getActiveDsn(tenant);
    if (!dsn) die("Esa empresa no tiene base de datos activa");
    return dsn;
  } finally {
    await pool.end();
  }
}

async function main() {
  const tenant = opt("--tenant");
  const dsnEnv = opt("--dsn-env");
  if (!tenant && !dsnEnv) die("Indica --tenant <empresa> o --dsn-env VAR");
  const dsn = tenant ? await tenantDsn(tenant) : process.env[dsnEnv!] || die(`La variable ${dsnEnv} está vacía`);
  const conn = await mysql.createConnection({ uri: dsn });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const report = await diagnoseInvoices(conn);
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else console.log(`${tenant ? `Empresa ${tenant}. ` : ""}${formatDiagnosis(report)}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => die(`Error en el diagnóstico: ${e instanceof Error ? e.message : String(e)}`));
