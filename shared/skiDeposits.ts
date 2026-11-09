/**
 * Ski Net · Fianzas del alquiler de material (capacidad `ski-rental`) — lógica pura, sin base de datos: importes en
 * céntimos enteros, estados de la fianza y del cargo por daños, cálculo de la devolución o la retención y movimientos
 * de caja que corresponden a cada caso. La usan el servidor (server/skiRental/depositService.ts) y el mostrador.
 *
 * Criterio contable (el del TPV y la caja del Core):
 *  - La fianza NO es una venta: no genera ticket ni factura ni IVA. Si se cobra en efectivo, entra en la caja como
 *    entrada manual («Fianza alquiler #N») y su devolución sale como salida manual; así el arqueo cuadra.
 *  - Lo retenido por daños o faltas SÍ es ingreso: se registra como venta del TPV (concepto libre «Cargo por daños»),
 *    con su ticket, su IVA y su numeración. En efectivo, la parte retenida sale de la custodia de fianzas (salida
 *    manual «Fianza aplicada a cargo por daños») y entra como venta: el efectivo neto de la caja es el que de verdad
 *    queda en el cajón y el ingreso aparece una sola vez, en ventas.
 *  - Con tarjeta (datáfono) o retención externa no hay movimiento de efectivo: la devolución se hace en el datáfono o
 *    se libera la retención fuera del Core, y la parte retenida se registra igualmente como venta (tarjeta u «otro»).
 *  - Si los daños superan la fianza, la diferencia queda como cargo pendiente del cliente, que se cobra en el TPV.
 *  - IVA: la venta de daños lleva siempre el IVA general de la empresa (nunca REAV, no es un servicio de viaje).
 *    PENDIENTE DE VALIDAR CON EL ASESOR FISCAL: una indemnización por daños puede no estar sujeta a IVA
 *    (art. 78.Tres.1º LIVA); hoy se documenta con ticket e IVA general, que es el criterio prudente del TPV.
 */

export const DEPOSIT_METHODS = ["cash", "card", "external"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

/** held = cobrada (en custodia); settling = liquidándose (venta del TPV en curso); el resto, cerrada. */
export const DEPOSIT_STATUSES = ["held", "settling", "refunded", "retained_partial", "retained_total"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];
export const CLOSED_DEPOSIT_STATUSES: readonly DepositStatus[] = ["refunded", "retained_partial", "retained_total"];

export const CHARGE_STATUSES = ["pending", "paying", "paid", "cancelled"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Medios de cobro del TPV del Core. */
export const PAY_METHODS = ["cash", "card", "bizum", "other"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const DEPOSIT_METHOD_LABEL: Record<DepositMethod, string> = { cash: "Efectivo", card: "Tarjeta (datáfono)", external: "Retención externa" };
export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  held: "Cobrada",
  settling: "Liquidándose",
  refunded: "Devuelta",
  retained_partial: "Retenida parcial",
  retained_total: "Retenida total",
};
export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = { pending: "Pendiente", paying: "Cobrándose", paid: "Cobrado", cancelled: "Anulado" };
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otro" };

/** Tope de una fianza o un cargo (100.000 €): evita errores de tecleo con ceros de más. */
export const MAX_DEPOSIT_CENTS = 10_000_000;

export class DepositRuleError extends Error {}

/** Importe en céntimos entero entre `min` y el tope; lanza con el nombre del campo. */
export function assertCents(v: unknown, what: string, min = 1): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > MAX_DEPOSIT_CENTS) {
    throw new DepositRuleError(`${what}: importe no válido (en céntimos, ${min === 0 ? "0" : "mayor que 0"} y como mucho ${MAX_DEPOSIT_CENTS / 100} €)`);
  }
  return v;
}

/** «12,50» o «12.5» → 1250. null si no es un importe. */
export function parseEurosToCents(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [int, dec = ""] = t.split(".");
  return Number(int) * 100 + Number((dec + "00").slice(0, 2));
}

/** Céntimos → euros con dos decimales para el TPV (que trabaja en euros). */
export const centsToEuros = (cents: number) => Math.round(cents) / 100;

// ── Importe sugerido por modelo o tipo de material ───────────────────────────────

export interface DepositRule {
  modelId: number | null;
  assetType: string | null;
  amountCents: number;
  active: boolean;
}
export interface DepositLine {
  modelId: number;
  assetType: string;
}

/** Clave única de la regla en la sede: por modelo o por tipo (categoría) de material. */
export function ruleKey(r: { modelId?: number | null; assetType?: string | null }): string {
  if (r.modelId != null) return `model:${r.modelId}`;
  if (r.assetType) return `type:${r.assetType}`;
  throw new DepositRuleError("La regla de fianza debe ser de un modelo o de un tipo de material");
}

