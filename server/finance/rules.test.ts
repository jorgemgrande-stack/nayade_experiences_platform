/**
 * Reglas contables puras (fase 1A): cuadre y rechazos, asiento de factura y de rectificativa con varios tipos de IVA,
 * reversión, regularización, cierre y apertura con saldos conocidos, sumas y saldos, mayor y CSV.
 */
import { describe, expect, it } from "vitest";
import { lineOf, totals } from "../invoicing/rules";
import {
  BOM,
  applyLines,
  balancesOf,
  closingEntry,
  csvText,
  esDate,
  eur,
  invoiceEntry,
  isValidDate,
  journalCsv,
  ledger,
  openingEntry,
  regularizationEntry,
  reversalEntry,
  trialBalance,
  trialBalanceCsv,
  validateEntry,
  type InvoiceForLedger,
} from "./rules";
import { seededPlan } from "./testkit";
import { FinanceError, type Account, type EntryDraft, type PostedLine } from "./types";

const plan = seededPlan();
const ACC = new Map<string, Account>(plan.accounts.map((a, i) => [a.code, { ...a, id: i + 1 }]));
const draft = (lines: EntryDraft["lines"], extra: Partial<EntryDraft> = {}): EntryDraft => ({ journalCode: "GEN", date: "2026-03-15", description: "Prueba", origin: "manual", sourceKey: null, lines, ...extra });
const D = (accountCode: string, c: number) => ({ accountCode, debitCents: c, creditCents: 0 });
const H = (accountCode: string, c: number) => ({ accountCode, debitCents: 0, creditCents: c });
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof FinanceError ? e.code : "other";
  }
  return null;
};

describe("plan sembrado", () => {
  it("lee de la migración las cuentas y diarios del contrato", () => {
    expect(plan.accounts).toHaveLength(58);
    expect(plan.journals.map((j) => j.code)).toEqual(["GEN", "VEN", "COM", "BAN", "CAJ", "STR", "NOM", "IMP", "APE", "REG", "CIE"]);
    expect(ACC.get("5720")).toMatchObject({ parentCode: "572", isPostable: true, type: "asset" });
    expect(ACC.get("572")?.isPostable).toBe(false);
    expect(ACC.get("477")?.type).toBe("liability");
  });
});

describe("validación y cuadre de asientos", () => {
  it("acepta un asiento cuadrado y numera sus líneas", () => {
    const { lines, draft: d } = validateEntry(draft([D("629", 12_100), H("410", 12_100)], { description: "  Hosting  " }), ACC);
    expect(lines.map((l) => [l.lineNo, l.accountCode, l.debitCents, l.creditCents])).toEqual([
      [1, "629", 12_100, 0],
      [2, "410", 0, 12_100],
    ]);
    expect(d.description).toBe("Hosting");
  });

  it("rechaza descuadres, líneas con los dos lados o ninguno, importes a cero y una sola línea", () => {
    expect(codeOf(() => validateEntry(draft([D("629", 100), H("410", 99)]), ACC))).toBe("unbalanced");
    expect(codeOf(() => validateEntry(draft([{ accountCode: "629", debitCents: 100, creditCents: 100 }, H("410", 0)]), ACC))).toBe("unbalanced");
    expect(codeOf(() => validateEntry(draft([D("629", 0), H("410", 0)]), ACC))).toBe("unbalanced");
    expect(codeOf(() => validateEntry(draft([D("629", 100)]), ACC))).toBe("unbalanced");
    expect(codeOf(() => validateEntry(draft([D("629", -100), H("410", -100)]), ACC))).toBe("invalid_input");
    expect(codeOf(() => validateEntry(draft([D("629", 1.5), H("410", 1.5)]), ACC))).toBe("invalid_input");
  });

  it("rechaza cuentas inexistentes, inactivas o de mayor, y fechas imposibles", () => {
    expect(codeOf(() => validateEntry(draft([D("999", 100), H("410", 100)]), ACC))).toBe("invalid_account");
    expect(codeOf(() => validateEntry(draft([D("572", 100), H("410", 100)]), ACC))).toBe("invalid_account");
    const inactive = new Map(ACC);
    inactive.set("629", { ...ACC.get("629")!, active: false });
    expect(codeOf(() => validateEntry(draft([D("629", 100), H("410", 100)]), inactive))).toBe("invalid_account");
    expect(codeOf(() => validateEntry(draft([D("629", 100), H("410", 100)], { date: "2026-02-30" }), ACC))).toBe("invalid_input");
    expect(codeOf(() => validateEntry(draft([D("629", 100), H("410", 100)], { description: "  " }), ACC))).toBe("invalid_input");
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2027-02-29")).toBe(false);
  });
});

const invoice = (o: Partial<InvoiceForLedger> & { lines: InvoiceForLedger["lines"] }): InvoiceForLedger => ({ id: 7, kind: "invoice", status: "issued", number: "EB-2026-00007", issueDate: "2026-04-02", operationDate: "2026-04-01", currency: "EUR", companyId: 31, ...totals(o.lines), ...o });

