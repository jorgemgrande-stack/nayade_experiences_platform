/**
 * Copias de seguridad lógicas por tenant, con verificación real de restauración.
 *
 * Formato: SQL comprimido (gzip) con una sentencia por bloque separada por `-- @@`, más un
 * manifiesto (tablas, filas, SHA-256 del volcado). No usa binarios externos: funciona en
 * cualquier entorno donde corra el Core.
 *
 * Una copia solo se considera válida tras `verifyBackup()`: restaura en una BD de pruebas y
 * comprueba filas y checksum de cada tabla contra el origen.
 *
 * Columnas generadas: no se vuelcan (MySQL las recalcula al insertar). Triggers: se vuelcan al final
 * (tras los datos), sin DEFINER y sin calificar con el nombre de la BD de origen, para que se creen
 * en la BD donde se restaura; quien restaura puede fijar el DEFINER (`restoreBackup(..., { definer })`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import mysqlCore from "mysql2";
import mysql from "mysql2/promise";

const SEP = "\n-- @@\n";

export interface BackupManifest {
  version: 1;
  tenantId: string;
  database: string;
  createdAt: string;
  file: string;
  bytes: number;
  sha256: string;
  tables: Record<string, { rows: number; checksum: string }>;
  /** Triggers incluidos en el volcado (ausente en copias anteriores a esta versión). */
  triggers?: string[];
}

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
  if (typeof v === "object" && !(v instanceof Date)) return mysqlCore.escape(JSON.stringify(v));
  return mysqlCore.escape(v as never);
}

const q = (id: string) => "`" + id.replace(/`/g, "``") + "`";

async function listTables(conn: mysql.Connection | mysql.Pool, db: string): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY TABLE_NAME",
    [db],
  );
  return rows.map((r) => r.t as string);
}

async function tableChecksum(conn: mysql.Connection, db: string, table: string): Promise<string> {
  const [r] = await conn.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE ${q(db)}.${q(table)}`);
  return String(r[0]?.Checksum ?? "");
}

/** Columnas que se vuelcan: todas salvo las generadas (MySQL rechaza valores explícitos en ellas). */
async function dumpColumns(conn: mysql.Connection, db: string, table: string): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND (GENERATION_EXPRESSION IS NULL OR GENERATION_EXPRESSION = '') ORDER BY ORDINAL_POSITION",
    [db, table],
  );
  return rows.map((r) => String(r.c));
}

/** Sentencia de creación de un trigger, sin DEFINER y sin el nombre de la BD de origen. */
export function portableTriggerSql(original: string, db: string): string {
  const unqualified = original.split("`" + db.replace(/`/g, "``") + "`.").join("");
  return unqualified.replace(/^\s*CREATE\s+DEFINER\s*=\s*(`[^`]*`|'[^']*'|[^\s@]+)\s*@\s*(`[^`]*`|'[^']*'|\S+)\s+/i, () => "CREATE ");
}

