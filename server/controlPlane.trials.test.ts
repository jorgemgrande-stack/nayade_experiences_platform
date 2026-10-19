/**
 * Prueba gratuita de Essential de punta a punta por HTTP, con el aprovisionamiento REAL (registro en
 * memoria; solo la creación física de la BD y el sembrado son dobles), el catálogo oficial, el motor
 * de suscripciones, las licencias por capacidad y un buzón de salida en memoria (no se envía nada).
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
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { capabilitiesOfTier } from "./catalog/capabilities";
import type { TrialNotifier } from "./trials/onboarding";

const DAY = 86_400_000;
const ADMIN = "trial-admin-token-aaaaaaaaaaaaaaaaaaaa";
let clock = Date.UTC(2026, 9, 16, 9);
let server: http.Server;
let port = 0;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
let registryReader: MemoryTenantRegistryStore;
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
let failProvisioning = 0;

const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};

const call = (method: string, path: string, o: { token?: string; body?: unknown } = {}) =>
  new Promise<{ status: number; json: any; raw: string }>((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
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

beforeAll(async () => {
  registryReader = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(registryReader, () => ring);
  const provisioning = new ProvisioningService({
    registry,
    reader: registryReader,
    databases: {
      ensureDatabase: async (id) => {
        if (failProvisioning > 0) {
          failProvisioning--;
          throw new Error("servidor de BD no disponible");
        }
        return { dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" };
      },
      dropDatabase: async () => undefined,
    },
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
  const app = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: ["tenants:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write"] }],
    registry,
    reader: registryReader,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: new CrmService({ store: crmStore }), store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    trials: { store: trialStore, publicEnabled: true, autoProvision: true, notify },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const key = () => crypto.randomBytes(12).toString("hex");
const access = () => new CapabilityAccess(caps, { enforce: true, now: () => clock });

describe("prueba gratuita de Essential de punta a punta", () => {
  let trialId = 0;
  let tenantId = "";

  it("registro: respuesta genérica sin token, enlace por el buzón; sin revelar correos ya registrados; campo trampa", async () => {
    const r = await call("POST", "/public/trial", { body: { email: "ana@hotelsol.example", companyName: "Hotel Sol, S.L.", idempotencyKey: key() } });
    expect(r.status).toBe(202);
    expect(r.raw).not.toMatch(/token/i);
    expect(outbox.filter((m) => m.kind === "verification")).toHaveLength(1);
    trialId = outbox[0].data.trialId as number;
    const again = await call("POST", "/public/trial", { body: { email: "ana@hotelsol.example", companyName: "Otra", idempotencyKey: key() } });
    expect(again.status).toBe(202);
    expect(again.json).toEqual(r.json);
    const bot = await call("POST", "/public/trial", { body: { email: "bot@spam.example", companyName: "Bot", idempotencyKey: key(), website: "http://spam" } });
    expect(bot.status).toBe(202);
    expect(outbox.filter((m) => m.kind === "verification")).toHaveLength(1);
    expect((await trialStore.list({})).length).toBe(1);
  });

  it("verificación con enlace incorrecto: mismo error genérico", async () => {
    const bad = await call("POST", "/public/trial/verify", { body: { id: trialId, token: "x".repeat(43) } });
    expect(bad.status).toBe(403);
    expect((await call("POST", "/public/trial/verify", { body: { id: 9999, token: "x".repeat(43) } })).status).toBe(403);
  });

  it("verificación correcta: plataforma con administrador, empresa, suscripción en prueba y licencias Essential hasta el fin de la prueba", async () => {
    const token = outbox[0].data.token as string;
    const r = await call("POST", "/public/trial/verify", { body: { id: trialId, token } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: "active", activationPending: false, endsAt: clock + 15 * DAY });
    const welcome = outbox.find((m) => m.kind === "welcome")!;
    tenantId = welcome.data.tenantId as string;
    expect(tenantId).toBe(`t${trialId}-hotel-sol-s-l`);
    expect(welcome.data.inviteToken).toBeTruthy();
    expect(await registryReader.getTenant(tenantId)).toBeTruthy();
    const company = (await crmStore.list("companies", { tenantId }))[0];
    expect(company.name).toBe("Hotel Sol, S.L.");
    const sub = (await subsStore.list({ companyId: company.id }))[0];
    expect(sub).toMatchObject({ status: "trialing", tenantId, trialEnd: clock + 15 * DAY });
    const granted = await caps.list(tenantId);
    expect(granted.map((g) => g.capabilityId).sort()).toEqual(capabilitiesOfTier("essential").sort());
    expect(granted.every((g) => g.status === "active" && g.validUntil === clock + 15 * DAY)).toBe(true);
    expect((await access().check("crm-leads", { write: true, tenantId })).allowed).toBe(true);
    // Lo que no está en Essential no se usa
    expect((await access().check("people-hr", { write: false, tenantId })).allowed).toBe(false);
    expect((await access().check("roles-custom", { write: false, tenantId })).allowed).toBe(false);
  });

  it("activar otra vez no duplica nada (idempotente)", async () => {
    const r = await call("POST", `/trials/${trialId}/activate`, { token: ADMIN });
    expect(r.status).toBe(200);
    expect(r.json.licencesChanged).toBe(0);
    expect((await crmStore.list("companies", { tenantId })).length).toBe(1);
    expect((await subsStore.list({})).length).toBe(1);
  });

  it("avisos: se calculan 1 día antes y solo se envían por acción explícita", async () => {
    expect((await call("GET", "/trials/review", { token: ADMIN })).json.noticesDue).toEqual([]);
    clock += 14 * DAY;
    const review = await call("GET", "/trials/review", { token: ADMIN });
    expect(review.json.noticesDue).toEqual([expect.objectContaining({ id: trialId, daysLeft: 1 })]);
    expect(outbox.filter((m) => m.kind === "expiry")).toHaveLength(0);
    expect((await call("POST", "/trials/notices/send", { token: ADMIN })).json).toEqual({ sent: 1 });
    expect(outbox.filter((m) => m.kind === "expiry")).toHaveLength(1);
  });

  it("vencimiento: solo lectura (los datos se conservan); nada se borra", async () => {
    clock += 2 * DAY;
    expect((await access().check("crm-leads", { write: false, tenantId })).allowed).toBe(true);
    expect((await access().check("crm-leads", { write: true, tenantId })).allowed).toBe(false);
    const r = await call("POST", `/trials/${trialId}/expire`, { token: ADMIN });
    expect(r.json.trial.state).toBe("expired");
    expect((await caps.list(tenantId)).length).toBe(29);
    expect(await registryReader.getTenant(tenantId)).toBeTruthy();
  });

  it("sin pedido no hay conversión a pago: el atajo exige la excepción tipificada y, sin orquestador, se rechaza", async () => {
    // Sin categoría ni motivo: rechazada antes de tocar nada
    expect((await call("POST", `/trials/${trialId}/convert`, { token: ADMIN, body: { plan: "business" } })).status).toBe(400);
    // Con la excepción completa, pero sin pedidos activos en este plano de control: 409 (se usa POST /orders y su cobro)
    const r = await call("POST", `/trials/${trialId}/convert`, { token: ADMIN, body: { plan: "business", category: "exception", reason: "Cliente piloto autorizado por dirección comercial" } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("orders_required");
    // Nada cambió: la prueba sigue vencida, la suscripción en prueba y ninguna licencia de pago
    expect((await call("GET", `/trials/${trialId}`, { token: ADMIN })).json.trial.state).toBe("expired");
    expect((await subsStore.list({}))[0].status).toBe("trialing");
    expect((await caps.list(tenantId)).filter((g) => g.validUntil === null)).toHaveLength(0);
    expect((await access().check("roles-custom", { write: true, tenantId })).allowed).toBe(false);
  });

  it("fallo del aprovisionamiento: el correo queda verificado, la activación pendiente y se reintenta", async () => {
    outbox.length = 0;
    await call("POST", "/public/trial", { body: { email: "luis@casarural.example", companyName: "Casa Rural Luna", idempotencyKey: key() } });
    const v = outbox.find((m) => m.kind === "verification")!;
    failProvisioning = 100;
    const r = await call("POST", "/public/trial/verify", { body: { id: v.data.trialId, token: v.data.token } });
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ state: "verified", activationPending: true });
    expect(r.raw).not.toMatch(/servidor de BD/);
    failProvisioning = 0;
    const retry = await call("POST", `/trials/${v.data.trialId}/activate`, { token: ADMIN });
    expect(retry.status).toBe(200);
    expect(retry.json.trial.state).toBe("active");
  });

  it("sin habilitar la ruta pública no existe; sin permisos de alta no se activa", async () => {
    expect((await call("POST", "/trials/1/activate")).status).toBe(401);
  });

  it("alta asistida por operador (beta privada): sin correo; plataforma, licencias y enlace de acceso; idempotente", async () => {
    outbox.length = 0;
    const body = { email: "ana@beta.example", companyName: "Beta Invitada SL", idempotencyKey: "operador-beta-0001" };
    expect((await call("POST", "/trials", { body })).status).toBe(401);
    const r = await call("POST", "/trials", { token: ADMIN, body });
    expect(r.status).toBe(201);
    expect(r.json.trial.state).toBe("active");
    expect(r.json.accessUrl).toMatch(new RegExp(`^https://${r.json.tenantId}\\.elephant\\.test/establecer-contrasena\\?token=`));
    expect(r.json.capabilities).toBeGreaterThan(0);
    expect(outbox.filter((m) => m.kind === "verification")).toHaveLength(0);
    expect((await caps.list(r.json.tenantId)).length).toBe(r.json.capabilities);
    // La misma petición no crea nada más
    const again = await call("POST", "/trials", { token: ADMIN, body });
    expect(again.status).toBe(201);
    expect(again.json.tenantId).toBe(r.json.tenantId);
    expect(again.json.accessUrl).toBeNull();
    expect((await call("POST", "/trials", { token: ADMIN, body: { ...body, email: "no-es-correo" } })).status).toBe(400);
  });
});
