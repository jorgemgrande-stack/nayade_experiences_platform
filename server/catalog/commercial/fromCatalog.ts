/**
 * Política comercial a partir del catálogo: una sola fuente. Las reglas viven en los productos (inclusiones, cupos
 * propuestos y ampliación por presupuesto en cada plan; regla de paquetes en cada paquete) y se versionan y publican
 * como el resto del borrador.
 *
 *  - "published": lo publicado. La proyección pública ya quitó lo no aprobado y aquí se vuelve a filtrar: solo
 *    reglas aprobadas. Es la que usan el cotizador público y las propuestas del CRM.
 *  - "proposed": los borradores tal cual, con las reglas propuestas marcadas como tales. Solo para el simulador
 *    del administrador (nunca para un presupuesto ni para la web).
 */
import type { CommercialPolicy, DecisionStatus, NetCoreInclusion, PlanInclusion } from "./policy";

interface CatalogFields {
  inclusions?: Array<Omit<PlanInclusion, "plan">>;
  quotaProposals?: Array<{ metric: string; included: number }>;
  quoteOnRequest?: { status: DecisionStatus };
  bundleRule?: { kind: "catalog" | "min2"; status: DecisionStatus };
  coreIncluded?: NetCoreInclusion;
}
export interface PolicySource {
  key: string;
  family: string;
  catalog?: CatalogFields;
}

export type PolicyMode = "published" | "proposed";

export function policyFromProducts(products: readonly PolicySource[], mode: PolicyMode): CommercialPolicy {
  const approvedOnly = mode === "published";
  const ok = (s: DecisionStatus | undefined) => !approvedOnly || s === "approved";
  const inclusions: PlanInclusion[] = [];
  const quotaOverrides: CommercialPolicy["quotaOverrides"] = [];
  const quoteOnRequestPlans: string[] = [];
  const bundleRules: NonNullable<CommercialPolicy["bundleRules"]> = {};
  const coreIncluded: NonNullable<CommercialPolicy["coreIncluded"]> = {};
  for (const p of products) {
    const c = p.catalog ?? {};
    if (p.family === "core_plan") {
      for (const i of c.inclusions ?? []) if (ok(i.status) && (!i.cap || ok(i.cap.status))) inclusions.push({ ...i, plan: p.key });
      if (!approvedOnly) for (const q of c.quotaProposals ?? []) quotaOverrides.push({ plan: p.key, metric: q.metric, included: q.included, status: "proposed" });
      if (c.quoteOnRequest && ok(c.quoteOnRequest.status)) quoteOnRequestPlans.push(p.key);
    } else if (c.bundleRule && ok(c.bundleRule.status)) bundleRules[p.key] = { ...c.bundleRule };
    // Elephant Core incluido en las soluciones Elephant Net completas (y sus reglas de ampliación y Net adicional)
    if (p.family === "net_bundle" && c.coreIncluded && ok(c.coreIncluded.status)) {
      const { upgrade, additional, ...ci } = c.coreIncluded;
      coreIncluded[p.key] = { ...ci, ...(upgrade && ok(upgrade.status) ? { upgrade: { ...upgrade } } : {}), ...(additional && ok(additional.status) ? { additional: { ...additional } } : {}) };
    }
  }
  return {
    id: mode === "published" ? "publicada" : "simulacion-borradores",
    inclusions,
    quotaOverrides,
    bundleRule: { kind: "catalog", status: "approved" },
    bundleRules,
    quoteOnRequestPlans,
    coreIncluded,
  };
}

/** ¿La política cambia algún cálculo frente al cotizador del catálogo? (sin reglas = mismos importes que siempre) */
export function isNeutral(policy: CommercialPolicy): boolean {
  return !policy.inclusions.length && !policy.quotaOverrides.length && !policy.quoteOnRequestPlans.length && policy.bundleRule.kind === "catalog" && Object.values(policy.bundleRules ?? {}).every((r) => r.kind === "catalog") && !Object.keys(policy.coreIncluded ?? {}).length;
}
