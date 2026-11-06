/**
 * Exportación del listado de gastos (Excel y PDF): filas, totales sin anulados, hoja legible y PDF que reparte un
 * listado largo en varias páginas (el PDF corporativo repite la cabecera de la tabla en cada una).
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { esDate, expenseExportRows, expenseExportTotals, expensesPdf, expensesPdfBlocks, expensesXlsx } from "./expenseExport";
import type { ExpenseRow } from "./opsStore";

const ISSUER = { legalName: "EMPRESA DE PRUEBA, S.L.", taxId: "B00000000", address: "Calle Falsa 1, 28000 Madrid" };
const row = (id: number, o: Partial<ExpenseRow> = {}) =>
  ({ id, invoiceDate: "2026-11-05", supplierName: "Proveedor Ficticio", invoiceNumber: `F-${id}`, description: `Gasto ${id}`, categoryId: 1, costCenterId: null, baseCents: 10_000, taxCents: 2_100, withholdingCents: 0, totalCents: 12_100, dueDate: "2026-12-05", status: "registered", paymentStatus: "pending", ...o }) as ExpenseRow;
const names = { category: (id: number | null) => (id === 1 ? "Software y licencias" : ""), costCenter: () => "" };
const meta = { filters: ["Estado: Registrado"], generatedAt: new Date(Date.UTC(2026, 10, 6, 10)) };

describe("exportación de gastos", () => {
  it("filas con nombres y estados en español; los anulados se listan pero no suman", () => {
    const rows = expenseExportRows([row(1), row(2, { status: "void", paymentStatus: "pending" }), row(3, { status: "draft" })], names);
    expect(rows[0]).toMatchObject({ category: "Software y licencias", status: "Registrado", payment: "Pendiente", void: false });
    expect(rows[1]).toMatchObject({ status: "Anulado", payment: "", void: true });
    expect(rows[2]).toMatchObject({ status: "Borrador", payment: "" });
    expect(expenseExportTotals(rows)).toMatchObject({ count: 3, counted: 2, baseCents: 20_000, taxCents: 4_200, totalCents: 24_200 });
    expect(esDate("2026-11-05")).toBe("05/11/2026");
  });

  it("Excel: cabecera, fechas reales, euros numéricos y totales", () => {
    const rows = expenseExportRows([row(1), row(2, { status: "void" })], names);
    const sheet = XLSX.read(expensesXlsx(rows, meta), { cellDates: true }).Sheets.Gastos;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
    expect(aoa[0]).toEqual(["Listado de gastos"]);
    expect(String(aoa[1][0])).toContain("Estado: Registrado");
    expect(aoa[3][0]).toBe("Fecha");
    expect(aoa[4][0]).toBeInstanceOf(Date);
    expect(aoa[4].slice(1, 4)).toEqual(["Proveedor Ficticio", "F-1", "Gasto 1"]);
    expect(aoa[4].slice(6, 10)).toEqual([100, 21, 0, 121]);
    const totals = aoa[aoa.length - 1];
    expect(totals[0]).toBe("Totales (1 gastos; sin anulados)");
    expect(totals.slice(6, 10)).toEqual([100, 21, 0, 121]);
  });

  it("PDF: resumen con filtros y totales; un listado largo ocupa varias páginas", async () => {
    const rows = expenseExportRows(Array.from({ length: 120 }, (_, i) => row(i + 1)), names);
    const blocks = expensesPdfBlocks(rows, meta);
    expect(blocks[1]).toMatchObject({ kind: "keyValue", rows: expect.arrayContaining([["Filtros", "Estado: Registrado"], ["Gastos", "120"]]) });
    const pdf = await expensesPdf(rows, meta, ISSUER, null);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(3);
    // Uno corto, una sola página
    const short = await expensesPdf(expenseExportRows([row(1)], names), meta, ISSUER, null);
    expect((await PDFDocument.load(short)).getPageCount()).toBe(1);
  });
});
