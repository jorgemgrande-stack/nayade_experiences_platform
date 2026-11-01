/**
 * Lectura TOLERANTE de lo que el catálogo central añade a cada producto del panel (`card`) y de la entrada
 * `marketplace` (cabeceras de Connect y Net).
 *
 *  - Todo es opcional: un campo ausente, de otro tipo o desconocido se ignora; nunca rompe el catálogo ni los demás
 *    campos (cada uno se valida por separado).
 *  - Solo pasan textos (recortados y con longitud máxima), listas de textos, precios con importe entero y moneda
 *    ISO, y medios con dirección https. Nada de HTML ni de direcciones de otro tipo.
 *  - `card: null` (sin ficha) o ausente → null: la ficha usa la semilla oficial como reserva.
 *  - Lo interno (`internal`) se descarta aunque llegara.
 */
import { z } from "zod";
import { SHEET_ACCENTS, SHEET_BLOCK_IDS, SHEET_HERO_STYLES, type ConnectFaq, type ConnectGalleryItem, type ConnectHowStep, type ConnectImage, type ConnectLayout, type ConnectMedia, type ConnectPrice, type ConnectVideo } from "../shared/connectCard";
import { CONNECT_CATEGORIES, type ConnectBrand } from "../shared/connectMarketplace";
import { SLIDE_SECTIONS, type ConnectActivation, type ConnectSlide, type SlideCta, type SlideImage } from "../shared/connectShowcase";

const MAX_TEXT = 600;
const MAX_LONG = 4000;
const MAX_LIST = 24;

const text = (max = MAX_TEXT) =>
  z
    .unknown()
    .transform((v) => (typeof v === "string" ? v.trim().slice(0, max) : ""))
    .transform((v) => (v ? v : null));

/** Lista vacía = sin contenido (null): la ficha usa la reserva o no muestra la sección. */
const nonEmpty = <T,>(a: T[]): T[] | null => (a.length > 0 ? a : null);

const textList = z.unknown().transform((v) => (Array.isArray(v) ? nonEmpty(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, MAX_TEXT)).filter(Boolean).slice(0, MAX_LIST)) : null));

const keyList = z.unknown().transform((v) => (Array.isArray(v) ? nonEmpty(v.filter((x): x is string => typeof x === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(x)).slice(0, MAX_LIST)) : null));

const bool = z.unknown().transform((v) => (typeof v === "boolean" ? v : null));

/** Objeto con campos validados uno a uno: lo que no encaja queda en null sin tumbar el resto. */
const loose = <T extends z.ZodRawShape>(shape: T) =>
  z.unknown().transform((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(shape)) {
      const r = (schema as z.ZodTypeAny).safeParse((v as Record<string, unknown>)[k]);
      out[k] = r.success ? r.data : null;
    }
    return out as { [K in keyof T]: z.output<T[K]> | null };
  });

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const media = z.unknown().transform((v): ConnectMedia | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const src = typeof o.src === "string" ? o.src.trim() : "";
  const alt = typeof o.alt === "string" ? o.alt.trim().slice(0, 300) : "";
  // Sin texto alternativo no se muestra: la imagen tiene que poder describirse
  if (!HTTPS.test(src) || src.length > 2000 || !alt) return null;
  const caption = typeof o.caption === "string" && o.caption.trim() ? o.caption.trim().slice(0, 300) : null;
  return { src, alt, caption };
});

