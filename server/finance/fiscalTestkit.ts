/**
 * Utilidades de PRUEBA de la parametrización fiscal (CRM 0039): monta el libro, las operaciones, Stripe, la gestoría y
 * el análisis con la migración 0039 «aplicada» (`fiscal: true`), en memoria o sobre MySQL, con datos SINTÉTICOS: un
 * banco, un proveedor alemán con NIF-IVA, otro español y la configuración fiscal guardada.
 */
import type mysql from "mysql2/promise";
import { FinanceAnalysisService } from "./analysisService";
import { MemoryFinanceAnalysisStore, MysqlFinanceAnalysisStore } from "./analysisStore";
import { FinanceOpsService } from "./opsService";
import { MemoryFinanceOpsStore, MysqlFinanceOpsStore } from "./opsStore";
import { FinanceService } from "./service";
import { MemoryFinanceStore, MysqlFinanceStore } from "./store";
import { FinanceStripeService } from "./stripeService";
import { MemoryFinanceStripeStore, MysqlFinanceStripeStore } from "./stripeStore";
import { FinanceTaxService } from "./taxService";
import { MemoryFinanceTaxStore, MysqlFinanceTaxStore } from "./taxStore";
import { seededOps, seededPlan } from "./testkit";

export const FISCAL_T0 = Date.UTC(2026, 9, 30, 10); // 30/10/2026
export const FISCAL_ACTOR = { by: "operator:luis", requestId: "req-fiscal" };
export const PDF_B64 = Buffer.from("%PDF-1.4\n% documento sintético\n").toString("base64");
export const b64 = (s: string) => Buffer.from(s).toString("base64");

export async function fiscalScenario(o: { pool?: mysql.Pool; fiscal?: boolean; now?: () => number } = {}) {
  const fiscal = o.fiscal ?? true;
  const now = o.now ?? (() => FISCAL_T0);
  const pool = o.pool;
  const ACTOR = FISCAL_ACTOR;
  const ledger = pool ? new MysqlFinanceStore(pool) : new MemoryFinanceStore(seededPlan());
  const finance = new FinanceService({ store: ledger, now });
  for (const y of [2025, 2026]) await finance.createFiscalYear(y, ACTOR);
  const opsStore = pool ? new MysqlFinanceOpsStore(pool, { fiscal }) : new MemoryFinanceOpsStore(seededOps());
  const ops = new FinanceOpsService({ store: opsStore, finance, ledger, now, fiscal });
  const stripeStore = pool ? new MysqlFinanceStripeStore(pool) : new MemoryFinanceStripeStore();
  const stripe = new FinanceStripeService({ store: stripeStore, finance, ops: opsStore, ledger, now, fiscal });
  ops.useReconciliation(stripe);
  if (fiscal) ops.useStripeFeeInvoices(stripe);
  const taxStore = pool ? new MysqlFinanceTaxStore(pool, { fiscal }) : new MemoryFinanceTaxStore();
  const tax = new FinanceTaxService({ store: taxStore, finance, ledger, ops: opsStore, documents: ops, stripe: stripeStore, issuer: { legalName: "EMPRESA DE PRUEBA, S.L.", taxId: "B00000000" }, now, fiscal, stripeFeeVat: stripe });
  ops.useTaxDocumentOwners((t, id) => tax.documentOwnerExists(t, id));
  const analysisStore = pool ? new MysqlFinanceAnalysisStore(pool, { fiscal }) : new MemoryFinanceAnalysisStore({ ledger: ledger as MemoryFinanceStore, ops: opsStore as MemoryFinanceOpsStore, stripe: stripeStore as MemoryFinanceStripeStore });
  const analysis = new FinanceAnalysisService({ store: analysisStore, finance, ledger, ops: opsStore, stripe: { service: stripe, store: stripeStore }, tax, now, fiscal });
  if (fiscal) ops.useBankFeeNatures((n) => analysis.natureAccount(n));
  const bank = await ops.createBankAccount({ name: "Banco de pruebas", iban: "ES9121000418450200051332" }, ACTOR);
  await stripe.saveSettings({ stripePayoutBankAccountId: bank.id, ...(fiscal ? { stripeFeeVat: "unset" as const } : {}) }, ACTOR);
  const cats = await opsStore.listCategories();
  const cat = (account: string) => cats.find((c) => c.accountCode === account)!.id;
  const de = await ops.createSupplier({ name: "Wolke GmbH", legalName: "Wolke GmbH", taxId: "DE123456789", country: "DE" }, ACTOR);
  const deNoVat = await ops.createSupplier({ name: "Teile GmbH", country: "DE" }, ACTOR);
  const es = await ops.createSupplier({ name: "Hosting Nube SL", taxId: "B12345674" }, ACTOR);
  await tax.saveSettings({ intraEuOperations: true, stripeVatId: "IE3206488LH" }, ACTOR);
  return { pool, ledger, finance, opsStore, ops, stripeStore, stripe, taxStore, tax, analysisStore, analysis, bank, cat, de, deNoVat, es, ACTOR };
}
