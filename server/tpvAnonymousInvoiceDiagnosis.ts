/**
 * Diagnóstico (SOLO LECTURA) de las facturas completas que la caja emitió sola al cobrar con tarjeta sin
 * destinatario identificado: a nombre de «Cliente TPV» o sin NIF del destinatario (art. 6 del RD 1619/2012).
 * Lo usa `scripts/diagnostico/facturas-cliente-tpv.ts`. Nunca escribe: los documentos emitidos no se modifican
 * ni se regeneran; esto solo los lista para que la gestoría decida (por ejemplo, rectificarlos).
 *
 * Señales:
 *  - nombre_generico: el destinatario es «Cliente TPV» (o está vacío).
 *  - sin_nif: la factura no lleva NIF del destinatario.
 * Solo facturas (no abonos) enlazadas a una venta de caja o a nombre de «Cliente TPV».
 */
import type mysql from "mysql2/promise";
import { ANONYMOUS_TICKET_NAME } from "../shared/ticketInvoice";
import { madridDayKey } from "../shared/gestoriaExportPeriod";

export type AnonymousInvoiceIssue = "nombre_generico" | "sin_nif";

export const ANONYMOUS_ISSUE_LABEL: Record<AnonymousInvoiceIssue, string> = {
  nombre_generico: `a nombre de «${ANONYMOUS_TICKET_NAME}»`,
  sin_nif: "sin NIF del destinatario",
};

export interface AnonymousInvoiceRow {
  invoiceNumber: string;
  status: string | null;
  issuedAt: Date | string | null;
  total: string | number | null;
  clientName: string | null;
  clientNif: string | null;
  ticketNumber: string | null;
  creditNotes: number | string | null;
}

export interface AnonymousInvoiceFinding {
  invoiceNumber: string;
  issuedOn: string;
  total: number;
  status: string;
  ticketNumber: string | null;
  /** Ya tiene algún abono que la rectifica. */
  hasCreditNote: boolean;
  issues: AnonymousInvoiceIssue[];
}

export interface AnonymousInvoiceReport {
  checked: number;
  findings: AnonymousInvoiceFinding[];
  total: number;
}

const isGeneric = (name: string | null) => {
  const n = (name ?? "").trim().toLowerCase();
  return !n || n === ANONYMOUS_TICKET_NAME.toLowerCase();
};

/** Señales de una factura (sin señales = válida en cuanto al destinatario). */
export function diagnoseAnonymousInvoice(row: AnonymousInvoiceRow): AnonymousInvoiceFinding {
  const issues: AnonymousInvoiceIssue[] = [];
  if (isGeneric(row.clientName)) issues.push("nombre_generico");
  if (!(row.clientNif ?? "").trim()) issues.push("sin_nif");
  const at = row.issuedAt ? new Date(row.issuedAt) : null;
  return {
    invoiceNumber: row.invoiceNumber,
    issuedOn: at && !Number.isNaN(at.getTime()) ? madridDayKey(at) : "",
    total: Math.round(Number(row.total ?? 0) * 100) / 100,
    status: row.status ?? "",
    ticketNumber: row.ticketNumber,
    hasCreditNote: Number(row.creditNotes ?? 0) > 0,
    issues,
  };
}

/** Lee (solo SELECT) las facturas de caja de la empresa conectada y devuelve las que no identifican al destinatario. */
export async function diagnoseAnonymousTpvInvoices(conn: Pick<mysql.Connection, "query">): Promise<AnonymousInvoiceReport> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT i.invoiceNumber, i.status, i.issuedAt, i.total, i.clientName, i.clientNif,
            (SELECT s.ticketNumber FROM tpv_sales s WHERE s.invoiceId = i.id ORDER BY s.id LIMIT 1) AS ticketNumber,
            (SELECT COUNT(*) FROM invoices a WHERE a.creditNoteForId = i.id) AS creditNotes
       FROM invoices i
      WHERE COALESCE(i.invoiceType, 'factura') = 'factura'
        AND (EXISTS (SELECT 1 FROM tpv_sales s WHERE s.invoiceId = i.id) OR LOWER(TRIM(i.clientName)) = LOWER(?))
      ORDER BY i.issuedAt, i.id`,
    [ANONYMOUS_TICKET_NAME],
  );
  const all = (rows as AnonymousInvoiceRow[]).map(diagnoseAnonymousInvoice);
  const findings = all.filter((f) => f.issues.length > 0);
  return { checked: all.length, findings, total: Math.round(findings.reduce((s, f) => s + f.total, 0) * 100) / 100 };
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Texto para la gestoría (sin datos de clientes: número, fecha, importe, ticket y señales). */
export function formatAnonymousDiagnosis(report: AnonymousInvoiceReport): string {
  if (!report.findings.length) return `Facturas de caja revisadas: ${report.checked}. Ninguna sin destinatario identificado.`;
  const lines = report.findings.map((f) =>
    `  ${f.invoiceNumber} · ${f.issuedOn} · ${eur(f.total)} · ${f.status}${f.ticketNumber ? ` · ticket ${f.ticketNumber}` : ""}${f.hasCreditNote ? " · ya tiene abono" : ""} · ${f.issues.map((i) => ANONYMOUS_ISSUE_LABEL[i]).join(", ")}`);
  return [
    `Facturas de caja revisadas: ${report.checked}. Sin destinatario identificado: ${report.findings.length} (${eur(report.total)}).`,
    ...lines,
    "No se ha modificado ningún documento. Decide con la gestoría cómo regularizarlas.",
  ].join("\n");
}
