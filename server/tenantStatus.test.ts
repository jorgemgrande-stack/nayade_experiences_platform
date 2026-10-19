/**
 * Estado de la empresa en el registro según su situación comercial (memoria, datos sintéticos): la regla,
 * el recorrido real del orquestador (alta pagada, impago, suspensión, recuperación, cancelación y fin), los
 * estados que solo decide un operador, el aislamiento entre empresas, la reparación en la revisión, que un
 * fallo del registro no deshace el cambio comercial y el registro de cada cambio en los eventos comerciales.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { TenantStatusSync, desiredTenantStatus } from "./orchestrator/tenantStatus";
import type { TenantStatus } from "./_core/tenantRegistry/contract";
import { assertTransition } from "./_core/tenantRegistry/lifecycle";
import { SignedTestProvider } from "./orchestrator/payments";
import { CommercialOrchestrator } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import type { CommercialOrder } from "./orchestrator/types";
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
import { MemoryCommercialEventLog } from "./commercialEvents/log";

const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const DAY = 86_400_000;
const key = () => crypto.randomBytes(12).toString("hex");
const actor = "operator:test";

/** Registro en memoria con la misma tabla de transiciones que el real. */
function fakeRegistry(initial: Record<string, TenantStatus> = {}) {
  const status = new Map<string, TenantStatus>(Object.entries(initial));
  const audit: Array<{ tenantId: string; from: TenantStatus; to: TenantStatus; reason?: string; actor: string }> = [];
  let fail = 0;
  return {
    status,
    audit,
    failNext: (n = 1) => void (fail = n),
    getTenant: async (id: string) => (status.has(id) ? { id, status: status.get(id)! } : null),
    setStatus: async (id: string, to: TenantStatus, a: { type: string; id: string }, o: { reason?: string }) => {
      if (fail > 0) {
        fail--;
        throw new Error("registro no disponible");
      }
      const from = status.get(id)!;
      if (from === to) return;
      assertTransition(from, to);
      status.set(id, to);
      audit.push({ tenantId: id, from, to, reason: o.reason, actor: a.id });
    },
  };
}

const order = (o: Partial<CommercialOrder>): CommercialOrder => ({ id: 1, state: "active", tenantId: "t1", companyId: 1, version: 1, ...o }) as CommercialOrder;

describe("regla: estado de la empresa según sus pedidos", () => {
  it("activo o con cancelación programada → active; impago → grace; suspendido → suspended; terminado → suspended; nada → sin cambio", () => {
    expect(desiredTenantStatus([order({ state: "active" })])?.status).toBe("active");
    expect(desiredTenantStatus([order({ state: "cancel_scheduled" })])?.status).toBe("active");
    expect(desiredTenantStatus([order({ state: "past_due" })])).toMatchObject({ status: "grace", reason: "commercial:payment_overdue" });
    expect(desiredTenantStatus([order({ state: "suspended" })])?.status).toBe("suspended");
    expect(desiredTenantStatus([order({ state: "cancelled" })])).toMatchObject({ status: "suspended", reason: "commercial:subscription_ended" });
    expect(desiredTenantStatus([order({ state: "contracted" }), order({ id: 2, state: "rejected" })])).toBeNull();
    expect(desiredTenantStatus([])).toBeNull();
  });
  it("un cambio de plan activo manda sobre el pedido sustituido o terminado", () => {
    expect(desiredTenantStatus([order({ id: 1, state: "superseded" }), order({ id: 2, state: "active" })])).toMatchObject({ status: "active", orderId: 2 });
    expect(desiredTenantStatus([order({ id: 1, state: "cancelled" }), order({ id: 2, state: "active" })])?.orderId).toBe(2);
  });
});

describe("sincronización", () => {
  it("nunca toca empresas que decide un operador (alta, archivo, borrado) ni las de otra empresa", async () => {
    for (const s of ["provisioning", "archived", "deleting", "deleted"] as TenantStatus[]) {
      const reg = fakeRegistry({ t1: s });
      const sync = new TenantStatusSync({ ...reg, orders: async () => [order({ state: "active" })] });
      expect(await sync.sync({ tenantId: "t1", companyId: 1 }, actor)).toMatchObject({ changed: false, skipped: "operator_owned" });
      expect(reg.status.get("t1")).toBe(s);
    }
    // Pedidos de la misma empresa CRM pero con otra plataforma no cuentan
    const reg = fakeRegistry({ t1: "trial" });
    const sync = new TenantStatusSync({ ...reg, orders: async () => [order({ state: "active", tenantId: "t9" })] });
    expect(await sync.sync({ tenantId: "t1", companyId: 1 }, actor)).toMatchObject({ changed: false, status: "trial" });
  });
  it("un fallo del registro no lanza (el cambio comercial ya está guardado) y deja la alerta", async () => {
    const reg = fakeRegistry({ t1: "trial" });
    reg.failNext();
    const sync = new TenantStatusSync({ ...reg, orders: async () => [order({ state: "active" })] });
    expect(await sync.syncSafely(order({}), actor)).toBeNull();
    expect(reg.status.get("t1")).toBe("trial");
    expect(await sync.syncSafely(order({}), actor)).toMatchObject({ changed: true, from: "trial", to: "active" });
  });
});

