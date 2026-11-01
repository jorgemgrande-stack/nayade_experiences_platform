/**
 * Ficha comercial de un producto de Elephant Connect o Elephant Net tal como la ve el panel: SOLO lo que publica el
 * catálogo central (o, mientras no lo publica, la semilla oficial). Ningún texto comercial vive en el frontend: si un
 * dato no viene, la sección no se muestra.
 *
 * Pura: la usan el servidor (al resolver la ficha) y el panel (para pintar precios). Sin dependencias.
 */

/** Precio aprobado del catálogo. `kind`: monthly, yearly/annual, one_time/setup… (`unit`: por usuario, por sede…). */
export interface ConnectPrice {
  kind: string;
  amountCents: number;
  currency: string;
  unit: string | null;
  /** Tipo de IVA en puntos básicos (2100 = 21 %); null si el catálogo no lo dice. */
  taxRateBp: number | null;
  taxIncluded: boolean;
}

export interface ConnectFaq {
  q: string;
  a: string;
}

/** Imagen real publicada en el catálogo (nunca se inventa ni se rellena). */
export interface ConnectMedia {
  src: string;
  alt: string;
  caption: string | null;
}

export interface ConnectTerms {
  commitment: string | null;
  cancellation: string | null;
  activation: string | null;
}

/** Contenido comercial de la ficha. Vacío = no se muestra nada de esa sección. */
export interface ConnectSheet {
  headline: string | null;
  valueProposition: string | null;
  longDescription: string | null;
  problem: string | null;
  benefits: string[];
  excludes: string[];
  integrations: string[];
  coreIntegration: string[];
  terms: ConnectTerms;
  faq: ConnectFaq[];
  /** Claves de productos relacionados (solo se muestran los que existen en el catálogo de la empresa). */
  related: string[];
  cover: ConnectMedia | null;
  screenshots: ConnectMedia[];
  /** Modalidad de contratación publicada («Implantación asistida», «Disponible»…), o null. */
  offer: string | null;
}

export const EMPTY_SHEET: ConnectSheet = {
  headline: null,
  valueProposition: null,
  longDescription: null,
  problem: null,
  benefits: [],
  excludes: [],
  integrations: [],
  coreIntegration: [],
  terms: { commitment: null, cancellation: null, activation: null },
  faq: [],
  related: [],
  cover: null,
  screenshots: [],
  offer: null,
};

const PERIOD: Record<string, { per: string | null; order: number; months: number | null }> = {
  monthly: { per: "mes", order: 0, months: 1 },
  month: { per: "mes", order: 0, months: 1 },
  yearly: { per: "año", order: 1, months: 12 },
  annual: { per: "año", order: 1, months: 12 },
  year: { per: "año", order: 1, months: 12 },
  one_time: { per: null, order: 2, months: null },
  once: { per: null, order: 2, months: null },
  setup: { per: null, order: 3, months: null },
};

/** «/ mes», «/ año», «pago único», «alta» o nada si el catálogo usa una periodicidad que no conocemos. */
export function periodLabel(kind: string): string {
  const p = PERIOD[kind];
  if (!p) return "";
  if (p.per) return `/ ${p.per}`;
  return kind === "setup" ? "de alta (pago único)" : "pago único";
}

export const isRecurring = (kind: string) => !!PERIOD[kind]?.per;

/** «IVA no incluido (21 %)», «IVA incluido (21 %)» o sin el tipo si el catálogo no lo publica. */
export function taxLabel(p: Pick<ConnectPrice, "taxIncluded" | "taxRateBp">): string {
  const rate = p.taxRateBp !== null ? ` (${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(p.taxRateBp / 100)} %)` : "";
  return `${p.taxIncluded ? "IVA incluido" : "IVA no incluido"}${rate}`;
}

export const formatMoney = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);

/** Precios en orden de lectura: mensual, anual, pago único, alta; los desconocidos al final. */
export function sortPrices(prices: ConnectPrice[]): ConnectPrice[] {
  return [...prices].sort((a, b) => (PERIOD[a.kind]?.order ?? 9) - (PERIOD[b.kind]?.order ?? 9));
}

/**
 * Precio «desde» de la tarjeta: el primer precio recurrente (mensual antes que anual) y, si no hay, el primero.
 * `from`: hay más de un precio (la tarjeta dice «desde»).
 */
export function headlinePrice(prices: ConnectPrice[]): { price: ConnectPrice; from: boolean } | null {
  const sorted = sortPrices(prices);
  const recurring = sorted.find((p) => isRecurring(p.kind));
  const price = recurring ?? sorted[0];
  return price ? { price, from: sorted.length > 1 } : null;
}