/** Imagen resuelta por el canal: https, con texto alternativo; `srcset` solo si todas sus fuentes son https. */
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
function readImage(v: unknown): ConnectImage | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const src = typeof o.src === "string" ? o.src.trim() : "";
  const alt = typeof o.alt === "string" ? o.alt.trim().slice(0, 300) : "";
  if (!HTTPS.test(src) || src.length > 2000 || !alt) return null;
  let srcset: string | null = null;
  // El almacén del catálogo envía `srcset: {webp, avif}`; se usa la variante WebP (todos los navegadores la admiten)
  const rawSrcset = o.srcset && typeof o.srcset === "object" && !Array.isArray(o.srcset) ? (o.srcset as Record<string, unknown>).webp : o.srcset;
  if (typeof rawSrcset === "string" && rawSrcset.trim() && rawSrcset.length <= 4000) {
    const parts = rawSrcset.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0 && parts.every((p) => /^https:\/\/[^\s"'<>,]+ \d{1,5}(w|(\.\d+)?x)$/.test(p))) srcset = parts.join(", ");
  }
  const width = num(o.width, 1, 10_000);
  const height = num(o.height, 1, 10_000);
  const f = o.focal && typeof o.focal === "object" ? (o.focal as Record<string, unknown>) : null;
  const fx = f ? num(f.x, 0, 100) : null;
  const fy = f ? num(f.y, 0, 100) : null;
  const kind = o.kind === "screenshot" || o.kind === "illustration" ? o.kind : null;
  const mobile = typeof o.mobileSrc === "string" ? o.mobileSrc.trim() : "";
  const mobileSrc = HTTPS.test(mobile) && mobile.length <= 2000 ? mobile : null;
  return { src, srcset, mobileSrc, width: width === null ? null : Math.round(width), height: height === null ? null : Math.round(height), alt, focal: fx !== null && fy !== null ? { x: fx, y: fy } : null, kind };
}
const image = z.unknown().transform(readImage);

const galleryList = z.unknown().transform((v): ConnectGalleryItem[] | null =>
  Array.isArray(v)
    ? v
        .map((x): ConnectGalleryItem | null => {
          const img = readImage(x);
          if (!img) return null;
          const o = x as Record<string, unknown>;
          // Sin saber si es captura o ilustración no se muestra: la ficha tiene que poder decirlo
          if (!img.kind) return null;
          const caption = typeof o.caption === "string" && o.caption.trim() ? o.caption.trim().slice(0, 300) : null;
          return { ...img, caption, kind: img.kind };
        })
        .filter((x): x is ConnectGalleryItem => x !== null)
        .slice(0, 12)
    : null,
);

/** Vídeo: SOLO la dirección de inserción ya normalizada (youtube-nocookie o player.vimeo) y con título. */
const EMBED = /^https:\/\/(www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{6,20}|player\.vimeo\.com\/video\/\d{1,15})(\?[A-Za-z0-9_=&%.-]{0,200})?$/;
const video = z.unknown().transform((v): ConnectVideo | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const embedUrl = typeof o.embedUrl === "string" ? o.embedUrl.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 160) : "";
  return EMBED.test(embedUrl) && title ? { embedUrl, title } : null;
});

const howList = z.unknown().transform((v): ConnectHowStep[] | null =>
  Array.isArray(v)
    ? nonEmpty(
        v
          .map((x) => (x && typeof x === "object" ? { title: text(60).parse((x as { title?: unknown }).title), text: text(240).parse((x as { text?: unknown }).text) } : null))
          .filter((x): x is ConnectHowStep => !!x && !!x.title && !!x.text)
          .slice(0, 4),
      )
    : null,
);

type BlockId = ConnectLayout["blocks"][number]["id"];
const layout = z.unknown().transform((v): ConnectLayout | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const blocks = Array.isArray(o.blocks)
    ? o.blocks
        .filter((b): b is { id: BlockId; visible?: unknown } => !!b && typeof b === "object" && (SHEET_BLOCK_IDS as readonly unknown[]).includes((b as { id?: unknown }).id))
        // Solo se oculta lo que el catálogo marca expresamente como no visible
        .map((b) => ({ id: b.id, visible: b.visible !== false }))
        .slice(0, 24)
    : [];
  const accentColor = (SHEET_ACCENTS as readonly unknown[]).includes(o.accentColor) ? (o.accentColor as ConnectLayout["accentColor"]) : null;
  const heroStyle = (SHEET_HERO_STYLES as readonly unknown[]).includes(o.heroStyle) ? (o.heroStyle as ConnectLayout["heroStyle"]) : null;
  return { blocks, accentColor, heroStyle };
});

const price = z.unknown().transform((v): ConnectPrice | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = typeof o.kind === "string" && /^[a-z_]{1,32}$/.test(o.kind) ? o.kind : null;
  const amountCents = typeof o.amountCents === "number" && Number.isInteger(o.amountCents) && o.amountCents >= 0 ? o.amountCents : null;
  const currency = typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null;
  if (!kind || amountCents === null || !currency) return null;
  const unit = typeof o.unit === "string" && o.unit.trim() ? o.unit.trim().slice(0, 60) : null;
  const taxRateBp = typeof o.taxRateBp === "number" && Number.isInteger(o.taxRateBp) && o.taxRateBp >= 0 && o.taxRateBp <= 10_000 ? o.taxRateBp : null;
  return { kind, amountCents, currency, unit, taxRateBp, taxIncluded: o.taxIncluded === true };
});

const priceList = z.unknown().transform((v) => (Array.isArray(v) ? v.map((p) => price.parse(p)).filter((p): p is ConnectPrice => p !== null).slice(0, 12) : null));

const faqList = z.unknown().transform((v): ConnectFaq[] | null =>
  Array.isArray(v)
    ? v
        .map((x) => (x && typeof x === "object" ? { q: text().parse((x as { q?: unknown }).q), a: text(MAX_LONG).parse((x as { a?: unknown }).a) } : null))
        .filter((x): x is ConnectFaq => !!x && !!x.q && !!x.a)
        .slice(0, MAX_LIST)
    : null,
);

