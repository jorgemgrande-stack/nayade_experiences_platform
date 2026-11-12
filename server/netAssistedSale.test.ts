/**
 * Venta asistida de Elephant Net (clase B, 11/11/2026): «Contratar e iniciar implantación» en el marketplace del panel
 * para los productos Net de empresa bajo solicitud, operativos y con precio publicado. Abre una solicitud de
 * implantación (y su expediente, idempotente) y no cobra nada. «Solicitar información» queda solo para lo que no tiene
 * precio o no es operativo; «Me interesa», para lo que está en preparación. Datos sintéticos en memoria.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { receivePanelRequest, PANEL_REQUEST_SOURCE } from "./commerce/panelRequests";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import type { LeadRequest } from "./crm/types";
import { ImplementationService } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { solutionFromWebStore } from "./implementation/ports";
import { buildConnectCatalog } from "./connectMarketplace";
import { primaryAction } from "../shared/connectShowcase";
import { ASSISTED_CONTRACT_COPY, NET_SALE_LABEL, NET_SALE_STATE_LABEL, netAvailabilitySplit, netSaleKind } from "../shared/netOffer";
import { netProductOf } from "../shared/netProducts";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { netCommitmentsText } from "./implementation/templates";

const NOW = Date.UTC(2026, 10, 11, 12);
const flush = () => new Promise((r) => setImmediate(r));
let site: SiteDocument;
let webStore: MemoryWebStore;

beforeAll(async () => {
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  site = await web.site("published");
});

describe("clase de venta de Elephant Net (mismo mapa en el panel y en la web)", () => {
  it("A checkout, B contratación asistida, información sin precio o no operativo, interés si está en preparación; fuera de Net, nada", () => {
    const k = (o: Partial<Parameters<typeof netSaleKind>[0]>) => netSaleKind({ key: "hotel-net-complete", commercialStatus: "on_request", technicalStatus: "partial", hasMonthlyPrice: true, ...o });
    expect(k({})).toBe("assisted_contract");
    expect(k({ technicalStatus: "available" })).toBe("assisted_contract");
    expect(k({ technicalStatus: "planned" })).toBe("request_info");
    expect(k({ hasMonthlyPrice: false })).toBe("request_info");
    expect(k({ commercialStatus: "coming_soon" })).toBe("interest");
    expect(k({ commercialStatus: "in_preparation" })).toBe("interest");
    expect(k({ key: "social-token-net-complete", commercialStatus: "available", technicalStatus: "available", offer: { modality: "immediate", checkout: true } })).toBe("checkout");
    // Disponible sin oferta conocida (el panel no la pasa): venta directa; con oferta asistida publicada, clase B
    expect(k({ key: "social-token-net-complete", commercialStatus: "available", technicalStatus: "available" })).toBe("checkout");
    expect(k({ commercialStatus: "available", offer: { modality: "assisted", checkout: false } })).toBe("assisted_contract");
    expect(k({ commercialStatus: "available", hasMonthlyPrice: false })).toBe("request_info");
    expect(ASSISTED_CONTRACT_COPY.priceLine("119,00 €")).toBe("119,00 € al mes (IVA aparte), según el precio publicado.");
    expect(ASSISTED_CONTRACT_COPY.priceLine("119,00 €", true)).toBe("119,00 € al mes (IVA incluido), según el precio publicado.");
    expect(k({ key: "life-net" })).toBeNull();
    expect(k({ key: "connect-people" })).toBeNull();
    expect(NET_SALE_LABEL).toEqual({ checkout: "Contratar ahora", assisted_contract: "Contratar e iniciar implantación", request_info: "Solicitar información", interest: "Me interesa" });
    expect(Object.values(NET_SALE_STATE_LABEL)).not.toContain("Próximamente");
    expect(netAvailabilitySplit("hotel-net-complete").inImplementation).toEqual(["Channel Manager", "Sincronización de inventario y tarifas"]);
  });

  it("catálogo sembrado: Hotel, Restaurant, Care, Ski y Travel son de clase B; Social Token Net, de clase A", () => {
    const products = quoteCatalogFromSite(site).products;
    const kindOf = (key: string) => {
      const p = products.find((x) => x.key === key)!;
      return netSaleKind({ key, commercialStatus: p.commercialStatus, technicalStatus: p.technicalStatus, hasMonthlyPrice: p.prices.some((x) => x.kind === "monthly"), offer: p.offer });
    };
    for (const key of ["hotel-net-complete", "restaurant-net-complete", "care-net-complete", "ski-net-complete", "travel-net-complete"]) expect(kindOf(key), key).toBe("assisted_contract");
    expect(kindOf("social-token-net-complete")).toBe("checkout");
  });
});

describe("marketplace del panel", () => {
  const items = () => panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: true, site }).items;

  it("la tarjeta de un producto de clase B dice «Contratar e iniciar implantación» con el precio y lo disponible y en implantación", () => {
    const out = buildConnectCatalog({ items: items() }, [], NOW, "essential");
    const hotel = out.find((i) => i.key === "hotel-net-complete")!;
    expect(hotel.state).toBe("on_request");
    expect(hotel.assisted).toMatchObject({ monthly: { kind: "monthly", amountCents: 11900, currency: "EUR" } });
    expect(hotel.assisted!.inImplementation).toEqual(["Channel Manager", "Sincronización de inventario y tarifas"]);
    expect(hotel.assisted!.available).toContain("PMS");
    const view = { canPurchase: true, interestEnabled: true };
    expect(primaryAction(hotel, view)).toEqual({ kind: "assisted", label: "Contratar e iniciar implantación", href: null });
    // Social Token Net (clase A): compra en línea como siempre, sin contratación asistida
    const stn = out.find((i) => i.key === "social-token-net-complete")!;
    expect(stn.assisted).toBeNull();
    expect(primaryAction(stn, view).kind).toBe("purchase");
    // Lo que no es Net bajo solicitud sigue con «Solicitar información»
    const voice = out.find((i) => i.key === "connect-voice")!;
    expect(voice.assisted).toBeNull();
    expect(primaryAction(voice, view)).toMatchObject({ kind: "request", label: "Solicitar información" });
    // Contratado: ya no se ofrece
    const grants = [{ tenantId: "t", capabilityId: "hotel-net", siteId: "", status: "active" as const, validUntil: null, source: "subscription:1", updatedAt: NOW, updatedBy: "x" }];
    const owned = buildConnectCatalog({ items: items() }, grants, NOW, "essential").find((i) => i.key === "hotel-net-complete")!;
    expect(owned.assisted).toBeNull();
    expect(primaryAction(owned, view).kind).toBe("open");
  });

  it("solicitud «Contratar e iniciar implantación»: abre el expediente de la empresa una sola vez y no cobra nada", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const created: LeadRequest[] = [];
    const impl = new MemoryImplementationStore();
    const svc = new ImplementationService({ store: impl, crm, crmStore: store, solution: solutionFromWebStore(webStore), now: () => NOW });
    const requests = new WebRequestService({ store, crm, now: () => NOW, onCreated: async (r) => void (created.push(r), await svc.fromIntake(r)) });
    const c = await crm.createCompany({ name: "Hotel Demo", legalName: "Hotel Demo SL" }, "operator:test");
    await store.update("companies", c.id, { tenantId: "t9-hotel" });
    const d = { site, internal: false, requests, crm: store };
    const body = (over: Record<string, unknown> = {}) => ({ type: "implementation" as const, interest: "hotel-net-complete", requester: { name: "Laura Demo", email: "laura@hotel-demo.example" }, idempotencyKey: "clave-impl-0001", ...over });
    const r = await receivePanelRequest(d, "t9-hotel", body());
    expect(r.outcome).toBe("created");
    await flush();
    expect(created[0]).toMatchObject({ type: "module_info", interest: "hotel-net-complete", sourcePage: `${PANEL_REQUEST_SOURCE}/hotel-net-complete${ASSISTED_CONTRACT_COPY.sourceFragment}` });
    expect(created[0].message).toMatch(/Quiere contratar Hotel Net e iniciar la implantación \(precio publicado: 119,00 € al mes \(IVA aparte\)\)[\s\S]*sin cobro en el panel/);
    expect(impl.rows.map((o) => [o.companyId, o.solutionKey, o.status])).toEqual([[c.id, "hotel-net-complete", "requested"]]);
    // Repetir (misma clave o un clic más otro día): el mismo expediente
    expect((await receivePanelRequest(d, "t9-hotel", body())).outcome).toBe("replayed");
    await receivePanelRequest(d, "t9-hotel", body({ idempotencyKey: "clave-impl-0002" })).catch(() => undefined);
    await flush();
    expect(impl.rows).toHaveLength(1);
    // Solo productos de clase B: Social Token Net (A), Life Net, Connect o algo en preparación, no
    for (const interest of ["social-token-net-complete", "connect-voice", "ski-net-school"]) {
      await expect(receivePanelRequest(d, "t9-hotel", body({ interest, idempotencyKey: `clave-${interest}` }))).rejects.toMatchObject({ status: 409 });
    }
    await expect(receivePanelRequest(d, "t9-hotel", body({ interest: "life-net", idempotencyKey: "clave-life" }))).rejects.toMatchObject({ status: 404 });
    expect(netProductOf("hotel-net-complete")!.segment).toBe("business");
  });

  it("una sola contratación en curso por empresa y módulo: se reutiliza con su estado; cerrada, se puede pedir otra", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const impl = new MemoryImplementationStore();
    // Como en production: abrir el expediente marca la solicitud como atendida
    const svc = new ImplementationService({ store: impl, crm, crmStore: store, solution: solutionFromWebStore(webStore), now: () => NOW, markAttended: async (id, who) => void (await requests.setStatus(id, "attended", who)) });
    const requests: WebRequestService = new WebRequestService({ store, crm, now: () => NOW, onCreated: async (r) => void (await svc.fromIntake(r)) });
    const c = await crm.createCompany({ name: "Restaurante Demo", legalName: "Restaurante Demo SL" }, "operator:test");
    await store.update("companies", c.id, { tenantId: "t9-rest" });
    const other = await crm.createCompany({ name: "Otra", legalName: "Otra SL" }, "operator:test");
    await store.update("companies", other.id, { tenantId: "t9-otra" });
    const d = { site, internal: false, requests, crm: store, implementations: impl };
    const body = (over: Record<string, unknown> = {}) => ({ type: "implementation" as const, interest: "restaurant-net-complete", requester: { name: "Ana Demo", email: "ana@rest-demo.example" }, idempotencyKey: "clave-rest-0001", ...over });
    const first = await receivePanelRequest(d, "t9-rest", body());
    expect(first.outcome).toBe("created");
    await flush();
    const order = impl.rows[0];
    // Otra persona, otro mensaje, otro día: la misma contratación, con el estado del expediente; nada nuevo
    const again = await receivePanelRequest(d, "t9-rest", body({ requester: { name: "Luis", email: "luis@rest-demo.example" }, message: "¿Cuándo empezamos?", idempotencyKey: "clave-rest-0002" }));
    expect(again).toMatchObject({ outcome: "duplicate", reference: order.reference, status: "requested", progress: `Expediente de implantación ${order.reference}: solicitada` });
    // El reintento con la misma clave sigue siendo un reintento
    expect((await receivePanelRequest(d, "t9-rest", body())).outcome).toBe("replayed");
    expect(await store.list("leadRequests", {})).toHaveLength(1);
    expect(impl.rows).toHaveLength(1);
    // Otra empresa no ve la de esta
    expect((await receivePanelRequest(d, "t9-otra", body({ idempotencyKey: "clave-otra-0001", requester: { name: "Eva", email: "eva@otra.example" } }))).outcome).toBe("created");
    // «Solicitar información» (sin expediente): la solicitud pendiente de esa empresa es la que se reutiliza
    const info = (k: string, email: string) => ({ type: "info" as const, interest: "connect-voice", requester: { name: "X", email }, idempotencyKey: k });
    const i1 = await receivePanelRequest(d, "t9-rest", info("clave-info-0001", "ana@rest-demo.example"));
    const i2 = await receivePanelRequest(d, "t9-rest", info("clave-info-0002", "luis@rest-demo.example"));
    expect(i2).toMatchObject({ outcome: "duplicate", reference: i1.reference, progress: `Solicitud ${i1.reference}: pendiente de atender` });
    // Expediente cerrado (cancelado): se puede iniciar una contratación nueva
    await impl.update(order.id, order.version, { status: "cancelled" }, NOW);
    const fresh = await receivePanelRequest(d, "t9-rest", body({ idempotencyKey: "clave-rest-0003", message: "Retomamos" }));
    expect(fresh.outcome).toBe("created");
    await flush();
    expect(impl.rows.filter((o) => o.companyId === c.id && o.solutionKey === "restaurant-net-complete").map((o) => o.status).sort()).toEqual(["cancelled", "requested"]);
  });
});

describe("paquete personalizado desde el expediente (catálogo y condiciones personalizadas reales)", () => {
  it("el borrador lo acepta el servicio de condiciones: Essential + Hotel Net a precio publicado, con aceptación y los compromisos", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const c = await crm.createCompany({ name: "Hotel Paquete", legalName: "Hotel Paquete SL" }, "operator:test");
    const opp = await crm.createOpportunity({ companyId: c.id, title: "Hotel Net — implantación asistida" }, "operator:test");
    const catalog = catalogFromWebStore(webStore);
    const subStore = new MemorySubscriptionStore();
    const crmPort: CrmPort = { company: async (id) => (id === c.id ? { id, name: "Hotel Paquete" } : null), contract: async () => null };
    const subs = new SubscriptionService({ store: subStore, catalog, crm: crmPort, now: () => NOW });
    const terms = new CommercialTermsService({ store: new MemoryTermsStore(), subscriptions: subs, subscriptionStore: subStore, catalog, crm: crmPort, now: () => NOW, stripeBilled: async () => false });
    const svc = new ImplementationService({
      store: new MemoryImplementationStore(),
      crm,
      crmStore: store,
      solution: solutionFromWebStore(webStore),
      packages: { offer: () => catalog.offer(), liveSubscription: async () => null, create: (companyId, input, actor) => terms.createPackage(companyId, input, actor), get: (id) => terms.must(id).catch(() => null) },
      now: () => NOW,
    });
    const { order } = await svc.open({ opportunityId: opp.id, solutionKey: "hotel-net-complete" }, "operator:laura");
    const r = await svc.preparePackage(order.id, "operator:laura");
    expect(r.created).toBe(true);
    const t = await terms.must(r.termsId);
    expect(t).toMatchObject({ companyId: c.id, subscriptionId: null, status: "draft", requiresAcceptance: true, interval: "month", packageName: "Hotel Net con implantación" });
    expect(t.lines.map((l) => [l.productKey, l.officialUnitCents, l.chargeClass])).toEqual([["essential", 2900, "recurring"], ["hotel-net-complete", 11900, "recurring"]]);
    expect(t.conditions).toContain(netCommitmentsText("hotel-net-complete")!);
    expect(t.conditions).toContain("En implantación (incluido en el precio");
    // Nada se cobra ni se activa: solo un borrador
    expect(await subStore.list({ companyId: c.id })).toEqual([]);
  });

  /** Empresa con suscripción y, si se pide, condiciones personalizadas con cuota global en vigor (como SUB-2026-000007). */
  async function kit(o: { trial?: boolean; global?: boolean } = {}) {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const c = await crm.createCompany({ name: `Empresa ${Math.random().toString(36).slice(2, 8)}`, legalName: "Empresa SL" }, "operator:test");
    const opp = await crm.createOpportunity({ companyId: c.id, title: "Restaurant Net — implantación asistida" }, "operator:test");
    const catalog = catalogFromWebStore(webStore);
    const subStore = new MemorySubscriptionStore();
    const crmPort: CrmPort = { company: async (id) => (id === c.id ? { id, name: "Empresa" } : null), contract: async () => null };
    const subs = new SubscriptionService({ store: subStore, catalog, crm: crmPort, now: () => NOW });
    const termsStore = new MemoryTermsStore();
    const terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: subStore, catalog, crm: crmPort, now: () => NOW, stripeBilled: async () => false });
    const offer = await catalog.offer();
    const monthly = (k: string) => offer.find((p) => p.key === k)!.prices.find((x) => x.kind === "monthly" && x.status === "approved")!.id;
    const sub = await subs.create({ companyId: c.id, tenantId: "t-empresa", interval: "month", plan: { productKey: "essential", priceId: monthly("essential") }, addons: [{ productKey: "hotel-net-complete", priceId: monthly("hotel-net-complete") }], ...(o.trial ? { trialDays: 15 } : {}) }, "operator:test");
    if (o.global) {
      const draft = await terms.createForSubscription(sub.id, { pricingMode: "global", globalAmountCents: 9900, presentation: "global", conditions: "Cuota global pactada para Essential y Hotel Net.", lines: [{ kind: "catalog", productKey: "essential", priceId: monthly("essential") }, { kind: "catalog", productKey: "hotel-net-complete", priceId: monthly("hotel-net-complete") }], reason: "Acuerdo comercial negociado" }, "operator:test");
      await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(sub.id)).version }, "operator:test");
    }
    // Lo mismo que monta el plano de control (server/controlPlane/api.ts)
    const svc = new ImplementationService({
      store: new MemoryImplementationStore(),
      crm,
      crmStore: store,
      solution: solutionFromWebStore(webStore),
      packages: {
        offer: () => catalog.offer(),
        liveSubscription: async (companyId) => {
          for (const s of await subStore.list({ companyId })) {
            if (s.status !== "active") continue;
            if ((await subStore.items(s.id)).some((i) => i.family === "core_plan" && i.effectiveFrom <= NOW && (i.effectiveTo === null || i.effectiveTo > NOW))) return s.id;
          }
          return null;
        },
        subscriptionBase: async (id) => (await terms.base(id)) as never,
        createForSubscription: (id, input, actor) => terms.createForSubscription(id, input as never, actor),
        create: (companyId, input, actor) => terms.createPackage(companyId, input, actor),
        get: (id) => terms.must(id).catch(() => null),
        ofCompany: async (companyId) => (await termsStore.list({ companyId })).map((t) => ({ id: t.id, status: t.status, companyId: t.companyId, acceptanceStatus: t.acceptanceStatus, productKeys: t.lines.map((l) => l.productKey).filter((k): k is string => !!k) })),
      },
      now: () => NOW,
    });
    const { order } = await svc.open({ opportunityId: opp.id, solutionKey: "restaurant-net-complete" }, "operator:laura");
    return { svc, terms, subStore, sub, order, companyId: c.id };
  }

  it("con condiciones de cuota global en vigor: acuerdo NUEVO sobre esa suscripción; la cuota pactada se conserva y se le suma el Net", async () => {
    const k = await kit({ global: true });
    const r = await k.svc.preparePackage(k.order.id, "operator:laura");
    expect(r.created).toBe(true);
    const t = await k.terms.must(r.termsId);
    expect(t).toMatchObject({ subscriptionId: k.sub.id, status: "draft", requiresAcceptance: true, pricingMode: "global", globalAmountCents: 9900 + 5900 });
    expect(t.lines.map((l) => l.productKey)).toEqual(["essential", "hotel-net-complete", "restaurant-net-complete"]);
    expect(t.conditions).toContain("Cuota global pactada para Essential y Hotel Net.");
    expect(t.conditions).toContain("Precio: la cuota global pactada (99,00 € al mes) se mantiene sin cambios y se le suma el precio publicado de Restaurant Net (59,00 € al mes): cuota global de 158,00 € al mes, IVA aparte.");
    expect(t.conditions).toContain(netCommitmentsText("restaurant-net-complete")!);
    // Ninguna suscripción nueva; repetir devuelve el mismo acuerdo
    expect((await k.subStore.list({ companyId: k.companyId })).map((s) => s.id)).toEqual([k.sub.id]);
    expect(await k.svc.preparePackage(k.order.id, "operator:laura")).toEqual({ termsId: r.termsId, created: false });
  });

  it("sin acuerdo previo: las partidas contratadas + el Net a su precio publicado, por partidas", async () => {
    const k = await kit();
    const t = await k.terms.must((await k.svc.preparePackage(k.order.id, "operator:laura")).termsId);
    expect(t).toMatchObject({ subscriptionId: k.sub.id, pricingMode: "per_item", requiresAcceptance: true });
    expect(t.lines.map((l) => [l.productKey, l.officialUnitCents])).toEqual([["essential", 2900], ["hotel-net-complete", 11900], ["restaurant-net-complete", 5900]]);
    expect(t.conditions).toContain("Precio: Restaurant Net se añade a su precio publicado (59,00 € al mes, IVA aparte); las demás partidas y sus precios pactados no cambian.");
  });

  it("empresa en prueba gratuita: no tiene plan Core de pago → paquete nuevo con Essential", async () => {
    const k = await kit({ trial: true });
    const t = await k.terms.must((await k.svc.preparePackage(k.order.id, "operator:laura")).termsId);
    expect(t.subscriptionId).toBeNull();
    expect(t.lines.map((l) => l.productKey)).toEqual(["essential", "restaurant-net-complete"]);
  });
});
