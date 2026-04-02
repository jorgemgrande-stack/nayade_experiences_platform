/**
 * settlementExportRoutes.ts
 * Endpoint REST para exportar liquidaciones de proveedor en formato XLSX.
 * GET /api/settlements/:id/export-excel
 *
 * Genera un libro Excel con dos hojas:
 *   1. "Cabecera"  — datos generales de la liquidación y del proveedor
 *   2. "Líneas"    — detalle de cada servicio liquidado
 *
 * El archivo se sirve como descarga directa (Content-Disposition: attachment).
 */

import { Router, Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import {
  supplierSettlements,
  settlementLines,
  suppliers,
} from "../drizzle/schema";
import { verifySessionToken } from "./localAuth";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

const settlementExportRouter = Router();

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.cookie ?? "";
  const cookies = Object.fromEntries(
    raw.split(";").map(c => {
      const idx = c.indexOf("=");
      if (idx === -1) return [c.trim(), ""];
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
    })
  );
  const token = cookies["nayade_session"];
  if (!token) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const userId = await verifySessionToken(token);
  if (!userId) {
    res.status(401).json({ error: "Sesión inválida o expirada" });
    return;
  }
  next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// Crea una celda xlsx con estilo opcional
function mkCell(
  v: string | number,
  style?: Record<string, unknown>
): XLSX.CellObject {
  const c: XLSX.CellObject = {
    v,
    t: typeof v === "number" ? "n" : "s",
  };
  if (style) c.s = style;
  return c;
}

// Estilos predefinidos (xlsx usa objetos planos para `s`)
const S_TITLE = { font: { bold: true, sz: 14, color: { rgb: "1A3A6B" } } };
const S_SECTION = { font: { bold: true, sz: 11, color: { rgb: "1A3A6B" } } };
const S_LABEL = { font: { bold: true, sz: 10 } };
const S_TOTAL_LABEL = { font: { bold: true, sz: 12, color: { rgb: "7C3AED" } } };
const S_TOTAL_VALUE = { font: { bold: true, sz: 12, color: { rgb: "7C3AED" } }, numFmt: '#,##0.00 "€"' };
const S_COL_HEADER = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: "1A3A6B" } },
};
const S_TOT_CELL = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: "7C3AED" } },
};
const S_TOT_EUR = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: "7C3AED" } },
  numFmt: '#,##0.00 "€"',
};
const S_EUR = { numFmt: '#,##0.00 "€"' };
const S_PCT = { numFmt: '0.00"%"' };

// ─── Endpoint ─────────────────────────────────────────────────────────────────

