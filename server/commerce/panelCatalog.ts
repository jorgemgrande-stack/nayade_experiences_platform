/**
 * Catálogo de módulos y ampliaciones para el PANEL de cada empresa (`GET /cp/v1/commerce/tenants/:t/catalog`).
 *
 * Solo lectura y solo lo publicado: qué existe, en qué estado comercial está y si se puede comprar en línea HOY. No
 * calcula importes de una compra (eso es la vista previa de compra, que sigue siendo la única fuente) ni cambia
 * nada. Lo interno (`internalOnly`) solo lo ven las empresas de prueba autorizadas para comprarlo.
 *
 * Cada elemento lleva su ficha (`card`): la versión PUBLICADA del producto (nunca la parte interna ni precios sin
 * aprobar), para el escaparate y la ficha del marketplace del panel. Sin ficha publicada, `card` es null.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import type { QuoteCatalogProduct } from "../catalog/quote";
import { withoutInternal, type SiteDocument } from "../web/service";
import { videoEmbedUrl, type CommercialBlock } from "../web/schemas";

export interface PanelCatalogItem {
  key: string;
  name: string;
  family: string;
  /** `module`: se activa entero; `quantity`: ampliación por unidades (usuarios, sedes, almacenamiento). */
  kind: "module" | "quantity";
  metric: string | null;
  step: number | null;
  commercialStatus: "coming_soon" | "in_preparation" | "on_request" | "available";
  capabilities: string[];
  /** Precio mensual publicado (sin calcular prorrateos ni impuestos de la empresa). */
  monthly: { amountCents: number; currency: string; taxIncluded: boolean; unit: string | null } | null;
  /** Se puede comprar desde el panel ahora mismo (compra en línea encendida y producto a la venta). */
  purchasable: boolean;
  /** Ficha publicada del marketplace (null: el producto no tiene ficha publicada). */
  card: PanelCard | null;
}

type Img = { src: string; alt: string; caption?: string; mobileSrc?: string; focal?: { x: number; y: number }; kind?: "screenshot" | "illustration" };

/** Ficha del marketplace: imágenes y vídeo. `cover` y `screenshots` se mantienen para el panel actual (reserva de hero y galería). */
export interface PanelMedia {
  card: Img | null;
  hero: Img | null;
  icon: Img | null;
  gallery: Img[];
  video: { url: string; embedUrl: string; title: string } | null;
  cover: Img | null;
  screenshots: Img[];
}

/** Carrusel y cabeceras de marca del marketplace (vacío hasta que se publiquen campañas). */
export interface PanelMarketplace {
  slides: Array<Record<string, unknown>>;
  settings: { autoplayMs: number };
  brands: Array<Record<string, unknown>>;
}

