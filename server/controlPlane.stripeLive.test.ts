/**
 * Stripe Billing en MODO LIVE por HTTP, con la aplicación REAL del plano de control (en memoria). Solo
 * Stripe es un doble (`FakeStripeGateway` que imita una cuenta live, sin red); la firma del webhook usa la
 * criptografía REAL del SDK. Comprueba lo que distingue al entorno live:
 *
 *  - Con `stripe_tax_exclusive`: Checkout con Stripe Tax y aviso sin «pruebas»; pago → webhook live firmado →
 *    empresa activa; el pago queda con proveedor `stripe` y modo `live`.
 *  - Eventos e ids de sesión de pruebas rechazados en live.
 *  - Sin política fiscal: Checkout apagado y ninguna llamada a Stripe.
 *  - Los pagos simulados y un almacén de otro modo no pueden montarse.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createContractActivation } from "./crm/activation";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { catalogFromWebStore } from "./subscriptions/ports";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryOrderStore } from "./orchestrator/store";
import { SignedTestProvider } from "./orchestrator/payments";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import { LIVE_TAX_NOTICE } from "./stripe/checkout";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type CheckoutSessionInput, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { FailureAlerts, configureFailureAlerts } from "./_core/ops/failureAlerts";
import { STRIPE_FAILURE_RULES } from "./stripe/alerts";
import type { ViesPort } from "./stripe/vies";
import { MemoryWithdrawalStore } from "./withdrawals/store";

const ADMIN = "stripe-live-admin-token-aaaaaaaaaaaaaaaaa";
const CORE = "c".repeat(40);
const WEB = "https://web.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const liveConfig = (taxPolicy: StripeConfig["taxPolicy"]): StripeConfig => ({ mode: "live", apiKey: ["rk", "live", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "l".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "restricted", namespace: "live", eventsRetentionDays: 180, taxPolicy });
const sdk = new Stripe(liveConfig(null).apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });
const clock = Date.UTC(2026, 9, 18, 9);
const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read"] as const;

type Res = { status: number; json: any; raw: string };
const key = () => crypto.randomBytes(12).toString("hex");

/** Una instancia completa del plano de control con Stripe en live (memoria). */
async function liveControlPlane(o: { taxPolicy: StripeConfig["taxPolicy"]; store?: MemoryStripeStore; payments?: SignedTestProvider | null; noStripe?: boolean; ordersMode?: "test" | "live"; fiscal?: NonNullable<Parameters<typeof createControlPlaneApp>[0]["stripe"]>["fiscal"]; vies?: ViesPort; withdrawals?: boolean }) {
  const config = liveConfig(o.taxPolicy);
  const registry = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new TenantRegistryService(registry, () => ring);
  const provisioning = new ProvisioningService({
    registry: reg,
    reader: registry,
    databases: { ensureDatabase: async (id) => ({ dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
    schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
    seeder: { seedAdmin: async () => ({ created: true, inviteToken: crypto.randomBytes(8).toString("hex") }), seedBranding: async () => undefined },
    entitlements: { grant: async () => undefined },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    now: () => clock,
    sleep: async () => undefined,
  });
  const webStore = new MemoryWebStore();
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  const gw = new FakeStripeGateway();
  gw.livemode = true;
  const stripeStore = o.store ?? new MemoryStripeStore("live");
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_live_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_live_${op.params.metadata.es_web_price_id}`, productId: `prod_live_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  if (stripeStore.mode === "live") await syncCatalog(desired, gw, stripeStore, clock);
  gw.calls = [];
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const orders = new MemoryOrderStore();
  const app = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: [...all] }, { id: "core", sha256: hashToken(CORE), scopes: ["commerce:withdrawal"], actorType: "crm" }],
    ...(o.withdrawals ? { withdrawals: { store: new MemoryWithdrawalStore() } } : {}),
    registry: reg,
    reader: registry,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock },
    capabilities: new MemoryCapabilityStore(),
    orders: { store: orders, payments: o.payments ?? null, ...(o.ordersMode ? { mode: o.ordersMode } : {}) },
    stripe: o.noStripe ? undefined : {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: `${WEB}/contratacion/estado`, cancel: `${WEB}/contratacion/cancelada`, portalReturn: "https://app.elephant.test/admin/suscripcion" },
      // Bandera encendida: en live sin política, Checkout sigue apagado igualmente
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: true,
      selfService: false,
      termsVersion: null,
      fiscal: o.fiscal ?? { scenarios: new Set(["business:es_mainland"]), consent: { terms: "v1-prueba", privacy: null, precontract: null, withdrawal: "pending" }, taxExpectations: new Map([["business:es_mainland", "taxed"]]) },
      ...(o.vies ? { vies: { client: o.vies, maxAgeDays: 30 } } : {}),
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, path: string, c: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
    new Promise<Res>((resolve, reject) => {
      const data = c.raw ?? (c.body === undefined ? undefined : JSON.stringify(c.body));
      const token = c.token === undefined ? ADMIN : c.token;
      const req = http.request(
        { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(c.headers ?? {}) } },
        (res) => {
          let b = "";
          res.on("data", (x) => (b += x));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null, raw: b }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
    const r = await p;
    if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${r.raw}`);
    return r.json;
  };
  /** Lo que Stripe enviaría al destino del webhook, firmado con el secreto real; `livemode` del evento. */
  const webhook = (ev: GwEvent, livemode = ev.livemode) => {
    const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
    return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
  };
  const contractedOrder = async (name: string) => {
    const c = await crm.createCompany({ name }, "operator:test");
    await crm.createContact(c.id, { name: "Ana Live", email: `ana@c${c.id}.example` }, "operator:test");
    const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-live-${c.id}`, approvalReason: "Aprobado por producto" } }), [200, 202]);
    return created.order.id as number;
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { gw, stripeStore, orders, call, ok, webhook, contractedOrder, close };
}

