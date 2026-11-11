/**
 * Cobro en Stripe de condiciones personalizadas con la pasarela REAL (`commercialTerms/stripeGateway.ts`) y la puesta
 * en cobro (`commercialTerms/stripeBilling.ts`), sobre el doble de Stripe de siempre (`stripe/testing.ts`): sin red ni
 * claves. Los eventos recorren el procesador de webhooks y la conciliación existentes.
 *
 * Cubre: cerrojos (apagado = ninguna llamada; encendido no cobra a nadie; las suscripciones ordinarias no se tocan),
 * alta sin duplicados (un Customer, una sesión, una suscripción), enlace por webhook, estado de pago (renovación,
 * impago, gracia, suspensión, recuperación, fin, cobro revertido), licencias, conciliación e idempotencia.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { FailureAlerts, configureFailureAlerts } from "./_core/ops/failureAlerts";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { catalogFromWebStore, type CrmPort } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, type LineInput, type TermsInput } from "./commercialTerms/service";
import { MemoryTermsStore } from "./commercialTerms/store";
import { TermsBillingService, describeTermsBilling } from "./commercialTerms/billing";
import { MemoryTermsBillingStore } from "./commercialTerms/billingStore";
import { NegotiatedBillingError, NegotiatedBillingService, invoiceTaxCheck, mapStripeStatus } from "./commercialTerms/stripeBilling";
import { CUSTOM_SERVICE_PRODUCT_ID, NegotiatedGatewayError, StripeNegotiatedGateway, catalogProductsOf } from "./commercialTerms/stripeGateway";
import { STRIPE_FAILURE_RULES } from "./stripe/alerts";
import type { StripeMode, StripeTaxPolicy } from "./stripe/config";
import { StripeEventProcessor } from "./stripe/events";
import type { NegotiatedCheckoutInput, NegotiatedItemsChange, StripeGateway } from "./stripe/gateway";
import { StripeReconciler } from "./stripe/reconcile";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import type { EligibilityConfig } from "./stripe/eligibility";

const A = "operator:ana";
const NS = "local";
const T0 = Date.UTC(2026, 10, 1, 10);
const DAY = 86_400_000;
const crm: CrmPort = { company: async (id) => ({ id, name: `Empresa ${id}` }), contract: async () => null };
const URLS = { success: "https://web.example/contratacion/estado", cancel: "https://web.example/contratacion/cancelada" };

let clock: number;
let store: MemorySubscriptionStore;
let termsStore: MemoryTermsStore;
let subs: SubscriptionService;
let terms: CommercialTermsService;
let gw: FakeStripeGateway;
let stripeStore: MemoryStripeStore;
let billingStore: MemoryTermsBillingStore;
let caps: MemoryCapabilityStore;
let alerts: FailureAlerts;
let companies: Map<number, Record<string, unknown>>;
let catalogPort: ReturnType<typeof catalogFromWebStore>;
const P: Record<string, number> = {};
/** Llamadas al circuito ORDINARIO (pedidos y orquestador): deben quedarse a cero con las contrataciones negociadas. */
let ordinary: string[];
/** Llamadas al registro de licencias y a la aplicación de licencias de los acuerdos hechas por el cobro. */
let capabilityCalls: string[];
let licenceCalls: number[];

beforeEach(async () => {
  clock = T0;
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
  gw = new FakeStripeGateway();
  stripeStore = new MemoryStripeStore();
  for (const [key, family, name, activation, amount] of [
    ["essential", "core_plan", "Essential", { kind: "plan", ref: "essential" }, 2900],
    ["hotel-net", "industry_module", "Hotel Net", { kind: "module", ref: "hotel" }, 11900],
    ["whatsapp", "extension", "Conector WhatsApp", { kind: "feature", ref: null }, 2900],
  ] as const) {
    await web.create({ kind: "product", key, family: family as never, draft: { name, technicalStatus: "available", activation, billingModel: family === "core_plan" ? "subscription" : "recurring_addon" } }, A);
    await web.publish("product", key, 1, A);
    const p = await web.addPrice(key, { kind: "monthly", amountCents: amount, taxRateBp: 2100 } as never, A);
    await web.approvePrice(p.id, A);
    P[key] = p.id;
    // Catálogo de Stripe ya enlazado (lo crea una persona): un Product por producto y su Price oficial
    gw.addProduct({ id: `prod_${key}`, name });
    gw.addPrice({ id: `price_${key}`, productId: `prod_${key}`, lookupKey: `es:${key}:monthly:eur:v${p.id}`, unitAmount: amount });
    await stripeStore.upsertPrice({ webPriceId: p.id, stripeProductId: `prod_${key}`, stripePriceId: `price_${key}`, lookupKey: `es:${key}:monthly:eur:v${p.id}`, now: clock });
  }
  store = new MemorySubscriptionStore();
  termsStore = new MemoryTermsStore();
  const catalog = (catalogPort = catalogFromWebStore(webStore));
  subs = new SubscriptionService({ store, catalog, crm, now: () => clock });
  billingStore = new MemoryTermsBillingStore();
  caps = new MemoryCapabilityStore();
  companies = new Map();
  for (const id of [1, 2, 3]) companies.set(id, { id, name: `Empresa ${id}`, legalName: `Empresa ${id} SL`, taxId: "B12345674", address: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "ES", billingEmail: `facturas${id}@example.test`, tenantId: null });
  ordinary = [];
  capabilityCalls = [];
  licenceCalls = [];
  alerts = new FailureAlerts({ rules: STRIPE_FAILURE_RULES });
  configureFailureAlerts(alerts);
});

/** Pasarela que falla en CUALQUIER llamada: prueba que algo no habla con Stripe. */
const exploding = (seen: string[]) =>
  new Proxy({} as StripeGateway, {
    get: (_t, op) => (op === "then" ? undefined : (..._a: unknown[]) => (seen.push(String(op)), Promise.reject(new Error(`llamada a Stripe no permitida: ${String(op)}`)))),
    has: () => true,
  });

interface World {
  neg: NegotiatedBillingService;
  billing: TermsBillingService;
  adapter: StripeNegotiatedGateway;
  processor: StripeEventProcessor;
  reconciler: StripeReconciler;
}

function world(o: { enabled?: boolean; mode?: StripeMode; taxPolicy?: StripeTaxPolicy | null; gateway?: StripeGateway; fiscal?: EligibilityConfig; orderBilled?: (id: number) => Promise<boolean> } = {}): World {
  const mode = o.mode ?? "test";
  const gateway = o.gateway ?? gw;
  const enabled = o.enabled ?? true;
  const taxPolicy = o.taxPolicy === undefined ? (mode === "live" ? "stripe_tax_exclusive" : "test_net_no_tax") : o.taxPolicy;
  const billing = new TermsBillingService({ enabled, termsStore, subscriptionStore: store, settle: (id) => terms.settleDue(id), now: () => clock });
  let neg: NegotiatedBillingService | null = null;
  const adapter = new StripeNegotiatedGateway({ gateway, namespace: NS, mode, taxPolicy, catalogProducts: async () => catalogProductsOf(await stripeStore.listPrices()), allowed: (id) => neg!.allowed(id) });
  neg = new NegotiatedBillingService({
    enabled,
    store: billingStore,
    stripeStore,
    gateway,
    adapter,
    billing,
    termsStore,
    subscriptionStore: store,
    subscriptions: subs,
    crmStore: { get: async (_t: string, id: number) => companies.get(id) ?? null, list: async () => [] } as never,
    capabilities: { list: (t: string) => (capabilityCalls.push(`list:${t}`), caps.list(t)), apply: (t: string, c: never, m: never) => (capabilityCalls.push(`apply:${t}`), caps.apply(t, c, m)) },
    licences: { ensure: async (id: number) => void licenceCalls.push(id) },
    orderBilled: o.orderBilled,
    urls: URLS,
    namespace: NS,
    mode,
    taxPolicy,
    fiscal: o.fiscal ? { config: o.fiscal } : undefined,
    now: () => clock,
  });
  billing.attach({ gateway: neg.gatewayFor(), link: neg.link });
  // Como en el plano de control: cada cambio de condiciones se lleva a Stripe si el cobro está abierto
  terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog: catalogPort, crm, now: () => clock, afterChange: async (sid) => void (await billing.syncIfOpen(sid)) });
  const n = neg;
  const trap = (name: string) => new Proxy({}, { get: (_t, op) => (op === "then" ? undefined : (..._a: unknown[]) => (ordinary.push(`${name}.${String(op)}`), Promise.reject(new Error(`circuito ordinario no permitido: ${name}.${String(op)}`)))) });
  const processor = new StripeEventProcessor({ store: stripeStore, gateway, orders: trap("orders") as never, orchestrator: trap("orchestrator") as never, now: () => clock, namespace: NS, mode, negotiated: { handleSession: (id) => n.handleSession(id), handleSubscription: (s, h) => n.handleSubscription(s, h), handleCharge: (c, i, s) => n.handleCharge(c, i, s) } });
  const reconciler = new StripeReconciler({ store: stripeStore, gateway, processor, now: () => clock, mode, negotiated: { toRefresh: (b, l) => n.toRefresh(b, l), closeExpiredSessions: (l) => n.closeExpiredSessions(l), reconcileAll: (l) => n.reconcileAll(l) } });
  return { neg, billing, adapter, processor, reconciler };
}

