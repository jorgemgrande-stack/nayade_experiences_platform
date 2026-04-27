/**
 * invoicePreviewRouter.ts
 * GET /api/invoices/preview?n=FAC-2026-XXXX
 *
 * Genera y sirve el HTML de una factura on-demand desde BD.
 * No necesita almacenamiento externo — los datos están en la tabla `invoices`.
 */

import { Router } from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { invoices } from "../drizzle/schema";
import { buildInvoiceHtml } from "./invoiceHtml";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const invoicePreviewRouter = Router();

invoicePreviewRouter.get("/api/invoices/preview", async (req, res) => {
  const n = (req.query.n as string | undefined)?.trim();
  if (!n) {
    res.status(400).send("Parámetro 'n' (número de factura) requerido.");
    return;
  }

  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, n)).limit(1);
    if (!invoice) {
      res.status(404).send(`Factura ${n} no encontrada.`);
      return;
    }

    const html = await buildInvoiceHtml({
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      clientPhone: invoice.clientPhone,
      clientNif: invoice.clientNif,
      clientAddress: invoice.clientAddress,
      itemsJson: (invoice.itemsJson as any[]) ?? [],
      subtotal: invoice.subtotal,
      taxRate: invoice.taxRate ?? "21",
      taxAmount: invoice.taxAmount ?? "0",
      total: invoice.total,
      issuedAt: invoice.issuedAt,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("[InvoicePreview] Error:", err);
    res.status(500).send("Error al generar la vista de factura.");
  }
});

export default invoicePreviewRouter;

