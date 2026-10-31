/**
 * Reglas puras de la fase 4 con casos numéricos: periodos y comparativas, partidas del PGC, cuenta de resultados y
 * balance CUADRADOS a partir de asientos sintéticos (también con un ejercicio anterior sin regularizar), tesorería por
 * naturaleza con su identidad (saldo final − inicial = entradas − salidas), previsión, antigüedad, gastos agrupados,
 * Revenue & Margin, conversión con fechas, coste directo, avisos y CSV. Solo datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import {
  addMonths,
  agingBucketOf,
  agingCsv,
  balanceCsv,
  balanceLineOf,
  balancesOfFacts,
  buildAging,
  buildBalance,
  buildCashflow,
  buildConversion,
  buildExpenseGroups,
  buildForecast,
  buildPnl,
  buildRevenueMargin,
  cashflowCsv,
  compareRange,
  conversionCsv,
  dailyAlerts,
  dailyCsv,
  expensesCsv,
  flowNatureOf,
  lastDayOf,
  monthRange,
  periodsOf,
  pnlCsv,
  pnlLineOf,
  resolveDirectCost,
  revenueMarginCsv,
  shiftPeriods,
  type ConversionInvoice,
} from "./analysisRules";
import type { LedgerFact, TreasuryFact } from "./analysisTypes";
import type { EntryOrigin } from "./types";

type L = [code: string, debit: number, credit: number, dims?: { cc?: number; sup?: number; cat?: number }];
interface E {
  date: string;
  origin?: EntryOrigin;
  journal?: string;
  lines: L[];
}

/** Hechos agregados (como el GROUP BY de MySQL) a partir de asientos sintéticos. */
function factsOf(entries: E[], f: { from?: string; to?: string; prefixes?: string[]; exclude57?: boolean; withTreasury?: boolean; cc?: number } = {}): LedgerFact[] {
  const m = new Map<string, LedgerFact>();
  for (const e of entries) {
    if ((f.from && e.date < f.from) || (f.to && e.date > f.to)) continue;
    if (f.withTreasury && !e.lines.some((l) => l[0].startsWith("57"))) continue;
    for (const [code, d, c, dims] of e.lines) {
      if (f.prefixes && !f.prefixes.some((p) => code.startsWith(p))) continue;
      if (f.exclude57 && code.startsWith("57")) continue;
      if (f.cc !== undefined && dims?.cc !== f.cc) continue;
      const fact: LedgerFact = { month: e.date.slice(0, 7), accountCode: code, origin: e.origin ?? "manual", costCenterId: dims?.cc ?? null, supplierId: dims?.sup ?? null, categoryId: dims?.cat ?? null, debitCents: 0, creditCents: 0 };
      const k = [fact.month, code, fact.origin, fact.costCenterId, fact.supplierId, fact.categoryId].join("|");
      const cur = m.get(k) ?? fact;
      cur.debitCents += d;
      cur.creditCents += c;
      m.set(k, cur);
    }
  }
  return Array.from(m.values());
}
function treasuryOf(entries: E[], from: string, to: string): TreasuryFact[] {
  const out: TreasuryFact[] = [];
  for (const e of entries) {
    if (e.date < from || e.date > to || e.journal === "APE") continue;
    const internal = e.lines.every((l) => l[0].startsWith("57"));
    for (const [code, d, c] of e.lines.filter((l) => l[0].startsWith("57"))) out.push({ month: e.date.slice(0, 7), accountCode: code, internal, debitCents: d, creditCents: c });
  }
  return out;
}

const BANK = "57200001";
/** Escenario: capital y un gasto de 2025 sin regularizar; en 2026 facturas, gasto, pagos, Stripe, payout, tributo y nómina. */
const LEDGER: E[] = [
  { date: "2025-03-01", lines: [[BANK, 300_000, 0], ["100", 0, 300_000]] },
  { date: "2025-06-01", lines: [["629", 20_000, 0], [BANK, 0, 20_000]] },
  { date: "2026-09-15", origin: "invoice", lines: [["430", 60_500, 0], ["705", 0, 50_000], ["477", 0, 10_500]] },
  { date: "2026-10-02", origin: "invoice", lines: [["430", 121_000, 0], ["705", 0, 100_000], ["477", 0, 21_000]] },
  { date: "2026-10-03", origin: "expense", lines: [["629", 50_000, 0, { cc: 1, sup: 7, cat: 1 }], ["472", 10_500, 0, { sup: 7 }], ["400", 0, 60_500, { sup: 7 }]] },
  { date: "2026-10-05", origin: "stripe", lines: [["5720", 117_120, 0], ["626", 3_880, 0], ["430", 0, 121_000]] },
  { date: "2026-10-08", origin: "stripe", lines: [[BANK, 113_500, 0], ["5720", 0, 113_500]] },
  { date: "2026-10-10", origin: "expense_payment", lines: [["400", 60_500, 0, { sup: 7 }], [BANK, 0, 60_500]] },
  { date: "2026-10-20", origin: "bank", lines: [["631", 5_000, 0, { cc: 2 }], [BANK, 0, 5_000]] },
  { date: "2026-10-31", origin: "payroll", lines: [["640", 100_000, 0], ["465", 0, 100_000]] },
  { date: "2026-10-31", origin: "payroll", lines: [["465", 100_000, 0], [BANK, 0, 100_000]] },
];
const NAMES = new Map([
  ["100", "Capital social"],
  ["430", "Clientes"],
  ["472", "H.P. IVA soportado"],
  ["477", "H.P. IVA repercutido"],
  ["626", "Servicios bancarios y similares"],
  ["629", "Otros servicios"],
  ["631", "Otros tributos"],
  ["640", "Sueldos y salarios"],
  ["705", "Prestaciones de servicios"],
  [BANK, "Banco: principal"],
  ["5720", "Stripe"],
]);

