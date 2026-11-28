/**
 * Newsletter · lectura PURA de un fichero histórico de contactos (CSV o Excel) para la importación preparada.
 * Sin base de datos ni correo: devuelve filas normalizadas y lo que se rechaza (con el motivo), nunca descarta nada en silencio.
 *
 * Columnas reconocidas (por alias, sin tildes ni mayúsculas): correo (obligatoria), nombre (o nombre + apellidos),
 * idioma (solo si es un idioma de la empresa; si no, el idioma por defecto del lote) y, SOLO si vienen de forma explícita,
 * fecha y origen del consentimiento (informativos: un fichero histórico nunca acredita consentimiento comercial).
 * Límites: 20 000 filas y 5 MB. Los duplicados dentro del fichero se rechazan (gana la primera aparición).
 */
import * as XLSX from "xlsx";
import { normalizeHeader, parseDelimitedText } from "./clientImportCsv";
import { normalizeLocale } from "./i18n";

export const NEWSLETTER_IMPORT_MAX_ROWS = 20_000;
export const NEWSLETTER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export type NewsletterImportFormat = "csv" | "xlsx";

type Col = "email" | "name" | "firstName" | "lastName" | "locale" | "consentDate" | "consentSource";
const ALIASES: Record<string, Col> = {
  email: "email", e_mail: "email", correo: "email", correo_electronico: "email", mail: "email", email_address: "email", direccion_de_correo: "email",
  nombre: "name", name: "name", nombre_completo: "name", full_name: "name", contacto: "name", cliente: "name", vorname_nachname: "name", nombre_y_apellidos: "name",
  vorname: "firstName", first_name: "firstName", firstname: "firstName", primer_nombre: "firstName",
  nachname: "lastName", last_name: "lastName", lastname: "lastName", apellidos: "lastName", apellido: "lastName", surname: "lastName",
  idioma: "locale", sprache: "locale", language: "locale", lang: "locale", locale: "locale",
  fecha_consentimiento: "consentDate", consent_date: "consentDate", consentimiento_fecha: "consentDate", einwilligung_datum: "consentDate", opt_in_date: "consentDate", fecha_alta: "consentDate", anmeldedatum: "consentDate",
  origen_consentimiento: "consentSource", consent_source: "consentSource", einwilligung_quelle: "consentSource", origen: "consentSource", quelle: "consentSource", source: "consentSource",
};

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** Correo normalizado (minúsculas, sin espacios ni el apóstrofo de las exportaciones) o null. */
export function normalizeImportEmail(raw: unknown): string | null {
  if (raw == null) return null;
  const e = String(raw).trim().replace(/^'/, "").toLowerCase();
  if (e.length < 6 || e.length > 254 || !EMAIL_RE.test(e) || e.includes("..")) return null;
  const tld = e.split("@")[1].split(".").pop() ?? "";
  return tld.length >= 2 ? e : null;
}
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/^'/, "").slice(0, max);

export interface ImportRow {
  /** Fila del fichero (1 = cabecera). */
  line: number;
  email: string;
  name: string | null;
  /** Idioma de la fila: el de la columna si es de la empresa; si no, el del lote. */
  locale: string;
  consentDate: string | null;
  consentSource: string | null;
}
export interface ImportRejected {
  line: number;
  email: string | null;
  reason: "invalid_email" | "duplicate" | "malformed";
  detail?: string;
}
export interface ParsedImport {
  rows: ImportRow[];
  rejected: ImportRejected[];
  /** Columnas reconocidas del fichero. */
  columns: string[];
  /** Columnas que se ignoran. */
  ignored: string[];
  /** Filas leídas (sin la cabecera y sin las vacías). */
  rowCount: number;
}
export class NewsletterImportError extends Error {}

export interface ParseInput {
  format: NewsletterImportFormat;
  /** CSV: texto del fichero. */
  text?: string;
  /** Excel: contenido en base64. */
  base64?: string;
}
export interface ParseOptions {
  defaultLocale: string;
  tenantLocales: readonly string[];
}

/** Tabla cruda (cabecera + filas) de un CSV o un libro Excel; `line` = fila del fichero. */
function table(input: ParseInput): { header: string[]; rows: Array<{ line: number; fields: string[] }>; malformed: Array<{ line: number; reason: string }> } {
  if (input.format === "csv") {
    const text = input.text ?? "";
    if (Buffer.byteLength(text, "utf8") > NEWSLETTER_IMPORT_MAX_BYTES) throw new NewsletterImportError("El fichero supera los 5 MB");
    return parseDelimitedText(text);
  }
  const b64 = (input.base64 ?? "").replace(/^data:[^,]*,/, "");
  if (!b64) throw new NewsletterImportError("Falta el contenido del fichero Excel");
  if (Math.ceil(b64.length * 0.75) > NEWSLETTER_IMPORT_MAX_BYTES) throw new NewsletterImportError("El fichero supera los 5 MB");
  let aoa: unknown[][];
  try {
    const wb = XLSX.read(Buffer.from(b64, "base64"), { type: "buffer", raw: false, cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("vacío");
    aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as unknown[][];
  } catch {
    throw new NewsletterImportError("No se pudo leer el fichero Excel (.xlsx)");
  }
  const header = (aoa[0] ?? []).map((c) => String(c ?? ""));
  const rows: Array<{ line: number; fields: string[] }> = [];
  for (let r = 1; r < aoa.length; r++) {
    const fields = (aoa[r] ?? []).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? "")));
    if (fields.every((f) => f.trim() === "")) continue;
    while (fields.length < header.length) fields.push("");
    rows.push({ line: r + 1, fields: fields.slice(0, header.length) });
  }
  return { header, rows, malformed: [] };
}

