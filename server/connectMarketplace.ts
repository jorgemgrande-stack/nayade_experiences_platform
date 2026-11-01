/**
 * Elephant Connect — catálogo para el panel de la empresa: el catálogo publicado (plano de control, con precios y si
 * se puede comprar) cruzado con las licencias de ESTA empresa y su plan. Pura: no consulta ni cambia nada.
 *
 * Textos de la ficha: los publica el catálogo central en `card` (lectura tolerante en ./connectCard). Mientras un
 * producto no traiga `card` (o le falte un dato), la reserva es el catálogo oficial v1 (server/catalog/elephantSourceV1.ts),
 * nunca su parte interna (notas, costes, evidencias). Lo que no está en ninguno de los dos no se muestra: ni
 * beneficios, ni preguntas, ni imágenes inventadas. Precios: solo los que publica el canal (los aprobados).
 */
import type { CapabilityGrant } from "./_core/capabilities/model";
import { effectiveStatus } from "./subscriptionOverview";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import type { PanelCatalogItemView } from "./panelModules";
import { parseActivation, parseConnectCard, parseConnectOffer, parseConnectPrices } from "./connectCard";
import { categoryOf, deriveConnectState, type ConnectCategoryId, type ConnectState } from "../shared/connectMarketplace";
import type { ConnectGalleryItem, ConnectImage, ConnectPrice, ConnectSheet } from "../shared/connectCard";
import type { ConnectActivation } from "../shared/connectShowcase";

/** Producto tal como llega del canal: lo de siempre y, opcionalmente, la ficha y los precios aprobados. */
export type ChannelCatalogItem = PanelCatalogItemView & { card?: unknown; prices?: unknown; offer?: unknown; activation?: unknown };

export interface ConnectItem {
  key: string;
  name: string;
  family: string;
  category: ConnectCategoryId;
  kind: "module" | "quantity";
  metric: string | null;
  step: number | null;
  commercialStatus: PanelCatalogItemView["commercialStatus"];
  /** Capacidades que concede (en un paquete, las de sus componentes según el catálogo oficial). */
  capabilities: string[];
  monthly: PanelCatalogItemView["monthly"];
  /** El catálogo lo permite comprar en línea hoy (no dice nada de esta persona: ver `canPurchase`). */
  purchasable: boolean;
  tagline: string | null;
  description: string | null;
  includes: string[];
  requirements: string[];
  forWho: string | null;
  thirdPartyCosts: string | null;
  dependencies: Array<{ key: string; name: string }>;
  plans: string[];
  state: ConnectState;
  reasons: string[];
  /** Nombre del icono del catálogo (el panel lo traduce a uno de su colección; desconocido = genérico). */
  icon: string | null;
  /** Destacado en el escaparate (lo decide el catálogo central). */
  highlight: boolean;
  /** Línea o familia sectorial (hotel, ski…), para agrupar. */
  group: string | null;
  /** Precios aprobados (todos los publicados; si el canal solo da el mensual, ese). */
  prices: ConnectPrice[];
  /** Contenido comercial del catálogo central (vacío si no publica ficha). */
  sheet: ConnectSheet;
  /** De dónde salen los textos: ficha del catálogo central, semilla oficial o ninguno. */
  contentSource: "card" | "seed" | "none";
  /** Estado de activación publicado por el canal (null si no lo publica). */
  activation: ConnectActivation | null;
  /** Ruta real del módulo en el panel (la de su entrada de menú), para «Abrir módulo»; null si no tiene. */
  openPath: string | null;
}

/** Imagen de la forma anterior (`cover`/`screenshots`) como imagen resuelta, mientras el canal la mande. */
const legacyImage = (m: { src: string; alt: string } | null | undefined): ConnectImage | null => (m ? { src: m.src, srcset: null, mobileSrc: null, width: null, height: null, alt: m.alt, focal: null, kind: null } : null);

type Seed = (typeof PRODUCTS)[number];
const seedOf = (key: string): Seed | undefined => PRODUCTS.find((p) => p.key === key);

/** Capacidades de un producto del catálogo oficial (un paquete: las de sus componentes). */
function seedCapabilities(key: string, depth = 0): string[] {
  const p = seedOf(key);
  if (!p || depth > 2) return [];
  const own = p.draft.catalog.capabilities ?? [];
  if (own.length > 0) return own;
  return Array.from(new Set((p.draft.catalog.bundleOf ?? []).flatMap((k) => seedCapabilities(k, depth + 1))));
}

/** El dato de la ficha si viene (aunque sea una lista vacía a propósito); si no, el de la semilla. */
function pick<T>(card: T | null | undefined, seed: T): T {
  return card === null || card === undefined ? seed : card;
}

