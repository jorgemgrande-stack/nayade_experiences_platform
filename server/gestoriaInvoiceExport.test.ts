import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  buildGestoriaInvoiceZip,
  buildInvoiceLedgerCsv,
  documentFileName,
  ExportTooLargeError,
  MAX_EXPORT_DOCUMENTS,
  type ExportInvoiceRow,
} from "./gestoriaInvoiceExport";
import { ExportPeriodError, lastClosedQuarter, resolveExportPeriod } from "../shared/gestoriaExportPeriod";

function inv(p: Partial<ExportInvoiceRow> & Pick<ExportInvoiceRow, "id" | "invoiceNumber">): ExportInvoiceRow {
  return {
    invoiceType: "factura",
    status: "generada",
    clientName: "Cliente Prueba SL",
    clientNif: "B00000011",
    itemsJson: [],
    taxRate: "21",
    taxAmount: "0",
    taxBreakdown: null,
    total: "0",
    creditNoteForId: null,
    issuedAt: new Date("2026-05-10T10:00:00Z"),
    ...p,
  };
}

const parseCsv = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n").map((l) => l.split(";"));

describe("periodo de exportación (Europe/Madrid)", () => {
  it("mes, trimestre fiscal y rango", () => {
    expect(resolveExportPeriod({ kind: "month", year: 2026, month: 2 })).toMatchObject({ from: "2026-02-01", to: "2026-02-28", key: "2026-02", label: "febrero de 2026" });
    expect(resolveExportPeriod({ kind: "month", year: 2028, month: 2 }).to).toBe("2028-02-29");
    expect(resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 3 })).toMatchObject({ from: "2026-07-01", to: "2026-09-30", key: "2026-T3" });
    expect(resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 4 })).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolveExportPeriod({ kind: "range", from: "2026-10-01", to: "2026-10-15" })).toMatchObject({ key: "2026-10-01_2026-10-15", label: "del 01/10/2026 al 15/10/2026" });
  });

  it("rechaza periodos imposibles", () => {
    expect(() => resolveExportPeriod({ kind: "month", year: 2026, month: 13 })).toThrow(ExportPeriodError);
    expect(() => resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 5 })).toThrow(ExportPeriodError);
    expect(() => resolveExportPeriod({ kind: "range", from: "2026-10-15", to: "2026-10-01" })).toThrow(ExportPeriodError);
    expect(() => resolveExportPeriod({ kind: "range", from: "2026-02-30", to: "2026-03-01" })).toThrow(ExportPeriodError);
    expect(() => resolveExportPeriod({ kind: "range", from: "2025-01-01", to: "2026-12-31" })).toThrow(ExportPeriodError);
  });

  it("último trimestre cerrado según la hora de Madrid, no la del servidor", () => {
    // 1 de abril a las 00:30 en Madrid = 31 de marzo 22:30 UTC: ya se ha cerrado el 1.er trimestre
    expect(lastClosedQuarter(new Date("2026-03-31T22:30:00Z"))).toEqual({ year: 2026, quarter: 1 });
    expect(lastClosedQuarter(new Date("2026-03-31T21:30:00Z"))).toEqual({ year: 2025, quarter: 4 });
    // 1 de enero 00:30 en Madrid (31/12 23:30 UTC): el 4.º trimestre del año anterior
    expect(lastClosedQuarter(new Date("2025-12-31T23:30:00Z"))).toEqual({ year: 2025, quarter: 4 });
  });
});