export function parseNewsletterImport(input: ParseInput, opts: ParseOptions): ParsedImport {
  const t = table(input);
  if (!t.header.length) throw new NewsletterImportError("El fichero no tiene cabecera");
  const col: Partial<Record<Col, number>> = {};
  const columns: string[] = [];
  const ignored: string[] = [];
  t.header.forEach((h, idx) => {
    const c = ALIASES[normalizeHeader(h)];
    if (c && col[c] === undefined) {
      col[c] = idx;
      columns.push(h.trim());
    } else if (h.trim()) ignored.push(h.trim());
  });
  if (col.email === undefined) throw new NewsletterImportError("El fichero necesita una columna de correo (email, e-mail, correo o mail)");
  if (t.rows.length > NEWSLETTER_IMPORT_MAX_ROWS) throw new NewsletterImportError(`El fichero tiene ${t.rows.length} filas: el máximo por lote es ${NEWSLETTER_IMPORT_MAX_ROWS}`);
  const allowed = new Set(opts.tenantLocales.map((l) => normalizeLocale(l)).filter(Boolean) as string[]);
  const def = normalizeLocale(opts.defaultLocale) ?? "es";
  allowed.add(def);
  const rows: ImportRow[] = [];
  const rejected: ImportRejected[] = t.malformed.map((m) => ({ line: m.line, email: null, reason: "malformed" as const, detail: m.reason }));
  const seen = new Set<string>();
  const get = (f: string[], c: Col) => (col[c] === undefined ? "" : f[col[c]!] ?? "");
  for (const r of t.rows) {
    const email = normalizeImportEmail(get(r.fields, "email"));
    if (!email) {
      rejected.push({ line: r.line, email: clean(get(r.fields, "email"), 80) || null, reason: "invalid_email" });
      continue;
    }
    if (seen.has(email)) {
      rejected.push({ line: r.line, email, reason: "duplicate" });
      continue;
    }
    seen.add(email);
    const name = clean(get(r.fields, "name"), 200) || [clean(get(r.fields, "firstName"), 100), clean(get(r.fields, "lastName"), 100)].filter(Boolean).join(" ").slice(0, 200) || null;
    const rowLocale = normalizeLocale(clean(get(r.fields, "locale"), 8).toLowerCase());
    rows.push({
      line: r.line,
      email,
      name,
      locale: rowLocale && allowed.has(rowLocale) ? rowLocale : def,
      consentDate: clean(get(r.fields, "consentDate"), 40) || null,
      consentSource: clean(get(r.fields, "consentSource"), 120) || null,
    });
  }
  return { rows, rejected, columns, ignored, rowCount: t.rows.length + t.malformed.length };
}
