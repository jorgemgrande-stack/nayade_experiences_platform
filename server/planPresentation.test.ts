/**
 * Presentación comercial de los planes en «Suscripción»: mensajes por plan, formato de importes (sin cambiar el
 * importe), lo que cabe en la tarjeta y la comparativa completa (con lo que cambia frente al plan actual).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog } from "./commerce/panelCatalog";
import { buildPlanComparison, parsePanelPlans, type PanelPlanInfo } from "../shared/subscriptionPlans";
import { CARD_BENEFITS, CARD_LIMITS, cardBenefits, cardLimits, comparisonLimitRows, displayMoney, planPresentation } from "../shared/planPresentation";

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

describe("presentación de los planes", () => {
  it("cada plan publicado en el catálogo tiene público, mensaje y pilares", () => {
    const plans = parsePanelPlans(panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site }).plans);
    expect(plans.map((p) => p.key)).toEqual(["essential", "business", "enterprise"]);
    for (const p of plans) {
      const pr = planPresentation(p);
      expect(pr.audience, p.key).toBeTruthy();
      expect(pr.headline, p.key).toBeTruthy();
      expect(pr.pillars.length, p.key).toBeGreaterThanOrEqual(3);
    }
    expect(planPresentation(plans[0]).headline).toBe("Todo tu negocio, conectado desde el primer día");
    expect(planPresentation(plans[1]).headline).toBe("Más equipo, más control y más capacidad para crecer");
    expect(planPresentation(plans[2]).headline).toBe("Una plataforma adaptada a tu organización");
    expect(planPresentation(plans[0]).pillars).toEqual(["CRM", "Ventas", "Web", "Tienda online", "TPV", "Facturación"]);
  });

  it("un plan desconocido se presenta con lo que publica el catálogo", () => {
    expect(planPresentation(plan("partners", { tagline: "Para socios" }))).toEqual({ audience: null, headline: "Para socios", pillars: [], icon: "layers" });
  });

  it("el importe no cambia: solo se omiten los decimales cuando son cero", () => {
    expect(displayMoney(2900, "EUR").replace(/\s/g, " ")).toBe("29 €");
    expect(displayMoney(189900, "EUR").replace(/\s/g, " ")).toBe("1899 €");
    expect(displayMoney(2950, "EUR").replace(/\s/g, " ")).toBe("29,50 €");
  });

  it("la tarjeta muestra lo principal y la comparativa todo lo demás", () => {
    const limits = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: String(i), metric: `m${i}` }));
    const p = plan("essential", { limits, benefits: ["a", "b", "c", "d", "e", "f"] });
    expect(cardLimits(p)).toHaveLength(CARD_LIMITS);
    expect(cardBenefits(p)).toHaveLength(CARD_BENEFITS);
    const rows = comparisonLimitRows(buildPlanComparison({ plans: [p], currentPlanKey: null, state: "active", isAdmin: true, conversion: null, planChange: null }));
    expect(rows.map((r) => r.label)).toEqual(limits.map((l) => l.label));
  });

  it("la comparativa une los límites y marca lo que cambia frente al plan actual (nunca el actual)", () => {
    const plans = [
      plan("essential", { limits: [{ label: "Usuarios", value: "3", metric: "users" }, { label: "Sedes", value: "1", metric: "sites" }] }),
      plan("business", { limits: [{ label: "Usuarios", value: "15", metric: "users" }, { label: "Sedes", value: "1", metric: "sites" }, { label: "Roles", value: "Personalizados", metric: null }] }),
      plan("enterprise", { limits: [{ label: "Usuarios", value: "Por contrato", metric: "users" }] }),
    ];
    const cards = buildPlanComparison({ plans, currentPlanKey: "essential", state: "trial", isAdmin: true, conversion: { enabled: true }, planChange: null });
    const rows = comparisonLimitRows(cards);
    expect(rows.map((r) => r.label)).toEqual(["Usuarios", "Sedes", "Roles"]);
    expect(rows[0].cells).toEqual([
      { value: "3", differs: false },
      { value: "15", differs: true },
      { value: "Por contrato", differs: true },
    ]);
    expect(rows[1].cells).toEqual([
      { value: "1", differs: false },
      { value: "1", differs: false },
      { value: null, differs: false },
    ]);
    // Sin valor en el plan actual no hay con qué comparar
    expect(rows[2].cells.map((c) => c.differs)).toEqual([false, false, false]);
    // Coincide con «Frente a tu plan» del comparador
    const business = cards.find((c) => c.plan.key === "business")!;
    expect(business.differences.map((d) => d.label)).toEqual(rows.filter((r) => r.cells[1].differs).map((r) => r.label));
  });
});