const cat = (key: string, over: Partial<Extract<LineInput, { kind: "catalog" }>> = {}): LineInput => ({ kind: "catalog", productKey: key, priceId: P[key], ...over });
const custom = (name: string, unitCents: number, over: Partial<Extract<LineInput, { kind: "custom" }>> = {}): LineInput => ({ kind: "custom", concept: "maintenance", name, chargeClass: "recurring", unitCents, taxRateBp: 2100, ...over });
const PACKAGE = (over: Partial<TermsInput> = {}): TermsInput => ({ pricingMode: "global", globalAmountCents: 12900, presentation: "global", reason: "Acuerdo comercial negociado", lines: [cat("essential"), cat("hotel-net"), cat("whatsapp")], ...over });

/** Suscripción con un acuerdo activo (en simulación: nadie la ha puesto a cobrar). */
async function agreed(companyId: number, input: TermsInput = PACKAGE()) {
  const sub = await subs.create({ companyId, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
  const draft = await terms.createForSubscription(sub.id, input, A);
  const out = await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: sub.version }, A);
  return { subId: sub.id, termsId: out.terms.id };
}
const applyNew = async (subId: number, input: TermsInput) => {
  const draft = await terms.createForSubscription(subId, input, A);
  return terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(subId)).version }, A);
};

/** Entrega a los webhooks los eventos que el doble ha emitido (cada uno, una vez) y los procesa. */
async function deliver(w: World) {
  for (const ev of gw.events.slice().reverse()) await stripeStore.recordEvent({ eventId: ev.id, type: ev.type, apiVersion: ev.apiVersion, objectType: ev.objectType, objectId: ev.objectId, stripeCreated: ev.created, source: "webhook", now: clock });
  return w.processor.processDue(200);
}
/** Puesta en cobro completa: el operador la inicia, el cliente paga en Stripe y llegan los webhooks. */
async function started(w: World, subId: number) {
  const s = await w.neg.start(subId, A);
  if (s.status !== "pending") throw new Error(`se esperaba una sesión pendiente y está ${s.status}`);
  const stripeId = gw.completeNegotiatedSession(s.sessionId);
  await deliver(w);
  return { stripeId, sessionId: s.sessionId };
}
const row = async (subId: number) => (await billingStore.bySubscription(subId))!;
const sessionCreates = () => gw.calls.filter((c) => c.op === "checkout.sessions.create(negotiated)");
const itemWrites = () => gw.calls.filter((c) => c.op === "subscriptions.update(negotiated)");
const oneOffWrites = () => gw.calls.filter((c) => c.op === "invoiceitems.create");
const grant = (tenantId: string, capabilityId: string, source: string, status: "active" | "suspended" = "active") => caps.apply(tenantId, [{ capabilityId, siteId: "", status, validUntil: null, source }], { actor: A, reason: "prueba", now: clock });
const statusOf = async (tenantId: string) => Object.fromEntries((await caps.list(tenantId)).map((g) => [g.capabilityId, g.status]));

