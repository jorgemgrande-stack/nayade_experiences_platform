/**
 * Utilidades de PRUEBA de la fase 4: un escenario sintético completo en memoria sobre los servicios reales de las fases
 * 1–2 (libro, operaciones y Stripe) para el control diario, los informes y el análisis. Solo datos inventados.
 *
 *  - 2025 y 2026 dados de alta; apertura manual (diario APE) de 10.000 € en el banco y capital el 1/1/2026;
 *  - facturas propias: EB-1 (121 €, 1/10, cobrada con Stripe `in_test_1`) y EB-2 (302,50 €, 15/9, pendiente);
 *  - gastos: hosting 500 € + IVA (centro General, vence el 20/10, sin pagar) y software 100 € + IVA (pagado el 10/10);
 *  - informe de saldo de Stripe de octubre contabilizado, payout po_test_1 al banco y vinculado a su movimiento.
 * Con `pool` el mismo escenario se monta sobre MySQL (almacenes MySQL de todas las fases): los resultados deben coincidir.
 */
import type mysql from "mysql2/promise";
import { lineOf, totals } from "../invoicing/rules";
import { MemoryInvoicingStore, MysqlInvoicingStore } from "../invoicing/store";
import type { FiscalParty, NewInvoice } from "../invoicing/types";
import { FinanceAnalysisService, type FinanceAnalysisDeps } from "./analysisService";
import { MemoryFinanceAnalysisStore, MysqlFinanceAnalysisStore } from "./analysisStore";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore, MysqlFinanceOpsStore } from "./opsStore";
import { MysqlOwnInvoiceDirectory, ownInvoicesFromStore } from "./ownInvoices";
import { FinanceService } from "./service";
import { MemoryFinanceStore, MysqlFinanceStore } from "./store";
import { FinanceStripeService } from "./stripeService";
import { MemoryFinanceStripeStore, MysqlFinanceStripeStore } from "./stripeStore";
import { seededOps, seededPlan, stripeBalanceSample } from "./testkit";

