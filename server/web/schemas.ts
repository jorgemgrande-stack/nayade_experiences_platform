/**
 * Esquemas del catálogo comercial y de los contenidos de la web. Cada tipo de entrada valida su
 * borrador con zod (campos desconocidos = error) y tiene una proyección PÚBLICA que es lo único que
 * sale hacia la web: nunca notas internas, costes, márgenes ni datos de autoría.
 */
import { z } from "zod";
import { OFFER_CTAS, OFFER_MODALITIES } from "../catalog/commercial/offer";

export const ENTRY_KINDS = ["product", "promotion", "faq", "menu", "seo", "page", "forms", "capability"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * Familia comercial (categoría de producto). Las cinco primeras son las originales; las de Elephant
 * Source (catálogo oficial v1) añaden los submódulos y paquetes de Elephant Net, las extensiones y
 * paquetes de Elephant Connect, los extras con capacidad propia y los complementos de cantidad.
 */
export const FAMILIES = ["core_plan", "extension", "industry_module", "usage", "service", "net_module", "net_bundle", "connect", "connect_bundle", "extra", "addon"] as const;
export type Family = (typeof FAMILIES)[number];
/** Familias que son paquetes: su precio sustituye al de sus componentes (`catalog.bundleOf`). */
export const BUNDLE_FAMILIES: readonly Family[] = ["net_bundle", "connect_bundle"];
/**
 * Estado COMERCIAL (qué puede hacer el visitante), independiente del técnico (instalado, habilitado, contratado):
 *  - unpublished: no se muestra
 *  - coming_soon: «Próximamente» — previsto, todavía no se puede implantar (no se contrata)
 *  - in_preparation: «En preparación» — en desarrollo o validación (no se contrata)
 *  - on_request: «Implantación acompañada» — operativo; lo implanta el equipo con el cliente (exige estado técnico
 *    «available» o «partial»)
 *  - available: «Disponible» — completo, comprobado y preparado para ofrecerse (exige estado técnico «available»)
 */
export const COMMERCIAL_STATUS = ["unpublished", "coming_soon", "in_preparation", "on_request", "available"] as const;
/** Etiquetas comerciales normalizadas (las mismas en el CRM, la web y el panel de la empresa). */
export const COMMERCIAL_STATUS_LABEL: Record<(typeof COMMERCIAL_STATUS)[number], string> = {
  unpublished: "No publicado",
  coming_soon: "Próximamente",
  in_preparation: "En preparación",
  on_request: "Implantación acompañada",
  available: "Disponible",
};
export type CommercialStatus = (typeof COMMERCIAL_STATUS)[number];
/** Mecanismo técnico de activación (independiente de la familia y de la facturación). */
export const ACTIVATIONS = ["plan", "module", "feature", "usage", "service", "none"] as const;
/** Modalidad de facturación. */
export const BILLING_MODELS = ["subscription", "recurring_addon", "usage", "credits", "one_time"] as const;
export const TECHNICAL_STATUS = ["available", "partial", "planned"] as const;
export const PRICE_KINDS = ["monthly", "yearly", "one_time", "usage"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

/** Clave estable: minúsculas, números y guiones (también las usan las URL y los formularios). */
export const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const entryKey = z.string().regex(KEY_RE);
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().default(null);
/** Enlace interno (/ruta) o https. Nada de javascript:, data: ni http en claro. */
const href = z.string().trim().max(300).regex(/^(\/[^\s]*|https:\/\/[^\s]+|mailto:[^\s@]+@[^\s]+)$/);
/** Métrica de consumo o cupo (users, sites, storage_gb…), igual que las de ERM. */
const metric = z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/);
/**
 * Estado de una regla comercial: approved = decidida por el propietario; proposed = pendiente de aprobación.
 * Lo propuesto se guarda y se simula en el CRM, pero NUNCA sale en la proyección pública ni en el cotizador público.
 */
export const DECISION_STATUS = ["approved", "proposed"] as const;
const decision = z.enum(DECISION_STATUS);
/** Extensión incluida en un plan (solo en core_plan; los planes superiores la heredan). */
const planInclusion = z
  .object({
    key: entryKey,
    mode: z.enum(["full", "partial"]),
    status: decision,
    /** Tope de una inclusión parcial: empleados base más, si se indica, los usuarios por encima del cupo. */
    cap: z.object({ metric: z.literal("employees"), base: z.number().int().min(0).max(100_000), plusExtraOf: z.literal("users").optional(), status: decision }).strict().optional(),
    /** Qué se contrata al superar el tope (a precio de catálogo). */
    overflowKey: entryKey.optional(),
    /** Lo que la inclusión no cubre (se muestra en el desglose). */
    excludes: text(300).optional(),
  })
  .strict()
  .refine((i) => i.mode !== "partial" || !!i.cap, { path: ["cap"], message: "una inclusión parcial necesita tope" })
  .refine((i) => i.mode !== "full" || (!i.cap && !i.overflowKey), { path: ["cap"], message: "una inclusión completa no tiene tope" });
export type PlanInclusionDraft = z.infer<typeof planInclusion>;
/** Llamada a la acción de la ficha: demostración, contacto o lista de espera. */
export const COMMERCIAL_CTA = ["demo", "contact", "waitlist"] as const;
/** Estado funcional verificado en el ecosistema (interno): en uso, parcial, prototipo, sin desarrollo. */
export const FUNCTIONAL_GRADES = ["in_use", "partial", "prototype", "none"] as const;
/** Imagen real de la ficha: solo https de un almacén público, con texto alternativo. */
const httpsSrc = z.string().trim().max(500).regex(/^https:\/\/[^\s]+$/);
const mediaImage = z.object({ src: httpsSrc, alt: text(160).min(1) }).strict();
/** Punto de interés de una imagen (porcentaje desde la esquina superior izquierda) para recortes responsive. */
const focal = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict();
/** Paleta cerrada de color de apoyo de la ficha: el panel la traduce a su tema (contraste garantizado). */
export const ACCENT_COLORS = ["blue", "teal", "violet", "amber", "rose", "slate"] as const;
export const HERO_STYLES = ["image", "split", "plain"] as const;
/** Bloques ordenables de la ficha del marketplace. */
export const SHEET_BLOCKS = ["problem", "benefits", "features", "howItWorks", "includes", "excludes", "integration", "gallery", "requirements", "terms", "faq", "related"] as const;
/**
 * Vídeo de la ficha: solo YouTube o Vimeo, servido en su modo de privacidad mejorada. Devuelve la URL para incrustar o
 * null si el enlace no es de un proveedor admitido.
 */
export function videoEmbedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const yt = host === "youtube.com" && u.pathname === "/watch" ? u.searchParams.get("v") : host === "youtu.be" ? u.pathname.slice(1) : null;
  if (yt !== null) return /^[\w-]{6,20}$/.test(yt) ? `https://www.youtube-nocookie.com/embed/${yt}` : null;
  const vm = host === "vimeo.com" ? /^\/(\d{4,12})$/.exec(u.pathname) : null;
  return vm ? `https://player.vimeo.com/video/${vm[1]}?dnt=1` : null;
}
/** Ficha comercial pública (contenido, sin precios: los importes solo viven en los precios aprobados). */
const commercialBlock = z
  .object({
    headline: text(200).default(""),
    longDescription: text(2000).default(""),
    problem: text(300).default(""),
    /** Para qué empresa resulta útil. Opcional y sin valor por defecto: así las versiones publicadas antes del campo se reconstruyen igual (publicación por lotes y reversión). */
    forWho: text(300).optional(),
    benefits: z.array(text(160).min(1)).max(6).default([]),
    excludes: z.array(text(200).min(1)).max(30).default([]),
    compatibleExtensions: z.array(entryKey).max(20).default([]),
    capacityRules: z.array(text(200).min(1)).max(12).default([]),
    integrations: z.array(text(200).min(1)).max(12).default([]),
    cta: z.enum(COMMERCIAL_CTA).default("contact"),
    seo: z.object({ slug: entryKey, title: text(70).min(1), description: text(160).min(1) }).strict().nullable().default(null),
    // ── Ficha del marketplace del panel (Elephant Connect y Net). Opcional y SIN valor por defecto, como forWho: las
    // versiones publicadas antes de estos campos se reconstruyen igual (publicación por lotes y reversión) ──
    /** Propuesta de valor en una frase. */
    valueProposition: text(300).optional(),
    /** Qué conecta con tu Elephant Core. */
    coreIntegration: z.array(text(160).min(1)).max(8).optional(),
    /** Condiciones: permanencia, baja y puesta en marcha. */
    terms: z.object({ commitment: text(300).optional(), cancellation: text(300).optional(), activation: text(300).optional() }).strict().optional(),
    /** Preguntas frecuentes de la ficha. */
    faq: z.array(z.object({ q: text(200).min(3), a: text(1000).min(1) }).strict()).max(10).optional(),
    /** Productos relacionados (claves del catálogo). */
    related: z.array(entryKey).max(6).optional(),
    /**
     * Imágenes y vídeo reales (nunca inventados): tarjeta, cabecera, icono, galería (captura real o ilustración) y vídeo.
     * `cover` y `screenshots` son los nombres anteriores: se aceptan y sirven de reserva de `hero` y `gallery`.
     */
    media: z
      .object({
        card: mediaImage.extend({ focal: focal.optional() }).strict().optional(),
        hero: mediaImage.extend({ mobileSrc: httpsSrc.optional(), focal: focal.optional() }).strict().optional(),
        icon: mediaImage.optional(),
        gallery: z.array(mediaImage.extend({ caption: text(160).optional(), kind: z.enum(["screenshot", "illustration"]) }).strict()).max(12).optional(),
        video: z.object({ url: z.string().trim().max(300).refine((u) => videoEmbedUrl(u) !== null, "solo YouTube o Vimeo"), title: text(120).min(1) }).strict().optional(),
        cover: mediaImage.optional(),
        screenshots: z.array(mediaImage.extend({ caption: text(160).optional() }).strict()).max(8).optional(),
      })
      .strict()
      .optional(),
    /** Cómo funciona, en pasos. */
    howItWorks: z.array(z.object({ title: text(60).min(1), text: text(240).min(1) }).strict()).max(4).optional(),
    /** Etiqueta promocional breve de la tarjeta (p. ej. «Nuevo»). */
    promoLabel: text(30).min(1).optional(),
    /** Diseño de la ficha: orden y visibilidad de bloques, color de apoyo de la paleta y estilo de cabecera. */
    layout: z
      .object({
        blocks: z
          .array(z.object({ id: z.enum(SHEET_BLOCKS), visible: z.boolean() }).strict())
          .max(SHEET_BLOCKS.length)
          .refine((b) => new Set(b.map((x) => x.id)).size === b.length, "bloque repetido")
          .optional(),
        accentColor: z.enum(ACCENT_COLORS).optional(),
        heroStyle: z.enum(HERO_STYLES).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CommercialBlock = z.infer<typeof commercialBlock>;

export const productDraft = z
  .object({
    name: text(120).min(1),
    tagline: text(200).default(""),
    description: text(2000).default(""),
    technicalStatus: z.enum(TECHNICAL_STATUS),
    activation: z.object({ kind: z.enum(ACTIVATIONS), ref: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).nullable().default(null) }).strict(),
    billingModel: z.enum(BILLING_MODELS),
    /** Periodicidad de referencia de la cuota (la de los precios manda). */
    billingNote: optText(300),
    limits: z.array(z.object({ label: text(80).min(1), value: text(80).min(1), metric: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/).nullable().default(null) }).strict()).max(20).default([]),
    /** Otros productos que deben estar contratados (claves). */
    dependencies: z.array(entryKey).max(20).default([]),
    /** Planes base con los que es compatible (claves de core_plan); vacío = todos. */
    compatibleWith: z.array(entryKey).max(20).default([]),
    /** Requisitos de configuración (cuentas de terceros, datos, dominio…). */
    requirements: z.array(text(200).min(1)).max(20).default([]),
    thirdPartyCosts: optText(500),
    includes: z.array(text(160).min(1)).max(30).default([]),
    presentation: z
      .object({
        icon: z.string().regex(/^[a-z-]{1,30}$/).default("puzzle"),
        color: z.string().regex(/^(#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))$/).default("var(--ink)"),
        highlight: z.boolean().default(false),
        /** Texto «Hoy:» con el estado real. */
        today: optText(500),
        forWho: optText(300),
        note: optText(300),
        sectorSlug: entryKey.nullable().default(null),
        moduleSlug: entryKey.nullable().default(null),
      })
      .strict()
      .prefault({}),
    /** Modelo comercial de Elephant Source (todo opcional: las entradas anteriores siguen siendo válidas). */
    catalog: z
      .object({
        commercialStatus: z.enum(COMMERCIAL_STATUS).default("on_request"),
        /**
         * Producto INTERNO de pruebas: nunca aparece en ninguna salida pública (web, vista previa, cotizador público,
         * instantánea) ni se contrata por autoservicio; solo lo compran las empresas de prueba autorizadas.
         */
        internalOnly: z.boolean().optional(),
        /** Capacidades (ids estables de server/catalog/capabilities.ts) que concede el producto. */
        capabilities: z.array(entryKey).max(80).default([]),
        /** Planes acumulativos: Business hereda de Essential y Enterprise de Business. */
        inherits: entryKey.nullable().default(null),
        /** Familia Net o grupo Connect (hotel, ski, travel…, communications…). */
        group: entryKey.nullable().default(null),
        /** Ámbito de la licencia: toda la empresa o por sede. */
        scope: z.enum(["company", "site"]).default("company"),
        /** Componentes de un paquete: el paquete los sustituye y no se cobran aparte. */
        bundleOf: z.array(entryKey).max(20).default([]),
        /** Cupos incluidos (null = configurable por contrato). Los límites nunca borran datos. */
        quotas: z.array(z.object({ metric, included: z.number().int().min(0).nullable(), unit: text(20).default("") }).strict()).max(20).default([]),
        /** Complemento de cantidad: cada unidad suma `step` a la métrica, solo para esos planes (vacío = todos). */
        addonFor: z.object({ metric, step: z.number().int().min(1), plans: z.array(entryKey).max(5).default([]) }).strict().nullable().default(null),
        /** Unidad de cobro legible («por sede», «por integración»…). */
        chargeUnit: optText(60),
        // ── Política comercial (todo opcional: sin estos campos, el comportamiento es el de siempre) ──
        /** Solo planes: extensiones incluidas. Al público solo llegan las aprobadas. */
        inclusions: z.array(planInclusion).max(30).optional(),
        /** Solo planes: cupos propuestos para los que el catálogo deja «por contrato». Nunca se publican. */
        quotaProposals: z.array(z.object({ metric, included: z.number().int().min(0).max(100_000_000) }).strict()).max(20).optional(),
        /** Solo planes: por encima del cupo y sin complemento, la ampliación se presupuesta (nunca se inventa tarifa). */
        quoteOnRequest: z.object({ status: decision }).strict().optional(),
        /** Solo paquetes: cómo se resuelve un paquete con componentes incluidos en el plan. */
        bundleRule: z.object({ kind: z.enum(["catalog", "min2"]), status: decision }).strict().optional(),
        /**
         * Solo soluciones Elephant Net completas: Elephant Core (nivel `plan`) incluido en el precio total. `upgrade`:
         * ampliar Core cobrando la diferencia de tarifas aprobadas; `additional`: Net adicional sin volver a pagar Core.
         * Sin la regla aprobada correspondiente, esa parte se presupuesta (nunca se cobra Core dos veces).
         */
        coreIncluded: z
          .object({
            plan: entryKey,
            status: decision,
            /** `yearlyPlans`: planes con ampliación anual aprobada (sin estar en la lista, la anual se presupuesta). */
            upgrade: z.object({ kind: z.literal("difference"), status: decision, yearlyPlans: z.array(entryKey).max(3).optional() }).strict().optional(),
            additional: z.object({ kind: z.literal("core_credit"), status: decision }).strict().optional(),
          })
          .strict()
          .optional(),
        /** 1 activable desde el Core · 2 portable desde otro desarrollo · 3 desarrollo nuevo. */
        implementationLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        /**
         * Modalidad comercial declarada: inmediata (prueba y/o checkout) o implantación asistida (propuesta). Opcional y
         * SIN valores por defecto: lo publicado antes del campo se reconstruye igual desde el historial. Lo que se
         * publica es el resultado efectivo (`effectiveOffer`, server/catalog/commercial/offer.ts).
         */
        offer: z
          .object({
            modality: z.enum(OFFER_MODALITIES).optional(),
            trial: z.boolean().optional(),
            checkout: z.boolean().optional(),
            cta: z.enum(OFFER_CTAS).optional(),
            /** Condiciones de activación (texto corto, público). */
            activationNotes: text(300).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .prefault({}),
    /** Ficha comercial pública (descripción completa, beneficios, exclusiones, SEO…). */
    commercial: commercialBlock.optional(),
    /** Solo para el equipo: nunca se publica. */
    internal: z
      .object({
        notes: optText(2000),
        costCents: z.number().int().min(0).nullable().default(null),
        marginNote: optText(300),
        /** Evidencia del estado comercial (código, pruebas, verificaciones): sin ella, el CRM lo marca como pendiente. */
        evidence: optText(1000),
        functionalGrade: z.enum(FUNCTIONAL_GRADES).optional(),
        /** Repositorios e identificadores F-… de origen. */
        sources: z.array(text(200).min(1)).max(20).optional(),
        /** Decisiones comerciales pendientes que afectan al producto. */
        pendingDecisions: z.array(text(200).min(1)).max(20).optional(),
      })
      .strict()
      .prefault({}),
  })
  .strict();
export type ProductDraft = z.infer<typeof productDraft>;

/** Capacidad comercial: la clave es un id estable del registro de capacidades. */
export const capabilityDraft = z
  .object({
    name: text(120).min(1),
    description: text(600).default(""),
    tier: z.enum(["essential", "business", "enterprise", "extra"]),
    group: entryKey,
    technicalStatus: z.enum(TECHNICAL_STATUS),
  })
  .strict();
export type CapabilityDraft = z.infer<typeof capabilityDraft>;

export const promotionDraft = z
  .object({
    name: text(120).min(1),
    description: text(500).default(""),
    discount: z.object({ kind: z.enum(["percent", "amount"]), value: z.number().int().min(1).max(10_000_000) }).strict(),
    products: z.array(entryKey).min(1).max(30),
    startsAt: z.number().int().min(0).nullable().default(null),
    endsAt: z.number().int().min(0).nullable().default(null),
    conditions: optText(500),
    internal: z.object({ notes: optText(1000) }).strict().prefault({}),
  })
  .strict()
  .refine((p) => p.discount.kind !== "percent" || p.discount.value <= 100, { path: ["discount", "value"], message: "percent ≤ 100" })
  .refine((p) => !p.startsAt || !p.endsAt || p.startsAt < p.endsAt, { path: ["endsAt"], message: "endsAt > startsAt" });

export const faqDraft = z
  .object({ items: z.array(z.object({ q: text(300).min(3), a: text(2000).min(1), topic: z.enum(["producto", "prueba", "precios", "seguridad"]) }).strict()).max(80) })
  .strict();
const link = z.object({ label: text(60).min(1), href }).strict();
export const menuDraft = z
  .object({ items: z.array(link).max(12).default([]), groups: z.array(z.object({ title: text(60).min(1), links: z.array(link).max(12) }).strict()).max(6).default([]) })
  .strict();
export const seoDraft = z
  .object({
    routes: z
      .array(z.object({ path: z.string().regex(/^\/[a-z0-9/-]*$/), title: text(70).min(1), description: text(170).min(1), noindex: z.boolean().default(false) }).strict())
      .max(100),
  })
  .strict();
/** Páginas de texto: cuerpo en texto con «## » para títulos y «- » para listas (sin HTML). */
export const pageDraft = z.object({ title: text(120).min(1), lead: text(400).default(""), body: text(30000).default(""), draftNotice: z.boolean().default(false) }).strict();
const formType = z.object({ enabled: z.boolean(), intro: optText(400) }).strict();
export const formsDraft = z
  .object({
    types: z.object({ trial: formType, onboarding: formType, contact: formType }).strict(),
    privacyVersion: z.string().regex(/^[a-z0-9.-]{1,32}$/),
  })
  .strict();

export const DRAFT_SCHEMAS: Record<EntryKind, z.ZodTypeAny> = {
  product: productDraft,
  promotion: promotionDraft,
  faq: faqDraft,
  menu: menuDraft,
  seo: seoDraft,
  page: pageDraft,
  forms: formsDraft,
  capability: capabilityDraft,
};

/**
 * Proyección pública: quita todo lo interno y toda regla comercial que no esté aprobada. Con la política comercial
 * desactivada en el entorno (`policy: false`, por defecto) tampoco publica las aprobadas: el cotizador público, las
 * propuestas, los contratos, los pedidos y los cobros siguen calculando con el catálogo como hasta ahora.
 */
export function publicView(kind: EntryKind, draft: Record<string, unknown>, opts: { policy?: boolean } = {}): Record<string, unknown> {
  if (kind === "product") {
    const { internal: _i, ...rest } = draft;
    return rest.catalog ? { ...rest, catalog: publicCatalog(rest.catalog as Record<string, unknown>, !!opts.policy) } : rest;
  }
  if (kind === "promotion") {
    const { internal: _i, ...rest } = draft;
    return rest;
  }
  return draft;
}

/**
 * Política comercial publicable: solo inclusiones aprobadas (y, si son parciales, con el tope aprobado), sin cupos
 * propuestos, y regla de paquetes y ampliación por presupuesto solo si están aprobadas. Sin política, no añade nada.
 */
function publicCatalog(cat: Record<string, unknown>, policy: boolean): Record<string, unknown> {
  const { quotaProposals: _q, inclusions, quoteOnRequest, bundleRule, coreIncluded, ...rest } = cat as Record<string, unknown> & {
    inclusions?: PlanInclusionDraft[];
    quoteOnRequest?: { status: string };
    bundleRule?: { status: string };
    coreIncluded?: { status: string; upgrade?: { status: string }; additional?: { status: string } };
  };
  const out: Record<string, unknown> = { ...rest };
  if (!policy) return out;
  if (inclusions) out.inclusions = inclusions.filter((i) => i.status === "approved" && (!i.cap || i.cap.status === "approved"));
  if (quoteOnRequest?.status === "approved") out.quoteOnRequest = quoteOnRequest;
  if (bundleRule?.status === "approved") out.bundleRule = bundleRule;
  if (coreIncluded?.status === "approved") {
    const { upgrade, additional, ...ci } = coreIncluded;
    out.coreIncluded = { ...ci, ...(upgrade?.status === "approved" ? { upgrade } : {}), ...(additional?.status === "approved" ? { additional } : {}) };
  }
  return out;
}
