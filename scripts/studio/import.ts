/**
 * CLI de importación de contenidos y medios de Elephant Studio (operador).
 *
 *   pnpm exec tsx scripts/studio/import.ts validate <documento.json>
 *   pnpm exec tsx scripts/studio/import.ts schema [--out docs/studio/import-format.schema.json]
 *   pnpm exec tsx scripts/studio/import.ts run <documento.json> --tenant <empresa> [--apply] [--publish] [--overwrite]
 *        [--refresh-media] [--actor "nombre"] [--report-json ruta] [--report-md ruta] [--dsn-env VAR]
 *
 * Garantías:
 *  - `run` es un ENSAYO salvo `--apply`: descarga y compara, pero no escribe nada (ni páginas, ni medios, ni registro).
 *  - Nunca publica salvo `--publish` (y solo las páginas con `"status": "published"` en el documento).
 *  - No sobrescribe una página existente que no creó la importación o que se ha editado a mano salvo `--overwrite`
 *    (que solo reescribe su borrador).
 *  - Escribe SOLO en el tenant de `--tenant`. Conexión: REGISTRY_ADMIN_DATABASE_URL + REGISTRY_KEYS/REGISTRY_ACTIVE_KEY_ID
 *    (la BD del tenant se obtiene del registro; los DSN no se imprimen), o `--dsn-env VAR` para una BD local de pruebas.
 *  - Salida: informe JSON por la salida estándar (o los ficheros indicados) y código de salida 1 si hay errores.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { importJsonSchema, validateImportDocument } from "../../shared/studioImport";

const args = process.argv.slice(2);
const cmd = args[0];
const FLAGS = new Set(["--apply", "--publish", "--overwrite", "--refresh-media"]);
const pos: string[] = [];
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (!FLAGS.has(args[i])) i++;
  } else pos.push(args[i]);
}
const has = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function readDoc(file: string | undefined): unknown {
  if (!file) die("Falta el documento JSON");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return die(`No se puede leer el documento: ${e instanceof Error ? e.message : e}`);
  }
}

async function tenantDsn(tenant: string): Promise<string> {
  const { keyringFromEnv } = await import("../../server/_core/tenantRegistry/crypto");
  const { MysqlTenantRegistryStore } = await import("../../server/_core/tenantRegistry/mysqlStore");
  const { TenantRegistryService } = await import("../../server/_core/tenantRegistry/service");
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
  if (!cmd || cmd === "help") return console.log("Ver la cabecera de scripts/studio/import.ts");
  if (cmd === "validate") {
    const v = validateImportDocument(readDoc(pos[0]));
    console.log(JSON.stringify({ ok: v.ok, errors: v.errors, media: v.doc?.media.length, pages: v.doc?.pages.length }, null, 2));
    process.exit(v.ok ? 0 : 1);
  }
  if (cmd === "schema") {
    const text = `${JSON.stringify(importJsonSchema(), null, 2)}\n`;
    const out = opt("--out");
    if (out) fs.writeFileSync(out, text);
    else process.stdout.write(text);
    return;
  }
  if (cmd !== "run") die(`Orden desconocida: ${cmd}`);

  const tenant = opt("--tenant");
  if (!tenant) die("Indica --tenant <empresa>");
  const doc = readDoc(pos[0]);
  const apply = has("--apply");
  const dsnEnv = opt("--dsn-env");
  if (dsnEnv) {
    // BD local de pruebas: instalación única, la BD es la de la variable
    process.env.DATABASE_URL = process.env[dsnEnv] || die(`La variable ${dsnEnv} está vacía`);
    process.env.TENANT_MODE = "single";
  } else {
    process.env.TENANT_MODE = "multi";
    const dsn = await tenantDsn(tenant);
    const { setConnectionResolver } = await import("../../server/_core/dbRegistry");
    setConnectionResolver((id) => (id === tenant ? dsn : null));
  }
  const { runStudioImport, reportToMarkdown } = await import("../../server/studioImport");
  const report = await runStudioImport(tenant, doc, {
    apply, publish: has("--publish"), overwrite: has("--overwrite"), refreshMedia: has("--refresh-media"),
    actor: opt("--actor") ?? `cli:${process.env.USERNAME ?? process.env.USER ?? "operador"}`,
  });
  const jsonPath = opt("--report-json");
  const mdPath = opt("--report-md");
  if (jsonPath) fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  if (mdPath) fs.mkdirSync(path.dirname(path.resolve(mdPath)), { recursive: true });
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  if (mdPath) fs.writeFileSync(mdPath, reportToMarkdown(report));
  if (!jsonPath) console.log(JSON.stringify(report, null, 2));
  if (!apply) console.error("[ensayo] No se ha escrito nada. Usa --apply para aplicar.");
  const { closeAllDatabases } = await import("../../server/_core/dbRegistry");
  await closeAllDatabases();
  process.exit(report.summary.errors ? 1 : 0);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
