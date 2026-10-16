/**
 * Contratación de punta a punta por HTTP, tal como la opera el CRM: solicitud de la web → lead → conversión
 * (empresa, contacto y oportunidad) → presupuesto del cotizador → contrato configurado → aprobación de lo
 * que va «bajo solicitud» → firma → activación (aprovisionamiento REAL en memoria) → suscripción desde el
 * contrato → licencias → renovación → cambio de plan → cancelación → historial.
 *
 * Cada paso posterior al contrato es una llamada explícita (no se encadenan solos): la prueba documenta
 * ese recorrido y comprueba que el estado es coherente en cada punto. Datos sintéticos; no se envía nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";

const DAY = 86_400_000;
const WEB = "https://web.example";
const SECRET = "secreto-de-formulario-de-prueba-0123456789abcdef";
const TOKEN = "flow-operator-token-aaaaaaaaaaaaaaaaaaaa";
let clock = Date.UTC(2026, 9, 16, 9);
let server: http.Server;
let port = 0;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
let registryReader: MemoryTenantRegistryStore;

const call = (method: string, path: string, o: { body?: unknown; auth?: boolean; headers?: Record<string, string> } = {}) =>
  new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1${path}`,
        method,
        headers: {
          ...(o.auth === false ? { origin: WEB } : { authorization: `Bearer ${TOKEN}` }),
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          ...(o.headers ?? {}),
        },
      },
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
const ok = async (p: Promise<{ status: number; json: any }>, expected = 200) => {
  const r = await p;
  if (r.status !== expected) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const priceId = async (key: string, kind: "monthly" | "yearly" = "monthly") =>
  (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === kind)!.id;

beforeAll(async () => {
  registryReader = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(registryReader, () => ring);
  const provisioning = new ProvisioningService({
    registry,
    reader: registryReader,
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
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }) });
  const app = createControlPlaneApp({
    tokens: [
      {
        id: "operador",
        sha256: hashToken(TOKEN),
        scopes: ["crm:read", "crm:write", "web:read", "provisioning:write", "billing:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read"],
      },
    ],
    registry,
    reader: registryReader,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock },
    capabilities: caps,
    publicIntake: { origins: [WEB], secret: SECRET, now: () => clock, perIp: 100 },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("contratación de punta a punta", () => {
  // Estado compartido entre pasos (la prueba es una secuencia)
  const s: { leadId?: number; companyId?: number; contractId?: number; tenantId?: string; subId?: number; version?: number; renewalId?: number } = {};
  const request = { plan: "essential", interval: "month" as const, items: [{ key: "restaurant-net-bookings" }] };

  it("1. la solicitud de la web crea un lead con su configuración", async () => {
    const ticket = (await ok(call("GET", "/public/form-ticket", { auth: false }))).ticket as string;
    clock += 5000;
    const r = await call("POST", "/public/requests", {
      auth: false,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: {
        type: "onboarding",
        name: "Lucía Ensayo",
        email: "lucia@montana.example",
        company: "Montaña Ejemplo SL",
        sector: "Restauración",
        configuration: { plan: "essential", extensions: [], industries: ["restaurant"], interests: [] },
        sourcePage: "/contratar",
        consents: { privacy: true, marketing: false },
        privacyVersion: "2026-10-borrador",
        ticket,
        website: "",
      },
    });
    expect([200, 201, 202]).toContain(r.status);
    const inbox = await ok(call("GET", "/crm/requests"));
    const req = inbox.requests.map((x: any) => x.request).find((x: any) => x.configuration?.plan === "essential");
    expect(req).toBeTruthy();
    s.leadId = req.leadId;
  });

  it("2. el lead se convierte en empresa, contacto y oportunidad", async () => {
    const conv = await ok(call("POST", `/crm/leads/${s.leadId}/convert`, { body: { companyName: "Montaña Ejemplo SL", opportunity: { title: "Essential + reservas", planId: "essential" } } }));
    s.companyId = conv.company.id;
    expect(conv.opportunity).toBeTruthy();
    const contacts = (await crmStore.list("contacts", { companyId: s.companyId! })).filter((c) => c.email);
    expect(contacts.map((c) => c.email)).toContain("lucia@montana.example");
  });

  it("3. el presupuesto lo calcula el servidor con el catálogo oficial", async () => {
    const q = await ok(call("POST", "/web/quote", { body: request }));
    const quote = q.quote ?? q;
    expect(quote.blocking ?? []).toEqual([]);
    expect(quote.lines.map((l: any) => l.key)).toEqual(expect.arrayContaining(["essential", "restaurant-net-bookings"]));
  });

  it("4. contrato con la configuración cotizada; lo «bajo solicitud» exige aprobación motivada", async () => {
    const c = await ok(call("POST", "/crm/contracts", { body: { companyId: s.companyId, configuration: { request } } }), 201);
    s.contractId = c.contract.id;
    expect(c.contract.planId).toBe("essential");
    expect(c.contract.amountCents).toBeGreaterThan(0);
    expect((await call("POST", `/crm/contracts/${s.contractId}/status`, { body: { status: "sent" } })).status).toBe(400);
    await ok(call("POST", `/crm/contracts/${s.contractId}/status`, { body: { status: "sent", approvalReason: "Revisado por el equipo de producto" } }));
    await ok(call("POST", `/crm/contracts/${s.contractId}/status`, { body: { status: "signed", signatureRef: "firma-ensayo-1", approvalReason: "Revisado por el equipo de producto" } }));
  });

  it("5. activar el contrato da de alta la plataforma de la empresa", async () => {
    const a = await ok(call("POST", `/crm/contracts/${s.contractId}/status`, { body: { status: "active" } }));
    expect(a.contract.status).toBe("active");
    s.tenantId = a.contract.tenantId;
    expect(s.tenantId).toBeTruthy();
    expect(await registryReader.getTenant(s.tenantId!)).toBeTruthy();
  });

  it("6. suscripción desde el contrato y licencias activas", async () => {
    const sub = await ok(
      call("POST", "/subscriptions", {
        body: { companyId: s.companyId, contractId: s.contractId, interval: "month", plan: { productKey: "essential", priceId: await priceId("essential") }, addons: [{ productKey: "restaurant-net-bookings", priceId: await priceId("restaurant-net-bookings") }] },
      }),
      201,
    );
    s.subId = sub.subscription.id;
    s.version = sub.subscription.version;
    expect(sub.subscription.tenantId ?? s.tenantId).toBe(s.tenantId);
    const ap = await ok(call("POST", `/subscriptions/${s.subId}/licences/apply`, { body: { activate: true, reason: "Alta del cliente" } }));
    expect(ap.applied.length).toBeGreaterThan(0);
    const list = await caps.list(s.tenantId!);
    expect(list.find((g) => g.capabilityId === "restaurant-net")?.status).toBe("active");
    expect(list.every((g) => g.status === "active")).toBe(true);
  });

  it("7. renovación del periodo: la suscripción avanza y las licencias siguen vigentes", async () => {
    const before = (await ok(call("GET", `/subscriptions/${s.subId}`))).subscription;
    clock += 32 * DAY;
    const r = await ok(call("POST", `/subscriptions/${s.subId}/renewals`, { body: {} }));
    expect(r.subscription.currentPeriodEnd).toBeGreaterThan(before.currentPeriodEnd);
    s.version = r.subscription.version;
    await ok(call("POST", `/subscriptions/${s.subId}/licences/apply`, { body: {} }));
    for (const g of await caps.list(s.tenantId!)) expect(g.validUntil === null || g.validUntil > clock, g.capabilityId).toBe(true);
  });

  it("8. cambio de plan Essential → Business: el contrato activo no se toca; se formaliza en una renovación y se aplica a la suscripción", async () => {
    const business = { ...request, plan: "business" };
    // Enterprise está «Próximamente»: ni el contrato ni la suscripción lo admiten
    const draft = await ok(call("POST", `/crm/contracts`, { body: { companyId: s.companyId, configuration: { request: { ...request, plan: "enterprise" } } } }), 201);
    expect((await call("POST", `/crm/contracts/${draft.contract.id}/status`, { body: { status: "sent", approvalReason: "Intento de contratar Enterprise" } })).status).toBe(409);
    const ent = await call("POST", `/subscriptions/${s.subId}/plan`, { body: { plan: { productKey: "enterprise", priceId: await priceId("enterprise") }, when: "now", reason: "Intento", expectedVersion: s.version } });
    expect(ent.status, JSON.stringify(ent.json)).toBeGreaterThanOrEqual(400);
    expect((await call("PATCH", `/crm/contracts/${s.contractId}`, { body: { configuration: { request: business } } })).status).toBe(409);
    const ren = await ok(call("POST", `/crm/contracts/${s.contractId}/renew`, { body: {} }), 201);
    s.renewalId = (ren.contract ?? ren).id;
    const upd = await call("PATCH", `/crm/contracts/${s.renewalId}`, { body: { configuration: { request: business } } });
    expect(upd.status, JSON.stringify(upd.json)).toBe(200);
    expect(upd.json.contract.planId).toBe("business");
    for (const status of ["sent", "signed"]) await ok(call("POST", `/crm/contracts/${s.renewalId}/status`, { body: { status, approvalReason: "Ampliación aprobada por dirección" } }));
    const ch = await ok(call("POST", `/subscriptions/${s.subId}/plan`, { body: { plan: { productKey: "business", priceId: await priceId("business") }, when: "now", reason: "Ampliación", expectedVersion: s.version } }));
    s.version = ch.subscription.version;
    const pre = await ok(call("POST", `/subscriptions/${s.subId}/licences/preview`, { body: {} }));
    expect(pre.desired.length).toBeGreaterThan(0);
    await ok(call("POST", `/subscriptions/${s.subId}/licences/apply`, { body: { activate: true } }));
  });

  it("9. cancelación a fin de periodo: las licencias pasan a canceladas y nada se borra", async () => {
    const cancel = await ok(call("POST", `/subscriptions/${s.subId}/cancel`, { body: { reason: "Cierre de temporada", expectedVersion: s.version } }));
    expect(cancel.subscription.cancelAt).toBeTruthy();
    clock = cancel.subscription.cancelAt + DAY;
    const r = await ok(call("POST", `/subscriptions/${s.subId}/renewals`, { body: {} }));
    expect(r.subscription.status).toBe("canceled");
    await ok(call("POST", `/subscriptions/${s.subId}/licences/apply`, { body: {} }));
    const list = await caps.list(s.tenantId!);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((g) => g.status === "cancelled")).toBe(true);
    expect(await registryReader.getTenant(s.tenantId!)).toBeTruthy();
  });

  it("10. historial completo: versiones y actividad del contrato, eventos de suscripción y de licencias", async () => {
    const c = await ok(call("GET", `/crm/contracts/${s.contractId}`));
    expect(c.versions.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(c.timeline)).toMatch(/Revisado por el equipo de producto/);
    expect(JSON.stringify(c.timeline)).toMatch(/Renovación creada/);
    const ren = await ok(call("GET", `/crm/contracts/${s.renewalId}`));
    expect((ren.contract ?? ren).previousContractId).toBe(s.contractId);
    const d = await ok(call("GET", `/subscriptions/${s.subId}`));
    const kinds = d.events.map((e: any) => e.type ?? e.kind);
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    const lic = await ok(call("GET", `/tenants/${s.tenantId}/capabilities`));
    expect(lic.events.some((e: any) => (e.status ?? e.toStatus) === "cancelled")).toBe(true);
  });
});
