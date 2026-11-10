/**
 * TPV Advanced (Elephant Connect, capacidad `pos-advanced`): lógica pura que comparten el servidor (que decide) y el
 * panel (que solo explica). Sin BD ni React.
 *
 *  - Arqueos: recuento por billetes y monedas (céntimos enteros, sin errores de coma flotante) y conciliación por
 *    método frente a lo esperado.
 *  - Autorizaciones especiales: operaciones sensibles que la empresa somete a un supervisor, con su umbral.
 *  - Auditoría: tipos de evento del registro cronológico unificado.
 */

// ─── Arqueos ──────────────────────────────────────────────────────────────────

/** Billetes y monedas de euro, en céntimos (de mayor a menor). */
export const EUR_DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;
export type EurDenomination = (typeof EUR_DENOMINATIONS)[number];
const DENOM_SET = new Set<number>(EUR_DENOMINATIONS);
export const MAX_PIECES_PER_DENOMINATION = 100_000;

export function isBill(cents: number): boolean {
  return cents >= 500;
}

/** Nombre de un billete o moneda: «50 €», «0,20 €». */
export function denominationLabel(cents: number): string {
  return cents % 100 === 0 ? `${cents / 100} €` : `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

/** Recuento normalizado (solo valores de euro válidos, cantidades enteras ≥ 0) o el error comprensible. */
export function normalizeDenominations(raw: Record<string, number>): { ok: true; pieces: Record<string, number>; totalCents: number } | { ok: false; error: string } {
  const pieces: Record<string, number> = {};
  let totalCents = 0;
  for (const [k, v] of Object.entries(raw ?? {})) {
    const cents = Number(k);
    if (!DENOM_SET.has(cents)) return { ok: false, error: `«${k}» no es un billete ni una moneda de euro.` };
    if (!Number.isInteger(v) || v < 0 || v > MAX_PIECES_PER_DENOMINATION) return { ok: false, error: `La cantidad de ${denominationLabel(cents)} no es válida.` };
    if (v === 0) continue;
    pieces[String(cents)] = v;
    totalCents += cents * v;
  }
  return { ok: true, pieces, totalCents };
}

export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number) => c / 100;
/** Diferencia contado − esperado en euros, redondeada al céntimo (positiva = sobra; negativa = falta). */
export function moneyDiff(counted: number, expected: number): number {
  return fromCents(toCents(counted) - toCents(expected));
}

export const COUNT_KINDS = ["intermediate", "closing"] as const;
export type CountKind = (typeof COUNT_KINDS)[number];
export const COUNT_KIND_LABELS: Record<CountKind, string> = { intermediate: "Arqueo intermedio", closing: "Arqueo de cierre" };

/** Métodos que se concilian: lo cobrado frente a lo declarado por el datáfono, Bizum o el operador. */
export const RECON_METHODS = ["cash", "card", "bizum", "other"] as const;
export type ReconMethod = (typeof RECON_METHODS)[number];
export const RECON_METHOD_LABELS: Record<ReconMethod, string> = { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otros" };

export interface Reconciliation {
  method: ReconMethod;
  expected: number;
  declared: number | null;
  difference: number | null;
}

/** Conciliación por método: sin declarar, sin diferencia (no se inventa un cero). */
export function reconcile(expected: Record<ReconMethod, number>, declared: Partial<Record<ReconMethod, number | null>>): Reconciliation[] {
  return RECON_METHODS.map((method) => {
    const d = declared[method];
    const has = typeof d === "number" && Number.isFinite(d);
    return { method, expected: fromCents(toCents(expected[method])), declared: has ? d : null, difference: has ? moneyDiff(d, expected[method]) : null };
  });
}

/** Tono de una diferencia para el panel: cuadra, sobra o falta. */
export function differenceTone(diff: number | null): "neutral" | "success" | "warning" | "danger" {
  if (diff === null) return "neutral";
  if (Math.abs(diff) < 0.005) return "success";
  return diff > 0 ? "warning" : "danger";
}

// ─── Turnos y entregas ───────────────────────────────────────────────────────

export const SHIFT_STATUSES = ["open", "closed"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const HANDOVER_STATUSES = ["pending", "accepted", "disputed", "cancelled"] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];
export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  pending: "Pendiente de recibir",
  accepted: "Recibida y conforme",
  disputed: "Recibida con diferencia",
  cancelled: "Anulada",
};

/** Estado de una entrega al recibirla: conforme si cuadra al céntimo. */
export function handoverOutcome(declared: number, received: number): { status: "accepted" | "disputed"; difference: number } {
  const difference = moneyDiff(received, declared);
  return { status: Math.abs(difference) < 0.005 ? "accepted" : "disputed", difference };
}

export const CORRECTION_TARGETS = ["count", "shift", "handover"] as const;
export type CorrectionTarget = (typeof CORRECTION_TARGETS)[number];
export const CORRECTION_TARGET_LABELS: Record<CorrectionTarget, string> = { count: "Arqueo", shift: "Turno", handover: "Entrega de caja" };

// ─── Autorizaciones especiales ───────────────────────────────────────────────

export const AUTH_KINDS = ["discount", "cash_out", "drawer_open", "closed_correction", "void_sale"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

/** Cómo se mide el umbral de cada operación: porcentaje, euros o sin umbral (siempre que esté activa). */
export const AUTH_KIND_UNIT: Record<AuthKind, "percent" | "eur" | "none"> = {
  discount: "percent",
  cash_out: "eur",
  drawer_open: "none",
  closed_correction: "eur",
  void_sale: "eur",
};

export const AUTH_KIND_LABELS: Record<AuthKind, string> = {
  discount: "Descuento por encima del umbral",
  cash_out: "Salida de efectivo por encima del umbral",
  drawer_open: "Abrir el cajón sin venta",
  closed_correction: "Corrección de una caja cerrada",
  void_sale: "Anulación o devolución por encima del umbral",
};

export const AUTH_STATUSES = ["pending", "approved", "rejected", "cancelled", "used"] as const;
export type AuthStatus = (typeof AUTH_STATUSES)[number];
export const AUTH_STATUS_LABELS: Record<AuthStatus, string> = {
  pending: "Pendiente",
  approved: "Autorizada",
  rejected: "Denegada",
  cancelled: "Retirada",
  used: "Aplicada",
};

/** Una autorización aprobada vale para su operación durante este tiempo; después hay que pedir otra. */
export const AUTH_VALIDITY_MS = 4 * 60 * 60 * 1000;

export interface AuthRule {
  kind: AuthKind;
  enabled: boolean;
  /** Porcentaje o euros según la operación; null = siempre (si está activa). */
  threshold: number | null;
}

/** ¿La operación necesita autorización según la regla de la empresa? Sin regla activa, nunca. */
export function authorizationRequired(rule: AuthRule | null | undefined, amount: number | null | undefined): boolean {
  if (!rule || !rule.enabled) return false;
  if (AUTH_KIND_UNIT[rule.kind] === "none" || rule.threshold === null) return true;
  const a = typeof amount === "number" && Number.isFinite(amount) ? Math.abs(amount) : 0;
  return a > rule.threshold;
}

/** Validación de una regla: umbral en su unidad (porcentaje 0–100; euros ≥ 0). */
export function validateRule(kind: AuthKind, threshold: number | null): string | null {
  const unit = AUTH_KIND_UNIT[kind];
  if (unit === "none") return threshold === null ? null : "Esta operación no tiene umbral: se autoriza siempre que esté activa.";
  if (threshold === null) return null;
  if (!Number.isFinite(threshold) || threshold < 0) return "El umbral no puede ser negativo.";
  if (unit === "percent" && threshold > 100) return "El umbral de un descuento es un porcentaje entre 0 y 100.";
  if (threshold >= 1e7) return "El umbral es demasiado alto.";
  return null;
}

/** Texto de la regla para el panel: «Más de 20 %», «Más de 100,00 €», «Siempre». */
export function ruleSummary(rule: AuthRule): string {
  if (!rule.enabled) return "No se pide autorización";
  const unit = AUTH_KIND_UNIT[rule.kind];
  if (unit === "none" || rule.threshold === null) return "Siempre";
  return unit === "percent" ? `Más de ${rule.threshold} %` : `Más de ${rule.threshold.toFixed(2).replace(".", ",")} €`;
}

/** ¿Sigue valiendo una autorización aprobada? */
export function authorizationUsable(a: { status: string; decidedAt: number | null }, now: number): boolean {
  return a.status === "approved" && a.decidedAt !== null && now - a.decidedAt <= AUTH_VALIDITY_MS;
}

// ─── Auditoría ───────────────────────────────────────────────────────────────

export const AUDIT_TYPES = [
  "session_open",
  "session_close",
  "sale",
  "sale_void",
  "cash_movement",
  "closed_correction",
  "count",
  "shift_start",
  "shift_end",
  "handover_declared",
  "handover_received",
  "handover_cancelled",
  "auth_requested",
  "auth_decided",
  "record_correction",
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  session_open: "Apertura de caja",
  session_close: "Cierre de caja",
  sale: "Venta",
  sale_void: "Anulación o devolución",
  cash_movement: "Movimiento de caja",
  closed_correction: "Corrección de caja cerrada",
  count: "Arqueo",
  shift_start: "Inicio de turno",
  shift_end: "Fin de turno",
  handover_declared: "Entrega de caja declarada",
  handover_received: "Entrega de caja recibida",
  handover_cancelled: "Entrega de caja anulada",
  auth_requested: "Autorización solicitada",
  auth_decided: "Autorización resuelta",
  record_correction: "Corrección de un registro",
};

export interface AuditEvent {
  at: number;
  type: AuditType;
  sessionId: number | null;
  registerId: number | null;
  registerName: string | null;
  actor: string | null;
  amount: number | null;
  detail: string;
  /** Clave estable del evento (tipo + id de origen) para ordenar y deduplicar. */
  ref: string;
}

/** Orden cronológico descendente estable (más reciente primero; empate por referencia). */
export function sortAudit(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((a, b) => b.at - a.at || (a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0));
}

/** Filtro del registro (tipos, caja, texto del operador). */
export function filterAudit(events: AuditEvent[], f: { types?: readonly AuditType[]; registerId?: number | null; actor?: string | null }): AuditEvent[] {
  const types = f.types && f.types.length ? new Set(f.types) : null;
  const actor = f.actor?.trim().toLowerCase() || null;
  return events.filter((e) => (!types || types.has(e.type)) && (!f.registerId || e.registerId === f.registerId) && (!actor || (e.actor ?? "").toLowerCase().includes(actor)));
}

/** Rango de días (YYYY-MM-DD) válido y acotado (las consultas no recorren años). */
export const ADV_MAX_RANGE_DAYS = 92;
export function validateDayRange(from: string, to: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return "Fecha no válida";
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "Fecha no válida";
  if (b < a) return "La fecha final es anterior a la inicial";
  if ((b - a) / 86_400_000 + 1 > ADV_MAX_RANGE_DAYS) return `Elige un periodo de ${ADV_MAX_RANGE_DAYS} días como máximo`;
  return null;
}

export const ADV_REPORT_SECTIONS = ["turnos", "operadores", "arqueos", "entregas", "autorizaciones", "auditoria"] as const;
export type AdvReportSection = (typeof ADV_REPORT_SECTIONS)[number];
export const ADV_REPORT_SECTION_LABELS: Record<AdvReportSection, string> = {
  turnos: "Por turno",
  operadores: "Por operador",
  arqueos: "Por arqueo",
  entregas: "Entregas de caja",
  autorizaciones: "Autorizaciones",
  auditoria: "Auditoría de operaciones",
};
