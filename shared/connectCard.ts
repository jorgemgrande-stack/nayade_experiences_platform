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

/**
 * Imagen ya resuelta por el canal (`{src, srcset?, width?, height?, alt, focal?}`): solo https y siempre con texto
 * alternativo. `focal`: punto de interés en % (0–100) para recortar sin perderlo.
 */
export interface ConnectImage {
  src: string;
  srcset: string | null;
  /** Versión para pantallas estrechas (otra proporción), si el canal la publica. */
  mobileSrc: string | null;
  width: number | null;
  height: number | null;
  alt: string;
  focal: { x: number; y: number } | null;
  /** Captura real de la pantalla o ilustración, si el canal lo dice (la ficha lo indica). */
  kind: "screenshot" | "illustration" | null;
}

/** Imagen de la galería: siempre dice si es captura real o ilustración. */
export interface ConnectGalleryItem extends Omit<ConnectImage, "kind"> {
  caption: string | null;
  kind: "screenshot" | "illustration";
}

/** Vídeo: solo la dirección de inserción normalizada por el canal (youtube-nocookie o player.vimeo). */
export interface ConnectVideo {
  embedUrl: string;
  title: string;
}

export interface ConnectSheetMedia {
  card: ConnectImage | null;
  hero: ConnectImage | null;
  icon: ConnectImage | null;
  gallery: ConnectGalleryItem[];
  video: ConnectVideo | null;
}

export interface ConnectHowStep {
  title: string;
  text: string;
}

/** Bloques de la ficha, en su orden por defecto. */
export const SHEET_BLOCK_IDS = ["problem", "benefits", "features", "howItWorks", "includes", "excludes", "integration", "gallery", "requirements", "terms", "faq", "related"] as const;
export type SheetBlockId = (typeof SHEET_BLOCK_IDS)[number];

export const SHEET_ACCENTS = ["blue", "teal", "violet", "amber", "rose", "slate"] as const;
export type SheetAccent = (typeof SHEET_ACCENTS)[number];
export const SHEET_HERO_STYLES = ["image", "split", "plain"] as const;
export type SheetHeroStyle = (typeof SHEET_HERO_STYLES)[number];

export interface ConnectLayout {
  /** Orden y visibilidad pedidos por el catálogo (vacío = el orden por defecto). */
  blocks: Array<{ id: SheetBlockId; visible: boolean }>;
  accentColor: SheetAccent | null;
  heroStyle: SheetHeroStyle | null;
}

/**
 * Orden final de los bloques: primero los que pide el catálogo (sin repetir), después los que no menciona en su orden
 * por defecto; los ocultos (`visible: false`) no aparecen. Un id desconocido ya se descartó al leer.
 */
export function resolveBlocks(layout: Pick<ConnectLayout, "blocks"> | null | undefined): SheetBlockId[] {
  const seen = new Set<SheetBlockId>();
  const out: SheetBlockId[] = [];
  for (const b of layout?.blocks ?? []) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    if (b.visible) out.push(b.id);
  }
  for (const id of SHEET_BLOCK_IDS) if (!seen.has(id)) out.push(id);
  return out;
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
  media: ConnectSheetMedia;
  /** Pasos de «Cómo funciona» (como mucho 4). */
  howItWorks: ConnectHowStep[];
  /** Etiqueta promocional publicada (≤ 30 caracteres), o null. */
  promoLabel: string | null;
  layout: ConnectLayout;
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
  media: { card: null, hero: null, icon: null, gallery: [], video: null },
  howItWorks: [],
  promoLabel: null,
  layout: { blocks: [], accentColor: null, heroStyle: null },
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
