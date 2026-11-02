/** Traza de extremo a extremo de las altas de pago: pasos, umbrales, compra de módulo, alerta idempotente y datos sensibles. */
import { describe, expect, it } from "vitest";
import type { CapabilityGrant } from "./_core/capabilities/model";
import { alertById } from "./adminAlerts/catalog";
import { AdminAlertService, type AlertMailer } from "./adminAlerts/service";
import { MemoryAdminAlertStore } from "./adminAlerts/store";
import {
  SALE_TRACE_ALERT,
  SaleTraceService,
  SaleTraceWatcher,
  duePhase,
  sanitize,
  type SaleTraceReader,
  type TraceChange,
  type TraceFiscalDocument,
  type TraceMail,
  type TraceOwnInvoice,
  type TraceSession,
  type TraceStripeEvent,
  type TraceStripeInvoice,
  type TraceStripeSubscription,
} from "./commerce/saleTrace";
import { MemorySettingsStore } from "./crm/leadNotices";
import { MemoryOrderStore, type NewOrder } from "./orchestrator/store";
import type { CommercialOrder, OrderState } from "./orchestrator/types";
import type { MailCategory, MailContent } from "./mail/types";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 10, 2, 10);
const s = (ms: number) => Math.floor(ms / 1000);
const INV = "in_1PagoAltaABCDEFGH";
const SES = "cs_live_SesionAlta12345678";
const SUB = "sub_1SuscripcionXYZ98765";
const TENANT = "t5-acme";
const CAPS = ["core.bookings", "people.staff"];

class FakeReader implements SaleTraceReader {
  sessionRows: TraceSession[] = [];
  changeRow: TraceChange | null = null;
  subs: TraceStripeSubscription[] = [];
  events: TraceStripeEvent[] = [];
  invoices: TraceStripeInvoice[] = [];
  fiscal: TraceFiscalDocument[] = [];
  own: TraceOwnInvoice[] = [];
  mailRows: TraceMail[] = [];
  sales: Array<{ orderId: number; paidAt: number; mode: "test" | "live" }> = [];
  async sessions() {
    return this.sessionRows;
  }
  async change() {
    return this.changeRow;
  }
  async stripeSubscriptions(orderId: number, ids: string[]) {
    return this.subs.filter((x) => x.orderId === orderId || ids.includes(x.id));
  }
  async stripeEvents(ids: string[]) {
    return this.events.filter((e) => e.objectId !== null && ids.includes(e.objectId));
  }
  async stripeInvoices() {
    return this.invoices;
  }
  async fiscalDocuments() {
    return this.fiscal;
  }
  async ownInvoices() {
    return this.own;
  }
  async mails(_t: string | null, keys: string[]) {
    return this.mailRows.filter((m) => keys.includes(m.key));
  }
  async recentSales(since: number, mode: "test" | "live") {
    return this.sales.filter((x) => x.paidAt >= since && x.mode === mode);
  }
}

const ev = (type: string, objectId: string, at: number, o: Partial<TraceStripeEvent> = {}): TraceStripeEvent => ({
  id: `evt_${type}_${objectId}`,
  type,
  objectId,
  status: "processed",
  attempts: 1,
  lastError: null,
  source: "webhook",
  stripeCreated: s(at),
  receivedAt: at + 2000,
  processedAt: at + 5000,
  nextAttemptAt: null,
  ...o,
});
const grant = (capabilityId: string, source = "subscription:12", status: CapabilityGrant["status"] = "active"): CapabilityGrant => ({ tenantId: TENANT, capabilityId, siteId: "", status, validUntil: null, source, updatedAt: T0, updatedBy: "system" });

function baseOrder(o: Partial<NewOrder> = {}): NewOrder {
  return {
    idempotencyKey: `k-${Math.random()}`,
    payloadHash: "h",
    kind: "trial_conversion",
    state: "contracted",
    companyId: 7,
    leadRequestId: null,
    trialId: 5,
    previousOrderId: null,
    request: { plan: "essential", interval: "month", items: [] } as never,
    quote: { catalogVersion: "v1", currency: "EUR", contractAmountCents: 10000, firstPeriodCents: 12100, capabilities: CAPS, blocking: [], onRequest: [], contractable: "yes" },
    contractId: 3,
    subscriptionId: 12,
    tenantId: TENANT,
    confirmation: null,
    graceEndsAt: null,
    attempts: 0,
    lastError: null,
    createdAt: T0 - H,
    createdBy: "customer:panel",
    ...o,
  };
}

