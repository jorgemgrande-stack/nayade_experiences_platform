/**
 * Registro de eventos comerciales con los almacenes en memoria: qué hecho produce cada cambio, que
 * nada se registra dos veces, que un cambio rechazado no deja evento, origen y causa, entorno y que no
 * se cuela ningún dato personal.
 */
import { describe, it, expect } from "vitest";
import { cleanData } from "./commercialEvents/derive";
import { MemoryCommercialEventLog } from "./commercialEvents/log";
import { sourceOfActor, withCommercialCause } from "./commercialEvents/context";
import type { CommercialEventDraft } from "./commercialEvents/types";
import { MemoryOrderStore, type NewOrder } from "./orchestrator/store";
import type { OrderPayment } from "./orchestrator/types";
import { MemoryTrialStore } from "./trials/store";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { MemoryStripeStore } from "./stripe/store";

const T0 = Date.UTC(2026, 9, 19, 9);
const actor = "operator:pruebas";

const newOrder = (o: Partial<NewOrder> = {}): NewOrder => ({
  idempotencyKey: `k-${Math.random()}`,
  payloadHash: "h".repeat(64),
  kind: "new",
  state: "requested",
  companyId: 7,
  leadRequestId: null,
  trialId: null,
  previousOrderId: null,
  request: { plan: "essential", interval: "month", items: [{ key: "net.crm" }, { key: "users", quantity: 3 }] } as NewOrder["request"],
  quote: null,
  contractId: null,
  subscriptionId: null,
  tenantId: "t7-ensayo",
  confirmation: null,
  graceEndsAt: null,
  attempts: 0,
  lastError: null,
  createdAt: T0,
  createdBy: actor,
  ...o,
});

const payment = (orderId: number, o: Partial<Omit<OrderPayment, "id">> = {}): Omit<OrderPayment, "id"> => ({
  orderId,
  idempotencyKey: `p-${Math.random()}`,
  purpose: "initial",
  periodStart: null,
  amountCents: 3509,
  currency: "EUR",
  status: "pending",
  provider: "simulated",
  mode: "test",
  providerRef: null,
  dueAt: T0,
  createdAt: T0,
  settledAt: null,
  ...o,
});

describe("datos de los eventos", () => {
  it("sin datos personales ni texto libre: solo códigos, números e identificadores", () => {
    const d = cleanData({
      email: "ana@empresa.example",
      contactName: "Ana",
      reason: "El cliente pidió la baja por teléfono",
      code: "coverage_lost",
      subscriptionId: 12,
      amountCents: 3509,
      invoice: "in_1AbC",
      nested: { taxId: "B123", plan: "essential", note: "texto con espacios" },
      list: ["net.crm", "correo@x.example"],
      fn: () => 1,
    });
    expect(d).toEqual({ code: "coverage_lost", subscriptionId: 12, amountCents: 3509, invoice: "in_1AbC", nested: { plan: "essential" }, list: ["net.crm"] });
  });
});