/**
 * `offer`: la modalidad comercial EFECTIVA publicada (`{modality, label, activationNotes, cta, …}`). Solo pasan su
 * etiqueta pública y las condiciones de activación; los motivos internos (`reasons`) nunca.
 */
export interface ConnectOffer {
  label: string | null;
  activationNotes: string | null;
}
const offer = z.unknown().transform((v): ConnectOffer | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const label = text(80).parse(o.label);
  const activationNotes = text().parse(o.activationNotes);
  return label || activationNotes ? { label, activationNotes } : null;
});

const cardSchema = loose({
  tagline: text(),
  description: text(MAX_LONG),
  includes: textList,
  requirements: textList,
  dependencies: keyList,
  compatibleWith: keyList,
  thirdPartyCosts: text(),
  group: text(80),
  offer,
  prices: priceList,
  presentation: loose({ icon: text(40), highlight: bool, forWho: text() }),
  commercial: loose({
    headline: text(),
    longDescription: text(MAX_LONG),
    problem: text(MAX_LONG),
    valueProposition: text(),
    forWho: text(),
    benefits: textList,
    excludes: textList,
    integrations: textList,
    compatibleExtensions: keyList,
    coreIntegration: textList,
    terms: loose({ commitment: text(), cancellation: text(), activation: text() }),
    faq: faqList,
    related: keyList,
    media: loose({
      card: image,
      hero: image,
      icon: image,
      gallery: galleryList,
      video,
      // Forma anterior (portada y capturas): solo como reserva mientras llegue
      cover: media,
      screenshots: z.unknown().transform((v) => (Array.isArray(v) ? v.map((m) => media.parse(m)).filter((m): m is ConnectMedia => m !== null).slice(0, 12) : null)),
    }),
    howItWorks: howList,
    promoLabel: text(30),
    layout,
  }),
});

export type ConnectCard = NonNullable<z.output<typeof cardSchema>>;

