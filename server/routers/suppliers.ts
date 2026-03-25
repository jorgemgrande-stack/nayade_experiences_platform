/**
 * Router: Suppliers & Settlements (Liquidaciones Proveedores)
 * Módulo v7.0 — Gestión completa de proveedores y liquidaciones
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  suppliers,
  supplierSettlements,
  settlementLines,
  settlementDocuments,
  settlementStatusLog,
  experiences,
  packs,
  invoices,
  reservations,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { sendEmail } from "../mailer";
import { storagePut } from "../storage";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSettlementNumber(year: number, seq: number): string {
  return `LIQ-${year}-${String(seq).padStart(4, "0")}`;
}

async function generateSettlementPdfAndUpload(data: {
  settlementNumber: string;
  supplierName: string;
  supplierNif?: string | null;
  supplierAddress?: string | null;
  supplierIban?: string | null;
  periodFrom: string;
  periodTo: string;
  grossAmount: string;
  commissionAmount: string;
  netAmountProvider: string;
  lines: { productName: string | null; serviceDate: string | null; paxCount: number; saleAmount: string; commissionPercent: string; commissionAmount: string; netAmountProvider: string; notes: string | null }[];
  issuedAt: Date;
  internalNotes?: string | null;
}): Promise<{ url: string; key: string }> {
  const lineRows = data.lines.map((l) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${l.productName ?? "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${l.serviceDate ?? "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${l.paxCount}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${parseFloat(l.saleAmount).toFixed(2)} €</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${parseFloat(l.commissionPercent).toFixed(2)}%</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${parseFloat(l.commissionAmount).toFixed(2)} €</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${parseFloat(l.netAmountProvider).toFixed(2)} €</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 3px solid #1a3a6b; }
  .logo-area h1 { font-size: 28px; font-weight: 800; color: #1a3a6b; letter-spacing: -0.5px; }
  .logo-area p { color: #6b7280; font-size: 13px; margin-top: 4px; }
  .doc-meta { text-align: right; }
  .doc-meta .doc-num { font-size: 22px; font-weight: 700; color: #7c3aed; }
  .doc-meta .doc-date { color: #6b7280; font-size: 13px; margin-top: 4px; }
  .parties { display: flex; gap: 40px; margin-bottom: 32px; }
  .party { flex: 1; }
  .party h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .party p { font-size: 14px; line-height: 1.6; }
  .period-badge { display: inline-block; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 16px; font-size: 14px; color: #374151; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
  thead tr { background: #1a3a6b; color: #fff; }
  thead th { padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  .totals { margin-left: auto; width: 320px; }
  .totals tr td { padding: 6px 12px; font-size: 14px; }
  .totals tr td:last-child { text-align: right; font-weight: 600; }
  .totals .total-row { background: #7c3aed; color: #fff; font-size: 16px; font-weight: 700; }
  .totals .total-row td { padding: 10px 12px; }
  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 12px; }
  .notes { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 13px; color: #374151; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <h1>NÁYADE EXPERIENCES</h1>
      <p>Los Ángeles de San Rafael, Segovia · reservas@nayadeexperiences.es</p>
      <p>CIF: [CIF_EMPRESA] · Tel: +34 930 34 77 91</p>
    </div>
    <div class="doc-meta">
      <div class="doc-num">LIQUIDACIÓN ${data.settlementNumber}</div>
      <div class="doc-date">Emitida: ${data.issuedAt.toLocaleDateString("es-ES")}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Emisor</h3>
      <p><strong>Náyade Experiences S.L.</strong><br/>
      Los Ángeles de San Rafael, Segovia<br/>
      CIF: [CIF_EMPRESA]</p>
    </div>
    <div class="party">
      <h3>Proveedor</h3>
      <p><strong>${data.supplierName}</strong><br/>
      ${data.supplierNif ? "NIF: " + data.supplierNif + "<br/>" : ""}
      ${data.supplierAddress ? data.supplierAddress + "<br/>" : ""}
      ${data.supplierIban ? "IBAN: " + data.supplierIban : ""}</p>
    </div>
  </div>

  <div class="period-badge">
    📅 Período de liquidación: <strong>${data.periodFrom}</strong> — <strong>${data.periodTo}</strong>
  </div>

  <table>
    <thead>
      <tr>
        <th>Servicio / Producto</th>
        <th style="text-align:center">Fecha</th>
        <th style="text-align:center">Pax</th>
        <th style="text-align:right">Venta bruta</th>
        <th style="text-align:right">Comisión %</th>
        <th style="text-align:right">Comisión €</th>
        <th style="text-align:right">Neto proveedor</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <table class="totals">
    <tr><td>Total venta bruta</td><td>${parseFloat(data.grossAmount).toFixed(2)} €</td></tr>
    <tr><td>Total comisión agencia</td><td>- ${parseFloat(data.commissionAmount).toFixed(2)} €</td></tr>
    <tr class="total-row"><td>NETO A ABONAR AL PROVEEDOR</td><td>${parseFloat(data.netAmountProvider).toFixed(2)} €</td></tr>
  </table>

  ${data.internalNotes ? `<div class="notes"><strong>Notas:</strong> ${data.internalNotes}</div>` : ""}

  <div class="footer">
    <p>Náyade Experiences S.L. · www.nayadeexperiences.es</p>
    <p>Documento de liquidación de servicios prestados por el proveedor durante el período indicado.</p>
  </div>
</body>
</html>`;

  try {
    const { execSync } = await import("child_process");
    const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const tmpHtml = join(tmpdir(), `settlement-${Date.now()}.html`);
    const tmpPdf = join(tmpdir(), `settlement-${Date.now()}.pdf`);
    writeFileSync(tmpHtml, html);
    try {
      execSync(`manus-md-to-pdf ${tmpHtml} ${tmpPdf} 2>/dev/null || chromium-browser --headless --no-sandbox --disable-gpu --print-to-pdf=${tmpPdf} ${tmpHtml} 2>/dev/null`, { timeout: 15000 });
      const pdfBuffer = readFileSync(tmpPdf);
      unlinkSync(tmpHtml);
      unlinkSync(tmpPdf);
      const key = `settlements/${data.settlementNumber}-${Date.now()}.pdf`;
      const { url } = await storagePut(key, pdfBuffer, "application/pdf");
      return { url, key };
    } catch {
      unlinkSync(tmpHtml);
      try { unlinkSync(tmpPdf); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // Fallback: store HTML
  const key = `settlements/${data.settlementNumber}-${Date.now()}.html`;
  const { url } = await storagePut(key, Buffer.from(html), "text/html");
  return { url, key };
}

async function getNextSettlementSeq(year: number): Promise<number> {
  const prefix = `LIQ-${year}-`;
  const rows = await db
    .select({ num: supplierSettlements.settlementNumber })
    .from(supplierSettlements)
    .where(sql`${supplierSettlements.settlementNumber} LIKE ${prefix + "%"}`)
    .orderBy(desc(supplierSettlements.settlementNumber))
    .limit(1);
  if (rows.length === 0) return 1;
  const last = rows[0].num;
  const seq = parseInt(last.split("-").pop() ?? "0", 10);
  return seq + 1;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const supplierSchema = z.object({
  fiscalName: z.string().min(1),
  commercialName: z.string().optional(),
  nif: z.string().optional(),
  fiscalAddress: z.string().optional(),
  adminEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  contactPerson: z.string().optional(),
  iban: z.string().optional(),
  paymentMethod: z.enum(["transferencia", "confirming", "efectivo", "compensacion"]).default("transferencia"),
  standardCommissionPercent: z.number().min(0).max(100).default(0),
  internalNotes: z.string().optional(),
  status: z.enum(["activo", "inactivo", "bloqueado"]).default("activo"),
});

const settlementLineInput = z.object({
  reservationId: z.number().optional(),
  invoiceId: z.number().optional(),
  productId: z.number().optional(),
  productName: z.string().optional(),
  serviceDate: z.string().optional(),
  paxCount: z.number().min(1).default(1),
  saleAmount: z.number().min(0),
  commissionPercent: z.number().min(0).max(100),
  costType: z.enum(["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  notes: z.string().optional(),
});

// ─── Suppliers router ─────────────────────────────────────────────────────────

export const suppliersRouter = router({
  // ── List all suppliers ──────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["activo", "inactivo", "bloqueado", "all"]).default("all"),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      let rows = await db.select().from(suppliers).orderBy(suppliers.fiscalName);
      if (input?.status && input.status !== "all") {
        rows = rows.filter((r) => r.status === input.status);
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.fiscalName.toLowerCase().includes(q) ||
            (r.commercialName ?? "").toLowerCase().includes(q) ||
            (r.nif ?? "").toLowerCase().includes(q)
        );
      }
      return rows;
    }),

  // ── Get single supplier ─────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(suppliers).where(eq(suppliers.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado" });
      return row;
    }),

  // ── Create supplier ─────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(supplierSchema)
    .mutation(async ({ input }) => {
      const [result] = await db.insert(suppliers).values({
        fiscalName: input.fiscalName,
        commercialName: input.commercialName ?? null,
        nif: input.nif ?? null,
        fiscalAddress: input.fiscalAddress ?? null,
        adminEmail: input.adminEmail || null,
        phone: input.phone ?? null,
        contactPerson: input.contactPerson ?? null,
        iban: input.iban ?? null,
        paymentMethod: input.paymentMethod,
        standardCommissionPercent: String(input.standardCommissionPercent),
        internalNotes: input.internalNotes ?? null,
        status: input.status,
      });
      return { id: (result as any).insertId };
    }),

  // ── Update supplier ─────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(supplierSchema))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(suppliers).set({
        fiscalName: data.fiscalName,
        commercialName: data.commercialName ?? null,
        nif: data.nif ?? null,
        fiscalAddress: data.fiscalAddress ?? null,
        adminEmail: data.adminEmail || null,
        phone: data.phone ?? null,
        contactPerson: data.contactPerson ?? null,
        iban: data.iban ?? null,
        paymentMethod: data.paymentMethod,
        standardCommissionPercent: String(data.standardCommissionPercent),
        internalNotes: data.internalNotes ?? null,
        status: data.status,
      }).where(eq(suppliers.id, id));
      return { ok: true };
    }),

  // ── Delete supplier ─────────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(suppliers).where(eq(suppliers.id, input.id));
      return { ok: true };
    }),

  // ── Get products linked to supplier ─────────────────────────────────────────
  getProducts: protectedProcedure
    .input(z.object({ supplierId: z.number() }))
    .query(async ({ input }) => {
      const exps = await db
        .select({
          id: experiences.id,
          title: experiences.title,
          type: sql<string>`'experience'`,
          isSettlable: experiences.isSettlable,
          supplierCommissionPercent: experiences.supplierCommissionPercent,
          supplierCostType: experiences.supplierCostType,
          settlementFrequency: experiences.settlementFrequency,
        })
        .from(experiences)
        .where(eq(experiences.supplierId, input.supplierId));

      const pkgs = await db
        .select({
          id: packs.id,
          title: packs.title,
          type: sql<string>`'pack'`,
          isSettlable: packs.isSettlable,
          supplierCommissionPercent: packs.supplierCommissionPercent,
          supplierCostType: packs.supplierCostType,
          settlementFrequency: packs.settlementFrequency,
        })
        .from(packs)
        .where(eq(packs.supplierId, input.supplierId));

      return [...exps, ...pkgs];
    }),
});

// ─── Settlements router ───────────────────────────────────────────────────────

export const settlementsRouter = router({
  // ── List settlements ────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      supplierId: z.number().optional(),
      status: z.string().optional(),
      periodFrom: z.string().optional(),
      periodTo: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      let rows = await db
        .select({
          id: supplierSettlements.id,
          settlementNumber: supplierSettlements.settlementNumber,
          supplierId: supplierSettlements.supplierId,
          supplierName: suppliers.fiscalName,
          periodFrom: supplierSettlements.periodFrom,
          periodTo: supplierSettlements.periodTo,
          grossAmount: supplierSettlements.grossAmount,
          commissionAmount: supplierSettlements.commissionAmount,
          netAmountProvider: supplierSettlements.netAmountProvider,
          status: supplierSettlements.status,
          pdfUrl: supplierSettlements.pdfUrl,
          sentAt: supplierSettlements.sentAt,
          paidAt: supplierSettlements.paidAt,
          createdAt: supplierSettlements.createdAt,
        })
        .from(supplierSettlements)
        .leftJoin(suppliers, eq(supplierSettlements.supplierId, suppliers.id))
        .orderBy(desc(supplierSettlements.createdAt));

      if (input?.supplierId) {
        rows = rows.filter((r) => r.supplierId === input.supplierId);
      }
      if (input?.status && input.status !== "all") {
        rows = rows.filter((r) => r.status === input.status);
      }
      if (input?.periodFrom) {
        rows = rows.filter((r) => r.periodFrom >= input.periodFrom!);
      }
      if (input?.periodTo) {
        rows = rows.filter((r) => r.periodTo <= input.periodTo!);
      }
      return rows;
    }),

  // ── Get single settlement with lines and docs ───────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [settlement] = await db
        .select({
          id: supplierSettlements.id,
          settlementNumber: supplierSettlements.settlementNumber,
          supplierId: supplierSettlements.supplierId,
          supplierName: suppliers.fiscalName,
          supplierNif: suppliers.nif,
          supplierIban: suppliers.iban,
          supplierEmail: suppliers.adminEmail,
          periodFrom: supplierSettlements.periodFrom,
          periodTo: supplierSettlements.periodTo,
          grossAmount: supplierSettlements.grossAmount,
          commissionAmount: supplierSettlements.commissionAmount,
          netAmountProvider: supplierSettlements.netAmountProvider,
          currency: supplierSettlements.currency,
          status: supplierSettlements.status,
          pdfUrl: supplierSettlements.pdfUrl,
          sentAt: supplierSettlements.sentAt,
          paidAt: supplierSettlements.paidAt,
          internalNotes: supplierSettlements.internalNotes,
          createdAt: supplierSettlements.createdAt,
          updatedAt: supplierSettlements.updatedAt,
        })
        .from(supplierSettlements)
        .leftJoin(suppliers, eq(supplierSettlements.supplierId, suppliers.id))
        .where(eq(supplierSettlements.id, input.id));

      if (!settlement) throw new TRPCError({ code: "NOT_FOUND", message: "Liquidación no encontrada" });

      const lines = await db
        .select()
        .from(settlementLines)
        .where(eq(settlementLines.settlementId, input.id))
        .orderBy(settlementLines.serviceDate);

      const docs = await db
        .select()
        .from(settlementDocuments)
        .where(eq(settlementDocuments.settlementId, input.id))
        .orderBy(desc(settlementDocuments.createdAt));

      const statusHistory = await db
        .select()
        .from(settlementStatusLog)
        .where(eq(settlementStatusLog.settlementId, input.id))
        .orderBy(desc(settlementStatusLog.createdAt));

      return { ...settlement, lines, docs, statusHistory };
    }),

  // ── Preview: calculate lines for a period before creating ──────────────────
  preview: protectedProcedure
    .input(z.object({
      supplierId: z.number(),
      periodFrom: z.string(),
      periodTo: z.string(),
    }))
    .query(async ({ input }) => {
      // Get all products (experiences + packs) linked to this supplier that are settlable
      const supplierExps = await db
        .select({ id: experiences.id, title: experiences.title, supplierCommissionPercent: experiences.supplierCommissionPercent, supplierCostType: experiences.supplierCostType })
        .from(experiences)
        .where(and(eq(experiences.supplierId, input.supplierId), eq(experiences.isSettlable, true)));

      const supplierPacks = await db
        .select({ id: packs.id, title: packs.title, supplierCommissionPercent: packs.supplierCommissionPercent, supplierCostType: packs.supplierCostType })
        .from(packs)
        .where(and(eq(packs.supplierId, input.supplierId), eq(packs.isSettlable, true)));

      const productIds = [
        ...supplierExps.map((e) => ({ id: e.id, type: "experience" as const, title: e.title, commissionPercent: parseFloat(e.supplierCommissionPercent ?? "0"), costType: e.supplierCostType ?? "comision_sobre_venta" })),
        ...supplierPacks.map((p) => ({ id: p.id, type: "pack" as const, title: p.title, commissionPercent: parseFloat(p.supplierCommissionPercent ?? "0"), costType: p.supplierCostType ?? "comision_sobre_venta" })),
      ];

      if (productIds.length === 0) return { lines: [], totals: { grossAmount: 0, commissionAmount: 0, netAmountProvider: 0 } };

      const productIdSet = new Set(productIds.map((p) => p.id));
      const periodFromMs = new Date(input.periodFrom).getTime();
      const periodToMs = new Date(input.periodTo + "T23:59:59").getTime();

      // Build lines from invoice items (facturas cobradas) that match supplier products
      const lines: Array<{
        reservationId?: number;
        invoiceId?: number;
        productId: number;
        productName: string;
        serviceDate: string;
        paxCount: number;
        saleAmount: number;
        commissionPercent: number;
        commissionAmount: number;
        netAmountProvider: number;
        costType: string;
        source: "invoice" | "tpv_reservation";
      }> = [];

      // ── SOURCE 1: Facturas cobradas en el periodo ──────────────────────────
      const paidInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.status, "cobrada"),
            gte(invoices.createdAt, new Date(input.periodFrom)),
            lte(invoices.createdAt, new Date(input.periodTo + "T23:59:59"))
          )
        );

      for (const inv of paidInvoices) {
        const items = (inv.itemsJson as any[]) ?? [];
        for (const item of items) {
          const productId = item.productId ?? item.experienceId ?? item.packId;
          const match = productIds.find((p) => p.id === productId);
          if (!match) continue;

          const saleAmount = parseFloat(String(item.unitPrice ?? item.price ?? "0")) * (item.quantity ?? 1);
          const commissionAmount = (saleAmount * match.commissionPercent) / 100;
          const netAmountProvider = saleAmount - commissionAmount;

          lines.push({
            invoiceId: inv.id,
            reservationId: inv.reservationId ?? undefined,
            productId: match.id,
            productName: item.description ?? match.title,
            serviceDate: input.periodFrom,
            paxCount: item.quantity ?? 1,
            saleAmount,
            commissionPercent: match.commissionPercent,
            commissionAmount,
            netAmountProvider,
            costType: match.costType,
            source: "invoice",
          });
        }
      }

      // ── SOURCE 2: Reservas TPV pagadas en el periodo (sin factura formal) ──
      // TPV reservations store items in extras_json; they may not have a formal invoice
      const tpvReservations = await db
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.status, "paid"),
            eq(reservations.channel, "tpv"),
            gte(reservations.paidAt, periodFromMs),
            lte(reservations.paidAt, periodToMs)
          )
        );

      // Track which invoice IDs we already processed to avoid double-counting
      const processedInvoiceIds = new Set(paidInvoices.map((i) => i.id));

      for (const res of tpvReservations) {
        // Skip if this reservation already has a formal invoice that was processed above
        if (res.invoiceId && processedInvoiceIds.has(res.invoiceId)) continue;

        let items: any[] = [];
        try {
          items = JSON.parse(res.extrasJson ?? "[]");
        } catch {
          // If extras_json is invalid, fall back to the main product
          items = [{ productId: res.productId, productName: res.productName, unitPrice: (res.amountPaid ?? 0) / 100, quantity: res.people }];
        }

        for (const item of items) {
          const productId = item.productId ?? item.experienceId ?? item.packId;
          if (!productId || !productIdSet.has(productId)) continue;
          const match = productIds.find((p) => p.id === productId);
          if (!match) continue;

          const unitPrice = parseFloat(String(item.unitPrice ?? item.price ?? "0"));
          const quantity = item.quantity ?? item.participants ?? 1;
          const saleAmount = unitPrice * quantity;
          if (saleAmount <= 0) continue;

          const commissionAmount = (saleAmount * match.commissionPercent) / 100;
          const netAmountProvider = saleAmount - commissionAmount;

          lines.push({
            reservationId: res.id,
            invoiceId: res.invoiceId ?? undefined,
            productId: match.id,
            productName: item.productName ?? item.description ?? match.title,
            serviceDate: res.bookingDate ?? input.periodFrom,
            paxCount: quantity,
            saleAmount,
            commissionPercent: match.commissionPercent,
            commissionAmount,
            netAmountProvider,
            costType: match.costType,
            source: "tpv_reservation",
          });
        }
      }

      const totals = lines.reduce(
        (acc, l) => ({
          grossAmount: acc.grossAmount + l.saleAmount,
          commissionAmount: acc.commissionAmount + l.commissionAmount,
          netAmountProvider: acc.netAmountProvider + l.netAmountProvider,
        }),
        { grossAmount: 0, commissionAmount: 0, netAmountProvider: 0 }
      );

      return { lines, totals };
    }),

  // ── Create settlement ───────────────────────────────────────────────────────
  create: protectedProcedure
    .input(z.object({
      supplierId: z.number(),
      periodFrom: z.string(),
      periodTo: z.string(),
      lines: z.array(settlementLineInput),
      internalNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const year = new Date().getFullYear();
      const seq = await getNextSettlementSeq(year);
      const settlementNumber = generateSettlementNumber(year, seq);

      // Calculate totals
      const grossAmount = input.lines.reduce((s, l) => s + l.saleAmount, 0);
      const commissionAmount = input.lines.reduce((s, l) => {
        const comm = (l.saleAmount * l.commissionPercent) / 100;
        return s + comm;
      }, 0);
      const netAmountProvider = grossAmount - commissionAmount;

      // Insert settlement header
      const [result] = await db.insert(supplierSettlements).values({
        settlementNumber,
        supplierId: input.supplierId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        grossAmount: String(grossAmount.toFixed(2)),
        commissionAmount: String(commissionAmount.toFixed(2)),
        netAmountProvider: String(netAmountProvider.toFixed(2)),
        status: "emitida",
        internalNotes: input.internalNotes ?? null,
        createdBy: ctx.user.id,
      });
      const settlementId = (result as any).insertId;

      // Insert lines
      if (input.lines.length > 0) {
        await db.insert(settlementLines).values(
          input.lines.map((l) => {
            const commAmt = (l.saleAmount * l.commissionPercent) / 100;
            const netAmt = l.saleAmount - commAmt;
            return {
              settlementId,
              reservationId: l.reservationId ?? null,
              invoiceId: l.invoiceId ?? null,
              productId: l.productId ?? null,
              productName: l.productName ?? null,
              serviceDate: l.serviceDate ?? null,
              paxCount: l.paxCount,
              saleAmount: String(l.saleAmount.toFixed(2)),
              commissionPercent: String(l.commissionPercent.toFixed(2)),
              commissionAmount: String(commAmt.toFixed(2)),
              netAmountProvider: String(netAmt.toFixed(2)),
              costType: l.costType,
              notes: l.notes ?? null,
            };
          })
        );
      }

      // Log status
      await db.insert(settlementStatusLog).values({
        settlementId,
        fromStatus: null,
        toStatus: "emitida",
        changedBy: ctx.user.id,
        changedByName: ctx.user.name ?? "Admin",
        notes: "Liquidación creada",
      });

      return { id: settlementId, settlementNumber };
    }),

  // ── Update status ───────────────────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["emitida", "pendiente_abono", "abonada", "incidencia", "recalculada"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [current] = await db
        .select({ status: supplierSettlements.status })
        .from(supplierSettlements)
        .where(eq(supplierSettlements.id, input.id));

      if (!current) throw new TRPCError({ code: "NOT_FOUND" });

      const updateData: Record<string, any> = { status: input.status };
      if (input.status === "abonada") updateData.paidAt = new Date();

      await db.update(supplierSettlements).set(updateData).where(eq(supplierSettlements.id, input.id));

      await db.insert(settlementStatusLog).values({
        settlementId: input.id,
        fromStatus: current.status,
        toStatus: input.status,
        changedBy: ctx.user.id,
        changedByName: ctx.user.name ?? "Admin",
        notes: input.notes ?? null,
      });

      return { ok: true };
    }),

  // ── Update notes ────────────────────────────────────────────────────────────
  updateNotes: protectedProcedure
    .input(z.object({ id: z.number(), internalNotes: z.string() }))
    .mutation(async ({ input }) => {
      await db.update(supplierSettlements).set({ internalNotes: input.internalNotes }).where(eq(supplierSettlements.id, input.id));
      return { ok: true };
    }),

  // ── Recalculate settlement lines ────────────────────────────────────────────
  // Deletes existing lines and regenerates them from the current data sources
  recalculate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Load settlement header
      const [settlement] = await db
        .select()
        .from(supplierSettlements)
        .where(eq(supplierSettlements.id, input.id));
      if (!settlement) throw new TRPCError({ code: "NOT_FOUND" });

      const { supplierId, periodFrom, periodTo } = settlement;

      // Get supplier products
      const supplierExps = await db
        .select({ id: experiences.id, title: experiences.title, supplierCommissionPercent: experiences.supplierCommissionPercent, supplierCostType: experiences.supplierCostType })
        .from(experiences)
        .where(and(eq(experiences.supplierId, supplierId), eq(experiences.isSettlable, true)));

      const supplierPacks = await db
        .select({ id: packs.id, title: packs.title, supplierCommissionPercent: packs.supplierCommissionPercent, supplierCostType: packs.supplierCostType })
        .from(packs)
        .where(and(eq(packs.supplierId, supplierId), eq(packs.isSettlable, true)));

      const productIds = [
        ...supplierExps.map((e) => ({ id: e.id, title: e.title, commissionPercent: parseFloat(e.supplierCommissionPercent ?? "0"), costType: e.supplierCostType ?? "comision_sobre_venta" })),
        ...supplierPacks.map((p) => ({ id: p.id, title: p.title, commissionPercent: parseFloat(p.supplierCommissionPercent ?? "0"), costType: p.supplierCostType ?? "comision_sobre_venta" })),
      ];

      const productIdSet = new Set(productIds.map((p) => p.id));
      const periodFromMs = new Date(periodFrom).getTime();
      const periodToMs = new Date(periodTo + "T23:59:59").getTime();

      const newLines: Array<{
        reservationId?: number;
        invoiceId?: number;
        productId: number;
        productName: string;
        serviceDate: string;
        paxCount: number;
        saleAmount: number;
        commissionPercent: number;
        commissionAmount: number;
        netAmountProvider: number;
        costType: string;
      }> = [];

      // SOURCE 1: Facturas cobradas
      if (productIds.length > 0) {
        const paidInvoices = await db
          .select()
          .from(invoices)
          .where(and(
            eq(invoices.status, "cobrada"),
            gte(invoices.createdAt, new Date(periodFrom)),
            lte(invoices.createdAt, new Date(periodTo + "T23:59:59"))
          ));

        const processedInvoiceIds = new Set(paidInvoices.map((i) => i.id));

        for (const inv of paidInvoices) {
          const items = (inv.itemsJson as any[]) ?? [];
          for (const item of items) {
            const productId = item.productId ?? item.experienceId ?? item.packId;
            const match = productIds.find((p) => p.id === productId);
            if (!match) continue;
            const saleAmount = parseFloat(String(item.unitPrice ?? item.price ?? "0")) * (item.quantity ?? 1);
            const commissionAmount = (saleAmount * match.commissionPercent) / 100;
            newLines.push({
              invoiceId: inv.id,
              reservationId: inv.reservationId ?? undefined,
              productId: match.id,
              productName: item.description ?? match.title,
              serviceDate: periodFrom,
              paxCount: item.quantity ?? 1,
              saleAmount,
              commissionPercent: match.commissionPercent,
              commissionAmount,
              netAmountProvider: saleAmount - commissionAmount,
              costType: match.costType,
            });
          }
        }

        // SOURCE 2: Reservas TPV pagadas
        const tpvReservations = await db
          .select()
          .from(reservations)
          .where(and(
            eq(reservations.status, "paid"),
            eq(reservations.channel, "tpv"),
            gte(reservations.paidAt, periodFromMs),
            lte(reservations.paidAt, periodToMs)
          ));

        for (const res of tpvReservations) {
          if (res.invoiceId && processedInvoiceIds.has(res.invoiceId)) continue;
          let items: any[] = [];
          try { items = JSON.parse(res.extrasJson ?? "[]"); } catch { items = []; }
          for (const item of items) {
            const productId = item.productId ?? item.experienceId ?? item.packId;
            if (!productId || !productIdSet.has(productId)) continue;
            const match = productIds.find((p) => p.id === productId);
            if (!match) continue;
            const unitPrice = parseFloat(String(item.unitPrice ?? item.price ?? "0"));
            const quantity = item.quantity ?? item.participants ?? 1;
            const saleAmount = unitPrice * quantity;
            if (saleAmount <= 0) continue;
            const commissionAmount = (saleAmount * match.commissionPercent) / 100;
            newLines.push({
              reservationId: res.id,
              invoiceId: res.invoiceId ?? undefined,
              productId: match.id,
              productName: item.productName ?? item.description ?? match.title,
              serviceDate: res.bookingDate ?? periodFrom,
              paxCount: quantity,
              saleAmount,
              commissionPercent: match.commissionPercent,
              commissionAmount,
              netAmountProvider: saleAmount - commissionAmount,
              costType: match.costType,
            });
          }
        }
      }

      // Delete existing lines
      await db.delete(settlementLines).where(eq(settlementLines.settlementId, input.id));

      // Insert new lines
      if (newLines.length > 0) {
        await db.insert(settlementLines).values(
          newLines.map((l) => ({
            settlementId: input.id,
            reservationId: l.reservationId ?? null,
            invoiceId: l.invoiceId ?? null,
            productId: l.productId ?? null,
            productName: l.productName ?? null,
            serviceDate: l.serviceDate ?? null,
            paxCount: l.paxCount,
            saleAmount: String(l.saleAmount.toFixed(2)),
            commissionPercent: String(l.commissionPercent.toFixed(2)),
            commissionAmount: String(l.commissionAmount.toFixed(2)),
            netAmountProvider: String(l.netAmountProvider.toFixed(2)),
            costType: l.costType as "comision_sobre_venta" | "coste_fijo" | "porcentaje_margen" | "hibrido",
            notes: null,
          }))
        );
      }

      // Recalculate totals
      const grossAmount = newLines.reduce((s, l) => s + l.saleAmount, 0);
      const commissionAmount = newLines.reduce((s, l) => s + l.commissionAmount, 0);
      const netAmountProvider = grossAmount - commissionAmount;

      await db.update(supplierSettlements).set({
        grossAmount: String(grossAmount.toFixed(2)),
        commissionAmount: String(commissionAmount.toFixed(2)),
        netAmountProvider: String(netAmountProvider.toFixed(2)),
        status: "recalculada",
      }).where(eq(supplierSettlements.id, input.id));

      // Log
      await db.insert(settlementStatusLog).values({
        settlementId: input.id,
        fromStatus: settlement.status,
        toStatus: "recalculada",
        changedBy: ctx.user.id,
        changedByName: ctx.user.name ?? "Admin",
        notes: `Recalculada: ${newLines.length} líneas generadas`,
      });

      return { ok: true, linesCount: newLines.length, grossAmount, commissionAmount, netAmountProvider };
    }),

  // ── Add document ────────────────────────────────────────────────────────────
  addDocument: protectedProcedure
    .input(z.object({
      settlementId: z.number(),
      docType: z.enum(["factura_recibida", "contrato", "justificante_pago", "email", "acuerdo_comision", "otro"]),
      title: z.string(),
      fileUrl: z.string().optional(),
      fileKey: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(settlementDocuments).values({
        settlementId: input.settlementId,
        docType: input.docType,
        title: input.title,
        fileUrl: input.fileUrl ?? null,
        fileKey: input.fileKey ?? null,
        notes: input.notes ?? null,
        uploadedBy: ctx.user.id,
      });
      return { id: (result as any).insertId };
    }),

  // ── Delete document ─────────────────────────────────────────────────────────
  deleteDocument: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(settlementDocuments).where(eq(settlementDocuments.id, input.id));
      return { ok: true };
    }),

  // ── Delete settlement ───────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(settlementLines).where(eq(settlementLines.settlementId, input.id));
      await db.delete(settlementDocuments).where(eq(settlementDocuments.settlementId, input.id));
      await db.delete(settlementStatusLog).where(eq(settlementStatusLog.settlementId, input.id));
      await db.delete(supplierSettlements).where(eq(supplierSettlements.id, input.id));
      return { ok: true };
    }),

  // ── KPI dashboard ───────────────────────────────────────────────────────────
  kpis: protectedProcedure.query(async () => {
    const all = await db
      .select({
        status: supplierSettlements.status,
        grossAmount: supplierSettlements.grossAmount,
        commissionAmount: supplierSettlements.commissionAmount,
        netAmountProvider: supplierSettlements.netAmountProvider,
        createdAt: supplierSettlements.createdAt,
        supplierId: supplierSettlements.supplierId,
        supplierName: suppliers.fiscalName,
      })
      .from(supplierSettlements)
      .leftJoin(suppliers, eq(supplierSettlements.supplierId, suppliers.id))
      .orderBy(desc(supplierSettlements.createdAt));

    const totalGross = all.reduce((s, r) => s + parseFloat(r.grossAmount ?? "0"), 0);
    const totalCommission = all.reduce((s, r) => s + parseFloat(r.commissionAmount ?? "0"), 0);
    const totalNet = all.reduce((s, r) => s + parseFloat(r.netAmountProvider ?? "0"), 0);
    const pendingCount = all.filter((r) => r.status === "pendiente_abono").length;
    const pendingAmount = all
      .filter((r) => r.status === "pendiente_abono")
      .reduce((s, r) => s + parseFloat(r.netAmountProvider ?? "0"), 0);

    // Monthly evolution (last 6 months)
    const now = new Date();
    const monthlyData: Record<string, { gross: number; commission: number; net: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyData[key] = { gross: 0, commission: 0, net: 0 };
    }
    for (const r of all) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyData[key]) {
        monthlyData[key].gross += parseFloat(r.grossAmount ?? "0");
        monthlyData[key].commission += parseFloat(r.commissionAmount ?? "0");
        monthlyData[key].net += parseFloat(r.netAmountProvider ?? "0");
      }
    }

    // Supplier ranking
    const bySupplier: Record<number, { name: string; gross: number; commission: number; count: number }> = {};
    for (const r of all) {
      if (!bySupplier[r.supplierId]) {
        bySupplier[r.supplierId] = { name: r.supplierName ?? "—", gross: 0, commission: 0, count: 0 };
      }
      bySupplier[r.supplierId].gross += parseFloat(r.grossAmount ?? "0");
      bySupplier[r.supplierId].commission += parseFloat(r.commissionAmount ?? "0");
      bySupplier[r.supplierId].count += 1;
    }
    const ranking = Object.entries(bySupplier)
      .map(([id, v]) => ({ supplierId: parseInt(id), ...v }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 10);

    return {
      totalGross,
      totalCommission,
      totalNet,
      pendingCount,
      pendingAmount,
      monthlyData,
      ranking,
      totalSettlements: all.length,
    };
  }),

  // ── Generate PDF ─────────────────────────────────────────────────────────────
  generatePdf: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Fetch settlement with supplier info
      const [settlement] = await db
        .select({
          id: supplierSettlements.id,
          settlementNumber: supplierSettlements.settlementNumber,
          periodFrom: supplierSettlements.periodFrom,
          periodTo: supplierSettlements.periodTo,
          grossAmount: supplierSettlements.grossAmount,
          commissionAmount: supplierSettlements.commissionAmount,
          netAmountProvider: supplierSettlements.netAmountProvider,
          internalNotes: supplierSettlements.internalNotes,
          createdAt: supplierSettlements.createdAt,
          supplierName: suppliers.fiscalName,
          supplierNif: suppliers.nif,
          supplierAddress: suppliers.fiscalAddress,
          supplierIban: suppliers.iban,
        })
        .from(supplierSettlements)
        .leftJoin(suppliers, eq(supplierSettlements.supplierId, suppliers.id))
        .where(eq(supplierSettlements.id, input.id));

      if (!settlement) throw new TRPCError({ code: "NOT_FOUND" });

      // Fetch lines
      const lines = await db
        .select()
        .from(settlementLines)
        .where(eq(settlementLines.settlementId, input.id));

      const { url, key } = await generateSettlementPdfAndUpload({
        settlementNumber: settlement.settlementNumber,
        supplierName: settlement.supplierName ?? "—",
        supplierNif: settlement.supplierNif,
        supplierAddress: settlement.supplierAddress,
        supplierIban: settlement.supplierIban,
        periodFrom: settlement.periodFrom,
        periodTo: settlement.periodTo,
        grossAmount: settlement.grossAmount ?? "0",
        commissionAmount: settlement.commissionAmount ?? "0",
        netAmountProvider: settlement.netAmountProvider ?? "0",
        lines: lines.map((l) => ({
          productName: l.productName,
          serviceDate: l.serviceDate,
          paxCount: l.paxCount,
          saleAmount: l.saleAmount ?? "0",
          commissionPercent: l.commissionPercent ?? "0",
          commissionAmount: l.commissionAmount ?? "0",
          netAmountProvider: l.netAmountProvider ?? "0",
          notes: l.notes,
        })),
        issuedAt: new Date(settlement.createdAt),
        internalNotes: settlement.internalNotes,
      });

      // Save PDF URL to settlement record
      await db.update(supplierSettlements)
        .set({ pdfUrl: url, pdfKey: key })
        .where(eq(supplierSettlements.id, input.id));

      return { url, key };
    }),

  // ── Send settlement by email ─────────────────────────────────────────────────
  sendEmail: protectedProcedure
    .input(z.object({
      id: z.number(),
      emailOverride: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const [settlement] = await db
        .select({
          id: supplierSettlements.id,
          settlementNumber: supplierSettlements.settlementNumber,
          supplierEmail: suppliers.adminEmail,
          supplierName: suppliers.fiscalName,
          periodFrom: supplierSettlements.periodFrom,
          periodTo: supplierSettlements.periodTo,
          netAmountProvider: supplierSettlements.netAmountProvider,
          pdfUrl: supplierSettlements.pdfUrl,
        })
        .from(supplierSettlements)
        .leftJoin(suppliers, eq(supplierSettlements.supplierId, suppliers.id))
        .where(eq(supplierSettlements.id, input.id));

      if (!settlement) throw new TRPCError({ code: "NOT_FOUND" });

      const toEmail = input.emailOverride || settlement.supplierEmail;
      if (!toEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "El proveedor no tiene email configurado" });

      await sendEmail({
        to: toEmail,
        subject: `Liquidación ${settlement.settlementNumber} — Náyade Experiences`,
        html: `
          <h2>Liquidación de servicios</h2>
          <p>Estimado/a ${settlement.supplierName},</p>
          <p>Adjuntamos la liquidación <strong>${settlement.settlementNumber}</strong> correspondiente al periodo <strong>${settlement.periodFrom} — ${settlement.periodTo}</strong>.</p>
          <p>Importe neto a abonar: <strong>${parseFloat(settlement.netAmountProvider ?? "0").toFixed(2)} €</strong></p>
          ${settlement.pdfUrl ? `<p><a href="${settlement.pdfUrl}">Descargar liquidación en PDF</a></p>` : ""}
          <p>Gracias por su colaboración.</p>
          <p>Náyade Experiences</p>
        `,
      });

      await db.update(supplierSettlements).set({ sentAt: new Date() }).where(eq(supplierSettlements.id, input.id));

      return { ok: true };
    }),
});
