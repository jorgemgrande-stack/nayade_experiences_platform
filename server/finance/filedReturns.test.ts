/**
 * Declaraciones ya presentadas por la gestoría que se registran a posteriori con los importes DECLARADOS (sin borrador
 * calculado): 303 a ingresar (con su liquidación), 303 aplazado con el calendario oficial y 111. Y la conciliación de
 * sus pagos con el extracto. Datos SINTÉTICOS con la forma de un caso real.
 */
import { describe, expect, it } from "vitest";
import { BankAutoReconciler } from "./bankAutoReconcile";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario } from "./fiscalTestkit";

async function scenario() {
  const s = await fiscalScenario();
  await s.tax.saveSettings({ hasProfessionalWithholdings: true }, ACTOR);
  await s.tax.generateCalendar(2026, ACTOR);
  const ob = async (model: string, period: string) => (await s.tax.listObligations({ year: 2026, limit: 100 })).items.find((x) => x.model === model && x.period === period)!;
  return { s, ob };
}

describe("declaraciones presentadas fuera del sistema", () => {
  it("303 a ingresar: presentado con justificante, importes declarados y su liquidación (477/472/4750); sin ingresos ni gastos", async () => {
    const { s, ob } = await scenario();
    const o = await ob("303", "3T");
    const expensesBefore = (await s.ops.listExpenses({ limit: 10 })).total;
    const r = await s.tax.registerFiled(o.id, { presentedOn: "2026-10-08", receiptNumber: "3030000000001", resultCents: 21_081, outcome: "a_ingresar", vat: { salesBaseCents: 761_158, outputVatCents: 159_842, purchasesBaseCents: 1_347_950, inputVatCents: 138_761 } }, ACTOR);
    expect(r).toMatchObject({ status: "presentado", presentedOn: "2026-10-08", receiptRef: "3030000000001", presentedAmountCents: 21_081, outcome: "a_ingresar" });
    const e = await s.finance.getEntry(r.settlementEntryId!);
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["477", 159_842, 0],
      ["472", 0, 138_761],
      ["4750", 0, 21_081],
    ]);
    expect(e.date).toBe("2026-09-30");
    expect((await s.ops.listExpenses({ limit: 10 })).total).toBe(expensesBefore);
    // No se presenta dos veces
    await expect(s.tax.registerFiled(o.id, { presentedOn: "2026-10-08", receiptNumber: "X", resultCents: 21_081, outcome: "a_ingresar", vat: { salesBaseCents: 0, outputVatCents: 21_081, purchasesBaseCents: 0, inputVatCents: 0 } }, ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("validaciones: el 303 debe cuadrar y el 111 llevar sus retenciones; nada de fechas futuras", async () => {
    const { s, ob } = await scenario();
    const o = await ob("303", "3T");
    await expect(s.tax.registerFiled(o.id, { presentedOn: "2026-10-08", receiptNumber: "J", resultCents: 100, outcome: "a_ingresar", vat: { salesBaseCents: 0, outputVatCents: 500, purchasesBaseCents: 0, inputVatCents: 0 } }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(s.tax.registerFiled(o.id, { presentedOn: "2027-01-01", receiptNumber: "J", resultCents: 500, outcome: "a_ingresar", vat: { salesBaseCents: 0, outputVatCents: 500, purchasesBaseCents: 0, inputVatCents: 0 } }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const o111 = await ob("111", "3T");
    await expect(s.tax.registerFiled(o111.id, { presentedOn: "2026-10-08", receiptNumber: "J", resultCents: 9_900, outcome: "a_ingresar" }, ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
    const r = await s.tax.registerFiled(o111.id, { presentedOn: "2026-10-08", receiptNumber: "1110000000001", resultCents: 9_900, outcome: "a_ingresar", withholding: { recipients: 1, baseCents: 66_000, withheldCents: 9_900 } }, ACTOR);
    expect(r).toMatchObject({ status: "presentado", settlementEntryId: null, presentedAmountCents: 9_900 });
  });

  it("de punta a punta: declaraciones, aplazamiento oficial y extracto → pagos conciliados sin duplicar y cuotas futuras pendientes", async () => {
    const { s, ob } = await scenario();
    const t2 = await ob("303", "2T");
    await s.tax.registerFiled(t2.id, { presentedOn: "2026-07-13", receiptNumber: "3030000000002", resultCents: 276_960, outcome: "a_ingresar", vat: { salesBaseCents: 1_477_078, outputVatCents: 310_186, purchasesBaseCents: 220_016, inputVatCents: 33_226 } }, ACTOR);
    // Calendario sintético de 3 cuotas con intereses exactos (en la realidad, los del documento oficial)
    const def = await s.tax.createDeferral({ obligationId: t2.id, principalCents: 276_960, interestCents: 600, requestedOn: "2026-07-13", reference: "EXP-SINTETICO", installments: [{ n: 1, dueDate: "2026-10-05", amountCents: 23_080, interestCents: 198 }, { n: 2, dueDate: "2026-11-05", amountCents: 23_080, interestCents: 202 }, { n: 3, dueDate: "2026-12-05", amountCents: 230_800, interestCents: 200 }] }, ACTOR);
    await s.tax.registerFiled((await ob("303", "3T")).id, { presentedOn: "2026-10-08", receiptNumber: "3030000000001", resultCents: 21_081, outcome: "a_ingresar", vat: { salesBaseCents: 761_158, outputVatCents: 159_842, purchasesBaseCents: 1_347_950, inputVatCents: 138_761 } }, ACTOR);
    await s.tax.registerFiled((await ob("111", "3T")).id, { presentedOn: "2026-10-08", receiptNumber: "1110000000001", resultCents: 9_900, outcome: "a_ingresar", withholding: { recipients: 1, baseCents: 66_000, withheldCents: 9_900 } }, ACTOR);
    const csv = ["Fecha;Concepto;Importe", "05/10/2026;APLAZAM./FRACC.;-232,78", "20/10/2026;I.R.P.F. MOD.111;-99,00", "20/10/2026;I.V.A. MODELO 303;-210,81"].join("\n");
    await s.ops.importStatement({ bankAccountId: s.bank.id, format: "csv", filename: "e.csv", contentBase64: b64(csv), mapping: { delimiter: ";", headerRows: 1, date: 0, amount: 2, description: 1, balance: null, dateFormat: "dd/mm/yyyy", decimal: "," } }, ACTOR);
    const r = await new BankAutoReconciler({ ops: s.ops, store: s.opsStore, tax: s.tax }).run(ACTOR);
    expect(r).toMatchObject({ applied: 3, skipped: 0, errors: 0, unmatched: 0 });
    const bal = async (code: string) => (await s.ledger.postedLines({})).filter((l) => l.accountCode === code).reduce((a, l) => a + l.debitCents - l.creditCents, 0);
    // 4750: 2.769,60 + 210,81 declarados − 210,81 pagado − 230,80 de principal = lo aplazado pendiente
    expect(await bal("4750")).toBe(-(276_960 - 23_080));
    expect(await bal("4751")).toBe(9_900);
    expect(await bal("669")).toBe(198);
    expect(await bal(s.bank.accountCode)).toBe(-(23_278 + 9_900 + 21_081));
    const d = (await s.tax.listDeferrals({})).find((x) => x.id === def.id)!;
    expect(d.installments.map((x) => x.status)).toEqual(["pagada", "pendiente", "pendiente"]);
    expect((await s.tax.listObligations({ year: 2026, limit: 100 })).items.filter((x) => x.period === "3T" && ["303", "111"].includes(x.model)).map((x) => x.status)).toEqual(["pagado", "pagado"]);
  });
});
