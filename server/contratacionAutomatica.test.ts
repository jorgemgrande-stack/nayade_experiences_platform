/**
 * Contratación automática de punta a punta (21/11/2026): aceptar el contrato durante la prueba SIN adelantarla, configurar el
 * método de pago en Stripe desde la página pública (ligada al enlace personal), prueba → pago al instante efectivo pactado y
 * etapas visibles. Aplicación REAL del plano de control por HTTP; Stripe es el doble de siempre con la firma real del webhook.
 * La verificación contra Stripe TEST real está en scripts/stripe/contratacionSandboxE2E.ts (manual, con clave de pruebas).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { MemoryTermsBillingStore } from "./commercialTerms/billingStore";
import { CUSTOM_PRICING_SCOPE } from "./commercialTerms/permission";
import { CUSTOM_SERVICE_PRODUCT_ID } from "./commercialTerms/stripeGateway";
import { MemoryExternalStore } from "./external/store";
import { MemoryOrderStore } from "./orchestrator/store";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent, type NegotiatedCheckoutInput } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";

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
  const app = createControlPlaneApp({
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
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock, terms: new MemoryTermsStore(), termsBilling: { enabled, store: billingStore } },
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
  return { server, port: (server.address() as AddressInfo).port, gw, stripeStore, billingStore, P, companyId: company.id };
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

describe("contratación automática: aceptar → pagar → activar en la fecha pactada", () => {
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

  it("aceptar durante la prueba NO la termina ni adelanta nada: el acuerdo queda programado al instante exacto de fin de prueba", async () => {
    const q = await quantum(on);
    expect(q.trialEnd).toBe(START + 27 * DAY);
    await accepted(on, q);
    const sub = (await call(on, "GET", `/subscriptions/${q.id}`)).json;
    expect(sub.subscription).toMatchObject({ status: "trialing", trialEnd: q.trialEnd });
    const detail = (await call(on, "GET", `/commercial-terms/${q.termsId}`)).json;
    expect(detail.terms).toMatchObject({ status: "scheduled", acceptanceStatus: "accepted", effectiveFrom: q.trialEnd });
    // Las partidas del acuerdo entran en el instante exacto del fin de la prueba, no antes
    expect(sub.items.filter((i: any) => i.termsId === q.termsId).map((i: any) => i.effectiveFrom)).toEqual([q.trialEnd, q.trialEnd, q.trialEnd]);
    // Quedan registrados firmante, huella y aceptación (trazabilidad)
    expect(detail.events.map((e: any) => e.kind)).toContain("accepted");
    const acc = (await call(on, "GET", `/commercial-terms/${q.termsId}/acceptance`)).json;
    expect(acc.acceptances[0]).toMatchObject({ status: "accepted", acceptedName: "Indira Prueba" });
    expect(acc.acceptances[0].documentSha256).toMatch(/^[0-9a-f]{64}$/);
    // Un contrato firmado sin método de pago NO es cobrable
    expect(await stageOf(on, q.id)).toMatchObject({ stage: "payment_pending", paymentMethodAuthorized: false, chargeable: false, activationAt: q.trialEnd, recurring: { netCents: 5200, taxCents: 1092, totalCents: 6292 } });
  });

  it("regla A: unas condiciones sin fecha (inmediatas) sobre una prueba siguen terminándola al aceptar", async () => {
    const q = await quantum(on, { effectiveAtTrialEnd: false });
    await accepted(on, q);
    expect((await call(on, "GET", `/subscriptions/${q.id}`)).json.subscription.status).toBe("active");
  });

  it("la página de pago: formulario solo con el enlace; importe y fecha salen del contrato (nada de importes del navegador)", async () => {
    const q = await quantum(on);
    const { token, html } = await accepted(on, q);
    expect(html).toContain("configurar el método de pago");
    const view = await page(on, "GET", `/pago?token=${token}`);
    expect(view.status).toBe(200);
    expect(view.text).toContain("Configurar método de pago");
    expect(view.text).toContain("52,00");
    expect(view.csp).toContain("form-action 'self' https://checkout.stripe.com");
    expect(view.text).not.toMatch(/name="(amount|price|total)/i);
    // Un enlace no válido no abre nada
    expect((await page(on, "GET", `/pago?token=${"x".repeat(43)}`)).status).toBe(404);
    expect((await page(on, "POST", "/pago", { token: "corto" })).status).toBe(404);
  });

  it("un enlace sin aceptar no sirve para pagar", async () => {
    const q = await quantum(on);
    const req = await call(on, "POST", `/commercial-terms/${q.termsId}/acceptance`, { body: { signer: { name: "Indira Prueba", email: "indira@cliente.example" }, expectedRevision: q.revision } });
    const token = String(req.json.url).split("token=")[1];
    const r = await page(on, "POST", "/pago", { token });
    expect(r.status).toBe(409);
    expect(r.text).toContain("todavía no están aceptadas");
  });

  it("recorrido completo: pago en Stripe con primer cargo aplazado al fin de la prueba, importe exacto, sin duplicados, y prueba → pago en ese instante", async () => {
    const q = await quantum(on);
    const { token } = await accepted(on, q);
    const before = on.gw.calls.filter((c) => c.op === "checkout.sessions.create(negotiated)").length;
    const start1 = await page(on, "POST", "/pago", { token, amount: "1", price: "1", total: "1", subscription: "999" });
    expect(start1.status).toBe(303);
    expect(start1.location).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_/);
    const start2 = await page(on, "POST", "/pago", { token });
    expect(start2.location).toBe(start1.location);
    const creates = on.gw.calls.filter((c) => c.op === "checkout.sessions.create(negotiated)");
    expect(creates.length - before).toBe(1);
    const input = creates[creates.length - 1].input as NegotiatedCheckoutInput;
    // El importe es el del contrato aceptado (52,00 € netos), no el que mande el navegador; primer cargo: fin de prueba (redondeo hacia arriba)
    expect(input.lines.reduce((a, l) => a + l.unitAmount, 0)).toBe(5200);
    expect(input.trialEnd).toBe(Math.ceil(q.trialEnd / 1000));
    expect(input.trialEnd! * 1000).toBeGreaterThanOrEqual(q.trialEnd);
    expect(input.trialEnd! * 1000 - q.trialEnd).toBeLessThan(1000);
    expect(input.metadata.es_terms_subscription).toBe(String(q.id));
    expect(await stageOf(on, q.id)).toMatchObject({ stage: "payment_pending", paymentMethodAuthorized: false });

    // Volver a una URL de éxito NO confirma nada: sin webhook verificado sigue pendiente
    const back = await page(on, "GET", `/pago?token=${token}`);
    expect(back.text).not.toContain("Método de pago confirmado");

    // El cliente paga y llega el webhook firmado de siempre
    const stripeId = on.gw.completeNegotiatedSession(sessionOf(start1.location));
    expect((await deliver(on)).failed).toBe(0);
    expect(on.gw.subscriptions.get(stripeId)).toMatchObject({ status: "trialing" });
    expect(await stageOf(on, q.id)).toMatchObject({ stage: "activation_scheduled", paymentMethodAuthorized: true, chargeable: true, activationAt: q.trialEnd, nextChargeAt: q.trialEnd, billingStatus: "active", stripeStatus: "trialing" });
    const confirmed = await page(on, "GET", `/pago?token=${token}`);
    expect(confirmed.text).toContain("Método de pago confirmado por Stripe");
    expect(confirmed.text).toContain("Primer cobro previsto");
    // Repetir el paso no crea otra sesión ni otra suscripción de Stripe
    const again = await page(on, "POST", "/pago", { token });
    expect(again.status).toBe(200);
    expect(Array.from(on.gw.subscriptions.values()).filter((s) => s.metadata.es_terms_subscription === String(q.id))).toHaveLength(1);

    // La prueba y las licencias siguen hasta el instante pactado
    expect((await call(on, "GET", `/subscriptions/${q.id}`)).json.subscription).toMatchObject({ status: "trialing", trialEnd: q.trialEnd });
    setClock(on, q.trialEnd - 1000);
    await call(on, "POST", `/subscriptions/${q.id}/shadow`);
    expect((await call(on, "GET", `/subscriptions/${q.id}`)).json.subscription.status).toBe("trialing");

    // Llega el instante pactado: la prueba termina y el primer periodo de pago empieza EXACTAMENTE ahí
    setClock(on, q.trialEnd + 5 * 60_000);
    const shadow = await call(on, "POST", `/subscriptions/${q.id}/shadow`);
    expect(shadow.status).toBe(200);
    const after = (await call(on, "GET", `/subscriptions/${q.id}`)).json;
    expect(after.subscription).toMatchObject({ status: "active", trialEnd: null, currentPeriodStart: q.trialEnd });
    expect(after.items.filter((i: any) => i.effectiveTo === null && i.termsId === q.termsId)).toHaveLength(3);
    // Idempotente: repetirlo no cambia nada
    await call(on, "POST", `/subscriptions/${q.id}/shadow`);
    expect((await call(on, "GET", `/subscriptions/${q.id}`)).json.subscription).toMatchObject({ status: "active", currentPeriodStart: q.trialEnd });
  });

  it("el primer cobro real de Stripe también concluye la prueba (webhook): factura de 52,00 €, sin duplicados", async () => {
    const q = await quantum(on);
    const { token } = await accepted(on, q);
    const start = await page(on, "POST", "/pago", { token });
    const stripeId = on.gw.completeNegotiatedSession(sessionOf(start.location));
    await deliver(on);
    setClock(on, q.trialEnd + 60_000);
    // Stripe sale de la prueba y cobra el primer periodo
    on.gw.updateSubscription(stripeId, { status: "active", currentPeriodStart: Math.floor(q.trialEnd / 1000), currentPeriodEnd: Math.floor((q.trialEnd + 30 * DAY) / 1000) });
    on.gw.chargeNegotiatedPeriod(stripeId, "paid");
    expect((await deliver(on)).failed).toBe(0);
    expect((await call(on, "GET", `/subscriptions/${q.id}`)).json.subscription.status).toBe("active");
    const view = (await call(on, "GET", `/subscriptions/${q.id}/terms/billing/stripe`)).json;
    expect(view.contracting.stage).toBe("active");
    const paid = view.invoices.filter((i: any) => i.status === "paid" && i.subtotalCents > 0);
    expect(paid.length).toBeGreaterThanOrEqual(1);
    expect(paid[0].subtotalCents).toBe(5200);
    // Reentrega de los mismos eventos: no duplica facturas ni suscripciones
    const n = view.invoices.length;
    await deliver(on);
    expect((await call(on, "GET", `/subscriptions/${q.id}/terms/billing/stripe`)).json.invoices).toHaveLength(n);
    expect(Array.from(on.gw.subscriptions.values()).filter((s) => s.metadata.es_terms_subscription === String(q.id))).toHaveLength(1);
  });

  it("abandono, sesión caducada y reanudación: el contrato sigue aceptado, no hay suscripciones ni cargos duplicados", async () => {
    const q = await quantum(on);
    const { token } = await accepted(on, q);
    const subsBefore = on.gw.subscriptions.size;
    const first = await page(on, "POST", "/pago", { token });
    const sid = sessionOf(first.location);
    // El cliente cierra Stripe sin pagar: sigue pendiente de pago, contrato aceptado
    expect(await stageOf(on, q.id)).toMatchObject({ stage: "payment_pending", paymentMethodAuthorized: false });
    expect((await call(on, "GET", `/commercial-terms/${q.termsId}`)).json.terms.acceptanceStatus).toBe("accepted");
    // La sesión caduca en Stripe
    await on.gw.expireCheckoutSession(sid);
    const resumed = await page(on, "POST", "/pago", { token });
    expect(resumed.status).toBe(303);
    expect(sessionOf(resumed.location)).not.toBe(sid);
    expect(on.gw.subscriptions.size).toBe(subsBefore);
    const open = Array.from(on.gw.sessions.values()).filter((s) => s.status === "open" && s.metadata.es_terms_subscription === String(q.id));
    expect(open).toHaveLength(1);
  });

  it("pago rechazado en el primer intento: no queda como autorizado y se puede reintentar", async () => {
    const q = await quantum(on);
    const { token } = await accepted(on, q);
    const first = await page(on, "POST", "/pago", { token });
    on.gw.completeNegotiatedSession(sessionOf(first.location), "incomplete");
    await deliver(on);
    expect(await stageOf(on, q.id)).toMatchObject({ paymentMethodAuthorized: false, chargeable: false });
    const retry = await page(on, "POST", "/pago", { token });
    expect([200, 303]).toContain(retry.status);
  });

  it("aislamiento: el enlace de una empresa solo abre el pago de SU suscripción", async () => {
    const a = await quantum(on);
    const b = await quantum(on);
    const ta = await accepted(on, a);
    await accepted(on, b);
    const r = await page(on, "POST", "/pago", { token: ta.token });
    expect(r.status).toBe(303);
    const sess = on.gw.sessions.get(sessionOf(r.location))!;
    expect(sess.metadata.es_terms_subscription).toBe(String(a.id));
    expect(await stageOf(on, b.id)).toMatchObject({ stage: "payment_pending" });
    expect(await on.billingStore.bySubscription(b.id)).toBeNull();
  });

  it("interruptor apagado (production hoy): aceptar funciona, la página dice «pago pendiente de habilitar» y no se llama a Stripe", async () => {
    const q = await quantum(off);
    const { token, html } = await accepted(off, q);
    expect(html).toContain("configurar el método de pago");
    const view = await page(off, "GET", `/pago?token=${token}`);
    expect(view.text).toContain("todavía no está habilitado");
    const post = await page(off, "POST", "/pago", { token });
    expect(post.status).toBe(200);
    expect(post.text).toContain("todavía no está habilitado");
    expect(off.gw.calls).toEqual([]);
    expect(await off.billingStore.bySubscription(q.id)).toBeNull();
    expect(await stageOf(off, q.id)).toMatchObject({ stage: "payment_not_enabled", chargeable: false, paymentEnabled: false });
    // La prueba se respeta igualmente hasta su instante
    expect((await call(off, "GET", `/subscriptions/${q.id}`)).json.subscription).toMatchObject({ status: "trialing", trialEnd: q.trialEnd });
  });

  it("sin el interruptor, el acuerdo aceptado también concluye la prueba en su instante (sin cobro: modo sombra) y la etapa lo dice", async () => {
    const q = await quantum(off);
    await accepted(off, q);
    setClock(off, q.trialEnd + 1000);
    await call(off, "POST", `/subscriptions/${q.id}/shadow`);
    expect((await call(off, "GET", `/subscriptions/${q.id}`)).json.subscription).toMatchObject({ status: "active", currentPeriodStart: q.trialEnd });
    expect((await stageOf(off, q.id)).chargeable).toBe(false);
  });

  it("con menos de 48 h para el fin de la prueba Stripe no admite aplazar el primer cargo: mensaje claro y, terminada la prueba, el pago se configura con cobro inmediato", async () => {
    const q = await quantum(on);
    const { token } = await accepted(on, q);
    expect((await stageOf(on, q.id)).acceptedAt).toBeGreaterThan(0);
    setClock(on, q.trialEnd - 10 * 3600_000);
    const tooSoon = await page(on, "POST", "/pago", { token });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.text).toContain("menos de 48 horas");
    expect(tooSoon.text).toContain("Tu contrato sigue aceptado");
    expect(on.gw.calls.filter((c) => c.op === "checkout.sessions.create(negotiated)" && (c.input as NegotiatedCheckoutInput).metadata.es_terms_subscription === String(q.id))).toHaveLength(0);
    // Terminada la prueba (la tarea la concluye) el enlace sigue sirviendo: ya no hay nada que aplazar
    setClock(on, q.trialEnd + 60_000);
    await call(on, "POST", `/subscriptions/${q.id}/shadow`);
    const ok = await page(on, "POST", "/pago", { token });
    expect(ok.status).toBe(303);
    const input = on.gw.negotiatedSessions.get(sessionOf(ok.location))!;
    expect(input.trialEnd).toBeUndefined();
    expect(input.lines.reduce((a, l) => a + l.unitAmount, 0)).toBe(5200);
  });
});
