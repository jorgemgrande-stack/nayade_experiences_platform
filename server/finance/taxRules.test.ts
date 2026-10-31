/**
 * Reglas puras de la fase 3 (gestoría e impuestos) con casos numéricos conocidos: vencimientos con fines de semana y
 * festivos, aplicabilidad, 303 (tipos, inversión del sujeto pasivo de Stripe, rectificativas, reversiones, sin prorrata,
 * compensación entre periodos y devolución), 390, 349, 347 (umbral y exclusiones), 111/115/190/180, seguros sociales,
 * 200 (ajustes, bases negativas con límite y por antigüedad, entidad de nueva creación), 202 (art. 40.2 y 40.3),
 * avisos, huella y diferencias, asientos y libros registro. Solo datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import {
  addMonthsISO,
  annualWithholdings,
  applyNegativeBases,
  art40_3CoefficientBp,
  baseYearFor202,
  corporate200,
  corporateRateBp,
  deferralInstallmentEntry,
  draftCsv,
  dueDateOf,
  easterSunday,
  finalizeDraft,
  installment202,
  isBusinessDay,
  issuedIncidentsCsv,
  lossCompensationLimit,
  m347,
  m349,
  modelApplicability,
  obligationSpecs,
  payrollEntry,
  periodRange,
  rawDueDate,
  receivedRegisterCsv,
  reminderBucket,
  shiftToBusinessDay,
  socialSecurity,
  staleInfo,
  taxPaymentEntry,
  vat303,
  vat390,
  vatSettlementEntry,
  w111,
  w115,
  type Corporate200Input,
  type ThirdPartyOp,
  type Vat303Input,
  type VatLedgerLine,
} from "./taxRules";
import { DEFAULT_TAX_SETTINGS } from "./taxService";
import type { TaxSettings } from "./taxTypes";
import { sumLines } from "./rules";

const S = (p: Partial<TaxSettings> = {}): TaxSettings => ({ ...DEFAULT_TAX_SETTINGS, legalName: null, taxId: null, ...p });
const box = (d: { boxes: Array<{ box: string; valueCents: number | null }> }, b: string) => d.boxes.find((x) => x.box === b)?.valueCents;

let seq = 0;
const line = (p: Partial<VatLedgerLine> & Pick<VatLedgerLine, "account">): VatLedgerLine => ({ entryId: ++seq, entryNumber: seq, date: "2026-08-10", description: "línea", kind: "sale", reversal: false, originalInPeriod: true, debitCents: 0, creditCents: 0, taxRateBp: 2100, taxBaseCents: 0, ...p });
const v303 = (p: Partial<Vat303Input>): Vat303Input => ({ year: 2026, period: "3T", lines: [], invoices: [], expenses: [], ledgerHasEntries: true, carriedInCents: 0, carriedInSource: "settings", lastPeriod: false, regime: "general", ...p });

describe("calendario fiscal", () => {
  it("vencimientos de la AEAT y traslado al siguiente hábil (fines de semana y festivos nacionales)", () => {
    expect(rawDueDate("303", 2026, "3T")).toBe("2026-10-20");
    expect(dueDateOf("303", 2026, "4T")).toBe("2027-02-01"); // 30/01/2027 es sábado
    expect(dueDateOf("111", 2026, "4T")).toBe("2027-01-20"); // el 4T de retenciones vence el 20
    expect(dueDateOf("390", 2026, "ANUAL")).toBe("2027-02-01");
    expect(dueDateOf("190", 2026, "ANUAL")).toBe("2027-02-01"); // 31/01/2027 es domingo
    expect(dueDateOf("347", 2026, "ANUAL")).toBe("2027-03-01");
    expect(dueDateOf("347", 2027, "ANUAL")).toBe("2028-02-29"); // bisiesto
    expect(dueDateOf("200", 2026, "ANUAL")).toBe("2027-07-26");
    expect(["1P", "2P", "3P"].map((p) => dueDateOf("202", 2026, p))).toEqual(["2026-04-20", "2026-10-20", "2026-12-21"]);
    expect(dueDateOf("202", 2025, "3P")).toBe("2025-12-22");
    expect(dueDateOf("303", 2025, "2T")).toBe("2025-07-21");
    expect(dueDateOf("SS", 2026, "02")).toBe("2026-03-31");
    expect(dueDateOf("SS", 2026, "12")).toBe("2027-02-01");
    expect(rawDueDate("303", 2026, "01")).toBe("2026-02-28");
    expect(rawDueDate("303", 2026, "12")).toBe("2027-01-30");
  });

  it("festivos nacionales fijos, Viernes Santo y festivos configurados", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(isBusinessDay("2026-04-03")).toBe(false); // Viernes Santo
    expect(shiftToBusinessDay("2026-01-06")).toBe("2026-01-07"); // Reyes, martes
    expect(shiftToBusinessDay("2026-12-08")).toBe("2026-12-09");
    expect(shiftToBusinessDay("2026-04-20", ["2026-04-20"])).toBe("2026-04-21");
    expect(dueDateOf("303", 2026, "1T", ["2026-04-20", "2026-04-21"])).toBe("2026-04-22");
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("solo lo que activa la configuración, con el motivo de lo que no aplica", () => {
    const base = obligationSpecs(2026, S());
    expect(Array.from(new Set(base.specs.map((s) => s.model))).sort()).toEqual(["200", "202", "303", "347", "390"]);
    expect(base.specs).toHaveLength(4 + 1 + 1 + 1 + 3);
    expect(base.notApplicable.map((n) => n.model).sort()).toEqual(["111", "115", "180", "190", "349", "SS"]);
    expect(base.specs.every((s) => s.key === `obligation:${s.model}:2026:${s.period}`)).toBe(true);
    const full = obligationSpecs(2026, S({ hasEmployees: true, hasRentWithholdings: true, intraEuOperations: true }));
    expect(full.specs.filter((s) => s.model === "SS")).toHaveLength(12);
    expect(full.notApplicable).toEqual([]);
    expect(obligationSpecs(2026, S({ vatRegime: "exento" })).specs.some((s) => s.model === "303" || s.model === "390")).toBe(false);
    expect(modelApplicability("390", S({ vat390Exempt: true })).reason).toMatch(/exoneración/);
    expect(obligationSpecs(2026, S({ vatPeriod: "monthly", redeme: true })).specs.filter((s) => s.model === "303")).toHaveLength(12);
    expect(periodRange("202", 2026, "2P")).toEqual({ from: "2026-01-01", to: "2026-09-30" });
  });
});

describe("303", () => {
  it("devengado por tipo, comisiones de Stripe con inversión del sujeto pasivo (10/11 y 36/37) y deducible", () => {
    const d = vat303(
      v303({
        lines: [
          line({ account: "477", creditCents: 2100, taxBaseCents: 10_000 }),
          line({ account: "477", creditCents: 100, taxRateBp: 1000, taxBaseCents: 1000 }),
          line({ account: "477", kind: "stripe", creditCents: 81, taxBaseCents: 388 }),
          line({ account: "472", kind: "stripe", debitCents: 81, taxBaseCents: 388 }),
          line({ account: "472", kind: "purchase", debitCents: 1050, taxBaseCents: 10_000 }), // 50 % deducible
          line({ account: "472", kind: "purchase", debitCents: 420, taxBaseCents: 2000 }),
        ],
      }),
    );
    expect([box(d, "07"), box(d, "09"), box(d, "04"), box(d, "06")]).toEqual([10_000, 2100, 1000, 100]);
    expect([box(d, "10"), box(d, "11"), box(d, "36"), box(d, "37")]).toEqual([388, 81, 388, 81]);
    expect([box(d, "28"), box(d, "29")]).toEqual([5000 + 2000, 1050 + 420]);
    expect(box(d, "27")).toBe(2100 + 100 + 81);
    expect(box(d, "45")).toBe(81 + 1050 + 420);
    expect(box(d, "71")).toBe(2281 - 1551);
    expect(d.outcome).toBe("a_ingresar");
    expect(d.details.filter((x) => x.source === "entry")).toHaveLength(6);
    // La inversión del sujeto pasivo es neutra: si se quita, el resultado no cambia
    const without = vat303(v303({ lines: [line({ account: "477", creditCents: 2100, taxBaseCents: 10_000 }), line({ account: "477", creditCents: 100, taxRateBp: 1000, taxBaseCents: 1000 }), line({ account: "472", kind: "purchase", debitCents: 1050, taxBaseCents: 10_000 }), line({ account: "472", kind: "purchase", debitCents: 420, taxBaseCents: 2000 })] }));
    expect(without.resultCents).toBe(d.resultCents);
  });

  it("rectificativas a 14/15 y 40/41; reversiones en su casilla si el original es del periodo y, si no, a modificaciones", () => {
    const d = vat303(
      v303({
        lines: [
          line({ account: "477", creditCents: 4200, taxBaseCents: 20_000 }),
          line({ account: "477", debitCents: 210, taxBaseCents: -1000 }), // factura rectificativa
          line({ account: "472", kind: "purchase", creditCents: 42, taxBaseCents: -200 }), // rectificativa recibida
          line({ account: "477", reversal: true, originalInPeriod: true, debitCents: 2100, taxBaseCents: 10_000 }),
          line({ account: "477", reversal: true, originalInPeriod: false, debitCents: 420, taxBaseCents: 2000 }),
        ],
      }),
    );
    expect([box(d, "07"), box(d, "09")]).toEqual([10_000, 2100]);
    expect([box(d, "14"), box(d, "15")]).toEqual([-3000, -630]);
    expect([box(d, "40"), box(d, "41")]).toEqual([-200, -42]);
    expect(box(d, "71")).toBe(2100 - 630 + 42);
  });

  it("compensación arrastrada (110 → 78 → 87), resultado negativo a compensar o a devolver en el último periodo", () => {
    const pos = vat303(v303({ lines: [line({ account: "477", creditCents: 3000, taxBaseCents: 14_286 })], carriedInCents: 5000 }));
    expect([box(pos, "110"), box(pos, "78"), box(pos, "87"), box(pos, "71")]).toEqual([5000, 3000, 2000, 0]);
    expect(pos.outcome).toBe("cero");
    expect(pos.extra.carryForwardCents).toBe(2000);
    const neg = vat303(v303({ lines: [line({ account: "472", kind: "purchase", debitCents: 1000, taxBaseCents: 4762 })], carriedInCents: 500 }));
    expect([box(neg, "78"), box(neg, "87"), box(neg, "71")]).toEqual([0, 500, -1000]);
    expect(neg.outcome).toBe("a_compensar");
    expect(neg.extra.carryForwardCents).toBe(1500);
    const refund = vat303(v303({ period: "4T", lastPeriod: true, refund: true, lines: [line({ account: "472", kind: "purchase", debitCents: 1000, taxBaseCents: 4762 })] }));
    expect(refund.outcome).toBe("a_devolver");
    expect(refund.extra.carryForwardCents).toBe(0);
    const noRefund = vat303(v303({ period: "2T", refund: true, lines: [line({ account: "472", kind: "purchase", debitCents: 1000, taxBaseCents: 4762 })] }));
    expect(noRefund.outcome).toBe("a_compensar");
  });

  it("sin asientos: «sin datos» (null, nunca 0); con asientos y sin IVA: sin actividad; sin prorrata en régimen mixto", () => {
    const none = vat303(v303({ ledgerHasEntries: false }));
    expect(none.hasData).toBe(false);
    expect(none.resultCents).toBeNull();
    expect(box(none, "71")).toBeNull();
    const quiet = vat303(v303({}));
    expect(quiet.outcome).toBe("sin_actividad");
    expect(quiet.resultCents).toBe(0);
    expect(vat303(v303({ regime: "mixto" })).warnings.join(" ")).toMatch(/no aplica prorrata/);
  });

  it("casillas informativas 59 (servicios a la UE) y 120 (fuera de la UE) y avisos de inversión no autoliquidada", () => {
    const d = vat303(
      v303({
        invoices: [
          { id: 1, number: "EB-1", date: "2026-08-01", customerName: "Kunde GmbH", customerTaxId: "DE123456789", customerCountry: "DE", zeroRatedBaseCents: 50_000 },
          { id: 2, number: "EB-2", date: "2026-08-02", customerName: "Client Inc", customerTaxId: null, customerCountry: "US", zeroRatedBaseCents: 30_000 },
          { id: 3, number: "EB-3", date: "2026-08-03", customerName: "Cliente SL", customerTaxId: "B12345674", customerCountry: "ES", zeroRatedBaseCents: 0 },
        ],
        expenses: [{ id: 9, number: "AWS-1", date: "2026-08-05", supplierName: "Nube Europa Ltd", supplierCountry: "IE", baseCents: 10_000, taxRateBp: 0, kind: "invoice" }],
      }),
    );
    expect([box(d, "59"), box(d, "120")]).toEqual([50_000, 30_000]);
    expect(d.warnings.join(" ")).toMatch(/AWS-1.*inversión del sujeto pasivo/);
    expect(vat303(v303({ invoices: null })).boxes.find((b) => b.box === "59")?.valueCents).toBeNull();
  });
});

describe("390, 349 y 347", () => {
  it("390: suma anual de las casillas de los 303 y avisos de los que faltan", () => {
    const q = (n: number) => vat303(v303({ period: `${n}T`, lines: [line({ account: "477", creditCents: 2100 * n, taxBaseCents: 10_000 * n })] }));
    const d = vat390(2026, [1, 2, 3].map((n) => ({ period: `${n}T`, draft: q(n), source: `obligation:${n}` })), ["1T", "2T", "3T", "4T"]);
    expect(box(d, "303.07")).toBe(60_000);
    expect(box(d, "303.71")).toBe(12_600);
    expect(d.warnings[0]).toMatch(/4T/);
    expect(vat390(2026, [], ["1T"]).hasData).toBe(false);
  });

  it("349: clave S (servicios prestados a la UE) e I (comisiones de Stripe y proveedores de la UE); sin operaciones no aplica", () => {
    const d = m349({
      year: 2026,
      period: "3T",
      invoices: [
        { id: 1, number: "EB-1", date: "2026-08-01", customerName: "Kunde GmbH", customerTaxId: "DE123456789", customerCountry: "DE", baseCents: 50_000 },
        { id: 2, number: "EB-R1", date: "2026-08-20", customerName: "Kunde GmbH", customerTaxId: "DE123456789", customerCountry: "DE", baseCents: -10_000 },
        { id: 3, number: "EB-2", date: "2026-08-02", customerName: "Cliente SL", customerTaxId: "B12345674", customerCountry: "ES", baseCents: 99_000 },
      ],
      expenses: [{ id: 5, number: "F-1", date: "2026-08-03", supplierName: "Nube Europa Ltd", supplierTaxId: "IE9999999X", supplierCountry: "IE", baseCents: 12_000 }],
      stripeFeeBaseCents: 388,
      stripeVatId: null,
      stripeDetails: [],
    });
    expect(d.declarants.map((x) => [x.key, x.taxId, x.amountCents])).toEqual([
      ["I", null, 388],
      ["I", "IE9999999X", 12_000],
      ["S", "DE123456789", 40_000],
    ]);
    expect(box(d, "01")).toBe(3);
    expect(box(d, "02")).toBe(52_388);
    expect(d.warnings.join(" ")).toMatch(/NIF-IVA de Stripe/);
    const empty = m349({ year: 2026, period: "3T", invoices: [], expenses: [], stripeFeeBaseCents: 0, stripeVatId: "IE3206488LH", stripeDetails: [] });
    expect(empty.applicable).toBe(false);
    expect(empty.outcome).toBe("sin_actividad");
  });

  it("347: más de 3.005,06 € con IVA, por clave y trimestre; excluye extranjeros y operaciones con retención; las rectificativas restan", () => {
    const op = (p: Partial<ThirdPartyOp>): ThirdPartyOp => ({ key: "B", ref: `invoice:${++seq}`, source: "invoice", date: "2026-03-01", number: `EB-${seq}`, taxId: "B12345674", name: "Cliente SL", country: "ES", totalCents: 0, withholdingCents: 0, ...p });
    const d = m347(2026, [
      op({ totalCents: 300_506 }), // exactamente el umbral: no se declara
      op({ taxId: "B76543210", name: "Grande SL", totalCents: 200_000 }),
      op({ taxId: "B76543210", name: "Grande SL", date: "2026-11-01", totalCents: 100_507 }),
      op({ key: "A", source: "expense", taxId: "A11111111", name: "Proveedor SA", totalCents: 400_000 }),
      op({ key: "A", source: "expense", taxId: "A11111111", name: "Proveedor SA", totalCents: -50_000, date: "2026-06-01" }),
      op({ key: "A", source: "expense", taxId: "B22222222", name: "Asesoría SL", totalCents: 900_000, withholdingCents: 105_000 }),
      op({ taxId: "DE123456789", name: "Kunde GmbH", country: "DE", totalCents: 900_000 }),
    ]);
    expect(d.declarants.map((x) => [x.key, x.taxId, x.amountCents, x.quarters])).toEqual([
      ["A", "A11111111", 350_000, [400_000, -50_000, 0, 0]],
      ["B", "B76543210", 300_507, [200_000, 0, 0, 100_507]],
    ]);
    expect(d.warnings.join(" ")).toMatch(/1 operaciones con terceros fuera de España/);
    expect(d.warnings.join(" ")).toMatch(/1 operaciones sujetas a retención/);
    expect(m347(2026, [op({ totalCents: 100 })]).applicable).toBe(false);
  });
});

describe("retenciones y seguros sociales", () => {
  const payroll = (period: string, alias = "empleado-1") => ({ id: ++seq, period, employeeAlias: alias, grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, status: "posted" });
  const pro = { id: 7, number: "A-1", date: "2026-08-04", supplierId: 3, supplierName: "Asesoría SL", supplierTaxId: "B22222222", baseCents: 100_000, withholdingCents: 15_000 };

  it("111: trabajo (nóminas) y profesionales; con empleados y un mes sin nómina, sin datos", () => {
    const d = w111({ year: 2026, period: "3T", hasEmployees: true, payrolls: ["2026-07", "2026-08", "2026-09"].map((p) => payroll(p)), professionals: [pro], ledgerHasEntries: true });
    expect([box(d, "01"), box(d, "02"), box(d, "03"), box(d, "07"), box(d, "08"), box(d, "09"), box(d, "28"), box(d, "30")]).toEqual([1, 900_000, 135_000, 1, 100_000, 15_000, 150_000, 150_000]);
    expect(d.outcome).toBe("a_ingresar");
    const missing = w111({ year: 2026, period: "3T", hasEmployees: true, payrolls: [payroll("2026-07")], professionals: [], ledgerHasEntries: true });
    expect(missing.hasData).toBe(false);
    expect(missing.resultCents).toBeNull();
    expect(missing.warnings.join(" ")).toMatch(/2026-08, 2026-09/);
    expect(w111({ year: 2026, period: "3T", hasEmployees: false, payrolls: [], professionals: [], ledgerHasEntries: true }).outcome).toBe("sin_actividad");
  });

  it("115 y resúmenes 190 (claves A y G) y 180; seguros sociales del mes", () => {
    const rent = { ...pro, id: 8, supplierName: "Inmuebles SL", supplierTaxId: "B33333333", baseCents: 120_000, withholdingCents: 22_800 };
    expect([box(w115({ year: 2026, period: "3T", rents: [rent], ledgerHasEntries: true }), "05")]).toEqual([22_800]);
    const d190 = annualWithholdings("190", 2026, { payrolls: [payroll("2026-01"), payroll("2026-02")], expenses: [pro], ledgerHasEntries: true });
    expect(d190.declarants.map((x) => [x.key, x.amountCents, x.withholdingCents])).toEqual([
      ["A", 600_000, 90_000],
      ["G", 100_000, 15_000],
    ]);
    expect(box(d190, "03")).toBe(105_000);
    expect(d190.warnings.join(" ")).toMatch(/alias/);
    expect(box(annualWithholdings("180", 2026, { payrolls: [], expenses: [rent], ledgerHasEntries: true }), "03")).toBe(22_800);
    const ss = socialSecurity({ year: 2026, period: "07", payrolls: [payroll("2026-07"), { ...payroll("2026-07", "b"), status: "draft" }] });
    expect([box(ss, "empresa"), box(ss, "trabajador"), box(ss, "total")]).toEqual([96_000, 19_500, 115_500]);
    expect(socialSecurity({ year: 2026, period: "08", payrolls: [] }).resultCents).toBeNull();
  });
});

describe("Impuesto sobre Sociedades", () => {
  const base = (p: Partial<Corporate200Input> = {}): Corporate200Input => ({ year: 2026, rateBp: 2500, newEntity: false, hasData: true, accountingResultCents: 10_000_000, taxExpenseCents: 0, withholdings473Cents: 100_000, installmentsPaidCents: 300_000, adjustments: [], previousPending: null, previousSource: null, details: [], ...p });

  it("200: ajustes, bases negativas, cuota íntegra, deducciones, retenciones y pagos fraccionados", () => {
    const d = corporate200(
      base({
        taxExpenseCents: 20_000,
        adjustments: [
          { id: 1, kind: "increase", description: "Multas", amountCents: 50_000, originYear: null },
          { id: 2, kind: "decrease", description: "Exención", amountCents: 70_000, originYear: null },
          { id: 3, kind: "negative_base", description: "BIN 2023", amountCents: 3_000_000, originYear: 2023 },
          { id: 4, kind: "deduction", description: "I+D", amountCents: 57_500, originYear: null },
        ],
      }),
    );
    expect(box(d, "00550")).toBe(10_000_000);
    expect(box(d, "00547")).toBe(3_000_000);
    expect(box(d, "00552")).toBe(7_000_000);
    expect(box(d, "00562")).toBe(1_750_000);
    expect(box(d, "00592")).toBe(1_692_500);
    expect(box(d, "00599")).toBe(1_692_500 - 100_000 - 300_000);
    expect(d.outcome).toBe("a_ingresar");
    expect(d.extra.pendingLossesAfterCents).toBe(0);
  });

  it("límite del 70 % por encima de un millón, sin límite en una entidad de nueva creación, y aplicación por antigüedad", () => {
    expect(lossCompensationLimit(50_000_000, false)).toBe(50_000_000);
    expect(lossCompensationLimit(200_000_000, false)).toBe(140_000_000);
    expect(lossCompensationLimit(120_000_000, false)).toBe(100_000_000);
    expect(lossCompensationLimit(200_000_000, true)).toBe(200_000_000);
    const big = corporate200(base({ accountingResultCents: 200_000_000, previousPending: [{ originYear: 2022, amountCents: 300_000_000 }], previousSource: "obligation:9" }));
    expect(box(big, "00552")).toBe(60_000_000);
    expect(JSON.parse(String(big.extra.pendingLossesJson))).toEqual([{ originYear: 2022, amountCents: 160_000_000 }]);
    expect(applyNegativeBases([{ originYear: 2022, amountCents: 2_000_000, source: "b" }, { originYear: 2020, amountCents: 1_000_000, source: "a" }], 1_500_000).map((x) => [x.originYear, x.appliedCents])).toEqual([
      [2020, 1_000_000],
      [2022, 500_000],
    ]);
  });

  it("base negativa: cuota cero, devuelve retenciones y deja la base pendiente para el ejercicio siguiente; sin datos, null", () => {
    const d = corporate200(base({ accountingResultCents: -5_000_000, installmentsPaidCents: 0 }));
    expect(box(d, "00562")).toBe(0);
    expect(d.resultCents).toBe(-100_000);
    expect(d.outcome).toBe("a_devolver");
    expect(JSON.parse(String(d.extra.pendingLossesJson))).toEqual([{ originYear: 2026, amountCents: 5_000_000 }]);
    expect(corporate200(base({ hasData: false })).resultCents).toBeNull();
  });

  it("tipo: el configurado, o el 15 % el primer ejercicio con base positiva y el siguiente", () => {
    expect(corporateRateBp({ corporateTaxRateBp: 2500, newEntityFirstProfitYear: null }, 2026)).toBe(2500);
    expect([2025, 2026, 2027, 2028].map((y) => corporateRateBp({ corporateTaxRateBp: 2500, newEntityFirstProfitYear: 2026 }, y))).toEqual([2500, 1500, 1500, 2500]);
  });

  it("202 por el art. 40.2 (18 % de la cuota del último 200 vencido) y por el art. 40.3 (5/7 del tipo)", () => {
    expect([baseYearFor202(2026, "1P"), baseYearFor202(2026, "2P"), baseYearFor202(2026, "3P")]).toEqual([2024, 2025, 2025]);
    const a = installment202({ year: 2026, period: "2P", method: "art40_2", last200: { year: 2025, cuotaIntegraCents: 1_750_000, deduccionesCents: 57_500, retencionesCents: 100_000, source: "obligation:1" } });
    expect(box(a, "base")).toBe(1_592_500);
    expect(a.resultCents).toBe(286_650);
    const zero = installment202({ year: 2026, period: "2P", method: "art40_2", last200: { year: 2025, cuotaIntegraCents: 0, deduccionesCents: 0, retencionesCents: 10_000, source: "obligation:1" } });
    expect(zero.applicable).toBe(false);
    expect(zero.reason).toMatch(/no hay pago fraccionado/);
    const missing = installment202({ year: 2026, period: "1P", method: "art40_2", last200: null });
    expect(missing.hasData).toBe(false);
    expect(missing.warnings[0]).toMatch(/2024/);
    expect([art40_3CoefficientBp(2500), art40_3CoefficientBp(1500)]).toEqual([1700, 1000]);
    const b = installment202({ year: 2026, period: "2P", method: "art40_3", last200: null, cumulative: { resultCents: 1_000_000, lossesAvailableCents: 0, withholdingsCents: 10_000, previousPaymentsCents: 50_000, rateBp: 2500, hasData: true, newEntity: false } });
    expect(b.resultCents).toBe(170_000 - 60_000);
    const c = installment202({ year: 2026, period: "1P", method: "art40_3", last200: null, cumulative: { resultCents: 1_000_000, lossesAvailableCents: 400_000, withholdingsCents: 0, previousPaymentsCents: 0, rateBp: 2500, hasData: true, newEntity: false } });
    expect(c.resultCents).toBe(102_000);
  });
});

describe("avisos, huella y asientos", () => {
  it("avisos a 15, 7 y 3 días, una sola vez por umbral", () => {
    expect(reminderBucket(20, null)).toBeNull();
    expect(reminderBucket(15, null)).toBe(15);
    expect(reminderBucket(10, 15)).toBeNull();
    expect(reminderBucket(7, 15)).toBe(7);
    expect(reminderBucket(5, 7)).toBeNull();
    expect(reminderBucket(2, 7)).toBe(3);
    expect(reminderBucket(0, null)).toBe(3);
    expect(reminderBucket(-1, null)).toBeNull();
  });

  it("misma entrada, misma huella; datos distintos: diferencias por casilla", () => {
    const a = finalizeDraft(vat303(v303({ lines: [line({ entryId: 1, entryNumber: 1, account: "477", creditCents: 2100, taxBaseCents: 10_000 })] })), 1);
    const b = finalizeDraft(vat303(v303({ lines: [line({ entryId: 1, entryNumber: 1, account: "477", creditCents: 2100, taxBaseCents: 10_000 })] })), 999);
    expect(a.hash).toBe(b.hash);
    expect(a.notice).toMatch(/no presenta declaraciones/);
    const c = finalizeDraft(vat303(v303({ lines: [line({ entryId: 1, entryNumber: 1, account: "477", creditCents: 4200, taxBaseCents: 20_000 })] })), 2);
    expect(staleInfo(a, b, 5)).toBeNull();
    const s = staleInfo(a, c, 5)!;
    expect(s.resultBefore).toBe(2100);
    expect(s.resultAfter).toBe(4200);
    expect(s.differences.find((x) => x.box === "09")).toEqual({ box: "09", label: "Régimen general 21 %: cuota", before: 2100, after: 4200 });
    expect(draftCsv(c, "3.er trimestre 2026")).toMatch(/^﻿/);
  });

  it("liquidación del IVA: a ingresar (4750), a compensar (4700), con compensación aplicada; sin importes, ningún asiento", () => {
    const pay = vatSettlementEntry({ year: 2026, period: "3T", date: "2026-09-30", devengadoCents: 2281, deducibleCents: 1551, compensadoCents: 200, resultCents: 530 })!;
    expect(pay.sourceKey).toBe("tax:303:2026:3T");
    expect(pay.origin).toBe("tax");
    expect(pay.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["477", 2281, 0],
      ["472", 0, 1551],
      ["4700", 0, 200],
      ["4750", 0, 530],
    ]);
    expect(sumLines(pay.lines).debitCents).toBe(sumLines(pay.lines).creditCents);
    const comp = vatSettlementEntry({ year: 2026, period: "2T", date: "2026-06-30", devengadoCents: 0, deducibleCents: 1000, compensadoCents: 0, resultCents: -1000 })!;
    expect(comp.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["472", 0, 1000],
      ["4700", 1000, 0],
    ]);
    expect(vatSettlementEntry({ year: 2026, period: "1T", date: "2026-03-31", devengadoCents: 0, deducibleCents: 0, compensadoCents: 0, resultCents: 0 })).toBeNull();
    expect(() => vatSettlementEntry({ year: 2026, period: "1T", date: "2026-03-31", devengadoCents: 10, deducibleCents: 0, compensadoCents: 0, resultCents: 9 })).toThrow(/no cuadra/);
  });

  it("pagos, nómina y cuotas de aplazamiento cuadran; los modelos informativos no tienen pago", () => {
    const p = taxPaymentEntry({ obligationId: 5, model: "202", year: 2026, period: "2P", date: "2026-10-20", amountCents: 1000, bankAccountCode: "57200001" });
    expect(p.lines.map((l) => l.accountCode)).toEqual(["473", "57200001"]);
    expect(p.sourceKey).toBe("tax-payment:5");
    expect(() => taxPaymentEntry({ obligationId: 5, model: "390", year: 2026, period: "ANUAL", date: "2026-10-20", amountCents: 1000, bankAccountCode: "57200001" })).toThrow(/informativo/);
    const n = payrollEntry({ id: 3, period: "2026-07", employeeAlias: "dev-1", grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, netCents: 235_500 });
    expect(n.date).toBe("2026-07-31");
    expect(n.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["640", 300_000, 0],
      ["642", 96_000, 0],
      ["4751", 0, 45_000],
      ["476", 0, 115_500],
      ["465", 0, 235_500],
    ]);
    expect(() => payrollEntry({ id: 3, period: "2026-07", employeeAlias: "dev-1", grossCents: 300_000, irpfCents: 45_000, ssEmployeeCents: 19_500, ssCompanyCents: 96_000, netCents: 1 })).toThrow(/no cuadra/);
    const q = deferralInstallmentEntry({ deferralId: 2, number: 1, model: "303", date: "2026-11-05", amountCents: 50_000, interestCents: 312, bankAccountCode: "57200001", label: "Aplazamiento" });
    expect(q.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["4750", 50_000, 0],
      ["669", 312, 0],
      ["57200001", 0, 50_312],
    ]);
  });

  it("libros registro en CSV («;», BOM, euros con coma) y cobros de Stripe sin factura como incidencia", () => {
    const csv = receivedRegisterCsv([{ invoiceDate: "2026-08-03", accrualDate: null, number: "F-1", kind: "F1", supplierName: "Proveedor; SA", supplierTaxId: "A11111111", country: "ES", baseCents: 10_000, taxRateBp: 2100, taxCents: 2100, deductibleTaxCents: 2100, withholdingCents: 0, totalCents: 12_100, rectifies: null, reverseCharge: false }]);
    expect(csv.startsWith("﻿Fecha de expedición;")).toBe(true);
    expect(csv).toContain('03/08/2026;;F-1;F1;"Proveedor; SA";A11111111;ES;100,00;21,00;21,00;21,00;0,00;121,00;;No');
    expect(issuedIncidentsCsv([])).toBe("");
    expect(issuedIncidentsCsv([{ date: "2026-10-06", transactionId: "txn_test_c2", description: "Cargo", grossCents: 6050 }])).toContain("06/10/2026;txn_test_c2;Cargo;60,50");
  });
});
