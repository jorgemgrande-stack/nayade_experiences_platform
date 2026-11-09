/**
 * Módulos Net heredados (09/11/2026): el servidor rechaza cualquier contratación nueva (suscripciones del equipo y
 * pedidos), pero quien ya los tiene conserva su partida, su precio y sus licencias.
 */
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { productDraft } from "./web/schemas";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { catalogFromWebStore, crmFromStore, type CrmPort } from "./subscriptions/ports";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { quote } from "./catalog/quote";
import { CommercialOrchestrator } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { SignedTestProvider } from "./orchestrator/payments";

const NOW = Date.UTC(2026, 10, 9, 10);
const PMS = "hotel-net-pms";
const BOOKING = "hotel-net-booking-engine";

async function catalog() {
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  const priceOf = async (key: string) => {
    const e = (await webStore.getEntry("product", key))!;
    return (await webStore.listPrices(e.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  };
  /** Marca un producto como heredado por el flujo normal (guardar → publicar). */
  const retire = async (key: string, replacedBy: string) => {
    const e = (await webStore.getEntry("product", key))!;
    const d = productDraft.parse(e.draft);
    const saved = await web.save("product", key, { draft: { ...d, catalog: { ...d.catalog, legacy: { replacedBy, since: "2026-11-09" } } }, expectedVersion: e.draftVersion }, "operator:1");
    await web.publish("product", key, saved.draftVersion, "operator:1");
  };
  return { web, webStore, priceOf, retire };
}

describe("suscripciones: heredado sin contrataciones nuevas, conservado para quien lo tiene", () => {
  let k: Awaited<ReturnType<typeof catalog>>;
  let subs: SubscriptionService;
  let store: MemorySubscriptionStore;
  let licensing: LicensingService;
  let caps: MemoryCapabilityStore;
  beforeEach(async () => {
    k = await catalog();
    const crm: CrmPort = {
      company: async (id) => (id === 1 || id === 2 ? { id, name: `Empresa ${id}` } : null),
      contract: async (id) => (id === 10 || id === 20 ? { id, reference: `CT-2026-0000${id}`, companyId: id / 10, status: "signed", amountCents: null, currency: "EUR", billingInterval: "month", tenantId: `t${id / 10}` } : null),
    };
    store = new MemorySubscriptionStore();
    caps = new MemoryCapabilityStore();
    subs = new SubscriptionService({ store, catalog: catalogFromWebStore(k.webStore), crm, now: () => NOW });
    licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await k.web.site("published")), now: () => NOW });
  });

  it("la empresa que ya lo tiene conserva partida, precio y licencias; una nueva no puede contratarlo", async () => {
    const owner = await subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "business", priceId: await k.priceOf("business") }, addons: [{ productKey: PMS, priceId: await k.priceOf(PMS) }] } as never, "operator:ana");
    await licensing.apply(owner.id, { activate: true, actor: "operator:ana" });
    const itemsBefore = JSON.stringify(await store.items(owner.id));
    const capsBefore = JSON.stringify(await caps.list("t1"));

    await k.retire(PMS, "hotel-net-complete");
    await k.retire(BOOKING, "hotel-net-complete");

    // Nada cambia para quien lo tiene: partidas, importes y licencias idénticos
    expect(JSON.stringify(await store.items(owner.id))).toBe(itemsBefore);
    const plan = await licensing.preview(owner.id, { activate: true });
    expect(plan.changes).toEqual([]);
    expect(JSON.stringify(await caps.list("t1"))).toBe(capsBefore);

    // Contratación nueva del heredado: rechazada (alta y ampliación)
    await expect(subs.create({ companyId: 2, contractId: 20, interval: "month", plan: { productKey: "business", priceId: await k.priceOf("business") }, addons: [{ productKey: PMS, priceId: await k.priceOf(PMS) }] } as never, "operator:ana")).rejects.toThrow(/ya no se contrata por separado/);
    const cur = await subs.must(owner.id);
    await expect(subs.addItem(owner.id, { item: { productKey: BOOKING, priceId: await k.priceOf(BOOKING) } }, cur.version, "operator:ana")).rejects.toThrow(/forma parte de/);
    // La solución completa sí se contrata
    const fresh = await subs.create({ companyId: 2, contractId: 20, interval: "month", plan: { productKey: "business", priceId: await k.priceOf("business") }, addons: [{ productKey: "hotel-net-complete", priceId: await k.priceOf("hotel-net-complete") }] } as never, "operator:ana");
    expect((await store.items(fresh.id)).map((i) => i.productKey)).toContain("hotel-net-complete");
  });
});

describe("pedidos: un heredado no entra como contratación nueva", () => {
  it("alta con un módulo heredado: rechazada; con la solución completa: admitida", async () => {
    const k = await catalog();
    await k.retire(PMS, "hotel-net-complete");
    const crmStore = new MemoryCrmStore();
    const subsStore = new MemorySubscriptionStore();
    const caps = new MemoryCapabilityStore();
    const platform = { activate: async ({ company }: { company: { id: number; tenantId: string | null } }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) };
    const crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now: () => NOW });
    const cat = catalogFromWebStore(k.webStore);
    const crmPort = crmFromStore(crmStore);
    const site = async () => quoteCatalogFromSite(await k.web.site("published"));
    const svc = new CommercialOrchestrator({
      store: new MemoryOrderStore(),
      crm,
      crmStore,
      subscriptions: new SubscriptionService({ store: subsStore, catalog: cat, crm: crmPort, now: () => NOW }),
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => NOW }),
      catalog: cat,
      quote: async (r) => quote(await site(), r),
      licensing: new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => NOW }),
      capabilities: caps,
      platform,
      payments: new SignedTestProvider({ webhookSecret: "secreto-del-proveedor-de-pruebas-0123456789abcdef" }),
      now: () => NOW,
    });
    const c = await crm.createCompany({ name: "Nueva SL" }, "operator:t");
    const key = () => crypto.randomBytes(12).toString("hex");
    await expect(svc.create({ idempotencyKey: key(), companyId: c.id, request: { plan: "business", interval: "month", items: [{ key: PMS }] } }, "operator:t")).rejects.toThrow(/ya no se contrata por separado/);
    const ok = await svc.create({ idempotencyKey: key(), companyId: c.id, request: { plan: "business", interval: "month", items: [{ key: "hotel-net-complete" }] } }, "operator:t");
    expect(ok.created).toBe(true);
  });
});
