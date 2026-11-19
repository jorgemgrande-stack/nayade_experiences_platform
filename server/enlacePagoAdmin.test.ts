/**
 * Enlace de pago de unas condiciones YA ACEPTADAS (22/11/2026): acción administrativa que recupera el enlace personal de la
 * aceptación existente y lo envía al firmante, sin repetir la aceptación ni tocar las condiciones. Aplicación REAL del plano de
 * control por HTTP, correo de plataforma doble con idempotencia por clave y el doble de Stripe de siempre.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
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
import { TermsAcceptanceService } from "./commercialTerms/acceptance";
import { FailureAlerts, configureFailureAlerts } from "./_core/ops/failureAlerts";
import { STRIPE_FAILURE_RULES } from "./stripe/alerts";
import { agreementDeferral, startAgreementConclusion, type TrialConclusionHook } from "./commercialTerms/trialDefer";
import { MemoryTermsBillingStore } from "./commercialTerms/billingStore";
import { CUSTOM_PRICING_SCOPE } from "./commercialTerms/permission";
import { CUSTOM_SERVICE_PRODUCT_ID } from "./commercialTerms/stripeGateway";
import { MemoryExternalStore } from "./external/store";
import { MemoryOrderStore } from "./orchestrator/store";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent, type NegotiatedCheckoutInput } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemoryAcceptanceLinkStore } from "./commercialTerms/acceptanceLinks";

const TOK = { admin: "tsb-admin-token-aaaaaaaaaaaaaaaaaaaaaa", sales: "tsb-sales-token-bbbbbbbbbbbbbbbbbbbbbb", writer: "tsb-writer-token-cccccccccccccccccccc", service: "tsb-service-token-dddddddddddddddddd" };
const PUBLIC = "https://admin.example.test/cp/v1/public/contract-acceptance";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "d".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });
let clock = Date.UTC(2026, 10, 1, 10);

interface Env {
  server: http.Server;
  port: number;
  gw: FakeStripeGateway;
  stripeStore: MemoryStripeStore;
  billingStore: MemoryTermsBillingStore;
  P: Record<string, number>;
  companyId: number;
  /** Gancho que rellena la API real (mismo cableado que main.ts). */
  hook: TrialConclusionHook;
  subStore: MemorySubscriptionStore;
  termsStore: MemoryTermsStore;
  crmStore: MemoryCrmStore;
  links: MemoryAcceptanceLinkStore;
  /** Correos de pago enviados (cada clave de idempotencia cuenta una vez). */
  payMails: Array<{ to: string; key: string; data: any }>;
  /** Todo el texto que ha pasado por registros y eventos (para comprobar que el enlace nunca consta). */
  logs: string[];
}

