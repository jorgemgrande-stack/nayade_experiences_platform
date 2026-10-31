/**
 * Parametrización fiscal (CRM 0039), reglas PURAS: resolución del IVA de las comisiones de Stripe por tipo y periodo
 * (regla exacta, `*`, modo global; `unset` no contabiliza), validación de reglas, inversión del sujeto pasivo en el
 * asiento del gasto y en el 303/349/347/libro de recibidas, escala del Impuesto sobre Sociedades por tramos, presets,
 * reservas de capitalización y nivelación, asiento del 200 y Revenue & Margin según el tratamiento de las comisiones.
 * Solo datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import { buildRevenueMargin, resolveDirectCost } from "./analysisRules";
import type { LedgerFact } from "./analysisTypes";
import { checkVatTreatment, expenseEntry, reverseChargeAmounts } from "./opsRules";
import type { Expense } from "./opsTypes";
import { checkFeeVatRule, issuerFromDescription, issuerMark, resolveFeeVat, stripeTxnEntry } from "./stripeRules";
import { DEFAULT_STRIPE_SETTINGS, type StripeFeeVatRule } from "./stripeTypes";
import {
  bracketQuota,
  capitalizationReduction,
  checkCorporateYear,
  corporate200,
  corporateEntryDraft,
  corporateEntrySourceKey,
  corporatePresets,
  CORPORATE_YEAR_UNSET_WARNING,
  draftHash,
  isEu,
  isEuForeign,
  m347,
  m349,
  receivedRegisterCsv,
  vat303,
  type Corporate200Input,
  type VatLedgerLine,
} from "./taxRules";
import { FinanceError } from "./types";

const EU = { isEu, isEuForeign };
const lines = (d: { lines: Array<{ accountCode: string; debitCents: number; creditCents: number }> }) => d.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents]);
const balanced = (d: { lines: Array<{ debitCents: number; creditCents: number }> }) => d.lines.reduce((a, l) => a + l.debitCents - l.creditCents, 0) === 0;
const box = (d: { boxes: Array<{ box: string; valueCents: number | null }> }, b: string) => d.boxes.find((x) => x.box === b)?.valueCents;

const rule = (p: Partial<StripeFeeVatRule>): StripeFeeVatRule => ({ id: 1, feeKind: "*", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", issuerVatId: "IE3206488LH", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01", validTo: null, documentRef: "Factura de comisiones", note: null, createdBy: "t", createdAt: 0, voidedBy: null, voidedAt: null, voidReason: null, ...p });
const charge = { balanceTransactionId: "txn_test_c1", type: "charge" as const, rawType: "charge", createdOn: "2026-10-05", currency: "EUR", grossCents: 12_100, feeCents: 388, netCents: 11_712, description: null, chargeId: "ch_test_1" };
const UNSET = { ...DEFAULT_STRIPE_SETTINGS, stripeFeeVat: "unset" as const };

describe("IVA de las comisiones de Stripe por tipo, emisor y periodo", () => {
  it("resolución: regla del tipo exacto → la de «*» → el modo global; vigencia y anuladas", () => {
    const rules = [rule({ id: 1, feeKind: "*", treatment: "exempt", rateBp: null }), rule({ id: 2, feeKind: "charge", validFrom: "2026-07-01" }), rule({ id: 3, feeKind: "stripe_fee", treatment: "domestic", issuerCountry: "ES", issuerVatId: null, voidedAt: 5 })];
    expect(resolveFeeVat(charge, rules, UNSET)).toMatchObject({ treatment: "reverse_charge", rateBp: 2100, source: "rule", rule: { id: 2, issuerVatId: "IE3206488LH" } });
    // Antes de la vigencia de la regla del tipo: la de «*»
    expect(resolveFeeVat({ ...charge, createdOn: "2026-06-30" }, rules, UNSET)).toMatchObject({ treatment: "exempt", source: "wildcard" });
    // La regla anulada no cuenta; tampoco el tipo original del informe si no casa
    expect(resolveFeeVat({ type: "stripe_fee", rawType: "fee", createdOn: "2026-10-05" }, rules, UNSET)).toMatchObject({ treatment: "exempt", source: "wildcard" });
    // Por el tipo original del informe (application_fee se normaliza como «other», pero la regla lo nombra)
    expect(resolveFeeVat({ type: "other", rawType: "application_fee", createdOn: "2026-10-05" }, [rule({ id: 9, feeKind: "application_fee", treatment: "per_invoice", rateBp: null })], UNSET)).toMatchObject({ treatment: "per_invoice", source: "rule" });
    // Sin reglas: el modo global (con 0039, por defecto `unset`)
    expect(resolveFeeVat(charge, [], UNSET)).toEqual({ treatment: "unset", rateBp: 2100, rule: null, source: "global" });
    // Entre dos vigentes del mismo tipo, la de inicio más reciente
    expect(resolveFeeVat(charge, [rule({ id: 4, feeKind: "charge", validFrom: "2026-01-01", treatment: "exempt", rateBp: null }), rule({ id: 5, feeKind: "charge", validFrom: "2026-09-01", rateBp: 1000 })], UNSET)).toMatchObject({ rateBp: 1000, rule: { id: 5 } });
  });

  it("validación de reglas: inversión del sujeto pasivo con emisor español o de fuera de la UE → invalid_rule", () => {
    const ok = checkFeeVatRule({ feeKind: "Charge", issuerName: " Stripe Payments Europe, Limited ", issuerCountry: "ie", issuerVatId: "ie 3206488lh", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01" }, EU);
    expect(ok).toMatchObject({ feeKind: "charge", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", issuerVatId: "IE3206488LH", validTo: null });
    const err = (p: Partial<Parameters<typeof checkFeeVatRule>[0]>) => {
      try {
        checkFeeVatRule({ feeKind: "*", issuerName: "Stripe", issuerCountry: "IE", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01", ...p }, EU);
        return null;
      } catch (e) {
        return (e as FinanceError).code;
      }
    };
    expect(err({ issuerCountry: "ES" })).toBe("invalid_rule");
    expect(err({ issuerCountry: "US" })).toBe("invalid_rule");
    expect(err({ rateBp: null })).toBe("invalid_rule");
    expect(err({ treatment: "exempt", rateBp: 2100 })).toBe("invalid_rule");
    expect(err({ validTo: "2025-12-31" })).toBe("invalid_rule");
    expect(err({ feeKind: "con espacios" })).toBe("invalid_rule");
    expect(err({ treatment: "domestic", issuerCountry: "ES", rateBp: 2100 })).toBeNull();
  });

  it("asiento: ISP con la marca del emisor; domestic y per_invoice sin IVA; unset no contabiliza si hay comisión", () => {
    const rc = resolveFeeVat(charge, [rule({ feeKind: "charge" })], UNSET);
    const e = stripeTxnEntry(charge, UNSET, null, rc);
    expect(lines(e)).toEqual([
      ["5720", 11_712, 0],
      ["626", 388, 0],
      ["430", 0, 12_100],
      ["472", 81, 0],
      ["477", 0, 81],
    ]);
    expect(e.lines[3].description).toContain(issuerMark("Stripe Payments Europe, Limited", "IE3206488LH"));
    expect(issuerFromDescription(e.lines[3].description)).toEqual({ name: "Stripe Payments Europe, Limited", vatId: "IE3206488LH" });
    for (const treatment of ["domestic", "per_invoice", "exempt"] as const) expect(lines(stripeTxnEntry(charge, UNSET, null, { treatment, rateBp: 2100, rule: null, source: "global" })).map((l) => l[0])).toEqual(["5720", "626", "430"]);
    expect(() => stripeTxnEntry(charge, UNSET, null)).toThrow(/fee_vat_unset/);
    // Sin comisión no hay nada que decidir
    expect(balanced(stripeTxnEntry({ ...charge, feeCents: 0, netCents: 12_100 }, UNSET, null))).toBe(true);
    // Sin el cuarto argumento, el modo global de la fase 2 (compatibilidad)
    expect(lines(stripeTxnEntry(charge, { ...DEFAULT_STRIPE_SETTINGS, stripeFeeVat: "reverse_charge" }, null)).length).toBe(5);
  });
});

const expense = (p: Partial<Expense>): Expense => ({ id: 7, supplierId: 3, categoryId: 1, costCenterId: null, invoiceNumber: "INV-1", invoiceDate: "2026-08-10", accrualDate: null, dueDate: null, description: "Servicio en la nube", baseCents: 100_000, taxRateBp: 0, taxCents: 0, deductibleBp: 10_000, withholdingRateBp: 0, withholdingCents: 0, totalCents: 100_000, paidCents: 0, currency: "EUR", kind: "invoice", rectifiesExpenseId: null, vatTreatment: null, reverseChargeRateBp: null, status: "draft", entryId: null, paymentStatus: "pending", sourceKey: null, createdBy: "t", createdAt: 0, registeredBy: null, registeredAt: null, voidedBy: null, voidedAt: null, voidReason: null, ...p });

describe("gastos con inversión del sujeto pasivo", () => {
  it("validación: NIF-IVA del proveedor UE (vat_id_required), factura sin IVA, tipo de la autoliquidación obligatorio", () => {
    const de = { country: "DE", taxId: "DE123456789" };
    expect(checkVatTreatment("intra_eu_services", { taxRateBp: 0, reverseChargeRateBp: 2100 }, de, EU)).toEqual({ vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100 });
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e) {
        return (e as FinanceError).code;
      }
    };
    expect(code(() => checkVatTreatment("intra_eu_services", { taxRateBp: 0, reverseChargeRateBp: 2100 }, { country: "DE", taxId: null }, EU))).toBe("vat_id_required");
    expect(code(() => checkVatTreatment("intra_eu_goods", { taxRateBp: 0, reverseChargeRateBp: 2100 }, null, EU))).toBe("vat_id_required");
    expect(code(() => checkVatTreatment("intra_eu_services", { taxRateBp: 0, reverseChargeRateBp: 2100 }, { country: "ES", taxId: "B12345674" }, EU))).toBe("invalid_input");
    expect(code(() => checkVatTreatment("intra_eu_services", { taxRateBp: 2100, reverseChargeRateBp: 2100 }, de, EU))).toBe("invalid_input");
    expect(code(() => checkVatTreatment("non_eu_services", { taxRateBp: 0 }, { country: "US", taxId: null }, EU))).toBe("invalid_input");
    expect(code(() => checkVatTreatment("non_eu_services", { taxRateBp: 0, reverseChargeRateBp: 2100 }, de, EU))).toBe("invalid_input");
    expect(code(() => checkVatTreatment(null, { taxRateBp: 2100, reverseChargeRateBp: 2100 }, null, EU))).toBe("invalid_input");
    expect(checkVatTreatment("import", { taxRateBp: 2100 }, { country: "ES", taxId: "B12345674" }, EU)).toEqual({ vatTreatment: "import", reverseChargeRateBp: null });
    expect(checkVatTreatment(undefined, { taxRateBp: 2100 }, null, EU)).toEqual({ vatTreatment: null, reverseChargeRateBp: null });
  });

  it("asiento con autoliquidación 472/477 y la parte no deducible a mayor gasto; el gasto interior no cambia", () => {
    const e = expenseEntry(expense({ vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100, deductibleBp: 5000 }), { categoryAccount: "629", supplierAccount: "410", supplierName: "Cloud GmbH" });
    expect(lines(e)).toEqual([
      ["629", 110_500, 0],
      ["472", 10_500, 0],
      ["477", 0, 21_000],
      ["410", 0, 100_000],
    ]);
    expect(balanced(e)).toBe(true);
    expect(e.lines.filter((l) => l.accountCode.startsWith("47")).every((l) => l.taxRateBp === 2100 && l.taxBaseCents === 100_000)).toBe(true);
    expect(reverseChargeAmounts(expense({ vatTreatment: "reverse_charge_domestic", reverseChargeRateBp: 2100 }))).toEqual({ rateBp: 2100, taxCents: 21_000, deductibleTaxCents: 21_000, nonDeductibleTaxCents: 0 });
    expect(reverseChargeAmounts(expense({ vatTreatment: "import" }))).toBeNull();
    // Interior: idéntico al de la fase 1B
    const dom = expenseEntry(expense({ taxRateBp: 2100, taxCents: 21_000, totalCents: 121_000 }), { categoryAccount: "629", supplierAccount: "410", supplierName: null });
    expect(lines(dom)).toEqual([
      ["629", 100_000, 0],
      ["472", 21_000, 0],
      ["410", 0, 121_000],
    ]);
  });

  it("303: ISP intracomunitaria 10/11 y 36/37, interior o de fuera de la UE 12/13 y 28/29, importación 32/33; sin aviso de ISP pendiente", () => {
    let n = 0;
    const l = (p: Partial<VatLedgerLine> & Pick<VatLedgerLine, "account">): VatLedgerLine => ({ entryId: ++n, entryNumber: n, date: "2026-08-10", description: "línea", kind: "purchase", reversal: false, originalInPeriod: true, debitCents: 0, creditCents: 0, taxRateBp: 2100, taxBaseCents: 100_000, ...p });
    const d = vat303({
      year: 2026,
      period: "3T",
      lines: [
        l({ account: "477", creditCents: 21_000, treatment: "intra_eu_services" }),
        l({ account: "472", debitCents: 21_000, treatment: "intra_eu_services" }),
        l({ account: "477", creditCents: 2_100, taxBaseCents: 10_000, treatment: "non_eu_services" }),
        l({ account: "472", debitCents: 2_100, taxBaseCents: 10_000, treatment: "non_eu_services" }),
        l({ account: "472", debitCents: 4_200, taxBaseCents: 20_000, treatment: "import" }),
      ],
      invoices: [],
      expenses: [{ id: 1, number: "INV-1", date: "2026-08-10", supplierName: "Cloud GmbH", supplierCountry: "DE", baseCents: 100_000, taxRateBp: 0, kind: "invoice", vatTreatment: "intra_eu_services" }],
      ledgerHasEntries: true,
      carriedInCents: 0,
      carriedInSource: "settings",
      lastPeriod: false,
      regime: "general",
    });
    expect([box(d, "10"), box(d, "11"), box(d, "36"), box(d, "37")]).toEqual([100_000, 21_000, 100_000, 21_000]);
    expect([box(d, "12"), box(d, "13"), box(d, "28"), box(d, "29")]).toEqual([10_000, 2_100, 10_000, 2_100]);
    expect([box(d, "32"), box(d, "33")]).toEqual([20_000, 4_200]);
    expect(d.resultCents).toBe(-4_200);
    expect(d.warnings.join(" ")).not.toMatch(/falta autoliquidarla/);
    // Sin importaciones, las casillas 32/33 no aparecen (la huella de los borradores anteriores no cambia)
    const none = vat303({ year: 2026, period: "3T", lines: [l({ account: "472", kind: "purchase", debitCents: 2_100, taxBaseCents: 10_000 })], invoices: [], expenses: [], ledgerHasEntries: true, carriedInCents: 0, carriedInSource: "s", lastPeriod: false, regime: "general" });
    expect(none.boxes.some((b) => b.box === "32")).toBe(false);
  });

  it("349 (clave A para bienes, I para servicios, un declarado por emisor de Stripe) y 347 (sin intracomunitarias ni importaciones)", () => {
    const d = m349({
      year: 2026,
      period: "3T",
      invoices: [],
      expenses: [
        { id: 1, number: "A-1", date: "2026-08-01", supplierName: "Teile GmbH", supplierTaxId: "DE111111111", supplierCountry: "DE", baseCents: 50_000, key: "A" },
        { id: 2, number: "S-1", date: "2026-08-02", supplierName: "Cloud BV", supplierTaxId: "NL222222222B01", supplierCountry: "NL", baseCents: 30_000 },
      ],
      stripeFeeBaseCents: 0,
      stripeVatId: null,
      stripeDetails: [],
      stripeGroups: [{ taxId: "IE3206488LH", name: "Stripe Payments Europe, Limited", baseCents: 388, details: [] }],
    });
    expect(d.declarants.map((x) => [x.key, x.taxId, x.amountCents])).toEqual([
      ["A", "DE111111111", 50_000],
      ["I", "IE3206488LH", 388],
      ["I", "NL222222222B01", 30_000],
    ]);
    const ops = (vatTreatment: "import" | "intra_eu_services" | null) => ({ key: "A" as const, ref: "expense:1", source: "expense" as const, date: "2026-03-01", number: "X", taxId: "B12345674", name: "Agente aduanas SL", country: "ES", totalCents: 500_000, withholdingCents: 0, vatTreatment });
    expect(m347(2026, [ops("import")]).declarants).toEqual([]);
    expect(m347(2026, [ops("import")]).warnings.join(" ")).toMatch(/intracomunitarias o importaciones excluidas/);
    expect(m347(2026, [ops(null)]).declarants).toHaveLength(1);
  });

  it("libro de recibidas: columna «Tratamiento IVA» (interior por defecto)", () => {
    const csv = receivedRegisterCsv([{ invoiceDate: "2026-08-10", accrualDate: null, number: "INV-1", kind: "F1", supplierName: "Cloud GmbH", supplierTaxId: "DE123456789", country: "DE", baseCents: 100_000, taxRateBp: 2100, taxCents: 21_000, deductibleTaxCents: 21_000, withholdingCents: 0, totalCents: 100_000, rectifies: null, reverseCharge: true, treatment: "Servicios intracomunitarios (ISP)" }]);
    expect(csv.split("\r\n")[0]).toMatch(/;Inversión del sujeto pasivo;Tratamiento IVA$/);
    expect(csv).toContain(";Sí;Servicios intracomunitarios (ISP)");
  });
});

describe("Impuesto sobre Sociedades por ejercicio", () => {
  const base = (p: Partial<Corporate200Input> = {}): Corporate200Input => ({ year: 2026, rateBp: 2500, newEntity: false, hasData: true, accountingResultCents: 10_000_000, taxExpenseCents: 0, withholdings473Cents: 0, installmentsPaidCents: 0, adjustments: [], previousPending: null, previousSource: null, details: [], ...p });

  it("presets con su cita y la propuesta; escala transitoria de la Ley 7/2024 desde 2025", () => {
    const p26 = corporatePresets(2026);
    expect(p26.map((p) => p.key)).toEqual(["general", "nueva_creacion", "microempresa", "erd"]);
    expect(p26.find((p) => p.key === "microempresa")!.brackets).toEqual([
      { uptoCents: 5_000_000, rateBp: 2000 },
      { uptoCents: null, rateBp: 2100 },
    ]);
    expect(p26.find((p) => p.key === "erd")!.brackets).toEqual([{ uptoCents: null, rateBp: 2300 }]);
    expect(corporatePresets(2025).find((p) => p.key === "microempresa")!.brackets.map((b) => b.rateBp)).toEqual([2100, 2200]);
    expect(corporatePresets(2031).find((p) => p.key === "microempresa")!.brackets.map((b) => b.rateBp)).toEqual([1700, 2000]);
    expect(corporatePresets(2031).find((p) => p.key === "erd")!.brackets[0].rateBp).toBe(2000);
    expect(corporatePresets(2024).map((p) => p.key)).toEqual(["general", "nueva_creacion"]);
    for (const p of p26) expect(p).toMatchObject({ notice: "Propuesta: confírmala con tu gestoría", citation: expect.stringMatching(/LIS|Ley 27\/2014/) });
  });

  it("validación de la configuración: tramos ordenados, el último sin tope, tipos de 0 a 10000", () => {
    const cfg = { regime: "microempresa" as const, brackets: [{ uptoCents: 5_000_000, rateBp: 2000 }, { uptoCents: null, rateBp: 2100 }], netTurnoverCents: 80_000_000, capReserveEquityIncreaseCents: null, capReserveRateBp: null, capReserveLimitBp: null, levellingReserveCents: null, notes: " " };
    expect(checkCorporateYear(cfg)).toMatchObject({ notes: null });
    expect(() => checkCorporateYear({ ...cfg, brackets: [{ uptoCents: 5_000_000, rateBp: 2000 }] })).toThrow(/último tramo/);
    expect(() => checkCorporateYear({ ...cfg, brackets: [{ uptoCents: 5_000_000, rateBp: 2000 }, { uptoCents: 4_000_000, rateBp: 2000 }, { uptoCents: null, rateBp: 2100 }] })).toThrow(/ordenados/);
    expect(() => checkCorporateYear({ ...cfg, brackets: [{ uptoCents: null, rateBp: 10_001 }] })).toThrow(/0 a 10000/);
    expect(() => checkCorporateYear({ ...cfg, capReserveEquityIncreaseCents: 1_000 })).toThrow(/tasa y su límite/);
    expect(() => checkCorporateYear({ ...cfg, regime: "otra" as never })).toThrow(/Régimen/);
  });

  it("cuota por tramos y reserva de capitalización", () => {
    // 80.000 € de base con la escala de microempresa de 2026: 50.000 × 20 % + 30.000 × 21 %
    expect(bracketQuota(8_000_000, [{ uptoCents: 5_000_000, rateBp: 2000 }, { uptoCents: null, rateBp: 2100 }])).toEqual({
      quotaCents: 1_630_000,
      rows: [
        { fromCents: 0, uptoCents: 5_000_000, rateBp: 2000, baseCents: 5_000_000, quotaCents: 1_000_000 },
        { fromCents: 5_000_000, uptoCents: null, rateBp: 2100, baseCents: 3_000_000, quotaCents: 630_000 },
      ],
    });
    // min(incremento × tasa, base × límite)
    expect(capitalizationReduction(10_000_000, { equityIncreaseCents: 4_000_000, rateBp: 2000, limitBp: 2000 })).toBe(800_000);
    expect(capitalizationReduction(1_000_000, { equityIncreaseCents: 4_000_000, rateBp: 2000, limitBp: 2000 })).toBe(200_000);
    expect(capitalizationReduction(-5, { equityIncreaseCents: 4_000_000, rateBp: 2000, limitBp: 2000 })).toBe(0);
  });

  it("200 configurado: base previa → reserva de capitalización (01032) → nivelación (ERD) → bases negativas → tramos", () => {
    const d = corporate200(
      base({
        accountingResultCents: 10_000_000,
        adjustments: [{ id: 1, kind: "negative_base", description: "BIN 2024", amountCents: 1_000_000, originYear: 2024 }],
        corporate: { regime: "microempresa", brackets: [{ uptoCents: 5_000_000, rateBp: 2000 }, { uptoCents: null, rateBp: 2100 }], capReserveEquityIncreaseCents: 4_000_000, capReserveRateBp: 2000, capReserveLimitBp: 2500, levellingReserveCents: 300_000 },
        fiscal: true,
      }),
    );
    expect(box(d, "00550")).toBe(10_000_000);
    expect(box(d, "01032")).toBe(800_000);
    expect(box(d, "nivelacion")).toBe(300_000);
    expect(box(d, "00547")).toBe(1_000_000);
    expect(box(d, "00552")).toBe(7_900_000);
    expect(box(d, "00562")).toBe(1_000_000 + 609_000);
    expect(d.details.filter((x) => x.ref.startsWith("corporate-year:2026:tramo")).map((x) => [x.baseCents, x.taxCents, x.rateBp])).toEqual([
      [5_000_000, 1_000_000, 2000],
      [2_900_000, 609_000, 2100],
    ]);
    expect(d.extra).toMatchObject({ regime: "microempresa", capitalizationReserveCents: 800_000, levellingReductionCents: 300_000 });
    expect(d.warnings.join(" ")).toMatch(/indisponible/);
    expect(d.warnings).not.toContain(CORPORATE_YEAR_UNSET_WARNING);
  });

  it("200 sin configurar: tipo único con el aviso corporate_year_unset (con 0039) y la misma huella que antes", () => {
    const legacy = corporate200(base());
    const unset = corporate200(base({ fiscal: true }));
    expect(unset.warnings).toContain(CORPORATE_YEAR_UNSET_WARNING);
    expect(legacy.warnings.join(" ")).toMatch(/Tipo único configurado/);
    // Los avisos no entran en la huella: los borradores presentados antes no pasan a «datos cambiados»
    expect(draftHash(unset)).toBe(draftHash(legacy));
    expect(box(unset, "00562")).toBe(2_500_000);
    // La nivelación solo para entidades de reducida dimensión
    const gen = corporate200(base({ corporate: { regime: "general", brackets: [{ uptoCents: null, rateBp: 2500 }], capReserveEquityIncreaseCents: null, capReserveRateBp: null, capReserveLimitBp: null, levellingReserveCents: 100_000 }, fiscal: true }));
    expect(box(gen, "nivelacion")).toBe(0);
    expect(gen.warnings.join(" ")).toMatch(/nivelación solo/);
  });

  it("asiento del 200: a ingresar, a devolver y diferido (gasto e ingreso), con su clave de origen", () => {
    expect(corporateEntrySourceKey(2026, 1)).toBe("tax:200:entry:2026");
    expect(corporateEntrySourceKey(2026, 3)).toBe("tax:200:entry:2026:3");
    const pay = corporateEntryDraft({ year: 2026, seq: 1, date: "2026-12-31", currentTaxCents: 250_000, deferredTaxCents: 10_000, withholdingsCents: 100_000, origin: "system" });
    expect(lines(pay)).toEqual([
      ["6300", 250_000, 0],
      ["473", 0, 100_000],
      ["4752", 0, 150_000],
      ["6301", 10_000, 0],
      ["479", 0, 10_000],
    ]);
    expect(pay).toMatchObject({ journalCode: "IMP", origin: "tax", sourceKey: "tax:200:entry:2026" });
    const refund = corporateEntryDraft({ year: 2026, seq: 2, date: "2026-12-31", currentTaxCents: 50_000, deferredTaxCents: -7_000, withholdingsCents: 80_000, origin: "gestoria" });
    expect(lines(refund)).toEqual([
      ["6300", 50_000, 0],
      ["473", 0, 80_000],
      ["4709", 30_000, 0],
      ["4740", 7_000, 0],
      ["6301", 0, 7_000],
    ]);
    expect(balanced(pay) && balanced(refund)).toBe(true);
    expect(() => corporateEntryDraft({ year: 2026, seq: 1, date: "2026-12-31", currentTaxCents: 0, deferredTaxCents: 0, withholdingsCents: 0, origin: "manual" })).toThrow(/nada que contabilizar/);
  });
});

describe("análisis: coste directo y comisiones de Stripe según su tratamiento", () => {
  const fact = (accountCode: string, origin: LedgerFact["origin"], debitCents: number, creditCents = 0, categoryId: number | null = null): LedgerFact => ({ month: "2026-10", accountCode, origin, costCenterId: null, supplierId: null, categoryId, debitCents, creditCents });
  const facts = [fact("705", "invoice", 0, 100_000), fact("626", "stripe", 3_000), fact("626", "bank", 500, 0, 5), fact("669", "bank", 200), fact("629", "expense", 10_000, 0, 1)];
  const rm = (t?: "direct_cost" | "structure" | "financial") => buildRevenueMargin({ facts, months: ["2026-10"], directCategories: new Set([1]), stripe: null, transfers: null, stripeFeesTreatment: t }).months[0];

  it("direct_cost (por defecto): en el margen; structure: en estructura; financial: fuera del margen, con los 66x", () => {
    expect(rm()).toMatchObject({ grossMarginCents: 87_000, structureCostsCents: 500, financialCostsCents: 200, resultCents: 86_300 });
    expect(rm("structure")).toMatchObject({ grossMarginCents: 90_000, structureCostsCents: 3_500, financialCostsCents: 200, resultCents: 86_300 });
    expect(rm("financial")).toMatchObject({ grossMarginCents: 90_000, structureCostsCents: 500, financialCostsCents: 3_200, resultCents: 86_300 });
    expect(resolveDirectCost({ name: "Comisiones bancarias", accountCode: "626", isDirectCost: null })).toBe(false);
  });
});