describe("recorrido real con el orquestador en memoria", () => {
  let clock: number;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let crmStore: MemoryCrmStore;
  let subsStore: MemorySubscriptionStore;
  let orders: MemoryOrderStore;
  let provider: SignedTestProvider;
  let reg: ReturnType<typeof fakeRegistry>;
  let ledger: MemoryCommercialEventLog;

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 19, 9);
    crmStore = new MemoryCrmStore();
    subsStore = new MemorySubscriptionStore();
    const caps = new MemoryCapabilityStore();
    ledger = new MemoryCommercialEventLog();
    orders = new MemoryOrderStore(ledger);
    provider = new SignedTestProvider({ webhookSecret: SECRET });
    reg = fakeRegistry();
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    // Cada empresa activada nace en el registro como «trial» (p. ej. viene de una prueba)
    const platform = {
      activate: async ({ company }: { company: { id: number; tenantId: string | null } }) => {
        const tenantId = company.tenantId ?? `t-${company.id}`;
        if (!reg.status.has(tenantId)) reg.status.set(tenantId, "trial");
        return { tenantId };
      },
    };
    crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now: () => clock });
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    const subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    svc = new CommercialOrchestrator({
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
      tenantStatus: new TenantStatusSync({ getTenant: reg.getTenant, setStatus: reg.setStatus, orders: (companyId) => orders.list({ companyId }), events: ledger, now: () => clock }),
      now: () => clock,
    });
  });

  const pay = (p: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, type: "payment.succeeded" | "payment.failed" = "payment.succeeded") => {
    const body = JSON.stringify({ id: `evt_${key()}`, type, paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };
  const paidOrder = async (name: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@${c.id}.example` }, actor);
    const o = (await svc.create({ idempotencyKey: key(), companyId: c.id, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-1", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await svc.requestPayment(o.id, actor);
    await pay(payment);
    return svc.must(o.id);
  };

  it("trial → active al pagar; impago → grace; gracia agotada → suspended; pago → active; cancelación → active hasta el fin → suspended", async () => {
    const o = await paidOrder("Recorrido SL");
    const t = o.tenantId!;
    expect(o.state).toBe("active");
    expect(reg.status.get(t)).toBe("active");
    const sub = (await subsStore.get(o.subscriptionId!))!;
    // Fin de periodo: renovación con recibo de PRUEBA vencido → impago con gracia
    clock = sub.currentPeriodEnd + 1;
    await svc.review(actor);
    expect((await svc.must(o.id)).state).toBe("past_due");
    expect(reg.status.get(t)).toBe("grace");
    // Gracia agotada → suspendido
    clock += 8 * DAY;
    await svc.review(actor);
    expect((await svc.must(o.id)).state).toBe("suspended");
    expect(reg.status.get(t)).toBe("suspended");
    // Pago del recibo → al corriente
    const due = (await orders.payments(o.id)).find((p) => p.purpose === "renewal" && p.status === "pending")!;
    await pay(due);
    expect((await svc.must(o.id)).state).toBe("active");
    expect(reg.status.get(t)).toBe("active");
    // Cancelación a fin de periodo: sigue activa hasta entonces; al terminar, suspendida (datos conservados)
    await svc.cancel(o.id, { reason: "El cliente cierra la temporada" }, actor);
    expect((await svc.must(o.id)).state).toBe("cancel_scheduled");
    expect(reg.status.get(t)).toBe("active");
    clock = (await subsStore.get(sub.id))!.currentPeriodEnd + 1;
    await svc.review(actor);
    expect((await svc.must(o.id)).state).toBe("cancelled");
    expect(reg.status.get(t)).toBe("suspended");
    // Cada cambio, auditado en el registro y en los eventos comerciales, una sola vez
    expect(reg.audit.filter((a) => a.tenantId === t).map((a) => `${a.from}→${a.to}`)).toEqual(["trial→active", "active→grace", "grace→suspended", "suspended→active", "active→suspended"]);
    const ev = await ledger.list({ companyId: o.companyId, types: ["tenant.status_changed"] });
    expect(ev.map((e) => `${e.fromState}→${e.toState}`)).toEqual(["trial→active", "active→grace", "grace→suspended", "suspended→active", "active→suspended"]);
    expect(ev.every((e) => e.tenantId === t && e.orderId === o.id)).toBe(true);
    // Repetir la revisión no cambia nada
    await svc.review(actor);
    expect(reg.audit.filter((a) => a.tenantId === t)).toHaveLength(5);
  });

  it("si el registro falla al activar, el pedido queda activo y la revisión lo repara; otra empresa no se ve afectada", async () => {
    const other = await paidOrder("Vecina SL");
    reg.failNext();
    const o = await paidOrder("Reparada SL");
    expect(o.state).toBe("active");
    expect(reg.status.get(o.tenantId!)).toBe("trial");
    const r = await svc.review(actor);
    expect(r.tenantSynced).toBe(1);
    expect(reg.status.get(o.tenantId!)).toBe("active");
    expect(reg.status.get(other.tenantId!)).toBe("active");
    expect(reg.audit.filter((a) => a.tenantId === other.tenantId)).toHaveLength(1);
  });
});
