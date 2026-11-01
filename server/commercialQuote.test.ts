/**
 * Cotizador comercial (política de planes). La API lo usa con la política construida desde el catálogo (fromCatalog.ts).
 * Importes esperados: los de ESPECIFICACION_COMERCIAL_DEFINITIVA_BIG_ELEPHANT.md (§8 y §14), sin IVA.
 */
import { describe, it, expect } from "vitest";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSeed } from "./catalog/commercial/seedCatalog";
import { CATALOG_POLICY, PROPOSED_POLICY, pendingRules, type CommercialPolicy } from "./catalog/commercial/policy";
import { commercialQuote, previewPlanChange, recommendPlan, roundToEuro, inclusionsOf } from "./catalog/commercial/commercialQuote";

const CAT = quoteCatalogFromSeed();
const eur = (n: number) => Math.round(n * 100);
const P = PROPOSED_POLICY;
const q = (policy: CommercialPolicy, req: Parameters<typeof commercialQuote>[2]) => commercialQuote(CAT, policy, req);
const line = (r: ReturnType<typeof commercialQuote>, key: string) => r.lines.find((l) => l.key === key);

describe("política vigente: mismo resultado que el cotizador publicado", () => {
  const cases = [
    { plan: "essential", interval: "month" as const, users: 5, items: [{ key: "connect-tax" }] },
    { plan: "business", interval: "year" as const, users: 20, sites: 6, items: [{ key: "connect-pack-finance" }, { key: "hotel-net-pms", quantity: 2 }] },
    { plan: "business", interval: "month" as const, items: [{ key: "connect-pack-ai" }, { key: "connect-people" }] },
  ];
  for (const c of cases)
    it(`${c.plan}/${c.interval} con ${c.items.map((i) => i.key).join(", ")}`, () => {
      const base = quote(CAT, c);
      const r = q(CATALOG_POLICY, c);
      expect(r.recurring.monthlyCents).toBe(base.totals.monthlyCents);
      expect(r.recurring.yearlyCents).toBe(base.totals.yearlyCents);
      expect(r.recurring.annualizedCents).toBe(base.totals.annualizedCents);
      expect(r.lines.some((l) => l.status === "included_in_plan")).toBe(false);
    });
});