describe("libro de facturas emitidas (CSV)", () => {
  const multi = inv({
    id: 1, invoiceNumber: "FAC-2026-0001", total: "176.00", taxAmount: "26.00",
    taxBreakdown: [{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 50, amount: 5 }],
    issuedAt: new Date("2026-05-10T10:00:00Z"),
  });
  const single = inv({ id: 2, invoiceNumber: "FAC-2026-0002", clientName: "Otro Cliente", clientNif: null, total: "121.00", taxAmount: "21.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }], issuedAt: new Date("2026-05-11T10:00:00Z"), status: "cobrada" });
  const credit = inv({
    id: 3, invoiceNumber: "ABO-2026-05-0001", invoiceType: "abono", creditNoteForId: 1, total: "-55.00", taxAmount: "-5.00",
    taxBreakdown: [{ rate: 10, base: -50, amount: -5 }], issuedAt: new Date("2026-05-12T10:00:00Z"),
  });

  it("columnas por tipo de IVA, abonos en negativo con su factura rectificada y fila de totales", () => {
    const csv = buildInvoiceLedgerCsv([credit, single, multi], new Map([[1, "FAC-2026-0001"]]));
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([
      "Número", "Fecha de expedición", "Tipo", "Factura rectificada", "Cliente", "NIF",
      "Base 21 %", "Cuota IVA 21 %", "Base 10 %", "Cuota IVA 10 %",
      "Base imponible total", "Cuota IVA total", "Importe no sujeto o exento", "Total", "Estado",
    ]);
    // Ordenado por fecha de expedición
    expect(rows[1]).toEqual(["FAC-2026-0001", "10/05/2026", "Factura", "", "Cliente Prueba SL", "B00000011", "100,00", "21,00", "50,00", "5,00", "150,00", "26,00", "0,00", "176,00", "Emitida"]);
    expect(rows[2].slice(6, 10)).toEqual(["100,00", "21,00", "", ""]);
    expect(rows[2][14]).toBe("Cobrada");
    expect(rows[3]).toEqual(["ABO-2026-05-0001", "12/05/2026", "Abono", "FAC-2026-0001", "Cliente Prueba SL", "B00000011", "", "", "-50,00", "-5,00", "-50,00", "-5,00", "0,00", "-55,00", "Emitida"]);
    expect(rows[4]).toEqual(["TOTAL", "", "", "", "3 documentos", "", "200,00", "42,00", "0,00", "0,00", "200,00", "42,00", "0,00", "242,00", ""]);
    expect(rows[2].slice(4, 6)).toEqual(["Otro Cliente", ""]);
    // Texto con separador y comillas, escapado
    const quoted = buildInvoiceLedgerCsv([inv({ id: 11, invoiceNumber: "F-11", clientName: "Uno; \"Dos\"" })], new Map());
    expect(quoted).toContain(";\"Uno; \"\"Dos\"\"\";");
  });

  it("abono guardado con importes positivos (documentos antiguos): figura en negativo igualmente", () => {
    const old = inv({ id: 9, invoiceNumber: "ABO-OLD-1", invoiceType: "abono", total: "121.00", taxAmount: "21.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] });
    const rows = parseCsv(buildInvoiceLedgerCsv([old], new Map()));
    expect(rows[1].slice(6)).toEqual(["-100,00", "-21,00", "-100,00", "-21,00", "0,00", "-121,00", "Emitida"]);
    expect(rows[1][3]).toBe("");
  });

  it("sin desglose guardado: el de sus líneas si cuadra; si no, un único tipo con la cuota guardada", () => {
    const lines = inv({ id: 4, invoiceNumber: "F-4", total: "231.00", taxAmount: "31.00", itemsJson: [{ total: 121, taxRate: 21 }, { total: 110, taxRate: 10 }] });
    const r1 = parseCsv(buildInvoiceLedgerCsv([lines], new Map()));
    expect(r1[0]).toContain("Base 10 %");
    expect(r1[1].slice(6, 10)).toEqual(["100,00", "21,00", "100,00", "10,00"]);
    const legacy = inv({ id: 5, invoiceNumber: "F-5", total: "110.00", taxAmount: "10.00", taxRate: "10", itemsJson: [{ total: 999 }] });
    const r2 = parseCsv(buildInvoiceLedgerCsv([legacy], new Map()));
    expect(r2[0][6]).toBe("Base 10 %");
    expect(r2[1].slice(6, 10)).toEqual(["100,00", "10,00", "100,00", "10,00"]);
  });

  it("importe no sujeto: la parte del total fuera del desglose de IVA", () => {
    const mixed = inv({ id: 6, invoiceNumber: "F-6", total: "321.00", taxAmount: "21.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] });
    const rows = parseCsv(buildInvoiceLedgerCsv([mixed], new Map()));
    expect(rows[1].slice(8, 11)).toEqual(["100,00", "21,00", "200,00"]);
  });

  it("fecha y trimestre por la hora de Madrid: una factura del 30/09 a las 23:30 UTC es del 1 de octubre", () => {
    const late = inv({ id: 7, invoiceNumber: "F-7", total: "121.00", taxAmount: "21.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }], issuedAt: new Date("2026-09-30T23:30:00Z") });
    expect(parseCsv(buildInvoiceLedgerCsv([late], new Map()))[1][1]).toBe("01/10/2026");
    const winter = inv({ id: 8, invoiceNumber: "F-8", total: "121.00", taxAmount: "21.00", issuedAt: new Date("2026-12-31T22:59:00Z") });
    expect(parseCsv(buildInvoiceLedgerCsv([winter], new Map()))[1][1]).toBe("31/12/2026");
  });

  it("un texto que empieza por = no se interpreta como fórmula", () => {
    const evil = inv({ id: 10, invoiceNumber: "F-10", clientName: "=HYPERLINK(\"x\")", total: "0" });
    expect(parseCsv(buildInvoiceLedgerCsv([evil], new Map()))[1][4]).toMatch(/^"?'=/);
  });

  it("periodo sin documentos: solo la cabecera", () => {
    const rows = parseCsv(buildInvoiceLedgerCsv([], new Map()));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain("Base 21 %");
  });
});

describe("ZIP para la gestoría", () => {
  const period = resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 2 });
  const rows = [
    inv({ id: 1, invoiceNumber: "FAC-2026-0001", total: "121.00", taxAmount: "21.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] }),
    inv({ id: 2, invoiceNumber: "ABO-2026-05-0001", invoiceType: "abono", creditNoteForId: 1, total: "-121.00", taxAmount: "-21.00", taxBreakdown: [{ rate: 21, base: -100, amount: -21 }], issuedAt: new Date("2026-05-20T10:00:00Z") }),
  ];
  const pdfFor = async (r: ExportInvoiceRow) => Buffer.from(`%PDF-1.4 ${r.invoiceNumber}`);

  it("PDF de facturas y abonos en carpetas separadas, libro CSV y LEEME", async () => {
    const out = await buildGestoriaInvoiceZip({ companyName: "Empresa Prueba SL", period, rows, originalNumbers: new Map([[1, "FAC-2026-0001"]]), pdfFor, generatedAt: new Date("2026-07-02T10:00:00Z") });
    expect(out.fileName).toBe("facturas_gestoria_2026-T2.zip");
    expect(out).toMatchObject({ invoices: 1, creditNotes: 1, missingPdfs: [] });
    const zip = await JSZip.loadAsync(out.buffer);
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
      "Abonos/ABO-2026-05-0001.pdf",
      "Facturas/FAC-2026-0001.pdf",
      "LEEME.txt",
      "libro_facturas_emitidas_2026-T2.csv",
    ]);
    expect(await zip.file("Facturas/FAC-2026-0001.pdf")!.async("string")).toBe("%PDF-1.4 FAC-2026-0001");
    expect(await zip.file("Abonos/ABO-2026-05-0001.pdf")!.async("string")).toBe("%PDF-1.4 ABO-2026-05-0001");
    const csv = await zip.file("libro_facturas_emitidas_2026-T2.csv")!.async("string");
    expect(csv).toContain("ABO-2026-05-0001;20/05/2026;Abono;FAC-2026-0001");
    const readme = await zip.file("LEEME.txt")!.async("string");
    expect(readme).toContain("Empresa Prueba SL");
    expect(readme).toContain("2.º trimestre de 2026 (01/04/2026 a 30/06/2026");
    expect(readme).not.toContain("ATENCIÓN");
  });

  it("si un PDF no se puede obtener, el documento sigue en el libro y se avisa", async () => {
    const out = await buildGestoriaInvoiceZip({
      companyName: "Empresa Prueba SL", period, rows, originalNumbers: new Map(),
      pdfFor: async (r) => { if (r.id === 2) throw new Error("sin PDF"); return pdfFor(r); },
    });
    expect(out.missingPdfs).toEqual(["ABO-2026-05-0001"]);
    const zip = await JSZip.loadAsync(out.buffer);
    expect(zip.file("Abonos/ABO-2026-05-0001.pdf")).toBeNull();
    expect(await zip.file("libro_facturas_emitidas_2026-T2.csv")!.async("string")).toContain("ABO-2026-05-0001");
    expect(await zip.file("LEEME.txt")!.async("string")).toContain("- ABO-2026-05-0001");
  });

  it("periodo vacío: ZIP con el libro vacío y el aviso", async () => {
    const out = await buildGestoriaInvoiceZip({ companyName: "X", period, rows: [], originalNumbers: new Map(), pdfFor });
    const zip = await JSZip.loadAsync(out.buffer);
    expect(await zip.file("LEEME.txt")!.async("string")).toContain("No hay facturas ni abonos");
  });

  it("nombres de fichero seguros y sin colisiones; tope de documentos", async () => {
    expect(documentFileName("FAC/2026 0001")).toBe("FAC_2026_0001.pdf");
    expect(documentFileName("../../x")).toBe("x.pdf");
    const twins = [inv({ id: 1, invoiceNumber: "A/1" }), inv({ id: 2, invoiceNumber: "A 1" })];
    const zip = await JSZip.loadAsync((await buildGestoriaInvoiceZip({ companyName: "X", period, rows: twins, originalNumbers: new Map(), pdfFor })).buffer);
    expect(zip.file("Facturas/A_1.pdf")).not.toBeNull();
    expect(zip.file("Facturas/A_1_2.pdf")).not.toBeNull();
    const many = Array.from({ length: MAX_EXPORT_DOCUMENTS + 1 }, (_, i) => inv({ id: i + 1, invoiceNumber: `F-${i}` }));
    await expect(buildGestoriaInvoiceZip({ companyName: "X", period, rows: many, originalNumbers: new Map(), pdfFor })).rejects.toBeInstanceOf(ExportTooLargeError);
  });
});