const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};

describe("Stripe en modo live por HTTP, con política fiscal stripe_tax_exclusive", () => {
  let cp: Awaited<ReturnType<typeof liveControlPlane>>;
  beforeAll(async () => {
    cp = await liveControlPlane({ taxPolicy: "stripe_tax_exclusive" });
  });
  afterAll(() => cp.close());

  it("alta: Checkout con Stripe Tax → pago → webhook live firmado → activa; el pago queda como stripe/live", async () => {
    expect(await cp.ok(cp.call("GET", "/stripe/status"))).toMatchObject({ enabled: true, mode: "live", namespace: "live", taxPolicy: "stripe_tax_exclusive", checkoutEnabled: true });
    expect(await cp.ok(cp.call("GET", "/orders/payments/config"))).toMatchObject({ enabled: false, mode: "live", stripeProvider: "stripe", autoCharge: false });
    const orderId = await cp.contractedOrder("Live Essential SL");
    // Sin perfil fiscal del comprador, en live no se abre el pago
    expect((await cp.call("POST", `/stripe/orders/${orderId}/checkout`)).status).toBe(409);
    // Particular sin decisión legal sobre el desistimiento: se rechaza el perfil (409) y no se guarda nada
    const consumer = await cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: { type: "consumer", firstName: "Ana", lastName: "Live", country: "ES", postalCode: "28002" }, consent: { terms: true, termsVersion: "v1-prueba" } } });
    expect(consumer.status).toBe(409);
    expect(consumer.json.error).toBe("consumer_pending");
    // Empresa: versión de condiciones distinta de la vigente → 422; la vigente → perfil guardado (escenario aprobado)
    const business = { type: "business", legalName: "Live Essential SL", taxId: "B12345674", country: "ES", postalCode: "28002", line1: "Calle Mayor, 1", city: "Madrid" };
    expect((await cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: business, consent: { terms: true, termsVersion: "v0" } } })).status).toBe(422);
    const saved = await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: business, consent: { terms: true, termsVersion: "v1-prueba" } } }));
    expect(saved).toMatchObject({ approved: true, buyer: { type: "business", territory: "es_mainland", scenario: "business:es_mainland", taxIdStatus: "unverified", version: 1, consent: { source: "operator", terms: { version: "v1-prueba" } } } });
    expect(await cp.ok(cp.call("GET", "/stripe/status"))).toMatchObject({ fiscal: { approved: ["business:es_mainland"], consumerWithdrawal: "pending" } });
    const s = await cp.ok(cp.call("POST", `/stripe/orders/${orderId}/checkout`));
    expect(s).toMatchObject({ amountCents: 2900, currency: "EUR", taxTreatment: "stripe_tax_exclusive", reused: false });
    expect(s.sessionId).toMatch(/^cs_live_/);
    const input = cp.gw.calls.find((c) => c.op === "checkout.sessions.create")!.input as CheckoutSessionInput;
    expect(input).toMatchObject({ automaticTax: true, taxIdRequired: true, notice: LIVE_TAX_NOTICE, metadata: { es_env: "live", es_tax_treatment: "stripe_tax_exclusive", es_buyer_type: "business", es_fiscal_scenario: "business:es_mainland" } });
    // Pedido ya con sesión: el perfil se puede corregir mientras no se confirme el pago (nueva versión)
    expect((await cp.ok(cp.call("GET", `/stripe/orders/${orderId}/buyer`))).buyer.version).toBe(1);
    expect(input.notice).not.toMatch(/prueba/i);
    // Estado público: solo ids de sesión live
    expect(await cp.ok(cp.call("GET", `/public/checkout/status?session_id=${s.sessionId}`, { token: null }))).toMatchObject({ state: "pending_payment" });
    expect((await cp.call("GET", `/public/checkout/status?session_id=${s.sessionId.replace("cs_live_", "cs_test_")}`, { token: null })).status).toBe(400);
    expect((await cp.call("POST", `/stripe/checkout/${s.sessionId.replace("cs_live_", "cs_test_")}/sync`)).status).toBe(400);
    // La empresa dio su NIF en Checkout y la dirección coincide con la declarada: ningún aviso
    const raised: string[] = [];
    configureFailureAlerts(new FailureAlerts({ incidents: { raise: async (i: { dedupeKey: string }) => void raised.push(i.dedupeKey) } as never, rules: STRIPE_FAILURE_RULES }));
    cp.gw.invoiceTaxBp = 2100;
    cp.gw.taxIdsOf.set(cp.gw.sessions.get(s.sessionId)!.customerId!, 1);
    cp.gw.completeSession(s.sessionId);
    expect(await cp.ok(cp.webhook(cp.gw.events[0]))).toMatchObject({ received: true, duplicate: false });
    await until(async () => (await cp.ok(cp.call("GET", `/orders/${orderId}`))).order.state === "active");
    const detail = await cp.ok(cp.call("GET", `/orders/${orderId}`));
    expect(detail.payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", provider: "stripe", mode: "live", amountCents: 3509 })]); // lo cobrado: 29 € + 21 % de Stripe Tax
    expect((await cp.orders.payments(orderId)).every((p) => p.mode === "live" && p.provider === "stripe")).toBe(true);
    expect(raised.filter((k) => k.includes("buyer") || k.includes("tax"))).toEqual([]);
    // Registro de la factura cobrada y su documento fiscal pendiente (nada se emite sin sistema legal aprobado)
    const invs = await cp.ok(cp.call("GET", `/stripe/invoices?orderId=${orderId}`));
    expect(invs.invoices).toEqual([expect.objectContaining({ subtotalCents: 2900, taxCents: 609, totalCents: 3509, buyerScenario: "business:es_mainland" })]);
    const fd = await cp.ok(cp.call("GET", `/stripe/fiscal-documents?orderId=${orderId}`));
    expect(fd).toMatchObject({ sink: "pending", documents: [expect.objectContaining({ kind: "invoice", status: "pending", totalCents: 3509 })] });
    const docId = fd.documents[0].id;
    expect((await cp.call("POST", `/stripe/fiscal-documents/${docId}/issued`, { body: { externalRef: "<x>" } })).status).toBe(400);
    expect(await cp.ok(cp.call("POST", `/stripe/fiscal-documents/${docId}/issued`, { body: { externalRef: "F-2026-000001" } }))).toMatchObject({ document: { status: "issued", externalRef: "F-2026-000001" } });
    expect((await cp.call("POST", `/stripe/fiscal-documents/${docId}/issued`, { body: { externalRef: "F-2026-000002" } })).status).toBe(409);
    expect((await cp.call("POST", `/stripe/fiscal-documents/999999/issued`, { body: { externalRef: "F-1" } })).status).toBe(404);
  });

  it("factura con otra dirección y sin NIF: el pago se registra igual pero se avisa (revisión fiscal)", async () => {
    const raised: string[] = [];
    configureFailureAlerts(new FailureAlerts({ incidents: { raise: async (i: { dedupeKey: string }) => void raised.push(i.dedupeKey) } as never, rules: STRIPE_FAILURE_RULES }));
    const orderId = await cp.contractedOrder("Live Discrepancia SL");
    const business = { type: "business", legalName: "Live Discrepancia SL", taxId: "B99999997", country: "ES", postalCode: "28002", line1: "Calle Mayor, 2", city: "Madrid" };
    await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: business, consent: { terms: true, termsVersion: "v1-prueba" } } }));
    const s = await cp.ok(cp.call("POST", `/stripe/orders/${orderId}/checkout`));
    // En Checkout el cliente cambió la dirección a Canarias y no dio NIF
    const customerId = cp.gw.sessions.get(s.sessionId)!.customerId!;
    cp.gw.customers.set(customerId, { ...cp.gw.customers.get(customerId)!, address: { country: "ES", postalCode: "35001" } });
    cp.gw.invoiceTaxBp = 0;
    cp.gw.completeSession(s.sessionId);
    await cp.ok(cp.webhook(cp.gw.events[0]));
    await until(async () => (await cp.ok(cp.call("GET", `/orders/${orderId}`))).order.state === "active");
    expect((await cp.ok(cp.call("GET", `/orders/${orderId}`))).payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded" })]);
    expect(raised).toEqual(expect.arrayContaining(["rate:stripe.buyer_territory_mismatch", "rate:stripe.buyer_tax_id_missing", "rate:stripe.invoice_tax_mismatch"]));
    configureFailureAlerts(new FailureAlerts());
  });

  it("Customer Portal: el plan compara la configuración actual con la deseada sin escribir nada en Stripe", async () => {
    cp.gw.portalConfigs = [
      {
        id: "bpc_live_prueba",
        isDefault: true,
        active: true,
        invoiceHistory: true,
        paymentMethodUpdate: true,
        customerUpdate: { enabled: false, allowedUpdates: [] },
        cancel: { enabled: true, mode: "at_period_end", prorationBehavior: "none" },
        update: { enabled: false, defaultAllowedUpdates: [], products: [], prorationBehavior: "none", scheduleAtPeriodEnd: [] },
        termsUrl: null,
        privacyUrl: null,
      },
    ];
    const before = cp.gw.calls.length;
    const plan = await cp.ok(cp.call("GET", "/stripe/portal/plan"));
    expect(plan).toMatchObject({ configurationId: "bpc_live_prueba", applicable: 5 });
    expect(plan.writeParams.features.subscription_update.products).toHaveLength(2);
    // Solo una lectura en Stripe
    expect(cp.gw.calls.slice(before).map((c) => c.op)).toEqual(["billing_portal.configurations.list"]);
    expect((await cp.call("GET", "/stripe/portal/plan", { token: null })).status).toBe(401);
  });

  it("un evento de PRUEBAS con firma válida se rechaza en live (400) y no se guarda nada", async () => {
    const ev = cp.gw.emit("invoice.paid", "invoice", "in_x_0000000001");
    const before = await cp.stripeStore.eventCounts();
    const r = await cp.webhook(ev, false);
    expect(r).toMatchObject({ status: 400, json: { error: "test_event_rejected" } });
    expect(await cp.stripeStore.event(ev.id)).toBeNull();
    expect(await cp.stripeStore.eventCounts()).toEqual(before);
  });

  it("no existe el webhook de pagos simulados (sin token cae en la autenticación; con él, no existe)", async () => {
    expect((await cp.call("POST", "/payments/test/webhook", { token: null, body: {} })).status).toBe(401);
    expect((await cp.call("POST", "/payments/test/webhook", { body: {} })).status).toBe(404);
  });
});

