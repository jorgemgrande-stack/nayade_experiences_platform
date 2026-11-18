/**
 * Catálogo público multidioma (/tienda y /<idioma>/tienda) de los productos por solicitud:
 *  - precio «desde» con la opción más barata, solo si el producto enseña precio;
 *  - nombre, resumen y slug del idioma (traducciones validadas) y categorías traducidas;
 *  - título desde la etiqueta del menú; ruta /<idioma>/tienda antes que las páginas traducidas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shopTitleFromMenu } from "../shared/tenantNav";
import { SITE_UI_TEXT } from "../shared/siteUiText";
import type { ContentTranslationRow, I18nRepo } from "./i18nService";

const variants: Record<number, Array<{ experienceId: number; priceModifier: string; priceType: "fixed" }>> = {
  1: [{ experienceId: 1, priceModifier: "144", priceType: "fixed" }, { experienceId: 1, priceModifier: "555", priceType: "fixed" }, { experienceId: 1, priceModifier: "777", priceType: "fixed" }],
  24: [{ experienceId: 24, priceModifier: "49", priceType: "fixed" }],
  31: [{ experienceId: 31, priceModifier: "30", priceType: "fixed" }],
};
const asked: number[][] = [];
const load = async (ids: number[]) => { asked.push(ids); return new Map(ids.filter((i) => variants[i]).map((i) => [i, variants[i]])); };

describe("precio «desde» del catálogo", () => {
  it("la opción más barata y «Desde» como en la ficha; nunca en «bajo petición» ni sin precio base; una sola lectura", async () => {
    const { catalogRows } = await import("./publicCatalog");
    const rows = await catalogRows([
      { id: 1, slug: "reconnect", title: "RECONNECT", basePrice: "555", offerMode: "priced_request" },
      { id: 24, slug: "morning-impulse", title: "MORNING IMPULSE", basePrice: "49", offerMode: "priced_request" },
      { id: 5, slug: "retiro", title: "Retiro", basePrice: "0", offerMode: "on_request" },
      { id: 30, slug: "fijo", title: "Fijo", basePrice: "20", offerMode: "fixed" },
      { id: 31, slug: "sin-base", title: "Sin base", basePrice: "0", offerMode: "priced_request" },
    ], { withFromPrice: true }, load);
    expect(rows.map((r) => [r.id, r.fromPrice, r.hasOptions])).toEqual([[1, 144, true], [24, 49, true], [5, null, false], [30, 20, false], [31, null, false]]);
    expect(asked).toEqual([[1, 24, 30]]);
  });
});

const tr = (entityType: "product" | "category", entityKey: string, fields: Record<string, string>, slug: string | null = null): ContentTranslationRow => ({ entityType, entityKey, locale: "es", fields, slug, status: "validated", validatedAt: null, validatedBy: null });
function repo(rows: ContentTranslationRow[]): I18nRepo {
  return {
    listLocales: async () => [{ locale: "de", status: "validated", isDefault: true }, { locale: "es", status: "validated", isDefault: false }],
    readSettings: async () => ({ defaultPrefix: false, fallback: "default", negotiate: false }),
    listContentTranslations: async (type: string) => rows.filter((r) => r.entityType === type),
  } as unknown as I18nRepo;
}

describe("textos del catálogo en el idioma de la página", () => {
  let r: I18nRepo;
  beforeEach(() => {
    r = repo([tr("product", "9", { title: "Sesión individual de sanación", shortDescription: "Trabajo energético" }, "mentoria-1-1"), tr("category", "3", { name: "Retiros y viajes del alma" })]);
  });
  it("producto traducido: nombre, resumen y slug; sin traducción, el principal", async () => {
    const { localizeProducts } = await import("./i18nProducts");
    const out = await localizeProducts(r, [{ id: 9, slug: "mentoria-1-1", title: "Einzelne Heilsitzung", shortDescription: "x" }, { id: 4, slug: "healer-initiation", title: "HEALER INITIATION" }], "es");
    expect(out).toEqual([{ id: 9, slug: "mentoria-1-1", title: "Sesión individual de sanación", shortDescription: "Trabajo energético" }, { id: 4, slug: "healer-initiation", title: "HEALER INITIATION" }]);
  });
  it("categorías traducidas; en el idioma principal, tal cual", async () => {
    const { localizeCategories } = await import("./i18nProducts");
    const cats = [{ id: 3, name: "Retreats & Seelenreisen" }, { id: 4, name: "Quantum Healer Training" }];
    expect(await localizeCategories(r, cats, "es")).toEqual([{ id: 3, name: "Retiros y viajes del alma" }, { id: 4, name: "Quantum Healer Training" }]);
    expect(await localizeCategories(r, cats, "de")).toBe(cats);
  });
  it("«category» es un tipo traducible con solo su nombre", async () => {
    const { CONTENT_ENTITY_TYPES, CONTENT_FIELDS } = await import("./i18nService");
    expect(CONTENT_ENTITY_TYPES).toContain("category");
    expect(CONTENT_FIELDS.category).toEqual({ name: 128 });
  });
});

describe("menú: enlace al catálogo en otro idioma", () => {
  it("/tienda y /tienda?categoria=x llevan al catálogo del idioma, con el filtro, aunque no sean una página", async () => {
    const { localizeMenu } = await import("./i18nService");
    const r = {
      listLocales: async () => [{ locale: "de", status: "validated", isDefault: true }, { locale: "es", status: "validated", isDefault: false }],
      readSettings: async () => ({ defaultPrefix: false, fallback: "hide", negotiate: false }),
      principalHomeSlug: async () => "home",
      principalPageBySlug: async () => null,
      listPageTranslations: async () => [],
      listContentTranslations: async () => [tr("menu_item" as never, "1", { label: "Programas y servicios" }), tr("menu_item" as never, "2", { label: "Retiros" })],
    } as unknown as I18nRepo;
    const out = await localizeMenu(r, [{ id: 1, parentId: null, label: "Angebote", url: "/tienda" }, { id: 2, parentId: null, label: "Retreats", url: "/tienda?categoria=retreats" }] as never, "es");
    expect(out.map((x: { label: string; url: string }) => [x.label, x.url])).toEqual([["Programas y servicios", "/es/tienda"], ["Retiros", "/es/tienda?categoria=retreats"]]);
  });
});

describe("/<idioma>/tienda en el servidor", () => {
  it("catálogo del idioma adicional validado; idioma sin validar, 404; sin tienda localizada, como siempre", async () => {
    const { resolveRequest } = await import("./i18nService");
    const base = {
      listLocales: async () => [{ locale: "de", status: "validated", isDefault: true }, { locale: "es", status: "validated", isDefault: false }, { locale: "fr", status: "draft", isDefault: false }],
      readSettings: async () => ({ defaultPrefix: false, fallback: "default", negotiate: false }),
      principalHomeSlug: async () => "home",
      principalPageBySlug: async () => null,
      pageTranslation: async () => null,
      publishedTranslationBySlug: async () => null,
      listContentTranslations: async () => [],
    };
    const shop = { ...base, productBySlug: async () => null, productById: async () => null } as unknown as I18nRepo;
    expect(await resolveRequest(shop, "/es/tienda", "https://x.test")).toMatchObject({ kind: "catalog", locale: "es", prefixed: true });
    expect(await resolveRequest(shop, "/fr/tienda", "https://x.test")).toEqual({ kind: "notFound" });
    expect((await resolveRequest(base as unknown as I18nRepo, "/es/tienda", "https://x.test")).kind).not.toBe("catalog");
  });
  it("el servidor web la sirve con las reglas de /tienda", () => {
    const vite = fs.readFileSync(path.join(__dirname, "_core/vite.ts"), "utf8");
    expect(vite).toContain('i18n?.kind === "catalog" ? await resolvePublicRoute("/tienda", deps)');
  });
});

describe("título y ruta del catálogo", () => {
  it("la etiqueta del menú que lleva al catálogo (también con ?categoria=), o null", () => {
    const menu = [{ label: "Start", url: "/", isActive: true }, { label: "Angebote", url: "/tienda?categoria=retreats", isActive: true }];
    expect(shopTitleFromMenu(menu, "/tienda")).toBe("Angebote");
    expect(shopTitleFromMenu([{ label: "Programas y servicios", url: "/es/tienda", isActive: true }], "/es/tienda")).toBe("Programas y servicios");
    expect(shopTitleFromMenu([{ label: "Oculto", url: "/tienda", isActive: false }], "/tienda")).toBeNull();
    expect(shopTitleFromMenu(undefined, "/tienda")).toBeNull();
  });
  it("textos fijos del catálogo en los tres idiomas", () => {
    for (const k of ["searchShop", "searchPlaceholder", "allCategories", "categoriesLabel", "noProducts", "noMatches", "viewAll", "loadMore"] as const) {
      for (const l of ["es", "de", "en"] as const) expect(SITE_UI_TEXT[l][k]).toBeTruthy();
    }
    expect(SITE_UI_TEXT.de.allCategories).toBe("Alle");
  });
  it("/<idioma>/tienda va antes que las páginas traducidas (/:locale/:slug)", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "client/src/App.tsx"), "utf8");
    const shop = app.indexOf('<Route path="/:locale/tienda">');
    expect(shop).toBeGreaterThan(0);
    expect(shop).toBeLessThan(app.indexOf('<Route path="/:locale/:slug">'));
  });
});

describe("bloque «Productos» de las páginas", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "client/src/components/site/PageBlocksView.tsx"), "utf8");
  it("pide los textos del idioma y el precio «desde»; el botón lleva al catálogo del idioma y la categoría", () => {
    expect(src).toContain("includeSoldOut: true, withFromPrice: true, ...(site.prefix ? { locale: site.prefix } : {})");
    expect(src).toContain("<SmartLink href={shopHref} preview={preview}>");
    expect(src).not.toContain('<SmartLink href="/tienda" preview={preview}>');
    expect(src).toContain("?categoria=${encodeURIComponent(d.categorySlug)}");
  });
});
