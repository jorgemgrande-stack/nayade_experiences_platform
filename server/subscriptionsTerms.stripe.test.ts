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
import { addMonthsUTC, madridAnchor } from "./subscriptions/pricing";
import type { EligibilityConfig } from "./stripe/eligibility";

const A = "operator:ana";
const NS = "local";
const T0 = Date.UTC(2026, 10, 1, 10);
const DAY = 86_400_000;
/** Como Stripe: periodos de meses de calendario UTC con el día del ancla. */
const month = (ts: number, n = 1) => addMonthsUTC(ts, n);
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
  billing.attach({ gateway: neg.gatewayFor(), link: neg.link, billFrom: neg.billFrom, invalidate: neg.invalidate, cancelRequested: neg.cancelRequested, serialize: neg.serialize });
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
const tagWrites = () => gw.calls.filter((c) => c.op === "subscription_items.update(metadata)");
const oneOffWrites = () => gw.calls.filter((c) => c.op === "invoiceitems.create");
const grant = (tenantId: string, capabilityId: string, source: string, status: "active" | "suspended" = "active") => caps.apply(tenantId, [{ capabilityId, siteId: "", status, validUntil: null, source }], { actor: A, reason: "prueba", now: clock });
const statusOf = async (tenantId: string) => Object.fromEntries((await caps.list(tenantId)).map((g) => [g.capabilityId, g.status]));

