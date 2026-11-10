/**
 * Cálculo puro (sin BD ni catálogo) de un acuerdo de condiciones personalizadas. Todo en céntimos enteros.
 *
 * Por cada partida se distinguen, sin mezclar:
 *  - precio OFICIAL de referencia (`officialCents`);
 *  - precio NEGOCIADO: el individual pactado o, con cuota global, su ASIGNACIÓN interna (`negotiatedCents`);
 *  - AJUSTES: descuentos y recargos (`adjustmentCents`, con el detalle de cuál aplicó cuánto: cada ajuste, una sola vez);
 *  - valor contractual EFECTIVO (`netCents` = negociado + ajustes, nunca negativo);
 *  - impuesto por tipo y total.
 * El importe realmente FACTURABLE de un periodo concreto (prorrateos, abonos de un solo uso) lo da la facturación a
 * partir de las partidas materializadas (`materialize`), que llevan el importe efectivo ya resuelto y ningún descuento.
 *
 * Redondeos: el descuento porcentual hacia arriba y el recargo hacia abajo (a favor del cliente); los repartos, por
 * resto mayor (la suma del reparto es exactamente el total repartido); el impuesto se calcula por TIPO sobre la base
 * sumada y se reparte a las líneas, de modo que «impuesto del total» y «suma de impuestos por línea» coinciden.
 */
import { isRecurring, type Adjustment, type Terms, type TermsLine } from "./model";

/** Reparte `total` (≥ 0) en proporción a `weights` (≥ 0) por resto mayor. Con todos los pesos a cero, a partes iguales. */
export function allocateCents(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  if (!Number.isInteger(total) || total < 0) throw new RangeError("total no válido");
  const w = weights.some((x) => x > 0) ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  // Aritmética entera (BigInt): sin errores de coma flotante en importes grandes
  const T = BigInt(total);
  const S = BigInt(sum);
  const out: number[] = [];
  const rem: Array<{ i: number; r: bigint }> = [];
  let given = 0;
  w.forEach((x, i) => {
    const p = T * BigInt(x);
    const q = Number(p / S);
    out.push(q);
    given += q;
    rem.push({ i, r: p % S });
  });
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; given < total; k++, given++) out[rem[k % rem.length].i] += 1;
  return out;
}

/**
 * Impuesto por TIPO: para cada tipo, redondea una vez sobre la base sumada y reparte el resultado entre sus líneas
 * (cada una con su redondeo propio; la diferencia de céntimos va a la línea de mayor base). Admite líneas negativas (abonos).
 */
export function groupTax(lines: Array<{ netCents: number; taxRateBp: number }>): number[] {
  const out = lines.map((l) => Math.round((l.netCents * l.taxRateBp) / 10_000));
  const rates = Array.from(new Set(lines.map((l) => l.taxRateBp)));
  for (const rate of rates) {
    const idx = lines.map((l, i) => (l.taxRateBp === rate ? i : -1)).filter((i) => i >= 0);
    const base = idx.reduce((a, i) => a + lines[i].netCents, 0);
    const diff = Math.round((base * rate) / 10_000) - idx.reduce((a, i) => a + out[i], 0);
    if (diff !== 0) {
      const top = idx.reduce((best, i) => (Math.abs(lines[i].netCents) > Math.abs(lines[best].netCents) ? i : best), idx[0]);
      out[top] += diff;
    }
  }
  return out;
}

export interface AppliedAdjustment {
  adjustmentId: number;
  /** Con signo: negativo = descuento. */
  cents: number;
}
export interface ComputedLine {
  lineId: number;
  name: string;
  kind: TermsLine["kind"];
  chargeClass: TermsLine["chargeClass"];
  quantity: number;
  taxRateBp: number;
  officialCents: number | null;
  negotiatedCents: number;
  adjustmentCents: number;
  applied: AppliedAdjustment[];
  netCents: number;
  taxCents: number;
  totalCents: number;
}
export interface TaxGroup {
  rateBp: number;
  baseCents: number;
  taxCents: number;
}
export interface Totals {
  /** Suma de precios oficiales de referencia (las partidas a medida cuentan por su precio). */
  officialCents: number;
  negotiatedCents: number;
  adjustmentCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  taxes: TaxGroup[];
}