describe("pedidos y pagos", () => {
  it("alta y cada cambio de estado producen un evento con su transición y versión; las notas no", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryOrderStore(log);
    const { order } = await store.insert(newOrder());
    const q = await store.transition(order.id, 1, { state: "quoted" }, { kind: "quote", detail: { firstPeriodCents: 3509, currency: "EUR" }, actor, at: T0 + 1 });
    await store.transition(q.id, q.version, { contractId: 3 }, { kind: "contract_drafted", detail: { contractId: 3, reference: "CT-2026-000003" }, actor, at: T0 + 2 });
    const ev = await log.list({ orderId: order.id });
    expect(ev.map((e) => [e.type, e.fromState, e.toState, e.aggregate.version])).toEqual([
      ["order.created", null, "requested", 1],
      ["order.quoted", "requested", "quoted", 2],
    ]);
    expect(ev[0]).toMatchObject({ correlationId: `order:${order.id}`, companyId: 7, tenantId: "t7-ensayo", source: "operator", environment: "test", schemaVersion: 1 });
    expect(ev[0].data).toMatchObject({ kind: "new", plan: "essential", interval: "month", items: ["net.crm", "usersx3"] });
    expect(ev[1].data).toEqual({ kind: "new", firstPeriodCents: 3509, currency: "EUR" });
  });

  it("la misma alta repetida o un cambio con versión antigua no dejan eventos", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryOrderStore(log);
    const n = newOrder();
    const { order } = await store.insert(n);
    expect((await store.insert(n)).created).toBe(false);
    await store.transition(order.id, 1, { state: "quoted" }, { kind: "quote", detail: null, actor, at: T0 });
    await expect(store.transition(order.id, 1, { state: "quoted" }, { kind: "quote", detail: null, actor, at: T0 })).rejects.toThrow(/cambió/);
    expect((await log.list({ orderId: order.id })).map((e) => e.type)).toEqual(["order.created", "order.quoted"]);
  });

  it("pago: solicitado, cobrado una sola vez aunque el evento del proveedor llegue dos veces; la renovación es otro tipo", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryOrderStore(log);
    const { order } = await store.insert(newOrder());
    const { payment: p } = await store.insertPayment(payment(order.id));
    const apply = () => store.paymentEvent({ providerEventId: "evt_1", type: "payment.succeeded", paymentKey: p.idempotencyKey, receivedAt: T0 + 5 }, () => ({ status: "succeeded", outcome: "applied", result: null }));
    expect((await apply()).duplicate).toBe(false);
    expect((await apply()).duplicate).toBe(true);
    // Un evento distinto que no cambia el estado tampoco registra nada
    await store.paymentEvent({ providerEventId: "evt_2", type: "payment.succeeded", paymentKey: p.idempotencyKey, receivedAt: T0 + 6 }, () => ({ outcome: "ignored", result: null }));
    const r = (await store.insertPayment(payment(order.id, { purpose: "renewal", status: "succeeded", provider: "stripe_test", providerRef: "stripe:inv:in_1Renov", idempotencyKey: "stripe:inv:in_1Renov", settledAt: T0 }))).payment;
    const ev = await log.list({ orderId: order.id, types: ["payment.requested", "payment.succeeded", "renewal.paid"] });
    expect(ev.map((e) => [e.type, e.paymentId, e.fromState, e.toState])).toEqual([
      ["payment.requested", p.id, null, "pending"],
      ["payment.succeeded", p.id, "pending", "succeeded"],
      ["renewal.paid", r.id, null, "succeeded"],
    ]);
    expect(ev[2]).toMatchObject({ stripeRef: "inv:in_1Renov", data: { purpose: "renewal", amountCents: 3509, currency: "EUR", provider: "stripe_test", mode: "test" } });
  });

  it("impago, suspensión, recuperación y cancelación del pedido", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryOrderStore(log);
    let { order: o } = await store.insert(newOrder({ state: "active", subscriptionId: 4 }));
    const step = async (kind: string, state: NewOrder["state"], detail: Record<string, unknown> | null = null) => (o = await store.transition(o.id, o.version, { state }, { kind, detail, actor: "system:stripe", at: T0 }));
    await step("payment_failed", "past_due", { source: "stripe", graceEndsAt: T0 + 7 * 86_400_000 });
    await step("suspend", "suspended", { source: "stripe", reason: "Stripe agotó los reintentos de cobro" });
    await step("payment_recovered", "active", { source: "stripe" });
    await step("cancel", "cancel_scheduled", { source: "stripe", cancelAt: T0 + 30 * 86_400_000 });
    await step("cancelled", "cancelled", { source: "stripe", licencesReadOnly: 12 });
    const ev = await log.list({ orderId: o.id });
    expect(ev.slice(1).map((e) => e.type)).toEqual(["order.past_due", "order.suspended", "order.recovered", "order.cancel_scheduled", "order.cancelled"]);
    expect(ev.every((e) => e.source === "stripe" || e.type === "order.created")).toBe(true);
    // El motivo escrito en frase no se guarda; el código sí
    expect(ev[2].data).toEqual({ kind: "new", source: "stripe" });
    expect(ev[1].data).toMatchObject({ graceEndsAt: T0 + 7 * 86_400_000 });
  });
});

describe("origen, causa y entorno", () => {
  it("con causa de Stripe, el evento la lleva; sin ella, el origen sale del actor", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryOrderStore(log);
    const { order } = await withCommercialCause({ source: "stripe", causationId: "stripe:evt_1Abc" }, () => store.insert(newOrder({ createdBy: "system:stripe" })));
    expect((await log.list({ orderId: order.id }))[0]).toMatchObject({ source: "stripe", causationId: "stripe:evt_1Abc" });
    expect(sourceOfActor("web:self-service")).toBe("customer");
    expect(sourceOfActor("system:trial-scheduler")).toBe("system");
    expect(sourceOfActor("system:stripe")).toBe("stripe");
    expect(sourceOfActor("jorge@example.com")).toBe("operator");
  });

  it("cada registro solo lee su entorno; el mismo hecho dos veces se cuenta como duplicado", async () => {
    const live = new MemoryCommercialEventLog("live");
    const d: CommercialEventDraft = {
      key: "order:1:v1:created",
      type: "order.created",
      aggregate: { type: "order", id: "1", version: 1 },
      correlationId: "order:1",
      tenantId: null,
      companyId: 1,
      orderId: 1,
      subscriptionId: null,
      trialId: null,
      paymentId: null,
      stripeRef: null,
      fromState: null,
      toState: "requested",
      actor,
      occurredAt: T0,
      data: {},
    };
    expect(await live.append(null, [d, d])).toEqual({ written: 1, duplicates: 1 });
    expect((await live.list({ orderId: 1 }))[0].environment).toBe("live");
  });
});