settlementExportRouter.get(
  "/api/settlements/:id/export-excel",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    // ── Fetch settlement + supplier ──────────────────────────────────────────
    const [settlement] = await db
      .select({
        id: supplierSettlements.id,
        settlementNumber: supplierSettlements.settlementNumber,
        status: supplierSettlements.status,
        periodFrom: supplierSettlements.periodFrom,
        periodTo: supplierSettlements.periodTo,
        grossAmount: supplierSettlements.grossAmount,
        commissionAmount: supplierSettlements.commissionAmount,
        netAmountProvider: supplierSettlements.netAmountProvider,
        internalNotes: supplierSettlements.internalNotes,
        createdAt: supplierSettlements.createdAt,
        paidAt: supplierSettlements.paidAt,
        // Supplier
        supplierName: suppliers.fiscalName,
        supplierNif: suppliers.nif,
        supplierAddress: suppliers.fiscalAddress,
        supplierIban: suppliers.iban,
        supplierEmail: suppliers.adminEmail,
        supplierPhone: suppliers.phone,
      })
      .from(supplierSettlements)
      .leftJoin(suppliers, eq(supplierSettlements.supplierId, suppliers.id))
      .where(eq(supplierSettlements.id, id));

    if (!settlement) {
      res.status(404).json({ error: "Liquidación no encontrada" });
      return;
    }

    // ── Fetch lines ──────────────────────────────────────────────────────────
    const lines = await db
      .select()
      .from(settlementLines)
      .where(eq(settlementLines.settlementId, id));

    // ── Build workbook ───────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Cabecera ────────────────────────────────────────────────────
    const headerRows: XLSX.CellObject[][] = [
      [mkCell("LIQUIDACIÓN DE PROVEEDOR — NÁYADE EXPERIENCES", S_TITLE), mkCell(""), mkCell(""), mkCell("")],
      [mkCell(""), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("Número de liquidación", S_LABEL), mkCell(settlement.settlementNumber), mkCell(""), mkCell("")],
      [mkCell("Estado", S_LABEL), mkCell(settlement.status ?? "—"), mkCell(""), mkCell("")],
      [mkCell("Período desde", S_LABEL), mkCell(settlement.periodFrom ?? "—"), mkCell(""), mkCell("")],
      [mkCell("Período hasta", S_LABEL), mkCell(settlement.periodTo ?? "—"), mkCell(""), mkCell("")],
      [mkCell("Fecha de emisión", S_LABEL), mkCell(fmtDate(settlement.createdAt)), mkCell(""), mkCell("")],
      [mkCell("Fecha de abono", S_LABEL), mkCell(fmtDate(settlement.paidAt)), mkCell(""), mkCell("")],
      [mkCell(""), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("DATOS DEL PROVEEDOR", S_SECTION), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("Razón social", S_LABEL), mkCell(settlement.supplierName ?? "—"), mkCell(""), mkCell("")],
      [mkCell("NIF / CIF", S_LABEL), mkCell(settlement.supplierNif ?? "—"), mkCell(""), mkCell("")],
      [mkCell("Dirección fiscal", S_LABEL), mkCell(settlement.supplierAddress ?? "—"), mkCell(""), mkCell("")],
      [mkCell("IBAN", S_LABEL), mkCell(settlement.supplierIban ?? "—"), mkCell(""), mkCell("")],
      [mkCell("Email", S_LABEL), mkCell(settlement.supplierEmail ?? "—"), mkCell(""), mkCell("")],
      [mkCell("Teléfono", S_LABEL), mkCell(settlement.supplierPhone ?? "—"), mkCell(""), mkCell("")],
      [mkCell(""), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("RESUMEN ECONÓMICO", S_SECTION), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("Total venta bruta", S_LABEL), mkCell(fmt(settlement.grossAmount), S_EUR), mkCell(""), mkCell("")],
      [mkCell("Total comisión agencia", S_LABEL), mkCell(fmt(settlement.commissionAmount), S_EUR), mkCell(""), mkCell("")],
      [mkCell("NETO A ABONAR AL PROVEEDOR", S_TOTAL_LABEL), mkCell(fmt(settlement.netAmountProvider), S_TOTAL_VALUE), mkCell(""), mkCell("")],
      [mkCell(""), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("Notas internas", S_LABEL), mkCell(settlement.internalNotes ?? "—"), mkCell(""), mkCell("")],
      [mkCell(""), mkCell(""), mkCell(""), mkCell("")],
      [mkCell("Emisor", S_LABEL), mkCell("Náyade Experiences S.L."), mkCell(""), mkCell("")],
      [mkCell("Generado el", S_LABEL), mkCell(fmtDate(new Date())), mkCell(""), mkCell("")],
    ];

    const wsHeader = XLSX.utils.aoa_to_sheet(headerRows);
    wsHeader["!cols"] = [{ wch: 32 }, { wch: 42 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsHeader, "Cabecera");

    // ── Sheet 2: Líneas ──────────────────────────────────────────────────────
    const colHeaders = [
      "Servicio / Producto",
      "Fecha servicio",
      "Pax",
      "Tipo coste",
      "Venta bruta (€)",
      "Comisión %",
      "Comisión (€)",
      "Neto proveedor (€)",
      "Notas",
    ];

    const linesRows: XLSX.CellObject[][] = [
      colHeaders.map((h) => mkCell(h, S_COL_HEADER)),
    ];

    for (const l of lines) {
      linesRows.push([
        mkCell(l.productName ?? "—"),
        mkCell(l.serviceDate ?? "—"),
        mkCell(l.paxCount ?? 0),
        mkCell(l.costType ?? "—"),
        mkCell(fmt(l.saleAmount), S_EUR),
        mkCell(fmt(l.commissionPercent), S_PCT),
        mkCell(fmt(l.commissionAmount), S_EUR),
        mkCell(fmt(l.netAmountProvider), S_EUR),
        mkCell(l.notes ?? ""),
      ]);
    }

    // Fila de totales
    const totGross = lines.reduce((s, l) => s + fmt(l.saleAmount), 0);
    const totComm = lines.reduce((s, l) => s + fmt(l.commissionAmount), 0);
    const totNet = lines.reduce((s, l) => s + fmt(l.netAmountProvider), 0);
    const totalPax = lines.reduce((s, l) => s + (l.paxCount ?? 0), 0);

    linesRows.push([
      mkCell("TOTALES", S_TOT_CELL),
      mkCell("", S_TOT_CELL),
      mkCell(totalPax, S_TOT_CELL),
      mkCell("", S_TOT_CELL),
      mkCell(totGross, S_TOT_EUR),
      mkCell("", S_TOT_CELL),
      mkCell(totComm, S_TOT_EUR),
      mkCell(totNet, S_TOT_EUR),
      mkCell("", S_TOT_CELL),
    ]);

    const wsLines = XLSX.utils.aoa_to_sheet(linesRows);
    wsLines["!cols"] = [
      { wch: 32 }, // Servicio
      { wch: 14 }, // Fecha
      { wch: 6 },  // Pax
      { wch: 14 }, // Tipo coste
      { wch: 18 }, // Venta bruta
      { wch: 12 }, // Comisión %
      { wch: 18 }, // Comisión €
      { wch: 22 }, // Neto proveedor
      { wch: 32 }, // Notas
    ];
    XLSX.utils.book_append_sheet(wb, wsLines, "Líneas");

    // ── Serialize & send ─────────────────────────────────────────────────────
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `Liquidacion-${settlement.settlementNumber}-${settlement.periodFrom ?? "periodo"}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`
    );
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  }
);

export default settlementExportRouter;
