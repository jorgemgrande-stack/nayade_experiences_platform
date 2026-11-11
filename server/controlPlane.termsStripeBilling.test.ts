/**
 * Cobro en Stripe de condiciones personalizadas de punta a punta por HTTP con la aplicación REAL del plano de control
 * (Stripe es el doble de siempre; la firma del webhook es la real del SDK): interruptor, permisos de la acción expresa
 * del operador, sesión de pago sin duplicados, enlace por el webhook existente, conciliación y fin programado.
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
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { ROLE_SCOPES } from "./controlPlane/operatorRoles";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryTermsStore } from "./commercialTerms/store";
import { MemoryTermsBillingStore } from "./commercialTerms/billingStore";
import { CUSTOM_PRICING_SCOPE } from "./commercialTerms/permission";
import { CUSTOM_SERVICE_PRODUCT_ID } from "./commercialTerms/stripeGateway";
import { MemoryExternalStore } from "./external/store";
import { MemoryOrderStore } from "./orchestrator/store";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent, type NegotiatedCheckoutInput } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";

const TOK = { admin: "tsb-admin-token-aaaaaaaaaaaaaaaaaaaaaa", sales: "tsb-sales-token-bbbbbbbbbbbbbbbbbbbbbb", writer: "tsb-writer-token-cccccccccccccccccccc", service: "tsb-service-token-dddddddddddddddddd" };
const PUBLIC = "https://admin.example.test/cp/v1/public/contract-acceptance";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "d".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });
const clock = Date.UTC(2026, 10, 1, 10);

interface Env {
  server: http.Server;
  port: number;
  gw: FakeStripeGateway;
  stripeStore: MemoryStripeStore;
  billingStore: MemoryTermsBillingStore;
  P: Record<string, number>;
  companyId: number;
}

async function build(enabled: boolean): Promise<Env> {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore });
  const company = await crm.createCompany({ name: "Hotel Ejemplo", legalName: "Hotel Ejemplo, S.L.", taxId: "B12345674", country: "ES", billingEmail: "facturas@hotel.example" }, "t");
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  const gw = new FakeStripeGateway();
  const stripeStore = new MemoryStripeStore();
  const P: Record<string, number> = {};
  for (const key of ["essential", "connect-voice"]) {
    P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
    gw.addProduct({ id: `prod_${key}`, name: key });
    await stripeStore.upsertPrice({ webPriceId: P[key], stripeProductId: `prod_${key}`, stripePriceId: `price_${key}`, lookupKey: `es:${key}:monthly:eur:v${P[key]}`, now: clock });
  }
  const admin = ROLE_SCOPES.admin.filter((s) => !s.startsWith("commerce:"));
  const billingStore = new MemoryTermsBillingStore();
  const app = createControlPlaneApp({
    tokens: [
      { id: "ana", sha256: hashToken(TOK.admin), scopes: [...admin], actorType: "operator" },
      { id: "comercial", sha256: hashToken(TOK.sales), scopes: [...ROLE_SCOPES.sales], actorType: "operator" },
      { id: "operador", sha256: hashToken(TOK.writer), scopes: ["subscriptions:read", "subscriptions:write"], actorType: "operator" },
      { id: "integracion", sha256: hashToken(TOK.service), scopes: [...admin] },
    ],
    registry,
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock, terms: new MemoryTermsStore(), termsBilling: { enabled, store: billingStore } },
    external: { store: new MemoryExternalStore("test"), urls: { acceptance: PUBLIC, setupSuccess: `${PUBLIC}/autorizado`, setupCancel: `${PUBLIC}/cancelado`, portalReturn: `${PUBLIC}/portal` }, ipSalt: "sal-de-pruebas-para-seudonimizar-ips" },
    capabilities: new MemoryCapabilityStore(),
    orders: { store: new MemoryOrderStore(), payments: null },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: "https://web.example/estado", cancel: "https://web.example/cancelada", portalReturn: "https://app.elephant.test/admin" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: false,
      selfService: false,
      termsVersion: null,
    },
  } as never);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port, gw, stripeStore, billingStore, P, companyId: company.id };
}

type Res = { status: number; json: any };
const call = (env: Env, method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? TOK.admin : o.token;
    const req = http.request(
      { host: "127.0.0.1", port: env.port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = b ? JSON.parse(b) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const webhook = (env: Env, ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call(env, "POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
async function deliver(env: Env) {
  for (const ev of env.gw.events.slice().reverse()) expect((await webhook(env, ev)).status).toBe(200);
  for (let i = 0; i < 300; i++) {
    const c = await env.stripeStore.eventCounts();
    if (c.received === 0 && c.processing === 0) return c;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("los eventos no terminaron de procesarse");
}

/** Suscripción con un acuerdo activo: Essential + Connect Voice + mantenimiento a medida, 99 €/mes de cuota global. */
async function agreed(env: Env) {
  const s = await call(env, "POST", "/subscriptions", { body: { companyId: env.companyId, interval: "month", plan: { productKey: "essential", priceId: env.P.essential }, addons: [{ productKey: "connect-voice", priceId: env.P["connect-voice"] }] } });
  expect(s.status).toBe(201);
  const id = s.json.subscription.id as number;
  const draft = await call(env, "POST", `/subscriptions/${id}/terms`, {
    body: {
      pricingMode: "global",
      globalAmountCents: 9900,
      presentation: "global",
      reason: "Acuerdo comercial negociado",
      lines: [
        { kind: "catalog", productKey: "essential", priceId: env.P.essential },
        { kind: "catalog", productKey: "connect-voice", priceId: env.P["connect-voice"] },
        { kind: "custom", concept: "maintenance", name: "Mantenimiento", chargeClass: "recurring", unitCents: 5000, taxRateBp: 2100 },
      ],
    },
  });
  expect(draft.status).toBe(201);
  const sub = await call(env, "GET", `/subscriptions/${id}`);
  const act = await call(env, "POST", `/commercial-terms/${draft.json.terms.id}/activate`, { body: { expectedRevision: draft.json.terms.revision, expectedVersion: sub.json.subscription.version } });
  expect(act.status).toBe(200);
  return id;
}