describe("cerrojos", () => {
  it("apagado por defecto: ninguna llamada a Stripe (pasarela que falla en cualquier llamada) y nada cambia", async () => {
    const seen: string[] = [];
    const w = world({ enabled: false, gateway: exploding(seen) });
    const a = await agreed(1);
    await expect(w.neg.start(a.subId, A)).rejects.toMatchObject({ code: "disabled" });
    await expect(w.neg.setCancel(a.subId, true, A)).rejects.toMatchObject({ code: "disabled" });
    expect((await w.billing.sync(a.subId, A)).status).toBe("disabled");
    expect(await w.billing.syncIfOpen(a.subId)).toBeNull();
    expect((await w.billing.reconcile(a.subId)).available).toBe(false);
    expect(await w.neg.reconcileAll()).toEqual({ checked: 0, drifted: [], errors: 0 });
    expect(await w.neg.toRefresh(clock + DAY)).toEqual([]);
    expect(await w.neg.closeExpiredSessions()).toBe(0);
    // Cambiar las condiciones tampoco llama a Stripe
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect((await w.neg.status(a.subId)).canStart).toBe(false);
    expect(seen).toEqual([]);
    expect(await billingStore.bySubscription(a.subId)).toBeNull();
    expect(await stripeStore.customerByCompany(1)).toBeNull();
  });

  it("encender el interruptor no cobra a nadie: sin puesta en cobro expresa no hay enlace ni llamadas", async () => {
    const seen: string[] = [];
    const w = world({ enabled: true, gateway: exploding(seen) });
    const a = await agreed(1);
    expect(w.billing.open).toBe(true);
    expect((await w.billing.sync(a.subId, A)).status).toBe("not_linked");
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect((await w.billing.reconcile(a.subId)).available).toBe(false);
    expect(await w.neg.reconcileAll()).toMatchObject({ checked: 0 });
    expect(await w.neg.toRefresh(clock + DAY)).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("una suscripción ORDINARIA de un cliente nunca se modifica, ni siquiera con un registro forzado apuntando a ella", async () => {
    const w = world();
    const a = await agreed(1);
    // Suscripción ordinaria viva en Stripe (de un pedido), con sus Prices oficiales
    const cus = await gw.createCustomer({ name: "Cliente ordinario", email: null, metadata: {} }, "k-ordinario");
    const s = await gw.createCheckoutSession({ customerId: cus.id, priceId: "price_essential", clientReferenceId: "es-order-7", metadata: { es_order_id: "7", es_env: NS }, successUrl: "https://x.example/ok", cancelUrl: "https://x.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "x" }, "k-cs");
    const ordinarySub = gw.completeSession(s.id);
    const before = JSON.stringify(gw.subscriptions.get(ordinarySub));
    // Registro forzado a mano (algo que el servicio nunca hace): la pasarela lo rechaza al releer la suscripción
    const forced = (await billingStore.create({ subscriptionId: a.subId, companyId: 1, stripeCustomerId: cus.id, startedBy: A, now: clock })).row;
    await billingStore.patch(forced.id, { stripeSubscriptionId: ordinarySub, status: "active" }, forced.version, clock);
    const out = await w.billing.sync(a.subId, A);
    expect(out).toMatchObject({ status: "failed" });
    expect((out as { error: string }).error).toMatch(/no es de condiciones personalizadas/);
    await expect(w.adapter.applyItems({ subscriptionId: ordinarySub, currency: "EUR", items: [{ key: "essential", name: "E", product: { kind: "catalog", productKey: "essential" }, amountCents: 100, interval: "month", taxRateBp: 2100 }], metadata: {} }, "k")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    await expect(w.adapter.addOneOff({ subscriptionId: ordinarySub, customerId: cus.id, currency: "EUR", item: { key: "charge:1", name: "X", amountCents: 100, taxRateBp: 2100 }, metadata: {} }, "k2")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    await expect(w.adapter.setCancelAtPeriodEnd(ordinarySub, true, "k3")).rejects.toBeInstanceOf(NegotiatedGatewayError);
    // Y una que ni siquiera consta en el registro no llega a leerse en Stripe
    const reads = gw.calls.length;
    await expect(w.adapter.current("sub_de_otro_cliente")).rejects.toMatchObject({ code: "not_negotiated" });
    expect(gw.calls.length).toBe(reads);
    expect(gw.negotiatedWrites()).toEqual([]);
    expect(JSON.stringify(gw.subscriptions.get(ordinarySub))).toBe(before);
  });

  it("no se pone a cobrar lo que ya cobra el circuito ordinario, ni sin condiciones vigentes, ni en live sin política fiscal", async () => {
    world();
    const a = await agreed(1);
    await expect(world({ orderBilled: async () => true }).neg.start(a.subId, A)).rejects.toThrow(/circuito ordinario/);
    const plain = await subs.create({ companyId: 2, interval: "month", plan: { productKey: "essential", priceId: P.essential } }, A);
    await expect(world().neg.start(plain.id, A)).rejects.toThrow(/no tiene condiciones personalizadas/);
    await expect(world({ mode: "live", taxPolicy: null }).neg.start(a.subId, A)).rejects.toThrow(/Política fiscal pendiente/);
    expect(gw.calls).toEqual([]);
    expect(await billingStore.bySubscription(a.subId)).toBeNull();
  });

  it("la línea de arranque dice el estado del cobro", () => {
    expect(describeTermsBilling({ switchOn: false, registry: true, stripe: { mode: "live", taxPolicy: "stripe_tax_exclusive", urls: true } })).toEqual({ stripeBilling: "off", stripeBillingScope: "explicit_start_only", stripeBillingMode: "live" });
    expect(describeTermsBilling({ switchOn: true, registry: true, stripe: { mode: "live", taxPolicy: "stripe_tax_exclusive", urls: true } })).toMatchObject({ stripeBilling: "on", stripeBillingMode: "live" });
    expect(describeTermsBilling({ switchOn: true, registry: false, stripe: null })).toMatchObject({ stripeBilling: "switch_on_blocked", stripeBillingReasons: ["crm_migration_0049_missing", "stripe_not_mounted"] });
    expect(describeTermsBilling({ switchOn: true, registry: true, stripe: { mode: "live", taxPolicy: null, urls: false } })).toMatchObject({ stripeBilling: "switch_on_blocked", stripeBillingReasons: ["checkout_urls_missing", "tax_policy_pending"] });
  });
});

describe("puesta en cobro: Checkout con las partidas negociadas, sin duplicados", () => {
  it("abre UNA sesión con precios en línea sobre los Products del catálogo; no crea ni toca Prices ni Products", async () => {
    const w = world();
    const a = await agreed(1);
    const s = await w.neg.start(a.subId, A);
    expect(s).toMatchObject({ status: "pending", reused: false, currency: "EUR", recurringCents: 12900, firstChargeCents: 12900, taxTreatment: "test_net_no_tax", deferredCredits: [] });
    const input = sessionCreates()[0].input as NegotiatedCheckoutInput;
    expect(sessionCreates()[0].key).toBe(`es-${NS}-terms-checkout-${a.subId}-1`);
    expect(input.lines.map((l) => [l.productId, l.interval]).sort()).toEqual([["prod_essential", "month"], ["prod_hotel-net", "month"], ["prod_whatsapp", "month"]]);
    expect(input.lines.reduce((x, l) => x + l.unitAmount, 0)).toBe(12900);
    expect(input.metadata).toMatchObject({ es_negotiated: "1", es_terms_subscription: String(a.subId), es_terms: String(a.termsId), es_company_id: "1", es_env: NS });
    expect(input.automaticTax).toBeUndefined();
    // El catálogo de Stripe queda como estaba
    expect(gw.prices.map((p) => [p.id, p.unitAmount])).toEqual([["price_essential", 2900], ["price_hotel-net", 11900], ["price_whatsapp", 2900]]);
    expect(Array.from(gw.products.keys())).toEqual(["prod_essential", "prod_hotel-net", "prod_whatsapp"]);
    // Aún no hay enlace: sigue sin cobrarse nada
    expect(await w.neg.link(a.subId)).toBeNull();
    expect((await w.billing.sync(a.subId, A)).status).toBe("not_linked");
    expect((await termsStore.events({ termsId: a.termsId })).some((e) => e.kind === "billing_started")).toBe(true);
  });

  it("repetir la acción devuelve la misma sesión; nunca una segunda sesión ni un segundo Customer", async () => {
    const w = world();
    const a = await agreed(1);
    const first = await w.neg.start(a.subId, A);
    clock += 60_000;
    const again = await w.neg.start(a.subId, "operator:berta");
    expect(again).toMatchObject({ status: "pending", reused: true, sessionId: (first as { sessionId: string }).sessionId, url: (first as { url: string }).url });
    expect(sessionCreates()).toHaveLength(1);
    expect(gw.calls.filter((c) => c.op === "customers.create")).toHaveLength(1);
    expect(gw.customers.size).toBe(1);
  });

  it("reutiliza el Customer que la empresa ya tiene en Stripe (no crea otro)", async () => {
    const w = world();
    const existing = await gw.createCustomer({ name: "Empresa 2 SL", email: null, metadata: { es_company_id: "2" } }, "k-prev");
    await stripeStore.linkCustomer({ companyId: 2, tenantId: null, stripeCustomerId: existing.id, now: clock });
    gw.calls.length = 0;
    const a = await agreed(2);
    await w.neg.start(a.subId, A);
    expect(gw.calls.filter((c) => c.op === "customers.create")).toHaveLength(0);
    expect((sessionCreates()[0].input as NegotiatedCheckoutInput).customerId).toBe(existing.id);
    expect((await row(a.subId)).stripeCustomerId).toBe(existing.id);
  });

  it("dos operadores a la vez: una sola sesión", async () => {
    const w = world();
    const a = await agreed(1);
    const out = await Promise.allSettled([w.neg.start(a.subId, A), w.neg.start(a.subId, "operator:berta")]);
    expect(sessionCreates()).toHaveLength(1);
    expect(out.filter((r) => r.status === "fulfilled")).not.toHaveLength(0);
    for (const r of out) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
    expect(Array.from(gw.sessions.values()).filter((s) => s.status === "open")).toHaveLength(1);
  });

  it("si las condiciones cambian antes de pagar, la sesión anterior se cierra y se abre otra con lo vigente", async () => {
    const w = world();
    const a = await agreed(1);
    const first = (await w.neg.start(a.subId, A)) as { sessionId: string };
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    const second = await w.neg.start(a.subId, A);
    expect(second).toMatchObject({ status: "pending", reused: false, recurringCents: 9900 });
    expect(gw.sessions.get(first.sessionId)!.status).toBe("expired");
    expect(Array.from(gw.sessions.values()).filter((s) => s.status === "open")).toHaveLength(1);
  });

  it("caída entre crear la sesión en Stripe y guardarla: la huérfana se cierra; si ya estaba pagada, se adopta", async () => {
    const w = world();
    const a = await agreed(1);
    const first = (await w.neg.start(a.subId, A)) as { sessionId: string };
    // El registro «olvida» la sesión (como si el proceso hubiera caído antes de guardarla)
    let r = await row(a.subId);
    await billingStore.patch(r.id, { sessionId: null, sessionStatus: null }, r.version, clock);
    const second = (await w.neg.start(a.subId, A)) as { sessionId: string; status: string };
    expect(second.status).toBe("pending");
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(gw.sessions.get(first.sessionId)!.status).toBe("expired");
    expect(Array.from(gw.sessions.values()).filter((s) => s.status === "open")).toHaveLength(1);
    // Ahora la huérfana ya está PAGADA: no se abre otra; se enlaza su suscripción
    r = await row(a.subId);
    await billingStore.patch(r.id, { sessionId: null, sessionStatus: null }, r.version, clock);
    const stripeId = gw.completeNegotiatedSession(second.sessionId);
    const third = await w.neg.start(a.subId, A);
    expect(third).toMatchObject({ status: "linked", stripeSubscriptionId: stripeId, state: "active" });
    expect(sessionCreates()).toHaveLength(2);
    expect(gw.subscriptions.size).toBe(1);
  });

  it("partidas a medida y cargos únicos van sobre el Product genérico; un abono de un solo uso va a la factura siguiente", async () => {
    const w = world();
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), custom("Mantenimiento personalizado", 5000), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial" })], adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }] }));
    const s = await w.neg.start(a.subId, A);
    expect(s).toMatchObject({ status: "pending", recurringCents: 12900, firstChargeCents: 62900 });
    expect((s as { deferredCredits: Array<{ amountCents: number }> }).deferredCredits.map((c) => c.amountCents)).toEqual([-2900]);
    const input = sessionCreates()[0].input as NegotiatedCheckoutInput;
    expect(input.lines.filter((l) => l.interval === null).map((l) => [l.productId, l.unitAmount])).toEqual([[CUSTOM_SERVICE_PRODUCT_ID, 50000]]);
    expect(input.lines.filter((l) => l.productId === CUSTOM_SERVICE_PRODUCT_ID && l.interval === "month")).toHaveLength(1);
    expect(input.lines.every((l) => l.unitAmount >= 0)).toBe(true);
    // En pruebas el Product genérico se crea solo; el catálogo enlazado no cambia
    expect(gw.products.has(CUSTOM_SERVICE_PRODUCT_ID)).toBe(true);
    expect(gw.prices).toHaveLength(3);
  });

  it("en live no se crea el Product genérico: sin él, una partida a medida no se pone a cobrar", async () => {
    const fiscal: EligibilityConfig = { scenarios: new Set(["business:es_mainland"]), taxExpectations: new Map([["business:es_mainland", "taxed"]]), countries: new Map(), consumerRates: new Map() } as never;
    const w = world({ mode: "live", fiscal });
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), custom("Mantenimiento personalizado", 5000)] }));
    await expect(w.neg.start(a.subId, A)).rejects.toThrow(/Falta en Stripe el Product genérico/);
    expect(gw.products.has(CUSTOM_SERVICE_PRODUCT_ID)).toBe(false);
    expect(sessionCreates()).toHaveLength(0);
    // Con el Product creado por el propietario, sí
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    expect((await w.neg.start(a.subId, A)).status).toBe("pending");
  });

  it("un producto de catálogo sin Product enlazado en Stripe no se cobra con otro", async () => {
    const w = world();
    stripeStore.prices.forEach((p) => {
      if (p.lookupKey.startsWith("es:whatsapp:")) (p as { status: string }).status = "archived";
    });
    const a = await agreed(1);
    await expect(w.neg.start(a.subId, A)).rejects.toThrow(/whatsapp.*no tiene Product enlazado/);
    expect(sessionCreates()).toHaveLength(0);
  });
});