describe("las seis simulaciones de la especificación (§14)", () => {
  it("1. autónomo: Essential + Tax = 48 €; 507 € al año con plan anual", () => {
    expect(q(P, { plan: "essential", interval: "month", items: [{ key: "connect-tax" }] }).recurring.monthlyCents).toBe(eur(48));
    expect(q(P, { plan: "essential", interval: "year", items: [{ key: "connect-tax" }] }).recurring.annualizedCents).toBe(eur(507));
  });
  // Elephant People no se incluye en ningún plan (01/11/2026): se cobra aparte, 19 €, también en Business y Enterprise
  it("2. servicios: Business + Finance + People = 143 €, aunque se pidan también las incluidas", () => {
    const r = q(P, { plan: "business", interval: "month", users: 10, employees: 10, items: [{ key: "connect-pack-finance" }, { key: "connect-people" }, { key: "connect-automations" }, { key: "extra-contracts-esign" }] });
    expect(r.errors).toEqual([]);
    expect(r.recurring.monthlyCents).toBe(eur(79 + 45 + 19));
    expect(line(r, "connect-automations")?.status).toBe("included_in_plan");
    expect(line(r, "extra-contracts-esign")?.status).toBe("included_in_plan");
    expect(line(r, "connect-people")).toMatchObject({ status: "charged", amountCents: eur(19) });
    expect(r.discounts.planInclusionCents).toBe(eur(29 + 15));
    expect(q(P, { plan: "business", interval: "year", users: 10, items: [{ key: "connect-pack-finance" }] }).recurring.annualizedCents).toBe(eur(1299));
  });
  it("3. comercio: Essential + 1 usuario + Campaigns = 54 €; con POS, 79 €", () => {
    expect(q(P, { plan: "essential", interval: "month", users: 4, items: [{ key: "connect-campaigns" }] }).recurring.monthlyCents).toBe(eur(54));
    expect(q(P, { plan: "essential", interval: "month", users: 4, items: [{ key: "connect-campaigns" }, { key: "connect-pos" }] }).recurring.monthlyCents).toBe(eur(79));
  });
  it("4. restaurante: Essential + Reservas + People = 67 €; Business, 117 € (People se cobra aparte)", () => {
    expect(q(P, { plan: "essential", interval: "month", users: 3, employees: 8, items: [{ key: "restaurant-net-bookings" }, { key: "connect-people" }] }).recurring.monthlyCents).toBe(eur(67));
    const b = q(P, { plan: "business", interval: "month", users: 3, employees: 8, items: [{ key: "restaurant-net-bookings" }, { key: "connect-people" }] });
    expect(b.recurring.monthlyCents).toBe(eur(79 + 19 + 19));
    expect(line(b, "connect-people")).toMatchObject({ status: "charged", amountCents: eur(19) });
    // Desde el 27/10/2026 la solución Elephant Net completa incluye Elephant Core Essential: 59 + 19 (antes 29 + 59 + 19 = 107)
    expect(q(P, { plan: "essential", interval: "month", users: 3, items: [{ key: "restaurant-net-complete" }, { key: "connect-people" }] }).recurring.monthlyCents).toBe(eur(78));
  });
  it("5. hotel: Business + PMS + Motor + Voice = 206 €; 2.283 € al año con plan anual", () => {
    const items = [{ key: "hotel-net-pms" }, { key: "hotel-net-booking-engine" }, { key: "connect-voice" }];
    expect(q(P, { plan: "business", interval: "month", users: 10, employees: 10, items }).recurring.monthlyCents).toBe(eur(206));
    expect(q(P, { plan: "business", interval: "year", users: 10, items }).recurring.annualizedCents).toBe(eur(2283));
    expect(q(P, { plan: "essential", interval: "month", users: 10, items: [...items, { key: "connect-people" }] }).recurring.monthlyCents).toBe(eur(217));
  });
  it("6. multisede: Enterprise + POS × 3 = 274 €; Business con lo mismo, 278 €", () => {
    const e = q(P, { plan: "enterprise", interval: "month", users: 25, sites: 3, employees: 25, items: [{ key: "connect-pos", quantity: 3 }] });
    expect(e.errors).toEqual([]);
    expect(e.recurring.monthlyCents).toBe(eur(274));
    expect(e.lines.some((l) => l.status === "on_quote")).toBe(false);
    expect(q(P, { plan: "enterprise", interval: "year", users: 25, sites: 3, items: [{ key: "connect-pos", quantity: 3 }] }).recurring.annualizedCents).toBe(eur(2799));
    const b = q(P, { plan: "business", interval: "month", users: 25, sites: 3, employees: 25, items: [{ key: "connect-pos", quantity: 3 }, { key: "connect-pack-finance" }, { key: "extra-accounting" }] });
    expect(b.recurring.monthlyCents).toBe(eur(278));
    // Ningún plan añade People por tener empleados: solo si se pide, y se cobra
    expect(line(b, "connect-people")).toBeUndefined();
    expect(line(e, "connect-people")).toBeUndefined();
    const ep = q(P, { plan: "enterprise", interval: "month", users: 25, sites: 3, employees: 25, items: [{ key: "connect-pos", quantity: 3 }, { key: "connect-people" }] });
    expect(ep.errors).toEqual([]);
    expect(ep.recurring.monthlyCents).toBe(eur(274 + 19));
    expect(line(ep, "connect-people")).toMatchObject({ status: "charged", amountCents: eur(19) });
  });
});

