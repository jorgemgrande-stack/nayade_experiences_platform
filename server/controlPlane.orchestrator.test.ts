/**
 * Orquestador comercial de punta a punta por HTTP (plano de control), con el aprovisionamiento REAL en
 * memoria, el catálogo oficial, el motor de suscripciones, las licencias por capacidad, la prueba
 * gratuita y el proveedor de pagos de PRUEBAS (webhooks firmados; ningún cobro real). Datos sintéticos.
 *
 *  A. Prueba Essential → pedido Business anual (+ complemento mensual: periodicidades mixtas) → pago de
 *     prueba verificado → suscripción activa y licencias sin caducidad, misma plataforma (sin pérdida de
 *     datos). Eventos inválidos o duplicados no activan nada ni dos veces.
 *  B. Cliente nuevo desde una solicitud de la web → aprobación administrativa → alta de plataforma,
 *     suscripción y licencias; cambio de plan pagado; renovación sincronizada; cancelación en cascada.
 *  C. Impago de una renovación: gracia de 7 días → suspensión reversible → pago → reactivación.
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
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MemoryOrderStore } from "./orchestrator/store";
import { SignedTestProvider } from "./orchestrator/payments";
import type { TrialNotifier } from "./trials/onboarding";
import { MailService, mailRef } from "./mail/service";
import { MemoryMailStore } from "./mail/store";
import { memoryProvider } from "./mail/providers";
import { mailPolicyFromEnv } from "./mail/policy";
import { PlatformMailer } from "./mail/platform";

const DAY = 86_400_000;
const WEB = "https://web.example";
const SECRET = "secreto-de-formulario-de-prueba-0123456789abcdef";
const ADMIN = "orq-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
const SALES = "orq-sales-token-bbbbbbbbbbbbbbbbbbbbbb";
let clock = Date.UTC(2026, 9, 16, 9);
let server: http.Server;
let port = 0;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
const orders = new MemoryOrderStore();
const provider = new SignedTestProvider({ webhookSecret: "secreto-del-proveedor-de-pruebas-0123456789abcdef" });
let registry: MemoryTenantRegistryStore;
const outbox: Array<{ kind: string; data: Record<string, unknown> }> = [];
const notify: TrialNotifier = {
  verification: async (_to, l) => void outbox.push({ kind: "verification", data: l }),
  welcome: async (_to, i) => void outbox.push({ kind: "welcome", data: i }),
  expiryNotice: async (_to, i) => void outbox.push({ kind: "expiry", data: i }),
};

type Res = { status: number; json: any };
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
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : { origin: WEB }),
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
const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
  const r = await p;
  if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const key = () => crypto.randomBytes(12).toString("hex");
let evSeq = 0;
/** El proveedor de pruebas envía un evento firmado. */
const providerEvent = (payment: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, type: "payment.succeeded" | "payment.failed", over: Record<string, unknown> = {}) => {
  const body = JSON.stringify({ id: `evt_test_${++evSeq}`, type, paymentKey: payment.idempotencyKey, providerRef: payment.providerRef, amountCents: payment.amountCents, currency: payment.currency, livemode: false, ...over });
  return { body, sig: provider.sign(body, Math.floor(clock / 1000)) };
};
// Correo de plataforma en memoria (live autorizado: dominios .example sintéticos; nada sale a la red)
const MAIL_TOKEN = "token-de-webhook-ficticio-orquestador-0000000"; // gitleaks:allow
const mailStore = new MemoryMailStore();
const mailProvider = memoryProvider();
const mailPolicy = mailPolicyFromEnv({ MAIL_MODE: "live", MAIL_LIVE_AUTHORIZED: "1", MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv);
const platformMail = new PlatformMailer(new MailService({ lane: "platform", store: mailStore, provider: mailProvider, policy: mailPolicy, now: () => clock }), mailPolicy);
const webhook = (e: { body: string; sig: string }) => call("POST", "/payments/test/webhook", { token: null, raw: e.body, headers: { "x-test-signature": e.sig } });

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
    tokens: [
      { id: "admin", sha256: hashToken(ADMIN), scopes: [...all] },
      { id: "comercial", sha256: hashToken(SALES), scopes: ["crm:read", "crm:write", "orders:read", "orders:write"] },
    ],
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
    publicIntake: { origins: [WEB], secret: SECRET, now: () => clock, perIp: 100 },
    mail: { platform: platformMail, webhookToken: MAIL_TOKEN },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("A. prueba Essential → suscripción de pago con un pago de prueba verificado", () => {
  const s: { trialId?: number; tenantId?: string; companyId?: number; subId?: number; orderId?: number; contractId?: number; payment?: any; capEvents?: number } = {};
  const request = { plan: "business", interval: "year", items: [{ key: "restaurant-net-bookings" }] };
  const orderKey = key();

  it("la prueba de 15 días deja Essential con licencias que caducan al final", async () => {
    await ok(call("POST", "/public/trial", { token: null, body: { email: "marta@pinar.example", companyName: "Pinar Ensayo SL", idempotencyKey: key() } }), 202);
    const v = outbox.find((m) => m.kind === "verification")!;
    s.trialId = v.data.trialId as number;
    await ok(call("POST", "/public/trial/verify", { token: null, body: { id: s.trialId, token: v.data.token } }));
    s.tenantId = (await trialStore.get(s.trialId))!.tenantId!;
    s.companyId = (await crmStore.list("companies", { tenantId: s.tenantId }))[0].id;
    const sub = (await subsStore.list({ companyId: s.companyId }))[0];
    s.subId = sub.id;
    expect(sub.status).toBe("trialing");
    const granted = await caps.list(s.tenantId);
    expect(granted.map((g) => g.capabilityId).sort()).toEqual(capabilitiesOfTier("essential").sort());
    expect(granted.every((g) => g.validUntil === clock + 15 * DAY)).toBe(true);
  });

  it("la solicitud de contratación no activa nada: cotiza y prepara el contrato en borrador", async () => {
    clock += 5 * DAY;
    const r = await ok(call("POST", "/orders", { body: { idempotencyKey: orderKey, trialId: s.trialId, request } }), 201);
    expect(r.order).toMatchObject({ kind: "trial_conversion", state: "quoted", subscriptionId: s.subId, tenantId: s.tenantId });
    expect(r.waitingFor).toBe("acceptance");
    s.orderId = r.order.id;
    s.contractId = r.order.contractId;
    expect((await crmStore.get("contracts", s.contractId!))!.status).toBe("draft");
    expect(r.order.quote.capabilities.length).toBeGreaterThan(29);
    expect((await subsStore.get(s.subId!))!.status).toBe("trialing");
    expect((await caps.list(s.tenantId!)).every((g) => g.validUntil === Date.UTC(2026, 9, 16, 9) + 15 * DAY)).toBe(true);
  });

  it("idempotencia: misma clave → el mismo pedido; misma clave con otro contenido → 409; otra clave → 409 (ya hay uno abierto)", async () => {
    const again = await ok(call("POST", "/orders", { body: { idempotencyKey: orderKey, trialId: s.trialId, request } }), 200);
    expect(again.order.id).toBe(s.orderId);
    expect(again.created).toBe(false);
    expect((await call("POST", "/orders", { body: { idempotencyKey: orderKey, trialId: s.trialId, request: { ...request, interval: "month" } } })).status).toBe(409);
    expect((await call("POST", "/orders", { body: { idempotencyKey: key(), trialId: s.trialId, request } })).status).toBe(409);
    expect((await orders.list({})).length).toBe(1);
  });

  it("aceptación: firma con aprobación motivada de lo «bajo solicitud»; sigue sin activarse nada", async () => {
    const noReason = await call("POST", `/orders/${s.orderId}/accept`, { token: SALES, body: { signatureRef: "aceptacion-web-1" } });
    expect(noReason.status).toBe(409);
    expect(noReason.json.error).toMatch(/aprobación de activación/);
    const r = await ok(call("POST", `/orders/${s.orderId}/accept`, { token: SALES, body: { signatureRef: "aceptacion-web-1", approvalReason: "Revisado por producto" } }), 202);
    expect(r.order.state).toBe("contracted");
    expect(r.waitingFor).toBe("confirmation");
    expect((await crmStore.get("contracts", s.contractId!))!.status).toBe("signed");
    expect((await subsStore.get(s.subId!))!.status).toBe("trialing");
  });

  it("sin permiso de aprobación no se aprueba; sin pago verificado no se avanza", async () => {
    expect((await call("POST", `/orders/${s.orderId}/approve`, { token: SALES, body: { reason: "Quiero saltarme el pago" } })).status).toBe(403);
    const adv = await ok(call("POST", `/orders/${s.orderId}/advance`), 202);
    expect(adv.order.state).toBe("contracted");
  });

  it("pago de prueba: checkout idempotente por el primer periodo (plan anual + primer mes del complemento)", async () => {
    const p = await ok(call("POST", `/orders/${s.orderId}/payments`, { token: SALES }), 201);
    s.payment = p.payment;
    expect(p.payment).toMatchObject({ status: "pending", mode: "test", provider: "simulated", purpose: "initial" });
    const order = (await ok(call("GET", `/orders/${s.orderId}`))).order;
    expect(p.payment.amountCents).toBe(order.quote.firstPeriodCents);
    const again = await ok(call("POST", `/orders/${s.orderId}/payments`, { token: SALES }), 200);
    expect(again.payment.id).toBe(p.payment.id);
    expect(provider.simulator.executed).toEqual([]); // nada «cobrado»: queda pendiente del evento firmado
    expect((await ok(call("GET", "/orders/payments/config"))).autoCharge).toBe(false);
  });

  it("eventos inválidos no activan nada: firma falsa, evento real (livemode), importe distinto, pago desconocido", async () => {
    const good = providerEvent(s.payment, "payment.succeeded");
    expect((await webhook({ body: good.body, sig: good.sig.replace(/v1=[0-9a-f]+/, `v1=${"f".repeat(64)}`) })).status).toBe(400);
    expect((await webhook({ body: good.body, sig: provider.sign(good.body, Math.floor(clock / 1000) - 3600) })).status).toBe(400);
    expect((await webhook(providerEvent(s.payment, "payment.succeeded", { livemode: true }))).status).toBe(400);
    expect((await ok(webhook(providerEvent(s.payment, "payment.succeeded", { amountCents: 1 })))).outcome).toBe("rejected");
    expect((await ok(webhook(providerEvent({ ...s.payment, idempotencyKey: "ord:999:initial:a1" }, "payment.succeeded")))).outcome).toBe("rejected");
    const d = await ok(call("GET", `/orders/${s.orderId}`));
    expect(d.order.state).toBe("contracted");
    expect(d.payments[0].status).toBe("pending");
    expect((await subsStore.get(s.subId!))!.status).toBe("trialing");
  });

  it("evento firmado válido: suscripción activa (anual, contrato enlazado), Business sin caducidad, prueba convertida, misma plataforma", async () => {
    s.capEvents = (await caps.events(s.tenantId!)).length;
    const r = await ok(webhook(providerEvent(s.payment, "payment.succeeded")));
    expect(r).toEqual({ status: "processed", outcome: "applied" });
    const d = await ok(call("GET", `/orders/${s.orderId}`));
    expect(d.order.state).toBe("active");
    expect(d.order.confirmation).toMatchObject({ kind: "payment", ref: String(s.payment.id) });
    const sub = (await subsStore.get(s.subId!))!;
    expect(sub).toMatchObject({ id: s.subId, status: "active", interval: "year", contractId: s.contractId, tenantId: s.tenantId, trialEnd: null });
    // Periodicidades mixtas: plan anual + complemento mensual
    const items = (await subsStore.items(s.subId!)).filter((i) => i.effectiveTo === null);
    expect(items.map((i) => `${i.productKey}:${i.priceKind}`).sort()).toEqual(["business:yearly", "restaurant-net-bookings:monthly"]);
    const granted = await caps.list(s.tenantId!);
    expect(granted.filter((g) => g.status === "active").map((g) => g.capabilityId)).toEqual(expect.arrayContaining([...capabilitiesOfTier("business"), "restaurant-net"]));
    expect(granted.every((g) => g.status === "active" && g.validUntil === null)).toBe(true);
    expect((await trialStore.get(s.trialId!))!.state).toBe("converted");
    expect((await crmStore.get("contracts", s.contractId!))!.status).toBe("active");
    // Sin pérdida de datos: misma plataforma, misma empresa, misma suscripción y ninguna licencia borrada
    expect((await registry.getTenant(s.tenantId!))!.id).toBe(s.tenantId);
    expect((await crmStore.list("companies", { tenantId: s.tenantId! })).map((c) => c.id)).toEqual([s.companyId]);
    expect((await subsStore.list({ companyId: s.companyId! })).length).toBe(1);
    expect(granted.length).toBeGreaterThanOrEqual(capabilitiesOfTier("essential").length);
    expect(d.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["created", "quote", "contract_drafted", "sign", "payment_requested", "confirm", "subscribe", "license", "activate"]));
  });

  it("el mismo evento otra vez (o uno nuevo del mismo pago) no activa nada dos veces", async () => {
    const before = (await caps.events(s.tenantId!)).length;
    const subVersion = (await subsStore.get(s.subId!))!.version;
    const dup = providerEvent(s.payment, "payment.succeeded");
    expect(await ok(webhook(dup))).toEqual({ status: "processed", outcome: "ignored" });
    expect(await ok(webhook(dup))).toEqual({ status: "duplicate", outcome: null });
    expect(await ok(webhook(providerEvent(s.payment, "payment.failed")))).toEqual({ status: "processed", outcome: "ignored" });
    expect((await caps.events(s.tenantId!)).length).toBe(before);
    expect((await subsStore.get(s.subId!))!.version).toBe(subVersion);
    expect((await ok(call("GET", `/orders/${s.orderId}`))).order.state).toBe("active");
    expect(before).toBeGreaterThan(s.capEvents!);
  });

  describe("C. impago de la renovación: gracia → suspensión (datos intactos) → pago → reactivación", () => {
    let renewal: any;
    it("renovación anual: recibo de prueba pendiente (nunca se cobra solo) y licencias vigentes", async () => {
      clock = (await subsStore.get(s.subId!))!.currentPeriodEnd + 1000;
      const r = await ok(call("POST", `/orders/${s.orderId}/renew`));
      renewal = r.payment;
      expect(renewal).toMatchObject({ purpose: "renewal", status: "pending", mode: "test" });
      expect(renewal.amountCents).toBeGreaterThan(0);
      expect(provider.simulator.executed).toEqual([]);
      expect((await caps.list(s.tenantId!)).every((g) => g.status === "active")).toBe(true);
    });
    it("pago fallido: 7 días de gracia con las licencias activas", async () => {
      await ok(webhook(providerEvent(renewal, "payment.failed")));
      const o = (await ok(call("GET", `/orders/${s.orderId}`))).order;
      expect(o.state).toBe("past_due");
      expect(o.graceEndsAt).toBe(clock + 7 * DAY);
      clock += 3 * DAY;
      expect((await ok(call("POST", "/orders/review"))).suspended).toBe(0);
      expect((await caps.list(s.tenantId!)).every((g) => g.status === "active")).toBe(true);
    });
    it("fin de la gracia: suspensión de las licencias; la plataforma y su historial se conservan", async () => {
      clock += 5 * DAY;
      expect((await ok(call("POST", "/orders/review"))).suspended).toBe(1);
      expect((await ok(call("GET", `/orders/${s.orderId}`))).order.state).toBe("suspended");
      const g = await caps.list(s.tenantId!);
      expect(g.length).toBeGreaterThan(0);
      expect(g.every((x) => x.status === "suspended")).toBe(true);
      expect(await registry.getTenant(s.tenantId!)).toBeTruthy();
    });
    it("el pago llega: pedido al corriente y licencias reactivadas", async () => {
      await ok(webhook(providerEvent(renewal, "payment.succeeded")));
      expect((await ok(call("GET", `/orders/${s.orderId}`))).order.state).toBe("active");
      expect((await caps.list(s.tenantId!)).every((g) => g.status === "active")).toBe(true);
    });
  });
});

