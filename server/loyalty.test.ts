/**
 * Social Token Net · Tokens internos (social-token-net-tokens): lógica pura (shared/loyalty.ts), licencia de rutas y
 * menú, catálogo y la migración aditiva. Casos adaptados de las pruebas del motor de SegoTokens de Segolife
 * (tokenRuleEngine.test.ts y tokenEngine.test.ts). El comportamiento con MySQL real está en server/loyalty.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LOYALTY_CAPABILITY,
  addMonthsMs,
  applyCampaignToAmount,
  calculateBasePoints,
  clampCampaignExtra,
  compareRulesByPrecedence,
  computePurchaseBase,
  csvText,
  equivalenceText,
  expiredPoints,
  findActionRule,
  findApplicableCampaign,
  periodStartKey,
  type LoyaltyCampaign,
  type LoyaltyRule,
} from "../shared/loyalty";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { routeCapabilities, TASK_NAV } from "../shared/adminNav";
import { CAPABILITIES } from "./catalog/capabilities";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { destructiveMigration } from "../scripts/deploy/esRailwayLib";

const rule = (o: Partial<LoyaltyRule> & { id: number }): LoyaltyRule => ({
  name: `Regla ${o.id}`, trigger: "purchase", actionKey: null, scope: "all", scopeId: null, calc: "per_euro", rate: 1, fixedPoints: null, minSpend: null, maxPoints: null,
  limitCount: null, limitPeriod: null, priority: 0, active: true, startsAt: null, endsAt: null, ...o,
});
const campaign = (o: Partial<LoyaltyCampaign> & { id: number }): LoyaltyCampaign => ({
  name: `Campaña ${o.id}`, scope: "all", scopeId: null, multiplier: 2, bonusPoints: null, budgetPoints: null, perClientLimit: null, limitPeriod: null, priority: 0, active: true,
  startsAt: null, endsAt: null, ...o,
});
const NOW = Date.UTC(2026, 10, 4, 12);

describe("cálculo base (Segolife calculateBaseTokens)", () => {
  it("fijo, por euro y porcentaje redondean hacia abajo y nunca son negativos", () => {
    expect(calculateBasePoints({ calc: "fixed", rate: null, fixedPoints: 50 }, 999)).toBe(50);
    expect(calculateBasePoints({ calc: "per_euro", rate: 1, fixedPoints: null }, 25.99)).toBe(25);
    expect(calculateBasePoints({ calc: "per_euro", rate: 1.5, fixedPoints: null }, 10)).toBe(15);
    expect(calculateBasePoints({ calc: "percentage", rate: 10, fixedPoints: null }, 55)).toBe(5);
    expect(calculateBasePoints({ calc: "per_euro", rate: -3, fixedPoints: null }, 10)).toBe(0);
    // 0,1 × 30 en coma flotante es 2,9999…: se toma 3
    expect(calculateBasePoints({ calc: "per_euro", rate: 0.1, fixedPoints: null }, 30)).toBe(3);
  });
});

describe("precedencia de reglas (Segolife compareRulesByPrecedence)", () => {
  it("prioridad, luego especificidad (producto > categoría > todas), luego id más bajo", () => {
    const list = [rule({ id: 3, scope: "all" }), rule({ id: 2, scope: "category", scopeId: 1 }), rule({ id: 1, scope: "product", scopeId: 7 }), rule({ id: 4, priority: 5 })];
    expect([...list].sort(compareRulesByPrecedence).map((r) => r.id)).toEqual([4, 1, 2, 3]);
    expect([rule({ id: 9 }), rule({ id: 5 })].sort(compareRulesByPrecedence).map((r) => r.id)).toEqual([5, 9]);
  });
});

describe("puntos de una compra", () => {
  const lines = [
    { productId: 7, categoryId: 1, amount: 40 },
    { productId: 8, categoryId: 2, amount: 20.5 },
    { productId: null, categoryId: null, amount: 10 },
  ];
  it("cada línea usa la regla de mayor precedencia que la cubre", () => {
    const rules = [rule({ id: 1, rate: 1 }), rule({ id: 2, scope: "product", scopeId: 7, rate: 3 })];
    const r = computePurchaseBase(rules, lines, NOW);
    expect(r.byRule).toEqual([{ ruleId: 1, ruleName: "Regla 1", points: 30 }, { ruleId: 2, ruleName: "Regla 2", points: 120 }]);
    expect(r.base).toBe(150);
  });
  it("una regla de categoría solo cubre su categoría; sin regla, la línea no da puntos", () => {
    const r = computePurchaseBase([rule({ id: 1, scope: "category", scopeId: 2, rate: 2 })], lines, NOW);
    expect(r.base).toBe(41);
  });
  it("las reglas inactivas o fuera de vigencia no cuentan; la compra mínima se mira sobre el total", () => {
    expect(computePurchaseBase([rule({ id: 1, active: false })], lines, NOW).base).toBe(0);
    expect(computePurchaseBase([rule({ id: 1, startsAt: NOW + 1 })], lines, NOW).base).toBe(0);
    expect(computePurchaseBase([rule({ id: 1, endsAt: NOW - 1 })], lines, NOW).base).toBe(0);
    expect(computePurchaseBase([rule({ id: 1, minSpend: 100 })], lines, NOW).base).toBe(0);
    expect(computePurchaseBase([rule({ id: 1, minSpend: 70 })], lines, NOW).base).toBe(70);
  });
  it("puntos fijos: una vez por documento; el tope por documento recorta", () => {
    expect(computePurchaseBase([rule({ id: 1, calc: "fixed", fixedPoints: 25, rate: null })], lines, NOW).base).toBe(25);
    expect(computePurchaseBase([rule({ id: 1, maxPoints: 50 })], lines, NOW).base).toBe(50);
  });
  it("las reglas de acción no cuentan en compras; se eligen por su acción", () => {
    const a = rule({ id: 5, trigger: "action", actionKey: "resena", calc: "fixed", fixedPoints: 20 });
    expect(computePurchaseBase([a], lines, NOW).base).toBe(0);
    expect(findActionRule([a, rule({ id: 6, trigger: "action", actionKey: "resena", calc: "fixed", fixedPoints: 30, priority: 2 })], "resena", NOW)?.id).toBe(6);
    expect(findActionRule([a], "alta", NOW)).toBeNull();
  });
});

describe("campañas (Segolife findApplicableCampaign / applyCampaignToAmount)", () => {
  const lines = [{ productId: 7, categoryId: 1, amount: 40 }];
  it("una campaña sin alcance aplica a todo; con alcance, solo si alguna línea encaja; nunca se apilan", () => {
    expect(findApplicableCampaign([campaign({ id: 1 })], lines, NOW)?.id).toBe(1);
    expect(findApplicableCampaign([campaign({ id: 1, scope: "category", scopeId: 2 })], lines, NOW)).toBeNull();
    expect(findApplicableCampaign([campaign({ id: 1 }), campaign({ id: 2, priority: 3 })], lines, NOW)?.id).toBe(2);
    expect(findApplicableCampaign([campaign({ id: 4 }), campaign({ id: 3 })], lines, NOW)?.id).toBe(3);
    expect(findApplicableCampaign([campaign({ id: 1, endsAt: NOW - 1 })], lines, NOW)).toBeNull();
  });
  it("multiplicador y luego bonificación, en ese orden", () => {
    expect(applyCampaignToAmount({ multiplier: 2, bonusPoints: 10 }, 15)).toBe(40);
    expect(applyCampaignToAmount({ multiplier: 1.5, bonusPoints: null }, 15)).toBe(22);
    expect(applyCampaignToAmount(null, 15)).toBe(15);
  });
  it("el extra se recorta al remanente del cliente y del presupuesto (nunca negativo)", () => {
    expect(clampCampaignExtra(30, { perClientRemaining: null, budgetRemaining: null })).toBe(30);
    expect(clampCampaignExtra(30, { perClientRemaining: 12, budgetRemaining: 100 })).toBe(12);
    expect(clampCampaignExtra(30, { perClientRemaining: 50, budgetRemaining: 7 })).toBe(7);
    expect(clampCampaignExtra(30, { perClientRemaining: -5, budgetRemaining: 7 })).toBe(0);
  });
});

describe("periodos, caducidad y textos", () => {
  it("inicio del periodo (semana de lunes a domingo)", () => {
    expect(periodStartKey("day", "2026-11-04")).toBe("2026-11-04");
    expect(periodStartKey("week", "2026-11-04")).toBe("2026-11-02");
    expect(periodStartKey("week", "2026-11-08")).toBe("2026-11-02");
    expect(periodStartKey("week", "2026-11-02")).toBe("2026-11-02");
    expect(periodStartKey("month", "2026-11-04")).toBe("2026-11-01");
    expect(periodStartKey("year", "2026-11-04")).toBe("2026-01-01");
    expect(periodStartKey("lifetime", "2026-11-04")).toBeNull();
  });
  it("caducidad FIFO: caduca el saldo que excede de los créditos vigentes", () => {
    expect(expiredPoints(150, 50)).toBe(100);
    expect(expiredPoints(40, 50)).toBe(0);
    expect(expiredPoints(-10, 0)).toBe(0);
    expect(new Date(addMonthsMs(Date.UTC(2026, 0, 15), 12)).toISOString().slice(0, 10)).toBe("2027-01-15");
  });
  it("la equivalencia es orientativa y el CSV neutraliza fórmulas", () => {
    expect(equivalenceText(250, { points: 100, euros: 1 })).toContain("2,50 €");
    expect(equivalenceText(250, null)).toBeNull();
    expect(csvText("=SUMA(A1)")).toBe(`"'=SUMA(A1)"`);
  });
});

describe("licencia, menú y catálogo", () => {
  it("las rutas de fidelización exigen social-token-net-tokens, separada de las comunidades", () => {
    for (const p of ["loyalty.overview", "loyalty.adjust", "loyalty.saveRule", "loyalty.wallet"]) expect(capabilityForProcedure(p)).toBe(LOYALTY_CAPABILITY);
    expect(CAPABILITIES.find((c) => c.id === LOYALTY_CAPABILITY)).toMatchObject({ tier: "extra", group: "net", technicalStatus: "partial" });
    expect(routeCapabilities("/admin/fidelizacion")).toEqual([LOYALTY_CAPABILITY]);
    // El menú lo aporta la extensión Social Token Net (sección propia), ya no el menú fijo del Core
    expect(TASK_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/fidelizacion")).toBeUndefined();
  });
  it("el producto de catálogo concede la capacidad y sigue sin comercializarse (Próximamente)", () => {
    const p = PRODUCTS.find((x) => x.key === "social-token-net-tokens")!;
    expect(p.draft.catalog.capabilities).toEqual([LOYALTY_CAPABILITY]);
    expect(p.draft.catalog.commercialStatus).toBe("coming_soon");
    expect(PRODUCTS.find((x) => x.key === "social-token-net-communities")!.draft.catalog.capabilities).toEqual(["social-token-net"]);
  });
  it("el TPV y la tienda siguen con sus licencias de siempre", () => {
    expect(capabilityForProcedure("tpv.createSale")).toBe("bill-cash");
    expect(capabilityForProcedure("reservations.cartCheckout")).toBe("shop-checkout");
  });
});

describe("migración 0026", () => {
  const dir = path.resolve(__dirname, "../db/migrations");
  it("es aditiva (ordinaria) y tiene reversión", () => {
    const up = fs.readFileSync(path.join(dir, "0026_loyalty_tokens.sql"), "utf8");
    expect(destructiveMigration(up)).toBeNull();
    expect(fs.existsSync(path.join(dir, "0026_loyalty_tokens.down.sql"))).toBe(true);
  });
});
