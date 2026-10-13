/**
 * Copias de seguridad lógicas por tenant, con verificación real de restauración.
 *
 * Formato: SQL comprimido (gzip) con una sentencia por bloque separada por `-- @@`, más un
 * manifiesto (tablas, filas, SHA-256 del volcado). No usa binarios externos: funciona en
 * cualquier entorno donde corra el Core.
 *
 * Una copia solo se considera válida tras `verifyBackup()`: restaura en una BD de pruebas y
 * comprueba filas y checksum de cada tabla contra el origen.
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

async function* dumpStatements(
  conn: mysql.Connection,
  raw: mysqlCore.Connection,
  names: string[],
  tables: BackupManifest["tables"],
  batchRows: number,
): AsyncGenerator<string> {
  yield "SET FOREIGN_KEY_CHECKS=0";
  yield "SET UNIQUE_CHECKS=0";
  yield "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'";
  for (const t of names) {
    const [cr] = await conn.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE ${q(t)}`);
    yield `DROP TABLE IF EXISTS ${q(t)}`;
    yield String(cr[0]["Create Table"]);
    let rows = 0;
    let batch: string[] = [];
    let cols: string[] | null = null;
    const stream = raw.query(`SELECT * FROM ${q(t)}`).stream({ highWaterMark: 200 });
    for await (const row of stream as AsyncIterable<Record<string, unknown>>) {
      cols ??= Object.keys(row);
      batch.push("(" + cols.map((c) => sqlValue(row[c])).join(",") + ")");
      rows++;
      if (batch.length >= batchRows) {
        yield `INSERT INTO ${q(t)} (${cols.map(q).join(",")}) VALUES ${batch.join(",")}`;
        batch = [];
      }
    }
    if (batch.length && cols) yield `INSERT INTO ${q(t)} (${cols.map(q).join(",")}) VALUES ${batch.join(",")}`;
    tables[t] = { rows, checksum: "" };
  }
  yield "SET FOREIGN_KEY_CHECKS=1";
}

/** Crea la copia en `outDir`; devuelve el manifiesto (también se escribe junto al volcado). */
export async function backupDatabase(
  dsn: string,
  opts: { tenantId: string; outDir: string; batchRows?: number },
): Promise<BackupManifest> {
  const conn = await mysql.createConnection({ uri: dsn, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const raw = (conn as unknown as { connection: mysqlCore.Connection }).connection;
  const dbName = new URL(dsn).pathname.slice(1);
  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(opts.outDir, `${opts.tenantId}-${stamp}.sql.gz`);
  const tables: BackupManifest["tables"] = {};

  try {
    // Lectura consistente entre tablas
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const names = await listTables(conn, dbName);

    const statements = () => dumpStatements(conn, raw, names, tables, opts.batchRows ?? 500);

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
    };
    fs.writeFileSync(file.replace(/\.sql\.gz$/, ".manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/** Restaura un volcado en la BD indicada (que debe existir y estar vacía o ser prescindible). */
export async function restoreBackup(dsn: string, backupFile: string): Promise<{ statements: number; sha256: string }> {
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
          await conn.query(stmt);
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
  const problems: string[] = [];
  const r = await restoreBackup(scratchDsn, file);
  if (r.sha256 !== manifest.sha256) problems.push("El SHA-256 del volcado no coincide con el manifiesto");

  const conn = await mysql.createConnection({ uri: scratchDsn });
  const db = new URL(scratchDsn).pathname.slice(1);
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
    return { ok: problems.length === 0, problems, tables: Object.keys(manifest.tables).length, rows };
  } finally {
    await conn.end().catch(() => undefined);
  }
}
