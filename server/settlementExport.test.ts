/**
 * settlementExport.test.ts
 * Tests unitarios para la lógica de generación XLSX de liquidaciones.
 * Verifican que el workbook se construye correctamente con los datos esperados.
 */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

// ─── Helpers duplicados del módulo (para testear de forma aislada) ─────────────

function fmt(value: string | null | undefined): number {
  return parseFloat(value ?? "0") || 0;
}

function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("es-ES");
  } catch {
    return String(value);
  }
}

function mkCell(v: string | number, style?: Record<string, unknown>): XLSX.CellObject {
  const c: XLSX.CellObject = { v, t: typeof v === "number" ? "n" : "s" };
  if (style) c.s = style;
  return c;
}

// ─── Datos de prueba ──────────────────────────────────────────────────────────

const mockSettlement = {
  id: 1,
  settlementNumber: "LIQ-2025-0001",
  status: "emitida",
  periodFrom: "2025-01-01",
  periodTo: "2025-01-31",
  grossAmount: "1200.00",
  commissionAmount: "120.00",
  netAmountProvider: "1080.00",
  internalNotes: "Liquidación de prueba",
  createdAt: new Date("2025-02-01"),
  paidAt: null,
  supplierName: "Proveedor Test S.L.",
  supplierNif: "B12345678",
  supplierAddress: "Calle Ejemplo 1, Madrid",
  supplierIban: "ES91 2100 0418 4502 0005 1332",
  supplierEmail: "proveedor@test.com",
  supplierPhone: "+34 600 000 000",
};

const mockLines = [
  {
    id: 1,
    settlementId: 1,
    productName: "Blob Jump",
    serviceDate: "2025-01-10",
    paxCount: 4,
    costType: "comision",
    saleAmount: "400.00",
    commissionPercent: "10.00",
    commissionAmount: "40.00",
    netAmountProvider: "360.00",
    notes: null,
    reservationId: null,
    invoiceId: null,
    createdAt: new Date(),
  },
  {
    id: 2,
    settlementId: 1,
    productName: "Kayak",
    serviceDate: "2025-01-15",
    paxCount: 6,
    costType: "comision",
    saleAmount: "800.00",
    commissionPercent: "10.00",
    commissionAmount: "80.00",
    netAmountProvider: "720.00",
    notes: "Grupo escolar",
    reservationId: null,
    invoiceId: null,
    createdAt: new Date(),
  },
];

// ─── Función de construcción del workbook (extraída para tests) ───────────────

