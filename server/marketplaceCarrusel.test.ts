/**
 * Carrusel del marketplace del panel (catálogo central): campañas con borrador y publicación, fechas, destinos que
 * existen, nunca un «Contratar» hacia algo que no se puede contratar, reglas de texto públicas y ajustes del carrusel.
 * Datos sintéticos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { WebAdminService, WebError, slideProducts } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { EMPTY_MARKETPLACE, panelMarketplace, planFromOrders } from "./commerce/panelMarketplace";

const DAY = 24 * 3600 * 1000;
let now = Date.UTC(2026, 10, 2, 12);
let web: WebAdminService;
let store: MemoryWebStore;

beforeEach(async () => {
  now = Date.UTC(2026, 10, 2, 12);
  store = new MemoryWebStore();
  web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => now });
  await seedElephantSource(web, store);
});

const slide = (over: Record<string, unknown> = {}) => ({
  title: "Tu equipo, organizado",
  subtitle: "Elephant People",
  background: { src: "https://media.example/fondo.webp", alt: "Equipo trabajando" },
  primaryCta: { label: "Ver la ficha", target: { type: "product", value: "connect-people" } },
  secondaryCta: { label: "Ver Connect", target: { type: "section", value: "connect" } },
  ...over,
});
const create = async (key: string, over: Record<string, unknown> = {}, sortOrder = 0) => web.create({ kind: "marketplace_slide", key, sortOrder, draft: slide(over) }, "operador:test");
const publish = async (key: string) => {
  const e = await store.getEntry("marketplace_slide", key);
  return web.publish("marketplace_slide", key, e!.draftVersion, "operador:test");
};
const problems = async (key: string) => web.publishProblems("marketplace_slide", key);

describe("campañas del carrusel", () => {
  it("se crean en borrador y no aparecen hasta publicarlas; se ordenan y no exponen notas internas", async () => {
    await create("people", { internal: { notes: "nota interna" } }, 2);
    await create("connect", { primaryCta: { label: "Descubrir", target: { type: "section", value: "connect" } }, secondaryCta: undefined }, 1);
    expect((await web.marketplace()).slides).toEqual([]);
    expect((await web.marketplace("preview")).slides.map((s) => s.id)).toEqual(["connect", "people"]);
    await publish("people");
    await publish("connect");
    const m = await web.marketplace();
    expect(m.slides.map((s) => s.id)).toEqual(["connect", "people"]);
    expect(JSON.stringify(m)).not.toMatch(/nota interna|"internal"/);
    expect(m.settings).toEqual({ autoplayMs: 6000, brands: [] });
  });

  it("respeta las fechas de inicio y fin", async () => {
    await create("futura", { startsAt: now + DAY, endsAt: now + 3 * DAY });
    await publish("futura");
    expect((await web.marketplace()).slides).toEqual([]);
    now += 2 * DAY;
    expect((await web.marketplace()).slides.map((s) => s.id)).toEqual(["futura"]);
    now += 2 * DAY;
    expect((await web.marketplace()).slides).toEqual([]);
  });

  it("no se publica con destinos rotos, productos internos o sin publicar ni planes que no existen", async () => {
    await create("rota", { productKey: "no-existe", audience: { plans: ["connect-tax"] } });
    const p = await problems("rota");
    expect(p).toContain("el producto «no-existe» no existe");
    expect(p).toContain("«connect-tax» no es un plan de Elephant Core");
    await expect(publish("rota")).rejects.toBeInstanceOf(WebError);
  });

  it("«Contratar» solo hacia un producto disponible para contratar", async () => {
    const products = (await web.site("published")).catalog.products as Array<{ key: string; family: string; catalog?: { commercialStatus?: string } }>;
    const status = (k: string) => products.find((p) => p.key === k)?.catalog?.commercialStatus;
    const notForSale = products.find((p) => p.family === "connect" && status(p.key) !== "available")!.key;
    await create("contratar", { primaryCta: { label: "Contratar ahora", target: { type: "product", value: notForSale } }, secondaryCta: undefined });
    expect(await problems("contratar")).toContain("«Contratar ahora» solo puede llevar a un producto disponible para contratar");
    const forSale = products.find((p) => p.family === "connect" && status(p.key) === "available")?.key;
    if (forSale) {
      await create("vendible", { primaryCta: { label: "Contratar", target: { type: "product", value: forSale } }, secondaryCta: undefined });
      expect((await problems("vendible")).filter((x) => /solo puede llevar/.test(x))).toEqual([]);
    }
    await create("activar", { primaryCta: { label: "Actívalo", target: { type: "section", value: "net" } } });
    expect((await problems("activar")).some((x) => /solo puede llevar a un producto disponible/.test(x))).toBe(true);
  });

  it("los textos pasan las reglas públicas y una campaña ya terminada no se publica", async () => {
    await create("textos", { title: "Activación inmediata", subtitle: "Soporte 24/7", endsAt: now - 1 });
    const p = await problems("textos");
    expect(p.some((x) => /activación inmediata/.test(x))).toBe(true);
    expect(p.some((x) => /servicio continuo/.test(x))).toBe(true);
    expect(p).toContain("la campaña ya terminó");
  });

  it("valida la forma: enlaces solo https de bigelephant.es, secciones y familias conocidas, fin después del inicio", async () => {
    const bad = [
      { primaryCta: { label: "Ir", target: { type: "url", value: "https://otro.example/x" } } },
      { primaryCta: { label: "Ir", target: { type: "url", value: "http://bigelephant.es/x" } } },
      { primaryCta: { label: "Ir", target: { type: "section", value: "tienda" } } },
      { primaryCta: { label: "Ir", target: { type: "category", value: "inventada" } } },
      { startsAt: now + DAY, endsAt: now },
      { background: { src: "https://media.example/f.webp", alt: "" } },
    ];
    for (const [i, b] of bad.entries()) await expect(create(`mala-${i}`, b), JSON.stringify(b)).rejects.toBeInstanceOf(WebError);
    await expect(create("buena", { primaryCta: { label: "Ver precios", target: { type: "url", value: "https://www.bigelephant.es/precios" } } })).resolves.toBeTruthy();
  });

  it("un producto con campañas publicadas no se despublica; al retirar la campaña, sí", async () => {
    await create("people");
    await publish("people");
    await expect(web.unpublish("product", "connect-people", "operador:test")).rejects.toThrow(/campaña people/);
    await web.unpublish("marketplace_slide", "people", "operador:test");
    expect((await web.marketplace()).slides).toEqual([]);
  });

  it("slideProducts reúne el destacado y los destinos de producto sin repetir", () => {
    expect(slideProducts({ productKey: "a", primaryCta: { label: "x", target: { type: "product", value: "a" } }, secondaryCta: { label: "y", target: { type: "product", value: "b" } } })).toEqual(["a", "b"]);
  });
});

describe("ajustes del marketplace", () => {
  it("clave única «settings»: ritmo del carrusel y cabeceras de marca, con borrador y publicación", async () => {
    await expect(web.create({ kind: "marketplace", key: "otra", draft: {} }, "operador:test")).rejects.toBeInstanceOf(WebError);
    await expect(web.create({ kind: "marketplace", key: "settings", draft: { autoplayMs: 1000 } }, "operador:test")).rejects.toBeInstanceOf(WebError);
    const e = await web.create({ kind: "marketplace", key: "settings", draft: { autoplayMs: 8000, brands: [{ key: "connect", title: "Elephant Connect", subtitle: "Amplía tu Core" }] } }, "operador:test");
    expect((await web.marketplace()).settings.autoplayMs).toBe(6000);
    await web.publish("marketplace", "settings", e.draftVersion, "operador:test");
    expect((await web.marketplace()).settings).toEqual({ autoplayMs: 8000, brands: [{ key: "connect", title: "Elephant Connect", subtitle: "Amplía tu Core" }] });
  });
});

describe("carrusel para el panel de una empresa", () => {
  it("solo campañas de su plan y de productos que ve; sin plan conocido, solo las de todos; sin audiencia ni orden en la salida", async () => {
    await create("todos");
    await create("business", { audience: { plans: ["business"] } });
    await create("people");
    for (const k of ["todos", "business", "people"]) await publish(k);
    const doc = await web.marketplace();
    const all = new Set(["connect-people"]);
    expect(panelMarketplace(doc, { visible: all, plan: "business" }).slides.map((s) => s.id)).toEqual(["business", "people", "todos"]);
    expect(panelMarketplace(doc, { visible: all, plan: "essential" }).slides.map((s) => s.id)).toEqual(["people", "todos"]);
    expect(panelMarketplace(doc, { visible: all, plan: null }).slides.map((s) => s.id)).toEqual(["people", "todos"]);
    expect(panelMarketplace(doc, { visible: new Set(), plan: "business" }).slides).toEqual([]);
    const out = panelMarketplace(doc, { visible: all, plan: "business" });
    expect(Object.keys(out.slides[0])).not.toContain("audience");
    expect(out.settings).toEqual({ autoplayMs: 6000 });
    expect(panelMarketplace(null, { visible: all, plan: null })).toEqual(EMPTY_MARKETPLACE);
  });

  it("el plan sale del pedido vigente más reciente de esa empresa", () => {
    const o = (id: number, state: string, plan: string, tenantId = "t9-demo") => ({ id, state, tenantId, request: { plan, interval: "month", items: [] } }) as never;
    expect(planFromOrders([o(1, "superseded", "essential"), o(2, "active", "business"), o(3, "active", "enterprise", "otra")], "t9-demo")).toBe("business");
    expect(planFromOrders([o(1, "cancelled", "essential")], "t9-demo")).toBeNull();
  });
});

describe("catálogo del panel con carrusel", () => {
  it("el catálogo de la empresa lleva sus campañas filtradas y los ajustes publicados", async () => {
    await create("todos");
    await create("enterprise", { audience: { plans: ["enterprise"] } });
    for (const k of ["todos", "enterprise"]) await publish(k);
    const e = await web.create({ kind: "marketplace", key: "settings", draft: { autoplayMs: 9000, brands: [{ key: "net", title: "Elephant Net" }] } }, "operador:test");
    await web.publish("marketplace", "settings", e.draftVersion, "operador:test");
    const site = await web.site("published");
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site, marketplace: { doc: await web.marketplace(), plan: "business" } });
    expect(cat.marketplace.slides.map((s) => s.id)).toEqual(["todos"]);
    expect(cat.marketplace.settings).toEqual({ autoplayMs: 9000 });
    expect(cat.marketplace.brands).toEqual([{ key: "net", title: "Elephant Net", subtitle: "" }]);
  });
});
