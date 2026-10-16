/**
 * API de licencias por capacidad (plano de control): vista previa, aplicación (exige
 * subscriptions:write Y entitlements:write), consulta por tenant y cambio manual con motivo.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryOrganizationStore } from "./organization/service";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";

const TOK = { org: "lic-org-token-dddddddddddddddddddddd", read: "lic-read-token-aaaaaaaaaaaaaaaaaaaa", subs: "lic-subs-token-bbbbbbbbbbbbbbbbbbbb", admin: "lic-admin-token-cccccccccccccccccc" };
let server: http.Server;
let port = 0;
let subscriptionId = 0;
const caps = new MemoryCapabilityStore();

const call = (method: string, path: string, o: { token?: string; body?: unknown } = {}) =>
  new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });

beforeAll(async () => {
  const clock = Date.UTC(2026, 9, 16, 10);
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "test" });
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore });
  const company = await crm.createCompany({ name: "Acme" }, "t");
  const contract = await crm.createContract({ companyId: company.id, planId: "business" }, "t");
  // Contrato firmado y con plataforma (en producción lo deja así la activación del contrato)
  await crmStore.update("contracts", contract.id, { status: "signed", tenantId: "acme" });
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  const price = async (key: string) => (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const subsStore = new MemorySubscriptionStore();
  const app = createControlPlaneApp({
    tokens: [
      { id: "lector", sha256: hashToken(TOK.read), scopes: ["subscriptions:read", "tenants:read"] },
      { id: "comercial", sha256: hashToken(TOK.subs), scopes: ["subscriptions:read", "subscriptions:write"] },
      { id: "org", sha256: hashToken(TOK.org), scopes: ["tenants:read", "tenants:write"] },
      { id: "admin", sha256: hashToken(TOK.admin), scopes: ["subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read"] },
    ],
    registry,
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    organization: new MemoryOrganizationStore(),
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  const s = await call("POST", "/subscriptions", {
    token: TOK.subs,
    body: { companyId: company.id, contractId: contract.id, interval: "month", plan: { productKey: "essential", priceId: await price("essential") }, addons: [{ productKey: "connect-voice", priceId: await price("connect-voice") }] },
  });
  expect(s.status).toBe(201);
  subscriptionId = s.json.subscription.id;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("API de licencias por capacidad", () => {
  it("vista previa con permiso de lectura; aplicar exige además entitlements:write", async () => {
    const pre = await call("POST", `/subscriptions/${subscriptionId}/licences/preview`, { token: TOK.read, body: {} });
    expect(pre.status).toBe(200);
    expect(pre.json.tenantId).toBe("acme");
    expect(pre.json.desired.map((d: { capabilityId: string }) => d.capabilityId)).toContain("voice-ai");
    expect(pre.json.changes).toHaveLength(30);
    expect((await caps.list("acme")).length).toBe(0);
    expect((await call("POST", `/subscriptions/${subscriptionId}/licences/apply`, { token: TOK.subs, body: {} })).status).toBe(403);
    const ap = await call("POST", `/subscriptions/${subscriptionId}/licences/apply`, { token: TOK.admin, body: { activate: true, reason: "Alta del cliente" } });
    expect(ap.status).toBe(200);
    expect(ap.json.applied).toHaveLength(30);
    expect((await call("POST", `/subscriptions/${subscriptionId}/licences/apply`, { token: TOK.admin, body: {} })).json.applied).toEqual([]);
  });
  it("consulta por tenant y cambio manual con motivo; tenant o suscripción desconocidos", async () => {
    const list = await call("GET", "/tenants/acme/capabilities", { token: TOK.read });
    expect(list.json.capabilities).toHaveLength(30);
    expect(list.json.events.length).toBeGreaterThanOrEqual(30);
    expect((await call("PUT", "/tenants/acme/capabilities/voice-ai", { token: TOK.admin, body: { status: "suspended" } })).status).toBe(400);
    const put = await call("PUT", "/tenants/acme/capabilities/voice-ai", { token: TOK.admin, body: { status: "suspended", reason: "Suspensión temporal pedida por el cliente" } });
    expect(put.status).toBe(200);
    expect((await caps.list("acme")).find((g) => g.capabilityId === "voice-ai")!.status).toBe("suspended");
    expect((await call("GET", "/tenants/no-existe/capabilities", { token: TOK.read })).status).toBe(404);
    expect((await call("POST", "/subscriptions/9999/licences/preview", { token: TOK.read, body: {} })).status).toBe(404);
  });
});

describe("API de sedes y entidades fiscales", () => {
  it("límites del plan contratado (Essential: 1 y 1), alta con permiso, rechazo por límite con 422", async () => {
    const o = await call("GET", "/tenants/acme/organization", { token: TOK.read });
    expect(o.json.limits).toMatchObject({ sites: 1, fiscal_entities: 1 });
    expect((await call("POST", "/tenants/acme/sites", { token: TOK.read, body: { siteId: "central", name: "Central" } })).status).toBe(403);
    expect((await call("POST", "/tenants/acme/fiscal-entities", { token: TOK.org, body: { entityId: "acme-sl", legalName: "Acme SL", taxId: "B12345678" } })).status).toBe(200);
    const site = await call("POST", "/tenants/acme/sites", { token: TOK.org, body: { siteId: "central", name: "Central" } });
    expect(site.json.sites[0]).toMatchObject({ siteId: "central", fiscalEntityId: "acme-sl" });
    const second = await call("POST", "/tenants/acme/sites", { token: TOK.org, body: { siteId: "norte", name: "Norte" } });
    expect(second.status).toBe(422);
    expect(second.json.message).toMatch(/1 sede/);
    expect((await call("GET", "/tenants/no-existe/organization", { token: TOK.read })).status).toBe(404);
  });
});