describe("paquetes con componentes incluidos (regla min2, propuesta)", () => {
  it("redondeo al euro: los medios euros hacia arriba", () => {
    expect(roundToEuro(2450)).toBe(2500);
    expect(roundToEuro(2449)).toBe(2400);
    expect(roundToEuro(6484)).toBe(6500);
  });
  it("Essential + AI Suite: precio del paquete, 49 €", () => {
    expect(q(P, { plan: "essential", interval: "month", items: [{ key: "connect-pack-ai" }] }).recurring.monthlyCents).toBe(eur(29 + 49));
  });
  it("Business + AI Suite: queda un componente, se cobra Copilot suelto (29 €)", () => {
    const r = q(P, { plan: "business", interval: "month", items: [{ key: "connect-pack-ai" }] });
    expect(r.recurring.monthlyCents).toBe(eur(79 + 29));
    expect(line(r, "connect-copilot")?.status).toBe("charged");
    expect(line(r, "connect-pack-ai")).toBeUndefined();
  });
  it("Enterprise + AI Suite: todo incluido, 0 €", () => {
    const r = q(P, { plan: "enterprise", interval: "month", items: [{ key: "connect-pack-ai" }] });
    expect(r.recurring.monthlyCents).toBe(eur(199));
    expect(line(r, "connect-pack-ai")?.status).toBe("included_in_plan");
  });
  it("hipotético: plan con Campaigns incluido + Marketing = 79 × 87/106 → 65 €", () => {
    const pol: CommercialPolicy = { ...P, inclusions: [...P.inclusions, { plan: "business", key: "connect-campaigns", mode: "full", status: "proposed" }] };
    const r = q(pol, { plan: "business", interval: "month", items: [{ key: "connect-pack-marketing" }] });
    expect(line(r, "connect-pack-marketing")?.status).toBe("bundle_adjusted");
    expect(r.recurring.monthlyCents).toBe(eur(79 + 65));
  });
  it("hipotético: plan con Tax incluido + Finance = 45 × 38/57 → 30 €", () => {
    const pol: CommercialPolicy = { ...P, inclusions: [...P.inclusions, { plan: "business", key: "connect-tax", mode: "full", status: "proposed" }] };
    expect(q(pol, { plan: "business", interval: "month", items: [{ key: "connect-pack-finance" }] }).recurring.monthlyCents).toBe(eur(79 + 30));
  });
  it("con la regla vigente, un paquete con componentes incluidos es un error explícito (nunca un cobro doble)", () => {
    const pol: CommercialPolicy = { ...P, bundleRule: { kind: "catalog", status: "approved" } };
    expect(q(pol, { plan: "business", interval: "month", items: [{ key: "connect-pack-ai" }] }).ok).toBe(false);
  });
});

describe("no cobrar dos veces, cupos y ampliaciones", () => {
  it("una extensión ya contratada que el plan incluye deja de cobrarse (People no: ningún plan lo incluye)", () => {
    const r = q(P, { plan: "business", interval: "month", owned: ["connect-people", "connect-automations"] });
    expect(r.absorbedByPlan.sort()).toEqual(["connect-automations"]);
    expect(r.recurring.monthlyCents).toBe(eur(79));
  });
  it("People en cualquier plan: 19 € por empresa si se contrata, sin tope de empleados ni parte incluida", () => {
    for (const employees of [15, 30]) {
      const r = q(P, { plan: "business", interval: "month", users: 15, employees });
      expect(r.recurring.monthlyCents).toBe(eur(79));
      expect(line(r, "connect-people")).toBeUndefined();
    }
    for (const [plan, base] of [["essential", 29], ["business", 79], ["enterprise", 199]] as const) {
      const r = q(P, { plan, interval: "month", employees: 40, items: [{ key: "connect-people" }] });
      expect(r.errors, plan).toEqual([]);
      expect(r.recurring.monthlyCents, plan).toBe(eur(base + 19));
      expect(line(r, "connect-people"), plan).toMatchObject({ status: "charged", amountCents: eur(19) });
    }
    expect(q(P, { plan: "business", interval: "month", users: 20, employees: 20 }).recurring.monthlyCents).toBe(eur(79 + 25));
  });
  it("ningún plan incluye People en la política propuesta ni en la vigente", () => {
    for (const pol of [P, CATALOG_POLICY]) {
      expect(pol.inclusions.filter((i) => i.key === "connect-people")).toEqual([]);
      for (const plan of ["essential", "business", "enterprise"]) expect(inclusionsOf(CAT, pol, plan).has("connect-people")).toBe(false);
    }
  });
  it("Enterprise por encima de la base: por presupuesto, sin inventar tarifa", () => {
    const r = q(P, { plan: "enterprise", interval: "month", users: 40, sites: 12 });
    expect(r.recurring.monthlyCents).toBe(eur(199));
    expect(r.lines.filter((l) => l.status === "on_quote").map((l) => l.quantity)).toEqual([15, 2]);
  });
  it("las soluciones sectoriales nunca están incluidas en un plan", () => {
    const fam = new Map(CAT.products.map((p) => [p.key, p.family]));
    for (const plan of ["essential", "business", "enterprise"]) for (const k of Array.from(inclusionsOf(CAT, P, plan).keys())) expect(["connect", "connect_bundle", "extra"]).toContain(fam.get(k));
  });
  it("las inclusiones apuntan a productos del catálogo y la política declara lo pendiente", () => {
    const keys = new Set(CAT.products.map((p) => p.key));
    for (const i of P.inclusions) expect(keys.has(i.key)).toBe(true);
    expect(pendingRules(P)).toContain("regla de paquetes min2");
    expect(pendingRules(P)).toContain("cupo enterprise:users");
    expect(pendingRules(P).filter((r) => r.includes("connect-people"))).toEqual([]);
    expect(pendingRules(CATALOG_POLICY)).toEqual([]);
  });
  it("implantación y consumos van aparte de la cuota", () => {
    const r = q(P, { plan: "enterprise", interval: "month", items: [{ key: "connect-voice" }] });
    expect(r.implementation.every((x) => x.amountCents === null)).toBe(true);
    expect(r.variableCosts.map((v) => v.key)).toEqual(expect.arrayContaining(["connect-voice", "connect-copilot"]));
    expect(r.recurring.monthlyCents).toBe(eur(199 + 39));
  });
  it("plan anual: el ahorro anual se separa de los descuentos de paquete", () => {
    const r = q(P, { plan: "business", interval: "year" });
    expect(r.discounts.annualPlanCents).toBe(eur(79 * 12 - 759));
    expect(r.taxes.annualizedCents).toBe(Math.round((eur(759) * 2100) / 10000));
  });
});

