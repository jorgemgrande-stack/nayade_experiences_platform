/**
 * Cobros posteriores al alta de Elephant Net con Core incluido (contrato v3 §5-§7; U8, U10, U15, U16 y renovaciones):
 *  - el precio contractual sale de la instantánea y no cambia si se republican tarifas;
 *  - una renovación cobra exactamente la cuota contratada (Price completo − cupón por partida);
 *  - un cambio a mitad de periodo cobra (P − crédito) × fracción; si Stripe calculara otra cosa (cupón entero,
 *    riesgo R-J), la comprobación lo rechaza antes de cobrar;
 *  - los contratos históricos (Core y Net en dos cuotas) no se recalculan con el modelo compuesto.
 */
import { describe, it, expect } from "vitest";
import { quoteCatalogFromSeed } from "../catalog/commercial/seedCatalog";
import { commercialQuote } from "../catalog/commercial/commercialQuote";
import { CATALOG_POLICY, PROPOSED_POLICY, type CommercialPolicy } from "../catalog/commercial/policy";
import type { QuoteCatalog } from "../catalog/quote";
import { checkChangePreview, contractualPrice, expectedChange } from "./netCoreCharges";
import { invoiceNetCents } from "./gateway";
import { FakeStripeGateway } from "./testing";

const cat = quoteCatalogFromSeed();
const NET_ONLY: CommercialPolicy = { ...CATALOG_POLICY, id: "solo-net", coreIncluded: PROPOSED_POLICY.coreIncluded };
const START = 1_800_000_000;
const DAY = 86_400;
const END = START + 30 * DAY;
const ski = { key: "ski-net-complete" };
const hotel = { key: "hotel-net-complete" };

/** Catálogo con tarifas republicadas (Essential 31 €, Business 89 €). */
function republished(): QuoteCatalog {
  const c = structuredClone(cat);
  for (const p of c.products) for (const x of p.prices) if (x.kind === "monthly" && p.key === "essential") x.amountCents = 3100;
  for (const p of c.products) for (const x of p.prices) if (x.kind === "monthly" && p.key === "business") x.amountCents = 8900;
  return { ...c, version: "republicado" };
}

describe("precio contractual", () => {
  it("U15 tarifas republicadas tras contratar: lo contratado sigue en 149 €; lo nuevo, con las tarifas vigentes", () => {
    const snapshot = commercialQuote(cat, NET_ONLY, { plan: "business", interval: "month", items: [ski] });
    expect(contractualPrice(snapshot.lines)).toMatchObject({ monthlyCents: 14_900, yearlyCents: 0 });
    const today = commercialQuote(republished(), NET_ONLY, { plan: "business", interval: "month", items: [ski] });
    expect(today.recurring.monthlyCents).toBe(8900 - 3100 + 9900);
    expect(contractualPrice(snapshot.lines).monthlyCents).toBe(14_900);
    expect(contractualPrice(snapshot.lines).lines.find((l) => l.key === "business")).toEqual({ key: "business", interval: "month", grossCents: 7900, creditCents: 2900, netCents: 5000 });
  });

  it("coincide con el cotizador en todas las soluciones Net y planes del autoservicio", () => {
    for (const net of ["hotel-net-complete", "ski-net-complete", "travel-net-complete", "restaurant-net-complete", "care-net-complete", "social-token-net-complete"]) {
      for (const plan of ["essential", "business"]) {
        const q = commercialQuote(cat, NET_ONLY, { plan, interval: "month", items: [{ key: net }] });
        expect(contractualPrice(q.lines).monthlyCents, `${net} ${plan}`).toBe(q.recurring.monthlyCents);
      }
    }
    const annual = commercialQuote(cat, NET_ONLY, { plan: "business", interval: "year", items: [ski] });
    expect(contractualPrice(annual.lines)).toMatchObject({ monthlyCents: 9900, yearlyCents: 48_000 });
  });

  it("U16 contrato histórico: Core y Net en dos cuotas; una compra posterior no pone el plan a 0 €", () => {
    const legacy = commercialQuote(cat, NET_ONLY, { plan: "essential", interval: "month", items: [], owned: ["ski-net-complete"], contractModel: "legacy" });
    const plan = legacy.lines.find((l) => l.key === "essential")!;
    expect([plan.status, plan.unitCents]).toEqual(["charged", 2900]);
    const buy = commercialQuote(cat, NET_ONLY, { plan: "essential", interval: "month", items: [hotel], owned: ["ski-net-complete"], contractModel: "legacy" });
    expect(buy.lines.find((l) => l.key === "essential")!.unitCents).toBe(2900);
    expect(buy.lines.find((l) => l.key === "hotel-net-complete")).toMatchObject({ status: "charged", unitCents: 11_900 });
    // Sin indicar el modelo, un Net ya contratado tampoco aporta Core (solo los nuevos componen)
    const unknown = commercialQuote(cat, NET_ONLY, { plan: "essential", interval: "month", items: [], owned: ["ski-net-complete"] });
    expect(unknown.lines.find((l) => l.key === "essential")!.unitCents).toBe(2900);
  });
});

