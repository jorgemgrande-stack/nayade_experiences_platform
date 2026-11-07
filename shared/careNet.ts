/**
 * Care Net · bonos y paquetes de sesiones y reservas de SPA — lógica pura compartida por el servidor
 * (server/careNetDb.ts) y el panel (client/src/pages/admin/careNet/). Sin base de datos ni React.
 *
 * Reglas de un bono vendido:
 *  - Solo se usa cobrado (venta del TPV del Core) y antes de caducar (compra + días de validez).
 *  - Vale para los tratamientos o categorías de su definición (sin ninguno, para todos).
 *  - Cada sesión consumida resta una; anular el consumo la devuelve. Nunca se consumen más de las compradas.
 *  - Para elegir automáticamente: el bono válido que caduca antes (para no perder sesiones).
 */

export const CARE_NET_CAPABILITY = "care-net";
export const DAY_MS = 86_400_000;

export interface PackScope {
  treatmentIds: number[];
  categoryIds: number[];
}

/** ¿Vale el bono para ese tratamiento? Sin tratamientos ni categorías, vale para todos. */
export function packAppliesTo(scope: PackScope, treatment: { id: number; categoryId: number | null }): boolean {
  if (!scope.treatmentIds.length && !scope.categoryIds.length) return true;
  if (scope.treatmentIds.includes(treatment.id)) return true;
  return treatment.categoryId != null && scope.categoryIds.includes(treatment.categoryId);
}

export interface PackInput {
  name: string;
  sessions: number;
  validityDays: number;
  price: number;
}

export function packProblem(p: PackInput): string | null {
  if (!p.name.trim()) return "Indica el nombre del bono.";
  if (!Number.isInteger(p.sessions) || p.sessions < 1 || p.sessions > 200) return "Las sesiones deben ser entre 1 y 200.";
  if (!Number.isInteger(p.validityDays) || p.validityDays < 1 || p.validityDays > 1830) return "La caducidad debe ser entre 1 y 1.830 días.";
  if (!Number.isFinite(p.price) || p.price < 0.01 || p.price > 10000) return "El precio debe ser entre 0,01 y 10.000 €.";
  return null;
}

export const expiresAtOf = (purchasedAt: number, validityDays: number): number => purchasedAt + validityDays * DAY_MS;

export type PurchaseState = "pending" | "active" | "exhausted" | "expired" | "cancelled";
export const PURCHASE_STATE_LABELS: Record<PurchaseState, string> = {
  pending: "Pendiente de cobro",
  active: "Activo",
  exhausted: "Agotado",
  expired: "Caducado",
  cancelled: "Anulado",
};

export interface PurchaseLike {
  status: string;
  sessionsTotal: number;
  sessionsUsed: number;
  expiresAt: number | null;
}

/** Estado efectivo de un bono vendido (la caducidad y el agotamiento se calculan, no se guardan). */
export function purchaseState(p: PurchaseLike, now: number): PurchaseState {
  if (p.status === "cancelled") return "cancelled";
  if (p.status !== "active") return "pending";
  if (p.sessionsUsed >= p.sessionsTotal) return "exhausted";
  if (p.expiresAt != null && p.expiresAt <= now) return "expired";
  return "active";
}

export const remainingOf = (p: PurchaseLike): number => Math.max(0, p.sessionsTotal - p.sessionsUsed);

/** Motivo por el que no se puede consumir una sesión de ese bono para ese tratamiento (null = se puede). */
export function consumeProblem(p: PurchaseLike & PackScope, treatment: { id: number; categoryId: number | null }, now: number): string | null {
  const st = purchaseState(p, now);
  if (st === "pending") return "El bono aún no está cobrado.";
  if (st === "cancelled") return "El bono está anulado.";
  if (st === "exhausted") return "El bono no tiene sesiones disponibles.";
  if (st === "expired") return "El bono ha caducado.";
  if (!packAppliesTo(p, treatment)) return "El bono no vale para este tratamiento.";
  return null;
}

/** Bono que se usa si no se elige uno: el válido para el tratamiento que caduca antes. */
export function pickPurchase<T extends PurchaseLike & PackScope & { id: number }>(list: readonly T[], treatment: { id: number; categoryId: number | null }, now: number): T | null {
  const ok = list.filter((p) => consumeProblem(p, treatment, now) == null);
  ok.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.id - b.id);
  return ok[0] ?? null;
}

/** Clave de idempotencia del cobro de un bono en el TPV (formato de tpvSaleIdempotency: 8–64, [A-Za-z0-9_-]). */
export const packSaleKey = (purchaseId: number): string => `care-pack-${purchaseId}`;

export const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

// ─── Reservas de SPA ─────────────────────────────────────────────────────────

export type SpaBookingState = "pendiente" | "confirmada" | "anulada" | "conflicto";
export const SPA_BOOKING_STATE_LABELS: Record<SpaBookingState, string> = {
  pendiente: "Pendiente de pago",
  confirmada: "Confirmada",
  anulada: "Anulada o liberada",
  conflicto: "Pagada sin plaza",
};

/** Estado legible de una reserva de SPA del Core según su pago y su retención de plaza. */
export function spaBookingState(r: { status: string; holdStatus: string | null; statusReservation?: string | null }): SpaBookingState {
  if (r.holdStatus === "conflicto") return "conflicto";
  if (r.status === "cancelled" || r.status === "failed" || r.holdStatus === "liberada" || r.statusReservation === "ANULADA") return "anulada";
  if (r.status === "paid" || r.holdStatus === "confirmada") return "confirmada";
  return "pendiente";
}

/** Días AAAA-MM-DD de [from, to] (máximo 62). */
export function daysBetween(from: string, to: string): string[] {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b && out.length < 62; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const formatEur = (n: number | string | null | undefined): string =>
  (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export function madridToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}