describe("Stripe en modo live sin política fiscal", () => {
  it("Checkout apagado aunque la bandera esté encendida: 409 y ninguna llamada a Stripe ni nada guardado", async () => {
    const cp = await liveControlPlane({ taxPolicy: null });
    try {
      expect(await cp.ok(cp.call("GET", "/stripe/status"))).toMatchObject({ mode: "live", taxPolicy: "pending", checkoutEnabled: false, checkoutBlocked: "tax_policy_pending" });
      const orderId = await cp.contractedOrder("Live Pendiente SL");
      const r = await cp.call("POST", `/stripe/orders/${orderId}/checkout`);
      expect(r.status).toBe(409);
      expect(cp.gw.calls).toEqual([]);
      expect(cp.gw.customers.size).toBe(0);
      expect(cp.stripeStore.sessions.size).toBe(0);
      expect((await cp.ok(cp.call("GET", `/orders/${orderId}`))).order.state).toBe("contracted");
    } finally {
      await cp.close();
    }
  });
});

describe("montaje del modo live", () => {
  it("los pagos simulados no pueden montarse con Stripe en live", async () => {
    await expect(liveControlPlane({ taxPolicy: "stripe_tax_exclusive", payments: new SignedTestProvider({ webhookSecret: "secreto-del-proveedor-de-pruebas-0123456789abcdef" }) })).rejects.toThrow(/pagos simulados/);
  });

  it("un almacén de pruebas con la configuración live no se monta", async () => {
    await expect(liveControlPlane({ taxPolicy: "stripe_tax_exclusive", store: new MemoryStripeStore("test") })).rejects.toThrow(/modo test/);
  });

  it("un almacén sin modo declarado tampoco se monta (el modo es obligatorio)", async () => {
    const sinModo = Object.assign(new MemoryStripeStore("live"), { mode: undefined }) as unknown as MemoryStripeStore;
    await expect(liveControlPlane({ taxPolicy: "stripe_tax_exclusive", store: sinModo })).rejects.toThrow(/almacén de Stripe/);
  });

  it("sin Stripe montado (p. ej. live sin la 0013), el orquestador sigue en el modo de la configuración: live", async () => {
    const cp = await liveControlPlane({ taxPolicy: null, noStripe: true, ordersMode: "live" });
    try {
      expect(await cp.ok(cp.call("GET", "/orders/payments/config"))).toMatchObject({ mode: "live", stripeProvider: "stripe", enabled: false });
    } finally {
      await cp.close();
    }
    // Y en live los pagos simulados tampoco se montan aunque Stripe no esté
    await expect(liveControlPlane({ taxPolicy: null, noStripe: true, ordersMode: "live", payments: new SignedTestProvider({ webhookSecret: "secreto-del-proveedor-de-pruebas-0123456789abcdef" }) })).rejects.toThrow(/modo live/);
  });

  it("un modo de pedidos distinto del de Stripe no se monta", async () => {
    await expect(liveControlPlane({ taxPolicy: "stripe_tax_exclusive", ordersMode: "test" })).rejects.toThrow(/modo de los pedidos/);
  });
});

