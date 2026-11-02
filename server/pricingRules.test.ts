/**
 * Reglas de precios (Business, pricing-rules): motor (prioridades, vigencias, condiciones, combinación, redondeo y orden
 * con los cupones), validación del formulario, licencia por plan (servidor y panel), aplicación en tienda, TPV y
 * presupuestos y migración aditiva. La operación real (MySQL, roles, aislamiento entre empresas) está en
 * server/pricingRules.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  adjustUnitPrice, appliedRuleNote, estimateCartLine, checkRule, emptyRuleForm, isoWeekday, normalizeRuleForm, priceLine, roundCents, rulesToApply, validateRuleForm,
  type PriceContext, type PriceLineInput, type PricingRule,
} from "../shared/pricingRules";
import { toRule } from "./pricingRulesDb";
import { capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV, resolveNav, routeAccess, type NavContext } from "../shared/adminNav";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { destructiveMigration, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

let nextId = 1;
const rule = (o: Partial<PricingRule> = {}): PricingRule => ({ ...emptyRuleForm(), name: `Regla ${nextId}`, id: nextId, priority: nextId++, ...o });
const line = (o: Partial<PriceLineInput> = {}): PriceLineInput => ({ productId: 1, categoryId: 10, unitPrice: 100, quantity: 1, serviceDate: null, ...o });
// 2026-11-02 es lunes
const web: PriceContext = { channel: "web", today: "2026-11-02" };

describe("reglas de precios: motor", () => {
  it("sin reglas (o sin ninguna que se cumpla) el precio queda exactamente igual, sin redondear", () => {
    expect(priceLine([], line({ unitPrice: 33.333 }), web)).toEqual({ baseUnitPrice: 33.333, unitPrice: 33.333, applied: [] });
    expect(priceLine([rule({ active: false })], line({ unitPrice: 33.333 }), web).unitPrice).toBe(33.333);
  });

  it("descuento y recargo por porcentaje o importe fijo por unidad, nunca por debajo de cero", () => {
    expect(adjustUnitPrice(100, { kind: "descuento", valueType: "porcentaje", value: 15 })).toBe(85);
    expect(adjustUnitPrice(100, { kind: "recargo", valueType: "porcentaje", value: 10 })).toBe(110);
    expect(adjustUnitPrice(100, { kind: "descuento", valueType: "importe", value: 7.5 })).toBe(92.5);
    expect(adjustUnitPrice(100, { kind: "recargo", valueType: "importe", value: 5 })).toBe(105);
    expect(adjustUnitPrice(4, { kind: "descuento", valueType: "importe", value: 10 })).toBe(0);
  });

  it("redondeo a céntimos simétrico, como el resto de importes", () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(19.999)).toBe(20);
    // 33,33 − 15 % = 28,3305 → 28,33
    expect(priceLine([rule({ value: 15 })], line({ unitPrice: 33.33 }), web).unitPrice).toBe(28.33);
    // 9,99 − 33 % = 6,6933 → 6,69
    expect(priceLine([rule({ value: 33 })], line({ unitPrice: 9.99 }), web).unitPrice).toBe(6.69);
  });

  it("prioridad: gana la primera que se cumple; a igualdad, la más antigua", () => {
    const a = rule({ name: "A", priority: 2, value: 10 });
    const b = rule({ name: "B", priority: 1, value: 20 });
    expect(priceLine([a, b], line(), web)).toMatchObject({ unitPrice: 80, applied: [{ name: "B" }] });
    const c = rule({ name: "C", priority: 5, value: 5 });
    const d = rule({ name: "D", priority: 5, value: 50 });
    expect(rulesToApply([d, c], line(), web).map((r) => r.name)).toEqual(["C"]);
  });

  it("combinación: no acumulables nunca se combinan; las acumulables se suman en orden de prioridad", () => {
    const top = rule({ name: "Grupo", priority: 1, value: 10, combinable: true });
    const other = rule({ name: "Martes", priority: 2, value: 5, valueType: "importe", combinable: true });
    const solo = rule({ name: "Solo", priority: 3, value: 50, combinable: false });
    // 100 − 10 % = 90; − 5 € = 85; la no acumulable se ignora
    expect(priceLine([solo, other, top], line(), web)).toMatchObject({ unitPrice: 85, applied: [{ name: "Grupo" }, { name: "Martes" }] });
    // Si la de más prioridad no es acumulable, va sola
    const first = rule({ name: "Primera", priority: 0, value: 30, combinable: false });
    expect(priceLine([solo, other, top, first], line(), web)).toMatchObject({ unitPrice: 70, applied: [{ name: "Primera" }] });
  });

  it("vigencia por fecha de la operación (ambas incluidas)", () => {
    const r = rule({ validFrom: "2026-11-01", validTo: "2026-11-30" });
    expect(checkRule(r, line(), { ...web, today: "2026-10-31" })).toMatchObject({ applies: false, reason: "Aún no está vigente" });
    expect(checkRule(r, line(), { ...web, today: "2026-11-01" }).applies).toBe(true);
    expect(checkRule(r, line(), { ...web, today: "2026-11-30" }).applies).toBe(true);
    expect(checkRule(r, line(), { ...web, today: "2026-12-01" })).toMatchObject({ applies: false, reason: "Su vigencia ha terminado" });
  });

  it("ámbito: todo el catálogo, productos o categorías", () => {
    expect(checkRule(rule({ scope: "producto", targetIds: [2, 3] }), line({ productId: 1 }), web).applies).toBe(false);
    expect(checkRule(rule({ scope: "producto", targetIds: [1] }), line({ productId: 1 }), web).applies).toBe(true);
    expect(checkRule(rule({ scope: "categoria", targetIds: [10] }), line({ categoryId: 10 }), web).applies).toBe(true);
    expect(checkRule(rule({ scope: "categoria", targetIds: [10] }), line({ categoryId: null }), web).applies).toBe(false);
  });

  it("condiciones: cantidad mínima, canal, días de la semana y franja de fechas del servicio", () => {
    expect(checkRule(rule({ minQuantity: 10 }), line({ quantity: 9 }), web)).toMatchObject({ applies: false, reason: "Pide al menos 10 unidades" });
    expect(checkRule(rule({ minQuantity: 10 }), line({ quantity: 10 }), web).applies).toBe(true);
    expect(checkRule(rule({ channels: ["tpv"] }), line(), web).applies).toBe(false);
    expect(checkRule(rule({ channels: ["tpv"] }), line(), { ...web, channel: "tpv" }).applies).toBe(true);
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
    const weekend = rule({ kind: "recargo", weekdays: [6, 7] });
    expect(checkRule(weekend, line({ serviceDate: "2026-11-07" }), web).applies).toBe(true);
    expect(checkRule(weekend, line({ serviceDate: "2026-11-04" }), web).applies).toBe(false);
    // Sin fecha del servicio cuenta la de la operación (lunes)
    expect(checkRule(weekend, line({ serviceDate: null }), web).applies).toBe(false);
    const season = rule({ serviceFrom: "2026-12-20", serviceTo: "2027-01-06" });
    expect(checkRule(season, line({ serviceDate: "2026-12-24" }), web).applies).toBe(true);
    expect(checkRule(season, line({ serviceDate: "2027-01-07" }), web).applies).toBe(false);
  });

  it("orden con los cupones: la regla primero, el cupón sobre el importe ya ajustado", () => {
    // Mismo cálculo que cartCheckout: líneas con la regla y después el cupón por porcentaje sobre el total
    const priced = priceLine([rule({ value: 10 })], line({ unitPrice: 50, quantity: 3 }), web);
    const totalCents = Math.round(priced.unitPrice * 3 * 100);
    const couponCents = Math.round((totalCents * 10) / 100);
    expect(totalCents).toBe(13500);
    expect(totalCents - couponCents).toBe(12150);
    const src = read("server/routers.ts");
    const checkout = src.slice(src.indexOf("cartCheckout: publicProcedure"));
    expect(checkout.indexOf("webRulePrice(cartRules")).toBeGreaterThan(0);
    expect(checkout.indexOf("webRulePrice(cartRules")).toBeLessThan(checkout.indexOf("3b. Aplicar descuento por código"));
  });

  it("la nota de la línea guardada dice qué regla se aplicó y el precio de catálogo", () => {
    const priced = priceLine([rule({ name: "Grupos", value: 10 })], line({ unitPrice: 20 }), web);
    expect(appliedRuleNote(priced)).toBe("Regla de precio: Grupos (precio de catálogo 20,00 €)");
    expect(appliedRuleNote(priceLine([], line(), web))).toBeNull();
  });
});

describe("reglas de precios: formulario y lectura de la BD", () => {
  it("valida nombre, valor, ámbito, cantidad, canales y fechas", () => {
    expect(validateRuleForm({ ...emptyRuleForm(), name: "Grupos" })).toEqual({});
    const e = validateRuleForm({ ...emptyRuleForm(), name: " ", value: 0, scope: "producto", targetIds: [], minQuantity: 0, channels: [], validFrom: "2026-12-01", validTo: "2026-11-01" });
    expect(Object.keys(e).sort()).toEqual(["channels", "minQuantity", "name", "targetIds", "validTo", "value"]);
    expect(validateRuleForm({ ...emptyRuleForm(), name: "X", value: 101 }).value).toMatch(/100/);
    expect(validateRuleForm({ ...emptyRuleForm(), name: "X", value: 150, kind: "recargo" }).value).toBeUndefined();
    expect(validateRuleForm({ ...emptyRuleForm(), name: "X", value: 1.234 }).value).toMatch(/decimales/);
    expect(validateRuleForm({ ...emptyRuleForm(), name: "X", validFrom: "2026-02-30" }).validFrom).toBeDefined();
  });

  it("normaliza: nombre limpio, listas sin duplicados y sin destinos en «todo el catálogo»", () => {
    const n = normalizeRuleForm({ ...emptyRuleForm(), name: "  Fin   de semana ", scope: "todo", targetIds: [3], weekdays: [7, 6, 7], channels: ["tpv", "web", "tpv"], validFrom: "" as unknown as null });
    expect(n).toMatchObject({ name: "Fin de semana", targetIds: [], weekdays: [6, 7], channels: ["web", "tpv"], validFrom: null });
  });

  it("lee las filas de la tabla de forma tolerante", () => {
    const r = toRule({
      id: 4, name: "Grupos", active: 1, priority: 2, kind: "descuento", valueType: "importe", value: "5.50", scope: "categoria", targetIds: "3,7", minQuantity: 10,
      weekdays: "6,7", channels: "web,presupuesto,otro", validFrom: "2026-11-01", validTo: null, serviceFrom: null, serviceTo: null, combinable: 0,
    });
    expect(r).toMatchObject({ id: 4, active: true, value: 5.5, targetIds: [3, 7], weekdays: [6, 7], channels: ["web", "presupuesto"], validFrom: "2026-11-01", combinable: false });
  });
});

describe("reglas de precios: licencia por plan", () => {
  it("las reglas son Business; Essential conserva sus precios y cupones", () => {
    expect(capabilitiesOfTier("business")).toContain("pricing-rules");
    expect(capabilitiesOfTier("essential")).not.toContain("pricing-rules");
    for (const p of ["pricingRules.list", "pricingRules.options", "pricingRules.create", "pricingRules.update", "pricingRules.setActive", "pricingRules.reorder", "pricingRules.remove", "pricingRules.simulate"])
      expect(capabilityForProcedure(p)).toBe("pricing-rules");
    expect(capabilityForProcedure("discounts.validate")).toBe("shop-coupons");
    // Las promociones de la tienda viajan en la ficha pública del producto: ninguna ruta pública nueva
    expect(capabilityForProcedure("public.getExperienceBySlug")).toBeUndefined();
    expect(capabilityForProcedure("tpv.pricingPreview")).toBe("bill-cash");
  });

  it("gestionar es de administración; aplicarlas al cobrar exige la capacidad activa (si no, el precio de siempre)", () => {
    const src = read("server/routers/pricingRules.ts");
    for (const p of ["list", "options", "create", "update", "setActive", "reorder", "remove", "simulate"]) expect(src).toMatch(new RegExp(`${p}: adminProcedure`));
    expect(read("server/routers.ts")).toMatch(/pricingRules: pricingRulesRouter/);
    const db = read("server/pricingRulesDb.ts");
    expect(db).toMatch(/check\(PRICING_RULES_CAPABILITY, \{ write: true \}\)/);
    expect(db).toMatch(/if \(!\(await pricingRulesEnabled\(\)\)\) return \[\];/);
  });

  const ctx = (role: string, caps: Record<string, "active" | "read_only" | null>): NavContext => ({
    role,
    isFlagVisible: () => true,
    isModuleVisible: () => true,
    capabilityState: (c) => caps[c] ?? null,
  });
  const essential = Object.fromEntries(capabilitiesOfTier("essential").map((c) => [c, "active" as const]));
  const business = { ...essential, ...Object.fromEntries(capabilitiesOfTier("business").map((c) => [c, "active" as const])) };
  const find = (c: NavContext, href: string) => resolveNav(TASK_NAV, c).flatMap((s) => s.items).find((i) => i.href === href);

  it("menú: Business (administración) lo ve en «Catálogo y comercio»; Essential y el equipo comercial no", () => {
    expect(find(ctx("admin", essential), "/admin/productos/reglas-precios")).toBeUndefined();
    expect(find(ctx("admin", essential), "/admin/marketing/descuentos")).toBeDefined();
    expect(find(ctx("admin", business), "/admin/productos/reglas-precios")).toMatchObject({ label: "Reglas de precios", readOnly: false });
    expect(find(ctx("agente", business), "/admin/productos/reglas-precios")).toBeUndefined();
    const section = resolveNav(TASK_NAV, ctx("admin", business)).find((s) => s.items.some((i) => i.href === "/admin/productos/reglas-precios"));
    expect(section?.label).toBe("Catálogo y comercio");
  });

  it("ruta del panel: sin la capacidad, «No incluido en tu plan»", () => {
    const state = (caps: Record<string, string>) => (c: string) => (caps[c] as "active" | undefined) ?? null;
    expect(routeAccess("/admin/productos/reglas-precios", state(essential))).toBe("not_included");
    expect(routeAccess("/admin/productos/reglas-precios", state(business))).toBe("allowed");
    expect(read("client/src/App.tsx")).toMatch(/path="\/admin\/productos\/reglas-precios"/);
  });
});

describe("reglas de precios: aplicación en el servidor", () => {
  it("tienda online: compra directa y carrito recalculan con las reglas antes de construir el pago", () => {
    const src = read("server/routers.ts");
    const single = src.slice(src.indexOf("createAndPay:"), src.indexOf("cartCheckout: publicProcedure"));
    expect(single).toMatch(/pricePerPerson = webRulePrice\(await activePricingRules\(\)/);
    expect(src).toMatch(/pricingRules: await webRulesForProduct\(/);
    expect(read("client/src/pages/Checkout.tsx")).toMatch(/estimateCartLine\(/);
  });

  it("carrito: estimación del precio final y del ahorro con el mismo motor (por persona o por unidad)", () => {
    const rules = [rule({ name: "Grupos", value: 10, minQuantity: 3 })];
    expect(estimateCartLine(rules, { productId: 1, categoryId: 10, unitPrice: 40, quantity: 3, lineTotal: 120 }, "2026-11-02"))
      .toEqual({ baseUnitPrice: 40, unitPrice: 36, baseTotal: 120, total: 108, savings: 12, rules: ["Grupos"] });
    // Por unidad (2 barcas de 80 € para 3 personas): la línea se escala igual
    expect(estimateCartLine(rules, { productId: 1, categoryId: 10, unitPrice: 80, quantity: 3, lineTotal: 160 }, "2026-11-02")?.total).toBe(144);
    expect(estimateCartLine(rules, { productId: 1, categoryId: 10, unitPrice: 40, quantity: 2, lineTotal: 80 }, "2026-11-02")).toBeNull();
    // Solo canal web
    expect(estimateCartLine([rule({ channels: ["tpv"] })], { productId: 1, categoryId: 10, unitPrice: 40, quantity: 3, lineTotal: 120 }, "2026-11-02")).toBeNull();
  });

  it("TPV: createSale aplica las reglas a las líneas antes de calcular totales y fiscalidad", () => {
    const src = read("server/routers/tpv.ts");
    const sale = src.slice(src.indexOf("createSale: tpvSellProc"));
    expect(sale.indexOf("input.items = await applyTpvPricingRules(")).toBeGreaterThan(0);
    expect(sale.indexOf("input.items = await applyTpvPricingRules(")).toBeLessThan(sale.indexOf("1. Calcular totales básicos"));
  });

  it("presupuestos: generar y precargar desde un lead aplican las reglas a las líneas del catálogo", () => {
    const src = read("server/routers/crm.ts");
    expect(src.match(/applyQuotePricingRules\(/g)?.length).toBe(3);
  });
});

describe("reglas de precios: migración 0022", () => {
  const up = "db/migrations/0022_pricing_rules.sql";
  it("es aditiva: la publicación la trata como ordinaria", () => {
    expect(destructiveMigration(read(up))).toBeNull();
    expect(extraordinaryChanges([up, "db/migrations/0022_pricing_rules.down.sql"], "", (f) => read(f))).toEqual([]);
  });

  it("el código de las reglas no contiene nada que la publicación trate como destructivo", () => {
    const files = ["shared/pricingRules.ts", "server/pricingRulesDb.ts", "server/routers/pricingRules.ts", "client/src/pages/admin/products/PricingRules.tsx"];
    const diff = files.map((f) => `diff --git a/${f} b/${f}\n` + read(f).replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`).join("\n")).join("\n");
    expect(extraordinaryChanges(files, diff, () => null)).toEqual([]);
  });

  it("crea la tabla que usa el servidor, no toca pedidos ni facturas y tiene reversión", () => {
    const sql = read(up);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS pricing_rules/);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(read("server/pricingRulesDb.ts")).toMatch(/mysqlTable\("pricing_rules"/);
    expect(read("db/migrations/0022_pricing_rules.down.sql")).toMatch(/pricing_rules/);
  });
});
