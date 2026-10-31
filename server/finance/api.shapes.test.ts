/**
 * Formas de respuesta que consume el CRM (anexo vinculante CRM-ESPERA, fase 1A): resumen, sincronización, plan
 * contable, diarios, asientos (`entryDate`, `debitCents`, líneas con `accountName`), sumas y saldos con `totals`, mayor
 * con `openingCents` y `balanceCents`, ejercicios con sus periodos anidados. También el permiso de alta de ejercicio
 * (solo billing:write) frente a cerrar/reabrir (administración).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type Scope } from "../controlPlane/auth";
import type { ValidSession } from "../controlPlane/operatorAuth";
import { requestIdMiddleware } from "../_core/ops/requestContext";
import { lineOf, totals } from "../invoicing/rules";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { FiscalParty } from "../invoicing/types";
import { createFinanceRouter } from "./api";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { seededPlan } from "./testkit";

const WRITE = "ci-only-placeholder-not-a-secret-shp-w";
const CSRF = "csrf-de-prueba-0987654321";
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-admin-000000000000": { role: "admin", scopes: ["billing:read", "billing:write"] },
  "sesion-comercial-000000000": { role: "sales", scopes: ["billing:read", "billing:write"] },
};
const ADMIN = "sesion-admin-000000000000";
const SALES = "sesion-comercial-000000000";
const keys = (o: object) => Object.keys(o).sort();

describe("API /cp/v1/finance: formas que espera el CRM", () => {
  let server: http.Server;
  let base: string;
  const invoices = new MemoryInvoicingStore();
  const svc = new FinanceService({ store: new MemoryFinanceStore(seededPlan()), invoices, now: () => Date.UTC(2026, 9, 30, 10) });

  beforeAll(async () => {
    const lines = [lineOf(1, "Plan", 1, 100_000, 2100)];
    await invoices.insertDraft({ sourceKey: "external:1:2026-10", kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: "2026-10-01", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: 0, lines });
    await invoices.issue({ id: 1, seriesCode: "EB", issueDate: "2026-10-02", issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: 0 });
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    const fake = (t: string) => {
      const s = SESSIONS[t];
      return s ? ({ operator: { id: 1, username: t.split("-")[1], displayName: t, role: s.role, status: "active" }, session: { id: `${t}-id-0000000000`, operatorId: 1, csrfToken: CSRF }, scopes: s.scopes } as unknown as ValidSession) : null;
    };
    app.use(authenticate([{ id: "integracion", sha256: hashToken(WRITE), scopes: ["billing:read", "billing:write"], actorType: "crm" }], undefined, { operators: { validateSession: async (t: string) => fake(t) }, allowedOrigins: new Set() }));
    app.use("/cp/v1/finance", createFinanceRouter(svc));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/finance`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = async (method: string, p: string, who: string, body?: unknown) => {
    const headers: Record<string, string> = who.startsWith("sesion-") ? { cookie: `be_cp_session=${who}`, "x-csrf-token": CSRF } : { authorization: `Bearer ${who}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, json: (await res.json()) as any };
  };

  it("alta de ejercicio con billing:write (sin rol de administración); cerrar y reabrir, solo administración", async () => {
    const fy = await call("POST", "/fiscal-years", WRITE, { year: 2026 });
    expect(fy.status).toBe(201);
    expect(fy.json.item).toMatchObject({ year: 2026, status: "open", closedAt: null, closedBy: null });
    expect(fy.json.item.periods[0]).toEqual({ year: 2026, month: 1, status: "open", closedAt: null, closedBy: null });
    expect((await call("POST", "/periods/2026/1/close", SALES)).status).toBe(403);
    expect((await call("POST", "/periods/2026/1/close", WRITE)).status).toBe(403);
    expect((await call("POST", "/periods/2026/1/close", ADMIN)).status).toBe(200);
    expect((await call("POST", "/periods/2026/1/reopen", SALES)).status).toBe(403);
    expect((await call("POST", "/periods/2026/1/reopen", ADMIN)).status).toBe(200);
    expect((await call("POST", "/fiscal-years/2026/close", SALES)).status).toBe(403);
    const list = await call("GET", "/fiscal-years", WRITE);
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0].periods).toHaveLength(12);
    for (const k of ["year", "status", "closedAt", "closedBy", "periods"]) expect(list.json.items[0]).toHaveProperty(k);
  });

  it("plan contable (con parentCode) y diarios", async () => {
    const acc = await call("GET", "/accounts", WRITE);
    for (const k of ["code", "name", "type", "parentCode", "isPostable", "active"]) expect(acc.json.items[0]).toHaveProperty(k);
    const created = await call("POST", "/accounts", ADMIN, { code: "57200001", name: "BBVA", parentCode: "572" });
    expect(created.status).toBe(201);
    expect(created.json.item).toMatchObject({ code: "57200001", name: "BBVA", type: "asset", parentCode: "572", isPostable: true, active: true });
    expect((await call("POST", "/accounts", ADMIN, { code: "57200002", name: "X", parentCode: "430" })).status).toBe(422);
    expect((await call("PATCH", "/accounts/57200001", ADMIN, { active: false })).json.item.active).toBe(false);
    expect((await call("PATCH", "/accounts/57200001", ADMIN, { name: "BBVA cuenta", active: true })).json.item).toMatchObject({ name: "BBVA cuenta", active: true });
    expect((await call("GET", "/journals", WRITE)).json.items[0]).toEqual({ code: "GEN", name: "General" });
  });

  it("sincronización: { posted, skipped, errors[{ invoiceId, message }] } y estado", async () => {
    expect((await call("GET", "/sync/status", WRITE)).json).toEqual({ lastRunAt: null, lastRunBy: null, pending: 1, synced: 0, lastResult: null });
    const r = await call("POST", "/sync/invoices", SALES, {});
    expect(r.json).toMatchObject({ posted: 1, skipped: 0, errors: [] });
    const st = (await call("GET", "/sync/status", WRITE)).json;
    expect(keys(st)).toEqual(["lastResult", "lastRunAt", "lastRunBy", "pending", "synced"]);
    expect(st).toMatchObject({ lastRunBy: "operator:comercial", pending: 0, synced: 1 });
    expect(typeof st.lastRunAt).toBe("number");
  });

  it("asientos: lista paginada con entryDate y debitCents; ficha con líneas y accountName", async () => {
    const created = await call("POST", "/entries", SALES, { date: "2026-10-05", journal: "COM", description: "Hosting", lines: [{ accountCode: "629", debitCents: 10_000, creditCents: 0, description: "Servidor" }, { accountCode: "472", debitCents: 2_100, creditCents: 0, description: null }, { accountCode: "410", debitCents: 0, creditCents: 12_100, description: null }], post: true });
    expect(created.status).toBe(201);
    const item = created.json.item;
    for (const k of ["id", "year", "number", "journalCode", "entryDate", "description", "origin", "sourceKey", "status", "reversesEntryId", "reversedByEntryId", "createdBy", "postedBy", "postedAt", "createdAt", "debitCents", "lines"]) expect(item).toHaveProperty(k);
    expect(item).toMatchObject({ entryDate: "2026-10-05", debitCents: 12_100, status: "posted", journalCode: "COM" });
    expect(item).not.toHaveProperty("date");
    expect(item.lines[0]).toMatchObject({ lineNo: 1, accountCode: "629", accountName: "Otros servicios", debitCents: 10_000, creditCents: 0, description: "Servidor", costCenterId: null, supplierId: null });

    const list = await call("GET", "/entries?limit=1&offset=0", WRITE);
    expect(keys(list.json)).toEqual(["items", "total"]);
    expect(list.json.total).toBe(2);
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0]).toHaveProperty("debitCents");
    const detail = await call("GET", `/entries/${item.id}`, WRITE);
    expect(detail.json.item.lines.map((l: any) => l.accountName)).toEqual(["Otros servicios", "Hacienda Pública, IVA soportado", "Acreedores por prestaciones de servicios"]);
    const rev = await call("POST", `/entries/${item.id}/reverse`, SALES, { date: "2026-10-06", reason: "Duplicado" });
    expect(rev.json.item).toMatchObject({ origin: "reversal", entryDate: "2026-10-06", debitCents: 12_100, reversesEntryId: item.id });
  });

  it("sumas y saldos con totals y mayor con openingCents y balanceCents", async () => {
    const tb = (await call("GET", "/trial-balance?from=2026-01-01&to=2026-12-31", WRITE)).json;
    for (const k of ["code", "name", "type", "debitCents", "creditCents", "balanceCents"]) expect(tb.items[0]).toHaveProperty(k);
    expect(tb.totals).toMatchObject({ debitCents: tb.totals.creditCents });
    const lg = (await call("GET", "/ledger/629?from=2026-10-06&to=2026-12-31", WRITE)).json;
    expect(lg.account).toMatchObject({ code: "629", name: "Otros servicios", type: "expense" });
    expect(lg.openingCents).toBe(10_000);
    expect(lg.items).toHaveLength(1);
    expect(keys(lg.items[0])).toEqual(["balanceCents", "creditCents", "debitCents", "description", "entryDate", "entryId", "entryNumber", "journalCode", "year"]);
    expect(lg.items[0]).toMatchObject({ entryDate: "2026-10-06", creditCents: 10_000, balanceCents: 0 });
  });

  it("resumen plano; lo de la fase 1B en null", async () => {
    const s = (await call("GET", "/summary", WRITE)).json;
    expect(keys(s)).toEqual(["asOf", "bankBalanceCents", "banks", "cash", "cashBalanceCents", "expensesMonthCents", "expensesYearCents", "incomeMonthCents", "incomeYearCents", "payablesCents", "resultYearCents", "stripeBalanceCents", "vatInputQuarterCents", "vatOutputQuarterCents"]);
    expect(s).toMatchObject({ asOf: "2026-10-30", bankBalanceCents: null, cashBalanceCents: null, payablesCents: null, vatInputQuarterCents: null, banks: null, cash: null, incomeMonthCents: 100_000, incomeYearCents: 100_000, vatOutputQuarterCents: 21_000, expensesMonthCents: 0, resultYearCents: 100_000 });
  });
});