async function build(enabled: boolean): Promise<Env> {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore });
  const company = await crm.createCompany({ name: "Hotel Ejemplo", legalName: "Hotel Ejemplo, S.L.", taxId: "B12345674", country: "ES", billingEmail: "facturas@hotel.example" }, "t");
  const webStore = new MemoryWebStore();
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  const gw = new FakeStripeGateway();
  const stripeStore = new MemoryStripeStore();
  const P: Record<string, number> = {};
  for (const key of ["essential", "business", "connect-whatsapp-ai", "connect-voice"]) {
    P[key] = (await webStore.listPrices((await webStore.getEntry("product", key))!.id)).find((p) => p.status === "approved" && p.kind === "monthly")!.id;
    gw.addProduct({ id: `prod_${key}`, name: key });
    await stripeStore.upsertPrice({ webPriceId: P[key], stripeProductId: `prod_${key}`, stripePriceId: `price_${key}`, lookupKey: `es:${key}:monthly:eur:v${P[key]}`, now: clock });
  }
  const admin = ROLE_SCOPES.admin.filter((s) => !s.startsWith("commerce:"));
  const billingStore = new MemoryTermsBillingStore();
  const hook: TrialConclusionHook = { concludeDue: null };
  const subStore = new MemorySubscriptionStore();
  const termsStore = new MemoryTermsStore();
  const links = new MemoryAcceptanceLinkStore();
  const payMails: Array<{ to: string; key: string; data: any }> = [];
  const seen = new Set<string>();
  const baseMailer = {
    policy: {},
    termsAcceptanceMail: () => ({
      invite: async (_to: string, key: string) => ({ status: "accepted", reason: null, duplicate: seen.has(key) && !!seen.add(key), id: 1 }),
      paymentLink: async (to: string, key: string, data: any) => {
        const duplicate = seen.has(key);
        seen.add(key);
        if (!duplicate) payMails.push({ to, key, data });
        return { status: "accepted", reason: null, duplicate, id: payMails.length };
      },
    }),
  };
  // El resto de métodos del correo de plataforma no intervienen: devuelven «sin servicio»
  const mailer = new Proxy(baseMailer as Record<string, unknown>, { get: (t, p) => (p in t ? t[p as string] : typeof p === "string" && p !== "then" ? () => undefined : undefined) });
  const app = createControlPlaneApp({
    trialConclusion: hook,
    termsAcceptance: { links: { store: links, keyring: ring } },
    mail: { platform: mailer },
    tokens: [
      { id: "ana", sha256: hashToken(TOK.admin), scopes: [...admin], actorType: "operator" },
      { id: "comercial", sha256: hashToken(TOK.sales), scopes: [...ROLE_SCOPES.sales], actorType: "operator" },
      { id: "operador", sha256: hashToken(TOK.writer), scopes: ["subscriptions:read", "subscriptions:write"], actorType: "operator" },
      { id: "integracion", sha256: hashToken(TOK.service), scopes: [...admin] },
    ],
    registry,
    reader: reg,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: subStore, now: () => clock, terms: termsStore, termsBilling: { enabled, store: billingStore } },
    external: { store: new MemoryExternalStore("test"), urls: { acceptance: PUBLIC, setupSuccess: `${PUBLIC}/autorizado`, setupCancel: `${PUBLIC}/cancelado`, portalReturn: `${PUBLIC}/portal` }, ipSalt: "sal-de-pruebas-para-seudonimizar-ips" },
    capabilities: new MemoryCapabilityStore(),
    orders: { store: new MemoryOrderStore(), payments: null },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: "https://web.example/estado", cancel: "https://web.example/cancelada", portalReturn: "https://app.elephant.test/admin" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: false,
      selfService: false,
      termsVersion: null,
    },
  } as never);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port, gw, stripeStore, billingStore, P, companyId: company.id, hook, subStore, termsStore, crmStore, links, payMails, logs: [] };
}

