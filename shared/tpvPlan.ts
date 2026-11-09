/**
 * Caja (TPV) por plan: qué incluye Essential, Business y Enterprise y qué añade TPV Advanced (capacidad
 * `pos-advanced`). Estrategia aprobada por Jorge el 09/11/2026. Lo comparten el servidor (que es quien decide) y el
 * panel (que solo lo explica).
 *
 * - `full`: sin plan que aplicar (instalación única de Náyade o empresa sin licencia base): todo, sin límite de cajas.
 * - El límite de cajas solo impide crear o activar cajas NUEVAS por encima del máximo: las que una empresa ya tenga
 *   activas se conservan y siguen funcionando aunque lo superen (decisión de Jorge del 09/11/2026).
 */

export type TpvTier = "essential" | "business" | "enterprise" | "full";

export const TPV_FEATURES = [
  "registerOperators",
  "authorizedReturns",
  "closureSupervision",
  "detailedReports",
  "cashDifferences",
  "multiSite",
  "centralSupervision",
  "consolidatedReports",
  "advancedPermissions",
] as const;
export type TpvFeature = (typeof TPV_FEATURES)[number];

/**
 * Tope técnico de Enterprise («sin límite comercial fijo, con control de recursos y uso razonable»): por encima, la
 * empresa lo pide y se amplía; protege los recursos compartidos, no es un límite comercial.
 */
export const ENTERPRISE_REGISTER_RESOURCE_CAP = 50;

export interface TpvPlanInfo {
  tier: TpvTier;
  /** Cajas activas que permite el plan; null = sin límite. */
  maxActiveRegisters: number | null;
  features: Record<TpvFeature, boolean>;
}

const BUSINESS_FEATURES: TpvFeature[] = ["registerOperators", "authorizedReturns", "closureSupervision", "detailedReports", "cashDifferences"];
const ENTERPRISE_FEATURES: TpvFeature[] = [...BUSINESS_FEATURES, "multiSite", "centralSupervision", "consolidatedReports", "advancedPermissions"];

export function tpvPlanInfo(tier: TpvTier): TpvPlanInfo {
  const on = new Set<TpvFeature>(tier === "essential" ? [] : tier === "business" ? BUSINESS_FEATURES : ENTERPRISE_FEATURES);
  const features = Object.fromEntries(TPV_FEATURES.map((f) => [f, on.has(f)])) as Record<TpvFeature, boolean>;
  const maxActiveRegisters = tier === "essential" ? 1 : tier === "business" ? 3 : tier === "enterprise" ? ENTERPRISE_REGISTER_RESOURCE_CAP : null;
  return { tier, maxActiveRegisters, features };
}

/** Plan del que forma parte cada función (para explicar dónde está y ofrecer la ampliación). */
export function tierForFeature(f: TpvFeature): "business" | "enterprise" {
  return BUSINESS_FEATURES.includes(f) ? "business" : "enterprise";
}

export const TPV_TIER_NAMES: Record<Exclude<TpvTier, "full">, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

/** Nombre comprensible de cada función (panel y mensajes del servidor). */
export const TPV_FEATURE_LABELS: Record<TpvFeature, string> = {
  registerOperators: "Operadores y permisos por caja",
  authorizedReturns: "Devoluciones y anulaciones autorizadas",
  closureSupervision: "Supervisión de cierres",
  detailedReports: "Informes por caja, por empleado y por periodo",
  cashDifferences: "Gestión de diferencias de caja",
  multiSite: "Cajas en varios establecimientos",
  centralSupervision: "Supervisión centralizada",
  consolidatedReports: "Informes consolidados",
  advancedPermissions: "Gestión avanzada de permisos",
};

/** Funciones de TPV Advanced (Elephant Connect, capacidad pos-advanced), sobre la caja del plan. */
export const TPV_ADVANCED_CAPABILITY = "pos-advanced";
export const TPV_ADVANCED_LABELS = [
  "Arqueos y conciliaciones avanzadas",
  "Control de turnos",
  "Entrega y recepción de caja entre operadores",
  "Autorizaciones especiales",
  "Auditoría de operaciones",
  "Informes y exportaciones avanzadas",
] as const;

/** Mensaje de una función que el plan no incluye: qué es y cómo tenerla, sin bloquear nada más. */
export function featureNotIncludedMessage(f: TpvFeature): string {
  return `${TPV_FEATURE_LABELS[f]} forma parte del plan ${TPV_TIER_NAMES[tierForFeature(f)]}. Puedes ampliar tu plan desde «Suscripción».`;
}

/** ¿Se puede crear o activar una caja más? Las ya activas nunca se tocan. */
export function registerLimitDecision(info: Pick<TpvPlanInfo, "tier" | "maxActiveRegisters">, activeNow: number, adding = 1): { allowed: true } | { allowed: false; reason: string } {
  if (info.maxActiveRegisters === null) return { allowed: true };
  if (activeNow + adding <= info.maxActiveRegisters) return { allowed: true };
  if (info.tier === "enterprise") {
    return { allowed: false, reason: `Tienes ${activeNow} cajas activas, el máximo de uso razonable de Enterprise. Escríbenos y lo ampliamos para tu empresa.` };
  }
  const n = info.maxActiveRegisters;
  const name = TPV_TIER_NAMES[info.tier as "essential" | "business"];
  const next = info.tier === "essential" ? "Business (hasta 3 cajas) o Enterprise" : "Enterprise";
  return {
    allowed: false,
    reason: `Tu plan ${name} incluye ${n === 1 ? "una caja activa" : `${n} cajas activas`} y ya tienes ${activeNow}. Desactiva una caja o amplía a ${next} para añadir más. Tus cajas actuales siguen funcionando.`,
  };
}

// ─── Hora de corte operativo ──────────────────────────────────────────────────

export const CUTOFF_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_CUTOFF = "00:00";

/**
 * Día operativo (YYYY-MM-DD) de un instante, con la hora de corte `cutoff` (HH:MM) en la zona `timeZone`: lo que pasa
 * antes del corte cuenta para el día anterior. Con 00:00 es la fecha de calendario de la zona.
 */
export function operationalDay(ms: number, cutoff: string, timeZone: string): string {
  const c = CUTOFF_RE.test(cutoff) ? cutoff : DEFAULT_CUTOFF;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  if (`${p.hour}:${p.minute}` >= c) return day;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Zona horaria válida para Intl; si no, la de la empresa por defecto. */
export function safeTimeZone(tz: string | null | undefined, fallback = "Europe/Madrid"): string {
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}