describe("live: impuestos como el resto del cobro (importes sin IVA + Stripe Tax) y elegibilidad fiscal", () => {
  const fiscal = { scenarios: new Set(["business:es_mainland"]), taxExpectations: new Map([["business:es_mainland", "taxed"]]), countries: new Map(), consumerRates: new Map() } as unknown as EligibilityConfig;

  it("la sesión activa Stripe Tax; sin datos fiscales válidos de la empresa no se abre el pago", async () => {
    const w = world({ mode: "live", fiscal });
    const a = await agreed(1);
    const s = await w.neg.start(a.subId, A);
    expect(s).toMatchObject({ status: "pending", taxTreatment: "stripe_tax_exclusive" });
    expect((sessionCreates()[0].input as NegotiatedCheckoutInput).automaticTax).toBe(true);
    expect(gw.calls.find((c) => c.op === "customers.create")!.input).toMatchObject({ address: { country: "ES", postalCode: "28001", line1: "Calle Mayor 1", city: "Madrid" }, taxIds: [{ type: "es_cif", value: "B12345674" }] });
    // Empresa sin NIF, o en un territorio sin escenario aprobado (Canarias): se rechaza ANTES de crear nada en Stripe
    companies.set(2, { ...companies.get(2)!, taxId: null });
    const b = await agreed(2);
    await expect(w.neg.start(b.subId, A)).rejects.toThrow(/identificador fiscal/);
    companies.set(3, { ...companies.get(3)!, postalCode: "35001" });
    const c = await agreed(3);
    await expect(w.neg.start(c.subId, A)).rejects.toThrow(/pendiente de aprobación/);
    expect(sessionCreates()).toHaveLength(1);
    expect(gw.customers.size).toBe(1);
  });

  it("con Stripe Tax no hay tipo fijo por partida: no cuenta como diferencia; un impuesto que no es el pactado se avisa", async () => {
    gw.invoiceTaxBp = 2100;
    const w = world({ mode: "live", fiscal });
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const remote = (await w.adapter.current(stripeId))!;
    expect(remote.tax).toEqual({ mode: "automatic", expected: "automatic" });
    expect(remote.items.every((i) => i.taxRateBp === null)).toBe(true);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ available: true, consistent: true });
    expect((await billingStore.invoices((await row(a.subId)).id))[0]).toMatchObject({ status: "paid", subtotalCents: 12900, taxCents: 2709, taxCheck: "ok" });
    expect(alerts.count("stripe.negotiated_tax_mismatch")).toBe(0);
    // Renovación en la que Stripe Tax no aplica impuesto (el acuerdo dice 21 %): queda registrado y se avisa
    gw.invoiceTaxBp = 0;
    gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect((await billingStore.invoices((await row(a.subId)).id)).find((i) => i.billingReason === "subscription_cycle")).toMatchObject({ taxCents: 0, taxCheck: "tax_mismatch" });
    expect(alerts.count("stripe.negotiated_tax_mismatch")).toBe(1);
    // Una suscripción sin Stripe Tax en live es una diferencia de conciliación
    gw.negotiated.get(stripeId)!.automaticTax = false;
    expect((await w.billing.reconcile(a.subId)).differences).toEqual([{ key: "impuestos:none", kind: "tax", expectedCents: null, stripeCents: null }]);
  });

  it("comprobación del impuesto de una factura frente al tipo pactado", () => {
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 12900, taxCents: 2709, lines: [] })).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 12900, taxCents: 2710, lines: [] })).toBe("tax_mismatch");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 12900, taxCents: 0, lines: [] })).toBe("tax_mismatch");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100, 1000], { subtotal: 10000, taxCents: 1500, lines: [] })).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 12900, taxCents: null, lines: [] })).toBe("tax_unknown");
    expect(invoiceTaxCheck("test_net_no_tax", [2100], { subtotal: 12900, taxCents: null, lines: [] })).toBeNull();
  });
});

