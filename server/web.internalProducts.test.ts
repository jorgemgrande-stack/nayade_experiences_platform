/**
 * Productos internos de pruebas en el catálogo web: un plan nunca puede ser interno; la vista pública
 * (`publicSite`, filtrada en el servidor) quita el producto interno y todo lo que lo nombra (paquetes,
 * dependencias y promociones) y su versión es la del catálogo sin él (publicar un interno no cambia la web).
 */
import { describe, it, expect } from "vitest";
import { WebAdminService, withoutInternal } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const NOW = Date.UTC(2026, 9, 20, 9);
const setup = async () => {
  const store = new MemoryWebStore();
  const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  return web;
};
const mark = async (web: WebAdminService, key: string, catalog: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const { entry: e } = await web.get("product", key);
  const draft = { ...(structuredClone(e.draft) as Record<string, unknown>), ...extra } as Record<string, unknown> & { catalog?: Record<string, unknown> };
  draft.catalog = { ...(draft.catalog ?? {}), ...catalog };
  const saved = await web.save("product", key, { draft, expectedVersion: e.draftVersion }, "operator:test");
  await web.publish("product", key, saved.draftVersion, "operator:test");
};
const keys = (s: { catalog: { products: Array<{ key: string }> } }) => s.catalog.products.map((p) => p.key);

describe("productos internos en el catálogo web", () => {
  it("un plan de Elephant Core no puede ser interno", async () => {
    const web = await setup();
    const { entry: e } = await web.get("product", "essential");
    const draft = structuredClone(e.draft) as { catalog?: Record<string, unknown> };
    draft.catalog = { ...(draft.catalog ?? {}), internalOnly: true };
    await expect(web.save("product", "essential", { draft, expectedVersion: e.draftVersion }, "operator:test")).rejects.toThrow(/no puede ser interno/);
  });

  it("la vista pública quita el interno, el paquete que lo incluye, quien depende de él y sus promociones; la versión es la del catálogo sin él", async () => {
    const web = await setup();
    const before = await web.publicSite("published");
    await mark(web, "connect-tax", { internalOnly: true });
    const full = await web.site("published");
    expect(keys(full)).toEqual(expect.arrayContaining(["connect-tax", "connect-pack-finance"]));
    const pub = await web.publicSite("published");
    expect(keys(pub)).not.toContain("connect-tax");
    expect(keys(pub)).not.toContain("connect-pack-finance");
    // Publicar un producto interno solo retira de lo público lo que lo nombra (paquete o dependencia)
    const names = (k: string) => {
      const p = full.catalog.products.find((x) => x.key === k) as unknown as { dependencies?: string[]; catalog?: { bundleOf?: string[] } };
      return [...(p.dependencies ?? []), ...(p.catalog?.bundleOf ?? [])].includes("connect-tax");
    };
    const removed = keys(before).filter((k) => !keys(pub).includes(k));
    expect(removed).toContain("connect-pack-finance");
    expect(removed.every((k) => k === "connect-tax" || names(k))).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("internalOnly");
    // Dependencia y promoción sintéticas sobre el interno
    const synthetic = {
      ...full,
      catalog: {
        ...full.catalog,
        products: [...full.catalog.products, { key: "dep-de-interno", dependencies: ["connect-tax"], catalog: {} } as never],
        promotions: [{ key: "promo-interna", products: ["connect-tax"] } as never, { key: "promo-publica", products: ["essential"] } as never],
      },
    };
    const filtered = withoutInternal(synthetic);
    expect(keys(filtered)).not.toContain("dep-de-interno");
    expect(filtered.catalog.promotions.map((p) => (p as { key: string }).key)).toEqual(["promo-publica"]);
    expect(filtered.version).not.toBe(synthetic.version);
    // Sin internos, la vista pública tiene los mismos productos y no menciona la marca
    const clean = await setup();
    expect(keys(await clean.publicSite("published"))).toEqual(keys(await clean.site("published")));
    expect(JSON.stringify(await clean.publicSite("published"))).not.toContain("internalOnly");
  });
});

describe("empresas de prueba autorizadas a comprar productos internos", () => {
  it("lista vacía por defecto; ids válidos; un id mal formado no arranca", async () => {
    const { internalTenantsFromEnv } = await import("./stripe/purchases");
    expect(internalTenantsFromEnv({}).size).toBe(0);
    expect(Array.from(internalTenantsFromEnv({ CP_COMMERCE_INTERNAL_TENANTS: " t1-empresa-demo-elephant-a , qa-fase3 " }))).toEqual(["t1-empresa-demo-elephant-a", "qa-fase3"]);
    expect(() => internalTenantsFromEnv({ CP_COMMERCE_INTERNAL_TENANTS: "t1,*" })).toThrow(/no válidos/);
  });
});
