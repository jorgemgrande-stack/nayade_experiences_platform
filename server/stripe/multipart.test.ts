/**
 * Suscripción multipartida: reglas puras (prorrateo, partidas a enviar, periodicidades, métodos de pago, propuestas
 * anuales) y el doble de Stripe con cobro condicionado (`pending_if_incomplete` + `always_invoice`): el cambio solo se
 * aplica si se cobra; si no, queda pendiente, caduca y no cambia nada.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FakeStripeGateway } from "./testing";
import { intervalCompatible, itemChanges, proposeYearlyPrices, prorationCents, stripeBillingModeFromEnv, supportsPendingUpdate, yearlyFromMonthly } from "./multipart";
import { toInvoiceLine, toSubscription } from "./gateway";

const DAY = 86_400;
const START = 1_900_000_000;
const END = START + 30 * DAY;

describe("reglas multipartida", () => {
  it("prorrateo por segundos, positivo al subir y negativo al bajar", () => {
    expect(prorationCents(1000, 1, 3, START, END, START + 15 * DAY)).toBe(1000);
    expect(prorationCents(1000, 3, 1, START, END, START + 15 * DAY)).toBe(-1000);
    expect(prorationCents(1000, 0, 1, START, END, START)).toBe(1000);
    expect(prorationCents(1000, 0, 1, START, END, END + 10)).toBe(0);
    expect(prorationCents(1000, 0, 1, START, START, START)).toBe(0);
    expect(prorationCents(999, 0, 1, START, END, START + 10 * DAY)).toBe(666);
  });

  it("partidas a enviar: añade, cambia cantidad, quita y no repite lo que no cambia", () => {
    const current = [
      { id: "si_plan", priceId: "price_plan", quantity: 1 },
      { id: "si_users", priceId: "price_users", quantity: 2 },
      { id: "si_mod", priceId: "price_mod", quantity: 1 },
    ];
    expect(itemChanges(current, [{ priceId: "price_plan", quantity: 1 }, { priceId: "price_users", quantity: 5 }, { priceId: "price_new", quantity: 1 }])).toEqual([
      { id: "si_users", quantity: 5 },
      { id: "si_mod", deleted: true },
      { priceId: "price_new", quantity: 1 },
    ]);
    expect(itemChanges(current, current.map((c) => ({ priceId: c.priceId, quantity: c.quantity })))).toEqual([]);
    expect(itemChanges(current, [{ priceId: "price_plan", quantity: 1 }, { priceId: "price_users", quantity: 0 }, { priceId: "price_mod", quantity: 1 }])).toEqual([{ id: "si_users", deleted: true }]);
  });

  it("modo de facturación: clásico por defecto; flexible solo explícito; otro valor no arranca", () => {
    expect(stripeBillingModeFromEnv({})).toBe("classic");
    expect(stripeBillingModeFromEnv({ CP_STRIPE_BILLING_MODE: " Classic " })).toBe("classic");
    expect(stripeBillingModeFromEnv({ CP_STRIPE_BILLING_MODE: "flexible" })).toBe("flexible");
    expect(() => stripeBillingModeFromEnv({ CP_STRIPE_BILLING_MODE: "mixto" })).toThrow(/classic.*flexible/);
    expect(intervalCompatible("classic", "month", "month")).toBe(true);
    expect(intervalCompatible("classic", "month", "year")).toBe(false);
    expect(intervalCompatible("flexible", "month", "year")).toBe(true);
  });

  it("compra en línea solo con métodos de cobro inmediato (no SEPA ni sin método)", () => {
    expect(supportsPendingUpdate("card")).toBe(true);
    expect(supportsPendingUpdate("link")).toBe(true);
    expect(supportsPendingUpdate("sepa_debit")).toBe(false);
    expect(supportsPendingUpdate("bacs_debit")).toBe(false);
    expect(supportsPendingUpdate(null)).toBe(false);
  });

  it("propuesta anual = 10 × mensual, solo con mensual aprobado y sin anual existente", () => {
    expect(yearlyFromMonthly(2900)).toBe(29_000);
    expect(
      proposeYearlyPrices([
        { key: "plan", name: "Plan", prices: [{ kind: "monthly", amountCents: 2900, currency: "EUR" }, { kind: "yearly", amountCents: 27_900, currency: "EUR" }] },
        { key: "users", name: "Usuarios", prices: [{ kind: "monthly", amountCents: 500, currency: "EUR", status: "approved" }] },
        { key: "borrador", name: "Borrador", prices: [{ kind: "monthly", amountCents: 900, currency: "EUR", status: "draft" }] },
        { key: "sin-precio", name: "Sin precio", prices: [] },
      ]),
    ).toEqual([{ productKey: "users", name: "Usuarios", currency: "EUR", monthlyCents: 500, proposedYearlyCents: 5000 }]);
  });
});

describe("conversión de la API de Stripe", () => {
  it("suscripción: partidas, cambio pendiente, modo de facturación e inicio del periodo", () => {
    const s = toSubscription({
      id: "sub_1",
      object: "subscription",
      livemode: false,
      customer: "cus_1",
      status: "active",
      cancel_at: null,
      cancel_at_period_end: false,
      latest_invoice: "in_1",
      metadata: {},
      pending_update: { expires_at: START + 23 * 3600 },
      billing_mode: { type: "classic" },
      items: { data: [{ id: "si_1", price: { id: "price_plan" }, quantity: 1, current_period_start: START, current_period_end: END }, { id: "si_2", price: { id: "price_users" }, quantity: 4, current_period_start: START, current_period_end: END }] },
    } as never, "test");
    expect(s).toMatchObject({ items: [{ id: "si_1", priceId: "price_plan", quantity: 1 }, { id: "si_2", priceId: "price_users", quantity: 4 }], pendingUpdate: { expiresAt: START + 23 * 3600 }, billingMode: "classic", currentPeriodStart: START, currentPeriodEnd: END });
  });

  it("línea de factura (API nueva con parent/pricing y antigua)", () => {
    expect(
      toInvoiceLine({ id: "il_1", amount: -500, quantity: 2, period: { start: START, end: END }, taxes: [{ amount: -105 }], parent: { subscription_item_details: { subscription_item: "si_2", proration: true } }, pricing: { price_details: { price: "price_users" } } } as never),
    ).toEqual({ id: "il_1", subscriptionItemId: "si_2", priceId: "price_users", quantity: 2, amount: -500, taxCents: -105, proration: true, periodStart: START, periodEnd: END });
    expect(toInvoiceLine({ id: "il_2", amount: 100, quantity: 1, price: { id: "price_x" }, proration: false, subscription_item: "si_9" } as never)).toMatchObject({ subscriptionItemId: "si_9", priceId: "price_x", proration: false, taxCents: null });
  });
});

describe("doble de Stripe: cambio de partidas con cobro condicionado", () => {
  let gw: FakeStripeGateway;
  const change = (items: Parameters<FakeStripeGateway["updateSubscriptionItems"]>[0]["items"]) => ({ subscriptionId: "sub_1", items, prorationBehavior: "always_invoice" as const, paymentBehavior: "pending_if_incomplete" as const, metadata: { order_id: "7" } });

  beforeEach(() => {
    gw = new FakeStripeGateway();
    gw.now = START + 15 * DAY;
    gw.addPrice({ id: "price_plan", productId: "prod_plan", unitAmount: 2900 });
    gw.addPrice({ id: "price_users", productId: "prod_users", unitAmount: 500 });
    gw.addPrice({ id: "price_mod", productId: "prod_mod", unitAmount: 1900 });
    gw.addPrice({ id: "price_mod_y", productId: "prod_mod", unitAmount: 19_000, interval: "year" });
    gw.subscriptions.set("sub_1", { id: "sub_1", customerId: "cus_1", status: "active", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodStart: START, currentPeriodEnd: END, latestInvoiceId: null, priceIds: ["price_plan"], metadata: {}, items: [{ id: "si_plan", priceId: "price_plan", quantity: 1 }], pendingUpdate: null, billingMode: "classic" });
  });

  it("vista previa sin efectos: prorrateo de la mitad del periodo con impuesto", async () => {
    gw.invoiceTaxBp = 2100;
    const p = await gw.previewSubscriptionChange({ subscriptionId: "sub_1", items: [{ priceId: "price_mod", quantity: 1 }, { id: "si_plan", quantity: 1 }], prorationBehavior: "always_invoice" });
    expect(p).toMatchObject({ currency: "EUR", subtotal: 950, taxCents: 200, amountDue: 1150 });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ priceId: "price_mod", quantity: 1, proration: true });
    expect((await gw.subscription("sub_1"))!.items).toHaveLength(1);
    expect(gw.invoices.size).toBe(0);
  });

  it("cobro correcto: factura pagada con sus líneas y cambio aplicado; misma clave, mismo resultado", async () => {
    const r = await gw.updateSubscriptionItems(change([{ priceId: "price_mod", quantity: 1 }]), "order:7:v1");
    expect(r.invoice).toMatchObject({ status: "paid", billingReason: "subscription_update", subtotal: 950, amountPaid: 950 });
    expect(r.invoice!.lines).toHaveLength(1);
    expect(r.subscription.priceIds).toEqual(["price_plan", "price_mod"]);
    expect(r.subscription.pendingUpdate).toBeNull();
    expect(r.subscription.metadata).toMatchObject({ order_id: "7" });
    const again = await gw.updateSubscriptionItems(change([{ priceId: "price_mod", quantity: 1 }]), "order:7:v1");
    expect(again.invoice!.id).toBe(r.invoice!.id);
    expect(gw.invoices.size).toBe(1);
    await expect(gw.updateSubscriptionItems(change([{ priceId: "price_users", quantity: 3 }]), "order:7:v1")).rejects.toMatchObject({ code: "idempotency_error" });
  });

  it("cobro fallido o con autenticación: factura abierta, cambio pendiente y NADA aplicado", async () => {
    for (const outcome of ["fail", "requires_action"] as const) {
      gw.paymentOutcome.set("cus_1", outcome);
      const r = await gw.updateSubscriptionItems(change([{ priceId: "price_users", quantity: 3 }]), `order:${outcome}`);
      expect(r.invoice).toMatchObject({ status: "open", amountPaid: 0 });
      expect(r.invoice!.hostedInvoiceUrl).toMatch(/^https:\/\//);
      expect(r.subscription.priceIds).toEqual(["price_plan"]);
      expect(r.subscription.pendingUpdate).toEqual({ expiresAt: gw.now! + 23 * 3600 });
      gw.expirePendingUpdate("sub_1");
      expect(gw.invoices.get(r.invoice!.id)!.status).toBe("void");
      expect((await gw.subscription("sub_1"))!.pendingUpdate).toBeNull();
      expect((await gw.subscription("sub_1"))!.priceIds).toEqual(["price_plan"]);
    }
    expect(gw.events.map((e) => e.type)).toContain("customer.subscription.pending_update_expired");
  });

  it("si el cliente paga la factura pendiente, el cambio se aplica entonces", async () => {
    gw.paymentOutcome.set("cus_1", "requires_action");
    const r = await gw.updateSubscriptionItems(change([{ priceId: "price_users", quantity: 3 }]), "order:8:v1");
    gw.payInvoice(r.invoice!.id);
    const s = (await gw.subscription("sub_1"))!;
    expect(s.items!.map((i) => [i.priceId, i.quantity])).toEqual([["price_plan", 1], ["price_users", 3]]);
    expect(s.pendingUpdate).toBeNull();
  });

  it("anular la factura descarta el cambio pendiente; un cambio nuevo sustituye al pendiente", async () => {
    gw.paymentOutcome.set("cus_1", "fail");
    const a = await gw.updateSubscriptionItems(change([{ priceId: "price_users", quantity: 3 }]), "order:9:v1");
    await gw.voidInvoice(a.invoice!.id);
    expect((await gw.subscription("sub_1"))!.pendingUpdate).toBeNull();
    await expect(gw.voidInvoice(a.invoice!.id)).rejects.toThrow(/abiertas/);
    const b = await gw.updateSubscriptionItems(change([{ priceId: "price_users", quantity: 2 }]), "order:10:v1");
    const c = await gw.updateSubscriptionItems(change([{ priceId: "price_mod", quantity: 1 }]), "order:11:v1");
    expect(gw.invoices.get(b.invoice!.id)!.status).toBe("void");
    expect(gw.pending.get("sub_1")!.invoiceId).toBe(c.invoice!.id);
  });

  it("bajar cantidad genera abono y se aplica sin cobro; sin prorrateo se aplica sin factura", async () => {
    gw.paymentOutcome.set("cus_1", "fail");
    gw.subscriptions.set("sub_1", { ...gw.subscriptions.get("sub_1")!, items: [{ id: "si_plan", priceId: "price_plan", quantity: 1 }, { id: "si_users", priceId: "price_users", quantity: 4 }], priceIds: ["price_plan", "price_users"] });
    const r = await gw.updateSubscriptionItems(change([{ id: "si_users", quantity: 2 }]), "order:12:v1");
    expect(r.invoice).toMatchObject({ status: "paid", subtotal: -500 });
    expect(r.subscription.items!.find((i) => i.id === "si_users")!.quantity).toBe(2);
    const n = await gw.updateSubscriptionItems({ ...change([{ id: "si_users", deleted: true }]), prorationBehavior: "none" }, "order:13:v1");
    expect(n.invoice).toBeNull();
    expect(n.subscription.priceIds).toEqual(["price_plan"]);
  });

  it("modo clásico rechaza periodicidades mezcladas; error_if_incomplete no deja nada pendiente; SEPA no admite pendiente", async () => {
    await expect(gw.updateSubscriptionItems(change([{ priceId: "price_mod_y", quantity: 1 }]), "order:14:v1")).rejects.toThrow(/periodicidades/);
    gw.subscriptions.set("sub_1", { ...gw.subscriptions.get("sub_1")!, billingMode: "flexible" });
    expect((await gw.previewSubscriptionChange({ subscriptionId: "sub_1", items: [{ priceId: "price_mod_y", quantity: 1 }], prorationBehavior: "always_invoice" })).lines).toHaveLength(1);
    gw.subscriptions.set("sub_1", { ...gw.subscriptions.get("sub_1")!, billingMode: "classic" });
    gw.paymentOutcome.set("cus_1", "fail");
    await expect(gw.updateSubscriptionItems({ ...change([{ priceId: "price_mod", quantity: 1 }]), paymentBehavior: "error_if_incomplete" }, "order:15:v1")).rejects.toMatchObject({ code: "card_declined" });
    expect(gw.pending.size).toBe(0);
    gw.pmTypeOf.set("cus_1", "sepa_debit");
    expect(await gw.paymentMethodTypeOf("sub_1")).toBe("sepa_debit");
    await expect(gw.updateSubscriptionItems(change([{ priceId: "price_mod", quantity: 1 }]), "order:16:v1")).rejects.toThrow(/método de pago/);
    expect((await gw.subscription("sub_1"))!.priceIds).toEqual(["price_plan"]);
  });

  it("partida o precio inexistentes y precio repetido fallan sin efectos", async () => {
    await expect(gw.updateSubscriptionItems(change([{ id: "si_nope", quantity: 2 }]), "k1")).rejects.toMatchObject({ code: "resource_missing" });
    await expect(gw.updateSubscriptionItems(change([{ priceId: "price_nope", quantity: 1 }]), "k2")).rejects.toMatchObject({ code: "resource_missing" });
    await expect(gw.updateSubscriptionItems(change([{ priceId: "price_plan", quantity: 1 }]), "k3")).rejects.toThrow(/repetido/);
    expect(gw.invoices.size).toBe(0);
  });
});
