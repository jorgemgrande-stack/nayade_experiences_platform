/**
 * Contabilidad general — reglas puras: cuadre, signos (abonos y devoluciones), IVA repercutido y soportado (deducible
 * parcial, retención, nóminas), cobros por método, caja, idempotencia de la generación por documento, reversiones,
 * plan de cuentas, pérdidas y ganancias y exportaciones. Sin BD.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ACC_DEFAULT_MAP, ACC_PGC_SEED } from "../shared/accountingGeneral";
import {
  AccError,
  autoReversalDate,
  cashCloseEntry,
  cashMoveCounterpart,
  cashMoveEntry,
  categoryRole,
  collectionEntry,
  deferLockedDraft,
  desiredOf,
  draftHash,
  expenseAmounts,
  expenseEntry,
  expensePaymentEntry,
  journalCsvOf,
  ledger,
  ledgerCsv,
  planSync,
  pnlItemOf,
  profitAndLoss,
  reversalDraft,
  saleEntry,
  subaccountParent,
  trialBalance,
  validateDraft,
  voidTicketCashEntry,
  workbookXlsx,
  type AccAccount,
  type AccDraft,
  type CashMoveKind,
  type Desired,
  type ExpenseDoc,
  type SaleDoc,
} from "./accountingGeneral/rules";
import { expenseDocOf, keyInGroups, taxConfirmationMatches } from "./accountingGeneral/sources";
import type { PostedLine } from "./finance/types";

const map = ACC_DEFAULT_MAP;
const accounts = new Map<string, AccAccount>(ACC_PGC_SEED.map((a) => [a.code, { code: a.code, name: a.name, type: a.type, parentCode: null, isPostable: true, active: true }]));
const sums = (d: AccDraft) => d.lines.reduce((a, l) => ({ d: a.d + l.debitCents, c: a.c + l.creditCents }), { d: 0, c: 0 });
const side = (d: AccDraft, code: string) => d.lines.filter((l) => l.accountCode === code).reduce((a, l) => a + l.debitCents - l.creditCents, 0);

const invoice: SaleDoc = {
  kind: "factura",
  id: 7,
  number: "F-2026-0007",
  date: "2026-03-10",
  clientName: "Cliente SL",
  rectifies: "",
  byRate: [
    { rateBp: 2100, baseCents: 10000, taxCents: 2100 },
    { rateBp: 1000, baseCents: 5000, taxCents: 500 },
  ],
  totalCents: 17600,
};

describe("ventas: facturas, abonos y tickets", () => {
  it("factura: Debe 430 total · Haber 700 base por tipo · Haber 477 cuota por tipo, y cuadra", () => {
    const d = saleEntry(invoice, map)!;
    expect(d.journal).toBe("VEN");
    expect(d.origin).toBe("invoice");
    expect(side(d, "430")).toBe(17600);
    expect(side(d, "700")).toBe(-15000);
    expect(side(d, "477")).toBe(-2600);
    expect(d.lines.filter((l) => l.accountCode === "477").map((l) => l.taxRateBp)).toEqual([2100, 1000]);
    expect(sums(d).d).toBe(sums(d).c);
    expect(validateDraft(d, accounts)).toHaveLength(5);
  });

  it("abono (importes negativos): las mismas cuentas con debe y haber intercambiados", () => {
    const d = saleEntry({ ...invoice, kind: "abono", number: "A-1", rectifies: "F-2026-0007", byRate: invoice.byRate.map((b) => ({ ...b, baseCents: -b.baseCents, taxCents: -b.taxCents })), totalCents: -17600 }, map)!;
    expect(side(d, "430")).toBe(-17600);
    expect(side(d, "700")).toBe(15000);
    expect(side(d, "477")).toBe(2600);
    expect(d.description).toContain("rectifica F-2026-0007");
    for (const l of d.lines) expect(l.debitCents > 0 !== l.creditCents > 0).toBe(true);
  });

  it("parte no sujeta (REAV, exenta sin desglose): al haber de ventas, el asiento sigue cuadrando al céntimo", () => {
    const d = saleEntry({ ...invoice, byRate: [{ rateBp: 2100, baseCents: 1000, taxCents: 210 }], totalCents: 5001 }, map)!;
    expect(side(d, "700")).toBe(-(1000 + 3791));
    expect(sums(d).d).toBe(5001);
    expect(sums(d).c).toBe(5001);
  });

  it("ticket ya cobrado: el debe va a la caja y a tarjeta por cada cobro; lo no cubierto, a clientes", () => {
    const t: SaleDoc = { kind: "ticket", id: 3, number: "T-3", date: "2026-03-11", clientName: "", rectifies: "", byRate: [{ rateBp: 2100, baseCents: 1000, taxCents: 210 }], totalCents: 1210, payments: [{ method: "cash", cents: 500 }, { method: "card", cents: 410 }, { method: "bizum", cents: 200 }] };
    const d = saleEntry(t, { ...map, card: "572" })!;
    expect(d.origin).toBe("ticket");
    expect(side(d, "570")).toBe(500);
    expect(side(d, "572")).toBe(610);
    expect(side(d, "430")).toBe(100);
    expect(sums(d).d).toBe(sums(d).c);
  });

  it("documento a cero: sin asiento", () => {
    expect(saleEntry({ ...invoice, byRate: [], totalCents: 0 }, map)).toBeNull();
  });
});

describe("cobros", () => {
  it("efectivo a caja (CAJ); transferencia y tarjeta a banco/tarjeta (BAN); contra clientes", () => {
    const cash = collectionEntry({ number: "F-1", date: "2026-03-12", totalCents: 1210, method: "efectivo", clientName: "X" }, map)!;
    expect(cash.journal).toBe("CAJ");
    expect(side(cash, "570")).toBe(1210);
    expect(side(cash, "430")).toBe(-1210);
    const card = collectionEntry({ number: "F-2", date: "2026-03-12", totalCents: 1210, method: "redsys", clientName: "" }, { ...map, card: "5720" })!;
    expect(card.journal).toBe("BAN");
    expect(side(card, "5720")).toBe(1210);
    const tr = collectionEntry({ number: "F-3", date: "2026-03-12", totalCents: 1210, method: "transferencia", clientName: "" }, map)!;
    expect(side(tr, "572")).toBe(1210);
    expect(collectionEntry({ number: "F-4", date: "2026-03-12", totalCents: 0, method: null, clientName: "" }, map)).toBeNull();
  });
});

const expense: ExpenseDoc = {
  id: 11,
  date: "2026-03-05",
  concept: "Alquiler local",
  supplierName: "Inmuebles SA",
  totalCents: 12100,
  taxCents: 2100,
  rateBp: 2100,
  deductibleBp: 10_000,
  retentionCents: 1900,
  payroll: false,
  expenseAccount: "621",
  method: "transfer",
  paidOn: "2026-03-06",
};

describe("gastos y pagos", () => {
  it("gasto: Debe 621 base · Debe 472 cuota · Haber 4751 retención · Haber 410 total − retención", () => {
    const d = expenseEntry(expense, map)!;
    expect(d.journal).toBe("COM");
    expect(side(d, "621")).toBe(10000);
    expect(side(d, "472")).toBe(2100);
    expect(side(d, "4751")).toBe(-1900);
    expect(side(d, "410")).toBe(-10200);
    expect(sums(d).d).toBe(sums(d).c);
    validateDraft(d, accounts);
  });

  it("IVA deducible parcial: la parte no deducible es mayor gasto (redondeo de las corporativas)", () => {
    const a = expenseAmounts({ ...expense, taxCents: 2101, deductibleBp: 5000 });
    expect(a.deductibleTaxCents).toBe(1051);
    expect(a.nonDeductibleTaxCents).toBe(1050);
    const d = expenseEntry({ ...expense, totalCents: 12101, taxCents: 2101, deductibleBp: 5000, retentionCents: 0 }, map)!;
    expect(side(d, "621")).toBe(10000 + 1050);
    expect(side(d, "472")).toBe(1051);
    expect(sums(d).d).toBe(12101);
  });

  it("nómina de RRHH: sin IVA y contra remuneraciones pendientes (465)", () => {
    const d = expenseEntry({ ...expense, payroll: true, expenseAccount: "640", taxCents: 999, retentionCents: 0, totalCents: 150000 }, map)!;
    expect(side(d, "472")).toBe(0);
    expect(side(d, "640")).toBe(150000);
    expect(side(d, "465")).toBe(-150000);
    const p = expensePaymentEntry({ ...expense, payroll: true, retentionCents: 0, totalCents: 150000, taxCents: 0 }, map)!;
    expect(side(p, "465")).toBe(150000);
  });

  it("gasto negativo (devolución del proveedor): sale invertido y cuadra", () => {
    const d = expenseEntry({ ...expense, totalCents: -12100, taxCents: -2100, retentionCents: 1900 }, map)!;
    expect(side(d, "621")).toBe(-10000);
    expect(side(d, "472")).toBe(-2100);
    expect(side(d, "4751")).toBe(1900);
    expect(side(d, "410")).toBe(10200);
  });

  it("pago por método: banco (BAN), efectivo (CAJ) y caja del TPV contra el puente de caja (555)", () => {
    const bank = expensePaymentEntry(expense, map)!;
    expect(bank.journal).toBe("BAN");
    expect(bank.date).toBe("2026-03-06");
    expect(side(bank, "410")).toBe(10200);
    expect(side(bank, "572")).toBe(-10200);
    const cash = expensePaymentEntry({ ...expense, method: "cash" }, map)!;
    expect(cash.journal).toBe("CAJ");
    expect(side(cash, "570")).toBe(-10200);
    const tpv = expensePaymentEntry({ ...expense, method: "tpv_cash" }, map)!;
    expect(side(tpv, "555")).toBe(-10200);
  });
});

describe("caja del TPV", () => {
  it("sobrante: Debe 570 · Haber 778; faltante: Debe 678 · Haber 570; sin descuadre, nada", () => {
    const over = cashCloseEntry({ sessionId: 1, date: "2026-03-01", differenceCents: 250, register: "Caja 1" }, map)!;
    expect(side(over, "570")).toBe(250);
    expect(side(over, "778")).toBe(-250);
    const short = cashCloseEntry({ sessionId: 2, date: "2026-03-01", differenceCents: -300, register: "" }, map)!;
    expect(side(short, "678")).toBe(300);
    expect(side(short, "570")).toBe(-300);
    expect(cashCloseEntry({ sessionId: 3, date: "2026-03-01", differenceCents: 0, register: "" }, map)).toBeNull();
  });
  it("movimientos manuales contra el puente de caja: entrada al debe de caja, salida al haber", () => {
    const i = cashMoveEntry({ id: 1, date: "2026-03-01", type: "in", amountCents: 5000, reason: "Cambio" }, map)!;
    expect(side(i, "570")).toBe(5000);
    expect(side(i, "555")).toBe(-5000);
    const o = cashMoveEntry({ id: 2, date: "2026-03-01", type: "out", amountCents: 2000, reason: "Ingreso en banco" }, map)!;
    expect(side(o, "570")).toBe(-2000);
    expect(side(o, "555")).toBe(2000);
  });

  it("retirada de caja del TPV de tipo gasto (cash_movements + expenses source tpv): la caja se abona una sola vez y sin IVA inventado", () => {
    // Lo que guarda tpv.addCashMovement: el movimiento de salida y un gasto en efectivo con el 21 % por defecto y sin cuota
    const move = cashMoveEntry({ id: 9, date: "2026-03-02", type: "out", amountCents: 3000, reason: "Compra de hielo" }, map)!;
    const row = { id: 50, date: "2026-03-02", concept: "Retirada de caja TPV — Compra de hielo", amount: "30.00", taxRate: "21.00", taxAmount: null, deductiblePercent: "100.00", categoryId: 3, paymentMethod: "cash", source: "tpv", fiscalReviewStatus: "pendiente" };
    const ctx = { map, categoryAccounts: new Map([[3, "600"]]) };
    const doc = expenseDocOf(row, "2026-03-02", undefined, ctx);
    const all = [move, expenseEntry(doc, map)!, expensePaymentEntry(doc, map)!];
    const total = (code: string) => all.reduce((a, d) => a + side(d, code), 0);
    expect(total("570")).toBe(-3000); // una sola salida de caja
    expect(total("555")).toBe(0); // el puente queda saldado
    expect(total("410")).toBe(0);
    expect(total("472")).toBe(0); // sin IVA soportado que no existe
    expect(total("600")).toBe(3000);
    for (const d of all) validateDraft(d, accounts);
    // Revisado en el formulario de gastos: entonces sí lleva su IVA real
    const reviewedRow = { ...row, taxRate: "10.00", taxAmount: "2.73" };
    const reviewed = expenseDocOf(reviewedRow, "2026-03-02", undefined, ctx, { amountCents: 3000, taxRateBp: 1000, taxCents: 273, invoiceType: null });
    expect(side(expenseEntry(reviewed, map)!, "472")).toBe(273);
    expect(side(expensePaymentEntry(reviewed, map)!, "555")).toBe(-3000);
    // Un gasto en efectivo que no viene del TPV sigue saliendo de la caja
    const manual = expenseDocOf({ ...row, source: "manual" }, "2026-03-02", undefined, ctx);
    expect(side(expensePaymentEntry(manual, map)!, "570")).toBe(-3000);
  });

  it("IVA soportado solo confirmado en la contabilidad: ni el 21 % por defecto ni «revisado» del Core bastan", () => {
    const ctx = { map, categoryAccounts: new Map<number, string>() };
    const row = { id: 60, date: "2026-03-02", concept: "Material", amount: "121.00", taxRate: "21.00", taxAmount: null, deductiblePercent: "100.00", categoryId: 1, paymentMethod: "transfer", source: "manual", fiscalReviewStatus: "pendiente" };
    // Sin cuota guardada (taxRate trae el 21 % por defecto): sin IVA
    const none = expenseDocOf(row, "2026-03-02", undefined, ctx);
    expect(none.taxUnknown).toBe(true);
    const e1 = expenseEntry(none, map)!;
    expect(side(e1, "472")).toBe(0);
    expect(side(e1, "629")).toBe(12100);
    expect(e1.lines.find((l) => l.accountCode === "629")!.taxRateBp).toBeNull(); // no se presenta como un 0 % ni un 21 %
    // Cuota estimada por la regularización de gastos antiguos (pendiente de revisar): tampoco
    const estimated = expenseDocOf({ ...row, taxBase: "100.00", taxAmount: "21.00" }, "2026-03-02", undefined, ctx);
    expect(side(expenseEntry(estimated, map)!, "472")).toBe(0);
    // «Revisado» en el Core (el formulario lo marca siempre, también con el 21 % precargado): tampoco
    const coreReviewed = { ...row, amount: "110.00", taxRate: "10.00", taxAmount: "10.00", invoiceType: "ordinaria", fiscalReviewStatus: "revisado" };
    expect(side(expenseEntry(expenseDocOf(coreReviewed, "2026-03-02", undefined, ctx), map)!, "472")).toBe(0);
    // Confirmado en la contabilidad con la factura: su IVA (aquí un 10 %)
    const conf = { amountCents: 11000, taxRateBp: 1000, taxCents: 1000, invoiceType: "ordinaria" };
    const real = expenseDocOf(coreReviewed, "2026-03-02", undefined, ctx, conf);
    expect(real.taxUnknown).toBe(false);
    expect(side(expenseEntry(real, map)!, "472")).toBe(1000);
    // Si el gasto cambia después de confirmarlo (importe, tipo, cuota o tipo de factura), la confirmación deja de valer
    expect(taxConfirmationMatches(conf, coreReviewed)).toBe(true);
    expect(taxConfirmationMatches(conf, { ...coreReviewed, amount: "121.00" })).toBe(false);
    expect(taxConfirmationMatches(conf, { ...coreReviewed, taxAmount: "11.00" })).toBe(false);
    expect(taxConfirmationMatches(conf, { ...coreReviewed, invoiceType: "simplificada" })).toBe(false);
    // Sin factura o exenta: nunca, aunque se hubiera confirmado
    expect(side(expenseEntry(expenseDocOf({ ...coreReviewed, invoiceType: "sin_factura" }, "2026-03-02", undefined, ctx, { ...conf, invoiceType: "sin_factura" }), map)!, "472")).toBe(0);
    // Nóminas de RRHH: sin IVA por naturaleza, no se marcan para revisar
    expect(expenseDocOf({ ...row, source: "hr_payroll" }, "2026-03-02", undefined, ctx).taxUnknown).toBe(false);
  });

  it("ticket devuelto en efectivo (venta revertida + salida manual de caja): la caja no se abona dos veces", () => {
    const sold = saleEntry({ kind: "ticket", id: 4, number: "T-4", date: "2026-03-03", clientName: "", rectifies: "", byRate: [{ rateBp: 2100, baseCents: 10000, taxCents: 2100 }], totalCents: 12100, payments: [{ method: "cash", cents: 12100 }] }, map)!;
    const reversal = reversalDraft({ id: 1, year: 2026, number: 1, journal: sold.journal, lines: validateDraft(sold, accounts) }, "2026-03-03", "devuelto");
    const pending = voidTicketCashEntry({ number: "T-4", date: "2026-03-03", cashCents: 12100 }, map)!;
    const refund = cashMoveEntry({ id: 10, date: "2026-03-03", type: "out", amountCents: 12100, reason: "Devolución T-4" }, map)!;
    const all = [sold, reversal, pending, refund];
    const total = (code: string) => all.reduce((a, d) => a + side(d, code), 0);
    expect(total("570")).toBe(0); // entró y salió una vez
    expect(total("555")).toBe(0);
    expect(total("700")).toBe(0);
    expect(total("477")).toBe(0);
    expect(total("430")).toBe(0);
    validateDraft(pending, accounts);
    expect(voidTicketCashEntry({ number: "T-5", date: "2026-03-03", cashCents: 0 }, map)).toBeNull(); // solo tarjeta: nada
    // Anulado sin salida de efectivo (bono, sin devolución o devolución por transferencia): la caja no se toca y el 555
    // queda a cero; el efectivo queda a favor del cliente en el 430
    const kept = [sold, reversal, pending];
    const keptTotal = (code: string) => kept.reduce((a, d) => a + side(d, code), 0);
    expect(keptTotal("570")).toBe(12100);
    expect(keptTotal("555")).toBe(0);
    expect(keptTotal("430")).toBe(-12100);
  });

  it("cada movimiento manual de la caja, contra su contrapartida real (el 555 solo para el gasto del TPV, que lo salda)", () => {
    const mv = (type: "in" | "out", kind: CashMoveKind | null, reason = "Motivo") => cashMoveEntry({ id: 1, date: "2026-03-03", type, amountCents: 5000, reason, kind }, map)!;
    const other = (d: AccDraft) => d.lines.find((l) => l.accountCode !== "570")!;
    expect(other(mv("out", "traspaso")).accountCode).toBe("5701"); // a la Caja Central
    expect(side(mv("out", "traspaso"), "5701")).toBe(5000);
    expect(other(mv("in", "fondo")).accountCode).toBe("5701"); // fondo desde la Caja Central
    expect(side(mv("in", "fondo"), "570")).toBe(5000);
    expect(other(mv("out", "devolucion")).accountCode).toBe("430");
    expect(other(mv("in", "cobro")).accountCode).toBe("430");
    expect(other(mv("out", "gasto")).accountCode).toBe("555");
    // Sin tipo: una devolución por su motivo, contra clientes; lo demás, al puente (pendiente de aplicar)
    expect(other(mv("out", null, "Devolución efectivo")).accountCode).toBe("430");
    expect(other(mv("out", null, "Ingreso en banco")).accountCode).toBe("555");
    // El motivo NUNCA pisa el tipo elegido: «Reembolso de gasolina» como gasto sigue siendo gasto
    expect(other(mv("out", "gasto", "Reembolso de gasolina")).accountCode).toBe("555");
    expect(other(mv("out", "gasto", "Devolución de fianza")).accountCode).toBe("555");
    // Entrada sin tipo: al puente (para revisar), nunca a la Caja Central
    expect(other(mv("in", null, "Fondo adicional")).accountCode).toBe("555");
    expect(cashMoveCounterpart({ type: "out", reason: "Refund ticket", kind: null }, map)).toBe("430");
    expect(cashMoveCounterpart({ type: "out", reason: "Abono al cliente", kind: null }, map)).toBe("430");
    // Fianzas del alquiler: contra fianzas recibidas (560), aunque el motivo diga «Devolución»; cobro y devolución se saldan
    expect(cashMoveCounterpart({ type: "out", reason: "Devolución fianza alquiler #7", kind: "fianza" }, map)).toBe("560");
    const deposit = [mv("in", "fianza", "Fianza alquiler #7"), mv("out", "fianza", "Devolución fianza alquiler #7")];
    expect(deposit.reduce((a, d) => a + side(d, "560") + side(d, "570") + side(d, "555") + side(d, "430"), 0)).toBe(0);
    expect(side(deposit[0], "560")).toBe(-5000);
    for (const d of deposit) validateDraft(d, accounts);
    expect(cashMoveCounterpart({ type: "out", reason: "Reembolso cliente", kind: null }, map)).toBe("430");
    for (const d of [mv("out", "traspaso"), mv("in", "fondo"), mv("out", "devolucion"), mv("in", "cobro")]) validateDraft(d, accounts);
    // Traspaso y vuelta del fondo: la caja y la Caja Central quedan como estaban, y nada pasa por el 555
    const pair = [mv("out", "traspaso"), mv("in", "fondo")];
    expect(pair.reduce((a, d) => a + side(d, "570") + side(d, "5701") + side(d, "555"), 0)).toBe(0);
  });
});

describe("validación: partida doble", () => {
  const base: AccDraft = { journal: "GEN", date: "2026-01-01", description: "Apertura", origin: "manual", lines: [{ accountCode: "572", debitCents: 1000, creditCents: 0 }, { accountCode: "100", debitCents: 0, creditCents: 1000 }] };
  it("cuadra: líneas numeradas", () => {
    expect(validateDraft(base, accounts).map((l) => l.lineNo)).toEqual([1, 2]);
  });
  it("no cuadra, línea en los dos lados, cuenta inexistente o inactiva, fecha mala: rechazado con su motivo", () => {
    const bad = (d: Partial<AccDraft>) => () => validateDraft({ ...base, ...d }, accounts);
    expect(bad({ lines: [{ accountCode: "572", debitCents: 1000, creditCents: 0 }, { accountCode: "100", debitCents: 0, creditCents: 999 }] })).toThrow(/no cuadra/);
    expect(bad({ lines: [{ accountCode: "572", debitCents: 1000, creditCents: 1000 }, { accountCode: "100", debitCents: 0, creditCents: 0 }] })).toThrow(AccError);
    expect(bad({ lines: [{ accountCode: "999", debitCents: 1000, creditCents: 0 }, { accountCode: "100", debitCents: 0, creditCents: 1000 }] })).toThrow(/no existe/);
    expect(() => validateDraft(base, new Map([...accounts, ["100", { ...accounts.get("100")!, active: false }]]))).toThrow(/inactiva/);
    expect(bad({ date: "2026-02-30" })).toThrow(/fecha/);
    expect(bad({ lines: [base.lines[0]] })).toThrow(/dos líneas/);
  });
});

describe("generación idempotente por documento", () => {
  const d1 = saleEntry(invoice, map)!;
  it("primera vez crea; con la misma huella no hace nada (repetir nunca duplica)", () => {
    const desired = new Map<string, Desired>([["inv:7", { kind: "entry", draft: d1 }]]);
    const first = planSync(desired, new Map());
    expect(first).toEqual([expect.objectContaining({ type: "create", key: "inv:7" })]);
    const again = planSync(desired, new Map([["inv:7", { entryId: 1, hash: draftHash(d1) }]]));
    expect(again).toEqual([]);
  });
  it("el documento cambió: sustituye (revertir y contabilizar el nuevo); la descripción sola no cuenta", () => {
    const changed = saleEntry({ ...invoice, totalCents: 17700, byRate: [{ rateBp: 2100, baseCents: 10100, taxCents: 2100 }, invoice.byRate[1]] }, map)!;
    const s = new Map([["inv:7", { entryId: 1, hash: draftHash(d1) }]]);
    expect(planSync(new Map([["inv:7", { kind: "entry", draft: changed }]]), s)).toEqual([expect.objectContaining({ type: "replace", entryId: 1 })]);
    expect(planSync(new Map([["inv:7", { kind: "entry", draft: { ...d1, description: "otra" } }]]), s)).toEqual([]);
  });
  it("anulado o devuelto (none) y documento desaparecido: revertir; keep y ya revertido: nada", () => {
    const s = new Map([["inv:7", { entryId: 1, hash: "x" }], ["gasto:2", { entryId: 2, hash: "y" }], ["cobro:9", { entryId: 3, hash: "z" }], ["tpv:1", { entryId: null, hash: null }]]);
    const a = planSync(new Map<string, Desired>([["inv:7", { kind: "none" }], ["cobro:9", { kind: "keep" }], ["tpv:1", { kind: "none" }]]), s);
    expect(a.map((x) => [x.type, x.key])).toEqual([["reverse", "gasto:2"], ["reverse", "inv:7"]]);
  });
  it("creaciones en orden de fecha (numeración cronológica)", () => {
    const later = { ...d1, date: "2026-05-01" };
    const a = planSync(new Map<string, Desired>([["inv:9", { kind: "entry", draft: later }], ["inv:7", { kind: "entry", draft: d1 }]]), new Map());
    expect(a.map((x) => x.key)).toEqual(["inv:7", "inv:9"]);
  });
  it("las claves solo se revierten si su grupo se leyó", () => {
    expect(keyInGroups("inv:1", ["sales"])).toBe(true);
    expect(keyInGroups("pago:1", ["sales"])).toBe(false);
    expect(keyInGroups("pago:1", ["expenses"])).toBe(true);
  });

  it("cambiar una cuenta en Ajustes o la de una categoría no vuelve a contabilizar el histórico (solo hacia adelante)", () => {
    const ticket: SaleDoc = { kind: "ticket", id: 3, number: "T-3", date: "2026-03-01", clientName: "", rectifies: "", byRate: [{ rateBp: 2100, baseCents: 1000, taxCents: 210 }], totalCents: 1210, payments: [{ method: "card", cents: 1210 }] };
    const before = desiredOf((m) => saleEntry(ticket, m), map);
    const moved = { ...map, card: "57200001", sales: "705", vatOutput: "4770" };
    const after = desiredOf((m) => saleEntry(ticket, m), moved);
    if (before.kind !== "entry" || after.kind !== "entry") throw new Error("sin asiento");
    expect(after.draft.lines.map((l) => l.accountCode)).toContain("57200001"); // lo nuevo, con la cuenta nueva
    expect(after.hash).toBe(before.hash);
    expect(planSync(new Map([["tpv:3", after]]), new Map([["tpv:3", { entryId: 5, hash: before.hash! }]]))).toEqual([]);
    // Categoría de gasto: la huella va con la categoría, no con su cuenta
    const g = (account: string) => desiredOf((m, roles) => expenseEntry({ ...expense, expenseAccount: roles ? categoryRole(4) : account }, m), map);
    expect((g("629") as any).hash).toBe((g("623") as any).hash);
    // El documento sí cambia: otro método de cobro, otro importe u otra categoría
    expect((desiredOf((m) => saleEntry({ ...ticket, payments: [{ method: "cash", cents: 1210 }] }, m), map) as any).hash).not.toBe(before.hash);
    expect((desiredOf((m) => saleEntry({ ...ticket, totalCents: 1331, byRate: [{ rateBp: 2100, baseCents: 1100, taxCents: 231 }] }, m), map) as any).hash).not.toBe(before.hash);
    expect((desiredOf((m, roles) => expenseEntry({ ...expense, expenseAccount: roles ? categoryRole(5) : "629" }, m), map) as any).hash).not.toBe((g("629") as any).hash);
  });

  it("documento nuevo o cambiado de un periodo bloqueado: al primer día abierto (no queda bloqueado en cada generación)", () => {
    const d = saleEntry(invoice, map)!;
    const moved = deferLockedDraft(d, "2026-03-31", "2026-04-15")!;
    expect(moved.date).toBe("2026-04-15");
    expect(moved.description).toContain("10/03/2026");
    expect(moved.lines).toEqual(d.lines);
    expect(deferLockedDraft(d, "2026-02-28", "2026-04-15")).toBe(d); // no bloqueado: tal cual
    expect(deferLockedDraft(d, "2026-04-30", "2026-04-15")).toBeNull(); // hoy también bloqueado: espera
  });
});

describe("reversiones", () => {
  it("debe y haber intercambiados, mismo diario, enlaza el número", () => {
    const lines = validateDraft(saleEntry(invoice, map)!, accounts);
    const r = reversalDraft({ id: 5, year: 2026, number: 12, journal: "VEN", lines }, "2026-04-01", "el documento cambió");
    expect(r.origin).toBe("reversal");
    expect(r.description).toContain("2026/12");
    expect(r.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual(lines.map((l) => [l.accountCode, l.creditCents, l.debitCents]));
  });
  it("fecha automática: la del asiento si no está bloqueada; si lo está, hoy; si hoy también, ninguna", () => {
    expect(autoReversalDate("2026-03-10", null, "2026-06-01")).toBe("2026-03-10");
    expect(autoReversalDate("2026-03-10", "2026-03-31", "2026-06-01")).toBe("2026-06-01");
    expect(autoReversalDate("2026-03-10", "2026-12-31", "2026-06-01")).toBeNull();
  });
});

describe("plan de cuentas", () => {
  it("subcuenta: hereda de la cuenta de prefijo más largo; duplicada o sin cuenta, rechazada", () => {
    expect(subaccountParent("57200001", accounts).code).toBe("572");
    expect(subaccountParent("47510001", accounts).code).toBe("4751");
    expect(() => subaccountParent("572", accounts)).toThrow(/4 a 12/);
    expect(() => subaccountParent("4751", accounts)).toThrow(/ya existe/);
    expect(() => subaccountParent("99900001", accounts)).toThrow(/No hay ninguna cuenta/);
  });
});

describe("pérdidas y ganancias (modelo de pymes)", () => {
  it("partidas por prefijo y resultados", () => {
    expect(pnlItemOf("700")).toBe("p1");
    expect(pnlItemOf("70500001")).toBe("p1");
    expect(pnlItemOf("640")).toBe("p6");
    expect(pnlItemOf("621")).toBe("p7");
    expect(pnlItemOf("678")).toBe("p12");
    expect(pnlItemOf("662")).toBe("p14");
    expect(pnlItemOf("630")).toBe("p18");
    expect(pnlItemOf("572")).toBeNull();
    const p = profitAndLoss(
      [
        { accountCode: "700", debitCents: 0, creditCents: 100000 },
        { accountCode: "621", debitCents: 30000, creditCents: 0 },
        { accountCode: "640", debitCents: 40000, creditCents: 0 },
        { accountCode: "662", debitCents: 1000, creditCents: 0 },
        { accountCode: "630", debitCents: 5000, creditCents: 0 },
        { accountCode: "430", debitCents: 999999, creditCents: 0 },
      ],
      new Map([["700", "Ventas"]]),
    );
    expect(p.items.find((i) => i.key === "p1")!.cents).toBe(100000);
    expect(p.operatingCents).toBe(30000);
    expect(p.financialCents).toBe(-1000);
    expect(p.beforeTaxCents).toBe(29000);
    expect(p.resultCents).toBe(24000);
  });
});

describe("exportaciones para la gestoría", () => {
  const lines = validateDraft(saleEntry(invoice, map)!, accounts);
  const posted: PostedLine[] = lines.map((l) => ({ ...l, entryId: 1, year: 2026, number: 1, date: "2026-03-10", journalCode: "VEN", origin: "manual", entryDescription: "Factura F-2026-0007" }));
  const names = new Map(Array.from(accounts, ([c, a]) => [c, a.name]));
  it("diario CSV con BOM, «;» y euros con coma; sumas y saldos cuadran", () => {
    const csv = journalCsvOf(posted, names);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("2026;1;10/03/2026;VEN;Factura F-2026-0007;430;Clientes;176,00;0,00");
    const tb = trialBalance(posted, accounts);
    expect(tb.totals.debitCents).toBe(tb.totals.creditCents);
  });
  it("mayor CSV con saldo anterior y acumulado", () => {
    const l = ledger([{ debitCents: 500, creditCents: 0 }], posted.filter((x) => x.accountCode === "430"));
    const csv = ledgerCsv({ code: "430", name: "Clientes" }, l);
    expect(csv).toContain("Saldo anterior 430 Clientes");
    expect(csv).toContain("181,00");
  });
  it("Excel con diario, sumas y saldos y pérdidas y ganancias (importes numéricos en euros)", () => {
    const buf = workbookXlsx({ title: "Contabilidad", from: "2026-01-01", to: "2026-12-31", journal: posted, names, trial: trialBalance(posted, accounts), pnl: profitAndLoss(posted, names) });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Diario", "Sumas y saldos", "Pérdidas y ganancias"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Diario, { header: 1 });
    expect(rows[4]).toEqual(expect.arrayContaining([2026, 1, "10/03/2026", "VEN", "430", 176]));
  });
});
