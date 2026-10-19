/**
 * Prueba gratuita autónoma por HTTP (plano de control) con el aprovisionamiento REAL en memoria, el
 * catálogo oficial, suscripciones, licencias por capacidad, el orquestador comercial y el proveedor de
 * pagos de PRUEBAS (ningún cobro real, ningún correo real). Datos sintéticos.
 *
 *  - Reenvío del enlace: respuesta genérica (no revela si el correo existe), token rotado, límite por IP.
 *  - Vencimiento por la tarea programada: solo lectura, nada se borra.
 *  - Conversión a pago (pedido `trial_conversion` con pago de prueba verificado, o por operador): misma
 *    plataforma, misma empresa y misma suscripción; nunca se duplica nada; licencias de solo lectura a activas.
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
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryTrialStore } from "./trials/store";
import { TrialScheduler, memoryLock } from "./trials/scheduler";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MemoryOrderStore } from "./orchestrator/store";
import { SignedTestProvider } from "./orchestrator/payments";
import type { TrialNotifier } from "./trials/onboarding";

const DAY = 86_400_000;
const ADMIN = "aut-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
let clock = Date.UTC(2026, 9, 16, 9);
let server: http.Server;
let port = 0;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
const orders = new MemoryOrderStore();
const provider = new SignedTestProvider({ webhookSecret: "secreto-del-proveedor-de-pruebas-autonomia-0123456789" });
let registry: MemoryTenantRegistryStore;
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
let evSeq = 0;

const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};
const scheduler = new TrialScheduler({ store: trialStore, notify, lock: memoryLock(), now: () => clock, log: () => undefined });

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `/cp/v1${path}`,
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) },
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
const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
  const r = await p;
  if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${r.raw}`);
  return r.json;
};
const key = () => crypto.randomBytes(12).toString("hex");
const access = () => new CapabilityAccess(caps, { enforce: true, now: () => clock });
const providerEvent = (payment: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, type: "payment.succeeded" | "payment.failed") => {
  const body = JSON.stringify({ id: `evt_aut_${++evSeq}`, type, paymentKey: payment.idempotencyKey, providerRef: payment.providerRef, amountCents: payment.amountCents, currency: payment.currency, livemode: false });
  return { body, sig: provider.sign(body, Math.floor(clock / 1000)) };
};
const webhook = (e: { body: string; sig: string }) => call("POST", "/payments/test/webhook", { token: null, raw: e.body, headers: { "x-test-signature": e.sig } });
/** El reenvío público responde sin esperar al trabajo: se espera a que termine. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

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
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write"] as const;
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
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    trials: { store: trialStore, publicEnabled: true, autoProvision: true, notify },
    orders: { store: orders, payments: provider },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Alta pública + verificación (activa la prueba). */
async function startTrial(email: string, companyName: string) {
  await ok(call("POST", "/public/trial", { token: null, body: { email, companyName, idempotencyKey: key() } }), 202);
  const v = outbox.filter((m) => m.kind === "verification" && m.to === email).at(-1)!;
  await ok(call("POST", "/public/trial/verify", { token: null, body: { id: v.data.trialId, token: v.data.token } }));
  const t = (await trialStore.get(v.data.trialId as number))!;
  const company = (await crmStore.list("companies", { tenantId: t.tenantId! }))[0];
  const sub = (await subsStore.list({ companyId: company.id }))[0];
  return { trialId: t.id, tenantId: t.tenantId!, companyId: company.id, subId: sub.id };
}

