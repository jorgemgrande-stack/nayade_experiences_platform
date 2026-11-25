/**
 * Única fuente del formato de euros del panel de Economía (solo presentación: no redondea ni calcula nada contable).
 *
 * Formato: «1.234.567,89 €». Agrupación de miles SIEMPRE (también con cuatro cifras: «2.673,86 €»), dos decimales,
 * símbolo siempre detrás (separado por un espacio duro para que no salte de línea) y negativos con «−» (U+2212)
 * delante de la cifra. En español y en alemán el patrón es el mismo; el idioma solo decide los separadores.
 */
export type MoneyLocale = "es" | "de";

const TAG: Record<MoneyLocale, string> = { es: "es-ES", de: "de-DE" };
const MINUS = "−";
const NBSP = " ";

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: MoneyLocale, decimals: number): Intl.NumberFormat {
  const key = `${locale}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(TAG[locale], { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: "always" });
    formatters.set(key, f);
  }
  return f;
}

export interface MoneyOptions {
  locale?: MoneyLocale;
  /** Texto cuando el valor no es un número (null, vacío, «abc»). Por defecto se trata como cero, igual que hacía el panel. */
  nullAs?: string;
  /** Con `true`, los importes positivos llevan «+» delante (cobros, ingresos). */
  plus?: boolean;
  /** Decimales (2 por defecto). */
  decimals?: number;
}

/** Convierte el valor (número o texto decimal con punto, como llega del servidor) en número; null si no lo es. */
export function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** «1.234.567,89 €» · «−1.234,50 €» · «0,00 €». */
export function formatEur(value: number | string | null | undefined, opts: MoneyOptions = {}): string {
  const n = toAmount(value);
  if (n === null && opts.nullAs !== undefined) return opts.nullAs;
  const locale = opts.locale ?? "es";
  const decimals = opts.decimals ?? 2;
  const abs = numberFormat(locale, decimals).format(Math.abs(n ?? 0));
  // El signo se decide sobre lo que realmente se pinta: -0,004 se muestra «0,00 €» (sin «−»).
  const isZero = /^[0.,\s]*$/.test(abs);
  const sign = n !== null && n < 0 && !isZero ? MINUS : opts.plus && n !== null && n > 0 && !isZero ? "+" : "";
  return `${sign}${abs}${NBSP}€`;
}

/** Importe guardado en céntimos (Contabilidad general): 123456 → «1.234,56 €». */
export function formatEurCents(cents: number | string | null | undefined, opts: MoneyOptions = {}): string {
  const n = toAmount(cents);
  if (n === null) return formatEur(null, opts);
  return formatEur(n / 100, opts);
}

/** Importe sin símbolo (columnas de debe/haber): «1.234,56». */
export function formatAmount(value: number | string | null | undefined, opts: MoneyOptions = {}): string {
  return formatEur(value, opts).replace(`${NBSP}€`, "");
}
