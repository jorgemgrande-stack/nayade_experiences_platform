/** Lógica pura de la pantalla de informes del TPV (periodos rápidos en hora de Madrid y formato). */

export type PeriodPreset = "hoy" | "ayer" | "7dias" | "mes" | "mesAnterior";

export const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "7dias", label: "Últimos 7 días" },
  { id: "mes", label: "Este mes" },
  { id: "mesAnterior", label: "Mes anterior" },
];

/** Fecha AAAA-MM-DD en Madrid. */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(now);
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Rango [desde, hasta] (ambos incluidos) de un periodo rápido, contado desde «hoy» en Madrid. */
export function presetRange(preset: PeriodPreset, now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const today = madridToday(now);
  switch (preset) {
    case "hoy":
      return { dateFrom: today, dateTo: today };
    case "ayer": {
      const y = addDays(today, -1);
      return { dateFrom: y, dateTo: y };
    }
    case "7dias":
      return { dateFrom: addDays(today, -6), dateTo: today };
    case "mes":
      return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
    case "mesAnterior": {
      const lastOfPrev = addDays(`${today.slice(0, 7)}-01`, -1);
      return { dateFrom: `${lastOfPrev.slice(0, 7)}-01`, dateTo: lastOfPrev };
    }
  }
}

/** Mensaje de error del filtro de fechas, o null si es válido. */
export function validateRange(dateFrom: string, dateTo: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(dateFrom) || !re.test(dateTo)) return "Indica las dos fechas del periodo.";
  if (dateFrom > dateTo) return "La fecha «desde» no puede ser posterior a «hasta».";
  const days = Math.round((Date.parse(`${dateTo}T12:00:00Z`) - Date.parse(`${dateFrom}T12:00:00Z`)) / 86_400_000) + 1;
  if (days > 366) return "El periodo no puede superar un año.";
  return null;
}

const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const formatEur = (n: number) => EUR.format(n);
export const formatPct = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
/** «2026-06-10» → «10/06/2026». */
export const formatDateKey = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
export const formatMadridDateTime = (ms: number) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
