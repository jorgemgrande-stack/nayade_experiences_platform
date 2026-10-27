/**
 * Clientes externos en un entorno SIN Stripe (production hoy): el módulo se monta, el contrato y la aceptación digital
 * funcionan y la autorización del método de pago responde que Stripe no está configurado. Nunca aprovisiona nada.
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
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryOrderStore } from "./orchestrator/store";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryExternalStore } from "./external/store";
import { chargeInstant, localDate } from "./external/schedule";

const ADMIN = "external-admin-token-aaaaaaaaaaaaaaaaaaa";
const CRM_ORIGIN = "https://admin.example";
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "d".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 9, 27, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
let registry: MemoryTenantRegistryStore;
const crmStore = new MemoryCrmStore();
const gw = new FakeStripeGateway();
const stripeStore = new MemoryStripeStore();
const ext = new MemoryExternalStore();
const caps = new MemoryCapabilityStore();
const provisioningRuns: string[] = [];

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": o.headers?.["content-type"] ?? "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
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
          resolve({ status: res.statusCode ?? 0, json, raw: b });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
  const r = await p;
  if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${r.raw.slice(0, 400)}`);
  return r.json;
};
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
  await settled();
}
const madrid = (y: number, m: number, d: number, h = 8) => chargeInstant(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, h, "Europe/Madrid");
const sec = (ms: number) => Math.floor(ms / 1000);

beforeAll(async () => {
  registry = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new TenantRegistryService(registry, () => ring);
  const provisioning = new ProvisioningService({
    registry: reg,
    reader: registry,
    databases: { ensureDatabase: async (id) => (provisioningRuns.push(id), { dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
    schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
    seeder: { seedAdmin: async () => ({ created: true, inviteToken: "x" }), seedBranding: async () => undefined },
    entitlements: { grant: async () => undefined },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    now: () => clock,
    sleep: async () => undefined,
  });
  const webStore = new MemoryWebStore();
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read", "ops:write"] as const;
  const app = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: [...all] }],
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
    capabilities: caps,
    limits: new MemoryTenantLimitStore(),
    trials: { store: new MemoryTrialStore(), publicEnabled: false, autoProvision: false, notify: { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined } },
    orders: { store: new MemoryOrderStore(), payments: null },
    external: {
      store: ext,
      urls: { acceptance: `${CRM_ORIGIN}/cp/v1/public/contract-acceptance`, setupSuccess: `${CRM_ORIGIN}/ok`, setupCancel: `${CRM_ORIGIN}/ko`, portalReturn: CRM_ORIGIN },
      ipSalt: "s".repeat(32),
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


describe("clientes externos sin Stripe en el entorno", { timeout: 30_000 }, () => {
  it("contrato y aceptación funcionan; la autorización de pago responde que Stripe no está configurado", async () => {
    const c = await crm.createCompany({ name: "Nextair SL", legalName: "Nextair SL", taxId: "B00000000", country: "ES" }, "operator:test");
    const x = (await ok(call("POST", "/external", { body: { companyId: c.id, service: { key: "skinet", name: "SkiNet — Servicio tecnológico gestionado" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Servicio tecnológico gestionado de la plataforma Skicenter, infraestructura externa." } }), 201)).external;
    const a = (await ok(call("POST", `/external/${x.id}/acceptance`, { body: { name: "Laura Representante", email: "laura@nextair.example" } }), 201)).acceptance;
    const token = new URL(a.url).searchParams.get("token")!;
    expect((await call("GET", `/public/contract-acceptance?token=${token}`, { token: null })).status).toBe(200);
    expect((await call("POST", "/public/contract-acceptance", { token: null, raw: new URLSearchParams({ token, name: "Laura Representante", accept: "1" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(200);
    expect((await ok(call("GET", `/external/${x.id}`))).external.status).toBe("awaiting_payment_method");
    const r = await call("POST", `/external/${x.id}/payment-setup`);
    expect(r.status).toBe(503);
    expect(r.json.message).toMatch(/Stripe no está configurado/);
    expect(provisioningRuns).toEqual([]);
  });
});
