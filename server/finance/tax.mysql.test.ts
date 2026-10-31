/**
 * Gestoría e impuestos (fase 3) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y retirada
 * aquí, con todas las migraciones del CRM): configuración con versión e historial, calendario idempotente también con
 * generaciones simultáneas, 303 de punta a punta sobre facturas, gastos y Stripe reales con su liquidación y su pago,
 * presentaciones simultáneas sin duplicar asientos, `stale`, nóminas, aplazamientos, expedientes, ajustes del 200,
 * avisos sin duplicar entre réplicas, justificantes en fin_documents, fechas sin desplazamiento y ZIP. Solo datos
 * sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { lineOf, totals } from "../invoicing/rules";
import { MysqlInvoicingStore } from "../invoicing/store";
import type { FiscalParty } from "../invoicing/types";
import { FinanceOpsService } from "./opsService";
import { MysqlFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MysqlFinanceStore } from "./store";
import { MysqlFinanceStripeStore } from "./stripeStore";
import { FinanceTaxService } from "./taxService";
import { MysqlFinanceTaxStore, finTaxTablesReady } from "./taxStore";
import { MysqlFiscalInvoiceSource } from "./taxSources";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "finance_tax_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 9, 30, 10);
const ACTOR = { by: "operator:luis", requestId: "req-tax-mysql" };
const ES: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const DE: FiscalParty = { legalName: "Kunde GmbH", taxId: "DE123456789", address: "Straße 1", postalCode: "10115", city: "Berlin", country: "DE" };
const PDF = Buffer.from("%PDF-1.4\n% justificante sintético\n").toString("base64");

describe.skipIf(!URL_)("gestoría e impuestos con MySQL real (CRM 0037)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let finance: FinanceService;
  let ops: FinanceOpsService;
  let tax: FinanceTaxService;
  let store: MysqlFinanceTaxStore;
  let bankId: number;
  let bankCode: string;
  const count = async (sql: string, args: unknown[] = []) => Number(((await pool.query<mysql.RowDataPacket[]>(sql, args))[0][0] as { n: number }).n);
  const make = (now = T) => new FinanceTaxService({ store: new MysqlFinanceTaxStore(pool), finance, ledger: new MysqlFinanceStore(pool), ops: new MysqlFinanceOpsStore(pool), documents: ops, stripe: new MysqlFinanceStripeStore(pool), invoices: new MysqlFiscalInvoiceSource(pool, "test"), issuer: { legalName: "EMPRESA DE PRUEBA, S.L.", taxId: "B00000000" }, now: () => now });

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    expect(await finTaxTablesReady(pool)).toBe(false);
    for (const m of loadMigrations(DIR).migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await finTaxTablesReady(pool)).toBe(true);
    const ledger = new MysqlFinanceStore(pool);
    finance = new FinanceService({ store: ledger, now: () => T });
    await finance.createFiscalYear(2026, ACTOR);
    const opsStore = new MysqlFinanceOpsStore(pool);
    ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => T });
    store = new MysqlFinanceTaxStore(pool);
    tax = make();
    ops.useTaxDocumentOwners((t, id) => tax.documentOwnerExists(t, id));
    const bank = await ops.createBankAccount({ name: "Banco de pruebas" }, ACTOR);
    bankId = bank.id;
    bankCode = bank.accountCode;
    // Facturas expedidas (al 21 % a un cliente español y al 0 % a uno alemán), un gasto y una comisión de Stripe con ISP
    const invoices = new MysqlInvoicingStore(pool, "test");
    for (const [key, date, base, rate, party] of [["external:1:2026-08", "2026-08-01", 100_000, 2100, ES], ["external:2:2026-08", "2026-08-02", 50_000, 0, DE]] as const) {
      const lines = [lineOf(1, "Servicio", 1, base, rate)];
      const { invoice } = await invoices.insertDraft({ sourceKey: key, kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: date, periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: party, notes: null, createdBy: "t", createdAt: T, lines });
      await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: date, issuer: ES, customer: party, issuedBy: "t", issuedAt: T });
    }
    await new FinanceService({ store: ledger, invoices, now: () => T }).syncInvoices(ACTOR);
    const cat = (await opsStore.listCategories()).find((c) => c.accountCode === "629")!.id;
    const sup = await ops.createSupplier({ name: "Hosting Nube SL", taxId: "B12345674" }, ACTOR);
    const e = await ops.createExpense({ kind: "invoice", supplierId: sup.id, categoryId: cat, invoiceNumber: "H-1", invoiceDate: "2026-08-05", description: "Servidores", baseCents: 20_000, taxRateBp: 2100 }, ACTOR);
    await ops.registerExpense(e.id, ACTOR);
    await finance.postGenerated({ journalCode: "STR", date: "2026-08-06", description: "Stripe txn_test_1", origin: "stripe", sourceKey: "stripe-txn:txn_test_1", lines: [{ accountCode: "5720", debitCents: 9612, creditCents: 0 }, { accountCode: "626", debitCents: 388, creditCents: 0 }, { accountCode: "430", debitCents: 0, creditCents: 10_000 }, { accountCode: "472", debitCents: 81, creditCents: 0, taxRateBp: 2100, taxBaseCents: 388 }, { accountCode: "477", debitCents: 0, creditCents: 81, taxRateBp: 2100, taxBaseCents: 388 }] }, ACTOR);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("configuración: null hasta guardarla, versión optimista e historial", async () => {
    expect(await tax.storedSettings()).toBeNull();
    const s = await tax.saveSettings({ intraEuOperations: true, stripeVatId: "IE3206488LH", hasEmployees: true, extraHolidays: ["2026-11-09"] }, ACTOR);
    expect(s).toMatchObject({ configured: true, version: 1, legalName: "EMPRESA DE PRUEBA, S.L.", extraHolidays: ["2026-11-09"], installmentPaymentsMethod: "art40_2" });
    await expect(tax.saveSettings({ notes: "x", expectedVersion: 0 }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_settings_log")).toBe(1);
  });

  it("calendario idempotente, también con dos generaciones simultáneas; fechas sin desplazamiento", async () => {
    const [a, b] = await Promise.all([tax.generateCalendar(2026, ACTOR), tax.generateCalendar(2026, ACTOR)]);
    const total = 4 + 1 + 4 + 1 + 4 + 1 + 1 + 3 + 12; // 303, 390, 349, 347, 111, 190, 200, 202, SS
    expect(a.created + b.created).toBe(total);
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_obligations")).toBe(total);
    expect((await tax.generateCalendar(2026, ACTOR)).created).toBe(0);
    const o = (await store.getObligationByKey("obligation:303:2026:4T"))!;
    expect(o).toMatchObject({ dueDate: "2027-02-01", periodFrom: "2026-10-01", periodTo: "2026-12-31", status: "pendiente" });
  });

  it("303: cálculo, presentaciones simultáneas (una gana, un solo asiento de liquidación), stale y pago", async () => {
    const o = (await store.getObligationByKey("obligation:303:2026:3T"))!;
    const c = await tax.calculate(o.id, ACTOR);
    expect(c.draft!.boxes.filter((b) => ["07", "09", "11", "29", "37", "59"].includes(b.box)).map((b) => b.valueCents)).toEqual([100_000, 21_000, 81, 4200, 81, 50_000]);
    expect(c.draft!.resultCents).toBe(16_800);
    expect((await store.getDraft(o.id))!.hash).toBe(c.draft!.hash);
    const results = await Promise.allSettled([tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "R-A", document: { filename: "j.pdf", contentBase64: PDF } }, ACTOR), tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "R-B" }, ACTOR)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries WHERE source_key = 'tax:303:2026:3T'")).toBe(1);
    const presented = (await store.getObligation(o.id))!;
    expect(presented).toMatchObject({ status: "presentado", presentedOn: "2026-10-20", presentedAmountCents: 16_800 });
    // Datos que cambian después: stale con la diferencia, lo presentado no se toca
    const opsStore = new MysqlFinanceOpsStore(pool);
    const cat = (await opsStore.listCategories()).find((x) => x.accountCode === "629")!.id;
    const e = await ops.createExpense({ kind: "ticket", categoryId: cat, invoiceDate: "2026-09-10", description: "Tique", baseCents: 1000, taxRateBp: 2100 }, ACTOR);
    await ops.registerExpense(e.id, ACTOR);
    const s = await tax.calculate(o.id, ACTOR);
    expect(s.obligation).toMatchObject({ stale: true, draftHash: c.draft!.hash, presentedAmountCents: 16_800 });
    expect(s.obligation.staleDetail).toMatchObject({ resultBefore: 16_800, resultAfter: 16_590 });
    const paid = await tax.pay(o.id, { paidOn: "2026-10-20", bankAccountId: bankId }, ACTOR);
    expect(paid).toMatchObject({ status: "pagado", paidOn: "2026-10-20" });
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT l.account_code, l.debit_cents, l.credit_cents FROM fin_entry_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE e.source_key = ? ORDER BY l.line_no", [`tax-payment:${o.id}`]);
    expect(rows.map((r) => [r.account_code, Number(r.debit_cents), Number(r.credit_cents)])).toEqual([
      ["4750", 16_800, 0],
      [bankCode, 0, 16_800],
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM fin_documents WHERE owner_type = 'tax_obligation' AND owner_id = ?", [o.id])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_obligation_log WHERE obligation_id = ?", [o.id])).toBeGreaterThanOrEqual(5);
  });

  it("349 con el NIF-IVA de Stripe y libro de expedidas leído directamente de invoices", async () => {
    const d = await tax.preview("349", 2026, "3T");
    expect(d.declarants.map((x) => [x.key, x.taxId, x.amountCents])).toEqual([
      ["I", "IE3206488LH", 388],
      ["S", "DE123456789", 50_000],
    ]);
    const csv = await tax.issuedRegisterCsv("2026-08-01", "2026-08-31");
    expect(csv.csv.split("\r\n").filter((l) => l.startsWith("0"))).toHaveLength(2);
  });

  it("nóminas (reemplazo en borrador, registro y pago), aplazamiento y su pago", async () => {
    const base = { grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, netCents: 235_500 };
    const ids: number[] = [];
    for (const m of ["2026-07", "2026-08", "2026-09"]) {
      await tax.savePayroll({ period: m, employeeAlias: "dev-1", ...base, grossCents: 1, netCents: 1, irpfCents: 0, ssEmployeeCents: 0 }, ACTOR);
      const p = await tax.savePayroll({ period: m, employeeAlias: "dev-1", ...base, paymentDate: `${m}-28` }, ACTOR);
      expect(p.created).toBe(false);
      ids.push((await tax.postPayroll(p.payroll.id, ACTOR)).id);
    }
    expect((await tax.listPayrolls("2026-08"))[0]).toMatchObject({ payDate: "2026-08-28", status: "posted", grossCents: 300_000 });
    await expect(tax.savePayroll({ period: "2026-07", employeeAlias: "dev-1", ...base }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await tax.payPayroll(ids[0], { paidOn: "2026-07-31", bankAccountId: bankId }, ACTOR);
    const o = (await store.getObligationByKey("obligation:111:2026:3T"))!;
    expect((await tax.calculate(o.id, ACTOR)).draft!.resultCents).toBe(135_000);
    await tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "111-3T" }, ACTOR);
    const d = await tax.createDeferral({ obligationId: o.id, principalCents: 135_000, requestedOn: "2026-10-20", installments: [{ n: 1, dueDate: "2026-11-20", amountCents: 135_000 }] }, ACTOR);
    expect(d.installments[0]).toMatchObject({ number: 1, dueDate: "2026-11-20", status: "pendiente" });
    const [x, y] = await Promise.allSettled([tax.payInstallment(d.id, 1, { paidOn: "2026-10-30", bankAccountId: bankId }, ACTOR), tax.payInstallment(d.id, 1, { paidOn: "2026-10-30", bankAccountId: bankId }, ACTOR)]);
    expect([x.status, y.status].filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entries WHERE source_key = ?", [`tax-deferral:${d.id}:1`])).toBe(1);
    expect((await store.getObligation(o.id))!.status).toBe("pagado");
    expect((await store.getDeferral(d.id))!).toMatchObject({ status: "pagado" });
  });

  it("expedientes, ajustes del 200, avisos sin duplicar entre réplicas y ZIP", async () => {
    const d = await tax.createDossier({ kind: "comprobacion", agency: "AEAT", subject: "Comprobación limitada IVA 2026", notifiedOn: "2026-10-01", responseDueOn: "2026-10-26" }, ACTOR);
    await tax.patchDossier(d.id, { status: "cerrado" }, ACTOR);
    await tax.addDossierNote(d.id, "Resuelto sin regularización", ACTOR);
    const full = await tax.dossier(d.id);
    expect(full.dossier).toMatchObject({ status: "cerrado", responseDueOn: "2026-10-26" });
    expect(full.dossier.closedAt).not.toBeNull();
    expect(full.log.map((l) => l.action)).toEqual(["create", "status", "note"]);
    const a = await tax.saveAdjustment(2026, { kind: "increase", description: "Multas", amountCents: 5000 }, ACTOR);
    await tax.saveAdjustment(2026, { id: a!.id, kind: "increase", description: "Multas", amountCents: 0 }, ACTOR);
    expect((await store.listAdjustments(2026)).map((x) => x.status)).toEqual(["void"]);
    // Dos réplicas con el mismo reloj (20/11/2026; los seguros sociales de octubre vencen el 30): cada aviso una sola vez
    const r1 = make(Date.UTC(2026, 10, 20, 10));
    const r2 = make(Date.UTC(2026, 10, 20, 10));
    const [l1, l2] = await Promise.all([r1.dueReminders(), r2.dueReminders()]);
    const all = [...l1, ...l2].map((r) => r.key);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("obligation:SS:2026:10");
    const zip = await JSZip.loadAsync((await tax.exportZip("2026-07-01", "2026-09-30")).buffer);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["libro-diario.csv", "libro-registro-expedidas.csv", "modelos/303-2026-3T.csv", "documentos.csv"]));
    expect(await zip.file("documentos.csv")!.async("string")).toContain("j.pdf");
  });
});
