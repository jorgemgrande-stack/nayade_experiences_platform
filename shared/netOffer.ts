/**
 * Venta de Elephant Net por clases (estrategia A/B/C aprobada el 11/11/2026). Lógica pura y textos ÚNICOS para el
 * marketplace del panel, el plano de control y la web pública (`bigelephant-web` debe reflejar este mapa: mismas
 * etiquetas y mismos estados, desde la oferta publicada del catálogo).
 *
 *  - Clase A · `checkout`: disponible con oferta inmediata con Checkout, o sin oferta conocida (hoy, Social Token Net):
 *    «Contratar ahora». Disponible con oferta asistida publicada: clase B si es operativo y tiene precio.
 *  - Clase B · `assisted_contract`: producto Net de empresa «bajo solicitud» (`on_request`), operativo
 *    (técnico `partial` o `available`) y con precio mensual publicado: «Contratar e iniciar implantación». Abre una
 *    solicitud de implantación (expediente) y el equipo prepara el contrato (condiciones personalizadas con los
 *    compromisos de implantación); NO se cobra nada en el panel ni en la web.
 *  - `request_info`: bajo solicitud sin precio publicado (o no operativo): «Solicitar información».
 *  - `interest`: próximamente o en preparación: «Me interesa».
 *  - Life Net es personal: no se ofrece a empresas (fuera de este mapa).
 */
import { netProductOf, type NetArea, type NetProduct } from "./netProducts";
import { connectAssistedOf } from "./connectAssisted";

export type NetSaleKind = "checkout" | "assisted_contract" | "request_info" | "interest";

/** Etiqueta del botón principal (la web la refleja tal cual). */
export const NET_SALE_LABEL: Record<NetSaleKind, string> = {
  checkout: "Contratar ahora",
  assisted_contract: "Contratar e iniciar implantación",
  request_info: "Solicitar información",
  interest: "Me interesa",
};

/** Etiqueta del estado (insignia) que acompaña a cada clase. Nunca «Próximamente» para lo que está en implantación. */
export const NET_SALE_STATE_LABEL: Record<NetSaleKind, string> = {
  checkout: "Disponible",
  assisted_contract: "Implantación asistida",
  request_info: "Bajo solicitud",
  interest: "En preparación",
};

/** Textos de la contratación asistida (clase B). */
export const ASSISTED_CONTRACT_COPY = {
  title: (name: string) => `Contratar ${name} e iniciar la implantación`,
  intro: "Lo preparamos contigo: abrimos tu expediente de implantación y nuestro equipo te contacta para preparar el contrato.",
  steps: [
    "Registramos tu solicitud y abrimos el expediente de implantación de tu empresa.",
    "Te contactamos para preparar el contrato: el precio publicado, las condiciones de prestación y los compromisos de implantación.",
    "Aceptas el contrato y preparamos tu entorno contigo antes de ponerlo en marcha.",
  ],
  noPayment: "No se realiza ningún cobro desde aquí: el pago llega con el contrato que aceptes.",
  availableTitle: "Disponible desde la puesta en marcha",
  inImplementationTitle: "En implantación (incluido, sin coste adicional)",
  planLine: (plan: string | null) => (plan ? `Se añade a tu plan actual: ${plan}.` : "Se contrata junto con un plan de Elephant Core."),
  priceLine: (monthly: string, taxIncluded = false) => `${monthly} al mes (${taxIncluded ? "IVA incluido" : "IVA aparte"}), según el precio publicado.`,
  confirm: "Solicitar contratación",
  done: "Solicitud registrada: nuestro equipo te contactará para preparar el contrato.",
  /** Origen de la solicitud en el CRM (sufijo de la página de origen). */
  sourceFragment: "#contratar-implantacion",
} as const;

export interface NetSaleInput {
  key: string;
  commercialStatus: string | null | undefined;
  technicalStatus?: string | null;
  /** ¿Tiene precio mensual publicado y aprobado? */
  hasMonthlyPrice: boolean;
  /** Oferta efectiva publicada (`offer` del catálogo), si se conoce. */
  offer?: { modality?: string | null; checkout?: boolean | null } | null;
}

/**
 * Clase de venta de un producto Net de empresa; null si no es un producto Net de empresa (Connect, extras, Life Net…).
 * Misma regla en el panel y en la web.
 */
export function netSaleKind(p: NetSaleInput): NetSaleKind | null {
  const net = netProductOf(p.key);
  if (!net || net.segment !== "business") return null;
  const cs = p.commercialStatus ?? "on_request";
  if (cs === "coming_soon" || cs === "in_preparation" || cs === "unpublished") return "interest";
  const operative = p.technicalStatus === "partial" || p.technicalStatus === "available";
  // Disponible: venta directa salvo que la oferta publicada diga expresamente otra cosa (sin oferta conocida, como el
  // panel, cuenta como inmediata); con oferta asistida, contratación asistida si es operativo y tiene precio
  if (cs === "available") {
    const assistedOffer = !!p.offer && !(p.offer.modality === "immediate" && p.offer.checkout === true);
    if (!assistedOffer) return p.hasMonthlyPrice ? "checkout" : "request_info";
    return operative && p.hasMonthlyPrice ? "assisted_contract" : "request_info";
  }
  if (cs === "on_request" && operative && p.hasMonthlyPrice) return "assisted_contract";
  return "request_info";
}

/**
 * Clase de venta de cualquier producto del marketplace con venta por clases: Net de empresa (netSaleKind) o Elephant
 * Connect de contratación asistida (shared/connectAssisted.ts, 12/11/2026). Un Connect vigente con precio mensual se
 * contrata con implantación asistida aunque tenga funcionalidades pendientes o el catálogo diga «próximamente» o «en
 * preparación»: lo pendiente se muestra como «en implantación». Retirado o sin publicar: fuera. null si no aplica
 * (Connect de contratación directa, extras, Life Net…: siguen con su regla de siempre).
 */
export function offerSaleKind(p: NetSaleInput): NetSaleKind | null {
  if (connectAssistedOf(p.key)) {
    // Disponible (venta directa con su Checkout), retirado o sin publicar: la regla de siempre, no la asistida
    if (p.commercialStatus === "available" || p.commercialStatus === "unpublished" || p.commercialStatus === "retired") return null;
    return p.hasMonthlyPrice ? "assisted_contract" : "request_info";
  }
  return netSaleKind(p);
}

/** Producto con venta por clases y su registro de funcionalidades: Net de empresa o Connect asistido. Pura. */
export function assistedProductOf(key: string): { key: string; name: string; areas: NetArea[]; note?: string } | null {
  const net = netProductOf(key);
  if (net) return net.segment === "business" ? net : null;
  return connectAssistedOf(key);
}

/** Funcionalidades disponibles hoy y en implantación de un producto Net (shared/netProducts.ts) o Connect asistido. */
export function netAvailabilitySplit(p: Pick<NetProduct, "areas"> | string): { available: string[]; inImplementation: string[] } {
  const net = typeof p === "string" ? (netProductOf(p) ?? connectAssistedOf(p)) : p;
  if (!net) return { available: [], inImplementation: [] };
  const all = net.areas.flatMap((a) => a.features);
  return { available: all.filter((f) => f.status === "available").map((f) => f.label), inImplementation: all.filter((f) => f.status === "coming_soon").map((f) => f.label) };
}
