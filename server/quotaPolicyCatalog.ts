/**
 * Política de consumo de UNA empresa a partir del catálogo oficial (server/catalog/elephantSourceV1.ts): lo incluido en
 * su plan Core y en sus módulos, las ampliaciones contratadas (registro 0013), los ajustes del operador (tenant_quotas),
 * las excepciones comerciales vigentes (registro 0016) y los valores por defecto de la plataforma.
 *
 * Puro: quien llama aporta las licencias, los límites contratados, las cuotas propias, las excepciones y la hora. Lo usan
 * el plano de control (desglose para el CRM) y el Core (aplicación de las cuotas de negocio).
 */
import { PRODUCTS } from "./catalog/elephantSourceV1";
import type { CapabilityGrant } from "./_core/capabilities/model";
import { BUSINESS_POLICIES, resolveEffectiveLimit, type EffectiveLimit, type MetricPolicy, type QuotaException } from "./_core/erm/policy";
import type { DefaultQuota } from "./_core/erm/quota";
import type { Quota, QuotaPeriod } from "./_core/erm/types";
import { licenceSummary, type CorePlan } from "./planSeats";

const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));

/** Incluido en un plan Core (con herencia): número, null (por contrato) o undefined (el plan no lo define). */
export function planIncluded(planKey: string | null, metric: string): number | null | undefined {
  for (let p = planKey ? byKey.get(planKey) : undefined, g = 0; p && g < 10; p = p.draft.catalog?.inherits ? byKey.get(p.draft.catalog.inherits) : undefined, g++) {
    const q = p.draft.catalog?.quotas?.find((x) => x.metric === metric);
    if (q) return q.included;
  }
  return undefined;
}

const liveGrant = (g: CapabilityGrant, now: number) => g.status !== "cancelled" && g.status !== "contracted" && (g.validUntil === null || g.validUntil > now);

/**
 * Cuotas que aportan los módulos contratados (p. ej. habitaciones de Hotel Net · PMS): un módulo cuenta si la empresa
 * tiene viva alguna de sus capacidades. Varios módulos con la misma métrica suman; uno «por contrato» (null) deja sin tope.
 */
export function moduleIncluded(grants: readonly CapabilityGrant[], metric: string, now: number): { included: number | null; modules: string[] } | undefined {
  const caps = new Set(grants.filter((g) => liveGrant(g, now)).map((g) => g.capabilityId));
  let total: number | null = 0;
  const modules: string[] = [];
  for (const p of PRODUCTS) {
    if (p.family !== "net_module") continue;
    const q = p.draft.catalog?.quotas?.find((x) => x.metric === metric);
    if (!q || !(p.draft.catalog?.capabilities ?? []).some((c) => caps.has(c))) continue;
    modules.push(p.key);
    total = total === null || q.included === null ? null : total + q.included;
  }
  return modules.length ? { included: total, modules } : undefined;
}

export interface TenantPolicyInput {
  grants: readonly CapabilityGrant[] | null;
  /** Límites contratados escritos por las licencias (registro 0013: users, sites, storage_gb). */
  contracted: ReadonlyArray<{ metric: string; limit: number | null }>;
  /** Ajustes del operador (tenant_quotas). */
  overrides: readonly Quota[];
  /** Valores por defecto del Resource Manager. */
  defaults: readonly DefaultQuota[];
  /** Política de la fase comercial (prueba gratuita: `quotaPolicyForPhase`); null o ausente = la de plataforma. */
  phase?: readonly DefaultQuota[] | null;
  exceptions: readonly QuotaException[];
  now: number;
}

export type BusinessLimit = EffectiveLimit & Pick<MetricPolicy, "label" | "unit" | "applied"> & { modules?: string[] };

export interface TenantPolicy {
  plan: CorePlan | null;
  business: BusinessLimit[];
  resources: EffectiveLimit[];
}

/** Límite efectivo de cada cuota de negocio de la empresa (con su desglose). */
export function businessLimit(policy: MetricPolicy, i: Omit<TenantPolicyInput, "overrides" | "defaults">, plan: CorePlan | null): BusinessLimit {
  const fromModules = i.grants ? moduleIncluded(i.grants, policy.metric, i.now) : undefined;
  const planValue = planIncluded(plan, policy.metric);
  const row = i.contracted.find((c) => c.metric === policy.metric);
  const eff = resolveEffectiveLimit({
    metric: policy.metric,
    period: policy.period,
    planKey: planValue !== undefined ? plan : fromModules ? fromModules.modules.join(" + ") : plan,
    planIncluded: planValue !== undefined ? planValue : fromModules?.included,
    // Sin plan, una fila de límites antigua no se interpreta como contrato (como hasta ahora: lo incluido)
    contracted: plan !== null && row ? row.limit : undefined,
    exceptions: i.exceptions,
    platformDefault: policy.platformDefault,
    enforcement: policy.enforcement,
    now: i.now,
  });
  return { ...eff, label: policy.label, unit: policy.unit, applied: policy.applied, ...(fromModules && planValue === undefined ? { modules: fromModules.modules } : {}) };
}

export function tenantPolicy(i: TenantPolicyInput): TenantPolicy {
  const plan = licenceSummary(i.grants, i.now).plan;
  const business = BUSINESS_POLICIES.map((p) => businessLimit(p, i, plan));
  // Resource Manager: ajustes propios, valores por defecto y cualquier métrica con excepción
  const keys = new Map<string, { metric: string; period: QuotaPeriod }>();
  const add = (metric: string, period: QuotaPeriod) => keys.set(`${metric}|${period}`, { metric, period });
  for (const q of i.overrides) add(q.metric, q.period);
  for (const q of i.defaults) add(q.metric, q.period);
  for (const q of i.phase ?? []) add(q.metric, q.period);
  for (const e of i.exceptions) if (e.period !== "total") add(e.metric, e.period);
  const resources = Array.from(keys.values())
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.period.localeCompare(b.period))
    .map(({ metric, period }) => {
      const own = i.overrides.find((q) => q.metric === metric && q.period === period);
      const def = i.defaults.find((q) => q.metric === metric && q.period === period);
      const phase = i.phase?.find((q) => q.metric === metric && q.period === period);
      return resolveEffectiveLimit({
        metric,
        period,
        planKey: plan,
        planIncluded: undefined,
        override: own?.limit,
        exceptions: i.exceptions,
        ...(phase ? { phaseDefault: phase.limit } : {}),
        platformDefault: def ? def.limit : null,
        enforcement: own?.enforcement ?? phase?.enforcement ?? def?.enforcement ?? "hard",
        now: i.now,
      });
    });
  return { plan, business, resources };
}

/** Límite que hay HOY sin excepciones (la «cuota original» de una excepción nueva). */
export function limitWithoutExceptions(p: TenantPolicy, metric: string, period: string): number | null | undefined {
  const row = period === "total" ? p.business.find((b) => b.metric === metric) : p.resources.find((r) => r.metric === metric && r.period === period);
  if (!row) return undefined;
  if (row.source !== "exception") return row.limit;
  if (row.breakdown.override !== null) return row.breakdown.override;
  if (row.contractual !== undefined) return row.contractual;
  if (row.breakdown.trial !== null) return row.breakdown.trial;
  return row.breakdown.default;
}