interface World {
  orders: MemoryOrderStore;
  reader: FakeReader;
  grants: CapabilityGrant[];
  trial: { id: number; state: string; tenantId: string | null; convertedSubscriptionId: number | null; updatedAt: number | null } | null;
  companyTenant: string | null;
  now: number;
  svc: SaleTraceService;
}
function world(): World {
  const w = { orders: new MemoryOrderStore(), reader: new FakeReader(), grants: [] as CapabilityGrant[], trial: null, companyTenant: TENANT, now: T0 } as unknown as World;
  w.svc = new SaleTraceService({
    orders: w.orders,
    reader: w.reader,
    mode: "live",
    capabilities: { list: async () => w.grants },
    subscriptions: { get: async (id) => ({ id, status: "active", tenantId: TENANT }) },
    trials: { get: async () => w.trial },
    companyTenant: async () => w.companyTenant,
    tenantName: async (id) => (id === TENANT ? "Acme Hoteles, S.L." : id === "t6-demo" ? "Empresa Demo" : "Nueva Empresa, S.L."),
    now: () => w.now,
  });
  return w;
}

async function move(w: World, order: CommercialOrder, path: Array<[string, OrderState, number]>) {
  let cur = order;
  for (const [kind, state, at] of path) cur = await w.orders.transition(cur.id, cur.version, { state }, { kind, detail: null, actor: "system:stripe", at });
  return cur;
}

async function pay(w: World, orderId: number, o: { purpose?: "initial" | "change"; invoice?: string; at?: number } = {}) {
  return (
    await w.orders.insertPayment({ orderId, idempotencyKey: `stripe:inv:${o.invoice ?? INV}`, purpose: o.purpose ?? "initial", periodStart: T0, amountCents: 12100, currency: "EUR", status: "succeeded", provider: "stripe", mode: "live", providerRef: o.invoice ?? INV, dueAt: null, createdAt: o.at ?? T0 + MIN, settledAt: o.at ?? T0 + MIN })
  ).payment;
}

/** Conversión de prueba completa: Checkout → pago → webhook → activa → licencias → factura. */
async function happyConversion(w: World) {
  const { order } = await w.orders.insert(baseOrder());
  const p = await pay(w, order.id);
  const active = await move(w, order, [
    ["confirm", "confirmed", T0 + MIN],
    ["subscribe", "subscribed", T0 + MIN],
    ["license", "licensed", T0 + 2 * MIN],
    ["activate", "active", T0 + 2 * MIN],
  ]);
  w.reader.sessionRows = [{ id: SES, status: "complete", paymentStatus: "paid", createdAt: T0 - 5 * MIN, completedAt: T0 + 30_000 }];
  w.reader.subs = [{ id: SUB, status: "active", orderId: order.id, companyId: 7, tenantId: TENANT, syncedAt: T0 + MIN }];
  w.reader.events = [ev("checkout.session.completed", SES, T0 + 20_000), ev("invoice.paid", INV, T0 + 25_000), ev("customer.subscription.updated", SUB, T0 + 26_000)];
  w.reader.invoices = [{ id: INV, status: "paid", purpose: "initial", totalCents: 12100, currency: "EUR", createdAt: T0 + MIN }];
  w.reader.own = [{ id: 3, status: "issued", number: "EB-2026-00001", paymentRef: `stripe:in:${INV}`, billingRef: `order:${order.id}`, issuedAt: T0 + 3 * H }];
  w.reader.mailRows = [
    { key: `order:${order.id}:invoice_available:p${p.id}`, status: "delivered", createdAt: T0 + 2 * MIN },
    { key: "invoicing:invoice:3:EB-2026-00001", status: "delivered", createdAt: T0 + 3 * H },
  ];
  w.reader.sales = [{ orderId: order.id, paidAt: T0 + 25_000, mode: "live" }];
  w.grants = CAPS.map((c) => grant(c));
  w.trial = { id: 5, state: "converted", tenantId: TENANT, convertedSubscriptionId: 12, updatedAt: T0 + 2 * MIN };
  return { order: active, payment: p };
}

