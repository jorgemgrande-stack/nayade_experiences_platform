/**
 * Exportación de facturas para la gestoría: un ZIP con el PDF de cada factura y abono expedidos en el
 * periodo y el libro de facturas emitidas en CSV.
 *
 * Todo sale de lo que ya está guardado de cada documento (número, fecha, cliente, NIF, desglose por tipo
 * de IVA, total): aquí no se recalcula ningún dato fiscal. El PDF lo aporta quien llama (el guardado de la
 * factura o, si no hay, el que genera el sistema con esos mismos datos), así que estas funciones son puras
 * y se prueban sin base de datos.
 */
import JSZip from "jszip";
import { groupTaxBreakdown } from "./taxUtils";
import { formatDateKeyEs, madridDayKey, type ResolvedExportPeriod } from "../shared/gestoriaExportPeriod";

/** Tope de documentos por ZIP: cada uno lleva su PDF; un periodo mayor se divide (mes o rango). */
export const MAX_EXPORT_DOCUMENTS = 250;

/** Lo que se lee de cada factura guardada. */
export interface ExportInvoiceRow {
  id: number;
  invoiceNumber: string;
  invoiceType: "factura" | "abono";
  status: string;
  clientName: string;
  clientNif: string | null;
  itemsJson: { total: number; fiscalRegime?: string; taxRate?: number }[] | null;
  taxRate: string | null;
  taxAmount: string | null;
  taxBreakdown: { rate: number; base: number; amount: number }[] | null;
  total: string;
  creditNoteForId: number | null;
  issuedAt: Date;
}

export interface LedgerLine {
  number: string;
  date: string;
  type: "Factura" | "Abono";
  rectifies: string;
  client: string;
  nif: string;
  byRate: Map<number, { base: number; amount: number }>;
  base: number;
  tax: number;
  notSubject: number;
  total: number;
  status: string;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 + 0;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const STATUS_LABEL: Record<string, string> = {
  generada: "Emitida",
  enviada: "Enviada",
  cobrada: "Cobrada",
  anulada: "Anulada",
  abonada: "Abonada",
};

/**
 * Desglose por tipo de IVA del documento: el guardado; si no lo hay (documentos antiguos), el de sus
 * líneas cuando cuadra con el total guardado; si tampoco, un único tipo con la cuota guardada.
 */
export function storedBreakdown(inv: ExportInvoiceRow): { rate: number; base: number; amount: number }[] {
  const stored = Array.isArray(inv.taxBreakdown) ? inv.taxBreakdown.filter((b) => b && Number.isFinite(Number(b.rate))) : [];
  if (stored.length) return stored.map((b) => ({ rate: num(b.rate), base: num(b.base), amount: num(b.amount) }));
  const total = num(inv.total);
  const items = Array.isArray(inv.itemsJson) ? inv.itemsJson : [];
  if (items.length) {
    const fromLines = groupTaxBreakdown(items);
    const sum = fromLines.reduce((s, b) => s + Math.abs(b.base) + Math.abs(b.amount), 0);
    const reav = items.filter((i) => i.fiscalRegime === "reav").reduce((s, i) => s + Math.abs(num(i.total)), 0);
    if (fromLines.length && Math.abs(sum + reav - Math.abs(total)) <= 0.02) return fromLines;
  }
  const tax = num(inv.taxAmount);
  return [{ rate: num(inv.taxRate ?? 0), base: r2(Math.abs(total) - Math.abs(tax)), amount: Math.abs(tax) }];
}

/** Una línea del libro por documento. Los abonos van siempre en negativo, como restan en la declaración. */
export function ledgerLine(inv: ExportInvoiceRow, originalNumbers: Map<number, string>): LedgerLine {
  const isCredit = inv.invoiceType === "abono";
  const fix = (n: number) => r2(isCredit ? -Math.abs(n) : n);
  const byRate = new Map<number, { base: number; amount: number }>();
  for (const b of storedBreakdown(inv)) {
    const prev = byRate.get(b.rate) ?? { base: 0, amount: 0 };
    byRate.set(b.rate, { base: r2(prev.base + fix(b.base)), amount: r2(prev.amount + fix(b.amount)) });
  }
  const base = r2(Array.from(byRate.values()).reduce((s, b) => s + b.base, 0));
  const tax = r2(Array.from(byRate.values()).reduce((s, b) => s + b.amount, 0));
  const total = fix(num(inv.total));
  const notSubject = r2(total - base - tax);
  return {
    number: inv.invoiceNumber,
    date: formatDateKeyEs(madridDayKey(inv.issuedAt)),
    type: isCredit ? "Abono" : "Factura",
    rectifies: isCredit && inv.creditNoteForId ? originalNumbers.get(inv.creditNoteForId) ?? "" : "",
    client: inv.clientName ?? "",
    nif: inv.clientNif ?? "",
    byRate,
    base,
    tax,
    notSubject: Math.abs(notSubject) < 0.005 ? 0 : notSubject,
    total,
    status: STATUS_LABEL[inv.status] ?? inv.status,
  };
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
 * columna de base y otra de cuota por cada tipo de IVA presente en el periodo, y una fila de totales.
 */
export function buildInvoiceLedgerCsv(rows: ExportInvoiceRow[], originalNumbers: Map<number, string>): string {
  const lines = sortForLedger(rows).map((r) => ledgerLine(r, originalNumbers));
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
  const sum = (f: (l: LedgerLine) => number) => money(lines.reduce((s, l) => s + f(l), 0));
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
  /** PDF del documento tal como se expidió. Si falla, el documento queda en el libro y se avisa en LEEME. */
  pdfFor: (row: ExportInvoiceRow) => Promise<Buffer>;
  generatedAt?: Date;
}

export interface GestoriaZipResult {
  buffer: Buffer;
  fileName: string;
  invoices: number;
  creditNotes: number;
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
  zip.file(`libro_facturas_emitidas_${input.period.key}.csv`, buildInvoiceLedgerCsv(rows, input.originalNumbers));

  const at = input.generatedAt ?? new Date();
  const readme = [
    `Facturas emitidas — ${input.companyName}`,
    `Periodo: ${input.period.label} (${formatDateKeyEs(input.period.from)} a ${formatDateKeyEs(input.period.to)}, hora de Madrid)`,
    `Preparado el ${formatDateKeyEs(madridDayKey(at))}`,
    "",
    `Facturas: ${invoices}`,
    `Abonos (facturas rectificativas): ${creditNotes}`,
    "",
    "Contenido:",
    "  Facturas/  PDF de cada factura emitida en el periodo.",
    "  Abonos/    PDF de cada abono emitido en el periodo.",
    `  libro_facturas_emitidas_${input.period.key}.csv  Libro de facturas emitidas (separador «;», decimales con coma). Los abonos figuran en negativo.`,
    ...(rows.length === 0 ? ["", "No hay facturas ni abonos emitidos en este periodo."] : []),
    ...(missing.length
      ? ["", "ATENCIÓN: no se pudo incluir el PDF de estos documentos (sí figuran en el libro). Descárgalos uno a uno desde Facturación:", ...missing.map((n) => `  - ${n}`)]
      : []),
    "",
  ].join("\r\n");
  zip.file("LEEME.txt", readme);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, fileName: `facturas_gestoria_${input.period.key}.zip`, invoices, creditNotes, missingPdfs: missing };
}
