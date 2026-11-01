/**
 * Clientes en CSV (importar y exportar desde el CRM): lectura RFC 4180, columnas reconocidas, plantilla y escritura.
 * Puro, sin BD: lo usan el servidor (vista previa y alta) y el panel (plantilla descargable).
 *
 * Lectura adaptada de Skicenter (`server/services/customerMasterParser.ts`): carácter a carácter, porque un campo
 * entre comillas puede llevar el separador o saltos de línea (`"Pérez; hijos"`), y nunca descarta una fila en silencio.
 * Sin lo sectorial de allí (temporadas, destinos, fuentes de la instalación original).
 */

export const CLIENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CLIENT_CSV_MAX_ROWS = 5000;

/** Campos de un cliente que se pueden importar/exportar. */
export type ClientCsvField = "name" | "email" | "phone" | "company" | "nif" | "address" | "city" | "postalCode" | "country" | "notes";

/** Columnas de la plantilla (y de la exportación), en este orden. */
export const CLIENT_CSV_COLUMNS: ReadonlyArray<{ field: ClientCsvField; header: string }> = [
  { field: "name", header: "nombre" },
  { field: "email", header: "email" },
  { field: "phone", header: "telefono" },
  { field: "company", header: "empresa" },
  { field: "nif", header: "nif" },
  { field: "address", header: "direccion" },
  { field: "city", header: "ciudad" },
  { field: "postalCode", header: "codigo_postal" },
  { field: "country", header: "pais" },
  { field: "notes", header: "notas" },
];

/** Otros nombres de columna habituales (exportaciones de otros programas, hojas hechas a mano). */
const ALIASES: Record<string, ClientCsvField> = {
  nombre: "name", name: "name", nombre_completo: "name", cliente: "name", contacto: "name", full_name: "name",
  email: "email", e_mail: "email", correo: "email", correo_electronico: "email", mail: "email",
  telefono: "phone", phone: "phone", movil: "phone", tel: "phone", telefono_movil: "phone", mobile: "phone",
  empresa: "company", company: "company", razon_social: "company", organizacion: "company",
  nif: "nif", cif: "nif", dni: "nif", nie: "nif", nif_cif: "nif", vat: "nif",
  direccion: "address", address: "address", domicilio: "address",
  ciudad: "city", city: "city", localidad: "city", poblacion: "city", municipio: "city",
  codigo_postal: "postalCode", cp: "postalCode", c_p: "postalCode", postal_code: "postalCode", zip: "postalCode", postalcode: "postalCode",
  pais: "country", country: "country",
  notas: "notes", notes: "notes", observaciones: "notes", comentarios: "notes",
};

/** «Teléfono móvil» → «telefono_movil» (sin tildes ni mayúsculas). */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface ParsedCsv {
  header: string[];
  /** `line`: número de fila en el fichero (1 = cabecera). */
  rows: Array<{ line: number; fields: string[] }>;
  /** Filas que no se pueden leer (columnas de más o de menos, comilla sin cerrar): se muestran, nunca se pierden. */
  malformed: Array<{ line: number; reason: string }>;
}

/** Separador más probable de la cabecera: `;` (Excel en español), `,` o tabulador. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => firstLine.split(d).length - 1;
  const best = [";", ",", "\t"].map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ";";
}

/** Lectura RFC 4180 con separador configurable; `""` dentro de comillas es una comilla. */
export function parseDelimitedText(text: string, delimiter = detectDelimiter(text)): ParsedCsv {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all: Array<{ line: number; fields: string[] }> = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  const pushRow = () => {
    row.push(field);
    all.push({ line: rowStart, fields: row });
    field = "";
    row = [];
  };
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      if (c === "\n") line++;
      field += c;
      continue;
    }
    if (c === '"' && field === "") { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { pushRow(); line++; rowStart = line; continue; }
    field += c;
  }
  const unclosed = inQuotes;
  if (field.length > 0 || row.length > 0) pushRow();

  const header = all[0]?.fields ?? [];
  const rows: ParsedCsv["rows"] = [];
  const malformed: ParsedCsv["malformed"] = [];
  for (let r = 1; r < all.length; r++) {
    const { line: l, fields } = all[r];
    if (fields.every((f) => f.trim() === "")) continue; // fila en blanco
    if (unclosed && r === all.length - 1) {
      malformed.push({ line: l, reason: "Tiene unas comillas sin cerrar" });
      continue;
    }
    if (fields.length !== header.length) {
      malformed.push({ line: l, reason: `Tiene ${fields.length} columnas y la cabecera ${header.length}` });
      continue;
    }
    rows.push({ line: l, fields });
  }
  return { header, rows, malformed };
}

export interface MappedHeader {
  /** Posición de cada campo reconocido. */
  columns: Partial<Record<ClientCsvField, number>>;
  /** Columnas que no se usarán (se avisa). */
  ignored: string[];
}

export function mapHeader(header: string[]): MappedHeader {
  const columns: Partial<Record<ClientCsvField, number>> = {};
  const ignored: string[] = [];
  header.forEach((h, idx) => {
    const f = ALIASES[normalizeHeader(h)];
    if (f && columns[f] === undefined) columns[f] = idx;
    else if (h.trim()) ignored.push(h.trim());
  });
  return { columns, ignored };
}

/** Celda segura al abrirla en una hoja de cálculo (no se ejecuta como fórmula) y entrecomillada si hace falta. */
export function csvCell(v: unknown, delimiter = ";"): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con BOM (Excel lo abre con tildes) y `;` como separador. */
export function toClientCsv(rows: ReadonlyArray<Partial<Record<ClientCsvField, string | null>>>): string {
  const lines = [CLIENT_CSV_COLUMNS.map((c) => c.header).join(";")];
  for (const r of rows) lines.push(CLIENT_CSV_COLUMNS.map((c) => csvCell(r[c.field] ?? "")).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Plantilla descargable con una fila de ejemplo. */
export function clientCsvTemplate(): string {
  return toClientCsv([
    { name: "Ana García López", email: "ana.garcia@ejemplo.com", phone: "600123456", company: "", nif: "", address: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "ES", notes: "" },
  ]);
}