describe("B. cliente nuevo desde la web: aprobación administrativa, cambio de plan, renovación y cancelación", () => {
  const s: { leadRequestId?: number; companyId?: number; orderId?: number; contractId?: number; tenantId?: string; subId?: number; changeId?: number; renewalContractId?: number } = {};

  it("la configuración del formulario web pasa al pedido (y de ahí al contrato) sin crear nada", async () => {
    const ticket = (await ok(call("GET", "/public/form-ticket", { token: null }))).ticket as string;
    clock += 5000;
    await ok(
      call("POST", "/public/requests", {
        token: null,
        headers: { "idempotency-key": crypto.randomUUID() },
        body: {
          type: "configuration",
          name: "Iker Ensayo",
          email: "iker@robledal.example",
          company: "Robledal Ejemplo SL",
          configuration: { plan: "essential", extensions: [], industries: ["restaurant-net-bookings"], interests: ["ski-net-school"] },
          sourcePage: "/construye",
          consents: { privacy: true, marketing: false },
          privacyVersion: "2026-10-borrador",
          ticket,
          website: "",
        },
      }),
      [200, 201, 202],
    );
    const req = (await ok(call("GET", "/crm/requests"))).requests.map((x: any) => x.request).find((x: any) => x.configuration?.industries?.includes("restaurant-net-bookings"));
    s.leadRequestId = req.id;
    // Sin convertir el lead no hay empresa: no se puede contratar
    expect((await call("POST", "/orders", { body: { idempotencyKey: key(), leadRequestId: s.leadRequestId } })).status).toBe(409);
    const conv = await ok(call("POST", `/crm/leads/${req.leadId}/convert`, { body: { companyName: "Robledal Ejemplo SL", opportunity: { title: "Essential + reservas", planId: "essential" } } }));
    s.companyId = conv.company.id;
    const r = await ok(call("POST", "/orders", { token: SALES, headers: { "idempotency-key": key() }, body: { leadRequestId: s.leadRequestId } }), 201);
    expect(r.order.request).toEqual({ plan: "essential", interval: "month", items: [{ key: "restaurant-net-bookings" }] });
    s.orderId = r.order.id;
    s.contractId = r.order.contractId;
    const contract = (await crmStore.get("contracts", s.contractId!))!;
    expect(contract.configuration?.request.items).toEqual([{ key: "restaurant-net-bookings" }]);
    expect(contract.opportunityId).toBe(conv.opportunity.id);
    expect((await registry.listTenants()).some((t) => t.displayName === "Robledal Ejemplo SL")).toBe(false);
    expect(await subsStore.list({ companyId: s.companyId })).toEqual([]);
  });

  it("aprobación administrativa registrada (sin pago): plataforma, suscripción, licencias y contrato activo", async () => {
    await ok(call("POST", `/orders/${s.orderId}/accept`, { token: SALES, body: { signatureRef: "firma-robledal-1", approvalReason: "Reservas revisadas por producto" } }), 202);
    expect((await call("POST", `/orders/${s.orderId}/approve`, { body: { reason: "ok" } })).status).toBe(400);
    const r = await ok(call("POST", `/orders/${s.orderId}/approve`, { body: { reason: "Cliente piloto con factura manual" } }));
    expect(r.order.state).toBe("active");
    expect(r.order.confirmation).toMatchObject({ kind: "admin_approval", reason: "Cliente piloto con factura manual" });
    s.tenantId = r.order.tenantId;
    s.subId = r.order.subscriptionId;
    expect(await registry.getTenant(s.tenantId!)).toBeTruthy();
    expect((await crmStore.get("contracts", s.contractId!))!).toMatchObject({ status: "active", tenantId: s.tenantId });
    expect((await subsStore.get(s.subId!))!).toMatchObject({ status: "active", contractId: s.contractId, interval: "month" });
    const g = await caps.list(s.tenantId!);
    expect(g.find((x) => x.capabilityId === "restaurant-net")?.status).toBe("active");
    expect(g.every((x) => x.status === "active" && x.validUntil === null)).toBe(true);
    // Repetir el avance no cambia nada
    const before = (await caps.events(s.tenantId!)).length;
    expect((await ok(call("POST", `/orders/${s.orderId}/advance`))).order.state).toBe("active");
    expect((await caps.events(s.tenantId!)).length).toBe(before);
  });

  it("cambio Essential → Business: renovación del contrato, pago de la diferencia, suscripción y licencias; el pedido anterior queda sustituido", async () => {
    const r = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), changeOf: s.orderId, request: { plan: "business", interval: "month", items: [{ key: "restaurant-net-bookings" }] } } }), 201);
    s.changeId = r.order.id;
    s.renewalContractId = r.order.contractId;
    expect((await crmStore.get("contracts", s.renewalContractId!))!).toMatchObject({ previousContractId: s.contractId, planId: "business", status: "draft" });
    expect((await call("POST", "/orders", { body: { idempotencyKey: key(), changeOf: s.orderId, request: { plan: "business", interval: "month", items: [] } } })).status).toBe(409);
    await ok(call("POST", `/orders/${s.changeId}/accept`, { body: { signatureRef: "firma-ampliacion", approvalReason: "Ampliación aprobada" } }), 202);
    const p = (await ok(call("POST", `/orders/${s.changeId}/payments`), 201)).payment;
    const order = (await ok(call("GET", `/orders/${s.changeId}`))).order;
    const prev = (await ok(call("GET", `/orders/${s.orderId}`))).order;
    expect(p.amountCents).toBe(order.quote.firstPeriodCents - prev.quote.firstPeriodCents);
    await ok(webhook(providerEvent(p, "payment.succeeded")));
    const done = await ok(call("GET", `/orders/${s.changeId}`));
    expect(done.order.state).toBe("active");
    expect((await ok(call("GET", `/orders/${s.orderId}`))).order.state).toBe("superseded");
    expect((await crmStore.get("contracts", s.contractId!))!.status).toBe("cancelled");
    expect((await crmStore.get("contracts", s.renewalContractId!))!.status).toBe("active");
    const sub = (await subsStore.get(s.subId!))!;
    expect(sub).toMatchObject({ status: "active", contractId: s.renewalContractId, cancelAt: null });
    expect((await subsStore.items(s.subId!)).filter((i) => i.effectiveTo === null).map((i) => i.productKey).sort()).toEqual(["business", "restaurant-net-bookings"]);
    expect((await caps.list(s.tenantId!)).filter((g) => g.status === "active").map((g) => g.capabilityId)).toEqual(expect.arrayContaining(capabilitiesOfTier("business")));
  });

  it("renovación sincronizada: suscripción y licencias avanzan y el contrato lo registra; sin pago en línea previo no se emite recibo", async () => {
    clock = (await subsStore.get(s.subId!))!.currentPeriodEnd + 1000;
    const before = (await subsStore.get(s.subId!))!.currentPeriodEnd;
    const r = await ok(call("POST", `/orders/${s.changeId}/renew`));
    expect(r.subscription.currentPeriodEnd).toBeGreaterThan(before);
    expect(r.payment).not.toBeNull(); // el cambio se pagó en línea: recibo de PRUEBA del periodo nuevo
    await ok(webhook(providerEvent(r.payment, "payment.succeeded")));
    const timeline = JSON.stringify((await ok(call("GET", `/crm/contracts/${s.renewalContractId}`))).timeline);
    expect(timeline).toMatch(/Periodo renovado/);
    expect((await caps.list(s.tenantId!)).every((g) => g.status === "active" || g.status === "cancelled")).toBe(true);
  });

  it("cancelación en cascada: contrato cancelado → suscripción a fin de periodo → 30 días en solo lectura; nada se borra", async () => {
    expect((await call("POST", `/orders/${s.changeId}/cancel`, { token: SALES, body: { reason: "Cierre" } })).status).toBe(403);
    const r = await ok(call("POST", `/orders/${s.changeId}/cancel`, { body: { reason: "Cierre de temporada" } }));
    expect(r.order.state).toBe("cancel_scheduled");
    expect((await crmStore.get("contracts", s.renewalContractId!))!.status).toBe("cancelled");
    const sub = (await subsStore.get(s.subId!))!;
    expect(sub.cancelAt).toBe(sub.currentPeriodEnd);
    expect((await caps.list(s.tenantId!)).some((g) => g.status === "active")).toBe(true); // el periodo pagado sigue
    clock = sub.cancelAt! + DAY;
    const rev = await ok(call("POST", "/orders/review"));
    expect(rev.cancelled).toBe(1);
    expect((await ok(call("GET", `/orders/${s.changeId}`))).order.state).toBe("cancelled");
    const ended = (await subsStore.get(s.subId!))!;
    expect(ended.status).toBe("canceled");
    // Regla de la fase 2: 30 días en solo lectura (consulta y exportación) tras el fin del periodo pagado
    const g = await caps.list(s.tenantId!);
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((x) => x.status === "read_only" && x.validUntil === ended.canceledAt! + 30 * DAY)).toBe(true);
    expect(await registry.getTenant(s.tenantId!)).toBeTruthy();
    expect(await crmStore.get("companies", s.companyId!)).toBeTruthy();
  });

  it("un contrato cancelado directamente en el CRM también cancela la suscripción (revisión)", async () => {
    // Pedido nuevo para la misma empresa tras la cancelación
    const r = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: s.companyId, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    await ok(call("POST", `/orders/${r.order.id}/accept`, { body: { signatureRef: "firma-vuelta", approvalReason: "Vuelve tras el cierre" } }), 202);
    const a = await ok(call("POST", `/orders/${r.order.id}/approve`, { body: { reason: "Vuelve a contratar" } }));
    expect(a.order.state).toBe("active");
    expect(a.order.tenantId).toBe(s.tenantId); // misma plataforma: los datos siguen ahí
    await ok(call("POST", `/crm/contracts/${a.order.contractId}/status`, { body: { status: "cancelled" } }));
    const rev = await ok(call("POST", "/orders/review"));
    expect(rev.cascaded).toBe(1);
    expect((await ok(call("GET", `/orders/${r.order.id}`))).order.state).toBe("cancel_scheduled");
    expect((await subsStore.get(a.order.subscriptionId))!.cancelAt).not.toBeNull();
  });
});