async function* dumpStatements(
  conn: mysql.Connection,
  raw: mysqlCore.Connection,
  db: string,
  names: string[],
  tables: BackupManifest["tables"],
  triggers: string[],
  batchRows: number,
): AsyncGenerator<string> {
  yield "SET FOREIGN_KEY_CHECKS=0";
  yield "SET UNIQUE_CHECKS=0";
  yield "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'";
  for (const t of names) {
    const [cr] = await conn.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE ${q(t)}`);
    yield `DROP TABLE IF EXISTS ${q(t)}`;
    yield String(cr[0]["Create Table"]);
    const cols = await dumpColumns(conn, db, t);
    let rows = 0;
    let batch: string[] = [];
    const stream = raw.query(`SELECT ${cols.map(q).join(",")} FROM ${q(t)}`).stream({ highWaterMark: 200 });
    for await (const row of stream as AsyncIterable<Record<string, unknown>>) {
      batch.push("(" + cols.map((c) => sqlValue(row[c])).join(",") + ")");
      rows++;
      if (batch.length >= batchRows) {
        yield `INSERT INTO ${q(t)} (${cols.map(q).join(",")}) VALUES ${batch.join(",")}`;
        batch = [];
      }
    }
    if (batch.length) yield `INSERT INTO ${q(t)} (${cols.map(q).join(",")}) VALUES ${batch.join(",")}`;
    tables[t] = { rows, checksum: "" };
  }
  // Triggers al final: no se disparan durante la carga de datos
  const [trg] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER",
    [db],
  );
  for (const r of trg) {
    const name = String(r.n);
    const [ct] = await conn.query<mysql.RowDataPacket[]>(`SHOW CREATE TRIGGER ${q(name)}`);
    yield `DROP TRIGGER IF EXISTS ${q(name)}`;
    yield portableTriggerSql(String(ct[0]["SQL Original Statement"]), db);
    triggers.push(name);
  }
  yield "SET FOREIGN_KEY_CHECKS=1";
}

/** Crea la copia en `outDir`; devuelve el manifiesto (también se escribe junto al volcado). */
export async function backupDatabase(
  dsn: string,
  opts: { tenantId: string; outDir: string; batchRows?: number; /** Nombre base del fichero (por defecto `<tenant>-<fecha>`). */ fileBase?: string },
): Promise<BackupManifest> {
  const conn = await mysql.createConnection({ uri: dsn, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const raw = (conn as unknown as { connection: mysqlCore.Connection }).connection;
  const dbName = new URL(dsn).pathname.slice(1);
  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(opts.outDir, `${opts.fileBase ?? `${opts.tenantId}-${stamp}`}.sql.gz`);
  const tables: BackupManifest["tables"] = {};
  const triggers: string[] = [];

  try {
    // Lectura consistente entre tablas
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const names = await listTables(conn, dbName);

    const statements = () => dumpStatements(conn, raw, dbName, names, tables, triggers, opts.batchRows ?? 500);

    const hash = crypto.createHash("sha256");
    let bytes = 0;
    const source = Readable.from(
      (async function* () {
        for await (const s of statements()) {
          const chunk = Buffer.from(s + ";" + SEP, "utf8");
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      })(),
    );
    await pipeline(source, createGzip(), fs.createWriteStream(file));

    // Checksums de origen dentro de la misma transacción de lectura
    for (const t of Object.keys(tables)) tables[t].checksum = await tableChecksum(conn, dbName, t);
    await conn.query("COMMIT");

    const manifest: BackupManifest = {
      version: 1,
      tenantId: opts.tenantId,
      database: dbName,
      createdAt: new Date().toISOString(),
      file: path.basename(file),
      bytes,
      sha256: hash.digest("hex"),
      tables,
      triggers,
    };
    fs.writeFileSync(file.replace(/\.sql\.gz$/, ".manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/**
 * Restaura un volcado en la BD indicada (que debe existir y estar vacía o ser prescindible).
 * `definer`: usuario con el que se crean los triggers (por defecto, el de la conexión).
 */
export async function restoreBackup(
  dsn: string,
  backupFile: string,
  opts: { definer?: { user: string; host: string } } = {},
): Promise<{ statements: number; sha256: string }> {
  const conn = await mysql.createConnection({ uri: dsn, multipleStatements: false });
  const hash = crypto.createHash("sha256");
  let buf = "";
  let n = 0;
  try {
    const gunzip = createGunzip();
    fs.createReadStream(backupFile).pipe(gunzip);
    const flush = async (final: boolean) => {
      let idx: number;
      while ((idx = buf.indexOf(SEP)) !== -1) {
        const stmt = buf.slice(0, idx).replace(/;$/, "");
        buf = buf.slice(idx + SEP.length);
        if (stmt.trim()) {
          if (opts.definer && /^CREATE\s+TRIGGER\s/i.test(stmt)) {
            await conn.query(stmt.replace(/^CREATE\s+TRIGGER\s/i, () => "CREATE DEFINER = ?@? TRIGGER "), [opts.definer.user, opts.definer.host]);
          } else await conn.query(stmt);
          n++;
        }
      }
      if (final && buf.trim()) throw new Error("Volcado truncado o corrupto");
    };
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      hash.update(chunk);
      buf += chunk.toString("utf8");
      await flush(false);
    }
    await flush(true);
    return { statements: n, sha256: hash.digest("hex") };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export interface VerificationReport {
  ok: boolean;
  problems: string[];
  tables: number;
  rows: number;
}

/**
 * Restaura la copia en una BD de pruebas y la compara con el manifiesto (filas y checksum por
 * tabla, y SHA-256 del volcado). Esta es la única prueba válida de que una copia sirve.
 */
export async function verifyBackup(scratchDsn: string, manifestPath: string): Promise<VerificationReport> {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BackupManifest;
  const file = path.join(path.dirname(manifestPath), manifest.file);
  const r = await restoreBackup(scratchDsn, file);
  const problems: string[] = [];
  if (r.sha256 !== manifest.sha256) problems.push("El SHA-256 del volcado no coincide con el manifiesto");
  const cmp = await compareWithManifest(scratchDsn, manifest);
  return { ...cmp, ok: problems.length === 0 && cmp.ok, problems: [...problems, ...cmp.problems] };
}

/** Compara una BD (restaurada) con las tablas, filas, checksums y triggers del manifiesto. */
export async function compareWithManifest(
  dsn: string,
  manifest: Pick<BackupManifest, "tables" | "triggers">,
): Promise<VerificationReport> {
  const problems: string[] = [];
  const conn = await mysql.createConnection({ uri: dsn });
  const db = new URL(dsn).pathname.slice(1);
  try {
    const present = new Set(await listTables(conn, db));
    let rows = 0;
    for (const [t, info] of Object.entries(manifest.tables)) {
      if (!present.has(t)) {
        problems.push(`Falta la tabla ${t}`);
        continue;
      }
      const [c] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${q(t)}`);
      const n = Number(c[0].n);
      rows += n;
      if (n !== info.rows) problems.push(`${t}: ${n} filas (esperadas ${info.rows})`);
      const sum = await tableChecksum(conn, db, t);
      if (sum !== info.checksum) problems.push(`${t}: checksum distinto`);
    }
    if (manifest.triggers?.length) {
      const [g] = await conn.query<mysql.RowDataPacket[]>("SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [db]);
      const got = new Set(g.map((r) => String(r.n)));
      for (const t of manifest.triggers) if (!got.has(t)) problems.push(`Falta el trigger ${t}`);
    }
    return { ok: problems.length === 0, problems, tables: Object.keys(manifest.tables).length, rows };
  } finally {
    await conn.end().catch(() => undefined);
  }
}