describe("enlace por los webhooks existentes", () => {
  it("al pagar el cliente, la suscripción de Stripe queda enlazada; el circuito ordinario ni se entera", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    expect(await row(a.subId)).toMatchObject({ status: "active", stripeSubscriptionId: stripeId, sessionStatus: "complete" });
    expect(await w.neg.link(a.subId)).toEqual({ customerId: (await row(a.subId)).stripeCustomerId, subscriptionId: stripeId });
    expect(ordinary).toEqual([]);
    expect(Array.from(stripeStore.events.values()).every((e) => e.status === "processed")).toBe(true);
    expect(alerts.count("stripe.event_mismatch")).toBe(0);
    // Solo productos de catálogo: sus partidas se reconocen por su Product y no hace falta escribir nada más
    expect(itemWrites()).toHaveLength(0);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ available: true, consistent: true });
    // Repetir la puesta en cobro no crea nada: devuelve el enlace
    expect(await w.neg.start(a.subId, A)).toEqual({ status: "linked", subscriptionId: a.subId, stripeSubscriptionId: stripeId, state: "active" });
    expect(sessionCreates()).toHaveLength(1);
    expect(gw.subscriptions.size).toBe(1);
  });

  it("un webhook repetido o fuera de orden no cambia nada", async () => {
    const w = world();
    const a = await agreed(1);
    await started(w, a.subId);
    const before = JSON.stringify([await row(a.subId), await billingStore.invoices((await row(a.subId)).id), (await termsStore.events({ subscriptionId: a.subId })).length]);
    const writes = gw.negotiatedWrites().length;
    for (const ev of gw.events) expect((await w.processor.process({ eventId: ev.id, type: ev.type, objectId: ev.objectId })).outcome).toBe("processed");
    const after = await row(a.subId);
    expect(JSON.stringify([{ ...after, version: (JSON.parse(before)[0] as { version: number }).version, syncedAt: (JSON.parse(before)[0] as { syncedAt: number }).syncedAt, updatedAt: (JSON.parse(before)[0] as { updatedAt: number }).updatedAt }, await billingStore.invoices(after.id), (await termsStore.events({ subscriptionId: a.subId })).length])).toBe(before);
    expect(gw.negotiatedWrites().length).toBe(writes);
  });

  it("los cargos del primer pago no se vuelven a enviar; las partidas a medida reciben su clave y el abono va una vez a la factura siguiente", async () => {
    const w = world();
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), custom("Mantenimiento personalizado", 5000), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial" })], adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }] }));
    const { stripeId } = await started(w, a.subId);
    expect((await billingStore.invoices((await row(a.subId)).id))[0]).toMatchObject({ billingReason: "subscription_create", subtotalCents: 62900, status: "paid" });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    // Tras enlazar: una sustitución de partidas sin prorrateo (claves) y UN importe único: el abono
    expect(itemWrites()).toHaveLength(1);
    expect((itemWrites()[0].input as NegotiatedItemsChange).add.every((x) => x.metadata.es_line)).toBe(true);
    expect(gw.invoiceItems.map((i) => i.amount)).toEqual([-2900]);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(12900);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ available: true, consistent: true });
    // Sincronizar de nuevo, y renovar: nada se duplica; la renovación cobra la cuota menos el abono, una vez
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    const renewal = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect(gw.invoices.get(renewal)!.subtotal).toBe(12900 - 2900);
    expect(gw.invoices.get(gw.chargeNegotiatedPeriod(stripeId))!.subtotal).toBe(12900);
    expect(oneOffWrites()).toHaveLength(1);
  });

  it("si el cliente no llega a pagar, no hay enlace y se puede volver a iniciar", async () => {
    const w = world();
    const a = await agreed(1);
    const s = (await w.neg.start(a.subId, A)) as { sessionId: string };
    const stripeId = gw.completeNegotiatedSession(s.sessionId, "incomplete");
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "pending", stripeSubscriptionId: stripeId });
    expect(await w.neg.link(a.subId)).toBeNull();
    expect((await w.neg.start(a.subId, A)).status).toBe("processing");
    gw.updateSubscription(stripeId, { status: "incomplete_expired" });
    gw.emit("customer.subscription.updated", "subscription", stripeId);
    await deliver(w);
    expect((await row(a.subId)).status).toBe("abandoned");
    const again = await w.neg.start(a.subId, A);
    expect(again).toMatchObject({ status: "pending", reused: false });
    expect(sessionCreates()).toHaveLength(2);
    // Un evento atrasado del intento muerto no pisa la sesión nueva: sigue viva y es la única
    await w.processor.process({ eventId: "atrasado", type: "customer.subscription.updated", objectId: stripeId });
    expect(await row(a.subId)).toMatchObject({ status: "pending", sessionId: (again as { sessionId: string }).sessionId, stripeSubscriptionId: null });
    expect(await w.neg.start(a.subId, A)).toMatchObject({ status: "pending", reused: true, sessionId: (again as { sessionId: string }).sessionId });
    expect(Array.from(gw.sessions.values()).filter((x) => x.status === "open")).toHaveLength(1);
    const live = gw.completeNegotiatedSession((again as { sessionId: string }).sessionId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", stripeSubscriptionId: live });
  });

  it("una segunda suscripción de Stripe para la misma contratación no se enlaza y se avisa", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId, sessionId } = await started(w, a.subId);
    // Stripe crea otra suscripción con los mismos metadatos (p. ej. una sesión pagada dos veces)
    const dup = gw.completeNegotiatedSession(sessionId);
    await deliver(w);
    expect((await row(a.subId)).stripeSubscriptionId).toBe(stripeId);
    expect(dup).not.toBe(stripeId);
    expect(alerts.count("stripe.negotiated_duplicate")).toBeGreaterThan(0);
    await expect(w.adapter.current(dup)).rejects.toMatchObject({ code: "not_negotiated" });
  });

  it("una suscripción marcada como negociada sin puesta en cobro se ignora con aviso; una ordinaria no llega al módulo", async () => {
    const w = world();
    const a = await agreed(1);
    const cus = await gw.createCustomer({ name: "X", email: null, metadata: {} }, "k");
    gw.subscriptions.set("sub_test_intrusa", { id: "sub_test_intrusa", customerId: cus.id, status: "active", cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: 1_900_000_000, latestInvoiceId: null, priceIds: [], metadata: { es_negotiated: "1", es_terms_subscription: String(a.subId), es_company_id: "1", es_env: NS } });
    gw.emit("customer.subscription.updated", "subscription", "sub_test_intrusa");
    expect(await deliver(w)).toMatchObject({ ignored: 1, processed: 0 });
    expect(alerts.count("stripe.event_mismatch")).toBe(1);
    expect(await billingStore.bySubscription(a.subId)).toBeNull();
    // De otro entorno: se ignora sin aviso
    gw.subscriptions.set("sub_test_otra", { ...gw.subscriptions.get("sub_test_intrusa")!, id: "sub_test_otra", metadata: { es_negotiated: "1", es_terms_subscription: "1", es_env: "otro" } });
    expect(await w.processor.process({ eventId: "e", type: "customer.subscription.updated", objectId: "sub_test_otra" })).toEqual({ outcome: "ignored", detail: "Condiciones personalizadas de otro entorno o sin módulo" });
    // Una suscripción de un pedido sigue yendo al circuito ordinario (aquí, a su trampa), nunca al de condiciones
    gw.subscriptions.set("sub_test_pedido", { ...gw.subscriptions.get("sub_test_intrusa")!, id: "sub_test_pedido", priceIds: ["price_essential"], metadata: { es_order_id: "9", es_env: NS, es_negotiated: "1" } });
    await expect(w.processor.process({ eventId: "e2", type: "customer.subscription.updated", objectId: "sub_test_pedido" })).rejects.toThrow(/circuito ordinario no permitido: orders.get/);
  });
});

