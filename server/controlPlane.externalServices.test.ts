/**
 * Clientes externos (piloto Nextair SL / Skicenter): contratación, aceptación digital, autorización del método de pago
 * sin cargo y cobro mensual el día 1 con Stripe Billing, de punta a punta por HTTP con la aplicación REAL del plano de
 * control (Stripe es un doble; la firma del webhook es la real del SDK). La validación contra el sandbox real de Stripe
 * (con relojes de prueba) está en scripts/stripe/externalSandboxE2E.ts.
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
import { MemoryOrderStore } from "./orchestrator/store";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryExternalStore } from "./external/store";
import { chargeInstant, localDate } from "./external/schedule";

const ADMIN = "external-admin-token-aaaaaaaaaaaaaaaaaaa";
const CRM_ORIGIN = "https://admin.example";
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "d".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 9, 27, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
let registry: MemoryTenantRegistryStore;
const crmStore = new MemoryCrmStore();
const gw = new FakeStripeGateway();
const stripeStore = new MemoryStripeStore();
const ext = new MemoryExternalStore();
const caps = new MemoryCapabilityStore();
const provisioningRuns: string[] = [];

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": o.headers?.["content-type"] ?? "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
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
          resolve({ status: res.statusCode ?? 0, json, raw: b });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
  const r = await p;
  if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${r.raw.slice(0, 400)}`);
  return r.json;
};
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
  await settled();
}
const madrid = (y: number, m: number, d: number, h = 8) => chargeInstant(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, h, "Europe/Madrid");
const sec = (ms: number) => Math.floor(ms / 1000);

beforeAll(async () => {
  registry = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new TenantRegistryService(registry, () => ring);
  const provisioning = new ProvisioningService({
    registry: reg,
    reader: registry,
    databases: { ensureDatabase: async (id) => (provisioningRuns.push(id), { dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
    schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
    seeder: { seedAdmin: async () => ({ created: true, inviteToken: "x" }), seedBranding: async () => undefined },
    entitlements: { grant: async () => undefined },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    now: () => clock,
    sleep: async () => undefined,
  });
  const webStore = new MemoryWebStore();
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read", "ops:write"] as const;
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
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock },
    capabilities: caps,
    limits: new MemoryTenantLimitStore(),
    trials: { store: new MemoryTrialStore(), publicEnabled: false, autoProvision: false, notify: { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined } },
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
      purchases: { enabled: false, changes: new MemorySubscriptionChangeStore(), internalTenants: new Set() },
    },
    external: {
      store: ext,
      urls: { acceptance: `${CRM_ORIGIN}/cp/v1/public/contract-acceptance`, setupSuccess: `${CRM_ORIGIN}/ok`, setupCancel: `${CRM_ORIGIN}/ko`, portalReturn: CRM_ORIGIN },
      ipSalt: "s".repeat(32),
    },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const SKINET = { key: "skinet", name: "SkiNet — Servicio tecnológico gestionado" };
const CONDITIONS = "Servicio tecnológico gestionado de la plataforma Skicenter (infraestructura externa a Elephant Source): mantenimiento, soporte y evolución según el anexo acordado. Duración indefinida con baja con 30 días de preaviso.";
async function nextair(name: string, taxId = "B00000000") {
  const c = await crm.createCompany({ name, legalName: name, taxId, country: "ES", billingEmail: "facturas@nextair.example" }, "operator:test");
  await crm.createContact(c.id, { name: "Laura Representante", email: "laura@nextair.example", isPrimary: true }, "operator:test");
  return c.id;
}
const createBody = (companyId: number, extra: Record<string, unknown> = {}) => ({ companyId, service: SKINET, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", externalRef: "skicenter:nextair", conditions: CONDITIONS, ...extra });

describe("clientes externos: piloto Nextair SL (SkiNet, 1.000 € + IVA, cobro el día 1)", { timeout: 30_000 }, () => {
  let id = 0;
  let subId = "";

  it("contratación externa: contrato del CRM con las condiciones, calendario en Europe/Madrid y sin duplicados", async () => {
    const companyId = await nextair("Nextair SL");
    const r = await ok(call("POST", "/external", { body: createBody(companyId) }), 201);
    id = r.external.id;
    expect(r.external).toMatchObject({ status: "awaiting_acceptance", amountCents: 100_000, taxRateBp: 2100, billingDay: 1, timezone: "Europe/Madrid", graceDays: 5, stripeSubscriptionId: null });
    // Primer cargo: 01/11/2026 a las 08:00 de Madrid (07:00 UTC en horario de invierno)
    expect(new Date(r.external.firstChargeAt).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    const detail = await ok(call("GET", `/external/${id}`));
    expect(detail.monthly).toEqual({ net: 100_000, tax: 21_000, total: 121_000 });
    expect(detail.contract).toMatchObject({ status: "draft", version: 1 });
    const contract = await crmStore.get("contracts", detail.contract.id);
    expect(contract).toMatchObject({ amountCents: 100_000, billingInterval: "month", planId: null });
    expect(contract!.conditions).toContain("1.210,00");
    // Sin duplicados: otra contratación viva del mismo servicio para la misma empresa
    expect((await call("POST", "/external", { body: createBody(companyId) })).status).toBe(409);
    // Primer vencimiento que no cae en el día de cobro, o ya pasado
    expect((await call("POST", "/external", { body: createBody(companyId, { service: { key: "otro", name: "Otro servicio" }, firstChargeDate: "2026-11-03" }) })).status).toBe(400);
    expect((await call("POST", "/external", { body: createBody(companyId, { service: { key: "otro", name: "Otro servicio" }, firstChargeDate: "2026-10-01" }) })).status).toBe(400);
  });

  it("aceptación digital con evidencias, separada de la autorización del método de pago", async () => {
    // Sin aceptación no hay enlace de pago
    expect((await call("POST", `/external/${id}/payment-setup`)).status).toBe(409);
    const a = (await ok(call("POST", `/external/${id}/acceptance`, { body: { name: "Laura Representante", email: "laura@nextair.example", role: "Administradora" } }), 201)).acceptance;
    expect(a.url).toMatch(new RegExp(`^${CRM_ORIGIN}/cp/v1/public/contract-acceptance\\?token=`));
    const token = new URL(a.url).searchParams.get("token")!;
    // Página pública (sin sesión): el documento exacto, importes y huella
    const pageRes = await call("GET", `/public/contract-acceptance?token=${token}`, { token: null });
    expect(pageRes.status).toBe(200);
    expect(pageRes.raw).toContain("1.000,00");
    expect(pageRes.raw).toContain("1.210,00");
    expect(pageRes.raw).toContain(a.documentSha256);
    expect(pageRes.raw).not.toContain("<script");
    // Sin marcar la aceptación, no vale
    const form = (accept: boolean) => new URLSearchParams({ token, name: "Laura Representante", taxId: "00000000T", ...(accept ? { accept: "1" } : {}) }).toString();
    expect((await call("POST", "/public/contract-acceptance", { token: null, raw: form(false), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Prueba/1.0" } })).status).toBe(400);
    const accepted = await call("POST", "/public/contract-acceptance", { token: null, raw: form(true), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Prueba/1.0" } });
    expect(accepted.status).toBe(200);
    expect(accepted.raw).toContain("No se ha realizado ningún cobro");
    // El mismo enlace no vale dos veces
    expect((await call("POST", "/public/contract-acceptance", { token: null, raw: form(true), headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(409);
    const detail = await ok(call("GET", `/external/${id}`));
    expect(detail.external.status).toBe("awaiting_payment_method");
    expect(detail.contract).toMatchObject({ status: "signed", signatureMethod: "electronic" });
    expect(detail.acceptances[0]).toMatchObject({ status: "accepted", acceptedName: "Laura Representante", acceptedTaxId: "00000000T", contractVersion: 1, documentSha256: a.documentSha256, acceptedUserAgent: "Prueba/1.0" });
    expect(detail.acceptances[0].consentText).toContain("1000.00 EUR más IVA");
    // La IP se guarda seudonimizada y no se devuelve
    expect(detail.acceptances[0].acceptedIpHash).toBeUndefined();
    expect((await ext.acceptances(detail.contract.id))[0].acceptedIpHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("autorización de la tarjeta sin cargo; suscripción programada para el día 1 con IVA del 21 %", async () => {
    const s = (await ok(call("POST", `/external/${id}/payment-setup`))).setup;
    expect(s).toMatchObject({ reused: false, url: expect.stringMatching(/^https:\/\//) });
    expect((await ok(call("POST", `/external/${id}/payment-setup`))).setup).toMatchObject({ reused: true, sessionId: s.sessionId });
    const input = gw.calls.find((c) => c.op === "checkout.sessions.create(setup)")!.input as { notice: string };
    expect(input.notice).toMatch(/1000\.00 € \+ IVA \(210\.00 €\) = 1210\.00 € al mes/);
    expect(input.notice).toContain("Hoy no se cobra nada");
    const invoicesBefore = gw.invoices.size;
    const mark = gw.events.length;
    const pm = gw.completeSetupSession(s.sessionId);
    await deliverSince(mark);
    const x = (await ok(call("GET", `/external/${id}`))).external;
    expect(x).toMatchObject({ status: "scheduled", stripePaymentMethodId: pm });
    subId = x.stripeSubscriptionId;
    const create = gw.calls.find((c) => c.op === "subscriptions.create(service)")!.input as Record<string, unknown>;
    expect(create).toMatchObject({ unitAmount: 100_000, currency: "EUR", interval: "month", trialEnd: sec(madrid(2026, 11, 1)), defaultPaymentMethod: pm });
    expect(gw.taxRates).toEqual([expect.objectContaining({ bp: 2100, country: "ES" })]);
    expect(gw.defaultPaymentMethod.get(x.stripeCustomerId)).toBe(pm);
    // Ningún cargo al autorizar
    expect(gw.invoices.size).toBe(invoicesBefore);
    // Repetir la autorización no crea otra suscripción
    await deliverSince(0);
    expect(gw.calls.filter((c) => c.op === "subscriptions.create(service)")).toHaveLength(1);
  });

  it("primer cobro el 01/11: 1.000 € + 210 € de IVA = 1.210 €; renovación el día 1 siguiente", async () => {
    clock = madrid(2026, 11, 1);
    let mark = gw.events.length;
    const nov = gw.chargeServicePeriod(subId, sec(madrid(2026, 11, 1)), sec(madrid(2026, 12, 1)), "paid");
    await deliverSince(mark);
    let d = await ok(call("GET", `/external/${id}`));
    expect(d.external).toMatchObject({ status: "active", lastInvoiceId: nov, lastInvoiceStatus: "paid" });
    const paid = d.events.find((e: { kind: string; ref: string }) => e.kind === "invoice_paid" && e.ref === nov);
    expect(paid.detail).toMatchObject({ subtotal: 100_000, tax: 21_000, amountPaid: 121_000, period: "noviembre de 2026" });
    // Evento de cobro para la facturación (I-6): referencias y periodo del SERVICIO (no el period_start de la factura)
    expect(paid.detail).toMatchObject({ billingRef: `external:${id}`, paymentRef: `stripe:in:${nov}`, currency: "EUR", baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, periodStart: madrid(2026, 11, 1), periodEnd: madrid(2026, 12, 1) });
    expect(gw.invoices.get(nov)!.periodStart).toBeLessThan(sec(madrid(2026, 11, 1)));
    clock = madrid(2026, 12, 1);
    mark = gw.events.length;
    gw.chargeServicePeriod(subId, sec(madrid(2026, 12, 1)), sec(madrid(2027, 1, 1)), "paid");
    await deliverSince(mark);
    d = await ok(call("GET", `/external/${id}`));
    expect(d.events.filter((e: { kind: string }) => e.kind === "invoice_paid").map((e: { detail: { period: string } }) => e.detail.period)).toEqual(["noviembre de 2026", "diciembre de 2026"]);
    // El calendario cae siempre el día 1 en Madrid, también con el cambio de hora de verano
    for (const [y, m] of [[2027, 3], [2027, 4], [2027, 10], [2027, 11]]) expect(localDate(madrid(y, m, 1), "Europe/Madrid").day).toBe(1);
  });

  it("impago del día 1 al 5: pago pendiente, recuperación de la MISMA factura y alerta del día 5 una sola vez", async () => {
    // Enero: falla el día 1; Stripe reintenta y cobra el día 3 (la misma factura, ningún cargo nuevo)
    clock = madrid(2027, 1, 1);
    let mark = gw.events.length;
    const jan = gw.chargeServicePeriod(subId, sec(madrid(2027, 1, 1)), sec(madrid(2027, 2, 1)), "open");
    await deliverSince(mark);
    let x = (await ok(call("GET", `/external/${id}`))).external;
    expect(x).toMatchObject({ status: "past_due", lastInvoiceId: jan });
    expect(new Date(x.graceUntil).toISOString()).toBe("2027-01-05T22:59:59.000Z"); // 05/01 23:59:59 en Madrid
    clock = madrid(2027, 1, 3);
    expect((await ok(call("POST", "/external/evaluate"))).overdue).toEqual([]);
    mark = gw.events.length;
    gw.recoverServiceInvoice(jan);
    await deliverSince(mark);
    expect((await ok(call("GET", `/external/${id}`))).external).toMatchObject({ status: "active", graceUntil: null });
    // Febrero: falla y sigue sin cobrar al acabar el día 5 → alerta administrativa una sola vez; el servicio no se toca
    clock = madrid(2027, 2, 1);
    mark = gw.events.length;
    const feb = gw.chargeServicePeriod(subId, sec(madrid(2027, 2, 1)), sec(madrid(2027, 3, 1)), "open");
    await deliverSince(mark);
    clock = madrid(2027, 2, 6, 9);
    expect((await ok(call("POST", "/external/evaluate"))).overdue).toEqual([expect.objectContaining({ externalId: id, invoiceId: feb })]);
    expect((await ok(call("POST", "/external/evaluate"))).overdue).toEqual([]);
    x = (await ok(call("GET", `/external/${id}`))).external;
    expect(x.status).toBe("past_due");
    // Una factura por periodo: Elephant no ha emitido ningún cargo propio
    const ofSub = Array.from(gw.invoices.values()).filter((i) => i.subscriptionId === subId);
    expect(ofSub).toHaveLength(4);
    expect(gw.calls.some((c) => /charges|paymentIntents|invoices\.create/.test(c.op))).toBe(false);
  });

  it("reembolso parcial y disputa de un cobro: un evento por hecho, con lo añadido, y nota en el contrato", async () => {
    const d = await ok(call("GET", `/external/${id}`));
    const nov = d.events.find((e: { kind: string; detail: { period: string } }) => e.kind === "invoice_paid" && e.detail.period === "noviembre de 2026").ref;
    const ch = gw.chargeForInvoice(nov);
    gw.refund(ch, 12_100);
    const ev = gw.emit("charge.refunded", "charge", ch);
    await ok(stripeWebhook(ev));
    await ok(stripeWebhook(ev));
    await settled();
    gw.refund(ch, 6_050);
    await ok(stripeWebhook(gw.emit("charge.refunded", "charge", ch)));
    const dp = gw.dispute(ch, "needs_response");
    await ok(stripeWebhook(gw.emit("charge.dispute.created", "dispute", dp)));
    await settled();
    const events = await ext.events(id);
    const refunds = events.filter((e) => e.kind === "charge_refunded");
    expect(refunds.map((e) => [e.ref, e.detail?.refundedDeltaCents, e.detail?.amountRefundedCents])).toEqual([
      [`${ch}:12100`, 12_100, 12_100],
      [`${ch}:18150`, 6_050, 18_150],
    ]);
    expect(refunds[0].detail).toMatchObject({ billingRef: `external:${id}`, paymentRef: `stripe:in:${nov}`, period: "noviembre de 2026", fullyRefunded: false });
    expect(events.filter((e) => e.kind === "charge_dispute").map((e) => e.ref)).toEqual([`${ch}:needs_response`]);
    // Elephant nunca crea reembolsos ni cargos propios
    expect(gw.calls.some((c) => /refunds|charges|paymentIntents/.test(c.op))).toBe(false);
  });

  it("webhooks repetidos e idempotencia; ningún aprovisionamiento en Elephant Core", async () => {
    const before = (await ext.events(id)).length;
    await deliverSince(0);
    expect((await ext.events(id)).length).toBe(before);
    expect(provisioningRuns).toEqual([]);
    expect(await registry.listTenants()).toEqual([]);
    const company = await crmStore.get("companies", (await ext.get(id))!.companyId);
    expect(company!.tenantId).toBeNull();
    // El contrato no se puede activar como un plan de Elephant Core (no aprovisiona)
    const contractId = (await ext.get(id))!.contractId;
    await expect(crm.setContractStatus(contractId, "active", "operator:test")).rejects.toThrow(/plan/);
  });

  it("autorización después del primer vencimiento: sin cargo retroactivo; la decisión se registra en el contrato", async () => {
    clock = Date.UTC(2027, 1, 20, 9);
    const companyId = await nextair("Nextair Montaña SL", "B00000001");
    const x = (await ok(call("POST", "/external", { body: createBody(companyId, { firstChargeDate: "2027-03-01" }) }), 201)).external;
    const a = (await ok(call("POST", `/external/${x.id}/acceptance`, { body: { name: "Laura Representante", email: "laura@nextair.example" } }), 201)).acceptance;
    const token = new URL(a.url).searchParams.get("token")!;
    await ok(call("POST", "/public/contract-acceptance", { token: null, raw: new URLSearchParams({ token, name: "Laura Representante", accept: "1" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }));
    const s = (await ok(call("POST", `/external/${x.id}/payment-setup`))).setup;
    // El cliente autoriza la tarjeta el 03/03, después del primer vencimiento
    clock = madrid(2027, 3, 3);
    const mark = gw.events.length;
    gw.completeSetupSession(s.sessionId);
    await deliverSince(mark);
    let d = (await ok(call("GET", `/external/${x.id}`))).external;
    expect(d).toMatchObject({ status: "needs_decision", stripeSubscriptionId: null });
    // Una fecha pasada no se acepta; una futura en el día de cobro, sí, y queda en el contrato
    expect((await call("POST", `/external/${x.id}/decision`, { body: { firstChargeDate: "2027-03-01", reason: "Cobrar marzo con retraso" } })).status).toBe(400);
    d = (await ok(call("POST", `/external/${x.id}/decision`, { body: { firstChargeDate: "2027-04-01", reason: "Marzo sin cargo: empieza en abril por acuerdo comercial" } }))).external;
    expect(d).toMatchObject({ status: "scheduled" });
    expect(new Date(d.firstChargeAt).toISOString()).toBe("2027-04-01T06:00:00.000Z"); // 08:00 en Madrid (horario de verano)
    const notes = (await crmStore.list("activities", { entityType: "contract", entityId: d.contractId } as never)) as Array<{ body?: string; text?: string; note?: string }>;
    expect(JSON.stringify(notes)).toContain("Cambio del calendario de cobro");
  });
});
