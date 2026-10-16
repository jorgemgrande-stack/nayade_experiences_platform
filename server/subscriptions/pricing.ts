/**
 * Cálculo puro (sin BD) de periodos e importes. Todo en céntimos enteros; los redondeos son a
 * favor del cliente (descuentos hacia arriba, prorrateos hacia abajo) y nunca dan importes negativos.
 */
import crypto from "node:crypto";
import type { Discount, Interval, PriceKind, ShadowLine, SubscriptionItem } from "./types";

const DAY = 86_400_000;

function daysInMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Suma `months` meses de calendario (UTC) conservando el día de anclaje: un alta el 31 renueva el
 * 30 de abril, el 28/29 de febrero y vuelve al 31 en marzo (sin deriva acumulada).
 */
export function addMonthsUTC(ts: number, months: number, anchorDay = new Date(ts).getUTCDate()): number {
  const d = new Date(ts);
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(anchorDay, daysInMonthUTC(year, month));
  return Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

export const intervalMonths = (i: Interval): number => (i === "year" ? 12 : 1);

/** Fin de un periodo que empieza en `start`, con el anclaje del alta. */
export function periodEnd(start: number, interval: Interval, anchorDay: number): number {
  return addMonthsUTC(start, intervalMonths(interval), anchorDay);
}

/** Tipo de precio recurrente que corresponde a una periodicidad. */
export const recurringKind = (i: Interval): PriceKind => (i === "year" ? "yearly" : "monthly");
export const isRecurring = (k: PriceKind) => k === "monthly" || k === "yearly";

/** ¿El descuento sigue vigente en el instante `at`? */
export const discountActive = (d: Discount | null, at: number): d is Discount => !!d && (d.endsAt === null || d.endsAt > at);

/**
 * Importe de una partida para una fracción del periodo. El importe del catálogo puede incluir el
 * impuesto (taxIncluded) o no; el resultado separa siempre base, descuento, impuesto y total.
 */
export function lineAmounts(
  item: Pick<SubscriptionItem, "unitAmountCents" | "quantity" | "taxRateBp" | "taxIncluded" | "discount">,
  at: number,
  fraction = 1,
  quantityOverride?: number,
): Pick<ShadowLine, "grossCents" | "discountCents" | "netCents" | "taxCents" | "totalCents"> {
  if (!(fraction >= 0 && fraction <= 1)) throw new RangeError("fracción fuera de [0,1]");
  const qty = quantityOverride ?? item.quantity;
  // Prorrateo a favor del cliente: hacia abajo
  const gross = Math.floor(item.unitAmountCents * qty * fraction);
  let discount = 0;
  if (discountActive(item.discount, at)) {
    discount =
      item.discount.kind === "percent"
        ? Math.ceil((gross * Math.min(100, Math.max(0, item.discount.value))) / 100)
        : Math.min(gross, Math.ceil(item.discount.value * fraction));
  }
  const afterDiscount = gross - discount;
  if (item.taxIncluded) {
    const base = Math.round((afterDiscount * 10_000) / (10_000 + item.taxRateBp));
    return { grossCents: gross, discountCents: discount, netCents: base, taxCents: afterDiscount - base, totalCents: afterDiscount };
  }
  const tax = Math.round((afterDiscount * item.taxRateBp) / 10_000);
  return { grossCents: gross, discountCents: discount, netCents: afterDiscount, taxCents: tax, totalCents: afterDiscount + tax };
}

/** Fracción del periodo [start, end) que cubre [from, to). */
export function coverage(start: number, end: number, from: number, to: number | null): number {
  const a = Math.max(start, from);
  const b = Math.min(end, to ?? end);
  if (b <= a || end <= start) return 0;
  return (b - a) / (end - start);
}

/** Importe mensual equivalente (para decidir si un cambio de plan es subida o bajada). */
export function monthlyEquivalent(item: Pick<SubscriptionItem, "unitAmountCents" | "quantity" | "priceKind">): number {
  const total = item.unitAmountCents * item.quantity;
  return item.priceKind === "yearly" ? total / 12 : total;
}

/** Huella estable de las entradas de un cálculo (claves ordenadas). */
export function stableHash(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  return crypto.createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");
}

export const days = (n: number) => n * DAY;
