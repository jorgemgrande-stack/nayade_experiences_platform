/**
 * Política de consumo por plan y por empresa: límite EFECTIVO de cada métrica y su desglose explicable.
 *
 *   límite efectivo = excepción comercial vigente
 *                   | si no, ajuste propio del operador (tenant_quotas, solo métricas del Resource Manager)
 *                   | si no, contractual = incluido en el plan + ampliaciones contratadas
 *                   | si no, valor de la fase comercial (prueba gratuita: `TRIAL_QUOTA_POLICY`)
 *                   | si no (nada de lo anterior), valor por defecto de la plataforma.
 *
 *  - «Contractual» es lo que el plano de control escribe al aplicar las licencias (registro 0013: plan + ampliaciones)
 *    o, si no hay fila, lo incluido en el plan según el catálogo oficial.
 *  - La excepción se resuelve POR FECHA en cada lectura: al caducar, el límite vuelve solo al contractual.
 *  - Cada política tiene umbral de aviso, umbral crítico y límite máximo (el efectivo).
 *  - Funciones puras: sin E/S ni reloj propio (la hora llega como argumento).
 */
import type { QuotaPeriod } from "./types";

export type PolicyPeriod = "total" | QuotaPeriod;
export type PolicySource = "exception" | "override" | "plan" | "addon" | "trial" | "default";
/** `hard`: se rechaza al superarlo. `soft`: se permite y se avisa. `none`: se informa, no se aplica todavía. */
export type PolicyEnforcement = "hard" | "soft" | "none";

export const POLICY_WARNING_RATIO = 0.8;
export const POLICY_CRITICAL_RATIO = 0.95;

export interface MetricPolicy {
  metric: string;
  label: string;
  unit: string;
  period: PolicyPeriod;
  enforcement: PolicyEnforcement;
  /** Valor por defecto de plataforma (solo si no hay plan, ampliación ni excepción). null = sin tope. */
  platformDefault: number | null;
  /** Dónde se aplica (o por qué no): se muestra en el CRM. */
  applied: string;
}

/**
 * Cuotas de negocio del catálogo (planes Core y módulos). «Productos» no figura: el catálogo v1 no declara cuota de
 * productos para ningún plan, así que no hay límite que aplicar. Los valores por defecto nunca son más estrictos que lo que
 * ya se aplicaba: usuarios, contactos y almacenamiento sin tope sin plan (como hasta ahora); sedes y entidades
 * fiscales, 1 (el mínimo que ya aplicaba el plano de control sin suscripción).
 */
export const BUSINESS_POLICIES: readonly MetricPolicy[] = [
  { metric: "users", label: "Usuarios", unit: "usuarios", period: "total", enforcement: "hard", platformDefault: null, applied: "Core: alta, invitación y reactivación de usuarios del panel" },
  { metric: "sites", label: "Sedes", unit: "sedes", period: "total", enforcement: "hard", platformDefault: 1, applied: "Plano de control: alta de sedes" },
  { metric: "fiscal_entities", label: "Entidades fiscales", unit: "entidades", period: "total", enforcement: "hard", platformDefault: 1, applied: "Plano de control: alta de entidades fiscales" },
  { metric: "storage_gb", label: "Almacenamiento", unit: "GB", period: "total", enforcement: "hard", platformDefault: null, applied: "Core: subida de ficheros" },
  {
    metric: "contacts",
    label: "Contactos",
    unit: "contactos",
    period: "total",
    enforcement: "hard",
    platformDefault: null,
    applied: "Core: alta manual de clientes en el CRM. Los que llegan por reservas, compras, cupones o formularios nunca se bloquean",
  },
  {
    metric: "orders_month",
    label: "Pedidos al mes",
    unit: "pedidos",
    period: "total",
    enforcement: "none",
    platformDefault: null,
    applied: "Sin aplicar: cortar un pedido perjudica al cliente y los pedidos entran por varios canales de cobro (Redsys, Stripe, TPV, taquilla). Solo se informa",
  },
  { metric: "websites", label: "Webs gestionadas", unit: "webs", period: "total", enforcement: "none", platformDefault: null, applied: "Sin aplicar: las webs las da de alta el equipo al implantar" },
  {
    metric: "rooms",
    label: "Habitaciones",
    unit: "habitaciones",
    period: "total",
    enforcement: "none",
    platformDefault: null,
    applied: "Sin aplicar: la cuota es del módulo Hotel Net · PMS y la composición de los paquetes que lo incluyen no está aprobada",
  },
];