/**
 * Fianza sugerida para un contrato: por cada unidad, la regla de su modelo y, si no hay, la de su tipo de material.
 * Devuelve el total y el detalle por línea (0 si no hay regla). El mostrador puede cambiarla en cada contrato.
 */
export function suggestDeposit(lines: readonly DepositLine[], rules: readonly DepositRule[]): { totalCents: number; perLine: number[] } {
  const active = rules.filter((r) => r.active);
  const perLine = lines.map((l) => (active.find((r) => r.modelId === l.modelId) ?? active.find((r) => r.modelId == null && r.assetType === l.assetType))?.amountCents ?? 0);
  return { totalCents: perLine.reduce((a, b) => a + b, 0), perLine };
}

/** Daños sugeridos al devolver: el valor de reposición de cada unidad perdida (los daños se valoran a mano). */
export function suggestDamage(lines: ReadonlyArray<{ returnCondition: string | null; replacementValueCents: number | null }>): number {
  return lines.reduce((a, l) => a + (l.returnCondition === "lost" ? (l.replacementValueCents ?? 0) : 0), 0);
}

// ── Liquidación al devolver ─────────────────────────────────────────────────────

export interface SettlementPlan {
  damageCents: number;
  /** Lo que se devuelve al cliente. */
  refundCents: number;
  /** Lo que se queda la empresa (venta «Cargo por daños»). */
  retainedCents: number;
  /** Daños que la fianza no cubre: cargo pendiente del cliente. */
  extraChargeCents: number;
  status: Extract<DepositStatus, "refunded" | "retained_partial" | "retained_total">;
}

/** Devolución total (daños 0), retención parcial o total; lo que exceda de la fianza queda como cargo adicional. */
export function planSettlement(depositCents: number, damageCents: number): SettlementPlan {
  assertCents(depositCents, "Fianza");
  assertCents(damageCents, "Daños", 0);
  const retainedCents = Math.min(damageCents, depositCents);
  const refundCents = depositCents - retainedCents;
  const extraChargeCents = damageCents - retainedCents;
  const status = retainedCents === 0 ? "refunded" : retainedCents === depositCents ? "retained_total" : "retained_partial";
  return { damageCents, refundCents, retainedCents, extraChargeCents, status };
}

/** Retener algo exige motivo (daños o faltas). */
export function assertSettlementReason(plan: SettlementPlan, reason: string | null): void {
  if (plan.damageCents > 0 && !(reason && reason.trim().length >= 3)) throw new DepositRuleError("Indica el motivo de la retención (daños o faltas)");
}

export interface CashMove {
  type: "in" | "out";
  cents: number;
  reason: string;
}

/** Entrada en la caja al cobrar la fianza: solo en efectivo. */
export function collectMovements(method: DepositMethod, amountCents: number, deliveryId: number): CashMove[] {
  return method === "cash" ? [{ type: "in", cents: amountCents, reason: `Fianza alquiler #${deliveryId}` }] : [];
}

/**
 * Movimientos de la liquidación. En efectivo: salida por lo devuelto y salida por lo aplicado a la venta de daños (que
 * entra como venta en efectivo). Con tarjeta o retención externa no se mueve efectivo.
 */
export function settlementMovements(method: DepositMethod, plan: SettlementPlan, deliveryId: number): CashMove[] {
  if (method !== "cash") return [];
  const out: CashMove[] = [];
  if (plan.refundCents > 0) out.push({ type: "out", cents: plan.refundCents, reason: `Devolución fianza alquiler #${deliveryId}` });
  if (plan.retainedCents > 0) out.push({ type: "out", cents: plan.retainedCents, reason: `Fianza aplicada a cargo por daños alquiler #${deliveryId}` });
  return out;
}

/** Medio de la venta de la parte retenida: el mismo con el que se cobró la fianza (externa → «otro»). */
export const retentionPayMethod = (m: DepositMethod): PayMethod => (m === "cash" ? "cash" : m === "card" ? "card" : "other");

/** ¿Hace falta una sesión de caja abierta? Para mover efectivo o para registrar la venta de daños en el TPV. */
export const needsCashSession = (method: DepositMethod, plan?: SettlementPlan) => method === "cash" || (plan ? plan.retainedCents > 0 : false);

const TRANSITIONS: Record<DepositStatus, readonly DepositStatus[]> = {
  held: ["settling", "refunded", "retained_partial", "retained_total"],
  settling: ["held", "refunded", "retained_partial", "retained_total"],
  refunded: [],
  retained_partial: [],
  retained_total: [],
};
export function assertDepositTransition(from: DepositStatus, to: DepositStatus): void {
  if (!TRANSITIONS[from].includes(to)) throw new DepositRuleError(`La fianza está «${DEPOSIT_STATUS_LABEL[from]}»: no puede pasar a «${DEPOSIT_STATUS_LABEL[to]}»`);
}