describe("estado de pago por los webhooks: mismas reglas que el cobro ordinario", () => {
  async function licensed(w: World, companyId = 1) {
    const a = await agreed(companyId);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    const own = `subscription:${a.subId}`;
    await grant("t-acme", "plan.essential", own);
    await grant("t-acme", "module.hotel", own);
    await grant("t-acme", "tpv.legacy", "acquired:tpv");
    return { ...a, stripeId, own };
  }

  it("renovación cobrada: factura registrada y el periodo interno avanza; repetir el evento no la duplica", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const period = (await subs.must(a.subId)).currentPeriodEnd;
    clock = period + 60_000;
    const inv = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect((await subs.must(a.subId)).currentPeriodStart).toBe(period);
    const invoices = await billingStore.invoices((await row(a.subId)).id);
    expect(invoices.map((i) => [i.billingReason, i.status, i.subtotalCents])).toEqual(expect.arrayContaining([["subscription_cycle", "paid", 12900], ["subscription_create", "paid", 12900]]));
    expect(await row(a.subId)).toMatchObject({ status: "active", lastPaidInvoiceId: inv });
    const events = (await termsStore.events({ subscriptionId: a.subId })).filter((e) => e.kind === "billing_payment").length;
    await w.processor.process({ eventId: "rep", type: "invoice.paid", objectId: inv });
    expect((await billingStore.invoices((await row(a.subId)).id)).length).toBe(invoices.length);
    expect((await termsStore.events({ subscriptionId: a.subId })).filter((e) => e.kind === "billing_payment").length).toBe(events);
    expect((await subs.must(a.subId)).currentPeriodStart).toBe(period);
  });

  it("impago → gracia; gracia vencida → licencias propias suspendidas; cobro recuperado → se devuelven solo esas", async () => {
    const w = world();
    const a = await licensed(w);
    const failed = gw.chargeNegotiatedPeriod(a.stripeId, "open");
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "past_due", graceEndsAt: clock + 7 * DAY });
    // En gracia no se toca ninguna licencia; el enlace sigue vivo
    expect(await statusOf("t-acme")).toEqual({ "plan.essential": "active", "module.hotel": "active", "tpv.legacy": "active" });
    expect(await w.neg.link(a.subId)).not.toBeNull();
    // Un operador bloquea una licencia por su cuenta durante el impago
    await grant("t-acme", "module.hotel", a.own, "suspended");
    // Vence la gracia y Stripe sigue en impago: la conciliación la relee y suspende
    clock += 7 * DAY + 60_000;
    await w.reconciler.tick();
    expect((await row(a.subId)).status).toBe("suspended");
    expect(await statusOf("t-acme")).toEqual({ "plan.essential": "suspended", "module.hotel": "suspended", "tpv.legacy": "active" });
    expect((await row(a.subId)).suspendedCapabilities).toEqual([{ capabilityId: "plan.essential", siteId: "" }]);
    // El cliente paga la factura pendiente: vuelve lo que suspendió el impago; lo que bloqueó el operador, no
    gw.invoices.set(failed, { ...gw.invoices.get(failed)!, status: "paid", amountPaid: 12900 });
    gw.updateSubscription(a.stripeId, { status: "active" });
    gw.emit("invoice.paid", "invoice", failed);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", graceEndsAt: null, suspendedCapabilities: null });
    expect(await statusOf("t-acme")).toEqual({ "plan.essential": "active", "module.hotel": "suspended", "tpv.legacy": "active" });
    expect((await termsStore.events({ subscriptionId: a.subId })).filter((e) => e.kind === "billing_state").map((e) => e.reason)).toEqual(["Cobro en Stripe: pending → active", "Cobro en Stripe: active → past_due", "Cobro en Stripe: past_due → suspended", "Cobro en Stripe: suspended → active"]);
  });

  it("Stripe agota los reintentos (unpaid): suspensión inmediata", async () => {
    const w = world();
    const a = await licensed(w);
    gw.chargeNegotiatedPeriod(a.stripeId, "open");
    gw.updateSubscription(a.stripeId, { status: "unpaid" });
    await deliver(w);
    expect((await row(a.subId)).status).toBe("suspended");
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("suspended");
  });

  it("fin en Stripe: licencias propias en solo lectura 30 días, la suscripción interna termina y deja de haber enlace", async () => {
    const w = world();
    const a = await licensed(w);
    gw.updateSubscription(a.stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", a.stripeId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: clock + 30 * DAY });
    expect(await statusOf("t-acme")).toEqual({ "plan.essential": "read_only", "module.hotel": "read_only", "tpv.legacy": "active" });
    expect((await caps.list("t-acme")).find((g) => g.capabilityId === "plan.essential")!.validUntil).toBe(clock + 30 * DAY);
    expect((await subs.must(a.subId)).cancelAt).not.toBeNull();
    expect(await w.neg.link(a.subId)).toBeNull();
    expect((await w.billing.sync(a.subId, A)).status).toBe("not_linked");
    await expect(w.neg.start(a.subId, A)).rejects.toThrow(/ya terminó/);
  });

  it("cancelación programada en Stripe (p. ej. desde el portal) y su vuelta atrás", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    await gw.setCancelAtPeriodEnd(stripeId, true, "portal-1");
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "cancel_scheduled" });
    expect((await row(a.subId)).cancelAt).not.toBeNull();
    await gw.setCancelAtPeriodEnd(stripeId, false, "portal-2");
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", cancelAt: null });
  });

  it("el operador programa el fin (al final del periodo pagado) y lo deshace; nunca hay cargo ni abono", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const invoices = gw.invoices.size;
    expect((await w.neg.setCancel(a.subId, true, A)).billing).toMatchObject({ status: "cancel_scheduled" });
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
    expect((await w.neg.setCancel(a.subId, false, A)).billing).toMatchObject({ status: "active" });
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(false);
    expect(gw.invoices.size).toBe(invoices);
  });

  it("cancelar la contratación interna termina Stripe al final del periodo (sincronización o conciliación)", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    await subs.scheduleCancel(a.subId, { reason: "Baja pedida por el cliente" }, (await subs.must(a.subId)).version, A);
    expect((await w.billing.reconcile(a.subId)).differences).toEqual([{ key: "fin_sin_programar", kind: "status", expectedCents: null, stripeCents: null }]);
    // La conciliación lo programa sola (único arreglo automático: deja de renovar); no cancela de inmediato
    clock += 20 * 60_000;
    const r = await w.reconciler.tick();
    expect(r.negotiated).toMatchObject({ checked: 1, drifted: [] });
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
    expect(gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)")).toHaveLength(1);
    // Repetir no vuelve a escribir, y deshacerlo en Stripe con la contratación interna terminando se rechaza
    await w.billing.sync(a.subId, A);
    expect(gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)")).toHaveLength(1);
    await expect(w.neg.setCancel(a.subId, false, A)).rejects.toThrow(/deshazlo primero/);
  });

  it("cobro revertido (reembolso total) del último periodo: suspendida hasta un pago nuevo", async () => {
    const w = world();
    const a = await licensed(w);
    const first = (await row(a.subId)).lastPaidInvoiceId!;
    const charge = gw.chargeForInvoice(first);
    gw.refund(charge);
    gw.emit("charge.refunded", "charge", charge);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "suspended", heldInvoiceId: first });
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("suspended");
    expect(alerts.count("stripe.coverage_lost")).toBe(1);
    expect((await w.neg.status(a.subId)).billing).toMatchObject({ coverageHeld: true });
    // Stripe sigue mostrando «active»: una relectura no la reactiva
    gw.emit("customer.subscription.updated", "subscription", a.stripeId);
    await deliver(w);
    expect((await row(a.subId)).status).toBe("suspended");
    // Un periodo nuevo pagado levanta la retención
    gw.chargeNegotiatedPeriod(a.stripeId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", heldInvoiceId: null });
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("active");
    expect(ordinary).toEqual([]);
  });

  it("correspondencia de estados de Stripe", () => {
    expect((["active", "trialing", "past_due", "unpaid", "paused", "canceled", "incomplete_expired", "incomplete"] as const).map(mapStripeStatus)).toEqual(["active", "active", "past_due", "unpaid", "unpaid", "canceled", "canceled", null]);
  });

  it("estado público de la sesión (mismo contrato que el alta ordinaria)", async () => {
    const w = world();
    const a = await agreed(1);
    const s = (await w.neg.start(a.subId, A)) as { sessionId: string };
    expect(await w.neg.publicStatus("cs_test_desconocida", "plataforma.example")).toBeNull();
    expect((await w.neg.publicStatus(s.sessionId, "plataforma.example"))!.state).toBe("pending_payment");
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    gw.completeNegotiatedSession(s.sessionId);
    await deliver(w);
    expect(await w.neg.publicStatus(s.sessionId, "plataforma.example")).toMatchObject({ state: "ready", accessUrl: "https://t-acme.plataforma.example" });
  });
});

describe("modificar las condiciones de una suscripción ya enlazada: la sincronización de siempre", () => {
  it("un acuerdo nuevo sustituye las partidas en línea sin prorrateo y sin tocar el catálogo", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const invoices = gw.invoices.size;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, lines: [cat("essential"), cat("hotel-net")] }));
    expect(itemWrites()).toHaveLength(1);
    expect(itemWrites()[0].key).toMatch(new RegExp(`^es-${NS}-ct:s${a.subId}:${stripeId}:items:`));
    expect(gw.negotiated.get(stripeId)!.items.map((i) => [i.metadata.es_line, i.productId]).sort()).toEqual([["essential", "prod_essential"], ["hotel-net", "prod_hotel-net"]]);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(9900);
    // Sin efectos retroactivos: ninguna factura ni cargo por el cambio; la renovación ya cobra lo nuevo
    expect(gw.invoices.size).toBe(invoices);
    expect(gw.invoices.get(gw.chargeNegotiatedPeriod(stripeId))!.subtotal).toBe(9900);
    expect(gw.prices.map((p) => p.unitAmount)).toEqual([2900, 11900, 2900]);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    expect((await termsStore.get((await w.billing.plan(a.subId)).termsId!))!.syncStatus).toBe("synced");
  });

  it("un cambio de periodicidad no se aplica solo en Stripe (reiniciaría el ciclo): queda como fallo visible", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    await expect(w.adapter.applyItems({ subscriptionId: stripeId, currency: "EUR", items: [{ key: "essential", name: "E", product: { kind: "catalog", productKey: "essential" }, amountCents: 100000, interval: "year", taxRateBp: 2100 }], metadata: {} }, "k")).rejects.toMatchObject({ code: "interval_change" });
    await expect(w.adapter.applyItems({ subscriptionId: stripeId, currency: "USD", items: [{ key: "essential", name: "E", product: { kind: "catalog", productKey: "essential" }, amountCents: 100, interval: "month", taxRateBp: 2100 }], metadata: {} }, "k")).rejects.toMatchObject({ code: "invalid_items" });
    expect(itemWrites()).toHaveLength(0);
  });
});

