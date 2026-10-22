/**
 * Contenido de la exportación de datos de una empresa (decisión D): un ZIP con
 *
 *   manifest.json        qué contiene (tablas, filas, columnas omitidas, ficheros), versión del formato y avisos
 *   LEEME.txt            explicación en lenguaje llano
 *   data/<tabla>.csv     cada tabla de la empresa en CSV (UTF-8 con BOM, separador «,»)
 *   data/<tabla>.json    la misma tabla en JSON
 *   files/<categoría>/<id>-<nombre>   los ficheros activos de la empresa (facturas, documentos, imágenes…)
 *
 * Se genera en STREAMING a un fichero del disco (`writeExport`): las tablas se leen por lotes y los ficheros se
 * copian en flujo, de modo que la memoria usada no depende del tamaño de la empresa. El tamaño sin comprimir se
 * cuenta mientras se escribe y, si supera el máximo, se aborta sin dejar nada.
 *
 * Sin secretos: se excluyen las tablas de credenciales, sesiones, tokens y la bandeja de correo, y en todas las
 * tablas las columnas con contraseñas, tokens, claves o secretos; en las tablas de ajustes, los valores de las
 * claves sensibles. Lo leído es la BD de la empresa en curso: no hay forma de leer otra.
 */
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable, Transform } from "node:stream";
import archiver from "archiver";

/**
 * Tablas que nunca se exportan: secretos (credenciales de integraciones, tokens de recuperación), correo
 * saliente, registros técnicos de webhooks, control de migraciones y el propio registro de exportaciones. Lista
 * EXPLÍCITA: un patrón amplio («session», «lock»…) dejaría fuera datos de negocio (p. ej. `cash_sessions`).
 */
const EXCLUDED_TABLES = new Set(["password_reset_tokens", "integration_credentials", "legacy_credential_audit", "mail_outbox", "mail_events", "mail_suppressions", "ghl_webhook_events", "ghl_webhook_logs", "data_exports", "sessions", "user_sessions"]);
export const isExcludedTable = (t: string) => EXCLUDED_TABLES.has(t.toLowerCase()) || /^__|(^|_)migrations$/i.test(t);
/** Columnas que nunca se exportan, en ninguna tabla. */
export const SECRET_COLUMN = /(password|passwd|secret|token|api_?key|private_?key|credential|totp|(^|_)mfa|(^|_)otp|(^|_)salt|hash$)/i;
/** Tablas de ajustes clave/valor: el valor de una clave sensible se omite. */
const SETTINGS_TABLE = /settings$/i;
const OMITTED = "[omitido: dato sensible]";

type Row = Record<string, unknown>;

export interface TableDump {
  name: string;
  columns: string[];
  rows: Row[];
}

export interface ExportFile {
  objectId: string;
  category: string;
  contentType: string;
  sizeBytes: number;
  originalName: string | null;
  /** Contenido completo (ficheros pequeños o proveedores sin streaming). */
  read?: () => Promise<Buffer>;
  /** Contenido en streaming (preferido). */
  open?: () => Promise<Readable>;
}

/**
 * Origen de los datos. `columns` + `rows` (por lotes) es lo que usa la generación en streaming; `dump` (tabla
 * entera en memoria) se admite para orígenes pequeños y pruebas.
 */
export interface ExportSource {
  tables(): Promise<string[]>;
  columns?(table: string): Promise<string[]>;
  rows?(table: string): AsyncIterable<Row[]>;
  dump?(table: string): Promise<TableDump>;
  files(): Promise<ExportFile[]>;
}

