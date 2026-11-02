/**
 * Gastos automáticos de Stripe (Contabilidad › Gastos): un gasto por cargo real, sin duplicar asientos ni IVA, con la
 * factura de Stripe vinculable después. Datos SINTÉTICOS (informe de saldo de prueba de ./testkit).
 */
import { describe, expect, it } from "vitest";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario } from "./fiscalTestkit";
import type { MemoryFinanceOpsStore } from "./opsStore";
import { stripeBalanceSample } from "./testkit";

async function imported() {
  const s = await fiscalScenario();
  await s.stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
  return s;
}
const stripeExpenses = async (s: Awaited<ReturnType<typeof fiscalScenario>>) => (await s.ops.listExpenses({ sourcePrefix: "stripe-fee:", limit: 100 })).items;
const balanceOf = async (s: Awaited<ReturnType<typeof fiscalScenario>>, code: string) => (await s.ledger.postedLines({})).filter((l) => l.accountCode === code).reduce((a, l) => a + l.debitCents - l.creditCents, 0);

describe("gastos automáticos de Stripe", () => {
  it("uno por cargo: proveedor Stripe, 626 para comisiones de cobro y 629 para servicios; origen y referencia; 5720 intacto", async () => {
    const s = await imported();
    const before = await (async () => {
      await s.stripe.post("2026-10-31", ACTOR);
      return balanceOf(s, "5720");
    })();
    const items = await stripeExpenses(s);
    expect(items).toHaveLength(5);
    const cats = await s.opsStore.listCategories();
    const accountOf = (id: number | null) => cats.find((c) => c.id === id)?.accountCode;
    const services = items.filter((e) => accountOf(e.categoryId) === "629");
    expect(services.map((e) => [e.description, e.baseCents])).toEqual([[expect.stringMatching(/^Stripe · /), 150]]);
    expect(items.filter((e) => accountOf(e.categoryId) === "626").every((e) => e.description.startsWith("Comisión de Stripe por el"))).toBe(true);
    expect(items.every((e) => e.origin === "stripe" && e.stripeBalanceTransactionId === e.sourceKey!.slice("stripe-fee:".length) && e.pendingCents === 0)).toBe(true);
    const sup = (await s.opsStore.listSuppliers({ q: "Stripe" })).items;
    expect(sup).toEqual([expect.objectContaining({ name: "Stripe", legalName: "Stripe Payments Europe, Limited", country: "IE", taxId: null })]);
    // Total de gastos de Stripe = lo que salió de 555 a 626/629; el saldo de Stripe no cambia en otra pasada
    expect(items.reduce((a, e) => a + e.totalCents, 0)).toBe((await balanceOf(s, "626")) + (await balanceOf(s, "629")));
    await s.stripe.post("2026-10-31", ACTOR);
    expect(await balanceOf(s, "5720")).toBe(before);
    expect(await stripeExpenses(s)).toHaveLength(5);
  });

  it("no se pagan, anulan, editan ni registran a mano; fuera de los modelos y del libro de recibidas (su IVA va por el libro)", async () => {
    const s = await imported();
    await s.stripe.post("2026-10-31", ACTOR);
    const [e] = await stripeExpenses(s);
    await expect(s.ops.addPayment(e.id, { paidOn: "2026-10-31", amountCents: e.totalCents, method: "stripe" }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(s.ops.voidExpense(e.id, "Prueba", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(s.ops.patchExpense(e.id, { description: "Otra" }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await s.tax.receivedRegisterCsv("2026-10-01", "2026-10-31")).csv).not.toContain("Comisión de Stripe");
    const d303 = await s.tax.preview("303", 2026, "4T");
    expect(JSON.stringify(d303)).not.toContain("stripe-fee:");
  });

  it("recuperación: un gasto que quedó en borrador tras un fallo se registra en la pasada siguiente, sin repetir el asiento", async () => {
    const s = await imported();
    await s.stripe.post("2026-10-31", ACTOR);
    const store = s.opsStore as MemoryFinanceOpsStore;
    const victim = store.expenses.find((e) => e.sourceKey === "stripe-fee:txn_test_c1")!;
    Object.assign(victim, { status: "draft", entryId: null, paidCents: 0, paymentStatus: "pending" });
    const entries = (await s.finance.listEntries({ limit: 500 })).total;
    const out = await s.stripe.syncFeeExpenses(ACTOR);
    expect(out).toMatchObject({ created: 1, errors: [] });
    const again = (await stripeExpenses(s)).find((e) => e.sourceKey === "stripe-fee:txn_test_c1")!;
    expect(again).toMatchObject({ status: "registered", paymentStatus: "paid" });
    expect(again.entryId).toEqual(expect.any(Number));
    expect((await s.finance.listEntries({ limit: 500 })).total).toBe(entries);
    expect(await stripeExpenses(s)).toHaveLength(5);
  });

  it("la factura de Stripe se vincula a varios gastos a la vez (idempotente); solo gastos de Stripe registrados", async () => {
    const s = await imported();
    await s.stripe.post("2026-10-31", ACTOR);
    const ids = (await stripeExpenses(s)).map((e) => e.id);
    expect(await s.stripe.linkFeeInvoice({ expenseIds: ids, invoiceRef: " STRIPE-2026-10 " }, ACTOR)).toEqual({ invoiceRef: "STRIPE-2026-10", expenses: 5, linked: 5 });
    expect((await s.stripe.linkFeeInvoice({ expenseIds: ids, invoiceRef: "STRIPE-2026-10" }, ACTOR)).linked).toBe(0);
    expect((await stripeExpenses(s)).every((e) => e.supplierInvoiceRef === "STRIPE-2026-10")).toBe(true);
    const manual = await s.ops.createExpense({ kind: "invoice", supplierId: s.es.id, categoryId: s.cat("629"), invoiceNumber: "F-9", invoiceDate: "2026-10-03", description: "Hosting", baseCents: 1_000, taxRateBp: 2100 }, ACTOR);
    await s.ops.registerExpense(manual.id, ACTOR);
    await expect(s.stripe.linkFeeInvoice({ expenseIds: [ids[0], manual.id], invoiceRef: "X" }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(s.stripe.linkFeeInvoice({ expenseIds: ids, invoiceRef: "" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("exenta decidida después: se fija el tratamiento sin asiento de IVA; ya no cuentan como pendientes", async () => {
    const s = await imported();
    await s.stripe.post("2026-10-31", ACTOR);
    expect(await s.stripe.pendingFiscalExpenses()).toHaveLength(5);
    await s.stripe.createFeeVatRule({ feeKind: "*", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", treatment: "exempt", validFrom: "2026-01-01" }, ACTOR);
    const entries = (await s.finance.listEntries({ limit: 500 })).total;
    expect(await s.stripe.syncFeeExpenses(ACTOR)).toMatchObject({ created: 0, classified: 5, pendingFiscal: 0 });
    expect((await s.finance.listEntries({ limit: 500 })).total).toBe(entries);
    expect((await stripeExpenses(s)).every((e) => e.vatTreatment === "exempt")).toBe(true);
  });
});