const step = (t: { steps: Array<{ id: string; status: string; detail: string }> }, id: string) => t.steps.find((x) => x.id === id)!;

describe("traza de un alta de pago", () => {
  it("conversión de prueba completa: los seis pasos correctos, sin incidencias", async () => {
    const w = world();
    const { order } = await happyConversion(w);
    w.now = T0 + 4 * H;
    const t = (await w.svc.trace(order.id))!;
    expect(t.steps.map((x) => [x.id, x.status])).toEqual([
      ["payment", "ok"],
      ["webhook", "ok"],
      ["subscription", "ok"],
      ["licences", "ok"],
      ["data", "ok"],
      ["invoice", "ok"],
    ]);
    expect(t.status).toBe("ok");
    expect(t.incidents).toEqual([]);
    // El pago en Stripe: el primer evento del cobro (Checkout completado)
    expect(t.paidAt).toBe(T0 + 20_000);
    expect(step(t, "invoice").detail).toContain("EB-2026-00001");
    expect(step(t, "invoice").detail).toContain("envío: enviado");
    expect(step(t, "data").detail).toContain("misma empresa y misma plataforma");
    expect(step(t, "licences").detail).toContain("2 de 2");
  });

  it("nunca incluye datos de tarjeta ni ids completos de Stripe", async () => {
    const w = world();
    const { order } = await happyConversion(w);
    w.reader.events.push(ev("invoice.payment_failed", INV, T0, { status: "failed", nextAttemptAt: null, lastError: `Tarjeta 4242 4242 4242 4242 rechazada en ${INV} pm_1TarjetaSecreta99` }));
    w.now = T0 + 4 * H;
    const json = JSON.stringify(await w.svc.trace(order.id));
    for (const id of [INV, SES, SUB, "pm_1TarjetaSecreta99"]) expect(json).not.toContain(id);
    expect(json).not.toMatch(/4242[ -]?4242/);
    expect(json).toContain("[oculto]");
    expect(sanitize("ch_3AbCdEfGhIjK y 4000056655665556")).toBe("ch_…hIjK y [oculto]");
  });

  it("webhook fallido sin más reintentos: fallo con el error y los intentos; el cobro no consta", async () => {
    const w = world();
    const { order } = await w.orders.insert(baseOrder());
    await move(w, order, [["sign", "contracted", T0]]);
    w.reader.sessionRows = [{ id: SES, status: "complete", paymentStatus: "paid", createdAt: T0 - 5 * MIN, completedAt: T0 }];
    w.reader.events = [ev("checkout.session.completed", SES, T0, { status: "failed", attempts: 8, lastError: "Alta pendiente: aprovisionamiento", processedAt: null, nextAttemptAt: null })];
    w.trial = { id: 5, state: "active", tenantId: TENANT, convertedSubscriptionId: null, updatedAt: T0 };
    w.now = T0 + 30 * MIN;
    const t = (await w.svc.trace(order.id))!;
    expect(step(t, "webhook").status).toBe("failed");
    expect(step(t, "webhook").detail).toContain("Alta pendiente: aprovisionamiento");
    expect(step(t, "webhook").detail).toContain("8 intentos");
    expect(step(t, "payment").status).toBe("pending");
    expect(t.status).toBe("failed");
    expect(t.incidents.join(" ")).toMatch(/Webhook: 1 eventos de Stripe fallidos/);
    expect(t.incidents.join(" ")).toMatch(/Checkout completado hace 30 min/);
  });

  it("webhook en reintento: pendiente en plazo; incidencia pasados 10 minutos", async () => {
    const w = world();
    const { order } = await w.orders.insert(baseOrder());
    await pay(w, order.id, { at: T0 });
    w.reader.events = [ev("invoice.paid", INV, T0, { status: "failed", nextAttemptAt: T0 + 5 * MIN, processedAt: null, lastError: "timeout" })];
    w.now = T0 + 5 * MIN;
    let t = (await w.svc.trace(order.id))!;
    expect(step(t, "webhook").status).toBe("pending");
    expect(t.incidents.filter((x) => x.startsWith("Webhook"))).toEqual([]);
    w.now = T0 + 11 * MIN;
    t = (await w.svc.trace(order.id))!;
    expect(t.incidents.some((x) => x.startsWith("Webhook: eventos sin procesar"))).toBe(true);
  });

  it("licencia no aplicada: falta una capacidad tras licenciar → fallo; sin licenciar a los 15 min → incidencia", async () => {
    const w = world();
    const { order } = await happyConversion(w);
    w.grants = [grant(CAPS[0])];
    w.now = T0 + H;
    let t = (await w.svc.trace(order.id))!;
    expect(step(t, "licences").status).toBe("failed");
    expect(step(t, "licences").detail).toContain("faltan: people.staff");
    expect(t.incidents.some((x) => x.includes("faltan 1 capacidades"))).toBe(true);

    const w2 = world();
    const { order: o2 } = await w2.orders.insert(baseOrder());
    await pay(w2, o2.id, { at: T0 });
    await move(w2, o2, [["confirm", "confirmed", T0], ["subscribe", "subscribed", T0]]);
    w2.trial = { id: 5, state: "active", tenantId: TENANT, convertedSubscriptionId: null, updatedAt: T0 };
    w2.now = T0 + 10 * MIN;
    t = (await w2.svc.trace(o2.id))!;
    expect(step(t, "licences").status).toBe("pending");
    expect(step(t, "subscription").status).toBe("pending");
    w2.now = T0 + 16 * MIN;
    t = (await w2.svc.trace(o2.id))!;
    expect(step(t, "licences").status).toBe("failed");
    expect(step(t, "subscription").status).toBe("failed");
    expect(t.incidents.some((x) => x.startsWith("Licencias: sin aplicar 16 min"))).toBe(true);
  });

  it("factura: pendiente dentro de las 48 h (documento en cola) y fallo fuera de plazo", async () => {
    const w = world();
    const { order } = await happyConversion(w);
    w.reader.own = [];
    w.reader.fiscal = [{ id: 9, kind: "invoice", stripeInvoiceId: INV, status: "pending", externalRef: null, issuedAt: null, lastError: null, createdAt: T0 + MIN }];
    w.now = T0 + 2 * H;
    let t = (await w.svc.trace(order.id))!;
    expect(step(t, "invoice").status).toBe("pending");
    expect(step(t, "invoice").detail).toContain("Dentro del plazo (48 h tras el cobro)");
    expect(step(t, "invoice").detail).toContain("documento fiscal #9 en cola");
    expect(step(t, "invoice").detail).toContain("sin proforma");
    expect(t.status).toBe("in_progress");
    expect(t.incidents).toEqual([]);
    w.now = T0 + 49 * H;
    t = (await w.svc.trace(order.id))!;
    expect(step(t, "invoice").status).toBe("failed");
    expect(t.incidents).toEqual(["Factura sin emitir 49 h después del cobro (plazo 48 h)"]);
    // Emitido por el sistema de facturación legal: correcto
    w.reader.fiscal[0] = { ...w.reader.fiscal[0], status: "issued", externalRef: "EB-2026-00007", issuedAt: T0 + 50 * H };
    t = (await w.svc.trace(order.id))!;
    expect(step(t, "invoice").status).toBe("ok");
    expect(step(t, "invoice").detail).toContain("EB-2026-00007");
  });

  it("compra de módulo: mismo tenant, cambio de partidas cobrado y licencias del módulo", async () => {
    const w = world();
    const { order: prev } = await w.orders.insert(baseOrder({ kind: "new", trialId: null, state: "active", quote: { ...baseOrder().quote!, capabilities: [CAPS[0]] } }));
    const { order } = await w.orders.insert(baseOrder({ kind: "change", trialId: null, previousOrderId: prev.id, state: "contracted" }));
    await pay(w, order.id, { purpose: "change", invoice: "in_1ProrrateoPeople0001", at: T0 });
    await move(w, order, [["confirm", "confirmed", T0], ["subscribe", "subscribed", T0], ["license", "licensed", T0 + MIN], ["activate", "active", T0 + MIN]]);
    w.reader.changeRow = { stripeSubscriptionId: SUB, status: "applied", stripeInvoiceId: "in_1ProrrateoPeople0001", detail: null, createdAt: T0 - MIN, updatedAt: T0 };
    w.reader.subs = [{ id: SUB, status: "active", orderId: prev.id, companyId: 7, tenantId: TENANT, syncedAt: T0 }];
    w.reader.events = [ev("invoice.paid", "in_1ProrrateoPeople0001", T0 - 10_000), ev("customer.subscription.updated", SUB, T0 - 9_000)];
    w.grants = CAPS.map((c) => grant(c));
    w.now = T0 + 30 * MIN;
    const t = (await w.svc.trace(order.id))!;
    expect(step(t, "payment").status).toBe("ok");
    expect(step(t, "payment").detail).toContain("prorrateo de la compra");
    expect(step(t, "payment").detail).toContain("cambio de partidas aplicado");
    expect(step(t, "webhook").status).toBe("ok");
    expect(step(t, "subscription").status).toBe("ok");
    expect(step(t, "subscription").detail).toContain("sub_…8765 active");
    expect(step(t, "licences").status).toBe("ok");
    expect(step(t, "data").status).toBe("ok");
    expect(step(t, "data").detail).toContain("Mismo tenant");
    expect(step(t, "invoice").status).toBe("pending");
  });

  it("conversión: el pedido activo sin la prueba convertida o con otra plataforma es un fallo", async () => {
    const w = world();
    const { order } = await happyConversion(w);
    w.now = T0 + H;
    w.trial = { id: 5, state: "active", tenantId: TENANT, convertedSubscriptionId: null, updatedAt: T0 };
    expect(step((await w.svc.trace(order.id))!, "data").status).toBe("failed");
    w.trial = { id: 5, state: "converted", tenantId: TENANT, convertedSubscriptionId: 12, updatedAt: T0 };
    w.companyTenant = "t9-otra-plataforma";
    const t = (await w.svc.trace(order.id))!;
    expect(step(t, "data").status).toBe("failed");
    expect(t.incidents.some((x) => x.includes("otra plataforma"))).toBe(true);
  });

  it("listado de altas recientes: solo el modo pedido y sin empresas internas de pruebas", async () => {
    const w = world();
    const { order } = await happyConversion(w);
    const { order: demo } = await w.orders.insert(baseOrder({ companyId: 8, tenantId: "t6-demo", trialId: null, kind: "new" }));
    w.reader.sales.push({ orderId: demo.id, paidAt: T0, mode: "live" }, { orderId: 99, paidAt: T0, mode: "test" });
    w.now = T0 + 4 * H;
    const list = await w.svc.recent(30);
    expect(list.map((x) => x.orderId)).toEqual([order.id]);
    expect(list[0]).toMatchObject({ status: "ok", incidents: [], kind: "trial_conversion" });
    expect(list[0].steps).toHaveLength(6);
  });
});