describe("periodos y comparativas", () => {
  it("meses, trimestres recortados al rango y años; rango normalizado a meses completos con tope de 36", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(periodsOf("2026-02", "2026-07", "quarter").map((p) => [p.key, p.label, p.from, p.to, p.months.length])).toEqual([
      ["2026-T1", "1T 2026", "2026-02-01", "2026-03-31", 2],
      ["2026-T2", "2T 2026", "2026-04-01", "2026-06-30", 3],
      ["2026-T3", "3T 2026", "2026-07-01", "2026-07-31", 1],
    ]);
    expect(periodsOf("2025-11", "2026-02", "year").map((p) => p.key)).toEqual(["2025", "2026"]);
    expect(periodsOf("2026-10", "2026-10", "month")[0]).toMatchObject({ key: "2026-10", label: "octubre 2026" });
    expect(monthRange("2026-03-15", "2026-05-02")).toEqual({ from: "2026-03-01", to: "2026-05-31", fromYm: "2026-03", toYm: "2026-05", months: 3 });
    expect(() => monthRange("2026-05-01", "2026-03-01")).toThrow(/posterior/);
    expect(() => monthRange("2023-01-01", "2026-01-31")).toThrow(/36 meses/);
  });

  it("comparación con el periodo anterior (misma duración) y con el mismo del año anterior", () => {
    expect(compareRange("2026-07", "2026-09", "previous")).toEqual({ fromYm: "2026-04", toYm: "2026-06", from: "2026-04-01", to: "2026-06-30", shift: -3 });
    expect(compareRange("2026-01", "2026-12", "year")).toMatchObject({ from: "2025-01-01", to: "2025-12-31", shift: -12 });
    expect(compareRange("2026-01", "2026-01", "none")).toBeNull();
    // El periodo anterior de un rango que empieza a mitad de trimestre conserva la forma de los periodos actuales
    const cur = periodsOf("2026-02", "2026-04", "quarter");
    const prev = shiftPeriods(cur, -3, "quarter");
    expect(prev.map((p) => [p.key, p.label, p.months])).toEqual([
      ["2025-T4", "4T 2025", ["2025-11", "2025-12"]],
      ["2026-T1", "1T 2026", ["2026-01"]],
    ]);
    // Si el periodo desplazado cruza el límite de un trimestre, se rotula con sus meses
    expect(shiftPeriods(cur, -2, "quarter")[0]).toMatchObject({ key: "2025-12/2026-01", label: "diciembre 2025 – enero 2026", from: "2025-12-01", to: "2026-01-31" });
    expect(shiftPeriods(periodsOf("2026-01", "2026-06", "quarter"), -12, "quarter").map((p) => p.label)).toEqual(["1T 2025", "2T 2025"]);
  });
});

