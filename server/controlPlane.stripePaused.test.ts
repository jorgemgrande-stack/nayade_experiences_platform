/**
 * CARACTERIZACIÓN (sin cambiar código de producción): cómo se trata cada estado de la suscripción de Stripe
 * (paused, unpaid, active, past_due) por el WEBHOOK y por el BARRIDO DE GRACIA del orquestador, con la aplicación REAL del
 * plano de control (en memoria) y solo Stripe como doble (`FakeStripeGateway`; firma del webhook con el SDK real).
 *
 * Fija el comportamiento ACTUAL, también cuando es dudoso: las divergencias llevan `// DIVERGENCIA:` y se
 * documentan en vez de arreglarse (la propuesta de corrección va en otro PR, aparte).
 *
 * Caminos y fichero:línea (lo que se ejercita):
 *  - Webhook: server/stripe/events.ts (estado → «active|past_due|unpaid|canceled»; paused → unpaid) → applyExternalBilling
 *    (server/orchestrator/service.ts).
 *  - Barrido de gracia: POST /orders/review → service.ts (past_due con la gracia vencida) → resolutor `stripeStatus` de
 *    server/controlPlane/api.ts (relee la API de Stripe; paused → null → no se suspende).
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
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MemoryOrderStore } from "./orchestrator/store";
import type { TrialNotifier } from "./trials/onboarding";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";

const ADMIN = "stripe-paused-admin-token-aaaaaaaaaaaaaa";
const WEB = "https://web.example";
const INTAKE_SECRET = "s".repeat(48);
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "p".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 9, 18, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
let registry: MemoryTenantRegistryStore;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
const orders = new MemoryOrderStore();
const gw = new FakeStripeGateway();
const stripeStore = new MemoryStripeStore();
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
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
const key = () => crypto.randomBytes(12).toString("hex");

/** Lo que Stripe enviaría al destino del webhook para un evento, firmado con el secreto real. */
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
/** El webhook guarda y responde; el procesamiento sigue en segundo plano: se espera a que termine. */
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const orderState = async (id: number) => (await ok(call("GET", `/orders/${id}`))).order.state as string;

beforeAll(async () => {
  registry = new MemoryTenantRegistryStore();
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
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  // Catálogo de Stripe creado según el plan de escrituras (lo que hará una persona en el sandbox) y enlazado
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  // + Social Token Net: en venta directa en la semilla, como en production (11/11/2026)
  expect((await syncCatalog(desired, gw, stripeStore, clock)).linked.filter((l) => l.sellable)).toHaveLength(4 + 1);
  crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read"] as const;
  const app = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: [...all] }],
    registry: reg,
    reader: registry,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    // Muchas llamadas de sondeo en esta prueba: sin el tope por minuto habitual
    perMinute: 1_000_000,
    perIpMinute: 1_000_000,
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    trials: { store: trialStore, publicEnabled: true, autoProvision: true, notify },
    orders: { store: orders, payments: null },
    publicIntake: { secret: INTAKE_SECRET, origins: [WEB] },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: `${WEB}/contratacion/estado`, cancel: `${WEB}/contratacion/cancelada`, portalReturn: "https://app.elephant.test/admin/suscripcion" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: true,
      selfService: true,
      // Condiciones legales SIN publicar (situación real hoy)
      termsVersion: null,
    },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Pedido asistido contratado (firmado) para una empresa nueva. */
