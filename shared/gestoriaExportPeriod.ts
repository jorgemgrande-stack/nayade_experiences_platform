/**
 * Periodo de la exportación de facturas para la gestoría: mes, trimestre fiscal o rango de fechas.
 * Las fechas son días de calendario en Europe/Madrid (AAAA-MM-DD): la fecha de expedición de una
 * factura es la de Madrid, no la del servidor. Lo usan el diálogo del panel y el servidor.
 */

export type GestoriaExportPeriod =
  | { kind: "month"; year: number; month: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "range"; from: string; to: string };

export interface ResolvedExportPeriod {
  /** Primer día incluido (AAAA-MM-DD, Madrid). */
  from: string;
  /** Último día incluido (AAAA-MM-DD, Madrid). */
  to: string;
  /** Etiqueta para el nombre del fichero: `2026-T3`, `2026-10`, `2026-10-01_2026-10-15`. */
  key: string;
  /** Texto para una persona: «3.er trimestre de 2026», «octubre de 2026», «del 01/10/2026 al 15/10/2026». */
  label: string;
}

/** Rango máximo de una exportación (un ejercicio completo cabe; dos no). */
export const MAX_RANGE_DAYS = 366;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const QUARTER_NAMES = ["1.er", "2.º", "3.er", "4.º"];

export class ExportPeriodError extends Error {}

const pad = (n: number) => String(n).padStart(2, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDateKey(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** dd/mm/aaaa a partir de AAAA-MM-DD. */
export function formatDateKeyEs(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function checkYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ExportPeriodError("El año no es válido.");
}

export function resolveExportPeriod(p: GestoriaExportPeriod): ResolvedExportPeriod {
  if (p.kind === "month") {
    checkYear(p.year);
    if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12) throw new ExportPeriodError("El mes no es válido.");
    const from = `${p.year}-${pad(p.month)}-01`;
    const to = `${p.year}-${pad(p.month)}-${pad(daysInMonth(p.year, p.month))}`;
    return { from, to, key: `${p.year}-${pad(p.month)}`, label: `${MONTHS[p.month - 1]} de ${p.year}` };
  }
  if (p.kind === "quarter") {
    checkYear(p.year);
    if (!Number.isInteger(p.quarter) || p.quarter < 1 || p.quarter > 4) throw new ExportPeriodError("El trimestre no es válido.");
    const firstMonth = (p.quarter - 1) * 3 + 1;
    const lastMonth = firstMonth + 2;
    const from = `${p.year}-${pad(firstMonth)}-01`;
    const to = `${p.year}-${pad(lastMonth)}-${pad(daysInMonth(p.year, lastMonth))}`;
    return { from, to, key: `${p.year}-T${p.quarter}`, label: `${QUARTER_NAMES[p.quarter - 1]} trimestre de ${p.year}` };
  }
  if (!isValidDateKey(p.from) || !isValidDateKey(p.to)) throw new ExportPeriodError("Las fechas del rango no son válidas.");
  if (p.from > p.to) throw new ExportPeriodError("La fecha de inicio es posterior a la de fin.");
  const days = (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) throw new ExportPeriodError(`El rango no puede superar ${MAX_RANGE_DAYS} días.`);
  return { from: p.from, to: p.to, key: `${p.from}_${p.to}`, label: `del ${formatDateKeyEs(p.from)} al ${formatDateKeyEs(p.to)}` };
}

/** Fecha de calendario (AAAA-MM-DD) en Europe/Madrid de un instante. */
export function madridDayKey(at: Date): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(at);
}

/** Último trimestre fiscal cerrado en Madrid: lo que la gestoría suele pedir. */
export function lastClosedQuarter(now: Date = new Date()): { year: number; quarter: number } {
  const [y, m] = madridDayKey(now).split("-").map(Number);
  const current = Math.ceil(m / 3);
  return current === 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: current - 1 };
}

function quarterOfDay(key: string): { year: number; quarter: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, quarter: Math.ceil(m / 3) };
}

/**
 * Trimestre que propone el diálogo: el trimestre en curso si ya tiene facturas (o si aún no hay ninguna) y, si no,
 * el último trimestre con facturas (el de la factura más reciente). Fechas de Madrid.
 */
export function suggestedExportQuarter(now: Date, latestIssuedAt: Date | string | null | undefined): { year: number; quarter: number } {
  const current = quarterOfDay(madridDayKey(now));
  if (!latestIssuedAt) return current;
  const at = new Date(latestIssuedAt);
  if (!Number.isFinite(at.getTime())) return current;
  const latest = quarterOfDay(madridDayKey(at));
  const beforeCurrent = latest.year < current.year || (latest.year === current.year && latest.quarter < current.quarter);
  return beforeCurrent ? latest : current;
}

/** Exportación sin ningún documento: no se descarga (sería un ZIP vacío). */
export function isEmptyExport(r: { invoices: number; creditNotes: number }): boolean {
  return r.invoices + r.creditNotes === 0;
}

const EMPTY_EXPORT_PREFIX = "No hay facturas ni abonos emitidos en ";

/** Aviso de un periodo sin documentos (el servidor lo rechaza sin montar nada). */
export function emptyExportMessage(label: string): string {
  return `${EMPTY_EXPORT_PREFIX}${label}. Elige otro periodo.`;
}

/** true si el mensaje de error es el de un periodo sin documentos (se muestra como aviso, no como fallo). */
export function isEmptyExportMessage(message: unknown): boolean {
  return typeof message === "string" && message.startsWith(EMPTY_EXPORT_PREFIX);
}