describe("conciliación e idempotencia", () => {
  it("una diferencia de importe en Stripe aparece en la conciliación y en sus avisos; sincronizar la corrige", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated).toMatchObject({ refreshed: 1, checked: 1, drifted: [], errors: 0 });
    // Alguien cambia un importe en Stripe a mano
    gw.negotiated.get(stripeId)!.items[0].unitAmount += 500;
    clock += 20 * 60_000;
    const r = await w.reconciler.tick();
    expect(r.negotiated!.drifted).toHaveLength(1);
    expect(r.negotiated!.drifted[0]).toMatchObject({ subscriptionId: a.subId });
    expect(r.negotiated!.drifted[0].differences.every((d) => d.kind === "item")).toBe(true);
    expect(alerts.count("stripe.negotiated_drift")).toBe(1);
    expect(await stripeStore.getState("terms_billing_reconcile")).toMatchObject({ checked: 1 });
    // Nunca se corrige sola: lo hace un operador al sincronizar
    expect(itemWrites()).toHaveLength(0);
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(12900);
  });

  it("repetir la sincronización no envía nada; dos a la vez dejan un solo efecto", async () => {
    const w = world();
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), custom("Mantenimiento personalizado", 5000)] }));
    await started(w, a.subId);
    const writes = gw.negotiatedWrites().length;
    for (let i = 0; i < 3; i++) expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(gw.negotiatedWrites().length).toBe(writes);
    // Cargo extraordinario nuevo y cambio de cuota, sincronizados dos veces a la vez
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 13900, lines: [cat("essential"), cat("hotel-net"), custom("Mantenimiento personalizado", 5000), custom("Migración de datos", 30000, { concept: "development", chargeClass: "extraordinary" })] }));
    await Promise.all([w.billing.sync(a.subId, A), w.billing.sync(a.subId, "operator:berta")]);
    const stripeId = (await row(a.subId)).stripeSubscriptionId!;
    expect(gw.invoiceItems.map((i) => i.amount)).toEqual([30000]);
    expect(gw.negotiated.get(stripeId)!.items).toHaveLength(3);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(13900);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
  });

  it("reintento tras un fallo parcial (también días después, con las claves de Stripe caducadas): nada se duplica", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    // Stripe cae justo después de aceptar las partidas nuevas y antes del cargo extraordinario
    const real = gw.createInvoiceItem.bind(gw);
    let fail = 1;
    gw.createInvoiceItem = async (i, k) => {
      if (fail-- > 0) {
        await real(i, k);
        throw new Error("Stripe no responde (se perdió la respuesta)");
      }
      return real(i, k);
    };
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 13900, lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Migración de datos", 30000, { concept: "development", chargeClass: "extraordinary" })] }));
    const termsId = (await w.billing.plan(a.subId)).termsId!;
    expect((await termsStore.get(termsId))!.syncStatus).toBe("failed");
    expect(gw.invoiceItems).toHaveLength(1);
    // Días después Stripe ya no recuerda las claves de idempotencia
    gw.forgetIdempotencyKeys();
    clock += 3 * DAY;
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(gw.invoiceItems.map((i) => i.amount)).toEqual([30000]);
    expect(itemWrites()).toHaveLength(1);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(13900);
    expect((await termsStore.get(termsId))!.syncStatus).toBe("synced");
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
  });

  it("con Stripe caído, la sincronización falla sin efectos y el reintento la completa", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    gw.down = true;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect((await termsStore.get((await w.billing.plan(a.subId)).termsId!))!.syncStatus).toBe("failed");
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(12900);
    gw.down = false;
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(9900);
  });

  it("una sesión que caduca sin pagarse se cierra en la conciliación", async () => {
    const w = world();
    const a = await agreed(1);
    const s = (await w.neg.start(a.subId, A)) as { sessionId: string };
    await gw.expireCheckoutSession(s.sessionId);
    clock += 3 * 3600_000;
    const r = await w.reconciler.tick();
    expect(r.sessionsClosed).toBe(1);
    expect(await row(a.subId)).toMatchObject({ status: "pending", sessionStatus: "expired" });
    expect((await w.neg.publicStatus(s.sessionId, null))!.state).toBe("expired");
    expect((await w.neg.start(a.subId, A)).status).toBe("pending");
  });
});

describe("errores de la API de puesta en cobro", () => {
  it("los códigos distinguen apagado, estado no válido y no encontrado", async () => {
    const w = world();
    await expect(w.neg.start(9999, A)).rejects.toMatchObject({ code: "not_found" });
    await expect(w.neg.setCancel(9999, true, A)).rejects.toBeInstanceOf(NegotiatedBillingError);
    const a = await agreed(1);
    await expect(w.neg.setCancel(a.subId, true, A)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await w.neg.status(a.subId)).toMatchObject({ enabled: true, canStart: true, blockers: [], billing: null, invoices: [] });
  });
});

