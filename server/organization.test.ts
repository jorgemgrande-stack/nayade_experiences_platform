/**
 * Sedes y entidades fiscales: límites del plan contratado (y complementos), archivado sin borrado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryOrganizationStore, OrganizationService } from "./organization/service";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";

const NOW = Date.UTC(2026, 9, 16, 10);
let org: OrganizationService;
let subs: SubscriptionService;
let priceOf: (key: string) => Promise<number>;
let markPartial: (key: string) => Promise<void>;

beforeEach(async () => {
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  // Enterprise y la sede adicional están «en hoja de ruta» en el catálogo oficial (la app aún no usa
  // varias sedes ni varias entidades fiscales) y el motor no los deja contratar. Para probar la lógica
  // de límites, esta copia del catálogo los marca como parciales.
  markPartial = async (key) => {
    const e = (await webStore.getEntry("product", key))!;
    await web.save("product", key, { draft: { ...(e.draft as object), technicalStatus: "partial" }, expectedVersion: e.draftVersion }, "t");
    await web.publish("product", key, e.draftVersion + 1, "t");
  };
  priceOf = async (key) => (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const crm: CrmPort = { company: async () => ({ id: 1, name: "Acme" }), contract: async () => null };
  const store = new MemorySubscriptionStore();
  subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => NOW });
  org = new OrganizationService({ store: new MemoryOrganizationStore(), subscriptions: store, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => NOW });
});

const subscribe = async (plan: string, addons: Array<{ key: string; quantity?: number }> = []) =>
  subs.create({ companyId: 1, tenantId: "acme", interval: "month", plan: { productKey: plan, priceId: await priceOf(plan) }, addons: await Promise.all(addons.map(async (a) => ({ productKey: a.key, priceId: await priceOf(a.key), quantity: a.quantity }))) }, "t");

describe("sedes y entidades fiscales", () => {
  it("sin suscripción rige el mínimo de Essential: 1 sede y 1 entidad fiscal", async () => {
    expect(await org.limits("acme")).toMatchObject({ sites: 1, fiscal_entities: 1 });
    await org.createSite("acme", { siteId: "central", name: "Central" }, "t");
    await expect(org.createSite("acme", { siteId: "norte", name: "Norte" }, "t")).rejects.toMatchObject({ code: "limit" });
  });
  it("Business: 5 sedes más las adicionales contratadas; una sola entidad fiscal (varias requieren Enterprise)", async () => {
    await markPartial("addon-site-business");
    await subscribe("business", [{ key: "addon-site-business", quantity: 2 }]);
    expect(await org.limits("acme")).toMatchObject({ sites: 7, fiscal_entities: 1 });
    await org.createFiscalEntity("acme", { entityId: "acme-sl", legalName: "Acme SL", taxId: "B12345678" }, "t");
    await expect(org.createFiscalEntity("acme", { entityId: "acme-dos", legalName: "Acme Dos SL", taxId: "B87654321" }, "t")).rejects.toThrow(/Enterprise/);
    for (let i = 1; i <= 7; i++) await org.createSite("acme", { siteId: `sede-${i}`, name: `Sede ${i}` }, "t");
    await expect(org.createSite("acme", { siteId: "sede-8", name: "Sede 8" }, "t")).rejects.toMatchObject({ code: "limit" });
    // La sede usa la entidad fiscal por defecto
    expect((await org.overview("acme")).sites.every((s) => s.fiscalEntityId === "acme-sl")).toBe(true);
  });
  it("Enterprise: sin tope técnico (por contrato) y varias entidades fiscales", async () => {
    await markPartial("enterprise");
    await subscribe("enterprise");
    expect(await org.limits("acme")).toMatchObject({ sites: null, fiscal_entities: null });
    await org.createFiscalEntity("acme", { entityId: "a", legalName: "A SL", taxId: "B11111111" }, "t");
    await org.createFiscalEntity("acme", { entityId: "b", legalName: "B SL", taxId: "B22222222" }, "t");
    await org.createSite("acme", { siteId: "s1", name: "S1", fiscalEntityId: "b" }, "t");
    const o = await org.overview("acme");
    expect(o.fiscalEntities.map((f) => [f.entityId, f.isDefault])).toEqual([["a", true], ["b", false]]);
    expect(o.sites[0].fiscalEntityId).toBe("b");
  });
  it("archivar: nada se borra; una entidad con sedes activas no se archiva; el límite cuenta solo lo activo", async () => {
    await org.createFiscalEntity("acme", { entityId: "acme-sl", legalName: "Acme SL", taxId: "B12345678" }, "t");
    await org.createSite("acme", { siteId: "central", name: "Central" }, "t");
    await expect(org.archiveFiscalEntity("acme", "acme-sl")).rejects.toMatchObject({ code: "conflict" });
    await org.archiveSite("acme", "central");
    await org.createSite("acme", { siteId: "nueva", name: "Nueva" }, "t");
    const o = await org.overview("acme");
    expect(o.sites.map((s) => [s.siteId, s.status])).toEqual([["central", "archived"], ["nueva", "active"]]);
    expect(o.used.sites).toBe(1);
  });
  it("validación: identificadores, NIF y duplicados", async () => {
    await expect(org.createSite("acme", { siteId: "Mal Id", name: "X" }, "t")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(org.createFiscalEntity("acme", { entityId: "x", legalName: "X SL", taxId: "?" }, "t")).rejects.toMatchObject({ code: "invalid_input" });
    await org.createSite("acme", { siteId: "central", name: "Central" }, "t");
    await org.archiveSite("acme", "central");
    await expect(org.createSite("acme", { siteId: "central", name: "Otra" }, "t")).rejects.toMatchObject({ code: "conflict" });
  });
});