describe("cerrojos", () => {
  it("apagado por defecto: ninguna llamada a Stripe (pasarela que falla en cualquier llamada) y nada cambia", async () => {
    const seen: string[] = [];
    const w = world({ enabled: false, gateway: exploding(seen) });
    const a = await agreed(1);
    await expect(w.neg.start(a.subId, A)).rejects.toMatchObject({ code: "disabled" });
    // Programar un fin sigue permitido apagado, pero aquí no hay nada enlazado; deshacerlo exige el interruptor
    await expect(w.neg.setCancel(a.subId, true, A)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(w.neg.setCancel(a.subId, false, A)).rejects.toMatchObject({ code: "disabled" });
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
    expect(await w.neg.link(a.subId)).toEqual({ customerId: (await row(a.subId)).stripeCustomerId, subscriptionId: stripeId, periodEnd: gw.subscriptions.get(stripeId)!.currentPeriodEnd! * 1000 });
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
    // Tras enlazar: NINGUNA sustitución de partidas (solo se pone la clave a la partida a medida) y UN importe único: el abono
    expect(itemWrites()).toHaveLength(0);
    expect(tagWrites()).toHaveLength(3);
    expect(gw.negotiated.get(stripeId)!.items.every((i) => !!i.metadata.es_line)).toBe(true);
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
    // Fin ordenado por el operador (o por la contratación): al terminar Stripe, la contratación termina
    await w.neg.setCancel(a.subId, true, A);
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
    // La partida a medida recibe su clave con un cambio de SOLO metadatos: lo recién pagado no se sustituye
    expect(itemWrites()).toHaveLength(0);
    expect(tagWrites()).toHaveLength(1);
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
    await w.neg.setCancel(a.subId, true, A);
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    await deliver(w);
    expect((await row(a.subId)).status).toBe("canceled");
    expect((await subs.must(a.subId)).cancelAt).not.toBeNull();
    expect(capabilityCalls).toEqual([]);
    expect(licenceCalls).toEqual([]);
    expect(ordinary).toEqual([]);
    expect(Array.from(stripeStore.events.values()).map((e) => e.status).filter((x) => x !== "processed")).toEqual([]);
    expect((await termsStore.events({ subscriptionId: a.subId })).filter((e) => e.kind === "billing_state").map((e) => e.reason)).toEqual(["Cobro en Stripe: pending → active", "Cobro en Stripe: active → past_due", "Cobro en Stripe: past_due → suspended", "Cobro en Stripe: suspended → active", "Cobro en Stripe: active → cancel_scheduled", "Cobro en Stripe: cancel_scheduled → canceled"]);
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

describe("inicio del acuerdo y reloj de una contratación cobrada en Stripe", () => {
  const stripePeriod = (id: string) => ({ start: gw.subscriptions.get(id)!.currentPeriodStart! * 1000, end: gw.subscriptions.get(id)!.currentPeriodEnd! * 1000 });
  /** Acuerdo activado HOY que empieza a regir en una fecha futura: queda guardado como «programado». */
  async function scheduled(companyId: number, startsAt: number, over: Partial<TermsInput> = {}) {
    const a = await agreed(companyId, PACKAGE({ effectiveFrom: startsAt, ...over }));
    expect((await termsStore.get(a.termsId))!.status).toBe("scheduled");
    return a;
  }

  it("un acuerdo con inicio futuro se puede poner a cobrar cuando llega su fecha, aunque conste guardado como «programado»", async () => {
    const w = world();
    const D = T0 + 10 * DAY;
    const a = await scheduled(1, D);
    clock = D + 3600_000;
    // Nadie reescribe el estado guardado: manda el estado efectivo en la fecha
    expect((await termsStore.get(a.termsId))!.status).toBe("scheduled");
    expect((await w.neg.status(a.subId))).toMatchObject({ canStart: true, blockers: [] });
    const s = await w.neg.start(a.subId, A);
    expect(s).toMatchObject({ status: "pending", recurringCents: 12900, firstChargeCents: 12900, firstChargeAt: null });
    expect((sessionCreates()[0].input as NegotiatedCheckoutInput).trialEnd).toBeUndefined();
  });

  it("antes del inicio (con más de 48 h): el cliente autoriza ya su método de pago y el primer cargo es el día del inicio, por el periodo completo", async () => {
    const w = world();
    const D = T0 + 10 * DAY;
    const a = await scheduled(1, D, { lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial" })], adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }] });
    const internal = await subs.must(a.subId);
    const s = await w.neg.start(a.subId, A);
    // Hoy no se cobra nada; el día D, la primera cuota entera con la implantación y el abono
    expect(s).toMatchObject({ status: "pending", recurringCents: 12900, firstChargeCents: 12900 + 50000 - 2900, firstChargeAt: D, deferredCredits: [] });
    const input = sessionCreates()[0].input as NegotiatedCheckoutInput;
    expect(input.trialEnd).toBe(D / 1000);
    expect(input.lines.every((l) => l.interval === "month")).toBe(true);
    expect(input.lines.reduce((x, l) => x + l.unitAmount, 0)).toBe(12900);
    // Repetir devuelve la misma sesión
    expect(await w.neg.start(a.subId, A)).toMatchObject({ status: "pending", reused: true, firstChargeAt: D });
    // El cliente autoriza el método de pago: factura de 0, contratación enlazada, sin tocar el periodo interno
    const stripeId = gw.completeNegotiatedSession((s as { sessionId: string }).sessionId);
    await deliver(w);
    expect(gw.subscriptions.get(stripeId)!.status).toBe("trialing");
    expect(await row(a.subId)).toMatchObject({ status: "active", stripeSubscriptionId: stripeId });
    expect((await billingStore.invoices((await row(a.subId)).id))[0]).toMatchObject({ billingReason: "subscription_create", subtotalCents: 0, taxCheck: "ok" });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    expect(await subs.must(a.subId)).toMatchObject({ currentPeriodStart: internal.currentPeriodStart, currentPeriodEnd: internal.currentPeriodEnd });
    // Lo que regirá el día D ya está en Stripe y concilia: los importes únicos de esa fecha esperan a su factura
    expect(gw.invoiceItems.map((i) => i.amount).sort((x, y) => x - y)).toEqual([-2900, 50000]);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ available: true, consistent: true, plan: { recurringNetCents: 12900 } });
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated).toMatchObject({ checked: 1, drifted: [] });
    // Llega el día D: primer cargo, periodo completo, sin prorrateo; el periodo interno es el de Stripe (empieza en D)
    clock = D + 60_000;
    const first = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect(gw.invoices.get(first)).toMatchObject({ billingReason: "subscription_cycle", subtotal: 12900 + 50000 - 2900 });
    expect((await billingStore.invoice(first))!.taxCheck).toBe("ok");
    expect(await subs.must(a.subId)).toMatchObject({ currentPeriodStart: D, currentPeriodEnd: month(D) });
    expect(stripePeriod(stripeId)).toEqual({ start: D, end: month(D) });
    // La segunda cuota ya es solo la recurrente
    clock = month(D) + 60_000;
    expect(gw.invoices.get(gw.chargeNegotiatedPeriod(stripeId))!.subtotal).toBe(12900);
    await deliver(w);
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
  });

  it("a menos de 48 h del inicio no se aplaza el primer cargo: se rechaza con la fecha y se pone a cobrar al llegar", async () => {
    const w = world();
    const D = T0 + 30 * 3600_000;
    const a = await scheduled(1, D);
    await expect(w.neg.start(a.subId, A)).rejects.toThrow(/en menos de 48 horas.*a partir de esa fecha/);
    expect((await w.neg.status(a.subId)).canStart).toBe(false);
    expect(gw.calls).toEqual([]);
    clock = D + 1000;
    expect(await w.neg.start(a.subId, A)).toMatchObject({ status: "pending", firstChargeAt: null });
  });

  it("el reloj es el de Stripe: si el cliente paga días después del inicio, el periodo interno pasa a ser el que Stripe cobra, y lo sigue en cada renovación", async () => {
    const w = world();
    const a = await agreed(1);
    const original = await subs.must(a.subId);
    clock += 5 * DAY;
    const { stripeId } = await started(w, a.subId);
    // Stripe empezó a cobrar al pagar (5 días después): el periodo interno es ese, no el del inicio del acuerdo
    expect(stripePeriod(stripeId).start).toBe(clock);
    expect(await subs.must(a.subId)).toMatchObject({ currentPeriodStart: clock, currentPeriodEnd: month(clock) });
    expect((await subs.must(a.subId)).currentPeriodEnd).not.toBe(original.currentPeriodEnd);
    expect((await store.events(a.subId)).filter((e) => e.kind === "renewed").map((e) => e.reason)).toEqual(["El periodo sigue al de la suscripción de Stripe"]);
    // Renovación de Stripe ANTES de que venciera el periodo interno original+desfase: la interna la sigue igual
    const paidAt = clock;
    clock = month(paidAt) + 60_000;
    gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect(await subs.must(a.subId)).toMatchObject({ currentPeriodStart: month(paidAt), currentPeriodEnd: month(paidAt, 2) });
    // Repetir el evento no vuelve a mover nada
    const events = (await store.events(a.subId)).length;
    for (const ev of gw.events) await w.processor.process({ eventId: ev.id, type: ev.type, objectId: ev.objectId });
    expect((await store.events(a.subId)).length).toBe(events);
    // Un fin programado en la suscripción interna termina con el periodo de Stripe
    await subs.scheduleCancel(a.subId, { reason: "Baja pedida" }, (await subs.must(a.subId)).version, A);
    clock = month(paidAt, 2) + 60_000;
    gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect((await subs.must(a.subId)).cancelAt).toBe(month(paidAt, 3));
  });

  it("fin en Stripe con renovaciones internas sin aplicar: la suscripción interna termina en el acto", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    // Pasan 45 días sin que llegue ningún evento: el periodo interno está vencido y sin renovar
    clock += 45 * DAY;
    expect(clock).toBeGreaterThan((await subs.must(a.subId)).currentPeriodEnd);
    await expect(subs.scheduleCancel(a.subId, { reason: "x" }, (await subs.must(a.subId)).version, A)).rejects.toThrow(/renovaciones vencidas/);
    // El operador ordenó el fin; Stripe termina con las renovaciones internas aún sin aplicar
    await w.neg.setCancel(a.subId, true, A);
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    expect(await deliver(w)).toMatchObject({ failed: 0, retried: 0 });
    expect((await row(a.subId)).status).toBe("canceled");
    expect(await subs.must(a.subId)).toMatchObject({ status: "canceled", canceledAt: clock });
    expect((await store.items(a.subId)).every((i) => i.effectiveTo !== null && i.effectiveTo <= clock)).toBe(true);
    // Y con el periodo interno aún sin vencer, también termina ya (Stripe no cobrará más)
    const b = await agreed(2);
    const other = await started(w, b.subId);
    await w.neg.setCancel(b.subId, true, A);
    gw.updateSubscription(other.stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", other.stripeId);
    await deliver(w);
    expect(await subs.must(b.subId)).toMatchObject({ status: "canceled", canceledAt: clock });
  });
});

describe("revisiones independientes: correcciones", () => {
  const fiscal = { scenarios: new Set(["business:es_mainland"]), taxExpectations: new Map([["business:es_mainland", "taxed"]]), countries: new Map(), consumerRates: new Map() } as unknown as EligibilityConfig;
  const cancelWrites = () => gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)");

  it("A — lo recién pagado nunca se sustituye: dos partidas a medida idénticas reciben su clave con cambios de solo metadatos", async () => {
    const w = world();
    const a = await agreed(1, PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [cat("essential"), custom("Soporte A", 5000), custom("Soporte B", 5000)] } as never));
    const { stripeId } = await started(w, a.subId);
    const ids = gw.negotiated.get(stripeId)!.items.map((i) => i.id).sort();
    expect(itemWrites()).toEqual([]);
    expect(tagWrites()).toHaveLength(3);
    // Mismas partidas (mismos ids de Stripe), ahora con clave; ninguna factura nueva; concilia
    expect(gw.negotiated.get(stripeId)!.items.map((i) => i.id).sort()).toEqual(ids);
    expect(new Set(gw.negotiated.get(stripeId)!.items.map((i) => i.metadata.es_line)).size).toBe(3);
    expect(gw.invoices.size).toBe(1);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(tagWrites()).toHaveLength(3);
    // El doble es más estricto que Stripe: sustituir una partida por otra idéntica es un error
    const item = gw.negotiated.get(stripeId)!.items[0];
    await expect(gw.replaceNegotiatedItems({ subscriptionId: stripeId, remove: [item.id], add: [{ productId: item.productId, unitAmount: item.unitAmount, currency: "EUR", interval: "month", metadata: {} }], metadata: {} }, "k-identica")).rejects.toThrow(/idéntica/);
  });

  it("B — más de 10 partidas: se ven todas; ni al enlazar ni al cambiar una queda ninguna duplicada", async () => {
    const w = world();
    const lines = [cat("essential"), ...Array.from({ length: 10 }, (_, n) => custom(`Servicio ${n + 1}`, 1000 + n))];
    const a = await agreed(1, PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines } as never));
    const { stripeId } = await started(w, a.subId);
    const total = () => gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0);
    const expected = (await w.billing.plan(a.subId)).recurringNetCents;
    expect(gw.negotiated.get(stripeId)!.items).toHaveLength(11);
    expect(itemWrites()).toEqual([]);
    expect(total()).toBe(expected);
    // Cambia el importe de una sola: se sustituye esa y siguen siendo 11
    await applyNew(a.subId, PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [...lines.slice(0, 10), custom("Servicio 10", 9999)] } as never));
    expect(gw.negotiated.get(stripeId)!.items).toHaveLength(11);
    expect(total()).toBe((await w.billing.plan(a.subId)).recurringNetCents);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
  });

  it("C — una baja reprogramada el mismo día vuelve a llegar a Stripe (otra clave de idempotencia)", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    await subs.scheduleCancel(a.subId, { reason: "Baja" }, (await subs.must(a.subId)).version, A);
    await w.billing.sync(a.subId, A);
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(true);
    // Se deshace dentro y en Stripe…
    await subs.reactivate(a.subId, { reason: "Se queda" }, (await subs.must(a.subId)).version, A);
    await w.neg.setCancel(a.subId, false, A);
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(false);
    // …y el cliente vuelve a pedir la baja en el mismo periodo (misma fecha de fin)
    await subs.scheduleCancel(a.subId, { reason: "Baja definitiva" }, (await subs.must(a.subId)).version, A);
    await w.billing.sync(a.subId, A);
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(true);
    const keys = cancelWrites().map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    // El operador también puede repetir on → off → on: cada orden es una petición distinta
    await subs.reactivate(a.subId, { reason: "x" }, (await subs.must(a.subId)).version, A);
    for (const on of [false, true, false, true]) {
      clock += 1000;
      await w.neg.setCancel(a.subId, on, A);
      expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(on);
    }
  });

  it("D — un fin programado solo en Stripe es una diferencia; si Stripe llega a terminar, la contratación y sus licencias no se tocan solas y se puede volver a cobrar", async () => {
    const w = world();
    const a = await agreed(1);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    await grant("t-acme", "plan.essential", `subscription:${a.subId}`);
    // Alguien programa el fin en el Dashboard de Stripe: ni la contratación termina dentro ni lo pidió un operador
    await gw.setCancelAtPeriodEnd(stripeId, true, "dashboard");
    await deliver(w);
    expect((await w.billing.reconcile(a.subId)).differences).toEqual([{ key: "fin_solo_en_stripe", kind: "status", expectedCents: null, stripeCents: null }]);
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated!.drifted[0].differences.map((d) => d.key)).toEqual(["fin_solo_en_stripe"]);
    // Nunca se deshace solo en Stripe ni se termina la contratación por ello
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(true);
    // Si lo hubiera pedido un operador, no sería una diferencia
    const b = await agreed(2);
    await started(w, b.subId);
    await w.neg.setCancel(b.subId, true, A);
    expect(await w.billing.reconcile(b.subId)).toMatchObject({ consistent: true });
    // Stripe termina la primera: ya no cobra; se avisa; contratación y licencias intactas
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: null });
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(1);
    expect(await subs.must(a.subId)).toMatchObject({ status: "active", cancelAt: null });
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("active");
    // Una persona decide: se vuelve a poner a cobrar con una suscripción de Stripe nueva
    const again = await w.neg.start(a.subId, A);
    expect(again).toMatchObject({ status: "pending", reused: false });
    const fresh = gw.completeNegotiatedSession((again as { sessionId: string }).sessionId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", stripeSubscriptionId: fresh });
  });

  it("E — primer pago que falla sin cobrarse nada: la contratación no queda pendiente para siempre", async () => {
    const w = world();
    const a = await agreed(1);
    const s = (await w.neg.start(a.subId, A)) as { sessionId: string };
    // Solo tarjeta en la sesión; aun así, si Stripe dejara la suscripción en impago sin ningún cobro…
    const stripeId = gw.completeNegotiatedSession(s.sessionId, "incomplete");
    await deliver(w);
    expect((await w.neg.start(a.subId, A)).status).toBe("processing");
    gw.updateSubscription(stripeId, { status: "past_due" });
    gw.emit("customer.subscription.updated", "subscription", stripeId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "abandoned" });
    expect(alerts.count("stripe.negotiated_first_payment_failed")).toBe(1);
    expect(await w.neg.link(a.subId)).toBeNull();
    expect(await w.neg.start(a.subId, A)).toMatchObject({ status: "pending", reused: false });
  });

  it("F — una cuota recurrente total de 0 no se pone a cobrar; en una ya enlazada el cobro queda en pausa hasta que vuelva a ser de pago", async () => {
    const w = world();
    const free = await agreed(1, PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [cat("essential", { negotiatedUnitCents: 0 })] } as never));
    await expect(w.neg.start(free.subId, A)).rejects.toThrow(/cuota recurrente total es 0/);
    expect((await w.neg.status(free.subId)).canStart).toBe(false);
    expect(gw.calls).toEqual([]);
    // Una ya enlazada que pasa a 0: el cobro se pone EN PAUSA (el cliente no sigue pagando lo anterior) y las partidas no se tocan
    const b = await agreed(2);
    const { stripeId } = await started(w, b.subId);
    const zero = PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [cat("essential", { negotiatedUnitCents: 0 })] } as never);
    await applyNew(b.subId, zero);
    expect((await termsStore.get((await w.billing.plan(b.subId)).termsId!))!.syncStatus).toBe("synced");
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    expect(itemWrites()).toEqual([]);
    expect(await w.billing.reconcile(b.subId)).toMatchObject({ consistent: true });
    // Llega la renovación: Stripe anula la factura y no cobra nada; la contratación sigue al corriente
    const invoices = (await billingStore.invoices((await row(b.subId)).id)).filter((i) => i.status === "paid").length;
    clock = (await subs.must(b.subId)).currentPeriodEnd + 60_000;
    const voided = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect(gw.invoices.get(voided)).toMatchObject({ status: "void", amountPaid: 0 });
    expect((await billingStore.invoices((await row(b.subId)).id)).filter((i) => i.status === "paid").length).toBe(invoices);
    expect((await row(b.subId)).status).toBe("active");
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    // Repetir no vuelve a escribir; un cobro sin pausar con cuota 0 sería una diferencia
    const pauses = () => gw.calls.filter((c) => c.op === "subscriptions.update(pause_collection)");
    await w.billing.sync(b.subId, A);
    expect(pauses()).toHaveLength(1);
    gw.pausedSubs.delete(stripeId);
    expect((await w.billing.reconcile(b.subId)).differences.map((d) => d.key)).toContain("cobro_sin_pausar");
    gw.pausedSubs.add(stripeId);
    // Vuelve a ser de pago: se quita la pausa y quedan las partidas vigentes; la siguiente renovación cobra lo nuevo
    await applyNew(b.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect(gw.pausedSubs.has(stripeId)).toBe(false);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(9900);
    expect(gw.invoices.get(gw.chargeNegotiatedPeriod(stripeId))).toMatchObject({ status: "paid", subtotal: 9900 });
    expect(await w.billing.reconcile(b.subId)).toMatchObject({ consistent: true });
  });

  it("G — cambiar las condiciones con la sesión de pago abierta la cierra; si aun así se pagara lo antiguo, se avisa y se corrige antes de la siguiente factura", async () => {
    const w = world();
    const a = await agreed(1);
    const s = (await w.neg.start(a.subId, A)) as { sessionId: string };
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect(gw.sessions.get(s.sessionId)!.status).toBe("expired");
    expect(await row(a.subId)).toMatchObject({ status: "pending", sessionStatus: "expired" });
    expect(await w.neg.start(a.subId, A)).toMatchObject({ status: "pending", reused: false, recurringCents: 9900 });
    // Caso límite: el cliente paga justo antes de que se cierre (aquí: Stripe no deja cerrarla)
    const b = await agreed(2);
    const old = (await w.neg.start(b.subId, A)) as { sessionId: string };
    const expire = gw.expireCheckoutSession.bind(gw);
    gw.expireCheckoutSession = async () => Promise.reject(new Error("Stripe no responde"));
    await applyNew(b.subId, PACKAGE({ globalAmountCents: 9900 }));
    gw.expireCheckoutSession = expire;
    const stripeId = gw.completeNegotiatedSession(old.sessionId);
    await deliver(w);
    // Pagó 129 € con 99 € en vigor: aviso, y Stripe queda con lo vigente para la siguiente factura
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(1);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(9900);
    expect(gw.invoices.get(gw.chargeNegotiatedPeriod(stripeId))!.subtotal).toBe(9900);
  });

  it("H — el impuesto admite el redondeo por factura y por línea, y nada más; lo cobrado tiene que ser el total", () => {
    const two = [{ amount: 1002 }, { amount: 1002 }] as never;
    // Dos líneas de 10,02 € al 21 %: 4,21 € (sobre el total) o 2,10 + 2,10 = 4,20 € (línea a línea)
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 2004, taxCents: 421, total: 2425, lines: two }, 2004)).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 2004, taxCents: 420, total: 2424, lines: two }, 2004)).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 2004, taxCents: 419, total: 2423, lines: two }, 2004)).toBe("tax_mismatch");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 2004, taxCents: 422, total: 2426, lines: two }, 2004)).toBe("tax_mismatch");
    // Una sola línea: exacto
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4463, taxCents: 937, total: 5400, lines: [{ amount: 4463 }] as never, amountPaid: 5400 }, 4463)).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4463, taxCents: 938, total: 5401, lines: [{ amount: 4463 }] as never }, 4463)).toBe("tax_mismatch");
    // Saldo a favor aplicado o cobro fuera de Stripe: lo cobrado no es el total
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: 4463, taxCents: 937, total: 5400, lines: [], amountPaid: 4400 }, 4463)).toBe("payment_mismatch");
    expect(invoiceTaxCheck("test_net_no_tax", [2100], { subtotal: 4463, taxCents: null, total: 4463, lines: [], amountPaid: 0 }, 4463)).toBe("payment_mismatch");
  });

  it("H — un cargo único antiguo a otro tipo no afloja la comprobación de las facturas siguientes", async () => {
    gw.invoiceTaxBp = 2100;
    const w = world({ mode: "live", fiscal });
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    const a = await agreed(1, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Formación", 10000, { concept: "professional_service", chargeClass: "initial", taxRateBp: 0 })] }));
    const { stripeId } = await started(w, a.subId);
    // Meses después, una renovación con un impuesto que no es el 21 % exacto: sigue siendo una diferencia
    gw.invoiceTaxBp = 2000;
    const inv = gw.chargeNegotiatedPeriod(stripeId);
    await deliver(w);
    expect((await billingStore.invoice(inv))!.taxCheck).toBe("tax_mismatch");
  });

  it("I — si el proceso se corta tras guardar la factura, el reintento repite el contraste de moneda y sigue el periodo; el aviso ya salió", async () => {
    gw.invoiceTaxBp = 2100;
    const w = world({ mode: "live", fiscal });
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    gw.invoiceTaxBp = 2200;
    const patch = billingStore.patch.bind(billingStore);
    let failing = true;
    billingStore.patch = async (...args: Parameters<typeof patch>) => (failing ? Promise.reject(new Error("BD no disponible")) : patch(...args));
    clock = (await subs.must(a.subId)).currentPeriodEnd + 60_000;
    const inv = gw.chargeNegotiatedPeriod(stripeId);
    const first = await deliver(w);
    expect(first.retried).toBeGreaterThan(0);
    // La factura quedó guardada, el aviso ya saltó, y el estado aún no
    expect((await billingStore.invoice(inv))!).toMatchObject({ status: "paid", taxCheck: "tax_mismatch" });
    expect(alerts.count("stripe.negotiated_tax_mismatch")).toBe(1);
    expect((await row(a.subId)).lastPaidInvoiceId).not.toBe(inv);
    // Reintento: el estado y el periodo se completan; la comprobación guardada no se pierde
    failing = false;
    clock += 2 * 3600_000;
    await w.processor.processDue(100);
    expect((await row(a.subId)).lastPaidInvoiceId).toBe(inv);
    expect((await subs.must(a.subId)).currentPeriodStart).toBe(gw.subscriptions.get(stripeId)!.currentPeriodStart! * 1000);
    expect((await billingStore.invoice(inv))!.taxCheck).toBe("tax_mismatch");
    // Una factura en otra moneda se rechaza también en un reintento (aunque ya conste guardada)
    gw.invoices.set(inv, { ...gw.invoices.get(inv)!, currency: "USD" });
    await expect(w.neg.handleSubscription((await gw.subscription(stripeId))!)).rejects.toThrow(/moneda/);
  });

  it("J — interruptor apagado con suscripciones ya enlazadas: no se inicia ni se cambia nada, pero el fin llega a Stripe y la conciliación sigue avisando", async () => {
    const on = world();
    const a = await agreed(1);
    const b = await agreed(2);
    const { stripeId } = await started(on, a.subId);
    const off = world({ enabled: false });
    gw.calls.length = 0;
    // No se inicia nada nuevo ni se envían cambios de condiciones
    await expect(off.neg.start(b.subId, A)).rejects.toMatchObject({ code: "disabled" });
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect((await off.billing.sync(a.subId, A)).status).toBe("disabled");
    expect(gw.negotiatedWrites()).toEqual([]);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(12900);
    // La conciliación periódica sigue comparando y avisa de la diferencia
    clock += 20 * 60_000;
    const r = await off.reconciler.tick();
    expect(r.negotiated).toMatchObject({ checked: 1 });
    expect(r.negotiated!.drifted[0].subscriptionId).toBe(a.subId);
    expect(itemWrites()).toEqual([]);
    // Los webhooks siguen aplicando el estado de pago
    gw.chargeNegotiatedPeriod(stripeId, "open");
    await deliver(off);
    expect((await row(a.subId)).status).toBe("past_due");
    // Cancelar dentro sí llega a Stripe: nunca queda facturando algo que se canceló
    gw.updateSubscription(stripeId, { status: "active" });
    await subs.scheduleCancel(a.subId, { reason: "Baja" }, (await subs.must(a.subId)).version, A);
    await off.billing.syncIfOpen(a.subId);
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true });
    expect(cancelWrites()).toHaveLength(1);
    // Y el operador puede programar el fin, pero no deshacerlo
    const c = await agreed(3);
    world();
    const other = await started(world(), c.subId);
    const off2 = world({ enabled: false });
    expect((await off2.neg.setCancel(c.subId, true, A)).billing).toMatchObject({ status: "cancel_scheduled" });
    expect(gw.subscriptions.get(other.stripeId)!.cancelAtPeriodEnd).toBe(true);
    await expect(off2.neg.setCancel(c.subId, false, A)).rejects.toMatchObject({ code: "disabled" });
    expect(describeTermsBilling({ switchOn: false, registry: true, stripe: { mode: "live", taxPolicy: "stripe_tax_exclusive", urls: true }, linked: 2 })).toMatchObject({ stripeBilling: "off_with_linked", stripeBillingLinked: 2 });
    expect(describeTermsBilling({ switchOn: false, registry: true, stripe: { mode: "live", taxPolicy: "stripe_tax_exclusive", urls: true }, linked: 0 })).toMatchObject({ stripeBilling: "off" });
  });

  it("K — un fallo del registro de condiciones no aborta la conciliación ordinaria; eventos sin módulo montado se avisan", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const broken = new StripeReconciler({ store: stripeStore, gateway: gw, processor: w.processor, now: () => clock, negotiated: { toRefresh: async () => Promise.reject(new Error("tabla no disponible")), closeExpiredSessions: async () => Promise.reject(new Error("tabla no disponible")), reconcileAll: async () => Promise.reject(new Error("tabla no disponible")) } });
    clock += 20 * 60_000;
    const r = await broken.tick();
    expect(r).toMatchObject({ skipped: false, refreshErrors: 1 });
    expect((await stripeStore.getState("events_cursor"))?.complete).toBe(true);
    // Sin el módulo montado, un evento de una suscripción negociada de ESTE entorno se ignora con aviso
    const bare = new StripeEventProcessor({ store: stripeStore, gateway: gw, orders: {} as never, orchestrator: {} as never, now: () => clock, namespace: NS, mode: "test" });
    expect(await bare.process({ eventId: "x", type: "customer.subscription.updated", objectId: stripeId })).toMatchObject({ outcome: "ignored" });
    expect(alerts.count("stripe.negotiated_unmounted")).toBe(1);
  });

  it("M — una suscripción cobrada con condiciones personalizadas no admite cambios ordinarios de la ficha: se cambia desde el acuerdo y Stripe no se toca", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const before = JSON.stringify(gw.negotiated.get(stripeId));
    const v = async () => (await subs.must(a.subId)).version;
    await expect(subs.changePlan(a.subId, { plan: { productKey: "essential", priceId: P.essential } }, await v(), A)).rejects.toThrow();
    await expect(subs.addItem(a.subId, { item: { productKey: "whatsapp", priceId: P.whatsapp } }, await v(), A)).rejects.toThrow();
    const item = (await store.items(a.subId)).find((i) => i.productKey === "hotel-net" && i.effectiveTo === null)!;
    await expect(subs.removeItem(a.subId, item.id, {}, await v(), A)).rejects.toThrow();
    expect(JSON.stringify(gw.negotiated.get(stripeId))).toBe(before);
    expect(gw.negotiatedWrites().filter((c) => c.op !== "checkout.sessions.create(negotiated)")).toEqual([]);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
  });

  it("N — fechas de corte: cuando empieza un acuerdo programado, la conciliación deja en Stripe lo que rige; lo que alguien cambie en Stripe a mano solo se avisa", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const total = () => gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0);
    const D = clock + 10 * DAY;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, effectiveFrom: D }));
    // Hasta la fecha no cambia nada en Stripe
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated).toMatchObject({ drifted: [] });
    expect(total()).toBe(12900);
    // Llega la fecha: sin que nadie sincronice, la siguiente pasada deja 99 € en Stripe (sin prorrateo ni factura)
    const invoices = gw.invoices.size;
    clock = D + 60_000;
    const r = await w.reconciler.tick();
    expect(r.negotiated).toMatchObject({ checked: 1, drifted: [] });
    expect(total()).toBe(9900);
    expect(gw.invoices.size).toBe(invoices);
    // Un cambio hecho a mano en Stripe NO se corrige solo
    gw.negotiated.get(stripeId)!.items[0].unitAmount += 500;
    const writes = itemWrites().length;
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated!.drifted).toHaveLength(1);
    expect(itemWrites().length).toBe(writes);
    // Y un cupón o una pausa de cobro puestos en el Dashboard son diferencias
    gw.negotiated.get(stripeId)!.items[0].unitAmount -= 500;
    gw.anomaliesOf.set(stripeId, ["cupón", "cobro_en_pausa"]);
    expect((await w.billing.reconcile(a.subId)).differences.map((d) => d.key)).toEqual(["cupón", "cobro_en_pausa"]);
  });
});

