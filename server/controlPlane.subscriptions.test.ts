/**
 * API de suscripciones (`/cp/v1/subscriptions`) por HTTP: autorización por ámbitos y roles,
 * validación de entrada, flujo completo en modo sombra y errores (400/404/409) sin detalles internos.
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
import { ROLE_SCOPES } from "./controlPlane/operatorRoles";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";

const A = "operator:ana";
const TOK = {
  read: "subs-read-token-aaaaaaaaaaaaaaaaaaaaa",
  write: "subs-write-token-bbbbbbbbbbbbbbbbbbbb",
  web: "web-only-token-cccccccccccccccccccccc",
};
let clock = Date.UTC(2026, 9, 1, 9);

let server: http.Server;
let port: number;
const P: Record<string, number> = {};
let companyId: number;

function call(method: string, path: string, o: { token?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; json: any; raw: string }>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1${path}`,
        method,
        headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) },
      },
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
}

beforeAll(async () => {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore });
  companyId = (await crm.createCompany({ name: "Acme" }, A)).id;
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
  for (const [key, family, act, model] of [
    ["business", "core_plan", { kind: "plan", ref: "business" }, "subscription"],
    ["telefonia", "extension", { kind: "feature", ref: null }, "recurring_addon"],
  ] as const) {
    await web.create({ kind: "product", key, family, draft: { name: key, technicalStatus: "available", activation: act, billingModel: model } }, A);
    await web.publish("product", key, 1, A);
  }
  for (const [name, key, amount] of [["busM", "business", 9900], ["telM", "telefonia", 2000]] as const) {
    const p = await web.addPrice(key, { kind: "monthly", amountCents: amount, taxRateBp: 2100 }, A);
    await web.approvePrice(p.id, A);
    P[name] = p.id;
  }
  const app = createControlPlaneApp({
    tokens: [
      { id: "lector", sha256: hashToken(TOK.read), scopes: ["subscriptions:read"] },
      { id: "admin", sha256: hashToken(TOK.write), scopes: ["subscriptions:read", "subscriptions:write"] },
      { id: "web", sha256: hashToken(TOK.web), scopes: ["web:read", "web:write", "web:publish"] },
    ],
    registry: new TenantRegistryService(reg, () => ring),
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("API de suscripciones", () => {
  it("roles: solo lectura y comercial consultan; operar queda para administración; soporte no ve nada", () => {
    expect(ROLE_SCOPES.readonly).toContain("subscriptions:read");
    expect(ROLE_SCOPES.sales).toContain("subscriptions:read");
    expect(ROLE_SCOPES.sales).not.toContain("subscriptions:write");
    expect(ROLE_SCOPES.support).not.toContain("subscriptions:read");
    expect(ROLE_SCOPES.admin).toContain("subscriptions:write");
  });

  it("sin token 401; sin el ámbito 403; lectura no puede escribir", async () => {
    expect((await call("GET", "/subscriptions")).status).toBe(401);
    expect((await call("GET", "/subscriptions", { token: TOK.web })).status).toBe(403);
    expect((await call("GET", "/subscriptions", { token: TOK.read })).status).toBe(200);
    const w = await call("POST", "/subscriptions", { token: TOK.read, body: { companyId, interval: "month", plan: { productKey: "business", priceId: P.busM } } });
    expect(w.status).toBe(403);
  });

  it("flujo completo en modo sombra: oferta → alta → extensión → simulación idempotente → cancelación", async () => {
    const offer = await call("GET", "/subscriptions/offer", { token: TOK.read });
    expect(offer.json.products.map((p: { key: string }) => p.key).sort()).toEqual(["business", "telefonia"]);
    const c = await call("POST", "/subscriptions", { token: TOK.write, body: { companyId, interval: "month", plan: { productKey: "business", priceId: P.busM } } });
    expect(c.status).toBe(201);
    expect(c.json.subscription).toMatchObject({ mode: "shadow", status: "active", version: 1 });
    const id = c.json.subscription.id;
    const add = await call("POST", `/subscriptions/${id}/items`, { token: TOK.write, body: { item: { productKey: "telefonia", priceId: P.telM }, when: "period_end", expectedVersion: 1 } });
    expect(add.status).toBe(201);
    // Misma versión otra vez: 409
    const stale = await call("POST", `/subscriptions/${id}/cancel`, { token: TOK.write, body: { reason: "x", expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe("version_conflict");
    const sim1 = await call("POST", `/subscriptions/${id}/shadow`, { token: TOK.write });
    const sim2 = await call("POST", `/subscriptions/${id}/shadow`, { token: TOK.write });
    expect(sim1.json.results[0].created).toBe(true);
    expect(sim2.json.results[0]).toMatchObject({ created: false, drift: null });
    expect(sim1.json.results[0].invoice).toMatchObject({ subtotalCents: 9900, paymentStatus: "none" });
    const det = await call("GET", `/subscriptions/${id}`, { token: TOK.read });
    expect(det.json.company).toMatchObject({ name: "Acme" });
    expect(det.json.licencePlan).toMatchObject({ applied: false });
    expect(det.json.events.map((e: { kind: string }) => e.kind)).toEqual(["created", "item_added"]);
    const cancel = await call("POST", `/subscriptions/${id}/cancel`, { token: TOK.write, body: { reason: "Prueba", expectedVersion: 2 } });
    expect(cancel.status).toBe(200);
  });

  it("validación de entrada: 400 sin detalles internos; 404 para lo que no existe", async () => {
    const bad = await call("POST", "/subscriptions", { token: TOK.write, body: { companyId, interval: "week", plan: { productKey: "business", priceId: P.busM } } });
    expect(bad.status).toBe(400);
    const extra = await call("POST", "/subscriptions", { token: TOK.write, body: { companyId, interval: "month", plan: { productKey: "business", priceId: P.busM }, amountCents: 1 } });
    expect(extra.status).toBe(400); // campos desconocidos: rechazados (el importe nunca lo pone el cliente)
    const nf = await call("GET", "/subscriptions/99999", { token: TOK.read });
    expect(nf.status).toBe(404);
    expect(nf.raw).not.toMatch(/stack|at \w+ \(/);
  });

  it("no existe ninguna ruta de cobro en la API", async () => {
    for (const p of ["/subscriptions/1/charge", "/subscriptions/1/pay", "/subscriptions/1/invoice"]) {
      expect((await call("POST", p, { token: TOK.write })).status).toBe(404);
    }
  });
});
