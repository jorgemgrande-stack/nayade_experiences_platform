/**
 * API de la fase 4 (/cp/v1/finance): permisos (lectura con finance:read; revisión diaria solo con sesión de operador y
 * finance:post; marca de coste directo con finance:expenses; rentabilidad por empresa solo con usage:read), FORMAS
 * EXACTAS de cada respuesta (el CRM se construye con ellas), CSV, validación y 404 sin la migración 0038.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type Scope } from "../controlPlane/auth";
import type { ValidSession } from "../controlPlane/operatorAuth";
import { requestIdMiddleware } from "../_core/ops/requestContext";
import { createFinanceRouter } from "./api";
import { analysisScenario } from "./analysisTestkit";

const WRITE = "ci-only-placeholder-not-a-secret-ana-w";
const READ = "ci-only-placeholder-not-a-secret-ana-r";
const CSRF = "csrf-de-prueba-0987654321";
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-admin-000000000000": { role: "admin", scopes: ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:config", "finance:export", "finance:sensitive", "billing:read", "usage:read"] },
  "sesion-lector-00000000000": { role: "sales", scopes: ["finance:read", "finance:export", "billing:read"] },
  "sesion-contable-000000000": { role: "sales", scopes: ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:export"] },
};
const ADMIN = "sesion-admin-000000000000";
const READER = "sesion-lector-00000000000";
const ACCOUNTANT = "sesion-contable-000000000";
const keys = (o: object) => Object.keys(o).sort();

describe("API /cp/v1/finance de la fase 4", () => {
  let server: http.Server;
  let base: string;
  let bare: string;
  let hostingId: number;

  beforeAll(async () => {
    const s = await analysisScenario();
    hostingId = s.hostingCat.id;
    const tenant = { key: "t1", kind: "saas", displayName: "Empresa Uno", revenue: { billedCents: 10_000 }, cost: { totalCents: 2_000 }, margin: { complete: true, cents: 8_000, provisionalCents: 8_000 } };
    const commercial = {
      metrics: async () => ({ windowDays: 30, currency: "EUR", mrrCents: 50_000, arrCents: 600_000, payingCompanies: 3, collected: { netCents: 0, taxCents: 0, grossCents: 0, invoices: 0 }, churn: { canceledCount: 0, lostMrrCents: 0, rate: null } }),
      profitability: async (days: 30 | 90 | 365) => ({ days, complete: true, tenants: [tenant] }),
    };
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    const fake = (t: string) => {
      const x = SESSIONS[t];
      return x ? ({ operator: { id: 1, username: t.split("-")[1], displayName: t, role: x.role, status: "active" }, session: { id: `${t}-id-0000000000`, operatorId: 1, csrfToken: CSRF }, scopes: x.scopes } as unknown as ValidSession) : null;
    };
    app.use(
      authenticate(
        [
          { id: "integracion", sha256: hashToken(WRITE), scopes: ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:export"], actorType: "crm" },
          { id: "lectura", sha256: hashToken(READ), scopes: ["finance:read", "finance:export"], actorType: "crm" },
        ],
        undefined,
        { operators: { validateSession: async (t: string) => fake(t) }, allowedOrigins: new Set() },
      ),
    );
    app.use("/cp/v1/finance", createFinanceRouter(s.finance, s.ops, s.stripe, null, s.analysis, commercial));
    app.use("/cp/v1/bare", createFinanceRouter(s.finance, s.ops, s.stripe, null, null));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}/cp/v1/finance`;
    bare = `http://127.0.0.1:${port}/cp/v1/bare`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = async (method: string, p: string, who: string, body?: unknown, root = base) => {
    const headers: Record<string, string> = who.startsWith("sesion-") ? { cookie: `be_cp_session=${who}`, "x-csrf-token": CSRF } : { authorization: `Bearer ${who}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(root + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    // Buffer conserva el BOM (el decodificador de fetch lo quitaría)
    const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  };

  it("sin la migración 0038 las rutas no existen (404) y la marca de coste directo no se acepta (503)", async () => {
    expect((await call("GET", "/daily", READ, undefined, bare)).status).toBe(404);
    expect((await call("GET", "/reports/pnl", READ, undefined, bare)).status).toBe(404);
    const cats = await call("GET", "/categories", READ, undefined, bare);
    expect(keys(cats.json.items[0])).toEqual(["accountCode", "active", "defaultTaxRateBp", "id", "name"]);
    const patch = await call("PATCH", `/categories/${hostingId}`, WRITE, { isDirectCost: true }, bare);
    expect(patch.status).toBe(503);
    expect(patch.json.error).toBe("unavailable");
  });

  it("control diario: forma exacta; lectura con finance:read", async () => {
    const r = await call("GET", "/daily?date=2026-10-31", READ);
    expect(r.status).toBe(200);
    expect(keys(r.json)).toEqual(["alerts", "bank", "counts", "date", "entries", "expenses", "invoices", "payouts", "receivables", "review", "stripe", "tax", "today"]);
    expect(keys(r.json.counts)).toEqual(["bankMovements", "bankPending", "draftEntries", "expensesRegistered", "invoicesIssued", "paymentsDueNext7", "paymentsDueToday", "paymentsOverdue", "payoutsArriving", "payoutsWithoutBank", "receivablesOverdue", "stripeCharges", "stripeIssuesOpen", "taxDueNext15", "taxOverdue"]);
    expect(keys(r.json.alerts[0])).toEqual(["code", "count", "message", "severity"]);
    expect(keys(r.json.invoices)).toEqual(["count", "items", "totalCents"]);
    expect(keys(r.json.stripe)).toEqual(["charges", "disputesOpen", "issuesOpen", "refunds"]);
    expect(keys(r.json.stripe.charges)).toEqual(["count", "feeCents", "grossCents", "netCents"]);
    expect(keys(r.json.payouts)).toEqual(["arriving", "withoutBank"]);
    expect(keys(r.json.bank)).toEqual(["movements", "pending"]);
    expect(keys(r.json.bank.movements)).toEqual(["count", "inCents", "outCents"]);
    expect(keys(r.json.bank.pending)).toEqual(["amountCents", "buckets", "count", "oldestDate"]);
    expect(keys(r.json.bank.pending.buckets)).toEqual(["d0_7", "d30_plus", "d8_30"]);
    expect(keys(r.json.expenses)).toEqual(["due", "registered"]);
    expect(keys(r.json.expenses.due)).toEqual(["next7", "overdue", "today"]);
    expect(keys(r.json.expenses.due.overdue)).toEqual(["amountCents", "count"]);
    expect(keys(r.json.expenses.registered)).toEqual(["count", "totalCents"]);
    expect(keys(r.json.receivables)).toEqual(["amountCents", "count", "days"]);
    expect(r.json.tax).toBeNull();
    expect(r.json.entries).toEqual({ drafts: 0 });
    const oct1 = await call("GET", "/daily?date=2026-10-01", READ);
    expect(keys(oct1.json.invoices.items[0])).toEqual(["customerName", "id", "number", "paymentStatus", "totalCents"]);
    const oct8 = await call("GET", "/daily?date=2026-10-08", READ);
    expect(keys(oct8.json.payouts.arriving[0])).toEqual(["amountCents", "arrivalOn", "bankMovementId", "entryId", "id", "inBank", "payoutId", "status"]);
    expect((await call("GET", "/daily?date=31-10-2026", READ)).status).toBe(400);
    expect((await call("GET", "/daily?otro=1", READ)).status).toBe(400);
  });

  it("revisión diaria: solo operador con finance:post; 201 la primera vez, 200 después; forma exacta", async () => {
    expect((await call("POST", "/daily/2026-10-30/review", WRITE, { note: "x" })).json.error).toBe("operator_session_required");
    expect((await call("POST", "/daily/2026-10-30/review", READER, { note: "x" })).status).toBe(403);
    const first = await call("POST", "/daily/2026-10-30/review", ACCOUNTANT, { note: "Cuadrado" });
    expect(first.status).toBe(201);
    expect(keys(first.json)).toEqual(["created", "item"]);
    expect(keys(first.json.item)).toEqual(["day", "id", "log", "note", "noteEditedAt", "noteEditedBy", "requestId", "reviewedAt", "reviewedBy", "snapshot"]);
    expect(keys(first.json.item.log[0])).toEqual(["action", "actor", "at", "id", "noteAfter", "noteBefore", "requestId"]);
    expect(first.json.item.reviewedBy).toMatch(/^operator:/);
    expect(keys(first.json.item.snapshot)).toContain("paymentsOverdue");
    const again = await call("POST", "/daily/2026-10-30/review", ACCOUNTANT, {});
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
    const edit = await call("POST", "/daily/2026-10-30/review", ACCOUNTANT, { note: "Cuadrado y revisado" });
    expect(edit.json.item.log).toHaveLength(2);
    expect((await call("POST", "/daily/2026-12-31/review", ACCOUNTANT, {})).status).toBe(400);
    expect((await call("POST", "/daily/2026-10-29/review", ACCOUNTANT, { note: "x", otro: 1 })).status).toBe(400);
    const list = await call("GET", "/daily/reviews?from=2026-10-01&to=2026-10-31", READ);
    expect(keys(list.json)).toEqual(["items", "total"]);
    expect(list.json.total).toBe(1);
    expect(keys(list.json.items[0])).toEqual(["day", "id", "note", "noteEditedAt", "noteEditedBy", "requestId", "reviewedAt", "reviewedBy", "snapshot"]);
    const day = await call("GET", "/daily?date=2026-10-30", READ);
    expect(day.json.review.note).toBe("Cuadrado y revisado");
  });

  it("cuenta de resultados: forma exacta, comparación y desglose por cuenta", async () => {
    const r = await call("GET", "/reports/pnl?from=2026-09-01&to=2026-10-31&granularity=month&compare=previous", READ);
    expect(r.status).toBe(200);
    expect(keys(r.json)).toEqual(["compare", "costCenter", "from", "granularity", "lines", "notes", "periods", "result", "to"]);
    expect(keys(r.json.periods[0])).toEqual(["from", "key", "label", "to"]);
    expect(keys(r.json.compare)).toEqual(["from", "kind", "periods", "to"]);
    expect(keys(r.json.lines[0])).toEqual(["accounts", "compareTotalCents", "compareValues", "key", "kind", "label", "totalCents", "values", "variationCents", "variationPct"]);
    expect(keys(r.json.lines[0].accounts[0])).toEqual(["code", "compareTotalCents", "name", "totalCents", "values"]);
    expect(keys(r.json.result)).toEqual(["compareTotalCents", "totalCents"]);
    expect(r.json.lines).toHaveLength(22);
    expect((await call("GET", "/reports/pnl?granularity=week", READ)).status).toBe(400);
    expect((await call("GET", "/reports/pnl?costCenter=999", READ)).status).toBe(404);
  });

  it("balance, tesorería con previsión, antigüedad y gastos: formas exactas", async () => {
    const b = await call("GET", "/reports/balance?date=2026-10-31", READ);
    expect(keys(b.json)).toEqual(["assets", "check", "date", "equityAndLiabilities", "result"]);
    expect(keys(b.json.assets)).toEqual(["current", "nonCurrent", "totalCents"]);
    expect(keys(b.json.equityAndLiabilities)).toEqual(["current", "equity", "nonCurrent", "totalCents"]);
    expect(keys(b.json.assets.current)).toEqual(["lines", "totalCents"]);
    expect(keys(b.json.assets.current.lines[0])).toEqual(["accounts", "amountCents", "key", "label"]);
    expect(keys(b.json.check)).toEqual(["assetsCents", "balanced", "differenceCents", "equityAndLiabilitiesCents"]);
    expect(keys(b.json.result)).toEqual(["currentYearCents", "pendingCents"]);
    expect(b.json.check.balanced).toBe(true);

    const c = await call("GET", "/reports/cashflow?from=2026-10-01&to=2026-10-31&forecastDays=60", READ);
    expect(keys(c.json)).toEqual(["accounts", "byNature", "forecast", "from", "months", "to", "totals"]);
    expect(keys(c.json.accounts[0])).toEqual(["closingCents", "code", "inCents", "internalInCents", "internalOutCents", "kind", "name", "openingCents", "outCents"]);
    expect(keys(c.json.totals)).toEqual(["closingCents", "inCents", "internalTransfersCents", "netCents", "openingCents", "outCents"]);
    expect(keys(c.json.months[0])).toEqual(["byNature", "inCents", "internalCents", "month", "netCents", "outCents"]);
    expect(keys(c.json.months[0].byNature)).toEqual(["customers", "other", "payroll", "suppliers", "taxes"]);
    expect(keys(c.json.byNature[0])).toEqual(["inCents", "key", "label", "netCents", "outCents"]);
    expect(keys(c.json.forecast)).toEqual(["asOf", "assumptions", "buckets", "excluded", "horizonDays", "isForecast", "items", "itemsTruncated", "label", "sources", "startingBalanceCents"]);
    expect(c.json.forecast.buckets.map((x: { days: number }) => x.days)).toEqual([30, 60]);
    expect(keys(c.json.forecast.buckets[0])).toEqual(["days", "inflowsCents", "netCents", "outflowsCents", "projectedBalanceCents", "until"]);
    expect(keys(c.json.forecast.items[0])).toEqual(["amountCents", "date", "description", "kind", "overdue", "reference", "sourceId"]);
    expect(keys(c.json.forecast.excluded)).toEqual(["overdueReceivablesCents", "overdueReceivablesCount", "uncalculatedTaxes"]);
    expect((await call("GET", "/reports/cashflow?forecastDays=0", READ)).json.forecast).toBeNull();
    expect((await call("GET", "/reports/cashflow?forecastDays=45", READ)).status).toBe(400);

    const a = await call("GET", "/reports/aging?side=payable&date=2026-10-31", READ);
    expect(keys(a.json)).toEqual(["basis", "buckets", "date", "parties", "side", "totals"]);
    expect(keys(a.json.totals)).toEqual(["count", "current", "d0_30", "d31_60", "d61_90", "d90_plus", "totalCents"]);
    expect(keys(a.json.parties[0])).toEqual(["buckets", "count", "documents", "key", "name", "partyId", "totalCents"]);
    expect(keys(a.json.parties[0].documents[0])).toEqual(["bucket", "date", "daysOverdue", "dueDate", "id", "number", "partyId", "partyKey", "partyName", "pendingCents", "totalCents"]);
    expect((await call("GET", "/reports/aging?side=receivable", READ)).json.side).toBe("receivable");
    expect((await call("GET", "/reports/aging", READ)).status).toBe(400);

    const e = await call("GET", "/reports/expenses?from=2026-10-01&to=2026-10-31&groupBy=supplier&compare=year", READ);
    expect(keys(e.json)).toEqual(["compare", "from", "groupBy", "items", "months", "to", "totals"]);
    expect(keys(e.json.items[0])).toEqual(["accountCode", "compareCents", "id", "key", "name", "totalCents", "values", "variationCents", "variationPct"]);
    expect(keys(e.json.totals)).toEqual(["compareCents", "totalCents", "values", "variationCents", "variationPct"]);
  });

  it("Revenue & Margin y Conversion Health: formas exactas; MRR/ARR solo con billing:read y la rentabilidad por empresa solo con usage:read", async () => {
    const admin = await call("GET", "/analytics/revenue-margin?year=2026", ADMIN);
    expect(keys(admin.json)).toEqual(["commercial", "definitions", "months", "stripeFeesTreatment", "totals", "year", "ytd"]);
    expect(admin.json.months).toHaveLength(12);
    expect(keys(admin.json.months[0])).toEqual(["accruedRevenueCents", "collectedCents", "directCostsCents", "financialCostsCents", "grossMarginCents", "grossMarginPct", "label", "month", "otherIncomeCents", "resultCents", "stripeFeesCents", "stripeFeesPct", "structureCostsCents"]);
    expect(keys(admin.json.ytd)).toEqual(["accruedRevenueCents", "collectedCents", "directCostsCents", "financialCostsCents", "grossMarginCents", "grossMarginPct", "otherIncomeCents", "resultCents", "stripeFeesCents", "stripeFeesPct", "structureCostsCents", "through"]);
    expect(keys(admin.json.commercial)).toEqual(["label", "metrics", "topCompanies"]);
    expect(keys(admin.json.commercial.metrics)).toEqual(["arrCents", "available", "churn", "collected", "currency", "mrrCents", "payingCompanies", "windowDays"]);
    expect(keys(admin.json.commercial.topCompanies)).toEqual(["complete", "days", "items"]);
    expect(keys(admin.json.commercial.topCompanies.items[0])).toEqual(["billedCents", "displayName", "key", "kind", "marginCents", "marginComplete", "totalCostCents"]);
    const reader = await call("GET", "/analytics/revenue-margin?year=2026", READER);
    expect(reader.json.commercial.metrics.mrrCents).toBe(50_000);
    expect(reader.json.commercial.topCompanies).toBeNull();
    // Con finance:read pero sin billing:read no se ven las métricas comerciales (como /revenue/metrics)
    expect((await call("GET", "/analytics/revenue-margin?year=2026", READ)).json.commercial.metrics).toBeNull();
    expect((await call("GET", "/analytics/revenue-margin?year=1999", READ)).status).toBe(400);

    const c = await call("GET", "/analytics/conversion-health?from=2026-09-01&to=2026-10-31", READ);
    expect(keys(c.json)).toEqual(["asOf", "commercialFunnel", "from", "months", "notes", "to", "totals", "truncated"]);
    expect(keys(c.json.months[0])).toEqual(["chargeToAvailableDays", "collectedPct", "dsoDays", "failedPayments", "inBankPct", "invoices", "label", "month", "payoutToBankDays", "settledPct", "stripe"]);
    expect(keys(c.json.months[1].stripe)).toEqual(["chargesCents", "chargesWithoutInvoice", "disputesCents", "disputesPct", "refundsCents", "refundsPct"]);
    expect(keys(c.json.totals)).toEqual(["chargeToAvailableDays", "collectedPct", "dsoDays", "failedPayments", "inBankPct", "invoices", "overdueUnpaid", "payoutToBankDays", "settledPct", "stripe"]);
    expect(c.json.months[1].failedPayments).toBeNull();
  });

  it("CSV de cada informe: cabeceras, BOM y nombre; informe desconocido 400", async () => {
    const reports: Array<[string, string]> = [
      ["pnl.csv?from=2026-10-01&to=2026-10-31", "cuenta-de-resultados-2026-10-01-2026-10-31.csv"],
      ["balance.csv?date=2026-10-31", "balance-2026-10-31.csv"],
      ["cashflow.csv?from=2026-10-01&to=2026-10-31&forecastDays=30", "tesoreria-2026-10-01-2026-10-31.csv"],
      ["aging.csv?side=payable&date=2026-10-31", "antiguedad-pagos-2026-10-31.csv"],
      ["expenses.csv?from=2026-10-01&to=2026-10-31&groupBy=category", "gastos-category-2026-10-01-2026-10-31.csv"],
      ["daily.csv?date=2026-10-31", "control-diario-2026-10-31.csv"],
      ["revenue-margin.csv?year=2026", "revenue-margin-2026.csv"],
      ["conversion-health.csv?from=2026-09-01&to=2026-10-31", "conversion-health-2026-09-01-2026-10-31.csv"],
    ];
    for (const [p, name] of reports) {
      const r = await call("GET", `/reports/${p}`, READ);
      expect([p, r.status]).toEqual([p, 200]);
      expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(r.headers.get("content-disposition")).toBe(`attachment; filename="${name}"`);
      expect(r.text.charCodeAt(0)).toBe(0xfeff);
      expect(r.text).toContain(";");
    }
    expect((await call("GET", "/reports/otro.csv", READ)).status).toBe(400);
    expect((await call("GET", "/reports/aging.csv", READ)).status).toBe(400);
  });

  it("marca de coste directo: finance:expenses; GET /categories con isDirectCost y directCost", async () => {
    const list = await call("GET", "/categories", READ);
    const hosting = list.json.items.find((c: { id: number }) => c.id === hostingId);
    expect(keys(hosting)).toEqual(["accountCode", "active", "defaultTaxRateBp", "directCost", "id", "isDirectCost", "name"]);
    expect(hosting).toMatchObject({ isDirectCost: null, directCost: true });
    expect((await call("PATCH", `/categories/${hostingId}`, READ, { isDirectCost: false })).status).toBe(403);
    const off = await call("PATCH", `/categories/${hostingId}`, WRITE, { isDirectCost: false });
    expect(off.status).toBe(200);
    expect(off.json.item).toMatchObject({ id: hostingId, isDirectCost: false, directCost: false });
    const back = await call("PATCH", `/categories/${hostingId}`, WRITE, { isDirectCost: null, name: "Hosting e infraestructura en la nube" });
    expect(back.json.item).toMatchObject({ isDirectCost: null, directCost: true });
    expect((await call("PATCH", "/categories/999", WRITE, { isDirectCost: true })).status).toBe(404);
    expect((await call("PATCH", `/categories/${hostingId}`, WRITE, { isDirectCost: "sí" })).status).toBe(400);
  });
});