/** Ficha del marketplace: solo contenido publicado; los campos que falten llegan vacíos y el panel usa su reserva. */
export interface PanelCard {
  tagline: string;
  description: string;
  includes: string[];
  requirements: string[];
  dependencies: string[];
  compatibleWith: string[];
  thirdPartyCosts: string | null;
  group: string | null;
  presentation: { icon: string | null; color: string | null; highlight: boolean; forWho: string | null };
  commercial: {
    headline: string;
    valueProposition: string;
    longDescription: string;
    problem: string;
    forWho: string | null;
    benefits: string[];
    excludes: string[];
    integrations: string[];
    coreIntegration: string[];
    compatibleExtensions: string[];
    terms: { commitment: string | null; cancellation: string | null; activation: string | null };
    faq: Array<{ q: string; a: string }>;
    related: string[];
    media: PanelMedia;
    howItWorks: Array<{ title: string; text: string }>;
    promoLabel: string | null;
    layout: { blocks: Array<{ id: string; visible: boolean }>; accentColor: string | null; heroStyle: string | null };
    cta: string;
    seo: { slug: string; title: string; description: string } | null;
  } | null;
  /** Modalidad comercial efectiva publicada (effectiveOffer). */
  offer: Record<string, unknown> | null;
  /** Todos los precios aprobados (mensual, anual, pago único…), con el IVA declarado. */
  prices: Array<{ kind: string; amountCents: number; currency: string; unit: string | null; taxRateBp: number | null; taxIncluded: boolean }>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
const img = (v: unknown): Img | null => {
  const o = v as Partial<Img> | null | undefined;
  if (!o || typeof o.src !== "string" || !/^https:\/\//.test(o.src) || typeof o.alt !== "string") return null;
  const f = o.focal;
  return {
    src: o.src,
    alt: o.alt,
    ...(typeof o.caption === "string" && o.caption ? { caption: o.caption } : {}),
    ...(typeof o.mobileSrc === "string" && /^https:\/\//.test(o.mobileSrc) ? { mobileSrc: o.mobileSrc } : {}),
    ...(f && typeof f.x === "number" && typeof f.y === "number" ? { focal: { x: f.x, y: f.y } } : {}),
    ...(o.kind === "screenshot" || o.kind === "illustration" ? { kind: o.kind } : {}),
  };
};
const imgs = (v: unknown): Img[] => (Array.isArray(v) ? v.map(img).filter((x): x is Img => !!x) : []);

function panelMedia(media: Record<string, unknown>): PanelMedia {
  const cover = img(media.cover);
  const screenshots = imgs(media.screenshots);
  const gallery = imgs(media.gallery);
  const v = media.video as { url?: unknown; title?: unknown } | undefined;
  const embedUrl = v && typeof v.url === "string" ? videoEmbedUrl(v.url) : null;
  return {
    card: img(media.card),
    hero: img(media.hero) ?? cover,
    icon: img(media.icon),
    gallery: gallery.length ? gallery : screenshots.map((s) => ({ ...s, kind: "screenshot" as const })),
    video: embedUrl && typeof v?.title === "string" ? { url: v.url as string, embedUrl, title: v.title } : null,
    cover,
    screenshots,
  };
}

/**
 * Ficha del panel a partir de un producto PUBLICADO del sitio. `visible`: claves que esta empresa ve en el panel
 * (relacionados y extensiones compatibles solo apuntan a productos visibles: nada interno ni retirado).
 */
export function panelCard(p: Record<string, unknown>, visible: ReadonlySet<string>): PanelCard {
  const pres = (p.presentation ?? {}) as Record<string, unknown>;
  const cat = (p.catalog ?? {}) as Record<string, unknown>;
  const m = p.commercial as (Partial<CommercialBlock> & Record<string, unknown>) | undefined;
  const onlyVisible = (keys: unknown) => strs(keys).filter((k) => visible.has(k) && k !== p.key);
  const terms = (m?.terms ?? {}) as Record<string, unknown>;
  const media = (m?.media ?? {}) as Record<string, unknown>;
  const layout = (m?.layout ?? {}) as Record<string, unknown>;
  return {
    tagline: str(p.tagline),
    description: str(p.description),
    includes: strs(p.includes),
    requirements: strs(p.requirements),
    dependencies: strs(p.dependencies),
    compatibleWith: strs(p.compatibleWith),
    thirdPartyCosts: strOrNull(p.thirdPartyCosts),
    group: strOrNull(cat.group),
    presentation: { icon: strOrNull(pres.icon), color: strOrNull(pres.color), highlight: pres.highlight === true, forWho: strOrNull(pres.forWho) },
    commercial: m
      ? {
          headline: str(m.headline),
          valueProposition: str(m.valueProposition),
          longDescription: str(m.longDescription),
          problem: str(m.problem),
          forWho: strOrNull(m.forWho),
          benefits: strs(m.benefits),
          excludes: strs(m.excludes),
          integrations: strs(m.integrations),
          coreIntegration: strs(m.coreIntegration),
          compatibleExtensions: onlyVisible(m.compatibleExtensions),
          terms: { commitment: strOrNull(terms.commitment), cancellation: strOrNull(terms.cancellation), activation: strOrNull(terms.activation) },
          faq: (Array.isArray(m.faq) ? m.faq : []).filter((f): f is { q: string; a: string } => !!f && typeof f.q === "string" && typeof f.a === "string"),
          related: onlyVisible(m.related),
          media: panelMedia(media),
          howItWorks: (Array.isArray(m.howItWorks) ? m.howItWorks : []).filter((s): s is { title: string; text: string } => !!s && typeof s.title === "string" && typeof s.text === "string"),
          promoLabel: strOrNull(m.promoLabel),
          layout: {
            blocks: (Array.isArray(layout.blocks) ? layout.blocks : []).filter((b): b is { id: string; visible: boolean } => !!b && typeof b.id === "string" && typeof b.visible === "boolean"),
            accentColor: strOrNull(layout.accentColor),
            heroStyle: strOrNull(layout.heroStyle),
          },
          cta: str(m.cta) || "contact",
          seo: m.seo && typeof m.seo === "object" ? { slug: str(m.seo.slug), title: str(m.seo.title), description: str(m.seo.description) } : null,
        }
      : null,
    offer: p.offer && typeof p.offer === "object" ? (p.offer as Record<string, unknown>) : null,
    prices: (Array.isArray(p.prices) ? (p.prices as Array<Record<string, unknown>>) : [])
      .filter((x) => !x.draft && typeof x.amountCents === "number")
      .map((x) => ({ kind: str(x.kind), amountCents: x.amountCents as number, currency: str(x.currency), unit: strOrNull(x.unit), taxRateBp: typeof x.taxRateBp === "number" ? x.taxRateBp : null, taxIncluded: x.taxIncluded === true })),
  };
}

export interface PanelCatalog {
  version: string;
  purchasesEnabled: boolean;
  items: PanelCatalogItem[];
  marketplace: PanelMarketplace;
}

/** Ritmo del carrusel por defecto mientras no haya ajuste publicado. */
export const DEFAULT_AUTOPLAY_MS = 6000;

/**
 * Familias que tienen sentido en el panel: módulos (Net, Connect, sectoriales, paquetes) y ampliaciones. Los planes se
 * cambian por otra vía; el uso y los servicios profesionales no se activan desde aquí.
 */
const PANEL_FAMILIES = new Set(["extension", "industry_module", "net_module", "net_bundle", "connect", "connect_bundle", "addon", "extra"]);

export function panelCatalog(products: QuoteCatalogProduct[], o: { version: string; purchasesEnabled: boolean; site?: Pick<SiteDocument, "catalog"> }): PanelCatalog {
  const items: PanelCatalogItem[] = [];
  const published = new Map((o.site?.catalog.products ?? []).map((p) => [p.key, p as Record<string, unknown>]));
  for (const p of products) {
    if (p.commercialStatus === "unpublished") continue;
    const quantity = !!p.addonFor;
    if (!quantity && !PANEL_FAMILIES.has(p.family)) continue;
    const monthly = p.prices.find((x) => x.kind === "monthly") ?? null;
    // Todas las familias del panel se contratan como extensión o módulo sectorial (CONTRACT_FAMILY): a la venta = comprable
    const sellable = p.commercialStatus === "available";
    items.push({
      key: p.key,
      name: p.name,
      family: p.family,
      kind: quantity ? "quantity" : "module",
      metric: p.addonFor?.metric ?? null,
      step: p.addonFor?.step ?? null,
      commercialStatus: p.commercialStatus,
      capabilities: p.capabilities,
      monthly: monthly ? { amountCents: monthly.amountCents, currency: monthly.currency, taxIncluded: monthly.taxIncluded, unit: monthly.unit } : null,
      purchasable: o.purchasesEnabled && sellable,
      card: null,
    });
  }
  // Las fichas, cuando ya se sabe qué ve la empresa (relacionados solo entre productos visibles)
  const visible = new Set(items.map((i) => i.key));
  for (const i of items) {
    const p = published.get(i.key);
    if (p) i.card = panelCard(p, visible);
  }
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.family.localeCompare(b.family) || a.name.localeCompare(b.name, "es"));
  return { version: o.version, purchasesEnabled: o.purchasesEnabled, items, marketplace: { slides: [], settings: { autoplayMs: DEFAULT_AUTOPLAY_MS }, brands: [] } };
}

const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

/** Rutas del Core (montar bajo /commerce), con el mismo token de servicio que la compra. */
export function createPanelCatalogRouter(d: { site: () => Promise<SiteDocument>; purchasesEnabled: boolean; internalTenants?: ReadonlySet<string> }): Router {
  const r = express.Router();
  r.get("/tenants/:tenantId/catalog", requireScope("commerce:purchase"), (req: Request, res: Response, _next: NextFunction) => {
    const parsed = tenant.safeParse(req.params.tenantId);
    if (!parsed.success) return void res.status(400).json({ error: "invalid_request", message: "tenantId" });
    d.site()
      .then((site) => {
        const visible = d.internalTenants?.has(parsed.data) ? site : withoutInternal(site);
        const c = quoteCatalogFromSite(visible);
        res.setHeader("Cache-Control", "no-store");
        res.json({ catalog: panelCatalog(c.products, { version: c.version, purchasesEnabled: d.purchasesEnabled, site: visible }) });
      })
      .catch((e) => {
        opsLog("error", "Commerce", "panel_catalog_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      });
  });
  return r;
}
