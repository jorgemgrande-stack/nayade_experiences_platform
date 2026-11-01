/**
 * invoicePreviewRouter.ts
 * GET /api/invoices/preview?n=FAC-2026-XXXX
 *
 * Genera y sirve el HTML de una factura on-demand desde BD.
 * No necesita almacenamiento externo — los datos están en la tabla `invoices`.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { invoices } from "../drizzle/schema";
import { buildInvoiceHtml } from "./invoiceHtml";
import { resolveSessionUser } from "./_core/expressAuth";
import { checkRbacOrLegacy } from "./_core/rbac";
import { verifyInvoiceLink } from "./_core/signedLinks";
import { legacyDb, legacyPool } from "./_core/legacyDb";

const _pool = legacyPool();
const db = legacyDb();

const invoicePreviewRouter = Router();

invoicePreviewRouter.get("/api/invoices/preview", async (req, res) => {
  const n = (req.query.n as string | undefined)?.trim();
  if (!n) {
    res.status(400).send("Parámetro 'n' (número de factura) requerido.");
    return;
  }

  // Acceso: enlace firmado (el número correlativo por sí solo es enumerable) o sesión del equipo.
  let allowed = verifyInvoiceLink(n, req.query.sig);
  if (!allowed) {
    const user = await resolveSessionUser(req);
    allowed =
      !!user &&
      user.isActive !== false &&
      (await checkRbacOrLegacy(user.id, String(user.role), "crm.view", ["admin", "agente"]));
  }
  if (!allowed) {
    res.status(401).send("Acceso no autorizado a la factura.");
    return;
  }

  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, n)).limit(1);
    if (!invoice) {
      res.status(404).send("Factura no encontrada.");
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
      discount: (invoice as any).discount ?? null,
      discountReason: (invoice as any).discountReason ?? (invoice as any).discount_reason ?? null,
      taxRate: invoice.taxRate ?? "21",
      taxAmount: invoice.taxAmount ?? "0",
      // Desglose por tipo guardado (con el descuento ya aplicado), no el recalculado desde las líneas
      taxBreakdown: (invoice.taxBreakdown as any) ?? undefined,
      total: invoice.total,
      issuedAt: invoice.issuedAt,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(html);
  } catch (err) {
    console.error("[InvoicePreview] Error:", err);
    res.status(500).send("Error al generar la vista de factura.");
  }
});

export default invoicePreviewRouter;

