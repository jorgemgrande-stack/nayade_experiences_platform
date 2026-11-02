/**
 * Conciliación bancaria automática por reglas deterministas, con datos SINTÉTICOS con la forma de un extracto de
 * CaixaBank: comisiones, cargos con tarjeta de proveedores, pagos a la AEAT y movimientos que no deben tocarse.
 */
import { describe, expect, it } from "vitest";
import { BankAutoReconciler } from "./bankAutoReconcile";
import { normalizeConcept, ruleFor } from "./bankRules";
import { b64, FISCAL_ACTOR as ACTOR, fiscalScenario } from "./fiscalTestkit";
import type { MemoryFinanceTaxStore } from "./taxStore";

const CSV = [
  "Fecha;Concepto;Importe",
  "05/10/2026;C. 369471107 0410;-3,40",
  "05/10/2026;MANTENIMIENTO TPV;-12,10",
  "05/10/2026;APLAZAM./FRACC.;-232,78",
  "06/10/2026;OPENAI;-21,78",
  "06/10/2026;OPENAI;9,10",
  "07/10/2026;ANTHROPIC CLAUDE;-108,90",
  "08/10/2026;FACEBK K7KZR3Y2;-20,00",
  "09/10/2026;RESTAURANTE TERRA;-33,00",
  "10/10/2026;TRANSFER INMEDIATA;1150,00",
  "20/10/2026;I.V.A. MODELO 303;-210,81",
  "20/10/2026;I.R.P.F. MOD.111;-99,00",
].join("\n");
const MAPPING = { delimiter: ";" as const, headerRows: 1, date: 0, amount: 2, description: 1, balance: null, dateFormat: "dd/mm/yyyy" as const, decimal: "," as const };

async function scenario() {
  const s = await fiscalScenario();
  await s.ops.importStatement({ bankAccountId: s.bank.id, format: "csv", filename: "caixa.csv", contentBase64: b64(CSV), mapping: MAPPING }, ACTOR);
  const rec = new BankAutoReconciler({ ops: s.ops, store: s.opsStore, tax: s.tax, now: () => Date.UTC(2026, 9, 30) });
  return { s, rec };
}

/** Obligación presentada y sin pagar (como la deja el registro de una declaración ya presentada). */
async function presented(s: Awaited<ReturnType<typeof fiscalScenario>>, model: "303" | "111", period: string, cents: number) {
  await s.tax.saveSettings({ hasProfessionalWithholdings: true }, ACTOR);
  await s.tax.generateCalendar(2026, ACTOR);
  const o = (await s.tax.listObligations({ year: 2026, model, limit: 50 })).items.find((x) => x.period === period)!;
  await (s.taxStore as MemoryFinanceTaxStore).transition(o.id, [o.status], "presentado", { presentedOn: "2026-10-08", presentedAmountCents: cents, amountCents: cents, outcome: "a_ingresar", receiptRef: "JUST-SINTETICO" }, Date.UTC(2026, 9, 8));
  return o.id;
}

describe("reglas de conciliación", () => {
  it("concepto exacto y signo: nada por parecido de texto", () => {
    expect(normalizeConcept("  c. 369471107   0410 ")).toBe("C. 369471107 0410");
    expect(ruleFor({ description: "C. 369471107 0410", amountCents: -340 })?.code).toBe("caixabank.tpv_commission");
    expect(ruleFor({ description: "OPENAI", amountCents: -2178 })?.code).toBe("supplier.openai");
    // Devolución de un proveedor: no es un cargo, se queda pendiente
    expect(ruleFor({ description: "OPENAI", amountCents: 910 })).toBeNull();
    expect(ruleFor({ description: "OPENAI IRELAND REFUND", amountCents: -100 })).toBeNull();
    expect(ruleFor({ description: "RESTAURANTE TERRA", amountCents: -3300 })).toBeNull();
    expect(ruleFor({ description: "TRANSFER INMEDIATA", amountCents: 115_000 })).toBeNull();
  });
});

