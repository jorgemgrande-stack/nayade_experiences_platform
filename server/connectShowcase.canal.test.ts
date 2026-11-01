/**
 * Contrato con el canal REAL de la Ventana 2 (#576): la ficha premium que publica el catálogo central
 * (`panelCatalog` → `card.commercial`) se lee entera en el panel; la forma anterior (`cover`/`screenshots`) sigue de
 * reserva y el bloque `marketplace` vacío no inventa carrusel. Datos sintéticos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { buildConnectCatalog, type ChannelCatalogItem } from "./connectMarketplace";
import { parseMarketplaceHeaders, parseMarketplaceRoot } from "./connectCard";
import { resolveBlocks } from "../shared/connectCard";

const NOW = Date.UTC(2026, 10, 1, 12);
let site: SiteDocument;

beforeAll(async () => {
  const store = new MemoryWebStore();
  const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  site = await web.site("published");
});

const IMG = (n: string) => ({ src: `https://media.example/${n}.webp`, alt: `Imagen ${n}` });
const PREMIUM = {
  media: {
    card: { ...IMG("tarjeta"), focal: { x: 40, y: 60 } },
    hero: { ...IMG("cabecera"), mobileSrc: "https://media.example/cabecera-movil.webp" },
    icon: IMG("icono"),
    gallery: [
      { ...IMG("captura"), caption: "Panel de prueba", kind: "screenshot" },
      { ...IMG("ilustracion"), kind: "illustration" },
    ],
    video: { url: "https://vimeo.com/123456789", title: "Recorrido de prueba" },
  },
  howItWorks: [
    { title: "Paso uno", text: "Texto de prueba." },
    { title: "Paso dos", text: "Texto de prueba." },
  ],
  promoLabel: "Nuevo",
  layout: { blocks: [{ id: "howItWorks", visible: true }, { id: "faq", visible: false }], accentColor: "teal", heroStyle: "split" },
};

function channel(extra: Record<string, unknown>) {
  const s = structuredClone(site);
  const p = s.catalog.products.find((x) => x.key === "connect-people") as Record<string, unknown>;
  p.commercial = { ...((p.commercial as object) ?? {}), ...extra };
  // Ida y vuelta por JSON: lo que viaja de verdad por el canal
  return JSON.parse(JSON.stringify(panelCatalog(quoteCatalogFromSite(s).products, { version: "v", purchasesEnabled: false, site: s }))) as { items: ChannelCatalogItem[]; marketplace: unknown };
}
const people = (cat: { items: ChannelCatalogItem[] }) => buildConnectCatalog(cat, [], NOW, "business").find((i) => i.key === "connect-people")!;

describe("ficha premium del canal real → panel", () => {
  it("imágenes, vídeo para incrustar, pasos, etiqueta y diseño", () => {
    const s = people(channel(PREMIUM)).sheet;
    expect(s.media.card).toMatchObject({ src: "https://media.example/tarjeta.webp", alt: "Imagen tarjeta", focal: { x: 40, y: 60 } });
    expect(s.media.hero).toMatchObject({ src: "https://media.example/cabecera.webp", mobileSrc: "https://media.example/cabecera-movil.webp" });
    expect(s.media.icon?.src).toBe("https://media.example/icono.webp");
    expect(s.media.gallery.map((g) => [g.kind, g.caption])).toEqual([
      ["screenshot", "Panel de prueba"],
      ["illustration", null],
    ]);
    expect(s.media.video).toEqual({ embedUrl: "https://player.vimeo.com/video/123456789?dnt=1", title: "Recorrido de prueba" });
    expect(s.howItWorks).toEqual(PREMIUM.howItWorks);
    expect(s.promoLabel).toBe("Nuevo");
    expect(s.layout).toEqual({ blocks: PREMIUM.layout.blocks, accentColor: "teal", heroStyle: "split" });
    expect(resolveBlocks(s.layout)[0]).toBe("howItWorks");
    expect(resolveBlocks(s.layout)).not.toContain("faq");
  });

  it("forma anterior de reserva y campos vacíos → marcadores neutros, sin inventar", () => {
    const old = people(channel({ media: { cover: IMG("portada"), screenshots: [{ ...IMG("cap"), caption: "Pie" }] } })).sheet;
    expect(old.media.hero?.src).toBe("https://media.example/portada.webp");
    expect(old.media.gallery).toEqual([expect.objectContaining({ src: "https://media.example/cap.webp", kind: "screenshot", caption: "Pie" })]);
    const empty = people(channel({})).sheet;
    expect(empty.media).toEqual({ card: null, hero: null, icon: null, gallery: [], video: null });
    expect(empty).toMatchObject({ howItWorks: [], promoLabel: null, layout: { blocks: [], accentColor: null, heroStyle: null } });
  });

  it("bloque marketplace de hoy (slides vacías, brands []) → sin carrusel y cabeceras de siempre", () => {
    const cat = channel({});
    expect(parseMarketplaceRoot(cat.marketplace)).toEqual({ slides: [], autoplayMs: 6000 });
    expect(parseMarketplaceHeaders(cat.marketplace)).toEqual({});
  });
});