describe("reenvío del enlace de verificación por HTTP", () => {
  it("respuesta idéntica exista o no el correo; token rotado; el anterior ya no vale", async () => {
    await ok(call("POST", "/public/trial", { token: null, body: { email: "rosa@vinos.example", companyName: "Vinos Rosa SL", idempotencyKey: key() } }), 202);
    const first = outbox.find((m) => m.kind === "verification" && m.to === "rosa@vinos.example")!;
    clock += 5 * 60_000;
    const yes = await call("POST", "/public/trial/resend", { token: null, body: { email: "rosa@vinos.example" } });
    const no = await call("POST", "/public/trial/resend", { token: null, body: { email: "nadie@vinos.example" } });
    expect([yes.status, no.status]).toEqual([202, 202]);
    expect(yes.raw).toBe(no.raw);
    expect(yes.raw).not.toMatch(/token/i);
    await settle();
    const again = outbox.filter((m) => m.kind === "verification" && m.to === "rosa@vinos.example");
    expect(again).toHaveLength(2);
    expect(again[1].data).toMatchObject({ trialId: first.data.trialId, resend: true });
    expect((await call("POST", "/public/trial/verify", { token: null, body: { id: first.data.trialId, token: first.data.token } })).status).toBe(403);
    const r = await ok(call("POST", "/public/trial/verify", { token: null, body: { id: first.data.trialId, token: again[1].data.token } }));
    expect(r.state).toBe("active");
    // Ya verificada: misma respuesta, nada se envía
    clock += 5 * 60_000;
    expect((await call("POST", "/public/trial/resend", { token: null, body: { email: "rosa@vinos.example" } })).raw).toBe(no.raw);
    await settle();
    expect(outbox.filter((m) => m.kind === "verification" && m.to === "rosa@vinos.example")).toHaveLength(2);
  });

  it("operador: resultado detallado sin token; requiere permiso", async () => {
    await ok(call("POST", "/public/trial", { token: null, body: { email: "op@vinos.example", companyName: "Vinos Op SL", idempotencyKey: key() } }), 202);
    const id = outbox.filter((m) => m.kind === "verification" && m.to === "op@vinos.example")[0].data.trialId;
    expect((await call("POST", `/trials/${id}/resend-verification`, { token: null })).status).toBe(401);
    const cool = await ok(call("POST", `/trials/${id}/resend-verification`));
    expect(cool).toMatchObject({ outcome: "cooldown", state: "pending_verification" });
    clock += 5 * 60_000;
    const r = await call("POST", `/trials/${id}/resend-verification`);
    expect(r.json).toMatchObject({ outcome: "resent", state: "pending_verification" });
    expect(r.raw).not.toMatch(/token/i);
    expect((await ok(call("GET", `/trials/${id}/events`))).events.map((e: any) => e.action)).toEqual(["registered", "resend_verification"]);
  });

  it("campo trampa y límite propio por IP", async () => {
    expect((await call("POST", "/public/trial/resend", { token: null, body: { email: "op@vinos.example", website: "http://spam" } })).status).toBe(202);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await call("POST", "/public/trial/resend", { token: null, body: { email: `x${i}@vinos.example` } })).status);
    expect(codes).toContain(429);
  });
});