export class ExportTooLargeError extends Error {
  constructor(readonly bytes: number, readonly maxBytes: number) {
    super(`La exportación supera el tamaño máximo (${Math.ceil(bytes / 1048576)} MB de ${Math.floor(maxBytes / 1048576)} MB): pídela al equipo de soporte`);
    this.name = "ExportTooLargeError";
  }
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("base64");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const quote = (s: string) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** Celdas que una hoja de cálculo interpretaría como fórmula: se anteponen con «'» (inyección CSV). */
const safeCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const BOM = "﻿";
const csvHeader = (columns: string[]) => `${BOM}${columns.map(quote).join(",")}\r\n`;
const csvRow = (columns: string[], r: Row) => `${columns.map((c) => quote(safeCell(cell(r[c])))).join(",")}\r\n`;

export function toCsv(columns: string[], rows: Row[]): string {
  return csvHeader(columns) + rows.map((r) => csvRow(columns, r)).join("");
}

const jsonValue = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : Buffer.isBuffer(v) ? { base64: v.toString("base64") } : v);
const jsonRow = (r: Row) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, jsonValue(v)])));

/** Plan de omisión de una tabla: columnas secretas fuera y, en tablas de ajustes, valores de claves sensibles. */
interface RedactPlan {
  columns: string[];
  omittedColumns: string[];
  keyCol?: string;
  valueCols: string[];
}
function redactPlan(name: string, all: string[]): RedactPlan {
  const omittedColumns = all.filter((c) => SECRET_COLUMN.test(c));
  const columns = all.filter((c) => !SECRET_COLUMN.test(c));
  const keyCol = SETTINGS_TABLE.test(name) ? columns.find((c) => /^(key|setting_key|name)$/i.test(c)) : undefined;
  return { columns, omittedColumns, keyCol, valueCols: keyCol ? columns.filter((c) => /value/i.test(c)) : [] };
}
function redactRow(p: RedactPlan, r: Row): { row: Row; omitted: number } {
  const o: Row = {};
  for (const c of p.columns) o[c] = r[c];
  let omitted = 0;
  if (p.keyCol && SECRET_COLUMN.test(String(r[p.keyCol] ?? "")))
    for (const c of p.valueCols) {
      if (o[c] !== null && o[c] !== undefined && o[c] !== "") omitted++;
      o[c] = OMITTED;
    }
  return { row: o, omitted };
}

