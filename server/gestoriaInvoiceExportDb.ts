/**
 * Lectura de la exportación para la gestoría: facturas y abonos expedidos en el periodo, siempre de la
 * base de datos de la empresa en curso (legacyDb resuelve la del contexto de la petición y falla si no
 * hay ninguna: nunca lee de otra empresa), y el PDF de cada documento tal como se expidió.
 */
import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { invoices } from "../drizzle/schema";
import { legacyDb } from "./_core/legacyDb";
import { madridEndOfDayUtc, madridStartOfDayUtc } from "./utils/timezone";
import { madridDayKey, type ResolvedExportPeriod } from "../shared/gestoriaExportPeriod";
import type { ExportInvoiceRow } from "./gestoriaInvoiceExport";
import type { FiscalDocument } from "./fiscalDocuments";
import { listTicketDocuments, madridDayRange } from "./fiscalDocumentsDb";

const db = legacyDb();

type StoredInvoice = typeof invoices.$inferSelect;

/** Documentos expedidos (fecha de expedición en Madrid) dentro del periodo, con su fila completa. */
export async function listInvoicesForExport(period: ResolvedExportPeriod): Promise<StoredInvoice[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(gte(invoices.issuedAt, madridStartOfDayUtc(period.from)), lte(invoices.issuedAt, madridEndOfDayUtc(period.to))))
    .orderBy(asc(invoices.issuedAt), asc(invoices.id));
  // Segunda comprobación con el día de Madrid: el periodo es de calendario español, no del servidor
  return rows.filter((r) => {
    const day = madridDayKey(r.issuedAt);
    return day >= period.from && day <= period.to;
  });
}

/**
 * Tickets de caja (facturas simplificadas) del periodo, para el libro: con la misma regla que Informes y el
 * Modelo 303; el de una venta que tiene factura completa figura como sustituido, sin importe.
 */
export async function listTicketsForExport(period: ResolvedExportPeriod): Promise<FiscalDocument[]> {
  return listTicketDocuments(madridDayRange(period.from, period.to));
}

/** Número de las facturas que rectifican los abonos (pueden ser de un periodo anterior). */
export async function originalInvoiceNumbers(rows: Pick<StoredInvoice, "creditNoteForId">[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.creditNoteForId).filter((v): v is number => typeof v === "number")));
  if (!ids.length) return new Map();
  const found = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(inArray(invoices.id, ids));
  return new Map(found.map((f) => [f.id, f.invoiceNumber]));
}

const parseJson = <T>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

export function toExportRow(r: StoredInvoice): ExportInvoiceRow {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    invoiceType: r.invoiceType,
    status: r.status,
    clientName: r.clientName,
    clientNif: r.clientNif,
    itemsJson: parseJson(r.itemsJson),
    subtotal: r.subtotal,
    taxRate: r.taxRate,
    taxAmount: r.taxAmount,
    taxBreakdown: parseJson(r.taxBreakdown),
    total: r.total,
    creditNoteForId: r.creditNoteForId,
    issuedAt: r.issuedAt,
  };
}

/**
 * PDF del documento expedido: el guardado de la empresa si existe; si no (empresa sin almacenamiento de
 * ficheros o documento que nunca lo tuvo), el mismo documento que sirve la vista de la factura, generado
 * con los datos guardados — sin recalcular importes ni datos fiscales.
 */
export async function storedInvoicePdf(r: StoredInvoice): Promise<Buffer> {
  if (r.pdfUrl) {
    const { readStoredFile } = await import("./storage");
    const stored = await readStoredFile(r.pdfUrl);
    if (stored && stored.data.length > 0 && /pdf/i.test(stored.contentType)) return stored.data;
  }
  const { buildInvoiceHtml } = await import("./invoiceHtml");
  const { htmlToPdf } = await import("./pdfGenerator");
  const html = await buildInvoiceHtml({
    invoiceNumber: r.invoiceNumber,
    clientName: r.clientName,
    clientEmail: r.clientEmail,
    clientPhone: r.clientPhone,
    clientNif: r.clientNif,
    clientAddress: r.clientAddress,
    itemsJson: parseJson<any[]>(r.itemsJson) ?? [],
    subtotal: r.subtotal,
    discount: r.discount ?? null,
    discountReason: r.discountReason ?? null,
    taxRate: r.taxRate ?? "21",
    taxAmount: r.taxAmount ?? "0",
    taxBreakdown: parseJson<{ rate: number; base: number; amount: number }[]>(r.taxBreakdown) ?? undefined,
    total: r.total,
    issuedAt: r.issuedAt,
  });
  return htmlToPdf(html);
}
