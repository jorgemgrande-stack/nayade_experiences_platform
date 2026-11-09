/**
 * Paquete Marketing: la licencia del paquete concede las cuatro capacidades de sus módulos, el menú muestra sus cuatro
 * entradas y la de «Puesta en marcha y resumen», y el resumen (lógica pura + agregador con dependencias de prueba)
 * calcula el estado, el siguiente paso y las cifras de cada módulo sin exponer secretos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { CapabilityAccess } from "./_core/capabilities/access";
import { TRPC_ROUTER_CAPABILITIES } from "./_core/capabilities/routeGuard";
import { LicensingService, capabilitiesOf } from "./licensing/service";
import { productDraft } from "./web/schemas";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { resolveNav, routeAccess, TASK_NAV } from "../shared/adminNav";
import { navOpenPathResolver } from "./connectShowcase";
import {
  MARKETING_PACK_CAPABILITIES,
  marketingPackSummary,
  type AdsFacts,
  type CampaignsFacts,
  type GeoFacts,
  type MarketingPackInput,
  type SeoFacts,
} from "../shared/marketingPack";
import { getMarketingPackSummary, type MarketingPackDeps } from "./marketingPack";

const NOW = Date.UTC(2026, 10, 9, 10);
const PACK_CAPS = ["ads-manager", "email-campaigns", "geo-control", "seo-control"];

describe("licencia del Paquete Marketing", () => {
  let caps: MemoryCapabilityStore;
  let licensing: LicensingService;
  let subs: SubscriptionService;
  let priceOf: (key: string) => Promise<number>;

  beforeEach(async () => {
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
    await seedElephantSource(web, webStore);
    priceOf = async (key) => {
      const e = (await webStore.getEntry("product", key))!;
      return (await webStore.listPrices(e.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
    };
    const crm: CrmPort = {
      company: async (id) => (id === 1 ? { id: 1, name: "Acme" } : null),
      contract: async (id) => (id === 10 ? { id: 10, reference: "CT-2026-000010", companyId: 1, status: "signed", amountCents: null, currency: "EUR", billingInterval: "month", tenantId: "acme" } : null),
    };
    const store = new MemorySubscriptionStore();
    caps = new MemoryCapabilityStore();
    subs = new SubscriptionService({ store, catalog: catalogFromWebStore(webStore), crm, now: () => NOW });
    licensing = new LicensingService({ capabilities: caps, subscriptions: store, crm, catalog: async () => quoteCatalogFromSite(await web.site("published")), now: () => NOW });
    catalog = async () => quoteCatalogFromSite(await web.site("published"));
    // Como lo deja la revisión preparada (review20261109packmarketing.ts): «Implantación acompañada», contratable por el equipo
    publishOnRequest = async () => {
      const e = (await webStore.getEntry("product", "connect-pack-marketing"))!;
      const d = productDraft.parse(e.draft);
      const draft = productDraft.parse({ ...d, technicalStatus: "partial", activation: { kind: "feature", ref: null }, catalog: { ...d.catalog, commercialStatus: "on_request" }, commercial: { ...d.commercial, cta: "contact", headline: "Todo tu marketing en un paquete." }, internal: { ...d.internal, functionalGrade: "in_use" } });
      const saved = await web.save("product", e.key, { draft, expectedVersion: e.draftVersion }, "operator:1");
      await web.publish("product", e.key, saved.draftVersion, "operator:1");
    };
  });
  let catalog: () => Promise<ReturnType<typeof quoteCatalogFromSite>>;
  let publishOnRequest: () => Promise<void>;

  it("el paquete expande a las capacidades de sus cuatro componentes en el catálogo publicado", async () => {
    const c = await catalog();
    const byKey = new Map(c.products.map((p) => [p.key, p]));
    expect(Array.from(capabilitiesOf(byKey.get("connect-pack-marketing"), byKey)).sort()).toEqual(PACK_CAPS);
  });

  it("en «Próximamente» (como hoy) no se puede contratar", async () => {
    await expect(subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "essential", priceId: await priceOf("essential") }, addons: [{ productKey: "connect-pack-marketing", priceId: await priceOf("connect-pack-marketing") }] } as never, "operator:ana")).rejects.toThrow(/no es contratable/);
  });

  it("solo con el paquete se conceden ads-manager, email-campaigns, seo-control y geo-control (y nada más fuera del plan)", async () => {
    await publishOnRequest();
    const s = await subs.create({ companyId: 1, contractId: 10, interval: "month", plan: { productKey: "essential", priceId: await priceOf("essential") }, addons: [{ productKey: "connect-pack-marketing", priceId: await priceOf("connect-pack-marketing") }] } as never, "operator:ana");
    const r = await licensing.apply(s.id, { activate: true, actor: "operator:ana" });
    const extra = r.desired.filter((d) => !capabilitiesOfTier("essential").includes(d.capabilityId));
    expect(extra.map((d) => d.capabilityId).sort()).toEqual(PACK_CAPS);
    expect(extra.every((d) => d.grantedBy.length === 1 && d.grantedBy[0] === "connect-pack-marketing")).toBe(true);
    const access = new CapabilityAccess(caps, { enforce: true, now: () => NOW });
    for (const c of PACK_CAPS) expect((await access.check(c, { write: true, tenantId: "acme" })).allowed, c).toBe(true);
    expect((await access.check("reception-ai", { write: false, tenantId: "acme" })).allowed).toBe(false);
  });
});

describe("menú con el Paquete Marketing", () => {
  const menu = (active: string[]) =>
    resolveNav(TASK_NAV, { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: (id) => (active.includes(id) ? "active" : null) })
      .flatMap((s) => s.items)
      .map((i) => i.href);

  it("con las cuatro capacidades del paquete aparecen sus entradas y el resumen", () => {
    const hrefs = menu(PACK_CAPS);
    for (const h of ["/admin/marketing/ads", "/admin/marketing/campanas", "/admin/marketing/brevo", "/admin/marketing/seo", "/admin/marketing/geo", "/admin/marketing/resumen"]) expect(hrefs, h).toContain(h);
  });
  it("el resumen aparece con cualquiera de las cuatro; sin ninguna, no", () => {
    for (const c of PACK_CAPS) expect(menu([c]), c).toContain("/admin/marketing/resumen");
    expect(menu(["crm-leads"])).not.toContain("/admin/marketing/resumen");
    expect(routeAccess("/admin/marketing/resumen", () => null)).toBe("not_included");
    expect(routeAccess("/admin/marketing/resumen", (id) => (id === "geo-control" ? "read_only" : null))).toBe("read_only");
    expect(routeAccess("/admin/marketing/resumen", (id) => (id === "seo-control" ? "active" : null))).toBe("allowed");
  });
  it("el agente no ve el resumen (solo administración)", () => {
    const agent = resolveNav(TASK_NAV, { role: "agente", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: () => "active" }).flatMap((s) => s.items).map((i) => i.href);
    expect(agent).not.toContain("/admin/marketing/resumen");
  });
  it("«Gestionar» del paquete (sus cuatro capacidades) abre el resumen; cada módulo, su pantalla", () => {
    const open = navOpenPathResolver(TASK_NAV, "admin");
    expect(open(["geo-control", "seo-control", "ads-manager", "email-campaigns"])).toBe("/admin/marketing/resumen");
    expect(open(["ads-manager"])).toBe("/admin/marketing/ads");
    expect(open(["geo-control"])).toBe("/admin/marketing/geo");
  });
  it("el namespace del resumen no se asocia a una sola capacidad en el guardián de rutas", () => {
    expect(TRPC_ROUTER_CAPABILITIES.marketingPack).toBeUndefined();
    expect(MARKETING_PACK_CAPABILITIES.slice().sort()).toEqual(PACK_CAPS);
  });
});

// ── Resumen ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const TODAY = "2026-11-09";
const ads0: AdsFacts = { metaConnected: false, googleConnected: false, csvImported: false, campaigns: 0, spendCents: 0, sales: null, roas: null, currency: "EUR" };
const camp0: CampaignsFacts = { brevoConnected: false, listName: null, consentsGranted: 0, lastSync: null, campaignsSent: 0, lastOpenRate: null };
const seo0: SeoFacts = { searchConsoleConnected: false, searchConsoleImported: false, reviewsConnected: false, keywords: 0, top10: 0, averagePosition: null, auditDone: false };
const geo0: GeoFacts = { brandConfigured: false, queries: 0, observations: 0, lastObservedOn: null, presenceRate: null };
const all = (over: Partial<MarketingPackInput> = {}): MarketingPackInput => ({
  ads: { licence: "active", facts: ads0 },
  campaigns: { licence: "active", facts: camp0 },
  seo: { licence: "active", facts: seo0 },
  geo: { licence: "active", facts: geo0 },
  ...over,
});
const mod = (s: ReturnType<typeof marketingPackSummary>, id: string) => s.modules.find((m) => m.id === id)!;

describe("resumen del Paquete Marketing (lógica pura)", () => {
  it("todo por empezar: primer paso de cada módulo con su pantalla", () => {
    const s = marketingPackSummary(all(), TODAY);
    expect(s).toMatchObject({ included: 4, ready: 0, complete: true });
    expect(s.modules.map((m) => m.state)).toEqual(["to_start", "to_start", "to_start", "to_start"]);
    expect(mod(s, "ads").nextStep!.href).toBe("/admin/marketing/ads?tab=importar");
    expect(mod(s, "campaigns").nextStep!.href).toBe("/admin/configuracion/integraciones");
    expect(mod(s, "seo").nextStep!.href).toBe("/admin/configuracion/integraciones");
    expect(mod(s, "geo").nextStep!.href).toBe("/admin/marketing/geo?tab=ajustes");
    for (const m of s.modules) expect(m.figures.length, m.id).toBeGreaterThanOrEqual(2);
    expect(mod(s, "ads").figures.map((f) => f.value)).toEqual(["Sin datos", "Sin datos", "Sin datos"]);
  });

  it("no incluidos: «No incluido» con enlace a /admin/ampliar y sin cifras", () => {
    const s = marketingPackSummary(all({ ads: { licence: null }, seo: { licence: null } }), TODAY);
    expect(s).toMatchObject({ included: 2, complete: false });
    for (const id of ["ads", "seo"]) expect(mod(s, id)).toMatchObject({ state: "not_included", stateLabel: "No incluido", figures: [], checks: [], nextStep: { href: "/admin/ampliar" } });
  });

  it("Ads Manager: con CSV importado y campañas está funcionando; sin ventas atribuidas pide relacionarlas", () => {
    let s = marketingPackSummary(all({ ads: { licence: "active", facts: { ...ads0, csvImported: true, campaigns: 3, spendCents: 1_234_567 } } }), TODAY);
    expect(mod(s, "ads")).toMatchObject({ state: "ready", nextStep: { href: "/admin/marketing/ads?tab=importar" } });
    expect(mod(s, "ads").nextStep!.label).toMatch(/Relaciona tus ventas/);
    expect(mod(s, "ads").figures[0].value).toMatch(/^12\.346\s€$/);
    s = marketingPackSummary(all({ ads: { licence: "active", facts: { ...ads0, metaConnected: true, campaigns: 2, spendCents: 50_000, sales: 4, roas: 3.25 } } }), TODAY);
    expect(mod(s, "ads").figures.map((f) => f.value.replace(/\s/g, " "))).toEqual(["500 €", "4", "3,3×"]);
    expect(mod(s, "ads").nextStep!.href).toBe("/admin/marketing/ads");
    s = marketingPackSummary(all({ ads: { licence: "active", facts: { ...ads0, googleConnected: true } } }), TODAY);
    expect(mod(s, "ads").state).toBe("in_progress");
  });

  it("Campaigns: Brevo conectado y lista elegida; después consentimientos y primera campaña", () => {
    let s = marketingPackSummary(all({ campaigns: { licence: "active", facts: { ...camp0, brevoConnected: true } } }), TODAY);
    expect(mod(s, "campaigns")).toMatchObject({ state: "in_progress", nextStep: { href: "/admin/marketing/brevo" } });
    s = marketingPackSummary(all({ campaigns: { licence: "active", facts: { ...camp0, brevoConnected: true, listName: "Clientes", consentsGranted: 12 } } }), TODAY);
    expect(mod(s, "campaigns")).toMatchObject({ state: "ready", nextStep: { href: "/admin/marketing/campanas" } });
    expect(mod(s, "campaigns").checks[1].label).toBe("Lista de Brevo elegida: Clientes");
    s = marketingPackSummary(all({ campaigns: { licence: "active", facts: { ...camp0, brevoConnected: true, listName: "Clientes", consentsGranted: 12000, campaignsSent: 3, lastOpenRate: 0.4234 } } }), TODAY);
    expect(mod(s, "campaigns").figures.map((f) => f.value)).toEqual(["12.000", "3", "42 %"]);
  });

  it("SEO Control: Search Console y palabras clave; después importación y auditoría", () => {
    let s = marketingPackSummary(all({ seo: { licence: "active", facts: { ...seo0, keywords: 5 } } }), TODAY);
    expect(mod(s, "seo")).toMatchObject({ state: "in_progress", nextStep: { href: "/admin/configuracion/integraciones" } });
    s = marketingPackSummary(all({ seo: { licence: "active", facts: { ...seo0, searchConsoleConnected: true, keywords: 5 } } }), TODAY);
    expect(mod(s, "seo")).toMatchObject({ state: "ready", nextStep: { href: "/admin/marketing/seo?tab=gsc" } });
    s = marketingPackSummary(all({ seo: { licence: "active", facts: { ...seo0, searchConsoleConnected: true, searchConsoleImported: true, keywords: 5, top10: 2, averagePosition: 8.25 } } }), TODAY);
    expect(mod(s, "seo").nextStep!.href).toBe("/admin/marketing/seo?tab=auditoria");
    expect(mod(s, "seo").figures.map((f) => f.value)).toEqual(["5", "2", "8,3"]);
    // Las reseñas son opcionales: no cuentan para «en marcha»
    s = marketingPackSummary(all({ seo: { licence: "active", facts: { ...seo0, reviewsConnected: true } } }), TODAY);
    expect(mod(s, "seo").state).toBe("to_start");
  });

  it("GEO Control: marca, consultas y observaciones; una observación antigua pide anotar de nuevo", () => {
    let s = marketingPackSummary(all({ geo: { licence: "active", facts: { ...geo0, brandConfigured: true } } }), TODAY);
    expect(mod(s, "geo")).toMatchObject({ state: "in_progress", nextStep: { href: "/admin/marketing/geo?tab=consultas" } });
    s = marketingPackSummary(all({ geo: { licence: "active", facts: { ...geo0, brandConfigured: true, queries: 8 } } }), TODAY);
    expect(mod(s, "geo").nextStep!.href).toBe("/admin/marketing/geo?tab=observaciones");
    s = marketingPackSummary(all({ geo: { licence: "active", facts: { brandConfigured: true, queries: 8, observations: 20, lastObservedOn: "2026-09-01", presenceRate: 0.5 } } }), TODAY);
    expect(mod(s, "geo")).toMatchObject({ state: "ready" });
    expect(mod(s, "geo").nextStep!.label).toMatch(/la última es del 01\/09\/2026/);
    expect(mod(s, "geo").figures.map((f) => f.value)).toEqual(["8", "01/09/2026", "50 %"]);
    s = marketingPackSummary(all({ geo: { licence: "active", facts: { brandConfigured: true, queries: 8, observations: 20, lastObservedOn: "2026-11-01", presenceRate: 0.5 } } }), TODAY);
    expect(mod(s, "geo").nextStep!.href).toBe("/admin/marketing/geo?tab=oportunidades");
  });

  it("solo lectura y error de un módulo", () => {
    const s = marketingPackSummary(all({ geo: { licence: "read_only", facts: geo0 }, seo: { licence: "active", error: "SEO Control aún no está preparado en tu empresa" } }), TODAY);
    expect(mod(s, "geo")).toMatchObject({ readOnly: true });
    expect(mod(s, "geo").message).toMatch(/solo lectura/);
    expect(mod(s, "seo")).toMatchObject({ state: "unavailable", message: "SEO Control aún no está preparado en tu empresa", nextStep: { href: "/admin/marketing/seo" } });
  });
});

describe("agregador del resumen (dependencias de prueba)", () => {
  const facts = (over: Partial<MarketingPackDeps["facts"]> = {}): MarketingPackDeps["facts"] => ({
    ads: async () => ads0,
    campaigns: async () => camp0,
    seo: async () => seo0,
    geo: async () => geo0,
    ...over,
  });
  const deps = (licences: Record<string, "active" | "read_only" | null>, over: Partial<MarketingPackDeps["facts"]> = {}, read: string[] = []): MarketingPackDeps => ({
    licence: async (c) => licences[c] ?? null,
    facts: {
      ...facts(over),
      // Registra qué módulos se han leído
      ...Object.fromEntries(
        Object.entries(facts(over)).map(([k, fn]) => [
          k,
          async () => {
            read.push(k);
            return (fn as () => Promise<unknown>)();
          },
        ]),
      ),
    } as MarketingPackDeps["facts"],
    today: () => TODAY,
  });

  it("sin ninguna de las cuatro capacidades: 403", async () => {
    await expect(getMarketingPackSummary(deps({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("solo lee los módulos licenciados (cada bloque con su capacidad)", async () => {
    const read: string[] = [];
    const s = await getMarketingPackSummary(deps({ "geo-control": "active", "email-campaigns": "read_only" }, {}, read));
    expect(read.sort()).toEqual(["campaigns", "geo"]);
    expect(s.modules.map((m) => [m.id, m.state])).toEqual([
      ["ads", "not_included"],
      ["campaigns", "to_start"],
      ["seo", "not_included"],
      ["geo", "to_start"],
    ]);
  });

  it("un módulo que falla no tumba el resumen ni filtra el detalle interno", async () => {
    const s = await getMarketingPackSummary(
      deps(Object.fromEntries(PACK_CAPS.map((c) => [c, "active"])), {
        ads: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.5:3306 password=supersecreto");
        },
        seo: async () => {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SEO Control aún no está preparado en tu empresa: falta aplicar la actualización 0054_connect_seo_control de su base de datos." });
        },
      }),
    );
    expect(mod(s, "ads").state).toBe("unavailable");
    expect(mod(s, "ads").message).toMatch(/No se ha podido leer el estado de Ads Manager/);
    expect(mod(s, "seo").message).toMatch(/0054_connect_seo_control/);
    expect(JSON.stringify(s)).not.toMatch(/supersecreto|ECONNREFUSED|10\.0\.0\.5/);
    expect(mod(s, "geo").state).toBe("to_start");
  });

  it("la respuesta no lleva campos de credenciales", async () => {
    const s = await getMarketingPackSummary(deps(Object.fromEntries(PACK_CAPS.map((c) => [c, "active"]))));
    expect(JSON.stringify(s)).not.toMatch(/apiKey|token|secret|password|serviceAccount|refresh/i);
  });
});
