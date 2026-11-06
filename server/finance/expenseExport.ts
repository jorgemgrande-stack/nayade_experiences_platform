/**
 * Exportación del listado de gastos (Contabilidad › Gastos del CRM) en Excel y PDF, con los mismos filtros que la lista.
 *
 *  - Excel (SheetJS): una fila por gasto con fechas reales, importes numéricos en euros y una fila de totales; sirve
 *    para la gestoría o para cuadrar con el banco.
 *  - PDF (PDF corporativo de Big Elephant): resumen con los filtros aplicados y los totales, y la tabla de gastos.
 *  - Los anulados se listan (son parte del registro) pero no suman en los totales.
 * Funciones puras salvo el PDF (asíncrono por pdf-lib). Solo lectura: no cambia ningún gasto.
 */
import * as XLSX from "xlsx";
import type { BrandIssuer, PdfBlock } from "../documents/brandPdf";
import type { ExpenseRow } from "./opsStore";

/** Máximo de gastos por exportación (más: que se filtre por fechas). */
export const EXPENSE_EXPORT_MAX = 5000;

const STATUS_LABEL: Record<string, string> = { draft: "Borrador", registered: "Registrado", void: "Anulado" };
const PAYMENT_LABEL: Record<string, string> = { pending: "Pendiente", partial: "Parcial", paid: "Pagado" };

export interface ExpenseExportRow {
  id: number;
  invoiceDate: string;
  supplier: string;
  invoiceNumber: string;
  description: string;
  category: string;
  costCenter: string;
  baseCents: number;
  taxCents: number;
  withholdingCents: number;
  totalCents: number;
  dueDate: string | null;
  status: string;
  payment: string;
  void: boolean;
}

export interface ExpenseExportMeta {
  /** Filtros aplicados en texto (p. ej. «Estado: Registrado · Desde 01/11/2026»); vacío = todos. */
  filters: string[];
  generatedAt: Date;
}

export function expenseExportRows(items: ExpenseRow[], names: { category: (id: number | null) => string; costCenter: (id: number | null) => string }): ExpenseExportRow[] {
  return items.map((e) => ({
    id: e.id,
    invoiceDate: e.invoiceDate,
    supplier: e.supplierName ?? "",
    invoiceNumber: e.invoiceNumber ?? "",
    description: e.description,
    category: names.category(e.categoryId),
    costCenter: names.costCenter(e.costCenterId),
    baseCents: e.baseCents,
    taxCents: e.taxCents,
    withholdingCents: e.withholdingCents,
    totalCents: e.totalCents,
    dueDate: e.dueDate,
    status: STATUS_LABEL[e.status] ?? e.status,
    payment: e.status === "registered" ? (PAYMENT_LABEL[e.paymentStatus] ?? e.paymentStatus) : "",
    void: e.status === "void",
  }));
}

/** Totales sin los anulados. */
export function expenseExportTotals(rows: ExpenseExportRow[]) {
  const live = rows.filter((r) => !r.void);
  const sum = (k: "baseCents" | "taxCents" | "withholdingCents" | "totalCents") => live.reduce((a, r) => a + r[k], 0);
  return { count: rows.length, counted: live.length, baseCents: sum("baseCents"), taxCents: sum("taxCents"), withholdingCents: sum("withholdingCents"), totalCents: sum("totalCents") };
}

const ymdToDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
export const esDate = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const euros = (c: number) => Math.round(c) / 100;
export const eur = (c: number) => `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;

const HEAD = ["Fecha", "Proveedor", "N.º factura", "Descripción", "Categoría", "Centro de coste", "Base (€)", "IVA (€)", "Retención (€)", "Total (€)", "Vencimiento", "Estado", "Pago"];

/** Libro Excel (.xlsx) con la hoja «Gastos». */
export function expensesXlsx(rows: ExpenseExportRow[], meta: ExpenseExportMeta): Buffer {
  const t = expenseExportTotals(rows);
  const aoa: unknown[][] = [
    ["Listado de gastos"],
    [`Generado el ${meta.generatedAt.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}${meta.filters.length ? ` · ${meta.filters.join(" · ")}` : " · Todos los gastos"}`],
    [],
    HEAD,
    ...rows.map((r) => [ymdToDate(r.invoiceDate), r.supplier, r.invoiceNumber, r.description, r.category, r.costCenter, euros(r.baseCents), euros(r.taxCents), euros(r.withholdingCents), euros(r.totalCents), ymdToDate(r.dueDate), r.status, r.payment]),
    [],
    [`Totales (${t.counted} gastos; sin anulados)`, "", "", "", "", "", euros(t.baseCents), euros(t.taxCents), euros(t.withholdingCents), euros(t.totalCents)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" });
  // Formatos: fechas y euros con dos decimales
  const first = 4;
  for (let i = 0; i < rows.length + 2; i++) {
    const row = first + i + (i >= rows.length ? 1 : 0);
    for (const col of [0, 10]) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && cell.t === "d") cell.z = "dd/mm/yyyy";
    }
    for (let col = 6; col <= 9; col++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && cell.t === "n") cell.z = "#,##0.00";
    }
  }
  ws["!cols"] = [12, 28, 16, 44, 26, 18, 12, 12, 12, 12, 12, 12, 10].map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: HEAD.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Gastos");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Bloques del PDF: título, filtros y totales, y la tabla (los anulados, marcados). */
export function expensesPdfBlocks(rows: ExpenseExportRow[], meta: ExpenseExportMeta): PdfBlock[] {
  const t = expenseExportTotals(rows);
  return [
    { kind: "title", text: "Listado de gastos", subtitle: `Generado el ${meta.generatedAt.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" })}` },
    {
      kind: "keyValue",
      rows: [
        ["Filtros", meta.filters.length ? meta.filters.join(" · ") : "Todos los gastos"],
        ["Gastos", `${t.count}${t.count !== t.counted ? ` (${t.count - t.counted} anulados, que no suman)` : ""}`],
        ["Base imponible", eur(t.baseCents)],
        ["IVA", eur(t.taxCents)],
        ["Retenciones", eur(t.withholdingCents)],
        ["Total", eur(t.totalCents)],
      ],
    },
    {
      kind: "table",
      columns: [
        { title: "Fecha", width: 11 },
        { title: "Proveedor", width: 17 },
        { title: "Factura", width: 12 },
        { title: "Descripción", width: 24 },
        { title: "Categoría", width: 16 },
        { title: "Total", width: 12, align: "right" },
        { title: "Estado", width: 11 },
      ],
      rows: rows.map((r) => [esDate(r.invoiceDate), r.supplier || "—", r.invoiceNumber || "—", r.description, r.category || "—", eur(r.totalCents), r.void ? "Anulado" : r.payment ? `${r.status} · ${r.payment}` : r.status]),
      totals: ["Total", "", "", "", "", eur(t.totalCents), ""],
    },
  ];
}

export async function expensesPdf(rows: ExpenseExportRow[], meta: ExpenseExportMeta, issuer: BrandIssuer, logoPng: Uint8Array | null): Promise<Uint8Array> {
  const { renderBrandPdf } = await import("../documents/brandPdf");
  return renderBrandPdf({ title: "Listado de gastos", issuer, logoPng, footerNote: `Listado de gastos · ${rows.length} gastos`, blocks: expensesPdfBlocks(rows, meta) });
}