type Res = { status: number; json: any };
const call = (env: Env, method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? TOK.admin : o.token;
    const req = http.request(
      { host: "127.0.0.1", port: env.port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
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
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const webhook = (env: Env, ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call(env, "POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
async function deliver(env: Env) {
  for (const ev of env.gw.events.slice().reverse()) expect((await webhook(env, ev)).status).toBe(200);
  for (let i = 0; i < 300; i++) {
    const c = await env.stripeStore.eventCounts();
    if (c.received === 0 && c.processing === 0) return c;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("los eventos no terminaron de procesarse");
}

const DAY = 86_400_000;
/** Instante de fin de prueba con milisegundos (como el real de Quantum: …:53:25.769): no se redondea ni se adelanta. */
const START = Date.UTC(2026, 10, 1, 20, 53, 25, 769);

const page = (env: Env, method: "GET" | "POST", path: string, form?: Record<string, string>) =>
  new Promise<{ status: number; text: string; location: string | null; csp: string | null }>((resolve, reject) => {
    const data = form ? new URLSearchParams(form).toString() : undefined;
    const req = http.request(
      { host: "127.0.0.1", port: env.port, path: `/cp/v1/public/contract-acceptance/condiciones${path}`, method, headers: data ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(data) } : {} },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: b, location: (res.headers.location as string) ?? null, csp: (res.headers["content-security-policy"] as string) ?? null }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const setClock = (env: Env, ms: number) => {
  clock = ms;
  env.gw.now = Math.floor(ms / 1000);
};

/** Cliente en prueba (27 días) con la propuesta tipo Quantum: Business + WhatsApp AI + un conector, 52,00 € global, desde el fin de la prueba. */
async function quantum(env: Env, o: { effectiveAtTrialEnd?: boolean } = {}) {
  setClock(env, START);
  const s = await call(env, "POST", "/subscriptions", { body: { companyId: env.companyId, interval: "month", trialDays: 27, plan: { productKey: "essential", priceId: env.P.essential } } });
  expect(s.status).toBe(201);
  const id = s.json.subscription.id as number;
  const trialEnd = s.json.subscription.trialEnd as number;
  const draft = await call(env, "POST", `/subscriptions/${id}/terms`, {
    body: {
      pricingMode: "global",
      globalAmountCents: 5200,
      presentation: "breakdown",
      requiresAcceptance: true,
      interval: "month",
      ...(o.effectiveAtTrialEnd === false ? {} : { effectiveFrom: trialEnd }),
      reason: "Propuesta Quantum de prueba",
      lines: ["business", "connect-whatsapp-ai", "connect-voice"].map((k) => ({ kind: "catalog", productKey: k, priceId: env.P[k] })),
    },
  });
  expect(draft.status).toBe(201);
  return { id, trialEnd, termsId: draft.json.terms.id as number, revision: draft.json.terms.revision as number };
}
/** El administrador envía el enlace (sin correo: se recoge) y el cliente acepta en la página pública. */
async function accepted(env: Env, q: Awaited<ReturnType<typeof quantum>>) {
  const req = await call(env, "POST", `/commercial-terms/${q.termsId}/acceptance`, { body: { signer: { name: "Indira Prueba", email: "indira@cliente.example" }, expectedRevision: q.revision } });
  expect(req.status).toBe(201);
  const token = String(req.json.url).split("token=")[1];
  const acc = await page(env, "POST", "", { token, name: "Indira Prueba", accept: "1" });
  expect(acc.status).toBe(200);
  return { token, html: acc.text };
}
const stageOf = async (env: Env, id: number) => (await call(env, "GET", `/subscriptions/${id}/terms/billing/stripe`)).json.contracting;
const sessionOf = (location: string | null) => String(location).split("/").pop()!;

async function acceptedLinked(env: Env, q: Awaited<ReturnType<typeof quantum>>) {
  const req = await call(env, "POST", `/commercial-terms/${q.termsId}/acceptance`, { body: { signer: { name: "Indira Prueba", email: "indira@cliente.example" }, expectedRevision: q.revision } });
  expect(req.status).toBe(201);
  const l = await call(env, "GET", `/commercial-terms/${q.termsId}/acceptance/link`);
  const token = String(l.json.url).split("token=")[1];
  expect(token).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
  const acc = await page(env, "POST", "", { token, name: "Indira Prueba", accept: "1" });
  expect(acc.status).toBe(200);
  return { token, html: acc.text };
}
const payLink = (env: Env, id: number, token?: string | null) => call(env, "GET", `/commercial-terms/${id}/payment-link`, token === undefined ? {} : { token });
const paySend = (env: Env, id: number, token?: string | null) => call(env, "POST", `/commercial-terms/${id}/payment-link/send`, token === undefined ? { body: {} } : { token, body: {} });
const termsEvents = async (env: Env, id: number) => (await call(env, "GET", `/commercial-terms/${id}`)).json.events as Array<{ kind: string; reason: string | null; actor: string }>;

describe("enlace de pago de unas condiciones aceptadas (acción administrativa)", () => {
  let on: Env;
  let off: Env;
  beforeAll(async () => {
    on = await build(true);
    off = await build(false);
  });
  afterAll(async () => {
    for (const e of [on, off]) {
      e.server.closeAllConnections();
      await new Promise<void>((r) => e.server.close(() => r()));
    }
  });

  it("COBRO APAGADO: el operador ve el estado y la URL pero NO se envía nada, no se llama a Stripe ni se crea fila de cobro", async () => {
    const q = await quantum(off);
    const { token } = await acceptedLinked(off, q);
    const v = await payLink(off, q.termsId);
    expect(v.status).toBe(200);
    expect(v.json).toMatchObject({ state: "payment_not_enabled", paymentEnabled: false, paymentMethodAuthorized: false, signer: { name: "Indira Prueba", email: "indira@cliente.example" }, trialEnd: q.trialEnd });
    expect(v.json.url).toBe(`${PUBLIC}/condiciones/pago?token=${token}`);
    expect(v.json.blockers.join(" ")).toContain("apagado");
    const s = await paySend(off, q.termsId);
    expect(s.status).toBe(409);
    expect(s.json.error).toBe("payment_not_enabled");
    expect(off.payMails).toHaveLength(0);
    expect(off.gw.calls.length).toBe(0);
    expect(await off.billingStore.bySubscription(q.id)).toBeNull();
    expect(((await call(off, "GET", `/commercial-terms/${q.termsId}/acceptance`)).json.sends as Array<{ kind: string }>).filter((x) => x.kind === "payment_link")).toHaveLength(0);
  });

  it("COBRO ENCENDIDO: se envía UNA vez al firmante (no a otro), con la fecha exacta del fin de prueba; reintento rápido = 409; pasados 10 min se permite", async () => {
    const q = await quantum(on);
    const { token } = await acceptedLinked(on, q);
    const v = await payLink(on, q.termsId);
    expect(v.json).toMatchObject({ state: "ready", paymentEnabled: true, trialEnd: q.trialEnd, firstChargeAt: q.trialEnd, lastSentAt: null, recurring: { netCents: 5200, taxCents: 1092, totalCents: 6292, currency: "EUR" } });
    const spy = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m as "log"));
    const s = await paySend(on, q.termsId);
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ ok: true, duplicate: false, to: "i***@cliente.example" });
    expect(on.payMails).toHaveLength(1);
    expect(on.payMails[0].to).toBe("indira@cliente.example");
    const d = on.payMails[0].data;
    expect(d.url).toBe(`${PUBLIC}/condiciones/pago?token=${token}`);
    expect(d).toMatchObject({ netCents: 5200, taxCents: 1092, totalCents: 6292, period: "mensual", signerName: "Indira Prueba" });
    // Fin de prueba 28/11/2026 20:53:25.769 UTC = 21:53 en Madrid
    expect(d.trialEndText).toContain("21:53");
    expect(d.firstChargeText).toContain("21:53");
    // Reintento inmediato: no se envía otro
    const again = await paySend(on, q.termsId);
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("rate_limited");
    expect(on.payMails).toHaveLength(1);
    // Constancia: historial (destinatario enmascarado), registro de envío y última fecha; el enlace no consta en ninguna parte
    const ev = (await termsEvents(on, q.termsId)).filter((e) => e.kind === "payment_link_sent");
    expect(ev).toHaveLength(1);
    expect(ev[0].reason).toContain("i***@cliente.example");
    const status = (await call(on, "GET", `/commercial-terms/${q.termsId}/acceptance`)).json;
    expect(status.sends.filter((x: { kind: string }) => x.kind === "payment_link")).toHaveLength(1);
    expect((await payLink(on, q.termsId)).json.lastSentAt).toBe(clock);
    const detail = JSON.stringify((await call(on, "GET", `/commercial-terms/${q.termsId}`)).json);
    expect(detail).not.toContain(token);
    expect(JSON.stringify(status)).not.toContain(token);
    const logged = spy.flatMap((x) => x.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
    expect(logged).not.toContain(token);
    spy.forEach((x) => x.mockRestore());
    // No se llamó a Stripe por enviar el enlace
    expect(on.gw.calls.length).toBe(0);
    // Pasados 10 minutos se puede reenviar (otro mensaje)
    setClock(on, clock + 11 * 60_000);
    expect((await paySend(on, q.termsId)).status).toBe(200);
    expect(on.payMails).toHaveLength(2);
    expect(new Set(on.payMails.map((m) => m.key)).size).toBe(2);
  });

  it("dos envíos SIMULTÁNEOS no duplican el correo (misma clave de idempotencia)", async () => {
    const q = await quantum(on);
    await acceptedLinked(on, q);
    const before = on.payMails.length;
    const [a, b] = await Promise.all([paySend(on, q.termsId), paySend(on, q.termsId)]);
    expect([a.status, b.status].filter((x) => x === 200).length).toBeGreaterThanOrEqual(1);
    expect(on.payMails.length - before).toBe(1);
    expect((await termsEvents(on, q.termsId)).filter((e) => e.kind === "payment_link_sent")).toHaveLength(1);
  });

  it("sin aceptar NO hay enlace: ni vista ni envío; id ajeno = 404; sin permiso = 403/401", async () => {
    const q = await quantum(on);
    const req = await call(on, "POST", `/commercial-terms/${q.termsId}/acceptance`, { body: { signer: { name: "Indira Prueba", email: "indira@cliente.example" }, expectedRevision: q.revision } });
    expect(req.status).toBe(201);
    const v = await payLink(on, q.termsId);
    expect(v.json).toMatchObject({ state: "not_accepted", url: null, signer: null });
    const s = await paySend(on, q.termsId);
    expect(s.status).toBe(409);
    expect(s.json.error).toBe("not_accepted");
    expect((await payLink(on, 987654)).status).toBe(404);
    expect((await paySend(on, 987654)).status).toBe(404);
    // Un operador sin el permiso de precios personalizados no puede ni verlo ni enviarlo
    expect((await payLink(on, q.termsId, TOK.writer)).status).toBe(403);
    expect((await paySend(on, q.termsId, TOK.writer)).status).toBe(403);
    expect((await payLink(on, q.termsId, null)).status).toBe(401);
    // Un token de servicio tampoco (siempre una persona)
    expect((await payLink(on, q.termsId, TOK.service)).status).toBe(403);
  });

  it("YA AUTORIZADO: tras el pago verificado por webhook no se ofrece ni se envía el enlace", async () => {
    const q = await quantum(on);
    const { token } = await acceptedLinked(on, q);
    const start = await page(on, "POST", "/pago", { token });
    expect(start.status).toBe(303);
    on.gw.completeNegotiatedSession(sessionOf(start.location));
    expect((await deliver(on)).failed).toBe(0);
    const before = on.payMails.length;
    const v = await payLink(on, q.termsId);
    expect(v.json).toMatchObject({ state: "already_authorized", paymentMethodAuthorized: true, url: null });
    const s = await paySend(on, q.termsId);
    expect(s.status).toBe(409);
    expect(s.json.error).toBe("already_authorized");
    expect(on.payMails.length).toBe(before);
  });

  it("el enlace caduca 60 días después de la aceptación: no se envía", async () => {
    const q = await quantum(on);
    await acceptedLinked(on, q);
    setClock(on, clock + 61 * DAY);
    const v = await payLink(on, q.termsId);
    expect(v.json.state).toBe("expired");
    expect((await paySend(on, q.termsId)).json.error).toBe("expired");
  });

  it("la URL enviada es la página pública real (absoluta) y abre el estado de pago; el enlace de la página de confirmación también es absoluto (no relativo)", async () => {
    const q = await quantum(on);
    const { token, html } = await acceptedLinked(on, q);
    // Antes el enlace era relativo y, desde …/condiciones, apuntaba a …/pago (404)
    expect(html).toContain(`href="${PUBLIC}/condiciones/pago?token=${token}"`);
    const url = (await payLink(on, q.termsId)).json.url as string;
    const path = new URL(url).pathname.replace("/cp/v1/public/contract-acceptance/condiciones", "") + new URL(url).search;
    const view = await page(on, "GET", path);
    expect(view.status).toBe(200);
    expect(view.text).toContain("Configurar método de pago");
  });

  it("no repite la aceptación ni toca las condiciones: mismo contrato, misma aceptación, acuerdo intacto", async () => {
    const q = await quantum(on);
    await acceptedLinked(on, q);
    const snap = async () => {
      const d = (await call(on, "GET", `/commercial-terms/${q.termsId}`)).json.terms;
      const a = (await call(on, "GET", `/commercial-terms/${q.termsId}/acceptance`)).json;
      return JSON.stringify({ s: d.status, r: d.revision, e: d.effectiveFrom, g: d.globalAmountCents, c: d.contractId, acc: a.acceptances.map((x: any) => [x.id, x.status, x.documentSha256]) });
    };
    const before = await snap();
    await payLink(on, q.termsId);
    expect((await paySend(on, q.termsId)).status).toBe(200);
    expect(await snap()).toBe(before);
  });
});
