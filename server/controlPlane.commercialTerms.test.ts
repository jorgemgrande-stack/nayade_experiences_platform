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
import { MemoryExternalStore } from "./external/store";
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
let hotelCompanyId = 0;
let referenceCompanyId = 0;
let contractCompanyId = 0;
const acceptanceStore = new MemoryExternalStore("test");
const crmStore = new MemoryCrmStore();
const PUBLIC = "https://admin.example.test/cp/v1/public/contract-acceptance";
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
  const crm = new CrmService({ store: crmStore });
  const company = await crm.createCompany({ name: "Acme" }, "t");
  const other = await crm.createCompany({ name: "Otra" }, "t");
  hotelCompanyId = (await crm.createCompany({ name: "Hotel Ejemplo" }, "t")).id;
  referenceCompanyId = (await crm.createCompany({ name: "Hotel a tarifa oficial" }, "t")).id;
  contractCompanyId = (await crm.createCompany({ name: "Hotel con contrato", legalName: "Hotel con Contrato, S.L.", taxId: "B12345674" }, "t")).id;
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  for (const key of ["essential", "connect-voice", "hotel-net-complete", "connect-whatsapp-ai"]) P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
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
    // Página pública y tabla de aceptaciones de los servicios externos (el mismo circuito)
    external: { store: acceptanceStore, urls: { acceptance: PUBLIC, setupSuccess: `${PUBLIC}/autorizado`, setupCancel: `${PUBLIC}/cancelado`, portalReturn: `${PUBLIC}/portal` }, ipSalt: "sal-de-pruebas-para-seudonimizar-ips" },
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
    // La suscripción tiene plataforma: al activar se aplican solas las licencias de sus productos
    expect(history.json.events.map((e: { kind: string; actor: string }) => [e.kind, e.actor])).toEqual([["draft_created", "operator:ana"], ["activated", "operator:ana"], ["licences_applied", "operator:ana"]]);
    const lic = await call("GET", `/subscriptions/${subscriptionId}/terms/licences`, { token: TOK.sales });
    expect(lic.json).toMatchObject({ automatic: true, tenantId: "acme", linked: true, last: { kind: "licences_applied" }, plan: { pending: 0 } });
    // Aplicarlas a mano exige el permiso de precios Y el de licencias
    for (const token of [TOK.sales, TOK.service, TOK.tenant, TOK.licences]) expect((await call("POST", `/subscriptions/${subscriptionId}/terms/licences/apply`, { token, body: {} })).status).toBe(403);
    expect((await call("POST", `/subscriptions/${subscriptionId}/terms/licences/apply`, { token: TOK.admin, body: {} })).json).toMatchObject({ status: "applied", changed: 0 });
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

/**
 * Caso de aceptación final del propietario: contratar desde el CRM Essential + Hotel Net + WhatsApp Connect por una
 * cuota global negociada de 129 €/mes + IVA, con licencias y facturación (simulada) coherentes.
 */
