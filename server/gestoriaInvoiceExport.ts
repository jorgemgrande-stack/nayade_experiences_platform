/**
 * Exportación de facturas para la gestoría: un ZIP con el PDF de cada factura y abono expedidos en el
 * periodo y el libro de facturas emitidas en CSV, que incluye también los tickets de caja (facturas
 * simplificadas) del periodo.
 *
 * Todo sale de lo que ya está guardado de cada documento (número, fecha, cliente, NIF, desglose por tipo
 * de IVA, total): aquí no se recalcula ningún dato fiscal. Cada documento se convierte con la misma regla que
 * Informes y el Modelo 303 (server/fiscalDocuments.ts), incluida la de no duplicar: un ticket cuya venta
 * tiene factura completa figura como sustituido, sin importe. El PDF lo aporta quien llama (el guardado de la
 * factura o, si no hay, el que genera el sistema con esos mismos datos), así que estas funciones son puras
 * y se prueban sin base de datos.
 */
import JSZip from "jszip";
import { formatDateKeyEs, madridDayKey, type ResolvedExportPeriod } from "../shared/gestoriaExportPeriod";
import {
  FISCAL_KIND_LABEL,
  invoiceBreakdown,
  invoiceDocument,
  sortFiscalDocuments,
  type FiscalDocument,
  type FiscalInvoiceRow,
} from "./fiscalDocuments";

/** Tope de documentos por ZIP: cada uno lleva su PDF; un periodo mayor se divide (mes o rango). */
export const MAX_EXPORT_DOCUMENTS = 250;

/** Lo que se lee de cada factura guardada. */
export type ExportInvoiceRow = FiscalInvoiceRow;

export interface LedgerLine {
  number: string;
  date: string;
  type: string;
  rectifies: string;
  client: string;
  nif: string;
  byRate: Map<number, { base: number; amount: number }>;
  base: number;
  tax: number;
  notSubject: number;
  total: number;
  status: string;
  /** Si suma en la fila de totales (no: factura anulada, ticket sustituido, anulado o devuelto). */
  counts: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 + 0;

/**
 * Desglose por tipo de IVA del documento: el guardado; si no lo hay (documentos antiguos), el de sus
 * líneas, con el mismo criterio que el Modelo 303 (nunca todo a un tipo si mezcla tipos o partes sin IVA
 * repercutido); sin líneas, un único tipo con la cuota guardada.
 */
export function storedBreakdown(inv: ExportInvoiceRow): { rate: number; base: number; amount: number }[] {
  return invoiceBreakdown(inv);
}

/** Una línea del libro por documento fiscal. Los abonos van siempre en negativo, como restan en la declaración. */
export function documentLedgerLine(doc: FiscalDocument): LedgerLine {
  const byRate = new Map<number, { base: number; amount: number }>();
  for (const b of doc.byRate) byRate.set(b.rate, { base: b.base, amount: b.amount });
  return {
    number: doc.number,
    date: formatDateKeyEs(madridDayKey(doc.issuedAt)),
    type: FISCAL_KIND_LABEL[doc.kind],
    rectifies: doc.rectifies,
    client: doc.clientName,
    nif: doc.clientNif,
    byRate,
    base: doc.base,
    tax: doc.tax,
    notSubject: doc.notSubject,
    total: doc.total,
    status: doc.status,
    counts: doc.counts,
  };
}

/** Una línea del libro por factura o abono. */
export function ledgerLine(inv: ExportInvoiceRow, originalNumbers: Map<number, string>): LedgerLine {
  return documentLedgerLine(invoiceDocument(inv, originalNumbers));
}

/** Orden del libro: por fecha de expedición y, a igual fecha, por número. */
export function sortForLedger<T extends Pick<ExportInvoiceRow, "issuedAt" | "invoiceNumber">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.invoiceNumber.localeCompare(b.invoiceNumber, "es", { numeric: true }));
}

const money = (n: number) => r2(n).toFixed(2).replace(".", ",");
const rateLabel = (rate: number) => `${String(rate).replace(".", ",")} %`;

