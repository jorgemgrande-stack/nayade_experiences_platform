/**
 * Reglas puras de la fase 1B: cálculo fiscal del gasto, asientos (gasto, rectificativa, pago, banco contra cuenta,
 * caja) que siempre cuadran, recurrentes por periodo, extractos (Norma 43, CaixaBank, CSV), claves de duplicado
 * estables, sugerencias, NIF/IBAN, firma de documentos y subcuentas.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  bankCounterpartEntry,
  bankMovementSourceKey,
  cashEntry,
  decodeText,
  expenseAmounts,
  expenseEntry,
  isValidIban,
  nextOccurrence,
  nextSubaccountCode,
  parseCaixaBankBuffer,
  parseCellAmount,
  parseExcelDate,
  parseImporte,
  parseMappedCsv,
  parseNorma43,
  paymentEntry,
  paymentStatusOf,
  pendingOf,
  recurringOccurrences,
  recurringPeriod,
  safeFilename,
  sniffDocument,
  spanishAccountOfIban,
  suggestMatches,
  taxIdProblem,
  type CsvMapping,
} from "./opsRules";
import type { Expense } from "./opsTypes";
import { sumLines, validateEntry } from "./rules";
import { n43, norma43Sample, seededPlan } from "./testkit";

const { r11, r22, r33, r88 } = n43;
import type { Account } from "./types";

const plan = seededPlan();
const accounts = new Map<string, Account>([...plan.accounts, { code: "57200001", name: "Banco", type: "asset" as const, parentCode: "572", isPostable: true, active: true, createdAt: 0 }, { code: "57000001", name: "Caja", type: "asset" as const, parentCode: "570", isPostable: true, active: true, createdAt: 0 }].map((a, i) => [a.code, { ...a, id: i + 1 }]));
const balanced = (d: Parameters<typeof validateEntry>[0]) => {
  const { lines } = validateEntry(d, accounts);
  const t = sumLines(lines);
  expect(t.debitCents).toBe(t.creditCents);
  return lines.map((l) => [l.accountCode, l.debitCents, l.creditCents]);
};

const expense = (o: Partial<Expense> = {}): Expense => {
  const base = { baseCents: 100_000, taxRateBp: 2100, deductibleBp: 10_000, withholdingRateBp: 0, ...o };
  const a = expenseAmounts(base);
  return {
    id: 7,
    supplierId: 3,
    categoryId: 1,
    costCenterId: 1,
    invoiceNumber: "F-2026-10",
    invoiceDate: "2026-10-05",
    accrualDate: null,
    dueDate: "2026-11-04",
    description: "Servidores octubre",
    taxCents: a.taxCents,
    withholdingCents: a.withholdingCents,
    totalCents: a.totalCents,
    paidCents: 0,
    currency: "EUR",
    kind: "invoice",
    rectifiesExpenseId: null,
    status: "registered",
    entryId: null,
    paymentStatus: "pending",
    sourceKey: null,
    createdBy: "t",
    createdAt: 0,
    registeredBy: null,
    registeredAt: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    ...base,
    ...o,
  } as Expense;
};

describe("cálculo fiscal del gasto", () => {
  it("base, cuota, parte deducible y no deducible, retención, total y a pagar", () => {
    expect(expenseAmounts({ baseCents: 100_000, taxRateBp: 2100, deductibleBp: 10_000, withholdingRateBp: 1500 })).toEqual({ baseCents: 100_000, taxCents: 21_000, deductibleTaxCents: 21_000, nonDeductibleTaxCents: 0, expenseAccountCents: 100_000, withholdingCents: 15_000, totalCents: 121_000, payableCents: 106_000 });
    // 50 % deducible (p. ej. vehículo): la otra mitad de la cuota es más gasto
    expect(expenseAmounts({ baseCents: 10_001, taxRateBp: 2100, deductibleBp: 5000, withholdingRateBp: 0 })).toMatchObject({ taxCents: 2100, deductibleTaxCents: 1050, nonDeductibleTaxCents: 1050, expenseAccountCents: 11_051, totalCents: 12_101 });
  });

  it("rectificativa: la misma factura en negativo (redondeo simétrico)", () => {
    const pos = expenseAmounts({ baseCents: 1_250, taxRateBp: 2100, deductibleBp: 10_000, withholdingRateBp: 700 });
    const neg = expenseAmounts({ baseCents: -1_250, taxRateBp: 2100, deductibleBp: 10_000, withholdingRateBp: 700 });
    for (const k of Object.keys(pos) as Array<keyof typeof pos>) expect(neg[k]).toBe(-pos[k] || 0);
  });

  it("pendiente = total − retención − pagos vigentes; estado de pago", () => {
    const e = expense({ withholdingRateBp: 1500 });
    expect(pendingOf(e)).toBe(106_000);
    expect(pendingOf({ ...e, paidCents: 6_000 })).toBe(100_000);
    expect(pendingOf({ ...e, status: "void" })).toBe(0);
    expect(paymentStatusOf(106_000, 0)).toBe("pending");
    expect(paymentStatusOf(106_000, 50)).toBe("partial");
    expect(paymentStatusOf(106_000, 106_000)).toBe("paid");
    expect(paymentStatusOf(-1_000, -1_000)).toBe("paid");
  });
});

describe("asientos de las operaciones", () => {
  it("gasto: Debe categoría (base + no deducible) · Debe 472 · Haber 4751 · Haber 410 (total − retención)", () => {
    const d = expenseEntry(expense({ deductibleBp: 5000, withholdingRateBp: 1500, accrualDate: "2026-09-30" }), { categoryAccount: "623", supplierAccount: "410", supplierName: "Gestoría Pérez" });
    expect(d).toMatchObject({ journalCode: "COM", date: "2026-09-30", origin: "expense", sourceKey: "expense:7", description: "Factura recibida F-2026-10 · Gestoría Pérez" });
    expect(balanced(d)).toEqual([
      ["623", 110_500, 0],
      ["472", 10_500, 0],
      ["4751", 0, 15_000],
      ["410", 0, 106_000],
    ]);
    expect(d.lines[0]).toMatchObject({ supplierId: 3, costCenterId: 1, taxRateBp: 2100, taxBaseCents: 100_000 });
  });

  it("rectificativa: las mismas cuentas con debe y haber intercambiados", () => {
    const d = expenseEntry(expense({ kind: "rectification", baseCents: -20_000, invoiceNumber: "R-1" }), { categoryAccount: "629", supplierAccount: "400", supplierName: null });
    expect(balanced(d)).toEqual([
      ["629", 0, 20_000],
      ["472", 0, 4_200],
      ["400", 24_200, 0],
    ]);
    expect(d.description).toBe("Factura rectificativa recibida R-1");
  });

  it("un gasto incoherente con su base no se contabiliza", () => {
    expect(() => expenseEntry({ ...expense(), taxCents: 1 }, { categoryAccount: "629", supplierAccount: "410", supplierName: null })).toThrow(/no cuadra/);
  });

  it("pago: Debe 400/410 · Haber banco, caja o Stripe (diario según la tesorería); devolución invertida", () => {
    const p = (treasuryAccount: string, amountCents = 121_000) => paymentEntry({ amountCents, date: "2026-10-20", supplierAccount: "410", treasuryAccount, supplierId: 3, label: "Pago F-1", sourceKey: "expense-payment:9" });
    expect(balanced(p("57200001"))).toEqual([
      ["410", 121_000, 0],
      ["57200001", 0, 121_000],
    ]);
    expect(p("57200001")).toMatchObject({ journalCode: "BAN", origin: "expense_payment", sourceKey: "expense-payment:9" });
    expect(p("57000001").journalCode).toBe("CAJ");
    expect(p("5720").journalCode).toBe("STR");
    expect(balanced(p("57200001", -500))).toEqual([
      ["410", 0, 500],
      ["57200001", 500, 0],
    ]);
  });

  it("movimiento bancario contra cuenta y caja: cargo y abono", () => {
    expect(balanced(bankCounterpartEntry({ amountCents: -350, bookingDate: "2026-10-02", description: "COMISION MANTENIMIENTO" }, "57200001", "626", null, "bankmov:5"))).toEqual([
      ["57200001", 0, 350],
      ["626", 350, 0],
    ]);
    expect(() => bankCounterpartEntry({ amountCents: 100, bookingDate: "2026-10-02", description: "x" }, "57200001", "57200001", null, "k")).toThrow(/propia cuenta/);
    expect(balanced(cashEntry({ amountCents: 5_000, movedOn: "2026-10-03", description: "Reposición de caja" }, "57000001", "57200001", "cash:1"))).toEqual([
      ["57000001", 5_000, 0],
      ["57200001", 0, 5_000],
    ]);
    expect(bankMovementSourceKey(5, 1)).toBe("bankmov:5");
    expect(bankMovementSourceKey(5, 2)).toBe("bankmov:5:2");
  });
});

describe("gastos recurrentes", () => {
  const t = { frequency: "monthly" as const, dayOfMonth: 5, startDate: "2026-01-10", endDate: null };
  it("fechas por frecuencia, sin antes del inicio ni después del fin; periodo de la clave", () => {
    expect(recurringOccurrences(t, "2026-04-30")).toEqual(["2026-02-05", "2026-03-05", "2026-04-05"]);
    expect(recurringOccurrences({ ...t, frequency: "quarterly", startDate: "2026-01-05" }, "2026-12-31")).toEqual(["2026-01-05", "2026-04-05", "2026-07-05", "2026-10-05"]);
    expect(recurringOccurrences({ ...t, frequency: "yearly", startDate: "2025-11-05" }, "2027-12-31")).toEqual(["2025-11-05", "2026-11-05", "2027-11-05"]);
    expect(recurringOccurrences({ ...t, endDate: "2026-03-01" }, "2026-12-31")).toEqual(["2026-02-05"]);
    expect(recurringOccurrences({ ...t, startDate: "2026-11-01" }, "2027-02-28")).toEqual(["2026-11-05", "2026-12-05", "2027-01-05", "2027-02-05"]);
    expect(recurringPeriod("monthly", "2026-10-05")).toBe("2026-10");
    expect(recurringPeriod("quarterly", "2026-11-05")).toBe("2026-T4");
    expect(recurringPeriod("yearly", "2026-11-05")).toBe("2026");
    expect(nextOccurrence(t, "2026-03-05")).toBe("2026-04-05");
    expect(nextOccurrence(t, null)).toBe("2026-02-05");
  });
});

describe("identificadores y documentos", () => {
  it("IBAN con control mod 97 y cuenta española", () => {
    expect(isValidIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(isValidIban("ES9121000418450200051333")).toBe(false);
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
    expect(isValidIban("ES912100041845020005133")).toBe(false);
    expect(spanishAccountOfIban("ES9121000418450200051332")).toEqual({ bank: "2100", branch: "0418", account: "0200051332" });
  });
  it("NIF/CIF con control en España; libre fuera", () => {
    expect(taxIdProblem("B12345674", "ES")).toBeNull();
    expect(taxIdProblem("b-1234567-4", "ES")).toBeNull();
    expect(taxIdProblem("B12345675", "ES")).toMatch(/no es válido/);
    expect(taxIdProblem("IE6388047V", "IE")).toBeNull();
  });
  it("tipo por firma del contenido, no por la extensión", () => {
    expect(sniffDocument(Buffer.from("%PDF-1.7\n..."), "x.png")).toEqual({ mime: "application/pdf", ext: "pdf" });
    expect(sniffDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "x")).toMatchObject({ mime: "image/png" });
    expect(sniffDocument(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]), "x")).toMatchObject({ mime: "image/jpeg" });
    expect(sniffDocument(Buffer.from('<?xml version="1.0"?><Invoice/>'), "f.xml")).toMatchObject({ mime: "application/xml" });
    expect(sniffDocument(Buffer.from("fecha;importe\n01/10/2026;-3,50\n"), "e.csv")).toMatchObject({ mime: "text/csv" });
    expect(sniffDocument(Buffer.from("fecha;importe\n"), "e.txt")).toBeNull();
    expect(sniffDocument(Buffer.from("MZ\x90\x00binario"), "malo.pdf")).toBeNull();
    expect(sniffDocument(Buffer.from("<script>alert(1)</script>"), "x.html")).toMatchObject({ mime: "application/xml" });
    expect(safeFilename('C:\\tmp\\"fac"<1>.pdf')).toBe("fac1.pdf");
    expect(safeFilename("")).toBe("documento");
  });
  it("subcuenta siguiente 572000NN / 570000NN", () => {
    expect(nextSubaccountCode("572000", ["572", "5720"])).toBe("57200001");
    expect(nextSubaccountCode("572000", ["57200001", "57200007", "5720"])).toBe("57200008");
    expect(() => nextSubaccountCode("570000", ["57000099"])).toThrow(/No quedan/);
  });
});

// ── Norma 43 ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe("Norma 43 (AEB 43)", () => {
  it("registros 11/22/23/33/88: signo por clave debe/haber, conceptos, saldo y cuadre", () => {
    const lines = norma43Sample().split("\r\n");
    expect(lines.every((l) => l.length === 80)).toBe(true);
    const [acc] = parseNorma43(norma43Sample());
    expect(acc).toMatchObject({ bank: "2100", branch: "0418", account: "0200051332", from: "2026-10-01", to: "2026-10-31", openingCents: 500_000, closingCents: 628_300, currency: "978" });
    expect(acc.movements.map((m) => [m.bookingDate, m.amountCents, m.balanceCents])).toEqual([
      ["2026-10-02", -350, 499_650],
      ["2026-10-05", -121_000, 378_650],
      ["2026-10-05", 250_000, 628_650],
      ["2026-10-05", -350, 628_300],
    ]);
    expect(acc.movements[0].description).toBe("COMISION MANT COMISION MANTENIMIENTO CUENTA");
    expect(acc.movements[1]).toMatchObject({ description: "TRANSF A HOSTING NUBE SL FACTURA F-2026-10", reference: "F-2026-10" });
    // Dos comisiones idénticas de días distintos y con concepto igual: claves distintas; volver a leer da las mismas
    const keys = acc.movements.map((m) => m.duplicateKey);
    expect(new Set(keys).size).toBe(4);
    expect(parseNorma43(norma43Sample())[0].movements.map((m) => m.duplicateKey)).toEqual(keys);
  });

  it("dos movimientos idénticos en el mismo fichero no se confunden (número de aparición)", () => {
    const f = [r11({ open: 0 }), r22({ date: "261002", amount: -100 }), r22({ date: "261002", amount: -100 }), r33({ nd: 2, d: 200, nc: 0, c: 0, close: -200 }), r88(4)].join("\n");
    const m = parseNorma43(f)[0].movements;
    expect(m).toHaveLength(2);
    expect(m[0].duplicateKey).not.toBe(m[1].duplicateKey);
  });

  it("rechaza ficheros que no cuadran o no son Norma 43", () => {
    expect(() => parseNorma43("fecha;importe\n")).toThrow(/no es Norma 43/);
    const bad = norma43Sample().replace(r33({ nd: 3, d: 121_700, nc: 1, c: 250_000, close: 628_300 }), r33({ nd: 3, d: 121_701, nc: 1, c: 250_000, close: 628_299 }));
    expect(() => parseNorma43(bad)).toThrow(/no cuadran/);
    expect(() => parseNorma43([r11({ open: 0 }), r22({ date: "261002", amount: -100 })].join("\n"))).toThrow(/falta el registro 33/);
    expect(() => parseNorma43([r11({ open: 0 }), r22({ date: "261302", amount: -100 })].join("\n"))).toThrow(/fecha de operación no válida/);
  });

  it("texto en Latin-1 (habitual en los bancos) se lee bien", () => {
    expect(decodeText(Buffer.from("Comisión", "latin1"))).toBe("Comisión");
    expect(decodeText(Buffer.from("﻿Comisión", "utf8"))).toBe("Comisión");
  });
});

describe("CaixaBank (adaptado de server/routers/bankMovements.ts) y CSV con mapeo", () => {
  it("parseImporte y parseExcelDate", () => {
    expect(parseImporte("-1.234,56")).toBe(-123_456);
    expect(parseImporte("1234,5")).toBe(123_450);
    expect(parseImporte("1,234.56")).toBe(123_456);
    expect(parseImporte("12.50 €")).toBe(1_250);
    expect(parseImporte("1.000")).toBe(100_000);
    expect(parseImporte(-3.5)).toBe(-350);
    expect(parseImporte("abc")).toBeNull();
    expect(parseExcelDate("05/10/2026")).toBe("2026-10-05");
    expect(parseExcelDate("2026-10-05")).toBe("2026-10-05");
    expect(parseExcelDate(46300)).toBe("2026-10-05");
    expect(parseExcelDate(new Date(Date.UTC(2026, 9, 4, 22)))).toBe("2026-10-05");
    expect(parseExcelDate(new Date(Date.UTC(2026, 9, 5)))).toBe("2026-10-05");
    expect(parseExcelDate("31/02/2026")).toBe("");
  });

  it("Excel exportado: busca la cabecera, lee importes con signo y saldo", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Movimientos de la cuenta"],
      [],
      ["Fecha", "Fecha valor", "Movimiento", "Más datos", "Importe", "Saldo"],
      ["05/10/2026", "05/10/2026", "TRANSFERENCIA", "HOSTING NUBE SL F-2026-10", "-1.210,00", "3.786,50"],
      ["06/10/2026", "06/10/2026", "COMISION", "", -3.5, 3783],
      ["", "", "Total", "", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const rows = parseCaixaBankBuffer(buf);
    expect(rows.map((r) => [r.bookingDate, r.amountCents, r.balanceCents, r.description])).toEqual([
      ["2026-10-05", -121_000, 378_650, "TRANSFERENCIA · HOSTING NUBE SL F-2026-10"],
      ["2026-10-06", -350, 378_300, "COMISION"],
    ]);
    expect(parseCaixaBankBuffer(buf).map((r) => r.duplicateKey)).toEqual(rows.map((r) => r.duplicateKey));
    expect(() => parseCaixaBankBuffer(Buffer.from("a;b\n1;2\n"))).toThrow(/cabecera/);
  });

  it("CSV con mapeo: separador, cabecera, formatos de fecha y decimal; pies sin fecha ignorados", () => {
    const m: CsvMapping = { delimiter: ";", headerRows: 1, date: 0, amount: 2, description: 1, balance: 3, dateFormat: "dd/mm/yyyy", decimal: "," };
    const csv = 'Fecha;Concepto;Importe;Saldo\n05/10/2026;"HOSTING; NUBE";-1.210,00;3.786,50\n06/10/2026;Comisión;-3,50;3.783,00\n\nSaldo final;;;3.783,00\n';
    const rows = parseMappedCsv(csv, m);
    expect(rows.map((r) => [r.bookingDate, r.amountCents, r.description, r.balanceCents])).toEqual([
      ["2026-10-05", -121_000, "HOSTING; NUBE", 378_650],
      ["2026-10-06", -350, "Comisión", 378_300],
    ]);
    expect(parseMappedCsv("2026-10-05,12.5,Cobro\n", { ...m, delimiter: ",", headerRows: 0, date: 0, amount: 1, description: 2, balance: null, dateFormat: "yyyy-mm-dd", decimal: "." })[0]).toMatchObject({ amountCents: 1_250, bookingDate: "2026-10-05" });
    expect(parseMappedCsv("10/05/2026;1;x\n", { ...m, headerRows: 0, date: 0, amount: 1, description: 2, balance: null, dateFormat: "mm/dd/yyyy" })[0].bookingDate).toBe("2026-10-05");
    expect(() => parseMappedCsv("05/10/2026;x;abc\n", { ...m, headerRows: 0, balance: null })).toThrow(/línea 1: importe no reconocido/);
    expect(() => parseMappedCsv("x", { ...m, amount: 0 })).toThrow(/columna distinta/);
    expect(parseCellAmount("(12,00)", ",")).toBe(-1_200);
  });
});

describe("sugerencias de conciliación", () => {
  const movement = { amountCents: -121_000, bookingDate: "2026-10-05", description: "TRANSF A HOSTING NUBE SL FACTURA F-2026-10", counterparty: null, reference: "F-2026-10" };
  it("pago manual con importe exacto primero; gasto por importe o por proveedor; lejanos o distintos fuera", () => {
    const s = suggestMatches(
      movement,
      [
        { id: 1, supplierName: "Hosting Nube, S.L.", invoiceNumber: "F-2026-10", invoiceDate: "2026-10-01", dueDate: "2026-10-04", pendingCents: 121_000 },
        { id: 2, supplierName: "Otro Proveedor SL", invoiceNumber: "A-9", invoiceDate: "2026-06-01", dueDate: null, pendingCents: 121_000 },
        { id: 3, supplierName: "Hosting Nube SL", invoiceNumber: "F-2026-11", invoiceDate: "2026-11-01", dueDate: null, pendingCents: 5_000 },
        { id: 4, supplierName: "Sin relación", invoiceNumber: null, invoiceDate: "2026-10-05", dueDate: null, pendingCents: 999 },
        { id: 5, supplierName: "Devolución", invoiceNumber: null, invoiceDate: "2026-10-05", dueDate: null, pendingCents: -121_000 },
      ],
      [{ id: 9, expenseId: 8, supplierName: "Hosting Nube SL", invoiceNumber: "F-2026-10", paidOn: "2026-10-04", amountCents: 121_000 }],
    );
    expect(s.map((x) => [x.type, x.expenseId, x.expensePaymentId])).toEqual([
      ["expense_payment", 8, 9],
      ["expense", 1, null],
      ["expense", 2, null],
      ["expense", 3, null],
    ]);
    expect(s[1].reasons).toEqual(["Importe exacto", "Fecha a 1 día", "Proveedor en el concepto", "Número de factura en el concepto"]);
    expect(s[2].reasons).toEqual(["Importe exacto"]);
  });
});