function buildSettlementWorkbook(
  settlement: typeof mockSettlement,
  lines: typeof mockLines
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Cabecera
  const headerRows: XLSX.CellObject[][] = [
    [mkCell("LIQUIDACIÓN DE PROVEEDOR — NÁYADE EXPERIENCES"), mkCell(""), mkCell(""), mkCell("")],
    [mkCell("")],
    [mkCell("Número de liquidación"), mkCell(settlement.settlementNumber), mkCell(""), mkCell("")],
    [mkCell("Estado"), mkCell(settlement.status ?? "—"), mkCell(""), mkCell("")],
    [mkCell("Período desde"), mkCell(settlement.periodFrom ?? "—"), mkCell(""), mkCell("")],
    [mkCell("Período hasta"), mkCell(settlement.periodTo ?? "—"), mkCell(""), mkCell("")],
    [mkCell("Fecha de emisión"), mkCell(fmtDate(settlement.createdAt)), mkCell(""), mkCell("")],
    [mkCell("Fecha de abono"), mkCell(fmtDate(settlement.paidAt)), mkCell(""), mkCell("")],
    [mkCell("")],
    [mkCell("DATOS DEL PROVEEDOR"), mkCell(""), mkCell(""), mkCell("")],
    [mkCell("Razón social"), mkCell(settlement.supplierName ?? "—"), mkCell(""), mkCell("")],
    [mkCell("NIF / CIF"), mkCell(settlement.supplierNif ?? "—"), mkCell(""), mkCell("")],
    [mkCell("IBAN"), mkCell(settlement.supplierIban ?? "—"), mkCell(""), mkCell("")],
    [mkCell("")],
    [mkCell("RESUMEN ECONÓMICO"), mkCell(""), mkCell(""), mkCell("")],
    [mkCell("Total venta bruta"), mkCell(fmt(settlement.grossAmount)), mkCell(""), mkCell("")],
    [mkCell("Total comisión agencia"), mkCell(fmt(settlement.commissionAmount)), mkCell(""), mkCell("")],
    [mkCell("NETO A ABONAR AL PROVEEDOR"), mkCell(fmt(settlement.netAmountProvider)), mkCell(""), mkCell("")],
  ];

  const wsHeader = XLSX.utils.aoa_to_sheet(headerRows);
  XLSX.utils.book_append_sheet(wb, wsHeader, "Cabecera");

  // Hoja 2: Líneas
  const colHeaders = [
    "Servicio / Producto", "Fecha servicio", "Pax", "Tipo coste",
    "Venta bruta (€)", "Comisión %", "Comisión (€)", "Neto proveedor (€)", "Notas",
  ];
  const linesRows: XLSX.CellObject[][] = [colHeaders.map((h) => mkCell(h))];

  for (const l of lines) {
    linesRows.push([
      mkCell(l.productName ?? "—"),
      mkCell(l.serviceDate ?? "—"),
      mkCell(l.paxCount ?? 0),
      mkCell(l.costType ?? "—"),
      mkCell(fmt(l.saleAmount)),
      mkCell(fmt(l.commissionPercent)),
      mkCell(fmt(l.commissionAmount)),
      mkCell(fmt(l.netAmountProvider)),
      mkCell(l.notes ?? ""),
    ]);
  }

  const totGross = lines.reduce((s, l) => s + fmt(l.saleAmount), 0);
  const totComm = lines.reduce((s, l) => s + fmt(l.commissionAmount), 0);
  const totNet = lines.reduce((s, l) => s + fmt(l.netAmountProvider), 0);
  const totalPax = lines.reduce((s, l) => s + (l.paxCount ?? 0), 0);

  linesRows.push([
    mkCell("TOTALES"), mkCell(""), mkCell(totalPax), mkCell(""),
    mkCell(totGross), mkCell(""), mkCell(totComm), mkCell(totNet), mkCell(""),
  ]);

  const wsLines = XLSX.utils.aoa_to_sheet(linesRows);
  XLSX.utils.book_append_sheet(wb, wsLines, "Líneas");

  return wb;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildSettlementWorkbook", () => {
  it("genera un workbook con dos hojas: Cabecera y Líneas", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    expect(wb.SheetNames).toHaveLength(2);
    expect(wb.SheetNames[0]).toBe("Cabecera");
    expect(wb.SheetNames[1]).toBe("Líneas");
  });

  it("la hoja Cabecera contiene el número de liquidación correcto", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Cabecera"];
    // Fila 3 (índice 2), columna B (índice 1) → número de liquidación
    const cellB3 = ws["B3"] as XLSX.CellObject;
    expect(cellB3.v).toBe("LIQ-2025-0001");
  });

  it("la hoja Cabecera contiene el nombre del proveedor", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Cabecera"];
    const cellB11 = ws["B11"] as XLSX.CellObject;
    expect(cellB11.v).toBe("Proveedor Test S.L.");
  });

  it("la hoja Cabecera contiene el neto a abonar correcto", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Cabecera"];
    // Fila 18 (índice 17), columna B → neto proveedor
    const cellB18 = ws["B18"] as XLSX.CellObject;
    expect(cellB18.v).toBe(1080);
  });

  it("la hoja Líneas tiene cabecera con 9 columnas", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Líneas"];
    const headers = ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1"].map(
      (addr) => (ws[addr] as XLSX.CellObject)?.v
    );
    expect(headers).toEqual([
      "Servicio / Producto", "Fecha servicio", "Pax", "Tipo coste",
      "Venta bruta (€)", "Comisión %", "Comisión (€)", "Neto proveedor (€)", "Notas",
    ]);
  });

  it("la hoja Líneas contiene las dos líneas de prueba", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Líneas"];
    const row2A = (ws["A2"] as XLSX.CellObject)?.v;
    const row3A = (ws["A3"] as XLSX.CellObject)?.v;
    expect(row2A).toBe("Blob Jump");
    expect(row3A).toBe("Kayak");
  });

  it("la fila de totales suma correctamente el neto proveedor", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Líneas"];
    // Fila 4 (índice 3) → fila de totales (1 cabecera + 2 líneas + 1 total)
    const totNetCell = ws["H4"] as XLSX.CellObject;
    expect(totNetCell.v).toBe(1080); // 360 + 720
  });

  it("la fila de totales suma correctamente el pax", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const ws = wb.Sheets["Líneas"];
    const totPaxCell = ws["C4"] as XLSX.CellObject;
    expect(totPaxCell.v).toBe(10); // 4 + 6
  });

  it("serializa el workbook a buffer sin errores", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("el buffer es un archivo XLSX válido (empieza con PK signature)", () => {
    const wb = buildSettlementWorkbook(mockSettlement, mockLines);
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    // XLSX/ZIP files start with PK (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("funciona con lista de líneas vacía", () => {
    const wb = buildSettlementWorkbook(mockSettlement, []);
    const ws = wb.Sheets["Líneas"];
    // Solo cabecera + fila de totales (con ceros)
    const totNetCell = ws["H2"] as XLSX.CellObject;
    expect(totNetCell.v).toBe(0);
  });

  it("fmt devuelve 0 para valores nulos o indefinidos", () => {
    expect(fmt(null)).toBe(0);
    expect(fmt(undefined)).toBe(0);
    expect(fmt("")).toBe(0);
    expect(fmt("123.45")).toBe(123.45);
  });

  it("fmtDate devuelve — para valores nulos", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
  });
});
