/**
 * API de operaciones (fase 1B) con Express real y la autenticación real del plano de control: permisos (lectura con
 * billing:read; gestión con billing:write, también con token de servicio; contabilizar o revertir solo con sesión de
 * operador) y las formas EXACTAS que consume el CRM (anexo CRM-ESPERA, secciones 1B y resumen completo). El analizador
 * JSON general es el mismo que el del plano de control (256 kB, salvo adjuntos y extractos).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type Scope } from "../controlPlane/auth";
import type { ValidSession } from "../controlPlane/operatorAuth";
import { requestIdMiddleware } from "../_core/ops/requestContext";
import { createFinanceRouter } from "./api";
import { FINANCE_UPLOAD_PATHS } from "./opsApi";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MemoryFinanceStore } from "./store";
import { norma43Sample, seededOps, seededPlan } from "./testkit";

const READ = "ci-only-placeholder-not-a-secret-ops-r";
const WRITE = "ci-only-placeholder-not-a-secret-ops-w";
const CSRF = "csrf-de-prueba-1122334455";
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-comercial-000000000": { role: "sales", scopes: ["billing:read", "billing:write"] },
  "sesion-lectura-00000000000": { role: "readonly", scopes: ["billing:read"] },
};
const SALES = "sesion-comercial-000000000";
const RO = "sesion-lectura-00000000000";
const IBAN = "ES9121000418450200051332";
const keys = (o: object) => Object.keys(o).sort();
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

describe("API /cp/v1/finance, fase 1B: permisos y formas del CRM", () => {
  let server: http.Server;
  let base: string;
  const ledger = new MemoryFinanceStore(seededPlan());
  const finance = new FinanceService({ store: ledger, now: () => Date.UTC(2026, 9, 30, 10) });
  const ops = new FinanceOpsService({ store: new MemoryFinanceOpsStore(seededOps()), finance, ledger, now: () => Date.UTC(2026, 9, 30, 10) });
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await finance.createFiscalYear(2026, { by: "test", requestId: null });
    const app = express();
    app.use(requestIdMiddleware);
    // Igual que el plano de control (server/controlPlane/api.ts)
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
    app.use("/cp/v1/finance", createFinanceRouter(finance, ops));
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
    const buf = Buffer.from(await res.arrayBuffer());
    let json: any = null;
    try {
      json = JSON.parse(buf.toString("utf8"));
    } catch {
      json = null;
    }
    return { status: res.status, json, buf, headers: res.headers };
  };

  it("catálogos: { items } con las formas del CRM; gestión con billing:write (también token de servicio)", async () => {
    const cc = await call("GET", "/cost-centers", READ);
    expect(keys(cc.json)).toEqual(["items"]);
    expect(keys(cc.json.items[0])).toEqual(["active", "code", "id", "name"]);
    expect((await call("POST", "/cost-centers", RO, { code: "MKT", name: "Marketing" })).status).toBe(403);
    const created = await call("POST", "/cost-centers", WRITE, { code: "mkt", name: "Marketing" });
    expect(created.status).toBe(201);
    expect(created.json.item).toEqual({ id: 2, code: "MKT", name: "Marketing", active: true });
    expect((await call("PATCH", "/cost-centers/2", WRITE, { active: false })).json.item.active).toBe(false);
    expect((await call("PATCH", "/cost-centers/2", WRITE, { code: "MKT2", name: "Marketing digital" })).json.item).toMatchObject({ code: "MKT2", name: "Marketing digital" });

    const cats = await call("GET", "/categories", READ);
    expect(keys(cats.json.items[0])).toEqual(["accountCode", "active", "defaultTaxRateBp", "id", "name"]);
    const cat = await call("POST", "/categories", WRITE, { name: "Dietas", accountCode: "629", defaultTaxRateBp: 1000 });
    expect(cat.json.item).toMatchObject({ name: "Dietas", accountCode: "629", defaultTaxRateBp: 1000, active: true });
    expect((await call("POST", "/categories", WRITE, { name: "Ventas", accountCode: "705", defaultTaxRateBp: null })).json).toMatchObject({ error: "invalid_account" });
    ids.category = cats.json.items.find((c: any) => c.name === "Hosting e infraestructura en la nube").id;
  });

  it("proveedores: lista paginada (limit hasta 500), ficha completa, NIF validado, active", async () => {
    const bad = await call("POST", "/suppliers", WRITE, { name: "Malo", taxId: "B12345675" });
    expect(bad.status).toBe(400);
    expect(bad.json).toEqual({ error: "invalid_input", message: "El NIF/CIF no es válido (revisa la letra o el dígito de control)" });
    const s = await call("POST", "/suppliers", WRITE, { name: "Hosting Nube SL", legalName: "HOSTING NUBE, S.L.", taxId: "B12345674", country: "ES", address: null, email: "facturas@hosting.example", phone: null, iban: IBAN, paymentTermsDays: 30, defaultCategoryId: ids.category, defaultCostCenterId: null, accountCode: "410", notes: null });
    expect(s.status).toBe(201);
    expect(keys(s.json.item)).toEqual(["accountCode", "active", "address", "country", "createdAt", "createdBy", "defaultCategoryId", "defaultCostCenterId", "email", "iban", "id", "legalName", "name", "notes", "paymentTermsDays", "phone", "taxId"]);
    ids.supplier = s.json.item.id;
    const list = await call("GET", "/suppliers?q=nube&active=true&limit=500&offset=0", READ);
    expect(keys(list.json)).toEqual(["items", "total"]);
    expect(list.json.total).toBe(1);
    expect((await call("GET", "/suppliers?limit=501", READ)).status).toBe(400);
    expect((await call("GET", `/suppliers/${ids.supplier}`, READ)).json.item.name).toBe("Hosting Nube SL");
    expect((await call("PATCH", `/suppliers/${ids.supplier}`, WRITE, { active: false })).json.item.active).toBe(false);
    expect((await call("PATCH", `/suppliers/${ids.supplier}`, WRITE, { active: true, phone: "+34 600 000 000" })).json.item).toMatchObject({ active: true, phone: "+34 600 000 000" });
    expect((await call("GET", "/suppliers/999", READ)).status).toBe(404);
  });

  it("bancos y caja: alta con subcuenta (billing:write, sin administración) y saldo", async () => {
    const b = await call("POST", "/bank-accounts", WRITE, { name: "CaixaBank", iban: IBAN, bankName: "CaixaBank", openingDate: "2026-01-01" });
    expect(b.status).toBe(201);
    expect(b.json.item).toMatchObject({ name: "CaixaBank", iban: IBAN, bankName: "CaixaBank", accountCode: "57200001", openingDate: "2026-01-01", active: true, balanceCents: 0 });
    ids.bank = b.json.item.id;
    const list = await call("GET", "/bank-accounts", READ);
    for (const k of ["id", "name", "iban", "bankName", "accountCode", "openingDate", "active", "balanceCents"]) expect(list.json.items[0]).toHaveProperty(k);
    expect((await call("PATCH", `/bank-accounts/${ids.bank}`, WRITE, { active: true })).json.item.active).toBe(true);
    const c = await call("POST", "/cash-accounts", WRITE, { name: "Caja" });
    expect(c.json.item).toMatchObject({ name: "Caja", accountCode: "57000001", balanceCents: 0 });
    ids.cash = c.json.item.id;
    for (const k of ["id", "name", "accountCode", "balanceCents"]) expect((await call("GET", "/cash-accounts", READ)).json.items[0]).toHaveProperty(k);
  });

  it("gastos: alta (gestión), registrar/pagar/anular solo con sesión; formas de lista, ficha y pagos", async () => {
    const body = { kind: "invoice", supplierId: ids.supplier, categoryId: ids.category, costCenterId: null, invoiceNumber: "F-2026-10", invoiceDate: "2026-10-01", accrualDate: null, dueDate: null, description: "Servidores", baseCents: 100_000, taxRateBp: 2100, deductibleBp: 10_000, withholdingRateBp: 0, rectifiesExpenseId: null };
    expect((await call("POST", "/expenses", RO, body)).status).toBe(403);
    const e = await call("POST", "/expenses", WRITE, body);
    expect(e.status).toBe(201);
    for (const k of ["id", "supplierId", "supplierName", "categoryId", "costCenterId", "invoiceNumber", "invoiceDate", "accrualDate", "dueDate", "description", "baseCents", "taxRateBp", "taxCents", "deductibleBp", "withholdingRateBp", "withholdingCents", "totalCents", "currency", "kind", "rectifiesExpenseId", "status", "entryId", "paymentStatus", "paidCents", "pendingCents", "createdBy", "createdAt"]) expect(e.json.item).toHaveProperty(k);
    expect(e.json.item).toMatchObject({ supplierName: "Hosting Nube SL", taxCents: 21_000, totalCents: 121_000, paidCents: 0, pendingCents: 121_000, dueDate: "2026-10-31", currency: "EUR", status: "draft" });
    ids.expense = e.json.item.id;
    expect((await call("PATCH", `/expenses/${ids.expense}`, WRITE, { description: "Servidores octubre" })).json.item.description).toBe("Servidores octubre");

    const svcToken = await call("POST", `/expenses/${ids.expense}/register`, WRITE);
    expect(svcToken.status).toBe(403);
    expect(svcToken.json.error).toBe("operator_session_required");
    const reg = await call("POST", `/expenses/${ids.expense}/register`, SALES);
    expect(reg.status).toBe(200);
    expect(reg.json.item).toMatchObject({ status: "registered", entryId: expect.any(Number) });
    expect((await call("PATCH", `/expenses/${ids.expense}`, WRITE, { description: "x" })).status).toBe(409);

    const payBody = { paidOn: "2026-10-15", amountCents: 21_000, method: "bank", bankAccountId: ids.bank, cashAccountId: null, reference: "TR-1" };
    expect((await call("POST", `/expenses/${ids.expense}/payments`, WRITE, payBody)).status).toBe(403);
    const pay = await call("POST", `/expenses/${ids.expense}/payments`, SALES, payBody);
    expect(pay.status).toBe(201);
    expect(keys(pay.json.item)).toEqual(expect.arrayContaining(["id", "expenseId", "paidOn", "amountCents", "method", "bankAccountId", "cashAccountId", "reference", "bankMovementId", "entryId", "status"]));
    ids.payment = pay.json.item.id;

    const detail = await call("GET", `/expenses/${ids.expense}`, READ);
    expect(keys(detail.json)).toEqual(["item", "payments"]);
    expect(detail.json.item).toMatchObject({ paymentStatus: "partial", paidCents: 21_000, pendingCents: 100_000 });
    expect(detail.json.payments).toHaveLength(1);

    const list = await call("GET", `/expenses?status=registered&paymentStatus=partial&supplier=${ids.supplier}&category=${ids.category}&from=2026-10-01&to=2026-10-31&q=F-2026&sort=supplier&dir=asc&limit=10&offset=0`, READ);
    expect(keys(list.json)).toEqual(["items", "total"]);
    expect(list.json.total).toBe(1);
    expect(list.json.items[0]).toMatchObject({ supplierName: "Hosting Nube SL", paidCents: 21_000, pendingCents: 100_000 });
    expect((await call("GET", "/expenses?due=overdue", READ)).json.total).toBe(0);
    expect((await call("GET", "/expenses?sort=amount", READ)).status).toBe(400);

    const st = await call("GET", `/suppliers/${ids.supplier}/statement?from=2026-01-01&to=2026-12-31`, READ);
    expect(keys(st.json)).toEqual(["expenses", "overdueCents", "payments", "pendingCents", "upcoming"]);
    expect(st.json.upcoming[0]).toEqual({ expenseId: ids.expense, invoiceNumber: "F-2026-10", dueDate: "2026-10-31", pendingCents: 100_000 });

    // Anular con pagos vigentes: 409; revertir el pago (solo sesión) y anular
    expect((await call("POST", `/expenses/${ids.expense}/void`, SALES, { reason: "Duplicada" })).status).toBe(409);
    expect((await call("POST", `/expense-payments/${ids.payment}/reverse`, WRITE, { reason: "Error" })).status).toBe(403);
    expect((await call("POST", `/expense-payments/${ids.payment}/reverse`, SALES, { reason: "Error" })).json.item.status).toBe("reversed");
    expect((await call("POST", `/expenses/${ids.expense}/void`, WRITE, { reason: "Duplicada" })).status).toBe(403);
    expect((await call("POST", `/expenses/${ids.expense}/void`, SALES, { reason: "Duplicada" })).json.item).toMatchObject({ status: "void", pendingCents: 0 });
  });

  it("documentos: alta en base64 (más de 256 kB pasa), lista, descarga con Content-Disposition y archivo", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(400 * 1024, 0x20)]);
    const up = await call("POST", "/documents", WRITE, { ownerType: "supplier", ownerId: ids.supplier, filename: "contrato «firmado».pdf", contentBase64: b64(pdf) });
    expect(up.status).toBe(201);
    expect(up.json.item).toMatchObject({ ownerType: "supplier", ownerId: ids.supplier, mime: "application/pdf", sizeBytes: pdf.length, archived: false });
    const bad = await call("POST", "/documents", WRITE, { ownerType: "supplier", ownerId: ids.supplier, filename: "a.pdf", contentBase64: b64("MZ...") });
    expect(bad.status).toBe(400);
    expect((await call("POST", "/documents", RO, { ownerType: "supplier", ownerId: ids.supplier, filename: "a.pdf", contentBase64: b64("%PDF-") })).status).toBe(403);
    const list = await call("GET", `/documents?ownerType=supplier&ownerId=${ids.supplier}`, READ);
    for (const k of ["id", "filename", "mime", "sizeBytes", "createdAt", "archived"]) expect(list.json.items[0]).toHaveProperty(k);
    const dl = await call("GET", `/documents/${up.json.item.id}/content`, READ);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="contrato _firmado_.pdf"; filename\*=UTF-8''contrato%20%C2%ABfirmado%C2%BB\.pdf$/);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.buf.equals(pdf)).toBe(true);
    expect((await call("POST", `/documents/${up.json.item.id}/archive`, WRITE)).json.item.archived).toBe(true);
  });

  it("recurrentes: { items }, vista previa y generación de borradores", async () => {
    const t = await call("POST", "/recurring", WRITE, { supplierId: ids.supplier, categoryId: ids.category, costCenterId: null, description: "Servidor", baseCents: 5_000, taxRateBp: 2100, deductibleBp: 10_000, withholdingRateBp: 0, frequency: "monthly", dayOfMonth: 1, startDate: "2026-10-01", endDate: null });
    expect(t.status).toBe(201);
    for (const k of ["id", "supplierId", "categoryId", "costCenterId", "description", "baseCents", "taxRateBp", "deductibleBp", "withholdingRateBp", "frequency", "dayOfMonth", "startDate", "endDate", "nextDate", "active"]) expect(t.json.item).toHaveProperty(k);
    expect((await call("GET", "/recurring", READ)).json.items).toHaveLength(1);
    const pre = await call("GET", "/recurring/preview?until=2026-11-30", READ);
    expect(keys(pre.json.items[0])).toEqual(["baseCents", "date", "description", "exists", "sourceKey", "templateId", "totalCents"]);
    expect((await call("POST", "/recurring/run", RO, { until: "2026-11-30" })).status).toBe(403);
    expect((await call("POST", "/recurring/run", WRITE, { until: "2026-11-30" })).json).toEqual({ created: 2, skipped: 0 });
    expect((await call("PATCH", `/recurring/${t.json.item.id}`, WRITE, { active: false })).json.item.active).toBe(false);
  });

  it("extractos, movimientos, sugerencias y conciliación (match/unmatch con sesión; ignore con gestión)", async () => {
    const e = await call("POST", "/expenses", WRITE, { kind: "invoice", supplierId: ids.supplier, categoryId: ids.category, invoiceNumber: "F-2026-11", invoiceDate: "2026-10-01", description: "Servidores", baseCents: 100_000, taxRateBp: 2100 });
    await call("POST", `/expenses/${e.json.item.id}/register`, SALES);
    const imp = await call("POST", "/bank-imports", WRITE, { bankAccountId: ids.bank, format: "norma43", filename: "octubre.n43", contentBase64: b64(norma43Sample()) });
    expect(imp.status).toBe(201);
    expect(imp.json.item).toMatchObject({ inserted: 4, duplicates: 0, rows: 4 });
    for (const k of ["id", "inserted", "duplicates", "rows"]) expect(imp.json.item).toHaveProperty(k);
    const dup = await call("POST", "/bank-imports", WRITE, { bankAccountId: ids.bank, format: "norma43", filename: "octubre.n43", contentBase64: b64(norma43Sample()) });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("conflict");
    expect(dup.json.message).toMatch(/ya se importó/);
    expect((await call("GET", `/bank-imports?bankAccountId=${ids.bank}`, READ)).json.items).toHaveLength(1);

    const movs = await call("GET", `/bank-movements?bankAccountId=${ids.bank}&status=pending&from=2026-10-01&to=2026-10-31&limit=50&offset=0`, READ);
    expect(keys(movs.json)).toEqual(["items", "total"]);
    expect(movs.json.total).toBe(4);
    for (const k of ["id", "bankAccountId", "importId", "bookingDate", "valueDate", "amountCents", "description", "reference", "counterparty", "balanceCents", "status", "matchType", "matchId", "entryId", "matchedBy", "matchedAt"]) expect(movs.json.items[0]).toHaveProperty(k);
    const transfer = movs.json.items.find((m: any) => m.amountCents === -121_000);
    const fee = movs.json.items.find((m: any) => m.amountCents === -350);
    const income = movs.json.items.find((m: any) => m.amountCents === 250_000);

    const sug = await call("GET", `/bank-movements/${transfer.id}/suggestions`, READ);
    expect(sug.json.items[0]).toMatchObject({ type: "expense", expenseId: e.json.item.id, expensePaymentId: null, supplierName: "Hosting Nube SL", invoiceNumber: "F-2026-11", amountCents: 121_000 });
    expect(keys(sug.json.items[0])).toEqual(["amountCents", "date", "expenseId", "expensePaymentId", "invoiceNumber", "reasons", "supplierName", "type"]);

    expect((await call("POST", `/bank-movements/${transfer.id}/match`, WRITE, { type: "expense_payment", expenseId: e.json.item.id })).status).toBe(403);
    const m = await call("POST", `/bank-movements/${transfer.id}/match`, SALES, { type: "expense_payment", expenseId: e.json.item.id });
    expect(m.json.item).toMatchObject({ status: "matched", matchType: "expense_payment", entryId: expect.any(Number) });
    expect((await call("GET", `/entries/${m.json.item.entryId}`, READ)).json.item.sourceKey).toBe(`bankmov:${transfer.id}`);
    const acc = await call("POST", `/bank-movements/${fee.id}/match`, SALES, { type: "other", accountCode: "626", description: "Comisión" });
    expect(acc.json.item).toMatchObject({ status: "matched", matchType: "other" });
    expect((await call("POST", `/bank-movements/${fee.id}/match`, SALES, { type: "expense_payment" })).status).toBe(400);
    expect((await call("POST", `/bank-movements/${income.id}/ignore`, RO)).status).toBe(403);
    expect((await call("POST", `/bank-movements/${income.id}/ignore`, WRITE)).json.item.status).toBe("ignored");
    expect((await call("POST", `/bank-movements/${income.id}/unmatch`, SALES)).json.item.status).toBe("pending");
    const un = await call("POST", `/bank-movements/${fee.id}/unmatch`, SALES);
    expect(un.json.item).toMatchObject({ status: "pending", entryId: null });
  });

  it("caja: movimientos con signo (contabiliza: solo sesión) y lista paginada", async () => {
    const body = { cashAccountId: ids.cash, movedOn: "2026-10-03", amountCents: 20_000, description: "Retirada", counterpartAccountCode: "57200001" };
    expect((await call("POST", "/cash-movements", WRITE, body)).status).toBe(403);
    const mv = await call("POST", "/cash-movements", SALES, body);
    expect(mv.status).toBe(201);
    for (const k of ["id", "cashAccountId", "movedOn", "amountCents", "description", "counterpartAccountCode", "entryId", "createdBy"]) expect(mv.json.item).toHaveProperty(k);
    const list = await call("GET", `/cash-movements?cashAccountId=${ids.cash}&limit=10&offset=0`, READ);
    expect(keys(list.json)).toEqual(["items", "total"]);
    expect(list.json.total).toBe(1);
  });

  it("resumen completo: bancos, caja, acreedores e IVA soportado rellenos", async () => {
    const s = (await call("GET", "/summary", READ)).json;
    expect(keys(s)).toEqual(["asOf", "bankBalanceCents", "banks", "cash", "cashBalanceCents", "expensesMonthCents", "expensesYearCents", "incomeMonthCents", "incomeYearCents", "payablesCents", "resultYearCents", "vatInputQuarterCents", "vatOutputQuarterCents"]);
    for (const k of ["bankBalanceCents", "cashBalanceCents", "payablesCents", "vatInputQuarterCents", "banks", "cash"]) expect(s[k]).not.toBeNull();
    expect(s.banks[0]).toEqual({ id: ids.bank, name: "CaixaBank", accountCode: "57200001", balanceCents: -121_000 - 20_000 });
    expect(s.cash[0]).toEqual({ id: ids.cash, name: "Caja", accountCode: "57000001", balanceCents: 20_000 });
    expect(s).toMatchObject({ bankBalanceCents: -141_000, cashBalanceCents: 20_000, payablesCents: 0, vatInputQuarterCents: 21_000 });
  });
});