describe("cobro en Stripe de condiciones personalizadas por HTTP", () => {
  let off: Env;
  let on: Env;
  beforeAll(async () => {
    off = await build(false);
    on = await build(true);
  });
  afterAll(async () => {
    for (const e of [off, on]) {
      e.server.closeAllConnections();
      await new Promise<void>((r) => e.server.close(() => r()));
    }
  });

  it("interruptor apagado: la puesta en cobro se rechaza y no sale ninguna llamada a Stripe", async () => {
    const id = await agreed(off);
    const r = await call(off, "POST", `/subscriptions/${id}/terms/billing/start`);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("disabled");
    expect((await call(off, "POST", `/subscriptions/${id}/terms/billing/sync`)).json.status).toBe("disabled");
    expect((await call(off, "POST", `/subscriptions/${id}/terms/billing/cancel`)).status).toBe(409);
    const view = await call(off, "GET", `/subscriptions/${id}/terms/billing/stripe`);
    expect(view.json).toMatchObject({ enabled: false, canStart: false, billing: null });
    expect((await call(off, "GET", `/subscriptions/${id}/terms/billing`)).json).toMatchObject({ available: false, plan: { recurringNetCents: 9900 } });
    expect(off.gw.calls).toEqual([]);
    expect(await off.billingStore.bySubscription(id)).toBeNull();
  });

  it("poner a cobrar es una acción expresa de un administrador central: ni comercial, ni operador de suscripciones, ni token de servicio", async () => {
    const id = await agreed(on);
    for (const path of ["start", "cancel", "resume"]) {
      for (const token of [TOK.sales, TOK.writer]) {
        const r = await call(on, "POST", `/subscriptions/${id}/terms/billing/${path}`, { token });
        expect(r.status).toBe(403);
        expect(r.json).toMatchObject({ error: "forbidden", scope: CUSTOM_PRICING_SCOPE });
      }
      const svc = await call(on, "POST", `/subscriptions/${id}/terms/billing/${path}`, { token: TOK.service });
      expect(svc.status).toBe(403);
      expect(svc.json.error).toBe("operator_session_required");
      expect((await call(on, "POST", `/subscriptions/${id}/terms/billing/${path}`, { token: null })).status).toBe(401);
    }
    // Consultar sí puede el comercial (subscriptions:read)
    expect((await call(on, "GET", `/subscriptions/${id}/terms/billing/stripe`, { token: TOK.sales })).status).toBe(200);
    expect(on.gw.calls).toEqual([]);
    expect(await on.billingStore.bySubscription(id)).toBeNull();
    // Encendido y sin puesta en cobro: sincronizar no hace nada (sigue en simulación)
    expect((await call(on, "POST", `/subscriptions/${id}/terms/billing/sync`)).json.status).toBe("not_linked");
    expect(on.gw.calls).toEqual([]);
  });

  it("recorrido: sesión de pago (una, reutilizada), pago del cliente, webhook firmado, enlace, conciliación y fin programado", async () => {
    const id = await agreed(on);
    const view = await call(on, "GET", `/subscriptions/${id}/terms/billing/stripe`);
    expect(view.json).toMatchObject({ enabled: true, canStart: true, blockers: [], taxTreatment: "test_net_no_tax" });
    const first = await call(on, "POST", `/subscriptions/${id}/terms/billing/start`);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ status: "pending", reused: false, recurringCents: 9900, firstChargeCents: 9900, currency: "EUR" });
    expect(first.json.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const again = await call(on, "POST", `/subscriptions/${id}/terms/billing/start`);
    expect(again.json).toMatchObject({ status: "pending", reused: true, sessionId: first.json.sessionId });
    const creates = on.gw.calls.filter((c) => c.op === "checkout.sessions.create(negotiated)");
    expect(creates).toHaveLength(1);
    const input = creates[0].input as NegotiatedCheckoutInput;
    expect(input.lines.map((l) => l.productId).sort()).toEqual([CUSTOM_SERVICE_PRODUCT_ID, "prod_connect-voice", "prod_essential"].sort());
    expect(input.lines.reduce((a, l) => a + l.unitAmount, 0)).toBe(9900);
    expect(on.gw.calls.filter((c) => c.op === "customers.create")).toHaveLength(1);
    // Aún sin enlace: sincronizar no toca nada
    expect((await call(on, "POST", `/subscriptions/${id}/terms/billing/sync`)).json.status).toBe("not_linked");

    // El cliente paga en Stripe; los eventos llegan por el webhook firmado de siempre
    const stripeId = on.gw.completeNegotiatedSession(first.json.sessionId);
    const counts = await deliver(on);
    expect(counts.failed).toBe(0);
    const linked = await call(on, "GET", `/subscriptions/${id}/terms/billing/stripe`);
    expect(linked.json.billing).toMatchObject({ status: "active", stripeSubscriptionId: stripeId, stripeStatus: "active" });
    expect(linked.json.invoices).toHaveLength(1);
    expect(linked.json.invoices[0]).toMatchObject({ status: "paid", subtotalCents: 9900, billingReason: "subscription_create" });
    expect((await call(on, "POST", `/subscriptions/${id}/terms/billing/start`)).json).toMatchObject({ status: "linked", stripeSubscriptionId: stripeId });
    expect(on.gw.subscriptions.size).toBe(1);
    // Conciliación: lo pactado coincide con lo que Stripe tiene (las partidas a medida ya llevan su clave)
    const rec = await call(on, "GET", `/subscriptions/${id}/terms/billing`);
    expect(rec.json).toMatchObject({ available: true, consistent: true, differences: [], stripe: { status: "active", cancelAtPeriodEnd: false } });
    expect((await call(on, "POST", `/subscriptions/${id}/terms/billing/sync`)).json).toMatchObject({ status: "synced", applied: 0 });
    // Los eventos de la contratación negociada no generan discordancias en el circuito ordinario
    expect((await on.stripeStore.eventCounts()).failed).toBe(0);
    expect(Array.from(on.stripeStore.events.values()).filter((e) => e.status === "ignored")).toEqual([]);

    // Fin programado por el operador (al final del periodo pagado) y vuelta atrás
    const cancel = await call(on, "POST", `/subscriptions/${id}/terms/billing/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.json.billing.status).toBe("cancel_scheduled");
    expect(on.gw.subscriptions.get(stripeId)).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
    const resume = await call(on, "POST", `/subscriptions/${id}/terms/billing/resume`);
    expect(resume.json.billing.status).toBe("active");
  });
});