describe("cuenta de pérdidas y ganancias", () => {
  it("cada cuenta de los grupos 6 y 7 cae en su partida del modelo abreviado (prefijo más largo)", () => {
    const cases: Array<[string, string]> = [
      ["705", "revenue"],
      ["708", "revenue"],
      ["600", "supplies"],
      ["6931", "supplies"],
      ["6930", "inventoryChange"],
      ["759", "otherOperatingIncome"],
      ["640", "personnel"],
      ["642", "personnel"],
      ["621", "otherOperatingExpenses"],
      ["626", "otherOperatingExpenses"],
      ["631", "otherOperatingExpenses"],
      ["681", "depreciation"],
      ["678", "otherResults"],
      ["778", "otherResults"],
      ["769", "financialIncome"],
      ["662", "financialExpenses"],
      ["669", "financialExpenses"],
      ["668", "exchangeDifferences"],
      ["699", "financialImpairment"],
      ["630", "incomeTax"],
      ["6300001", "incomeTax"],
      ["671", "fixedAssetDisposals"],
      ["612", "supplies"],
      ["690", "fixedAssetDisposals"],
    ];
    for (const [code, line] of cases) expect([code, pnlLineOf(code)]).toEqual([code, line]);
    expect(pnlLineOf("430")).toBeNull();
  });

  it("partidas, subtotales y resultado por mes; el total coincide con −Σ(grupos 6 y 7); comparación con el mes anterior", () => {
    const facts = factsOf(LEDGER, { from: "2026-09-01", to: "2026-10-31", prefixes: ["6", "7"] });
    const lines = buildPnl(facts, periodsOf("2026-09", "2026-10", "month"), NAMES);
    const get = (k: string) => lines.find((l) => l.key === k)!;
    expect(get("revenue")).toMatchObject({ values: [50_000, 100_000], totalCents: 150_000, compareTotalCents: null, variationPct: null });
    expect(get("revenue").accounts).toEqual([{ code: "705", name: "Prestaciones de servicios", values: [50_000, 100_000], totalCents: 150_000, compareTotalCents: null }]);
    expect(get("otherOperatingExpenses")).toMatchObject({ values: [0, -58_880], totalCents: -58_880 });
    expect(get("otherOperatingExpenses").accounts.map((a) => [a.code, a.totalCents])).toEqual([["626", -3_880], ["629", -50_000], ["631", -5_000]]);
    expect(get("personnel").totalCents).toBe(-100_000);
    expect(get("operatingResult")).toMatchObject({ kind: "subtotal", values: [50_000, -58_880], totalCents: -8_880 });
    expect(get("financialResult").totalCents).toBe(0);
    expect(get("preTaxResult").totalCents).toBe(-8_880);
    expect(get("netResult").totalCents).toBe(-8_880);
    const sixSeven = facts.reduce((a, f) => a + f.creditCents - f.debitCents, 0);
    expect(get("netResult").totalCents).toBe(sixSeven);
    expect(lines.map((l) => l.key)).toEqual(["revenue", "inventoryChange", "ownWork", "supplies", "otherOperatingIncome", "personnel", "otherOperatingExpenses", "depreciation", "grants", "provisionsExcess", "fixedAssetDisposals", "otherResults", "operatingResult", "financialIncome", "financialExpenses", "fairValue", "exchangeDifferences", "financialImpairment", "financialResult", "preTaxResult", "incomeTax", "netResult"]);

    // Octubre frente a septiembre
    const cr = compareRange("2026-10", "2026-10", "previous")!;
    const oct = periodsOf("2026-10", "2026-10", "month");
    const cmp = buildPnl(factsOf(LEDGER, { from: "2026-10-01", to: "2026-10-31", prefixes: ["6", "7"] }), oct, NAMES, { facts: factsOf(LEDGER, { from: cr.from, to: cr.to, prefixes: ["6", "7"] }), periods: shiftPeriods(oct, cr.shift, "month") });
    expect(cmp.find((l) => l.key === "revenue")).toMatchObject({ totalCents: 100_000, compareValues: [50_000], compareTotalCents: 50_000, variationCents: 50_000, variationPct: 100 });
    expect(cmp.find((l) => l.key === "netResult")).toMatchObject({ totalCents: -58_880, compareTotalCents: 50_000, variationCents: -108_880, variationPct: -217.8 });
    expect(cmp.find((l) => l.key === "personnel")).toMatchObject({ compareTotalCents: 0, variationPct: null });
  });

  it("filtro por centro de coste: solo las líneas imputadas a ese centro", () => {
    const lines = buildPnl(factsOf(LEDGER, { from: "2026-10-01", to: "2026-10-31", prefixes: ["6", "7"], cc: 1 }), periodsOf("2026-10", "2026-10", "month"), NAMES);
    expect(lines.find((l) => l.key === "revenue")!.totalCents).toBe(0);
    expect(lines.find((l) => l.key === "otherOperatingExpenses")!.accounts.map((a) => [a.code, a.totalCents])).toEqual([["629", -50_000]]);
    expect(lines.find((l) => l.key === "netResult")!.totalCents).toBe(-50_000);
  });
});

