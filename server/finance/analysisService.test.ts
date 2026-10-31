/**
 * Servicio de la fase 4 en memoria sobre el escenario sintético de analysisTestkit (servicios reales de las fases 1–2):
 * cuenta de resultados y balance cuadrados contra el libro (sumas y saldos y mayor), centro de coste, tesorería con su
 * identidad y la apertura del diario APE, previsión, antigüedad a una fecha, gastos, Revenue & Margin con la marca de
 * coste directo, Conversion Health con fechas, control diario y revisión idempotente con bitácora.
 */
import { describe, expect, it } from "vitest";
import { analysisScenario, ANALYSIS_ACTOR as ACTOR } from "./analysisTestkit";

const sixSeven = async (finance: Awaited<ReturnType<typeof analysisScenario>>["finance"], from: string, to: string) => {
  const tb = await finance.trialBalance(from, to);
  return tb.items.filter((r) => /^[67]/.test(r.code)).reduce((a, r) => a - r.balanceCents, 0);
};

describe("cuenta de resultados y balance desde el libro", () => {
  it("el resultado por meses coincide con sumas y saldos; partidas y desglose por cuenta; comparación con el año anterior", async () => {
    const { analysis, finance } = await analysisScenario();
    const pnl = await analysis.pnl({ from: "2026-09-01", to: "2026-10-31", compare: "year" });
    expect(pnl.periods.map((p) => p.key)).toEqual(["2026-09", "2026-10"]);
    expect(pnl.compare).toEqual({ kind: "year", from: "2025-09-01", to: "2025-10-31", periods: [expect.objectContaining({ key: "2025-09" }), expect.objectContaining({ key: "2025-10" })] });
    const line = (k: string) => pnl.lines.find((l) => l.key === k)!;
    expect(line("revenue").values).toEqual([25_000, 10_000]);
    // Hosting 500 € y software 100 € (629) y comisiones de Stripe (626): 3,88 + 2,12 + 1,50 de servicios − 15 + 15 disputa
    expect(line("otherOperatingExpenses").accounts.map((a) => [a.code, a.totalCents])).toEqual([["626", -750], ["629", -60_000]]);
    expect(pnl.result.totalCents).toBe(await sixSeven(finance, "2026-09-01", "2026-10-31"));
    expect(pnl.result).toEqual({ totalCents: 25_000 + 10_000 - 60_000 - 750, compareTotalCents: 0 });
    expect(line("revenue")).toMatchObject({ compareTotalCents: 0, variationCents: 35_000, variationPct: null });
    // Trimestral y anual: mismo total
    expect((await analysis.pnl({ from: "2026-01-01", to: "2026-12-31", granularity: "quarter" })).result.totalCents).toBe(pnl.result.totalCents);
    expect((await analysis.pnl({ from: "2026-01-01", to: "2026-12-31", granularity: "year" })).lines.find((l) => l.key === "netResult")!.values).toEqual([pnl.result.totalCents]);
  });

  it("filtro por centro de coste (solo el hosting está imputado a General) y centro inexistente", async () => {
    const { analysis, general } = await analysisScenario();
    const pnl = await analysis.pnl({ from: "2026-10-01", to: "2026-10-31", costCenter: general.id });
    expect(pnl.costCenter).toEqual({ id: general.id, code: general.code, name: general.name });
    expect(pnl.result.totalCents).toBe(-50_000);
    expect(pnl.notes).toHaveLength(2);
    await expect(analysis.pnl({ costCenter: 999 })).rejects.toMatchObject({ code: "not_found" });
    await expect(analysis.pnl({ from: "2023-01-01", to: "2026-10-31" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("balance cuadrado; tesorería del balance = saldos del mayor; resultado del ejercicio = cuenta de resultados del año", async () => {
    const { analysis, finance, bank } = await analysisScenario();
    const b = await analysis.balance("2026-10-31");
    expect(b.check.balanced).toBe(true);
    expect(b.check.differenceCents).toBe(0);
    const cash = b.assets.current.lines.find((l) => l.key === "cash")!;
    const bankBalance = (await finance.ledger(bank.accountCode, "2026-01-01", "2026-10-31")).closingCents;
    const stripeBalance = (await finance.ledger("5720", "2026-01-01", "2026-10-31")).closingCents;
    // 5720 queda a cero (todo lo cobrado se liquidó o se retuvo y devolvió): una cuenta sin saldo no se lista
    expect(stripeBalance).toBe(0);
    expect(cash.accounts).toEqual([{ code: bank.accountCode, name: expect.any(String), amountCents: bankBalance }]);
    expect(cash.amountCents).toBe(bankBalance + stripeBalance);
    expect(b.result.currentYearCents).toBe((await analysis.pnl({ from: "2026-01-01", to: "2026-10-31" })).result.totalCents);
    expect(b.equityAndLiabilities.equity.lines.find((l) => l.key === "capital")!.amountCents).toBe(1_000_000);
    // A una fecha anterior a todo: vacío y cuadrado
    expect((await analysis.balance("2025-06-30")).check).toEqual({ assetsCents: 0, equityAndLiabilitiesCents: 0, differenceCents: 0, balanced: true });
  });
});

describe("tesorería, previsión y antigüedad", () => {
  it("la apertura del diario APE forma el saldo inicial; saldo final = mayor; final − inicial = entradas − salidas", async () => {
    const { analysis, finance, bank } = await analysisScenario();
    const c = await analysis.cashflow({ from: "2026-01-01", to: "2026-10-31", forecastDays: 0 });
    const acc = c.accounts.find((a) => a.code === bank.accountCode)!;
    expect(acc.openingCents).toBe(1_000_000);
    expect(acc.closingCents).toBe((await finance.ledger(bank.accountCode, "2026-01-01", "2026-10-31")).closingCents);
    expect(c.totals.closingCents - c.totals.openingCents).toBe(c.totals.netCents);
    expect(c.totals.internalTransfersCents).toBe(11_350);
    expect(c.byNature.find((n) => n.key === "suppliers")).toMatchObject({ outCents: 12_100 });
    expect(c.forecast).toBeNull();
    expect(c.months).toHaveLength(10);
  });

  it("previsión: el pago vencido del hosting mañana, la factura vencida aparte, impuestos de la gestoría", async () => {
    const tax = {
      listObligations: async () => ({ items: [{ id: 5, model: "303", year: 2026, period: "4T", dueDate: "2026-11-20", status: "borrador", amountCents: 4_200, outcome: "a_ingresar" }], total: 1 }) as never,
    };
    const { analysis } = await analysisScenario({ analysis: { tax } });
    const f = await analysis.forecast(30);
    expect(f.items.map((i) => [i.date, i.kind, i.amountCents, i.overdue])).toEqual([
      ["2026-11-01", "payable", -60_500, true],
      ["2026-11-20", "tax", -4_200, false],
    ]);
    expect(f.excluded).toMatchObject({ overdueReceivablesCount: 1, overdueReceivablesCents: 30_250 });
    expect(f.buckets).toEqual([{ days: 30, until: "2026-11-30", inflowsCents: 0, outflowsCents: 64_700, netCents: -64_700, projectedBalanceCents: f.startingBalanceCents - 64_700 }]);
    expect(f.sources).toEqual({ receivables: true, taxes: true });
  });

  it("antigüedad de pagos y de cobros a una fecha (lo cobrado después no cuenta)", async () => {
    const { analysis, supplier } = await analysisScenario();
    const pay = await analysis.aging("payable", "2026-10-31");
    expect(pay.totals).toMatchObject({ totalCents: 60_500, d0_30: 60_500, count: 1 });
    expect(pay.parties).toEqual([expect.objectContaining({ key: `supplier:${supplier.id}`, name: "Nube Sintética SL", totalCents: 60_500 })]);
    // A 5/10 el software (vence el 5/11) estaba sin pagar: no vencido
    expect((await analysis.aging("payable", "2026-10-05")).totals).toMatchObject({ current: 60_500 + 12_100, totalCents: 72_600 });
    const rec = await analysis.aging("receivable", "2026-10-31");
    expect(rec.totals).toMatchObject({ totalCents: 30_250, d31_60: 30_250, count: 1 });
    // El 22/10 el cobro de EB-1 estaba retenido por la disputa: pendiente
    const before = await analysis.aging("receivable", "2026-10-22");
    expect(before.totals.totalCents).toBe(30_250 + 12_100);
    expect(before.parties[0].documents.map((d) => [d.number, d.bucket])).toEqual([["EB-000002", "d31_60"], ["EB-000001", "d0_30"]].map(([n, b]) => [expect.stringContaining(n!.slice(-1)), b]));
  });
});

describe("gastos, Revenue & Margin y Conversion Health", () => {
  it("gastos por categoría, centro y proveedor (con comparación)", async () => {
    const { analysis, hostingCat, softwareCat, general, supplier } = await analysisScenario();
    const byCat = await analysis.expenses({ from: "2026-10-01", to: "2026-10-31", compare: "previous" });
    expect(byCat.items.map((i) => [i.key, i.name, i.totalCents])).toEqual([
      [`category:${hostingCat.id}`, hostingCat.name, 50_000],
      [`category:${softwareCat.id}`, softwareCat.name, 10_000],
      ["account:626", "626 · Servicios bancarios y similares (sin categoría)", 750],
    ]);
    expect(byCat.compare).toEqual({ kind: "previous", from: "2026-09-01", to: "2026-09-30" });
    expect(byCat.totals).toMatchObject({ totalCents: 60_750, compareCents: 0 });
    const byCc = await analysis.expenses({ from: "2026-10-01", to: "2026-10-31", groupBy: "costCenter" });
    expect(byCc.items.map((i) => [i.name, i.totalCents])).toEqual([[general.name, 50_000], ["Sin centro de coste", 10_750]]);
    const bySup = await analysis.expenses({ from: "2026-10-01", to: "2026-10-31", groupBy: "supplier" });
    expect(bySup.items.map((i) => [i.id, i.name, i.totalCents])).toEqual([[supplier.id, "Nube Sintética SL", 60_000], [null, "Sin proveedor", 750]]);
  });

  it("Revenue & Margin: hosting coste directo por defecto; la marca del operador lo cambia; resultado = cuenta de resultados", async () => {
    const { analysis, hostingCat, softwareCat } = await analysisScenario();
    const cats = await analysis.decorateCategories([hostingCat, softwareCat]);
    expect(cats.map((c) => [c.isDirectCost, c.directCost])).toEqual([[null, true], [null, false]]);
    const rm = await analysis.revenueMargin(2026);
    const oct = rm.months.find((m) => m.month === "2026-10")!;
    expect(oct).toMatchObject({ accruedRevenueCents: 10_000, stripeFeesCents: 750, directCostsCents: 50_000, grossMarginCents: 10_000 - 750 - 50_000, structureCostsCents: 10_000 });
    // Cobrado: cobros de Stripe (121 + 60,50) − reembolso (60,50) = 121 €
    expect(oct.collectedCents).toBe(12_100);
    expect(oct.stripeFeesPct).toBe(6.2);
    expect(oct.resultCents).toBe((await analysis.pnl({ from: "2026-10-01", to: "2026-10-31" })).result.totalCents);
    expect(rm.ytd.through).toBe("2026-10");
    expect(rm.ytd.resultCents).toBe((await analysis.pnl({ from: "2026-01-01", to: "2026-10-31" })).result.totalCents);
    expect(rm.commercial).toEqual({ label: expect.stringContaining("no contables"), metrics: null, topCompanies: null });
    await analysis.setDirectCost(hostingCat.id, false, ACTOR);
    await analysis.setDirectCost(softwareCat.id, true, ACTOR);
    const after = (await analysis.revenueMargin(2026)).months.find((m) => m.month === "2026-10")!;
    expect(after).toMatchObject({ directCostsCents: 10_000, structureCostsCents: 50_000 });
    await expect(analysis.setDirectCost(999, true, ACTOR)).rejects.toMatchObject({ code: "not_found" });
    expect((await analysis.revenueMargin(2025)).ytd.through).toBe("2025-12");
  });

  it("métricas comerciales consumidas tal cual y aparte; el top de empresas por margen", async () => {
    const { analysis } = await analysisScenario();
    const tenant = (key: string, billed: number, margin: number | null) => ({ key, kind: "saas", displayName: key, revenue: { billedCents: billed }, cost: { totalCents: 100 }, margin: { complete: margin !== null, cents: margin, provisionalCents: margin } });
    const rm = await analysis.revenueMargin(2026, {
      metrics: async () => ({ windowDays: 30, currency: "EUR", mrrCents: 50_000, arrCents: 600_000, payingCompanies: 3, collected: { netCents: 1, taxCents: 0, grossCents: 1, invoices: 1 }, churn: { canceledCount: 0, lostMrrCents: 0, rate: null } }),
      profitability: async (days) => ({ days, complete: false, tenants: [tenant("a", 1_000, 200), tenant("b", 5_000, 4_000), tenant("c", 9_000, null)] }),
    });
    expect(rm.commercial.metrics).toMatchObject({ available: true, mrrCents: 50_000, arrCents: 600_000, payingCompanies: 3 });
    expect(rm.commercial.topCompanies).toMatchObject({ days: 365, complete: false });
    expect(rm.commercial.topCompanies!.items.map((t) => [t.key, t.marginCents])).toEqual([["c", null], ["b", 4_000], ["a", 200]]);
    // Una fuente que falla no rompe el informe
    const broken = await analysis.revenueMargin(2026, { metrics: async () => Promise.reject(new Error("x")), profitability: null });
    expect(broken.commercial.metrics).toBeNull();
  });

  it("Conversion Health: cohorte de octubre, plazos con fechas, reembolsos, cobros sin factura y pagos fallidos", async () => {
    const paymentEvents = { monthly: async () => [{ month: "2026-10", failed: 1, succeeded: 2 }] };
    const { analysis } = await analysisScenario({ analysis: { paymentEvents } });
    const c = await analysis.conversion({ from: "2026-09-01", to: "2026-10-31" });
    const oct = c.months[1];
    expect(oct.invoices).toEqual({ count: 1, amountCents: 12_100 });
    expect(oct.collectedPct).toBe(100);
    expect(oct.dsoDays).toBe(4); // factura 1/10 → cobro 5/10
    // Disponibilidad = la última de los cobros positivos (la reversión de la disputa estuvo disponible el 25/10)
    expect(oct.chargeToAvailableDays).toBe(20);
    expect(oct.payoutToBankDays).toBe(0); // payout y banco el 8/10
    expect(oct.stripe).toMatchObject({ chargesCents: 18_150, refundsCents: 6_050, refundsPct: 33.3, disputesCents: 0, chargesWithoutInvoice: { count: 1, amountCents: 6_050 } });
    expect(oct.failedPayments).toEqual({ failed: 1, succeeded: 2, ratePct: 33.3 });
    expect(c.months[0]).toMatchObject({ invoices: { count: 1, amountCents: 30_250 }, collectedPct: 0, dsoDays: null });
    expect(c.totals.overdueUnpaid).toEqual({ count: 1, amountCents: 30_250, days: 30 });
    expect(c.commercialFunnel).toBeNull();
    expect(c.asOf).toBe("2026-10-31");
  });
});

describe("control diario y revisión", () => {
  it("recuentos, detalle y avisos del día; null donde falta la fuente", async () => {
    const { analysis } = await analysisScenario();
    const d = await analysis.daily("2026-10-31");
    expect(d.counts).toMatchObject({ invoicesIssued: 0, paymentsOverdue: 1, paymentsDueToday: 0, paymentsDueNext7: 0, receivablesOverdue: 1, draftEntries: 0, bankPending: 1, taxDueNext15: null, taxOverdue: null });
    expect(d.expenses.due.overdue).toEqual({ count: 1, amountCents: 60_500 });
    expect(d.bank.pending).toMatchObject({ count: 1, amountCents: 350, oldestDate: "2026-10-29", buckets: { d0_7: 1, d8_30: 0, d30_plus: 0 } });
    expect(d.receivables).toEqual({ count: 1, amountCents: 30_250, days: 30 });
    expect(d.alerts.map((a) => a.code)).toEqual(expect.arrayContaining(["payments_overdue", "receivables_overdue", "bank_pending", "stripe_issues"]));
    expect(d.review).toBeNull();
    expect(d.tax).toBeNull();
    const oct1 = await analysis.daily("2026-10-01");
    expect(oct1.invoices).toMatchObject({ count: 1, totalCents: 12_100 });
    const oct5 = await analysis.daily("2026-10-05");
    expect(oct5.stripe!.charges).toEqual({ count: 1, grossCents: 12_100, feeCents: 388, netCents: 11_712 });
    const oct8 = await analysis.daily("2026-10-08");
    expect(oct8.payouts!.arriving).toEqual([expect.objectContaining({ payoutId: "po_test_1", amountCents: 11_350, inBank: true })]);
    expect(oct8.bank.movements).toEqual({ count: 1, inCents: 11_350, outCents: 0 });
    // Gastos registrados en el día (por la marca de tiempo del registro, en Madrid)
    expect((await analysis.daily("2026-10-31")).expenses.registered).toEqual({ count: 2, totalCents: 72_600 });
    await expect(analysis.daily("2026-13-01")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("revisión idempotente con instantánea; solo cambia la nota y queda en la bitácora; día futuro no", async () => {
    const { analysis, finance } = await analysisScenario();
    const first = await analysis.review("2026-10-30", "Todo cuadra", ACTOR);
    expect(first.created).toBe(true);
    expect(first.item).toMatchObject({ day: "2026-10-30", reviewedBy: "operator:luis", note: "Todo cuadra", noteEditedBy: null, snapshot: expect.objectContaining({ paymentsOverdue: 1 }) });
    expect(first.item.log).toEqual([expect.objectContaining({ action: "review", noteBefore: null, noteAfter: "Todo cuadra" })]);
    const again = await analysis.review("2026-10-30", "Todo cuadra", { by: "operator:ana", requestId: null });
    expect(again.created).toBe(false);
    expect(again.item.reviewedBy).toBe("operator:luis");
    expect(again.item.log).toHaveLength(1);
    const edited = await analysis.review("2026-10-30", "  Revisado con la gestoría  ", { by: "operator:ana", requestId: "r2" });
    expect(edited.item).toMatchObject({ note: "Revisado con la gestoría", noteEditedBy: "operator:ana", reviewedBy: "operator:luis" });
    expect(edited.item.log.map((l) => [l.action, l.noteBefore, l.noteAfter])).toEqual([["review", null, "Todo cuadra"], ["note", "Todo cuadra", "Revisado con la gestoría"]]);
    // Sin nota en el cuerpo: no la toca
    expect((await analysis.review("2026-10-30", undefined, ACTOR)).item.log).toHaveLength(2);
    // Nota vacía = borrarla (queda en la bitácora)
    expect((await analysis.review("2026-10-30", "", ACTOR)).item.note).toBeNull();
    await expect(analysis.review("2026-11-01", null, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(analysis.review("2026-10-29", "x".repeat(1001), ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    expect((await analysis.daily("2026-10-30")).review).toMatchObject({ day: "2026-10-30", note: null });
    const list = await analysis.reviews({ from: "2026-10-01", to: "2026-10-31" });
    expect(list).toEqual({ items: [expect.objectContaining({ day: "2026-10-30" })], total: 1 });
    const audit = (finance as unknown as { d: { store: { audit: Array<{ action: string }> } } }).d.store.audit.map((a) => a.action);
    expect(audit.filter((a) => a.startsWith("daily."))).toEqual(["daily.review", "daily.note", "daily.note"]);
  });
});