describe("segunda revisión independiente: correcciones", () => {
  const WITH_ONE_OFFS = () => PACKAGE({ lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial" })], adjustments: [{ line: null, type: "discount", mode: "amount", value: 2900, recurrence: "once", note: "bienvenida" }] });
  const cancelInStripe = async (w: World, stripeId: string) => {
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    await deliver(w);
  };

  it("B1 — volver a poner a cobrar tras un fin solo en Stripe no cobra otra vez la implantación; el abono que no llegó a facturarse va, una vez, a la nueva", async () => {
    const w = world();
    const a = await agreed(1, WITH_ONE_OFFS());
    const first = await started(w, a.subId);
    expect(gw.invoices.get((await row(a.subId)).lastPaidInvoiceId!)!.subtotal).toBe(12900 + 50000);
    expect(gw.invoiceItems.map((i) => i.amount)).toEqual([-2900]);
    // Alguien cancela en Stripe; el operador vuelve a ponerla a cobrar, como indica la alerta
    await cancelInStripe(w, first.stripeId);
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(1);
    // El abono seguía PENDIENTE en la suscripción cancelada: no se aplicó. Se retira del Customer (lo comparte el
    // circuito ordinario) y deja de constar como enviado
    expect(gw.invoiceItems).toEqual([]);
    const again = await w.neg.start(a.subId, A);
    // Segundo Checkout: solo la cuota (los 500 € de implantación ya se cobraron); el abono va, una vez, a la factura siguiente
    expect(again).toMatchObject({ status: "pending", recurringCents: 12900, firstChargeCents: 12900, deferredCredits: [{ amountCents: -2900 }] });
    const input = sessionCreates()[1].input as NegotiatedCheckoutInput;
    expect(input.lines.every((l) => l.interval === "month")).toBe(true);
    expect(input.lines.reduce((x, l) => x + l.unitAmount, 0)).toBe(12900);
    const second = gw.completeNegotiatedSession((again as { sessionId: string }).sessionId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "active", stripeSubscriptionId: second });
    expect(gw.invoices.get((await row(a.subId)).lastPaidInvoiceId!)!.subtotal).toBe(12900);
    expect(gw.invoiceItems.map((i) => [i.amount, i.subscriptionId])).toEqual([[-2900, second]]);
    expect(oneOffWrites()).toHaveLength(2);
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    // Sincronizar y conciliar sobre la suscripción nueva: lo ya enviado en la anterior consta, no se repite ni cuenta como diferencia
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    expect(gw.invoices.get(gw.chargeNegotiatedPeriod(second))!.subtotal).toBe(12900 - 2900);
    expect(gw.invoiceItems.map((i) => i.amount)).toEqual([-2900]);
    expect(oneOffWrites()).toHaveLength(2);
  });

  it("B2 — una cancelación de Stripe por impago sigue las reglas del impago (solo lectura y fin), no el camino de «alguien la canceló en Stripe»", async () => {
    const w = world();
    const a = await agreed(1);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    await grant("t-acme", "plan.essential", `subscription:${a.subId}`);
    // Impago (en gracia) y, a los 3 días, Stripe cancela por agotar reintentos
    gw.chargeNegotiatedPeriod(stripeId, "open");
    await deliver(w);
    expect((await row(a.subId)).status).toBe("past_due");
    clock += 3 * DAY;
    await cancelInStripe(w, stripeId);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: clock + 30 * DAY });
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("read_only");
    expect((await subs.must(a.subId)).status).toBe("canceled");
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(0);
    await expect(w.neg.start(a.subId, A)).rejects.toThrow(/ya terminó/);
    // Lo mismo si llega cancelada con la última factura sin cobrar, sin haber pasado antes por «impago»
    const b = await agreed(2);
    const other = await started(w, b.subId);
    const unpaid = gw.chargeNegotiatedPeriod(other.stripeId, "open");
    gw.updateSubscription(other.stripeId, { status: "canceled" });
    stripeStore.events.clear();
    await w.processor.process({ eventId: "solo", type: "customer.subscription.deleted", objectId: other.stripeId });
    expect(gw.invoices.get(unpaid)!.status).toBe("open");
    expect((await subs.must(b.subId)).status).toBe("canceled");
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(0);
  });

  it("B2 — una terminada solo en Stripe (al corriente) sigue a la vista en cada pasada hasta que alguien la resuelve", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    await cancelInStripe(w, stripeId);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: null });
    for (let n = 0; n < 3; n++) {
      clock += 10 * DAY;
      expect((await w.reconciler.tick()).negotiated!.drifted).toEqual([{ subscriptionId: a.subId, differences: [{ key: "terminada_solo_en_stripe", kind: "status" }] }]);
    }
    // Reinicio con un impedimento: la fila sigue «terminada» (no queda a medias)
    const blocked = world({ orderBilled: async () => true });
    await expect(blocked.neg.start(a.subId, A)).rejects.toThrow(/circuito ordinario/);
    expect((await row(a.subId)).status).toBe("canceled");
    // Resuelta al volver a ponerla a cobrar
    const again = (await w.neg.start(a.subId, A)) as { sessionId: string };
    gw.completeNegotiatedSession(again.sessionId);
    await deliver(w);
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated!.drifted).toEqual([]);
  });

  it("B3 — un envío que falla siempre se reintenta cada vez más espaciado, deja UN evento por error y sigue avisando en cada pasada", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    // El Product de un producto del acuerdo deja de estar enlazado: el cambio de condiciones no se puede enviar
    stripeStore.prices.forEach((p) => {
      if (p.lookupKey.startsWith("es:whatsapp:")) (p as { status: string }).status = "archived";
    });
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    const termsId = (await w.billing.plan(a.subId)).termsId!;
    expect((await termsStore.get(termsId))!.syncStatus).toBe("failed");
    // Un día de pasadas de conciliación cada 15 minutos
    let drifted = 0;
    for (let n = 0; n < 96; n++) {
      clock += 15 * 60_000;
      const r = await w.reconciler.tick();
      if (r.negotiated!.drifted[0]?.differences.some((d) => d.key === "sincronización_fallida")) drifted++;
    }
    expect(drifted).toBe(96);
    const detail = (await termsStore.get(termsId))!.syncDetail as { attempts: number; failures: number };
    // 15 min, 1 h, 4 h, 16 h: cinco intentos en un día, no noventa y seis
    expect(detail.failures).toBe(5);
    expect((await termsStore.events({ termsId })).filter((e) => e.kind === "sync")).toHaveLength(1);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(12900);
    // Arreglado el enlace, el siguiente reintento lo deja en Stripe
    stripeStore.prices.forEach((p) => ((p as { status: string }).status = "active"));
    clock += 24 * 3600_000;
    expect((await w.reconciler.tick()).negotiated!.drifted).toEqual([]);
    expect(gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0)).toBe(9900);
  });

  it("B4 — las condiciones terminan sin sucesor: Stripe no sigue cobrándolas; se programa su fin al final del periodo pagado, se avisa y, al terminar, termina la contratación", async () => {
    const w = world();
    const a = await agreed(1);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    await grant("t-acme", "plan.essential", `subscription:${a.subId}`);
    // Vence el acuerdo y nada lo sustituye: la suscripción interna se queda sin condiciones personalizadas vigentes
    clock += 10 * DAY;
    await store.mutate(a.subId, null, A, clock, async (tx) => {
      for (const i of await tx.items()) if (i.termsId != null && (i.effectiveTo === null || i.effectiveTo > clock)) await tx.endItem(i.id, clock);
      return { patch: {}, event: { kind: "terms_settled", before: null, after: null, reason: "Fin de las condiciones sin sucesor" }, result: null };
    });
    expect((await w.billing.plan(a.subId)).items).toEqual([]);
    const invoices = gw.invoices.size;
    clock += 20 * 60_000;
    const r = await w.reconciler.tick();
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
    expect(alerts.count("stripe.negotiated_terms_ended")).toBe(1);
    expect(gw.invoices.size).toBe(invoices);
    // Con el fin ya programado no es una diferencia ni se repite la orden
    expect(r.negotiated!.drifted).toEqual([]);
    const cancels = gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)").length;
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated!.drifted).toEqual([]);
    expect(gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)").length).toBe(cancels);
    expect(itemWrites()).toEqual([]);
    // Stripe termina al final del periodo: como el fin de una contratación (solo lectura y fin interno). Nunca queda una
    // contratación activa con licencias que ya nadie cobra
    await cancelInStripe(w, stripeId);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: clock + 30 * DAY });
    expect((await subs.must(a.subId)).status).toBe("canceled");
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("read_only");
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(0);
    expect(alerts.count("stripe.negotiated_terms_ended")).toBe(2);
    clock += 20 * 60_000;
    expect((await w.reconciler.tick()).negotiated!.drifted).toEqual([]);
  });

  it("menores: total negativo, sesión aplazada caducada, orden de fin que falla, y el contraste con lo vigente en el camino aplazado", async () => {
    // m2 — un abono mayor que la cuota deja la factura en negativo: no se cobra nada y no es una diferencia
    expect(invoiceTaxCheck("test_net_no_tax", [2100], { subtotal: -1000, taxCents: null, total: -1000, lines: [], amountPaid: 0 }, -1000)).toBe("ok");
    expect(invoiceTaxCheck("stripe_tax_exclusive", [2100], { subtotal: -1000, taxCents: -210, total: -1210, lines: [], amountPaid: 0 }, -1000)).toBe("ok");
    // m3 — una sesión aplazada que el cliente deja caducar no sigue desplazando el plan a la fecha de inicio
    const w = world();
    const D = T0 + 10 * DAY;
    const a = await agreed(1, PACKAGE({ effectiveFrom: D }));
    await w.neg.start(a.subId, A);
    expect((await w.billing.plan(a.subId)).recurringNetCents).toBe(12900);
    clock += 3 * 3600_000;
    expect((await w.billing.plan(a.subId)).items).toEqual([]);
    expect(await w.neg.billFrom(a.subId)).toBeNull();
    // m6 — si Stripe no acepta la orden de fin, no queda anotada como pedida
    const b = await agreed(2);
    await started(w, b.subId);
    gw.down = true;
    await expect(w.neg.setCancel(b.subId, true, A)).rejects.toThrow();
    gw.down = false;
    expect((await row(b.subId)).cancelRequestedAt).toBeNull();
    await w.neg.setCancel(b.subId, true, A);
    expect((await row(b.subId)).cancelRequestedAt).not.toBeNull();
  });

  it("menores: una partida tocada a mano en Stripe con un tipo fijo no cuenta como la pactada; las claves de etiquetado no se repiten", async () => {
    const w = world();
    const a = await agreed(1, PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [cat("essential"), custom("Soporte", 5000)] } as never));
    const { stripeId } = await started(w, a.subId);
    expect(new Set(tagWrites().map((c) => c.key)).size).toBe(tagWrites().length);
    // m8 — alguien pone un tipo fijo a una partida en Stripe: deja de ser «exactamente la pactada» y se sustituye por la buena
    const item = gw.negotiated.get(stripeId)!.items.find((i) => i.productId === "prod_essential")!;
    item.taxRateBp = 2100;
    item.unitAmount += 1;
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 1 });
    expect(gw.negotiated.get(stripeId)!.items.find((i) => i.productId === "prod_essential")).toMatchObject({ taxRateBp: null, unitAmount: 2900 });
  });
});

