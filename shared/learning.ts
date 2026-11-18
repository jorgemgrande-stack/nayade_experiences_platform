/**
 * Elephant LMS: reglas puras (sin servidor ni navegador) de matrículas, vigencias y autorización de contenido.
 *
 * Principios:
 *  - La autorización la da la MATRÍCULA nominativa, nunca un enlace. Sin matrícula activa, en ventana y con el módulo
 *    concedido, no hay acceso.
 *  - La vigencia se comprueba AL LEER (`now` entre `startsAt` y `endsAt`): la tarea de caducidad solo cambia el estado.
 *  - Una matrícula solo nace de un PAGO CONFIRMADO (con referencia), de una CONCESIÓN administrativa con motivo o de una
 *    DEMOSTRACIÓN. Solicitud, presupuesto, justificante sin verificar, checkout iniciado o pago pendiente no bastan.
 */

export const ENROLLMENT_STATUSES = ["active", "suspended", "revoked", "expired"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_SOURCES = ["payment", "admin", "demo"] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];
export const START_MODES = ["on_grant", "fixed_date"] as const;
export type StartMode = (typeof START_MODES)[number];

export const DAY_MS = 86_400_000;
/** Duración del acceso de demostración. */
export const DEMO_MINUTES = 60;
export const DEMO_MS = DEMO_MINUTES * 60_000;

export interface AccessRule {
  id: number;
  experienceId: number;
  /** null = cualquier variante del producto */
  variantId: number | null;
  courseId: number;
  moduleIds: number[];
  /** null = sin caducidad */
  durationDays: number | null;
  startMode: StartMode;
  fixedStart: number | null;
  active: boolean;
}

/** Reglas activas que aplican a una compra: la de la variante exacta o, si no hay, las genéricas del producto. */
export function matchRules(rules: AccessRule[], experienceId: number, variantId: number | null): AccessRule[] {
  const own = rules.filter((r) => r.active && r.experienceId === experienceId);
  const exact = own.filter((r) => variantId != null && r.variantId === variantId);
  return exact.length ? exact : own.filter((r) => r.variantId == null);
}

/** Ventana de la matrícula: inicio (ahora o fecha fija) y fin (inicio + duración, o sin límite). */
export function computeWindow(p: { startMode: StartMode; fixedStart: number | null; durationDays: number | null; grantedAt: number }): { startsAt: number; endsAt: number | null } {
  const startsAt = p.startMode === "fixed_date" && p.fixedStart != null ? p.fixedStart : p.grantedAt;
  const endsAt = p.durationDays == null ? null : startsAt + Math.round(p.durationDays) * DAY_MS;
  return { startsAt, endsAt };
}

export interface EnrollmentView {
  status: EnrollmentStatus;
  startsAt: number;
  endsAt: number | null;
  moduleIds: number[];
}

export type AccessDecision = { allowed: true } | { allowed: false; reason: "no_enrollment" | "inactive" | "not_started" | "expired" | "module_not_granted" };

/** ¿Abre esta matrícula este módulo ahora? */
export function evaluateAccess(e: EnrollmentView | null | undefined, moduleId: number, now: number): AccessDecision {
  if (!e) return { allowed: false, reason: "no_enrollment" };
  if (e.status !== "active") return { allowed: false, reason: "inactive" };
  if (now < e.startsAt) return { allowed: false, reason: "not_started" };
  if (e.endsAt != null && now >= e.endsAt) return { allowed: false, reason: "expired" };
  if (!e.moduleIds.includes(moduleId)) return { allowed: false, reason: "module_not_granted" };
  return { allowed: true };
}

/** La mejor decisión entre varias matrículas del mismo usuario (basta una que abra el módulo). */
export function evaluateAny(list: EnrollmentView[], moduleId: number, now: number): AccessDecision {
  let last: AccessDecision = { allowed: false, reason: "no_enrollment" };
  for (const e of list) {
    const d = evaluateAccess(e, moduleId, now);
    if (d.allowed) return d;
    last = d;
  }
  return last;
}

/** Estado derivado para mostrar: una matrícula «active» fuera de ventana se enseña como caducada o futura. */
export function effectiveStatus(e: Pick<EnrollmentView, "status" | "startsAt" | "endsAt">, now: number): EnrollmentStatus | "scheduled" {
  if (e.status !== "active") return e.status;
  if (now < e.startsAt) return "scheduled";
  if (e.endsAt != null && now >= e.endsAt) return "expired";
  return "active";
}

export interface PaymentEvidence {
  /** Referencia del pago verificado (id de pago, número de operación, referencia bancaria conciliada) */
  reference: string;
  amountCents: number;
  /** Quién lo verificó (persona del equipo o sistema autenticado) */
  verifiedBy: string;
}

export class LearningRuleError extends Error {
  constructor(readonly code: "PAYMENT_NOT_CONFIRMED" | "REASON_REQUIRED" | "BAD_REQUEST", message: string) {
    super(message);
  }
}

/** Un pago cuenta solo con referencia, importe positivo y quién lo verificó. */
export function assertPaymentConfirmed(p: Partial<PaymentEvidence> | null | undefined): PaymentEvidence {
  const reference = (p?.reference ?? "").trim();
  const verifiedBy = (p?.verifiedBy ?? "").trim();
  if (!reference || !verifiedBy || !Number.isFinite(p?.amountCents) || (p?.amountCents ?? 0) <= 0) {
    throw new LearningRuleError("PAYMENT_NOT_CONFIRMED", "No se concede acceso sin un pago confirmado: hace falta la referencia, el importe y quién lo verificó.");
  }
  return { reference: reference.slice(0, 190), amountCents: Math.round(p!.amountCents!), verifiedBy: verifiedBy.slice(0, 120) };
}

export function assertReason(reason: string | null | undefined, min = 8): string {
  const r = (reason ?? "").replace(/\s+/g, " ").trim();
  if (r.length < min) throw new LearningRuleError("REASON_REQUIRED", "Indica el motivo (mínimo " + min + " caracteres).");
  return r.slice(0, 500);
}

/** Clave de idempotencia de una matrícula de pago: la misma compra y la misma regla nunca crean dos. */
export function paymentKey(p: { operationKind: string; operationId: number | string; ruleId: number; userId: number }): string {
  return `pay:${p.operationKind}:${p.operationId}:r${p.ruleId}:u${p.userId}`;
}
export const adminKey = (p: { userId: number; courseId: number; nonce: string }) => `adm:u${p.userId}:c${p.courseId}:${p.nonce}`;
export const demoKey = (p: { userId: number; courseId: number; trigger: string }) => `demo:u${p.userId}:c${p.courseId}:${p.trigger}`;

/** Porcentaje completado (0-100) de un conjunto de lecciones. */
export function progressPercent(totalLessons: number, completedLessons: number): number {
  if (totalLessons <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completedLessons / totalLessons) * 100)));
}

/** Matrícula nueva sobre las anteriores de la misma persona y curso: amplía módulos y vigencia, no duplica. */
export function mergeModules(current: number[], added: number[]): number[] {
  return Array.from(new Set([...current, ...added])).sort((a, b) => a - b);
}
