/**
 * Modalidad comercial de un producto del catálogo: cómo se contrata (función pura, sin BD).
 *
 *  - Inmediata: prueba de 15 días y/o checkout automático. Solo si el producto está «Disponible» (estado comercial)
 *    y operativo (estado técnico «available»), y si de verdad ofrece algo inmediato (prueba o checkout).
 *  - Implantación asistida: solicitud de propuesta con oportunidad en el CRM; no activa ni cobra nada.
 *
 * Lo configurado vive en `catalog.offer` (opcional). Lo que se publica es siempre el resultado EFECTIVO: lo que la
 * plataforma no puede entregar de inmediato se degrada a implantación asistida, con el motivo. Así la web, el CRM y el
 * cotizador nunca anuncian como inmediato algo que no lo es. El CRM replica estas reglas (src/webOffer.ts).
 */
export const OFFER_MODALITIES = ["immediate", "assisted"] as const;
export type OfferModality = (typeof OFFER_MODALITIES)[number];
export const OFFER_CTAS = ["trial", "checkout", "proposal", "specialist", "configure", "implementation", "advised"] as const;
export type OfferCta = (typeof OFFER_CTAS)[number];
/** CTA de acceso inmediato: solo en modalidad inmediata. */
export const IMMEDIATE_CTAS: readonly OfferCta[] = ["trial", "checkout"];

/** Etiqueta PÚBLICA por modalidad (nunca «Próximamente»). El CRM conserva además las etiquetas internas del estado comercial. */
export const OFFER_MODALITY_LABEL: Record<OfferModality, string> = {
  immediate: "Disponible",
  assisted: "Implantación asistida",
};
export const OFFER_CTA_LABEL: Record<OfferCta, string> = {
  trial: "Prueba de 15 días",
  checkout: "Contratar ahora",
  proposal: "Solicitar propuesta",
  specialist: "Hablar con un especialista",
  configure: "Configurar",
  implementation: "Solicitar implantación",
  advised: "Contratación asesorada",
};

const TECHNICAL_LABEL: Record<string, string> = { available: "disponible", partial: "parcial", planned: "en hoja de ruta" };
const COMMERCIAL_LABEL: Record<string, string> = {
  unpublished: "no publicado",
  coming_soon: "próximamente",
  in_preparation: "en preparación",
  on_request: "implantación acompañada",
  available: "disponible",
};

/** Configuración declarada (`catalog.offer`). */
export interface OfferConfig {
  modality?: OfferModality;
  trial?: boolean;
  checkout?: boolean;
  cta?: OfferCta;
  activationNotes?: string;
}
/** Lo mínimo del producto que decide la modalidad (sirve un borrador, lo publicado o la salida pública). */
export interface OfferSource {
  technicalStatus?: string | null;
  catalog?: { commercialStatus?: string | null; offer?: OfferConfig | null } | null;
  /** Precios publicados (`draft: true` en la vista previa) o del catálogo (`status`). */
  prices?: ReadonlyArray<object> | null;
}
export interface EffectiveOffer {
  modality: OfferModality;
  trial: boolean;
  checkout: boolean;
  cta: OfferCta;
  /** Por qué el resultado difiere de lo configurado (vacío = se aplica tal cual). */
  reasons: string[];
  /** Etiqueta pública de la modalidad. */
  label: string;
  /** Condiciones de activación declaradas (texto corto) o null. */
  activationNotes: string | null;
}

/** Precio publicado y no borrador: aprobado en el catálogo (los borradores de la vista previa no cuentan). */
const hasPublishedPrice = (prices: OfferSource["prices"]) =>
  (prices ?? []).some((x) => {
    const p = x as { draft?: boolean; status?: string };
    return !p.draft && (p.status === undefined || p.status === "approved");
  });

export function effectiveOffer(product: OfferSource): EffectiveOffer {
  const cfg: OfferConfig = product.catalog?.offer ?? {};
  const commercial = product.catalog?.commercialStatus ?? "on_request";
  const technical = product.technicalStatus ?? "planned";
  const reasons: string[] = [];

  let modality: OfferModality = cfg.modality === "immediate" ? "immediate" : "assisted";
  if (modality === "immediate") {
    if (commercial !== "available") {
      reasons.push(`Se ofrecerá como implantación asistida porque el estado comercial es «${COMMERCIAL_LABEL[commercial] ?? commercial}»`);
      modality = "assisted";
    } else if (technical !== "available") {
      reasons.push(`Se ofrecerá como implantación asistida porque el estado técnico es ${TECHNICAL_LABEL[technical] ?? technical}`);
      modality = "assisted";
    }
  }

  let trial = cfg.trial === true;
  let checkout = cfg.checkout === true;
  if (modality === "assisted") {
    if (trial) reasons.push("La prueba de 15 días solo se ofrece en modalidad inmediata");
    if (checkout) reasons.push("El checkout automático solo se ofrece en modalidad inmediata");
    trial = false;
    checkout = false;
  } else if (checkout && !hasPublishedPrice(product.prices)) {
    reasons.push("El checkout automático exige un precio publicado (aprobado)");
    checkout = false;
  }
  // Inmediata sin prueba ni checkout no entrega nada de inmediato
  if (modality === "immediate" && !trial && !checkout) {
    reasons.push("Se ofrecerá como implantación asistida porque no hay prueba ni checkout que activar");
    modality = "assisted";
  }

  const fallback: OfferCta = modality === "assisted" ? "proposal" : trial ? "trial" : "checkout";
  let cta: OfferCta = cfg.cta ?? fallback;
  if (cfg.cta && IMMEDIATE_CTAS.includes(cfg.cta)) {
    if (modality === "assisted") {
      reasons.push(`La llamada a la acción «${OFFER_CTA_LABEL[cfg.cta]}» se sustituye por «${OFFER_CTA_LABEL.proposal}» en implantación asistida`);
      cta = "proposal";
    } else if ((cfg.cta === "trial" && !trial) || (cfg.cta === "checkout" && !checkout)) {
      reasons.push(`La llamada a la acción «${OFFER_CTA_LABEL[cfg.cta]}» no está activa: se usa «${OFFER_CTA_LABEL[fallback]}»`);
      cta = fallback;
    }
  }

  const notes = cfg.activationNotes?.trim();
  return { modality, trial, checkout, cta, reasons, label: OFFER_MODALITY_LABEL[modality], activationNotes: notes ? notes : null };
}