describe("balance de situación", () => {
  it("partida por cuenta y por signo del saldo (grupos 4 y 5)", () => {
    expect(balanceLineOf("100", -1)).toBe("capital");
    expect(balanceLineOf("129", -1)).toBe("pendingResult");
    expect(balanceLineOf("120", -1)).toBe("priorResults");
    expect(balanceLineOf("170", -1)).toBe("longTermDebt");
    expect(balanceLineOf("213", 1)).toBe("tangible");
    expect(balanceLineOf("2813", -1)).toBe("tangible");
    expect(balanceLineOf("430", 1)).toBe("receivables");
    expect(balanceLineOf("430", -1)).toBe("payables");
    expect(balanceLineOf("472", 1)).toBe("receivables");
    expect(balanceLineOf("477", -1)).toBe("payables");
    expect(balanceLineOf("4750", -1)).toBe("payables");
    expect(balanceLineOf("474", 1)).toBe("deferredTaxAssets");
    expect(balanceLineOf("479", -1)).toBe("deferredTaxLiabilities");
    expect(balanceLineOf("57200001", 1)).toBe("cash");
    expect(balanceLineOf("57200001", -1)).toBe("shortTermDebt");
    expect(balanceLineOf("5720", 1)).toBe("cash");
    expect(balanceLineOf("520", -1)).toBe("shortTermDebt");
    expect(balanceLineOf("551", 1)).toBe("shortTermInvestments");
    expect(balanceLineOf("629", 1)).toBeNull();
  });

  it("cuadra (activo = patrimonio neto + pasivo) con resultado del ejercicio y de ejercicios anteriores sin regularizar", () => {
    const facts = factsOf(LEDGER, { to: "2026-10-31" });
    const year = balancesOfFacts(facts.filter((f) => f.month.startsWith("2026") && /^[67]/.test(f.accountCode)));
    const b = buildBalance(balancesOfFacts(facts), year, NAMES);
    const line = (block: { lines: Array<{ key: string; amountCents: number }> }, k: string) => block.lines.find((l) => l.key === k)!.amountCents;
    expect(line(b.assets.current, "cash")).toBe(228_000 + 3_620);
    expect(b.assets.current.lines.find((l) => l.key === "cash")!.accounts).toEqual([
      { code: "5720", name: "Stripe", amountCents: 3_620 },
      { code: BANK, name: "Banco: principal", amountCents: 228_000 },
    ]);
    expect(line(b.assets.current, "receivables")).toBe(60_500 + 10_500);
    expect(b.assets).toMatchObject({ totalCents: 302_620, nonCurrent: { totalCents: 0 } });
    expect(line(b.equityAndLiabilities.equity, "capital")).toBe(300_000);
    expect(line(b.equityAndLiabilities.equity, "yearResult")).toBe(-8_880);
    expect(line(b.equityAndLiabilities.equity, "pendingResult")).toBe(-20_000);
    expect(line(b.equityAndLiabilities.current, "payables")).toBe(31_500);
    expect(b.check).toEqual({ assetsCents: 302_620, equityAndLiabilitiesCents: 302_620, differenceCents: 0, balanced: true });
    expect(b.result).toEqual({ currentYearCents: -8_880, pendingCents: -20_000 });
    // El resultado del ejercicio del balance es el de la cuenta de resultados del año
    const pnl = buildPnl(factsOf(LEDGER, { from: "2026-01-01", to: "2026-10-31", prefixes: ["6", "7"] }), periodsOf("2026-01", "2026-10", "year"), NAMES);
    expect(pnl.find((l) => l.key === "netResult")!.totalCents).toBe(b.result.currentYearCents);
  });

  it("descubierto bancario al pasivo y regularización: el resultado pasa a 129 y sigue cuadrando", () => {
    const entries: E[] = [
      { date: "2026-01-10", lines: [["629", 10_000, 0], [BANK, 0, 10_000]] },
      { date: "2026-02-10", lines: [["430", 30_000, 0], ["705", 0, 30_000]] },
      { date: "2026-12-31", origin: "regularization", lines: [["705", 30_000, 0], ["629", 0, 10_000], ["129", 0, 20_000]] },
    ];
    const facts = factsOf(entries, { to: "2026-12-31" });
    const b = buildBalance(balancesOfFacts(facts), balancesOfFacts(facts.filter((f) => /^[67]/.test(f.accountCode))), NAMES);
    expect(b.equityAndLiabilities.current.lines.find((l) => l.key === "shortTermDebt")!.amountCents).toBe(10_000);
    expect(b.equityAndLiabilities.equity.lines.find((l) => l.key === "pendingResult")!.amountCents).toBe(20_000);
    expect(b.equityAndLiabilities.equity.lines.find((l) => l.key === "yearResult")!.amountCents).toBe(0);
    expect(b.check.balanced).toBe(true);
    expect(b.assets.totalCents).toBe(30_000);
  });
});

