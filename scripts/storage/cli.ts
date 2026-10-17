/**
 * CLI de operador del almacenamiento de ficheros (server/_core/files/service.ts).
 *
 *   pnpm exec tsx scripts/storage/cli.ts cleanup        --tenant <empresa> [--grace-hours 24] [--apply]
 *   pnpm exec tsx scripts/storage/cli.ts restore-object --tenant <empresa> --object <id>  [--apply]
 *
 * Instalación única (sin registro): `--dsn-env VAR` en lugar de `--tenant` (el DSN se lee de esa
 * variable; nunca como argumento).
 *
 * Conexión: REGISTRY_ADMIN_DATABASE_URL + REGISTRY_KEYS/REGISTRY_ACTIVE_KEY_ID (DSN de la empresa);
 * proveedor de ficheros con las variables S3_* del Core; copias con BACKUP_STORAGE/BACKUP_* y
 * BACKUP_KEYS (solo `restore-object`).
 *
 * Garantías: SIMULACIÓN por defecto (solo informa); escribir exige `--apply`. Las salidas no contienen
 * DSN, credenciales ni contenido de ficheros (solo identificadores, claves de objeto y recuentos).
 */
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../../server/_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../../server/_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "../../server/_core/tenantRegistry/service";
import { runWithTenant } from "../../server/_core/tenant";
import { backendFromEnv } from "../../server/_core/files/backend";
import { FileService } from "../../server/_core/files/service";
import { restoreStoredObject } from "../../server/_core/files/restore";
import { MysqlObjectMetaStore } from "../../server/storedObjectsDb";
import { backupStorageFromEnv } from "../../server/_core/ops/backupStorage";
import { backupKeyringFromEnv } from "../../server/_core/ops/backupCrypto";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = args.includes("--apply");

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
  if (!cmd || cmd === "help") {
    console.log("Ver la cabecera de scripts/storage/cli.ts");
    return;
  }
  const tenant = opt("--tenant");
  const dsnEnv = opt("--dsn-env");
  if (!tenant && !dsnEnv) die("Indica --tenant <empresa> o --dsn-env VAR");
  if (tenant) process.env.TENANT_MODE = "multi";
  const dsn = tenant ? await tenantDsn(tenant) : process.env[dsnEnv!] || die(`La variable ${dsnEnv} está vacía`);
  const pool = mysql.createPool({ uri: dsn, connectionLimit: 2 });
  const meta = new MysqlObjectMetaStore(() => pool);
  const backend = backendFromEnv();
  const inTenant = <T>(fn: () => Promise<T>) => (tenant ? runWithTenant(tenant, fn) : fn());
  try {
    if (cmd === "cleanup") {
      const graceHours = Number(opt("--grace-hours") ?? 24);
      if (!Number.isFinite(graceHours) || graceHours < 1) die("--grace-hours debe ser ≥ 1");
      const svc = new FileService({ backend: () => backend, meta });
      const r = await inTenant(() => svc.cleanup({ apply: APPLY, graceMs: graceHours * 3600 * 1000 }));
      console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", backend: backend.describe(), graceHours, staleUploads: r.staleUploads.length, superseded: r.superseded.length, bucketOrphans: r.bucketOrphans, errors: r.errors }, null, 2));
      if (!APPLY) console.log("[dry-run] Nada se ha borrado. Usa --apply para ejecutar.");
    } else if (cmd === "restore-object") {
      if (!tenant) die("restore-object requiere --tenant (la réplica de ficheros es por empresa)");
      const objectId = opt("--object") ?? die("Falta --object <id>");
      const st = backupStorageFromEnv();
      if (!st.storage) die(`Almacén de copias no configurado: ${st.reason}`);
      const r = await inTenant(() => restoreStoredObject({ storage: st.storage!, ring: backupKeyringFromEnv(), tenantId: tenant, backend, meta }, objectId, { apply: APPLY }));
      console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", ...r }, null, 2));
    } else die(`Orden desconocida: ${cmd}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
