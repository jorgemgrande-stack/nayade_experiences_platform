/**
 * Comparador de planes de «Suscripción»: planes publicados por el plano de control (panelCatalog.plans), lectura
 * defensiva en el panel y acción de cada tarjeta según lo que el servidor permite (prueba, cambio, asistida, rol).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { buildPlanComparison, parsePanelPlans, planDifferences, relatedRecommendations, type PanelPlanInfo, type PlanChangeInfo } from "../shared/subscriptionPlans";

const NOW = Date.UTC(2026, 10, 1, 12);
let site: SiteDocument;

beforeAll(async () => {
  const store = new MemoryWebStore();
  const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  site = await web.site("published");
});

const plan = (key: string, o: Partial<PanelPlanInfo> = {}): PanelPlanInfo => ({
  key,
  name: key[0].toUpperCase() + key.slice(1),
  commercialStatus: "available",
  inherits: null,
  tagline: null,
  description: null,
  forWho: null,
  highlight: false,
  benefits: [],
  limits: [],
  monthly: null,
  yearly: null,
  assisted: null,
  offerLabel: null,
  ...o,
});
const PLANS = [
  plan("essential", { limits: [{ label: "Usuarios", value: "3", metric: "users" }, { label: "Sedes", value: "1", metric: "sites" }] }),
  plan("business", { limits: [{ label: "Usuarios", value: "15", metric: "users" }, { label: "Sedes", value: "1", metric: "sites" }] }),
  plan("enterprise", { commercialStatus: "in_preparation", assisted: true, offerLabel: "Implantación asistida" }),
];
const base = { plans: PLANS, isAdmin: true, conversion: null, planChange: null };
const ctaOf = (cards: ReturnType<typeof buildPlanComparison>, key: string) => cards.find((c) => c.plan.key === key)!.cta;

describe("plano de control: planes publicados en el catálogo del panel", () => {
  it("incluye Essential, Business y Enterprise con sus precios aprobados y límites publicados", () => {
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site });
    expect(cat.plans.map((p) => p.key)).toEqual(["essential", "business", "enterprise"]);
    const essential = cat.plans[0];
    expect(essential.prices.map((p) => p.kind).sort()).toEqual(["monthly", "yearly"]);
    expect(essential.limits.find((l) => l.metric === "users")?.value).toBe("3");
    expect(essential.tagline).not.toBe("");
    // Los planes no entran en el carrito del panel
    expect(cat.items.some((i) => i.family === "core_plan")).toBe(false);
  });

  it("el panel lee lo publicado sin perder datos y en orden de plan", () => {
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site });
    const parsed = parsePanelPlans(JSON.parse(JSON.stringify([...cat.plans].reverse())));
    expect(parsed.map((p) => p.key)).toEqual(["essential", "business", "enterprise"]);
    const e = parsed[0];
    expect(e.monthly?.amountCents).toBe(cat.plans[0].prices.find((p) => p.kind === "monthly")!.amountCents);
    expect(e.limits.length).toBe(cat.plans[0].limits.length);
  });

  it("es idempotente: lo que el Core ya normalizó y reenvía al navegador conserva precios y modalidad", () => {
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site });
    const once = parsePanelPlans(JSON.parse(JSON.stringify(cat.plans)));
    const twice = parsePanelPlans(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(twice.every((p) => p.monthly !== null)).toBe(true);
  });
});

describe("parsePanelPlans", () => {
  it("sin campo o mal formado → lista vacía; descarta entradas sin clave o nombre y precios inválidos", () => {
    expect(parsePanelPlans(undefined)).toEqual([]);
    expect(parsePanelPlans({})).toEqual([]);
    const r = parsePanelPlans([{ key: "Mal Clave", name: "X" }, { key: "essential" }, { key: "business", name: "Business", prices: [{ kind: "monthly", amountCents: -5, currency: "EUR" }] }]);
    expect(r.map((p) => p.key)).toEqual(["business"]);
    expect(r[0].monthly).toBeNull();
    expect(r[0].commercialStatus).toBe("on_request");
  });
});

describe("buildPlanComparison", () => {
  it("prueba con alta en línea: «Prueba gratuita» en el plan probado y «Contratar» en los de autoservicio; Enterprise, contacto", () => {
    const cards = buildPlanComparison({ ...base, currentPlanKey: "essential", state: "trial", conversion: { enabled: true } });
    const ess = cards.find((c) => c.plan.key === "essential")!;
    expect(ess.currentLabel).toBe("Prueba gratuita");
    expect(ess.cta).toEqual({ kind: "convert", plan: "essential" });
    expect(ctaOf(cards, "business")).toEqual({ kind: "convert", plan: "business" });
    expect(ctaOf(cards, "enterprise")).toEqual({ kind: "contact", request: "contract" });
    expect(cards.find((c) => c.plan.key === "enterprise")!.commercialLabel).toBe("Implantación asistida");
  });

  it("prueba sin alta en línea: ningún botón de compra, solo solicitud de contratación", () => {
    const cards = buildPlanComparison({ ...base, currentPlanKey: "essential", state: "trial", conversion: { enabled: false } });
    expect(cards.every((c) => c.cta.kind === "contact" && c.cta.request === "contract")).toBe(true);
  });

  it("Essential de pago con cambio en línea: «Tu plan actual» y cambio a Business con la opción del servidor (mismo periodo)", () => {
    const planChange: PlanChangeInfo = {
      enabled: true,
      available: true,
      current: { plan: "essential", interval: "year" },
      options: [
        { plan: "business", interval: "month", direction: "upgrade", recurringCents: 7900, currency: "EUR" },
        { plan: "business", interval: "year", direction: "upgrade", recurringCents: 75900, currency: "EUR" },
        { plan: "essential", interval: "month", direction: "downgrade", recurringCents: 2900, currency: "EUR" },
      ],
    };
    const cards = buildPlanComparison({ ...base, currentPlanKey: "essential", state: "active", planChange });
    const ess = cards.find((c) => c.plan.key === "essential")!;
    expect(ess.currentLabel).toBe("Tu plan actual");
    expect(ess.cta).toEqual({ kind: "current" });
    expect(ctaOf(cards, "business")).toEqual({ kind: "change", plan: "business", interval: "year", direction: "upgrade", recurringCents: 75900, currency: "EUR" });
    expect(ctaOf(cards, "enterprise")).toEqual({ kind: "contact", request: "upgrade" });
  });

  it("Business de pago sin bajada en línea: Essential por solicitud de cambio; Enterprise por solicitud de ampliación", () => {
    const planChange: PlanChangeInfo = { enabled: true, available: true, current: { plan: "business", interval: "month" }, options: [] };
    const cards = buildPlanComparison({ ...base, currentPlanKey: "business", state: "active", planChange });
    expect(ctaOf(cards, "essential")).toEqual({ kind: "contact", request: "change" });
    expect(ctaOf(cards, "business")).toEqual({ kind: "current" });
    expect(ctaOf(cards, "enterprise")).toEqual({ kind: "contact", request: "upgrade" });
  });

  it("el cambio no disponible para la suscripción no ofrece botones de cambio", () => {
    const planChange: PlanChangeInfo = { enabled: true, available: false, current: null, options: [] };
    const cards = buildPlanComparison({ ...base, currentPlanKey: "essential", state: "active", planChange });
    expect(cards.some((c) => c.cta.kind === "change" || c.cta.kind === "convert")).toBe(false);
  });

  it("rol que no es administración: nunca acciones de compra (aunque el servidor las ofreciera)", () => {
    const cards = buildPlanComparison({ ...base, isAdmin: false, currentPlanKey: "essential", state: "trial", conversion: { enabled: true } });
    expect(cards.map((c) => c.cta.kind)).toEqual(["admin_only", "admin_only", "admin_only"]);
    const paid = buildPlanComparison({ ...base, isAdmin: false, currentPlanKey: "essential", state: "active" });
    expect(paid.map((c) => c.cta.kind)).toEqual(["current", "admin_only", "admin_only"]);
  });

  it("diferencias frente al plan actual: solo límites publicados con distinto valor", () => {
    expect(planDifferences(PLANS[1], PLANS[0])).toEqual([{ label: "Usuarios", value: "15", current: "3" }]);
    expect(planDifferences(PLANS[0], PLANS[0])).toEqual([]);
    expect(planDifferences(PLANS[2], PLANS[0])).toEqual([]);
  });
});

describe("relatedRecommendations", () => {
  const item = (key: string, state: string, related: string[] = []) => ({ key, name: key.toUpperCase(), state, sheet: { related } });
  it("solo recomienda relacionados publicados de lo contratado, que no se tengan y se puedan pedir", () => {
    const items = [item("a", "active", ["b", "c", "d", "e"]), item("b", "available"), item("c", "not_eligible"), item("d", "active"), item("e", "coming_soon"), item("f", "available")];
    expect(relatedRecommendations(items).map((r) => [r.item.key, r.because])).toEqual([
      ["b", "A"],
      ["e", "A"],
    ]);
  });
  it("sin nada contratado o sin relaciones, no recomienda", () => {
    expect(relatedRecommendations([item("a", "available", ["b"]), item("b", "available")])).toEqual([]);
    expect(relatedRecommendations([item("a", "active"), item("b", "available")])).toEqual([]);
  });
});