/** Ficha del catálogo central, o null si no la hay (o no es un objeto). Nunca lanza. */
export function parseConnectCard(raw: unknown): ConnectCard | null {
  const r = cardSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Precios de nivel de producto (fuera de `card`), por si el catálogo los publica ahí. */
export function parseConnectPrices(raw: unknown): ConnectPrice[] | null {
  const r = priceList.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseConnectOffer(raw: unknown): ConnectOffer | null {
  const r = offer.safeParse(raw);
  return r.success ? r.data : null;
}

const headerSchema = loose({ title: text(120), intro: text(), subtitle: text() });

/** Cabeceras de la entrada `marketplace` del catálogo (`{connect:{title,intro}, net:{…}}`). */
export function parseMarketplaceHeaders(raw: unknown): Partial<Record<ConnectBrand, { title: string | null; intro: string | null }>> {
  if (!raw || typeof raw !== "object") return {};
  // Forma acordada: `marketplace.brands.{connect,net}`; si no trae ninguna, la anterior (`marketplace.{connect,net}`)
  const rawBrands = (raw as { brands?: unknown }).brands;
  const brands = Array.isArray(rawBrands)
    ? Object.fromEntries(
        rawBrands
          .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
          .map((b) => [typeof b.key === "string" ? b.key : typeof b.id === "string" ? b.id : "", b] as const)
          .filter(([k]) => k === "connect" || k === "net"),
      )
    : rawBrands;
  if (brands && typeof brands === "object" && !Array.isArray(brands)) {
    const fromBrands = parseMarketplaceHeaders(brands);
    if (Object.keys(fromBrands).length > 0) return fromBrands;
  }
  const out: Partial<Record<ConnectBrand, { title: string | null; intro: string | null }>> = {};
  for (const b of ["connect", "net"] as const) {
    const h = headerSchema.safeParse((raw as Record<string, unknown>)[b]);
    if (h.success && h.data) out[b] = { title: h.data.title ?? null, intro: h.data.intro ?? h.data.subtitle ?? null };
  }
  return out;
}

/**
 * El catálogo indica que acepta solicitudes desde el panel (oportunidad en el CRM): lo anuncia expresamente o es la
 * versión del canal que publica fichas (`card` en los productos, aunque sea null), que llega junto con las
 * solicitudes. Si aun así la llamada da 404 sin más, el router vuelve al ticket y deja de ofrecer «Me interesa».
 */
export function advertisesRequests(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as { requests?: unknown; features?: unknown; items?: unknown };
  if (Array.isArray(c.items) && c.items.some((i) => !!i && typeof i === "object" && Object.prototype.hasOwnProperty.call(i, "card"))) return true;
  if (c.requests === true || (c.requests && typeof c.requests === "object" && (c.requests as { enabled?: unknown }).enabled === true)) return true;
  if (Array.isArray(c.features)) return c.features.includes("requests");
  return !!c.features && typeof c.features === "object" && (c.features as { requests?: unknown }).requests === true;
}

// ── Escaparate: carrusel del catálogo raíz (`marketplace.slides`) y estado de activación ──────────────

/** Enlaces externos de una diapositiva: solo páginas propias (https de *.bigelephant.es). */
const SLIDE_URL = /^https:\/\/([a-z0-9-]+\.)*bigelephant\.es(\/[^\s"'<>]*)?$/;
const FAMILIES = new Set<string>(CONNECT_CATEGORIES.flatMap((c) => c.families as readonly string[]));

function readCta(v: unknown): SlideCta | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const label = text(40).parse(o.label);
  const t = o.target && typeof o.target === "object" ? (o.target as Record<string, unknown>) : null;
  const value = t && typeof t.value === "string" ? t.value.trim() : "";
  if (!label || !t || !value) return null;
  switch (t.type) {
    case "section":
      return (SLIDE_SECTIONS as readonly string[]).includes(value) ? { label, target: { type: "section", value } } : null;
    case "category":
      return FAMILIES.has(value) ? { label, target: { type: "category", value } } : null;
    case "product":
      return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value) ? { label, target: { type: "product", value } } : null;
    case "url":
      return SLIDE_URL.test(value) && value.length <= 500 ? { label, target: { type: "url", value } } : null;
    default:
      return null;
  }
}

function readSlideImage(v: unknown): SlideImage | null {
  const img = readImage(v);
  if (!img) return null;
  const o = v as Record<string, unknown>;
  const position = typeof o.position === "string" && /^[a-z0-9% .-]{1,40}$/i.test(o.position) ? o.position : null;
  return { ...img, position };
}

const when = (v: unknown) => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

const OVERLAYS: Record<string, number> = { none: 0, light: 0.35, dark: 0.6, strong: 0.75 };

function readSlide(v: unknown, index: number): ConnectSlide | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : null;
  const title = text(90).parse(o.title);
  if (!id || !title) return null;
  const overlay = typeof o.overlay === "number" ? num(o.overlay, 0, 0.9) : typeof o.overlay === "string" && o.overlay in OVERLAYS ? OVERLAYS[o.overlay] : null;
  const productKey = typeof o.productKey === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(o.productKey) ? o.productKey : null;
  return {
    id,
    title,
    subtitle: text(140).parse(o.subtitle),
    description: text(280).parse(o.description),
    background: readSlideImage(o.background),
    visual: readImage(o.visual),
    overlay,
    primaryCta: readCta(o.primaryCta),
    secondaryCta: readCta(o.secondaryCta),
    productKey,
    order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : index,
    tags: (textList.parse(o.tags) ?? []).map((t) => t.slice(0, 30)).slice(0, 6),
    startsAt: when(o.startsAt),
    endsAt: when(o.endsAt),
  };
}

export interface MarketplaceRoot {
  slides: ConnectSlide[];
  /** Rotación automática pedida por el catálogo (ms); null = la de por defecto; 0 = sin rotación. */
  autoplayMs: number | null;
}

/** Diapositivas y ajustes del carrusel (`marketplace.slides` y `marketplace.settings`). Nunca lanza. */
export function parseMarketplaceRoot(raw: unknown): MarketplaceRoot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { slides: [], autoplayMs: null };
  const m = raw as Record<string, unknown>;
  const ids = new Set<string>();
  const slides = (Array.isArray(m.slides) ? m.slides : [])
    .slice(0, 24)
    .map((x, i) => readSlide(x, i))
    .filter((x): x is ConnectSlide => {
      if (!x || ids.has(x.id)) return false;
      ids.add(x.id);
      return true;
    });
  const settings = m.settings && typeof m.settings === "object" && !Array.isArray(m.settings) ? (m.settings as Record<string, unknown>) : {};
  const ms = num(settings.autoplayMs, 0, 120_000);
  return { slides, autoplayMs: ms === null ? null : Math.round(ms) };
}

const ACTIVATION_STATES = ["none", "pending", "processing", "active", "error"] as const;

/** Estado de activación que publica el canal para cada producto (`activation`), o null si no llega o es raro. */
export function parseActivation(raw: unknown): ConnectActivation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!(ACTIVATION_STATES as readonly unknown[]).includes(o.state)) return null;
  const at = when(o.updatedAt);
  return { state: o.state as ConnectActivation["state"], retryable: o.retryable === true, updatedAt: at === null ? null : new Date(at).toISOString() };
}
