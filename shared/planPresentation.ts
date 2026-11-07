/**
 * Presentación comercial de los planes de Elephant Core en «Suscripción»: público, mensaje y pilares de cada plan
 * conocido, y la comparativa completa (precios, límites y ventajas) a partir de las tarjetas del comparador. Es solo
 * capa de contenido: no calcula importes ni decide qué se puede contratar (eso sigue en subscriptionPlans y el
 * servidor). Un plan que no esté aquí se presenta con lo que publica el catálogo.
 */
import type { PanelPlanInfo, PlanCardModel, PlanPrice } from "./subscriptionPlans";

export type PlanIconKey = "rocket" | "trending" | "building" | "layers";

export interface PlanPresentation {
  /** Para quién es, en dos o tres palabras («Para empezar»). */
  audience: string | null;
  /** Mensaje principal de la tarjeta. */
  headline: string | null;
  /** Áreas clave que cubre el plan (etiquetas cortas, sacadas de lo que publica el catálogo). */
  pillars: string[];
  icon: PlanIconKey;
}

const KNOWN: Record<string, Omit<PlanPresentation, "headline"> & { headline: string }> = {
  essential: {
    audience: "Para empezar",
    headline: "Todo tu negocio, conectado desde el primer día",
    pillars: ["CRM", "Ventas", "Web", "Tienda online", "TPV", "Facturación"],
    icon: "rocket",
  },
  business: {
    audience: "Para crecer",
    headline: "Más equipo, más control y más capacidad para crecer",
    pillars: ["Varias sedes", "Inventario", "Reservas", "Compras", "Informes"],
    icon: "trending",
  },
  enterprise: {
    audience: "Para operaciones complejas",
    headline: "Una plataforma adaptada a tu organización",
    pillars: ["Varias entidades fiscales", "API", "Integraciones a medida", "Trazabilidad avanzada"],
    icon: "building",
  },
};

export function planPresentation(plan: Pick<PanelPlanInfo, "key" | "tagline">): PlanPresentation {
  const k = KNOWN[plan.key];
  if (k) return { ...k, pillars: [...k.pillars] };
  return { audience: null, headline: plan.tagline, pillars: [], icon: "layers" };
}

/** Límites que se ven en la tarjeta (los primeros que publica el catálogo); el resto, en la comparativa. */
export const CARD_LIMITS = 4;
/** Ventajas que se ven en la tarjeta; la lista completa, en la comparativa. */
export const CARD_BENEFITS = 4;

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
