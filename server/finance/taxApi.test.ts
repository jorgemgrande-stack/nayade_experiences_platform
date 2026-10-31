/**
 * API de gestoría e impuestos (fase 3) con Express real y la autenticación real del plano de control: permisos
 * (lectura billing:read; borradores, obligaciones, nóminas, aplazamientos y expedientes solo con sesión de operador y
 * billing:write; configuración, reapertura y cierre del trimestre solo rol admin|superadmin), el PDF de la presentación
 * en el mismo cuerpo, 404 sin el módulo montado y las formas EXACTAS del anexo CRM-ESPERA-FASE3. Solo datos sintéticos.
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
import { FinanceTaxService } from "./taxService";
import { MemoryFinanceTaxStore } from "./taxStore";
import { fiscalInvoicesFromStore } from "./taxSources";
import { seededOps, seededPlan } from "./testkit";

const READ = "ci-only-placeholder-not-a-secret-tax-r";
const WRITE = "ci-only-placeholder-not-a-secret-tax-w";
const CSRF = "csrf-de-prueba-7788990011";
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-admin-000000000000": { role: "admin", scopes: ["billing:read", "billing:write"] },
  "sesion-comercial-000000000": { role: "sales", scopes: ["billing:read", "billing:write"] },
  "sesion-lectura-00000000000": { role: "readonly", scopes: ["billing:read"] },
};
const ADMIN = "sesion-admin-000000000000";
const SALES = "sesion-comercial-000000000";
const RO = "sesion-lectura-00000000000";
const T = Date.UTC(2026, 9, 30, 10);
const ACTOR = { by: "test", requestId: null };
const keys = (o: object) => Object.keys(o).sort();
const PDF = Buffer.from("%PDF-1.4\n% justificante sintético\n").toString("base64");

const OBLIGATION_KEYS = ["id", "model", "year", "period", "dueDate", "status", "amountCents", "result", "draftHash", "stale", "staleDiff", "presentedAt", "presentedBy", "receiptNumber", "paidAt", "paymentEntryId", "notes"];
const DRAFT_KEYS = ["boxes", "sources", "warnings", "result", "resultCents", "hash", "calculatedAt", "applies", "reason"];

async function app(withTax: boolean) {
  const ledger = new MemoryFinanceStore(seededPlan());
  const invoices = new MemoryInvoicingStore();
  const finance = new FinanceService({ store: ledger, invoices, now: () => T });
  await finance.createFiscalYear(2026, ACTOR);
  const opsStore = new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => T });
  const tax = new FinanceTaxService({ store: new MemoryFinanceTaxStore(), finance, ledger, ops: opsStore, documents: ops, invoices: fiscalInvoicesFromStore(invoices), issuer: { legalName: "EMPRESA DE PRUEBA, S.L.", taxId: "B00000000" }, now: () => T });
  ops.useTaxDocumentOwners((t, id) => tax.documentOwnerExists(t, id));
  const bank = await ops.createBankAccount({ name: "Banco" }, ACTOR);
  const party = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
  const lines = [lineOf(1, "Plan", 1, 100_000, 2100)];
  const { invoice } = await invoices.insertDraft({ sourceKey: "external:1:2026-08", kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: "2026-08-01", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: party, notes: null, createdBy: "t", createdAt: T, lines });
  await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: "2026-08-01", issuer: party, customer: party, issuedBy: "t", issuedAt: T });
  await finance.syncInvoices(ACTOR);
  const a = express();
  a.use(requestIdMiddleware);
  a.use(express.json({ limit: "256kb", type: (req) => !FINANCE_UPLOAD_PATHS.test(req.url ?? "") && String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json") }));
  const fake = (t: string) => {
    const s = SESSIONS[t];
    return s ? ({ operator: { id: 1, username: t.split("-")[1], displayName: t, role: s.role, status: "active" }, session: { id: `${t}-id-0000000000`, operatorId: 1, csrfToken: CSRF }, scopes: s.scopes } as unknown as ValidSession) : null;
  };
  a.use(
    authenticate(
      [
        { id: "lector", sha256: hashToken(READ), scopes: ["billing:read"], actorType: "crm" },
        { id: "integracion", sha256: hashToken(WRITE), scopes: ["billing:read", "billing:write"], actorType: "crm" },
      ],
      undefined,
      { operators: { validateSession: async (t: string) => fake(t) }, allowedOrigins: new Set() },
    ),
  );
  a.use("/cp/v1/finance", createFinanceRouter(finance, ops, null, withTax ? tax : null));
  const server = http.createServer(a);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/finance`, bank };
}

describe("API /cp/v1/finance/tax (fase 3)", () => {
  let server: http.Server;
  let off: http.Server;
  let base: string;
  let offBase: string;
  let bankId: number;
  beforeAll(async () => {
    const on = await app(true);
    server = on.server;
    base = on.base;
    bankId = on.bank.id;
    const o = await app(false);
    off = o.server;
    offBase = o.base;
  });
  afterAll(async () => {
    for (const s of [server, off]) {
      s?.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  const call = async (method: string, p: string, who: string, body?: unknown, root = base) => {
    const headers: Record<string, string> = who.startsWith("sesion-") ? { cookie: `be_cp_session=${who}`, "x-csrf-token": CSRF } : { authorization: `Bearer ${who}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(root + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, type: res.headers.get("content-type") };
  };

  it("sin el módulo montado: 404 (el CRM oculta el grupo)", async () => {
    expect((await call("GET", "/tax/dashboard", READ, undefined, offBase)).status).toBe(404);
    expect((await call("GET", "/tax/settings", READ, undefined, offBase)).status).toBe(404);
  });

  it("configuración: lectura con billing:read (null hasta guardarla); cambiarla solo la administración con sesión", async () => {
    const g = await call("GET", "/tax/settings", READ);
    expect(g.status).toBe(200);
    expect(keys(g.json)).toEqual(["defaults", "item", "log"]);
    expect(g.json.item).toBeNull();
    expect(g.json.defaults).toMatchObject({ legalName: "EMPRESA DE PRUEBA, S.L.", configured: false });
    expect((await call("PATCH", "/tax/settings", WRITE, { hasEmployees: true })).status).toBe(403);
    expect((await call("PATCH", "/tax/settings", SALES, { hasEmployees: true })).json.error).toBe("forbidden_role");
    expect((await call("PATCH", "/tax/settings", ADMIN, { campoRaro: 1 })).status).toBe(400);
    const p = await call("PATCH", "/tax/settings", ADMIN, { hasEmployees: true, hasProfessionalWithholdings: true });
    expect(p.status).toBe(200);
    expect(p.json.item).toMatchObject({ configured: true, version: 1, hasEmployees: true });
    const after = await call("GET", "/tax/settings", RO);
    expect(after.json.log).toHaveLength(1);
    expect(keys(after.json.log[0])).toEqual(["actor", "at", "changes", "note"]);
    expect(after.json.log[0].changes.hasEmployees).toEqual([false, true]);
  });

  it("calendario: generar exige sesión de operador con billing:write; formas de la obligación", async () => {
    expect((await call("POST", "/tax/calendar/generate", READ, { year: 2026 })).status).toBe(403);
    expect((await call("POST", "/tax/calendar/generate", WRITE, { year: 2026 })).status).toBe(403);
    expect((await call("POST", "/tax/calendar/generate", RO, { year: 2026 })).status).toBe(403);
    const g = await call("POST", "/tax/calendar/generate", SALES, { year: 2026 });
    expect(g.status).toBe(200);
    expect(keys(g.json)).toEqual(["created", "existing", "notApplicable", "retired"]);
    const c = await call("GET", "/tax/calendar?year=2026", READ);
    expect(keys(c.json)).toEqual(["items", "notApplicable"]);
    for (const k of OBLIGATION_KEYS) expect(c.json.items[0]).toHaveProperty(k);
    expect(c.json.items.some((o: { model: string }) => o.model === "SS")).toBe(true);
    expect(c.json.notApplicable.map((n: { model: string }) => n.model)).toEqual(expect.arrayContaining(["349", "115", "180"]));
    const list = await call("GET", "/tax/obligations?year=2026&model=202", READ);
    expect(list.json.items.map((o: { period: string }) => o.period)).toEqual(["1P", "2P", "3P"]);
    expect(list.json.total).toBe(3);
  });

  it("obligación: calcular, revisar, presentar con el PDF en el cuerpo, pagar; detalle con borrador y bitácora", async () => {
    const id = (await call("GET", "/tax/obligations?year=2026&model=303", READ)).json.items.find((o: { period: string }) => o.period === "3T").id;
    expect((await call("POST", `/tax/obligations/${id}/calculate`, WRITE, {})).status).toBe(403);
    const c = await call("POST", `/tax/obligations/${id}/calculate`, SALES, {});
    expect(c.status).toBe(200);
    expect(c.json.item.status).toBe("borrador");
    for (const k of DRAFT_KEYS) expect(c.json.item.draft).toHaveProperty(k);
    expect(keys(c.json.item.draft.boxes[0])).toEqual(["box", "label", "text", "valueCents"]);
    expect(c.json.item.draft.boxes.find((b: { box: string }) => b.box === "09")).toEqual({ box: "09", label: "Régimen general 21 %: cuota", valueCents: 21_000, text: expect.stringMatching(/210,00/) });
    expect(keys(c.json.item.draft.sources[0])).toEqual(["amountCents", "baseCents", "box", "date", "id", "kind", "label", "number", "ref", "taxCents", "taxId"]);
    expect(c.json.item.draft.sources[0].kind).toBe("entry");
    expect(c.json.item.draft.warnings.every((w: object) => keys(w).join() === "code,message")).toBe(true);
    expect(c.json.item.draft).toMatchObject({ result: "a_ingresar", resultCents: 21_000, applies: true, reason: null });
    expect((await call("POST", `/tax/obligations/${id}/review`, SALES, {})).json.item.status).toBe("revisado");
    const p = await call("POST", `/tax/obligations/${id}/present`, SALES, { presentedOn: "2026-10-20", receiptNumber: "2026-303-ABC", note: "Presentado por la gestoría", document: { filename: "justificante.pdf", contentBase64: PDF } });
    expect(p.status).toBe(200);
    expect(p.json.item).toMatchObject({ status: "presentado", receiptNumber: "2026-303-ABC", result: "a_ingresar", amountCents: 21_000 });
    const docs = await call("GET", `/documents?ownerType=tax_obligation&ownerId=${id}`, READ);
    expect(docs.json.items).toHaveLength(1);
    expect((await call("POST", `/tax/obligations/${id}/pay`, SALES, { paidOn: "2026-10-20", bankAccountId: bankId })).json.item).toMatchObject({ status: "pagado" });
    const d = await call("GET", `/tax/obligations/${id}`, READ);
    expect(d.json.item.log.map((l: { action: string }) => l.action)).toEqual(["generate", "calculate", "review", "present", "pay"]);
    expect(keys(d.json.item.log[0])).toEqual(["action", "actor", "at", "fromStatus", "note", "toStatus"]);
    expect(d.json.item.documents).toHaveLength(1);
    // Reabrir lo presentado: solo administración
    expect((await call("POST", `/tax/obligations/${id}/reopen`, SALES, { reason: "Error" })).status).toBe(403);
    expect((await call("POST", `/tax/obligations/${id}/reopen`, ADMIN, { reason: "Error" })).status).toBe(409);
  });

  it("marcar, vista previa (Draft directo), libros registro y ZIP", async () => {
    const id = (await call("GET", "/tax/obligations?year=2026&model=303", READ)).json.items.find((o: { period: string }) => o.period === "1T").id;
    expect((await call("POST", `/tax/obligations/${id}/mark`, SALES, { status: "pagado" })).status).toBe(400);
    expect((await call("POST", `/tax/obligations/${id}/mark`, SALES, { status: "sin_actividad", note: "Sin operaciones" })).json.item.status).toBe("sin_actividad");
    const pv = await call("GET", "/tax/models/303/preview?year=2026&period=2T", READ);
    for (const k of DRAFT_KEYS) expect(pv.json).toHaveProperty(k);
    expect(pv.json.resultCents).toBeNull();
    expect(pv.json.warnings[0].code).toBe("sin_datos");
    expect((await call("GET", "/tax/models/303/preview?year=2026&period=ANUAL", READ)).status).toBe(400);
    const csv = await call("GET", "/tax/registers/issued.csv?from=2026-07-01&to=2026-09-30", READ);
    expect(csv.type).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/EB-/);
    expect((await call("GET", "/tax/registers/received.csv?from=2026-07-01&to=2026-09-30", READ)).status).toBe(200);
    const zip = await fetch(`${base}/tax/export.zip?from=2026-07-01&to=2026-09-30`, { headers: { authorization: `Bearer ${READ}` } });
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect((await call("GET", "/tax/export.zip?from=2025-01-01&to=2026-09-30", READ)).status).toBe(400);
  });

  it("nóminas, aplazamientos, expedientes, sociedades y panel con sus formas", async () => {
    const pr = await call("POST", "/tax/payrolls", SALES, { period: "2026-07", employeeAlias: "dev-1", grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, netCents: 235_500, paymentDate: "2026-07-31" });
    expect(pr.status).toBe(201);
    expect(keys(pr.json.item)).toEqual(["bankAccountId", "employeeAlias", "entryId", "grossCents", "id", "irpfCents", "netCents", "notes", "paidOn", "paymentDate", "paymentEntryId", "period", "ssCompanyCents", "ssEmployeeCents", "status"]);
    expect((await call("POST", "/tax/payrolls", SALES, { period: "2026-07", employeeAlias: "X1234567L", grossCents: 1, irpfCents: 0, ssEmployeeCents: 0, ssCompanyCents: 0, netCents: 1 })).status).toBe(400);
    expect((await call("POST", `/tax/payrolls/${pr.json.item.id}/post`, SALES, {})).json.item.status).toBe("posted");
    expect((await call("POST", `/tax/payrolls/${pr.json.item.id}/pay`, SALES, { paidOn: "2026-07-31", bankAccountId: bankId })).json.item.status).toBe("paid");
    expect((await call("GET", "/tax/payrolls?period=2026-07", READ)).json.items).toHaveLength(1);

    // Un 111 presentado con resultado: aplazamiento
    const id111 = (await call("GET", "/tax/obligations?year=2026&model=111", READ)).json.items.find((o: { period: string }) => o.period === "3T").id;
    for (const m of ["2026-08", "2026-09"]) {
      const x = await call("POST", "/tax/payrolls", SALES, { period: m, employeeAlias: "dev-1", grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, netCents: 235_500 });
      await call("POST", `/tax/payrolls/${x.json.item.id}/post`, SALES, {});
    }
    expect((await call("POST", `/tax/obligations/${id111}/calculate`, SALES, {})).json.item.amountCents).toBe(135_000);
    await call("POST", `/tax/obligations/${id111}/present`, SALES, { presentedOn: "2026-10-20", receiptNumber: "111-3T" });
    const def = await call("POST", "/tax/deferrals", SALES, { obligationId: id111, principalCents: 135_000, interestCents: 500, reference: "APL-1", requestedOn: "2026-10-20", installments: [{ n: 1, dueDate: "2026-11-20", amountCents: 67_500 }, { n: 2, dueDate: "2026-12-20", amountCents: 67_500 }] });
    expect(def.status).toBe(201);
    expect(keys(def.json.item)).toEqual(["id", "installments", "interestCents", "model", "notes", "obligationId", "period", "principalCents", "reference", "requestedOn", "resolutionOn", "status", "year"]);
    expect(def.json.item).toMatchObject({ model: "111", period: "3T", year: 2026, status: "solicitado" });
    expect(keys(def.json.item.installments[0])).toEqual(["amountCents", "dueDate", "entryId", "n", "paidAt", "paidOn", "status"]);
    const paid = await call("POST", `/tax/deferrals/${def.json.item.id}/installments/1/pay`, SALES, { paidOn: "2026-10-30", bankAccountId: bankId });
    expect(paid.json.item.status).toBe("en_curso");
    expect(paid.json.item.installments[0].paidAt).toBe(T);
    expect((await call("GET", "/tax/deferrals", READ)).json.items).toHaveLength(1);

    const dos = await call("POST", "/tax/dossiers", SALES, { kind: "requerimiento", agency: "AEAT", reference: "REQ-1", subject: "Requerimiento del 303", notifiedOn: "2026-10-01", responseDueOn: "2026-11-20", status: "abierto", obligationId: null, notes: null });
    expect(dos.status).toBe(201);
    expect(keys(dos.json.item)).toEqual(["agency", "closedAt", "createdAt", "createdBy", "documents", "id", "kind", "log", "notes", "notifiedOn", "obligationId", "reference", "responseDueOn", "status", "subject", "updatedAt"]);
    const patched = await call("PATCH", `/tax/dossiers/${dos.json.item.id}`, SALES, { status: "en_tramite" });
    expect(patched.json.item.status).toBe("en_tramite");
    const note = await call("POST", `/tax/dossiers/${dos.json.item.id}/log`, SALES, { note: "Aportada la documentación" });
    expect(note.json.item.log.map((l: { note: string }) => l.note)).toContain("Aportada la documentación");
    expect(keys(note.json.item.log[0])).toEqual(["action", "actor", "at", "note"]);
    expect((await call("GET", "/tax/dossiers?status=en_tramite", READ)).json.items).toHaveLength(1);

    const adj = await call("POST", "/tax/corporate/2026/adjustments", SALES, { kind: "negative_base", description: "BIN 2024", amountCents: 1_000_000, originYear: 2024 });
    expect(adj.status).toBe(201);
    expect(keys(adj.json.item)).toEqual(["amountCents", "description", "id", "kind", "originYear"]);
    const corp = await call("GET", "/tax/corporate/2026", READ);
    expect(keys(corp.json.item)).toEqual(["accountingResultCents", "adjustments", "deductionsCents", "draft", "grossQuotaCents", "installments", "installmentsCents", "negativeBases", "obligation", "rateBp", "resultCents", "taxBaseCents", "warnings", "withholdingsCents", "year"]);
    expect(corp.json.item.negativeBases).toEqual([{ originYear: 2024, amountCents: 1_000_000, appliedCents: expect.any(Number) }]);
    expect(corp.json.item.installments.map((o: { period: string }) => o.period)).toEqual(["1P", "2P", "3P"]);

    const dash = await call("GET", "/tax/dashboard", READ);
    expect(keys(dash.json)).toEqual(["asOf", "deferrals", "dossiers", "estimates", "hasEmployees", "quarter", "settingsMissing", "upcoming", "warnings"]);
    expect(keys(dash.json.deferrals)).toEqual(["count", "nextDueDate", "pendingCents"]);
    expect(keys(dash.json.dossiers)).toEqual(["nextDeadline", "open", "overdue"]);
    expect(keys(dash.json.estimates[0])).toEqual(["amountCents", "label", "model", "obligationId", "period", "result"]);
    expect(dash.json).toMatchObject({ settingsMissing: false, hasEmployees: true, quarter: { label: "4.º trimestre 2026" }, deferrals: { count: 1, pendingCents: 67_500, nextDueDate: "2026-12-20" }, dossiers: { open: 1, nextDeadline: "2026-11-20", overdue: 0 } });
    for (const w of dash.json.warnings) expect(keys(w)).toEqual(["code", "message", "obligationId"]);
  });
});
