/**
 * Motor de transiciones temporales (memoria, datos sintéticos): política provisional, plan de solo
 * lectura, aplicación por los caminos existentes (renovación, impago con gracia, suspensión), avisos solo
 * planificados, pedidos de Stripe, licencias que caducan por fecha sin reactivar nada suspendido, pruebas,
 * conservación sin borrado, bloqueo entre réplicas e idempotencia.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { LifecycleEngine, temporalChange, type LifecycleDeps } from "./lifecycle/engine";
import { lifecyclePolicyFromEnv } from "./lifecycle/policy";
import { SignedTestProvider } from "./orchestrator/payments";
import { CommercialOrchestrator } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
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
import { MemoryTrialStore } from "./trials/store";
import { memoryLock } from "./trials/scheduler";

const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const DAY = 86_400_000;
const key = () => crypto.randomBytes(12).toString("hex");
const actor = "operator:test";

describe("política provisional", () => {
  it("por defecto: apagada, solo planifica y usa las propuestas D-15/D-16/D-17", () => {
    expect(lifecyclePolicyFromEnv({})).toMatchObject({ enabled: false, mode: "plan", modeReason: null, dunningDays: [0, 3, 6], trialNoticeDays: [7, 3, 1], retentionDays: 30, intervalMs: 15 * 60_000 });
  });
  it("aplicar en live exige una autorización expresa; valores no válidos vuelven a la propuesta", () => {
    expect(lifecyclePolicyFromEnv({ CP_LIFECYCLE_MODE: "apply" }).mode).toBe("apply");
    expect(lifecyclePolicyFromEnv({ CP_LIFECYCLE_MODE: "apply", CP_STRIPE_MODE: "live" })).toMatchObject({ mode: "plan", modeReason: "live_apply_not_authorized" });
    expect(lifecyclePolicyFromEnv({ CP_LIFECYCLE_MODE: "apply", CP_STRIPE_MODE: "live", CP_LIFECYCLE_LIVE_APPLY: "1" }).mode).toBe("apply");
    expect(lifecyclePolicyFromEnv({ CP_LIFECYCLE_DUNNING_DAYS: "6,0,3,3", CP_LIFECYCLE_TRIAL_NOTICE_DAYS: "x", CP_LIFECYCLE_RETENTION_DAYS: "0", CP_LIFECYCLE_INTERVAL_MS: "5" })).toMatchObject({
      dunningDays: [0, 3, 6],
      trialNoticeDays: [7, 3, 1],
      retentionDays: 30,
      intervalMs: 60_000,
    });
  });
});

describe("cambios de licencia aplicables por fecha", () => {
  const g = (status: "active" | "suspended" | "read_only" | "cancelled") => [{ tenantId: "t", capabilityId: "crm", siteId: "", status, validUntil: null, source: "subscription:1", updatedAt: 0, updatedBy: "x" }];
  const c = (status: "active" | "cancelled", validUntil: number | null = null) => ({ capabilityId: "crm", siteId: "", status, validUntil, source: "subscription:1" });
  it("bajas, altas nuevas y cambios de fecha sí; reactivar algo suspendido, en solo lectura o cancelado, no", () => {
    expect(temporalChange(c("cancelled"), g("active"))).toBe(true);
    expect(temporalChange(c("active"), [])).toBe(true);
    expect(temporalChange(c("active", 123), g("active"))).toBe(true);
    expect(temporalChange(c("active"), g("suspended"))).toBe(false);
    expect(temporalChange(c("active"), g("read_only"))).toBe(false);
    expect(temporalChange(c("active"), g("cancelled"))).toBe(false);
  });
});

describe("motor con el orquestador en memoria", () => {
  let clock: number;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let subsStore: MemorySubscriptionStore;
  let caps: MemoryCapabilityStore;
  let orders: MemoryOrderStore;
  let trials: MemoryTrialStore;
  let provider: SignedTestProvider;
  let licensing: LicensingService;
  let base: LifecycleDeps;

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 19, 9);
    const crmStore = new MemoryCrmStore();
    subsStore = new MemorySubscriptionStore();
    caps = new MemoryCapabilityStore();
    orders = new MemoryOrderStore();
    trials = new MemoryTrialStore();
    provider = new SignedTestProvider({ webhookSecret: SECRET });
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    const platform = { activate: async ({ company }: { company: { id: number; tenantId: string | null } }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) };
    crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now: () => clock });
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    const subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    licensing = new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => clock });
    svc = new CommercialOrchestrator({
      store: orders,
      crm,
      crmStore,
      subscriptions: subs,
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog,
      quote: async (r) => quote(await site(), r),
      licensing,
      capabilities: caps,
      platform,
      payments: provider,
      now: () => clock,
    });
    base = {
      orders,
      subscriptions: subsStore,
      licensing,
      orchestrator: svc,
      trials,
      graceMs: 7 * DAY,
      policy: { mode: "apply", dunningDays: [0, 3, 6], trialNoticeDays: [7, 3, 1], retentionDays: 30 },
      lock: memoryLock(),
      now: () => clock,
    };
  });

  const company = async (name: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@${c.id}.example` }, actor);
    return c.id;
  };
  const pay = (p: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }) => {
    const body = JSON.stringify({ id: `evt_${key()}`, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };
  /** Pedido activo pagado en línea (pago de PRUEBA firmado): su renovación emite un recibo de prueba. */
  const paidOrder = async (name: string) => {
    const o = (await svc.create({ idempotencyKey: key(), companyId: await company(name), request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await svc.requestPayment(o.id, actor);
    await pay(payment);
    return svc.must(o.id);
  };
  const kinds = async (e: LifecycleEngine, orderId: number) => (await e.plan()).actions.filter((a) => a.orderId === orderId).map((a) => a.kind);

  it("modo plan: calcula la renovación vencida y no cambia nada", async () => {
    const o = await paidOrder("Plan SL");
    const sub = (await subsStore.get(o.subscriptionId!))!;
    const e = new LifecycleEngine({ ...base, policy: { ...base.policy, mode: "plan" } });
    expect(await kinds(e, o.id)).toEqual([]);
    clock = sub.currentPeriodEnd + 1;
    expect(await kinds(e, o.id)).toEqual(["renew"]);
    const r = await e.run();
    expect(r).toMatchObject({ mode: "plan", planned: { renew: 1 }, applied: { review: null, licenceSynced: 0 } });
    expect((await subsStore.get(sub.id))!.currentPeriodStart).toBe(sub.currentPeriodStart);
  });

  it("impago completo: renovación → recibo vencido → gracia con avisos 0, 3 y 6 → suspensión; repetir no repite nada", async () => {
    const o = await paidOrder("Impago SL");
    const sub = (await subsStore.get(o.subscriptionId!))!;
    const e = new LifecycleEngine(base);
    clock = sub.currentPeriodEnd + 1;
    await e.run();
    expect((await subsStore.get(sub.id))!.currentPeriodStart).toBeGreaterThan(sub.currentPeriodStart);
    // El recibo de la renovación (de prueba, sin cobro) vence al empezar el periodo: la misma revisión marca el impago
    const late = await svc.must(o.id);
    expect(late.state).toBe("past_due");
    const graceEndsAt = late.graceEndsAt!;
    const notice = async () => (await e.plan()).actions.find((a) => a.kind === "dunning_notice" && a.orderId === o.id)?.detail.day ?? null;
    expect(await notice()).toBe(0);
    clock += 3 * DAY;
    expect(await notice()).toBe(3);
    clock += 3 * DAY;
    expect(await notice()).toBe(6);
    // Los avisos solo se planifican: nada se envía ni cambia el pedido
    await e.run();
    expect((await svc.must(o.id)).state).toBe("past_due");
    clock = graceEndsAt;
    expect(await kinds(e, o.id)).toEqual(["suspend"]);
    await e.run();
    const s = await svc.must(o.id);
    expect(s.state).toBe("suspended");
    expect((await caps.list(s.tenantId!)).filter((g) => g.source === `subscription:${sub.id}`).every((g) => g.status === "suspended")).toBe(true);
    const events = (await orders.events(o.id)).length;
    await e.run();
    await e.run();
    expect((await orders.events(o.id)).length).toBe(events);
    expect(await kinds(e, o.id)).toEqual([]);
  });

  it("pedido cobrado en Stripe: la gracia agotada no lo suspende el motor (lo decide Stripe)", async () => {
    const o = await paidOrder("Stripe SL");
    await orders.insertPayment({ orderId: o.id, idempotencyKey: `stripe:inv:in_${key()}`, purpose: "renewal", periodStart: clock, amountCents: 3509, currency: "EUR", status: "failed", provider: "stripe_test", mode: "test", providerRef: "in_x", dueAt: null, createdAt: clock, settledAt: clock });
    await svc.applyExternalBilling(o.id, { status: "past_due", cancelAt: null }, "system:stripe");
    clock += 8 * DAY;
    const e = new LifecycleEngine(base);
    expect(await kinds(e, o.id)).toContain("stripe_dunning");
    expect(await kinds(e, o.id)).not.toContain("suspend");
    await e.run();
    expect((await svc.must(o.id)).state).toBe("past_due");
  });

  it("licencias: una baja por fecha se aplica; una licencia suspendida por un operador no se reactiva (solo se señala)", async () => {
    const o = await paidOrder("Licencias SL");
    // Sin revisión de pedidos (orquestador sustituido): solo actúan las licencias
    const noReview = { review: async () => ({ suspended: 0, pastDue: 0, renewed: 0, cancelled: 0, cascaded: 0, resumed: 0, errors: [] }) } as unknown as LifecycleDeps["orchestrator"];
    const e = new LifecycleEngine({ ...base, orchestrator: noReview });
    const source = `subscription:${o.subscriptionId}`;
    // Una capacidad de más con este origen (p. ej. un módulo cuya partida ya terminó): se da de baja
    await caps.apply(o.tenantId!, [{ capabilityId: "roles-custom", siteId: "", status: "active", validUntil: clock, source }], { actor, reason: "Partida terminada", now: clock });
    expect(await kinds(e, o.id)).toEqual(["licence_sync"]);
    expect((await e.run()).applied.licenceSynced).toBe(1);
    expect((await caps.list(o.tenantId!)).find((g) => g.capabilityId === "roles-custom")?.status).toBe("cancelled");
    // Una capacidad del plan suspendida a mano: el motor no la reactiva
    const one = capabilitiesOfTier("essential")[0];
    await caps.apply(o.tenantId!, [{ capabilityId: one, siteId: "", status: "suspended", validUntil: null, source }], { actor, reason: "Revisión", now: clock });
    expect(await kinds(e, o.id)).toEqual(["licence_drift"]);
    expect((await e.run()).applied.licenceSynced).toBe(0);
    expect((await caps.list(o.tenantId!)).find((g) => g.capabilityId === one)?.status).toBe("suspended");
  });

  it("pruebas: aviso que toca (7, 3, 1 días), vencimiento para la tarea de pruebas y revisión de conservación sin borrar", async () => {
    let t = await trials.insert(
      {
        email: "olga@abeto.example", emailDomain: "abeto.example", companyName: "Abeto SL", configuration: { plan: "essential", addons: [] }, state: "active",
        verificationTokenHash: null, verificationExpiresAt: null, verifiedAt: clock, tenantId: "t9-abeto", startsAt: clock, endsAt: clock + 15 * DAY, extensionsUsed: 0,
        extensionRequestedAt: null, extensionReason: null, suspendedReason: null, convertedSubscriptionId: null, idempotencyKey: key(), ipHash: null, createdAt: clock,
      },
      actor,
    );
    const e = new LifecycleEngine({ ...base, policy: { ...base.policy, mode: "plan" } });
    const of = async () => (await e.plan()).actions.filter((a) => a.trialId === t.id).map((a) => `${a.kind}:${a.detail.daysLeft ?? ""}`);
    expect(await of()).toEqual([]);
    clock += 8 * DAY;
    expect(await of()).toEqual(["trial_notice:7"]);
    clock += 4 * DAY;
    expect(await of()).toEqual(["trial_notice:3"]);
    clock += 2 * DAY;
    expect(await of()).toEqual(["trial_notice:1"]);
    clock += 1 * DAY;
    expect(await of()).toEqual(["trial_expire:"]);
    t = await trials.transition(t.id, t.version, { state: "expired" }, { action: "mark_expired", fromState: "active", detail: null, actor, at: clock });
    clock += 30 * DAY;
    expect(await of()).toEqual(["retention_review:"]);
    expect((await e.plan()).actions.find((a) => a.trialId === t.id)?.executor).toBe("operator");
  });

  it("otra réplica con el bloqueo: el tick no hace nada", async () => {
    const lock = memoryLock();
    lock.held.add("elephant_lifecycle_engine");
    expect((await new LifecycleEngine({ ...base, lock }).run()).skipped).toBe("locked");
  });
});
