/**
 * Parametrización fiscal (CRM 0039) en memoria, de punta a punta sobre los servicios reales: validación de la
 * configuración (puerta de revisar y presentar, anulada por cualquier cambio), gastos con inversión del sujeto pasivo
 * (asiento, 303, 349 y libro de recibidas), comisiones de Stripe sin tratamiento (no se contabilizan), reglas por
 * tipo con su emisor, vista previa de importación SIN escrituras, Impuesto sobre Sociedades por ejercicio y su asiento
 * (sistema, manual, reversión y uno vivo por ejercicio), naturalezas bancarias y el comportamiento de antes sin la
 * migración. Solo datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario, PDF_B64 } from "./fiscalTestkit";
import type { MemoryFinanceStore } from "./store";
import type { MemoryFinanceStripeStore } from "./stripeStore";
import { stripeBalanceSample } from "./testkit";

const lines = (e: { lines: Array<{ accountCode: string; debitCents: number; creditCents: number }> }) => e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents]);
const box = (d: { boxes: Array<{ box: string; valueCents: number | null }> }, b: string) => d.boxes.find((x) => x.box === b)?.valueCents;

describe("validación de la configuración fiscal (puerta para datos reales)", () => {
  it("sin validar: borradores sí, revisar y presentar 409; validar con nota; cualquier cambio la anula con traza", async () => {
    const s = await fiscalScenario();
    const e = await s.ops.createExpense({ kind: "invoice", supplierId: s.es.id, categoryId: s.cat("629"), invoiceNumber: "F-1", invoiceDate: "2026-08-03", description: "Hosting", baseCents: 10_000, taxRateBp: 2100 }, ACTOR);
    await s.ops.registerExpense(e.id, ACTOR);
    await s.tax.generateCalendar(2026, ACTOR);
    const o = (await s.tax.listObligations({ year: 2026, model: "303" })).items.find((x) => x.period === "3T")!;
    const calc = await s.tax.calculate(o.id, ACTOR);
    expect(calc.draft!.resultCents).toBe(-2_100);
    expect(await s.tax.configValidated()).toBe(false);
    await expect(s.tax.review(o.id, ACTOR)).rejects.toMatchObject({ code: "tax_config_not_validated" });
    await expect(s.tax.present(o.id, { presentedOn: "2026-10-20", receiptNumber: "CSV-1" }, ACTOR)).rejects.toMatchObject({ code: "tax_config_not_validated" });
    expect((await s.tax.dashboard()).warnings.map((w) => w.code)).toContain("tax_config_not_validated");
    await expect(s.tax.validateSettings("", ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const v = await s.tax.validateSettings("Revisada con la gestoría el 30/10", ACTOR);
    expect(v).toMatchObject({ validatedBy: "operator:luis", validationNote: "Revisada con la gestoría el 30/10", validatedAt: expect.any(Number) });
    expect((await s.tax.review(o.id, ACTOR)).status).toBe("revisado");
    // Un cambio posterior la anula en el mismo guardado (y queda en el historial y la auditoría)
    const after = await s.tax.saveSettings({ notes: "Cambio de la gestoría" }, ACTOR);
    expect(after).toMatchObject({ validatedAt: null, validatedBy: null, validationNote: null });
    const log = await s.tax.settingsLog();
    expect(log[0].before?.validatedAt).toEqual(expect.any(Number));
    expect(log[0].after.validatedAt).toBeNull();
    expect(log[1].after.validationNote).toBe("Revisada con la gestoría el 30/10");
    const audit = (s.ledger as MemoryFinanceStore).audit.map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["tax.settings.validate", "tax.settings.invalidated"]));
  });

  it("el 200 no se revisa sin configurar el ejercicio (corporate_year_unset) y sí después", async () => {
    const s = await fiscalScenario();
    const e = await s.ops.createExpense({ kind: "invoice", supplierId: s.es.id, categoryId: s.cat("629"), invoiceNumber: "F-2", invoiceDate: "2026-03-03", description: "Hosting", baseCents: 10_000, taxRateBp: 2100 }, ACTOR);
    await s.ops.registerExpense(e.id, ACTOR);
    await s.tax.validateSettings("Validada", ACTOR);
    await s.tax.generateCalendar(2026, ACTOR);
    const o = (await s.tax.listObligations({ year: 2026, model: "200" })).items[0];
    const calc = await s.tax.calculate(o.id, ACTOR);
    expect(calc.draft!.warnings.join(" ")).toMatch(/corporate_year_unset/);
    await expect(s.tax.review(o.id, ACTOR)).rejects.toMatchObject({ code: "corporate_year_unset" });
    await s.tax.saveCorporateYear(2026, { regime: "general", brackets: [{ uptoCents: null, rateBp: 2500 }], netTurnoverCents: null, capReserveEquityIncreaseCents: null, capReserveRateBp: null, capReserveLimitBp: null, levellingReserveCents: null, notes: null }, ACTOR);
    await s.tax.calculate(o.id, ACTOR);
    expect((await s.tax.review(o.id, ACTOR)).status).toBe("revisado");
  });
});

describe("gastos con inversión del sujeto pasivo", () => {
  it("alta y registro: NIF-IVA obligatorio, autoliquidación en el asiento, 303 (10/11 y 36/37), 349 y libro de recibidas", async () => {
    const s = await fiscalScenario();
    const input = { kind: "invoice" as const, categoryId: s.cat("629"), invoiceNumber: "R-1", invoiceDate: "2026-08-05", description: "Servidores", baseCents: 100_000, taxRateBp: 0, vatTreatment: "intra_eu_services" as const, reverseChargeRateBp: 2100 };
    await expect(s.ops.createExpense({ ...input, supplierId: s.deNoVat.id }, ACTOR)).rejects.toMatchObject({ code: "vat_id_required" });
    await expect(s.ops.createExpense({ ...input, supplierId: s.de.id, reverseChargeRateBp: null }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const e = await s.ops.createExpense({ ...input, supplierId: s.de.id }, ACTOR);
    expect(s.ops.expenseDto(e)).toMatchObject({ vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100, taxCents: 0, totalCents: 100_000 });
    const reg = await s.ops.registerExpense(e.id, ACTOR);
    const entry = await s.finance.getEntry(reg.entryId!);
    expect(lines(entry)).toEqual([
      ["629", 100_000, 0],
      ["472", 21_000, 0],
      ["477", 0, 21_000],
      ["410", 0, 100_000],
    ]);
    const d303 = await s.tax.preview("303", 2026, "3T");
    expect([box(d303, "10"), box(d303, "11"), box(d303, "36"), box(d303, "37"), box(d303, "71")]).toEqual([100_000, 21_000, 100_000, 21_000, 0]);
    expect(d303.warnings.join(" ")).not.toMatch(/falta autoliquidarla/);
    const d349 = await s.tax.preview("349", 2026, "3T");
    expect(d349.declarants).toEqual([expect.objectContaining({ key: "I", taxId: "DE123456789", amountCents: 100_000 })]);
    const csv = (await s.tax.receivedRegisterCsv("2026-07-01", "2026-09-30")).csv;
    expect(csv).toContain("R-1;F1;Wolke GmbH;DE123456789;DE;1000,00;21,00;210,00;210,00;0,00;1000,00;;Sí;Servicios intracomunitarios (ISP)");
    // Edición de un borrador: al pasar a interior el tipo de la autoliquidación se descarta
    const e2 = await s.ops.createExpense({ ...input, supplierId: s.de.id, invoiceNumber: "R-2" }, ACTOR);
    const back = await s.ops.patchExpense(e2.id, { vatTreatment: null }, ACTOR);
    expect(back).toMatchObject({ vatTreatment: null, reverseChargeRateBp: null });
  });

  it("sin la migración 0039 solo cabe el interior (como antes)", async () => {
    const s = await fiscalScenario({ fiscal: false });
    await expect(s.ops.createExpense({ kind: "invoice", supplierId: s.de.id, categoryId: s.cat("629"), invoiceNumber: "R-1", invoiceDate: "2026-08-05", description: "Servidores", baseCents: 100_000, taxRateBp: 0, vatTreatment: "intra_eu_services", reverseChargeRateBp: 2100 }, ACTOR)).rejects.toMatchObject({ code: "unavailable" });
    const ok = await s.ops.createExpense({ kind: "invoice", supplierId: s.de.id, categoryId: s.cat("629"), invoiceNumber: "R-1", invoiceDate: "2026-08-05", description: "Servidores", baseCents: 100_000, taxRateBp: 0, vatTreatment: "domestic" }, ACTOR);
    expect(ok).toMatchObject({ vatTreatment: null, reverseChargeRateBp: null });
    expect(await s.tax.configValidated()).toBeNull();
    expect((await s.stripe.settings()).stripeFeeVat).toBe("exempt");
  });
});

describe("comisiones de Stripe: nada se contabiliza a ciegas", () => {
  it("modo global sin decidir: las transacciones con comisión quedan pendientes (fee_vat_unset) y se avisan", async () => {
    const s = await fiscalScenario();
    expect((await s.stripe.settings()).stripeFeeVat).toBe("unset");
    await s.stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    const out = await s.stripe.post("2026-10-31", ACTOR);
    // Con comisión: c1, c2, f1 (cargo de Stripe), d1 y d2 (comisión de disputa); el reembolso r2 no tiene comisión
    expect(out.pendingFeeVat).toBe(5);
    const st = s.stripeStore as MemoryFinanceStripeStore;
    expect(st.txns.find((t) => t.balanceTransactionId === "txn_test_c1")).toMatchObject({ status: "pending", issueDetail: expect.stringMatching(/^fee_vat_unset/) });
    expect(st.txns.find((t) => t.balanceTransactionId === "txn_test_r2")).toMatchObject({ status: "posted" });
    expect(await s.stripe.pendingFeeVatCount()).toBe(5);
    expect(await s.stripe.pendingFeeVatCount("2026-10-20", "2026-10-31")).toBe(2);
    expect((await s.tax.dashboard()).warnings.map((w) => w.code)).toContain("fee_vat_unset");
    expect((await s.tax.preview("303", 2026, "4T")).warnings.join(" ")).toMatch(/fee_vat_unset/);
    expect((await s.analysis.daily("2026-10-31")).counts).toMatchObject({ stripeFeeVatUnset: 5 });
    expect((await s.analysis.daily("2026-10-31")).alerts.map((a) => a.code)).toContain("fee_vat_unset");
  });

  it("regla «*» con inversión del sujeto pasivo: se contabiliza con el emisor de la regla, que llega al 349; anular la regla", async () => {
    const s = await fiscalScenario();
    await s.stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    await expect(s.stripe.createFeeVatRule({ feeKind: "*", issuerName: "Stripe España", issuerCountry: "ES", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01" }, ACTOR)).rejects.toMatchObject({ code: "invalid_rule" });
    const rule = await s.stripe.createFeeVatRule({ feeKind: "*", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", issuerVatId: "IE9999999ZZ", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01", documentRef: "Factura de comisiones de octubre" }, ACTOR);
    const out = await s.stripe.post("2026-10-31", ACTOR);
    expect(out).toMatchObject({ errors: [], pendingFeeVat: 0 });
    const c1 = (s.stripeStore as MemoryFinanceStripeStore).txns.find((t) => t.balanceTransactionId === "txn_test_c1")!;
    const e = await s.finance.getEntry(c1.entryId!);
    expect(e.lines.find((l) => l.accountCode === "477")!.description).toContain("emisor: Stripe Payments Europe, Limited (IE9999999ZZ)");
    const d349 = await s.tax.preview("349", 2026, "4T");
    expect(d349.declarants.find((x) => x.key === "I")).toMatchObject({ taxId: "IE9999999ZZ", name: "Stripe Payments Europe, Limited" });
    const voided = await s.stripe.voidFeeVatRule(rule.id, "Sustituida por la factura nueva", ACTOR);
    expect(voided.voidedAt).toEqual(expect.any(Number));
    await expect(s.stripe.voidFeeVatRule(rule.id, "Otra vez", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await s.stripe.feeVatRules()).length).toBe(1);
  });

  it("vista previa de importación: totales, resolución del IVA y asientos propuestos SIN escribir nada", async () => {
    const s = await fiscalScenario();
    const st = s.stripeStore as MemoryFinanceStripeStore;
    const led = s.ledger as MemoryFinanceStore;
    const snapshot = () => JSON.stringify([st.imports, st.txns, st.payouts, st.rules, led.entries, led.audit]);
    const before = snapshot();
    const p = await s.stripe.previewImport({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) });
    expect(snapshot()).toBe(before);
    expect(p).toMatchObject({ kind: "balance", rows: 9, parsed: 9, skipped: 0, alreadyImported: false, duplicates: 0, nonEur: 1, feeVat: { unset: 5 } });
    expect(p.totals.byType.charge).toEqual({ count: 2, grossCents: 18_150, feeCents: 600, netCents: 17_550 });
    expect(p.sample).toHaveLength(9);
    expect(p.wouldPost.map((w) => w.balanceTransactionId)).toEqual(["txn_test_r2"]);
    expect(p.warnings.map((w) => w.message).join(" ")).toMatch(/fee_vat_unset/);
    // Con una regla, se proponen todos los asientos con sus líneas de IVA
    await s.stripe.createFeeVatRule({ feeKind: "*", issuerName: "Stripe Payments Europe, Limited", issuerCountry: "IE", treatment: "reverse_charge", rateBp: 2100, validFrom: "2026-01-01" }, ACTOR);
    const q = await s.stripe.previewImport({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) });
    expect(q.feeVat).toEqual({ resolved: { reverse_charge: 5 }, unset: 0 });
    expect(q.wouldPost.find((w) => w.balanceTransactionId === "txn_test_c1")!.lines).toEqual([
      { account: "5720", debitCents: 11_712, creditCents: 0 },
      { account: "626", debitCents: 388, creditCents: 0 },
      { account: "430", debitCents: 0, creditCents: 12_100 },
      { account: "472", debitCents: 81, creditCents: 0 },
      { account: "477", debitCents: 0, creditCents: 81 },
    ]);
    // Ya importado: lo dice y cuenta los duplicados
    await s.stripe.importFile({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) }, ACTOR);
    expect(await s.stripe.previewImport({ kind: "balance", filename: "b.csv", contentBase64: b64(stripeBalanceSample()) })).toMatchObject({ alreadyImported: true, duplicates: 9, wouldPost: [] });
  });
});

describe("Impuesto sobre Sociedades: configuración por ejercicio y asiento", () => {
  async function withResult() {
    const s = await fiscalScenario();
    // Beneficio sintético: 10.000 € de ingresos y 2.000 € de gasto; 300 € de retenciones en la 473
    await s.finance.createManual({ date: "2026-06-30", journal: "GEN", description: "Ingresos sintéticos", lines: [{ accountCode: s.bank.accountCode, debitCents: 1_000_000, creditCents: 0 }, { accountCode: "705", debitCents: 0, creditCents: 1_000_000 }], post: true }, ACTOR);
    await s.finance.createManual({ date: "2026-06-30", journal: "GEN", description: "Gasto sintético", lines: [{ accountCode: "629", debitCents: 200_000, creditCents: 0 }, { accountCode: s.bank.accountCode, debitCents: 0, creditCents: 200_000 }], post: true }, ACTOR);
    await s.finance.createManual({ date: "2026-06-30", journal: "GEN", description: "Retención sintética", lines: [{ accountCode: "473", debitCents: 30_000, creditCents: 0 }, { accountCode: s.bank.accountCode, debitCents: 0, creditCents: 30_000 }], post: true }, ACTOR);
    return s;
  }

  it("configuración con bitácora y presets; el 200 calcula por tramos", async () => {
    const s = await withResult();
    await expect(s.tax.saveCorporateYear(2026, { regime: "microempresa", brackets: [{ uptoCents: 5_000_000, rateBp: 2000 }], netTurnoverCents: null, capReserveEquityIncreaseCents: null, capReserveRateBp: null, capReserveLimitBp: null, levellingReserveCents: null, notes: null }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const micro = s.tax.corporatePresets(2026).find((p) => p.key === "microempresa")!;
    const cfg = await s.tax.saveCorporateYear(2026, { regime: "microempresa", brackets: micro.brackets, netTurnoverCents: 900_000_00, capReserveEquityIncreaseCents: 1_000_000, capReserveRateBp: 2000, capReserveLimitBp: micro.capReserveLimitBp, levellingReserveCents: null, notes: "Confirmado con la gestoría" }, ACTOR);
    expect(cfg).toMatchObject({ year: 2026, version: 1, regime: "microempresa", configuredBy: "operator:luis" });
    await expect(s.tax.saveCorporateYear(2026, { ...cfg, expectedVersion: 0 }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    const c = await s.tax.corporate(2026);
    expect(c.config).toMatchObject({ regime: "microempresa" });
    expect(c.configLog).toHaveLength(1);
    // Base previa 8.000 €; reserva de capitalización min(10.000 × 20 %, 8.000 × 25 %) = 2.000 €; base 6.000 € al 20 %
    expect([box(c.draft, "00550"), box(c.draft, "01032"), box(c.draft, "00552"), box(c.draft, "00562")]).toEqual([800_000, 200_000, 600_000, 120_000]);
    expect(c.presets.length).toBe(4);
  });

  it("asiento del sistema, uno vivo por ejercicio, reversión y otro manual con la diferencia y su documento", async () => {
    const s = await withResult();
    await s.tax.saveCorporateYear(2026, { regime: "general", brackets: [{ uptoCents: null, rateBp: 2500 }], netTurnoverCents: null, capReserveEquityIncreaseCents: null, capReserveRateBp: null, capReserveLimitBp: null, levellingReserveCents: null, notes: null }, ACTOR);
    // Base 8.000 € al 25 % = 2.000 € de cuota; 300 € de retenciones en la 473 → 1.700 € a ingresar
    const first = await s.tax.corporateEntry(2026, { origin: "system", date: "2026-12-31" }, ACTOR);
    expect(first.record).toMatchObject({ seq: 1, sourceKey: "tax:200:entry:2026", origin: "system", currentTaxCents: 200_000, withholdingsCents: 30_000, differenceFromDraftCents: 0 });
    const e1 = await s.finance.getEntry(first.record.entryId);
    expect(lines(e1)).toEqual([
      ["6300", 200_000, 0],
      ["473", 0, 30_000],
      ["4752", 0, 170_000],
    ]);
    expect((await s.finance.accounts()).find((a) => a.code === "6300")).toMatchObject({ parentCode: "630", type: "expense" });
    await expect(s.tax.corporateEntry(2026, { origin: "manual", date: "2026-12-31", currentTaxCents: 1 }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    await expect(s.tax.corporateEntry(2026, { origin: "system", date: "2026-12-31", currentTaxCents: 5 }, ACTOR)).rejects.toMatchObject({ code: "conflict" });
    const rev = await s.tax.reverseCorporateEntry(2026, "Importes corregidos por la gestoría", ACTOR);
    expect(rev).toMatchObject({ reversedBy: "operator:luis", reverseReason: "Importes corregidos por la gestoría", reversalEntryId: expect.any(Number) });
    const second = await s.tax.corporateEntry(2026, { origin: "gestoria", date: "2026-12-31", currentTaxCents: 190_000, deferredTaxCents: -5_000, note: "Según el modelo 200 de la gestoría", document: { filename: "modelo-200.pdf", contentBase64: PDF_B64 } }, ACTOR);
    expect(second.record).toMatchObject({ seq: 2, sourceKey: "tax:200:entry:2026:2", differenceFromDraftCents: -10_000, documentId: expect.any(Number) });
    expect(await s.ops.documents("tax_200_entry", second.record.id)).toEqual([expect.objectContaining({ id: second.record.documentId, filename: "modelo-200.pdf", mime: "application/pdf" })]);
    await expect(s.ops.uploadDocument({ ownerType: "tax_200_entry", ownerId: 999, filename: "x.pdf", contentBase64: PDF_B64 }, ACTOR)).rejects.toMatchObject({ code: "not_found" });
    const e2 = await s.finance.getEntry(second.record.entryId);
    expect(lines(e2)).toEqual([
      ["6300", 190_000, 0],
      ["473", 0, 30_000],
      ["4752", 0, 160_000],
      ["4740", 5_000, 0],
      ["6301", 0, 5_000],
    ]);
    expect((await s.finance.accounts()).filter((a) => ["474", "4740", "6301"].includes(a.code)).map((a) => a.code).sort()).toEqual(["474", "4740", "6301"]);
    const c = await s.tax.corporate(2026);
    expect(c.entries.map((e) => [e.seq, e.reversedAt === null])).toEqual([
      [1, false],
      [2, true],
    ]);
    // Retenciones por encima del saldo de la 473: se salda solo el saldo y se avisa
    await s.tax.reverseCorporateEntry(2026, "Otra corrección", ACTOR);
    const third = await s.tax.corporateEntry(2026, { origin: "manual", date: "2026-12-31", currentTaxCents: 100_000, withholdingsAndPaymentsCents: 50_000 }, ACTOR);
    expect(third.record.withholdingsCents).toBe(30_000);
    expect(third.warnings.join(" ")).toMatch(/superan el saldo de la 473/);
  });
});

describe("naturalezas de las comisiones bancarias y configuración del análisis", () => {
  it("cuenta por naturaleza (configurable, grupo 6) al conciliar un movimiento sin gasto; trazada en la descripción", async () => {
    const s = await fiscalScenario();
    expect(await s.analysis.analysisSettings()).toMatchObject({ stripeFeesTreatment: "direct_cost", bankFeeAccounts: { servicio: "626", cobro: "626", financiera: "669", intereses: "662", custodia: "626" } });
    await expect(s.analysis.saveAnalysisSettings({ bankFeeAccounts: { financiera: "705" } }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const saved = await s.analysis.saveAnalysisSettings({ stripeFeesTreatment: "financial", bankFeeAccounts: { custodia: "669" } }, ACTOR);
    expect(saved).toMatchObject({ stripeFeesTreatment: "financial", bankFeeAccounts: { custodia: "669", servicio: "626" }, configuredBy: "operator:luis" });
    const MAPPING = { delimiter: ";" as const, headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd" as const, decimal: "," as const };
    await s.ops.importStatement({ bankAccountId: s.bank.id, format: "csv", filename: "extracto.csv", contentBase64: b64(["Fecha;Importe;Concepto", "2026-10-29;-3,50;COMISION CUSTODIA", "2026-10-30;-12,00;INTERESES DESCUBIERTO"].join("\n")), mapping: MAPPING }, ACTOR);
    const movs = (await s.ops.movements({ bankAccountId: s.bank.id, limit: 50 })).items;
    const custody = await s.ops.match(movs.find((m) => m.amountCents === -350)!.id, { type: "other", nature: "custodia" }, ACTOR);
    const interest = await s.ops.match(movs.find((m) => m.amountCents === -1_200)!.id, { type: "other", nature: "intereses", description: "Intereses del descubierto" }, ACTOR);
    const ec = await s.finance.getEntry(custody.entryId!);
    expect(lines(ec)).toEqual([
      [s.bank.accountCode, 0, 350],
      ["669", 350, 0],
    ]);
    expect(ec.description).toMatch(/naturaleza: custodia o mantenimiento/);
    expect((await s.finance.getEntry(interest.entryId!)).lines.find((l) => l.accountCode === "662")).toMatchObject({ debitCents: 1_200, description: "Intereses del descubierto · naturaleza: intereses" });
    expect((s.ledger as MemoryFinanceStore).audit.find((a) => a.action === "bank_movement.match" && a.summary?.nature === "custodia")?.summary).toMatchObject({ accountCode: "669" });
    // El análisis lleva las comisiones de Stripe y los 66x al resultado financiero
    const rm = await s.analysis.revenueMargin(2026);
    expect(rm.stripeFeesTreatment).toBe("financial");
    expect(rm.months[9].financialCostsCents).toBe(1_550);
  });

  it("sin la migración 0039 la naturaleza no está disponible y el análisis usa los valores por defecto", async () => {
    const s = await fiscalScenario({ fiscal: false });
    await expect(s.analysis.saveAnalysisSettings({ stripeFeesTreatment: "structure" }, ACTOR)).rejects.toMatchObject({ code: "unavailable" });
    const MAPPING = { delimiter: ";" as const, headerRows: 1, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd" as const, decimal: "," as const };
    await s.ops.importStatement({ bankAccountId: s.bank.id, format: "csv", filename: "e.csv", contentBase64: b64(["Fecha;Importe;Concepto", "2026-10-29;-3,50;COMISION"].join("\n")), mapping: MAPPING }, ACTOR);
    const m = (await s.ops.movements({ bankAccountId: s.bank.id, limit: 5 })).items[0];
    await expect(s.ops.match(m.id, { type: "other", nature: "servicio" }, ACTOR)).rejects.toMatchObject({ code: "unavailable" });
    expect((await s.analysis.daily("2026-10-31")).counts).not.toHaveProperty("stripeFeeVatUnset");
  });
});