/** Quita columnas secretas y, en tablas de ajustes, los valores de claves sensibles. */
export function redact(t: TableDump): { columns: string[]; rows: Row[]; omittedColumns: string[]; omittedValues: number } {
  const p = redactPlan(t.name, t.columns);
  let omittedValues = 0;
  const rows = t.rows.map((r) => {
    const x = redactRow(p, r);
    omittedValues += x.omitted;
    return x.row;
  });
  return { columns: p.columns, rows, omittedColumns: p.omittedColumns, omittedValues };
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9À-ÿ._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "fichero";

export interface WriteResult {
  /** Tamaño del ZIP y su SHA-256 (calculado al escribirlo). */
  sizeBytes: number;
  sha256: string;
  /** Bytes sin comprimir (lo que cuenta para el máximo). */
  uncompressedBytes: number;
  manifest: Record<string, unknown>;
  tableCount: number;
  rowCount: number;
  fileCount: number;
  /** Ficheros registrados que no estaban en el almacenamiento: la exportación NO está completa si es > 0. */
  missingFileCount: number;
}

export interface WriteOptions {
  tenantId: string;
  requestedBy: number;
  now: number;
  maxBytes: number;
  /** Se llama de vez en cuando durante la generación (latido del trabajo). */
  onProgress?: (bytes: number) => void | Promise<void>;
}

/**
 * Escribe el ZIP en `outPath` (permisos 0600) en streaming. Si supera `maxBytes` (sin comprimir) o falla algo,
 * borra lo escrito y lanza el error.
 */
export async function writeExport(src: ExportSource, outPath: string, o: WriteOptions): Promise<WriteResult> {
  const out = createWriteStream(outPath, { mode: 0o600 });
  const hash = crypto.createHash("sha256");
  let zipBytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      zipBytes += chunk.length;
      cb(null, chunk);
    },
  });
  const archive = archiver("zip", { zlib: { level: 6 } });
  let failure: unknown = null;
  const written = new Promise<void>((resolve, reject) => {
    out.on("close", () => (failure ? reject(failure) : resolve()));
    out.on("error", reject);
    archive.on("error", (e) => {
      failure ??= e;
      reject(e);
    });
  });
  written.catch(() => undefined);
  archive.pipe(tap).pipe(out);

  let bytes = 0;
  let lastProgress = 0;
  const count = (n: number) => {
    bytes += n;
    if (bytes > o.maxBytes) throw new ExportTooLargeError(bytes, o.maxBytes);
  };
  const progress = async () => {
    if (o.onProgress && Date.now() - lastProgress > 10_000) {
      lastProgress = Date.now();
      await o.onProgress(bytes);
    }
  };
  const date = new Date(o.now);
  /** Añade una entrada y espera a que el ZIP la haya consumido entera (entradas en serie). */
  const append = (source: Readable | string, name: string) =>
    new Promise<void>((resolve, reject) => {
      const onEntry = (e: { name: string }) => {
        if (e.name !== name) return;
        archive.off("entry", onEntry);
        archive.off("error", onError);
        resolve();
      };
      const onError = (e: unknown) => {
        archive.off("entry", onEntry);
        reject(e);
      };
      archive.on("entry", onEntry);
      archive.once("error", onError);
      if (typeof source === "string") {
        try {
          count(Buffer.byteLength(source));
        } catch (e) {
          return onError(e);
        }
        archive.append(source, { name, date });
      } else {
        source.once("error", (e) => {
          failure ??= e;
          onError(e);
        });
        archive.append(source, { name, date });
      }
    });

  try {
    const all = (await src.tables()).sort();
    const skippedTables = all.filter((t) => isExcludedTable(t));
    const tables: Array<{ name: string; rows: number; columns: string[]; omittedColumns: string[]; omittedValues: number }> = [];
    let rowCount = 0;
    for (const name of all.filter((t) => !isExcludedTable(t))) {
      // Dos pasadas por la tabla (CSV y JSON), por lotes y dentro de la misma instantánea del origen
      const batches = (): AsyncIterable<Row[]> =>
        src.rows
          ? src.rows(name)
          : (async function* () {
              const d = await src.dump!(name);
              yield d.rows;
            })();
      const allColumns = src.columns ? await src.columns(name) : (await src.dump!(name)).columns;
      const plan = redactPlan(name, allColumns);
      const stat = { rows: 0, omittedValues: 0 };
      const csv = async function* () {
        const h = csvHeader(plan.columns);
        count(Buffer.byteLength(h));
        yield h;
        for await (const batch of batches()) {
          let chunk = "";
          for (const r of batch) {
            const x = redactRow(plan, r);
            stat.rows++;
            stat.omittedValues += x.omitted;
            chunk += csvRow(plan.columns, x.row);
          }
          count(Buffer.byteLength(chunk));
          await progress();
          if (chunk) yield chunk;
        }
      };
      const json = async function* () {
        let first = true;
        count(1);
        yield "[";
        for await (const batch of batches()) {
          let chunk = "";
          for (const r of batch) {
            chunk += `${first ? "\n" : ",\n"}${jsonRow(redactRow(plan, r).row)}`;
            first = false;
          }
          count(Buffer.byteLength(chunk));
          await progress();
          if (chunk) yield chunk;
        }
        count(2);
        yield "\n]";
      };
      await append(Readable.from(csv()), `data/${name}.csv`);
      await append(Readable.from(json()), `data/${name}.json`);
      tables.push({ name, rows: stat.rows, columns: plan.columns, omittedColumns: plan.omittedColumns, omittedValues: stat.omittedValues });
      rowCount += stat.rows;
    }

    const files = await src.files();
    const declared = files.reduce((a, f) => a + f.sizeBytes, 0);
    if (bytes + declared > o.maxBytes) throw new ExportTooLargeError(bytes + declared, o.maxBytes);
    const fileEntries: Array<Record<string, unknown>> = [];
    for (const f of files) {
      const p = `files/${safeName(f.category)}/${f.objectId}-${safeName(f.originalName ?? f.category)}`;
      let stream: Readable;
      try {
        stream = f.open ? await f.open() : Readable.from([await f.read!()]);
      } catch {
        // Un fichero que ya no está en el almacenamiento no impide exportar el resto: queda anotado
        fileEntries.push({ path: null, objectId: f.objectId, category: f.category, contentType: f.contentType, sizeBytes: f.sizeBytes, originalName: f.originalName, missing: true });
        continue;
      }
      const counted = new PassThrough();
      stream.on("data", (c: Buffer) => {
        try {
          count(c.length);
        } catch (e) {
          stream.destroy(e as Error);
        }
      });
      stream.on("error", (e) => counted.destroy(e));
      stream.pipe(counted);
      await append(counted, p);
      await progress();
      fileEntries.push({ path: p, objectId: f.objectId, category: f.category, contentType: f.contentType, sizeBytes: f.sizeBytes, originalName: f.originalName });
    }
    const missing = fileEntries.filter((f) => f.missing).length;
    const manifest = {
      format: "elephant-source-export",
      formatVersion: 1,
      tenantId: o.tenantId,
      generatedAt: date.toISOString(),
      requestedBy: o.requestedBy,
      complete: missing === 0,
      missingFiles: missing,
      tables,
      skippedTables,
      files: fileEntries,
      notes: [
        "Datos de la empresa en el momento de la exportación (una misma instantánea de la base de datos). Los CSV usan UTF-8 con BOM y separador coma; los JSON, el mismo contenido.",
        "Por seguridad no se incluyen contraseñas, tokens, claves ni secretos, ni las tablas de sesiones, credenciales o correo saliente.",
        "Los documentos fiscales se exportan como copia: el original legal es el emitido por el sistema de facturación.",
        "No incluye la documentación de la relación con Elephant Source (contrato, facturas de la suscripción, soporte): se entrega aparte, a petición.",
        "La conservación legal de los datos tras la baja está pendiente de validación jurídica: esta exportación no borra nada.",
      ],
    };
    await append(JSON.stringify(manifest, null, 2), "manifest.json");
    await append(
      [
        "Exportación de datos de tu empresa en Elephant Source",
        "",
        `Generada: ${manifest.generatedAt}`,
        `Tablas: ${tables.length} (${rowCount} filas). Ficheros: ${fileEntries.filter((f) => !f.missing).length}.`,
        ...(missing ? ["", `ATENCIÓN: exportación INCOMPLETA. ${missing} fichero(s) registrados no estaban en el almacenamiento y no se han incluido (ver «missing» en manifest.json).`] : []),
        "",
        "data/   cada tabla en CSV (abre con una hoja de cálculo) y en JSON (para importar en otro sistema).",
        "files/  tus ficheros (facturas, documentos, imágenes...).",
        "manifest.json  el índice completo de esta exportación.",
        "",
        "No incluye contraseñas, tokens ni claves de integraciones, ni la documentación de tu relación con Elephant Source (contrato, facturas de la suscripción, soporte), que se entrega aparte a petición.",
        "",
      ].join("\r\n"),
      "LEEME.txt",
    );
    await archive.finalize();
    await written;
    return { sizeBytes: zipBytes, sha256: hash.digest("hex"), uncompressedBytes: bytes, manifest, tableCount: tables.length, rowCount, fileCount: fileEntries.filter((f) => !f.missing).length, missingFileCount: missing };
  } catch (e) {
    failure ??= e;
    archive.abort();
    out.destroy();
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    throw e;
  }
}

export interface BuildResult {
  zip: Buffer;
  manifest: Record<string, unknown>;
  tableCount: number;
  rowCount: number;
  fileCount: number;
  missingFileCount: number;
}

/** Versión en memoria (pruebas y orígenes pequeños): genera en un temporal y devuelve el ZIP. */
export async function buildExport(src: ExportSource, o: { tenantId: string; requestedBy: number; now: number; maxBytes: number }): Promise<BuildResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "elephant-export-"));
  const file = path.join(dir, "export.zip");
  try {
    const r = await writeExport(src, file, o);
    return { zip: await fs.readFile(file), manifest: r.manifest, tableCount: r.tableCount, rowCount: r.rowCount, fileCount: r.fileCount, missingFileCount: r.missingFileCount };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