describe("caso final — Essential + Hotel Net + WhatsApp Connect por 129 €/mes + IVA", () => {
  let termsId = 0;
  let revision = 0;
  let sid = 0;

  it("1. el administrador crea el paquete con cuota global y ve la vista previa", async () => {
    const created = await call("POST", "/commercial-terms/packages", {
      token: TOK.admin,
      body: {
        companyId: hotelCompanyId,
        interval: "month",
        pricingMode: "global",
        globalAmountCents: 12900,
        presentation: "global",
        packageName: "Paquete Hotel",
        reason: "Oferta negociada con el cliente",
        lines: [
          { kind: "catalog", productKey: "essential", priceId: P.essential },
          { kind: "catalog", productKey: "hotel-net-complete", priceId: P["hotel-net-complete"] },
          { kind: "catalog", productKey: "connect-whatsapp-ai", priceId: P["connect-whatsapp-ai"] },
        ],
      },
    });
    expect(created.status).toBe(201);
    termsId = created.json.terms.id;
    revision = created.json.terms.revision;
    expect(created.json.terms).toMatchObject({ status: "draft", subscriptionId: null, pricingMode: "global", globalAmountCents: 12900, presentation: "global" });
    const preview = (await call("GET", `/commercial-terms/${termsId}/preview`, { token: TOK.admin })).json;
    // 129,00 € + 21 % = 156,09 €; la tarifa oficial de referencia sigue a la vista del administrador
    expect(preview.summary.recurring).toMatchObject({ netCents: 12900, taxCents: 2709, totalCents: 15609 });
    expect(preview.summary.recurring.lines.map((l: { name: string }) => l.name)).toHaveLength(3);
    expect(preview.summary.recurring.lines.reduce((a: number, l: { netCents: number }) => a + l.netCents, 0)).toBe(12900);
    expect(preview.differenceVsOfficialCents).toBe(12900 - preview.summary.recurring.officialCents);
    // Efectos sobre las licencias de un paquete nuevo: entran el plan y los dos productos (aunque el catálogo los
    // active por capacidades y no por una referencia de plan o de módulo)
    expect(preview.licences.products).toEqual({ added: [{ key: "essential", name: expect.any(String), plan: true }, { key: "hotel-net-complete", name: expect.any(String), plan: false }, { key: "connect-whatsapp-ai", name: expect.any(String), plan: false }], removed: [], kept: [] });
    expect(preview.licences).toMatchObject({ planProductBefore: null, planProductAfter: { key: "essential" } });
  });

  it("2. prepara la contratación: una suscripción con los tres productos identificados y la cuota pactada", async () => {
    const done = await call("POST", `/commercial-terms/${termsId}/prepare-contracting`, { token: TOK.admin, body: { expectedRevision: revision } });
    expect(done.status).toBe(200);
    sid = done.json.subscription.id;
    expect(done.json.terms).toMatchObject({ status: "active", subscriptionId: sid });
    const detail = (await call("GET", `/subscriptions/${sid}`, { token: TOK.admin })).json;
    const live = detail.items.filter((i: { effectiveTo: number | null }) => i.effectiveTo === null);
    expect(live.map((i: { productKey: string }) => i.productKey).sort()).toEqual(["connect-whatsapp-ai", "essential", "hotel-net-complete"]);
    expect(live.reduce((a: number, i: { lineAmountCents: number }) => a + i.lineAmountCents, 0)).toBe(12900);
    expect(live.every((i: { priceSource: string; discount: unknown }) => i.priceSource === "contract" && i.discount === null)).toBe(true);
    expect(detail.billing).toEqual({ source: "shadow" });
    // Contratación nueva: el historial no inventa unas «condiciones anteriores» ni una diferencia
    const history = (await call("GET", `/subscriptions/${sid}/terms`, { token: TOK.admin })).json;
    const activated = history.events.find((e: { kind: string }) => e.kind === "activated");
    expect(activated.before).toBeNull();
    expect(activated.economic).toMatchObject({ newContract: true, before: null, difference: null, recurringNetCents: 12900 });
    const applied = detail.events.find((e: { kind: string }) => e.kind === "terms_applied");
    expect(applied.before).toEqual({ newContract: true });
    // La partida del alta queda sin ventana: ni rige ni se factura
    const ghost = detail.items.filter((i: { termsId?: number | null }) => i.termsId == null);
    expect(ghost.every((i: { effectiveFrom: number; effectiveTo: number | null }) => i.effectiveTo === i.effectiveFrom)).toBe(true);
  });

  it("3. licencias: exactamente las de los tres productos a tarifa oficial; el precio no interviene", async () => {
    await subsStore.mutate(sid, null, "t", clock, async () => ({ patch: { tenantId: "hotel-ejemplo" }, event: { kind: "contract_linked", before: null, after: null, reason: null }, result: null }));
    const negotiated = (await call("POST", `/subscriptions/${sid}/licences/preview`, { token: TOK.licences, body: { activate: true } })).json;
    // La misma composición contratada a tarifa oficial, sin acuerdo
    const plain = await call("POST", "/subscriptions", {
      token: TOK.admin,
      body: { companyId: referenceCompanyId, interval: "month", plan: { productKey: "essential", priceId: P.essential }, addons: [{ productKey: "hotel-net-complete", priceId: P["hotel-net-complete"] }, { productKey: "connect-whatsapp-ai", priceId: P["connect-whatsapp-ai"] }] },
    });
    expect(plain.status).toBe(201);
    await subsStore.mutate(plain.json.subscription.id, null, "t", clock, async () => ({ patch: { tenantId: "hotel-oficial" }, event: { kind: "contract_linked", before: null, after: null, reason: null }, result: null }));
    const official = (await call("POST", `/subscriptions/${plain.json.subscription.id}/licences/preview`, { token: TOK.licences, body: { activate: true } })).json;
    const capsOf = (p: { changes: Array<{ capabilityId: string; status: string }> }) => p.changes.filter((c) => c.status === "active").map((c) => c.capabilityId).sort();
    expect(capsOf(negotiated).length).toBeGreaterThan(0);
    expect(capsOf(negotiated)).toEqual(capsOf(official));
  });

  it("4. facturación simulada: 129,00 € + 27,09 € de IVA = 156,09 €, con el detalle por producto, y no se duplica", async () => {
    const first = await call("POST", `/subscriptions/${sid}/shadow`, { token: TOK.admin, body: {} });
    expect(first.status).toBe(200);
    expect(first.json.results).toHaveLength(1);
    const invoice = first.json.results[0].invoice;
    expect(invoice).toMatchObject({ kind: "renewal", subtotalCents: 12900, discountCents: 0, taxCents: 2709, totalCents: 15609, currency: "EUR" });
    // La factura lleva siempre el detalle fiscal por concepto, aunque la oferta sea de cuota global
    expect(invoice.lines.map((l: { productKey: string }) => l.productKey).sort()).toEqual(["connect-whatsapp-ai", "essential", "hotel-net-complete"]);
    expect(invoice.lines.reduce((a: number, l: { taxCents: number }) => a + l.taxCents, 0)).toBe(2709);
    const again = await call("POST", `/subscriptions/${sid}/shadow`, { token: TOK.admin, body: {} });
    expect(again.json.results.map((r: { created: boolean; drift: unknown }) => [r.created, r.drift])).toEqual([[false, null]]);
  });

  it("5. el catálogo y las demás empresas no cambian", async () => {
    const offer = (await call("GET", "/subscriptions/offer", { token: TOK.admin })).json.products as Array<{ key: string; prices: Array<{ id: number; amountCents: number }> }>;
    const official = (key: string) => offer.find((p) => p.key === key)!.prices.find((x) => x.id === P[key])!.amountCents;
    expect(official("essential") + official("hotel-net-complete") + official("connect-whatsapp-ai")).toBeGreaterThan(12900);
    const others = (await call("GET", `/subscriptions/${otherSubscriptionId}`, { token: TOK.admin })).json;
    expect(others.items.every((i: { termsId?: number | null }) => i.termsId == null)).toBe(true);
  });
});

