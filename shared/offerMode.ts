/**
 * Cómo se ofrece un producto (E-6): precio fijo (se compra como siempre), «bajo petición» o «próximamente».
 * Solo reglas y textos, sin servidor ni navegador: los usan el panel, la web pública y el servidor (que rechaza
 * cualquier compra de un producto que no sea de precio fijo, aunque llegue una petición manipulada).
 */

export const OFFER_MODES = ["fixed", "on_request", "coming_soon"] as const;
export type OfferMode = (typeof OFFER_MODES)[number];

/** Nombre de cada modo en el panel (lenguaje llano). */
export const OFFER_MODE_LABELS: Record<OfferMode, string> = {
  fixed: "Precio fijo",
  on_request: "Bajo petición",
  coming_soon: "Próximamente",
};

/** Ayuda breve de cada modo bajo el selector del formulario de producto. */
export const OFFER_MODE_HELP: Record<OfferMode, string> = {
  fixed: "Se vende en tu web con su precio, como hasta ahora.",
  on_request: "En tu web no se muestra el precio ni se puede comprar: la persona te pide información y la solicitud llega a tu CRM.",
  coming_soon: "Se anuncia en tu web como «Próximamente», sin precio ni compra. Quien se interese te deja sus datos y llega a tu CRM.",
};

/** Etiqueta pública (insignia) de los modos que no son de precio fijo. */
export const OFFER_MODE_PUBLIC_LABELS: Record<Exclude<OfferMode, "fixed">, string> = {
  on_request: "Bajo petición",
  coming_soon: "Próximamente",
};

export const DEFAULT_REQUEST_CTA = "Solicitar información";
export const MAX_REQUEST_CTA_LENGTH = 80;

/** Valor desconocido o ausente (producto anterior a E-6) = precio fijo. */
export function offerModeOf(p: { offerMode?: unknown } | null | undefined): OfferMode {
  const v = p?.offerMode;
  return v === "on_request" || v === "coming_soon" ? v : "fixed";
}

export const isFixedOffer = (p: { offerMode?: unknown } | null | undefined): boolean => offerModeOf(p) === "fixed";

/** Insignia pública («Bajo petición», «Próximamente») o null si es de precio fijo. Nunca «Agotado». */
export function publicOfferBadge(p: { offerMode?: unknown } | null | undefined): string | null {
  const m = offerModeOf(p);
  return m === "fixed" ? null : OFFER_MODE_PUBLIC_LABELS[m];
}

/** Texto del botón de petición de un producto (el que escribió la empresa o «Solicitar información»). */
export function requestCtaLabel(p: { requestCtaLabel?: unknown } | null | undefined): string {
  const v = typeof p?.requestCtaLabel === "string" ? p.requestCtaLabel.replace(/\s+/g, " ").trim().slice(0, MAX_REQUEST_CTA_LENGTH) : "";
  return v || DEFAULT_REQUEST_CTA;
}

/** Aviso del servidor cuando alguien intenta comprar un producto que no se vende online. */
export function notForSaleMessage(title: string, mode: OfferMode): string {
  return mode === "coming_soon"
    ? `«${title}» todavía no está a la venta (próximamente). Quítalo del carrito y solicita información.`
    : `«${title}» se ofrece bajo petición y no se puede comprar online. Quítalo del carrito y solicita información.`;
}

/** Texto limpio (una línea, o varias si `multiline`), sin caracteres de control ni etiquetas: se guarda y se enseña como texto. */
export function cleanText(v: unknown, max: number, multiline = false): string {
  if (typeof v !== "string") return "";
  const noCtl = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
  return (multiline ? noCtl.replace(/[ \t]+/g, " ") : noCtl.replace(/\s+/g, " ")).trim().slice(0, max);
}
