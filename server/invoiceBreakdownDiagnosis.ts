/**
 * Diagnóstico (SOLO LECTURA) del desglose fiscal de las facturas ya emitidas de una empresa. Lo usa
 * `scripts/diagnostico/facturas-desglose.ts`. Nunca escribe: los documentos emitidos no se modifican ni se
 * regeneran; esto solo señala cuáles revisar con la gestoría.
 *
 * Señales:
 *  - base_mas_iva_distinto_total: base imponible + IVA guardados no suman el total del documento.
 *  - varios_tipos_sin_desglose: líneas con varios tipos de IVA y sin desglose por tipo guardado (los
 *    informes antiguos podían atribuir toda la base a un único tipo).
 *  - presupuesto_con_descuento: factura de un presupuesto con descuento global (el IVA pudo calcularse sobre
 *    las líneas sin descontar).
 *  - desglose_supera_total: el desglose guardado suma más que el total del documento.
 */
import type mysql from "mysql2/promise";
import { isReavLine } from "./taxUtils";
import { madridDayKey } from "../shared/gestoriaExportPeriod";

export type DiagnosisIssue = "base_mas_iva_distinto_total" | "varios_tipos_sin_desglose" | "presupuesto_con_descuento" | "desglose_supera_total";

export const ISSUE_LABEL: Record<DiagnosisIssue, string> = {
  base_mas_iva_distinto_total: "base + IVA no suman el total",
  varios_tipos_sin_desglose: "varios tipos de IVA sin desglose guardado",
  presupuesto_con_descuento: "factura de presupuesto con descuento",
  desglose_supera_total: "el desglose suma más que el total",
};

export interface DiagnosisRow {
  invoiceNumber: string;
  invoiceType: string | null;
  status: string | null;
  issuedAt: Date | string | null;
  quoteId: number | null;
  quoteDiscount: string | number | null;
  itemsJson: unknown;
  subtotal: string | number | null;
  discount: string | number | null;
  taxRate: string | number | null;
  taxAmount: string | number | null;
  taxBreakdown: unknown;
  total: string | number | null;
}

export interface DiagnosisFinding {
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  issuedAt: string;
  total: number;
  base: number;
  tax: number;
  rates: number[];
  issues: DiagnosisIssue[];
}

export interface DiagnosisReport {
  checked: number;
  findings: DiagnosisFinding[];
  byIssue: Record<DiagnosisIssue, number>;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const parse = (v: unknown) => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Señales de un documento emitido (vacío si no hay nada que revisar). */
export function diagnoseInvoice(row: DiagnosisRow): { issues: DiagnosisIssue[]; rates: number[] } {
  const items = (Array.isArray(parse(row.itemsJson)) ? parse(row.itemsJson) : []) as { total?: number; fiscalRegime?: string; taxRate?: number }[];
  const bdRaw = parse(row.taxBreakdown);
  const breakdown = (Array.isArray(bdRaw) ? bdRaw : []) as { rate: number; base: number; amount: number }[];
  const docRate = num(row.taxRate ?? 21);
  const rates = Array.from(new Set(items.filter((i) => !isReavLine(i)).map((i) => num(i.taxRate ?? docRate)))).sort((a, b) => b - a);
  const total = Math.abs(num(row.total));
  const issues: DiagnosisIssue[] = [];
  if (Math.abs(r2(Math.abs(num(row.subtotal)) + Math.abs(num(row.taxAmount))) - total) > 0.01) issues.push("base_mas_iva_distinto_total");
  if (rates.length > 1 && breakdown.length === 0) issues.push("varios_tipos_sin_desglose");
  const linesGross = r2(items.reduce((s, i) => s + Math.abs(num(i.total)), 0));
  if (row.quoteId && row.invoiceType !== "abono" && (num(row.quoteDiscount) > 0.004 || num(row.discount) > 0.004 || (items.length > 0 && linesGross - total > 0.01))) issues.push("presupuesto_con_descuento");
  if (breakdown.length && r2(breakdown.reduce((s, b) => s + Math.abs(num(b.base)) + Math.abs(num(b.amount)), 0)) - total > 0.01) issues.push("desglose_supera_total");
  return { issues, rates };
}

/** Lee las facturas y abonos emitidos de la BD conectada, en una transacción de solo lectura. */
export async function diagnoseInvoices(conn: mysql.Connection): Promise<DiagnosisReport> {
  await conn.query("START TRANSACTION READ ONLY");
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT i.invoiceNumber, i.invoiceType, i.status, i.issuedAt, i.quoteId, q.discount AS quoteDiscount,
              i.itemsJson, i.subtotal, i.discount, i.taxRate, i.taxAmount, i.taxBreakdown, i.total
         FROM invoices i LEFT JOIN quotes q ON q.id = i.quoteId
        ORDER BY i.issuedAt ASC, i.id ASC`,
    );
    const byIssue = { base_mas_iva_distinto_total: 0, varios_tipos_sin_desglose: 0, presupuesto_con_descuento: 0, desglose_supera_total: 0 } as Record<DiagnosisIssue, number>;
    const findings: DiagnosisFinding[] = [];
    for (const row of rows as unknown as DiagnosisRow[]) {
      const { issues, rates } = diagnoseInvoice(row);
      if (!issues.length) continue;
      for (const i of issues) byIssue[i] += 1;
      const issued = row.issuedAt instanceof Date ? madridDayKey(row.issuedAt) : String(row.issuedAt ?? "").slice(0, 10);
      findings.push({
        invoiceNumber: row.invoiceNumber,
        invoiceType: row.invoiceType ?? "factura",
        status: row.status ?? "",
        issuedAt: issued,
        total: num(row.total),
        base: num(row.subtotal),
        tax: num(row.taxAmount),
        rates,
        issues,
      });
    }
    return { checked: rows.length, findings, byIssue };
  } finally {
    await conn.query("ROLLBACK");
  }
}

/** Informe legible (sin datos de clientes: solo número, fecha, importes y señales). */
export function formatDiagnosis(r: DiagnosisReport): string {
  const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
  const out = [`Documentos revisados: ${r.checked}. Con algo que revisar: ${r.findings.length}.`];
  for (const k of Object.keys(r.byIssue) as DiagnosisIssue[]) out.push(`  - ${ISSUE_LABEL[k]}: ${r.byIssue[k]}`);
  for (const f of r.findings) {
    out.push(`${f.invoiceNumber} (${f.invoiceType}, ${f.status}, ${f.issuedAt}) total ${eur(f.total)} = base ${eur(f.base)} + IVA ${eur(f.tax)}`
      + `${f.rates.length ? ` · tipos ${f.rates.join(" %, ")} %` : ""} → ${f.issues.map((i) => ISSUE_LABEL[i]).join("; ")}`);
  }
  return out.join("\n");
}
