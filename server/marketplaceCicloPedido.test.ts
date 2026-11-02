/**
 * Ciclo completo de un pedido de `connect-people` y su reflejo en el catálogo del PANEL de la empresa.
 *
 * Recorre el orquestador real en memoria (sin MySQL, sin Stripe: pagos con el proveedor SIMULADO firmado de pruebas)
 * por todos los estados del pedido y comprueba en cada paso:
 *  - el `activation` del producto en el catálogo del panel (`orderActivation` → `panelCatalog`);
 *  - el plan de la empresa (`orderPlan`), que no cambia al comprar ni al dar de baja el módulo;
 *  - la licencia `people-hr` del registro de capacidades y la decisión de acceso del Core (`decide`).
 *
 * Fuera de alcance (Ventana 2): Stripe Checkout, webhooks de Stripe, `ModulePurchaseService` y el menú visible del
 * Core. Aquí el rechazo lo hace el operador con `reject`, igual que hace la compra del panel cuando Stripe caduca o
 * rechaza el cambio (server/stripe/purchases.ts).
 *
 * Los casos marcados «hueco» fijan el comportamiento ACTUAL que el informe de revisión señala como mejorable: si
 * alguien lo corrige, el test debe actualizarse a propósito. Datos sintéticos.
 */
import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { SignedTestProvider } from "./orchestrator/payments";
import { CommercialOrchestrator, type OrchestratorDeps } from "./orchestrator/service";
import { MemoryOrderStore } from "./orchestrator/store";
import type { CommercialOrder, OrderPayment } from "./orchestrator/types";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { decide } from "./_core/capabilities/model";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { panelCatalog } from "./commerce/panelCatalog";
import { orderActivation, orderPlan, ERROR_WINDOW_MS } from "./commerce/panelActivation";

const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const PRODUCT = "connect-people";
const CAPABILITY = "people-hr";
const DAY = 24 * 3600 * 1000;
const actor = "operator:test";
const key = () => crypto.randomBytes(12).toString("hex");

