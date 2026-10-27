/**
 * Elephant Net con Elephant Core incluido en el pago (contrato v3 P0-C, pruebas U1-U7 y U17 del §9): las partidas del
 * Checkout salen del presupuesto comercial con las tarifas del catálogo de Elephant Source.
 *  - el plan incluido no tiene partida en Stripe; ampliación y Net adicional van con su Price completo y un crédito
 *    que es la tarifa aprobada de Essential (cupón);
 *  - lo que paga el cliente en el primer cobro (neto después del cupón) es el presupuesto aceptado;
 *  - sin cuota anual del plan incluido, un crédito por pago, una unidad por partida con crédito;
 *  - con la política sin la regla (hoy), Core y Net se cobran aparte como siempre.
 */
import { describe, it, expect } from "vitest";
import { quoteCatalogFromSeed } from "../catalog/commercial/seedCatalog";
import { commercialQuote, type CommercialQuote, type CommercialQuoteRequest } from "../catalog/commercial/commercialQuote";
import { CATALOG_POLICY, PROPOSED_POLICY, type CommercialPolicy } from "../catalog/commercial/policy";
import { coreCreditCoupon, planCheckoutLines, type CheckoutLinePlan } from "./checkoutLines";
import { invoiceNetCents } from "./gateway";
import { SELF_SERVICE_PLANS } from "./catalog";
import { FakeStripeGateway } from "./testing";

const cat = quoteCatalogFromSeed();
const NET_ONLY: CommercialPolicy = { ...CATALOG_POLICY, id: "solo-net", coreIncluded: PROPOSED_POLICY.coreIncluded };