describe("pruebas, suscripciones y cargos de Stripe", () => {
  it("prueba: alta, arranque y conversión; un reenvío del enlace no es un hecho comercial", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryTrialStore(log);
    let t = await store.insert(
      {
        email: "olga@abeto.example", emailDomain: "abeto.example", companyName: "Abeto SL", configuration: { plan: "essential", addons: [] }, state: "pending_verification",
        verificationTokenHash: "x", verificationExpiresAt: T0 + 1, verifiedAt: null, tenantId: null, startsAt: null, endsAt: null, extensionsUsed: 0, extensionRequestedAt: null,
        extensionReason: null, suspendedReason: null, convertedSubscriptionId: null, idempotencyKey: "trial-1", ipHash: "abc", createdAt: T0,
      },
      "web",
    );
    t = await store.transition(t.id, t.version, {}, { action: "resend_verification", fromState: "pending_verification", detail: null, actor: "web", at: T0 });
    t = await store.transition(t.id, t.version, { state: "verified" }, { action: "verify", fromState: "pending_verification", detail: null, actor: "web", at: T0 });
    t = await store.transition(t.id, t.version, { state: "provisioning" }, { action: "request_provisioning", fromState: "verified", detail: null, actor: "system:trial", at: T0 });
    t = await store.transition(t.id, t.version, { state: "active", tenantId: "t1-abeto", startsAt: T0, endsAt: T0 + 15 * 86_400_000 }, { action: "provisioned", fromState: "provisioning", detail: null, actor: "system:trial", at: T0 });
    await store.transition(t.id, t.version, { state: "converted", convertedSubscriptionId: 9 }, { action: "convert", fromState: "active", detail: null, actor, at: T0 });
    const ev = await log.list({ trialId: t.id });
    expect(ev.map((e) => e.type)).toEqual(["trial.requested", "trial.verified", "trial.started", "trial.converted"]);
    expect(ev[0].source).toBe("customer");
    expect(ev[2]).toMatchObject({ tenantId: "t1-abeto", data: { plan: "essential", endsAt: T0 + 15 * 86_400_000 } });
    expect(ev[3]).toMatchObject({ subscriptionId: 9, fromState: "active", toState: "converted" });
    expect(JSON.stringify(ev)).not.toMatch(/abeto\.example|Abeto SL|olga/);
  });

  it("suscripción: alta y módulo añadido con la versión de la suscripción", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemorySubscriptionStore(log);
    const s = await store.create(
      {
        companyId: 7, contractId: null, tenantId: "t7-ensayo", status: "active", mode: "shadow", currency: "EUR", interval: "month", pendingInterval: null, startedAt: T0, anchorDay: 19,
        currentPeriodStart: T0, currentPeriodEnd: T0 + 30 * 86_400_000, trialEnd: null, cancelAt: null, canceledAt: null, createdAt: T0, createdBy: actor,
      },
      [],
      { kind: "created", before: null, after: { plan: "essential", addons: [], interval: "month", currency: "EUR" }, reason: null },
    );
    await store.mutate(s.id, s.version, actor, T0 + 1, async () => ({
      patch: {},
      event: { kind: "item_added", before: null, after: { item: "net.crm", family: "addon", priceId: 41, unitAmountCents: 1500, effectiveFrom: T0 + 1 }, reason: "Lo pidió Ana por teléfono" },
      result: null,
    }));
    const ev = await log.list({ subscriptionId: s.id });
    expect(ev.map((e) => [e.type, e.aggregate.version])).toEqual([
      ["subscription.created", 1],
      ["subscription.module_added", 2],
    ]);
    expect(ev[1].data).toEqual({ interval: "month", before: null, after: { item: "net.crm", family: "addon", priceId: 41, unitAmountCents: 1500, effectiveFrom: T0 + 1 } });
  });

  it("cargo de Stripe: reembolso parcial, total con pérdida de cobertura, disputa y recuperación; releer lo mismo no repite nada", async () => {
    const log = new MemoryCommercialEventLog();
    const store = new MemoryStripeStore("test", log);
    const base = { chargeId: "ch_1Abc", invoiceId: "in_1Abc", subscriptionId: "sub_1Abc", orderId: 5, companyId: 7, amountCents: 3509, currency: "eur", disputeStatus: null as string | null, coverageLost: false };
    await store.upsertAdjustment({ ...base, amountRefundedCents: 1000 }, T0);
    await store.upsertAdjustment({ ...base, amountRefundedCents: 1000 }, T0 + 1);
    await store.upsertAdjustment({ ...base, amountRefundedCents: 3509, coverageLost: true }, T0 + 2);
    await store.upsertAdjustment({ ...base, amountRefundedCents: 3509, disputeStatus: "won", coverageLost: false }, T0 + 3);
    const ev = await log.list({ orderId: 5 });
    expect(ev.map((e) => e.type)).toEqual(["refund.recorded", "refund.recorded", "coverage.lost", "coverage.restored", "dispute.status_changed"]);
    expect(ev[0].data).toMatchObject({ amountRefundedCents: 1000, deltaCents: 1000, full: false });
    expect(ev[1].data).toMatchObject({ amountRefundedCents: 3509, deltaCents: 2509, full: true });
    expect(ev.every((e) => e.stripeRef === "ch_1Abc" && e.correlationId === "order:5")).toBe(true);
  });
});
