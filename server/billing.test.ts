/**
 * Suscripciones y facturación SaaS: prueba de 15 días, renovación, gracia de 7 días,
 * suspensión reversible, cambios de plan, límites por plan, webhooks verificados e
 * idempotentes y conciliación. Sin cobros reales: proveedor simulado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionService } from "./_core/billing/service";
import { FakeProvider, MemoryBillingStore, RecordingEffects } from "./_core/billing/memory";
import { BillingError, DAY, type Catalog } from "./_core/billing/types";

const T0 = Date.UTC(2026, 9, 1, 10);

const catalog: Catalog = {
  trialDays: 15,
  graceDays: 7,
  trial: { maxCustomDomains: 0, integrations: ["email"], quotas: [{ metric: "email.sent", period: "day", limit: 50 }] },
  plans: [
    { id: "base", name: "Base", kind: "base", interval: "month", priceCents: 4900, currency: "EUR", includedModules: ["cms", "commerce"], maxCustomDomains: 1, quotas: [{ metric: "email.sent", period: "day", limit: 500 }] },
    { id: "pro", name: "Pro", kind: "base", interval: "month", priceCents: 9900, currency: "EUR", includedModules: ["cms", "commerce", "tpv"], maxCustomDomains: 3, quotas: [{ metric: "email.sent", period: "day", limit: 2000 }] },
    { id: "sin-precio", name: "Pendiente", kind: "base", interval: "month", priceCents: null, currency: "EUR", includedModules: [], maxCustomDomains: 0, quotas: [] },
  ],
  modules: [
    { moduleId: "hotel", interval: "month", priceCents: 1900, currency: "EUR" },
    { moduleId: "spa", interval: "month", priceCents: null, currency: "EUR" },
  ],
};

let now: number;
let store: MemoryBillingStore;
let provider: FakeProvider;
let fx: RecordingEffects;
let svc: SubscriptionService;
let seq = 0;
const notified: string[] = [];

beforeEach(() => {
  now = T0;
  seq = 0;
  notified.length = 0;
  store = new MemoryBillingStore();
  provider = new FakeProvider();
  fx = new RecordingEffects();
  svc = new SubscriptionService({
    catalog,
    store,
    provider,
    effects: fx,
    notifier: { notify: async (e, t) => void notified.push(`${e}:${t}`) },
    now: () => now,
    id: () => `id${++seq}`,
  });
});

describe("prueba gratuita", () => {
  it("15 días, subdominio/limitaciones y licencias hasta el fin de la prueba", async () => {
    const s = await svc.startTrial({ tenantId: "acme", planId: "base", modules: ["hotel"] });
    expect(s.status).toBe("trialing");
    expect(s.trialEnd).toBe(T0 + 15 * DAY);
    expect(fx.status.get("acme")).toBe("trial");
    expect(fx.modules.get("acme|cms")!.until!.getTime()).toBe(T0 + 15 * DAY);
    expect(fx.modules.has("acme|hotel")).toBe(true);
    expect(fx.quotas.get("acme|email.sent|day")).toBe(50);
    expect(await svc.canAddCustomDomain("acme", 0)).toBe(false); // sin dominios propios en prueba
    expect(await svc.isIntegrationAllowed("acme", "email")).toBe(true);
    expect(await svc.isIntegrationAllowed("acme", "whatsapp")).toBe(false);
  });

  it("no admite dos suscripciones ni planes inexistentes", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    await expect(svc.startTrial({ tenantId: "acme", planId: "base" })).rejects.toMatchObject({ code: "duplicate" });
    await expect(svc.startTrial({ tenantId: "otro", planId: "no-existe" })).rejects.toMatchObject({ code: "invalid_plan" });
  });

  it("al terminar la prueba sin contratar, se suspende (reversible) y se suspenden los módulos", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    now = T0 + 15 * DAY;
    const r = await svc.tick();
    expect(r.suspended).toBe(1);
    expect(fx.status.get("acme")).toBe("suspended");
    expect(fx.modules.get("acme|cms")!.status).toBe("suspended");
    expect(notified).toContain("suspended:acme");
  });
});

describe("contratación y renovación", () => {
  it("contratar cobra el primer periodo, activa y concede licencias del periodo", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "base", modules: ["hotel"] });
    const r = await svc.subscribe("acme", { customerId: "cus_1" });
    expect(r.paid).toBe(true);
    expect(r.invoice.amountCents).toBe(4900 + 1900);
    expect(r.invoice.number).toBe("SAAS-2026-000001");
    expect(r.subscription.status).toBe("active");
    expect(fx.status.get("acme")).toBe("active");
    expect(fx.quotas.get("acme|email.sent|day")).toBe(500);
    expect(provider.charges).toHaveLength(1);
  });

  it("sin tarifa definida no se factura (no se inventan precios)", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "sin-precio" });
    await expect(svc.subscribe("acme")).rejects.toMatchObject({ code: "no_price" });
    await svc.startTrial({ tenantId: "b", planId: "base", modules: ["spa"] });
    await expect(svc.subscribe("b")).rejects.toMatchObject({ code: "no_price" });
    expect(provider.charges).toHaveLength(0);
  });

  it("renueva al vencer el periodo y avanza fechas; facturas correlativas", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    await svc.subscribe("acme");
    now = (await store.getSubscriptionByTenant("acme"))!.currentPeriodEnd;
    const r = await svc.tick();
    expect(r.renewed).toBe(1);
    const invs = (await store.listInvoices("acme")).map((i) => i.number).sort();
    expect(invs).toEqual(["SAAS-2026-000001", "SAAS-2026-000002"]);
    expect((await store.getSubscriptionByTenant("acme"))!.status).toBe("active");
  });

  it("tick es idempotente: no vuelve a cobrar el mismo periodo", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    await svc.subscribe("acme");
    now = (await store.getSubscriptionByTenant("acme"))!.currentPeriodEnd;
    await svc.tick();
    const n = provider.charges.length;
    await svc.tick();
    expect(provider.charges.length).toBe(n);
  });
});

describe("impago: gracia de 7 días y suspensión reversible", () => {
  async function activeSub() {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    await svc.subscribe("acme");
    return (await store.getSubscriptionByTenant("acme"))!;
  }

  it("fallo de cobro → past_due con 7 días de gracia; luego suspendido", async () => {
    const sub = await activeSub();
    provider.declineAll = true;
    now = sub.currentPeriodEnd;
    expect((await svc.tick()).pastDue).toBe(1);
    const s1 = (await store.getSubscriptionByTenant("acme"))!;
    expect(s1.status).toBe("past_due");
    expect(s1.graceEnd).toBe(now + 7 * DAY);
    expect(fx.status.get("acme")).toBe("grace");
    expect(notified).toContain("payment_failed:acme");

    now += 7 * DAY;
    expect((await svc.tick()).suspended).toBe(1);
    expect(fx.status.get("acme")).toBe("suspended");
    expect(fx.modules.get("acme|cms")!.status).toBe("suspended");
  });

  it("un reintento exitoso durante la gracia reactiva", async () => {
    const sub = await activeSub();
    provider.declineAll = true;
    now = sub.currentPeriodEnd;
    await svc.tick();
    provider.declineAll = false;
    now += 2 * DAY;
    const r = await svc.tick();
    expect(r.renewed).toBe(1);
    expect((await store.getSubscriptionByTenant("acme"))!.status).toBe("active");
    expect(fx.status.get("acme")).toBe("active");
  });

  it("reactivar una suspensión cobra y devuelve el servicio", async () => {
    const sub = await activeSub();
    provider.declineAll = true;
    now = sub.currentPeriodEnd;
    await svc.tick();
    now += 8 * DAY;
    await svc.tick();
    expect(fx.status.get("acme")).toBe("suspended");
    provider.declineAll = false;
    const r = await svc.reactivate("acme");
    expect(r.paid).toBe(true);
    expect(fx.status.get("acme")).toBe("active");
    expect(fx.modules.get("acme|cms")!.status).toBe("active");
    expect(notified).toContain("reactivated:acme");
  });
});

describe("cambios de plan, módulos y cancelación", () => {
  async function active() {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    await svc.subscribe("acme");
    return (await store.getSubscriptionByTenant("acme"))!;
  }

  it("mejora inmediata cobra el prorrateo y amplía límites", async () => {
    const sub = await active();
    now = sub.currentPeriodStart + (sub.currentPeriodEnd - sub.currentPeriodStart) / 2;
    const before = provider.charges.length;
    const s = await svc.changePlan("acme", "pro", "now");
    expect(s.planId).toBe("pro");
    expect(provider.charges.length).toBe(before + 1);
    const last = provider.charges[provider.charges.length - 1];
    expect(last.amountCents).toBeGreaterThan(2000);
    expect(last.amountCents).toBeLessThan(3000); // ≈ mitad de 5000
    expect(fx.modules.has("acme|tpv")).toBe(true);
    expect(await svc.maxCustomDomains("acme")).toBe(3);
  });

  it("un cambio al fin de periodo se aplica en la renovación", async () => {
    const sub = await active();
    await svc.changePlan("acme", "pro", "period_end");
    expect((await store.getSubscriptionByTenant("acme"))!.planId).toBe("base");
    now = sub.currentPeriodEnd;
    await svc.tick();
    const s = (await store.getSubscriptionByTenant("acme"))!;
    expect(s.planId).toBe("pro");
    const invs = await store.listInvoices("acme");
    expect(invs.some((i) => i.amountCents === 9900)).toBe(true);
  });

  it("si el cobro del cambio se rechaza, el plan no cambia", async () => {
    await active();
    provider.declineAll = true;
    await expect(svc.changePlan("acme", "pro", "now")).rejects.toBeInstanceOf(BillingError);
    expect((await store.getSubscriptionByTenant("acme"))!.planId).toBe("base");
  });

  it("añadir un módulo cobra el prorrateo y lo licencia", async () => {
    await active();
    await svc.addModule("acme", "hotel");
    expect(fx.modules.has("acme|hotel")).toBe(true);
    await expect(svc.addModule("acme", "spa")).rejects.toMatchObject({ code: "no_price" });
  });

  it("cancelar al fin de periodo mantiene el servicio hasta entonces y luego archiva", async () => {
    const sub = await active();
    await svc.cancel("acme", { atPeriodEnd: true });
    expect((await store.getSubscriptionByTenant("acme"))!.status).toBe("active");
    now = sub.currentPeriodEnd;
    const r = await svc.tick();
    expect(r.ended).toBe(1);
    expect(fx.status.get("acme")).toBe("archived");
    expect(fx.modules.size).toBe(0);
    expect(provider.charges).toHaveLength(1); // no hay nuevo cobro
  });

  it("los dominios propios dependen del plan", async () => {
    await active();
    expect(await svc.canAddCustomDomain("acme", 0)).toBe(true);
    expect(await svc.canAddCustomDomain("acme", 1)).toBe(false);
  });
});

describe("webhooks y conciliación", () => {
  async function pastDueWithOpenInvoice() {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    await svc.subscribe("acme");
    provider.declineAll = true;
    now = (await store.getSubscriptionByTenant("acme"))!.currentPeriodEnd;
    await svc.tick();
    const inv = (await store.listInvoices("acme")).find((i) => i.status === "open")!;
    return inv;
  }

  it("rechaza webhooks con firma inválida", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", invoiceId: "x", chargeId: "c", at: now });
    await expect(svc.handleWebhook(body, "firma-falsa")).rejects.toMatchObject({ code: "invalid_signature" });
  });

  it("un pago confirmado por webhook reactiva; el mismo evento no se procesa dos veces", async () => {
    const inv = await pastDueWithOpenInvoice();
    const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", invoiceId: inv.id, chargeId: "ch_x", at: now });
    const sig = provider.sign(body);
    expect(await svc.handleWebhook(body, sig)).toEqual({ processed: true, duplicate: false });
    expect((await store.getSubscriptionByTenant("acme"))!.status).toBe("active");
    expect((await store.getInvoice(inv.id))!.status).toBe("paid");
    expect(await svc.handleWebhook(body, sig)).toEqual({ processed: false, duplicate: true });
  });

  it("conciliación: detecta importes distintos y cobros sin factura", async () => {
    await svc.startTrial({ tenantId: "acme", planId: "base" });
    const r = await svc.subscribe("acme");
    provider.charges.push({ chargeId: "ch_huerfano", invoiceId: "inv_inexistente", amountCents: 100, ok: true, key: "k" });
    provider.charges[0].amountCents = r.invoice.amountCents + 1;
    const rep = await svc.reconcile(0, now + DAY);
    expect(rep.unknownInvoice).toEqual(["ch_huerfano"]);
    expect(rep.amountMismatch).toEqual([r.invoice.id]);
  });
});