describe("tercera revisión independiente: lo que rige en una renovación llega a Stripe ANTES de ella", () => {
  const cancelInStripe = async (w: World, stripeId: string) => {
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    await deliver(w);
  };
  /** Próxima renovación de Stripe (ms). */
  const renewalAt = (stripeId: string) => gw.subscriptions.get(stripeId)!.currentPeriodEnd! * 1000;
  /** Llega la renovación: Stripe factura en `current_period_end` con lo que tiene en ese instante y llegan los webhooks. */
  const renew = async (w: World, stripeId: string, outcome: "paid" | "open" = "paid") => {
    clock = renewalAt(stripeId) + 60_000;
    const id = gw.chargeNegotiatedPeriod(stripeId, outcome);
    await deliver(w);
    return id;
  };
  const tick = async (w: World) => (await w.reconciler.tick()).negotiated!;
  const total = (stripeId: string) => gw.negotiated.get(stripeId)!.items.reduce((x, i) => x + i.unitAmount, 0);
  const pauses = () => gw.calls.filter((c) => c.op === "subscriptions.update(pause_collection)");
  const FREE = (from: number, to: number, over: Partial<TermsInput> = {}) => PACKAGE({ effectiveFrom: from, adjustments: [{ line: null, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring", endsAt: to, note: "periodo gratuito" }], ...over } as never);
  const ENDING = (at: number) => PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [cat("essential", { endsAt: at }), custom("Soporte", 5000, { endsAt: at })] } as never);

  it("1 — un cambio de importe que rige en la renovación está en Stripe antes de ella: la renovación cobra lo nuevo (no un periodo más de lo anterior)", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, effectiveFrom: R1 }));
    // Lejos de la renovación no cambia nada (lo de hoy sigue siendo lo de hoy)
    clock += 20 * 60_000;
    await tick(w);
    expect(total(stripeId)).toBe(12900);
    // A tres días de la renovación, la conciliación deja ya en Stripe lo que regirá en ella (sin factura ni prorrateo)
    const invoices = gw.invoices.size;
    clock = R1 - 2 * DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(total(stripeId)).toBe(9900);
    expect(gw.invoices.size).toBe(invoices);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    // Y la renovación cobra 99 €, conciliada con lo pactado
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 9900 });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
  });

  it("1 y 6 — unas condiciones que terminan sin sucesor en la renovación: Stripe no renueva (cancel_at_period_end, sin prorrateo); esa renovación no se cobra y la contratación termina", async () => {
    const w = world();
    const a = await agreed(1);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    await grant("t-acme", "plan.essential", `subscription:${a.subId}`);
    const R1 = renewalAt(stripeId);
    // Acuerdo nuevo cuyas partidas terminan todas en la renovación (p. ej. un acuerdo anual que vence) y nada detrás
    await applyNew(a.subId, ENDING(R1));
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ status: "active", cancelAt: R1 / 1000, cancelAtPeriodEnd: true });
    const ends = () => gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)");
    expect(ends().map((c) => c.input)).toEqual([{ subscriptionId: stripeId, cancel: true, prorationBehavior: "none" }]);
    // Nunca un cancel_at (en modo flexible acortaría el periodo y lo prorratearía)
    expect(gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at)")).toEqual([]);
    expect(alerts.count("stripe.negotiated_terms_ended")).toBe(1);
    // Es lo esperado (no un «fin solo en Stripe»); como ya no habrá más renovaciones, se avisa, como mucho una vez al día
    expect((await w.billing.reconcile(a.subId)).differences.map((d) => d.key)).toEqual(["fin_por_condiciones"]);
    const drift = [{ subscriptionId: a.subId, differences: [{ key: "fin_por_condiciones", kind: "status" }] }];
    for (const expected of [drift, [], [], drift]) {
      clock += expected === drift ? DAY : 20 * 60_000;
      expect((await tick(w)).drifted).toEqual(expected);
    }
    expect(alerts.count("stripe.negotiated_terms_ended")).toBe(3);
    expect(ends()).toHaveLength(1);
    // Llega la fecha: Stripe termina en lugar de renovar (ningún periodo más) y la contratación termina como cualquier fin
    const invoices = gw.invoices.size;
    expect(await renew(w, stripeId)).toBe("");
    expect(gw.invoices.size).toBe(invoices);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: clock + 30 * DAY });
    expect((await subs.must(a.subId)).status).toBe("canceled");
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("read_only");
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(0);
    clock += 20 * 60_000;
    expect((await tick(w)).drifted).toEqual([]);
  });

  it("1 — cuota 0 que empieza en la renovación: la pausa (con su reanudación) se pone antes; el periodo gratuito no se cobra y el primero de pago sí", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const R2 = month(R1);
    await applyNew(a.subId, FREE(R1, R2));
    expect(gw.pausedSubs.has(stripeId)).toBe(false);
    // A tres días de la renovación gratuita: en pausa, con la reanudación un minuto antes del primer instante de pago
    clock = R1 - 2 * DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    expect(gw.pauseResumes.get(stripeId)).toBe((R2 - 6 * 3600_000) / 1000);
    expect(itemWrites()).toEqual([]);
    // Renovación gratuita: Stripe la anula, no cobra nada y no es una diferencia
    const voided = await renew(w, stripeId);
    expect(gw.invoices.get(voided)).toMatchObject({ status: "void", amountPaid: 0 });
    expect((await row(a.subId)).status).toBe("active");
    clock += 20 * 60_000;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    // A tres días del primer periodo de pago se quita la pausa: esa renovación se cobra (no se anula)
    clock = R2 - 2 * DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(gw.pausedSubs.has(stripeId)).toBe(false);
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 12900 });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    expect(pauses()).toHaveLength(2);
  });

  it("1 — aunque la conciliación no llegue a pasar, Stripe reanuda solo el cobro antes del primer periodo de pago", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    await applyNew(a.subId, FREE(R1, month(R1)));
    clock = R1 - 2 * DAY;
    await tick(w);
    expect(gw.invoices.get(await renew(w, stripeId))!.status).toBe("void");
    // Sin ninguna pasada más: la renovación siguiente ya se cobra
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 12900 });
    expect(gw.pausedSubs.has(stripeId)).toBe(false);
  });

  it("2 — un importe único ya enviado que la pausa arrastra a una factura anulada no se pierde: se vuelve a enviar UNA vez y se cobra en el primer periodo de pago", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const R2 = month(R1);
    const D = clock + 5 * DAY;
    // Vence un cargo de implantación a mitad de periodo y, desde la renovación, un mes gratis
    await applyNew(a.subId, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial", startsAt: D })] }));
    await applyNew(a.subId, FREE(R1, R2));
    clock = D + 60_000;
    await tick(w);
    expect(gw.invoiceItems.map((i) => [i.amount, i.invoiceId])).toEqual([[50000, null]]);
    clock = R1 - 2 * DAY;
    await tick(w);
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    // Como Stripe: la renovación en pausa se lleva el importe pendiente a la factura que anula
    const voided = await renew(w, stripeId);
    expect(gw.invoices.get(voided)).toMatchObject({ status: "void", subtotal: 12900 + 50000, amountPaid: 0 });
    expect(gw.invoiceItems[0].invoiceId).toBe(voided);
    // Al quitar la pausa, la sincronización ve que no se cobró y lo envía de nuevo (una vez)
    clock = R2 - 2 * DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(oneOffWrites()).toHaveLength(2);
    expect(gw.invoiceItems.filter((i) => i.invoiceId === null).map((i) => i.amount)).toEqual([50000]);
    clock += 20 * 60_000;
    await tick(w);
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(oneOffWrites()).toHaveLength(2);
    // El primer periodo de pago lleva la cuota y la implantación, conciliado con lo pactado
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 12900 + 50000 });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
  });

  it("3 — la pausa solo se quita con las partidas de pago ya en Stripe: si no se pueden poner, Stripe no cobra lo de antes del periodo gratuito", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const R2 = month(R1);
    // Un mes gratis y, después, 99 € (no los 129 € de antes)
    await applyNew(a.subId, FREE(R1, R2, { globalAmountCents: 9900 }));
    // El Product de un producto deja de estar enlazado: las partidas de 99 € no se pueden enviar
    const link = (status: string) => stripeStore.prices.forEach((p) => p.lookupKey.startsWith("es:whatsapp:") && ((p as { status: string }).status = status));
    link("archived");
    clock = R1 - 2 * DAY;
    await tick(w);
    // Se pone en pausa igual (el periodo gratuito no se cobra), pero SIN reanudación automática: Stripe no la quitaría con lo de antes
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    expect(gw.pauseResumes.has(stripeId)).toBe(false);
    expect((await termsStore.get((await w.billing.plan(a.subId)).termsId!))!.syncStatus).toBe("failed");
    expect(gw.invoices.get(await renew(w, stripeId))!.status).toBe("void");
    // Antes del primer periodo de pago sigue fallando: la pausa NO se quita (nunca cobra 129 €) y se avisa
    clock = R2 - 2 * DAY;
    expect((await tick(w)).drifted[0].differences.map((d) => d.key)).toContain("sincronización_fallida");
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    expect(total(stripeId)).toBe(12900);
    // Arreglado el enlace: primero las partidas de 99 € y después se quita la pausa; la renovación cobra 99 €
    link("active");
    clock += DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(total(stripeId)).toBe(9900);
    expect(gw.pausedSubs.has(stripeId)).toBe(false);
    const order = gw.calls.filter((c) => c.op === "subscriptions.update(negotiated)" || c.op === "subscriptions.update(pause_collection)").map((c) => c.op);
    expect(order.slice(-2)).toEqual(["subscriptions.update(negotiated)", "subscriptions.update(pause_collection)"]);
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 9900 });
  });

  it("4 — un importe único enviado a una suscripción de Stripe cancelada y sin facturar NO cuenta como cobrado: se retira del Customer y el reinicio lo cobra una vez", async () => {
    const w = world();
    const a = await agreed(1);
    const first = await started(w, a.subId);
    const R1 = renewalAt(first.stripeId);
    const D = R1 + 5 * DAY;
    await applyNew(a.subId, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial", startsAt: D }), custom("Formación", 20000, { concept: "implementation", chargeClass: "initial", startsAt: clock })] }));
    // La formación entra en la renovación (cobrada); la implantación vence después y queda pendiente
    expect(gw.invoices.get(await renew(w, first.stripeId))).toMatchObject({ status: "paid", subtotal: 12900 + 20000 });
    clock = D + 60_000;
    await tick(w);
    expect(gw.invoiceItems.filter((i) => i.invoiceId === null).map((i) => i.amount)).toEqual([50000]);
    // Alguien cancela en Stripe con la implantación sin facturar: se borra del Customer (que comparte el circuito ordinario)
    await cancelInStripe(w, first.stripeId);
    expect(gw.invoiceItems.map((i) => i.amount)).toEqual([20000]);
    expect(gw.calls.filter((c) => c.op === "invoiceitems.delete")).toHaveLength(1);
    // El reinicio cobra la cuota y la implantación (no la formación, que ya se cobró), una vez
    const again = await w.neg.start(a.subId, A);
    expect(again).toMatchObject({ status: "pending", recurringCents: 12900, firstChargeCents: 12900 + 50000 });
    const second = gw.completeNegotiatedSession((again as { sessionId: string }).sessionId);
    await deliver(w);
    expect(gw.invoices.get((await row(a.subId)).lastPaidInvoiceId!)!.subtotal).toBe(12900 + 50000);
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced", applied: 0 });
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    expect(gw.invoices.get(await renew(w, second))!.subtotal).toBe(12900);
  });

  it("5 — el fin que programó la sincronización se deshace solo si llega un acuerdo posterior antes de esa fecha (y solo ese fin)", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    await applyNew(a.subId, ENDING(R1));
    expect(gw.subscriptions.get(stripeId)!.cancelAt).toBe(R1 / 1000);
    // Llega el sucesor antes del fin: Stripe deja de tener el fin y sigue cobrando lo nuevo
    clock += 2 * DAY;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAt: null, cancelAtPeriodEnd: false });
    expect(total(stripeId)).toBe(9900);
    expect(await w.billing.reconcile(a.subId)).toMatchObject({ consistent: true });
    // Deshacerlo también va sin prorrateo: no se cobran otra vez días ya pagados
    const ends = gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)");
    expect(ends.map((c) => c.input)).toEqual([{ subscriptionId: stripeId, cancel: true, prorationBehavior: "none" }, { subscriptionId: stripeId, cancel: false, prorationBehavior: "none" }]);
    expect(new Set(ends.map((c) => c.key)).size).toBe(2);
    clock += 20 * 60_000;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)")).toHaveLength(2);
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 9900 });
    // Un fin que NO programó la sincronización (puesto a mano en Stripe) nunca se deshace solo: se avisa
    gw.updateSubscription(stripeId, { cancelAt: renewalAt(stripeId) / 1000, cancelAtPeriodEnd: true });
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9800 }));
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(true);
    expect((await w.billing.reconcile(a.subId)).differences.map((d) => d.key)).toContain("fin_solo_en_stripe");
  });

  it("5 — un sucesor que empieza días después (hueco): no se termina; el hueco no se cobra y la renovación siguiente cobra el acuerdo nuevo", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const R2 = month(R1);
    await applyNew(a.subId, ENDING(R1));
    expect(gw.subscriptions.get(stripeId)!.cancelAt).toBe(R1 / 1000);
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, effectiveFrom: R1 + 5 * DAY }));
    expect(gw.subscriptions.get(stripeId)!.cancelAt).toBeNull();
    clock = R1 - 2 * DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    // Hueco hasta el acuerdo siguiente: en pausa, con las partidas del acuerdo siguiente ya puestas y su reanudación
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    expect(gw.pauseResumes.get(stripeId)).toBe((R1 + 5 * DAY - 6 * 3600_000) / 1000);
    expect(total(stripeId)).toBe(9900);
    expect(gw.invoices.get(await renew(w, stripeId))!.status).toBe("void");
    clock = R2 - 2 * DAY;
    expect(await tick(w)).toMatchObject({ drifted: [] });
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 9900 });
  });

  it("menores: el escalado de reintentos no vuelve a cero al anotar lo cobrado; las canceladas se revisan las más recientes primero", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    stripeStore.prices.forEach((p) => p.lookupKey.startsWith("es:whatsapp:") && ((p as { status: string }).status = "archived"));
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    clock += 20 * 60_000;
    await tick(w);
    const termsId = (await w.billing.plan(a.subId)).termsId!;
    const failures = ((await termsStore.get(termsId))!.syncDetail as { failures: number }).failures;
    expect(failures).toBeGreaterThan(0);
    await w.billing.recordSent(a.subId, stripeId, { "charge:999": "checkout:cs_x" }, A);
    expect(((await termsStore.get(termsId))!.syncDetail as { failures: number }).failures).toBe(failures);
    // Orden de las canceladas
    const mem = new MemoryTermsBillingStore();
    for (const sid of [11, 12, 13]) {
      const r = (await mem.create({ subscriptionId: sid, companyId: 1, stripeCustomerId: "cus_x", startedBy: A, now: sid })).row;
      await mem.patch(r.id, { status: "canceled" }, r.version, 100 - sid);
    }
    expect((await mem.list({ status: ["canceled"], newestFirst: true })).map((r) => r.subscriptionId)).toEqual([11, 12, 13]);
    expect((await mem.list({ status: ["canceled"], newestFirst: true, limit: 1 })).map((r) => r.subscriptionId)).toEqual([11]);
  });
});

