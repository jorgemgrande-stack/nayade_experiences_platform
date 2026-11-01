import { formatDateKeyEs } from "./gestoriaExportPeriod";

/** «2026-11-01» → «01/11/2026» (formato de España). Cualquier otro valor se muestra tal cual. */
export function formatDayEs(v: string | null | undefined): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateKeyEs(v) : v ?? "";
}