async function contractedOrder(name: string, plan = "essential", interval = "month") {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Beta", email: `ana@c${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan, interval, items: [] } } }), 201);
  await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-beta-${c.id}`, approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
  return { orderId: created.order.id as number, companyId: c.id };
}


// ── Ayudas ───────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
type SubStatus = NonNullable<Parameters<FakeStripeGateway["updateSubscription"]>[1]["status"]>;

/** Entrega un evento como lo haría Stripe (webhook firmado) y espera a que el procesador lo termine. */
async function deliver(ev: GwEvent) {
  await ok(stripeWebhook(ev));
  await until(async () => ["processed", "ignored", "failed"].includes((await stripeStore.event(ev.id))?.status ?? ""));
  return (await stripeStore.event(ev.id))!;
}
/** Cambia el estado de la suscripción EN STRIPE y entrega el evento correspondiente. */
async function change(subId: string, status: SubStatus, type = "customer.subscription.updated") {
  gw.updateSubscription(subId, { status });
  return deliver(gw.emit(type, "subscription", subId));
}
/** Cambia el estado en Stripe SIN que llegue ningún evento (webhook perdido o aún sin entregar). */
const silently = (subId: string, status: SubStatus) => gw.updateSubscription(subId, { status });

/** Pedido cobrado en Stripe y activo, con su suscripción de Stripe. */
async function liveOrder(name: string) {
  const { orderId } = await contractedOrder(name);
  const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
  const subId = gw.completeSession(s.sessionId);
  await deliver(gw.events[0]);
  await until(async () => (await orderState(orderId)) === "active");
  const tenantId = (await ok(call("GET", `/orders/${orderId}`))).order.tenantId as string;
  return { orderId, subId, tenantId };
}
const TRANSITIONS = ["payment_failed", "suspend", "payment_recovered", "cancel", "cancelled"];
const kindsOf = async (orderId: number) => (await orders.events(orderId)).map((e) => e.kind as string).filter((k) => TRANSITIONS.includes(k));
const licenceStatuses = async (tenantId: string) => [...new Set((await caps.list(tenantId)).map((g) => g.status))];
const review = async () => ok(call("POST", "/orders/review"));
/** Fin de la gracia de un pedido en past_due y barrido de gracia (el reloj del orquestador es `clock`). */
async function sweepAtGraceEnd(orderId: number) {
  const o = (await ok(call("GET", `/orders/${orderId}`))).order;
  clock = Math.max(clock, o.graceEndsAt);
  await review();
}

describe("webhook: cada estado de la suscripción de Stripe sobre un pedido activo", () => {
  it("past_due: gracia de 7 días con el acceso intacto; sigue en past_due con eventos repetidos", async () => {
    const { orderId, subId, tenantId } = await liveOrder("Estado past_due SL");
    await change(subId, "past_due");
    const o = (await ok(call("GET", `/orders/${orderId}`))).order;
    expect(o.state).toBe("past_due");
    expect(o.graceEndsAt).toBe(clock + 7 * DAY);
    expect(await licenceStatuses(tenantId)).toEqual(["active"]);
    // Otro evento con el mismo estado: ni otra gracia ni otra transición
    await change(subId, "past_due");
    expect(await kindsOf(orderId)).toEqual(["payment_failed"]);
  });

  it("unpaid desde active: se encadena payment_failed + suspend en el MISMO evento; acceso suspendido, datos conservados", async () => {
    const { orderId, subId, tenantId } = await liveOrder("Estado unpaid SL");
    await change(subId, "unpaid");
    expect(await orderState(orderId)).toBe("suspended");
    // service.ts ~1222-1226: `step()` reasigna el pedido, así que el segundo `if` ya ve «past_due» y suspende sin esperar a otro evento
    expect(await kindsOf(orderId)).toEqual(["payment_failed", "suspend"]);
    expect(await licenceStatuses(tenantId)).toEqual(["suspended"]);
    expect((await caps.list(tenantId)).length).toBeGreaterThan(0);
  });

  it("paused desde active: el webhook lo trata EXACTAMENTE como unpaid (suspensión inmediata), también con el evento .paused", async () => {
    const a = await liveOrder("Estado paused SL");
    await change(a.subId, "paused", "customer.subscription.paused");
    expect(await orderState(a.orderId)).toBe("suspended");
    expect(await kindsOf(a.orderId)).toEqual(["payment_failed", "suspend"]);
    expect(await licenceStatuses(a.tenantId)).toEqual(["suspended"]);
    // La copia local conserva el estado crudo de Stripe
    expect(await stripeStore.subscription(a.subId)).toMatchObject({ status: "paused" });
    const u = await liveOrder("Estado unpaid gemelo SL");
    await change(u.subId, "unpaid");
    const detail = async (id: number) => (await orders.events(id)).filter((e) => e.kind === "suspend").map((e) => e.detail);
    // Mismo detalle de suspensión: el motivo dice «agotó los reintentos» aunque Stripe solo la pausó
    expect(await detail(a.orderId)).toEqual(await detail(u.orderId));
    expect((await detail(a.orderId))[0]).toMatchObject({ source: "stripe", reason: "Stripe agotó los reintentos de cobro" });
  });

  it("paused → resumed/active: recuperación automática (un solo payment_recovered aunque el estado se repita)", async () => {
    const a = await liveOrder("Reanudación SL");
    await change(a.subId, "paused", "customer.subscription.paused");
    expect(await orderState(a.orderId)).toBe("suspended");
    await change(a.subId, "active", "customer.subscription.resumed");
    await change(a.subId, "active");
    expect(await orderState(a.orderId)).toBe("active");
    expect(await licenceStatuses(a.tenantId)).toEqual(["active"]);
    expect(await kindsOf(a.orderId)).toEqual(["payment_failed", "suspend", "payment_recovered"]);
  });

  it("past_due → unpaid (reintentos agotados): suspensión; past_due → active: se recupera en la gracia", async () => {
    const a = await liveOrder("Escalada SL");
    await change(a.subId, "past_due");
    await change(a.subId, "unpaid");
    expect(await kindsOf(a.orderId)).toEqual(["payment_failed", "suspend"]);
    await change(a.subId, "active");
    expect(await orderState(a.orderId)).toBe("active");
    const b = await liveOrder("Recuperación en gracia SL");
    await change(b.subId, "past_due");
    await change(b.subId, "active");
    expect(await kindsOf(b.orderId)).toEqual(["payment_failed", "payment_recovered"]);
  });

  it("trialing cuenta como active; incomplete no cambia nada", async () => {
    const a = await liveOrder("Trialing SL");
    await change(a.subId, "past_due");
    await change(a.subId, "trialing");
    expect(await orderState(a.orderId)).toBe("active");
    await change(a.subId, "past_due");
    await change(a.subId, "incomplete");
    // incomplete mapea a «sin cambios»: sigue en gracia
    expect(await orderState(a.orderId)).toBe("past_due");
  });
});

describe("webhook: eventos DUPLICADOS y FUERA DE ORDEN (el estado se relee de Stripe; el evento solo dice «mira este objeto»)", () => {
  it("el mismo evento (mismo id) repetido: responde duplicate y no vuelve a tocar el pedido", async () => {
    const a = await liveOrder("Duplicado paused SL");
    gw.updateSubscription(a.subId, { status: "paused" });
    const ev = gw.emit("customer.subscription.paused", "subscription", a.subId);
    await deliver(ev);
    expect(await ok(stripeWebhook(ev))).toMatchObject({ duplicate: true });
    expect(await orderState(a.orderId)).toBe("suspended");
    expect(await kindsOf(a.orderId)).toEqual(["payment_failed", "suspend"]);
  });

  it("varios eventos distintos con estados que acaban en suspensión (paused, unpaid, paused): una sola suspensión", async () => {
    const a = await liveOrder("Doble suspensión SL");
    await change(a.subId, "paused", "customer.subscription.paused");
    await change(a.subId, "unpaid");
    await change(a.subId, "paused");
    expect((await kindsOf(a.orderId)).filter((k) => k === "suspend")).toHaveLength(1);
    expect(await orderState(a.orderId)).toBe("suspended");
  });

  it("evento «active» atrasado cuando Stripe ya está en unpaid o paused: no reactiva (se aplica el estado actual)", async () => {
    for (const now of ["unpaid", "paused"] as const) {
      const a = await liveOrder(`Active atrasado tras ${now} SL`);
      const stale = gw.emit("customer.subscription.updated", "subscription", a.subId, 1_000_000); // «active» de hace tiempo
      await change(a.subId, now);
      expect(await orderState(a.orderId)).toBe("suspended");
      await deliver(stale);
      expect(await orderState(a.orderId)).toBe("suspended");
      expect(await licenceStatuses(a.tenantId)).toEqual(["suspended"]);
    }
  });

  it("evento «past_due» atrasado (marca de tiempo anterior) cuando Stripe ya está active: no suspende ni abre gracia", async () => {
    const a = await liveOrder("Past_due atrasado SL");
    const stale = gw.emit("customer.subscription.updated", "subscription", a.subId, 1_000_000);
    await change(a.subId, "past_due");
    await change(a.subId, "active");
    expect(await orderState(a.orderId)).toBe("active");
    await deliver(stale);
    expect(await orderState(a.orderId)).toBe("active");
    expect(await kindsOf(a.orderId)).toEqual(["payment_failed", "payment_recovered"]);
  });

  it("paused entregado ANTES que el alta: sin pago inicial verificado el pedido no avanza ni se suspende", async () => {
    const { orderId } = await contractedOrder("Paused antes del alta SL");
    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    const subId = gw.completeSession(s.sessionId);
    const completed = gw.events[0];
    gw.updateSubscription(subId, { status: "paused" });
    await deliver(gw.emit("customer.subscription.paused", "subscription", subId));
    const pipeline = ["contracted", "confirmed", "subscribed", "licensed"];
    expect(pipeline).toContain(await orderState(orderId));
    await deliver(completed);
    expect(pipeline).toContain(await orderState(orderId));
  });
});

describe("barrido de gracia (POST /orders/review): el estado se relee en la API de Stripe con el resolutor de controlPlane/api.ts", () => {
  /** Pedido en past_due con la gracia vencida y Stripe cambiado SIN evento (webhook perdido o atrasado). */
  async function expired(name: string, stripeNow: SubStatus) {
    const a = await liveOrder(name);
    await change(a.subId, "past_due");
    expect(await orderState(a.orderId)).toBe("past_due");
    silently(a.subId, stripeNow);
    await sweepAtGraceEnd(a.orderId);
    return a;
  }

  it.each(["past_due", "unpaid"] as const)("Stripe sigue en %s al vencer la gracia → suspende (origen stripe_grace)", async (st) => {
    const a = await expired(`Gracia ${st} SL`, st);
    expect(await orderState(a.orderId)).toBe("suspended");
    expect(await licenceStatuses(a.tenantId)).toEqual(["suspended"]);
    const ev = (await orders.events(a.orderId)).filter((e) => e.kind === "suspend");
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toMatchObject({ source: "stripe_grace", stripeStatus: st });
    // Repetir el barrido no repite la suspensión
    await review();
    expect((await orders.events(a.orderId)).filter((e) => e.kind === "suspend")).toHaveLength(1);
  });

  it.each(["active", "trialing", "canceled", "incomplete"] as const)("Stripe está en %s al vencer la gracia → NO suspende (queda en past_due)", async (st) => {
    const a = await expired(`Gracia ${st} SL`, st);
    expect(await orderState(a.orderId)).toBe("past_due");
    expect(await licenceStatuses(a.tenantId)).toEqual(["active"]);
  });

  it("paused al vencer la gracia: el resolutor devuelve null y NO suspende; el webhook de paused sí suspende", async () => {
    // DIVERGENCIA: controlPlane/api.ts (resolutor `stripeStatus`) solo reconoce past_due/unpaid/active/trialing/canceled/
    // incomplete_expired; «paused» devuelve null («no se puede saber») y el orquestador no suspende por fin de gracia
    // (service.ts ~1018-1021). En cambio el webhook (stripe/events.ts:549) trata paused como unpaid y suspende al instante.
    const a = await expired("Gracia paused SL", "paused");
    expect(await orderState(a.orderId)).toBe("past_due");
    expect(await licenceStatuses(a.tenantId)).toEqual(["active"]);
    expect((await orders.events(a.orderId)).filter((e) => e.kind === "suspend")).toHaveLength(0);
    // Se mantiene así por muchos barridos: solo un evento posterior de Stripe lo repara
    clock += 30 * DAY;
    await review();
    expect(await orderState(a.orderId)).toBe("past_due");
    await deliver(gw.emit("customer.subscription.paused", "subscription", a.subId));
    expect(await orderState(a.orderId)).toBe("suspended");
  });

  it("el barrido no actúa ANTES de vencer la gracia, con ningún estado", async () => {
    const a = await liveOrder("Gracia no vencida SL");
    await change(a.subId, "past_due");
    silently(a.subId, "unpaid");
    const o = (await ok(call("GET", `/orders/${a.orderId}`))).order;
    clock = o.graceEndsAt - 1;
    await review();
    expect(await orderState(a.orderId)).toBe("past_due");
  });

  it("tras la suspensión del barrido, un evento past_due atrasado no la revierte; el pago real sí", async () => {
    const a = await expired("Suspendido y evento atrasado SL", "unpaid");
    expect(await orderState(a.orderId)).toBe("suspended");
    await change(a.subId, "past_due");
    expect(await orderState(a.orderId)).toBe("suspended");
    await change(a.subId, "active");
    expect(await orderState(a.orderId)).toBe("active");
    expect(await licenceStatuses(a.tenantId)).toEqual(["active"]);
  });
});
