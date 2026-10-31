/**
 * API de Stripe y conciliación (fase 2) con Express real y la autenticación real del plano de control: permisos
 * (lectura billing:read; importar billing:write, también token de servicio; contabilizar, vincular y revisar solo con
 * sesión de operador; configuración solo rol admin|superadmin), cuerpo grande solo en la importación, y las formas
 * EXACTAS que consume el CRM. Solo datos sintéticos.
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
import { createFinanceRouter } from "./api";
import { FINANCE_UPLOAD_PATHS } from "./opsApi";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { FinanceStripeService } from "./stripeService";
import { ownInvoicesFromStore } from "./ownInvoices";
import { MemoryFinanceStripeStore } from "./stripeStore";
import { seededOps, seededPlan, stripeBalanceSample, stripePayoutsSample } from "./testkit";

const READ = "ci-only-placeholder-not-a-secret-str-r";
const WRITE = "ci-only-placeholder-not-a-secret-str-w";
const CSRF = "csrf-de-prueba-5566778899";
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-admin-000000000000": { role: "admin", scopes: ["billing:read", "billing:write"] },
  "sesion-comercial-000000000": { role: "sales", scopes: ["billing:read", "billing:write"] },
  "sesion-lectura-00000000000": { role: "readonly", scopes: ["billing:read"] },
};
const ADMIN = "sesion-admin-000000000000";
const SALES = "sesion-comercial-000000000";
const RO = "sesion-lectura-00000000000";
const T = Date.UTC(2026, 9, 30, 10);
const keys = (o: object) => Object.keys(o).sort();
const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("API /cp/v1/finance, fase 2: Stripe y conciliación", () => {
  let server: http.Server;
  let base: string;
  const ledger = new MemoryFinanceStore(seededPlan());
  const finance = new FinanceService({ store: ledger, now: () => T });
  const opsStore = new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => T });
  const invoices = new MemoryInvoicingStore();
  const stripe = new FinanceStripeService({ store: new MemoryFinanceStripeStore(), finance, ops: opsStore, ledger, invoices: ownInvoicesFromStore(invoices), now: () => T });
  ops.useReconciliation(stripe);
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await finance.createFiscalYear(2026, { by: "test", requestId: null });
    ids.bank = (await ops.createBankAccount({ name: "CaixaBank" }, { by: "test", requestId: null })).id;
    const lines = [lineOf(1, "Plan", 1, 10_000, 2100)];
    const PARTY = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
    const { invoice } = await invoices.insertDraft({ sourceKey: "external:1:2026-10", kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: "2026-10-01", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: T, lines });
    await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: "2026-10-01", issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: T });
    await invoices.setPayment(invoice.id, { paymentStatus: "paid", paymentRef: "stripe:in:in_test_1", paidAt: T }, T);
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json({ limit: "256kb", type: (req) => !FINANCE_UPLOAD_PATHS.test(req.url ?? "") && String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json") }));
    const fake = (t: string) => {
      const s = SESSIONS[t];
      return s ? ({ operator: { id: 1, username: t.split("-")[1], displayName: t, role: s.role, status: "active" }, session: { id: `${t}-id-0000000000`, operatorId: 1, csrfToken: CSRF }, scopes: s.scopes } as unknown as ValidSession) : null;
    };
    app.use(
      authenticate(
        [
          { id: "lector", sha256: hashToken(READ), scopes: ["billing:read"], actorType: "crm" },
          { id: "integracion", sha256: hashToken(WRITE), scopes: ["billing:read", "billing:write"], actorType: "crm" },
        ],
        undefined,
        { operators: { validateSession: async (t: string) => fake(t) }, allowedOrigins: new Set() },
      ),
    );
    app.use("/cp/v1/finance", createFinanceRouter(finance, ops, stripe));
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
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  it("configuración: lectura con billing:read; cambiarla solo administración con sesión", async () => {
    const g = await call("GET", "/stripe/settings", READ);
    expect(g.json).toEqual({ item: { stripeFeeVat: "exempt", feeVatRateBp: 2100, stripePayoutBankAccountId: null, disputeAccountCode: "430", updatedBy: null, updatedAt: null } });
    const body = { stripeFeeVat: "exempt", feeVatRateBp: 2100, stripePayoutBankAccountId: ids.bank, disputeAccountCode: "430" };
    expect((await call("PATCH", "/stripe/settings", WRITE, body)).status).toBe(403);
    const sales = await call("PATCH", "/stripe/settings", SALES, body);
    expect(sales.status).toBe(403);
    expect(sales.json.error).toBe("forbidden_role");
    const ok = await call("PATCH", "/stripe/settings", ADMIN, body);
    expect(ok.json.item).toMatchObject({ stripePayoutBankAccountId: ids.bank, updatedBy: "operator:admin" });
    expect((await call("PATCH", "/stripe/settings", ADMIN, { stripeFeeVat: "otro" })).status).toBe(400);
  });

  it("importación: billing:write (también token de servicio), fichero grande permitido, forma exacta; repetida = 409", async () => {
    const body = { kind: "balance", filename: "balance.csv", contentBase64: b64(stripeBalanceSample()) };
    expect((await call("POST", "/stripe/imports", RO, body)).status).toBe(403);
    const r = await call("POST", "/stripe/imports", WRITE, body);
    expect(r.status).toBe(201);
    expect(keys(r.json.item)).toEqual(["createdAt", "duplicates", "errors", "filename", "id", "importedBy", "inserted", "kind", "nonEur", "problems", "refreshed", "rows", "sha256"]);
    expect(r.json.item).toMatchObject({ id: 1, rows: 9, inserted: 9, duplicates: 0, nonEur: 1, errors: 0 });
    expect((await call("POST", "/stripe/imports", WRITE, body)).status).toBe(409);
    // Más de 256 kB de JSON: la ruta de importación tiene su propio límite
    const big = `${stripeBalanceSample()}\n${" ".repeat(400_000)}`;
    expect((await call("POST", "/stripe/imports", WRITE, { kind: "balance", filename: "grande.csv", contentBase64: b64(big) })).json.item).toMatchObject({ inserted: 0, duplicates: 9 });
    expect((await call("POST", "/stripe/imports", WRITE, { kind: "payouts", filename: "p.csv", contentBase64: b64(stripePayoutsSample()) })).status).toBe(201);
    const list = await call("GET", "/stripe/imports", READ);
    expect(keys(list.json)).toEqual(["items", "total"]);
    expect(list.json.total).toBe(3);
  });

  it("contabilizar: solo personas; resultado { posted, skipped, errors, truncated }", async () => {
    expect((await call("POST", "/stripe/post", WRITE, {})).status).toBe(403);
    expect((await call("POST", "/stripe/post", RO, {})).status).toBe(403);
    const r = await call("POST", "/stripe/post", SALES, { until: "2026-10-31" });
    expect(r.json).toEqual({ posted: 7, skipped: 1, errors: [], truncated: false });
    expect((await call("POST", "/stripe/post", SALES, {})).json).toMatchObject({ posted: 0 });
  });

  it("transacciones, payouts y resumen: formas exactas", async () => {
    const t = await call("GET", "/stripe/transactions?type=charge&from=2026-10-01&to=2026-10-31&limit=10&offset=0", READ);
    expect(keys(t.json)).toEqual(["items", "total"]);
    expect(t.json.total).toBe(3);
    expect(keys(t.json.items[0])).toEqual([
      "availableOn", "balanceTransactionId", "chargeId", "createdOn", "currency", "customerEmail", "description", "entryId", "feeCents", "grossCents", "id", "invoiceRef", "issue", "issueDetail", "issueNote", "issueReviewedAt", "issueReviewedBy",
      "netCents", "ownInvoiceId", "ownInvoiceNumber", "payoutArrivalOn", "payoutId", "rawType", "sourceId", "status", "stripePayoutId", "type",
    ]);
    expect((await call("GET", "/stripe/transactions?issue=open", READ)).json.total).toBe(4);
    expect((await call("GET", "/stripe/transactions?payout=po_test_1&status=posted", READ)).json.total).toBe(5);
    expect((await call("GET", "/stripe/transactions?type=nada", READ)).status).toBe(400);
    const p = await call("GET", "/stripe/payouts?status=paid&from=2026-10-01&to=2026-10-31", READ);
    expect(p.json.total).toBe(1);
    expect(keys(p.json.items[0])).toEqual(["amountCents", "arrivalOn", "bankBookingDate", "bankLinkedAt", "bankMovementId", "createdOn", "currency", "description", "differenceCents", "entryId", "feeCents", "id", "origin", "reversalEntryId", "status", "stripePayoutId", "transactionsCents", "transactionsCount"]);
    expect(p.json.items[0]).toMatchObject({ stripePayoutId: "po_test_1", amountCents: 11_350, transactionsCents: 11_350, differenceCents: 0, bankMovementId: null });
    const s = await call("GET", "/stripe/summary", READ);
    expect(keys(s.json)).toEqual(["asOf", "balanceDifferenceCents", "balancePendingCents", "disputesOpen", "feesMonthCents", "grossMonthCents", "importedBalanceCents", "lastImportAt", "netMonthCents", "payoutsMonthCents", "payoutsWithoutBank", "refundsMonthCents", "unmatchedTransactions"]);
    expect(s.json).toMatchObject({ balancePendingCents: 0, payoutsWithoutBank: 1 });
    expect((await call("GET", "/summary", READ)).json.stripeBalanceCents).toBe(0);
  });

  it("conciliación: vínculo payout ↔ banco con sesión, vista por payout y por factura, revisión de incidencias", async () => {
    await ops.importStatement({ bankAccountId: ids.bank, format: "csv", filename: "e.csv", contentBase64: b64("Fecha;Importe;Concepto\n2026-10-09;113,50;STRIPE PAYMENTS"), mapping: { delimiter: ";", headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd", decimal: "," } }, { by: "test", requestId: null });
    const mov = (await ops.movements({})).items[0];
    const sugg = await call("GET", `/bank-movements/${mov.id}/suggestions`, READ);
    expect(sugg.json.items[0]).toEqual({ type: "stripe_payout", payoutId: 1, stripePayoutId: "po_test_1", date: "2026-10-08", amountCents: 11_350, reasons: ["Importe exacto", "Llegada a 1 día hábil", "«STRIPE» en el concepto"] });
    expect((await call("POST", "/reconciliation/payouts/1/link-bank", WRITE, { bankMovementId: mov.id })).status).toBe(403);
    const link = await call("POST", "/reconciliation/payouts/1/link-bank", SALES, { bankMovementId: mov.id });
    expect(link.status).toBe(200);
    expect(link.json.item).toMatchObject({ bankMovementId: mov.id, bankBookingDate: "2026-10-09", bankMovement: { id: mov.id, amountCents: 11_350 } });
    const view = await call("GET", "/reconciliation/payouts/1", READ);
    expect(keys(view.json.item)).toEqual(["amountCents", "arrivalOn", "bankBookingDate", "bankLinkedAt", "bankMovement", "bankMovementId", "createdOn", "currency", "description", "differenceCents", "entryId", "feeCents", "id", "origin", "reversalEntryId", "status", "stripePayoutId", "transactions", "transactionsCents", "transactionsCount"]);
    expect((await call("POST", "/reconciliation/payouts/1/unlink-bank", SALES)).json.item.bankMovementId).toBeNull();
    expect((await call("POST", `/bank-movements/${mov.id}/match`, SALES, { type: "stripe_payout", payoutId: 1 })).json.item).toMatchObject({ status: "matched", matchType: "stripe_payout", matchId: 1, entryId: null });

    const inv = await call("GET", "/reconciliation/invoices?from=2026-10-01&to=2026-10-31&q=EB", READ);
    expect(keys(inv.json)).toEqual(["items", "total"]);
    expect(keys(inv.json.items[0])).toEqual(["charges", "collectedCents", "companyId", "customerName", "dates", "feesCents", "invoiceId", "issueDate", "issues", "number", "paymentRef", "paymentStatus", "status", "totalCents", "transfers"]);
    expect(keys(inv.json.items[0].dates)).toEqual(["availableOn", "bankDate", "chargeDate", "invoiceDate", "payoutDate"]);
    expect(keys(inv.json.items[0].charges[0])).toEqual(["availableOn", "balanceTransactionId", "createdOn", "entryId", "feeCents", "grossCents", "id", "issue", "issueReviewedAt", "netCents", "payout", "status", "type"]);
    expect(keys(inv.json.items[0].charges[0].payout)).toEqual(["arrivalOn", "bankBookingDate", "bankMovementId", "entryId", "id", "status", "stripePayoutId"]);
    expect((await call("GET", "/reconciliation/invoices?status=raro", READ)).status).toBe(400);

    const c2 = (await call("GET", "/stripe/transactions?q=txn_test_c2", READ)).json.items[0];
    expect((await call("POST", `/reconciliation/transactions/${c2.id}/review`, WRITE, { note: "Revisado" })).status).toBe(403);
    expect((await call("POST", `/reconciliation/transactions/${c2.id}/review`, SALES, { note: "Revisado con el cliente" })).json.item).toMatchObject({ issueNote: "Revisado con el cliente", issueReviewedBy: "operator:comercial" });
    expect((await call("GET", "/reconciliation/payouts/999", READ)).json).toEqual({ error: "not_found", message: "Payout no encontrado" });
  });
});
