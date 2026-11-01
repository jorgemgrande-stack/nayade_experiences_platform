/**
 * Marketplace premium (catálogo central): imágenes de tarjeta, cabecera, icono y galería, vídeo de YouTube o Vimeo en
 * privacidad mejorada, «cómo funciona», etiqueta promocional y diseño de la ficha (bloques, paleta cerrada). Todo
 * opcional y sin valor por defecto; llega al panel en `card` y el carrusel viaja vacío hasta que haya campañas.
 * Datos sintéticos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { productDraft, videoEmbedUrl, type ProductDraft } from "./web/schemas";
import { commercialChecks } from "./catalog/commercial/checks";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { DEFAULT_AUTOPLAY_MS, panelCatalog } from "./commerce/panelCatalog";

const NOW = Date.UTC(2026, 10, 1, 12);
let site: SiteDocument;
let entries: Array<{ key: string; family: string | null; publication: string; draft: ProductDraft }>;

beforeAll(async () => {
  const store = new MemoryWebStore();
  const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  site = await web.site("published");
  entries = (await store.listEntries()).filter((x) => x.kind === "product").map((x) => ({ key: x.key, family: x.family, publication: x.publication, draft: productDraft.parse(x.draft) as ProductDraft }));
});

const IMG = (n: string) => ({ src: `https://media.example/${n}.webp`, alt: `Imagen ${n}` });
const PREMIUM = {
  media: {
    card: { ...IMG("tarjeta"), focal: { x: 40, y: 60 } },
    hero: { ...IMG("cabecera"), mobileSrc: "https://media.example/cabecera-movil.webp" },
    icon: IMG("icono"),
    gallery: [
      { ...IMG("captura"), caption: "Panel de fichajes", kind: "screenshot" as const },
      { ...IMG("ilustracion"), kind: "illustration" as const },
    ],
    video: { url: "https://www.youtube.com/watch?v=abcDEF12345", title: "Recorrido por el módulo" },
  },
  howItWorks: [
    { title: "Solicítalo", text: "Nos cuentas cómo trabaja tu equipo." },
    { title: "Lo configuramos", text: "Lo dejamos listo con tus usuarios." },
  ],
  promoLabel: "Nuevo",
  layout: { blocks: [{ id: "howItWorks" as const, visible: true }, { id: "faq" as const, visible: false }], accentColor: "teal" as const, heroStyle: "split" as const },
};

const people = () => entries.find((x) => x.key === "connect-people")!;
const parse = (extra: Record<string, unknown>) => {
  const d = people().draft;
  return productDraft.safeParse({ ...d, commercial: { ...(d.commercial ?? {}), ...extra } });
};

describe("vídeo: solo YouTube o Vimeo en privacidad mejorada", () => {
  it("normaliza a youtube-nocookie y al reproductor de Vimeo sin rastreo", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=abcDEF12345")).toBe("https://www.youtube-nocookie.com/embed/abcDEF12345");
    expect(videoEmbedUrl("https://youtu.be/abcDEF12345")).toBe("https://www.youtube-nocookie.com/embed/abcDEF12345");
    expect(videoEmbedUrl("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789?dnt=1");
  });
  it("rechaza otros proveedores, http y enlaces mal formados", () => {
    for (const u of ["http://www.youtube.com/watch?v=abcDEF12345", "https://evil.example/watch?v=abcDEF12345", "https://youtube.com.evil.example/watch?v=abcDEF12345", "https://vimeo.com/abc", "no es un enlace", "https://youtu.be/<script>"]) {
      expect(videoEmbedUrl(u), u).toBeNull();
    }
  });
});

describe("campos premium de la ficha comercial", () => {
  it("una ficha anterior sigue validando igual (todo opcional y sin valor por defecto)", () => {
    const parsed = people().draft;
    for (const k of ["howItWorks", "promoLabel", "layout"]) expect(k in (parsed.commercial ?? {}), k).toBe(false);
    expect(productDraft.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("acepta los campos completos", () => {
    const r = parse(PREMIUM);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("rechaza color fuera de la paleta, bloques desconocidos o repetidos, vídeo no admitido, imagen sin alt o sin https y más de 4 pasos", () => {
    const bad: Array<Record<string, unknown>> = [
      { layout: { accentColor: "#ff0000" } },
      { layout: { blocks: [{ id: "pricing", visible: true }] } },
      { layout: { blocks: [{ id: "faq", visible: true }, { id: "faq", visible: false }] } },
      { media: { video: { url: "https://tiktok.com/@x/video/1", title: "Vídeo" } } },
      { media: { card: { src: "https://media.example/a.webp", alt: "" } } },
      { media: { hero: { src: "http://media.example/a.webp", alt: "Cabecera" } } },
      { media: { gallery: [{ ...IMG("a"), kind: "photo" }] } },
      { howItWorks: Array.from({ length: 5 }, (_, i) => ({ title: `Paso ${i}`, text: "Texto" })) },
      { promoLabel: "Una etiqueta promocional demasiado larga" },
    ];
    for (const b of bad) expect(parse(b).success, JSON.stringify(b)).toBe(false);
  });

  it("los textos nuevos pasan por las reglas públicas (alt, pies, vídeo, pasos y etiqueta)", () => {
    const fichaBlocking = (extra: Record<string, unknown>) => {
      const r = parse(extra);
      expect(r.success).toBe(true);
      const e = { ...people(), draft: r.success ? (r.data as ProductDraft) : people().draft };
      return commercialChecks(e, entries).blocking.filter((b) => /^la ficha/.test(b));
    };
    expect(fichaBlocking(PREMIUM)).toEqual([]);
    expect(fichaBlocking({ promoLabel: "Soporte 24/7" }).length).toBeGreaterThan(0);
    expect(fichaBlocking({ howItWorks: [{ title: "Paso", text: "Respuesta en 24 horas" }] }).length).toBeGreaterThan(0);
    expect(fichaBlocking({ media: { gallery: [{ ...IMG("a"), caption: "Activación inmediata", kind: "screenshot" }] } }).length).toBeGreaterThan(0);
    expect(fichaBlocking({ media: { video: { url: PREMIUM.media.video.url, title: "Texto pendiente" } } }).length).toBeGreaterThan(0);
  });
});

describe("canal hacia el Core", () => {
  const withPremium = (extra: Record<string, unknown>): SiteDocument => {
    const s = structuredClone(site);
    const p = s.catalog.products.find((x) => x.key === "connect-people") as Record<string, unknown>;
    p.commercial = { ...((p.commercial as object) ?? {}), ...extra };
    return s;
  };
  const card = (s: SiteDocument) => panelCatalog(quoteCatalogFromSite(s).products, { version: "v", purchasesEnabled: false, site: s }).items.find((i) => i.key === "connect-people")!.card!.commercial!;

  it("cada tarjeta lleva imágenes, vídeo para incrustar, pasos, etiqueta y diseño", () => {
    const c = card(withPremium(PREMIUM));
    expect(c.media.card).toEqual({ ...IMG("tarjeta"), focal: { x: 40, y: 60 } });
    expect(c.media.hero).toEqual({ ...IMG("cabecera"), mobileSrc: "https://media.example/cabecera-movil.webp" });
    expect(c.media.icon).toEqual(IMG("icono"));
    expect(c.media.gallery.map((g) => g.kind)).toEqual(["screenshot", "illustration"]);
    expect(c.media.video).toEqual({ url: PREMIUM.media.video.url, embedUrl: "https://www.youtube-nocookie.com/embed/abcDEF12345", title: "Recorrido por el módulo" });
    expect(c.howItWorks).toEqual(PREMIUM.howItWorks);
    expect(c.promoLabel).toBe("Nuevo");
    expect(c.layout).toEqual({ blocks: PREMIUM.layout.blocks, accentColor: "teal", heroStyle: "split" });
  });

  it("los nombres anteriores sirven de reserva: cover → hero y screenshots → galería de capturas", () => {
    const c = card(withPremium({ media: { cover: IMG("portada"), screenshots: [{ ...IMG("cap"), caption: "Pie" }] } }));
    expect(c.media.hero).toEqual(IMG("portada"));
    expect(c.media.gallery).toEqual([{ ...IMG("cap"), caption: "Pie", kind: "screenshot" }]);
    expect(c.media.cover).toEqual(IMG("portada"));
    expect(c.media.screenshots).toEqual([{ ...IMG("cap"), caption: "Pie" }]);
  });

  it("sin campos premium llegan vacíos (el panel usa sus marcadores neutros) y un vídeo no admitido no se envía", () => {
    const c = card(withPremium({ media: { video: { url: "https://evil.example/v", title: "x" } } }));
    expect(c.media).toMatchObject({ card: null, hero: null, icon: null, gallery: [], video: null });
    expect(c).toMatchObject({ howItWorks: [], promoLabel: null, layout: { blocks: [], accentColor: null, heroStyle: null } });
  });

  it("el catálogo lleva el bloque del marketplace (carrusel vacío hasta que haya campañas publicadas)", () => {
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site });
    expect(cat.marketplace).toEqual({ slides: [], settings: { autoplayMs: DEFAULT_AUTOPLAY_MS }, brands: [] });
  });
});
