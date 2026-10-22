/**
 * API del plano de control: autenticación, ámbitos, auditoría, límites por plan, secretos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken, parseTokens, type ServiceToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { SubscriptionService } from "./_core/billing/service";
import { FakeProvider, MemoryBillingStore, RecordingEffects } from "./_core/billing/memory";
import { MemoryUsageStore } from "./_core/erm/usage";
import type { Entitlement } from "./_core/modules/entitlements";

const FULL = "full-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const READ = "read-token-bbbbbbbbbbbbbbbbbbbbbbbb";

const tokens: ServiceToken[] = [
  { id: "crm-main", sha256: hashToken(FULL), scopes: ["tenants:read", "tenants:write", "domains:write", "entitlements:write", "quotas:write", "billing:read", "billing:write", "usage:read"] },
  { id: "crm-readonly", sha256: hashToken(READ), scopes: ["tenants:read"] },
];

let server: http.Server;
let port: number;
let store: MemoryTenantRegistryStore;
let registry: TenantRegistryService;
const ents: Entitlement[] = [];
const quotas: any[] = [];

function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; json: any; text: string }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = JSON.parse(b);
          } catch {
            /* sin cuerpo */
          }
          resolve({ status: res.statusCode ?? 0, json, text: b });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  store = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({
    REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
    REGISTRY_ACTIVE_KEY_ID: "k1",
  } as NodeJS.ProcessEnv);
  registry = new TenantRegistryService(store, () => ring);

  const billingStore = new MemoryBillingStore();
  const billing = new SubscriptionService({
    catalog: {
      trialDays: 15,
      graceDays: 7,
      trial: { maxCustomDomains: 0, integrations: [], quotas: [] },
      plans: [{ id: "base", name: "Base", kind: "base", interval: "month", priceCents: 1000, currency: "EUR", includedModules: [], maxCustomDomains: 1, quotas: [] }],
      modules: [],
    },
    store: billingStore,
    provider: new FakeProvider(),
    effects: new RecordingEffects(),
  });

  const app = createControlPlaneApp({
    tokens,
    registry,
    reader: store,
    entitlements: {
      listEntitlements: async (t) => ents.filter((e) => e.tenantId === t),
      grant: async (t, m, _a, o) => void ents.push({ tenantId: t, moduleId: m, status: "active", validUntil: o?.validUntil ?? null, source: "crm" }),
      setStatus: async (t, m, s) => void (ents.find((e) => e.tenantId === t && e.moduleId === m)!.status = s),
      revoke: async (t, m) => void ents.splice(ents.findIndex((e) => e.tenantId === t && e.moduleId === m), 1),
    },
    quotas: {
      listQuotas: async (t) => quotas.filter((q) => q.tenantId === t),
      set: async (q) => void quotas.push(q),
      remove: async () => undefined,
    },
    billing,
    billingStore,
    usage: new MemoryUsageStore(),
    platformTarget: "edge.elephantsource.es",
    verifyDomain: async () => ({ ok: true, cname: true, txt: true, pending: [] }),
    perMinute: 1000,
    allowedOrigins: ["https://crm.elephantsource.es"],
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("autenticación y ámbitos", () => {
  it("sin token o con token inválido → 401 sin información", async () => {
    expect((await call("GET", "/cp/v1/tenants")).status).toBe(401);
    expect((await call("GET", "/cp/v1/tenants", { token: "token-incorrecto-xxxxxxxxxxxxx" })).status).toBe(401);
    const r = await call("GET", "/cp/v1/tenants", { headers: { authorization: "Basic abc" } });
    expect(r.status).toBe(401);
  });

  it("un token de solo lectura no puede escribir (403)", async () => {
    expect((await call("GET", "/cp/v1/tenants", { token: READ })).status).toBe(200);
    const w = await call("POST", "/cp/v1/tenants/acme/status", { token: READ, body: { status: "active" } });
    expect(w.status).toBe(403);
    expect(w.json).toEqual({ error: "forbidden", scope: "tenants:write" });
  });

  it("parseTokens descarta entradas mal formadas o con ámbitos desconocidos", () => {
    expect(parseTokens(JSON.stringify([{ id: "x", sha256: "no-hash", scopes: [] }]))).toEqual([]);
    expect(parseTokens(JSON.stringify([{ id: "x", sha256: hashToken("a".repeat(20)), scopes: ["root"] }]))).toEqual([]);
    expect(parseTokens("no json")).toEqual([]);
  });
});

describe("CORS", () => {
  it("solo refleja orígenes permitidos y responde al preflight sin autenticación", async () => {
    const ok = await call("OPTIONS", "/cp/v1/tenants", { headers: { origin: "https://crm.elephantsource.es" } });
    expect(ok.status).toBe(204);
    const raw = await new Promise<http.IncomingHttpHeaders>((resolve) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/cp/v1/tenants", method: "OPTIONS", headers: { origin: "https://crm.elephantsource.es" } }, (res) => {
        res.resume();
        resolve(res.headers);
      });
      r.end();
    });
    expect(raw["access-control-allow-origin"]).toBe("https://crm.elephantsource.es");
    // Las ediciones del CRM usan PATCH: el navegador debe poder enviarlas
    expect(String(raw["access-control-allow-methods"])).toMatch(/\bPATCH\b/);
    const bad = await new Promise<http.IncomingHttpHeaders>((resolve) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/cp/v1/tenants", method: "OPTIONS", headers: { origin: "https://evil.example" } }, (res) => {
        res.resume();
        resolve(res.headers);
      });
      r.end();
    });
    expect(bad["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("operaciones", () => {
  beforeAll(async () => {
    await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "seed" });
    await registry.setStatus("acme", "trial", { type: "operator", id: "seed" });
    const db = await registry.registerDatabase("acme", "mysql://u:SECRETO-FICTICIO@db.invalid/acme", { type: "operator", id: "seed" });
    await registry.activateDatabase("acme", db.id, { type: "operator", id: "seed" });
  });

  it("consulta un tenant sin exponer DSN ni credenciales", async () => {
    const r = await call("GET", "/cp/v1/tenants/acme", { token: FULL });
    expect(r.status).toBe(200);
    expect(r.json.tenant.id).toBe("acme");
    expect(r.text).not.toContain("SECRETO-FICTICIO");
    expect(r.text).not.toContain("dsnCipher");
    expect(r.json.databases[0]).toMatchObject({ state: "active", keyId: "k1" });
  });

  it("cambia el estado con auditoría atribuida al token", async () => {
    const r = await call("POST", "/cp/v1/tenants/acme/status", { token: FULL, body: { status: "active" } });
    expect(r.status).toBe(200);
    const ev = await call("GET", "/cp/v1/tenants/acme/events", { token: FULL });
    const last = ev.json.events.filter((e: any) => e.action === "status.changed").pop();
    expect(last).toMatchObject({ actorType: "crm", actorId: "crm-main", toState: "active" });
  });

  it("transiciones no permitidas y datos no válidos devuelven 409/400", async () => {
    expect((await call("POST", "/cp/v1/tenants/acme/status", { token: FULL, body: { status: "provisioning" } })).status).toBe(400);
    expect((await call("POST", "/cp/v1/tenants/acme/status", { token: FULL, body: { status: "deleted" } })).status).toBe(409);
    expect((await call("GET", "/cp/v1/tenants/..%2Fetc", { token: FULL })).status).toBe(400);
    expect((await call("GET", "/cp/v1/tenants/no-existe", { token: FULL })).status).toBe(404);
  });

  it("catálogo de planes: requiere billing:read y no se confunde con un id de empresa", async () => {
    expect((await call("GET", "/cp/v1/billing/plans", { token: READ })).status).toBe(403);
    expect((await call("GET", "/cp/v1/billing/plans")).status).toBe(401);
    const r = await call("GET", "/cp/v1/billing/plans", { token: FULL });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.plans)).toBe(true);
    expect(r.json.plans.find((p: any) => p.id === "base")).toMatchObject({ id: "base", billable: expect.any(Boolean) });
    expect(typeof r.json.trialDays).toBe("number");
  });

  it("dominios: el límite por plan se aplica antes de crear el dominio", async () => {
    await call("POST", "/cp/v1/billing/acme/trial", { token: FULL, body: { planId: "base" } });
    // en prueba: 0 dominios propios permitidos
    const denied = await call("POST", "/cp/v1/tenants/acme/domains", { token: FULL, body: { domain: "acme.example.com", kind: "custom" } });
    expect(denied.status).toBe(409);
    expect(denied.json.error).toBe("domain_limit");
    // tras contratar: 1 permitido
    await call("POST", "/cp/v1/billing/acme/subscribe", { token: FULL, body: {} });
    const ok = await call("POST", "/cp/v1/tenants/acme/domains", { token: FULL, body: { domain: "acme.example.com", kind: "custom" } });
    expect(ok.status).toBe(201);
    expect(ok.json.domain.status).toBe("pending_verification");
    expect(ok.json.domain.verificationToken).toBeTruthy();
    const second = await call("POST", "/cp/v1/tenants/acme/domains", { token: FULL, body: { domain: "otro.example.com", kind: "custom" } });
    expect(second.json.error).toBe("domain_limit");
  });

  it("verificación y activación de dominio", async () => {
    const v = await call("POST", "/cp/v1/domains/acme.example.com/verify", { token: FULL });
    expect(v.json).toMatchObject({ verified: true });
    const a = await call("POST", "/cp/v1/domains/acme.example.com/activate", { token: FULL });
    expect(a.json.domain.status).toBe("active");
  });

  it("licencias y cuotas", async () => {
    const put = await call("PUT", "/cp/v1/tenants/acme/entitlements/hotel", { token: FULL, body: { validUntil: null } });
    expect(put.json.entitlements.map((e: any) => e.moduleId)).toEqual(["hotel"]);
    const q = await call("PUT", "/cp/v1/tenants/acme/quotas", {
      token: FULL,
      body: { metric: "email.sent", period: "day", limit: 100 },
    });
    expect(q.json.quotas).toHaveLength(1);
    expect((await call("PUT", "/cp/v1/tenants/acme/quotas", { token: FULL, body: { metric: "email.sent", period: "year", limit: 1 } })).status).toBe(400);
    expect((await call("DELETE", "/cp/v1/tenants/acme/entitlements/hotel", { token: FULL })).status).toBe(204);
  });

  it("webhook de facturación: firma inválida → 400 sin efectos", async () => {
    const r = await call("POST", "/cp/v1/billing/webhook", {
      body: { id: "e1", type: "payment.succeeded", invoiceId: "x", chargeId: "c", at: 0 },
      headers: { "x-signature": "falsa" },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("invalid_signature");
  });

  it("métricas en formato Prometheus, sin identificadores de tenant", async () => {
    const r = await call("GET", "/cp/v1/metrics", { token: FULL });
    expect(r.status).toBe(200);
    expect(r.text).toContain("# TYPE elephant_tenants gauge");
    expect(r.text).toMatch(/elephant_tenants\{status="[a-z]+"\} \d+/);
    expect(r.text).not.toContain("acme");
    expect((await call("GET", "/cp/v1/metrics", { token: READ })).status).toBe(403);
  });

  it("rutas inexistentes → 404 genérico; el servicio no anuncia su tecnología", async () => {
    const r = await call("GET", "/otra-cosa");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "not_found" });
  });
});
