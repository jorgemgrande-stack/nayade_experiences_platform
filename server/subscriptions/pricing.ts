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

const MADRID = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Fecha y hora de pared en Europe/Madrid de un instante. */
function madridWall(ts: number) {
  const p: Record<string, number> = {};
  for (const x of MADRID.formatToParts(new Date(ts))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { year: p.year, month: p.month - 1, day: p.day, hour: p.hour, minute: p.minute, second: p.second, ms: ((ts % 1000) + 1000) % 1000 };
}
/** Instante de una fecha y hora de pared de Europe/Madrid (con el cambio de hora resuelto). */
function madridInstant(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): number {
  const wall = Date.UTC(year, month, day, hour, minute, second, ms);
  const offset = (ts: number) => {
    const w = madridWall(ts);
    return Date.UTC(w.year, w.month, w.day, w.hour, w.minute, w.second, w.ms) - ts;
  };
  const first = wall - offset(wall);
  return wall - offset(first);
}
/** Día del mes (1–31) de un instante en Europe/Madrid. */
export const madridDayOfMonth = (ts: number): number => madridWall(ts).day;
/**
 * Anclaje en calendario de Europe/Madrid: un día de anclaje NEGATIVO (−1…−31) significa «ese día del mes en hora
 * peninsular». Solo lo usan las suscripciones económicas con fecha de inicio elegida por el operador (día 1 a las
 * 00:00 de Madrid → día 1 a las 00:00 de Madrid de cada mes, con el cambio de hora). Las demás suscripciones llevan
 * un día positivo y su cálculo en UTC no cambia.
 */
export const madridAnchor = (ts: number): number => -madridDayOfMonth(ts);
function addMonthsMadrid(ts: number, months: number, anchorDay: number): number {
  const w = madridWall(ts);
  const total = w.month + months;
  const year = w.year + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(anchorDay, daysInMonthUTC(year, month));
  return madridInstant(year, month, day, w.hour, w.minute, w.second, w.ms);
}

/**
 * Suma `months` meses de calendario (UTC) conservando el día de anclaje: un alta el 31 renueva el
 * 30 de abril, el 28/29 de febrero y vuelve al 31 en marzo (sin deriva acumulada). Con un día de anclaje negativo, el
 * calendario es el de Europe/Madrid (`madridAnchor`).
 */
export function addMonthsUTC(ts: number, months: number, anchorDay = new Date(ts).getUTCDate()): number {
  if (anchorDay < 0) return addMonthsMadrid(ts, months, -anchorDay);
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
/** Periodicidad PROPIA de una partida (la de su precio aceptado); null si no es recurrente. */
export const itemInterval = (k: PriceKind): Interval | null => (k === "yearly" ? "year" : k === "monthly" ? "month" : null);

/**
 * Intervalos mixtos: el periodo de la suscripción es el del plan Core. Una partida con la misma
 * periodicidad comparte ese periodo; una de periodicidad más corta (complemento mensual en un plan
 * anual) lo divide en periodos consecutivos con el mismo anclaje, de modo que renueva por su cuenta
 * cada mes y su última renovación coincide con la del Core. Nunca hay una partida con periodicidad
 * más larga que la del Core (se rechaza al contratar).
 */
export function itemPeriods(sub: { interval: Interval; anchorDay: number; currentPeriodStart: number; currentPeriodEnd: number }, interval: Interval): Array<{ start: number; end: number }> {
  const S = sub.currentPeriodStart;
  const E = sub.currentPeriodEnd;
  const total = intervalMonths(sub.interval);
  const step = intervalMonths(interval);
  if (step >= total) return [{ start: S, end: E }];
  const out: Array<{ start: number; end: number }> = [];
  for (let k = step, start = S; k <= total; k += step) {
    const end = k >= total ? E : addMonthsUTC(S, k, sub.anchorDay);
    out.push({ start, end });
    start = end;
  }
  return out;
}

/** Periodo propio de la partida que contiene `at` (el primero o el último si cae fuera). */
export function itemPeriodAt(sub: Parameters<typeof itemPeriods>[0], interval: Interval, at: number): { start: number; end: number } {
  const all = itemPeriods(sub, interval);
  return all.find((p) => at < p.end) ?? all[all.length - 1];
}

/** ¿El descuento sigue vigente en el instante `at`? */
export const discountActive = (d: Discount | null, at: number): d is Discount => !!d && (d.endsAt === null || d.endsAt > at);

/**
 * Importe de una partida para una fracción del periodo. El importe del catálogo puede incluir el
 * impuesto (taxIncluded) o no; el resultado separa siempre base, descuento, impuesto y total.
 */
export function lineAmounts(
  item: Pick<SubscriptionItem, "unitAmountCents" | "quantity" | "taxRateBp" | "taxIncluded" | "discount" | "lineAmountCents">,
  at: number,
  fraction = 1,
  quantityOverride?: number,
): Pick<ShadowLine, "grossCents" | "discountCents" | "netCents" | "taxCents" | "totalCents"> {
  if (!(fraction >= 0 && fraction <= 1)) throw new RangeError("fracción fuera de [0,1]");
  const qty = quantityOverride ?? item.quantity;
  // Prorrateo a favor del cliente: hacia abajo. Una partida de un acuerdo lleva su importe del periodo ya resuelto
  const gross = Math.floor((item.lineAmountCents ?? item.unitAmountCents * qty) * fraction);
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
export function monthlyEquivalent(item: Pick<SubscriptionItem, "unitAmountCents" | "quantity" | "priceKind" | "lineAmountCents">): number {
  const total = item.lineAmountCents ?? item.unitAmountCents * item.quantity;
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
