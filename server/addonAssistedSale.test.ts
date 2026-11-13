/**
 * Ampliaciones de capacidad del Core con contratación asistida (decisión del 13/11/2026): todas las ampliaciones del
 * Marketplace se pueden contratar. Fase 1: «Contratar e iniciar implantación», el mismo circuito que Elephant Net y
 * Connect (solicitud, expediente, paquete personalizado y aceptación); nada se cobra en el panel. Una ampliación de otro
 * plan no se ofrece. Una disponible sigue con la compra en línea de siempre («Ampliar»). Datos sintéticos en memoria.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { receivePanelRequest } from "./commerce/panelRequests";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService } from "./crm/webRequests";
import { ImplementationService } from "./implementation/service";
import { MemoryImplementationStore } from "./implementation/store";
import { solutionFromWebStore } from "./implementation/ports";
import { netCommitmentsText, templateFor } from "./implementation/templates";
import { buildConnectCatalog } from "./connectMarketplace";
import { primaryAction } from "../shared/connectShowcase";
import { ADDON_ASSISTED, addonAssistedOf } from "../shared/addonAssisted";
import { netAvailabilitySplit, offerSaleKind } from "../shared/netOffer";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";

const NOW = Date.UTC(2026, 10, 13, 12);
const flush = () => new Promise((r) => setImmediate(r));
let site: SiteDocument;
let webStore: MemoryWebStore;
const ASSISTED = { kind: "assisted", label: "Contratar e iniciar implantación", href: null };

beforeAll(async () => {
  webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, webStore);
  site = await web.site("published");
});

describe("ampliaciones de capacidad: contratación asistida", () => {
  it("el registro = las ampliaciones del catálogo (familia addon), con los mismos planes y lo que ofrecen hoy", () => {
    const addons = quoteCatalogFromSite(site).products.filter((p) => p.family === "addon");
    expect(addons.map((p) => p.key).sort()).toEqual(ADDON_ASSISTED.map((p) => p.key).sort());
    for (const a of ADDON_ASSISTED) {
      const p = addons.find((x) => x.key === a.key)!;
      expect([...(a.plans ?? [])].sort(), a.key).toEqual([...(p.addonFor?.plans ?? [])].sort());
      const split = netAvailabilitySplit(a.key);
      expect(split.available.length, a.key).toBeGreaterThan(0);
      expect(split.inImplementation, a.key).toEqual([]);
    }
  });

  it("la clase de venta: asistida bajo solicitud o en preparación; disponible, retirado o sin publicar, la regla de siempre", () => {
    const k = (key: string, commercialStatus: string, hasMonthlyPrice = true) => offerSaleKind({ key, commercialStatus, technicalStatus: "partial", hasMonthlyPrice });
    expect(k("addon-user-essential", "on_request")).toBe("assisted_contract");
    expect(k("addon-site-business", "in_preparation")).toBe("assisted_contract");
    expect(k("addon-storage-10gb", "coming_soon")).toBe("assisted_contract");
    expect(k("addon-storage-10gb", "on_request", false)).toBe("request_info");
    // Fase 2: una ampliación disponible y comprable sigue con «Ampliar» (compra en línea), nunca con la asistida
    expect(k("addon-user-business", "available")).toBeNull();
    expect(k("addon-user-business", "retired")).toBeNull();
    expect(k("addon-user-business", "unpublished")).toBeNull();
  });

  it("marketplace Essential: usuario Essential y almacenamiento, asistidos con su precio; los de Business no se ofrecen", () => {
    const items = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: true, site }).items;
    const out = buildConnectCatalog({ items }, [], NOW, "essential");
    const view = { canPurchase: true, interestEnabled: true };
    const card = (key: string) => out.find((i) => i.key === key)!;
    expect(card("addon-user-essential")).toMatchObject({ kind: "quantity", state: "on_request", assisted: { monthly: { kind: "monthly", amountCents: 600 } } });
    expect(card("addon-storage-10gb")).toMatchObject({ kind: "quantity", state: "on_request", assisted: { monthly: { kind: "monthly", amountCents: 500 } } });
    expect(primaryAction(card("addon-user-essential"), view)).toEqual(ASSISTED);
    expect(primaryAction(card("addon-storage-10gb"), view)).toEqual(ASSISTED);
    for (const key of ["addon-user-business", "addon-site-business"]) {
      const c = card(key);
      expect(c.state, key).toBe("not_eligible");
      expect(c.assisted, key).toBeNull();
      expect(primaryAction(c, view).kind, key).not.toBe("assisted");
    }
  });

  it("marketplace Business: usuario Business, almacenamiento y sede (también «en preparación»), asistidos; el de Essential no", () => {
    const items = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: true, site }).items;
    const out = buildConnectCatalog({ items }, [], NOW, "business");
    const view = { canPurchase: true, interestEnabled: true };
    const card = (key: string) => out.find((i) => i.key === key)!;
    for (const [key, cents] of [["addon-user-business", 500], ["addon-storage-10gb", 500], ["addon-site-business", 1200]] as const) {
      expect(card(key), key).toMatchObject({ state: "on_request", assisted: { monthly: { amountCents: cents } } });
      expect(primaryAction(card(key), view), key).toEqual(ASSISTED);
    }
    expect(card("addon-user-essential").state).toBe("not_eligible");
    expect(card("addon-user-essential").assisted).toBeNull();
  });

  it("solicitud desde el panel: abre el expediente una sola vez; otra ampliación de otro plan se rechaza; nada se cobra", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const impl = new MemoryImplementationStore();
    const svc: ImplementationService = new ImplementationService({ store: impl, crm, crmStore: store, solution: solutionFromWebStore(webStore), now: () => NOW, markAttended: async (id, who) => void (await requests.setStatus(id, "attended", who)) });
    const requests: WebRequestService = new WebRequestService({ store, crm, now: () => NOW, onCreated: async (r) => void (await svc.fromIntake(r)) });
    const c = await crm.createCompany({ name: "Tienda Demo", legalName: "Tienda Demo SL" }, "operator:test");
    await store.update("companies", c.id, { tenantId: "t9-tienda" });
    const d = { site, internal: false, requests, crm: store, implementations: impl, planOf: async () => "essential" };
    const body = (k: string, over: Record<string, unknown> = {}) => ({ type: "implementation" as const, interest: "addon-user-essential", requester: { name: "Ana", email: "ana@tienda.example" }, idempotencyKey: k, ...over });
    expect((await receivePanelRequest(d, "t9-tienda", body("clave-usu-0001"))).outcome).toBe("created");
    await flush();
    expect(impl.rows.map((o) => [o.companyId, o.solutionKey, o.status])).toEqual([[c.id, "addon-user-essential", "requested"]]);
    const again = await receivePanelRequest(d, "t9-tienda", body("clave-usu-0002", { message: "¿Cuándo?" }));
    expect(again).toMatchObject({ outcome: "duplicate", reference: impl.rows[0].reference });
    // Sede adicional «en preparación»: se contrata (no «Me interesa»), pero es de Business
    await expect(receivePanelRequest(d, "t9-tienda", body("clave-sede-0001", { interest: "addon-site-business" }))).rejects.toMatchObject({ status: 409 });
    await expect(receivePanelRequest(d, "t9-tienda", body("clave-sede-0002", { type: "waitlist", interest: "addon-site-business" }))).rejects.toMatchObject({ status: 409 });
    expect(await store.list("leadRequests", {})).toHaveLength(1);

    const t = templateFor("addon-user-essential");
    expect(t).toMatchObject({ key: "addon-user-essential", generic: false, name: "Implantación de Usuario adicional Essential" });
    expect(t.items.some((i) => i.section === "comprobaciones" && /límite ampliado/.test(i.title))).toBe(true);
    for (const a of ADDON_ASSISTED) {
      const text = netCommitmentsText(a.key)!;
      expect(text, a.key).toMatch(new RegExp(`^Compromisos de implantación de ${a.name}\\.`));
      expect(text, a.key).toContain("Se aplica a los límites de tu empresa al aceptar el contrato.");
    }
  });
});

describe("paquete personalizado de una ampliación desde el expediente", () => {
  async function kit(o: { units?: number; global?: boolean; key?: string } = {}) {
    const key = o.key ?? "addon-user-essential";
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store, now: () => NOW });
    const c = await crm.createCompany({ name: `Empresa ${Math.random().toString(36).slice(2, 8)}`, legalName: "Empresa SL" }, "operator:test");
    const opp = await crm.createOpportunity({ companyId: c.id, title: "Usuarios adicionales" }, "operator:test");
    const catalog = catalogFromWebStore(webStore);
    const subStore = new MemorySubscriptionStore();
    const crmPort: CrmPort = { company: async (id) => (id === c.id ? { id, name: "Empresa" } : null), contract: async () => null };
    const subs = new SubscriptionService({ store: subStore, catalog, crm: crmPort, now: () => NOW });
    const termsStore = new MemoryTermsStore();
    const terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: subStore, catalog, crm: crmPort, now: () => NOW, stripeBilled: async () => false });
    const offer = await catalog.offer();
    const monthly = (k: string) => offer.find((p) => p.key === k)!.prices.find((x) => x.kind === "monthly" && x.status === "approved")!.id;
    const sub = await subs.create({ companyId: c.id, tenantId: "t-empresa", interval: "month", plan: { productKey: "essential", priceId: monthly("essential") }, addons: o.units ? [{ productKey: "addon-user-essential", priceId: monthly("addon-user-essential"), quantity: o.units }] : [] }, "operator:test");
    if (o.global) {
      const draft = await terms.createForSubscription(sub.id, { pricingMode: "global", globalAmountCents: 4000, presentation: "global", conditions: "Cuota global pactada.", lines: [{ kind: "catalog", productKey: "essential", priceId: monthly("essential") }, { kind: "catalog", productKey: "addon-user-essential", priceId: monthly("addon-user-essential"), quantity: o.units ?? 1 }], reason: "Acuerdo comercial negociado" }, "operator:test");
      await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(sub.id)).version }, "operator:test");
    }
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
    const { order } = await svc.open({ opportunityId: opp.id, solutionKey: key }, "operator:laura");
    return { svc, terms, subStore, sub, order, companyId: c.id };
  }

  it("con 2 usuarios adicionales ya contratados: acuerdo nuevo sobre la suscripción con 3 (nunca «ya incluye»)", async () => {
    const k = await kit({ units: 2 });
    const r = await k.svc.preparePackage(k.order.id, "operator:laura");
    expect(r.created).toBe(true);
    const t = await k.terms.must(r.termsId);
    expect(t).toMatchObject({ subscriptionId: k.sub.id, status: "draft", requiresAcceptance: true, pricingMode: "per_item" });
    expect(t.lines.map((l) => [l.productKey, l.quantity])).toEqual([["essential", 1], ["addon-user-essential", 3]]);
    expect(t.conditions).toContain("Precio: Usuario adicional Essential pasa de 2 unidades a 3 unidades, a su precio por unidad (6,00 € al mes cada una, IVA aparte)");
    expect(t.conditions).toContain(netCommitmentsText("addon-user-essential")!);
    // Ninguna suscripción nueva; repetir devuelve el mismo borrador
    expect((await k.subStore.list({ companyId: k.companyId })).map((s) => s.id)).toEqual([k.sub.id]);
    expect(await k.svc.preparePackage(k.order.id, "operator:laura")).toEqual({ termsId: r.termsId, created: false });
  });

  it("con cuota global en vigor que ya incluye la ampliación: se suma una unidad a la cuota y a la partida", async () => {
    const k = await kit({ units: 2, global: true });
    const t = await k.terms.must((await k.svc.preparePackage(k.order.id, "operator:laura")).termsId);
    expect(t).toMatchObject({ subscriptionId: k.sub.id, status: "draft", pricingMode: "global", globalAmountCents: 4000 + 600 });
    expect(t.lines.map((l) => [l.productKey, l.quantity])).toEqual([["essential", 1], ["addon-user-essential", 3]]);
  });

  it("sin la ampliación contratada: se añade una unidad", async () => {
    const k = await kit();
    const t = await k.terms.must((await k.svc.preparePackage(k.order.id, "operator:laura")).termsId);
    expect(t.lines.map((l) => [l.productKey, l.quantity])).toEqual([["essential", 1], ["addon-user-essential", 1]]);
  });

  it("un producto que no es ampliación sigue sin contratarse dos veces", () => {
    expect(addonAssistedOf("hotel-net-complete")).toBeNull();
    expect(addonAssistedOf("connect-voice")).toBeNull();
  });
});