/**
 * Cierre del Checkout del lanzamiento (live, Stripe simulado): autónomo con NIF de persona física, empresa de la UE
 * con NIF-IVA verificado en VIES (y VIES caído), particular con desistimiento y territorios no aprobados. Lo que
 * NO se puede comprobar aquí (página real de Stripe, Stripe Tax real, VIES real) queda en COMPROBACIONES_APERTURA.md.
 */
describe("cierre del Checkout del lanzamiento (live)", () => {
  let cp: Awaited<ReturnType<typeof liveControlPlane>>;
  let viesStatus: "valid" | "invalid" | "unavailable" = "valid";
  const vies: ViesPort = { check: async (country, vatNumber) => ({ status: viesStatus, country, vatNumber, consultationNumber: viesStatus === "valid" ? "WAPIAAAAZ1" : null, traderName: null, traderAddress: null, detail: viesStatus === "valid" ? null : "MS_UNAVAILABLE" }) };
  beforeAll(async () => {
    cp = await liveControlPlane({
      taxPolicy: "stripe_tax_exclusive",
      vies,
      withdrawals: true,
      fiscal: {
        scenarios: new Set(["business:es_mainland", "business:eu", "consumer:es_mainland"]),
        consent: { terms: "v1-prueba", privacy: null, precontract: "pre1", withdrawal: "immediate_execution_ack" },
        taxExpectations: new Map([
          ["business:es_mainland", "taxed"],
          ["business:eu", "reverse_charge"],
          ["consumer:es_mainland", "taxed"],
        ]),
        countries: new Map(),
        consumerRates: new Map([["ES", 2100]]),
      },
    });
  });
  afterAll(() => cp.close());
  const pay = async (orderId: number, taxBp: number) => {
    const s = await cp.ok(cp.call("POST", `/stripe/orders/${orderId}/checkout`));
    const input = cp.gw.calls.filter((c) => c.op === "checkout.sessions.create").at(-1)!.input as CheckoutSessionInput;
    const customerId = cp.gw.sessions.get(s.sessionId)!.customerId!;
    cp.gw.invoiceTaxBp = taxBp;
    cp.gw.taxIdsOf.set(customerId, 1);
    const seen = cp.gw.events.length;
    cp.gw.completeSession(s.sessionId);
    // El doble añade los eventos nuevos al principio (los más recientes primero)
    for (const ev of cp.gw.events.slice(0, cp.gw.events.length - seen).reverse()) await cp.ok(cp.webhook(ev));
    await until(async () => (await cp.ok(cp.call("GET", `/orders/${orderId}`))).order.state === "active");
    return { input, customer: cp.gw.customers.get(customerId) as unknown as Record<string, unknown>, detail: await cp.ok(cp.call("GET", `/orders/${orderId}`)) };
  };

  it("autónomo con NIF de persona física: el Customer lleva su NIF-IVA (ES + DNI) y Checkout no lo vuelve a pedir; alta activa con IVA", async () => {
    const orderId = await cp.contractedOrder("Ana Autonoma");
    await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: { type: "business", legalName: "Ana Perez Gomez", taxId: "12345678Z", country: "ES", postalCode: "28002", line1: "Calle Mayor, 3", city: "Madrid" }, consent: { terms: true, termsVersion: "v1-prueba" } } }));
    const { input, customer, detail } = await pay(orderId, 2100);
    expect(input).toMatchObject({ lockTaxId: true, lockAddress: true, automaticTax: true });
    expect(customer).toMatchObject({ taxIds: [{ type: "eu_vat", value: "ES12345678Z" }], address: { country: "ES", postalCode: "28002", city: "Madrid" } });
    expect(detail.payments).toEqual([expect.objectContaining({ status: "succeeded", mode: "live", amountCents: 3509 })]);
    expect(detail.order.tenantId).toBeTruthy();
  });

  it("empresa con CIF: Customer con es_cif", async () => {
    const orderId = await cp.contractedOrder("Taller Norte SL");
    await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: { type: "business", legalName: "Taller Norte SL", taxId: "B11111119", country: "ES", postalCode: "48001", line1: "Gran Via, 10", city: "Bilbao" }, consent: { terms: true, termsVersion: "v1-prueba" } } }));
    const { customer } = await pay(orderId, 2100);
    expect(customer).toMatchObject({ taxIds: [{ type: "es_cif", value: "B11111119" }] });
  });

  it("empresa de Francia: con VIES caído no se abre el pago; verificado, Customer con su NIF-IVA y factura sin IVA (inversión)", async () => {
    const orderId = await cp.contractedOrder("Societe Test SAS");
    await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: { type: "business", legalName: "Societe Test SAS", taxId: "FR12345678901", country: "FR", postalCode: "75001", line1: "1 rue de Rivoli", city: "Paris" }, consent: { terms: true, termsVersion: "v1-prueba" } } }));
    viesStatus = "unavailable";
    const blocked = await cp.call("POST", `/stripe/orders/${orderId}/checkout`);
    expect(blocked.status).toBe(409);
    expect(blocked.raw).toContain("vat_check_unavailable");
    viesStatus = "valid";
    const { input, customer, detail } = await pay(orderId, 0);
    expect(input.metadata).toMatchObject({ es_fiscal_scenario: "business:eu", es_tax_expectation: "reverse_charge", es_vies_consultation: "WAPIAAAAZ1" });
    expect(customer).toMatchObject({ taxIds: [{ type: "eu_vat", value: "FR12345678901" }] });
    expect(detail.payments[0]).toMatchObject({ amountCents: 2900 });
    expect((await cp.ok(cp.call("GET", `/stripe/orders/${orderId}/vat-checks`))).checks.map((c: { status: string }) => c.status)).toEqual(["valid", "unavailable"]);
  });

  it("territorios y tipos no aprobados: rechazo seguro antes de crear nada en Stripe", async () => {
    const before = cp.gw.customers.size;
    for (const buyer of [
      { type: "business", legalName: "Canarias SL", taxId: "B87654323", country: "ES", postalCode: "35001", line1: "Calle Triana, 2", city: "Las Palmas" },
      { type: "business", legalName: "Tokyo KK", taxId: "1234567890123", country: "JP", line1: "1-1 Chiyoda", city: "Tokio" },
      { type: "consumer", firstName: "Marie", lastName: "Dupont", country: "FR", postalCode: "75001", line1: "2 rue X", city: "Paris" },
    ]) {
      const orderId = await cp.contractedOrder(`Fuera de alcance ${buyer.country}`);
      const consent = buyer.type === "consumer" ? { terms: true, termsVersion: "v1-prueba", precontractVersion: "pre1", immediateExecution: true } : { terms: true, termsVersion: "v1-prueba" };
      await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer, consent } }));
      const r = await cp.call("POST", `/stripe/orders/${orderId}/checkout`);
      expect(r.status).toBe(409);
      expect(r.raw).toMatch(/no se abre el pago/);
    }
    expect(cp.gw.customers.size).toBe(before);
  });

  it("particular de la Península: alta con IVA y, desde su cuenta, desistimiento con justificante (sin reembolso automático)", async () => {
    const orderId = await cp.contractedOrder("Lucia Particular");
    await cp.ok(cp.call("PUT", `/stripe/orders/${orderId}/buyer`, { body: { buyer: { type: "consumer", firstName: "Lucia", lastName: "Particular", country: "ES", postalCode: "07001", line1: "Carrer de Sant Miquel, 3", city: "Palma" }, consent: { terms: true, termsVersion: "v1-prueba", precontractVersion: "pre1", immediateExecution: true } } }));
    const { input, detail } = await pay(orderId, 2100);
    expect(input.taxIdRequired).toBeUndefined();
    expect(input.lockTaxId).toBeUndefined();
    const tenant = detail.order.tenantId as string;
    const status = await cp.ok(cp.call("GET", `/commerce/tenants/${tenant}/withdrawal`, { token: CORE }));
    expect(status.withdrawal).toMatchObject({ available: true, assessment: { applicability: "applicable", withinTerm: true, immediateExecution: true } });
    const refunds = cp.gw.calls.filter((c) => /refund|cancel/i.test(c.op)).length;
    const r = await cp.ok(cp.call("POST", `/commerce/tenants/${tenant}/withdrawal`, { token: CORE, body: { idempotencyKey: "desistimiento-lucia-0001", requestedBy: "user:1", contactEmail: "lucia@example.com" } }), 201);
    expect(r.receipt).toMatchObject({ reference: expect.stringMatching(/^DS-/), withinTerm: true, status: "received" });
    expect(cp.gw.calls.filter((c) => /refund|cancel/i.test(c.op)).length).toBe(refunds);
    expect((await cp.ok(cp.call("GET", "/withdrawals"))).withdrawals[0]).toMatchObject({ contractOrderId: orderId, status: "received" });
  });
});
