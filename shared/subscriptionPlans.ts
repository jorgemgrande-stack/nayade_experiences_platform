/**
 * Comparador de planes de «Suscripción»: modelo puro (sin consultas) a partir de lo que publica el catálogo central
 * (planes, precios, beneficios y límites) y de lo que el servidor dice que se puede hacer HOY (alta desde la prueba,
 * cambio de plan). No calcula importes ni inventa datos: lo que no llega no se muestra.
 */

export type PlanInterval = "month" | "year";
export type SelfServicePlanKey = "essential" | "business";
const SELF_SERVICE: readonly string[] = ["essential", "business"];

export interface PlanPrice {
  amountCents: number;
  currency: string;
  taxIncluded: boolean;
}

export interface PanelPlanInfo {
  key: string;
  name: string;
  commercialStatus: "coming_soon" | "in_preparation" | "on_request" | "available";
  inherits: string | null;
  tagline: string | null;
  description: string | null;
  forWho: string | null;
  highlight: boolean;
  benefits: string[];
  limits: Array<{ label: string; value: string; metric: string | null }>;
  monthly: PlanPrice | null;
  yearly: PlanPrice | null;
  /** Contratación asistida (la decide el catálogo central); null si no lo publica. */
  assisted: boolean | null;
  offerLabel: string | null;
}

const COMMERCIAL = ["coming_soon", "in_preparation", "on_request", "available"] as const;
const text = (v: unknown, max = 400): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const texts = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => text(x, 200)).filter((x): x is string => !!x).slice(0, max) : [];
const price = (v: unknown): PlanPrice | null => {
  const o = v as { amountCents?: unknown; currency?: unknown; taxIncluded?: unknown } | null;
  if (!o || typeof o.amountCents !== "number" || !Number.isFinite(o.amountCents) || o.amountCents < 0) return null;
  if (typeof o.currency !== "string" || !/^[A-Za-z]{3}$/.test(o.currency)) return null;
  return { amountCents: Math.round(o.amountCents), currency: o.currency.toUpperCase(), taxIncluded: o.taxIncluded === true };
};

/** Orden de presentación: los planes conocidos de menor a mayor; el resto, detrás en el orden del catálogo. */
const RANK: Record<string, number> = { essential: 0, business: 1, enterprise: 2 };

/** Planes publicados en el catálogo del panel (campo `plans`). Descarta lo mal formado; sin campo, lista vacía. */
export function parsePanelPlans(raw: unknown): PanelPlanInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelPlanInfo[] = [];
  const seen = new Set<string>();
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    const key = typeof r.key === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(r.key) ? r.key : null;
    const name = text(r.name, 80);
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    const prices = Array.isArray(r.prices) ? (r.prices as Array<Record<string, unknown>>) : [];
    const offer = r.offer as { modality?: unknown; label?: unknown } | null | undefined;
    out.push({
      key,
      name,
      commercialStatus: (COMMERCIAL as readonly string[]).includes(String(r.commercialStatus)) ? (r.commercialStatus as PanelPlanInfo["commercialStatus"]) : "on_request",
      inherits: text(r.inherits, 64),
      tagline: text(r.tagline),
      description: text(r.description, 800),
      forWho: text(r.forWho),
      highlight: r.highlight === true,
      benefits: texts(r.benefits, 8),
      limits: (Array.isArray(r.limits) ? (r.limits as Array<Record<string, unknown>>) : [])
        .map((l) => ({ label: text(l?.label, 80), value: text(l?.value, 80), metric: text(l?.metric, 64) }))
        .filter((l): l is { label: string; value: string; metric: string | null } => !!l.label && !!l.value)
        .slice(0, 12),
      monthly: price(prices.find((p) => p?.kind === "monthly")),
      yearly: price(prices.find((p) => p?.kind === "yearly")),
      assisted: offer && (offer.modality === "assisted" || offer.modality === "immediate") ? offer.modality === "assisted" : null,
      offerLabel: offer ? text(offer.label, 60) : null,
    });
  }
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (RANK[a.p.key] ?? 10) - (RANK[b.p.key] ?? 10) || a.i - b.i)
    .map((x) => x.p);
}

export const COMMERCIAL_LABELS: Record<PanelPlanInfo["commercialStatus"], string> = {
  available: "Disponible",
  on_request: "Bajo solicitud",
  in_preparation: "En preparación",
  coming_soon: "Próximamente",
};

export type PlanCta =
  /** El plan contratado: sin botón. */
  | { kind: "current" }
  /** Alta de pago desde la prueba (el formulario «Contratar» de la página). */
  | { kind: "convert"; plan: SelfServicePlanKey }
  /** Cambio de plan con el autoservicio (vista previa de importes y confirmación). */
  | { kind: "change"; plan: SelfServicePlanKey; interval: PlanInterval; direction: "upgrade" | "downgrade"; recurringCents: number; currency: string }
  /** Contratación asistida o sin flujo en línea: hablar con el equipo comercial. */
  | { kind: "contact" }
  /** Solo la administración de la empresa puede contratar o cambiar de plan. */
  | { kind: "admin_only" }
  /** Nada que hacer desde aquí (por ejemplo, un plan inferior sin bajada en línea). */
  | { kind: "none" };

export interface PlanDifference {
  label: string;
  value: string;
  current: string;
}