describe("renovaciones", () => {
  it("Ski Net + Business mensual + Hotel adicional: cada renovación cobra la cuota contratada", async () => {
    const gw = new FakeStripeGateway();
    gw.invoiceTaxBp = 2100;
    for (const [id, amount] of [["price_business", 7900], ["price_ski", 9900], ["price_hotel", 11_900]] as const) gw.addPrice({ id, productId: id.replace("price", "prod"), unitAmount: amount });
    const c = await gw.ensureCoupon({ id: "es-beta-core-credit-essential-month-2900", name: "Core", amountOffCents: 2900, currency: "EUR", metadata: {} });
    gw.subscriptions.set("sub_1", { id: "sub_1", customerId: "cus_1", status: "active", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodStart: START, currentPeriodEnd: END, latestInvoiceId: null, priceIds: [], metadata: {}, items: [{ id: "si_b", priceId: "price_business", quantity: 1, discounts: [c] }, { id: "si_s", priceId: "price_ski", quantity: 1 }, { id: "si_h", priceId: "price_hotel", quantity: 1, discounts: [c] }], pendingUpdate: null, billingMode: "flexible" });
    // Instantánea: Hotel aporta el Core (mayor precio); Ski adicional y Business con crédito
    const contracted = 7900 - 2900 + 9900 + 11_900 - 2900;
    for (let month = 0; month < 3; month++) {
      const inv = gw.invoices.get(gw.addInvoice("sub_1", "cus_1", "subscription_cycle", "paid", 7900 + 9900 + 11_900))!;
      expect(invoiceNetCents(inv)).toBe(contracted);
      expect(inv.taxCents).toBe(Math.round(contracted * 0.21));
    }
  });
});

describe("cambios a mitad de periodo: aceptado = cobrado", () => {
  const period = { start: START, end: END, at: START + 15 * DAY };
  async function upgrade(couponProration: "proportional" | "flat") {
    const gw = new FakeStripeGateway();
    gw.couponProration = couponProration;
    gw.addPrice({ id: "price_business", productId: "prod_business", unitAmount: 7900 });
    gw.addPrice({ id: "price_ski", productId: "prod_ski", unitAmount: 9900 });
    gw.addPrice({ id: "price_hotel", productId: "prod_hotel", unitAmount: 11_900 });
    const c = await gw.ensureCoupon({ id: "es-beta-core-credit-essential-month-2900", name: "Core", amountOffCents: 2900, currency: "EUR", metadata: {} });
    gw.subscriptions.set("sub_1", { id: "sub_1", customerId: "cus_1", status: "active", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodStart: START, currentPeriodEnd: END, latestInvoiceId: null, priceIds: ["price_ski"], metadata: {}, items: [{ id: "si_s", priceId: "price_ski", quantity: 1 }], pendingUpdate: null, billingMode: "flexible" });
    return { gw, c };
  }

  it("U8 subida Essential incluido → Business: (79 − 29) × ½ = 25 €, la vista previa coincide y se cobra eso", async () => {
    const { gw, c } = await upgrade("proportional");
    const change = { subscriptionId: "sub_1", items: [{ priceId: "price_business", quantity: 1, discounts: [c] }], prorationBehavior: "always_invoice" as const, prorationDate: period.at };
    const expected = expectedChange([{ priceId: "price_business", grossUnitCents: 7900, creditCents: 2900, from: 0, to: 1 }], period);
    expect(expected.netCents).toBe(2500);
    const check = checkChangePreview(await gw.previewSubscriptionChange(change), expected);
    expect(check).toEqual({ ok: true, netCents: 2500 });
    const r = await gw.updateSubscriptionItems({ ...change, paymentBehavior: "pending_if_incomplete" }, "k");
    expect(invoiceNetCents(r.invoice!)).toBe(2500);
  });

  it("R-J: si Stripe descontara el cupón entero (79 × ½ − 29), no se cobra: conflicto", async () => {
    const { gw, c } = await upgrade("flat");
    const preview = await gw.previewSubscriptionChange({ subscriptionId: "sub_1", items: [{ priceId: "price_business", quantity: 1, discounts: [c] }], prorationBehavior: "always_invoice", prorationDate: period.at });
    const check = checkChangePreview(preview, expectedChange([{ priceId: "price_business", grossUnitCents: 7900, creditCents: 2900, from: 0, to: 1 }], period));
    expect(check.ok).toBe(false);
    expect(check).toMatchObject({ reason: expect.stringContaining("1050") });
  });

  it("U10 segundo Net a mitad de periodo: (119 − 29) × ½ = 45 €", async () => {
    const { gw, c } = await upgrade("proportional");
    const preview = await gw.previewSubscriptionChange({ subscriptionId: "sub_1", items: [{ priceId: "price_hotel", quantity: 1, discounts: [c] }], prorationBehavior: "always_invoice", prorationDate: period.at });
    expect(checkChangePreview(preview, expectedChange([{ priceId: "price_hotel", grossUnitCents: 11_900, creditCents: 2900, from: 0, to: 1 }], period))).toEqual({ ok: true, netCents: 4500 });
  });

  it("un Price distinto del previsto en la vista previa: conflicto", async () => {
    const { gw } = await upgrade("proportional");
    const preview = await gw.previewSubscriptionChange({ subscriptionId: "sub_1", items: [{ priceId: "price_business", quantity: 1 }], prorationBehavior: "always_invoice", prorationDate: period.at });
    expect(checkChangePreview(preview, expectedChange([{ priceId: "price_business", grossUnitCents: 7900, creditCents: 2900, from: 0, to: 1 }], period)).ok).toBe(false);
  });
});