describe("cuarta revisión independiente: modo flexible, fin sin prorrateo, huecos, ancla y cargos al aceptar", () => {
  const renewalAt = (stripeId: string) => gw.subscriptions.get(stripeId)!.currentPeriodEnd! * 1000;
  const renew = async (w: World, stripeId: string, outcome: "paid" | "open" = "paid") => {
    clock = renewalAt(stripeId) + 60_000;
    const id = gw.chargeNegotiatedPeriod(stripeId, outcome);
    await deliver(w);
    return id;
  };
  const tick = async (w: World) => (await w.reconciler.tick()).negotiated!;
  const ENDING = (at: number) => PACKAGE({ pricingMode: "per_item", globalAmountCents: undefined, lines: [cat("essential", { endsAt: at }), custom("Soporte", 5000, { endsAt: at })] } as never);
  const FREE = (from: number, to: number, over: Partial<TermsInput> = {}) => PACKAGE({ effectiveFrom: from, adjustments: [{ line: null, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring", endsAt: to, note: "periodo gratuito" }], ...over } as never);
  const cancelAts = () => gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at)");
  const periodEnds = () => gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)");

  it("B-1 — el doble modela el modo flexible: un cancel_at a más de un periodo vista ACORTA y prorratea el último periodo (por eso nunca se usa)", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    expect(gw.subscriptions.get(stripeId)!.billingMode).toBe("flexible");
    const R1 = renewalAt(stripeId);
    // Directamente contra el doble (lo que haría Stripe): fin a mitad del periodo siguiente
    await gw.setCancelAt(stripeId, (R1 + 10 * DAY) / 1000, "k-demo");
    const inv = gw.invoices.get(await renew(w, stripeId))!;
    expect(inv.subtotal).toBeLessThan(12900);
    expect(inv.lines?.[0].proration).toBe(true);
    expect(gw.subscriptions.get(stripeId)!.currentPeriodEnd).toBe((R1 + 10 * DAY) / 1000);
  });

  it("B-1 — fin a mitad de periodo: Stripe no renueva hacia un periodo que el contrato no cubre entero; esos días no se cobran y el servicio sigue hasta la fecha", async () => {
    const w = world();
    const a = await agreed(1);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    await grant("t-acme", "plan.essential", `subscription:${a.subId}`);
    const R1 = renewalAt(stripeId);
    const E = R1 + 10 * DAY;
    await applyNew(a.subId, ENDING(E));
    // El periodo que empezaría en R1 pasaría del fin: Stripe termina en R1, sin prorrateo y sin cancel_at
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true, cancelAt: R1 / 1000 });
    expect(cancelAts()).toEqual([]);
    const invoices = gw.invoices.size;
    expect(await renew(w, stripeId)).toBe("");
    expect(gw.invoices.size).toBe(invoices);
    // Nada se cobra de más; el contrato sigue hasta su fecha (sin cobro) y solo entonces termina
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: null });
    expect(await subs.must(a.subId)).toMatchObject({ status: "active", cancelAt: E });
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("active");
    clock = E - DAY;
    expect((await tick(w)).drifted).toEqual([]);
    expect((await subs.must(a.subId)).status).toBe("active");
    clock = E + 60_000;
    await tick(w);
    expect((await subs.must(a.subId)).status).toBe("canceled");
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("read_only");
    expect((await row(a.subId)).readOnlyUntil).toBe(clock + 30 * DAY);
  });

  it("B-1 — fin a más de un periodo vista: la renovación intermedia se cobra ENTERA (sin prorrateo) y el fin se programa en el último periodo", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const E = month(R1) + 10 * DAY;
    await applyNew(a.subId, ENDING(E));
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: false, cancelAt: null });
    const inv = gw.invoices.get(await renew(w, stripeId))!;
    expect(inv).toMatchObject({ status: "paid", subtotal: 2900 + 5000 });
    expect(inv.lines?.some((l) => l.proration)).toBe(false);
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    // Ya en el último periodo: la conciliación lo programa (sin prorrateo)
    clock += 20 * 60_000;
    await tick(w);
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true, cancelAt: month(R1) / 1000 });
    expect(periodEnds().map((c) => (c.input as { prorationBehavior?: string }).prorationBehavior)).toEqual(["none"]);
    expect(cancelAts()).toEqual([]);
    expect(await renew(w, stripeId)).toBe("");
  });

  it("B-1 — el ciclo de Stripe va anclado a la hora del pago: un periodo que acaba horas después del fin del acuerdo es su último periodo, no uno de más", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    // El acuerdo termina 11 h antes de la renovación siguiente (medianoche de Madrid frente a la hora del pago)
    await applyNew(a.subId, ENDING(month(R1) - 11 * 3600_000));
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(false);
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 7900 });
    clock += 20 * 60_000;
    await tick(w);
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(true);
  });

  it("B-1 — deshacer el fin con un sucesor va ANTES que las partidas y sin prorrateo: nada del periodo en curso se cobra con las partidas nuevas", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    await applyNew(a.subId, ENDING(R1));
    const invoices = gw.invoices.size;
    const items = gw.invoiceItems.length;
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900 }));
    const order = gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at_period_end)" || c.op === "subscriptions.update(negotiated)").map((c) => c.op);
    expect(order.slice(-2)).toEqual(["subscriptions.update(cancel_at_period_end)", "subscriptions.update(negotiated)"]);
    expect(periodEnds().map((c) => c.input)).toEqual([{ subscriptionId: stripeId, cancel: true, prorationBehavior: "none" }, { subscriptionId: stripeId, cancel: false, prorationBehavior: "none" }]);
    expect(gw.invoices.size).toBe(invoices);
    expect(gw.invoiceItems.length).toBe(items);
    expect(gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: false, cancelAt: null, currentPeriodEnd: R1 / 1000 });
  });

  it("B-2 — un hueco hasta un acuerdo ya activado que alguien cancela en el Dashboard es «solo en Stripe»: aviso, y la contratación y sus licencias no se tocan", async () => {
    const w = world();
    const a = await agreed(1);
    await subs.linkTenant(a.subId, { tenantId: "t-acme" }, A);
    const { stripeId } = await started(w, a.subId);
    await grant("t-acme", "plan.essential", `subscription:${a.subId}`);
    const R1 = renewalAt(stripeId);
    await applyNew(a.subId, ENDING(R1));
    await applyNew(a.subId, PACKAGE({ globalAmountCents: 9900, effectiveFrom: R1 + 5 * DAY }));
    clock = R1 - 2 * DAY;
    await tick(w);
    expect(gw.subscriptions.get(stripeId)!.cancelAtPeriodEnd).toBe(false);
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    await renew(w, stripeId);
    // En el hueco (hoy sin condiciones, B programado), alguien la cancela en Stripe
    clock += DAY;
    gw.updateSubscription(stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", stripeId);
    await deliver(w);
    expect(await row(a.subId)).toMatchObject({ status: "canceled", readOnlyUntil: null });
    expect(alerts.count("stripe.negotiated_ended_in_stripe")).toBe(1);
    expect(await subs.must(a.subId)).toMatchObject({ status: "active", cancelAt: null });
    expect((await statusOf("t-acme"))["plan.essential"]).toBe("active");
  });

  it("ancla de Madrid y cargos al aceptar: con el primer cargo aplazado, el cargo sin fecha se cobra al pagar la sesión; el ancla de meses de Madrid no se pierde", async () => {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    const w = world();
    subs.checkComposition = async () => undefined;
    // Servicio desde el 1 de diciembre (medianoche de Madrid): suscripción solo económica, meses de calendario de Madrid
    const D = Date.UTC(2026, 10, 30, 23);
    // Paquete nuevo solo económico (el camino de la contratación de paquetes): cuota desde D, alta sin fecha (al aceptar)
    const pkg = await terms.createPackage(1, { pricingMode: "per_item", presentation: "breakdown", interval: "month", reason: "Paquete", lines: [custom("Servicio gestionado", 4463, { concept: "professional_service", startsAt: D }), custom("Alta", 10000, { concept: "implementation", chargeClass: "initial" })] } as never, A);
    const prepared = await terms.prepareContracting(pkg.id, { expectedRevision: pkg.revision }, A);
    const sub = await subs.must(prepared.terms.subscriptionId!);
    expect(sub.anchorDay).toBeLessThan(0);
    const s = await w.neg.start(sub.id, A);
    expect(s).toMatchObject({ status: "pending", firstChargeAt: D, recurringCents: 4463, firstChargeCents: 4463 });
    const input = sessionCreates()[0].input as NegotiatedCheckoutInput;
    expect(input.trialEnd).toBe(D / 1000);
    expect(input.lines.filter((l) => l.interval === null).map((l) => l.unitAmount)).toEqual([10000]);
    const stripeId = gw.completeNegotiatedSession((s as { sessionId: string }).sessionId);
    await deliver(w);
    // Lo debido al aceptar se cobra ya, no en la factura del 1 de diciembre
    expect(gw.invoices.get((await row(sub.id)).lastPaidInvoiceId!)).toMatchObject({ billingReason: "subscription_create", subtotal: 10000 });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    expect(gw.invoiceItems).toEqual([]);
    // Primer cargo de cuota el día del inicio, solo la cuota; el ancla interna sigue siendo la de Madrid
    gw.updateSubscription(stripeId, { status: "active" });
    expect(gw.invoices.get(await renew(w, stripeId))).toMatchObject({ status: "paid", subtotal: 4463 });
    expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    const after = await subs.must(sub.id);
    expect(after.anchorDay).toBe(sub.anchorDay);
    expect(after.currentPeriodStart).toBe(D);
  });

  it("menores: al ENTRAR en la pausa, pausa antes que partidas; una pausa sin fecha borra la anterior", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const R2 = month(R1);
    await applyNew(a.subId, FREE(R1, R2, { globalAmountCents: 9900 }));
    clock = R1 - 2 * DAY;
    await tick(w);
    const ops = gw.calls.filter((c) => c.op === "subscriptions.update(pause_collection)" || c.op === "subscriptions.update(negotiated)").map((c) => [c.op, (c.input as { resumesAt?: number | null }).resumesAt ?? null]);
    expect(ops).toEqual([["subscriptions.update(pause_collection)", null], ["subscriptions.update(negotiated)", null], ["subscriptions.update(pause_collection)", (R2 - 6 * 3600_000) / 1000]]);
    expect(gw.pauseResumes.get(stripeId)).toBe((R2 - 6 * 3600_000) / 1000);
    // Cambia lo que regirá después y no se puede enviar: la pausa sigue, pero SIN la reanudación anterior (se borra)
    stripeStore.prices.forEach((p) => p.lookupKey.startsWith("es:whatsapp:") && ((p as { status: string }).status = "archived"));
    await applyNew(a.subId, FREE(clock, R2, { globalAmountCents: 9800 }));
    expect(gw.pausedSubs.has(stripeId)).toBe(true);
    expect(gw.pauseResumes.has(stripeId)).toBe(false);
    const last = gw.calls.filter((c) => c.op === "subscriptions.update(pause_collection)").at(-1)!;
    expect(last.input).toMatchObject({ paused: true, resumesAt: null });
  });

  it("menores: un importe único en una factura que un OPERADOR anuló (no la pausa) no se vuelve a cobrar: queda como diferencia", async () => {
    const w = world();
    const a = await agreed(1);
    const { stripeId } = await started(w, a.subId);
    const R1 = renewalAt(stripeId);
    const R2 = month(R1);
    // Hubo una pausa (mes gratis) y después un cargo único
    await applyNew(a.subId, FREE(R1, R2));
    clock = R1 - 2 * DAY;
    await tick(w);
    const voided = await renew(w, stripeId);
    expect((await billingStore.invoice(voided))!.taxCheck).toBe("paused_void");
    clock = R2 - 2 * DAY;
    await tick(w);
    const D = clock + 60_000;
    await applyNew(a.subId, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Migración", 30000, { concept: "implementation", chargeClass: "initial", startsAt: D })] }));
    clock = D + 60_000;
    await tick(w);
    expect(oneOffWrites()).toHaveLength(1);
    // La renovación queda impagada y un operador la anula para perdonar el cargo
    const open = await renew(w, stripeId, "open");
    await gw.voidInvoice(open);
    await deliver(w);
    clock += 20 * 60_000;
    await tick(w);
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced" });
    expect(oneOffWrites()).toHaveLength(1);
    expect((await w.billing.reconcile(a.subId)).differences.map((d) => d.kind)).toContain("one_off");
  });

  it("menores: una sincronización a la vez por suscripción (el arrendamiento de los webhooks)", async () => {
    const w = world();
    const a = await agreed(1);
    await started(w, a.subId);
    expect(await stripeStore.acquireLease(`terms-billing:${a.subId}`, clock + 60_000, clock)).toBe(true);
    const calls = gw.calls.length;
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "busy" });
    expect(gw.calls.length).toBe(calls);
    await stripeStore.releaseLease(`terms-billing:${a.subId}`, clock + 60_000);
    expect(await w.billing.sync(a.subId, A)).toMatchObject({ status: "synced" });
  });

  it("menores: al terminar se retiran TODOS los importes pendientes, aunque el cliente tenga más de 500 importes", async () => {
    const w = world();
    const a = await agreed(1);
    const first = await started(w, a.subId);
    const D = clock + 5 * DAY;
    await applyNew(a.subId, PACKAGE({ lines: [cat("essential"), cat("hotel-net"), cat("whatsapp"), custom("Implantación", 50000, { concept: "implementation", chargeClass: "initial", startsAt: D })] }));
    clock = D + 60_000;
    await tick(w);
    // 600 importes ya facturados más recientes (de otra cosa del mismo cliente) por delante del pendiente
    for (let n = 0; n < 600; n++) gw.invoiceItems.unshift({ id: `ii_old_${n}`, amount: 100, currency: "EUR", subscriptionId: first.stripeId, invoiceId: "in_otra", metadata: {} });
    gw.updateSubscription(first.stripeId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", first.stripeId);
    await deliver(w);
    expect(gw.invoiceItems.filter((i) => i.invoiceId === null)).toEqual([]);
    expect(gw.calls.filter((c) => c.op === "invoiceitems.delete")).toHaveLength(1);
  });
});