/** Oferta publicada, enlaces de Stripe y Prices reales de Stripe a partir del catálogo (todas las tarifas en EUR). */
function setup() {
  const gw = new FakeStripeGateway();
  let id = 0;
  const links = new Map<number, { stripePriceId: string; stripeProductId: string; lookupKey: string; status: "active" }>();
  const offer = cat.products.map((p) => ({
    ...p,
    activationKind: "module",
    activationRef: null,
    prices: p.prices
      .filter((x) => x.kind === "monthly" || x.kind === "yearly")
      .map((x) => {
        const pid = ++id;
        const lookupKey = `${p.key}_${x.kind}`;
        links.set(pid, { stripePriceId: `price_${lookupKey}`, stripeProductId: `prod_${p.key}`, lookupKey, status: "active" });
        gw.addPrice({ id: `price_${lookupKey}`, productId: `prod_${p.key}`, lookupKey, unitAmount: x.amountCents, interval: x.kind === "yearly" ? "year" : "month" });
        return { id: pid, productKey: p.key, kind: x.kind, amountCents: x.amountCents, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved" as const };
      }),
  }));
  const deps = {
    catalog: { offer: async () => offer, product: async () => null, price: async () => null } as never,
    store: { priceForWebPrice: async (pid: number) => links.get(pid) ?? null } as never,
    gateway: gw,
  };
  return { gw, deps };
}

/** Pedido con el presupuesto aceptado (contrato y primer cobro) del presupuesto comercial. */
function orderOf(r: CommercialQuoteRequest, q: CommercialQuote) {
  const first = r.interval === "year" ? q.recurring.yearlyCents + q.recurring.monthlyCents : q.recurring.monthlyCents;
  return { request: r, quote: { currency: "EUR", contractAmountCents: r.interval === "month" ? q.recurring.monthlyCents : q.recurring.yearlyCents + 12 * q.recurring.monthlyCents, firstPeriodNetCents: first } } as never;
}

async function plan(r: CommercialQuoteRequest, policy: CommercialPolicy = NET_ONLY): Promise<CheckoutLinePlan & { q: CommercialQuote }> {
  const { deps } = setup();
  const q = commercialQuote(cat, policy, r);
  return { ...(await planCheckoutLines(deps, orderOf(r, q), q)), q };
}

const ski = { key: "ski-net-complete" };
const hotel = { key: "hotel-net-complete" };

describe("Checkout de Elephant Net con Core incluido", () => {
  it("U1 Ski Net + Essential mensual: una sola partida (Ski 99 €), plan incluido sin partida en Stripe", async () => {
    const p = await plan({ plan: "essential", interval: "month", items: [ski] });
    expect(p.recurring.map((l) => [l.productKey, l.unitAmountCents, l.credit?.cents ?? 0])).toEqual([["ski-net-complete", 9900, 0]]);
    expect(p).toMatchObject({ includedPlan: "essential", deferred: [], firstChargeCents: 9900, monthlyCents: 9900 });
  });

  it("U2 Ski Net + Essential anual: no hay cuota anual que cobrar, se rechaza", async () => {
    const r: CommercialQuoteRequest = { plan: "essential", interval: "year", items: [ski] };
    const { deps } = setup();
    const q = commercialQuote(cat, NET_ONLY, r);
    await expect(planCheckoutLines(deps, { request: r, quote: { currency: "EUR", contractAmountCents: 9900 * 12, firstPeriodNetCents: 9900 } } as never, q)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("U3 Ski Net + Business mensual: Business 79 € con crédito de 29 € + Ski 99 € = 149 €", async () => {
    const p = await plan({ plan: "business", interval: "month", items: [ski] });
    expect(p.recurring.map((l) => [l.productKey, l.unitAmountCents, l.credit?.cents ?? 0])).toEqual([["business", 7900, 2900], ["ski-net-complete", 9900, 0]]);
    expect(p).toMatchObject({ includedPlan: null, firstChargeCents: 14_900 });
    expect(p.recurring[0].credit).toEqual({ kind: "core_upgrade", cents: 2900, plan: "essential", interval: "month" });
  });

  it("U4 Ski Net + Business anual: Business 759 € con crédito de 279 €, Ski diferido; primer cobro 480 + 99", async () => {
    const p = await plan({ plan: "business", interval: "year", items: [ski] });
    expect(p.recurring.map((l) => [l.productKey, l.interval, l.unitAmountCents, l.credit?.cents ?? 0])).toEqual([["business", "year", 75_900, 27_900]]);
    expect(p.deferred.map((l) => [l.productKey, l.unitAmountCents])).toEqual([["ski-net-complete", 9900]]);
    expect(p.firstChargeCents).toBe(48_000 + 9900);
  });

  it("U5 Ski Net + Enterprise: la diferencia (+170 €) se calcula, pero el plan no se vende por Checkout", async () => {
    const p = await plan({ plan: "enterprise", interval: "month", items: [ski] });
    const ent = p.recurring.find((l) => l.productKey === "enterprise")!;
    expect(ent.unitAmountCents - ent.credit!.cents).toBe(17_000);
    // checkout.ts rechaza los planes fuera del autoservicio antes de calcular las partidas (contrato v3, H6)
    expect((SELF_SERVICE_PLANS as readonly string[]).includes("enterprise")).toBe(false);
  });

  it("U6 Hotel + Ski con Essential: Hotel aporta el Core, Ski adicional 99 − 29; total 189 €", async () => {
    const p = await plan({ plan: "essential", interval: "month", items: [ski, hotel] });
    expect(p.recurring.map((l) => [l.productKey, l.unitAmountCents, l.credit?.cents ?? 0]).sort()).toEqual([["hotel-net-complete", 11_900, 0], ["ski-net-complete", 9900, 2900]]);
    expect(p.q.netCore.providedBy).toBe("hotel-net-complete");
    expect(p.firstChargeCents).toBe(18_900);
  });

  it("dos créditos en un mismo pago (Business + segundo Net): se contrata uno después", async () => {
    await expect(plan({ plan: "business", interval: "month", items: [ski, hotel] })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("U7 Net + extensiones: las extensiones se cobran a su precio, sin crédito", async () => {
    const p = await plan({ plan: "essential", interval: "month", items: [ski, { key: "connect-automations" }] });
    const ext = p.recurring.find((l) => l.productKey === "connect-automations");
    expect(ext).toBeDefined();
    expect(ext!.credit).toBeUndefined();
    expect(p.firstChargeCents).toBe(9900 + ext!.unitAmountCents);
  });

  it("crédito manipulado o que no es la tarifa aprobada de Essential: conflicto, nada se cobra", async () => {
    const r: CommercialQuoteRequest = { plan: "business", interval: "month", items: [ski] };
    const { deps } = setup();
    const q = commercialQuote(cat, NET_ONLY, r);
    const bad = structuredClone(q);
    const b = bad.lines.find((l) => l.key === "business")!;
    b.credit = { ...b.credit!, cents: 3000 };
    b.unitCents = 4900;
    await expect(planCheckoutLines(deps, orderOf(r, q), bad)).rejects.toMatchObject({ code: "conflict" });
    const noCredit = structuredClone(q);
    delete noCredit.lines.find((l) => l.key === "business")!.credit;
    await expect(planCheckoutLines(deps, orderOf(r, q), noCredit)).rejects.toMatchObject({ code: "conflict" });
  });

  it("una partida con crédito y más de una unidad: por propuesta comercial", async () => {
    const r: CommercialQuoteRequest = { plan: "essential", interval: "month", items: [ski, hotel] };
    const { deps } = setup();
    const q = commercialQuote(cat, NET_ONLY, r);
    const two = structuredClone(q);
    const s = two.lines.find((l) => l.status === "net_additional")!;
    s.quantity = 2;
    s.amountCents *= 2;
    await expect(planCheckoutLines(deps, orderOf(r, two), two)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("U17 sin la regla (política de hoy): Essential 29 € + Ski 99 € en dos cuotas, sin créditos", async () => {
    const p = await plan({ plan: "essential", interval: "month", items: [ski] }, CATALOG_POLICY);
    expect(p.recurring.map((l) => [l.productKey, l.unitAmountCents, l.credit])).toEqual([["essential", 2900, undefined], ["ski-net-complete", 9900, undefined]]);
    expect(p).toMatchObject({ includedPlan: null, firstChargeCents: 12_800 });
  });

  it("aceptado = cobrado: el primer cobro del Checkout con el cupón es el neto del presupuesto", async () => {
    const r: CommercialQuoteRequest = { plan: "business", interval: "month", items: [ski] };
    const { deps, gw } = setup();
    const q = commercialQuote(cat, NET_ONLY, r);
    const p = await planCheckoutLines(deps, orderOf(r, q), q);
    const spec = coreCreditCoupon("beta", p.recurring.find((l) => l.credit)!.credit!);
    expect(spec).toMatchObject({ id: "es-beta-core-credit-essential-month-2900", amountOffCents: 2900, currency: "EUR" });
    const coupon = await gw.ensureCoupon(spec);
    gw.invoiceTaxBp = 2100;
    const { id } = await gw.createCheckoutSession({ customerId: "cus_1", priceId: p.recurring[0].stripePriceId, lineItems: p.recurring.map((l) => ({ priceId: l.stripePriceId, quantity: l.quantity })), clientReferenceId: "es-order-1", metadata: {}, successUrl: "https://x", cancelUrl: "https://x", expiresAt: 1_800_000_000, integrationIdentifier: "t", discounts: [coupon] }, "k");
    const sub = gw.completeSession(id);
    const inv = gw.invoices.get(gw.subscriptions.get(sub)!.latestInvoiceId!)!;
    expect(invoiceNetCents(inv)).toBe(p.firstChargeCents);
    expect(invoiceNetCents(inv)).toBe(q.recurring.monthlyCents);
    expect(inv.taxCents).toBe(Math.round(14_900 * 0.21));
  });
});