/** Petición sin JSON (la página pública es HTML y su formulario, urlencoded). */
const raw = (method: string, path: string, form?: Record<string, string>) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const data = form ? new URLSearchParams(form).toString() : undefined;
    const req = http.request({ host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(data ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(data) } : {}), "user-agent": "navegador-de-prueba" } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const publicPath = (url: string) => url.replace("https://admin.example.test/cp/v1", "");

/**
 * Caso 22 y caso final con CONTRATO: el mismo paquete de 129 €/mes, ahora con aceptación del cliente. Nada se activa
 * antes de aceptar; al aceptar quedan el contrato firmado con sus evidencias, la suscripción y la facturación simulada.
 */
describe("Caso 22 — contrato y aceptación del cliente (paquete de 129 €/mes)", () => {
  let termsId = 0;
  let revision = 0;
  let url = "";
  let contractId = 0;
  let sid = 0;
  const pkg = (over: Record<string, unknown> = {}) => ({
    companyId: contractCompanyId,
    interval: "month",
    pricingMode: "global",
    globalAmountCents: 12900,
    presentation: "global",
    packageName: "Paquete Hotel",
    requiresAcceptance: true,
    reason: "Oferta negociada con el cliente",
    lines: [
      { kind: "catalog", productKey: "essential", priceId: P.essential },
      { kind: "catalog", productKey: "hotel-net-complete", priceId: P["hotel-net-complete"] },
      { kind: "catalog", productKey: "connect-whatsapp-ai", priceId: P["connect-whatsapp-ai"] },
    ],
    ...over,
  });
  const signer = { name: "Marta Ruiz", email: "marta@hotel-ejemplo.test", role: "Administradora única" };

  it("lo que depende de la aceptación no se activa por adelantado", async () => {
    const created = await call("POST", "/commercial-terms/packages", { token: TOK.admin, body: pkg() });
    expect(created.status).toBe(201);
    termsId = created.json.terms.id;
    revision = created.json.terms.revision;
    expect(created.json.terms).toMatchObject({ requiresAcceptance: true, acceptanceStatus: "pending" });
    const early = await call("POST", `/commercial-terms/${termsId}/prepare-contracting`, { token: TOK.admin, body: { expectedRevision: revision } });
    expect(early.status).toBe(409);
    expect(early.json.details).toMatchObject({ reason: "acceptance_required" });
    expect((await call("GET", `/subscriptions?companyId=${contractCompanyId}`, { token: TOK.admin })).json.subscriptions).toEqual([]);
  });

  it("el documento respeta la presentación de cuota global: ni precios por partida ni tarifa oficial", async () => {
    const doc = (await call("GET", `/commercial-terms/${termsId}/document`, { token: TOK.sales })).json;
    expect(doc.text).toContain("Cliente: Hotel con Contrato, S.L. (NIF B12345674)");
    expect(doc.text).toMatch(/Cuota global pactada: 129,00\s€ al mes, más impuestos/);
    expect(doc.text).toMatch(/Total con impuestos: 156,09\s€ al mes\./);
    expect(doc.view.breakdown).toBeNull();
    const preview = (await call("GET", `/commercial-terms/${termsId}/preview`, { token: TOK.admin })).json;
    for (const l of preview.summary.recurring.lines) {
      expect(new RegExp(`(^|[^0-9.,])${(l.netCents / 100).toFixed(2).replace(".", ",")}\\s€`, "m").test(doc.text)).toBe(false);
      expect(new RegExp(`(^|[^0-9.,])${(l.officialCents / 100).toFixed(2).replace(".", ",")}\\s€`, "m").test(doc.text)).toBe(false);
    }
  });

  it("solo quien gestiona precios envía a aceptación; el enlace es personal y el acuerdo deja de ser editable", async () => {
    for (const token of [TOK.sales, TOK.service, TOK.tenant]) expect((await call("POST", `/commercial-terms/${termsId}/acceptance`, { token, body: { signer, expectedRevision: revision } })).status).toBe(403);
    const sent = await call("POST", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin, body: { signer, expectedRevision: revision } });
    expect(sent.status).toBe(201);
    url = sent.json.url;
    contractId = sent.json.contract.id;
    expect(url).toMatch(/^https:\/\/admin\.example\.test\/cp\/v1\/public\/contract-acceptance\/condiciones\?token=[A-Za-z0-9_-]{40,60}$/);
    expect(sent.json.terms).toMatchObject({ status: "pending_acceptance", acceptanceStatus: "pending", contractId });
    revision = sent.json.terms.revision;
    const contract = (await crmStore.get("contracts", contractId))!;
    expect(contract).toMatchObject({ status: "sent", companyId: contractCompanyId, amountCents: 12900, billingInterval: "month" });
    expect(contract.conditions).toContain("Cuota global pactada");
    // El enlace nunca se guarda en claro ni se devuelve al consultar el estado
    const status = (await call("GET", `/commercial-terms/${termsId}/acceptance`, { token: TOK.sales })).json;
    expect(JSON.stringify(status)).not.toContain(url.split("token=")[1]);
    expect(status.acceptances).toEqual([expect.objectContaining({ status: "pending", signerEmail: "marta@hotel-ejemplo.test", documentSha256: sent.json.documentSha256 })]);
    // Enviado a aceptación, no se edita (habría que retirarlo antes)
    expect((await call("PUT", `/commercial-terms/${termsId}`, { token: TOK.admin, body: { ...pkg({ globalAmountCents: 9900 }), companyId: undefined, expectedRevision: revision } })).status).toBeGreaterThanOrEqual(400);
  });

  it("si las condiciones se retiran y cambian, el enlace antiguo deja de valer", async () => {
    const back = await call("POST", `/commercial-terms/${termsId}/acceptance/withdraw`, { token: TOK.admin, body: { reason: "El cliente pide otra cuota", expectedRevision: revision } });
    expect(back.status).toBe(200);
    expect(back.json.terms.status).toBe("draft");
    expect((await raw("GET", publicPath(url))).status).toBe(409);
    const { companyId: _c, ...edit } = pkg({ conditions: "Soporte prioritario." });
    const saved = await call("PUT", `/commercial-terms/${termsId}`, { token: TOK.admin, body: { ...edit, expectedRevision: back.json.terms.revision } });
    expect(saved.status).toBe(200);
    const again = await call("POST", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin, body: { signer, expectedRevision: saved.json.terms.revision } });
    expect(again.status).toBe(201);
    // Mismo contrato (seguía en borrador), versión nueva, enlace nuevo
    expect(again.json.contract.id).toBe(contractId);
    expect(again.json.url).not.toBe(url);
    expect((await raw("GET", publicPath(url))).status).toBe(409);
    url = again.json.url;
  });

  it("el firmante ve el documento exacto, sin sesión, y debe marcar la aceptación", async () => {
    const page = await raw("GET", publicPath(url));
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body).toMatch(/Cuota global pactada: 129,00\s€ al mes/);
    expect(page.body).toContain("Marta Ruiz");
    expect(page.body).toContain("Soporte prioritario.");
    expect(page.body).not.toContain("<script");
    const token = url.split("token=")[1];
    expect((await raw("POST", publicPath(url), { token, name: "Marta Ruiz" })).status).toBe(400);
    expect((await raw("GET", "/public/contract-acceptance/condiciones?token=" + "x".repeat(43))).status).toBe(404);
    expect((await call("GET", `/subscriptions?companyId=${contractCompanyId}`, { token: TOK.admin })).json.subscriptions).toEqual([]);
  });

  it("al aceptar: contrato firmado con evidencias, suscripción creada y enlazada, condiciones activas", async () => {
    const token = url.split("token=")[1];
    const done = await raw("POST", publicPath(url), { token, name: "Marta Ruiz Gómez", taxId: "00000000T", accept: "1" });
    expect(done.status).toBe(200);
    expect(done.body).toContain("Condiciones aceptadas");
    expect(done.body).toContain("quedan activadas");
    const terms = (await call("GET", `/commercial-terms/${termsId}`, { token: TOK.admin })).json;
    expect(terms.terms).toMatchObject({ status: "active", acceptanceStatus: "accepted", contractId });
    sid = terms.terms.subscriptionId;
    expect(terms.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["acceptance_requested", "acceptance_withdrawn", "accepted", "subscription_created", "activated"]));
    const accepted = terms.events.find((e: { kind: string }) => e.kind === "accepted");
    expect(accepted).toMatchObject({ actor: "public:acceptance", acceptanceStatus: "accepted" });
    // Contrato del CRM: firmado electrónicamente, con la referencia de la aceptación y su versión guardada
    const contract = (await crmStore.get("contracts", contractId))!;
    expect(contract).toMatchObject({ status: "signed", signatureMethod: "electronic" });
    expect(contract.signatureRef).toMatch(/^aceptacion:\d+:[0-9a-f]{16}$/);
    // Evidencias: identidad declarada, fecha, huella del documento, IP seudonimizada y navegador
    const status = (await call("GET", `/commercial-terms/${termsId}/acceptance`, { token: TOK.admin })).json;
    const ok = status.acceptances.find((a: { status: string }) => a.status === "accepted");
    expect(ok).toMatchObject({ acceptedName: "Marta Ruiz Gómez", contractVersion: contract.version });
    expect(ok.acceptedAt).toBe(clock);
    const row = (await acceptanceStore.acceptances(contractId)).find((a) => a.status === "accepted")!;
    expect(row.acceptedIpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.acceptedUserAgent).toBe("navegador-de-prueba");
    expect(row.consentText).toContain("Marta Ruiz");
    expect(row.documentSha256).toBe(ok.documentSha256);
    // Las aceptaciones anteriores (retiradas) siguen ahí, revocadas: nada se borra
    expect(status.acceptances.map((a: { status: string }) => a.status).sort()).toEqual(["accepted", "revoked"]);
    // Suscripción: una, con los tres productos, la cuota pactada y enlazada con el contrato firmado
    const detail = (await call("GET", `/subscriptions/${sid}`, { token: TOK.admin })).json;
    expect(detail.subscription).toMatchObject({ companyId: contractCompanyId, contractId, status: "active" });
    const live = detail.items.filter((i: { effectiveTo: number | null }) => i.effectiveTo === null);
    expect(live.map((i: { productKey: string }) => i.productKey).sort()).toEqual(["connect-whatsapp-ai", "essential", "hotel-net-complete"]);
    expect(live.reduce((a: number, i: { lineAmountCents: number }) => a + i.lineAmountCents, 0)).toBe(12900);
    const invoice = (await call("POST", `/subscriptions/${sid}/shadow`, { token: TOK.admin, body: {} })).json.results[0].invoice;
    expect(invoice).toMatchObject({ subtotalCents: 12900, taxCents: 2709, totalCents: 15609 });
  });

  it("el enlace es de un solo uso", async () => {
    const token = url.split("token=")[1];
    expect((await raw("GET", publicPath(url))).status).toBe(409);
    expect((await raw("POST", publicPath(url), { token, name: "Otra Persona", accept: "1" })).status).toBe(409);
  });

  it("un contrato firmado no se sobrescribe: unas condiciones nuevas son otro contrato, enlazado con el anterior", async () => {
    const signedBefore = (await crmStore.get("contracts", contractId))!;
    clock += 86_400_000;
    const sub = (await call("GET", `/subscriptions/${sid}`, { token: TOK.admin })).json.subscription;
    const { companyId: _c, interval: _i, ...lines } = pkg({ globalAmountCents: 11900, reason: "Renegociación anual" });
    const created = await call("POST", `/subscriptions/${sid}/terms`, { token: TOK.admin, body: lines });
    expect(created.status).toBe(201);
    // Sin aceptar, no se puede activar desde el CRM
    expect((await call("POST", `/commercial-terms/${created.json.terms.id}/activate`, { token: TOK.admin, body: { expectedRevision: created.json.terms.revision, expectedVersion: sub.version } })).json.details).toMatchObject({ reason: "acceptance_required" });
    const sent = await call("POST", `/commercial-terms/${created.json.terms.id}/acceptance`, { token: TOK.admin, body: { signer, expectedRevision: created.json.terms.revision } });
    expect(sent.status).toBe(201);
    expect(sent.json.contract.id).not.toBe(contractId);
    const next = (await crmStore.get("contracts", sent.json.contract.id))!;
    expect(next).toMatchObject({ previousContractId: contractId, status: "sent", amountCents: 11900 });
    const token = sent.json.url.split("token=")[1];
    expect((await raw("POST", publicPath(sent.json.url), { token, name: "Marta Ruiz Gómez", accept: "1" })).status).toBe(200);
    // El contrato anterior sigue firmado e idéntico; la suscripción es la misma y pasa al contrato nuevo
    expect(await crmStore.get("contracts", contractId)).toEqual(signedBefore);
    const after = (await call("GET", `/subscriptions/${sid}`, { token: TOK.admin })).json;
    expect(after.subscription).toMatchObject({ id: sid, contractId: sent.json.contract.id });
    expect((await call("GET", `/subscriptions?companyId=${contractCompanyId}`, { token: TOK.admin })).json.subscriptions).toHaveLength(1);
    const versions = await crmStore.list("contractVersions", { contractId });
    expect(versions.length).toBeGreaterThan(0);
    const history = (await call("GET", `/subscriptions/${sid}/terms`, { token: TOK.admin })).json;
    expect(history.currentRecurring).toMatchObject({ netCents: 11900 });
  });
});

