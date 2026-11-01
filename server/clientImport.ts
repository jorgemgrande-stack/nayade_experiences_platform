/**
 * Importar clientes desde CSV (lógica pura, sin BD): qué pasará con cada fila antes de aplicar nada.
 *
 * Adaptado de Skicenter (`server/services/customerMasterMatching.ts`, `customerMasterReview.ts`,
 * `customerMasterApply.ts`): el correo y el teléfono son señales para reconocer a un cliente que ya existe; ante la
 * duda (el correo apunta a uno y el teléfono a otro, o el teléfono a varios) la fila queda en revisión y no se toca
 * nada. Al reconocer un cliente solo se rellenan sus datos VACÍOS: nunca se sobrescribe lo que ya tiene.
 * Sin lo sectorial de allí (temporadas, destinos, tablas de preparación).
 */
import crypto from "node:crypto";
import { CLIENT_CSV_MAX_ROWS, mapHeader, parseDelimitedText, type ClientCsvField } from "../shared/clientImportCsv";

export type ImportAction = "create" | "update" | "unchanged" | "review" | "error";

export interface ExistingClient {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  nif: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
}

export type ClientValues = Partial<Record<ClientCsvField, string>>;

export interface ImportRowPlan {
  line: number;
  action: ImportAction;
  /** Datos leídos de la fila (ya limpios). */
  values: ClientValues;
  /** Cliente reconocido (update/unchanged) o candidatos (review). */
  clientId?: number;
  candidateIds?: number[];
  /** Campos vacíos del cliente que se rellenarán (update). */
  fill?: ClientValues;
  /** Motivo, en lenguaje de la empresa (review/error/unchanged). */
  reason?: string;
}

export interface ImportPlan {
  rows: ImportRowPlan[];
  ignoredColumns: string[];
  totals: Record<ImportAction, number>;
  /** Huella del plan: la confirmación se rechaza si los clientes cambiaron desde la vista previa. */
  fingerprint: string;
}

export class ClientImportError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITS: Record<ClientCsvField, number> = { name: 256, email: 256, phone: 64, company: 256, nif: 64, address: 1000, city: 128, postalCode: 16, country: 64, notes: 4000 };

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Teléfono comparable: `+` y dígitos; 9 dígitos sin prefijo se entienden de España (+34). Otras longitudes sin
 * prefijo no se comparan (nunca se inventa un prefijo para un número ambiguo).
 */
export function normalizePhone(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? "+" + digits : "";
  if (digits.length === 9) return "+34" + digits;
  if (digits.length === 11 && digits.startsWith("34")) return "+" + digits;
  return "";
}

const words = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

/** ¿Pueden ser la misma persona por el nombre? (comparten alguna palabra; sin nombre en un lado, sí) */
export function namesCompatible(a: string, b: string): boolean {
  const wa = words(a);
  const wb = new Set(words(b));
  if (!wa.length || !wb.size) return true;
  return wa.some((w) => wb.has(w));
}

