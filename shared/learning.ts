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
  /** true = la regla declara de forma EXPRESA acceso sin caducidad para los módulos sin duración (por defecto false). */
  permanent?: boolean;
  /** Calendario por módulo: desbloqueo progresivo y duración propia. Sin entrada = desde el primer día y duración de la regla. */
  moduleSchedule?: Record<number, ModuleSchedule>;
}

export interface ModuleSchedule {
  /** Días desde la concesión en que se desbloquea el módulo. null/0 = desde el primer día. */
  unlockOffsetDays: number | null;
  /** Días de acceso desde el desbloqueo. null = hereda `durationDays` de la regla. */
  durationDays: number | null;
}

/** Ventana propia de un módulo en una matrícula (ms epoch). null en un extremo = hereda el de la matrícula. */
export interface ModuleWindow {
  startsAt: number | null;
  endsAt: number | null;
}

/** Duración efectiva de un módulo en la regla: la propia o, si no consta, la de la regla. null = sin duración definida. */
export function effectiveModuleDuration(rule: Pick<AccessRule, "durationDays" | "moduleSchedule">, moduleId: number): number | null {
  const own = rule.moduleSchedule?.[moduleId]?.durationDays;
  return own != null ? own : rule.durationDays;
}

/** Módulos de una regla que quedarían sin ninguna duración (ni propia ni heredada). */
export function modulesWithoutDuration(rule: Pick<AccessRule, "durationDays" | "moduleSchedule" | "moduleIds">): number[] {
  return rule.moduleIds.filter((m) => effectiveModuleDuration(rule, m) == null);
}

/**
 * Ventanas propias por módulo al conceder según una regla. Sin desbloqueo diferido ni duración propia el módulo no lleva ventana
 * (hereda la de la matrícula: comportamiento de siempre). La duración cuenta desde el desbloqueo del módulo.
 * También devuelve el fin de la matrícula: el mayor de los fines de módulo, o null si algún módulo no caduca.
 */
export function computeModuleWindows(rule: Pick<AccessRule, "durationDays" | "moduleSchedule" | "moduleIds">, base: { startsAt: number; endsAt: number | null }): { windows: Record<number, ModuleWindow>; enrollmentEndsAt: number | null } {
  const all: Record<number, ModuleWindow> = {};
  const ends: Array<number | null> = [];
  let custom = false;
  for (const m of rule.moduleIds) {
    const s = rule.moduleSchedule?.[m];
    const offset = s?.unlockOffsetDays && s.unlockOffsetDays > 0 ? s.unlockOffsetDays : 0;
    const own = s?.durationDays ?? null;
    if (offset === 0 && own == null) {
      all[m] = { startsAt: null, endsAt: base.endsAt };
      ends.push(base.endsAt);
      continue;
    }
    custom = true;
    const start = base.startsAt + offset * DAY_MS;
    const dur = own ?? rule.durationDays;
    const end = dur == null ? null : start + Math.round(dur) * DAY_MS;
    all[m] = { startsAt: offset > 0 ? start : null, endsAt: end };
    ends.push(end);
  }
  if (!custom) return { windows: {}, enrollmentEndsAt: base.endsAt };
  const unlimited = ends.some((e) => e == null);
  return { windows: all, enrollmentEndsAt: unlimited ? null : Math.max(...(ends as number[])) };
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
  /** Ventanas propias por módulo (opcional). Sin entrada, el módulo hereda la ventana de la matrícula. */
  moduleWindows?: Record<number, ModuleWindow>;
  /** Matrícula técnica de validación (ver `isTechnicalGrant`). */
  technical?: boolean;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "no_enrollment" | "inactive" | "not_started" | "expired" | "module_not_granted"; unlocksAt?: number };

/** Ventana efectiva de un módulo: la propia o, en cada extremo que no tenga, la de la matrícula. */
export function moduleWindow(e: Pick<EnrollmentView, "startsAt" | "endsAt" | "moduleWindows">, moduleId: number): { startsAt: number; endsAt: number | null } {
  const w = e.moduleWindows?.[moduleId];
  return { startsAt: w?.startsAt ?? e.startsAt, endsAt: w?.endsAt ?? e.endsAt };
}

/** ¿Abre esta matrícula este módulo ahora? Cada módulo incluido se evalúa con su propia ventana (desbloqueo y caducidad). */
export function evaluateAccess(e: EnrollmentView | null | undefined, moduleId: number, now: number): AccessDecision {
  if (!e) return { allowed: false, reason: "no_enrollment" };
  if (e.status !== "active") return { allowed: false, reason: "inactive" };
  if (!e.moduleIds.includes(moduleId)) {
    if (now < e.startsAt) return { allowed: false, reason: "not_started" };
    if (e.endsAt != null && now >= e.endsAt) return { allowed: false, reason: "expired" };
    return { allowed: false, reason: "module_not_granted" };
  }
  if (now < e.startsAt) return { allowed: false, reason: "not_started" };
  const w = moduleWindow(e, moduleId);
  if (now < w.startsAt) return { allowed: false, reason: "not_started", unlocksAt: w.startsAt };
  if (w.endsAt != null && now >= w.endsAt) return { allowed: false, reason: "expired" };
  return { allowed: true };
}