describe("cambios de plan y recomendación", () => {
  it("Essential → Business: las extensiones pagadas que pasan a estar incluidas dejan de cobrarse", () => {
    const pv = previewPlanChange(CAT, P, { plan: "essential", interval: "month", items: [{ key: "connect-people" }, { key: "connect-automations" }] }, "business");
    expect(pv.direction).toBe("upgrade");
    expect(pv.effective).toBe("immediate");
    expect(pv.gained.sort()).toEqual(["connect-automations", "extra-contracts-esign"]);
    expect(pv.current.recurring.monthlyCents).toBe(eur(77));
    // People sigue cobrándose en Business: 79 + 19
    expect(pv.droppingAll.recurring.monthlyCents).toBe(eur(79 + 19));
  });
  it("Business → Essential: bloqueo por sedes y coste de conservar lo que deja de estar incluido", () => {
    const pv = previewPlanChange(CAT, P, { plan: "business", interval: "month", users: 12, sites: 2 }, "essential");
    expect(pv.effective).toBe("period_end");
    expect(pv.blockers.length).toBe(1);
    expect(pv.lost.sort()).toEqual(["connect-automations", "extra-contracts-esign"]);
    const one = previewPlanChange(CAT, P, { plan: "business", interval: "month", users: 12, sites: 1 }, "essential");
    expect(one.blockers).toEqual([]);
    expect(one.keepingAll.recurring.monthlyCents).toBe(eur(29 + 9 * 6 + 29 + 15));
    expect(one.droppingAll.recurring.monthlyCents).toBe(eur(29 + 9 * 6));
  });
  it("Enterprise → Business: bloqueo con más de una sociedad", () => {
    const pv = previewPlanChange(CAT, P, { plan: "enterprise", interval: "month", fiscalEntities: 2 }, "business");
    expect(pv.blockers.some((b) => b.startsWith("Sociedades"))).toBe(true);
    expect(pv.lost).toEqual(expect.arrayContaining(["connect-pack-finance", "extra-accounting", "connect-copilot"]));
  });
  it("recomienda Business para la empresa de servicios y Essential para el autónomo", () => {
    expect(recommendPlan(CAT, P, { interval: "month", users: 10, employees: 10, items: [{ key: "connect-pack-finance" }, { key: "connect-people" }, { key: "connect-automations" }, { key: "extra-contracts-esign" }] }).recommended).toBe("business");
    expect(recommendPlan(CAT, P, { interval: "month", items: [{ key: "connect-tax" }] }).recommended).toBe("essential");
  });
});