describe("conciliación bancaria automática", () => {
  it("simulación sin escrituras; después aplica solo lo inequívoco y deja el resto pendiente", async () => {
    const { s, rec } = await scenario();
    const entries = (await s.finance.listEntries({ limit: 500 })).total;
    const dry = await rec.run(ACTOR, { dryRun: true });
    expect(dry).toMatchObject({ scanned: 11, proposed: 8, applied: 0, unmatched: 3 });
    expect((await s.finance.listEntries({ limit: 500 })).total).toBe(entries);

    const r = await rec.run(ACTOR);
    // Sin obligaciones ni aplazamiento registrados, los pagos a la AEAT esperan (no se inventa su contrapartida)
    expect(r).toMatchObject({ scanned: 11, applied: 5, skipped: 3, errors: 0, unmatched: 3 });
    expect(r.items.filter((i) => i.outcome === "skipped").map((i) => i.rule).sort()).toEqual(["aeat.deferral", "aeat.irpf_111", "aeat.vat_303"]);
    const pending = (await s.opsStore.listMovements({ status: "pending", limit: 50 })).items.map((m) => m.description).sort();
    expect(pending).toEqual(["APLAZAM./FRACC.", "I.R.P.F. MOD.111", "I.V.A. MODELO 303", "OPENAI", "RESTAURANTE TERRA", "TRANSFER INMEDIATA"]);
    // Comisión: asiento contra 626 por el importe del banco
    const fee = (await s.opsStore.listMovements({ status: "matched", limit: 50 })).items.find((m) => m.description === "C. 369471107 0410")!;
    const e = await s.finance.getEntry(fee.entryId!);
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual(expect.arrayContaining([["626", 340, 0], [s.bank.accountCode, 0, 340]]));
    // Proveedores: gasto pendiente de factura (sin IVA), pagado por banco, y proveedor dado de alta una sola vez
    const charges = (await s.ops.listExpenses({ q: "pendiente de factura", limit: 50 })).items;
    expect(charges.map((x) => [x.supplierName, x.totalCents, x.taxCents, x.paymentStatus, x.kind])).toEqual(
      expect.arrayContaining([
        ["OpenAI", 2178, 0, "paid", "ticket"],
        ["Anthropic", 10_890, 0, "paid", "ticket"],
        ["Meta (Facebook Ads)", 2000, 0, "paid", "ticket"],
      ]),
    );
    expect((await s.opsStore.listSuppliers({ q: "OpenAI" })).items).toHaveLength(1);
    // Fuera de los modelos hasta tener la factura
    expect((await s.tax.receivedRegisterCsv("2026-10-01", "2026-10-31")).csv).not.toContain("pendiente de factura");
    // Idempotente: otra pasada no concilia ni crea nada más
    const n = (await s.finance.listEntries({ limit: 500 })).total;
    expect(await rec.run(ACTOR)).toMatchObject({ applied: 0, skipped: 3, unmatched: 3 });
    expect((await s.finance.listEntries({ limit: 500 })).total).toBe(n);
  });

  it("pagos a la AEAT: contra la obligación presentada con el mismo importe (su asiento) y la cuota de aplazamiento con principal e intereses", async () => {
    const { s, rec } = await scenario();
    const o303 = await presented(s, "303", "3T", 21_081);
    const o111 = await presented(s, "111", "3T", 9_900);
    const o2t = await presented(s, "303", "2T", 50_000);
    const def = await s.tax.createDeferral(
      {
        obligationId: o2t,
        principalCents: 50_000,
        interestCents: 498,
        requestedOn: "2026-07-13",
        reference: "EXP-SINTETICO",
        installments: [
          { n: 1, dueDate: "2026-10-05", amountCents: 23_080, interestCents: 198 },
          { n: 2, dueDate: "2026-11-05", amountCents: 26_920, interestCents: 300 },
        ],
      },
      ACTOR,
    );
    const r = await rec.run(ACTOR);
    expect(r).toMatchObject({ skipped: 0, errors: 0 });
    expect(r.byRule).toMatchObject({ "aeat.vat_303": 1, "aeat.irpf_111": 1, "aeat.deferral": 1 });
    expect((await s.tax.listObligations({ year: 2026, limit: 50 })).items.filter((x) => [o303, o111].includes(x.id)).map((x) => x.status)).toEqual(["pagado", "pagado"]);
    const d = (await s.tax.listDeferrals({})).find((x) => x.id === def.id)!;
    expect(d.installments.map((x) => x.status)).toEqual(["pagada", "pendiente"]);
    // La cuota: principal a la cuenta del modelo e intereses aparte; el movimiento se vincula a ese asiento, sin otro
    const inst = await s.finance.getEntry(d.installments[0].entryId!);
    expect(inst.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual(expect.arrayContaining([["4750", 23_080, 0], ["669", 198, 0], [s.bank.accountCode, 0, 23_278]]));
    const mv = (await s.opsStore.listMovements({ status: "matched", limit: 50 })).items.find((m) => m.description === "APLAZAM./FRACC.")!;
    expect(mv).toMatchObject({ matchType: "tax", matchId: def.id, entryId: null });
    // Desvincular solo deshace el vínculo (el pago sigue en Gestoría con su asiento)
    const before = (await s.finance.listEntries({ limit: 500 })).total;
    await s.ops.unmatch(mv.id, ACTOR);
    expect((await s.finance.listEntries({ limit: 500 })).total).toBe(before);
  });

  it("un cargo desvinculado vuelve a pendiente y revierte su pago; la siguiente pasada no duplica el gasto", async () => {
    const { s, rec } = await scenario();
    await rec.run(ACTOR);
    const mv = (await s.opsStore.listMovements({ status: "matched", limit: 50 })).items.find((m) => m.description === "ANTHROPIC CLAUDE")!;
    await s.ops.unmatch(mv.id, ACTOR);
    expect((await s.opsStore.getMovement(mv.id))!.status).toBe("pending");
    const again = await rec.run(ACTOR);
    expect(again.byRule["supplier.anthropic"]).toBe(1);
    expect((await s.ops.listExpenses({ q: "ANTHROPIC CLAUDE", limit: 50 })).total).toBe(1);
  });
});
