/**
 * API de condiciones comerciales personalizadas (plano de control): permisos (solo administradores centrales con el
 * permiso de precios personalizados y sesión de persona; nunca un token de servicio ni el de la empresa), esquema
 * estricto de las partidas a medida, flujo completo por HTTP y licencias reales por capacidad.
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
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryTermsStore } from "./commercialTerms/store";
import { CUSTOM_PRICING_SCOPE, canManageCustomPricing, customPricingScopeDefined } from "./commercialTerms/permission";
import { TPV_ACQUIRED_RIGHTS_CAPABILITY, TPV_ACQUIRED_RIGHTS_SOURCE } from "./licensing/tpvAcquiredRights";

const TOK = {
  admin: "terms-admin-token-aaaaaaaaaaaaaaaaaaaa",
  sales: "terms-sales-token-bbbbbbbbbbbbbbbbbbbb",
  writer: "terms-writer-token-cccccccccccccccccc",
  service: "terms-service-token-dddddddddddddddd",
  tenant: "terms-tenant-token-eeeeeeeeeeeeeeeeee",
  licences: "terms-licences-token-ffffffffffffffff",
};
let server: http.Server;
let port = 0;
let clock = Date.UTC(2026, 10, 1, 10);
let subscriptionId = 0;
let otherSubscriptionId = 0;
let P: Record<string, number> = {};
const caps = new MemoryCapabilityStore();
const subsStore = new MemorySubscriptionStore();

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

const body = (over: Record<string, unknown> = {}) => ({
  pricingMode: "per_item",
  presentation: "breakdown",
  reason: "Acuerdo comercial negociado",
  lines: [
    { kind: "catalog", productKey: "essential", priceId: P.essential, negotiatedUnitCents: 1900 },
    { kind: "catalog", productKey: "connect-voice", priceId: P["connect-voice"] },
    { kind: "custom", concept: "maintenance", name: "Mantenimiento", chargeClass: "recurring", unitCents: 5000, taxRateBp: 2100 },
  ],
  adjustments: [{ line: 1, type: "discount", mode: "percent", value: 10_000, recurrence: "recurring" }],
  ...over,
});

beforeAll(async () => {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "test" });
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore });
  const company = await crm.createCompany({ name: "Acme" }, "t");
  const other = await crm.createCompany({ name: "Otra" }, "t");
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  for (const key of ["essential", "connect-voice"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
  const admin = ROLE_SCOPES.admin.filter((s) => !s.startsWith("commerce:"));
  const app = createControlPlaneApp({
    tokens: [
      // Administrador central: una persona con los permisos del rol
      { id: "ana", sha256: hashToken(TOK.admin), scopes: [...admin], actorType: "operator" },
      // Comercial: consulta suscripciones y prepara pedidos, sin operar ni aprobar
      { id: "comercial", sha256: hashToken(TOK.sales), scopes: [...ROLE_SCOPES.sales], actorType: "operator" },
      // Persona que opera suscripciones pero no aprueba pedidos
      { id: "operador", sha256: hashToken(TOK.writer), scopes: ["subscriptions:read", "subscriptions:write"], actorType: "operator" },
      // Token de servicio con TODOS los ámbitos: aun así no gestiona precios (no es una persona)
      { id: "integracion", sha256: hashToken(TOK.service), scopes: [...admin] },
      // El token del Core con el que actúa el panel de la empresa
      { id: "core-commerce", sha256: hashToken(TOK.tenant), scopes: ["commerce:purchase"] },
      { id: "licencias", sha256: hashToken(TOK.licences), scopes: ["subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read"] },
    ],
    registry,
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock, terms: new MemoryTermsStore() },
    capabilities: caps,
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  const mk = async (companyId: number) => {
    const s = await call("POST", "/subscriptions", { token: TOK.admin, body: { companyId, interval: "month", plan: { productKey: "essential", priceId: P.essential }, addons: [{ productKey: "connect-voice", priceId: P["connect-voice"] }] } });
    expect(s.status).toBe(201);
    return s.json.subscription.id as number;
  };
  subscriptionId = await mk(company.id);
  otherSubscriptionId = await mk(other.id);
  // La empresa tiene plataforma (para las licencias) y un derecho adquirido que nada debe retirar
  await subsStore.mutate(subscriptionId, null, "t", clock, async () => ({ patch: { tenantId: "acme" }, event: { kind: "contract_linked", before: null, after: null, reason: null }, result: null }));
  await caps.apply("acme", [{ capabilityId: TPV_ACQUIRED_RIGHTS_CAPABILITY, siteId: "", status: "active", validUntil: null, source: TPV_ACQUIRED_RIGHTS_SOURCE }], { actor: "seed", reason: "derechos adquiridos", now: clock });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("permiso de precios y paquetes personalizados", () => {
  it("una sola función: regla provisional mientras el permiso propio no existe; después, solo el permiso propio", () => {
    const provisional = ["subscriptions:read", "subscriptions:write", "orders:approve"];
    expect(canManageCustomPricing(new Set(["subscriptions:write", "orders:approve"]), provisional)).toBe(true);
    expect(canManageCustomPricing(new Set(["subscriptions:write"]), provisional)).toBe(false);
    expect(canManageCustomPricing(new Set(["orders:approve"]), provisional)).toBe(false);
    const withScope = [...provisional, CUSTOM_PRICING_SCOPE];
    // Con el permiso propio publicado: tener suscripciones y aprobación de pedidos ya no basta, y él solo sí
    expect(canManageCustomPricing(new Set(["subscriptions:write", "orders:approve"]), withScope)).toBe(false);
    expect(canManageCustomPricing(new Set([CUSTOM_PRICING_SCOPE]), withScope)).toBe(true);
    expect(customPricingScopeDefined(withScope)).toBe(true);
  });

  it("solo el administrador central gestiona; el comercial y quien solo opera suscripciones, no", async () => {
    expect((await call("GET", "/commercial-terms/access", { token: TOK.admin })).json).toMatchObject({ canManage: true, scope: CUSTOM_PRICING_SCOPE });
    expect((await call("GET", "/commercial-terms/access", { token: TOK.sales })).json.canManage).toBe(false);
    for (const token of [TOK.sales, TOK.writer]) {
      const r = await call("POST", `/subscriptions/${subscriptionId}/terms`, { token, body: body() });
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ error: "forbidden", scope: CUSTOM_PRICING_SCOPE });
    }
    // El comercial sí puede consultar (subscriptions:read)
    expect((await call("GET", `/subscriptions/${subscriptionId}/terms`, { token: TOK.sales })).status).toBe(200);
  });

  it("un token de servicio no gestiona precios aunque lleve todos los ámbitos", async () => {
    const r = await call("POST", `/subscriptions/${subscriptionId}/terms`, { token: TOK.service, body: body() });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("operator_session_required");
  });

  it("una empresa no puede leer ni modificar sus precios negociados con su token", async () => {
    for (const [method, path] of [
      ["GET", `/subscriptions/${subscriptionId}/terms`],
      ["GET", `/subscriptions/${subscriptionId}/terms/base`],
      ["POST", `/subscriptions/${subscriptionId}/terms`],
      ["POST", `/subscriptions/${subscriptionId}/terms/restore-official`],
      ["POST", "/commercial-terms/packages"],
      ["PUT", "/commercial-terms/1"],
      ["POST", "/commercial-terms/1/activate"],
      ["POST", "/commercial-terms/1/cancel"],
      ["POST", "/commercial-terms/1/prepare-contracting"],
      ["GET", "/commercial-terms/1"],
      ["GET", "/commercial-terms/1/preview"],
    ] as const) {
      expect((await call(method, path, { token: TOK.tenant, body: method === "GET" ? undefined : body() })).status, `${method} ${path}`).toBe(403);
    }
    expect((await call("GET", `/subscriptions/${subscriptionId}/terms`)).status).toBe(401);
  });
});

describe("flujo completo por la API", () => {
  let termsId = 0;
  let revision = 0;

  it("una partida a medida con clave de producto, activación o capacidad se rechaza (400)", async () => {
    for (const extra of [{ productKey: "hotel-net-pms" }, { activationRef: "hotel" }, { capabilities: ["hotel"] }, { priceId: P.essential }]) {
      const lines = [...body().lines.slice(0, 2), { ...body().lines[2], ...extra }];
      const r = await call("POST", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin, body: body({ lines }) });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    // Ni un plan Core de texto libre
    const plan = [{ kind: "custom", concept: "core_plan", name: "Plan a medida", chargeClass: "recurring", unitCents: 1000, taxRateBp: 2100 }];
    expect((await call("POST", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin, body: body({ lines: plan, adjustments: [] }) })).status).toBe(400);
    // Importes con decimales o motivo ausente
    expect((await call("POST", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin, body: body({ pricingMode: "global", globalAmountCents: 129.5 }) })).status).toBe(400);
    expect((await call("POST", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin, body: body({ reason: "" }) })).status).toBe(400);
  });

  it("borrador → vista previa → activación, con conflicto si la suscripción cambió entretanto", async () => {
    const created = await call("POST", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin, body: body() });
    expect(created.status).toBe(201);
    termsId = created.json.terms.id;
    revision = created.json.terms.revision;
    expect(created.json.terms).toMatchObject({ status: "draft", createdBy: "operator:ana", reason: "Acuerdo comercial negociado" });
    const preview = await call("GET", `/commercial-terms/${termsId}/preview`, { token: TOK.sales });
    expect(preview.status).toBe(200);
    // Essential a 19 €, voz al 100 % de descuento y 50 € de mantenimiento
    expect(preview.json.summary.recurring.netCents).toBe(1900 + 0 + 5000);
    expect(preview.json.licences).toMatchObject({ planBefore: null, planAfter: null, added: [], removed: [] });
    const sub = (await call("GET", `/subscriptions/${subscriptionId}`, { token: TOK.admin })).json.subscription;
    const stale = await call("POST", `/commercial-terms/${termsId}/activate`, { token: TOK.admin, body: { expectedRevision: revision, expectedVersion: sub.version - 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe("version_conflict");
    const done = await call("POST", `/commercial-terms/${termsId}/activate`, { token: TOK.admin, body: { expectedRevision: revision, expectedVersion: sub.version } });
    expect(done.status).toBe(200);
    expect(done.json.terms.status).toBe("active");
    const history = await call("GET", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin });
    expect(history.json).toMatchObject({ current: termsId, timeZone: "Europe/Madrid" });
    expect(history.json.events.map((e: { kind: string; actor: string }) => [e.kind, e.actor])).toEqual([["draft_created", "operator:ana"], ["activated", "operator:ana"]]);
    // La ficha de la suscripción sigue siendo la misma, en simulación de facturación
    const detail = (await call("GET", `/subscriptions/${subscriptionId}`, { token: TOK.admin })).json;
    expect(detail.billing).toEqual({ source: "shadow" });
    expect(detail.items.filter((i: { effectiveTo: number | null }) => i.effectiveTo === null).map((i: { productName: string; lineAmountCents: number }) => i.lineAmountCents).sort((a: number, b: number) => a - b)).toEqual([0, 1900, 5000]);
  });

  it("Caso 29 — las condiciones de una suscripción no se aplican ni se ven desde otra", async () => {
    expect((await call("GET", `/subscriptions/${otherSubscriptionId}/terms`, { token: TOK.admin })).json.terms).toEqual([]);
    const other = (await call("GET", `/subscriptions/${otherSubscriptionId}`, { token: TOK.admin })).json;
    expect(other.items.every((i: { termsId?: number | null }) => i.termsId == null)).toBe(true);
  });

  it("Casos 27 y 28 — licencias reales: el descuento total no retira capacidades, la partida a medida no concede ninguna y los derechos adquiridos siguen intactos", async () => {
    const applied = await call("POST", `/subscriptions/${subscriptionId}/licences/apply`, { token: TOK.licences, body: { activate: true, reason: "Alta del cliente" } });
    expect(applied.status).toBe(200);
    const granted = (await caps.list("acme")).filter((g) => g.source === `subscription:${subscriptionId}` && g.status === "active").map((g) => g.capabilityId).sort();
    expect(granted.length).toBeGreaterThan(0);
    // Lo mismo que concede una suscripción idéntica SIN condiciones personalizadas (la de la otra empresa)
    await subsStore.mutate(otherSubscriptionId, null, "t", clock, async () => ({ patch: { tenantId: "otra" }, event: { kind: "contract_linked", before: null, after: null, reason: null }, result: null }));
    const reference = await call("POST", `/subscriptions/${otherSubscriptionId}/licences/preview`, { token: TOK.licences, body: { activate: true } });
    expect(reference.json.changes.map((c: { capabilityId: string }) => c.capabilityId).sort()).toEqual(granted);
    // Ninguna capacidad sale de «Mantenimiento»
    expect(granted.some((c) => /custom|mantenimiento/i.test(c))).toBe(false);
    const acquired = (await caps.list("acme")).find((g) => g.capabilityId === TPV_ACQUIRED_RIGHTS_CAPABILITY);
    expect(acquired).toMatchObject({ status: "active", source: TPV_ACQUIRED_RIGHTS_SOURCE, validUntil: null });
    // Restaurar la tarifa oficial tampoco toca licencias ni derechos adquiridos
    clock += 86_400_000;
    const sub = (await call("GET", `/subscriptions/${subscriptionId}`, { token: TOK.admin })).json.subscription;
    const restored = await call("POST", `/subscriptions/${subscriptionId}/terms/restore-official`, { token: TOK.admin, body: { reason: "Fin del acuerdo", expectedVersion: sub.version } });
    expect(restored.status).toBe(200);
    expect((await call("POST", `/subscriptions/${subscriptionId}/licences/apply`, { token: TOK.licences, body: { activate: true, reason: "Comprobación" } })).json.applied).toEqual([]);
    expect((await caps.list("acme")).find((g) => g.capabilityId === TPV_ACQUIRED_RIGHTS_CAPABILITY)).toMatchObject({ status: "active", source: TPV_ACQUIRED_RIGHTS_SOURCE });
  });
});