/** Limpia una celda: espacios, el apóstrofo que añade la exportación ante `=+-@` y la longitud de la columna. */
function cell(raw: string | undefined, field: ClientCsvField): string {
  let v = (raw ?? "").trim();
  if (/^'[=+\-@]/.test(v)) v = v.slice(1);
  return v.slice(0, LIMITS[field]);
}

const FILLABLE: ClientCsvField[] = ["name", "phone", "company", "nif", "address", "city", "postalCode", "country", "notes"];

/** Vista previa: qué se hará con cada fila. `existing`: todos los clientes de la empresa. */
export function planClientImport(text: string, existing: readonly ExistingClient[]): ImportPlan {
  const parsed = parseDelimitedText(text);
  if (parsed.rows.length + parsed.malformed.length > CLIENT_CSV_MAX_ROWS) {
    throw new ClientImportError(`El fichero tiene más de ${CLIENT_CSV_MAX_ROWS.toLocaleString("es-ES")} filas. Divídelo en varios y súbelos por partes.`);
  }
  const { columns, ignored } = mapHeader(parsed.header);
  if (columns.name === undefined && columns.email === undefined) {
    throw new ClientImportError("No se reconoce la cabecera: la primera fila debe tener al menos las columnas «nombre» y «email». Descarga la plantilla para ver el formato.");
  }

  const byEmail = new Map<string, ExistingClient>();
  const byPhone = new Map<string, ExistingClient[]>();
  for (const c of existing) {
    const e = normalizeEmail(c.email);
    if (e) byEmail.set(e, c);
    const p = normalizePhone(c.phone);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), c]);
  }

  const out: ImportRowPlan[] = parsed.malformed.map((m) => ({ line: m.line, action: "error" as const, values: {}, reason: m.reason }));
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();

  for (const { line, fields } of parsed.rows) {
    const values: ClientValues = {};
    for (const [f, idx] of Object.entries(columns) as Array<[ClientCsvField, number]>) {
      const v = cell(fields[idx], f);
      if (v) values[f] = v;
    }
    const email = normalizeEmail(values.email);
    if (email) values.email = email;
    const phone = normalizePhone(values.phone);

    if (!values.name && !email) { out.push({ line, action: "error", values, reason: "Fila sin nombre ni email" }); continue; }
    if (email && !EMAIL_RE.test(email)) { out.push({ line, action: "error", values, reason: "El email no es válido" }); continue; }

    // Repetidos dentro del mismo fichero: solo cuenta la primera fila
    const dupLine = (email && seenEmail.get(email)) || (phone && seenPhone.get(phone));
    if (dupLine) { out.push({ line, action: "error", values, reason: `Repite el cliente de la fila ${dupLine}` }); continue; }
    if (email) seenEmail.set(email, line);
    if (phone) seenPhone.set(phone, line);

    const emailMatch = email ? byEmail.get(email) : undefined;
    const phoneMatches = phone ? byPhone.get(phone) ?? [] : [];

    let target: ExistingClient | undefined;
    if (emailMatch) {
      const other = phoneMatches.find((c) => c.id !== emailMatch.id);
      if (phoneMatches.length && !phoneMatches.some((c) => c.id === emailMatch.id) && other) {
        out.push({ line, action: "review", values, candidateIds: [emailMatch.id, other.id], reason: `El email es de «${emailMatch.name}» y el teléfono de «${other.name}». Revísalo a mano` });
        continue;
      }
      target = emailMatch;
    } else if (phoneMatches.length > 1) {
      out.push({ line, action: "review", values, candidateIds: phoneMatches.map((c) => c.id), reason: `El teléfono lo tienen ${phoneMatches.length} clientes. Revísalo a mano` });
      continue;
    } else if (phoneMatches.length === 1) {
      const c = phoneMatches[0];
      if (!namesCompatible(values.name ?? "", c.name)) {
        out.push({ line, action: "review", values, candidateIds: [c.id], reason: `El teléfono es de «${c.name}», con otro nombre. Revísalo a mano` });
        continue;
      }
      if (email && normalizeEmail(c.email) !== email) {
        out.push({ line, action: "review", values, candidateIds: [c.id], reason: `El teléfono es de «${c.name}», que tiene otro email. Revísalo a mano` });
        continue;
      }
      target = c;
    }

    if (target) {
      const fill: ClientValues = {};
      for (const f of FILLABLE) {
        const current = (target as unknown as Record<string, string | null>)[f];
        if (values[f] && !(current ?? "").trim()) fill[f] = values[f];
      }
      out.push(Object.keys(fill).length
        ? { line, action: "update", values, clientId: target.id, fill }
        : { line, action: "unchanged", values, clientId: target.id, reason: "Ya existe con estos datos" });
      continue;
    }

    // Alta nueva: el email identifica al cliente y es obligatorio
    if (!email) { out.push({ line, action: "error", values, reason: "Falta el email (es obligatorio para dar de alta un cliente)" }); continue; }
    if (!values.name) { out.push({ line, action: "error", values, reason: "Falta el nombre" }); continue; }
    out.push({ line, action: "create", values });
  }

  out.sort((a, b) => a.line - b.line);
  const totals: Record<ImportAction, number> = { create: 0, update: 0, unchanged: 0, review: 0, error: 0 };
  for (const r of out) totals[r.action]++;
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(out.map((r) => [r.line, r.action, r.clientId ?? null, r.fill ?? null, r.action === "create" ? r.values : null])))
    .digest("hex")
    .slice(0, 32);
  return { rows: out, ignoredColumns: ignored, totals, fingerprint };
}