const officialOf = (l: TermsLine) => (l.officialUnitCents === null ? null : l.officialUnitCents * l.quantity);
const ownPriceOf = (l: TermsLine) => (l.negotiatedUnitCents ?? l.officialUnitCents ?? 0) * l.quantity;
/** Valor de referencia para repartir una cuota global: el oficial o, en una partida a medida, su precio. */
const referenceOf = (l: TermsLine) => officialOf(l) ?? ownPriceOf(l);

/** Importe con signo de un ajuste sobre una base (sin topes). */
function adjustmentAmount(a: Pick<Adjustment, "type" | "mode" | "value">, base: number): number {
  if (a.type === "discount") return -(a.mode === "percent" ? Math.ceil((base * a.value) / 10_000) : a.value);
  return a.mode === "percent" ? Math.floor((base * a.value) / 10_000) : a.value;
}

function totalsOf(lines: Array<Pick<ComputedLine, "officialCents" | "negotiatedCents" | "adjustmentCents" | "netCents" | "taxCents" | "totalCents" | "taxRateBp">>): Totals {
  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((a, l) => a + f(l), 0);
  const rates = Array.from(new Set(lines.map((l) => l.taxRateBp))).sort((a, b) => a - b);
  return {
    officialCents: sum((l) => l.officialCents ?? l.negotiatedCents),
    negotiatedCents: sum((l) => l.negotiatedCents),
    adjustmentCents: sum((l) => l.adjustmentCents),
    netCents: sum((l) => l.netCents),
    taxCents: sum((l) => l.taxCents),
    totalCents: sum((l) => l.totalCents),
    taxes: rates.map((rateBp) => {
      const g = lines.filter((l) => l.taxRateBp === rateBp);
      return { rateBp, baseCents: g.reduce((a, l) => a + l.netCents, 0), taxCents: g.reduce((a, l) => a + l.taxCents, 0) };
    }),
  };
}

function withTax<T extends { netCents: number; taxRateBp: number }>(lines: T[]): Array<T & { taxCents: number; totalCents: number }> {
  const tax = groupTax(lines);
  return lines.map((l, i) => ({ ...l, taxCents: tax[i], totalCents: l.netCents + tax[i] }));
}

const lineStart = (t: Pick<Terms, "effectiveFrom">, l: TermsLine) => l.startsAt ?? t.effectiveFrom ?? Number.NEGATIVE_INFINITY;
const adjustmentLive = (a: Adjustment, at: number) => a.recurrence === "recurring" && (a.endsAt === null || at < a.endsAt);

/** Partidas recurrentes vigentes en `at` (cada una con su inicio y fin propios, si los tiene). */
export function recurringLinesAt(t: Pick<Terms, "effectiveFrom" | "lines">, at: number): TermsLine[] {
  return t.lines.filter((l) => isRecurring(l) && lineStart(t, l) <= at && (l.endsAt === null || at < l.endsAt)).sort((a, b) => a.sort - b.sort || a.id - b.id);
}

/**
 * Cuota recurrente de UN periodo completo que empieza en `at`: oficial, negociado (o asignación de la cuota global),
 * ajustes recurrentes vigentes, efectivo e impuestos. No incluye cargos únicos ni ajustes de un solo uso.
 */
