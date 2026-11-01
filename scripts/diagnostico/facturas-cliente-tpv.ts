/**
 * Diagnóstico (SOLO LECTURA) de las facturas completas que la caja emitió al cobrar con tarjeta a nombre de
 * «Cliente TPV» o sin NIF del destinatario, POR EMPRESA, para que la gestoría decida qué hacer con ellas.
 * No se ejecuta solo ni al desplegar: lo lanza una persona cuando lo necesita.
 *
 *   pnpm exec tsx scripts/diagnostico/facturas-cliente-tpv.ts --tenant <empresa> [--tenant <otra>]
 *   pnpm exec tsx scripts/diagnostico/facturas-cliente-tpv.ts --all          (todas las empresas del registro)
 *   pnpm exec tsx scripts/diagnostico/facturas-cliente-tpv.ts --dsn-env VAR  (BD indicada en esa variable)
 *   … [--json]                                                              (salida en JSON)
 *
 * Conexión con --tenant/--all: REGISTRY_ADMIN_DATABASE_URL + REGISTRY_KEYS/REGISTRY_ACTIVE_KEY_ID (DSN de cada
 * empresa en el registro). El DSN nunca se pasa como argumento ni se imprime.
 *
 * Garantías: NUNCA escribe. La sesión se marca de solo lectura (`SET SESSION TRANSACTION READ ONLY`) y solo
 * lanza SELECT; no modifica, anula ni regenera ningún documento fiscal. La salida no incluye datos de clientes
 * (solo número, fecha, importe, estado, ticket y señales).
 */
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../../server/_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../../server/_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "../../server/_core/tenantRegistry/service";
import { diagnoseAnonymousTpvInvoices, formatAnonymousDiagnosis, type AnonymousInvoiceReport } from "../../server/tpvAnonymousInvoiceDiagnosis";

const args = process.argv.slice(2);
const opts = (n: string) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function readOnly<T>(dsn: string, fn: (c: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({ uri: dsn });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

async function main() {
  const asJson = args.includes("--json");
  const dsnEnv = opts("--dsn-env")[0];
  let tenants = opts("--tenant");
  const results: Array<{ tenant: string; report?: AnonymousInvoiceReport; error?: string }> = [];

  if (dsnEnv) {
    const dsn = process.env[dsnEnv] || die(`La variable ${dsnEnv} está vacía`);
    results.push({ tenant: dsnEnv, report: await readOnly(dsn, diagnoseAnonymousTpvInvoices) });
  } else {
    if (!tenants.length && !args.includes("--all")) die("Indica --tenant <empresa> (una o varias), --all o --dsn-env VAR");
    const url = process.env.REGISTRY_ADMIN_DATABASE_URL || die("Falta REGISTRY_ADMIN_DATABASE_URL");
    const pool = mysql.createPool({ uri: url, connectionLimit: 1 });
    try {
      const store = new MysqlTenantRegistryStore(pool);
      const ring = keyringFromEnv(process.env);
      const registry = new TenantRegistryService(store, () => ring);
      if (args.includes("--all")) tenants = (await store.listTenants()).map((t) => t.id);
      for (const tenant of tenants) {
        try {
          const dsn = await registry.getActiveDsn(tenant);
          if (!dsn) { results.push({ tenant, error: "sin base de datos activa" }); continue; }
          results.push({ tenant, report: await readOnly(dsn, diagnoseAnonymousTpvInvoices) });
        } catch (e) {
          results.push({ tenant, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      await pool.end();
    }
  }

  if (asJson) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) console.log(`Empresa ${r.tenant}. ${r.report ? formatAnonymousDiagnosis(r.report) : `No se ha podido revisar: ${r.error}`}\n`);
}

main().catch((e) => die(`Error en el diagnóstico: ${e instanceof Error ? e.message : String(e)}`));
