/**
 * Elephant Net unificado (07/11/2026): 7 productos comerciales, 0 extensiones sectoriales a la venta. Coherencia del
 * registro común (shared/netProducts.ts) con el catálogo oficial, el menú y las barreras de venta.
 */
import { describe, expect, it } from "vitest";
import { isNetLegacyExtension, legacyExtensionText, NET_LEGACY_KEYS, NET_PRODUCTS, netProductOf, netProductOfLegacy, netProductOfLicence } from "../shared/netProducts";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { CORE_EXTENSION_PANELS, CORE_EXTENSION_ROUTES } from "../shared/panelExtensions";
import { panelCatalog } from "./commerce/panelCatalog";
import type { QuoteCatalogProduct } from "./catalog/quote";

const seed = (key: string) => PRODUCTS.find((p) => p.key === key);
const monthly = (key: string) => seed(key)?.prices.find((p) => p.kind === "monthly")?.amountCents;

describe("Elephant Net: 7 productos", () => {
  it("los 7 productos, con sus licencias y los precios de catálogo de siempre", () => {
    expect(NET_PRODUCTS.map((p) => [p.name, p.licence, monthly(p.key)])).toEqual([
      ["Care Net", "CARE_NET", 6900],
      ["Hotel Net", "HOTEL_NET", 11900],
      ["Restaurant Net", "RESTAURANT_NET", 5900],
      ["Ski Net", "SKI_NET", 9900],
      ["Travel Net", "TRAVEL_NET", 11900],
      ["Social Token Net", "SOCIAL_TOKEN_NET", 5900],
      ["Life Net", "LIFE_NET", 900],
    ]);
    expect(NET_PRODUCTS.filter((p) => p.segment === "personal").map((p) => p.name)).toEqual(["Life Net"]);
    for (const p of NET_PRODUCTS) {
      expect(seed(p.key)!.draft.name, p.key).toBe(p.name);
      expect(netProductOf(p.key)).toBe(p);
      expect(netProductOfLicence(p.licence)).toBe(p);
      expect(p.areas.flatMap((a) => a.features).length, p.key).toBeGreaterThan(0);
    }
  });

  it("las 19 antiguas extensiones son exactamente los componentes de cada producto y siguen en el catálogo (compatibilidad)", () => {
    expect(NET_LEGACY_KEYS).toHaveLength(19);
    for (const p of NET_PRODUCTS) {
      const bundleOf = seed(p.key)!.draft.catalog.bundleOf;
      expect([...p.legacyKeys].sort(), p.key).toEqual([...bundleOf].sort());
      for (const k of p.legacyKeys) {
        expect(seed(k), k).toBeDefined();
        expect(netProductOfLegacy(k)).toBe(p);
        expect(seed(k)!.draft.internal.notes, k).toMatch(/^Componente interno/);
      }
    }
    expect(isNetLegacyExtension("hotel-net-complete")).toBe(false);
    expect(isNetLegacyExtension("life-net")).toBe(false);
    expect(isNetLegacyExtension("connect-people")).toBe(false);
    expect(legacyExtensionText("hotel-net-channel-manager")).toBe("Forma parte de Hotel Net: se contrata con el producto completo, sin extensiones adicionales.");
    expect(legacyExtensionText("connect-people")).toBeNull();
  });

  it("ninguna extensión antigua se puede comprar aunque el catálogo central la tenga «Disponible» con precio", () => {
    const prod = (key: string, family: string): QuoteCatalogProduct =>
      ({ key, name: key, family, commercialStatus: "available", capabilities: [], prices: [{ kind: "monthly", amountCents: 2900, currency: "EUR", taxIncluded: false, unit: null }], bundleOf: [], addonFor: null, inherits: null }) as unknown as QuoteCatalogProduct;
    const out = panelCatalog([prod("social-token-net-tokens", "industry_module"), prod("social-token-net-complete", "industry_module")], { version: "t", purchasesEnabled: true });
    expect(out.items.map((i) => [i.key, i.purchasable]).sort()).toEqual([
      ["social-token-net-complete", true],
      ["social-token-net-tokens", false],
    ]);
  });

  it("cada producto contratado tiene una sola sección de menú con su panel general, protegido por su licencia", () => {
    const sections = Object.values(CORE_EXTENSION_PANELS).map((x) => x.panel.section).filter((s): s is NonNullable<typeof s> => !!s);
    for (const p of NET_PRODUCTS) {
      const own = sections.filter((s) => s.items.some((i) => i.path === p.homePath));
      expect(own.map((s) => s.label), p.key).toEqual([p.name]);
      expect(CORE_EXTENSION_ROUTES.some((r) => r.path === p.homePath && r.capabilities.length > 0), p.homePath).toBe(true);
    }
  });
});