describe("vencimiento por la tarea programada y conversión a pago sin duplicar nada", () => {
  let s: Awaited<ReturnType<typeof startTrial>>;
  let tenantsBefore = 0;

  it("vence sola: solo lectura en el servidor, licencias y plataforma intactas", async () => {
    s = await startTrial("marta@pinar.example", "Pinar Autonomía SL");
    tenantsBefore = (await registry.listTenants()).length;
    const capsBefore = (await caps.list(s.tenantId)).length;
    clock += 15 * DAY + 60_000;
    const tick = await scheduler.tick();
    expect(tick).toMatchObject({ skipped: null, errors: 0 });
    expect(tick.expired).toBeGreaterThanOrEqual(1);
    expect((await trialStore.get(s.trialId))!.state).toBe("expired");
    expect(outbox.filter((m) => m.kind === "expiry" && m.data.trialId === s.trialId).map((m) => m.data.daysLeft)).toEqual([0]);
    // Solo lectura: consultar sí, operar no
    expect((await access().check("crm-leads", { write: false, tenantId: s.tenantId })).allowed).toBe(true);
    expect(await access().check("crm-leads", { write: true, tenantId: s.tenantId })).toMatchObject({ allowed: false, status: "expired" });
    // Nada se borra ni se suspende
    const granted = await caps.list(s.tenantId);
    expect(granted).toHaveLength(capsBefore);
    expect(granted.every((g) => g.status === "active")).toBe(true);
    expect(await registry.getTenant(s.tenantId)).toBeTruthy();
    expect((await subsStore.get(s.subId))!.status).toBe("trialing");
    // Otra pasada no repite nada
    expect(await scheduler.tick()).toMatchObject({ expired: 0, noticesQueued: 0 });
  });

  it("vencida, puede seguir contratando: pedido de conversión con pago de prueba verificado", async () => {
    const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), trialId: s.trialId, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    expect(created.order).toMatchObject({ kind: "trial_conversion", subscriptionId: s.subId, tenantId: s.tenantId, companyId: s.companyId });
    const orderId = created.order.id;
    await ok(call("POST", `/orders/${orderId}/accept`, { body: { signatureRef: "aceptacion-web-autonomia", approvalReason: "Revisado por producto" } }), [200, 202]);
    // Sin pago verificado no cambia nada: sigue en solo lectura
    expect((await access().check("crm-leads", { write: true, tenantId: s.tenantId })).allowed).toBe(false);
    const p = await ok(call("POST", `/orders/${orderId}/payments`), 201);
    expect(await ok(webhook(providerEvent(p.payment, "payment.succeeded")))).toEqual({ status: "processed", outcome: "applied" });
    const d = await ok(call("GET", `/orders/${orderId}`));
    expect(d.order.state).toBe("active");
    // Misma plataforma, empresa y suscripción
    const sub = (await subsStore.get(s.subId))!;
    expect(sub).toMatchObject({ id: s.subId, status: "active", tenantId: s.tenantId, trialEnd: null });
    expect((await crmStore.list("companies", { tenantId: s.tenantId })).map((c) => c.id)).toEqual([s.companyId]);
    expect((await subsStore.list({ companyId: s.companyId })).map((x) => x.id)).toEqual([s.subId]);
    expect((await registry.listTenants()).length).toBe(tenantsBefore);
    // Licencias: de solo lectura (caducadas) a activas sin caducidad
    const granted = await caps.list(s.tenantId);
    expect(granted.map((g) => g.capabilityId).sort()).toEqual(capabilitiesOfTier("essential").sort());
    expect(granted.every((g) => g.status === "active" && g.validUntil === null)).toBe(true);
    expect((await access().check("crm-leads", { write: true, tenantId: s.tenantId })).allowed).toBe(true);
    expect((await trialStore.get(s.trialId))!).toMatchObject({ state: "converted", convertedSubscriptionId: s.subId });
    // La empresa deja de estar en «trial» en el registro: ya paga
    expect((await registry.getTenant(s.tenantId))!.status).toBe("active");
  });

  it("no se convierte dos veces: ni por operador ni con otro pedido", async () => {
    expect((await call("POST", `/trials/${s.trialId}/convert`, { body: { category: "exception", reason: "Conversión excepcional autorizada por dirección comercial" } })).status).toBe(409);
    expect((await call("POST", "/orders", { body: { idempotencyKey: key(), trialId: s.trialId, request: { plan: "essential", interval: "month", items: [] } } })).status).toBe(409);
    expect((await subsStore.list({ companyId: s.companyId })).length).toBe(1);
    expect((await registry.listTenants()).length).toBe(tenantsBefore);
  });

  it("conversión por excepción administrativa de una prueba vencida: con pedido y aprobación tipificada; mismos tenant, empresa y suscripción", async () => {
    const o = await startTrial("luis@casaluna.example", "Casa Luna Autonomía");
    const tenants = (await registry.listTenants()).length;
    const companies = (await crmStore.list("companies", {})).length;
    clock += 16 * DAY;
    await scheduler.tick();
    expect((await trialStore.get(o.trialId))!.state).toBe("expired");
    expect((await access().check("crm-leads", { write: true, tenantId: o.tenantId })).allowed).toBe(false);
    // Sin categoría ni motivo no hay excepción
    expect((await call("POST", `/trials/${o.trialId}/convert`, { body: {} })).status).toBe(400);
    const r = await ok(call("POST", `/trials/${o.trialId}/convert`, { body: { category: "exception", reason: "Conversión excepcional autorizada por dirección comercial" } }));
    expect(r).toMatchObject({
      order: { kind: "trial_conversion", state: "active", subscriptionId: o.subId, tenantId: o.tenantId, confirmation: { kind: "admin_approval", category: "exception" } },
      trial: { state: "converted", tenantId: o.tenantId },
    });
    expect((await registry.getTenant(o.tenantId))!.status).toBe("active");
    expect((await subsStore.get(o.subId))!.status).toBe("active");
    expect((await subsStore.list({ companyId: o.companyId })).length).toBe(1);
    expect((await crmStore.list("companies", {})).length).toBe(companies);
    expect((await registry.listTenants()).length).toBe(tenants);
    expect((await caps.list(o.tenantId)).every((g) => g.status === "active" && g.validUntil === null)).toBe(true);
    expect((await access().check("crm-leads", { write: true, tenantId: o.tenantId })).allowed).toBe(true);
    // Repetir la excepción es idempotente (el mismo pedido, nada nuevo) y no se abre otro pedido sobre la prueba convertida
    const again = await ok(call("POST", `/trials/${o.trialId}/convert`, { body: { category: "exception", reason: "Conversión excepcional autorizada por dirección comercial" } }));
    expect(again.order.id).toBe(r.order.id);
    expect((await subsStore.list({ companyId: o.companyId })).length).toBe(1);
    expect((await call("POST", "/orders", { body: { idempotencyKey: key(), trialId: o.trialId, request: { plan: "essential", interval: "month", items: [] } } })).status).toBe(409);
  });
});
