/**
 * Política comercial de los planes: qué extensiones incluye cada plan, cupos base de Enterprise y regla de
 * paquetes con componentes incluidos (ESPECIFICACION_COMERCIAL_DEFINITIVA_BIG_ELEPHANT.md, 26/10/2026).
 *
 * La política que aplica el cotizador se construye desde el catálogo (`fromCatalog.ts`): la publicada solo con lo
 * aprobado y la de simulación con los borradores. `CATALOG_POLICY` reproduce el comportamiento vigente (sin
 * inclusiones) y `PROPOSED_POLICY` es la propuesta de la especificación, con cada regla marcada como aprobada por el
 * propietario o pendiente de aprobación; se carga en los borradores con la importación de especificaciones.
 */

/** approved = decisión del propietario; proposed = regla propuesta pendiente de aprobación. */
export type DecisionStatus = "approved" | "proposed";

export interface PlanInclusion {
  /** Plan que la concede (los planes superiores la heredan). */
  plan: string;
  /** Producto del catálogo incluido (extensión, extra o paquete de extensiones). */
  key: string;
  /** full: completa; partial: con tope (`cap`). */
  mode: "full" | "partial";
  status: DecisionStatus;
  /** Tope de la inclusión parcial: métrica, base y si suma las unidades adicionales de otra métrica. */
  cap?: { metric: "employees"; base: number; plusExtraOf?: "users"; status: DecisionStatus };
  /** Qué se contrata al superar el tope (precio de catálogo, sin crear tarifas nuevas). */
  overflowKey?: string;
  /** Lo que la inclusión no cubre (se muestra en el desglose). */
  excludes?: string;
}

export interface CommercialPolicy {
  id: string;
  inclusions: PlanInclusion[];
  /** Cupos de los planes que el catálogo deja «por contrato» (null). */
  quotaOverrides: Array<{ plan: string; metric: string; included: number; status: DecisionStatus }>;
  /**
   * catalog: un paquete sustituye a sus componentes (comportamiento vigente).
   * min2: con componentes incluidos en el plan, el paquete conserva su descuento (proporcional) solo si quedan
   * al menos dos componentes por facturar; con uno, se cobra su precio individual.
   */
  bundleRule: { kind: "catalog" | "min2"; status: DecisionStatus };
  /** Regla propia de cada paquete (`catalog.bundleRule` del paquete); si no tiene, la general. */
  bundleRules?: Record<string, { kind: "catalog" | "min2"; status: DecisionStatus }>;
  /** Planes donde una ampliación sin complemento en el catálogo se presupuesta en vez de exigir otro plan. */
  quoteOnRequestPlans: string[];
}

/** Comportamiento vigente: sin inclusiones, sin cupos de Enterprise, paquetes como hoy. */
export const CATALOG_POLICY: CommercialPolicy = {
  id: "catalogo-vigente",
  inclusions: [],
  quotaOverrides: [],
  bundleRule: { kind: "catalog", status: "approved" },
  quoteOnRequestPlans: [],
};

/** Escenario equilibrado (decidido el 26/10/2026) con las reglas propuestas de la especificación definitiva. */
export const PROPOSED_POLICY: CommercialPolicy = {
  id: "escenario-equilibrado-2026-10",
  inclusions: [
    { plan: "business", key: "connect-automations", mode: "full", status: "approved", excludes: "Envíos de marketing (Elephant Campaigns)" },
    {
      plan: "business",
      key: "connect-people",
      mode: "partial",
      status: "approved",
      cap: { metric: "employees", base: 15, plusExtraOf: "users", status: "proposed" },
      overflowKey: "connect-people",
      excludes: "Por encima del tope de empleados se contrata Elephant People completo",
    },
    { plan: "business", key: "extra-contracts-esign", mode: "full", status: "approved", excludes: "Firma avanzada o cualificada: por uso, con proveedor" },
    { plan: "enterprise", key: "connect-people", mode: "full", status: "proposed" },
    { plan: "enterprise", key: "connect-pack-finance", mode: "full", status: "approved" },
    { plan: "enterprise", key: "extra-accounting", mode: "full", status: "approved" },
    { plan: "enterprise", key: "connect-copilot", mode: "full", status: "approved", excludes: "Consumo de IA por encima del límite mensual" },
  ],
  quotaOverrides: [
    { plan: "enterprise", metric: "users", included: 25, status: "proposed" },
    { plan: "enterprise", metric: "sites", included: 10, status: "proposed" },
    { plan: "enterprise", metric: "fiscal_entities", included: 3, status: "proposed" },
    { plan: "enterprise", metric: "contacts", included: 250_000, status: "proposed" },
    { plan: "enterprise", metric: "orders_month", included: 20_000, status: "proposed" },
    { plan: "enterprise", metric: "storage_gb", included: 200, status: "proposed" },
    { plan: "enterprise", metric: "websites", included: 10, status: "proposed" },
  ],
  bundleRule: { kind: "min2", status: "proposed" },
  quoteOnRequestPlans: ["enterprise"],
};

/** Reglas pendientes de aprobación de una política (para avisos en el CRM y en las pruebas). */
export function pendingRules(policy: CommercialPolicy): string[] {
  return [
    ...policy.inclusions.filter((i) => i.status === "proposed").map((i) => `inclusión ${i.plan}:${i.key}`),
    ...policy.inclusions.filter((i) => i.cap?.status === "proposed").map((i) => `tope ${i.plan}:${i.key}`),
    ...policy.quotaOverrides.filter((q) => q.status === "proposed").map((q) => `cupo ${q.plan}:${q.metric}`),
    ...(policy.bundleRule.status === "proposed" ? [`regla de paquetes ${policy.bundleRule.kind}`] : []),
    ...Object.entries(policy.bundleRules ?? {}).filter(([, r]) => r.status === "proposed").map(([k, r]) => `regla de paquetes ${r.kind} en ${k}`),
  ];
}
