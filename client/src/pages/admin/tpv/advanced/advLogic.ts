/** Utilidades puras del panel de TPV Advanced (formato y lectura de importes). Quien decide es el servidor. */
import { differenceTone, type ReconMethod } from "@shared/tpvAdvanced";
import type { Tone } from "@/lib/panelTones";

export { formatEur, formatMadridDateTime, presetRange, PERIOD_PRESETS, type PeriodPreset } from "../tpvReportsLogic";

/** Importe escrito por una persona («12,50», «12.5», «») → número o null. */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Cantidad de piezas escrita («3», «») → entero ≥ 0 (vacío = 0; inválido = null). */
export function parsePieces(raw: string): number | null {
  const t = raw.trim();
  if (!t) return 0;
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

export function toneOf(diff: number | null): Tone {
  return differenceTone(diff);
}

/** «Cuadra», «Sobran 2,00 €», «Faltan 1,50 €», «Sin declarar». */
export function differenceLabel(diff: number | null, fmt: (n: number) => string): string {
  if (diff === null) return "Sin declarar";
  if (Math.abs(diff) < 0.005) return "Cuadra";
  return diff > 0 ? `Sobran ${fmt(diff)}` : `Faltan ${fmt(-diff)}`;
}

export const METHOD_ORDER: ReconMethod[] = ["cash", "card", "bizum", "other"];

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}