export function buildConnectCatalog(
  catalog: { items: ChannelCatalogItem[] },
  grants: CapabilityGrant[],
  now: number,
  plan: string | null,
  openPathOf: (capabilities: string[]) => string | null = () => null,
): ConnectItem[] {
  const byKey = new Map(catalog.items.map((i) => [i.key, i]));
  const capsOf = (key: string) => {
    const i = byKey.get(key);
    return i && i.capabilities.length > 0 ? i.capabilities : seedCapabilities(key);
  };
  const capabilityStatus = (c: string) => effectiveStatus(grants, c, now);
  const productActive = (key: string) => {
    const caps = capsOf(key);
    return caps.length > 0 && caps.every((c) => capabilityStatus(c) === "active");
  };
  const productName = (key: string) => byKey.get(key)?.name ?? seedOf(key)?.draft.name ?? key;

  return catalog.items.map((item): ConnectItem => {
    const seed = seedOf(item.key);
    const d = seed?.draft;
    const card = parseConnectCard(item.card);
    const c = card?.commercial ?? null;
    const capabilities = item.kind === "module" ? capsOf(item.key) : [];
    const dependencies = pick(card?.dependencies, d?.dependencies ?? []);
    // Ampliaciones: los planes a los que amplían; módulos: los planes con los que se pueden contratar
    const plans = d?.catalog.addonFor?.plans ?? (item.kind === "module" ? pick(card?.compatibleWith, d?.compatibleWith ?? []) : []);
    const { state, reasons } = deriveConnectState(
      { kind: item.kind, commercialStatus: item.commercialStatus, capabilities, dependencies, plans },
      { capabilityStatus, plan, productActive, productName },
    );
    const prices = card?.prices ?? parseConnectPrices(item.prices) ?? [];
    const fallbackPrices: ConnectPrice[] = item.monthly
      ? [{ kind: "monthly", amountCents: item.monthly.amountCents, currency: item.monthly.currency, unit: item.monthly.unit, taxRateBp: null, taxIncluded: item.monthly.taxIncluded }]
      : [];
    const offer = card?.offer ?? parseConnectOffer(item.offer);
    const related = Array.from(new Set([...(c?.related ?? []), ...(c?.compatibleExtensions ?? [])])).filter((k) => k !== item.key && byKey.has(k));
    const sheet: ConnectSheet = {
      headline: c?.headline ?? null,
      valueProposition: c?.valueProposition ?? null,
      longDescription: c?.longDescription ?? null,
      problem: c?.problem ?? null,
      benefits: c?.benefits ?? [],
      excludes: c?.excludes ?? [],
      integrations: c?.integrations ?? [],
      coreIntegration: c?.coreIntegration ?? [],
      terms: { commitment: c?.terms?.commitment ?? null, cancellation: c?.terms?.cancellation ?? null, activation: c?.terms?.activation ?? offer?.activationNotes ?? null },
      faq: c?.faq ?? [],
      related,
      media: {
        card: c?.media?.card ?? null,
        hero: c?.media?.hero ?? legacyImage(c?.media?.cover),
        icon: c?.media?.icon ?? null,
        gallery: c?.media?.gallery ?? (c?.media?.screenshots ?? []).map((m): ConnectGalleryItem => ({ src: m.src, srcset: null, mobileSrc: null, width: null, height: null, alt: m.alt, focal: null, caption: m.caption, kind: "screenshot" })),
        video: c?.media?.video ?? null,
      },
      howItWorks: c?.howItWorks ?? [],
      promoLabel: c?.promoLabel ?? null,
      layout: c?.layout ?? { blocks: [], accentColor: null, heroStyle: null },
      offer: offer?.label ?? null,
    };
    return {
      key: item.key,
      name: item.name,
      family: item.family,
      category: categoryOf(item),
      kind: item.kind,
      metric: item.metric,
      step: item.step,
      commercialStatus: item.commercialStatus,
      capabilities,
      monthly: item.monthly,
      // Solo se compra lo que está disponible para esta empresa (nunca algo contratado, en curso o sin requisitos)
      purchasable: item.purchasable && state === "available",
      tagline: card?.tagline ?? (d?.tagline || null),
      description: card?.description ?? (d?.description || null),
      includes: pick(card?.includes, d?.includes ?? []),
      requirements: pick(card?.requirements, d?.requirements ?? []),
      forWho: c?.forWho ?? card?.presentation?.forWho ?? d?.presentation.forWho ?? null,
      thirdPartyCosts: card?.thirdPartyCosts ?? d?.thirdPartyCosts ?? null,
      dependencies: dependencies.map((k) => ({ key: k, name: productName(k) })),
      plans,
      state,
      reasons,
      icon: card?.presentation?.icon ?? d?.presentation.icon ?? null,
      // El destacado lo decide el catálogo central (la semilla solo destaca un plan, que no está en el panel)
      highlight: card?.presentation?.highlight === true,
      group: card?.group ?? d?.catalog.group ?? null,
      prices: prices.length > 0 ? prices : fallbackPrices,
      sheet,
      contentSource: card ? "card" : d ? "seed" : "none",
      activation: parseActivation(item.activation),
      openPath: item.kind === "module" && capabilities.length > 0 ? openPathOf(capabilities) : null,
    };
  });
}
