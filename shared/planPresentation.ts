/**
 * Presentación comercial de los planes de Elephant Core en «Suscripción»: público, mensaje, icono y tono de cada plan
 * conocido, y la comparativa completa (precios, límites y ventajas, agrupados por categorías) a partir de las tarjetas
 * del comparador. Es solo capa de contenido: no calcula importes, no anuncia capacidades (las capacidades y los
 * límites salen SIEMPRE del catálogo publicado) ni decide qué se puede contratar (eso sigue en subscriptionPlans y el
 * servidor). Un plan que no esté aquí se presenta con lo que publica el catálogo.
 */
import type { PanelPlanInfo, PlanCardModel, PlanPrice } from "./subscriptionPlans";

export type PlanIconKey = "rocket" | "trending" | "building" | "layers";
/** Tono del plan en el sistema visual del marketplace (`data-tone` de connectStage.css). */
export type PlanTone = "violet" | "electric" | "magenta" | "night";

export interface PlanPresentation {
  /** Para quién es, en dos o tres palabras («Para empezar»). */
  audience: string | null;
  /** Mensaje principal de la tarjeta. */
  headline: string | null;
  icon: PlanIconKey;
  tone: PlanTone;
}

const KNOWN: Record<string, Omit<PlanPresentation, "headline"> & { headline: string }> = {
  essential: { audience: "Para empezar", headline: "Todo tu negocio, conectado desde el primer día", icon: "rocket", tone: "violet" },
  business: { audience: "Para crecer", headline: "Más equipo, más control y más capacidad para crecer", icon: "trending", tone: "electric" },
  enterprise: { audience: "Para operaciones complejas", headline: "Una plataforma adaptada a tu organización", icon: "building", tone: "magenta" },
};

export function planPresentation(plan: Pick<PanelPlanInfo, "key" | "tagline">): PlanPresentation {
  const k = KNOWN[plan.key];
  if (k) return { ...k };
  return { audience: null, headline: plan.tagline, icon: "layers", tone: "night" };
}

/** Límites que se ven en la tarjeta (los primeros que publica el catálogo); el resto, en la comparativa. */
export const CARD_LIMITS = 4;
/** Ventajas que se ven en la tarjeta; la lista completa, en la comparativa. */
export const CARD_BENEFITS = 3;

export const cardLimits = (plan: PanelPlanInfo) => plan.limits.slice(0, CARD_LIMITS);
export const cardBenefits = (plan: PanelPlanInfo) => plan.benefits.slice(0, CARD_BENEFITS);

/** Importe para mostrar: sin decimales si son cero («29 €»), con ellos si no («29,50 €»). Mismo importe, solo formato. */
export function displayMoney(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export const taxLabel = (p: PlanPrice) => (p.taxIncluded ? "IVA incluido" : "+ IVA");

export interface ComparisonCell {
  value: string | null;
  /** Distinto del plan actual de la empresa (lo que antes era «Frente a tu plan»). */
  differs: boolean;
}
export interface ComparisonRow {
  label: string;
  cells: ComparisonCell[];
}

/**
 * Filas de límites de la comparativa: la unión de los límites publicados (mismo indicador o, sin él, misma etiqueta),
 * en el orden en que aparecen. Cada celda marca si cambia frente al plan actual; el plan actual nunca se marca.
 */
export function comparisonLimitRows(cards: PlanCardModel[]): ComparisonRow[] {
  const keyOf = (l: { label: string; metric: string | null }) => (l.metric ? `m:${l.metric}` : `l:${l.label}`);
  const order: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const c of cards)
    for (const l of c.plan.limits) {
      const k = keyOf(l);
      if (!seen.has(k)) {
        seen.add(k);
        order.push({ key: k, label: l.label });
      }
    }
  const current = cards.find((c) => c.isCurrent) ?? null;
  const find = (plan: PanelPlanInfo, k: string) => plan.limits.find((l) => keyOf(l) === k)?.value ?? null;
  return order.map(({ key, label }) => {
    const mine = current ? find(current.plan, key) : null;
    return {
      label,
      cells: cards.map((c) => {
        const value = find(c.plan, key);
        return { value, differs: !c.isCurrent && mine !== null && value !== null && value !== mine };
      }),
    };
  });
}

/** Categorías de la comparativa completa (por indicador publicado o, sin él, por la etiqueta). */
export type ComparisonGroupId = "team" | "sales" | "web" | "service" | "other";
export const COMPARISON_GROUP_LABELS: Record<ComparisonGroupId, string> = {
  team: "Equipo y organización",
  sales: "Clientes y ventas",
  web: "Web y almacenamiento",
  service: "Soporte y servicio",
  other: "Otras capacidades",
};
const GROUP_BY_METRIC: Record<string, ComparisonGroupId> = {
  users: "team",
  sites: "team",
  fiscal_entities: "team",
  contacts: "sales",
  orders_month: "sales",
  websites: "web",
  storage_gb: "web",
};
const GROUP_BY_LABEL: Record<string, ComparisonGroupId> = { roles: "team", soporte: "service", support: "service" };
const GROUP_ORDER: ComparisonGroupId[] = ["team", "sales", "web", "service", "other"];

export function comparisonGroupOf(l: { label: string; metric: string | null }): ComparisonGroupId {
  return (l.metric && GROUP_BY_METRIC[l.metric]) || GROUP_BY_LABEL[l.label.trim().toLowerCase()] || "other";
}

/**
 * Filas de límites agrupadas por categoría, en el orden fijo de las categorías y, dentro de cada una, en el de
 * publicación. No se descarta ninguna fila: lo que no encaja en una categoría conocida va a «Otras capacidades».
 */
export function groupedComparisonRows(cards: PlanCardModel[]): Array<{ id: ComparisonGroupId; label: string; rows: ComparisonRow[] }> {
  const rows = comparisonLimitRows(cards);
  const metricOf = new Map<string, string | null>();
  for (const c of cards) for (const l of c.plan.limits) if (!metricOf.has(l.label)) metricOf.set(l.label, l.metric);
  return GROUP_ORDER.map((id) => ({ id, label: COMPARISON_GROUP_LABELS[id], rows: rows.filter((r) => comparisonGroupOf({ label: r.label, metric: metricOf.get(r.label) ?? null }) === id) })).filter(
    (g) => g.rows.length > 0,
  );
}

const PLAN_RANK: Record<string, number> = { essential: 0, business: 1, enterprise: 2 };

/**
 * Plan que se presenta como opción de crecimiento: lo marca el catálogo (`highlight`) y es superior al plan actual.
 * Nunca se presenta como «el recomendado para todos».
 */
export function isGrowthOption(card: Pick<PlanCardModel, "isCurrent" | "plan">, currentKey: string | null): boolean {
  if (!card.plan.highlight || card.isCurrent) return false;
  if (!currentKey || PLAN_RANK[currentKey] === undefined) return true;
  return (PLAN_RANK[card.plan.key] ?? -1) > PLAN_RANK[currentKey];
}
