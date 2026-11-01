/**
 * Periodicidad y ajustes comerciales de los servicios externos. Mensual (1 mes) es la de siempre: con ella, sin
 * duración y sin ajuste, todos los textos (contrato, aceptación, Stripe y correos) son exactamente los de antes.
 */
import type { ExternalSubscription } from "./types";
import { localDate, zonedInstant } from "./schedule";

export type IntervalChoice = "month" | "quarter" | "year";

/** Ajuste comercial autorizado: descuento o recargo, en porcentaje (puntos básicos) o importe (céntimos). */
export interface Adjustment {
  type: "discount" | "surcharge";
  mode: "percent" | "amount";
  value: number;
  reason: string;
  /** Quien lo autorizó (con `orders:approve`). */
  authorizedBy?: string;
}

type Recurrence = Pick<ExternalSubscription, "interval" | "intervalCount">;

export function recurrenceOf(choice: IntervalChoice | undefined): { interval: "month" | "year"; intervalCount: number } {
  if (choice === "quarter") return { interval: "month", intervalCount: 3 };
  if (choice === "year") return { interval: "year", intervalCount: 1 };
  return { interval: "month", intervalCount: 1 };
}

export const isMonthly = (x: Partial<Recurrence>) => (x.interval ?? "month") === "month" && (x.intervalCount ?? 1) === 1;

/** Meses de un periodo. */
export const periodMonths = (x: Partial<Recurrence>) => ((x.interval ?? "month") === "year" ? 12 : 1) * (x.intervalCount ?? 1);

/** Textos de la periodicidad: «mensual», «al mes», «de cada mes»… */
export function cadence(x: Partial<Recurrence>): { adj: string; per: string; every: string; unit: string } {
  const m = periodMonths(x);
  if (m === 12) return { adj: "anual", per: "al año", every: "de cada año", unit: "anualidad" };
  if (m === 3) return { adj: "trimestral", per: "al trimestre", every: "de cada trimestre", unit: "periodo trimestral" };
  return { adj: "mensual", per: "al mes", every: "de cada mes", unit: "mensualidad" };
}

/** Importe con signo del ajuste sobre la base (redondeo al céntimo). */
export function adjustmentCents(baseCents: number, a: Adjustment | null | undefined): number {
  if (!a) return 0;
  const v = a.mode === "percent" ? Math.round((baseCents * a.value) / 10_000) : a.value;
  return a.type === "discount" ? -v : v;
}

/** Problema del ajuste (o null). La base resultante debe seguir siendo positiva. */
export function adjustmentProblem(baseCents: number, a: Adjustment | null | undefined): string | null {
  if (!a) return null;
  if (a.type !== "discount" && a.type !== "surcharge") return "Tipo de ajuste no válido";
  if (a.mode !== "percent" && a.mode !== "amount") return "Modo de ajuste no válido";
  if (!Number.isInteger(a.value) || a.value <= 0) return "El ajuste debe ser positivo";
  if (a.mode === "percent" && a.value > (a.type === "discount" ? 10_000 : 100_000)) return "Porcentaje de ajuste no válido";
  if (a.mode === "amount" && a.value > 100_000_000) return "Importe de ajuste no válido";
  const reason = String(a.reason ?? "").trim();
  if (reason.length < 5 || reason.length > 300) return "Indica el motivo del ajuste (5 a 300 caracteres)";
  if (baseCents + adjustmentCents(baseCents, a) <= 0) return "El descuento no puede dejar el importe a cero o en negativo";
  return null;
}

/** Ajuste normalizado (motivo recortado y quién lo autorizó). */
export const cleanAdjustment = (a: Adjustment, actor: string): Adjustment => ({ type: a.type, mode: a.mode, value: a.value, reason: String(a.reason).trim(), authorizedBy: actor });

/** Ajuste legible: «descuento comercial del 10 %» o «recargo comercial de 50,00 €». */
export function adjustmentText(a: Adjustment, currency: string): string {
  const v = a.mode === "percent" ? `del ${(a.value / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %` : `de ${new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" } as Intl.NumberFormatOptions).format(a.value / 100)}`;
  return `${a.type === "discount" ? "descuento" : "recargo"} comercial ${v}`;
}

/** Fin de una duración fija: el día de cobro tras `periods` periodos desde el primer cargo (misma hora local). */
export function endOfTerm(firstChargeAt: number, periods: number, x: Partial<Recurrence>, billingHour: number, timezone: string): number {
  const d = localDate(firstChargeAt, timezone);
  return zonedInstant(d.year, d.month + periods * periodMonths(x), d.day, billingHour, timezone);
}
