/**
 * API de la parametrización fiscal (CRM 0039) con Express real y la autenticación real del plano de control: formas
 * EXACTAS de las rutas nuevas y de los cambios en las existentes (las consume el CRM), permisos `finance:*` (lectura,
 * configuración y gestoría con sesión de operador, gestión de gastos), códigos de error (`tax_config_not_validated`,
 * `corporate_year_unset`, `vat_id_required`, `invalid_rule`) y 404 de todo lo nuevo sin la migración. Solo datos
 * sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, hashToken, type Scope } from "../controlPlane/auth";
import type { ValidSession } from "../controlPlane/operatorAuth";
import { requestIdMiddleware } from "../_core/ops/requestContext";
import { createFinanceRouter } from "./api";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario, PDF_B64 } from "./fiscalTestkit";
import { FINANCE_UPLOAD_PATHS } from "./opsApi";
import { stripeBalanceSample } from "./testkit";

const READ = "ci-only-placeholder-not-a-secret-fis-r";
const CSRF = "csrf-de-prueba-5566778899";
const ALL: Scope[] = ["finance:read", "finance:expenses", "finance:suppliers", "finance:post", "finance:tax", "finance:config", "finance:export", "finance:sensitive"];
const SESSIONS: Record<string, { role: string; scopes: Scope[] }> = {
  "sesion-admin-fiscal-0000000": { role: "admin", scopes: ALL },
  "sesion-lectura-fiscal-00000": { role: "readonly", scopes: ["finance:read"] },
};
const ADMIN = "sesion-admin-fiscal-0000000";
const RO = "sesion-lectura-fiscal-00000";
const keys = (o: object) => Object.keys(o).sort();

async function app(fiscal: boolean) {
  const s = await fiscalScenario({ fiscal });
  const a = express();
  a.use(requestIdMiddleware);
  a.use(express.json({ limit: "256kb", type: (req) => !FINANCE_UPLOAD_PATHS.test(req.url ?? "") && String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json") }));
  const fake = (t: string) => {
    const x = SESSIONS[t];
    return x ? ({ operator: { id: 1, username: t.split("-")[1], displayName: t, role: x.role, status: "active" }, session: { id: `${t}-id-0000000000`, operatorId: 1, csrfToken: CSRF }, scopes: x.scopes } as unknown as ValidSession) : null;
  };
  a.use(authenticate([{ id: "lector", sha256: hashToken(READ), scopes: ALL, actorType: "crm" }], undefined, { operators: { validateSession: async (t: string) => fake(t) }, allowedOrigins: new Set() }));
  a.use("/cp/v1/finance", createFinanceRouter(s.finance, s.ops, s.stripe, s.tax, s.analysis, null, fiscal));
  const server = http.createServer(a);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { s, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/finance` };
}

describe("API de la parametrización fiscal (CRM 0039)", () => {
  let on: Awaited<ReturnType<typeof app>>;
  let off: Awaited<ReturnType<typeof app>>;
  beforeAll(async () => {
    on = await app(true);
    off = await app(false);
  });
  afterAll(async () => {
    for (const x of [on, off]) {
      x.server.closeAllConnections();
      await new Promise<void>((r) => x.server.close(() => r()));
    }
  });
  const call = async (method: string, path: string, who: string, body?: unknown, base = on.base) => {
    const headers: Record<string, string> = who.startsWith("sesion-") ? { cookie: `be_cp_session=${who}`, "x-csrf-token": CSRF } : { authorization: `Bearer ${who}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  it("sin la migración: todas las rutas nuevas responden 404 y las existentes conservan su forma", async () => {
    for (const [m, p] of [["POST", "/tax/settings/validate"], ["GET", "/tax/corporate/presets?year=2026"], ["PUT", "/tax/corporate/2026/config"], ["POST", "/tax/corporate/2026/entry"], ["POST", "/tax/corporate/2026/entry/reverse"], ["POST", "/stripe/imports/preview"], ["GET", "/stripe/fee-vat-rules"], ["POST", "/stripe/fee-vat-rules"], ["POST", "/stripe/fee-vat-rules/1/void"], ["GET", "/analysis/settings"], ["PATCH", "/analysis/settings"]] as const) {
      expect((await call(m, p, ADMIN, m === "GET" ? undefined : {}, off.base)).status, `${m} ${p}`).toBe(404);
    }
    expect((await call("GET", "/stripe/settings", ADMIN, undefined, off.base)).json.item).not.toHaveProperty("pendingFeeVatCount");
    expect((await call("GET", "/stripe/settings", ADMIN, undefined, off.base)).json.item.stripeFeeVat).toBe("exempt");
    expect(keys((await call("GET", "/tax/corporate/2026", ADMIN, undefined, off.base)).json.item)).not.toContain("config");
  });

  it("configuración fiscal: GET con la validación; POST /tax/settings/validate (finance:config, operador); la revisión responde 409", async () => {
    const g = await call("GET", "/tax/settings", RO);
    expect(g.json.item).toMatchObject({ validatedAt: null, validatedBy: null, validationNote: null });
    expect((await call("POST", "/tax/settings/validate", RO, { note: "x" })).status).toBe(403);
    expect((await call("POST", "/tax/settings/validate", READ, { note: "Validada con la gestoría" })).json.error).toBe("operator_session_required");
    // Un borrador lleva el aviso hasta validar; revisar responde 409 tax_config_not_validated
    const e = await on.s.ops.createExpense({ kind: "invoice", supplierId: on.s.es.id, categoryId: on.s.cat("629"), invoiceNumber: "F-1", invoiceDate: "2026-08-03", description: "Hosting", baseCents: 10_000, taxRateBp: 2100 }, ACTOR);
    await on.s.ops.registerExpense(e.id, ACTOR);
    await on.s.tax.generateCalendar(2026, ACTOR);
    const o = (await on.s.tax.listObligations({ year: 2026, model: "303" })).items.find((x) => x.period === "3T")!;
    const calc = await call("POST", `/tax/obligations/${o.id}/calculate`, ADMIN, {});
    expect(calc.json.item.draft.warnings[0]).toEqual({ code: "tax_config_not_validated", message: expect.stringMatching(/^Borrador · configuración fiscal sin validar/) });
    expect((await call("GET", "/tax/models/303/preview?year=2026&period=3T", RO)).json.warnings[0].code).toBe("tax_config_not_validated");
    const rv = await call("POST", `/tax/obligations/${o.id}/review`, ADMIN, {});
    expect([rv.status, rv.json.error]).toEqual([409, "tax_config_not_validated"]);
    const v = await call("POST", "/tax/settings/validate", ADMIN, { note: "Validada con la gestoría" });
    expect(v.status).toBe(200);
    expect(v.json.item).toMatchObject({ validatedAt: expect.any(Number), validatedBy: "operator:admin", validationNote: "Validada con la gestoría" });
    expect((await call("POST", `/tax/obligations/${o.id}/review`, ADMIN, {})).status).toBe(200);
    expect((await call("GET", "/tax/models/303/preview?year=2026&period=3T", RO)).json.warnings.map((w: { code: string }) => w.code)).not.toContain("tax_config_not_validated");
    const log = (await call("GET", "/tax/settings", RO)).json.log;
    expect(log[0]).toMatchObject({ validation: "validated", note: "Configuración validada con la gestoría: Validada con la gestoría", changes: {} });
  });

  it("Impuesto sobre Sociedades: presets, PUT config, GET con config/brackets/entry, asiento y su reversión", async () => {
    const p = await call("GET", "/tax/corporate/presets?year=2026", RO);
    expect(p.json.items.map((x: { key: string }) => x.key)).toEqual(["general", "nueva_creacion", "microempresa", "erd"]);
    expect(keys(p.json.items[0])).toEqual(["brackets", "capReserveLimitBp", "citation", "key", "label", "notice", "regime"]);
    expect((await call("PUT", "/tax/corporate/2026/config", RO, {})).status).toBe(403);
    const bad = await call("PUT", "/tax/corporate/2026/config", ADMIN, { regime: "general", brackets: [{ uptoCents: 100, rateBp: 2500 }] });
    expect([bad.status, bad.json.error]).toEqual([400, "invalid_input"]);
    const put = await call("PUT", "/tax/corporate/2026/config", ADMIN, { regime: "microempresa", brackets: p.json.items[2].brackets, capReserveEquityIncreaseCents: 100_000, capReserveRateBp: 2000, capReserveLimitBp: 2500 });
    expect(put.status).toBe(200);
    expect(keys(put.json.item)).toEqual(["brackets", "capReserveEquityIncreaseCents", "capReserveLimitBp", "capReserveRateBp", "configuredAt", "configuredBy", "levellingReserveCents", "netTurnoverCents", "notes", "regime", "version", "year"]);
    await on.s.finance.createManual({ date: "2026-06-30", journal: "GEN", description: "Ingresos sintéticos", lines: [{ accountCode: on.s.bank.accountCode, debitCents: 1_000_000, creditCents: 0 }, { accountCode: "705", debitCents: 0, creditCents: 1_000_000 }], post: true }, ACTOR);
    const g = await call("GET", "/tax/corporate/2026", RO);
    expect(keys(g.json.item)).toEqual(["accountingResultCents", "adjustments", "brackets", "capitalizationReserveCents", "config", "configLog", "deductionsCents", "draft", "entry", "entryHistory", "grossQuotaCents", "installments", "installmentsCents", "negativeBases", "obligation", "presets", "rateBp", "resultCents", "taxBaseCents", "warnings", "withholdingsCents", "year"]);
    expect(g.json.item.capitalizationReserveCents).toBe(20_000);
    expect(g.json.item.brackets[0]).toEqual({ fromCents: 0, uptoCents: 5_000_000, rateBp: 2000, baseCents: expect.any(Number), quotaCents: expect.any(Number) });
    expect(g.json.item.entry).toBeNull();
    const post = await call("POST", "/tax/corporate/2026/entry", ADMIN, { origin: "manual", date: "2026-12-31", currentTaxCents: 150_000, note: "Importe de la gestoría", document: { filename: "200.pdf", contentBase64: PDF_B64 } });
    expect(post.status).toBe(201);
    expect(keys(post.json)).toEqual(["item", "warnings"]);
    expect(keys(post.json.item)).toEqual(["createdAt", "createdBy", "currentTaxCents", "date", "deferredTaxCents", "differenceFromDraftCents", "documentId", "draftCurrentTaxCents", "entryId", "entryNumber", "id", "note", "origin", "reversalEntryId", "reverseReason", "reversedAt", "reversedBy", "sourceKey", "withholdingsCents", "year"]);
    expect(post.json.item).toMatchObject({ origin: "manual", currentTaxCents: 150_000, entryNumber: expect.any(Number), documentId: expect.any(Number), sourceKey: "tax:200:entry:2026" });
    const dup = await call("POST", "/tax/corporate/2026/entry", ADMIN, { origin: "manual", date: "2026-12-31", currentTaxCents: 1 });
    expect([dup.status, dup.json.error]).toEqual([409, "conflict"]);
    expect((await call("GET", "/tax/corporate/2026", RO)).json.item.entry).toMatchObject({ entryId: post.json.item.entryId });
    const rev = await call("POST", "/tax/corporate/2026/entry/reverse", ADMIN, { reason: "Corrección" });
    expect(rev.json.item).toMatchObject({ reversalEntryId: expect.any(Number), reverseReason: "Corrección" });
    const after = (await call("GET", "/tax/corporate/2026", RO)).json.item;
    expect([after.entry, after.entryHistory.length]).toEqual([null, 1]);
  });

  it("200 sin configurar el ejercicio: revisar responde 409 corporate_year_unset", async () => {
    const x = await app(true);
    try {
      await x.s.finance.createManual({ date: "2026-06-30", journal: "GEN", description: "Ingresos", lines: [{ accountCode: x.s.bank.accountCode, debitCents: 100_000, creditCents: 0 }, { accountCode: "705", debitCents: 0, creditCents: 100_000 }], post: true }, ACTOR);
      await x.s.tax.validateSettings("Validada", ACTOR);
      await x.s.tax.generateCalendar(2026, ACTOR);
      const o = (await x.s.tax.listObligations({ year: 2026, model: "200" })).items[0];
      await x.s.tax.calculate(o.id, ACTOR);
      const r = await call("POST", `/tax/obligations/${o.id}/review`, ADMIN, {}, x.base);
      expect([r.status, r.json.error]).toEqual([409, "corporate_year_unset"]);
    } finally {
      x.server.closeAllConnections();
      await new Promise<void>((r) => x.server.close(() => r()));
    }
  });

  it("Stripe: settings con unset y pendingFeeVatCount, reglas (invalid_rule), vista previa con fichero grande y sin escrituras", async () => {
    const st = await call("GET", "/stripe/settings", RO);
    expect(keys(st.json.item)).toEqual(["disputeAccountCode", "feeVatRateBp", "pendingFeeVatCount", "stripeFeeVat", "stripePayoutBankAccountId", "updatedAt", "updatedBy"]);
    expect(st.json.item).toMatchObject({ stripeFeeVat: "unset", pendingFeeVatCount: 0 });
    expect((await call("PATCH", "/stripe/settings", ADMIN, { stripeFeeVat: "per_invoice" })).json.item.stripeFeeVat).toBe("per_invoice");
    await call("PATCH", "/stripe/settings", ADMIN, { stripeFeeVat: "unset" });
    const bad = await call("POST", "/stripe/fee-vat-rules", ADMIN, { feeKind: "*", issuerName: "Stripe", issuerCountry: "ES", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01" });
    expect([bad.status, bad.json.error]).toEqual([400, "invalid_rule"]);
    expect((await call("POST", "/stripe/fee-vat-rules", RO, {})).status).toBe(403);
    const r = await call("POST", "/stripe/fee-vat-rules", ADMIN, { feeKind: "charge", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", issuerVatId: "IE3206488LH", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01", documentRef: "Factura 2026-10" });
    expect(r.status).toBe(201);
    expect(keys(r.json.item)).toEqual(["active", "createdAt", "createdBy", "documentRef", "feeKind", "id", "issuerCountry", "issuerName", "issuerVatId", "note", "rateBp", "treatment", "validFrom", "validTo", "voidReason", "voidedAt", "voidedBy"]);
    expect((await call("GET", "/stripe/fee-vat-rules", RO)).json.items).toHaveLength(1);
    const prev = await call("POST", "/stripe/imports/preview", ADMIN, { kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) });
    expect(prev.status).toBe(200);
    expect(keys(prev.json)).toEqual(["alreadyImported", "duplicates", "feeVat", "filename", "kind", "nonEur", "parsed", "previousImportId", "rows", "sample", "skipped", "totals", "warnings", "wouldPost"]);
    expect(prev.json.feeVat).toEqual({ resolved: { reverse_charge: 2 }, unset: 3 });
    expect(keys(prev.json.wouldPost[0])).toEqual(["balanceTransactionId", "date", "description", "lines"]);
    expect(keys(prev.json.totals)).toEqual(["byType", "feeCents", "grossCents", "netCents"]);
    // Un cuerpo de más de 256 kB pasa por el lector grande (tras el permiso)
    const huge = await call("POST", "/stripe/imports/preview", ADMIN, { kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample() + "\n" + " ".repeat(400_000)) });
    expect(huge.status).toBe(200);
    expect((await call("GET", "/stripe/imports", RO)).json.items).toEqual([]);
    const v = await call("POST", `/stripe/fee-vat-rules/${r.json.item.id}/void`, ADMIN, { reason: "Ya no aplica" });
    expect(v.json.item).toMatchObject({ active: false, voidReason: "Ya no aplica" });
  });

  it("gastos (vatTreatment y reverseChargeRateBp en el cuerpo y en la ficha), análisis y naturaleza al conciliar", async () => {
    const bad = await call("POST", "/expenses", ADMIN, { kind: "invoice", supplierId: on.s.deNoVat.id, categoryId: on.s.cat("629"), invoiceNumber: "X-1", invoiceDate: "2026-08-03", description: "Servicio", baseCents: 10_000, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100 });
    expect([bad.status, bad.json.error]).toEqual([400, "vat_id_required"]);
    const ok = await call("POST", "/expenses", ADMIN, { kind: "invoice", supplierId: on.s.de.id, categoryId: on.s.cat("629"), invoiceNumber: "X-1", invoiceDate: "2026-08-03", description: "Servicio", baseCents: 10_000, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100 });
    expect(ok.status).toBe(201);
    expect(ok.json.item).toMatchObject({ vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100 });
    expect((await call("PATCH", `/expenses/${ok.json.item.id}`, ADMIN, { vatTreatment: "exempt" })).json.item).toMatchObject({ vatTreatment: "exempt", reverseChargeRateBp: null });
    expect((await call("GET", `/expenses/${ok.json.item.id}`, RO)).json.item).toMatchObject({ vatTreatment: "exempt", settlesStripeFees: false });
    // Factura de comisiones de Stripe: modo sin decidir → 400 invalid_stripe_fee_invoice; en per_invoice, 201 y nace pagada
    const stripeSup = await on.s.ops.createSupplier({ name: "Stripe Payments Europe, Limited", taxId: "IE3206488LH", country: "IE" }, ACTOR);
    const fee = { kind: "invoice", supplierId: stripeSup.id, categoryId: on.s.cat("626"), invoiceNumber: "STR-1", invoiceDate: "2026-10-31", description: "Comisiones de Stripe", baseCents: 750, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100, settlesStripeFees: true };
    const nope = await call("POST", "/expenses", ADMIN, fee);
    expect([nope.status, nope.json.error]).toEqual([400, "invalid_stripe_fee_invoice"]);
    await call("PATCH", "/stripe/settings", ADMIN, { stripeFeeVat: "per_invoice" });
    const created = await call("POST", "/expenses", ADMIN, fee);
    expect(created.status).toBe(201);
    expect(created.json.item).toMatchObject({ settlesStripeFees: true, vatTreatment: "intra_eu_services" });
    const regd = await call("POST", `/expenses/${created.json.item.id}/register`, ADMIN, {});
    expect(regd.json.item).toMatchObject({ settlesStripeFees: true, paymentStatus: "paid", pendingCents: 0 });
    const pay = await call("POST", `/expenses/${created.json.item.id}/payments`, ADMIN, { paidOn: "2026-10-31", amountCents: 750, method: "stripe" });
    expect([pay.status, pay.json.error]).toEqual([409, "invalid_state"]);
    await call("PATCH", "/stripe/settings", ADMIN, { stripeFeeVat: "unset" });
    const s = await call("GET", "/analysis/settings", RO);
    expect(keys(s.json.item)).toEqual(["bankFeeAccounts", "configuredAt", "configuredBy", "natures", "stripeFeesTreatment"]);
    expect(s.json.item.natures[0]).toEqual({ key: "servicio", label: "Servicio bancario", accountCode: "626" });
    expect((await call("PATCH", "/analysis/settings", RO, { stripeFeesTreatment: "structure" })).status).toBe(403);
    const p = await call("PATCH", "/analysis/settings", ADMIN, { stripeFeesTreatment: "structure", bankFeeAccounts: { financiera: "669" } });
    expect(p.json.item).toMatchObject({ stripeFeesTreatment: "structure", configuredBy: "operator:admin" });
    expect((await call("PATCH", "/analysis/settings", ADMIN, { bankFeeAccounts: { otra: "626" } })).status).toBe(400);
    expect((await call("GET", "/analytics/revenue-margin?year=2026", RO)).json.stripeFeesTreatment).toBe("structure");
    await on.s.ops.importStatement({ bankAccountId: on.s.bank.id, format: "csv", filename: "e.csv", contentBase64: b64(["Fecha;Importe;Concepto", "2026-10-29;-3,50;COMISION"].join("\n")), mapping: { delimiter: ";", headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd", decimal: "," } }, ACTOR);
    const m = (await on.s.ops.movements({ bankAccountId: on.s.bank.id, limit: 5 })).items.find((x) => x.amountCents === -350)!;
    expect((await call("POST", `/bank-movements/${m.id}/match`, ADMIN, { type: "other", nature: "financiera", accountCode: "626" })).status).toBe(400);
    const matched = await call("POST", `/bank-movements/${m.id}/match`, ADMIN, { type: "other", nature: "financiera" });
    expect(matched.json.item).toMatchObject({ status: "matched", matchType: "other" });
  });
});