export interface PlanCardModel {
  plan: PanelPlanInfo;
  /** Es el plan de la licencia de la empresa (en prueba o contratado). */
  isCurrent: boolean;
  /** Etiqueta del plan de la empresa: «Tu plan actual» o «Prueba gratuita» (nunca ambas). */
  currentLabel: string | null;
  commercialLabel: string;
  /** Lo que cambia frente al plan actual (límites publicados con distinto valor). */
  differences: PlanDifference[];
  cta: PlanCta;
}

export interface PlanChangeInfo {
  enabled: boolean;
  available: boolean;
  current: { plan: string; interval: PlanInterval } | null;
  options: Array<{ plan: string; interval: PlanInterval; direction: "upgrade" | "downgrade"; recurringCents: number; currency: string }>;
}

export interface PlanComparisonInput {
  plans: PanelPlanInfo[];
  currentPlanKey: string | null;
  /** Estado de la suscripción (overview.state). */
  state: string;
  isAdmin: boolean;
  /** subscription.conversionStatus (null: no aplica a esta persona o empresa). */
  conversion: { enabled: boolean } | null;
  /** subscription.planChangeStatus (null: no aplica). */
  planChange: PlanChangeInfo | null;
}

export const isTrialState = (state: string) => state === "trial" || state === "trial_expired";

/** Diferencias de límites publicados entre un plan y el actual (mismo indicador o, sin él, misma etiqueta). */
export function planDifferences(plan: PanelPlanInfo, current: PanelPlanInfo | null): PlanDifference[] {
  if (!current || current.key === plan.key) return [];
  const out: PlanDifference[] = [];
  for (const l of plan.limits) {
    const mine = current.limits.find((c) => (l.metric && c.metric ? c.metric === l.metric : c.label === l.label));
    if (mine && mine.value !== l.value) out.push({ label: l.label, value: l.value, current: mine.value });
  }
  return out;
}

export function buildPlanComparison(i: PlanComparisonInput): PlanCardModel[] {
  const trial = isTrialState(i.state);
  const current = i.plans.find((p) => p.key === i.currentPlanKey) ?? null;
  const convertible = trial && i.isAdmin && i.conversion?.enabled === true;
  const change = !trial && i.isAdmin && i.planChange?.enabled && i.planChange.available && i.planChange.current ? i.planChange : null;
  return i.plans.map((plan): PlanCardModel => {
    const isCurrent = plan.key === i.currentPlanKey;
    const selfService = SELF_SERVICE.includes(plan.key);
    let cta: PlanCta;
    if (isCurrent && !trial) cta = { kind: "current" };
    else if (!i.isAdmin) cta = { kind: "admin_only" };
    else if (convertible && selfService) cta = { kind: "convert", plan: plan.key as SelfServicePlanKey };
    else if (change && selfService) {
      // Mismo periodo que el contrato actual si existe esa opción; si no, la primera que ofrezca el servidor
      const opts = change.options.filter((o) => o.plan === plan.key);
      const o = opts.find((x) => x.interval === change.current!.interval) ?? opts[0];
      cta = o ? { kind: "change", plan: plan.key as SelfServicePlanKey, interval: o.interval, direction: o.direction, recurringCents: o.recurringCents, currency: o.currency } : current && rank(plan) < rank(current) ? { kind: "none" } : { kind: "contact" };
    } else if (current && !trial && rank(plan) < rank(current)) cta = { kind: "none" };
    else cta = { kind: "contact" };
    return {
      plan,
      isCurrent,
      currentLabel: isCurrent ? (trial ? "Prueba gratuita" : "Tu plan actual") : null,
      commercialLabel: plan.assisted && plan.offerLabel ? plan.offerLabel : COMMERCIAL_LABELS[plan.commercialStatus],
      differences: planDifferences(plan, current),
      cta,
    };
  });
}

const rank = (p: PanelPlanInfo) => RANK[p.key] ?? 10;

/** Estados de un módulo que la empresa ya tiene (contratado, activándose o con incidencia). */
export const OWNED_MODULE_STATES: readonly string[] = ["active", "pending_setup", "activating", "incident"];
const RECOMMENDABLE_STATES: readonly string[] = ["available", "on_request", "coming_soon"];

/**
 * Recomendaciones de ampliación SOLO con relaciones publicadas por el catálogo central: productos «relacionados» de
 * la ficha de algo que la empresa ya tiene. Sin módulos contratados o sin relaciones publicadas, lista vacía.
 */
export function relatedRecommendations<T extends { key: string; name: string; state: string; sheet: { related: string[] } }>(items: T[], max = 3): Array<{ item: T; because: string }> {
  const owned = items.filter((i) => OWNED_MODULE_STATES.includes(i.state));
  const ownedKeys = new Set(owned.map((i) => i.key));
  const out: Array<{ item: T; because: string }> = [];
  const seen = new Set<string>();
  for (const o of owned) {
    for (const key of o.sheet.related) {
      if (out.length >= max) return out;
      if (seen.has(key) || ownedKeys.has(key)) continue;
      const item = items.find((i) => i.key === key);
      if (!item || !RECOMMENDABLE_STATES.includes(item.state)) continue;
      seen.add(key);
      out.push({ item, because: o.name });
    }
  }
  return out;
}