export function recurringAt(t: Terms, at: number): Totals & { at: number; lines: ComputedLine[] } {
  const lines = recurringLinesAt(t, at);
  const negotiated = t.pricingMode === "global" ? allocateCents(t.globalAmountCents ?? 0, lines.map(referenceOf)) : lines.map(ownPriceOf);
  const net = negotiated.slice();
  const applied: AppliedAdjustment[][] = lines.map(() => []);
  const live = t.adjustments.filter((a) => adjustmentLive(a, at));
  // 1.º los ajustes de cada partida, sobre su precio negociado (no se encadenan entre sí)
  for (const a of live.filter((x) => x.lineId !== null)) {
    const i = lines.findIndex((l) => l.id === a.lineId);
    if (i < 0) continue;
    const delta = Math.max(-net[i], adjustmentAmount(a, negotiated[i]));
    if (delta !== 0) {
      net[i] += delta;
      applied[i].push({ adjustmentId: a.id, cents: delta });
    }
  }
  // 2.º los ajustes globales, sobre el total ya ajustado, repartidos en proporción
  for (const a of live.filter((x) => x.lineId === null)) {
    const base = net.reduce((x, y) => x + y, 0);
    const delta = Math.max(-base, adjustmentAmount(a, base));
    if (delta === 0) continue;
    const parts = allocateCents(Math.abs(delta), net.some((x) => x > 0) ? net : lines.map(referenceOf));
    parts.forEach((p, i) => {
      if (!p) return;
      const d = delta < 0 ? -Math.min(p, net[i]) : p;
      net[i] += d;
      applied[i].push({ adjustmentId: a.id, cents: d });
    });
  }
  const computed = withTax(
    lines.map((l, i) => ({
      lineId: l.id,
      name: l.name,
      kind: l.kind,
      chargeClass: l.chargeClass,
      quantity: l.quantity,
      taxRateBp: l.taxRateBp,
      officialCents: officialOf(l),
      negotiatedCents: negotiated[i],
      adjustmentCents: net[i] - negotiated[i],
      applied: applied[i],
      netCents: net[i],
    })),
  );
  return { at, lines: computed, ...totalsOf(computed) };
}

export interface OneTimeCharge extends ComputedLine {
  /** Fecha del cargo (ms UTC). */
  at: number;
}
/** Ajuste de un solo uso sobre las cuotas recurrentes: abono (negativo) o recargo (positivo) del primer periodo. */
export interface OnceCredit {
  adjustmentId: number;
  note: string | null;
  at: number;
  /** Reparto por partida (para el impuesto de cada tipo). */
  parts: Array<{ lineId: number; taxRateBp: number; cents: number }>;
  cents: number;
}

/**
 * Importes ÚNICOS del acuerdo: los cargos (pagos iniciales y trabajos extraordinarios, con sus ajustes de un solo
 * uso) y los ajustes de un solo uso sobre las cuotas recurrentes (se aplican una vez, en el primer periodo).
 */
export function oneTime(t: Terms): { charges: OneTimeCharge[]; credits: OnceCredit[] } {
  const start = t.effectiveFrom ?? 0;
  const once = t.adjustments.filter((a) => a.recurrence === "once");
  const charges = t.lines
    .filter((l) => !isRecurring(l))
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((l) => {
      const base = ownPriceOf(l);
      let net = base;
      const applied: AppliedAdjustment[] = [];
      for (const a of once.filter((x) => x.lineId === l.id)) {
        const delta = Math.max(-net, adjustmentAmount(a, base));
        if (delta !== 0) {
          net += delta;
          applied.push({ adjustmentId: a.id, cents: delta });
        }
      }
      return { at: l.startsAt ?? start, lineId: l.id, name: l.name, kind: l.kind, chargeClass: l.chargeClass, quantity: l.quantity, taxRateBp: l.taxRateBp, officialCents: officialOf(l), negotiatedCents: base, adjustmentCents: net - base, applied, netCents: net };
    });
  // Sobre las recurrentes: contra la cuota efectiva del primer periodo, sin dejarla nunca por debajo de cero
  const first = recurringAt(t, start);
  const left = first.lines.map((l) => l.netCents);
  const credits: OnceCredit[] = [];
  for (const a of once) {
    const target = a.lineId === null ? null : t.lines.find((l) => l.id === a.lineId);
    if (target && !isRecurring(target)) continue;
    const idx = target ? first.lines.map((l, i) => (l.lineId === target.id ? i : -1)).filter((i) => i >= 0) : first.lines.map((_, i) => i);
    if (!idx.length) continue;
    const base = idx.reduce((x, i) => x + first.lines[i].netCents, 0);
    const room = idx.reduce((x, i) => x + left[i], 0);
    const delta = Math.max(-room, adjustmentAmount(a, base));
    if (delta === 0) continue;
    const weights = idx.map((i) => (delta < 0 ? left[i] : first.lines[i].netCents));
    const shares = allocateCents(Math.abs(delta), weights);
    const parts: OnceCredit["parts"] = [];
    shares.forEach((p, k) => {
      if (!p) return;
      const i = idx[k];
      const d = delta < 0 ? -Math.min(p, left[i]) : p;
      left[i] += d;
      parts.push({ lineId: first.lines[i].lineId, taxRateBp: first.lines[i].taxRateBp, cents: d });
    });
    credits.push({ adjustmentId: a.id, note: a.note, at: start, parts, cents: parts.reduce((x, p) => x + p.cents, 0) });
  }
  return { charges: withTax(charges), credits };
}