function csvCell(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Evita que una hoja de cálculo interprete como fórmula un texto escrito por un cliente. */
function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/**
 * Libro de facturas emitidas: separador `;`, decimales con coma y BOM UTF-8 (Excel en español). Una
 * columna de base y otra de cuota por cada tipo de IVA presente en el periodo, y una fila de totales con
 * lo que cuenta (sin las facturas anuladas ni los tickets sustituidos, anulados o devueltos). Los tickets de
 * caja del periodo (facturas simplificadas) van en el mismo libro, ordenados por fecha.
 */
export function buildInvoiceLedgerCsv(rows: ExportInvoiceRow[], originalNumbers: Map<number, string>, tickets: FiscalDocument[] = []): string {
  const docs = sortFiscalDocuments([...rows.map((r) => invoiceDocument(r, originalNumbers)), ...tickets]);
  const lines = docs.map(documentLedgerLine);
  const rates = Array.from(new Set(lines.flatMap((l) => Array.from(l.byRate.keys())))).sort((a, b) => b - a);
  const header = [
    "Número", "Fecha de expedición", "Tipo", "Factura rectificada", "Cliente", "NIF",
    ...rates.flatMap((r) => [`Base ${rateLabel(r)}`, `Cuota IVA ${rateLabel(r)}`]),
    "Base imponible total", "Cuota IVA total", "Importe no sujeto o exento", "Total", "Estado",
  ];
  const body = lines.map((l) => [
    safeText(l.number), l.date, l.type, safeText(l.rectifies), safeText(l.client), safeText(l.nif),
    ...rates.flatMap((r) => {
      const b = l.byRate.get(r);
      return b ? [money(b.base), money(b.amount)] : ["", ""];
    }),
    money(l.base), money(l.tax), money(l.notSubject), money(l.total), l.status,
  ]);
  const sum = (f: (l: LedgerLine) => number) => money(lines.reduce((s, l) => s + (l.counts ? f(l) : 0), 0));
  const totals = [
    "TOTAL", "", "", "", `${lines.length} documentos`, "",
    ...rates.flatMap((r) => [sum((l) => l.byRate.get(r)?.base ?? 0), sum((l) => l.byRate.get(r)?.amount ?? 0)]),
    sum((l) => l.base), sum((l) => l.tax), sum((l) => l.notSubject), sum((l) => l.total), "",
  ];
  const all = [header, ...body, ...(lines.length ? [totals] : [])];
  return "﻿" + all.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** Nombre de fichero seguro a partir del número del documento. */
export function documentFileName(invoiceNumber: string): string {
  const safe = invoiceNumber.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${safe || "documento"}.pdf`;
}

export interface GestoriaZipInput {
  companyName: string;
  period: ResolvedExportPeriod;
  rows: ExportInvoiceRow[];
  originalNumbers: Map<number, string>;
  /** Tickets de caja del periodo (facturas simplificadas): van en el libro; no tienen PDF propio. */
  tickets?: FiscalDocument[];
  /** PDF del documento tal como se expidió. Si falla, el documento queda en el libro y se avisa en LEEME. */
  pdfFor: (row: ExportInvoiceRow) => Promise<Buffer>;
  generatedAt?: Date;
}

export interface GestoriaZipResult {
  buffer: Buffer;
  fileName: string;
  invoices: number;
  creditNotes: number;
  tickets: number;
  missingPdfs: string[];
}

export class ExportTooLargeError extends Error {}

export async function buildGestoriaInvoiceZip(input: GestoriaZipInput): Promise<GestoriaZipResult> {
  if (input.rows.length > MAX_EXPORT_DOCUMENTS) {
    throw new ExportTooLargeError(
      `El periodo tiene ${input.rows.length} documentos y el máximo por exportación es ${MAX_EXPORT_DOCUMENTS}. Exporta por meses o con un rango más corto.`,
    );
  }
  const rows = sortForLedger(input.rows);
  const zip = new JSZip();
  const used = new Set<string>();
  const missing: string[] = [];
  let invoices = 0;
  let creditNotes = 0;
  for (const row of rows) {
    const folder = row.invoiceType === "abono" ? "Abonos" : "Facturas";
    if (row.invoiceType === "abono") creditNotes++;
    else invoices++;
    let name = `${folder}/${documentFileName(row.invoiceNumber)}`;
    for (let i = 2; used.has(name); i++) name = `${folder}/${documentFileName(row.invoiceNumber).replace(/\.pdf$/, "")}_${i}.pdf`;
    used.add(name);
    try {
      zip.file(name, await input.pdfFor(row));
    } catch {
      missing.push(row.invoiceNumber);
    }
  }
  const tickets = input.tickets ?? [];
  const substituted = tickets.filter((t) => t.substitutedBy);
  zip.file(`libro_facturas_emitidas_${input.period.key}.csv`, buildInvoiceLedgerCsv(rows, input.originalNumbers, tickets));

  const at = input.generatedAt ?? new Date();
  const readme = [
    `Facturas emitidas — ${input.companyName}`,
    `Periodo: ${input.period.label} (${formatDateKeyEs(input.period.from)} a ${formatDateKeyEs(input.period.to)}, hora de Madrid)`,
    `Preparado el ${formatDateKeyEs(madridDayKey(at))}`,
    "",
    `Facturas: ${invoices}`,
    `Abonos (facturas rectificativas): ${creditNotes}`,
    `Tickets de caja (facturas simplificadas): ${tickets.length}${substituted.length ? ` (${substituted.length} ${substituted.length === 1 ? "sustituido" : "sustituidos"} por su factura completa)` : ""}`,
    "",
    "Contenido:",
    "  Facturas/  PDF de cada factura emitida en el periodo.",
    "  Abonos/    PDF de cada abono emitido en el periodo.",
    `  libro_facturas_emitidas_${input.period.key}.csv  Libro de facturas emitidas (separador «;», decimales con coma). Los abonos figuran en negativo.`,
    ...(tickets.length
      ? [
          "",
          "Tickets de caja:",
          "  Cada ticket de caja es una factura simplificada y figura en el libro con el tipo «Factura simplificada / ticket».",
          "  Sus PDF no se incluyen: el ticket se imprime y se entrega en la caja al cobrar.",
          "  Para no contar dos veces una misma venta: si una venta de caja tiene, además de su ticket, una factura",
          "  completa (al cobrar con tarjeta o al canjear el ticket por una factura), cuenta la factura y el ticket",
          "  figura como «Sustituido por» esa factura, sin importe. Los tickets anulados o devueltos figuran sin importe.",
          "  La fila TOTAL suma solo lo que cuenta: sin facturas anuladas ni tickets sustituidos, anulados o devueltos.",
        ]
      : []),
    ...(rows.length === 0 && tickets.length === 0 ? ["", "No hay facturas ni abonos emitidos en este periodo."] : []),
    ...(missing.length
      ? ["", "ATENCIÓN: no se pudo incluir el PDF de estos documentos (sí figuran en el libro). Descárgalos uno a uno desde Facturación:", ...missing.map((n) => `  - ${n}`)]
      : []),
    "",
  ].join("\r\n");
  zip.file("LEEME.txt", readme);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, fileName: `facturas_gestoria_${input.period.key}.zip`, invoices, creditNotes, tickets: tickets.length, missingPdfs: missing };
}