export const ANALYSIS_T0 = Date.UTC(2026, 9, 31, 10);
export const ANALYSIS_ACTOR = { by: "operator:luis", requestId: "req-analysis" };
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const b64 = (s: string) => Buffer.from(s).toString("base64");
const MAPPING = { delimiter: ";" as const, headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd" as const, decimal: "," as const };

export async function analysisScenario(o: { now?: number; analysis?: Partial<FinanceAnalysisDeps>; pool?: mysql.Pool } = {}) {
  const now = () => o.now ?? ANALYSIS_T0;
  const ACTOR = ANALYSIS_ACTOR;
  const pool = o.pool;
  const invoices = pool ? new MysqlInvoicingStore(pool, "test") : new MemoryInvoicingStore();
  const ledger = pool ? new MysqlFinanceStore(pool) : new MemoryFinanceStore(seededPlan());
  const finance = new FinanceService({ store: ledger, invoices, now });
  await finance.createFiscalYear(2025, ACTOR);
  await finance.createFiscalYear(2026, ACTOR);
  const opsStore = pool ? new MysqlFinanceOpsStore(pool) : new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now });
  const bank = await ops.createBankAccount({ name: "CaixaBank principal", iban: "ES9121000418450200051332" }, ACTOR);
  await finance.createManual({ date: "2026-01-01", journal: "APE", description: "Saldos de apertura", lines: [{ accountCode: bank.accountCode, debitCents: 1_000_000, creditCents: 0 }, { accountCode: "100", debitCents: 0, creditCents: 1_000_000 }], post: true }, ACTOR);

  const issue = async (sourceKey: string, lines: NewInvoice["lines"], issueDate: string, paymentRef: string | null) => {
    const { invoice } = await invoices.insertDraft({ sourceKey, kind: "invoice", paymentStatus: "pending", companyId: 9, billingRef: "external:1", paymentRef: null, originalInvoiceId: null, operationDate: issueDate, periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: ANALYSIS_T0, lines });
    const inv = await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate, issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: ANALYSIS_T0 });
    return paymentRef ? invoices.setPayment(inv.id, { paymentStatus: "paid", paymentRef, paidAt: ANALYSIS_T0 }, ANALYSIS_T0) : inv;
  };
  const inv1 = await issue("external:1:2026-10", [lineOf(1, "Plan Elephant Core", 1, 10_000, 2100)], "2026-10-01", "stripe:in:in_test_1");
  const inv2 = await issue("charge:5", [lineOf(1, "Implantación", 1, 25_000, 2100)], "2026-09-15", null);
  await finance.syncInvoices(ACTOR);

  const cats = await opsStore.listCategories();
  const hostingCat = cats.find((c) => c.name.startsWith("Hosting"))!;
  const softwareCat = cats.find((c) => c.name.startsWith("Software"))!;
  const general = (await opsStore.listCostCenters())[0];
  const supplier = await ops.createSupplier({ name: "Nube Sintética SL", taxId: "B12345674" }, ACTOR);
  const hosting = await ops.createExpense({ kind: "invoice", supplierId: supplier.id, categoryId: hostingCat.id, costCenterId: general.id, invoiceNumber: "H-10", invoiceDate: "2026-10-03", dueDate: "2026-10-20", description: "Servidores de octubre", baseCents: 50_000, taxRateBp: 2100 }, ACTOR);
  await ops.registerExpense(hosting.id, ACTOR);
  const software = await ops.createExpense({ kind: "invoice", supplierId: supplier.id, categoryId: softwareCat.id, invoiceNumber: "S-10", invoiceDate: "2026-10-04", dueDate: "2026-11-05", description: "Licencias", baseCents: 10_000, taxRateBp: 2100 }, ACTOR);
  await ops.registerExpense(software.id, ACTOR);
  await ops.addPayment(software.id, { paidOn: "2026-10-10", amountCents: 12_100, method: "bank", bankAccountId: bank.id }, ACTOR);

  const stripeStore = pool ? new MysqlFinanceStripeStore(pool) : new MemoryFinanceStripeStore();
  const own = pool ? new MysqlOwnInvoiceDirectory(pool, "test") : ownInvoicesFromStore(invoices);
  const stripe = new FinanceStripeService({ store: stripeStore, finance, ops: opsStore, ledger, invoices: own, now });
  ops.useReconciliation(stripe);
  await stripe.saveSettings({ stripePayoutBankAccountId: bank.id }, ACTOR);
  await stripe.importFile({ kind: "balance", filename: "balance.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
  await stripe.post("2026-10-31", ACTOR);
  await ops.importStatement({ bankAccountId: bank.id, format: "csv", filename: "extracto.csv", contentBase64: b64(["Fecha;Importe;Concepto", "2026-10-08;113,50;STRIPE PAYOUT", "2026-10-29;-3,50;COMISION MANTENIMIENTO"].join("\n")), mapping: MAPPING }, ACTOR);
  const payoutMov = (await ops.movements({ bankAccountId: bank.id, limit: 50 })).items.find((m) => m.amountCents === 11_350)!;
  await ops.match(payoutMov.id, { type: "stripe_payout", payoutId: 1 }, ACTOR);

  const store = pool ? new MysqlFinanceAnalysisStore(pool) : new MemoryFinanceAnalysisStore({ ledger: ledger as MemoryFinanceStore, ops: opsStore as MemoryFinanceOpsStore, stripe: stripeStore as MemoryFinanceStripeStore });
  const analysis = new FinanceAnalysisService({ store, finance, ledger, ops: opsStore, stripe: { service: stripe, store: stripeStore }, invoices: own, now, ...o.analysis });
  return { ledger, finance, ops, opsStore, bank, invoices, inv1, inv2, stripe, stripeStore, store, analysis, hosting, software, supplier, hostingCat, softwareCat, general };
}