export const BUSINESS_METRICS = BUSINESS_POLICIES.map((p) => p.metric);
export const policyOf = (metric: string): MetricPolicy | undefined => BUSINESS_POLICIES.find((p) => p.metric === metric);

export interface QuotaException {
  id: number;
  tenantId: string;
  metric: string;
  period: PolicyPeriod;
  /** Límite que había al concederla (informativo). null = sin tope. */
  originalLimit: number | null;
  /** Límite durante la excepción. null = sin tope. */
  newLimit: number | null;
  reason: string;
  operator: string;
  startsAt: number;
  expiresAt: number;
  status: "active" | "revoked";
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ExceptionState = "scheduled" | "active" | "expired" | "revoked";

export function exceptionState(e: Pick<QuotaException, "status" | "startsAt" | "expiresAt">, now: number): ExceptionState {
  if (e.status === "revoked") return "revoked";
  if (now >= e.expiresAt) return "expired";
  if (now < e.startsAt) return "scheduled";
  return "active";
}

/** Excepción vigente para la métrica y el periodo (la más reciente si hubiera varias). */
export function activeException(list: readonly QuotaException[], metric: string, period: PolicyPeriod, now: number): QuotaException | null {
  let best: QuotaException | null = null;
  for (const e of list) {
    if (e.metric !== metric || e.period !== period || exceptionState(e, now) !== "active") continue;
    if (!best || e.createdAt > best.createdAt || (e.createdAt === best.createdAt && e.id > best.id)) best = e;
  }
  return best;
}

export interface PolicyInput {
  metric: string;
  period: PolicyPeriod;
  /** Plan contratado (clave del catálogo) o null si la empresa no tiene plan conocido. */
  planKey: string | null;
  /** Incluido en el plan: número, null (sin tope, por contrato) o undefined (el plan no define la métrica). */
  planIncluded: number | null | undefined;
  /** Límite contractual ya calculado por las licencias (registro 0013: plan + ampliaciones). undefined = sin fila. */
  contracted?: number | null;
  /** Unidades de ampliación contratadas (cuando no hay `contracted`). */
  addonUnits?: number;
  /** Ajuste propio del operador (tenant_quotas). */
  override?: number;
  exceptions?: readonly QuotaException[];
  /** Valor de la fase comercial (prueba gratuita). undefined = la empresa no está en una fase con política propia. */
  phaseDefault?: number;
  platformDefault: number | null | undefined;
  enforcement: PolicyEnforcement;
  now: number;
}

export interface EffectiveLimit {
  metric: string;
  period: PolicyPeriod;
  /** Límite máximo efectivo. null = sin tope. */
  limit: number | null;
  source: PolicySource;
  enforcement: PolicyEnforcement;
  /** Límite contractual (plan + ampliaciones); undefined = no hay contrato que lo fije. */
  contractual: number | null | undefined;
  breakdown: {
    plan: { key: string | null; included: number | null } | null;
    addon: number | null;
    override: number | null;
    /** Límite de la prueba gratuita (si la empresa está en prueba). */
    trial: number | null;
    exception: { id: number; newLimit: number | null; originalLimit: number | null; reason: string; operator: string; startsAt: number; expiresAt: number } | null;
    default: number | null;
  };
  thresholds: { warning: number | null; critical: number | null; max: number | null };
}

const thresholdsOf = (limit: number | null) =>
  limit === null ? { warning: null, critical: null, max: null } : { warning: Math.floor(limit * POLICY_WARNING_RATIO), critical: Math.floor(limit * POLICY_CRITICAL_RATIO), max: limit };

export function resolveEffectiveLimit(i: PolicyInput): EffectiveLimit {
  const addonFromContract = i.contracted !== undefined && i.contracted !== null && typeof i.planIncluded === "number" ? Math.max(0, i.contracted - i.planIncluded) : null;
  let contractual: number | null | undefined;
  let addon: number | null = null;
  if (i.contracted !== undefined) {
    contractual = i.contracted;
    addon = addonFromContract;
  } else if (i.planIncluded !== undefined) {
    contractual = i.planIncluded === null ? null : i.planIncluded + Math.max(0, i.addonUnits ?? 0);
    addon = i.planIncluded === null ? null : Math.max(0, i.addonUnits ?? 0);
  }
  const plan = i.planIncluded !== undefined ? { key: i.planKey, included: i.planIncluded } : null;
  const exc = activeException(i.exceptions ?? [], i.metric, i.period, i.now);
  const def = i.platformDefault === undefined ? null : i.platformDefault;
  let limit: number | null;
  let source: PolicySource;
  if (exc) {
    limit = exc.newLimit;
    source = "exception";
  } else if (i.override !== undefined) {
    limit = i.override;
    source = "override";
  } else if (contractual !== undefined) {
    limit = contractual;
    source = addon ? "addon" : "plan";
  } else if (i.phaseDefault !== undefined) {
    limit = i.phaseDefault;
    source = "trial";
  } else {
    limit = def;
    source = "default";
  }
  return {
    metric: i.metric,
    period: i.period,
    limit,
    source,
    enforcement: i.enforcement,
    contractual,
    breakdown: {
      plan,
      addon,
      override: i.override ?? null,
      trial: i.phaseDefault ?? null,
      exception: exc ? { id: exc.id, newLimit: exc.newLimit, originalLimit: exc.originalLimit, reason: exc.reason, operator: exc.operator, startsAt: exc.startsAt, expiresAt: exc.expiresAt } : null,
      default: def,
    },
    thresholds: thresholdsOf(limit),
  };
}

export type QuotaVerdict = { allowed: true; level: "ok" | "warning" | "critical" | "soft_exceeded" } | { allowed: false; level: "exceeded" };

/** ¿Cabe `adding` más con `used` ya consumido? El aviso y el crítico nunca bloquean. */
export function quotaVerdict(eff: Pick<EffectiveLimit, "limit" | "enforcement" | "thresholds">, used: number, adding = 1): QuotaVerdict {
  if (eff.limit === null) return { allowed: true, level: "ok" };
  const after = used + adding;
  if (after > eff.limit) return eff.enforcement === "hard" ? { allowed: false, level: "exceeded" } : { allowed: true, level: "soft_exceeded" };
  if (eff.thresholds.critical !== null && after >= eff.thresholds.critical) return { allowed: true, level: "critical" };
  if (eff.thresholds.warning !== null && after >= eff.thresholds.warning) return { allowed: true, level: "warning" };
  return { allowed: true, level: "ok" };
}

const SOURCE_LABEL: Record<PolicySource, string> = { exception: "excepción comercial", override: "ajuste del operador", plan: "plan", addon: "plan + ampliaciones", trial: "prueba gratuita", default: "valor por defecto de la plataforma" };

/** Explicación legible del límite (para el CRM y los registros). */
export function explainLimit(eff: EffectiveLimit, fmt: (n: number) => string = (n) => n.toLocaleString("es-ES")): string {
  const v = (n: number | null) => (n === null ? "sin tope" : fmt(n));
  const parts: string[] = [];
  if (eff.breakdown.plan) parts.push(`Plan ${eff.breakdown.plan.key ?? "?"}: ${v(eff.breakdown.plan.included)}`);
  if (eff.breakdown.addon) parts.push(`ampliaciones: +${fmt(eff.breakdown.addon)}`);
  if (eff.breakdown.override !== null) parts.push(`ajuste del operador: ${fmt(eff.breakdown.override)}`);
  if (eff.breakdown.exception) parts.push(`excepción hasta ${new Date(eff.breakdown.exception.expiresAt).toISOString().slice(0, 10)}: ${v(eff.breakdown.exception.newLimit)}`);
  if (eff.source === "trial") parts.push(`prueba gratuita: ${v(eff.breakdown.trial)} (fuera de la prueba: ${v(eff.breakdown.default)})`);
  if (eff.source === "default") parts.push(`por defecto: ${v(eff.breakdown.default)}`);
  return `${v(eff.limit)} (${SOURCE_LABEL[eff.source]})${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}