describe("acuerdos sin plan Core: solo partidas a medida, sin plataforma ni licencias", () => {
  const fiscal = { scenarios: new Set(["business:es_mainland"]), taxExpectations: new Map([["business:es_mainland", "taxed"]]), countries: new Map(), consumerRates: new Map() } as unknown as EligibilityConfig;
  /** 44,63 € netos al mes + 21 % = 54,00 € exactos. */
  const SERVICE = (): TermsInput => ({ pricingMode: "per_item", presentation: "breakdown", reason: "Servicio a medida sin plataforma", lines: [custom("Servicio gestionado", 4463, { concept: "professional_service" })] });

  /**
   * Suscripción puramente económica: UNA partida a medida recurrente, sin plan, sin plataforma (tenant) y sin
   * licencias. La regla «necesita un plan Core» la retira otra rama; aquí se simula su resultado (la composición sin
   * plan se admite) para probar el cobro, que no depende de ella.
   */
  async function planless(w: World, companyId = 1) {
    void w;
    subs.checkComposition = async () => undefined;
    const a = await agreed(companyId, SERVICE());
    const sub = await subs.must(a.subId);
    const live = (await store.items(a.subId)).filter((i) => i.effectiveFrom <= clock && (i.effectiveTo === null || i.effectiveTo > clock));
    // Sin plan, sin plataforma: solo la partida a medida
    expect(sub.tenantId).toBeNull();
    expect(live.map((i) => [i.family, i.productKey.startsWith("custom:"), i.activationKind, i.lineAmountCents ?? i.unitAmountCents])).toEqual([["service", true, "none", 4463]]);
    return a;
  }

  it("la sesión de pago lleva solo la partida a medida: 4463 céntimos sin IVA, mensual, sobre el Product genérico, con Stripe Tax; no hace falta catálogo ni plataforma", async () => {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    // Ni un solo Price o Product de catálogo enlazado: no se necesita ninguno
    stripeStore.prices.clear();
    const w = world({ mode: "live", fiscal });
    const a = await planless(w);
    const s = await w.neg.start(a.subId, A);
    expect(s).toMatchObject({ status: "pending", currency: "EUR", recurringCents: 4463, firstChargeCents: 4463, taxTreatment: "stripe_tax_exclusive", deferredCredits: [] });
    const input = sessionCreates()[0].input as NegotiatedCheckoutInput;
    expect(input.lines).toEqual([{ productId: CUSTOM_SERVICE_PRODUCT_ID, unitAmount: 4463, currency: "EUR", interval: "month" }]);
    expect(input.automaticTax).toBe(true);
    // Todo cuelga de la EMPRESA y de la suscripción interna: ningún dato de plataforma en Stripe
    expect(input.metadata).toEqual({ es_negotiated: "1", es_terms_subscription: String(a.subId), es_terms: String(a.termsId), es_company_id: "1", es_env: NS, es_tax_treatment: "stripe_tax_exclusive" });
    expect(input.clientReferenceId).toBe(`es-terms-${a.subId}`);
    expect((gw.calls.find((c) => c.op === "customers.create")!.input as { metadata: Record<string, string> }).metadata).toEqual({ es_company_id: "1", es_env: NS, es_buyer_type: "business" });
    expect(await stripeStore.customerByCompany(1)).toMatchObject({ companyId: 1, tenantId: null });
    // Ni periodo de prueba, ni ancla de ciclo, ni prorrateo: la sesión no tiene ningún parámetro para ello
    expect(Object.keys(input).sort()).toEqual(["automaticTax", "cancelUrl", "clientReferenceId", "customerId", "expiresAt", "integrationIdentifier", "lines", "metadata", "notice", "successUrl"]);
  });

  it("primer cobro y renovaciones: 44,63 + 9,37 = 54,00 € exactos, conciliados con el acuerdo y la empresa; cero licencias, cero plataformas, cero avisos", async () => {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    gw.invoiceTaxBp = 2100;
    const w = world({ mode: "live", fiscal });
    const a = await planless(w);
    const { stripeId } = await started(w, a.subId);
    const r = await row(a.subId);
    expect(r).toMatchObject({ status: "active", companyId: 1, stripeSubscriptionId: stripeId });
    // Primera factura: periodo completo, sin línea de prorrateo, 54,00 €
    const first = gw.invoices.get(r.lastPaidInvoiceId!)!;
    expect(first).toMatchObject({ billingReason: "subscription_create", subtotal: 4463, taxCents: 937, total: 5400, amountPaid: 5400 });
    expect(first.lines!.every((l) => !l.proration)).toBe(true);
    expect((await billingStore.invoices(r.id))[0]).toMatchObject({ subtotalCents: 4463, taxCents: 937, totalCents: 5400, taxCheck: "ok" });
    // La partida a medida recibe su clave (una sustitución sin prorrateo) y lo pactado coincide con Stripe
    expect(itemWrites()).toHaveLength(1);
    expect(gw.negotiated.get(stripeId)!.items.map((i) => [i.productId, i.unitAmount, i.quantity, i.interval, !!i.metadata.es_line])).toEqual([[CUSTOM_SERVICE_PRODUCT_ID, 4463, 1, "month", true]]);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ available: true, consistent: true, plan: { recurringNetCents: 4463 } });
    // Tres renovaciones mensuales: siempre 54,00 €, registradas en el acuerdo
    for (let n = 0; n < 3; n++) {
      clock = (await subs.must(a.subId)).currentPeriodEnd + 60_000;
      const inv = gw.chargeNegotiatedPeriod(stripeId);
      await deliver(w);
      expect(gw.invoices.get(inv)).toMatchObject({ billingReason: "subscription_cycle", subtotal: 4463, taxCents: 937, total: 5400 });
      expect((await billingStore.invoice(inv))!).toMatchObject({ status: "paid", totalCents: 5400, taxCheck: "ok", subscriptionId: a.subId });
    }
    expect((await termsStore.events({ subscriptionId: a.subId })).filter((e) => e.kind === "billing_payment")).toHaveLength(4);
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated).toMatchObject({ checked: 1, drifted: [], errors: 0 });
    // Ningún evento perdido ni ignorado, ninguna alerta, y nada del circuito de pedidos, plataformas o licencias
    expect(Array.from(stripeStore.events.values()).map((e) => e.status).filter((x) => x !== "processed")).toEqual([]);
    for (const kind of ["stripe.event_mismatch", "stripe.negotiated_tax_mismatch", "stripe.negotiated_invoice_mismatch", "stripe.negotiated_drift", "stripe.namespace_mismatch"]) expect(alerts.count(kind)).toBe(0);
    expect(ordinary).toEqual([]);
    expect(licenceCalls).toEqual([]);
    expect(capabilityCalls).toEqual([]);
    expect((await subs.must(a.subId)).tenantId).toBeNull();
    expect(await stripeStore.customerByCompany(1)).toMatchObject({ tenantId: null });
    expect((await w.neg.publicStatus((await row(a.subId)).sessionId!, "plataforma.example"))).toEqual({ state: "ready", message: "Tu empresa está lista." });
  });

  it("impago, gracia, suspensión y recuperación: solo cambia el estado contractual; sin licencias que tocar no falla ni escribe nada", async () => {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    gw.invoiceTaxBp = 2100;
    const w = world({ mode: "live", fiscal });
    const a = await planless(w);
    const { stripeId } = await started(w, a.subId);
    const failed = gw.chargeNegotiatedPeriod(stripeId, "open");
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "past_due", graceEndsAt: clock + 7 * DAY });
    clock += 7 * DAY + 60_000;
    await w.reconciler.tick();
    expect(await row(a.subId)).toMatchObject({ status: "suspended", suspendedCapabilities: [] });
    // Stripe reintenta y cobra la misma factura
    gw.invoices.set(failed, { ...gw.invoices.get(failed)!, status: "paid", amountPaid: 5400 });
    gw.updateSubscription(stripeId, { status: "active" });
    gw.emit("invoice.paid", "invoice", failed);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", graceEndsAt: null, lastPaidInvoiceId: failed });
    // Fin en Stripe: la contratación termina; tampoco hay nada que dejar en solo lectura
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    await deliver(w);
    expect((await row(a.subId)).status).toBe("canceled");
    expect((await subs.must(a.subId)).cancelAt).not.toBeNull();
    expect(capabilityCalls).toEqual([]);
    expect(licenceCalls).toEqual([]);
    expect(ordinary).toEqual([]);
    expect(Array.from(stripeStore.events.values()).map((e) => e.status).filter((x) => x !== "processed")).toEqual([]);
    expect((await termsStore.events({ subscriptionId: a.subId })).filter((e) => e.kind === "billing_state").map((e) => e.reason)).toEqual(["Cobro en Stripe: pending → active", "Cobro en Stripe: active → past_due", "Cobro en Stripe: past_due → suspended", "Cobro en Stripe: suspended → active", "Cobro en Stripe: active → canceled"]);
  });

  it("una factura cuyo total no es el esperado (54,00 €) se avisa y aparece en la conciliación, por un céntimo o por la base", async () => {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    gw.invoiceTaxBp = 2100;
    const w = world({ mode: "live", fiscal });
    const a = await planless(w);
    const { stripeId } = await started(w, a.subId);
    // Stripe Tax aplica otro tipo: 44,63 + 9,82 = 54,45 €
    gw.invoiceTaxBp = 2200;
    const wrongTax = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect(gw.invoices.get(wrongTax)!.total).toBe(5445);
    expect((await billingStore.invoice(wrongTax))!.taxCheck).toBe("tax_mismatch");
    expect(alerts.count("stripe.negotiated_tax_mismatch")).toBe(1);
    clock += 20 * 60_000;
    const r = await w.reconciler.tick();
    expect(r.negotiated!.drifted).toEqual([{ subscriptionId: a.subId, differences: [{ key: `factura:${wrongTax}:tax_mismatch`, kind: "invoice" }] }]);
    expect(alerts.count("stripe.negotiated_drift")).toBe(1);
    // La siguiente sale bien: deja de contar
    gw.invoiceTaxBp = 2100;
    gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated!.drifted).toEqual([]);
    // Alguien cambia el importe en Stripe: la factura sale por otra base (45,00 €)
    gw.negotiated.get(stripeId)!.items[0].unitAmount = 4500;
    const wrongBase = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect((await billingStore.invoice(wrongBase))!).toMatchObject({ subtotalCents: 4500, taxCheck: "amount_mismatch" });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(1);
    clock += 20 * 60_000;
    const kinds = (await w.reconciler.tick()).negotiated!.drifted[0].differences.map((d) => d.kind).sort();
    expect(kinds).toEqual(["invoice", "item"]);
    // Un céntimo de más en el impuesto ya no es lo pactado
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4463, taxCents: 937, total: 5400, lines: [] }, 4463)).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4463, taxCents: 938, total: 5401, lines: [] }, 4463)).toBe("tax_mismatch");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4463, taxCents: 937, total: 5401, lines: [] }, 4463)).toBe("tax_mismatch");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4464, taxCents: 937, total: 5401, lines: [] }, 4463)).toBe("amount_mismatch");
    expect(invoiceTaxCheck("test_net_no_tax", [2100], { subtotal: 4463, taxCents: null, total: 4463, lines: [] }, 4463)).toBe("ok");
  });
});
