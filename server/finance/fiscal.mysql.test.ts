/**
 * Parametrización fiscal (CRM 0039) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y retirada
 * aquí): la migración 0039 se aplica sobre 0033–0038 con datos ya escritos (las filas existentes quedan interiores y
 * sin validar), el código sin la migración sigue funcionando, la vista previa de Stripe no escribe NADA, el tratamiento
 * del IVA de los gastos y la validación de la configuración se guardan y se anulan, reglas de comisiones, Impuesto
 * sobre Sociedades por ejercicio con su bitácora y un único asiento vivo por ejercicio (índice único), y la
 * configuración del análisis. Solo datos sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario } from "./fiscalTestkit";
import { FinanceOpsService } from "./opsService";
import { MysqlFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MysqlFinanceStore } from "./store";
import { FinanceTaxService } from "./taxService";
import { finFiscalTablesReady, MysqlFinanceTaxStore } from "./taxStore";
import { stripeBalanceSample } from "./testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "finance_fiscal_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 9, 30, 10);

describe.skipIf(!URL_)("parametrización fiscal con MySQL real (CRM 0039)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let s: Awaited<ReturnType<typeof fiscalScenario>>;
  let legacyExpenseId: number;
  const count = async (sql: string, args: unknown[] = []) => Number(((await pool.query<mysql.RowDataPacket[]>(sql, args))[0][0] as { n: number }).n);
  /** Recuento de filas de todas las tablas fin_* (para comprobar que algo no escribe nada). */
  const finRows = async () => {
    const [tables] = await pool.query<mysql.RowDataPacket[]>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'fin\\_%' ORDER BY table_name");
    const out: Record<string, number> = {};
    for (const r of tables) out[String(r.t)] = await count(`SELECT COUNT(*) AS n FROM ${String(r.t)}`);
    return out;
  };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const st of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(st);
    const migrations = loadMigrations(DIR).migrations;
    const i0039 = migrations.findIndex((m) => m.id === "0039_finance_fiscal");
    expect(i0039).toBeGreaterThan(0);
    for (const m of migrations.slice(0, i0039)) for (const st of splitStatements(m.up)) await pool.query(st);
    // Sin la 0039: el código funciona con el esquema anterior y escribe datos (un gasto y la configuración fiscal)
    expect(await finFiscalTablesReady(pool)).toBe(false);
    const ledger = new MysqlFinanceStore(pool);
    const finance = new FinanceService({ store: ledger, now: () => T });
    await finance.createFiscalYear(2024, ACTOR);
    const opsStore = new MysqlFinanceOpsStore(pool);
    const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now: () => T });
    const sup = await ops.createSupplier({ name: "Proveedor previo SL" }, ACTOR);
    const cat = (await opsStore.listCategories()).find((c) => c.accountCode === "629")!.id;
    const e = await ops.createExpense({ kind: "invoice", supplierId: sup.id, categoryId: cat, invoiceNumber: "P-1", invoiceDate: "2024-05-10", description: "Gasto anterior a la 0039", baseCents: 10_000, taxRateBp: 2100 }, ACTOR);
    await ops.registerExpense(e.id, ACTOR);
    legacyExpenseId = e.id;
    const legacyTax = new FinanceTaxService({ store: new MysqlFinanceTaxStore(pool), finance, ledger, ops: opsStore, documents: ops, now: () => T });
    await legacyTax.saveSettings({ intraEuOperations: true }, ACTOR);
    // Ahora la 0039 sobre 0033–0038 con datos
    for (const m of migrations.slice(i0039)) for (const st of splitStatements(m.up)) await pool.query(st);
    expect(await finFiscalTablesReady(pool)).toBe(true);
    s = await fiscalScenario({ pool });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("migración aditiva: las filas existentes quedan interiores (NULL) y la configuración sin validar", async () => {
    expect(await s.ops.expense(legacyExpenseId)).toMatchObject({ vatTreatment: null, reverseChargeRateBp: null, status: "registered" });
    expect(await count("SELECT COUNT(*) AS n FROM fin_expenses WHERE vat_treatment IS NOT NULL")).toBe(0);
    // La configuración guardada antes de la 0039 se lee sin validar (el escenario la ha vuelto a guardar: sigue sin validar)
    expect(await s.tax.configValidated()).toBe(false);
    for (const t of ["fin_stripe_fee_vat_rules", "fin_tax_corporate_years", "fin_tax_corporate_year_log", "fin_tax_corporate_entries", "fin_analysis_settings"]) expect(await count(`SELECT COUNT(*) AS n FROM ${t}`)).toBe(0);
  });

  it("vista previa de importación de Stripe: CERO escrituras en la BD", async () => {
    const before = await finRows();
    const p = await s.stripe.previewImport({ kind: "balance", filename: "balance.csv", contentBase64: b64(stripeBalanceSample()) });
    expect(p).toMatchObject({ parsed: 9, duplicates: 0, alreadyImported: false, feeVat: { unset: 5 } });
    const q = await s.stripe.previewImport({ kind: "payouts", filename: "payouts.csv", contentBase64: b64("payout_id,effective_at_utc,currency,gross,fee,net,reporting_category,payout_expected_arrival_date,payout_status\npo_test_1,2026-10-08 00:00:00,eur,113.50,0.00,113.50,payout,2026-10-08,paid\n") });
    expect(q).toMatchObject({ kind: "payouts", parsed: 1, wouldPost: [expect.objectContaining({ balanceTransactionId: "po_test_1" })] });
    expect(await finRows()).toEqual(before);
  });

  it("gasto con inversión del sujeto pasivo: columnas guardadas, asiento con 472/477 y el 303", async () => {
    const e = await s.ops.createExpense({ kind: "invoice", supplierId: s.de.id, categoryId: s.cat("629"), invoiceNumber: "R-1", invoiceDate: "2026-08-05", description: "Servidores", baseCents: 100_000, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100 }, ACTOR);
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT vat_treatment, reverse_charge_rate_bp FROM fin_expenses WHERE id = ?", [e.id]);
    expect(row).toMatchObject({ vat_treatment: "intra_eu_services", reverse_charge_rate_bp: 2100 });
    const reg = await s.ops.registerExpense(e.id, ACTOR);
    const lines = (await s.finance.getEntry(reg.entryId!)).lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.taxRateBp]);
    expect(lines).toEqual([
      ["629", 100_000, 0, 0],
      ["472", 21_000, 0, 2100],
      ["477", 0, 21_000, 2100],
      ["410", 0, 100_000, null],
    ]);
    expect((await s.opsStore.expenseTreatmentsByEntries([reg.entryId!])).get(reg.entryId!)).toBe("intra_eu_services");
    const d = await s.tax.preview("303", 2026, "3T");
    expect(["10", "11", "36", "37"].map((b) => d.boxes.find((x) => x.box === b)?.valueCents)).toEqual([100_000, 21_000, 100_000, 21_000]);
    // Edición del borrador (UPDATE condicional) con las columnas nuevas
    const e2 = await s.ops.createExpense({ kind: "invoice", supplierId: s.de.id, categoryId: s.cat("629"), invoiceNumber: "R-2", invoiceDate: "2026-08-06", description: "Servidores", baseCents: 10_000, taxRateBp: 0, vatTreatment: "intra_eu_goods", reverseChargeRateBp: 2100 }, ACTOR);
    expect(await s.ops.patchExpense(e2.id, { vatTreatment: "exempt" }, ACTOR)).toMatchObject({ vatTreatment: "exempt", reverseChargeRateBp: null });
  });

  it("factura de comisiones de Stripe (per_invoice): columna guardada, solo el IVA en el asiento y pagada sin pagos", async () => {
    const before = await s.stripe.settings();
    await s.stripe.saveSettings({ stripeFeeVat: "per_invoice" }, ACTOR);
    const sup = await s.ops.createSupplier({ name: "Stripe Payments Europe, Limited", taxId: "IE3206488LH", country: "IE" }, ACTOR);
    const e = await s.ops.createExpense({ kind: "invoice", supplierId: sup.id, categoryId: s.cat("626"), invoiceNumber: "STR-2026-09", invoiceDate: "2026-09-30", description: "Comisiones de Stripe de septiembre", baseCents: 750, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100, settlesStripeFees: true }, ACTOR);
    expect(await count("SELECT COUNT(*) AS n FROM fin_expenses WHERE id = ? AND settles_stripe_fees = 1", [e.id])).toBe(1);
    const reg = await s.ops.registerExpense(e.id, ACTOR);
    expect(reg).toMatchObject({ settlesStripeFees: true, paymentStatus: "paid", paidCents: 750 });
    expect((await s.finance.getEntry(reg.entryId!)).lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["472", 158, 0],
      ["477", 0, 158],
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM fin_expense_payments WHERE expense_id = ?", [e.id])).toBe(0);
    // Al desmarcar en un borrador se guarda 0 (UPDATE condicional con la columna nueva)
    const d = await s.ops.createExpense({ kind: "invoice", supplierId: sup.id, categoryId: s.cat("626"), invoiceNumber: "STR-2026-08", invoiceDate: "2026-08-31", description: "Comisiones", baseCents: 100, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100, settlesStripeFees: true }, ACTOR);
    expect(await s.ops.patchExpense(d.id, { settlesStripeFees: false }, ACTOR)).toMatchObject({ settlesStripeFees: false });
    await s.stripe.saveSettings({ stripeFeeVat: before.stripeFeeVat }, ACTOR);
  });

  it("validación de la configuración: columnas e historial; un cambio la anula", async () => {
    await s.tax.validateSettings("Validada con la gestoría", ACTOR);
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_settings WHERE validated_at IS NOT NULL AND validation_note = 'Validada con la gestoría'")).toBe(1);
    const logs = await count("SELECT COUNT(*) AS n FROM fin_tax_settings_log");
    await s.tax.saveSettings({ notes: "Otro cambio" }, ACTOR);
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_settings WHERE validated_at IS NULL AND validated_by IS NULL AND validation_note IS NULL")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_settings_log")).toBe(logs + 1);
    expect((await s.tax.settingsLog())[1].after.validationNote).toBe("Validada con la gestoría");
  });

  it("reglas de IVA de las comisiones: alta, contabilización con la regla y anulación (sin edición)", async () => {
    await s.stripe.importFile({ kind: "balance", filename: "balance.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    expect((await s.stripe.post("2026-10-31", ACTOR)).pendingFeeVat).toBe(5);
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_transactions WHERE status = 'pending' AND issue_detail LIKE 'fee_vat_unset%'")).toBe(5);
    const r = await s.stripe.createFeeVatRule({ feeKind: "*", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", issuerVatId: "IE3206488LH", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01", validTo: "2026-12-31", documentRef: "Factura 2026-10" }, ACTOR);
    expect(r).toMatchObject({ validFrom: "2026-01-01", validTo: "2026-12-31", voidedAt: null });
    expect((await s.stripe.post("2026-10-31", ACTOR)).pendingFeeVat).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM fin_entry_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE e.origin = 'stripe' AND l.account_code = '477' AND l.description LIKE '%emisor: Stripe Payments Europe, Limited (IE3206488LH)%'")).toBe(5);
    await s.stripe.voidFeeVatRule(r.id, "Sustituida", ACTOR);
    await expect(s.stripe.voidFeeVatRule(r.id, "Sustituida", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await count("SELECT COUNT(*) AS n FROM fin_stripe_fee_vat_rules WHERE voided_at IS NOT NULL")).toBe(1);
  });

  it("Impuesto sobre Sociedades: configuración con versión y bitácora; un asiento vivo por ejercicio (índice único)", async () => {
    await s.finance.createManual({ date: "2026-06-30", journal: "GEN", description: "Ingresos sintéticos", lines: [{ accountCode: s.bank.accountCode, debitCents: 1_000_000, creditCents: 0 }, { accountCode: "705", debitCents: 0, creditCents: 1_000_000 }], post: true }, ACTOR);
    const cfg = { regime: "erd" as const, brackets: [{ uptoCents: null, rateBp: 2300 }], netTurnoverCents: 500_000_000, capReserveEquityIncreaseCents: null, capReserveRateBp: null, capReserveLimitBp: null, levellingReserveCents: 50_000, notes: null };
    expect(await s.tax.saveCorporateYear(2026, cfg, ACTOR)).toMatchObject({ version: 1, brackets: [{ uptoCents: null, rateBp: 2300 }] });
    expect(await s.tax.saveCorporateYear(2026, { ...cfg, expectedVersion: 1, notes: "Confirmado" }, ACTOR)).toMatchObject({ version: 2, notes: "Confirmado" });
    await expect(s.tax.saveCorporateYear(2026, { ...cfg, expectedVersion: 1 }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    const log = await s.taxStore.corporateYearLog(2026);
    expect(log.map((l) => [l.before?.version ?? null, l.after.version])).toEqual([
      [1, 2],
      [null, 1],
    ]);
    const first = await s.tax.corporateEntry(2026, { origin: "system", date: "2026-12-31" }, ACTOR);
    expect(first.record).toMatchObject({ sourceKey: "tax:200:entry:2026", date: "2026-12-31" });
    // El índice único sobre el ejercicio vivo impide un segundo asiento aunque se salte la comprobación del servicio
    await expect(s.taxStore.insertCorporateEntry({ ...first.record, seq: 2, sourceKey: "tax:200:entry:2026:2" })).rejects.toMatchObject({ code: "conflict" });
    await s.tax.reverseCorporateEntry(2026, "Corrección", ACTOR);
    const second = await s.tax.corporateEntry(2026, { origin: "manual", date: "2026-12-31", currentTaxCents: 100_000 }, ACTOR);
    expect(second.record).toMatchObject({ seq: 2, sourceKey: "tax:200:entry:2026:2" });
    expect(await count("SELECT COUNT(*) AS n FROM fin_tax_corporate_entries WHERE live_year = 2026")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_accounts WHERE code IN ('6300')")).toBe(1);
    // Fechas DATE sin desplazamiento de zona
    expect((await s.taxStore.listCorporateEntries(2026)).map((e) => e.date)).toEqual(["2026-12-31", "2026-12-31"]);
  });

  it("configuración del análisis: guardada (una fila) y aplicada a la naturaleza bancaria", async () => {
    await s.analysis.saveAnalysisSettings({ stripeFeesTreatment: "structure", bankFeeAccounts: { custodia: "669" } }, ACTOR);
    await s.analysis.saveAnalysisSettings({ stripeFeesTreatment: "financial" }, ACTOR);
    expect(await count("SELECT COUNT(*) AS n FROM fin_analysis_settings")).toBe(1);
    expect(await s.analysis.analysisSettings()).toMatchObject({ stripeFeesTreatment: "financial", bankFeeAccounts: { custodia: "669", financiera: "669", intereses: "662" } });
    expect(await s.analysis.natureAccount("custodia")).toBe("669");
  });
});
