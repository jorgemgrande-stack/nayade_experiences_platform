/**
 * Reglas de precios (Business, pricing-rules) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0022). Essential no llega a las reglas
 * y cobra lo de siempre; con Business, administración las gestiona, el TPV, la tienda y los presupuestos las aplican en
 * el servidor, las ventas ya grabadas no cambian y cada empresa solo ve y aplica las suyas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "pricing-rules";

describe.skipIf(!URL_)("Reglas de precios (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let agA: string;
  let admB: string;
  let agB: string;
  let productA = 0;
  let productB = 0;
  let regA = 0;
  let regB = 0;

  const rule = (o: Record<string, unknown> = {}) => ({
    name: "Grupos", active: true, kind: "descuento", valueType: "porcentaje", value: 10, scope: "todo", targetIds: [], minQuantity: 1,
    weekdays: [], channels: ["web", "tpv", "presupuesto"], validFrom: null, validTo: null, serviceFrom: null, serviceTo: null, combinable: false, ...o,
  });
  const item = (productId: number, o: Record<string, unknown> = {}) => ({ productType: "experience", productId, productName: "Corte de pelo", quantity: 1, unitPrice: 100, ...o });

  async function setupCompany(co: "a" | "b", adm: string): Promise<{ productId: number; registerId: number }> {
    await ess.m(co, "products.createCategory", { slug: "peluqueria", name: "Peluquería" }, adm);
    await ess.m(co, "products.createLocation", { slug: "local", name: "Local" }, adm);
    const [c] = await ess.sql(co, "SELECT id FROM categories WHERE slug = 'peluqueria'");
    const [l] = await ess.sql(co, "SELECT id FROM locations LIMIT 1");
    await ess.m(co, "products.create", { slug: "corte", title: "Corte de pelo", categoryId: c.id, locationId: l.id, basePrice: "100.00", taxRate: "21" }, adm);
    const productId = (await ess.sql(co, "SELECT id FROM experiences WHERE slug = 'corte'"))[0].id;
    await ess.sql(co, "UPDATE experiences SET isPresentialSale = 1, isActive = 1 WHERE id = ?", [productId]);
    const registerId = data(await ess.m(co, "tpv.createRegister", { name: "Mostrador" }, adm)).id;
    return { productId, registerId };
  }

  async function sell(co: "a" | "b", cookie: string, registerId: number, items: unknown[], amount: number, extra: Record<string, unknown> = {}) {
    const s = data(await ess.m(co, "tpv.openSession", { registerId, openingAmount: 0 }, cookie));
    const res = await ess.m(co, "tpv.createSale", { sessionId: s.id, items, payments: [{ method: "card", amount }], ...extra }, cookie);
    await ess.m(co, "tpv.closeSession", { sessionId: s.id, countedCash: 0 }, cookie);
    return res;
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "reglasprecios");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    agB = await ess.login("b", "agente");
    ({ productId: productA, registerId: regA } = await setupCompany("a", admA));
    ({ productId: productB, registerId: regB } = await setupCompany("b", admB));
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("Essential: sin acceso a las reglas; la caja y la tienda cobran el precio de siempre", async () => {
    expect(isLicenseDenied(await ess.q("a", "pricingRules.list", undefined, admA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "pricingRules.create", rule(), admA), CAP)).toBe(true);
    // Aunque hubiera una regla grabada, sin la capacidad no se aplica
    await ess.sql("a", "INSERT INTO pricing_rules (name, active, priority, kind, value_type, value, scope, min_quantity, channels, combinable) VALUES ('Fantasma', 1, 1, 'descuento', 'porcentaje', 50, 'todo', 1, 'web,tpv,presupuesto', 0)");
    expect(data(await ess.q("a", "tpv.pricingPreview", { items: [item(productA)] }, agA))).toEqual([null]);
    expect(data(await ess.q("a", "public.getExperienceBySlug", { slug: "corte" })).pricingRules).toEqual([]);
    const sale = await sell("a", agA, regA, [item(productA)], 100);
    expect(sale.status).toBe(200);
    expect(Number(data(sale).sale.total)).toBe(100);
    await ess.sql("a", "DELETE FROM pricing_rules");
  });

  it("Business: administración gestiona y simula; el equipo comercial no", async () => {
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    expect(errCode(await ess.m("a", "pricingRules.create", rule(), agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "pricingRules.create", rule({ value: 0 }), admA))).toBe("BAD_REQUEST");
    const g = data(await ess.m("a", "pricingRules.create", rule({ name: "Grupos", minQuantity: 3 }), admA)).id;
    const t = data(await ess.m("a", "pricingRules.create", rule({ name: "Solo caja", value: 5, valueType: "importe", channels: ["tpv"] }), admA)).id;
    expect(data(await ess.q("a", "pricingRules.list", undefined, admA)).map((r: any) => [r.name, r.priority])).toEqual([["Grupos", 1], ["Solo caja", 2]]);
    // Simulación: 1 unidad no llega al mínimo del grupo; en caja se aplica la de solo caja
    const s1 = data(await ess.q("a", "pricingRules.simulate", { productId: productA, quantity: 1, channel: "tpv" }, admA));
    expect(s1).toMatchObject({ baseUnitPrice: 100, unitPrice: 95, total: 95, savings: 5, applied: [{ id: t }] });
    const s3 = data(await ess.q("a", "pricingRules.simulate", { productId: productA, quantity: 3, channel: "tpv" }, admA));
    expect(s3).toMatchObject({ unitPrice: 90, total: 270, savings: 30, applied: [{ id: g }] });
    // Reordenar: la de solo caja pasa delante
    expect((await ess.m("a", "pricingRules.reorder", { ids: [t, g] }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "pricingRules.simulate", { productId: productA, quantity: 3, channel: "tpv" }, admA)).applied).toEqual([{ id: t, name: "Solo caja" }]);
    expect((await ess.m("a", "pricingRules.reorder", { ids: [g, t] }, admA)).status).toBe(200);
    // Aislamiento: B no ve ni toca las reglas de A
    expect(data(await ess.q("b", "pricingRules.list", undefined, admB))).toEqual([]);
    expect(errCode(await ess.m("b", "pricingRules.setActive", { id: g, active: false }, admB))).toBe("NOT_FOUND");
  });

  it("TPV: la venta guarda el precio de la regla, el descuento manual va después y lo ya vendido no cambia", async () => {
    expect(data(await ess.q("a", "tpv.pricingPreview", { items: [item(productA, { quantity: 3 })] }, agA))).toEqual([{ unitPrice: 90, baseUnitPrice: 100, rules: ["Grupos"] }]);
    // El total que no tiene en cuenta la regla no cuadra con lo que cobra el servidor
    expect(errCode(await sell("a", agA, regA, [item(productA, { quantity: 3 })], 300))).toBe("BAD_REQUEST");
    // 3 × 90 = 270; descuento manual de 20 → 250
    const sale = await sell("a", agA, regA, [item(productA, { quantity: 3 })], 250, { discountAmount: 20, discountReason: "Cliente habitual" });
    expect(sale.status).toBe(200);
    const saleId = data(sale).sale.id;
    expect(Number(data(sale).sale.total)).toBe(250);
    const [line] = await ess.sql("a", "SELECT unitPrice, subtotal_tsi AS subtotal, notes_tsi AS notes FROM tpv_sale_items WHERE saleId = ?", [saleId]);
    expect([Number(line.unitPrice), Number(line.subtotal)]).toEqual([90, 270]);
    expect(line.notes).toMatch(/Regla de precio: Grupos \(precio de catálogo 100,00 €\)/);
    // Cambiar o quitar la regla no toca la venta grabada
    const [g] = data(await ess.q("a", "pricingRules.list", undefined, admA));
    expect((await ess.m("a", "pricingRules.update", { id: g.id, ...rule({ name: "Grupos", minQuantity: 3, value: 50 }) }, admA)).status).toBe(200);
    const [after] = await ess.sql("a", "SELECT total FROM tpv_sales WHERE id = ?", [saleId]);
    expect(Number(after.total)).toBe(250);
    // B, sin reglas, cobra su precio de siempre
    expect(data(await ess.q("b", "tpv.pricingPreview", { items: [item(productB, { quantity: 3 })] }, agB))).toEqual([null]);
    const saleB = await sell("b", agB, regB, [item(productB, { quantity: 3 })], 300);
    expect(saleB.status).toBe(200);
    expect(Number(data(saleB).sale.total)).toBe(300);
  });

  it("tienda: la ficha pública lleva solo las promociones web vigentes; el carrito estima con el mismo motor", async () => {
    const product = data(await ess.q("a", "public.getExperienceBySlug", { slug: "corte" }));
    // La regla «Solo caja» no se aplica en la web
    expect(product.pricingRules.map((r: any) => r.name)).toEqual(["Grupos"]);
    const { estimateCartLine } = await import("../shared/pricingRules");
    const est = estimateCartLine(product.pricingRules, { productId: product.id, categoryId: product.categoryId, unitPrice: 100, quantity: 3, lineTotal: 300 }, "2026-11-02");
    expect(est).toMatchObject({ unitPrice: 50, total: 150, savings: 150, rules: ["Grupos"] });
    expect(data(await ess.q("b", "public.getExperienceBySlug", { slug: "corte" })).pricingRules).toEqual([]);
  });

  it("tienda: el pago recalcula con la regla y el cupón se aplica después, sobre el importe ya ajustado", async () => {
    const key = crypto.randomBytes(24).toString("base64");
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: key } }, admA)).status).toBe(200);
    expect((await ess.m("a", "discounts.create", { code: "PROMO10", name: "Promo 10", discountPercent: 10 }, admA)).status).toBe(200);
    const [coupon] = await ess.sql("a", "SELECT id FROM discount_codes WHERE code = ?", ["PROMO10"]);
    const buyer = { customerName: "Comprador Prueba", customerEmail: "comprador@cliente-a.example", origin: `https://${ess.host("a")}` };
    const r = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: productA, bookingDate: "", people: 3 }], discountCodeId: coupon.id, discountCode: "PROMO10" });
    expect(r.status).toBe(200);
    // 3 × 100 € con la regla del 50 % = 150 €; el cupón del 10 % sobre 150 € → se cobran 135 €
    expect(data(r).totalAmountCents).toBe(15000);
    const params = JSON.parse(Buffer.from(data(r).redsysForm.Ds_MerchantParameters, "base64").toString("utf8"));
    expect(params.DS_MERCHANT_AMOUNT).toBe("13500");
    const [row] = await ess.sql("a", "SELECT amount_total AS total FROM reservations WHERE merchant_order = ?", [data(r).merchantOrder]);
    expect(Number(row.total)).toBe(15000);
  });

  it("presupuestos: precargar desde un lead aplica las reglas del canal presupuesto", async () => {
    const lead = data(await ess.m("a", "crm.leads.create", { name: "Grupo empresa", email: "grupo@cliente-a.example" }, agA)).id;
    await ess.sql("a", "UPDATE leads SET selectedProduct = 'Corte de pelo', numberOfPersons = 4 WHERE id = ?", [lead]);
    const prev = data(await ess.q("a", "crm.leads.previewFromLead", { leadId: lead }, agA));
    expect(prev.items[0]).toMatchObject({ quantity: 4, unitPrice: 50, total: 200, productId: productA });
    expect(prev.items[0].description).toMatch(/Grupos/);
    // Desactivada, el presupuesto vuelve al precio de catálogo
    const [g] = data(await ess.q("a", "pricingRules.list", undefined, admA));
    await ess.m("a", "pricingRules.setActive", { id: g.id, active: false }, admA);
    expect(data(await ess.q("a", "crm.leads.previewFromLead", { leadId: lead }, agA)).items[0]).toMatchObject({ unitPrice: 100, total: 400 });
  });
});