describe("tesorería", () => {
  it("naturaleza de la contrapartida", () => {
    expect(["430", "4300001", "438", "705"].map(flowNatureOf)).toEqual(["customers", "customers", "customers", "customers"]);
    expect(["400", "410", "407"].map(flowNatureOf)).toEqual(["suppliers", "suppliers", "suppliers"]);
    expect(["4750", "477", "472", "4751", "631", "630"].map(flowNatureOf)).toEqual(["taxes", "taxes", "taxes", "taxes", "taxes", "taxes"]);
    expect(["465", "476", "640"].map(flowNatureOf)).toEqual(["payroll", "payroll", "payroll"]);
    expect(["626", "170", "100", "662"].map(flowNatureOf)).toEqual(["other", "other", "other", "other"]);
  });

  it("por cuenta y por naturaleza; traspasos aparte; saldo final − inicial = entradas − salidas", () => {
    const from = "2026-10-01";
    const to = "2026-10-31";
    const opening = balancesOfFacts(factsOf(LEDGER, { to: "2026-09-30", prefixes: ["57"] }));
    const c = buildCashflow({ opening, treasury: treasuryOf(LEDGER, from, to), counterparts: factsOf(LEDGER, { from, to, withTreasury: true, exclude57: true }), months: ["2026-10"], names: NAMES });
    expect(c.accounts).toEqual([
      { code: "5720", name: "Stripe", kind: "stripe", openingCents: 0, inCents: 117_120, outCents: 113_500, internalInCents: 0, internalOutCents: 113_500, closingCents: 3_620 },
      { code: BANK, name: "Banco: principal", kind: "bank", openingCents: 280_000, inCents: 113_500, outCents: 165_500, internalInCents: 113_500, internalOutCents: 0, closingCents: 228_000 },
    ]);
    expect(c.totals).toEqual({ openingCents: 280_000, inCents: 121_000, outCents: 169_380, internalTransfersCents: 113_500, closingCents: 231_620, netCents: -48_380 });
    expect(c.totals.closingCents - c.totals.openingCents).toBe(c.totals.netCents);
    expect(Object.fromEntries(c.byNature.map((n) => [n.key, [n.inCents, n.outCents]]))).toEqual({ customers: [121_000, 0], suppliers: [0, 60_500], taxes: [0, 5_000], payroll: [0, 100_000], other: [0, 3_880] });
    expect(c.months[0]).toMatchObject({ month: "2026-10", inCents: 121_000, outCents: 169_380, netCents: -48_380, internalCents: 113_500 });
  });

  it("previsión a 30/60/90 días: cobros a 30 días de la factura (los vencidos aparte), pagos a su vencimiento, impuestos calculados", () => {
    const f = buildForecast({
      today: "2026-10-31",
      horizonDays: 90,
      startingBalanceCents: 231_620,
      receivables: [
        { id: 1, number: "EB-1", customerName: "Cliente A", date: "2026-10-20", pendingCents: 60_500 },
        { id: 2, number: "EB-2", customerName: "Cliente B", date: "2026-08-01", pendingCents: 12_100 },
        { id: 3, number: "EB-3", customerName: "Cliente C", date: "2026-12-20", pendingCents: 9_999 },
        { id: 4, number: "EB-4", customerName: null, date: "2026-10-05", pendingCents: 0 },
      ],
      payables: [
        { id: 10, supplierId: 7, supplierName: "Hosting", invoiceNumber: "H-1", invoiceDate: "2026-10-01", dueDate: "2026-10-15", totalCents: 60_500, pendingCents: 60_500 },
        { id: 11, supplierId: 7, supplierName: "Hosting", invoiceNumber: "H-2", invoiceDate: "2026-11-01", dueDate: "2026-12-15", totalCents: 30_250, pendingCents: 30_250 },
      ],
      taxes: [
        { id: 20, model: "303", period: "4T", year: 2026, dueDate: "2027-01-30", amountCents: 40_000, outcome: "a_ingresar", status: "borrador" },
        { id: 21, model: "111", period: "4T", year: 2026, dueDate: "2027-01-20", amountCents: null, outcome: null, status: "pendiente" },
        { id: 22, model: "303", period: "3T", year: 2026, dueDate: "2026-11-20", amountCents: -5_000, outcome: "a_compensar", status: "revisado" },
      ],
    });
    expect(f.isForecast).toBe(true);
    expect(f.items.map((i) => [i.date, i.kind, i.amountCents, i.overdue])).toEqual([
      ["2026-11-01", "payable", -60_500, true],
      ["2026-11-19", "receivable", 60_500, false],
      ["2026-12-15", "payable", -30_250, false],
      ["2027-01-19", "receivable", 9_999, false],
      ["2027-01-20", "tax", null, false],
    ]);
    expect(f.buckets).toEqual([
      { days: 30, until: "2026-11-30", inflowsCents: 60_500, outflowsCents: 60_500, netCents: 0, projectedBalanceCents: 231_620 },
      { days: 60, until: "2026-12-30", inflowsCents: 60_500, outflowsCents: 90_750, netCents: -30_250, projectedBalanceCents: 201_370 },
      { days: 90, until: "2027-01-29", inflowsCents: 70_499, outflowsCents: 90_750, netCents: -20_251, projectedBalanceCents: 211_369 },
    ]);
    expect(f.excluded).toEqual({ overdueReceivablesCents: 12_100, overdueReceivablesCount: 1, uncalculatedTaxes: 1 });
    // Con horizonte de 30 días solo hay un tramo y lo de después no aparece
    const short = buildForecast({ today: "2026-10-31", horizonDays: 30, startingBalanceCents: 0, receivables: [], payables: [], taxes: [{ id: 20, model: "303", period: "4T", year: 2026, dueDate: "2026-11-20", amountCents: 40_000, outcome: "a_ingresar", status: "presentado" }] });
    expect(short.buckets).toEqual([{ days: 30, until: "2026-11-30", inflowsCents: 0, outflowsCents: 40_000, netCents: -40_000, projectedBalanceCents: -40_000 }]);
  });
});

