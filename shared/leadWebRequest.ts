/**
 * Solicitud web estructurada de un lead (E-6 / E-4): lo que la persona vio y eligió en la ficha del producto, para el
 * bloque «Solicitud web» del CRM. Lógica pura (servidor y panel).
 *
 * Los datos salen de columnas propias del lead (0073: idioma, modalidad, precio mostrado; 0076: convocatoria y moneda)
 * y de la inscripción enlazada. Si la migración 0076 aún no está aplicada, la convocatoria se deduce de la inscripción
 * y la moneda queda vacía (se muestra el precio sin moneda en vez de inventarla).
 */
import { formatEditionDates } from "./editions";

/** Orígenes que crea `processProductRequest` (server/productRequests.ts). */
export const WEB_REQUEST_SOURCES = ["web_solicitud_producto", "web_solicitud_plaza"] as const;
export type WebRequestSource = (typeof WEB_REQUEST_SOURCES)[number];

export const WEB_REQUEST_SOURCE_LABELS: Record<WebRequestSource, string> = {
  web_solicitud_producto: "Solicitud de información",
  web_solicitud_plaza: "Solicitud de plaza",
};

export function isWebRequestSource(source: unknown): source is WebRequestSource {
  return typeof source === "string" && (WEB_REQUEST_SOURCES as readonly string[]).includes(source);
}

/** Moneda ISO 4217 (tres letras). Cualquier otra cosa → la de reserva (EUR). */
export function normalizeCurrency(raw: unknown, fallback = "EUR"): string {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(v) ? v : fallback;
}

/** Precio mostrado con su moneda («777,00 €»). Sin moneda conocida, solo la cifra; sin precio, null. */
export function formatShownPrice(amount: unknown, currency: string | null | undefined): string | null {
  const n = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() !== "" ? Number(amount) : NaN;
  if (!Number.isFinite(n)) return null;
  const cur = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
  if (!cur) return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  }
}

/** Nombre del idioma en español («de» → «Alemán»); si el navegador no lo conoce, el código. */
export function languageNameEs(code: string): string {
  try {
    const n = new Intl.DisplayNames(["es"], { type: "language" }).of(code);
    return n && n.toLowerCase() !== code.toLowerCase() ? n.charAt(0).toLocaleUpperCase("es") + n.slice(1) : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Lo que el CRM necesita del lead (columnas de `leads`). */
export interface LeadRequestFields {
  source?: string | null;
  experienceId?: number | null;
  selectedProduct?: string | null;
  variantId?: number | null;
  variantLabel?: string | null;
  shownPrice?: string | number | null;
  requestLang?: string | null;
  numberOfPersons?: number | null;
  isTest?: boolean | null;
}

/** Datos aparte: columnas de 0076 (si existen), convocatoria y producto. */
export interface LeadRequestExtras {
  currency?: string | null;
  product?: { id: number; title: string; slug: string | null } | null;
  edition?: { id: number; label: string; startsAt: number; endsAt: number | null; timezone: string } | null;
}

export interface LeadWebRequestView {
  source: string | null;
  sourceLabel: string | null;
  product: { id: number | null; title: string; slug: string | null } | null;
  variant: { id: number | null; label: string } | null;
  shownPrice: string | null;
  currency: string | null;
  lang: { code: string; name: string } | null;
  edition: { id: number; label: string; dates: string; experienceId: number | null } | null;
  participants: number | null;
  isTest: boolean;
}

/**
 * Bloque «Solicitud web» del lead, o null si el lead no viene de una solicitud de producto ni tiene ninguno de sus
 * campos (un lead normal no enseña un bloque vacío).
 */
export function buildLeadWebRequestView(lead: LeadRequestFields, extras: LeadRequestExtras = {}): LeadWebRequestView | null {
  const fromWeb = isWebRequestSource(lead.source);
  const hasFields = !!(lead.variantLabel || lead.requestLang || (lead.shownPrice != null && lead.shownPrice !== "") || extras.edition);
  if (!fromWeb && !hasFields) return null;
  const currency = extras.currency && /^[A-Z]{3}$/.test(extras.currency) ? extras.currency : null;
  const code = (lead.requestLang ?? "").trim().toLowerCase();
  const title = extras.product?.title || lead.selectedProduct || "";
  return {
    source: lead.source ?? null,
    sourceLabel: isWebRequestSource(lead.source) ? WEB_REQUEST_SOURCE_LABELS[lead.source] : null,
    product: title ? { id: extras.product?.id ?? lead.experienceId ?? null, title, slug: extras.product?.slug ?? null } : null,
    variant: lead.variantLabel ? { id: lead.variantId ?? null, label: lead.variantLabel } : null,
    shownPrice: formatShownPrice(lead.shownPrice, currency),
    currency,
    lang: /^[a-z]{2}$/.test(code) ? { code, name: languageNameEs(code) } : null,
    edition: extras.edition
      ? { id: extras.edition.id, label: extras.edition.label, dates: formatEditionDates(extras.edition.startsAt, extras.edition.endsAt, extras.edition.timezone), experienceId: extras.product?.id ?? lead.experienceId ?? null }
      : null,
    participants: lead.numberOfPersons && lead.numberOfPersons > 0 ? lead.numberOfPersons : null,
    isTest: lead.isTest === true,
  };
}

/** Enlace del panel a las convocatorias de un producto (lo abre `ExperiencesManager` con `?convocatorias=<id>`). */
export function productEditionsHref(experienceId: number): string {
  return `/admin/productos?convocatorias=${experienceId}`;
}