describe(`ciclo del pedido de ${PRODUCT} y estado de activación en el panel`, () => {
  let clock: number;
  let orders: MemoryOrderStore;
  let crmStore: MemoryCrmStore;
  let crm: CrmService;
  let caps: MemoryCapabilityStore;
  let provider: SignedTestProvider;
  let svc: CommercialOrchestrator;
  let site: SiteDocument;
  // Fallos inyectados (uno por paso) para ver el pedido detenido en cada estado intermedio
  let failQuote = 0;
  let failLicensing = 0;
  let failActivateLog = 0;
  let coverageHeld = false;

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 16, 9);
    failQuote = failLicensing = failActivateLog = 0;
    coverageHeld = false;
    crmStore = new MemoryCrmStore();
    const subsStore = new MemorySubscriptionStore();
    caps = new MemoryCapabilityStore();
    orders = new MemoryOrderStore();
    provider = new SignedTestProvider({ webhookSecret: SECRET });
    const webStore = new MemoryWebStore();
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    site = await web.site("published");
    const platform = { activate: async ({ company }: { company: { id: number; tenantId: string | null } }) => ({ tenantId: company.tenantId ?? `t-${company.id}` }) };
    crm = new CrmService({ store: crmStore, activation: { activate: async (i) => platform.activate(i) }, now: () => clock });
    // `crm.log` se llama en el paso de activación justo antes de mover el pedido a «active»
    const log = crm.log.bind(crm);
    crm.log = (async (...a: Parameters<CrmService["log"]>) => {
      if (failActivateLog > 0 && /activo: suscripción/.test(String(a[3]))) {
        failActivateLog--;
        throw new Error("CRM no disponible");
      }
      return log(...a);
    }) as CrmService["log"];
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    const subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    const quoteSite = async () => quoteCatalogFromSite(await web.site("published"));
    const licensing = new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: quoteSite, now: () => clock });
    const deps: OrchestratorDeps = {
      store: orders,
      crm,
      crmStore,
      subscriptions: subs,
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog,
      quote: async (r) => {
        if (failQuote > 0) {
          failQuote--;
          throw new Error("catálogo no disponible");
        }
        return quote(await quoteSite(), r);
      },
      licensing: {
        preview: (id, o) => licensing.preview(id, o),
        apply: async (id, o) => {
          if (failLicensing > 0) {
            failLicensing--;
            throw new Error("registro de capacidades no disponible");
          }
          return licensing.apply(id, o);
        },
      },
      capabilities: caps,
      platform,
      payments: provider,
      coverageHeld: async () => coverageHeld,
      now: () => clock,
    };
    svc = new CommercialOrchestrator(deps);
  });

  // ── Lectura del panel (lo mismo que monta server/controlPlane/api.ts para GET /commerce/tenants/:t/catalog) ──

  const panelItem = async (tenantId: string) => {
    const activation = await orderActivation({ crm: crmStore, orders, now: () => clock })(tenantId);
    const cat = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site, activation });
    return cat.items.find((i) => i.key === PRODUCT)!;
  };
  const activationOf = async (tenantId: string) => (await panelItem(tenantId)).activation;
  const planOf = (tenantId: string) => orderPlan({ crm: crmStore, orders })(tenantId);
  const access = async (tenantId: string, write = true) => decide(await caps.list(tenantId), CAPABILITY, { write, now: clock });

  // ── Pasos del circuito ──

  const company = async (name: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@${c.id}.example` }, actor);
    return c.id;
  };
  /** Empresa con Business activo SIN el módulo (alta aprobada por un operador, sin cobro). */
  const baseOrder = async (name: string, items: string[] = []) => {
    const cid = await company(name);
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "business", interval: "month", items: items.map((k) => ({ key: k })) } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-alta", approvalReason: "Aprobado por producto" }, actor);
    const done = (await svc.approve(o.id, { reason: "Cliente piloto de pruebas" }, actor)).order;
    expect(done.state).toBe("active");
    return done;
  };
  const changeWith = (prev: CommercialOrder, items: string[]) =>
    svc.create({ idempotencyKey: key(), changeOf: prev.id, request: { plan: "business", interval: "month", items: items.map((k) => ({ key: k })) } }, actor);
  const paymentEvent = (p: Pick<OrderPayment, "idempotencyKey" | "providerRef" | "amountCents" | "currency">, type: "payment.succeeded" | "payment.failed") => {
    const body = JSON.stringify({ id: `evt_${key()}`, type, paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };

  it("de punta a punta: pending → error recuperable → reintento → processing → active → impago → baja programada → fin", async () => {
    const base = await baseOrder("Ciclo People SL");
    const t = base.tenantId!;
    expect((await crmStore.get("companies", base.companyId))!.tenantId).toBe(t);
    expect(await activationOf(t)).toEqual({ state: "none", retryable: false, updatedAt: null });
    expect(await planOf(t)).toBe("business");
    expect((await access(t)).status).toBe("not_contracted");

    // requested: la cotización falla y el pedido se queda en «requested» (pendiente, con el error anotado)
    failQuote = 1;
    const first = await changeWith(base, [PRODUCT]);
    expect(first.order).toMatchObject({ state: "requested", attempts: 1 });
    expect(first.error).toMatch(/catálogo/);
    expect(await activationOf(t)).toMatchObject({ state: "pending", retryable: false });

    // quoted → contracted (firma con motivo: el producto es «bajo solicitud»), esperando el cobro
    expect((await svc.advance(first.order.id, actor)).order.state).toBe("quoted");
    expect(await activationOf(t)).toMatchObject({ state: "pending" });
    const signed = await svc.accept(first.order.id, { signatureRef: "firma-people-1", approvalReason: "Aprobado por producto" }, actor);
    expect(signed).toMatchObject({ waitingFor: "confirmation", order: { state: "contracted" } });
    expect(await activationOf(t)).toMatchObject({ state: "pending" });

    // Cobro de prueba fallido: el pedido sigue «contracted» y el panel sigue en pendiente (hueco: no hay error visible)
    const p1 = (await svc.requestPayment(first.order.id, actor)).payment;
    expect(p1.amountCents).toBeGreaterThan(0);
    await paymentEvent(p1, "payment.failed");
    expect((await svc.must(first.order.id)).state).toBe("contracted");
    expect(await activationOf(t)).toMatchObject({ state: "pending", retryable: false });

    // rejected: error recuperable; nada concedido y el plan intacto
    await svc.reject(first.order.id, { reason: "Pago no completado" }, actor);
    expect(await activationOf(t)).toMatchObject({ state: "error", retryable: true });
    expect((await access(t)).status).toBe("not_contracted");
    expect(await planOf(t)).toBe("business");

    // Reintento: un pedido nuevo vuelve a «pending»
    clock += 60_000;
    const retry = (await changeWith(base, [PRODUCT])).order;
    expect(retry.state).toBe("quoted");
    expect(await activationOf(t)).toMatchObject({ state: "pending", retryable: false });
    await svc.accept(retry.id, { signatureRef: "firma-people-2", approvalReason: "Aprobado por producto" }, actor);
    const p2 = (await svc.requestPayment(retry.id, actor)).payment;

    // confirmed: cobro verificado, pero la cobertura está retenida (reembolso/disputa) → se queda en «confirmed»
    coverageHeld = true;
    await paymentEvent(p2, "payment.succeeded");
    expect((await svc.must(retry.id)).state).toBe("confirmed");
    expect(await activationOf(t)).toMatchObject({ state: "processing", retryable: false });
    expect((await access(t)).status).toBe("not_contracted");

    // subscribed: el registro de capacidades falla al conceder la licencia
    coverageHeld = false;
    failLicensing = 1;
    const r1 = await svc.advance(retry.id, actor);
    expect(r1.order).toMatchObject({ state: "subscribed" });
    expect(r1.order.lastError).toMatch(/capacidades/);
    // Hueco: el fallo está anotado (lastError) pero el panel sigue en «procesando», sin error ni reintento
    expect(await activationOf(t)).toMatchObject({ state: "processing", retryable: false });
    expect((await access(t)).status).toBe("not_contracted");

    // licensed: la licencia ya está concedida y el pedido se detiene antes de «active»
    failActivateLog = 1;
    const r2 = await svc.advance(retry.id, actor);
    expect(r2.order.state).toBe("licensed");
    expect(await activationOf(t)).toMatchObject({ state: "processing" });
    // Licencia activa con el panel aún en «procesando» (transitorio hasta que `review` lo reanuda)
    expect(await access(t)).toEqual({ allowed: true, status: "active" });

    // review (motor de ciclo de vida) reanuda → active; el pedido anterior queda sustituido
    expect((await svc.review(actor)).resumed).toBe(1);
    const active = await svc.must(retry.id);
    expect(active).toMatchObject({ state: "active", lastError: null });
    expect((await svc.must(base.id)).state).toBe("superseded");
    expect(await activationOf(t)).toMatchObject({ state: "active", retryable: false });
    expect(await planOf(t)).toBe("business");
    expect(await access(t)).toEqual({ allowed: true, status: "active" });

    // Fin del periodo: renovación con recibo de prueba vencido → past_due (gracia): el panel sigue «active»
    clock = Date.UTC(2026, 10, 16, 10);
    const rev1 = await svc.review(actor);
    expect(rev1).toMatchObject({ renewed: 1, pastDue: 1 });
    expect((await svc.must(retry.id)).state).toBe("past_due");
    expect(await activationOf(t)).toMatchObject({ state: "active" });
    expect(await planOf(t)).toBe("business");
    expect((await access(t)).allowed).toBe(true);

    // Fin de la gracia → suspended: licencia suspendida y acceso cortado; el panel sigue «active» (hueco)
    clock += 8 * DAY;
    expect((await svc.review(actor)).suspended).toBe(1);
    expect((await svc.must(retry.id)).state).toBe("suspended");
    expect(await access(t)).toMatchObject({ allowed: false, status: "suspended" });
    expect(await activationOf(t)).toMatchObject({ state: "active" });
    expect(await planOf(t)).toBe("business");

    // Pago del recibo → recuperado: active y licencia reactivada
    const renewal = (await orders.payments(retry.id)).find((p) => p.purpose === "renewal" && p.status === "pending")!;
    await paymentEvent(renewal, "payment.succeeded");
    expect((await svc.must(retry.id)).state).toBe("active");
    expect(await access(t)).toEqual({ allowed: true, status: "active" });

    // Baja programada: sigue «active» (panel, licencia y plan) hasta el fin del periodo
    const cs = await svc.cancel(retry.id, { reason: "Baja solicitada por el cliente" }, actor);
    expect(cs.order.state).toBe("cancel_scheduled");
    clock = Date.UTC(2026, 11, 16, 8); // justo antes del fin del periodo renovado (16/12, 09:00 UTC)
    await svc.review(actor);
    expect((await svc.must(retry.id)).state).toBe("cancel_scheduled");
    expect(await activationOf(t)).toMatchObject({ state: "active" });
    expect(await planOf(t)).toBe("business");
    expect(await access(t)).toEqual({ allowed: true, status: "active" });

    // Llega la fecha: cancelled → el panel deja de mostrarlo; licencia en solo lectura (consulta, sin operar)
    clock = Date.UTC(2026, 11, 16, 10);
    expect((await svc.review(actor)).cancelled).toBe(1);
    expect((await svc.must(retry.id)).state).toBe("cancelled");
    expect(await activationOf(t)).toEqual({ state: "none", retryable: false, updatedAt: null });
    expect(await planOf(t)).toBeNull();
    expect(await access(t, false)).toEqual({ allowed: true, status: "read_only" });
    expect((await access(t, true)).allowed).toBe(false);
  });

  it("el error de un rechazo caduca a los 7 días y nunca tapa lo ya activo", async () => {
    const base = await baseOrder("Rechazo People SL");
    const t = base.tenantId!;
    const o = (await changeWith(base, [PRODUCT])).order;
    await svc.reject(o.id, { reason: "El cliente lo deja para más adelante" }, actor);
    expect(await activationOf(t)).toMatchObject({ state: "error", retryable: true });
    clock += ERROR_WINDOW_MS + 1;
    expect(await activationOf(t)).toMatchObject({ state: "none", retryable: false });
    expect(await planOf(t)).toBe("business");
  });

  it("hueco: al quitar el módulo, el panel lo muestra «none» al instante aunque la licencia sigue activa hasta fin de periodo", async () => {
    const base = await baseOrder("Reduce People SL", [PRODUCT]);
    const t = base.tenantId!;
    expect(await activationOf(t)).toMatchObject({ state: "active" });
    expect(await access(t)).toEqual({ allowed: true, status: "active" });
    // Reducción: sin importe y sin capacidades nuevas → confirmación heredada y pedido activo en el acto
    const ch = (await changeWith(base, [])).order;
    const r = await svc.accept(ch.id, { signatureRef: "firma-reduce", approvalReason: "Aprobado por producto" }, actor);
    expect(r.order).toMatchObject({ state: "active", confirmation: { kind: "inherited" } });
    expect(await planOf(t)).toBe("business");
    // La licencia se mantiene (fecha de fin = fin de periodo) pero el panel ya no la refleja
    const grant = (await caps.list(t)).find((g) => g.capabilityId === CAPABILITY)!;
    expect(grant).toMatchObject({ status: "active" });
    expect(grant.validUntil).toBeGreaterThan(clock);
    expect(await access(t)).toEqual({ allowed: true, status: "active" });
    expect(await activationOf(t)).toEqual({ state: "none", retryable: false, updatedAt: null });
  });
});