describe("antigüedad de saldos", () => {
  it("tramos por días desde el vencimiento (o la fecha del documento)", () => {
    expect(agingBucketOf("2026-10-31", "2026-11-10", true)).toEqual({ bucket: "current", days: -10 });
    expect(agingBucketOf("2026-10-31", "2026-10-31", true)).toEqual({ bucket: "d0_30", days: 0 });
    expect(agingBucketOf("2026-10-31", "2026-10-01", false)).toEqual({ bucket: "d0_30", days: 30 });
    expect(agingBucketOf("2026-10-31", "2026-09-30", false)).toEqual({ bucket: "d31_60", days: 31 });
    expect(agingBucketOf("2026-10-31", "2026-08-15", true)).toEqual({ bucket: "d61_90", days: 77 });
    expect(agingBucketOf("2026-10-31", "2026-08-01", true)).toEqual({ bucket: "d90_plus", days: 91 });
    expect(agingBucketOf("2026-10-31", "2026-11-10", false)).toEqual({ bucket: "d0_30", days: 0 });
  });

  it("por tercero y tramo, con totales y documentos ordenados por antigüedad", () => {
    const doc = (id: number, party: string, date: string, dueDate: string | null, pending: number) => ({ id, number: `F-${id}`, partyKey: party, partyId: Number(party.split(":")[1]), partyName: party === "supplier:7" ? "Hosting Nube SL" : "Marketing SL", date, dueDate, totalCents: pending, pendingCents: pending });
    const a = buildAging("2026-10-31", [doc(1, "supplier:7", "2026-10-01", "2026-11-10", 30_000), doc(2, "supplier:7", "2026-10-01", "2026-10-20", 10_000), doc(3, "supplier:8", "2026-07-01", "2026-08-15", 5_000), doc(4, "supplier:8", "2026-06-01", null, 2_500), doc(5, "supplier:8", "2026-06-01", null, 0)]);
    expect(a.totals).toEqual({ current: 30_000, d0_30: 10_000, d31_60: 0, d61_90: 5_000, d90_plus: 2_500, totalCents: 47_500, count: 4 });
    expect(a.parties.map((p) => [p.name, p.totalCents, p.count, p.buckets.d61_90])).toEqual([["Hosting Nube SL", 40_000, 2, 0], ["Marketing SL", 7_500, 2, 5_000]]);
    expect(a.parties[1].documents.map((d) => [d.id, d.bucket, d.daysOverdue])).toEqual([[4, "d90_plus", 152], [3, "d61_90", 77]]);
    expect(a.buckets.map((b) => b.label)).toEqual(["No vencido", "0–30 días", "31–60 días", "61–90 días", "Más de 90 días"]);
  });
});

describe("gastos agrupados", () => {
  const facts = factsOf(LEDGER, { from: "2026-10-01", to: "2026-10-31", prefixes: ["6"] });
  const cfacts = factsOf(LEDGER, { from: "2025-10-01", to: "2025-10-31", prefixes: ["6"] });
  const nameOf = (k: string) => ({ id: k.endsWith("none") || k.startsWith("account") ? null : Number(k.split(":")[1]), name: k, accountCode: k.startsWith("account:") ? k.slice(8) : null });

  it("por categoría (sin categoría, por cuenta), por centro y por proveedor; con comparación", () => {
    const byCat = buildExpenseGroups({ facts, compareFacts: cfacts, months: ["2026-10"], groupBy: "category", nameOf });
    expect(byCat.items.map((i) => [i.key, i.totalCents, i.compareCents])).toEqual([["account:640", 100_000, 0], ["category:1", 50_000, 0], ["account:631", 5_000, 0], ["account:626", 3_880, 0]]);
    expect(byCat.totals).toMatchObject({ values: [158_880], totalCents: 158_880, compareCents: 0, variationCents: 158_880, variationPct: null });
    const byCc = buildExpenseGroups({ facts, compareFacts: null, months: ["2026-10"], groupBy: "costCenter", nameOf });
    expect(byCc.items.map((i) => [i.key, i.totalCents])).toEqual([["costCenter:none", 103_880], ["costCenter:1", 50_000], ["costCenter:2", 5_000]]);
    expect(byCc.totals.compareCents).toBeNull();
    const bySup = buildExpenseGroups({ facts, compareFacts: null, months: ["2026-10"], groupBy: "supplier", nameOf });
    expect(bySup.items.map((i) => [i.key, i.totalCents])).toEqual([["supplier:none", 108_880], ["supplier:7", 50_000]]);
    // Comparación con un año con gasto: variación y porcentaje
    const yoy = buildExpenseGroups({ facts: factsOf(LEDGER, { from: "2025-06-01", to: "2025-06-30", prefixes: ["6"] }), compareFacts: factsOf([{ date: "2024-06-01", lines: [["629", 10_000, 0], [BANK, 0, 10_000]] }], { prefixes: ["6"] }), months: ["2025-06"], groupBy: "category", nameOf });
    expect(yoy.items[0]).toMatchObject({ key: "account:629", totalCents: 20_000, compareCents: 10_000, variationCents: 10_000, variationPct: 100 });
  });
});

