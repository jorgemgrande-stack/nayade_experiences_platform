/**
 * Auditoría de deriva de esquema: compara `drizzle/schema.ts` con una base de datos MySQL
 * o con un volcado de metadatos de `information_schema`.
 *
 * Contra una base de datos (solo lectura):
 *   DRIFT_DATABASE_URL=mysql://root:pass@127.0.0.1:3317/drift \
 *     pnpm exec tsx scripts/audit-schema-drift.ts [--json salida.json]
 *
 * Contra un volcado de metadatos (sin conectarse a ninguna base de datos):
 *   pnpm exec tsx scripts/audit-schema-drift.ts --actual-json volcado.json [--json salida.json]
 *   donde volcado.json = { "cols": [ { "t": tabla, "c": columna, "ty": COLUMN_TYPE, "n": "YES"|"NO" } ] }
 *
 * Operaciones de preparación SOLO sobre bases locales (se rechazan hosts remotos):
 *   --apply-journal   aplica las migraciones registradas en drizzle/meta/_journal.json
 *   --apply-orphans   aplica los .sql que NO figuran en el journal (orden numérico)
 *   --apply-all       aplica TODOS los .sql por orden numérico, tolerando errores e informando
 *
 * La auditoría es de solo lectura. Nunca imprime la cadena de conexión.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import * as schema from "../drizzle/schema";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const jsonOut = argValue("--json");
const actualJson = argValue("--actual-json");
const wantsWrite = ["--apply-journal", "--apply-orphans", "--apply-all"].some((f) => args.includes(f));

const url = process.env.DRIFT_DATABASE_URL;
let dbName = "";
if (!actualJson) {
  if (!url) {
    console.error("Falta DRIFT_DATABASE_URL (o --actual-json).");
    process.exit(2);
  }
  const u = new URL(url);
  dbName = u.pathname.slice(1);
  if (wantsWrite && !["127.0.0.1", "localhost", "::1"].includes(u.hostname)) {
    console.error("Las operaciones --apply-* solo se permiten sobre bases locales (127.0.0.1/localhost).");
    process.exit(2);
  }
}

const DRIZZLE_DIR = path.resolve(process.cwd(), "drizzle");

function orphanFiles(): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"));
  const inJournal = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
  return fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4))
    .filter((t) => !inJournal.has(t))
    .sort();
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/g)
    .flatMap((chunk) => chunk.split(/;\s*(?:\r?\n|$)/g))
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

function normType(t: string): string {
  return t
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^boolean$/, "tinyint(1)")
    .replace(/^int\(\d+\)$/, "int")
    .replace(/^bigint\(\d+\)$/, "bigint")
    .replace(/^tinyint\((?!1\))\d+\)$/, "tinyint")
    .replace(/^smallint\(\d+\)$/, "smallint")
    .replace(/unsigned.*$/, "unsigned");
}

type ActualRow = { t: string; c: string; ty: string; n: string };

async function applyOperations(conn: mysql.Connection) {
  if (args.includes("--apply-journal")) {
    const pool = mysql.createPool({ uri: url!, connectionLimit: 1 });
    await migrate(drizzle(pool), { migrationsFolder: DRIZZLE_DIR });
    await pool.end();
    console.log("[apply-journal] migraciones del journal aplicadas");
  }
  const runFiles = async (label: string, tags: string[]) => {
    let stmtOk = 0;
    let stmtErr = 0;
    let withErrors = 0;
    for (const tag of tags) {
      const sql = fs.readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), "utf8");
      const errors: string[] = [];
      for (const stmt of splitStatements(sql)) {
        try {
          await conn.query(stmt);
          stmtOk++;
        } catch (e) {
          stmtErr++;
          errors.push(`${(e as { code?: string }).code ?? "ERR"}: ${(e as Error).message.slice(0, 100)}`);
        }
      }
      if (errors.length) {
        withErrors++;
        console.log(`[${label}] ${tag}: ${errors.length} sentencia(s) con error`);
        for (const er of errors.slice(0, 3)) console.log(`    - ${er}`);
      }
    }
    console.log(`[${label}] ${tags.length} ficheros · ${stmtOk} sentencias OK · ${stmtErr} con error · ${withErrors} ficheros con errores`);
  };
  if (args.includes("--apply-all")) {
    const all = fs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, -4))
      .sort();
    await runFiles("apply-all", all);
  }
  if (args.includes("--apply-orphans")) await runFiles("apply-orphans", orphanFiles());
}

async function loadActual(): Promise<ActualRow[]> {
  if (actualJson) {
    const parsed = JSON.parse(fs.readFileSync(actualJson, "utf8"));
    return parsed.cols as ActualRow[];
  }
  const conn = await mysql.createConnection({ uri: url! });
  try {
    if (wantsWrite) await applyOperations(conn);
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty, IS_NULLABLE AS n
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [dbName],
    );
    return rows as unknown as ActualRow[];
  } finally {
    await conn.end();
  }
}

async function main() {
  // ── Esquema esperado (drizzle/schema.ts) ───────────────────────────────────
  type Col = { name: string; type: string; notNull: boolean };
  const expected = new Map<string, Map<string, Col>>();
  for (const value of Object.values(schema)) {
    if (!is(value, MySqlTable)) continue;
    const cfg = getTableConfig(value);
    const cols = new Map<string, Col>();
    for (const c of cfg.columns) cols.set(c.name, { name: c.name, type: normType(c.getSQLType()), notNull: c.notNull });
    expected.set(cfg.name, cols);
  }

  // ── Esquema real ───────────────────────────────────────────────────────────
  const rows = await loadActual();
  const actual = new Map<string, Map<string, { type: string; nullable: boolean }>>();
  for (const r of rows) {
    if (!actual.has(r.t)) actual.set(r.t, new Map());
    actual.get(r.t)!.set(r.c, { type: normType(String(r.ty)), nullable: r.n === "YES" });
  }

  // ── Comparación ────────────────────────────────────────────────────────────
  const INTERNAL = new Set(["__drizzle_migrations"]);
  const missingTables = [...expected.keys()].filter((t) => !actual.has(t)).sort();
  const extraTables = [...actual.keys()].filter((t) => !expected.has(t) && !INTERNAL.has(t)).sort();
  const missingColumns: Array<{ table: string; column: string }> = [];
  const extraColumns: Array<{ table: string; column: string }> = [];
  const typeMismatches: Array<{ table: string; column: string; expected: string; actual: string }> = [];
  const nullMismatches: Array<{ table: string; column: string }> = [];

  for (const [t, cols] of expected) {
    const act = actual.get(t);
    if (!act) continue;
    for (const [cn, c] of cols) {
      const a = act.get(cn);
      if (!a) {
        missingColumns.push({ table: t, column: cn });
        continue;
      }
      if (a.type !== c.type) typeMismatches.push({ table: t, column: cn, expected: c.type, actual: a.type });
      if (c.notNull && a.nullable) nullMismatches.push({ table: t, column: cn });
    }
    for (const cn of act.keys()) if (!cols.has(cn)) extraColumns.push({ table: t, column: cn });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    expectedTables: expected.size,
    actualTables: [...actual.keys()].filter((t) => !INTERNAL.has(t)).length,
    missingTables,
    extraTables,
    missingColumns,
    extraColumns,
    typeMismatches,
    nullMismatches,
  };

  console.log("=== Deriva de esquema: drizzle/schema.ts vs base de datos ===");
  console.log(`Tablas en schema.ts: ${report.expectedTables} · en la BD: ${report.actualTables}`);
  console.log(`Tablas que faltan en la BD:        ${missingTables.length}${missingTables.length ? " → " + missingTables.join(", ") : ""}`);
  console.log(`Tablas en la BD fuera de schema:   ${extraTables.length}${extraTables.length ? " → " + extraTables.join(", ") : ""}`);
  console.log(`Columnas que faltan en la BD:      ${missingColumns.length}`);
  for (const m of missingColumns.slice(0, 80)) console.log(`    - ${m.table}.${m.column}`);
  console.log(`Columnas en la BD fuera de schema: ${extraColumns.length}`);
  for (const m of extraColumns.slice(0, 40)) console.log(`    - ${m.table}.${m.column}`);
  console.log(`Diferencias de tipo:               ${typeMismatches.length}`);
  for (const m of typeMismatches.slice(0, 40)) console.log(`    - ${m.table}.${m.column}: esperado ${m.expected}, real ${m.actual}`);
  console.log(`NOT NULL esperado pero nullable:   ${nullMismatches.length}`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    console.log(`Informe JSON escrito en ${jsonOut}`);
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