describe("D. avisos por correo de los eventos del pedido (bandeja de plataforma)", () => {
  it("pago de prueba, alta de la plataforma, contratación y cancelación generan su aviso, una vez y al contacto de la empresa", async () => {
    await new Promise((r) => setTimeout(r, 20)); // los avisos se encolan sin esperar a la transición
    const tags = mailProvider.sent.map((m) => m.tag);
    for (const t of ["test_payment_confirmed", "contract_confirmed", "tenant_welcome", "cancellation"]) expect(tags).toContain(t);
    expect(new Set(mailStore.rows.map((r) => `${r.tenantId}:${r.idempotencyKey}`)).size).toBe(mailStore.rows.length);
    expect(mailProvider.sent.every((m) => m.from.email === "no-reply@envios.example" && m.from.name === "Big Elephant")).toBe(true);
    expect(mailProvider.sent.find((m) => m.tag === "test_payment_confirmed")!.text).toMatch(/ningún cargo real/);
    expect(JSON.stringify(mailProvider.sent)).not.toMatch(/n[aá]yade/i);
  });

  it("webhook de Brevo montado en el plano de control: sin la cabecera no cambia nada; con ella, aplica el evento", async () => {
    const row = mailStore.rows.find((r) => r.status === "accepted")!;
    const ev = { event: "delivered", "message-id": row.providerMessageId, ts_epoch: 1, "X-Mailin-custom": mailRef("platform", row.tenantId, row.id) };
    expect((await call("POST", "/mail/brevo/webhook", { token: null, body: ev })).status).toBe(401);
    expect(mailStore.rows.find((r) => r.id === row.id)!.status).toBe("accepted");
    const r = await call("POST", "/mail/brevo/webhook", { token: null, body: ev, headers: { "x-elephant-webhook-token": MAIL_TOKEN } });
    expect(r).toMatchObject({ status: 200, json: { applied: 1 } });
    expect(mailStore.rows.find((x) => x.id === row.id)!.status).toBe("delivered");
  });
});
