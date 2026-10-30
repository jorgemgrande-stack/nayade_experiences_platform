/**
 * Resource Manager — rentabilidad por cliente: ingresos facturados SOLO live y con su fuente (sin contar dos veces un
 * hecho), costes medidos frente a estimados, margen solo con costes completos, clientes externos sin infraestructura
 * y API (`GET /cp/v1/resources/profitability`, usage:read + billing:read). Datos simulados.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ESTIMATED_COST_MODEL, costModelFromEnv, costModelInputSchema, tenantCosts, type CostModel } from "./_core/erm/costs";
import { MemoryUsageStore, hourOf } from "./_core/erm/usage";
import { buildProfitability, collectRevenue, costGaps, dayAxis, type RevenueInputs } from "./revenue/profitability";
import type { Invoice } from "./invoicing/types";
import type { FiscalDocument } from "./stripe/fiscalDocuments";
import type { CommercialEvent } from "./commercialEvents/types";
import type { ExternalEvent, ExternalSubscription } from "./external/types";
import { MemoryCommercialEventLog } from "./commercialEvents/log";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 86_400_000;
const FROM = NOW - 30 * DAY;
const TO = NOW + 3_600_000;

const FULL_MODEL: CostModel = {
  source: "configuración",
  note: "prueba",
  currency: "EUR",
  rates: [{ metric: "http.response.bytes", label: "Tráfico", unit: "GB", per: 1e9, centsPerUnit: 10, evidence: "Railway, factura 2026-10" }],
  sharedMonthlyCents: 3000,
  sharedBasis: "http.request",
  sharedEvidence: "Railway 2026-10",
};

const invoice = (p: Partial<Invoice>): Invoice =>
  ({
    id: 1,
    sourceKey: "k",
    kind: "invoice",
    status: "issued",
    paymentStatus: "paid",
    companyId: 10,
    billingRef: "charge:1",
    paymentRef: null,
    originalInvoiceId: null,
    seriesCode: "EB",
    number: "EB-2026-00001",
    operationDate: "2026-10-15",
    periodStart: null,
    periodEnd: null,
    periodLabel: null,
    issueDate: "2026-10-15",
    currency: "EUR",
    baseCents: 10_000,
    taxCents: 2100,
    totalCents: 12_100,
    issuer: null,
    customer: null,
    hash: null,
    previousHash: null,
    notes: null,
    issuedAt: NOW,
    issuedBy: "op",
    paidAt: null,
    createdBy: "op",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    lines: [],
    ...p,
  }) as Invoice;

const fiscal = (p: Partial<FiscalDocument>): FiscalDocument => ({
  id: 1,
  kind: "invoice",
  sourceKey: "invoice:in_1",
  orderId: 7,
  stripeInvoiceId: "in_1",
  stripeChargeId: null,
  originalDocumentId: null,
  currency: "EUR",
  baseCents: 5000,
  taxCents: 1050,
  totalCents: 6050,
  status: "issued",
  externalRef: "ST-1",
  issuedAt: NOW,
  issuedBy: null,
  lastError: null,
  createdAt: NOW - 5 * DAY,
  ...p,
});

const payment = (p: Partial<CommercialEvent> & { data?: Record<string, any> }): CommercialEvent =>
  ({
    id: 1,
    key: "payment:1:succeeded",
    type: "payment.succeeded",
    aggregate: { type: "payment", id: "1", version: null },
    correlationId: "order:9",
    tenantId: "alfa",
    companyId: 10,
    orderId: 9,
    subscriptionId: null,
    trialId: null,
    paymentId: 1,
    stripeRef: null,
    fromState: "pending",
    toState: "succeeded",
    actor: "system",
    occurredAt: NOW - 2 * DAY,
    schemaVersion: 1,
    environment: "live",
    source: "stripe",
    causationId: null,
    dispatchStatus: "done",
    ...p,
    data: { purpose: "initial", amountCents: 3000, currency: "EUR", mode: "live", ...(p.data ?? {}) },
  }) as CommercialEvent;

const noRevenue: RevenueInputs = { from: FROM, to: TO, ownInvoices: null, stripeFiscal: null, external: null, paymentEvents: null };

describe("ingresos facturados", () => {
  it("solo suman los del entorno live; los de pruebas se excluyen y se dice", () => {
    const test = collectRevenue({ ...noRevenue, ownInvoices: { mode: "test", invoices: [invoice({})] }, stripeFiscal: { mode: "test", documents: [fiscal({})], orderOf: new Map() } });
    expect(test.entries).toHaveLength(0);
    expect(test.sources.find((s) => s.source === "own_invoices")).toMatchObject({ status: "excluded_test", cents: 0 });
    expect(test.sources.find((s) => s.source === "stripe_fiscal")?.status).toBe("excluded_test");
    expect(test.sources.find((s) => s.source === "payment_events")?.status).toBe("not_mounted");

    const live = collectRevenue({ ...noRevenue, ownInvoices: { mode: "live", invoices: [invoice({})] } });
    expect(live.entries).toEqual([expect.objectContaining({ source: "own_invoices", companyId: 10, cents: 10_000, ref: "EB-2026-00001" })]);
  });

  it("cobros: un evento de pruebas o un cobro simulado nunca cuentan", () => {
    const r = collectRevenue({
      ...noRevenue,
      paymentEvents: { events: [payment({ id: 1 }), payment({ id: 2, environment: "test" }), payment({ id: 3, data: { mode: "test" } }), payment({ id: 4, type: "payment.failed" })] },
    });
    expect(r.entries.map((e) => e.cents)).toEqual([3000]);
    expect(r.entries[0].source).toBe("payment_events");
  });

  it("borradores fuera, rectificativas restan y fuera del periodo no cuenta", () => {
    const r = collectRevenue({
      ...noRevenue,
      ownInvoices: {
        mode: "live",
        invoices: [
          invoice({ id: 1 }),
          invoice({ id: 2, status: "draft", number: null }),
          invoice({ id: 3, kind: "rectification", baseCents: -2000, number: "EBR-2026-00001" }),
          invoice({ id: 4, operationDate: "2026-08-01" }),
        ],
      },
    });
    expect(r.entries.map((e) => e.cents)).toEqual([10_000, -2000]);
  });

  it("un mismo hecho no se cuenta dos veces entre fuentes", () => {
    const ext = { id: 5, companyId: 20, timezone: "Europe/Madrid" } as ExternalSubscription;
    const events: ExternalEvent[] = [
      // Ya facturada por la facturación propia (mismo periodo): no suma
      { id: 1, externalId: 5, kind: "invoice_paid", ref: "in_ext_1", detail: { subtotal: 40_000, period: "octubre de 2026" }, actor: "system:stripe", at: NOW - DAY },
      // Sin factura propia: suma como factura de Stripe del servicio externo
      { id: 2, externalId: 5, kind: "invoice_paid", ref: "in_ext_2", detail: { subtotal: 40_000, period: "septiembre de 2026", number: "ST-EXT-2" }, actor: "system:stripe", at: NOW - 20 * DAY },
    ];
    const r = collectRevenue({
      ...noRevenue,
      ownInvoices: { mode: "live", invoices: [invoice({ companyId: 20, billingRef: "external:5", periodLabel: "octubre de 2026", baseCents: 40_000 })] },
      stripeFiscal: { mode: "live", documents: [fiscal({})], orderOf: new Map([[7, { companyId: 10, tenantId: "alfa" }]]) },
      external: { mode: "live", subscriptions: [ext], events: new Map([[5, events]]) },
      paymentEvents: {
        events: [
          // Cobro de la factura de Stripe ya contada como documento fiscal
          payment({ id: 1, orderId: 7, stripeRef: "inv:in_1" }),
          // Cobro sin documento fiscal: suma
          payment({ id: 2, orderId: 9, stripeRef: "inv:in_9" }),
        ],
      },
    });
    expect(r.entries.map((e) => [e.source, e.cents])).toEqual([
      ["own_invoices", 40_000],
      ["stripe_fiscal", 5000],
      ["stripe_external", 40_000],
      ["payment_events", 3000],
    ]);
    expect(r.entries.find((e) => e.source === "stripe_fiscal")).toMatchObject({ companyId: 10, tenantId: "alfa", ref: "ST-1" });
  });
});

describe("costes completos frente a incompletos", () => {
  it("sin coste compartido, con tarifas de referencia y con recursos sin medir: incompleto con la lista", () => {
    const gaps = costGaps(ESTIMATED_COST_MODEL, "estimación").map((g) => g.key);
    expect(gaps).toEqual(["shared", "rates", "storage.total.bytes", "db.size", "cpu"]);
  });
  it("con coste compartido y tarifas reales, la infraestructura sin medir queda cubierta: completo", () => {
    expect(costGaps(FULL_MODEL, "admin")).toEqual([]);
    expect(costGaps(FULL_MODEL, "estimación").map((g) => g.key)).toEqual(["rates"]);
    // Valores guardados sin factura: siguen siendo de referencia (el margen no es exacto)
    const sinFactura = { ...FULL_MODEL, rates: [{ ...FULL_MODEL.rates[0], evidence: undefined }, { metric: "email.sent", label: "Correo", unit: "correo", per: 1, centsPerUnit: 0.1, evidence: "Postmark 2026-10" }], sharedEvidence: undefined };
    const g = costGaps(sinFactura, "admin");
    expect(g.map((x) => x.key)).toEqual(["shared_evidence", "rates"]);
    expect(g[1].label).toBe("Tarifas sin factura de respaldo: Tráfico");
  });
});

describe("rentabilidad por empresa", () => {
  const base = async (model: CostModel, origin: "admin" | "estimación") => {
    const usage = new MemoryUsageStore();
    const h = hourOf(NOW - DAY);
    await usage.add([
      { tenantId: "alfa", metric: "http.request", hourStart: h, quantity: 300 },
      { tenantId: "alfa", metric: "http.response.bytes", hourStart: h, quantity: 2e9 },
      { tenantId: "beta", metric: "http.request", hourStart: h, quantity: 100 },
    ]);
    const costs = await tenantCosts(usage, model, ["alfa", "beta"], NOW, 30);
    const usageDaily = new Map([
      ["alfa", new Map([[dayAxis(NOW - DAY, 1)[0], { "http.request": 300, "http.response.bytes": 2e9 }]])],
      ["beta", new Map([[dayAxis(NOW - DAY, 1)[0], { "http.request": 100 }]])],
    ]);
    const revenue = collectRevenue({
      ...noRevenue,
      ownInvoices: { mode: "live", invoices: [invoice({ companyId: 10, baseCents: 10_000 }), invoice({ id: 2, companyId: 30, baseCents: 50_000, number: "EB-2026-00002" })] },
    });
    return buildProfitability({
      now: NOW,
      days: 30,
      from: FROM,
      to: TO,
      tenants: [
        { id: "alfa", displayName: "Alfa", status: "active" },
        { id: "beta", displayName: "Beta", status: "active" },
      ],
      costs,
      model,
      tariffOrigin: origin,
      usageDaily,
      dayAxis: dayAxis(NOW, 30),
      revenue,
      tenantOfCompany: new Map([
        [10, "alfa"],
        [30, null],
      ]),
      companyName: new Map([[30, "Cliente Externo de Prueba SL"]]),
      plans: new Map([["alfa", { plan: { id: "pro", name: "Pro" }, modules: [{ id: "crm", name: "CRM" }] }]]),
      resources: new Map([["alfa", { tenantId: "alfa", worst: "warning", maxRatio: 0.9, rows: [{ metric: "http.request", period: "day", limit: 1000, enforcement: "soft", source: "default", used: 900, ratio: 0.9, state: "warning", windowStart: 0 }] }]]),
      incidents: [
        { id: 1, tenantId: "alfa", severity: "warning", title: "Pico de tráfico", kind: "erm", status: "open", openedAt: NOW },
        { id: 2, tenantId: "alfa", severity: "info", title: "Resuelta", kind: "erm", status: "resolved", openedAt: NOW },
      ],
    });
  };

  it("costes completos: margen exacto con medido y estimado separados", async () => {
    const r = await base(FULL_MODEL, "admin");
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
    const alfa = r.tenants.find((t) => t.key === "alfa")!;
    expect(alfa.cost).toEqual({ applicable: true, measuredCents: 20, estimatedCents: 2250, totalCents: 2270 });
    expect(alfa.revenue).toMatchObject({ billedCents: 10_000, bySource: { own_invoices: 10_000 } });
    expect(alfa.margin).toMatchObject({ complete: true, cents: 7730, provisionalCents: 7730, missing: [] });
    expect(alfa.plan).toEqual({ id: "pro", name: "Pro" });
    expect(alfa.alerts.map((a) => a.id)).toEqual([1]);
    expect(alfa.nearLimit).toBe(true);
    expect(alfa.monthly.reduce((s, m) => s + m.revenueCents, 0)).toBe(10_000);
    expect(alfa.daily.reduce((s, d) => s + d.measuredCents, 0)).toBe(20);
  });

  it("costes incompletos (estimación): margen solo provisional y la lista de lo que falta", async () => {
    const r = await base(ESTIMATED_COST_MODEL, "estimación");
    expect(r.complete).toBe(false);
    const alfa = r.tenants.find((t) => t.key === "alfa")!;
    expect(alfa.cost.estimatedCents).toBe(0);
    expect(alfa.margin.cents).toBeNull();
    expect(alfa.margin.missing.join(" ")).toMatch(/Coste fijo compartido sin configurar/);
  });

  it("cliente externo: ingresos facturados y coste de infraestructura «no aplica»", async () => {
    const r = await base(FULL_MODEL, "admin");
    const ext = r.tenants.find((t) => t.kind === "external")!;
    expect(ext).toMatchObject({ key: "company:30", displayName: "Cliente Externo de Prueba SL", tenantId: null, cost: { applicable: false, totalCents: null }, margin: { cents: null } });
    expect(ext.revenue.billedCents).toBe(50_000);
    expect(r.totals).toMatchObject({ activeCompanies: 2, saasCompanies: 2, externalClients: 1, billedCents: 60_000, activeAlerts: 1 });
    expect(r.topConsumers[0]).toMatchObject({ key: "alfa", measuredCents: 20 });
    expect(r.nearLimit.map((n) => n.key)).toEqual(["alfa"]);
    expect(r.daily).toHaveLength(dayAxis(NOW, 30).length);
  });
});

describe("API de rentabilidad", () => {
  let server: http.Server;
  let port: number;
  const FULL = "rentab-full-token-aaaaaaaaaaaaaaaaaaaa";
  const USAGE_ONLY = "rentab-usage-token-bbbbbbbbbbbbbbbbbbb";
  const BILLING_ONLY = "rentab-billing-token-ccccccccccccccccc";
  const OP: Actor = { type: "operator", id: "test" };

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["grande", "pequena"]) await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
    const usage = new MemoryUsageStore();
    await usage.add([
      { tenantId: "grande", metric: "http.request", hourStart: hourOf(Date.now()), quantity: 900 },
      { tenantId: "grande", metric: "http.response.bytes", hourStart: hourOf(Date.now()), quantity: 1e9 },
    ]);
    // Registro de eventos de un entorno live con un cobro live atribuido a «grande»
    const events = new MemoryCommercialEventLog("live");
    const draft = (key: string, amountCents: number, mode: string) => ({
      key,
      type: "payment.succeeded" as const,
      aggregate: { type: "payment" as const, id: key, version: null },
      correlationId: "order:1",
      tenantId: "grande",
      companyId: null,
      orderId: null,
      subscriptionId: null,
      trialId: null,
      paymentId: null,
      stripeRef: null,
      fromState: "pending",
      toState: "succeeded",
      actor: "system",
      occurredAt: Date.now() - DAY,
      data: { purpose: "initial", amountCents, currency: "EUR", mode },
    });
    await events.append(null, [draft("p1", 12_000, "live"), draft("p2", 99_999, "test")]);
    server = http.createServer(
      createControlPlaneApp({
        tokens: [
          { id: "full", sha256: hashToken(FULL), scopes: ["usage:read", "billing:read", "tenants:read"] },
          { id: "usage", sha256: hashToken(USAGE_ONLY), scopes: ["usage:read"] },
          { id: "billing", sha256: hashToken(BILLING_ONLY), scopes: ["billing:read"] },
        ] as Array<{ id: string; sha256: string; scopes: any[] }>,
        registry,
        reader: reg,
        entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
        quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
        platformTarget: "edge.example.com",
        // Sin coste compartido: los costes no están completos
        costModel: { model: { ...FULL_MODEL, sharedMonthlyCents: 0 }, error: null },
        usage,
        commercialEvents: events,
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = (path: string, token: string) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/cp/v1${path}`, method: "GET", headers: { authorization: `Bearer ${token}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      });
      req.on("error", reject);
      req.end();
    });

  it("exige usage:read y billing:read; solo admite 30, 90 o 365 días", async () => {
    expect((await call("/resources/profitability", USAGE_ONLY)).status).toBe(403);
    expect((await call("/resources/profitability", BILLING_ONLY)).status).toBe(403);
    expect((await call("/resources/profitability", "token-inventado-xxxxxxxxxxxxxxxxxxxx")).status).toBe(401);
    expect((await call("/resources/profitability?days=31", FULL)).status).toBe(400);
    expect((await call("/resources/profitability?tenant=no-existe", FULL)).status).toBe(404);
  });

  it("ingresos live con su fuente, costes medidos y estimados, y margen no exacto si faltan costes", async () => {
    const r = await call("/resources/profitability?days=90", FULL);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ available: true, days: 90, currency: "EUR", complete: false });
    const grande = r.json.tenants.find((t: any) => t.key === "grande");
    expect(grande.revenue).toMatchObject({ billedCents: 12_000, bySource: { payment_events: 12_000 } });
    expect(grande.cost).toMatchObject({ applicable: true, measuredCents: 10 });
    expect(grande.margin.cents).toBeNull();
    expect(grande.margin.missing.length).toBeGreaterThan(0);
    expect(r.json.revenueSources.find((s: any) => s.source === "own_invoices").status).toBe("not_mounted");
    expect(r.json.daily).toHaveLength(dayAxis(Date.now(), 90).length);
    const one = await call("/resources/profitability?tenant=pequena", FULL);
    expect(one.json.tenants.map((t: any) => t.key)).toEqual(["pequena"]);
  });
});

describe("respaldo de factura en el modelo de costes", () => {
  it("las tarifas y el coste compartido aceptan su factura; una referencia vacía o demasiado corta se rechaza", () => {
    const rate = { metric: "email.sent", label: "Correo", unit: "correo", per: 1, centsPerUnit: 0.1 };
    expect(costModelInputSchema.parse({ rates: [{ ...rate, evidence: "Postmark 2026-10" }], sharedMonthlyCents: 1000, sharedEvidence: "Railway 2026-10" }).rates[0].evidence).toBe("Postmark 2026-10");
    expect(() => costModelInputSchema.parse({ rates: [{ ...rate, evidence: " x " }] })).toThrow();
    const env = costModelFromEnv({ ERM_COST_MODEL: JSON.stringify({ rates: [rate], sharedMonthlyCents: 500, sharedEvidence: "Railway 2026-10" }) });
    expect(env.model.sharedEvidence).toBe("Railway 2026-10");
    expect(costGaps(env.model, "entorno").map((g) => g.key)).toEqual(["rates"]);
  });
});