describe("asiento de factura emitida", () => {
  const lines = [lineOf(1, "Plan Pro", 1, 100_000, 2100), lineOf(2, "Formación", 2, 25_000, 1000), lineOf(3, "Exento", 1, 5_000, 0)];

  it("Debe 430 total · Haber 705 base y 477 cuota por tipo, con fecha de expedición y clave invoice:<id>", () => {
    const e = invoiceEntry(invoice({ lines }));
    expect(e).toMatchObject({ journalCode: "VEN", date: "2026-04-02", origin: "invoice", sourceKey: "invoice:7" });
    expect(e.description).toContain("EB-2026-00007");
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.taxRateBp ?? null])).toEqual([
      ["430", 181_000, 0, null],
      ["705", 0, 100_000, 2100],
      ["705", 0, 50_000, 1000],
      ["705", 0, 5_000, 0],
      ["477", 0, 21_000, 2100],
      ["477", 0, 5_000, 1000],
    ]);
    expect(e.lines.every((l) => l.companyId === 31)).toBe(true);
    const { lines: v } = validateEntry(e, ACC);
    expect(v.reduce((a, l) => a + l.debitCents, 0)).toBe(181_000);
  });

  it("rectificativa (importes negativos): mismas cuentas con debe y haber intercambiados", () => {
    const neg = lines.map((l, i) => lineOf(i + 1, `Rectificación: ${l.concept}`, l.quantity, -l.unitCents, l.taxRateBp));
    const e = invoiceEntry(invoice({ id: 8, kind: "rectification", number: "EBR-2026-00001", lines: neg }));
    expect(e.sourceKey).toBe("invoice:8");
    expect(e.description).toMatch(/^Factura rectificativa EBR-2026-00001/);
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["430", 0, 181_000],
      ["705", 100_000, 0],
      ["705", 50_000, 0],
      ["705", 5_000, 0],
      ["477", 21_000, 0],
      ["477", 5_000, 0],
    ]);
    expect(e.lines[1].taxBaseCents).toBe(-100_000);
    expect(() => validateEntry(e, ACC)).not.toThrow();
  });

  it("una factura rectificada sigue contabilizada; borradores, otras monedas y totales incoherentes no", () => {
    expect(invoiceEntry(invoice({ status: "rectified", lines })).sourceKey).toBe("invoice:7");
    expect(codeOf(() => invoiceEntry(invoice({ status: "draft", lines })))).toBe("invalid_state");
    expect(codeOf(() => invoiceEntry(invoice({ number: null, lines })))).toBe("invalid_state");
    expect(codeOf(() => invoiceEntry(invoice({ currency: "USD", lines })))).toBe("invalid_input");
    expect(codeOf(() => invoiceEntry({ ...invoice({ lines }), totalCents: 1 }))).toBe("invalid_input");
  });
});

describe("reversión", () => {
  it("intercambia debe y haber, conserva cuentas y referencias y enlaza por reverse:<id>", () => {
    const { lines } = validateEntry(draft([{ ...D("629", 5_000), supplierId: 3 }, D("472", 1_050), H("410", 6_050)]), ACC);
    const r = reversalEntry({ id: 41, year: 2026, number: 12, journalCode: "COM", lines }, "2026-05-01", "Factura duplicada");
    expect(r).toMatchObject({ journalCode: "COM", date: "2026-05-01", origin: "reversal", sourceKey: "reverse:41", description: "Reversión del asiento 2026/12: Factura duplicada" });
    expect(r.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.supplierId])).toEqual([
      ["629", 0, 5_000, 3],
      ["472", 0, 1_050, null],
      ["410", 6_050, 0, null],
    ]);
    // Original + reversión = saldos a cero
    const both = applyLines(balancesOf(lines), r.lines);
    expect(Array.from(both.values()).every((v) => v === 0)).toBe(true);
  });
});