describe("aceptación: integridad de lo aceptado (hallazgos de la revisión independiente)", () => {
  const signer = { name: "Marta Ruiz", email: "marta@hotel-ejemplo.test" };
  const line = (cents: number | null = null) => [{ kind: "catalog", productKey: "essential", priceId: P.essential, negotiatedUnitCents: cents }];
  let sid = 0;
  let companyId = 0;
  const version = async () => (await call("GET", `/subscriptions/${sid}`, { token: TOK.admin })).json.subscription.version as number;
  const draft = async (over: Record<string, unknown>) => {
    const r = await call("POST", `/subscriptions/${sid}/terms`, { token: TOK.admin, body: { pricingMode: "per_item", presentation: "breakdown", reason: "Acuerdo comercial negociado", lines: line(1900), requiresAcceptance: true, ...over } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json.terms as { id: number; revision: number };
  };
  const send = (t: { id: number; revision: number }) => call("POST", `/commercial-terms/${t.id}/acceptance`, { token: TOK.admin, body: { signer, expectedRevision: t.revision } });
  const accept = (url: string) => raw("POST", publicPath(url), { token: url.split("token=")[1], name: "Marta Ruiz", accept: "1" });

  it("prepara una suscripción propia para estos casos", async () => {
    companyId = (await crmStore.insert("companies", { ...(await crmStore.get("companies", contractCompanyId))!, id: undefined as never, name: "Empresa de la revisión" } as never)).id;
    const s = await call("POST", "/subscriptions", { token: TOK.admin, body: { companyId, interval: "month", plan: { productKey: "essential", priceId: P.essential } } });
    expect(s.status).toBe(201);
    sid = s.json.subscription.id;
  });

  it("la condición siguiente va completa en el contrato y no se puede cambiar mientras el acuerdo está enviado", async () => {
    const end = clock + 40 * 86_400_000;
    const next = await call("POST", `/subscriptions/${sid}/terms`, { token: TOK.admin, body: { pricingMode: "per_item", presentation: "breakdown", reason: "Condición siguiente", lines: line(2500), effectiveFrom: end, conditions: "Revisión anual." } });
    expect(next.status).toBe(201);
    const main = await draft({ effectiveTo: end, afterEnd: "next_terms", nextTermsId: next.json.terms.id });
    const sent = await send(main);
    expect(sent.status).toBe(201);
    const page = await raw("GET", publicPath(sent.json.url));
    expect(page.body).toContain("CONDICIONES A PARTIR DEL");
    expect(page.body).toMatch(/25,00\s€ al mes/);
    expect(page.body).toContain("Revisión anual.");
    // Intento de colar un cargo y una permanencia en la condición siguiente
    const sneaky = await call("PUT", `/commercial-terms/${next.json.terms.id}`, {
      token: TOK.admin,
      body: { pricingMode: "per_item", presentation: "breakdown", reason: "Cambio posterior", effectiveFrom: end, conditions: "Permanencia de 5 años.", lines: [...line(2500), { kind: "custom", concept: "other", name: "Cargo sorpresa", chargeClass: "initial", unitCents: 500000, taxRateBp: 2100 }], expectedRevision: next.json.terms.revision },
    });
    expect(sneaky.status).toBe(409);
    expect(sneaky.json.details).toMatchObject({ reason: "chained_pending_acceptance" });
    expect((await call("POST", `/commercial-terms/${next.json.terms.id}/cancel`, { token: TOK.admin, body: { reason: "Quitarla de en medio", expectedRevision: next.json.terms.revision } })).status).toBe(409);
    // Anular el principal cancela su contrato y libera la siguiente
    const cancelled = await call("POST", `/commercial-terms/${main.id}/cancel`, { token: TOK.admin, body: { reason: "Se rehace la oferta", expectedRevision: sent.json.terms.revision } });
    expect(cancelled.status).toBe(200);
    expect((await crmStore.get("contracts", sent.json.contract.id))!.status).toBe("cancelled");
    expect((await raw("GET", publicPath(sent.json.url))).status).toBe(409);
    expect((await call("POST", `/commercial-terms/${next.json.terms.id}/cancel`, { token: TOK.admin, body: { reason: "Ya no hace falta", expectedRevision: next.json.terms.revision } })).status).toBe(200);
  });

  it("anular exige la revisión de quien anula (el control de concurrencia no se pierde por tener contrato)", async () => {
    const t = await draft({});
    const sent = await send(t);
    const stale = await call("POST", `/commercial-terms/${t.id}/cancel`, { token: TOK.admin, body: { reason: "Con revisión antigua", expectedRevision: t.revision } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe("version_conflict");
    expect((await raw("GET", publicPath(sent.json.url))).status).toBe(200);
    expect((await call("POST", `/commercial-terms/${t.id}/cancel`, { token: TOK.admin, body: { reason: "Con la revisión vigente", expectedRevision: sent.json.terms.revision } })).status).toBe(200);
  });

  it("condición temporal sin fecha de inicio (desde la aceptación): el documento se genera y se puede enviar", async () => {
    const t = await draft({ effectiveTo: clock + 90 * 86_400_000, afterEnd: "official_snapshot" });
    const doc = await call("GET", `/commercial-terms/${t.id}/document`, { token: TOK.admin });
    expect(doc.status).toBe(200);
    expect(doc.json.text).toContain("Entrada en vigor: en el momento de la aceptación de estas condiciones.");
    expect(doc.json.text).toContain("se aplicará la tarifa oficial fijada en este acuerdo");
    const sent = await send(t);
    expect(sent.status).toBe(201);
    await call("POST", `/commercial-terms/${t.id}/cancel`, { token: TOK.admin, body: { reason: "Solo era la prueba", expectedRevision: sent.json.terms.revision } });
  });

  it("no se envía ni se acepta lo que ya no se podría activar (vigencia vencida)", async () => {
    const t = await draft({ effectiveFrom: clock + 86_400_000, effectiveTo: clock + 10 * 86_400_000, afterEnd: "official_snapshot" });
    const sent = await send(t);
    expect(sent.status).toBe(201);
    const saved = clock;
    clock += 11 * 86_400_000;
    // Pasada la vigencia: la página ya no ofrece aceptar y no se registra ninguna aceptación
    expect((await raw("GET", publicPath(sent.json.url))).status).toBe(409);
    expect((await accept(sent.json.url)).status).toBe(409);
    expect((await crmStore.get("contracts", sent.json.contract.id))!.status).toBe("sent");
    expect((await call("GET", `/commercial-terms/${t.id}`, { token: TOK.admin })).json.terms).toMatchObject({ status: "pending_acceptance", acceptanceStatus: "pending" });
    // Y tiene salida: se anula (con su contrato) y se rehace
    expect((await call("POST", `/commercial-terms/${t.id}/cancel`, { token: TOK.admin, body: { reason: "Vigencia vencida", expectedRevision: sent.json.terms.revision } })).status).toBe(200);
    clock = saved;
    // Tampoco se envía uno ya vencido
    const late = await draft({ effectiveTo: clock + 86_400_000, afterEnd: "official_snapshot" });
    clock += 2 * 86_400_000;
    expect((await send(late)).status).toBe(409);
    clock = saved;
    await call("POST", `/commercial-terms/${late.id}/cancel`, { token: TOK.admin, body: { reason: "Vencido antes de enviarse", expectedRevision: late.revision } });
  });

  it("si el contrato se cancela en el CRM o cambian los datos del cliente, el enlace deja de valer", async () => {
    const t = await draft({});
    const sent = await send(t);
    // Cambia la razón social: el documento ya no es el enviado (comparación de huella)
    const company = (await crmStore.get("companies", companyId))!;
    await crmStore.update("companies", companyId, { legalName: "Otra Razón Social, S.L." });
    const changed = await raw("GET", publicPath(sent.json.url));
    expect(changed.status).toBe(409);
    expect(changed.body).toContain("han cambiado desde que se envió este enlace");
    await crmStore.update("companies", companyId, { legalName: company.legalName });
    expect((await raw("GET", publicPath(sent.json.url))).status).toBe(200);
    // Contrato cancelado a mano en el CRM
    await crmStore.update("contracts", sent.json.contract.id, { status: "cancelled" });
    expect((await raw("GET", publicPath(sent.json.url))).status).toBe(409);
    expect((await accept(sent.json.url)).status).toBe(409);
    expect((await acceptanceStore.acceptances(sent.json.contract.id)).every((a) => a.status !== "accepted")).toBe(true);
    expect((await call("POST", `/commercial-terms/${t.id}/cancel`, { token: TOK.admin, body: { reason: "Contrato cancelado", expectedRevision: sent.json.terms.revision } })).status).toBe(200);
  });

  it("retirar y aceptar a la vez: gana uno solo y el acuerdo nunca queda activo y en borrador a la vez", async () => {
    const t = await draft({});
    const sent = await send(t);
    const [w, a] = await Promise.all([call("POST", `/commercial-terms/${t.id}/acceptance/withdraw`, { token: TOK.admin, body: { reason: "Retirada simultánea", expectedRevision: sent.json.terms.revision } }), accept(sent.json.url)]);
    const terms = (await call("GET", `/commercial-terms/${t.id}`, { token: TOK.admin })).json.terms;
    const rows = await acceptanceStore.acceptances(sent.json.contract.id);
    if (a.status === 200) {
      expect(w.status).toBe(409);
      expect(terms).toMatchObject({ status: "active", acceptanceStatus: "accepted" });
      expect(rows.filter((r) => r.status === "accepted")).toHaveLength(1);
    } else {
      expect(w.status).toBe(200);
      expect(terms).toMatchObject({ status: "draft" });
      expect(rows.some((r) => r.status === "accepted")).toBe(false);
      await call("POST", `/commercial-terms/${t.id}/cancel`, { token: TOK.admin, body: { reason: "Limpieza de la prueba", expectedRevision: terms.revision } });
    }
    // Una retirada posterior a una aceptación se rechaza siempre
    const t2 = await draft({ lines: line(1700) });
    const sent2 = await send(t2);
    expect((await accept(sent2.json.url)).status).toBe(200);
    const after = (await call("GET", `/commercial-terms/${t2.id}`, { token: TOK.admin })).json.terms;
    expect(after).toMatchObject({ status: "active", acceptanceStatus: "accepted" });
    expect((await call("POST", `/commercial-terms/${t2.id}/acceptance/withdraw`, { token: TOK.admin, body: { reason: "Demasiado tarde", expectedRevision: after.revision } })).status).toBe(409);
    expect(await version()).toBeGreaterThan(1);
  });

  it("un paquete no lleva fecha efectiva: entra en vigor al contratarlo o al aceptarlo, como dice su contrato", async () => {
    const body = { companyId, interval: "month", pricingMode: "per_item", presentation: "breakdown", reason: "Paquete con fecha", lines: line(1900), effectiveFrom: clock + 30 * 86_400_000 };
    const r = await call("POST", "/commercial-terms/packages", { token: TOK.admin, body });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/no lleva fecha efectiva/);
  });
});

describe("cobro en Stripe de condiciones personalizadas: apagado por defecto", () => {
  it("las rutas existen, pero sin interruptor no se llama a Stripe ni cambia nada; sincronizar exige el permiso de precios", async () => {
    const list = (await call("GET", `/subscriptions/${subscriptionId}/terms`, { token: TOK.admin })).json;
    const active = list.terms.find((t: { effectiveStatus: string }) => t.effectiveStatus === "active");
    expect(active).toBeTruthy();
    for (const token of [TOK.sales, TOK.service, TOK.tenant]) expect((await call("POST", `/subscriptions/${subscriptionId}/terms/billing/sync`, { token, body: {} })).status).toBe(403);
    const sync = await call("POST", `/subscriptions/${subscriptionId}/terms/billing/sync`, { token: TOK.admin, body: {} });
    expect(sync.status).toBe(200);
    expect(sync.json.status).toBe("disabled");
    const view = (await call("GET", `/subscriptions/${subscriptionId}/terms/billing`, { token: TOK.sales })).json;
    expect(view).toMatchObject({ available: false, syncStatus: "none", differences: [] });
    expect(view.plan.items.length).toBeGreaterThan(0);
    const after = (await call("GET", `/commercial-terms/${active.id}`, { token: TOK.admin })).json;
    expect(after.terms.syncStatus).toBe("none");
    expect(after.events.some((e: { kind: string }) => e.kind === "sync")).toBe(false);
    expect((await call("GET", `/subscriptions/${subscriptionId}`, { token: TOK.admin })).json.billing).toEqual({ source: "shadow" });
  });
});