function fakeMailer() {
  const sent: Array<{ key: string; to: string; category: MailCategory; c: MailContent }> = [];
  const keys = new Set<string>();
  const m: AlertMailer = {
    policy: { mode: "sandbox" },
    send: async (_t, key, category, to, c) => {
      const duplicate = keys.has(key);
      if (!duplicate) (keys.add(key), sent.push({ key, to, category, c }));
      return { status: "pending", reason: null, duplicate, id: sent.length } as never;
    },
  };
  return { m, sent };
}

describe("alerta admin.sale_trace", () => {
  it("existe en el catálogo, conectada, en facturación", () => {
    expect(alertById(SALE_TRACE_ALERT)).toMatchObject({ n: 44, section: "facturacion", state: "conectada", severity: "info", locked: false });
  });

  it("fases: inmediata, a los 20 minutos y a las 48 horas", () => {
    expect(duePhase(T0, T0 - 1)).toBeNull();
    expect(duePhase(T0, T0)?.id).toBe("inicial");
    expect(duePhase(T0, T0 + 20 * MIN)?.id).toBe("revision");
    expect(duePhase(T0, T0 + 48 * H)?.id).toBe("factura");
  });

  it("idempotente por pedido y fase; nunca avisa de cobros anteriores a su activación; importante si hay incidencias", async () => {
    const w = world();
    const store = new MemoryAdminAlertStore();
    const { m, sent } = fakeMailer();
    const alerts = new AdminAlertService({ store, settings: new MemorySettingsStore(), mailer: m, crmUrl: "https://admin.bigelephant.example", environment: "production", now: () => w.now });
    const watcher = new SaleTraceWatcher({ traces: w.svc, store, raise: (id, f) => alerts.raise(id, f), companyName: async () => "Acme Hoteles, S.L.", now: () => w.now });
    const { order: old } = await happyConversion(w);
    // Primera pasada: fija el inicio en este instante; el cobro anterior no se avisa
    w.now = T0 + MIN;
    expect(await watcher.tick()).toBe(0);
    w.now = T0 + 2 * MIN;
    expect(await watcher.tick()).toBe(0);

    // Cobro nuevo después de la activación
    const { order } = await w.orders.insert(baseOrder({ companyId: 11, trialId: null, kind: "new", tenantId: "t11-nueva" }));
    await pay(w, order.id, { invoice: "in_1NuevaVenta000001", at: T0 + 3 * MIN });
    w.reader.sales = [{ orderId: old.id, paidAt: T0 + 25_000, mode: "live" }, { orderId: order.id, paidAt: T0 + 3 * MIN, mode: "live" }];
    w.now = T0 + 4 * MIN;
    expect(await watcher.tick()).toBe(1);
    expect(await watcher.tick()).toBe(0);
    const first = store.rows.filter((r) => r.alertId === SALE_TRACE_ALERT);
    expect(first.map((r) => r.eventKey)).toEqual([`sale-trace:${order.id}:inicial`]);
    expect(first[0].severity).toBe("info");
    expect(sent).toHaveLength(1);
    expect(sent[0].c.text).toContain(`GET /cp/v1/orders/${order.id}/trace`);
    expect(sent[0].c.text).not.toContain("in_1NuevaVenta000001");

    // A los 20 minutos: sigue sin activar (más de 15 min) → importante con incidencias
    w.now = T0 + 25 * MIN;
    expect(await watcher.tick()).toBe(1);
    expect(await watcher.tick()).toBe(0);
    const rev = store.rows.find((r) => r.eventKey === `sale-trace:${order.id}:revision`)!;
    expect(rev.severity).toBe("important");
    expect(rev.summary).toContain("incidencias");

    // A las 48 horas: fase de factura (una sola vez)
    w.now = T0 + 3 * MIN + 48 * H;
    expect(await watcher.tick()).toBe(1);
    expect(await watcher.tick()).toBe(0);
    expect(store.rows.filter((r) => r.alertId === SALE_TRACE_ALERT).map((r) => r.eventKey)).toEqual([`sale-trace:${order.id}:inicial`, `sale-trace:${order.id}:revision`, `sale-trace:${order.id}:factura`]);
  });

  it("detectado tarde: solo avisa de la fase más reciente", async () => {
    const w = world();
    const store = new MemoryAdminAlertStore();
    const raised: string[] = [];
    const watcher = new SaleTraceWatcher({ traces: w.svc, store, raise: async (_id, f) => void raised.push(f.key), now: () => w.now });
    w.now = T0 - H;
    await watcher.tick();
    const { order } = await happyConversion(w);
    w.now = T0 + H;
    expect(await watcher.tick()).toBe(1);
    expect(raised).toEqual([`sale-trace:${order.id}:revision`]);
  });
});
