/**
 * Escaparate de Elephant Connect con el catálogo OFICIAL publicado (semilla de Elephant Source → sitio publicado →
 * catálogo del panel del plano de control → connect.catalog del Core): lo comercialmente visible nunca desaparece por
 * el plan ni por las licencias, Elephant People sigue «Bajo solicitud» sin compra en línea, Connect y Net van
 * separados y lo interno o no publicado no aparece.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import type { QuoteCatalogProduct } from "./catalog/quote";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog, type PanelCatalog } from "./commerce/panelCatalog";
import { buildConnectCatalog } from "./connectMarketplace";
import { brandOf, connectAction, filterConnectItems } from "../shared/connectMarketplace";

const NOW = Date.UTC(2026, 10, 1, 12);
let products: QuoteCatalogProduct[];
let published: PanelCatalog;

beforeAll(async () => {
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  products = quoteCatalogFromSite(await web.site("published")).products;
  // Compra en línea abierta: aun así, lo que no está a la venta no se puede comprar
  published = panelCatalog(products, { version: "v-prueba", purchasesEnabled: true });
});

describe("escaparate de Elephant Connect", () => {
  it("el catálogo publicado del panel no está vacío y no incluye planes, servicios ni lo no publicado", () => {
    expect(published.items.length).toBeGreaterThan(20);
    const families = new Set(published.items.map((i) => i.family));
    expect(families.has("core_plan")).toBe(false);
    expect(families.has("service")).toBe(false);
    const unpublished = panelCatalog(
      products.map((p) => (p.key === "connect-voice" ? { ...p, commercialStatus: "unpublished" as const } : p)),
      { version: "v", purchasesEnabled: true },
    );
    expect(unpublished.items.map((i) => i.key)).not.toContain("connect-voice");
  });

  it.each(["essential", "business", "enterprise", null])("ningún producto publicado desaparece por el plan (%s) ni por no tener licencias", (plan) => {
    const items = buildConnectCatalog(published, [], NOW, plan);
    expect(items.map((i) => i.key).sort()).toEqual(published.items.map((i) => i.key).sort());
    expect(filterConnectItems(items, { state: "all" })).toHaveLength(items.length);
  });

  it.each(["essential", "business", "enterprise"])("Elephant People es visible y «Bajo solicitud» para %s, sin compra en línea", (plan) => {
    const people = buildConnectCatalog(published, [], NOW, plan).find((i) => i.key === "connect-people")!;
    expect(people).toBeDefined();
    expect(people).toMatchObject({ state: "on_request", purchasable: false, commercialStatus: "on_request" });
    expect(people.plans).toEqual(expect.arrayContaining(["essential", "business", "enterprise"]));
    expect(people.monthly?.amountCents).toBe(1900);
    expect(connectAction({ state: people.state, kind: people.kind, purchasable: people.purchasable, canPurchase: true })).toBe("request");
    expect(filterConnectItems([people], { state: "on_request" })).toHaveLength(1);
  });

  it("Elephant Net va separado de Elephant Connect", () => {
    const items = buildConnectCatalog(published, [], NOW, "business");
    const net = items.filter((i) => brandOf(i) === "net");
    const connect = items.filter((i) => brandOf(i) === "connect");
    expect(net.length).toBeGreaterThan(0);
    expect(connect.length).toBeGreaterThan(0);
    expect(net.every((i) => /^net_|industry_module$/.test(i.family))).toBe(true);
    expect(connect.some((i) => i.key === "connect-people")).toBe(true);
    expect(connect.every((i) => !/^net_/.test(i.family))).toBe(true);
  });

  it("solo se puede comprar lo que está «Disponible» para la empresa", () => {
    const items = buildConnectCatalog(published, [], NOW, "business");
    for (const i of items) if (i.purchasable) expect(i.state).toBe("available");
    for (const i of items.filter((x) => x.commercialStatus !== "available")) expect(i.purchasable).toBe(false);
  });
});
