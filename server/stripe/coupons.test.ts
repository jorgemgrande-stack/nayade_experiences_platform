/**
 * Cupones de crédito (Elephant Core incluido en Elephant Net, contrato v3 P0-A y P0-D):
 *  - la conversión de la API lee descuentos por línea y por factura y el neto sin impuestos; sin descuentos, el
 *    objeto queda exactamente como antes;
 *  - la base cotejada y declarada es el neto DESPUÉS de los descuentos;
 *  - el doble de Stripe aplica los cupones por partida en el alta, las renovaciones y los prorrateos, con las dos
 *    formas posibles de prorratear un cupón (riesgo R-J, se decide en sandbox con S-N2).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FakeStripeGateway } from "./testing";
import { invoiceNetCents, toInvoice, toInvoiceLine, toSubscription, type CouponSpec } from "./gateway";
import { invoiceRecordOf } from "./fiscalDocuments";

const START = 1_800_000_000;
const DAY = 86_400;
const END = START + 30 * DAY;
const coupon = (amountOffCents: number, id = `es-test-core-credit-essential-month-${amountOffCents}`): CouponSpec => ({ id, name: "Elephant Core Essential incluido", amountOffCents, currency: "EUR", appliesToProducts: ["prod_business", "prod_ski", "prod_hotel"], metadata: { es_reason: "core_included" } });

describe("conversión de la API: descuentos", () => {
  it("línea y factura con cupón: descuento y neto sin impuestos; sin cupón, sin campos nuevos", () => {
    expect(toInvoiceLine({ id: "il_1", amount: 7900, quantity: 1, discount_amounts: [{ amount: 2900 }], taxes: [{ amount: 1050 }], pricing: { price_details: { price: "price_business" } } } as never)).toMatchObject({ amount: 7900, discountCents: 2900, taxCents: 1050 });
    expect(toInvoiceLine({ id: "il_2", amount: 9900, quantity: 1, discount_amounts: [] } as never)).not.toHaveProperty("discountCents");
    const inv = toInvoice({ id: "in_1", object: "invoice", livemode: false, status: "paid", amount_paid: 18029, currency: "eur", subtotal: 17800, total_discount_amounts: [{ amount: 2900 }], total_excluding_tax: 14900, total: 18029 } as never, "test");
    expect(inv).toMatchObject({ subtotal: 17800, discountCents: 2900, totalExcludingTax: 14900 });
    const plain = toInvoice({ id: "in_2", object: "invoice", livemode: false, status: "paid", amount_paid: 9900, currency: "eur", subtotal: 9900, total_discount_amounts: [], total_excluding_tax: 9900, total: 9900 } as never, "test");
    expect(plain).not.toHaveProperty("discountCents");
    expect(plain).not.toHaveProperty("totalExcludingTax");
  });

  it("partida con descuentos expandidos: cupones; con ids sueltos, nada (no se adivina)", () => {
    const sub = (discounts: unknown[]) =>
      toSubscription({ id: "sub_1", object: "subscription", livemode: false, customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: {}, items: { data: [{ id: "si_1", price: { id: "price_business" }, quantity: 1, discounts }] } } as never, "test");
    expect(sub([{ id: "di_1", source: { coupon: { id: "es-core-2900" } } }]).items).toEqual([{ id: "si_1", priceId: "price_business", quantity: 1, discounts: ["es-core-2900"] }]);
    expect(sub([{ id: "di_2", coupon: "es-core-2900" }]).items![0].discounts).toEqual(["es-core-2900"]);
    expect(sub(["di_3"]).items).toEqual([{ id: "si_1", priceId: "price_business", quantity: 1 }]);
  });

  it("neto de una factura: sin descuentos, el subtotal de siempre; con cupón, el neto después de descuentos", () => {
    expect(invoiceNetCents({ subtotal: 9900, amountPaid: 11979 })).toBe(9900);
    expect(invoiceNetCents({ subtotal: null, amountPaid: 9900 })).toBe(9900);
    expect(invoiceNetCents({ subtotal: 17800, amountPaid: 0, discountCents: 2900, totalExcludingTax: 14900 })).toBe(14900);
    expect(invoiceNetCents({ subtotal: 17800, amountPaid: 0, discountCents: 2900, totalExcludingTax: null })).toBe(14900);
  });

  it("documento fiscal: la base imponible es el neto después del crédito", () => {
    const r = invoiceRecordOf({ id: "in_1", status: "paid", subscriptionId: "sub_1", customerId: "cus_1", amountPaid: 18029, currency: "EUR", billingReason: "subscription_create", periodStart: START, subtotal: 17800, discountCents: 2900, totalExcludingTax: 14900, taxCents: 3129, total: 18029 }, { orderId: 1, purpose: "initial", buyerScenario: null, now: 1 });
    expect(r.subtotalCents).toBe(14900);
    expect(r.totalCents).toBe(18029);
  });
});

describe("doble de Stripe: cupones por partida", () => {
  let gw: FakeStripeGateway;
  beforeEach(() => {
    gw = new FakeStripeGateway();
    gw.now = START + 15 * DAY;
    gw.addPrice({ id: "price_business", productId: "prod_business", unitAmount: 7900, lookupKey: "business_m" });
    gw.addPrice({ id: "price_ski", productId: "prod_ski", unitAmount: 9900, lookupKey: "ski_m" });
    gw.addPrice({ id: "price_hotel", productId: "prod_hotel", unitAmount: 11_900, lookupKey: "hotel_m" });
  });

  it("cupón idempotente por id; otro importe con el mismo id, error", async () => {
    expect(await gw.ensureCoupon(coupon(2900))).toBe("es-test-core-credit-essential-month-2900");
    expect(await gw.ensureCoupon(coupon(2900))).toBe("es-test-core-credit-essential-month-2900");
    await expect(gw.ensureCoupon(coupon(3100, "es-test-core-credit-essential-month-2900"))).rejects.toMatchObject({ code: "coupon_mismatch" });
    expect(gw.coupons.size).toBe(1);
  });

  it("alta Ski Net + Business con cupón de sesión: primer cobro neto 14900, IVA sobre el neto, renovación con el cupón", async () => {
    gw.invoiceTaxBp = 2100;
    await gw.ensureCoupon(coupon(2900));
    const { id } = await gw.createCheckoutSession({ customerId: "cus_1", priceId: "price_business", lineItems: [{ priceId: "price_business", quantity: 1 }, { priceId: "price_ski", quantity: 1 }], clientReferenceId: "1", metadata: {}, successUrl: "https://x", cancelUrl: "https://x", expiresAt: START, integrationIdentifier: "t", discounts: [coupon(2900).id] }, "k1");
    const subId = gw.completeSession(id);
    const first = gw.invoices.get(gw.subscriptions.get(subId)!.latestInvoiceId!)!;
    expect(first).toMatchObject({ subtotal: 17_800, discountCents: 2900, totalExcludingTax: 14_900, taxCents: 3129, total: 18_029, amountPaid: 18_029 });
    expect(invoiceNetCents(first)).toBe(14_900);
    expect(gw.subscriptions.get(subId)!.items!.find((i) => i.priceId === "price_business")!.discounts).toEqual([coupon(2900).id]);
    const renewal = gw.invoices.get(gw.addInvoice(subId, "cus_1", "subscription_cycle", "paid", 17_800))!;
    expect(renewal).toMatchObject({ discountCents: 2900, totalExcludingTax: 14_900, total: 18_029 });
  });

  it("sin cupones, las facturas no cambian de forma", async () => {
    const { id } = await gw.createCheckoutSession({ customerId: "cus_1", priceId: "price_ski", clientReferenceId: "1", metadata: {}, successUrl: "https://x", cancelUrl: "https://x", expiresAt: START, integrationIdentifier: "t" }, "k1");
    const subId = gw.completeSession(id);
    const inv = gw.invoices.get(gw.subscriptions.get(subId)!.latestInvoiceId!)!;
    expect(inv).toMatchObject({ subtotal: 9900, total: 9900 });
    expect(inv).not.toHaveProperty("discountCents");
  });

  describe("subida a mitad de periodo con cupón (R-J)", () => {
    const setup = async () => {
      await gw.ensureCoupon(coupon(2900));
      gw.subscriptions.set("sub_1", { id: "sub_1", customerId: "cus_1", status: "active", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodStart: START, currentPeriodEnd: END, latestInvoiceId: null, priceIds: ["price_ski"], metadata: {}, items: [{ id: "si_ski", priceId: "price_ski", quantity: 1 }], pendingUpdate: null, billingMode: "flexible" });
      return { subscriptionId: "sub_1", items: [{ priceId: "price_business", quantity: 1, discounts: [coupon(2900).id] }], prorationBehavior: "always_invoice" as const, prorationDate: START + 15 * DAY };
    };

    it("proporcional: (7900 − 2900) × ½ = 2500, vista previa = cobro", async () => {
      const change = await setup();
      const p = await gw.previewSubscriptionChange(change);
      expect(p).toMatchObject({ subtotal: 3950, discountCents: 1450, totalExcludingTax: 2500, amountDue: 2500 });
      const r = await gw.updateSubscriptionItems({ ...change, paymentBehavior: "pending_if_incomplete" }, "k-up");
      expect(r.invoice).toMatchObject({ subtotal: 3950, discountCents: 1450, totalExcludingTax: 2500, amountPaid: 2500 });
      expect(r.subscription.items!.find((i) => i.priceId === "price_business")!.discounts).toEqual([coupon(2900).id]);
    });

    it("entero: 7900 × ½ − 2900 = 1050 (por eso la vista previa aceptada manda y se coteja)", async () => {
      gw.couponProration = "flat";
      const p = await gw.previewSubscriptionChange(await setup());
      expect(p).toMatchObject({ subtotal: 3950, discountCents: 2900, totalExcludingTax: 1050 });
    });

    it("el instante de prorrateo fijado manda sobre el reloj", async () => {
      const change = await setup();
      gw.now = START + 20 * DAY;
      expect((await gw.previewSubscriptionChange(change)).totalExcludingTax).toBe(2500);
    });

    it("un cupón inexistente se rechaza como en Stripe", async () => {
      const change = await setup();
      await expect(gw.previewSubscriptionChange({ ...change, items: [{ priceId: "price_business", quantity: 1, discounts: ["no-existe"] }] })).rejects.toMatchObject({ code: "resource_missing" });
    });
  });

  it("segundo Net con crédito: (11900 − 2900) × ½ y quitar el cupón (traspaso) sin prorrateo", async () => {
    await gw.ensureCoupon(coupon(2900));
    gw.subscriptions.set("sub_1", { id: "sub_1", customerId: "cus_1", status: "active", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodStart: START, currentPeriodEnd: END, latestInvoiceId: null, priceIds: ["price_ski"], metadata: {}, items: [{ id: "si_ski", priceId: "price_ski", quantity: 1 }], pendingUpdate: null, billingMode: "flexible" });
    const add = await gw.updateSubscriptionItems({ subscriptionId: "sub_1", items: [{ priceId: "price_hotel", quantity: 1, discounts: [coupon(2900).id] }], prorationBehavior: "always_invoice", paymentBehavior: "pending_if_incomplete", prorationDate: START + 15 * DAY }, "k-add");
    expect(add.invoice).toMatchObject({ totalExcludingTax: 4500 });
    const hotel = add.subscription.items!.find((i) => i.priceId === "price_hotel")!;
    const off = await gw.updateSubscriptionItems({ subscriptionId: "sub_1", items: [{ id: hotel.id, discounts: [] }], prorationBehavior: "none", paymentBehavior: "error_if_incomplete" }, "k-off");
    expect(off.invoice).toBeNull();
    expect(off.subscription.items!.find((i) => i.id === hotel.id)!.discounts).toEqual([]);
  });
});