export interface TermsSummary {
  /** Cuota recurrente al empezar el acuerdo (un periodo completo). */
  recurring: ReturnType<typeof recurringAt>;
  /** Cargos únicos, con su fecha. */
  charges: OneTimeCharge[];
  chargesTotals: Totals;
  credits: OnceCredit[];
  /** Primera contratación: cuota del primer periodo + cargos únicos con fecha de inicio + ajustes de un solo uso. */
  first: Totals;
  /** Renovaciones posteriores: solo las partidas recurrentes vigentes (tras vencer los ajustes temporales). */
  steady: ReturnType<typeof recurringAt>;
  /** Fechas en las que cambia la cuota recurrente dentro de la vigencia (ms UTC), con la cuota desde entonces. */
  changes: Array<{ at: number; netCents: number; taxCents: number; totalCents: number }>;
}

/** Fechas en que puede cambiar la cuota recurrente dentro de [effectiveFrom, effectiveTo). */
function breakpoints(t: Terms): number[] {
  const from = t.effectiveFrom ?? 0;
  const end = t.effectiveTo ?? Number.POSITIVE_INFINITY;
  const pts = new Set<number>([from]);
  for (const a of t.adjustments) if (a.recurrence === "recurring" && a.endsAt !== null) pts.add(a.endsAt);
  for (const l of t.lines.filter(isRecurring)) {
    if (l.startsAt !== null) pts.add(l.startsAt);
    if (l.endsAt !== null) pts.add(l.endsAt);
  }
  return Array.from(pts).filter((p) => p >= from && p < end).sort((a, b) => a - b);
}

/** Resumen económico del acuerdo para la vista previa, el contrato y el historial. */
export function summarize(t: Terms): TermsSummary {
  const start = t.effectiveFrom ?? 0;
  const recurring = recurringAt(t, start);
  const { charges, credits } = oneTime(t);
  const pts = breakpoints(t);
  const steady = recurringAt(t, pts[pts.length - 1] ?? start);
  // Primera factura: recurrentes menos abonos por partida, más los cargos con fecha de inicio
  const firstLines = withTax([
    ...recurring.lines.map((l) => {
      const credit = credits.reduce((a, c) => a + c.parts.filter((p) => p.lineId === l.lineId).reduce((x, p) => x + p.cents, 0), 0);
      return { officialCents: l.officialCents, negotiatedCents: l.negotiatedCents, adjustmentCents: l.adjustmentCents + credit, netCents: l.netCents + credit, taxRateBp: l.taxRateBp };
    }),
    ...charges.filter((c) => c.at <= start).map((c) => ({ officialCents: c.officialCents, negotiatedCents: c.negotiatedCents, adjustmentCents: c.adjustmentCents, netCents: c.netCents, taxRateBp: c.taxRateBp })),
  ]);
  const changes: TermsSummary["changes"] = [];
  let last = recurring.netCents;
  for (const p of pts.slice(1)) {
    const r = recurringAt(t, p);
    if (r.netCents !== last) changes.push({ at: p, netCents: r.netCents, taxCents: r.taxCents, totalCents: r.totalCents });
    last = r.netCents;
  }
  return { recurring, charges, chargesTotals: totalsOf(charges), credits, first: totalsOf(firstLines), steady, changes };
}

