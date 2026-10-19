/**
 * Orquestador comercial (unitarias): máquina de estados, proveedor de pagos de pruebas (firma,
 * tolerancia, solo pruebas, sin cobro automático), traslado de la configuración web, base de la
 * activación, recuperación tras un fallo, cambio a la baja sin importe y eventos simultáneos.
 * Memoria; datos sintéticos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { ORDER_TRANSITIONS, nextOrderState } from "./orchestrator/machine";
import { SignedTestProvider, PaymentSignatureError, testPaymentsFromEnv } from "./orchestrator/payments";
import { CommercialOrchestrator, requestFromWebConfiguration, type OrchestratorDeps } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import { ORDER_STATES, TERMINAL_STATES } from "./orchestrator/types";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { capabilitiesOfTier } from "./catalog/capabilities";

const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const key = () => crypto.randomBytes(12).toString("hex");

describe("máquina de estados del pedido", () => {
  it("el alta sigue el orden Solicitud → … → Activación, sin atajos", () => {
    const path = ["quote", "sign", "confirm", "subscribe", "license", "activate"] as const;
    let s: (typeof ORDER_STATES)[number] = "requested";
    for (const a of path) s = nextOrderState(s, a)!;
    expect(s).toBe("active");
    expect(nextOrderState("requested", "confirm")).toBeNull();
    expect(nextOrderState("quoted", "subscribe")).toBeNull();
    expect(nextOrderState("contracted", "license")).toBeNull();
    expect(nextOrderState("confirmed", "reject")).toBeNull(); // confirmado (pagado) ya no se abandona
  });
  it("los estados terminales no tienen salida", () => {
    for (const t of Array.from(TERMINAL_STATES)) for (const a of Object.keys(ORDER_TRANSITIONS)) expect(nextOrderState(t, a as keyof typeof ORDER_TRANSITIONS)).toBeNull();
  });
  it("impago: activo → gracia → suspendido → activo al pagar", () => {
    expect(nextOrderState("active", "payment_failed")).toBe("past_due");
    expect(nextOrderState("past_due", "suspend")).toBe("suspended");
    expect(nextOrderState("suspended", "payment_recovered")).toBe("active");
    expect(nextOrderState("active", "suspend")).toBeNull();
  });
});

describe("proveedor de pagos de PRUEBAS", () => {
  const p = new SignedTestProvider({ webhookSecret: SECRET });
  const now = Date.UTC(2026, 9, 16, 9);
  const body = (o: Record<string, unknown> = {}) => JSON.stringify({ id: "evt_1234", type: "payment.succeeded", paymentKey: "ord:1:initial:a1", providerRef: "sim_1", amountCents: 100, currency: "eur", livemode: false, ...o });

  it("firma y verifica; cualquier alteración, fuera de tolerancia o «livemode» se rechaza", () => {
    const b = body();
    expect(p.verify(b, p.sign(b, now / 1000), now)).toMatchObject({ id: "evt_1234", currency: "EUR", amountCents: 100 });
    expect(() => p.verify(b.replace("100", "101"), p.sign(b, now / 1000), now)).toThrow(PaymentSignatureError);
    expect(() => p.verify(b, p.sign(b, now / 1000 - 301), now)).toThrow(/tolerancia/);
    expect(() => p.verify(b, "", now)).toThrow(PaymentSignatureError);
    const live = body({ livemode: true });
    expect(() => p.verify(live, p.sign(live, now / 1000), now)).toThrow(/pruebas/);
    expect(() => new SignedTestProvider({ webhookSecret: SECRET.replace("pruebas", "live000") })).toThrow(/pruebas/);
    expect(() => new SignedTestProvider({ webhookSecret: "corto" })).toThrow();
  });
  it("el checkout no cobra: queda pendiente del evento firmado y es idempotente por clave", async () => {
    const a = await p.checkout({ key: "ord:9:initial:a1", amountCents: 500, currency: "EUR" });
    const b = await p.checkout({ key: "ord:9:initial:a1", amountCents: 500, currency: "EUR" });
    expect(a.providerRef).toBe(b.providerRef);
    expect(p.simulator.executed).toEqual([]);
    expect(p.autoCharge).toBe(false);
  });
  it("configuración: sin proveedor no hay pagos; el cobro automático y los proveedores reales no se admiten", () => {
    expect(testPaymentsFromEnv({}).provider).toBeNull();
    expect(() => testPaymentsFromEnv({ CP_PAYMENTS_AUTO_CHARGE: "true" })).toThrow(/no está autorizado/);
    expect(() => testPaymentsFromEnv({ CP_PAYMENTS_PROVIDER: "stripe" })).toThrow(/no está soportado/);
    expect(testPaymentsFromEnv({ CP_PAYMENTS_PROVIDER: "simulated" }).reason).toBe("missing_test_webhook_secret");
    expect(testPaymentsFromEnv({ CP_PAYMENTS_PROVIDER: "simulated", CP_PAYMENTS_TEST_WEBHOOK_SECRET: SECRET }).provider?.mode).toBe("test");
  });
  it("con CP_STRIPE_MODE=live los pagos simulados no se montan (no arranca); sin configurarlos, no hay pagos simulados", () => {
    expect(() => testPaymentsFromEnv({ CP_STRIPE_MODE: "live", CP_PAYMENTS_PROVIDER: "simulated", CP_PAYMENTS_TEST_WEBHOOK_SECRET: SECRET })).toThrow(/CP_STRIPE_MODE=live/);
    expect(() => testPaymentsFromEnv({ CP_STRIPE_MODE: "live", CP_PAYMENTS_TEST_WEBHOOK_SECRET: SECRET })).toThrow(/CP_STRIPE_MODE=live/);
    expect(testPaymentsFromEnv({ CP_STRIPE_MODE: "live" })).toEqual({ provider: null, reason: "payments_live_stripe_only" });
    expect(testPaymentsFromEnv({ CP_STRIPE_MODE: "test", CP_PAYMENTS_PROVIDER: "simulated", CP_PAYMENTS_TEST_WEBHOOK_SECRET: SECRET }).provider?.mode).toBe("test");
  });
});

describe("configuración del formulario web → petición del cotizador", () => {
  it("plan, extensiones y sectoriales; los intereses (hoja de ruta) no se contratan", () => {
    expect(requestFromWebConfiguration({ plan: "business", extensions: ["connect-voice"], industries: ["hotel-net-complete", "connect-voice"], interests: ["ski-net-school"] }, "year")).toEqual({
      plan: "business",
      interval: "year",
      items: [{ key: "connect-voice" }, { key: "hotel-net-complete" }],
    });
    expect(() => requestFromWebConfiguration({ plan: null, extensions: [], industries: [], interests: [] }, "month")).toThrow(/plan/);
  });
});

describe("orquestador en memoria", () => {
  let clock: number;
  let failPlatform: number;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let crmStore: MemoryCrmStore;
  let subsStore: MemorySubscriptionStore;
  let caps: MemoryCapabilityStore;
  let orders: MemoryOrderStore;
  let provider: SignedTestProvider;
  let deps: OrchestratorDeps;
  const actor = "operator:test";

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 16, 9);
    failPlatform = 0;
    crmStore = new MemoryCrmStore();
    subsStore = new MemorySubscriptionStore();
    caps = new MemoryCapabilityStore();
    orders = new MemoryOrderStore();
    provider = new SignedTestProvider({ webhookSecret: SECRET });
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    const platform = {
      activate: async ({ company }: { company: { id: number; name: string; tenantId: string | null } }) => {
        if (failPlatform > 0) {
          failPlatform--;
          throw new Error("servidor de BD no disponible");
        }
        return { tenantId: company.tenantId ?? `t-${company.id}` };
      },
    };
    crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now: () => clock });
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    const subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    deps = {
      store: orders,
      crm,
      crmStore,
      subscriptions: subs,
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog,
      quote: async (r) => quote(await site(), r),
      licensing: new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => clock }),
      capabilities: caps,
      platform,
      payments: provider,
      now: () => clock,
    };
    svc = new CommercialOrchestrator(deps);
  });

  it("modo de cobro: pruebas por defecto; en live no se monta con pagos simulados y paymentsConfig informa del modo real", () => {
    expect(svc.paymentsConfig).toMatchObject({ enabled: true, provider: "simulated", mode: "test", stripeProvider: "stripe_test", autoCharge: false });
    expect(() => new CommercialOrchestrator({ ...deps, mode: "live" })).toThrow(/modo live/);
    const live = new CommercialOrchestrator({ ...deps, payments: null, mode: "live" });
    expect(live.paymentsConfig).toMatchObject({ enabled: false, provider: null, mode: "live", stripeProvider: "stripe", autoCharge: false });
    expect(() => new CommercialOrchestrator({ ...deps, mode: "otro" as never })).toThrow();
  });

  it("en live solo cuenta un pago cobrado de modo live y proveedor stripe: los de pruebas o de otro proveedor no confirman ni se recuperan", async () => {
    const live = new CommercialOrchestrator({ ...deps, payments: null, mode: "live" });
    const cid = await company("Live Modo SL");
    const o = (await live.create({ idempotencyKey: key(), companyId: cid, request: { plan: "business", interval: "month", items: [] } }, actor)).order;
    await live.accept(o.id, { signatureRef: "firma-live", approvalReason: "Aprobado por producto" }, actor);
    const pay = (k: string, provider: string, mode: "test" | "live") =>
      orders.insertPayment({ orderId: o.id, idempotencyKey: k, purpose: "initial", periodStart: null, amountCents: 100, currency: "EUR", status: "succeeded", provider, mode, providerRef: k, dueAt: null, createdAt: clock, settledAt: clock });
    await pay("k-test-sim", "simulated", "test");
    await pay("k-test-stripe", "stripe_test", "test");
    await pay("k-live-otro", "stripe_test", "live");
    expect((await live.detail(o.id)).waitingFor).toBe("confirmation");
    expect((await live.advance(o.id, actor)).order.state).toBe("contracted");
    expect((await live.review(actor)).resumed).toBe(0);
    // Una confirmación que apunte a un pago de pruebas no da base para activar
    const testPay = (await orders.paymentByKey("k-test-sim"))!;
    await expect(live.paidBasis({ ...(await live.must(o.id)), confirmation: { kind: "payment", ref: String(testPay.id), actor, reason: null, at: clock } })).rejects.toThrow(/no está verificado/);
    // El de pruebas en el orquestador de pruebas sí cuenta (sin regresión), y el live verificado en Stripe, en live
    await expect(svc.paidBasis({ ...(await live.must(o.id)), confirmation: { kind: "payment", ref: String(testPay.id), actor, reason: null, at: clock } })).resolves.toBe("payment");
    await pay("k-live-stripe", "stripe", "live");
    expect((await live.detail(o.id)).waitingFor).toBeNull();
    expect((await live.advance(o.id, actor)).order.state).not.toBe("contracted");
  });

  it("aprobación administrativa en live: tipo obligatorio, motivo largo, referencia si es cobro externo, nunca con un cobro en curso; sin pago ni documento fiscal", async () => {
    const live = new CommercialOrchestrator({ ...deps, payments: null, mode: "live" });
    const contracted = async (name: string) => {
      const o = (await live.create({ idempotencyKey: key(), companyId: await company(name), request: { plan: "business", interval: "month", items: [] } }, actor)).order;
      await live.accept(o.id, { signatureRef: `firma-${name}`, approvalReason: "Aprobado por producto" }, actor);
      return o.id;
    };
    const id = await contracted("Excepción Live SL");
    const motivo = "Cliente piloto con acuerdo firmado por dirección";
    await expect(live.approve(id, { reason: motivo }, actor)).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/tipo de aprobación/) });
    await expect(live.approve(id, { reason: "Cliente piloto", category: "partner" }, actor)).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/20 caracteres/) });
    await expect(live.approve(id, { reason: motivo, category: "offline_payment" }, actor)).rejects.toMatchObject({ code: "invalid_input", message: expect.stringMatching(/referencia/) });
    await expect(live.approve(id, { reason: motivo, category: "regalo" as never }, actor)).rejects.toMatchObject({ code: "invalid_input" });
    expect((await live.must(id)).state).toBe("contracted");
    // Con la referencia del cobro externo: confirmada por aprobación tipificada, auditada, sin ningún pago
    await live.approve(id, { reason: motivo, category: "offline_payment", reference: "TRF-2026-0042" }, actor);
    const o = await live.must(id);
    expect(o.confirmation).toMatchObject({ kind: "admin_approval", category: "offline_payment", reference: "TRF-2026-0042", reason: motivo, ref: null });
    expect(await orders.payments(id)).toEqual([]);
    const ev = (await orders.events(id)).find((e) => e.kind === "confirm");
    expect(ev?.detail).toMatchObject({ basis: "admin_approval", category: "offline_payment", reference: "TRF-2026-0042" });
    // Un pedido con un cobro en curso no se aprueba sin pago (evita duplicar activación o cobro)
    const id2 = await contracted("Cobro En Curso SL");
    await orders.insertPayment({ orderId: id2, idempotencyKey: `k-${id2}`, purpose: "initial", periodStart: null, amountCents: 7900, currency: "EUR", status: "pending", provider: "stripe", mode: "live", providerRef: null, dueAt: null, createdAt: clock, settledAt: null });
    await expect(live.approve(id2, { reason: motivo, category: "exception" }, actor)).rejects.toMatchObject({ code: "invalid_state" });
    // En pruebas sigue siendo compatible (sin tipo: «exception»)
    const t = (await svc.create({ idempotencyKey: key(), companyId: await company("Pruebas Compat SL"), request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(t.id, { signatureRef: "firma-compat", approvalReason: "Aprobado por producto" }, actor);
    await svc.approve(t.id, { reason: "Cliente piloto" }, actor);
    expect((await svc.must(t.id)).confirmation).toMatchObject({ kind: "admin_approval", category: "exception" });
  });

  const company = async (name: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@${c.id}.example` }, actor);
    return c.id;
  };
  const activeOrder = async (companyId: number, plan = "business") => {
    const o = (await svc.create({ idempotencyKey: key(), companyId, request: { plan, interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    return (await svc.approve(o.id, { reason: "Cliente piloto" }, actor)).order;
  };
  const pay = async (p: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, id = `evt_${key()}`) => {
    const body = JSON.stringify({ id, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };

  it("la base de la activación exige un pago VERIFICADO: una confirmación sin pago cobrado no concede licencias", async () => {
    const cid = await company("Base Ensayo SL");
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await svc.requestPayment(o.id, actor);
    const forged = { ...(await svc.must(o.id)), confirmation: { kind: "payment" as const, ref: String(payment.id), actor, reason: null, at: clock } };
    await expect(svc.paidBasis(forged)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.paidBasis({ ...forged, confirmation: { kind: "admin_approval", ref: null, actor, reason: "", at: clock } })).rejects.toMatchObject({ code: "forbidden" });
    expect((await svc.advance(o.id, actor)).order.state).toBe("contracted");
    expect(await subsStore.list({})).toEqual([]);
  });

  it("recuperación: si falla el alta de la plataforma no queda nada a medias y se reanuda desde el paso pendiente", async () => {
    const cid = await company("Recupera Ensayo SL");
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    failPlatform = 1;
    const r = await svc.approve(o.id, { reason: "Cliente piloto" }, actor);
    expect(r.error).toMatch(/servidor de BD/);
    expect(r.order).toMatchObject({ state: "confirmed", attempts: 1 });
    expect(await subsStore.list({})).toEqual([]);
    const rev = await svc.review(actor);
    expect(rev.resumed).toBe(1);
    const done = await svc.must(o.id);
    expect(done).toMatchObject({ state: "active", lastError: null });
    expect((await subsStore.list({})).length).toBe(1);
    expect((await svc.detail(o.id)).events.map((e) => e.kind)).toContain("step_failed");
  });

  it("cambio a la baja sin importe que no añade capacidades: confirmación heredada; Business se mantiene hasta fin de periodo", async () => {
    const cid = await company("Baja Ensayo SL");
    const prev = await activeOrder(cid, "business");
    const ch = (await svc.create({ idempotencyKey: key(), changeOf: prev.id, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await expect(svc.create({ idempotencyKey: key(), changeOf: prev.id, request: { plan: "business", interval: "month", items: [] } }, actor)).rejects.toMatchObject({ code: "invalid_input" });
    const r = await svc.accept(ch.id, { signatureRef: "firma-baja", approvalReason: "Aprobado por producto" }, actor);
    expect(r.order).toMatchObject({ state: "active", confirmation: { kind: "inherited", ref: String(prev.id) } });
    expect((await svc.must(prev.id)).state).toBe("superseded");
    const sub = (await subsStore.get(r.order.subscriptionId!))!;
    const businessOnly = capabilitiesOfTier("business").filter((c) => !capabilitiesOfTier("essential").includes(c));
    const g = await caps.list(r.order.tenantId!);
    for (const c of businessOnly) expect(g.find((x) => x.capabilityId === c)).toMatchObject({ status: "active", validUntil: sub.currentPeriodEnd });
  });

  it("una subida sin pago ni aprobación se queda esperando la confirmación (no se hereda)", async () => {
    const cid = await company("Sube Ensayo SL");
    const prev = await activeOrder(cid, "essential");
    const ch = (await svc.create({ idempotencyKey: key(), changeOf: prev.id, request: { plan: "business", interval: "month", items: [] } }, actor)).order;
    const r = await svc.accept(ch.id, { signatureRef: "firma-sube", approvalReason: "Aprobado por producto" }, actor);
    expect(r).toMatchObject({ waitingFor: "confirmation", order: { state: "contracted" } });
    expect((await caps.list(prev.tenantId!)).some((x) => x.capabilityId === "roles-custom")).toBe(false);
  });

  it("el mismo evento de pago enviado a la vez: se aplica una vez y el resto son duplicados", async () => {
    const cid = await company("Carrera Ensayo SL");
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await svc.requestPayment(o.id, actor);
    const out = await Promise.all(Array.from({ length: 5 }, () => pay(payment, "evt_mismo_evento")));
    expect(out.filter((x) => x.status === "processed")).toHaveLength(1);
    expect(out.filter((x) => x.status === "duplicate")).toHaveLength(4);
    expect((await svc.must(o.id)).state).toBe("active");
    expect((await subsStore.list({})).length).toBe(1);
  });

  it("un pago inicial fallido no activa nada y permite un segundo intento con otra clave", async () => {
    const cid = await company("Reintento Ensayo SL");
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    const first = (await svc.requestPayment(o.id, actor)).payment;
    const body = JSON.stringify({ id: "evt_falla", type: "payment.failed", paymentKey: first.idempotencyKey, providerRef: first.providerRef, amountCents: first.amountCents, currency: first.currency, livemode: false });
    await svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
    expect((await svc.must(o.id)).state).toBe("contracted");
    const second = await svc.requestPayment(o.id, actor);
    expect(second.created).toBe(true);
    expect(second.payment.idempotencyKey).not.toBe(first.idempotencyKey);
    await pay(second.payment);
    expect((await svc.must(o.id)).state).toBe("active");
  });

  it("avisos: el pago del alta avisa con «confirm» y la renovación cobrada con «payment_recorded» (una vez, sin cambiar el estado)", async () => {
    const notices: Array<{ action: string; detail: Record<string, unknown> | null }> = [];
    const n = new CommercialOrchestrator({ ...deps, notify: async (e) => void notices.push({ action: e.action, detail: e.detail }) });
    const cid = await company("Aviso Ensayo SL");
    const o = (await n.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await n.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await n.requestPayment(o.id, actor);
    const body = (p: typeof payment, id: string) => JSON.stringify({ id, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    const send = (p: typeof payment, id: string) => n.handlePaymentEvent(body(p, id), provider.sign(body(p, id), Math.floor(clock / 1000)));
    await send(payment, "evt_alta");
    expect(notices.filter((x) => x.action === "confirm")).toEqual([{ action: "confirm", detail: { basis: "payment", paymentId: payment.id } }]);
    clock += 32 * 86_400_000;
    const renewal = (await n.renew(o.id, actor)).payment!;
    const before = (await n.must(o.id)).version;
    await send(renewal, "evt_renov");
    await send(renewal, "evt_renov");
    expect(notices.filter((x) => x.action === "payment_recorded")).toEqual([{ action: "payment_recorded", detail: { paymentId: renewal.id, purpose: "renewal" } }]);
    expect((await n.must(o.id)).version).toBe(before);
  });
});
