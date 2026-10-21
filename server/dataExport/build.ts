/**
 * Contenido de la exportación de datos de una empresa (decisión D): un ZIP con
 *
 *   manifest.json        qué contiene (tablas, filas, columnas omitidas, ficheros), versión del formato y avisos
 *   LEEME.txt            explicación en lenguaje llano
 *   data/<tabla>.csv     cada tabla de la empresa en CSV (UTF-8 con BOM, separador «,»)
 *   data/<tabla>.json    la misma tabla en JSON
 *   files/<categoría>/<id>-<nombre>   los ficheros activos de la empresa (facturas, documentos, imágenes…)
 *
 * Sin secretos: se excluyen las tablas de credenciales, sesiones, tokens y la bandeja de correo, y en todas las
 * tablas las columnas con contraseñas, tokens, claves o secretos; en las tablas de ajustes, los valores de las
 * claves sensibles. Lo leído es la BD de la empresa en curso: no hay forma de leer otra.
 */
import JSZip from "jszip";

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

export interface TableDump {
  name: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface ExportFile {
  objectId: string;
  category: string;
  contentType: string;
  sizeBytes: number;
  originalName: string | null;
  read: () => Promise<Buffer>;
}

export interface ExportSource {
  tables(): Promise<string[]>;
  dump(table: string): Promise<TableDump>;
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

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(quote).join(",")];
  for (const r of rows) lines.push(columns.map((c) => quote(safeCell(cell(r[c])))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const jsonValue = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : Buffer.isBuffer(v) ? { base64: v.toString("base64") } : v);

/** Quita columnas secretas y, en tablas de ajustes, los valores de claves sensibles. */
export function redact(t: TableDump): { columns: string[]; rows: Array<Record<string, unknown>>; omittedColumns: string[]; omittedValues: number } {
  const omittedColumns = t.columns.filter((c) => SECRET_COLUMN.test(c));
  const columns = t.columns.filter((c) => !SECRET_COLUMN.test(c));
  const keyCol = SETTINGS_TABLE.test(t.name) ? columns.find((c) => /^(key|setting_key|name)$/i.test(c)) : undefined;
  const valueCols = keyCol ? columns.filter((c) => /value/i.test(c)) : [];
  let omittedValues = 0;
  const rows = t.rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of columns) o[c] = r[c];
    if (keyCol && SECRET_COLUMN.test(String(r[keyCol] ?? "")))
      for (const c of valueCols) {
        if (o[c] !== null && o[c] !== undefined && o[c] !== "") omittedValues++;
        o[c] = OMITTED;
      }
    return o;
  });
  return { columns, rows, omittedColumns, omittedValues };
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9À-ÿ._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "fichero";

export interface BuildResult {
  zip: Buffer;
  manifest: Record<string, unknown>;
  tableCount: number;
  rowCount: number;
  fileCount: number;
  /** Ficheros registrados que no estaban en el almacenamiento: la exportación NO está completa si es > 0. */
  missingFileCount: number;
}

/** Construye el ZIP. Supera `maxBytes` (datos + ficheros, sin comprimir) → ExportTooLargeError, sin generar nada. */
export async function buildExport(src: ExportSource, o: { tenantId: string; requestedBy: number; now: number; maxBytes: number }): Promise<BuildResult> {
  const zip = new JSZip();
  let bytes = 0;
  const add = (path: string, data: string | Buffer) => {
    bytes += typeof data === "string" ? Buffer.byteLength(data) : data.length;
    if (bytes > o.maxBytes) throw new ExportTooLargeError(bytes, o.maxBytes);
    zip.file(path, data, { date: new Date(o.now) });
  };
  const all = (await src.tables()).sort();
  const skippedTables = all.filter((t) => isExcludedTable(t));
  const tables: Array<{ name: string; rows: number; columns: string[]; omittedColumns: string[]; omittedValues: number }> = [];
  let rowCount = 0;
  for (const name of all.filter((t) => !isExcludedTable(t))) {
    const r = redact(await src.dump(name));
    add(`data/${name}.csv`, toCsv(r.columns, r.rows));
    add(`data/${name}.json`, JSON.stringify(r.rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, jsonValue(v)]))), null, 1));
    tables.push({ name, rows: r.rows.length, columns: r.columns, omittedColumns: r.omittedColumns, omittedValues: r.omittedValues });
    rowCount += r.rows.length;
  }
  const files = await src.files();
  const declared = files.reduce((a, f) => a + f.sizeBytes, 0);
  if (bytes + declared > o.maxBytes) throw new ExportTooLargeError(bytes + declared, o.maxBytes);
  const fileEntries: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const path = `files/${safeName(f.category)}/${f.objectId}-${safeName(f.originalName ?? f.category)}`;
    let data: Buffer;
    try {
      data = await f.read();
    } catch {
      // Un fichero que ya no está en el almacenamiento no impide exportar el resto: queda anotado
      fileEntries.push({ path: null, objectId: f.objectId, category: f.category, contentType: f.contentType, sizeBytes: f.sizeBytes, originalName: f.originalName, missing: true });
      continue;
    }
    add(path, data);
    fileEntries.push({ path, objectId: f.objectId, category: f.category, contentType: f.contentType, sizeBytes: f.sizeBytes, originalName: f.originalName });
  }
  const missing = fileEntries.filter((f) => f.missing).length;
  const manifest = {
    format: "elephant-source-export",
    formatVersion: 1,
    tenantId: o.tenantId,
    generatedAt: new Date(o.now).toISOString(),
    requestedBy: o.requestedBy,
    complete: missing === 0,
    missingFiles: missing,
    tables,
    skippedTables,
    files: fileEntries,
    notes: [
      "Datos de la empresa en el momento de la exportación. Los CSV usan UTF-8 con BOM y separador coma; los JSON, el mismo contenido.",
      "Por seguridad no se incluyen contraseñas, tokens, claves ni secretos, ni las tablas de sesiones, credenciales o correo saliente.",
      "Los documentos fiscales se exportan como copia: el original legal es el emitido por el sistema de facturación.",
      "La conservación legal de los datos tras la baja está pendiente de validación jurídica: esta exportación no borra nada.",
    ],
  };
  add("manifest.json", JSON.stringify(manifest, null, 2));
  add(
    "LEEME.txt",
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
      "No incluye contraseñas, tokens ni claves de integraciones.",
      "",
    ].join("\r\n"),
  );
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { zip: out, manifest, tableCount: tables.length, rowCount, fileCount: fileEntries.filter((f) => !f.missing).length, missingFileCount: missing };
}
