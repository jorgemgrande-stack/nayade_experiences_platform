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
import type { ConnectFaq, ConnectMedia, ConnectPrice } from "../shared/connectCard";
import type { ConnectBrand } from "../shared/connectMarketplace";

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
    media: loose({ cover: media, screenshots: z.unknown().transform((v) => (Array.isArray(v) ? v.map((m) => media.parse(m)).filter((m): m is ConnectMedia => m !== null).slice(0, 12) : null)) }),
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

const headerSchema = loose({ title: text(120), intro: text() });

/** Cabeceras de la entrada `marketplace` del catálogo (`{connect:{title,intro}, net:{…}}`). */
export function parseMarketplaceHeaders(raw: unknown): Partial<Record<ConnectBrand, { title: string | null; intro: string | null }>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<ConnectBrand, { title: string | null; intro: string | null }>> = {};
  for (const b of ["connect", "net"] as const) {
    const h = headerSchema.safeParse((raw as Record<string, unknown>)[b]);
    if (h.success && h.data) out[b] = { title: h.data.title ?? null, intro: h.data.intro ?? null };
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