describe("regularización, cierre y apertura", () => {
  // Ejercicio con saldos conocidos: ventas 1.000 €, otros ingresos 50 €, servicios 300 €, sueldos 200 € → beneficio 550 €
  const year = [D("430", 121_000), H("705", 100_000), H("477", 21_000), D("572000", 0)].filter((l) => l.debitCents || l.creditCents);
  const lines = [...year, D("572001", 5_000), H("759", 5_000), D("629", 30_000), H("572001", 30_000), D("640", 20_000), H("465", 20_000), D("100", 0)].filter((l) => l.debitCents || l.creditCents);
  const balances = balancesOf(lines);

  it("beneficio: salda 6 y 7 y abona 129", () => {
    const reg = regularizationEntry(2026, balances)!;
    expect(reg).toMatchObject({ journalCode: "REG", date: "2026-12-31", origin: "regularization", sourceKey: "regularization:2026" });
    expect(reg.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["629", 0, 30_000],
      ["640", 0, 20_000],
      ["705", 100_000, 0],
      ["759", 5_000, 0],
      ["129", 0, 55_000],
    ]);
    expect(() => validateEntry(reg, ACC)).not.toThrow();
  });

  it("pérdida: 129 al debe; sin saldos de gestión no hay asiento", () => {
    const loss = regularizationEntry(2026, balancesOf([D("629", 80_000), H("705", 30_000), H("572001", 50_000)]))!;
    expect(loss.lines.at(-1)).toMatchObject({ accountCode: "129", debitCents: 50_000, creditCents: 0 });
    expect(regularizationEntry(2026, balancesOf([D("430", 100), H("100", 100)]))).toBeNull();
  });

  it("cierre salda todo el balance y la apertura lo repone el 1 de enero", () => {
    const afterReg = applyLines(balances, regularizationEntry(2026, balances)!.lines);
    const cie = closingEntry(2026, afterReg)!;
    expect(cie).toMatchObject({ journalCode: "CIE", date: "2026-12-31", origin: "closing", sourceKey: "closing:2026" });
    expect(cie.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([
      ["129", 55_000, 0],
      ["430", 0, 121_000],
      ["465", 20_000, 0],
      ["477", 21_000, 0],
      ["572001", 25_000, 0],
    ]);
    const zero = applyLines(afterReg, cie.lines);
    expect(Array.from(zero.values()).every((v) => v === 0)).toBe(true);
    const ape = openingEntry(2026, cie);
    expect(ape).toMatchObject({ journalCode: "APE", date: "2027-01-01", origin: "opening", sourceKey: "opening:2027" });
    const reopened = applyLines(new Map(), ape.lines);
    expect(reopened.get("430")).toBe(121_000);
    expect(reopened.get("129")).toBe(-55_000);
    expect(reopened.get("572001")).toBe(-25_000);
    expect(closingEntry(2026, zero)).toBeNull();
    expect(codeOf(() => closingEntry(2026, balances))).toBe("invalid_state");
  });
});

const posted = (entryId: number, number: number, date: string, l: { accountCode: string; debitCents: number; creditCents: number }, lineNo = 1): PostedLine => ({ ...l, lineNo, entryId, year: Number(date.slice(0, 4)), number, date, journalCode: "GEN", origin: "manual", entryDescription: `Asiento ${number}`, description: null, costCenterId: null, supplierId: null, companyId: null, taxRateBp: null, taxBaseCents: null });

describe("sumas y saldos, mayor", () => {
  const lines = [posted(1, 1, "2026-01-10", D("430", 12_100)), posted(1, 1, "2026-01-10", H("705", 10_000), 2), posted(1, 1, "2026-01-10", H("477", 2_100), 3), posted(2, 2, "2026-02-01", H("430", 12_100)), posted(2, 2, "2026-02-01", D("570", 12_100), 2)];

  it("sumas y saldos por cuenta con totales cuadrados", () => {
    const tb = trialBalance(lines, ACC);
    expect(tb.items.map((r) => [r.code, r.debitCents, r.creditCents, r.balanceCents])).toEqual([
      ["430", 12_100, 12_100, 0],
      ["477", 0, 2_100, -2_100],
      ["570", 12_100, 0, 12_100],
      ["705", 0, 10_000, -10_000],
    ]);
    expect(tb.totals).toEqual({ debitCents: 24_200, creditCents: 24_200, debitBalanceCents: 12_100, creditBalanceCents: 12_100 });
  });

  it("mayor con saldo anterior y saldo acumulado en orden de fecha y número", () => {
    const before = [D("430", 5_000)];
    const l = ledger(before, lines.filter((x) => x.accountCode === "430").reverse());
    expect(l.openingCents).toBe(5_000);
    expect(l.items.map((r) => [r.entryNumber, r.debitCents, r.creditCents, r.balanceCents])).toEqual([
      [1, 12_100, 0, 17_100],
      [2, 0, 12_100, 5_000],
    ]);
    expect(l.closingCents).toBe(5_000);
  });

  it("CSV: BOM, punto y coma, euros con coma decimal y celdas sin fórmulas", () => {
    expect(eur(123_456)).toBe("1234,56");
    expect(eur(-5)).toBe("-0,05");
    expect(eur(0)).toBe("0,00");
    expect(esDate("2026-01-09")).toBe("09/01/2026");
    expect(csvText('Pago; "urgente"')).toBe('"Pago; ""urgente"""');
    expect(csvText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    const csv = journalCsv(lines, ACC);
    expect(csv.startsWith(BOM)).toBe(true);
    const rows = csv.slice(1).trim().split("\r\n");
    expect(rows[0]).toBe("Ejercicio;Asiento;Fecha;Diario;Descripción;Cuenta;Nombre de la cuenta;Debe;Haber;Concepto");
    expect(rows[1]).toBe("2026;1;10/01/2026;GEN;Asiento 1;430;Clientes;121,00;0,00;");
    expect(rows).toHaveLength(6);
    const tb = trialBalanceCsv(trialBalance(lines, ACC)).slice(1).trim().split("\r\n");
    expect(tb[0]).toBe("Cuenta;Nombre;Sumas debe;Sumas haber;Saldo deudor;Saldo acreedor");
    expect(tb.at(-1)).toBe(";Totales;242,00;242,00;121,00;121,00");
  });
});