export interface PlannedItem {
  role: "recurring" | "charge" | "credit" | "after_end";
  /** Partida del acuerdo (null en un abono global que agrupa varias). */
  lineId: number | null;
  adjustmentId: number | null;
  name: string;
  quantity: number;
  taxRateBp: number;
  /** Importe NETO: por periodo (recurrente) o único (cargo; negativo en un abono). Ya con los ajustes resueltos. */
  amountCents: number;
  from: number;
  to: number | null;
  /** Tarifa oficial provisional: se sustituye por la vigente en la fecha del cambio (`official_current`). */
  provisional: boolean;
}

/**
 * Traduce el acuerdo a partidas de suscripción con fechas: una por partida y TRAMO de importe constante (los ajustes
 * temporales y los inicios y fines propios parten tramos), los cargos únicos en su fecha, los ajustes de un solo uso
 * como abonos en el inicio y, si la condición es temporal y vuelve a la tarifa oficial, las partidas posteriores.
 * Las fechas futuras entran en vigor solas: nada depende de una modificación manual posterior.
 */
export function materialize(t: Terms): PlannedItem[] {
  if (t.effectiveFrom === null) throw new RangeError("El acuerdo no tiene fecha de inicio");
  const from = t.effectiveFrom;
  const end = t.effectiveTo;
  const pts = breakpoints(t);
  const out: PlannedItem[] = [];
  const open = new Map<number, PlannedItem>();
  for (const p of pts) {
    const r = recurringAt(t, p);
    const seen = new Set<number>();
    for (const l of r.lines) {
      seen.add(l.lineId);
      const cur = open.get(l.lineId);
      if (cur && cur.amountCents === l.netCents) continue;
      if (cur) cur.to = p;
      const next: PlannedItem = { role: "recurring", lineId: l.lineId, adjustmentId: null, name: l.name, quantity: l.quantity, taxRateBp: l.taxRateBp, amountCents: l.netCents, from: p, to: null, provisional: false };
      open.set(l.lineId, next);
      out.push(next);
    }
    for (const [id, cur] of Array.from(open)) {
      if (seen.has(id)) continue;
      cur.to = p;
      open.delete(id);
    }
  }
  if (end !== null) {
    for (const cur of Array.from(open.values())) cur.to = end;
    if (t.afterEnd === "official_snapshot" || t.afterEnd === "official_current") {
      for (const l of t.lines.filter((x) => isRecurring(x) && open.has(x.id)).sort((a, b) => a.sort - b.sort || a.id - b.id)) {
        if (l.endsAt !== null && l.endsAt <= end) continue;
        out.push({ role: "after_end", lineId: l.id, adjustmentId: null, name: l.name, quantity: l.quantity, taxRateBp: l.taxRateBp, amountCents: referenceOf(l), from: end, to: l.endsAt, provisional: t.afterEnd === "official_current" && l.kind === "catalog" });
      }
    }
  }
  const { charges, credits } = oneTime(t);
  for (const c of charges) out.push({ role: "charge", lineId: c.lineId, adjustmentId: null, name: c.name, quantity: c.quantity, taxRateBp: c.taxRateBp, amountCents: c.netCents, from: c.at, to: null, provisional: false });
  for (const c of credits) {
    const rates = Array.from(new Set(c.parts.map((p) => p.taxRateBp))).sort((a, b) => a - b);
    for (const rate of rates) {
      const parts = c.parts.filter((p) => p.taxRateBp === rate);
      const name = `${c.cents < 0 ? "Descuento" : "Recargo"} de un solo uso${c.note ? `: ${c.note}` : ""}`;
      out.push({ role: "credit", lineId: parts.length === 1 ? parts[0].lineId : null, adjustmentId: c.adjustmentId, name, quantity: 1, taxRateBp: rate, amountCents: parts.reduce((a, p) => a + p.cents, 0), from, to: null, provisional: false });
    }
  }
  return out;
}

/** Diferencia económica entre dos cuotas recurrentes (antes → después), para la vista previa de un cambio. */
export function difference(before: Pick<Totals, "netCents" | "taxCents" | "totalCents"> | null, after: Pick<Totals, "netCents" | "taxCents" | "totalCents">) {
  return { netCents: after.netCents - (before?.netCents ?? 0), taxCents: after.taxCents - (before?.taxCents ?? 0), totalCents: after.totalCents - (before?.totalCents ?? 0) };
}