describe("coste directo, Revenue & Margin y conversión", () => {
  it("coste directo por defecto: 626 y hosting/infraestructura; la marca del operador manda", () => {
    expect(resolveDirectCost({ name: "Comisiones de pasarelas de pago", accountCode: "626", isDirectCost: null })).toBe(true);
    expect(resolveDirectCost({ name: "Comisiones bancarias", accountCode: "626", isDirectCost: null })).toBe(true);
    expect(resolveDirectCost({ name: "Hosting e infraestructura en la nube", accountCode: "629", isDirectCost: null })).toBe(true);
    expect(resolveDirectCost({ name: "Software y licencias", accountCode: "629", isDirectCost: null })).toBe(false);
    expect(resolveDirectCost({ name: "Comisiones bancarias", accountCode: "626", isDirectCost: false })).toBe(false);
    expect(resolveDirectCost({ name: "Software y licencias", accountCode: "629", isDirectCost: true })).toBe(true);
  });

  it("margen bruto = devengado − comisiones de Stripe − costes directos; resultado = el de la cuenta de resultados", () => {
    const facts = factsOf(LEDGER, { from: "2026-01-01", to: "2026-12-31", prefixes: ["6", "7"] });
    const r = buildRevenueMargin({ facts, months: ["2026-09", "2026-10"], directCategories: new Set([1]), stripe: [{ month: "2026-10", type: "charge", noInvoice: false, count: 1, grossCents: 121_000, feeCents: 3_880, netCents: 117_120 }, { month: "2026-10", type: "refund", noInvoice: false, count: 1, grossCents: -6_050, feeCents: 0, netCents: -6_050 }], transfers: [{ month: "2026-09", count: 1, amountCents: 60_500 }] });
    expect(r.months[1]).toEqual({ month: "2026-10", label: "octubre 2026", accruedRevenueCents: 100_000, collectedCents: 114_950, stripeFeesCents: 3_880, stripeFeesPct: 3.4, directCostsCents: 50_000, grossMarginCents: 46_120, grossMarginPct: 46.1, structureCostsCents: 105_000, otherIncomeCents: 0, resultCents: -58_880 });
    expect(r.months[0]).toMatchObject({ accruedRevenueCents: 50_000, collectedCents: 60_500, grossMarginPct: 100, resultCents: 50_000 });
    expect(r.totals).toEqual({ accruedRevenueCents: 150_000, collectedCents: 175_450, stripeFeesCents: 3_880, stripeFeesPct: 2.2, directCostsCents: 50_000, grossMarginCents: 96_120, grossMarginPct: 64.1, structureCostsCents: 105_000, otherIncomeCents: 0, resultCents: -8_880 });
    // Sin categorías directas, todo el gasto (salvo Stripe) es estructura
    const none = buildRevenueMargin({ facts, months: ["2026-10"], directCategories: new Set(), stripe: null, transfers: null });
    expect(none.months[0]).toMatchObject({ directCostsCents: 0, structureCostsCents: 155_000, collectedCents: null, stripeFeesPct: null });
    expect(none.totals.collectedCents).toBeNull();
  });

  it("conversión: % cobrado/liquidado/en banco por importe, DSO, cobro→disponible, payout→banco, reembolsos, sin factura y pagos fallidos", () => {
    const inv = (id: number, issueDate: string, total: number, collected: number, status: string, dates: Partial<ConversionInvoice["dates"]>): ConversionInvoice => ({ invoiceId: id, issueDate, totalCents: total, collectedCents: collected, status, dates: { invoiceDate: issueDate, chargeDate: null, availableOn: null, payoutDate: null, bankDate: null, ...dates } });
    const c = buildConversion({
      months: ["2026-09", "2026-10"],
      asOf: "2026-11-15",
      invoices: [inv(1, "2026-10-01", 121_000, 121_000, "en_banco", { chargeDate: "2026-10-05", availableOn: "2026-10-07", payoutDate: "2026-10-08", bankDate: "2026-10-09" }), inv(2, "2026-10-02", 30_250, 0, "pendiente_cobro", {}), inv(3, "2026-09-01", 60_500, 60_500, "cobrada", { chargeDate: "2026-09-11", bankDate: "2026-09-11" }), inv(4, "2026-10-20", 10_000, 12_000, "liquidada", { chargeDate: "2026-10-23", availableOn: "2026-10-25", payoutDate: "2026-10-26" })],
      stripe: [
        { month: "2026-10", type: "charge", noInvoice: false, count: 1, grossCents: 121_000, feeCents: 3_880, netCents: 117_120 },
        { month: "2026-10", type: "charge", noInvoice: true, count: 1, grossCents: 6_050, feeCents: 200, netCents: 5_850 },
        { month: "2026-10", type: "refund", noInvoice: false, count: 1, grossCents: -6_050, feeCents: 0, netCents: -6_050 },
        { month: "2026-10", type: "dispute", noInvoice: false, count: 1, grossCents: -121_000, feeCents: 1_500, netCents: -122_500 },
        { month: "2026-10", type: "dispute_reversal", noInvoice: false, count: 1, grossCents: 121_000, feeCents: -1_500, netCents: 122_500 },
      ],
      payments: [{ month: "2026-10", failed: 1, succeeded: 3 }],
    });
    const oct = c.months[1];
    expect(oct.invoices).toEqual({ count: 3, amountCents: 161_250 });
    expect(oct.collectedPct).toBe(81.2); // (121.000 + 0 + 10.000 tope) / 161.250
    expect(oct.settledPct).toBe(81.2);
    expect(oct.inBankPct).toBe(75);
    expect(oct.dsoDays).toBe(3.5); // (4 + 3) / 2
    expect(oct.chargeToAvailableDays).toBe(2);
    expect(oct.payoutToBankDays).toBe(1);
    expect(oct.stripe).toEqual({ chargesCents: 127_050, refundsCents: 6_050, refundsPct: 4.8, disputesCents: 0, disputesPct: 0, chargesWithoutInvoice: { count: 1, amountCents: 6_050 } });
    expect(oct.failedPayments).toEqual({ failed: 1, succeeded: 3, ratePct: 25 });
    expect(c.months[0]).toMatchObject({ invoices: { count: 1, amountCents: 60_500 }, collectedPct: 100, settledPct: 0, inBankPct: 0, dsoDays: 10, payoutToBankDays: null, stripe: { chargesCents: 0, refundsPct: null }, failedPayments: { failed: 0, succeeded: 0, ratePct: null } });
    expect(c.totals.overdueUnpaid).toEqual({ count: 1, amountCents: 30_250, days: 30 });
    expect(c.totals.dsoDays).toBe(5.7); // (4 + 3 + 10) / 3
    // Sin Stripe ni registro comercial: null, no 0
    const bare = buildConversion({ months: ["2026-10"], asOf: "2026-10-31", invoices: null, stripe: null, payments: null });
    expect(bare.months[0]).toMatchObject({ invoices: null, collectedPct: null, dsoDays: null, stripe: null, failedPayments: null });
    expect(bare.totals.overdueUnpaid).toBeNull();
  });
});