const CHARGE_TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  pending: ["paying", "cancelled"],
  paying: ["pending", "paid"],
  paid: [],
  cancelled: [],
};
export function assertChargeTransition(from: ChargeStatus, to: ChargeStatus): void {
  if (!CHARGE_TRANSITIONS[from].includes(to)) throw new DepositRuleError(`El cargo está «${CHARGE_STATUS_LABEL[from]}»: no puede pasar a «${CHARGE_STATUS_LABEL[to]}»`);
}

/**
 * Claves de idempotencia del TPV (`[A-Za-z0-9_-]{8,64}`): una venta por liquidación de fianza (con el importe retenido,
 * para que una liquidación nueva con otro plan nunca reutilice una venta anterior) y una por cargo. Si la venta se
 * anuló o devolvió en el TPV sin cobrarse el cargo o liquidarse la fianza, su clave ya está gastada (el TPV devolvería
 * esa misma venta): el siguiente intento usa `<base>-2`, `<base>-3`…
 */
export const attemptKey = (base: string, attempt = 1) => (attempt > 1 ? `${base}-${attempt}` : base);
export const retentionSaleKey = (depositId: number, retainedCents: number, attempt = 1) => attemptKey(`skidep-${depositId}-r${retainedCents}`, attempt);
export const chargeSaleKey = (chargeId: number, attempt = 1) => attemptKey(`skichg-${chargeId}-pay`, attempt);
/** Intento de una clave de la familia `base` (1 = la base; 0 si no es de esa familia). */
export function keyAttempt(base: string, key: string): number {
  if (key === base) return 1;
  const m = key.startsWith(`${base}-`) ? /^\d+$/.exec(key.slice(base.length + 1)) : null;
  return m ? Number(m[0]) : 0;
}

/** Clave del cliente para no duplicar un cargo manual con un doble clic. */
export const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

// ── Totales del día (cierre de caja) ────────────────────────────────────────────

export interface DepositRow {
  method: DepositMethod;
  status: DepositStatus;
  amountCents: number;
  refundedCents: number | null;
  retainedCents: number | null;
  collectedAt: number;
  settledAt: number | null;
}
export interface ChargeRow {
  status: ChargeStatus;
  amountCents: number;
  payMethod: PayMethod | null;
  createdAt: number;
  paidAt: number | null;
}
type ByMethod = Record<DepositMethod, number>;
const zero = (): ByMethod => ({ cash: 0, card: 0, external: 0 });

export interface DayTotals {
  day: string;
  collected: ByMethod & { count: number; total: number };
  refunded: ByMethod & { count: number; total: number };
  retained: ByMethod & { count: number; total: number };
  /** Fianzas en custodia ahora mismo (de cualquier día). */
  open: ByMethod & { count: number; total: number };
  chargesPaid: { count: number; total: number };
  chargesPending: { count: number; total: number };
  /** Efectivo neto de fianzas en la caja hoy: cobrado − devuelto − aplicado a daños (lo aplicado entra como venta). */
  netCashCents: number;
}

/** Día en Madrid (AAAA-MM-DD) de una marca de tiempo en milisegundos. */
export function madridDay(ms: number): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function dayTotals(day: string, deposits: readonly DepositRow[], charges: readonly ChargeRow[]): DayTotals {
  const bucket = () => ({ ...zero(), count: 0, total: 0 });
  const t: DayTotals = { day, collected: bucket(), refunded: bucket(), retained: bucket(), open: bucket(), chargesPaid: { count: 0, total: 0 }, chargesPending: { count: 0, total: 0 }, netCashCents: 0 };
  const add = (b: ByMethod & { count: number; total: number }, m: DepositMethod, c: number) => {
    b[m] += c;
    b.count += 1;
    b.total += c;
  };
  for (const d of deposits) {
    if (madridDay(d.collectedAt) === day) add(t.collected, d.method, d.amountCents);
    if (d.status === "held" || d.status === "settling") add(t.open, d.method, d.amountCents);
    if (d.settledAt != null && CLOSED_DEPOSIT_STATUSES.includes(d.status) && madridDay(d.settledAt) === day) {
      if ((d.refundedCents ?? 0) > 0) add(t.refunded, d.method, d.refundedCents ?? 0);
      if ((d.retainedCents ?? 0) > 0) add(t.retained, d.method, d.retainedCents ?? 0);
    }
  }
  for (const c of charges) {
    if (c.status === "pending" || c.status === "paying") {
      t.chargesPending.count += 1;
      t.chargesPending.total += c.amountCents;
    }
    if (c.status === "paid" && c.paidAt != null && madridDay(c.paidAt) === day) {
      t.chargesPaid.count += 1;
      t.chargesPaid.total += c.amountCents;
    }
  }
  t.netCashCents = t.collected.cash - t.refunded.cash - t.retained.cash;
  return t;
}
