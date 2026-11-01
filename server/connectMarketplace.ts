/**
 * Elephant Connect — catálogo para el panel de la empresa: el catálogo publicado (plano de control, con precios y si
 * se puede comprar) cruzado con las licencias de ESTA empresa y su plan. Pura: no consulta ni cambia nada.
 *
 * Textos de la ficha (lema, descripción, qué incluye, requisitos, costes de terceros, para quién): el catálogo del
 * panel del plano de control aún no los publica, así que salen del catálogo oficial v1 (server/catalog/elephantSourceV1.ts),
 * nunca de su parte interna (notas, costes, evidencias). Si un producto no está ahí, la ficha va sin esos textos.
 */
import type { CapabilityGrant } from "./_core/capabilities/model";
import { effectiveStatus } from "./subscriptionOverview";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import type { PanelCatalogItemView } from "./panelModules";
import { categoryOf, deriveConnectState, type ConnectCategoryId, type ConnectState } from "../shared/connectMarketplace";

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
}

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

export function buildConnectCatalog(catalog: { items: PanelCatalogItemView[] }, grants: CapabilityGrant[], now: number, plan: string | null): ConnectItem[] {
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
    const capabilities = item.kind === "module" ? capsOf(item.key) : [];
    const dependencies = d?.dependencies ?? [];
    // Ampliaciones: los planes a los que amplían; módulos: los planes con los que se pueden contratar
    const plans = d?.catalog.addonFor?.plans ?? (item.kind === "module" ? d?.compatibleWith ?? [] : []);
    const { state, reasons } = deriveConnectState(
      { kind: item.kind, commercialStatus: item.commercialStatus, capabilities, dependencies, plans },
      { capabilityStatus, plan, productActive, productName },
    );
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
      tagline: d?.tagline || null,
      description: d?.description || null,
      includes: d?.includes ?? [],
      requirements: d?.requirements ?? [],
      forWho: d?.presentation.forWho ?? null,
      thirdPartyCosts: d?.thirdPartyCosts ?? null,
      dependencies: dependencies.map((k) => ({ key: k, name: productName(k) })),
      plans,
      state,
      reasons,
    };
  });
}