describe("control diario y CSV", () => {
  it("avisos solo de lo que tiene recuento (null no avisa), por gravedad", () => {
    const a = dailyAlerts({ paymentsOverdue: 2, taxOverdue: 0, receivablesOverdue: 1, bankPending: null, stripeIssuesOpen: 3, draftEntries: 1, paymentsDueNext7: 0 });
    expect(a.map((x) => [x.code, x.severity, x.count])).toEqual([["payments_overdue", "critical", 2], ["receivables_overdue", "warning", 1], ["stripe_issues", "warning", 3], ["draft_entries", "info", 1]]);
    expect(a[0].message).toBe("2 pagos a proveedores vencidos sin pagar");
    expect(a[1].message).toBe("1 factura pendiente de cobro con más de 30 días");
  });

  it("CSV con BOM, «;», CRLF y euros con coma decimal", () => {
    const facts = factsOf(LEDGER, { from: "2026-10-01", to: "2026-10-31", prefixes: ["6", "7"] });
    const p = pnlCsv({ periods: [{ label: "octubre 2026" }], lines: buildPnl(facts, periodsOf("2026-10", "2026-10", "month"), NAMES), compare: null });
    expect(p.startsWith("﻿Partida;Cuenta;octubre 2026;Total\r\n")).toBe(true);
    expect(p).toContain("1. Importe neto de la cifra de negocios;;1000,00;1000,00\r\n");
    expect(p).toContain("   Otros servicios;629;-500,00;-500,00\r\n");
    expect(p).toContain("A.4) RESULTADO DEL EJERCICIO (A.3 + 18);;-588,80;-588,80\r\n");
    const bf = factsOf(LEDGER, { to: "2026-10-31" });
    const b = balanceCsv({ date: "2026-10-31", ...buildBalance(balancesOfFacts(bf), balancesOfFacts(bf.filter((f) => f.month.startsWith("2026") && /^[67]/.test(f.accountCode))), NAMES) });
    expect(b).toContain("TOTAL ACTIVO (A + B);;3026,20\r\n");
    expect(b).toContain("Cuadre a 31/10/2026;;0,00\r\n");
    const c = cashflowCsv({ ...buildCashflow({ opening: new Map([[BANK, 280_000]]), treasury: treasuryOf(LEDGER, "2026-10-01", "2026-10-31"), counterparts: factsOf(LEDGER, { from: "2026-10-01", to: "2026-10-31", withTreasury: true, exclude57: true }), months: ["2026-10"], names: NAMES }), forecast: null });
    expect(c).toContain("Naturaleza;customers;Cobros de clientes;;1210,00;0,00;1210,00\r\n");
    const a = agingCsv({ side: "payable", ...buildAging("2026-10-31", [{ id: 1, number: "=1+1", partyKey: "supplier:7", partyId: 7, partyName: "Hosting; SL", date: "2026-10-01", dueDate: "2026-10-20", totalCents: 1_000, pendingCents: 1_000 }]) });
    expect(a.split("\r\n")[0]).toBe("﻿Proveedor;Documento;Fecha;Vencimiento;No vencido;0–30 días;31–60 días;61–90 días;Más de 90 días;Pendiente");
    expect(a).toContain(`"Hosting; SL";'=1+1;01/10/2026;20/10/2026;;10,00;;;;10,00`);
    const e = expensesCsv({ months: ["2026-10"], ...buildExpenseGroups({ facts, compareFacts: null, months: ["2026-10"], groupBy: "category", nameOf: (k) => ({ id: null, name: k, accountCode: null }) }) });
    expect(e.split("\r\n")[0]).toBe("﻿Grupo;Cuenta;octubre 2026;Total");
    const rm = revenueMarginCsv(buildRevenueMargin({ facts, months: ["2026-10"], directCategories: new Set([1]), stripe: null, transfers: null }));
    expect(rm).toContain("octubre 2026;1000,00;;38,80;;500,00;461,20;46,1;1050,00;0,00;-588,80");
    const cv = conversionCsv(buildConversion({ months: ["2026-10"], asOf: "2026-10-31", invoices: [], stripe: null, payments: null }));
    expect(cv.split("\r\n")[1]).toBe("octubre 2026;0;0,00;;;;;;;;;;");
    const d = dailyCsv({ date: "2026-10-31", counts: { invoicesIssued: 2, stripeCharges: null }, alerts: [] });
    expect(d).toContain("31/10/2026;Facturas emitidas;2\r\n31/10/2026;Cobros de Stripe;\r\n");
  });
});