describe("quinta revisión independiente: tantos cobros como periodos cubre el contrato", () => {
  const renewalAt = (stripeId: string) => gw.subscriptions.get(stripeId)!.currentPeriodEnd! * 1000;
  const tick = async (w: World) => (await w.reconciler.tick()).negotiated!;
  /**
   * Paquete solo económico de N periodos desde hoy (fechas de Madrid, como las del acuerdo); el cliente paga `late` días
   * después del inicio. Se recorren todas las renovaciones hasta que Stripe termina y se cuentan los cobros.
   */
  async function charges(interval: "month" | "year", periods: number, late: number, extra = 0) {
    gw.addProduct({ id: CUSTOM_SERVICE_PRODUCT_ID, name: "Servicio a medida" });
    subs.checkComposition = async () => undefined;
    const w = world();
    const S = clock;
    const E = addMonthsUTC(S, periods * (interval === "year" ? 12 : 1), madridAnchor(S)) + extra;
    const amount = interval === "year" ? 120000 : 4463;
    const pkg = await terms.createPackage(1, { pricingMode: "per_item", presentation: "breakdown", interval, reason: "Paquete", lines: [custom("Servicio gestionado", amount, { concept: "professional_service", endsAt: E })] } as never, A);
    const prepared = await terms.prepareContracting(pkg.id, { expectedRevision: pkg.revision }, A);
    const subId = prepared.terms.subscriptionId!;
    clock += late * DAY;
    const s = (await w.neg.start(subId, A)) as { sessionId: string };
    const stripeId = gw.completeNegotiatedSession(s.sessionId);
    await deliver(w);
    for (let n = 0; n < 40 && gw.subscriptions.get(stripeId)!.status !== "canceled"; n++) {
      clock = renewalAt(stripeId) - 2 * DAY;
      await tick(w);
      clock = renewalAt(stripeId) + 60_000;
      if (gw.chargeNegotiatedPeriod(stripeId) === "") break;
      await deliver(w);
    }
    await deliver(w);
    const paid = Array.from(gw.invoices.values()).filter((i) => i.subscriptionId === stripeId && i.status === "paid");
    // Nunca un periodo prorrateado ni otro importe
    expect(paid.every((i) => i.subtotal === amount)).toBe(true);
    expect(cancelAts()).toEqual([]);
    return { count: paid.length, subId, E };
  }
  const cancelAts = () => gw.calls.filter((c) => c.op === "subscriptions.update(cancel_at)");

  for (const late of [0, 1, 4, 20]) {
    it(`mensual de 6 meses pagado ${late} días después del inicio: 6 cobros`, async () => {
      expect((await charges("month", 6, late)).count).toBe(6);
      expect(alerts.count("stripe.negotiated_invoice_mismatch")).toBe(0);
    });
    it(`anual de 2 años pagado ${late} días después del inicio: 2 cobros`, async () => {
      expect((await charges("year", 2, late)).count).toBe(2);
    });
  }

  it("un contrato de 12 meses son 12 cobros", async () => {
    expect((await charges("month", 12, 4)).count).toBe(12);
  });

  it("un tramo final que no llega a un periodo entero (6 meses y medio) no se cobra: 6 cobros, nunca un séptimo", async () => {
    const r = await charges("month", 6, 4, 15 * DAY);
    expect(r.count).toBe(6);
    // El servicio sigue sin cobro hasta la fecha de fin del acuerdo
    const sub = await subs.must(r.subId);
    expect(sub.status === "canceled" || sub.cancelAt === r.E).toBe(true);
  });

  it("menor: los fines internos aplazados se aplican aunque haya más de 200 canceladas más recientes", async () => {
    const w = world();
    const r = await charges("month", 6, 0, 15 * DAY);
    expect(await subs.must(r.subId)).toMatchObject({ status: "active", cancelAt: r.E });
    // 250 contrataciones canceladas posteriores (ya resueltas)
    for (let n = 0; n < 250; n++) {
      const x = (await billingStore.create({ subscriptionId: 10_000 + n, companyId: 2, stripeCustomerId: "cus_x", startedBy: A, now: clock })).row;
      await billingStore.patch(x.id, { status: "canceled", readOnlyUntil: clock + 30 * DAY }, x.version, clock + n);
    }
    clock = r.E + 60_000;
    await tick(w);
    expect((await subs.must(r.subId)).status).toBe("canceled");
    expect((await row(r.subId)).readOnlyUntil).toBe(clock + 30 * DAY);
  });
});