/** Estado de la matrícula para mostrar teniendo en cuenta las ventanas por módulo: activa si algún módulo está abierto. */
export function effectiveEnrollmentStatus(e: EnrollmentView, now: number): EnrollmentStatus | "scheduled" {
  if (e.status !== "active") return e.status;
  if (!e.moduleWindows || !Object.keys(e.moduleWindows).length) return effectiveStatus(e, now);
  const ds = e.moduleIds.map((m) => evaluateAccess(e, m, now));
  if (ds.some((d) => d.allowed)) return "active";
  if (ds.some((d) => !d.allowed && d.reason === "not_started")) return "scheduled";
  return "expired";
}

/** Normaliza las ventanas leídas de la base de datos: solo las que tienen algún extremo propio. */
export function windowsFromRows(list: Array<{ moduleId: number; startsAt: number | null; endsAt: number | null }>): Record<number, ModuleWindow> | undefined {
  const out: Record<number, ModuleWindow> = {};
  for (const r of list) if (r.startsAt != null || r.endsAt != null) out[r.moduleId] = { startsAt: r.startsAt, endsAt: r.endsAt };
  return Object.keys(out).length ? out : undefined;
}

// ─── Ampliación individual por módulo ──────────────────────────────────────────────────────────────────────────────

/** Ampliaciones del catálogo (los precios los fija el catálogo, no este código). */
export const MODULE_EXTENSION_DAYS = [30, 60] as const;

/** Clave de idempotencia de una ampliación: la misma referencia de pedido, módulo y días no se aplica dos veces. */
export const extensionKey = (p: { ref: string; moduleId: number; days: number }) => `ext:${p.ref}:m${p.moduleId}:d${p.days}`;

/** Nuevo fin de una ampliación: desde el mayor entre el fin actual y ahora. */
export function extendedEnd(currentEndsAt: number, now: number, days: number): number {
  return Math.max(currentEndsAt, now) + Math.round(days) * DAY_MS;
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

const KIND_MIME: Record<string, RegExp> = { video: /^video\//, audio: /^(audio\/|video\/(mp4|webm)$)/, pdf: /^application\/pdf$/, document: /^application\//, image: /^image\// };

/** ¿Es este tipo MIME válido para un recurso de este tipo? Un «audio» de Articulate llega como contenedor video/mp4 o video/webm con pista de audio. */
export function mimeMatchesKind(kind: string, mimeType: string): boolean {
  return (KIND_MIME[kind] ?? /^$/).test(mimeType);
}

// ─── Matrícula técnica y estado «interno» del curso ─────────────────────────────────────────────────────────────────
//
// Un curso en BORRADOR no lo ve nadie (ni siquiera con una matrícula de pago): es el estado privado. Para validar el curso
// antes de abrirlo existe la MATRÍCULA TÉCNICA: una concesión administrativa cuyo motivo empieza por el prefijo de prueba.
// Esa matrícula (y solo ella) abre un curso en borrador o publicado; no hace falta migración ni publicar el curso, de modo
// que no hay catálogo, inscripción ni venta posibles. Las matrículas de pago y de demostración siguen necesitando «published».

export const TECHNICAL_PREFIX = "[PRUEBA TÉCNICA]";
/** Duración máxima de una matrícula técnica: caducidad forzosa en un día. */
export const TECHNICAL_MAX_DAYS = 1;

export const isTechnicalGrant = (source: string, reason: string | null | undefined): boolean =>
  source === "admin" && typeof reason === "string" && reason.trimStart().startsWith(TECHNICAL_PREFIX);

export type CourseStatus = "draft" | "published" | "archived";

/** ¿Abre este curso una matrícula (técnica o no)? published: todas; draft: solo las técnicas; archived: ninguna. */
export function courseOpensFor(status: string, technical: boolean): boolean {
  if (status === "published") return true;
  if (status === "draft") return technical;
  return false;
}

/** Motivo de una matrícula técnica: siempre con el prefijo, sin duplicarlo. */
export function technicalReason(note: string | null | undefined): string {
  const body = (note ?? "").replace(TECHNICAL_PREFIX, "").replace(/\s+/g, " ").trim();
  return `${TECHNICAL_PREFIX} ${body || "validación del curso antes de su apertura"}`.slice(0, 500);
}
