/**
 * CRM Router — Skicenter
 * Ciclo completo: Lead ? Presupuesto ? Pago Redsys ? Reserva ? Factura PDF
 */


import { router, protectedProcedure, publicProcedure, staffProcedure, adminProcedure, permissionProcedure } from "../_core/trpc";
import { publicBaseUrl } from "../_core/productIdentity";
import { brandSetting, companyName, formatLegalAddress } from "../tenantBrand";
import { invoicePreviewPath } from "../_core/signedLinks";
import { createLead, createBookingFromReservation, createReavExpedient, attachReavDocument, upsertClientFromReservation, postConfirmOperation, getGHLCredentials } from "../db";
import { confirmReservationAndNotify } from "../reservationEmails";
import { calcularREAVSimple, validarConfiguracionREAV } from "../reav";
import { TRPCError } from "@trpc/server";
import { panelVocabulary } from "../panelVocabulary";
import { z } from "zod";
import {
  leads,
  quotes,
  reservations,
  reservationOperational,
  invoices,
  crmActivityLog,
  clients,
  experiences,
  experienceVariants,
  reavExpedients,
  siteSettings,
  tpvSales,
  tpvSaleItems,
  tpvSalePayments,
  legoPacks,
  packs,
  pendingPayments,
  discountCodes,
  paymentPlans,
  paymentInstallments,
  cancellationRequests,
  discountCodeUses,
  bankMovements,
  bankMovementLinks,
  cardTerminalOperations,
  ghlConversations,
  vapiCalls,
  crmLeadSources,
  partnerBillingBatchItems,
  transactions,
} from "../../drizzle/schema";
import { recordDiscountUse } from "./discounts";
import { getDefaultCashAccountId, createCashMovementIfNotExists } from "./cashRegisterHelper";
import { eq, desc, and, gte, lte, like, or, sql, count, sum, isNull, max, ne, notInArray, inArray, isNotNull, getTableColumns } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { sendManagedEmail, logDirectEmail } from "../emailManager";
import { generateDocumentNumber } from "../documentNumbers";
import { nextCreditNoteNumber, withCreditNoteNumberRetry } from "../creditNoteNumber";
import { QUOTE_DISCOUNT_DESCRIPTION, QUOTE_LINE_TOTAL_DESCRIPTION, QUOTE_TOTAL_DESCRIPTION, QUOTE_UNIT_PRICE_DESCRIPTION, linesToTaxIncluded, pricesIncludeTaxSchema, quoteTotalMismatch } from "../quoteTaxConvention";
import { invoiceClientForQuote } from "../invoiceClient";
import { needsExemptionReason } from "../../shared/directInvoice";
import { formatRecipientAddress, invoicePaymentMethodFromTicket, proposeTicketInvoiceRecipient, validateTicketInvoiceRecipient } from "../../shared/ticketInvoice";
import { ordersWithoutInvoice } from "../invoiceAudit";
import { alreadyCredited, chargedInvoiceAmounts, computeDirectInvoice, creditNoteLineStatus, CreditNoteSelectionError, DIRECT_INVOICE_TAX_RATES, planCreditNote, QUOTE_DISCOUNT_REASON, round2, type CreditNoteLineSelection } from "../invoiceCalc";
import { htmlToPdf } from "../pdfGenerator";
import { buildRedsysForm, generateMerchantOrder } from "../redsys";
import { storagePut, hasExternalStorage, externalFileUrl } from "../storage";
import { isAcceptableFileUrl } from "../_core/files/service";
import {
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildQuotePdfHtml,
  buildPendingPaymentHtml,
  buildPendingPaymentReminderHtml,
  buildInstallmentReminderHtml,
  buildBudgetRequestUserHtml,
  buildBudgetRequestAdminHtml,
} from "../emailTemplates";
import { buildInvoiceHtml, getLegalCompanySettings } from "../invoiceHtml";
import { ClientImportError, planClientImport } from "../clientImport";
import { applyClientImport, listClientsForExport, loadClientsForImport } from "../clientImportDb";
import { CLIENT_CSV_MAX_BYTES, CLIENT_CSV_MAX_ROWS, toClientCsv } from "../../shared/clientImportCsv";
import { syncLeadUrlsToGHL, createGHLContact, getGHLTagsFromSource, triggerGHLWorkflow } from "../ghl";
import { getSystemSettingSync, getBusinessEmail, internalNoticeEmail } from "../config";
import { groupTaxBreakdown, totalTaxAmount } from "../taxUtils";
import { reservationProductFromQuoteItems } from "../reservationUtils";
import { buildGestoriaInvoiceZip, ExportTooLargeError, MAX_EXPORT_DOCUMENTS } from "../gestoriaInvoiceExport";
import { listInvoicesForExport, listTicketsForExport, originalInvoiceNumbers, storedInvoicePdf, toExportRow } from "../gestoriaInvoiceExportDb";
import { ExportPeriodError, emptyExportMessage, resolveExportPeriod } from "../../shared/gestoriaExportPeriod";

// DB helper — usa la misma pool que el resto del servidor
const _pool = legacyPool();
const db = legacyDb();

// Email helper — delega en el helper compartido mailer.ts
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const sent = await sharedSendEmail({ to, subject, html });
  if (!sent) { console.warn("SMTP not configured, skipping email"); return; }
  const copyEmail = getSystemSettingSync("email_copy_recipient", "");
  if (copyEmail) await sharedSendEmail({ to: copyEmail, subject: `[COPIA] ${subject}`, html });
}
// --- HELPERS -----------------------------------------------------------------

// logActivity ahora viene de db.ts (centralizado)
import { logActivity } from "../db";
import { legacyDb, legacyPool } from "../_core/legacyDb";
import { integrationEnv } from "../_core/tenantConfig";
import { hasTagCondition } from "../crmTagsDb";
import { assertBusinessQuota } from "../businessQuotas";
import { buildInvoiceEmailHtml } from "../emailTemplates";
import { assertQuotePricedForSend } from "../quoteSendGuards";
import { addClientNote, clientListConditions, clientStats, deleteClientNote, deleteNotesOfClient, findClientDuplicates, listClientNotes, listFilteredClientsForExport, loadClientHistoryExtras } from "../clientProfileDb";
import { CLIENT_KINDS, NOTE_MAX } from "../../shared/clientProfile";
import { isValidSpanishTaxId } from "../../shared/formValidation";
import { issuerSnapshotForNewInvoice } from "../issuerSnapshot";

// generateInvoiceNumber y generateQuoteNumber reemplazadas por el helper centralizado
// Ver server/documentNumbers.ts
async function generateInvoiceNumber(context?: string, userId?: string): Promise<string> {
  // Salta los números ya ocupados por facturas guardadas (importadas o creadas sin pasar por el contador):
  // un número repetido haría fallar el alta de la factura por duplicado.
  return generateDocumentNumber("factura", context ?? "crm:invoice", userId ?? "system", async (candidate) => {
    const [hit] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.invoiceNumber, candidate)).limit(1);
    return !!hit;
  });
}
async function generateQuoteNumber(context?: string, userId?: string): Promise<string> {
  return generateDocumentNumber("presupuesto", context ?? "crm:quote", userId ?? "system");
}
async function generateReservationNum(context?: string, userId?: string): Promise<string> {
  return generateDocumentNumber("reserva", context ?? "crm:reservation", userId ?? "system");
}

// --- INVOICE PDF GENERATION --------------------------------------------------
async function generateInvoicePdf(invoice: {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientNif?: string | null;
  clientAddress?: string | null;
  itemsJson: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string; taxRate?: number }[];
  subtotal: string;
  discount?: string | number | null;
  discountReason?: string | null;
  taxRate: string;
  taxAmount: string;
  total: string;
  taxBreakdown?: { rate: number; base: number; amount: number }[];
  issuedAt: Date;
}): Promise<{ url: string; key: string }> {
  // Sin almacenamiento externo (S3/Forge) ? URL on-demand desde BD, sin archivos temporales
  if (!hasExternalStorage()) {
    const url = invoicePreviewPath(invoice.invoiceNumber);
    return { url, key: "" };
  }

  const html = await buildInvoiceHtml(invoice);
  try {
    const pdfBuffer = await htmlToPdf(html);
    const key = `invoices/${invoice.invoiceNumber}-${Date.now()}.pdf`;
    const stored = await storagePut(key, pdfBuffer, "application/pdf", { category: "invoice", originalName: `${invoice.invoiceNumber}.pdf`, owner: { type: "invoice", id: invoice.invoiceNumber } });
    return { url: stored.url, key: stored.key };
  } catch (pdfErr) {
    console.error("[PDF] Error generando factura PDF, usando vista on-demand:", pdfErr);
    const url = invoicePreviewPath(invoice.invoiceNumber);
    return { url, key: "" };
  }
}

// --- EMAIL TEMPLATES ---------------------------------------------------------

async function sendQuoteEmail(quote: {
  quoteNumber: string;
  title: string;
  clientName: string;
  clientEmail: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  validUntil?: Date | null;
  notes?: string | null;
  conditions?: string | null;
  paymentLinkUrl?: string | null;
  installmentPlan?: {
    firstRequiredAmountCents: number | null;
    installments: { installmentNumber: number; amountCents: number; dueDate: string; isRequiredForConfirmation: boolean }[];
  } | null;
}) {
  const html = buildQuoteHtml({
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    clientName: quote.clientName,
    items: quote.items,
    subtotal: quote.subtotal,
    discount: quote.discount,
    tax: quote.tax,
    total: quote.total,
    validUntil: quote.validUntil ?? undefined,
    notes: quote.notes ?? undefined,
    conditions: quote.conditions ?? undefined,
    paymentLinkUrl: quote.paymentLinkUrl ?? undefined,
    installmentPlan: quote.installmentPlan ?? undefined,
  });

  const quoteSubject = `Tu propuesta de ${companyName()} — ${quote.quoteNumber}`;
  const result = await sendManagedEmail({
    templateKey: "quote",
    triggerEvent: "quote_sent",
    recipientEmail: quote.clientEmail,
    subject: quoteSubject,
    html,
    relatedEntityType: "quote",
    relatedEntityId: (quote as any).id,
    quoteId: (quote as any).id,
  });
  const _cq = getSystemSettingSync("email_copy_recipient", "");
  if (_cq) sharedSendEmail({ to: _cq, subject: `[COPIA] ${quoteSubject}`, html }).catch(() => {});
  return quoteMailOutcome(result.sent);
}

/**
 * Si el correo del presupuesto no ha salido, por qué: durante la prueba gratuita solo se escribe a los buzones de la
 * propia empresa (server/trialRestrictions.ts), así que la pantalla debe pedir que se comparta el enlace a mano en vez
 * de decir «enviado al cliente».
 */
async function quoteMailOutcome(emailSent: boolean): Promise<{ emailSent: boolean; trialMailBlocked: boolean }> {
  if (emailSent) return { emailSent, trialMailBlocked: false };
  const { currentCommercialState } = await import("../trialRestrictions");
  const restricted = await currentCommercialState().then((st) => st.restricted).catch(() => false);
  return { emailSent, trialMailBlocked: restricted };
}

async function sendConfirmationEmail(data: {
  clientName: string;
  clientEmail: string;
  reservationRef: string;
  quoteTitle: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  total: string;
  invoiceUrl?: string | null;
  reservationUrl?: string;
  bookingDate?: string | null;
  selectedTime?: string | null;
  installmentPlan?: {
    installments: Array<{
      installmentNumber: number;
      amountCents: number;
      dueDate: string;
      status: string;
      isRequiredForConfirmation: boolean;
    }>;
  };
}) {
  const html = buildConfirmationHtml({
    clientName: data.clientName,
    reservationRef: data.reservationRef,
    quoteTitle: data.quoteTitle,
    items: data.items,
    total: data.total,
    invoiceUrl: data.invoiceUrl ?? undefined,
    reservationUrl: data.reservationUrl,
    bookingDate: data.bookingDate ?? undefined,
    selectedTime: data.selectedTime ?? undefined,
    installmentPlan: data.installmentPlan,
  });

  const confSubject = `? Reserva confirmada — ${data.reservationRef} — ${companyName()}`;
  await sendManagedEmail({
    templateKey: "confirmation",
    triggerEvent: "reservation_confirmed",
    recipientEmail: data.clientEmail,
    subject: confSubject,
    html,
  });
  const _cc = getSystemSettingSync("email_copy_recipient", "");
  if (_cc) sharedSendEmail({ to: _cc, subject: `[COPIA] ${confSubject}`, html }).catch(() => {});
}


async function sendInternalNotification(data: {
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  reservationRef: string;
  quoteTitle: string;
  total: string;
  paidAt: Date;
  reservationId: number;
}) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#1a3a6b;padding:24px 32px;">
      <div style="display:inline-block;background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.4);border-radius:20px;padding:4px 14px;font-size:11px;color:#86efac;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">?? Compra Efectuada</div>
      <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;">${data.clientName}</h1>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:140px;">Referencia</td><td style="padding:8px 0;font-weight:600;color:#111827;">${data.reservationRef}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Email</td><td style="padding:8px 0;color:#111827;">${data.clientEmail}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Teléfono</td><td style="padding:8px 0;color:#111827;">${data.clientPhone || "—"}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Producto</td><td style="padding:8px 0;color:#111827;">${data.quoteTitle}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Importe</td><td style="padding:8px 0;font-size:18px;font-weight:800;color:#16a34a;">${Number(data.total).toFixed(2)}€</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Fecha pago</td><td style="padding:8px 0;color:#111827;">${data.paidAt.toLocaleString("es-ES")}</td></tr>
      </table>
      <div style="margin-top:24px;text-align:center;">
        <a href="${process.env.VITE_OAUTH_PORTAL_URL || ""}/admin/crm/reservations/${data.reservationId}" style="display:inline-block;background:#1a3a6b;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Ver ficha de reserva ?</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const internalRecipient = await getBusinessEmail('reservations');
  const internalSubject = `?? Compra efectuada "${data.clientName}" — ${data.reservationRef}`;
  await sharedSendEmail({ to: internalRecipient, subject: internalSubject, html });
  logDirectEmail({ templateKey: "confirmation", triggerEvent: "reservation_confirmed_admin", recipientEmail: internalRecipient, subject: internalSubject, sent: true }).catch(() => {});
}

// --- Email: Confirmación de pago por transferencia bancaria (al cliente) ----
async function sendTransferConfirmationEmail(data: {
  clientName: string;
  clientEmail: string;
  invoiceNumber: string;
  reservationRef: string;
  quoteTitle: string;
  quoteNumber?: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  taxAmount: string;
  total: string;
  invoiceUrl?: string | null;
  reservationUrl?: string;
  confirmedBy?: string;
  confirmedAt?: Date;
}) {
  const html = buildTransferConfirmationHtml({
    clientName: data.clientName,
    invoiceNumber: data.invoiceNumber,
    reservationRef: data.reservationRef,
    quoteTitle: data.quoteTitle,
    quoteNumber: data.quoteNumber,
    items: data.items,
    subtotal: data.subtotal,
    taxAmount: data.taxAmount,
    total: data.total,
    invoiceUrl: data.invoiceUrl ?? undefined,
    reservationUrl: data.reservationUrl,
    confirmedBy: data.confirmedBy,
    confirmedAt: data.confirmedAt,
  });

  await sendEmail({
    to: data.clientEmail,
    subject: `?? Pago por transferencia confirmado — ${data.invoiceNumber} — ${companyName()}`,
    html,
  });
}

// --- ABONO (FACTURA RECTIFICATIVA) -------------------------------------------

/**
 * Emite un abono de `partialAmount` (o de todo lo pendiente) sobre una factura emitida. El abono copia el
 * desglose por tipo de IVA de la factura y, si es parcial, lo reparte en proporción (ver
 * `computeCreditNote`). Una transacción BLOQUEA la factura original: dos abonos simultáneos se serializan
 * y nunca abonan entre los dos más de lo facturado. Si otro abono simultáneo (de otra factura) toma el
 * mismo número, el índice único lo rechaza y la transacción completa se reintenta.
 */
/** Qué se abona (createCreditNote y su vista previa): nada = lo pendiente; o un importe; o unas líneas. */
const creditNoteSelectionShape = {
  partialAmount: z.number().positive("El importe del abono debe ser mayor que cero").optional(),
  lines: z.array(z.object({
    itemIndex: z.number().int().min(0),
    quantity: z.number().positive("La cantidad debe ser mayor que cero").optional(),
    amount: z.number().positive("El importe debe ser mayor que cero").optional(),
  })).max(200).optional(),
};

async function issueCreditNote(input:{ invoiceId: number; reason: string; partialAmount?: number; lines?: CreditNoteLineSelection[] }) {
  // Copia del emisor antes de abrir la transacción: leerla dentro ocuparía otra conexión con la fila bloqueada
  const issuerSnapshot = await issuerSnapshotForNewInvoice();
  return withCreditNoteNumberRetry(() => db.transaction(async (tx) => {
    const [original] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).for("update");
    if (!original) throw new TRPCError({ code: "NOT_FOUND" });
    if (original.invoiceType === "abono") throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede abonar una factura de abono" });
    if (original.status === "anulada") throw new TRPCError({ code: "BAD_REQUEST", message: "La factura ya está anulada" });

    const now = new Date();
    // Lo ya abonado de esta factura: el total abonado nunca supera lo facturado
    const previous = await tx.select().from(invoices)
      .where(and(eq(invoices.creditNoteForId, original.id), eq(invoices.invoiceType, "abono")));
    // Abono por líneas elegidas, por importe (repartido entre los tipos de IVA) o total; la suma de abonos
    // nunca supera lo facturado (ni por línea). Las mismas reglas que la vista previa (`planCreditNote`).
    let plan: ReturnType<typeof planCreditNote>;
    try {
      plan = planCreditNote(original as any, previous as any[], { partialAmount: input.partialAmount, lines: input.lines });
    } catch (e) {
      if (e instanceof CreditNoteSelectionError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }
    const { amounts, creditTotal } = plan;

    // Numeración en la serie vigente ABO-AAAA-MM-nnnn: máximo del mes + 1, único por índice (nunca un
    // recuento de filas, que con dos abonos simultáneos daba el mismo número)
    const creditNoteNumber = await nextCreditNoteNumber(tx, now);

    const [result] = await tx.insert(invoices).values({
      issuerSnapshot,
      invoiceNumber: creditNoteNumber,
      invoiceType: "abono",
      quoteId: original.quoteId,
      reservationId: original.reservationId,
      clientName: original.clientName,
      clientEmail: original.clientEmail,
      clientPhone: original.clientPhone,
      clientNif: original.clientNif,
      clientAddress: original.clientAddress,
      itemsJson: amounts.items,
      subtotal: amounts.subtotal.toFixed(2),
      taxRate: original.taxRate,
      taxAmount: amounts.taxAmount.toFixed(2),
      taxBreakdown: amounts.taxBreakdown.length > 0 ? amounts.taxBreakdown : undefined,
      total: amounts.total.toFixed(2),
      currency: original.currency,
      status: "generada",
      creditNoteForId: original.id,
      creditNoteReason: input.reason,
      isAutomatic: false,
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const creditNoteId = (result as any).insertId as number;

    // Abonada solo cuando el total abonado cubre la factura (un abono parcial no la cierra)
    if (plan.closesInvoice) {
      await tx.update(invoices).set({ status: "abonada", updatedAt: now }).where(eq(invoices.id, input.invoiceId));
    }

    return { creditNoteId, creditNoteNumber, creditTotal, invoiceNumber: original.invoiceNumber };
  }));
}

// --- CRM ROUTER --------------------------------------------------------------

const staff = staffProcedure;
const admin = adminProcedure;

// Importar clientes desde CSV: el fichero llega como texto (límite de tamaño) y se planifica sin escribir nada
const clientCsvInput = z.string().min(1, "El fichero está vacío").refine(
  (s) => Buffer.byteLength(s, "utf8") <= CLIENT_CSV_MAX_BYTES,
  `El fichero supera ${CLIENT_CSV_MAX_BYTES / 1024 / 1024} MB. Divídelo en varios y súbelos por partes.`,
);
function planImportOrThrow(csv: string, existing: Awaited<ReturnType<typeof loadClientsForImport>>) {
  try {
    return planClientImport(csv, existing);
  } catch (e) {
    if (e instanceof ClientImportError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

/**
 * El producto es la fuente de verdad fiscal. Para cada línea de presupuesto con
 * `productId`, sobreescribe `fiscalRegime`/`taxRate` con los valores reales del
 * producto en BD, impidiendo que el cliente fuerce un régimen distinto al del
 * catálogo. Las líneas manuales (sin `productId`) se devuelven intactas.
 *
 * El `productId` de una línea CRM puede referir a una experiencia, un pack o un
 * legoPack. Los legoPacks no tienen modelo fiscal propio ? siempre general 21%.
 * Si un mismo `productId` existe en más de una tabla la línea es ambigua (no se
 * sabe a qué producto refiere) y se respeta el valor del cliente.
 */
async function sanitizeQuoteItemsFiscal<
  T extends { productId?: number; fiscalRegime?: "reav" | "general"; taxRate?: number }
>(items: T[]): Promise<T[]> {
  const productIds = Array.from(new Set(items.filter(i => i.productId != null).map(i => i.productId!)));
  if (productIds.length === 0) return items;
  const [exps, pks, legos] = await Promise.all([
    db.select({ id: experiences.id, fiscalRegime: experiences.fiscalRegime, taxRate: experiences.taxRate })
      .from(experiences).where(inArray(experiences.id, productIds)),
    db.select({ id: packs.id, fiscalRegime: packs.fiscalRegime, taxRate: packs.taxRate })
      .from(packs).where(inArray(packs.id, productIds)),
    db.select({ id: legoPacks.id }).from(legoPacks).where(inArray(legoPacks.id, productIds)),
  ]);
  const expById = new Map(exps.map(e => [e.id, e]));
  const pkById = new Map(pks.map(p => [p.id, p]));
  const legoIds = new Set(legos.map(l => l.id));
  return items.map(it => {
    if (it.productId == null) return it;
    const inExp = expById.get(it.productId);
    const inPk = pkById.get(it.productId);
    const inLego = legoIds.has(it.productId);
    // Coincidencia en más de una tabla ? ambiguo ? respetar valor del cliente.
    if ([inExp, inPk, inLego].filter(Boolean).length > 1) return it;
    if (inLego) return { ...it, fiscalRegime: "general", taxRate: 21 };
    const prod = inExp ?? inPk;
    if (!prod) return it;
    const fr = prod.fiscalRegime === "reav" ? "reav" : "general";
    return { ...it, fiscalRegime: fr, taxRate: fr === "reav" ? 0 : Number(prod.taxRate ?? 21) };
  });
}

/**
 * La confirmación manual factura el total del presupuesto (IVA incluido). Si se indica otro importe cobrado,
 * se rechaza en vez de emitir una factura que no corresponde a lo cobrado: los cobros por partes van con
 * un plan de pagos.
 */
function assertPaidAmountMatchesQuote(paidAmount: number | undefined, quoteTotal: unknown) {
  if (paidAmount === undefined) return;
  const total = round2(Number(quoteTotal) || 0);
  if (Math.abs(round2(paidAmount) - total) > 0.005) {
    const eur = (n: number) => `${round2(n).toFixed(2).replace(".", ",")} €`;
    throw new TRPCError({ code: "BAD_REQUEST", message: `El importe cobrado (${eur(paidAmount)}) no coincide con el total del presupuesto (${eur(total)}). Para cobrar por partes, crea un plan de pagos.` });
  }
}

/**
 * Líneas de un presupuesto recibido listas para guardar con el convenio de IVA incluido (ver
 * `quoteTaxConvention`): régimen e IVA revalidados contra el producto, bases imponibles convertidas a IVA
 * incluido si se indicó `pricesIncludeTax: false`, y rechazo con un error claro si el total no cuadra.
 */
async function quoteItemsTaxIncluded<
  T extends { productId?: number; fiscalRegime?: "reav" | "general"; taxRate?: number; total: number; unitPrice: number }
>(items: T[], pricesIncludeTax: boolean | undefined, discount: number, total: number): Promise<T[]> {
  const sanitized = await sanitizeQuoteItemsFiscal(items);
  const normalized = pricesIncludeTax === false ? linesToTaxIncluded(sanitized) : sanitized;
  const mismatch = quoteTotalMismatch(normalized, discount, total);
  if (mismatch) throw new TRPCError({ code: "BAD_REQUEST", message: mismatch });
  return normalized;
}

export async function checkAndConfirmInstallmentPlan(quoteId: number, userId: number, userName: string) {
  const installments = await db.select().from(paymentInstallments)
    .where(eq(paymentInstallments.quoteId, quoteId));
  const required = installments.filter(i => i.isRequiredForConfirmation);
  if (required.length === 0) return;
  const allRequiredPaid = required.every(i => i.status === "paid");
  if (!allRequiredPaid) return;

  const allInstallmentsPaid = installments.every(i => i.status === "paid");

  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return;

  const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
  const now = new Date();
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string }[]) ?? [];
  // Lo facturado es lo cobrado: con todas las cuotas pagadas, su suma; antes, el total del presupuesto (las
  // cuotas suman ese importe). El descuento del presupuesto reduce base e IVA de cada tipo antes de desglosar.
  const paidInstallmentsEur = installments.filter(i => i.status === "paid").reduce((s, i) => s + (i.amountCents ?? 0), 0) / 100;
  const quoteTotal = Number(quote.total);
  const chargedInst = allInstallmentsPaid && paidInstallmentsEur > 0 ? paidInstallmentsEur : quoteTotal;
  const amountsInst = chargedInvoiceAmounts(items, chargedInst);
  const { subtotal, taxAmount, total } = amountsInst;
  const breakdown = amountsInst.taxBreakdown;
  const taxRateInst = amountsInst.taxRate;

  // -- FASE 1: Confirmar reserva cuando se pagan las cuotas obligatorias ------
  // Idempotente: sólo si el quote aún no está aceptado
  if (quote.status !== "aceptado") {
    let [reservation] = await db.select().from(reservations)
      .where(and(eq(reservations.quoteId, quoteId), ne(reservations.status, "cancelled")))
      .orderBy(desc(reservations.createdAt))
      .limit(1);

    const paidAmountCents = installments.filter(i => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
    const totalAmountCents = installments.reduce((s, i) => s + i.amountCents, 0);

    if (!reservation) {
      // Pago manual de la primera cuota: no existe reserva previa — crearla ahora
      const mainProductId = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? lead?.experienceId ?? 0;
      const serviceDate = quote.activityDate
        ? String(quote.activityDate).slice(0, 10)
        : lead?.preferredDate
          ? new Date(lead.preferredDate).toISOString().split("T")[0]
          : now.toISOString().split("T")[0];
      const reservationNumber = await generateReservationNum("crm:installments:manual", String(userId));
      const merchantOrder = reservationNumber.replace(/[^A-Z0-9]/gi, "").substring(0, 12);
      const resProd = reservationProductFromQuoteItems(quote.items, mainProductId);
      const [resResult] = await db.insert(reservations).values({
        productId: resProd.productId,
        productName: quote.title ?? "Presupuesto",
        extrasJson: resProd.extrasJson,
        bookingDate: resProd.mainServiceDate ?? serviceDate,
        people: lead?.numberOfPersons ?? lead?.numberOfAdults ?? 1,
        amountTotal: totalAmountCents,
        amountPaid: paidAmountCents,
        status: "paid",
        statusReservation: "CONFIRMADA",
        statusPayment: allInstallmentsPaid ? "PAGADO" : "PAGO_PARCIAL",
        channel: "ONLINE_ASISTIDO",
        customerName: lead?.name ?? quote.title ?? "",
        customerEmail: lead?.email ?? "",
        customerPhone: lead?.phone ?? "",
        merchantOrder,
        reservationNumber,
        quoteId,
        quoteSource: "presupuesto",
        paymentMethod: "otro",
        notes: `Plan fraccionado — confirmado desde presupuesto ${quote.quoteNumber}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        paidAt: Date.now(),
      } as any);
      const newReservationId = (resResult as { insertId: number }).insertId;
      const [newRes] = await db.select().from(reservations).where(eq(reservations.id, newReservationId)).limit(1);
      reservation = newRes;
      console.log(`[checkAndConfirmInstallmentPlan] Reserva ${reservationNumber} creada para plan fraccionado manual — quoteId=${quoteId}`);
    } else if (reservation.status !== "paid") {
      await db.update(reservations)
        .set({ status: "paid", amountPaid: paidAmountCents, updatedAt: Date.now() } as any)
        .where(eq(reservations.id, reservation.id));
    }

    // El enlace del presupuesto se conserva: con él el cliente paga las cuotas siguientes y vuelve a ver
    // el presupuesto. Nunca cobra dos veces: solo inicia el pago de cuotas pendientes y, con el plan
    // cobrado (paidAt), deja de iniciar pagos.
    await db.update(quotes).set({
      status: "aceptado",
      updatedAt: now,
    }).where(eq(quotes.id, quoteId));

    if (lead) {
      await db.update(leads).set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now }).where(eq(leads.id, lead.id));
    }

    // Crear pendingPayments para cuotas aún sin pagar
    const stillPending = installments.filter(i => i.status === "pending");
    if (stillPending.length > 0) {
      const nowMs = Date.now();
      for (const inst of stillPending) {
        await db.insert(pendingPayments).values({
          quoteId: quote.id,
          reservationId: reservation?.id ?? null,
          clientName: lead?.name ?? quote.title ?? "",
          clientEmail: lead?.email ?? undefined,
          clientPhone: lead?.phone ?? undefined,
          productName: quote.title ?? undefined,
          amountCents: inst.amountCents,
          dueDate: inst.dueDate ?? undefined,
          reason: `Plan fraccionado — Cuota #${inst.installmentNumber}${inst.notes ? `: ${inst.notes}` : ""}`,
          status: "pending",
          createdBy: userId,
          createdAt: nowMs,
          updatedAt: nowMs,
        } as any);
      }
    }

    await db.insert(crmActivityLog).values({
      entityType: "quote",
      entityId: quoteId,
      action: "confirmed_by_installments",
      actorId: userId,
      actorName: userName,
      details: { message: "Cuotas obligatorias pagadas — reserva confirmada, plan activo" },
      createdAt: now,
    });

    // Email de confirmación solo si quedan cuotas pendientes (si todas pagadas, Fase 2 envía el email con factura)
    if (!allInstallmentsPaid && lead?.email) {
      try {
        await sendConfirmationEmail({
          clientName: lead.name,
          clientEmail: lead.email,
          reservationRef: quote.quoteNumber ?? `PRES-${quoteId}`,
          quoteTitle: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
          items,
          total: String(total),
          invoiceUrl: null,
          installmentPlan: {
            installments: installments.map(i => ({
              installmentNumber: i.installmentNumber,
              amountCents: i.amountCents,
              dueDate: i.dueDate ?? "",
              status: i.status ?? "pending",
              isRequiredForConfirmation: i.isRequiredForConfirmation ?? false,
            })),
          },
        });
      } catch (emailErr) {
        console.error("[_checkAndConfirmReservation] Error enviando email confirmación:", emailErr);
      }
    }
  }

  // -- FASE 2: Generar factura sólo cuando TODAS las cuotas están pagadas -----
  if (allInstallmentsPaid) {
    // Re-leer el quote para verificar idempotencia (evitar doble factura en llamadas concurrentes)
    const [freshQuote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (freshQuote?.paidAt) return;

    // Usar la reserva MÁS ANTIGUA (la original del primer pago), no la más reciente.
    // En planes multi-cuota, payWithToken crea una nueva reserva por cada pago, pero la
    // factura debe vincularse a la reserva original (la que el cliente ve como "su reserva").
    const [reservation] = await db.select().from(reservations)
      .where(and(eq(reservations.quoteId, quoteId), ne(reservations.status, "cancelled")))
      .orderBy(reservations.createdAt)
      .limit(1);

    const invoiceNumber = await generateInvoiceNumber("crm:installments", String(userId));
    // Datos fiscales del cliente vinculado al presupuesto (NIF, nombre fiscal y dirección)
    const billTo = await invoiceClientForQuote(db, quote, { name: lead?.name ?? quote.title, email: lead?.email ?? "", phone: lead?.phone ?? null });
    let pdfUrl: string | null = null;
    let pdfKey: string | null = null;
    try {
      const pdf = await generateInvoicePdf({
        invoiceNumber,
        ...billTo,
        itemsJson: items as any,
        subtotal: String(subtotal),
        discount: amountsInst.discount,
        discountReason: amountsInst.discount > 0 ? QUOTE_DISCOUNT_REASON : null,
        taxRate: String(taxRateInst),
        taxAmount: String(taxAmount),
        taxBreakdown: breakdown.length > 0 ? breakdown : undefined,
        total: String(total),
        issuedAt: now,
      });
      pdfUrl = pdf.url;
      pdfKey = pdf.key;
    } catch (e) {
      console.error("[checkAndConfirmInstallmentPlan] Error generando PDF:", e);
    }

    const [invResult] = await db.insert(invoices).values({
      issuerSnapshot: await issuerSnapshotForNewInvoice(),
      invoiceNumber,
      quoteId: quote.id,
      reservationId: reservation?.id ?? null,
      ...billTo,
      itemsJson: items as any,
      subtotal: String(subtotal),
      discount: String(amountsInst.discount),
      discountReason: amountsInst.discount > 0 ? QUOTE_DISCOUNT_REASON : null,
      taxRate: String(taxRateInst),
      taxAmount: String(taxAmount),
      taxBreakdown: breakdown.length > 0 ? breakdown : undefined,
      total: String(total),
      status: "cobrada",
      paymentMethod: "otro",
      isAutomatic: false,
      issuedAt: now,
      pdfUrl,
      pdfKey,
      createdAt: now,
      updatedAt: now,
    });
    const invoiceId = (invResult as { insertId: number }).insertId;

    if (reservation) {
      await db.update(reservations)
        .set({ amountPaid: Math.round(total * 100), invoiceId, invoiceNumber, paidAt: Date.now(), updatedAt: Date.now() } as any)
        .where(eq(reservations.id, reservation.id));
    }

    await db.update(quotes).set({
      paidAt: now,
      invoiceNumber,
      invoicePdfUrl: pdfUrl,
      updatedAt: now,
    }).where(eq(quotes.id, quoteId));

    await db.insert(crmActivityLog).values({
      entityType: "quote",
      entityId: quoteId,
      action: "invoice_generated",
      actorId: userId,
      actorName: userName,
      details: { invoiceNumber, message: "Plan de pagos completado — factura generada" },
      createdAt: now,
    });

    // Email final con factura adjunta
    if (lead?.email) {
      try {
        await sendConfirmationEmail({
          clientName: lead.name,
          clientEmail: lead.email,
          reservationRef: invoiceNumber,
          quoteTitle: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
          items,
          total: String(total),
          invoiceUrl: pdfUrl,
          installmentPlan: {
            installments: installments.map(i => ({
              installmentNumber: i.installmentNumber,
              amountCents: i.amountCents,
              dueDate: i.dueDate ?? "",
              status: i.status ?? "paid",
              isRequiredForConfirmation: i.isRequiredForConfirmation ?? false,
            })),
          },
        });
      } catch (emailErr) {
        console.error("[_checkAndConfirmReservation] Error enviando email factura:", emailErr);
      }
    }
  }
}

export const crmRouter = router({
  // --- LEADS -----------------------------------------------------------------

  leads: router({
    list: staff
      .input(
        z.object({
          opportunityStatus: z.enum(["nueva", "enviada", "ganada", "perdida"]).optional(),
          search: z.string().optional(),
          assignedTo: z.number().optional(),
          priority: z.enum(["baja", "media", "alta"]).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          leadSourceId: z.number().optional(),
          tagId: z.number().int().positive().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        const conditions = [];
        if (input.opportunityStatus) conditions.push(eq(leads.opportunityStatus, input.opportunityStatus));
        if (input.assignedTo) conditions.push(eq(leads.assignedTo, input.assignedTo));
        if (input.priority) conditions.push(eq(leads.priority, input.priority));
        if (input.leadSourceId) conditions.push(eq(leads.leadSourceId, input.leadSourceId));
        if (input.tagId) conditions.push(hasTagCondition(leads.id, "lead", input.tagId));
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(
            or(
              like(leads.name, s),
              like(leads.email, s),
              like(leads.phone, s),
              like(leads.company, s),
              like(leads.selectedProduct, s),
              like(leads.selectedCategory, s),
              like(leads.message, s),
              like(leads.source, s)
            )
          );
        }
        if (input.from) conditions.push(gte(leads.createdAt, new Date(input.from)));
        if (input.to) conditions.push(lte(leads.createdAt, new Date(input.to)));

        const where = conditions.length ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db
            .select({
              ...getTableColumns(leads),
              clientId: clients.id,
              lsName: crmLeadSources.name,
              lsColor: crmLeadSources.color,
              lsCode: crmLeadSources.code,
              lsIcon: crmLeadSources.icon,
            })
            .from(leads)
            .leftJoin(clients, eq(clients.leadId, leads.id))
            .leftJoin(crmLeadSources, eq(crmLeadSources.id, leads.leadSourceId))
            .where(where)
            .orderBy(desc(leads.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(leads).where(where),
        ]);

        return { rows, total };
      }),

    counters: staff.query(async () => {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());

      const [total, nueva, enviada, ganada, perdida, hoy, semana, sinLeer,
             valorNueva, valorEnviada, valorGanada, valorPerdida] = await Promise.all([
        db.select({ cnt: count() }).from(leads),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "nueva")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "enviada")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "ganada")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "perdida")),
        db.select({ cnt: count() }).from(leads).where(gte(leads.createdAt, startOfDay)),
        db.select({ cnt: count() }).from(leads).where(gte(leads.createdAt, startOfWeek)),
        db.select({ cnt: count() }).from(leads).where(isNull(leads.seenAt)),
        // Valor económico por estado: suma del presupuesto más reciente de cada lead
        // "nueva": lead sin presupuesto aún ? usa leads.budget (estimación del cliente)
        db.select({ total: sum(leads.budget) }).from(leads).where(eq(leads.opportunityStatus, "nueva")),
        // "enviada": presupuesto ya enviado ? suma quotes.total (importe real del presupuesto)
        db.select({ total: sum(quotes.total) }).from(quotes)
          .innerJoin(leads, eq(quotes.leadId, leads.id))
          .where(and(eq(leads.opportunityStatus, "enviada"), sql`${quotes.status} NOT IN ('rechazado')`)),
        // "ganada": presupuesto aceptado ? suma quotes.total del presupuesto aceptado
        db.select({ total: sum(quotes.total) }).from(quotes)
          .innerJoin(leads, eq(quotes.leadId, leads.id))
          .where(and(eq(leads.opportunityStatus, "ganada"), eq(quotes.status, "aceptado"))),
        // "perdida": lead descartado ? usa leads.budget (ya no tiene presupuesto activo)
        db.select({ total: sum(leads.budget) }).from(leads).where(eq(leads.opportunityStatus, "perdida")),
      ]);

      return {
        total: total[0]?.cnt ?? 0,
        nueva: nueva[0]?.cnt ?? 0,
        enviada: enviada[0]?.cnt ?? 0,
        ganada: ganada[0]?.cnt ?? 0,
        perdida: perdida[0]?.cnt ?? 0,
        hoy: hoy[0]?.cnt ?? 0,
        semana: semana[0]?.cnt ?? 0,
        sinLeer: sinLeer[0]?.cnt ?? 0,
        valorNueva: Number(valorNueva[0]?.total ?? 0),
        valorEnviada: Number(valorEnviada[0]?.total ?? 0),
        valorGanada: Number(valorGanada[0]?.total ?? 0),
        valorPerdida: Number(valorPerdida[0]?.total ?? 0),
      };
    }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Mark as seen
        if (!lead.seenAt) {
          await db.update(leads).set({ seenAt: new Date() }).where(eq(leads.id, input.id));
        }

        // Activity log
        const activity = await db
          .select()
          .from(crmActivityLog)
          .where(and(eq(crmActivityLog.entityType, "lead"), eq(crmActivityLog.entityId, input.id)))
          .orderBy(desc(crmActivityLog.createdAt))
          .limit(50);

        // Related quotes
        const relatedQuotes = await db
          .select()
          .from(quotes)
          .where(eq(quotes.leadId, input.id))
          .orderBy(desc(quotes.createdAt));

        return { lead, activity, quotes: relatedQuotes };
      }),

    update: staff
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          email: z.string().email().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
          message: z.string().optional(),
          opportunityStatus: z.enum(["nueva", "enviada", "ganada", "perdida"]).optional(),
          priority: z.enum(["baja", "media", "alta"]).optional(),
          assignedTo: z.number().nullable().optional(),
          lostReason: z.string().optional(),
          selectedCategory: z.string().optional(),
          selectedProduct: z.string().optional(),
          numberOfAdults: z.number().optional(),
          numberOfChildren: z.number().optional(),
           preferredDate: z.string().optional(),
          activitiesJson: z.array(z.object({
            experienceId: z.number(),
            experienceTitle: z.string(),
            family: z.string(),
            participants: z.number(),
            details: z.record(z.string(), z.union([z.string(), z.number()])),
          })).optional(),
          leadSourceId: z.number().nullable().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
        if (data.preferredDate) updateData.preferredDate = new Date(data.preferredDate);
        await db.update(leads).set(updateData).where(eq(leads.id, id));
        await logActivity("lead", id, "lead_updated", ctx.user.id, ctx.user.name, { changes: Object.keys(data) });
        return { success: true };
      }),

    // --- Marcar un lead como contactado -------------------------------------
    // Setea lastContactAt = NOW(). El dashboard usa este campo para sacar
    // temporalmente al lead del contador "leads por atender": si el lead
    // sigue en opportunityStatus='nueva' y han pasado >3 días desde el
    // último contacto manual, vuelve a aparecer como pendiente (chasing).
    markContacted: staff
      .input(z.object({ id: z.number(), note: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select({ id: leads.id, internalNotes: leads.internalNotes })
          .from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        const updateData: Record<string, unknown> = {
          lastContactAt: new Date(),
          updatedAt: new Date(),
        };

        // Si el admin escribe una nota, se añade al historial interno.
        if (input.note?.trim()) {
          const existing = (lead.internalNotes as { text: string; authorId: number; authorName: string; createdAt: string }[]) ?? [];
          updateData.internalNotes = [
            ...existing,
            {
              text: `[Contacto] ${input.note.trim()}`,
              authorId: ctx.user.id,
              authorName: ctx.user.name ?? "Agente",
              createdAt: new Date().toISOString(),
            },
          ];
        }

        await db.update(leads).set(updateData).where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "lead_contacted", ctx.user.id, ctx.user.name, {
          note: input.note ?? null,
        });
        return { success: true, lastContactAt: updateData.lastContactAt };
      }),

    addNote: staff
      .input(z.object({ id: z.number(), text: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select({ notes: leads.internalNotes }).from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        const existing = (lead.notes as { text: string; authorId: number; authorName: string; createdAt: string }[]) ?? [];
        const newNote = {
          text: input.text,
          authorId: ctx.user.id,
          authorName: ctx.user.name ?? "Agente",
          createdAt: new Date().toISOString(),
        };
        const updated = [...existing, newNote];

        await db.update(leads).set({ internalNotes: updated, lastContactAt: new Date() }).where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "note_added", ctx.user.id, ctx.user.name, { note: input.text });
        return { success: true, note: newNote };
      }),

    markLost: staff
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        await db
          .update(leads)
          .set({ opportunityStatus: "perdida", status: "perdido", lostReason: input.reason, updatedAt: new Date() })
          .where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "marked_lost", ctx.user.id, ctx.user.name, { reason: input.reason });
        return { success: true };
      }),

    convertToQuote: staff
      .input(
        z.object({
          leadId: z.number(),
          title: z.string(),
          description: z.string().optional(),
          items: z.array(
            z.object({
              description: z.string(),
              quantity: z.number(),
              unitPrice: z.number().describe(QUOTE_UNIT_PRICE_DESCRIPTION),
              total: z.number().describe(QUOTE_LINE_TOTAL_DESCRIPTION),
              fiscalRegime: z.enum(["reav", "general"]).optional(),
              taxRate: z.number().optional(),
              productId: z.number().optional(),
              serviceDate: z.string().optional(), // YYYY-MM-DD: fecha de servicio propia de la línea
            })
          ),
          subtotal: z.number().describe("Base imponible (se recalcula en el servidor a partir de las líneas y el total)"),
          discount: z.number().default(0).describe(QUOTE_DISCOUNT_DESCRIPTION),
          taxRate: z.number().default(21),
          total: z.number().describe(QUOTE_TOTAL_DESCRIPTION),
          pricesIncludeTax: pricesIncludeTaxSchema,
          validUntil: z.string().optional(),
          activityDate: z.string().nullable().optional(),
          notes: z.string().optional(),
          conditions: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });

        // Producto = fuente de verdad fiscal: revalidar régimen/IVA de cada línea contra BD. Líneas con IVA
        // incluido; el total debe cuadrar con ellas menos el descuento (antes de consumir numeración).
        const items = await quoteItemsTaxIncluded(input.items, input.pricesIncludeTax, input.discount, input.total);
        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        // Base y cuota del total ya descontado (el descuento reduce la base y el IVA de cada tipo)
        const amounts = chargedInvoiceAmounts(items, input.total);
        const taxAmount = amounts.taxAmount;

        const [result] = await db.insert(quotes).values({
          quoteNumber,
          leadId: input.leadId,
          agentId: ctx.user.id,
          title: input.title,
          description: input.description,
          items,
          subtotal: String(amounts.subtotal),
          discount: String(input.discount),
          tax: String(taxAmount),
          total: String(input.total),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          activityDate: input.activityDate || (lead.preferredDate ? new Date(lead.preferredDate).toISOString().split("T")[0] : null),
          notes: input.notes,
          conditions: input.conditions,
          status: "borrador",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const quoteId = (result as { insertId: number }).insertId;

        // Update lead status
        await db
          .update(leads)
          .set({ status: "en_proceso", updatedAt: new Date() })
          .where(eq(leads.id, input.leadId));

        await logActivity("lead", input.leadId, "converted_to_quote", ctx.user.id, ctx.user.name, { quoteId, quoteNumber });
        await logActivity("quote", quoteId, "quote_created", ctx.user.id, ctx.user.name, { fromLead: input.leadId });
        return { success: true, quoteId, quoteNumber };
      }),

    // --- Generar presupuesto automáticamente desde activitiesJson del lead -------------------------
    generateFromLead: staff
      .input(z.object({
        leadId: z.number(),
        taxRate: z.number().default(21),
        conditions: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1. Cargar el lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });

        const activities = (lead.activitiesJson as {
          experienceId: number;
          experienceTitle: string;
          family: string;
          participants: number;
          details: Record<string, string | number>;
        }[] | null) ?? [];

        // 2. Resolver precios para cada actividad
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; taxRate?: number; productId?: number }[] = [];

        // -- Fallback: si no hay activitiesJson, buscar por selectedProduct en packs/experiences/legoPacks --
        if (activities.length === 0) {
          const productName = lead.selectedProduct;
          const qty = lead.numberOfPersons ?? 1;

          if (!productName) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Este lead no tiene actividades ni producto seleccionado. Añade los conceptos manualmente.",
            });
          }

          // Buscar en packs (día, escolar, empresa)
          const [foundPack] = await db.select().from(packs)
            .where(and(eq(packs.title, productName), eq(packs.isActive, true)))
            .limit(1);

          if (foundPack) {
            const unitPrice = parseFloat(String(foundPack.basePrice));
            quoteItems.push({
              description: `${foundPack.title}${foundPack.subtitle ? ` — ${foundPack.subtitle}` : ""}`,
              quantity: qty,
              unitPrice,
              total: parseFloat((unitPrice * qty).toFixed(2)),
              fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
              taxRate: foundPack.taxRate != null ? parseFloat(String(foundPack.taxRate)) : 21,
              productId: foundPack.id,
            });
          } else {
            // Buscar en legoPacks
            const [foundLego] = await db.select().from(legoPacks)
              .where(and(eq(legoPacks.title, productName), eq(legoPacks.isActive, true)))
              .limit(1);

            if (foundLego) {
              const unitPrice = parseFloat(String((foundLego as any).basePrice ?? (foundLego as any).price ?? 0));
              quoteItems.push({
                description: `${foundLego.title}${(foundLego as any).subtitle ? ` — ${(foundLego as any).subtitle}` : ""}`,
                quantity: qty,
                unitPrice,
                total: parseFloat((unitPrice * qty).toFixed(2)),
                fiscalRegime: "general",
                taxRate: (foundLego as any).taxRate != null ? parseFloat(String((foundLego as any).taxRate)) : 21,
                productId: foundLego.id,
              });
            } else {
              // Buscar en experiences
              const [foundExp] = await db.select().from(experiences)
                .where(and(eq(experiences.title, productName), eq(experiences.isActive, true)))
                .limit(1);

              if (foundExp) {
                const unitPrice = parseFloat(String(foundExp.basePrice));
                quoteItems.push({
                  description: foundExp.title,
                  quantity: qty,
                  unitPrice,
                  total: parseFloat((unitPrice * qty).toFixed(2)),
                  fiscalRegime: foundExp.fiscalRegime === "reav" ? "reav" : "general",
                  taxRate: foundExp.taxRate != null ? parseFloat(String(foundExp.taxRate)) : 21,
                  productId: foundExp.id,
                });
              } else {
                // Producto no encontrado en BD: crear línea vacía con nombre del producto
                quoteItems.push({
                  description: productName,
                  quantity: qty,
                  unitPrice: 0,
                  total: 0,
                  fiscalRegime: "general",
                  taxRate: 21,
                });
              }
            }
          }
        }

        for (const act of activities) {
          // Cargar experiencia base
          const [exp] = await db.select().from(experiences).where(eq(experiences.id, act.experienceId));
          const basePrice = exp ? parseFloat(String(exp.basePrice)) : 0;

          // Cargar variantes de esta experiencia
          const variants = await db
            .select()
            .from(experienceVariants)
            .where(eq(experienceVariants.experienceId, act.experienceId));

          // Determinar variante seleccionada (si existe)
          const selectedVariantName = act.details?.variante as string | undefined;
          const matchedVariant = selectedVariantName
            ? variants.find((v) => v.name === selectedVariantName)
            : variants.length === 1 ? variants[0] : null;

          let unitPrice = basePrice;
          let description = act.experienceTitle;

          if (matchedVariant) {
            const modifier = parseFloat(String(matchedVariant.priceModifier ?? "0"));
            if (matchedVariant.priceType === "per_person") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name} (${act.participants} pax)`;
            } else if (matchedVariant.priceType === "fixed") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            } else if (matchedVariant.priceType === "percentage") {
              unitPrice = basePrice * (1 + modifier / 100);
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            }
          } else if (variants.length > 0) {
            // Hay variantes pero ninguna seleccionada: usar precio base
            description = `${act.experienceTitle} (precio base)`;
          }

          // Añadir detalles contextuales a la descripción
          const detailParts: string[] = [];
          if (act.details?.duration) detailParts.push(String(act.details.duration));
          if (act.details?.jumps) detailParts.push(`${act.details.jumps} saltos`);
          if (act.details?.notes) detailParts.push(String(act.details.notes));
          if (detailParts.length > 0) description += ` — ${detailParts.join(" — ")}`;

           const quantity = act.participants;
          const total = parseFloat((unitPrice * quantity).toFixed(2));
          const itemFiscalRegime = exp?.fiscalRegime === "reav" ? "reav" : "general";
          const itemTaxRate = exp?.taxRate != null ? parseFloat(String(exp.taxRate)) : 21;
          quoteItems.push({ description, quantity, unitPrice: parseFloat(unitPrice.toFixed(2)), total, fiscalRegime: itemFiscalRegime, taxRate: itemTaxRate, productId: act.experienceId });
        }
        // 3. Calcular totales — IVA ya incluido en precios, se extrae con groupTaxBreakdown
        const subtotal = parseFloat(quoteItems.reduce((s, i) => s + i.total, 0).toFixed(2));
        const taxBreakdown = groupTaxBreakdown(quoteItems);
        const taxAmount = parseFloat(totalTaxAmount(taxBreakdown).toFixed(2));
        const total = subtotal;

        // 4. Crear el presupuesto en borrador
        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 15); // válido 15 días
        const voc = await panelVocabulary();

        const [result] = await db.insert(quotes).values({
          quoteNumber,
          leadId: input.leadId,
          agentId: ctx.user.id,
          title: `Propuesta para ${lead.name}`,
          description: `Generado automáticamente desde ${voc.licensed ? "los productos o servicios seleccionados" : "las actividades seleccionadas"} en el formulario.`,
          items: quoteItems,
          subtotal: String(subtotal),
          discount: "0",
          tax: String(taxAmount),
          total: String(total),
          validUntil,
          activityDate: lead.preferredDate ? new Date(lead.preferredDate).toISOString().split("T")[0] : null,
          conditions: input.conditions ?? voc.quoteConditions,
          status: "borrador",
          isAutoGenerated: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const quoteId = (result as { insertId: number }).insertId;

        // 5. Actualizar estado del lead
        await db.update(leads).set({ status: "en_proceso", updatedAt: new Date() }).where(eq(leads.id, input.leadId));

        await logActivity("lead", input.leadId, "auto_quote_generated", ctx.user.id, ctx.user.name, { quoteId, quoteNumber, itemCount: quoteItems.length });
        await logActivity("quote", quoteId, "quote_created", ctx.user.id, ctx.user.name, { fromLead: input.leadId, auto: true });

        return { success: true, quoteId, quoteNumber, itemCount: quoteItems.length, subtotal, total };
      }),

    // --- Previsualizar líneas desde activitiesJson (sin guardar en BD) ---------------------------
    previewFromLead: staffProcedure
      .input(z.object({ leadId: z.number() }))
      .query(async ({ input }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });
        const activities = (lead.activitiesJson as {
          experienceId: number;
          experienceTitle: string;
          family: string;
          participants: number;
          details: Record<string, string | number>;
        }[] | null) ?? [];
        if (activities.length === 0) {
          // Fallback: buscar por selectedProduct en packs/legoPacks/experiences
          const productName = lead.selectedProduct;
          const qty = lead.numberOfPersons ?? 1;
          if (!productName) return { items: [], hasActivities: false };

          const [foundPack] = await db.select().from(packs)
            .where(and(eq(packs.title, productName), eq(packs.isActive, true))).limit(1);
          if (foundPack) {
            const unitPrice = parseFloat(String(foundPack.basePrice));
            return { items: [{ description: `${foundPack.title}${foundPack.subtitle ? ` — ${foundPack.subtitle}` : ""}`, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general", productId: foundPack.id }], hasActivities: true, fromSelectedProduct: true };
          }
          const [foundLego] = await db.select().from(legoPacks)
            .where(and(eq(legoPacks.title, productName), eq(legoPacks.isActive, true))).limit(1);
          if (foundLego) {
            const unitPrice = parseFloat(String((foundLego as any).basePrice ?? (foundLego as any).price ?? 0));
            return { items: [{ description: `${foundLego.title}${(foundLego as any).subtitle ? ` — ${(foundLego as any).subtitle}` : ""}`, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: "general" as const, productId: foundLego.id }], hasActivities: true, fromSelectedProduct: true };
          }
          const [foundExp] = await db.select().from(experiences)
            .where(and(eq(experiences.title, productName), eq(experiences.isActive, true))).limit(1);
          if (foundExp) {
            const unitPrice = parseFloat(String(foundExp.basePrice));
            return { items: [{ description: foundExp.title, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: (foundExp.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general", productId: foundExp.id }], hasActivities: true, fromSelectedProduct: true };
          }
          return { items: [{ description: productName, quantity: qty, unitPrice: 0, total: 0, fiscalRegime: "general" as const }], hasActivities: true, fromSelectedProduct: true };
        }
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; productId?: number }[] = [];
        for (const act of activities) {
          const [exp] = await db.select().from(experiences).where(eq(experiences.id, act.experienceId));
          const basePrice = exp ? parseFloat(String(exp.basePrice)) : 0;
          const variants = await db.select().from(experienceVariants).where(eq(experienceVariants.experienceId, act.experienceId));
          const selectedVariantName = act.details?.variante as string | undefined;
          const matchedVariant = selectedVariantName
            ? variants.find((v) => v.name === selectedVariantName)
            : variants.length === 1 ? variants[0] : null;
          let unitPrice = basePrice;
          let description = act.experienceTitle;
          if (matchedVariant) {
            const modifier = parseFloat(String(matchedVariant.priceModifier ?? "0"));
            if (matchedVariant.priceType === "per_person") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name} (${act.participants} pax)`;
            } else if (matchedVariant.priceType === "fixed") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            } else if (matchedVariant.priceType === "percentage") {
              unitPrice = basePrice * (1 + modifier / 100);
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            }
          } else if (variants.length > 0) {
            description = `${act.experienceTitle} (precio base)`;
          }
          const detailParts: string[] = [];
          if (act.details?.duration) detailParts.push(String(act.details.duration));
          if (act.details?.jumps) detailParts.push(`${act.details.jumps} saltos`);
          if (act.details?.notes) detailParts.push(String(act.details.notes));
          if (detailParts.length > 0) description += ` — ${detailParts.join(" — ")}`;
          const quantity = act.participants;
          const total = parseFloat((unitPrice * quantity).toFixed(2));
          const itemFiscalRegime = exp?.fiscalRegime === "reav" ? "reav" : "general";
          quoteItems.push({ description, quantity, unitPrice: parseFloat(unitPrice.toFixed(2)), total, fiscalRegime: itemFiscalRegime, productId: act.experienceId });
        }
        return { items: quoteItems, hasActivities: true };
      }),

    create: staff
      .input(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
        company: z.string().optional(),
        message: z.string().optional(),
        preferredDate: z.string().optional(),
        numberOfAdults: z.number().optional(),
        numberOfChildren: z.number().optional(),
        selectedCategory: z.string().optional(),
        selectedProduct: z.string().optional(),
        source: z.string().optional(),
        activitiesJson: z.array(z.object({
          experienceId: z.number(),
          experienceTitle: z.string(),
          family: z.string(),
          participants: z.number(),
          details: z.record(z.string(), z.union([z.string(), z.number()])),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Usar createLead de db.ts para que se cree el cliente automáticamente
        const { source: _source, activitiesJson: _acts, ...leadInput } = input;
        const result = await createLead({
          ...leadInput,
          source: "crm_manual",
          leadSourceCode: "CRM_MANUAL",
        });
        // Si hay actividades, guardarlas en el lead
        if (input.activitiesJson && input.activitiesJson.length > 0) {
          await db.update(leads).set({ activitiesJson: input.activitiesJson }).where(eq(leads.id, result.id));
        }
        await logActivity("lead", result.id, "lead_created_admin", ctx.user.id, ctx.user.name, { name: input.name });

        // Disparar automatizaciones de email (igual que submitBudget)
        const emailData = {
          name: input.name,
          email: input.email,
          phone: input.phone ?? "",
          arrivalDate: input.preferredDate
            ? new Date(input.preferredDate).toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
            : "",
          adults: input.numberOfAdults ?? 1,
          children: input.numberOfChildren ?? 0,
          selectedCategory: input.selectedCategory ?? "",
          selectedProduct: input.selectedProduct ?? "",
          comments: input.message ?? "",
          submittedAt: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
          activitiesJson: input.activitiesJson ?? undefined,
        };
        sendManagedEmail({
          templateKey: "budget_request_user",
          triggerEvent: "lead_submitted",
          recipientEmail: input.email,
          subject: `Solicitud de presupuesto recibida — ${companyName()}`,
          html: buildBudgetRequestUserHtml(emailData),
          relatedEntityType: "lead",
          relatedEntityId: result.id,
          leadId: result.id,
        }).catch(err => console.error("[leads.create] Email al usuario fallido:", err));
        const adminEmail = await internalNoticeEmail();
        sendManagedEmail({
          templateKey: "budget_request_admin",
          triggerEvent: "lead_submitted",
          recipientEmail: adminEmail,
          subject: `?? Nueva solicitud — ${input.name} (${input.selectedCategory ?? "Sin categoría"})`,
          html: buildBudgetRequestAdminHtml(emailData),
          relatedEntityType: "lead",
          relatedEntityId: result.id,
          leadId: result.id,
          forceCustomer: true,
        }).catch(err => console.error("[leads.create] Email al admin fallido:", err));

        return result;
      }),

    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });
        // Borrar actividad relacionada
        await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "lead"), eq(crmActivityLog.entityId, input.id)));
        await db.delete(leads).where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "lead_deleted", ctx.user.id, ctx.user.name, { name: lead.name });
        return { success: true };
      }),

    bulkDelete: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        for (const id of input.ids) {
          await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "lead"), eq(crmActivityLog.entityId, id)));
        }
        await db.delete(leads).where(inArray(leads.id, input.ids));
        return { deleted: input.ids.length };
      }),

    bulkMarkSeen: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        await db.update(leads).set({ seenAt: new Date() }).where(and(inArray(leads.id, input.ids), isNull(leads.seenAt)));
        return { updated: input.ids.length };
      }),

    bulkUpdateStatus: staff
      .input(z.object({
        ids: z.array(z.number()).min(1),
        status: z.enum(["nueva", "enviada", "ganada", "perdida"]),
      }))
      .mutation(async ({ input }) => {
        await db.update(leads).set({ opportunityStatus: input.status, updatedAt: new Date() }).where(inArray(leads.id, input.ids));
        return { updated: input.ids.length };
      }),
  }),

  // --- LEAD SOURCES ------------------------------------------------------------

  leadSources: router({
    list: staff.query(async () => {
      return db
        .select()
        .from(crmLeadSources)
        .where(eq(crmLeadSources.isActive, true))
        .orderBy(crmLeadSources.sortOrder, crmLeadSources.name);
    }),

    listAll: admin.query(async () => {
      return db
        .select()
        .from(crmLeadSources)
        .orderBy(crmLeadSources.sortOrder, crmLeadSources.name);
    }),

    create: admin
      .input(z.object({
        code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, "Código solo mayúsculas, números y guión bajo"),
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        await db.insert(crmLeadSources).values({ ...input, isActive: true, isSystem: false });
        return { success: true };
      }),

    update: admin
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.update(crmLeadSources).set({ ...data, updatedAt: new Date() }).where(eq(crmLeadSources.id, id));
        return { success: true };
      }),

    delete: admin
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const [src] = await db.select({ isSystem: crmLeadSources.isSystem }).from(crmLeadSources).where(eq(crmLeadSources.id, input.id));
        if (!src) throw new TRPCError({ code: "NOT_FOUND" });
        if (src.isSystem) throw new TRPCError({ code: "FORBIDDEN", message: "No se puede eliminar un origen de sistema" });
        await db.delete(crmLeadSources).where(eq(crmLeadSources.id, input.id));
        return { success: true };
      }),
  }),

  // --- QUOTESES ----------------------------------------------------------------

  quotes: router({
    list: staff
      .input(
        z.object({
          status: z.enum(["borrador", "enviado", "visualizado", "convertido_carrito", "pago_fallido", "aceptado", "rechazado", "expirado", "perdido"]).optional(),
          search: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        const conditions = [];
        if (input.status) conditions.push(eq(quotes.status, input.status));
         if (input.from) conditions.push(gte(quotes.createdAt, new Date(input.from)));
        if (input.to) conditions.push(lte(quotes.createdAt, new Date(input.to)));
        // Join con leads para obtener datos del cliente
        // NOTE: search filter is applied AFTER the join so we can search by client name/email/phone
        const baseQuery = db
          .select({
            id: quotes.id,
            quoteNumber: quotes.quoteNumber,
            title: quotes.title,
            status: quotes.status,
            total: quotes.total,
            subtotal: quotes.subtotal,
            discount: quotes.discount,
            tax: quotes.tax,
            items: quotes.items,
            validUntil: quotes.validUntil,
            notes: quotes.notes,
            conditions: quotes.conditions,
            paymentLinkUrl: quotes.paymentLinkUrl,
            paymentLinkToken: quotes.paymentLinkToken,
            paidAt: quotes.paidAt,
            sentAt: quotes.sentAt,
            viewedAt: quotes.viewedAt,
            isAutoGenerated: quotes.isAutoGenerated,
            invoiceNumber: quotes.invoiceNumber,
            invoicePdfUrl: quotes.invoicePdfUrl,
            createdAt: quotes.createdAt,
            updatedAt: quotes.updatedAt,
            leadId: quotes.leadId,
            agentId: quotes.agentId,
            paymentPlanId: quotes.paymentPlanId,
            // Datos del cliente (desde el lead)
            clientName: leads.name,
            clientEmail: leads.email,
            clientPhone: leads.phone,
            clientCompany: leads.company,
            clientId: clients.id,
          })
          .from(quotes)
          .leftJoin(leads, eq(quotes.leadId, leads.id))
          .leftJoin(clients, eq(clients.leadId, quotes.leadId));
        // Build search condition including joined lead fields
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(
            or(
              like(quotes.quoteNumber, s),
              like(quotes.title, s),
              like(quotes.notes, s),
              like(leads.name, s),
              like(leads.email, s),
              like(leads.phone, s),
              like(leads.company, s),
              like(leads.selectedProduct, s)
            )
          );
        }
        const where = conditions.length ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          baseQuery
            .where(where)
            .orderBy(desc(quotes.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(quotes)
            .leftJoin(leads, eq(quotes.leadId, leads.id))
            .leftJoin(clients, eq(clients.leadId, quotes.leadId))
            .where(where),
        ]);
        return { rows, total };
      }),

    counters: staff.query(async () => {
      const [borrador, enviado, pagoFallido, pendientePago, ganado, perdido, totalImporte,
             importeBorrador, importeEnviado, importePagoFallido] = await Promise.all([
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "borrador")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "enviado")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "pago_fallido")),
        db.select({ cnt: count() }).from(quotes).where(and(eq(quotes.status, "enviado"), sql`${quotes.paidAt} IS NULL`)),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "aceptado")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "perdido")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "aceptado")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "borrador")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "enviado")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "pago_fallido")),
      ]);

      const totalEnviados = (enviado[0]?.cnt ?? 0);
      const totalGanados = (ganado[0]?.cnt ?? 0);
      const ratio = totalEnviados > 0 ? Math.round((totalGanados / totalEnviados) * 100) : 0;

      return {
        borrador: borrador[0]?.cnt ?? 0,
        enviado: enviado[0]?.cnt ?? 0,
        pagoFallido: pagoFallido[0]?.cnt ?? 0,
        pendientePago: pendientePago[0]?.cnt ?? 0,
        ganado: totalGanados,
        perdido: perdido[0]?.cnt ?? 0,
        importeTotal: Number(totalImporte[0]?.total ?? 0).toFixed(2),
        importeBorrador: Number(importeBorrador[0]?.total ?? 0),
        importeEnviado: Number(importeEnviado[0]?.total ?? 0),
        importePagoFallido: Number(importePagoFallido[0]?.total ?? 0),
        ratioConversion: ratio,
      };
    }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        const activity = await db
          .select()
          .from(crmActivityLog)
          .where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, input.id)))
          .orderBy(desc(crmActivityLog.createdAt))
          .limit(50);

        const relatedInvoices = await db.select().from(invoices).where(eq(invoices.quoteId, input.id));

        return { quote, lead, activity, invoices: relatedInvoices };
      }),

    update: staff
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          description: z.string().optional(),
          items: z
            .array(
              z.object({
                description: z.string(),
                quantity: z.number(),
                unitPrice: z.number().describe(QUOTE_UNIT_PRICE_DESCRIPTION),
                total: z.number().describe(QUOTE_LINE_TOTAL_DESCRIPTION),
                fiscalRegime: z.enum(["reav", "general"]).optional(),
                taxRate: z.number().optional(),
                productId: z.number().optional(),
                serviceDate: z.string().optional(), // YYYY-MM-DD: fecha de servicio propia de la línea
              })
            )
            .optional(),
          subtotal: z.number().optional().describe("Base imponible (se recalcula en el servidor a partir de las líneas y el total)"),
          discount: z.number().optional().describe(QUOTE_DISCOUNT_DESCRIPTION),
          taxRate: z.number().optional(),
          total: z.number().optional().describe(QUOTE_TOTAL_DESCRIPTION),
          pricesIncludeTax: pricesIncludeTaxSchema,
          validUntil: z.string().optional(),
          activityDate: z.string().nullable().optional(),
          notes: z.string().optional(),
          conditions: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // `taxRate` global se ignora: la fiscalidad la define cada línea (producto = fuente de verdad).
        const { id, taxRate: _ignoredGlobalTaxRate, pricesIncludeTax, ...rest } = input;
        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (rest.title !== undefined) updateData.title = rest.title;
        if (rest.description !== undefined) updateData.description = rest.description;
        if (rest.items !== undefined || rest.discount !== undefined || rest.total !== undefined) {
          // Importes con el convenio de IVA incluido: lo que no llega se toma del presupuesto guardado y el
          // conjunto (líneas, descuento y total) debe cuadrar.
          const [current] = await db.select({ items: quotes.items, discount: quotes.discount, total: quotes.total }).from(quotes).where(eq(quotes.id, id)).limit(1);
          if (!current) throw new TRPCError({ code: "NOT_FOUND" });
          const discount = rest.discount ?? Number(current.discount ?? 0);
          const total = rest.total ?? Number(current.total ?? 0);
          // Producto = fuente de verdad fiscal: revalidar régimen/IVA contra BD.
          const items = rest.items !== undefined
            ? await quoteItemsTaxIncluded(rest.items, pricesIncludeTax, discount, total)
            : (current.items ?? []);
          if (rest.items === undefined) {
            const mismatch = quoteTotalMismatch(items, discount, total);
            if (mismatch) throw new TRPCError({ code: "BAD_REQUEST", message: mismatch });
          }
          // IVA recalculado por línea sobre el total ya descontado (PVP con IVA incluido); nunca un IVA global.
          const amounts = chargedInvoiceAmounts(items, total);
          if (rest.items !== undefined) updateData.items = items;
          updateData.tax = String(amounts.taxAmount);
          updateData.subtotal = String(amounts.subtotal);
          if (rest.discount !== undefined) updateData.discount = String(rest.discount);
          if (rest.total !== undefined) updateData.total = String(rest.total);
        } else if (rest.subtotal !== undefined) {
          updateData.subtotal = String(rest.subtotal);
        }
        if (rest.validUntil) updateData.validUntil = new Date(rest.validUntil);
        if (rest.activityDate !== undefined) updateData.activityDate = rest.activityDate || null;
        if (rest.notes !== undefined) updateData.notes = rest.notes;
        if (rest.conditions !== undefined) updateData.conditions = rest.conditions;

        await db.update(quotes).set(updateData).where(eq(quotes.id, id));
        await logActivity("quote", id, "quote_updated", ctx.user.id, ctx.user.name, {});
        return { success: true };
      }),

    send: staff
      .input(
        z.object({
          id: z.number(),
          /** URL base del frontend (window.location.origin) para construir el enlace de aceptación */
          origin: z.string().url().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead asociado no encontrado" });
        assertQuotePricedForSend(quote.items);

        // Generar token único de aceptación si no existe ya
        const { randomBytes } = await import("crypto");
        const token = quote.paymentLinkToken ?? randomBytes(32).toString("hex");
        const origin = input.origin ?? publicBaseUrl();
        const acceptUrl = `${origin}/presupuesto/${token}`;

        // Update quote
        await db
          .update(quotes)
          .set({
            status: "enviado",
            sentAt: new Date(),
            paymentLinkToken: token,
            paymentLinkUrl: acceptUrl,
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, input.id));

        // Update lead opportunity status
        await db
          .update(leads)
          .set({ opportunityStatus: "enviada", status: "contactado", lastContactAt: new Date(), seenAt: new Date(), updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));

        // Send email con el enlace de aceptación
        let quoteInstallmentPlan = null;
        if (quote.paymentPlanId) {
          const planInsts = await db.select({
            installmentNumber: paymentInstallments.installmentNumber,
            amountCents: paymentInstallments.amountCents,
            dueDate: paymentInstallments.dueDate,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
          }).from(paymentInstallments)
            .where(eq(paymentInstallments.quoteId, quote.id))
            .orderBy(paymentInstallments.installmentNumber);
          const firstReq = planInsts.find(i => i.isRequiredForConfirmation) ?? null;
          quoteInstallmentPlan = { firstRequiredAmountCents: firstReq?.amountCents ?? null, installments: planInsts };
        }
        const mail = await sendQuoteEmail({
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          clientName: lead.name,
          clientEmail: lead.email,
          items: (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: quote.subtotal,
          discount: quote.discount ?? "0",
          tax: quote.tax ?? "0",
          total: quote.total,
          validUntil: quote.validUntil,
          notes: quote.notes,
          conditions: quote.conditions,
          paymentLinkUrl: acceptUrl,
          installmentPlan: quoteInstallmentPlan,
        });

        await logActivity("quote", input.id, "quote_sent", ctx.user.id, ctx.user.name, { email: lead.email, acceptUrl });
        await logActivity("lead", quote.leadId, "quote_sent_to_client", ctx.user.id, ctx.user.name, { quoteId: input.id });

        // Sync URL del presupuesto al contacto GHL (fire-and-forget)
        getGHLCredentials().then(ghlCreds => {
          syncLeadUrlsToGHL({
            ghlContactId: (lead as any).ghlContactId,
            quoteUrl: acceptUrl,
            quoteNumber: quote.quoteNumber,
            email: lead.email,
            phone: lead.phone,
            credentials: ghlCreds ?? undefined,
          });
        });

        return { success: true, acceptUrl, token, ...mail };
      }),

    resend: staff
      .input(z.object({
        id: z.number(),
        origin: z.string().url().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
        assertQuotePricedForSend(quote.items);

        // Si el presupuesto no tiene token de aceptación, generarlo ahora
        const { randomBytes } = await import("crypto");
        let paymentLinkUrl = quote.paymentLinkUrl;
        if (!paymentLinkUrl || !quote.paymentLinkToken) {
          const token = randomBytes(32).toString("hex");
          const origin = input.origin ?? publicBaseUrl();
          paymentLinkUrl = `${origin}/presupuesto/${token}`;
          await db.update(quotes).set({
            paymentLinkToken: token,
            paymentLinkUrl,
            updatedAt: new Date(),
          }).where(eq(quotes.id, input.id));
        }

        let resendInstallmentPlan = null;
        if (quote.paymentPlanId) {
          const planInsts = await db.select({
            installmentNumber: paymentInstallments.installmentNumber,
            amountCents: paymentInstallments.amountCents,
            dueDate: paymentInstallments.dueDate,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
          }).from(paymentInstallments)
            .where(eq(paymentInstallments.quoteId, quote.id))
            .orderBy(paymentInstallments.installmentNumber);
          const firstReq = planInsts.find(i => i.isRequiredForConfirmation) ?? null;
          resendInstallmentPlan = { firstRequiredAmountCents: firstReq?.amountCents ?? null, installments: planInsts };
        }
        const mail = await sendQuoteEmail({
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          clientName: lead.name,
          clientEmail: lead.email,
          items: (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: quote.subtotal,
          discount: quote.discount ?? "0",
          tax: quote.tax ?? "0",
          total: quote.total,
          validUntil: quote.validUntil,
          notes: quote.notes,
          conditions: quote.conditions,
          paymentLinkUrl,
          installmentPlan: resendInstallmentPlan,
        });
        await logActivity("quote", input.id, "quote_resent", ctx.user.id, ctx.user.name, { paymentLinkUrl });

        // Sync URL del presupuesto regenerado al contacto GHL (fire-and-forget)
        getGHLCredentials().then(ghlCreds => {
          syncLeadUrlsToGHL({
            ghlContactId: (lead as any).ghlContactId,
            quoteUrl: paymentLinkUrl ?? undefined,
            quoteNumber: quote.quoteNumber,
            email: lead.email,
            phone: lead.phone,
            credentials: ghlCreds ?? undefined,
          });
        });

        return { success: true, acceptUrl: paymentLinkUrl ?? null, ...mail };
      }),

    duplicate: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [original] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!original) throw new TRPCError({ code: "NOT_FOUND" });

        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        const [result] = await db.insert(quotes).values({
          quoteNumber,
          leadId: original.leadId,
          agentId: ctx.user.id,
          title: `${original.title} (copia)`,
          description: original.description,
          items: original.items,
          subtotal: original.subtotal,
          discount: original.discount,
          tax: original.tax,
          total: original.total,
          validUntil: original.validUntil,
          activityDate: original.activityDate,
          notes: original.notes,
          conditions: original.conditions,
          status: "borrador",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const newId = (result as { insertId: number }).insertId;
        await logActivity("quote", newId, "quote_duplicated", ctx.user.id, ctx.user.name, { originalId: input.id });
        return { success: true, quoteId: newId, quoteNumber };
      }),

    markLost: staff
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        await db.update(quotes).set({ status: "perdido", updatedAt: new Date() }).where(eq(quotes.id, input.id));
        await db
          .update(leads)
          .set({ opportunityStatus: "perdida", status: "perdido", lostReason: input.reason, updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));

        await logActivity("quote", input.id, "quote_lost", ctx.user.id, ctx.user.name, { reason: input.reason });
        return { success: true };
      }),

    // Called from Redsys webhook or manual confirmation
    confirmPayment: staff
      .input(
        z.object({
          quoteId: z.number(),
          redsysOrderId: z.string().optional(),
          paidAmount: z.number().optional(),
          paymentMethod: z.enum(["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]).optional(),
          tpvOperationNumber: z.string().optional(), // Nº operación TPV (tarjeta)
          paymentNote: z.string().optional(),        // Justificación (efectivo) o nota interna
          transferProofUrl: z.string().optional(),   // URL S3 del justificante de transferencia
          transferProofKey: z.string().optional(),   // Key S3 del justificante de transferencia
          bankMovementId: z.number().optional(),     // Vincular movimiento bancario conciliado
          cardTerminalOperationId: z.number().optional(), // Vincular operación TPV (tarjeta)
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Idempotencia: si el presupuesto ya está pagado, devolver la factura existente sin duplicar
        if (quote.paidAt || quote.status === "aceptado") {
          const [existingInv] = await db.select().from(invoices)
            .where(eq(invoices.quoteId, quote.id))
            .orderBy(invoices.id)
            .limit(1);
          if (existingInv) {
            return {
              success: true,
              invoiceId: existingInv.id,
              invoiceNumber: existingInv.invoiceNumber,
              reservationId: null,
              pdfUrl: existingInv.pdfUrl ?? null,
              reavExpedientId: null,
              reavExpedientNumber: null,
            };
          }
        }

        // La factura es por lo cobrado: un importe distinto del total del presupuesto no se factura aquí
        assertPaidAmountMatchesQuote(input.paidAmount, quote.total);
        const now = new Date();

        // Generate invoice
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        // Datos fiscales del cliente vinculado al presupuesto (NIF, nombre fiscal y dirección)
        const billTo = await invoiceClientForQuote(db, quote, { name: lead.name, email: lead.email, phone: lead.phone });
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
        // Lo facturado es lo cobrado: el total del presupuesto. El descuento reduce base e IVA de cada tipo.
        const amountsInv = chargedInvoiceAmounts(items, Number(quote.total));
        const { subtotal, taxAmount, total } = amountsInv;
        const bdInv = amountsInv.taxBreakdown;
        const taxRate = amountsInv.taxRate;
        // Generate PDF
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            ...billTo,
            itemsJson: items,
            subtotal: String(subtotal),
            discount: amountsInv.discount,
            discountReason: amountsInv.discount > 0 ? QUOTE_DISCOUNT_REASON : null,
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total),
            taxBreakdown: bdInv,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("PDF generation failed:", e);
        }
        // Insert invoice record
        // Determinar productId principal desde las líneas del presupuesto
        const mainProductId = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? lead.experienceId ?? 0;

        const [invResult] = await db.insert(invoices).values({
          issuerSnapshot: await issuerSnapshotForNewInvoice(),
          invoiceNumber,
          quoteId: quote.id,
          ...billTo,
          itemsJson: items,
          subtotal: String(subtotal),
          discount: String(amountsInv.discount),
          discountReason: amountsInv.discount > 0 ? QUOTE_DISCOUNT_REASON : null,
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdInv.length > 0 ? bdInv : undefined,
          total: String(total),
          pdfUrl,
          pdfKey,
          isAutomatic: false,
          status: "generada",
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;

        // Create reservation
        // Fecha operativa: prioridad quote.activityDate (editable desde admin) ? lead.preferredDate ? hoy
        const serviceDate = quote.activityDate
          ? String(quote.activityDate).slice(0, 10)
          : lead.preferredDate
            ? new Date(lead.preferredDate).toISOString().split("T")[0]
            : now.toISOString().split("T")[0];
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const reservationNumber = await generateReservationNum("crm:confirmPayment", String(ctx.user.id));
        const resProd = reservationProductFromQuoteItems(quote.items, mainProductId);
        const [resResult] = await db.insert(reservations).values({
          productId: resProd.productId,
          productName: quote.title,
          extrasJson: resProd.extrasJson,
          bookingDate: resProd.mainServiceDate ?? serviceDate,
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: Math.round((input.paidAmount ?? total) * 100),
          status: "paid",
          statusReservation: "CONFIRMADA",
          statusPayment: "PAGADO",
          // Canal: presupuesto cobrado manualmente por el equipo ? siempre ONLINE_ASISTIDO
          channel: "ONLINE_ASISTIDO",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          reservationNumber,
          paymentMethod: input.paymentMethod ?? "efectivo",
          transferProofUrl: input.transferProofUrl ?? null,
          notes: [
            `Generado desde presupuesto ${quote.quoteNumber}`,
            input.tpvOperationNumber ? `Nº operación TPV: ${input.tpvOperationNumber}` : null,
            input.paymentNote ? `Nota: ${input.paymentNote}` : null,
            input.transferProofUrl ? `Justificante transferencia adjunto` : null,
          ].filter(Boolean).join(" — "),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paidAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;
        // FIX: Vincular factura ? reserva recién creadass
        await db.update(invoices).set({ reservationId, updatedAt: now }).where(eq(invoices.id, invoiceId));
        await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() } as any).where(eq(reservations.id, reservationId));

        // Crear/actualizar cliente en el CRM
        await upsertClientFromReservation({
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          source: "presupuesto",
          leadId: lead.id,
        });

        // Update quote
        await db
          .update(quotes)
          .set({
            status: "aceptado",
            paidAt: now,
            redsysOrderId: input.redsysOrderId,
            invoiceNumber,
            invoicePdfUrl: pdfUrl,
            invoiceGeneratedAt: now,
            updatedAt: now,
          })
          .where(eq(quotes.id, input.quoteId));

        // Update lead
        await db
          .update(leads)
          .set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now })
          .where(eq(leads.id, quote.leadId));

        // Log activity
        await logActivity("quote", quote.id, "payment_confirmed", ctx.user.id, ctx.user.name, { invoiceId, reservationId });
        await logActivity("lead", quote.leadId, "opportunity_won", ctx.user.id, ctx.user.name, { quoteId: quote.id });
        await logActivity("invoice", invoiceId, "invoice_generated", ctx.user.id, ctx.user.name, { pdfUrl });

        // Sync URL de factura al contacto GHL (fire-and-forget)
        getGHLCredentials().then(ghlCreds => {
          syncLeadUrlsToGHL({
            ghlContactId: (lead as any).ghlContactId,
            invoiceUrl: pdfUrl ?? undefined,
            invoiceNumber,
            credentials: ghlCreds ?? undefined,
          });
        });

        // Send emails
        try {
          await sendConfirmationEmail({
            clientName: lead.name,
            clientEmail: lead.email,
            reservationRef,
            quoteTitle: quote.title,
            items,
            total: String(total),
            invoiceUrl: pdfUrl,
            bookingDate: serviceDate ?? undefined,
          });
        } catch (e) {
          console.error("Confirmation email failed:", e);
        }

        try {
          await sendInternalNotification({
            clientName: lead.name,
            clientEmail: lead.email,
            clientPhone: lead.phone,
            reservationRef,
            quoteTitle: quote.title,
            total: String(total),
            paidAt: now,
            reservationId,
          });
        } catch (e) {
          console.error("Internal notification failed:", e);
        }

        // -- Crear expediente REAV automáticamente si hay líneas REAV -------------
        const reavLines = items.filter(i => i.fiscalRegime === "reav");
        let reavExpedientId: number | undefined;
        let reavExpedientNumber: string | undefined;
        if (reavLines.length > 0) {
          try {
            const reavSaleAmount = reavLines.reduce((s, i) => s + i.total, 0);

            // -- P5+P3+P4: calcular por línea con los porcentajes de cada producto --
            // Cada línea REAV puede tener un producto con porcentajes distintos.
            // Si la config es inválida no se usa fallback 60/40 — se registra la advertencia.
            let totalEstimatedCost = 0;
            let totalEstimatedMargin = 0;
            const configWarnings: string[] = [];

            for (const line of reavLines as any[]) {
              const productId = line.productId ?? (lead as any).experienceId;
              let lineCostePct: number | null = null;
              let lineMargenPct: number | null = null;

              if (productId) {
                const [prod] = await db.select({
                  providerPercent: experiences.providerPercent,
                  agencyMarginPercent: experiences.agencyMarginPercent,
                  fiscalRegime: experiences.fiscalRegime,
                }).from(experiences).where(eq(experiences.id, productId)).limit(1);

                if (prod?.fiscalRegime === "reav") {
                  const errores = validarConfiguracionREAV(prod);
                  if (errores.length === 0) {
                    lineCostePct = parseFloat(String(prod.providerPercent));
                    lineMargenPct = parseFloat(String(prod.agencyMarginPercent));
                  } else {
                    configWarnings.push(`Producto ${productId} (${line.description}): ${errores.join("; ")}`);
                    console.warn(`[confirmPayment] REAV config inválida en producto ${productId}:`, errores);
                  }
                } else if (prod) {
                  configWarnings.push(`Producto ${productId} (${line.description}): fiscalRegime no es "reav" (es "${prod.fiscalRegime}").`);
                }
              } else {
                configWarnings.push(`Línea "${line.description}": sin productId, no se pueden obtener porcentajes REAV.`);
              }

              if (lineCostePct !== null && lineMargenPct !== null) {
                const lineCalc = calcularREAVSimple(line.total, lineCostePct, lineMargenPct);
                totalEstimatedCost += lineCalc.costeProveedor;
                totalEstimatedMargin += lineCalc.margenAgencia;
              } else {
                // Sin config válida: coste y margen estimados quedan en 0 (visible en expediente)
                configWarnings.push(`Línea "${line.description}" (${line.total.toFixed(2)}€): coste/margen estimados no calculados — revisar configuración del producto.`);
              }
            }

            const reavCalc = { costeProveedor: totalEstimatedCost, margenAgencia: totalEstimatedMargin };
            // Obtener datos del cliente del lead
            const clientName = lead.name ?? undefined;
            const clientEmail = lead.email ?? undefined;
            const clientPhone = lead.phone ?? undefined;
            const clientDni = (lead as any).dni ?? undefined;
            const clientAddress = (lead as any).address ?? undefined;
            const reavResult = await createReavExpedient({
              invoiceId,
              reservationId,
              quoteId: quote.id,
              serviceDescription: reavLines.map(i => i.description).join(" | "),
              serviceDate: serviceDate,
              numberOfPax: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
              saleAmountTotal: String(reavSaleAmount),
              providerCostEstimated: String(reavCalc.costeProveedor),
              agencyMarginEstimated: String(reavCalc.margenAgencia),
              // Datos del cliente
              clientName,
              clientEmail,
              clientPhone,
              clientDni,
              clientAddress,
              // Canal y referencia
              channel: "crm",
              sourceRef: invoiceNumber,
              internalNotes: [
                `Expediente creado automáticamente al confirmar pago del presupuesto ${quote.quoteNumber ?? quote.id}.`,
                clientName ? `Cliente: ${clientName}` : null,
                clientEmail ? `Email: ${clientEmail}` : null,
                clientPhone ? `Teléfono: ${clientPhone}` : null,
                clientDni ? `DNI/NIF: ${clientDni}` : null,
                `Factura: ${invoiceNumber}`,
                `Importe REAV: ${reavSaleAmount.toFixed(2)}€`,
                `Agente: ${ctx.user.name ?? ctx.user.email}`,
                configWarnings.length > 0 ? `? REVISAR CONFIGURACIÓN REAV: ${configWarnings.join(" | ")}` : null,
              ].filter(Boolean).join(" — "),
            });
            reavExpedientId = reavResult.id;
            reavExpedientNumber = reavResult.expedientNumber;
            // Adjuntar la factura PDF al expediente (documento del cliente)
            if (pdfUrl && reavExpedientId) {
              await attachReavDocument({
                expedientId: reavExpedientId,
                side: "client",
                docType: "factura_emitida",
                title: `Factura ${invoiceNumber}`,
                fileUrl: pdfUrl,
                mimeType: "application/pdf",
                notes: `Factura generada automáticamente al confirmar pago. Presupuesto: ${quote.quoteNumber ?? quote.id}.`,
                uploadedBy: ctx.user.id,
              });
            }
            // Adjuntar el presupuesto PDF al expediente (documento del cliente)
            if ((quote as any).pdfUrl && reavExpedientId) {
              await attachReavDocument({
                expedientId: reavExpedientId,
                side: "client",
                docType: "otro",
                title: `Presupuesto ${quote.quoteNumber ?? quote.id}`,
                fileUrl: (quote as any).pdfUrl,
                mimeType: "application/pdf",
                notes: `Presupuesto original aceptado por el cliente.`,
                uploadedBy: ctx.user.id,
              });
            }
            await logActivity("invoice", invoiceId, "reav_expedient_created", ctx.user.id, ctx.user.name, { expedientId: reavExpedientId, expedientNumber: reavExpedientNumber });
          } catch (e) {
            console.error("[confirmPayment] Error al crear expediente REAV:", e);
          }
        }

        // -- BUG #2 + #3 FIX: Crear booking operativo + transacción contable ---------
        try {
          const bdForTx = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
          const taxAmountForTx = totalTaxAmount(bdForTx);
          const generalSubtotalForTx = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
          const reavSubtotalForTx = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
          const fiscalRegimeForTx = reavSubtotalForTx > 0 && generalSubtotalForTx > 0 ? "mixed"
            : reavSubtotalForTx > 0 ? "reav" : "general";
          await postConfirmOperation({
            reservationId,
            productId: mainProductId, // FIX: usar el productId principal del presupuesto
            productName: quote.title,
            serviceDate,
            people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
            amountCents: Math.round((input.paidAmount ?? total) * 100),
            customerName: lead.name,
            customerEmail: lead.email,
            customerPhone: lead.phone,
            totalAmount: total,
            paymentMethod: input.paymentMethod ?? "otro",
            saleChannel: "crm",
            invoiceNumber,
            reservationRef,
            sellerUserId: ctx.user.id,
            sellerName: ctx.user.name ?? undefined,
            taxBase: generalSubtotalForTx,
            taxAmount: taxAmountForTx,
            reavMargin: reavSubtotalForTx,
            fiscalRegime: fiscalRegimeForTx,
            description: `Pago CRM — ${quote.quoteNumber} — ${lead.name}`,
            quoteId: quote.id,
            sourceChannel: "otro",
            ghlContactId: (lead as any).ghlContactId ?? null,
          });
          await logActivity("reservation", reservationId, "booking_and_transaction_created", ctx.user.id, ctx.user.name, { invoiceNumber, serviceDate });
        } catch (e) {
          console.error("[confirmPayment] Error en postConfirmOperation:", e);
        }

        // -- Conciliación bancaria opcional --------------------------------------
        if (input.bankMovementId) {
          const [bm] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
          if (bm && bm.conciliationStatus !== "conciliado") {
            await db.insert(bankMovementLinks).values({
              bankMovementId: input.bankMovementId,
              entityType: "quote",
              entityId: input.quoteId,
              linkType: "income_transfer",
              amountLinked: String(total),
              status: "confirmed",
              confidenceScore: 100,
              matchedBy: ctx.user.name ?? undefined,
              matchedAt: now,
            });
            await db.update(bankMovements)
              .set({ conciliationStatus: "conciliado" })
              .where(eq(bankMovements.id, input.bankMovementId));
            await logActivity("quote", input.quoteId, "bank_movement_linked", ctx.user.id, ctx.user.name, {
              bankMovementId: input.bankMovementId,
              amount: total,
            });
          }
        }

        // -- Vinculación operación TPV opcional ------------------------------
        if (input.cardTerminalOperationId) {
          const [tpvOp] = await db.select().from(cardTerminalOperations).where(eq(cardTerminalOperations.id, input.cardTerminalOperationId));
          if (tpvOp && tpvOp.status !== "conciliado") {
            await db.update(cardTerminalOperations).set({
              linkedEntityType: "quote",
              linkedEntityId: input.quoteId,
              linkedAt: now,
              linkedBy: ctx.user.name ?? "admin",
              status: "conciliado",
            }).where(eq(cardTerminalOperations.id, input.cardTerminalOperationId));
            await logActivity("quote", input.quoteId, "tpv_operation_linked", ctx.user.id, ctx.user.name, {
              cardTerminalOperationId: input.cardTerminalOperationId,
              operationNumber: tpvOp.operationNumber,
              amount: total,
            });
          }
        }

        // -- Caja: movimiento automático si pago en efectivo -----------------
        if ((input.paymentMethod ?? "efectivo") === "efectivo") {
          try {
            const cashAccountId = await getDefaultCashAccountId();
            if (cashAccountId) {
              await createCashMovementIfNotExists({
                accountId: cashAccountId,
                date: now.toISOString().slice(0, 10),
                type: "income",
                amount: total,
                concept: `Cobro en efectivo ${quote.quoteNumber} — ${lead.name}`,
                relatedEntityType: "reservation",
                relatedEntityId: reservationId,
                createdBy: ctx.user.id,
              });
            }
          } catch (e) {
            console.error("[confirmPayment] Error creando movimiento de caja:", e);
          }
        }

        return { success: true, invoiceId, invoiceNumber, reservationId, pdfUrl, reavExpedientId, reavExpedientNumber };
      }),

    // --- ESCENARIO B: Convertir a reserva SIN pago previo (admin manual) ------
    convertToReservation: staff
      .input(z.object({
        quoteId: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead asociado no encontrado" });
        // Idempotente: un presupuesto ya convertido (doble clic, reintento) no genera otro pedido
        const [existing] = await db
          .select({ id: reservations.id, merchantOrder: reservations.merchantOrder, status: reservations.status })
          .from(reservations)
          .where(and(eq(reservations.quoteId, input.quoteId), ne(reservations.status, "cancelled")))
          .limit(1);
        if (existing) return { success: true, reservationId: existing.id, reservationRef: existing.merchantOrder, status: existing.status };

        const now = new Date();
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const total = Number(quote.total);
        const reservationNumberConvert = await generateReservationNum("crm:convertQuote", String(ctx.user.id));

        // Crear reserva CONFIRMADA: el admin siempre confirma al convertir, independientemente del pago
        // Fecha operativa: quote.activityDate (editable desde admin) ? lead.preferredDate ? hoy
        const serviceDate = quote.activityDate
          ? String(quote.activityDate).slice(0, 10)
          : lead.preferredDate
            ? new Date(lead.preferredDate).toISOString().split("T")[0]
            : now.toISOString().split("T")[0];
        const resProd = reservationProductFromQuoteItems(quote.items);
        const [resResult] = await db.insert(reservations).values({
          productId: resProd.productId,
          productName: quote.title,
          extrasJson: resProd.extrasJson,
          bookingDate: resProd.mainServiceDate ?? serviceDate,
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: 0,
          status: "pending_payment",         // pago pendiente
          statusReservation: "CONFIRMADA",    // reserva SIEMPRE confirmada por el admin
          statusPayment: "PENDIENTE",          // pago pendiente hasta que se cobre
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          reservationNumber: reservationNumberConvert,
          channel: "ONLINE_ASISTIDO",
          quoteId: input.quoteId,
          quoteSource: "presupuesto",
          notes: input.notes ?? `Convertido manualmente desde presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // Crear/actualizar cliente en el CRM
        await upsertClientFromReservation({
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          source: "presupuesto",
          leadId: lead.id,
        });

        // Actualizar presupuesto: estado aceptado (ganado comercialmente) pero sin factura
        await db.update(quotes).set({
          status: "aceptado",
          updatedAt: now,
        }).where(eq(quotes.id, input.quoteId));

        // Actualizar lead: oportunidad ganada comercialmente
        await db.update(leads).set({
          opportunityStatus: "ganada",
          status: "convertido",
          updatedAt: now,
        }).where(eq(leads.id, quote.leadId));

        await logActivity("quote", quote.id, "converted_to_reservation_manual", ctx.user.id, ctx.user.name, { reservationId, status: "pending_payment" });
        await logActivity("lead", quote.leadId, "opportunity_won_manual", ctx.user.id, ctx.user.name, { quoteId: quote.id });

        // Email de confirmación al cliente (reserva confirmada, pago pendiente).
        confirmReservationAndNotify(reservationId).catch(e =>
          console.error("[crm.convertToReservation] Error enviando email de confirmación:", e)
        );

        return { success: true, reservationId, reservationRef, status: "pending_payment" };
      }),

    // --- ESCENARIO B: Confirmación manual por transferencia bancaria ----------
    // Paso 1: Subir el justificante (JPG/PNG/PDF) a S3
    uploadTransferProof: staff
      .input(
        z.object({
          quoteId: z.number(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
        })
      )
      .mutation(async ({ input }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType === "image/png" ? "png" : "jpg";
        const fileKey = `transfer-proofs/${input.quoteId}-${Date.now()}.${ext}`;
        const { url, key: storedKey } = await storagePut(fileKey, buffer, input.mimeType, { category: "transfer-proof", originalName: input.fileName, owner: { type: "quote", id: input.quoteId } });
        await db.update(quotes).set({
          transferProofUrl: url,
          transferProofKey: storedKey,
          updatedAt: new Date(),
        } as Record<string, unknown>).where(eq(quotes.id, input.quoteId));
        return { url, fileKey: storedKey };
      }),

    // Subir justificante de transferencia sin modificar el presupuesto (para el modal Confirmar Pago)
    uploadProofOnly: staff
      .input(
        z.object({
          quoteId: z.number(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType === "image/png" ? "png" : "jpg";
        const fileKey = `transfer-proofs/pay-${input.quoteId}-${Date.now()}.${ext}`;
        const { url, key: storedKey } = await storagePut(fileKey, buffer, input.mimeType, { category: "transfer-proof", originalName: input.fileName, owner: { type: "quote", id: input.quoteId } });
        return { url, fileKey: storedKey };
      }),

    // Paso 2: Confirmar el pago (exige justificante ya subido)
    confirmTransfer: staff
      .input(
        z.object({
          quoteId: z.number(),
          paidAmount: z.number().optional(),
          bankMovementId: z.number().optional(), // FASE 2A: vínculo bancario opcional
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const proofUrl = (quote as Record<string, unknown>).transferProofUrl as string | null;

        // Si se vincula movimiento bancario, el justificante no es obligatorio
        if (!proofUrl && !input.bankMovementId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Debes adjuntar el justificante de transferencia o vincular un movimiento bancario.",
          });
        }

        // Validar movimiento bancario si se proporciona
        if (input.bankMovementId) {
          const [movement] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
          if (!movement) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento bancario no encontrado." });
          if (movement.status === "ignorado") throw new TRPCError({ code: "BAD_REQUEST", message: "El movimiento bancario está marcado como ignorado." });
          if (movement.conciliationStatus === "conciliado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este movimiento bancario ya está conciliado con otro pago." });
          const existingConfirmed = await db.select({ id: bankMovementLinks.id }).from(bankMovementLinks)
            .where(and(eq(bankMovementLinks.bankMovementId, input.bankMovementId), eq(bankMovementLinks.status, "confirmed"))).limit(1);
          if (existingConfirmed.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Este movimiento bancario ya tiene una conciliación confirmada." });
        }
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Idempotencia: si ya hay factura para este presupuesto, devolver la existente
        if (quote.paidAt || quote.status === "aceptado") {
          const [existingInvT] = await db.select().from(invoices)
            .where(eq(invoices.quoteId, quote.id))
            .orderBy(invoices.id)
            .limit(1);
          if (existingInvT) {
            return { success: true, invoiceId: existingInvT.id, invoiceNumber: existingInvT.invoiceNumber };
          }
        }

        // La factura es por lo cobrado: un importe distinto del total del presupuesto no se factura aquí
        assertPaidAmountMatchesQuote(input.paidAmount, quote.total);
        const now = new Date();
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        // Datos fiscales del cliente vinculado al presupuesto (NIF, nombre fiscal y dirección)
        const billTo = await invoiceClientForQuote(db, quote, { name: lead.name, email: lead.email, phone: lead.phone });
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
        // Lo facturado es lo cobrado: el total del presupuesto. El descuento reduce base e IVA de cada tipo.
        const amountsT = chargedInvoiceAmounts(items, Number(quote.total));
        const { subtotal, taxAmount, total } = amountsT;
        const bdT = amountsT.taxBreakdown;
        const taxRate = amountsT.taxRate;
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            ...billTo,
            itemsJson: items,
            subtotal: String(subtotal),
            discount: amountsT.discount,
            discountReason: amountsT.discount > 0 ? QUOTE_DISCOUNT_REASON : null,
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total),
            taxBreakdown: bdT,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("PDF generation failed:", e);
        }
        // Determinar productId principal desde las líneas del presupuesto
        const mainProductIdT = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? lead.experienceId ?? 0;

        const [invResult] = await db.insert(invoices).values({
          issuerSnapshot: await issuerSnapshotForNewInvoice(),
          invoiceNumber,
          quoteId: quote.id,
          ...billTo,
          itemsJson: items,
          subtotal: String(subtotal),
          discount: String(amountsT.discount),
          discountReason: amountsT.discount > 0 ? QUOTE_DISCOUNT_REASON : null,
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdT.length > 0 ? bdT : undefined,
          total: String(total),
          pdfUrl,
          pdfKey,
          status: "cobrada",
          paymentMethod: "transferencia",
          transferProofUrl: proofUrl,
          isAutomatic: false,
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;
        // Fecha operativa: quote.activityDate (editable desde admin) ? lead.preferredDate ? hoy
        const serviceDateTransfer = quote.activityDate
          ? String(quote.activityDate).slice(0, 10)
          : lead.preferredDate
            ? new Date(lead.preferredDate).toISOString().split("T")[0]
            : now.toISOString().split("T")[0];
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const reservationNumberTransfer = await generateReservationNum("crm:confirmTransfer", String(ctx.user.id));
        const resProd = reservationProductFromQuoteItems(quote.items, mainProductIdT);
        const [resResult] = await db.insert(reservations).values({
          productId: resProd.productId,
          productName: quote.title,
          extrasJson: resProd.extrasJson,
          bookingDate: resProd.mainServiceDate ?? serviceDateTransfer,
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: Math.round((input.paidAmount ?? total) * 100),
          status: "paid",
          statusReservation: "CONFIRMADA",
          statusPayment: "PAGADO",
          // Canal: transferencia confirmada manualmente por el equipo ? ONLINE_ASISTIDO
          channel: "ONLINE_ASISTIDO",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          reservationNumber: reservationNumberTransfer,
          notes: `Pago por transferencia bancaria confirmado manualmente. Presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paidAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // FIX: Vincular factura ? reserva recién creadas
        await db.update(invoices).set({ reservationId, updatedAt: now }).where(eq(invoices.id, invoiceId));
        await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() } as any).where(eq(reservations.id, reservationId));

        // Crear/actualizar cliente en el CRM
        await upsertClientFromReservation({
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          source: "transferencia",
          leadId: lead.id,
        });

        await db.update(quotes).set({
          status: "aceptado",
          paidAt: now,
          invoiceNumber,
          invoicePdfUrl: pdfUrl,
          invoiceGeneratedAt: now,
          transferConfirmedAt: now,
          transferConfirmedBy: ctx.user.name,
          paymentMethod: "transferencia",
          updatedAt: now,
        } as Record<string, unknown>).where(eq(quotes.id, input.quoteId));
        await db.update(leads).set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now }).where(eq(leads.id, quote.leadId));
        await logActivity("quote", quote.id, "transfer_payment_confirmed", ctx.user.id, ctx.user.name, {
          invoiceId, reservationId, proofUrl, confirmedBy: ctx.user.name,
        });
        await logActivity("lead", quote.leadId, "opportunity_won", ctx.user.id, ctx.user.name, { quoteId: quote.id, method: "transferencia" });
        await logActivity("invoice", invoiceId, "invoice_generated", ctx.user.id, ctx.user.name, { pdfUrl });
        // -- BUG #2 + #3 FIX (confirmTransfer): Crear booking operativo + transacción contable ----
        try {
          const generalSubtotalT = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
          const reavSubtotalT = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
          const taxAmountT = totalTaxAmount(groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav")));
          const fiscalRegimeT = reavSubtotalT > 0 && generalSubtotalT > 0 ? "mixed"
            : reavSubtotalT > 0 ? "reav" : "general";
          await postConfirmOperation({
            reservationId,
            productId: mainProductIdT, // FIX: usar el productId principal del presupuesto
            productName: quote.title,
            serviceDate: serviceDateTransfer,
            people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
            amountCents: Math.round((input.paidAmount ?? total) * 100),
            customerName: lead.name,
            customerEmail: lead.email,
            customerPhone: lead.phone,
            totalAmount: total,
            paymentMethod: "transferencia",
            saleChannel: "crm",
            invoiceNumber,
            reservationRef,
            sellerUserId: ctx.user.id,
            sellerName: ctx.user.name ?? undefined,
            taxBase: generalSubtotalT,
            taxAmount: taxAmountT,
            reavMargin: reavSubtotalT,
            fiscalRegime: fiscalRegimeT,
            description: `Transferencia CRM — ${quote.quoteNumber} — ${lead.name}`,
            quoteId: quote.id,
            sourceChannel: "transferencia",
            ghlContactId: (lead as any).ghlContactId ?? null,
          });
        } catch (e) { console.error("[confirmTransfer] Error en postConfirmOperation:", e); }
        try {
          await sendTransferConfirmationEmail({
            clientName: lead.name,
            clientEmail: lead.email,
            invoiceNumber,
            reservationRef,
            quoteTitle: quote.title,
            quoteNumber: quote.quoteNumber ?? undefined,
            items,
            subtotal: String(subtotal),
            taxAmount: String(taxAmount),
            total: String(total),
            invoiceUrl: pdfUrl ?? undefined,
            confirmedBy: ctx.user.name ?? undefined,
            confirmedAt: now,
          });
        } catch (e) { console.error("Transfer confirmation email failed:", e); }
        try {
          await sendInternalNotification({
            clientName: lead.name,
            clientEmail: lead.email,
            clientPhone: lead.phone,
            reservationRef,
            quoteTitle: quote.title,
            total: String(total),
            paidAt: now,
            reservationId,
          });
        } catch (e) { console.error("Internal notification failed:", e); }

        // -- Crear expediente REAV automáticamente si hay líneas REAV -------------
        const reavLinesTransfer = items.filter(i => i.fiscalRegime === "reav");
        let reavExpedientIdT: number | undefined;
        let reavExpedientNumberT: string | undefined;
        if (reavLinesTransfer.length > 0) {
          try {
            const reavSaleAmountT = reavLinesTransfer.reduce((s, i) => s + i.total, 0);
            // -- Obtener porcentajes REAV desde el producto (origen único de verdad) --
            let reavCostePctT = 60; // fallback conservador
            let reavMargenPctT = 40;
            const firstReavLineT = reavLinesTransfer[0] as any;
            const reavProductIdT = firstReavLineT?.productId ?? (lead as any).experienceId;
            if (reavProductIdT) {
              const [reavProductT] = await db.select({
                providerPercent: experiences.providerPercent,
                agencyMarginPercent: experiences.agencyMarginPercent,
                fiscalRegime: experiences.fiscalRegime,
              }).from(experiences).where(eq(experiences.id, reavProductIdT)).limit(1);
              if (reavProductT && reavProductT.fiscalRegime === "reav") {
                const erroresT = validarConfiguracionREAV(reavProductT);
                if (erroresT.length === 0) {
                  reavCostePctT = parseFloat(String(reavProductT.providerPercent ?? 60));
                  reavMargenPctT = parseFloat(String(reavProductT.agencyMarginPercent ?? 40));
                } else {
                  console.warn("[confirmTransfer] Configuración REAV inválida, usando fallback 60/40:", erroresT);
                }
              }
            }
            const reavCalcT = calcularREAVSimple(reavSaleAmountT, reavCostePctT, reavMargenPctT);
            const clientNameT = lead.name ?? undefined;
            const clientEmailT = lead.email ?? undefined;
            const clientPhoneT = lead.phone ?? undefined;
            const clientDniT = (lead as any).dni ?? undefined;
            const clientAddressT = (lead as any).address ?? undefined;
            const reavResultT = await createReavExpedient({
              invoiceId,
              reservationId,
              quoteId: quote.id,
              serviceDescription: reavLinesTransfer.map(i => i.description).join(" | "),
              serviceDate: serviceDateTransfer,
              numberOfPax: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
              saleAmountTotal: String(reavSaleAmountT),
              providerCostEstimated: String(reavCalcT.costeProveedor),
              agencyMarginEstimated: String(reavCalcT.margenAgencia),
              clientName: clientNameT,
              clientEmail: clientEmailT,
              clientPhone: clientPhoneT,
              clientDni: clientDniT,
              clientAddress: clientAddressT,
              channel: "crm",
              sourceRef: invoiceNumber,
              internalNotes: [
                `Expediente creado automáticamente al confirmar transferencia del presupuesto ${quote.quoteNumber ?? quote.id}.`,
                clientNameT ? `Cliente: ${clientNameT}` : null,
                clientEmailT ? `Email: ${clientEmailT}` : null,
                clientPhoneT ? `Teléfono: ${clientPhoneT}` : null,
                clientDniT ? `DNI/NIF: ${clientDniT}` : null,
                `Factura: ${invoiceNumber}`,
                `Importe REAV: ${reavSaleAmountT.toFixed(2)}€`,
                `Agente: ${ctx.user.name ?? ctx.user.email}`,
              ].filter(Boolean).join(" — "),
            });
            reavExpedientIdT = reavResultT.id;
            reavExpedientNumberT = reavResultT.expedientNumber;
            // Adjuntar la factura PDF al expediente
            if (pdfUrl && reavExpedientIdT) {
              await attachReavDocument({
                expedientId: reavExpedientIdT,
                side: "client",
                docType: "factura_emitida",
                title: `Factura ${invoiceNumber}`,
                fileUrl: pdfUrl,
                mimeType: "application/pdf",
                notes: `Factura generada al confirmar transferencia. Presupuesto: ${quote.quoteNumber ?? quote.id}.`,
                uploadedBy: ctx.user.id,
              });
            }
            if ((quote as any).pdfUrl && reavExpedientIdT) {
              await attachReavDocument({
                expedientId: reavExpedientIdT,
                side: "client",
                docType: "otro",
                title: `Presupuesto ${quote.quoteNumber ?? quote.id}`,
                fileUrl: (quote as any).pdfUrl,
                mimeType: "application/pdf",
                notes: `Presupuesto original aceptado por el cliente (pago por transferencia).`,
                uploadedBy: ctx.user.id,
              });
            }
            await logActivity("invoice", invoiceId, "reav_expedient_created", ctx.user.id, ctx.user.name, { expedientId: reavExpedientIdT, expedientNumber: reavExpedientNumberT });
          } catch (e) {
            console.error("[confirmTransfer] Error al crear expediente REAV:", e);
          }
        }

        // FASE 2A: crear vínculo bancario y marcar movimiento como conciliado
        if (input.bankMovementId) {
          try {
            const now2 = new Date();
            await db.insert(bankMovementLinks).values({
              bankMovementId: input.bankMovementId,
              entityType: "quote",
              entityId: input.quoteId,
              linkType: "income_transfer",
              amountLinked: String(total),
              status: "confirmed",
              confidenceScore: 100,
              matchedBy: ctx.user.name ?? undefined,
              matchedAt: now2,
            });
            await db.update(bankMovements)
              .set({ conciliationStatus: "conciliado" })
              .where(eq(bankMovements.id, input.bankMovementId));
            await logActivity("quote", input.quoteId, "bank_movement_linked", ctx.user.id, ctx.user.name, {
              bankMovementId: input.bankMovementId, invoiceId, invoiceNumber,
            });
          } catch (e) {
            console.error("[confirmTransfer] Error al crear vínculo bancario:", e);
          }
        }

        return { success: true, invoiceId, invoiceNumber, reservationId, pdfUrl, reavExpedientId: reavExpedientIdT, reavExpedientNumber: reavExpedientNumberT };
      }),


    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        // Borrar actividad e invoices relacionadas
        await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, input.id)));
        await db.delete(invoices).where(eq(invoices.quoteId, input.id));
        await db.delete(quotes).where(eq(quotes.id, input.id));
        // Si el lead asociado no tiene más presupuestos, volver a estado "nueva"
        if (quote.leadId) {
          const remaining = await db.select({ cnt: count() }).from(quotes).where(eq(quotes.leadId, quote.leadId));
          if ((remaining[0]?.cnt ?? 0) === 0) {
            await db.update(leads).set({ opportunityStatus: "nueva", status: "nuevo", updatedAt: new Date() }).where(eq(leads.id, quote.leadId));
          }
        }
        return { success: true };
      }),

    bulkDelete: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        for (const id of input.ids) {
          await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, id)));
          await db.delete(invoices).where(eq(invoices.quoteId, id));
        }
        await db.delete(quotes).where(inArray(quotes.id, input.ids));
        return { deleted: input.ids.length };
      }),

    bulkUpdateStatus: staff
      .input(z.object({
        ids: z.array(z.number()).min(1),
        status: z.enum(["borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado", "perdido"]),
      }))
      .mutation(async ({ input }) => {
        await db.update(quotes).set({ status: input.status, updatedAt: new Date() }).where(inArray(quotes.id, input.ids));
        return { updated: input.ids.length };
      }),

    generatePdf: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        // Fetch quote + lead data
        const rows = await db
          .select({
            id: quotes.id,
            quoteNumber: quotes.quoteNumber,
            title: quotes.title,
            status: quotes.status,
            total: quotes.total,
            subtotal: quotes.subtotal,
            discount: quotes.discount,
            tax: quotes.tax,
            items: quotes.items,
            validUntil: quotes.validUntil,
            notes: quotes.notes,
            conditions: quotes.conditions,
            paymentLinkUrl: quotes.paymentLinkUrl,
            createdAt: quotes.createdAt,
            clientName: leads.name,
            clientEmail: leads.email,
            clientPhone: leads.phone,
            clientCompany: leads.company,
          })
          .from(quotes)
          .leftJoin(leads, eq(quotes.leadId, leads.id))
          .where(eq(quotes.id, input.id));

        const quote = rows[0];
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });

        const items: { description: string; quantity: number; unitPrice: number; total: number }[] =
          Array.isArray(quote.items) ? quote.items as { description: string; quantity: number; unitPrice: number; total: number }[] : JSON.parse((quote.items as unknown as string) ?? "[]");

        // Obtener datos de empresa facturadora
        const legalQ = await getLegalCompanySettings();

        const html = buildQuotePdfHtml({
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          clientName: quote.clientName ?? "",
          clientEmail: quote.clientEmail ?? "",
          clientPhone: quote.clientPhone,
          clientCompany: quote.clientCompany,
          items,
          subtotal: quote.subtotal,
          discount: quote.discount,
          tax: quote.tax,
          total: quote.total,
          validUntil: quote.validUntil,
          notes: quote.notes,
          conditions: quote.conditions,
          paymentLinkUrl: quote.paymentLinkUrl,
          createdAt: quote.createdAt,
          issuerName: legalQ.name,
          issuerCif: legalQ.cif,
          // Sin datos vacíos sueltos («, ()»): igual que en la factura
          issuerAddress: formatLegalAddress(legalQ),
        });

        // Generar PDF con puppeteer-core (funciona en producción desplegada)
        const ts = Date.now();
        try {
          const pdfBuffer = await htmlToPdf(html);
          const key = `quotes/${quote.quoteNumber}-${ts}.pdf`;
          const { url } = await storagePut(key, pdfBuffer, "application/pdf", { category: "quote", originalName: `Presupuesto-${quote.quoteNumber}.pdf`, owner: { type: "quote", id: quote.id } });
          return {
            success: true,
            pdfUrl: url,
            filename: `Presupuesto-${quote.quoteNumber}.pdf`,
          };
        } catch (pdfErr) {
          console.error("[PDF] Error generando presupuesto PDF, guardando HTML como fallback:", pdfErr);
          // Fallback: guardar HTML
          const key = `quotes/${quote.quoteNumber}-${ts}.html`;
          const { url } = await storagePut(key, Buffer.from(html), "text/html", { category: "quote", originalName: `Presupuesto-${quote.quoteNumber}.html`, owner: { type: "quote", id: quote.id } });
          return {
            success: true,
            pdfUrl: url,
            filename: `Presupuesto-${quote.quoteNumber}.html`,
          };
        }
      }),

    // --- CREAR PRESUPUESTO DIRECTO (sin lead previo) -------------------------
    createDirect: staff
      .input(
        z.object({
          // Datos del cliente
          clientName: z.string().min(1),
          clientEmail: z.string().email(),
          clientPhone: z.string().optional(),
          clientCompany: z.string().optional(),
          // Datos del presupuesto
          title: z.string().min(1),
          description: z.string().optional(),
          items: z.array(
            z.object({
              description: z.string(),
              quantity: z.number(),
              unitPrice: z.number().describe(QUOTE_UNIT_PRICE_DESCRIPTION),
              total: z.number().describe(QUOTE_LINE_TOTAL_DESCRIPTION),
              fiscalRegime: z.enum(["reav", "general"]).optional(),
              taxRate: z.number().optional(),
              productId: z.number().optional(),
              serviceDate: z.string().optional(), // YYYY-MM-DD: fecha de servicio propia de la línea
            })
          ),
          subtotal: z.number().describe("Base imponible (se recalcula en el servidor a partir de las líneas y el total)"),
          discount: z.number().default(0).describe(QUOTE_DISCOUNT_DESCRIPTION),
          taxRate: z.number().default(21),
          total: z.number().describe(QUOTE_TOTAL_DESCRIPTION),
          pricesIncludeTax: pricesIncludeTaxSchema,
          validUntil: z.string().optional(),
          activityDate: z.string().nullable().optional(),
          notes: z.string().optional(),
          conditions: z.string().optional(),
          sendNow: z.boolean().default(false),
          origin: z.string().url().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (input.sendNow) assertQuotePricedForSend(input.items);
        // Producto = fuente de verdad fiscal; líneas con IVA incluido y total coherente (antes de crear nada).
        const items = await quoteItemsTaxIncluded(input.items, input.pricesIncludeTax, input.discount, input.total);
        // 1. Resolver leadId: lead existente ? cliente existente con lead ? crear lead nuevo
        let leadId: number;
        const [existingLead] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(eq(leads.email, input.clientEmail))
          .orderBy(desc(leads.createdAt))
          .limit(1);

        if (existingLead) {
          leadId = existingLead.id;
        } else {
          // Sin lead — buscar cliente existente que ya tenga leadId (p.ej. vino por reserva)
          const [existingClient] = await db
            .select({ leadId: clients.leadId })
            .from(clients)
            .where(eq(clients.email, input.clientEmail))
            .limit(1);

          if (existingClient?.leadId) {
            leadId = existingClient.leadId;
          } else {
            // Cliente nuevo sin historial — crear lead silencioso
            const [leadResult] = await db.insert(leads).values({
              name: input.clientName,
              email: input.clientEmail,
              phone: input.clientPhone ?? "",
              company: input.clientCompany ?? "",
              source: "presupuesto_directo",
              status: "en_proceso",
              opportunityStatus: "nueva",
              priority: "media",
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            leadId = (leadResult as { insertId: number }).insertId;
            await logActivity("lead", leadId, "lead_created_from_quote", ctx.user.id, ctx.user.name, { name: input.clientName });
          }
        }

        // 2. Upsert de cliente — nunca sobreescribe leadId si ya tiene uno válido
        try {
          await db.insert(clients).values({
            leadId,
            source: "presupuesto_directo",
            name: input.clientName,
            email: input.clientEmail,
            phone: input.clientPhone ?? "",
            company: input.clientCompany ?? "",
            tags: [],
            isConverted: false,
            totalBookings: 0,
          }).onDuplicateKeyUpdate({
            set: {
              leadId: sql`IF(${clients.leadId} IS NULL, ${leadId}, ${clients.leadId})`,
              name: sql`IF(TRIM(${clients.name}) = '' OR ${clients.name} IS NULL, ${input.clientName}, ${clients.name})`,
              phone: sql`IF(TRIM(${clients.phone}) = '' OR ${clients.phone} IS NULL, ${input.clientPhone ?? ''}, ${clients.phone})`,
              company: sql`IF(TRIM(${clients.company}) = '' OR ${clients.company} IS NULL, ${input.clientCompany ?? ''}, ${clients.company})`,
              updatedAt: new Date(),
            },
          });
        } catch (e) {
          console.warn("[createDirect] No se pudo crear/vincular cliente:", e);
        }

        // 3. Crear el presupuesto
        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        // IVA por línea (PVP con IVA incluido) sobre el total ya descontado; nunca un IVA global.
        const amounts = chargedInvoiceAmounts(items, input.total);
        const taxAmount = amounts.taxAmount;

        const [quoteResult] = await db.insert(quotes).values({
          quoteNumber,
          leadId,
          agentId: ctx.user.id,
          title: input.title,
          description: input.description,
          items,
          subtotal: String(amounts.subtotal),
          discount: String(input.discount),
          tax: String(taxAmount),
          total: String(input.total),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          activityDate: input.activityDate || null,
          notes: input.notes,
          conditions: input.conditions,
          status: "borrador",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const quoteId = (quoteResult as { insertId: number }).insertId;

        await logActivity("quote", quoteId, "quote_created_direct", ctx.user.id, ctx.user.name, { leadId, quoteNumber });

        // 4. Enviar inmediatamente si se solicita
        let directMail: { emailSent: boolean; trialMailBlocked: boolean; acceptUrl?: string } | null = null;
        if (input.sendNow) {
          // Generar token de aceptación SIEMPRE antes de enviar el email
          const { randomBytes } = await import("crypto");
          const token = randomBytes(32).toString("hex");
          const origin = input.origin ?? publicBaseUrl();
          const acceptUrl = `${origin}/presupuesto/${token}`;

          await db.update(quotes).set({
            status: "enviado",
            sentAt: new Date(),
            paymentLinkToken: token,
            paymentLinkUrl: acceptUrl,
            updatedAt: new Date(),
          }).where(eq(quotes.id, quoteId));
          await db.update(leads).set({ opportunityStatus: "enviada", status: "contactado", lastContactAt: new Date(), seenAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, leadId));
          directMail = await sendQuoteEmail({
            quoteNumber,
            title: input.title,
            clientName: input.clientName,
            clientEmail: input.clientEmail,
            items,
            subtotal: String(amounts.subtotal),
            discount: String(input.discount),
            tax: String(taxAmount),
            total: String(input.total),
            validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
            notes: input.notes,
            conditions: input.conditions,
            paymentLinkUrl: acceptUrl,
          });
          directMail = { ...directMail!, acceptUrl };
          await logActivity("quote", quoteId, "quote_sent", ctx.user.id, ctx.user.name, { email: input.clientEmail, acceptUrl });

          // Sync GHL: crear contacto si no existe, luego sincronizar URL del presupuesto
          getGHLCredentials().then(async (ghlCreds) => {
            if (!ghlCreds) return;
            try {
              // Leer el lead para saber si ya tiene ghlContactId
              const [lead] = await db.select({ ghlContactId: (leads as any).ghlContactId })
                .from(leads).where(eq(leads.id, leadId)).limit(1);
              let ghlContactId: string | null = (lead as any)?.ghlContactId ?? null;

              // Si no tiene contacto en GHL, crearlo ahora
              if (!ghlContactId) {
                ghlContactId = await createGHLContact(
                  {
                    name: input.clientName,
                    email: input.clientEmail,
                    phone: input.clientPhone,
                    companyName: input.clientCompany,
                    tags: getGHLTagsFromSource("presupuesto_directo"),
                    notes: `[Lead #${leadId}] Presupuesto directo ${quoteNumber}`,
                  },
                  ghlCreds,
                );
                if (ghlContactId) {
                  await db.update(leads)
                    .set({ ghlContactId, updatedAt: new Date() } as any)
                    .where(eq(leads.id, leadId));
                }
              }

              // Sincronizar URL del presupuesto al contacto GHL
              syncLeadUrlsToGHL({
                ghlContactId,
                quoteUrl: acceptUrl,
                quoteNumber,
                email: input.clientEmail,
                phone: input.clientPhone,
                credentials: ghlCreds,
              });
            } catch (err: any) {
              console.error("[createDirect] Error sync GHL:", err?.message);
            }
          });
        }

        return { success: true, quoteId, quoteNumber, leadId, sent: input.sendNow, emailSent: directMail?.emailSent ?? false, trialMailBlocked: directMail?.trialMailBlocked ?? false, acceptUrl: directMail?.acceptUrl ?? null };
      }),

    // --- FLUJO PÚBLICO: Aceptación de presupuesto por token ---------------------

    /**
     * Carga un presupuesto por su paymentLinkToken.
     * Endpoint público — no requiere autenticación.
     * Registra viewedAt y actualiza status a 'visualizado' si era 'enviado'.
     */
    getByToken: publicProcedure
      .input(z.object({ token: z.string().min(10) }))
      .query(async ({ input }) => {
        const [quote] = await db
          .select()
          .from(quotes)
          .where(eq(quotes.paymentLinkToken, input.token))
          .limit(1);

        // Si no es un token de quote, probar tabla reservations (Fase 2 del
        // plan "Ver tu reserva" — los emails de confirmación de cualquier
        // canal apuntan a esta URL, incluyendo reservas sin presupuesto).
        if (!quote) {
          const [reservation] = await db
            .select()
            .from(reservations)
            .where(eq(reservations.publicToken, input.token))
            .limit(1);
          if (!reservation) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado o enlace inválido" });

          // Buscar factura asociada (por reservationId o por invoiceId guardado en la reserva)
          let invoicePdfUrl: string | null = null;
          let invoiceNumber: string | null = reservation.invoiceNumber ?? null;
          if (reservation.invoiceId) {
            const [inv] = await db.select({ pdfUrl: invoices.pdfUrl, invoiceNumber: invoices.invoiceNumber })
              .from(invoices).where(eq(invoices.id, reservation.invoiceId)).limit(1);
            if (inv) {
              invoicePdfUrl = inv.pdfUrl ?? null;
              invoiceNumber = inv.invoiceNumber ?? invoiceNumber;
            }
          }

          // Construir items desde extrasJson si existe, o un único item con el productName
          let items: { description: string; quantity: number; unitPrice: number; total: number }[] = [];
          try {
            const extras = reservation.extrasJson ? JSON.parse(String(reservation.extrasJson)) : null;
            if (Array.isArray(extras) && extras.length > 0) {
              items = extras.map((e: any) => ({
                description: e.productName ?? e.name ?? reservation.productName,
                quantity: e.quantity ?? 1,
                unitPrice: parseFloat(String(e.unitPrice ?? 0)),
                total: parseFloat(String(e.unitPrice ?? 0)) * (e.quantity ?? 1),
              }));
            }
          } catch { /* extrasJson inválido — usar fallback */ }
          if (items.length === 0) {
            const amountEur = (reservation.amountTotal ?? 0) / 100;
            items = [{
              description: reservation.productName,
              quantity: reservation.people ?? 1,
              unitPrice: amountEur / (reservation.people || 1),
              total: amountEur,
            }];
          }

          const totalEur = ((reservation.amountTotal ?? 0) / 100).toFixed(2);
          const isPaid = reservation.status === "paid";
          const isCancelled = reservation.status === "cancelled";

          return {
            id: -reservation.id, // negativo para indicar que es reserva, no quote
            quoteNumber: reservation.reservationNumber ?? `RES-${reservation.id}`,
            title: `Reserva ${reservation.productName}`,
            items,
            subtotal: totalEur,
            discount: "0",
            tax: "0",
            total: totalEur,
            currency: "EUR",
            validUntil: null,
            status: isCancelled ? "rechazado" : (isPaid ? "pago_completado" : "enviado"),
            notes: reservation.notes ?? null,
            conditions: null,
            isExpired: false,
            isPaid,
            isRejected: isCancelled,
            clientName: reservation.customerName ?? "",
            clientEmail: reservation.customerEmail ?? "",
            clientPhone: reservation.customerPhone ?? "",
            invoicePdfUrl,
            invoiceNumber,
            installmentPlan: null,
            // Marcador para que el frontend sepa que NO es un quote
            sourceType: "reservation" as const,
            bookingDate: reservation.bookingDate ?? null,
            selectedTime: reservation.selectedTime ?? null,
            people: reservation.people ?? null,
          };
        }

        // Marcar como visualizado si llega por primera vez (solo desde "enviado")
        // Si ya está en pago_fallido o estados posteriores, no se degrada el estado
        if (quote.status === "enviado") {
          await db
            .update(quotes)
            .set({ status: "visualizado", viewedAt: new Date(), updatedAt: new Date() })
            .where(eq(quotes.id, quote.id));
          await logActivity("quote", quote.id, "quote_viewed_by_client", null, null, { token: input.token });
        } else if (!quote.viewedAt) {
          // Garantizar viewedAt aunque el estado ya haya avanzado
          await db.update(quotes).set({ viewedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));
        }

        // Obtener datos del lead/cliente
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);

        // Verificar si ha expirado (un presupuesto ya aceptado no caduca: quedan sus cuotas por pagar)
        const isExpired = quote.status !== "aceptado" && quote.validUntil && new Date(quote.validUntil) < new Date();
        const isPaid = !!quote.paidAt;
        const isRejected = quote.status === "rechazado";

        // Cargar plan de pagos si existe
        let installmentPlan: {
          planId: number;
          firstRequiredAmountCents: number | null;
          nextInstallment: { installmentNumber: number; amountCents: number } | null;
          installments: {
            id: number;
            installmentNumber: number;
            amountCents: number;
            dueDate: string;
            status: string;
            isRequiredForConfirmation: boolean;
          }[];
        } | null = null;

        if (quote.paymentPlanId) {
          const planInstallments = await db
            .select({
              id: paymentInstallments.id,
              installmentNumber: paymentInstallments.installmentNumber,
              amountCents: paymentInstallments.amountCents,
              dueDate: paymentInstallments.dueDate,
              status: paymentInstallments.status,
              isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
            })
            .from(paymentInstallments)
            .where(eq(paymentInstallments.quoteId, quote.id))
            .orderBy(paymentInstallments.installmentNumber);

          // La cuota que cobraría el enlace ahora (mismo orden que payWithToken): primero las obligatorias
          // pendientes y después cualquier pendiente
          const next = planInstallments.find((i) => i.isRequiredForConfirmation && i.status === "pending")
            ?? planInstallments.find((i) => i.status === "pending")
            ?? null;

          installmentPlan = {
            planId: quote.paymentPlanId,
            firstRequiredAmountCents: next?.amountCents ?? null,
            nextInstallment: next ? { installmentNumber: next.installmentNumber, amountCents: next.amountCents } : null,
            installments: planInstallments,
          };
        }

        return {
          id: quote.id,
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          items: (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: quote.subtotal,
          discount: quote.discount ?? "0",
          tax: quote.tax ?? "0",
          total: quote.total,
          currency: quote.currency,
          validUntil: quote.validUntil,
          status: quote.status,
          notes: quote.notes,
          conditions: quote.conditions,
          isExpired: !!isExpired,
          isPaid,
          isRejected,
          clientName: lead?.name ?? "",
          clientEmail: lead?.email ?? "",
          clientPhone: lead?.phone ?? "",
          invoicePdfUrl: quote.invoicePdfUrl,
          invoiceNumber: quote.invoiceNumber,
          installmentPlan,
        };
      }),

    /**
     * El cliente rechaza el presupuesto desde el enlace.
     */
    rejectByToken: publicProcedure
      .input(z.object({ token: z.string().min(10), reason: z.string().max(500).optional() }))
      .mutation(async ({ input }) => {
        const [quote] = await db
          .select()
          .from(quotes)
          .where(eq(quotes.paymentLinkToken, input.token))
          .limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya ha sido pagado" });
        if (quote.status === "rechazado") return { success: true };
        // Aceptado (con cuotas ya pagadas): el enlace sigue vivo para pagar el resto, pero ya no se rechaza
        if (quote.status === "aceptado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya está confirmado. Si necesitas cambiarlo, ponte en contacto con nosotros." });

        await db
          .update(quotes)
          .set({ status: "rechazado", updatedAt: new Date() })
          .where(eq(quotes.id, quote.id));
        await db
          .update(leads)
          .set({ opportunityStatus: "perdida", updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));
        await logActivity("quote", quote.id, "quote_rejected_by_client", null, null, { reason: input.reason });
        return { success: true };
      }),

    /**
     * Inicia el pago Redsys para un presupuesto por token.
     * Los precios están CONGELADOS — se usan los del presupuesto, nunca los del catálogo.
     * Devuelve el formulario Redsys para que el frontend lo envíe.
     */
    payWithToken: publicProcedure
      .input(z.object({
        token: z.string().min(10),
        origin: z.string().url(),
        // El cliente puede ajustar datos de contacto antes de pagar
        customerName: z.string().min(2).optional(),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const [quote] = await db
          .select()
          .from(quotes)
          .where(eq(quotes.paymentLinkToken, input.token))
          .limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya ha sido pagado" });
        if (quote.status === "rechazado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto fue rechazado" });
        // La validez limita la aceptación; las cuotas de un presupuesto ya aceptado se pagan aunque haya pasado
        if (quote.status !== "aceptado" && quote.validUntil && new Date(quote.validUntil) < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ha expirado" });
        }

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente no encontrado" });

        // Garantizar viewedAt: si el cliente llega a iniciar el pago, definitivamente vio el presupuesto
        if (!quote.viewedAt) {
          await db.update(quotes).set({ viewedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));
        }

        // Precios CONGELADOS del presupuesto — nunca recalculados
        const totalEuros = Number(quote.total);
        if (!(totalEuros > 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `El presupuesto tiene un importe inválido (${quote.total}). Contacta con el equipo.` });
        }

        // Si hay plan de pagos, cobrar la siguiente cuota pendiente:
        // 1ª prioridad: cuotas requeridas para confirmar reserva
        // 2ª prioridad: cualquier cuota pendiente (cuotas posteriores a la confirmación)
        let amountCents = Math.round(totalEuros * 100);
        let firstRequiredInstallment: { id: number; amountCents: number; installmentNumber: number; reservationId: number | null } | null = null;

        if (quote.paymentPlanId) {
          // Buscar primera cuota requerida pendiente
          const [requiredInst] = await db
            .select({ id: paymentInstallments.id, amountCents: paymentInstallments.amountCents, installmentNumber: paymentInstallments.installmentNumber, reservationId: paymentInstallments.reservationId })
            .from(paymentInstallments)
            .where(and(
              eq(paymentInstallments.quoteId, quote.id),
              eq(paymentInstallments.isRequiredForConfirmation, true),
              eq(paymentInstallments.status, "pending"),
            ))
            .orderBy(paymentInstallments.installmentNumber)
            .limit(1);

          if (requiredInst) {
            firstRequiredInstallment = requiredInst;
            amountCents = requiredInst.amountCents;
          } else {
            // No quedan requeridas — buscar la próxima cuota pendiente (plan en curso)
            const [nextInst] = await db
              .select({ id: paymentInstallments.id, amountCents: paymentInstallments.amountCents, installmentNumber: paymentInstallments.installmentNumber, reservationId: paymentInstallments.reservationId })
              .from(paymentInstallments)
              .where(and(
                eq(paymentInstallments.quoteId, quote.id),
                eq(paymentInstallments.status, "pending"),
              ))
              .orderBy(paymentInstallments.installmentNumber)
              .limit(1);
            if (!nextInst) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "No hay cuotas pendientes de pago. El plan está completamente cobrado." });
            }
            firstRequiredInstallment = nextInst;
            amountCents = nextInst.amountCents;
          }
        }

        const customerName = input.customerName ?? lead.name;
        const customerEmail = input.customerEmail ?? lead.email ?? "";
        const customerPhone = input.customerPhone ?? lead.phone ?? "";

        // Cuota con un pago ya iniciado y sin completar: se reutiliza su mismo pedido de la pasarela. Así
        // abrir el pago dos veces no crea dos cobros de la misma cuota (la pasarela no autoriza dos veces el
        // mismo pedido) y la notificación siempre encuentra la cuota.
        if (firstRequiredInstallment?.reservationId) {
          const [pendingRes] = await db
            .select()
            .from(reservations)
            .where(and(
              eq(reservations.id, firstRequiredInstallment.reservationId),
              eq(reservations.quoteId, quote.id),
              eq(reservations.status, "pending_payment"),
            ))
            .limit(1);
          if (pendingRes && pendingRes.amountTotal === amountCents) {
            const redsysForm = await buildRedsysForm({
              amount: amountCents,
              merchantOrder: pendingRes.merchantOrder,
              productDescription: `Presupuesto ${quote.quoteNumber} — ${quote.title}`,
              notifyUrl: `${publicBaseUrl()}/api/redsys/notification`,
              okUrl: `${publicBaseUrl()}/reserva/ok?order=${pendingRes.merchantOrder}`,
              koUrl: `${publicBaseUrl()}/reserva/error?order=${pendingRes.merchantOrder}`,
              holderName: customerName,
            });
            return {
              merchantOrder: pendingRes.merchantOrder,
              amountCents,
              amountEuros: totalEuros,
              quoteTitle: quote.title,
              redsysForm,
            };
          }
        }

        // Reutilizar reserva pending_payment existente si el presupuesto ya fue convertido
        // o si el pago anterior falló y el cliente reintenta con una nueva tarjeta.
        // (Con plan de pagos solo se reutiliza la reserva de la propia cuota, tratada arriba: la de otra
        // cuota llevaría su pedido y la notificación marcaría la cuota equivocada.)
        if (!firstRequiredInstallment && (quote.status === "convertido_carrito" || quote.status === "pago_fallido") && quote.redsysOrderId) {
          const [existingReservation] = await db
            .select()
            .from(reservations)
            .where(and(eq(reservations.quoteId, quote.id), eq(reservations.status, "pending_payment")))
            .limit(1);

          if (existingReservation) {
            const redsysForm = await buildRedsysForm({
              amount: amountCents,
              merchantOrder: existingReservation.merchantOrder,
              productDescription: `Presupuesto ${quote.quoteNumber} — ${quote.title}`,
              notifyUrl: `${publicBaseUrl()}/api/redsys/notification`,
              okUrl: `${publicBaseUrl()}/reserva/ok?order=${existingReservation.merchantOrder}`,
              koUrl: `${publicBaseUrl()}/reserva/error?order=${existingReservation.merchantOrder}`,
              holderName: customerName,
            });
            return {
              merchantOrder: existingReservation.merchantOrder,
              amountCents,
              amountEuros: totalEuros,
              quoteTitle: quote.title,
              redsysForm,
            };
          }
        }

        // Generar merchantOrder único para Redsys (máx 12 chars)
        const merchantOrder = generateMerchantOrder();

        // Guardar pre-reserva con estado pending_payment
        const reservationNumberLink = await generateReservationNum("crm:paymentLink", "system");

        const resProd = reservationProductFromQuoteItems(quote.items);
        const [resResult] = await db.insert(reservations).values({
          productId: resProd.productId,
          productName: quote.title,
          extrasJson: resProd.extrasJson,
          bookingDate: resProd.mainServiceDate
            ?? (quote.activityDate
              ? String(quote.activityDate).slice(0, 10)
              : lead.preferredDate
                ? new Date(lead.preferredDate).toISOString().split("T")[0]
                : new Date().toISOString().split("T")[0]),
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: amountCents,
          amountPaid: 0,
          status: "pending_payment",
          customerName,
          customerEmail,
          customerPhone,
          merchantOrder,
          reservationNumber: reservationNumberLink,
          notes: `Pago desde enlace de presupuesto ${quote.quoteNumber}`,
          quoteId: quote.id,
          quoteSource: "presupuesto",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // Actualizar quote: solo cambiar a convertido_carrito si aún no está confirmado (aceptado)
        // Un quote "aceptado" ya pasó la Fase 1 — no debe degradarse de estado
        await db
          .update(quotes)
          .set({
            ...(quote.status !== "aceptado" ? { status: "convertido_carrito" as const, acceptedAt: new Date() } : {}),
            redsysOrderId: merchantOrder,
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, quote.id));

        // Vincular la reserva a la cuota del plan de pagos
        if (firstRequiredInstallment) {
          await db
            .update(paymentInstallments)
            .set({ reservationId, merchantOrder, updatedAt: new Date() })
            .where(eq(paymentInstallments.id, firstRequiredInstallment.id));
        }

        await logActivity("quote", quote.id, "payment_initiated", null, null, {
          merchantOrder,
          reservationId,
          installmentId: firstRequiredInstallment?.id ?? null,
          installmentNumber: firstRequiredInstallment?.installmentNumber ?? null,
        });

        // Construir formulario Redsys
        const redsysForm = await buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: `Presupuesto ${quote.quoteNumber} — ${quote.title}`,
          notifyUrl: `${publicBaseUrl()}/api/redsys/notification`,
          okUrl: `${publicBaseUrl()}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${publicBaseUrl()}/reserva/error?order=${merchantOrder}`,
          holderName: customerName,
        });

        return {
          merchantOrder,
          amountCents,
          amountEuros: totalEuros,
          quoteTitle: quote.title,
          redsysForm,
        };
      }),
  }),

  // --- PLANES DE PAGO FRACCIONADO ----------------------------------------------
  // Estos procedimientos son NUEVOS y no tocan ningún flujo existente de pago.
  // El flujo de pago completo clásico sigue intacto si paymentPlanId === null.

  paymentPlans: router({

    // Crear o reemplazar el plan de pagos de un presupuesto
    // Solo permitido si el presupuesto NO tiene cuotas ya pagadas
    upsert: staff
      .input(z.object({
        quoteId: z.number(),
        installments: z.array(z.object({
          installmentNumber: z.number().int().min(1),
          amountCents: z.number().int().min(1),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
          isRequiredForConfirmation: z.boolean(),
          notes: z.string().optional(),
        })).min(1).max(24),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });

        // No permitir si el presupuesto ya está completamente pagado (plan finalizado)
        if (quote.paidAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede modificar el plan de un presupuesto ya cerrado (todas las cuotas cobradas)" });
        }

        // Si ya existe plan, verificar que no haya cuotas pagadas
        if (quote.paymentPlanId) {
          const paidInstallments = await db
            .select({ id: paymentInstallments.id })
            .from(paymentInstallments)
            .where(and(
              eq(paymentInstallments.planId, quote.paymentPlanId),
              eq(paymentInstallments.status, "paid")
            ))
            .limit(1);
          if (paidInstallments.length > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede modificar el plan porque ya hay cuotas pagadas. Crea un nuevo presupuesto si necesitas reestructurar." });
          }
          // Borrar cuotas pendientes del plan anterior
          await db.delete(paymentInstallments).where(eq(paymentInstallments.planId, quote.paymentPlanId));
          await db.delete(paymentPlans).where(eq(paymentPlans.id, quote.paymentPlanId));
        }

        // Validar que la suma de cuotas == total del presupuesto (tolerancia ±1 céntimo por redondeo)
        const totalQuoteCents = Math.round(Number(quote.total) * 100);
        const sumInstallments = input.installments.reduce((s, i) => s + i.amountCents, 0);
        if (Math.abs(sumInstallments - totalQuoteCents) > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La suma de las cuotas (${(sumInstallments / 100).toFixed(2)}€) no coincide con el total del presupuesto (${(totalQuoteCents / 100).toFixed(2)}€)`,
          });
        }

        // Validar que al menos una cuota está marcada como obligatoria para confirmar
        const hasRequired = input.installments.some(i => i.isRequiredForConfirmation);
        if (!hasRequired) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Al menos una cuota debe ser obligatoria para confirmar la reserva" });
        }

        // Crear plan
        const [planResult] = await db.insert(paymentPlans).values({
          quoteId: input.quoteId,
          planType: "installment",
          totalAmountCents: totalQuoteCents,
          createdBy: ctx.user.id,
        });
        const planId = (planResult as { insertId: number }).insertId;

        // Crear cuotas
        for (const inst of input.installments) {
          await db.insert(paymentInstallments).values({
            planId,
            quoteId: input.quoteId,
            installmentNumber: inst.installmentNumber,
            amountCents: inst.amountCents,
            dueDate: inst.dueDate,
            isRequiredForConfirmation: inst.isRequiredForConfirmation,
            notes: inst.notes ?? null,
            status: "pending",
          });
        }

        // Vincular plan al presupuesto
        await db.update(quotes).set({ paymentPlanId: planId, updatedAt: new Date() }).where(eq(quotes.id, input.quoteId));

        await logActivity("quote", input.quoteId, "payment_plan_created", ctx.user.id, ctx.user.name, {
          planId,
          installmentsCount: input.installments.length,
          totalCents: totalQuoteCents,
        });

        return { success: true, planId, installmentsCount: input.installments.length };
      }),

    // Obtener el plan de pagos de un presupuesto
    get: staff
      .input(z.object({ quoteId: z.number() }))
      .query(async ({ input }) => {
        const [quote] = await db.select({ paymentPlanId: quotes.paymentPlanId, total: quotes.total })
          .from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote || !quote.paymentPlanId) return null;

        const [plan] = await db.select().from(paymentPlans)
          .where(eq(paymentPlans.id, quote.paymentPlanId)).limit(1);
        if (!plan) return null;

        const installments = await db.select().from(paymentInstallments)
          .where(eq(paymentInstallments.planId, plan.id))
          .orderBy(paymentInstallments.installmentNumber);

        return { plan, installments };
      }),

    // Eliminar plan (solo si no hay cuotas pagadas)
    delete: staff
      .input(z.object({ quoteId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote || !quote.paymentPlanId) throw new TRPCError({ code: "NOT_FOUND", message: "No hay plan de pagos para este presupuesto" });

        const paidInstallments = await db
          .select({ id: paymentInstallments.id })
          .from(paymentInstallments)
          .where(and(eq(paymentInstallments.planId, quote.paymentPlanId), eq(paymentInstallments.status, "paid")))
          .limit(1);
        if (paidInstallments.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede eliminar el plan porque hay cuotas ya pagadas" });
        }

        await db.delete(paymentInstallments).where(eq(paymentInstallments.planId, quote.paymentPlanId));
        await db.delete(paymentPlans).where(eq(paymentPlans.id, quote.paymentPlanId));
        await db.update(quotes).set({ paymentPlanId: null, updatedAt: new Date() }).where(eq(quotes.id, input.quoteId));

        await logActivity("quote", input.quoteId, "payment_plan_deleted", ctx.user.id, ctx.user.name, {});
        return { success: true };
      }),

    // Confirmar pago de una cuota manualmente (efectivo / transferencia / tarjeta presencial)
    confirmInstallment: staff
      .input(z.object({
        installmentId: z.number(),
        paymentMethod: z.enum(["efectivo", "transferencia", "tarjeta_fisica"]),
        paymentNote: z.string().optional(),
        tpvOperationNumber: z.string().optional(),
        transferProofUrl: z.string().optional(),
        transferProofKey: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [inst] = await db.select().from(paymentInstallments)
          .where(eq(paymentInstallments.id, input.installmentId)).limit(1);
        if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "Cuota no encontrada" });
        if (inst.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta cuota ya está pagada" });
        if (inst.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta cuota está cancelada" });

        const now = new Date();
        await db.update(paymentInstallments).set({
          status: "paid",
          paymentMethod: input.paymentMethod,
          paidAt: now,
          paidBy: `admin:${ctx.user.id}`,
          notes: [
            input.paymentNote,
            input.tpvOperationNumber ? `Nº operación TPV: ${input.tpvOperationNumber}` : null,
            input.transferProofUrl ? `Justificante: ${input.transferProofUrl}` : null,
          ].filter(Boolean).join(" — ") || inst.notes,
          updatedAt: now,
        }).where(eq(paymentInstallments.id, input.installmentId));

        await logActivity("quote", inst.quoteId, "installment_paid_manual", ctx.user.id, ctx.user.name, {
          installmentId: inst.id,
          installmentNumber: inst.installmentNumber,
          amountCents: inst.amountCents,
          paymentMethod: input.paymentMethod,
          tpvOperationNumber: input.tpvOperationNumber ?? null,
          transferProofUrl: input.transferProofUrl ?? null,
        });

        // Marcar el pendingPayments vinculado como cobrado (primera coincidencia por quoteId + amountCents)
        try {
          const [matchingPP] = await db.select({ id: pendingPayments.id })
            .from(pendingPayments)
            .where(and(
              eq(pendingPayments.quoteId, inst.quoteId),
              eq(pendingPayments.amountCents, inst.amountCents),
              eq(pendingPayments.status, "pending"),
            ))
            .limit(1);
          if (matchingPP) {
            await db.update(pendingPayments)
              .set({ status: "paid", updatedAt: Date.now() } as any)
              .where(eq(pendingPayments.id, matchingPP.id));
          }
        } catch (ppErr) {
          console.error("[confirmInstallment] Error actualizando pendingPayments:", ppErr);
        }

        // Enviar email de confirmación de pago al cliente
        try {
          const [quote] = await db.select({ leadId: quotes.leadId, quoteNumber: quotes.quoteNumber, title: quotes.title })
            .from(quotes).where(eq(quotes.id, inst.quoteId)).limit(1);
          if (quote) {
            const [lead] = await db.select({ name: leads.name, email: leads.email })
              .from(leads).where(eq(leads.id, quote.leadId)).limit(1);
            const allInstallments = await db.select({ id: paymentInstallments.id })
              .from(paymentInstallments).where(eq(paymentInstallments.quoteId, inst.quoteId));
            if (lead?.email) {
              const html = buildInstallmentReminderHtml({
                clientName: lead.name ?? "Cliente",
                clientEmail: lead.email,
                quoteNumber: quote.quoteNumber ?? "",
                installmentNumber: inst.installmentNumber,
                totalInstallments: allInstallments.length,
                amountFormatted: `${(inst.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`,
                dueDate: inst.dueDate,
              });
              const instSubject = `? Pago recibido — Cuota ${inst.installmentNumber}/${allInstallments.length} — ${quote.quoteNumber}`;
              await sendManagedEmail({
                templateKey: "installment_reminder",
                triggerEvent: "installment_paid",
                recipientEmail: lead.email,
                subject: instSubject,
                html,
                relatedEntityType: "quote",
                relatedEntityId: inst.quoteId,
                quoteId: inst.quoteId,
              });
              const _ci = getSystemSettingSync("email_copy_recipient", "");
              if (_ci) sharedSendEmail({ to: _ci, subject: `[COPIA] ${instSubject}`, html }).catch(() => {});
            }
          }
        } catch (emailErr) {
          console.error("[confirmInstallment] Error enviando email al cliente:", emailErr);
        }

        await checkAndConfirmInstallmentPlan(inst.quoteId, ctx.user.id, ctx.user.name ?? "Admin");

        return { success: true };
      }),

    // Obtener cuotas próximas a vencer o vencidas (para dashboard)
    upcoming: staff
      .input(z.object({
        daysAhead: z.number().default(7),
        status: z.enum(["pending", "overdue"]).optional(),
      }))
      .query(async ({ input }) => {
        const now = new Date();
        const future = new Date(now.getTime() + input.daysAhead * 86400000);
        const todayStr = now.toISOString().split("T")[0];
        const futureStr = future.toISOString().split("T")[0];

        // Solo se incluyen cuotas de presupuestos que ya tienen una reserva
        // creada (existe compromiso real de pago). Un presupuesto sin reserva
        // — aunque tenga plan fraccionado — no genera aviso de incidencia.
        const conditions = [
          ne(paymentInstallments.status, "paid"),
          ne(paymentInstallments.status, "cancelled"),
          ne(reservations.status, "cancelled"),
        ];
        if (input.status === "overdue") {
          conditions.push(lte(paymentInstallments.dueDate, todayStr));
        } else if (!input.status) {
          conditions.push(lte(paymentInstallments.dueDate, futureStr));
        }

        const rows = await db
          .select({
            id: paymentInstallments.id,
            planId: paymentInstallments.planId,
            quoteId: paymentInstallments.quoteId,
            installmentNumber: paymentInstallments.installmentNumber,
            amountCents: paymentInstallments.amountCents,
            dueDate: paymentInstallments.dueDate,
            status: paymentInstallments.status,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
            merchantOrder: paymentInstallments.merchantOrder,
            reservationId: paymentInstallments.reservationId,
            paymentMethod: paymentInstallments.paymentMethod,
            paidAt: paymentInstallments.paidAt,
            paidBy: paymentInstallments.paidBy,
            remindersSent: paymentInstallments.remindersSent,
            lastReminderAt: paymentInstallments.lastReminderAt,
            notes: paymentInstallments.notes,
            createdAt: paymentInstallments.createdAt,
            updatedAt: paymentInstallments.updatedAt,
            quoteNumber: quotes.quoteNumber,
            quoteTitle: quotes.title,
          })
          .from(paymentInstallments)
          .innerJoin(quotes, eq(quotes.id, paymentInstallments.quoteId))
          .innerJoin(reservations, eq(reservations.quoteId, quotes.id))
          .where(and(...conditions))
          .orderBy(paymentInstallments.dueDate)
          .limit(50);

        return rows;
      }),

    // Generar enlace de pago para la siguiente cuota pendiente y enviarlo al cliente
    generateInstallmentLink: staff
      .input(z.object({
        quoteId: z.number(),
        origin: z.string().url(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        if (!quote.paymentPlanId) throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto no tiene plan de pagos" });
        if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "El plan ya está completamente cobrado" });

        // Verificar que hay cuotas pendientes
        const [nextPending] = await db
          .select({ id: paymentInstallments.id, installmentNumber: paymentInstallments.installmentNumber, amountCents: paymentInstallments.amountCents, dueDate: paymentInstallments.dueDate })
          .from(paymentInstallments)
          .where(and(
            eq(paymentInstallments.quoteId, input.quoteId),
            eq(paymentInstallments.status, "pending"),
          ))
          .orderBy(paymentInstallments.installmentNumber)
          .limit(1);
        if (!nextPending) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay cuotas pendientes de cobro" });

        // Generar nuevo token y actualizar el quote
        const { randomBytes } = await import("crypto");
        const token = randomBytes(32).toString("hex");
        await db.update(quotes)
          .set({ paymentLinkToken: token, updatedAt: new Date() })
          .where(eq(quotes.id, input.quoteId));

        const paymentUrl = `${input.origin}/presupuesto/${token}`;

        // Enviar email al cliente con el enlace
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
        const allInstallments = await db.select({ id: paymentInstallments.id })
          .from(paymentInstallments).where(eq(paymentInstallments.quoteId, input.quoteId));

        if (lead?.email) {
          try {
            const html = buildInstallmentReminderHtml({
              clientName: lead.name ?? "Cliente",
              clientEmail: lead.email,
              quoteNumber: quote.quoteNumber ?? "",
              installmentNumber: nextPending.installmentNumber,
              totalInstallments: allInstallments.length,
              amountFormatted: `${(nextPending.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`,
              dueDate: nextPending.dueDate,
              paymentUrl,
            });
            const linkSubject = `?? Enlace de pago — Cuota ${nextPending.installmentNumber}/${allInstallments.length} — ${quote.quoteNumber}`;
            await sendManagedEmail({
              templateKey: "installment_reminder",
              triggerEvent: "installment_link_sent",
              recipientEmail: lead.email,
              subject: linkSubject,
              html,
              relatedEntityType: "quote",
              relatedEntityId: input.quoteId,
              quoteId: input.quoteId,
            });
            const _cl = getSystemSettingSync("email_copy_recipient", "");
            if (_cl) sharedSendEmail({ to: _cl, subject: `[COPIA] ${linkSubject}`, html }).catch(() => {});
          } catch (emailErr) {
            console.error("[generateInstallmentLink] Error enviando email:", emailErr);
          }
        }

        await logActivity("quote", input.quoteId, "installment_link_sent", ctx.user.id, ctx.user.name, {
          installmentNumber: nextPending.installmentNumber,
          amountCents: nextPending.amountCents,
          paymentUrl,
        });

        return { paymentUrl, installmentNumber: nextPending.installmentNumber, amountCents: nextPending.amountCents };
      }),

    // Marcar cuotas vencidas automáticamente (llamado por job)
    markOverdue: staff
      .input(z.object({}))
      .mutation(async ({ ctx }) => {
        const todayStr = new Date().toISOString().split("T")[0];
        const result = await db.update(paymentInstallments)
          .set({ status: "overdue", updatedAt: new Date() })
          .where(and(
            eq(paymentInstallments.status, "pending"),
            lte(paymentInstallments.dueDate, todayStr),
          ));
        const affected = (result[0] as any).affectedRows ?? 0;
        if (affected > 0) {
          console.log(`[InstallmentJob] ${affected} cuota(s) marcadas como vencidas`);
        }
        return { marked: affected };
      }),
  }),

  // --- QUOTES TIMELINE ---------------------------------------------------------
  timeline: router({
    get: staff.input(z.object({ quoteId: z.number() })).query(async ({ input }) => {
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });

      // Construir eventos sintéticos desde los campos del quote
      type TimelineEvent = {
        id: string;
        type: "created" | "sent" | "viewed" | "reminder" | "accepted" | "rejected" | "paid" | "lost" | "expired" | "activity";
        label: string;
        detail?: string;
        timestamp: number;
        actor?: string;
      };

      const events: TimelineEvent[] = [];

      // 1. Creado
      events.push({
        id: "created",
        type: "created",
        label: "Presupuesto creado",
        detail: quote.quoteNumber,
        timestamp: new Date(quote.createdAt).getTime(),
      });

      // 2. Enviado
      if (quote.sentAt) {
        events.push({
          id: "sent",
          type: "sent",
          label: "Enviado al cliente",
          detail: "Email con enlace de aceptación",
          timestamp: new Date(quote.sentAt).getTime(),
        });
      }

      // 3. Recordatorios automáticos (estimamos desde lastReminderAt y reminderCount)
      if (quote.reminderCount && quote.reminderCount > 0 && quote.lastReminderAt) {
        // Si hay 2 recordatorios, el primero fue ~48h después del envío
        if (quote.reminderCount >= 2 && quote.sentAt) {
          const firstReminderTs = new Date(quote.sentAt).getTime() + 48 * 60 * 60 * 1000;
          events.push({
            id: "reminder_1",
            type: "reminder",
            label: "Recordatorio automático #1",
            detail: "Presupuesto no abierto en 48h",
            timestamp: firstReminderTs,
          });
        }
        events.push({
          id: "reminder_last",
          type: "reminder",
          label: `Recordatorio automático #${quote.reminderCount}`,
          detail: "Reenvío automático del sistema",
          timestamp: new Date(quote.lastReminderAt).getTime(),
        });
      }

      // 4. Visto
      if (quote.viewedAt) {
        events.push({
          id: "viewed",
          type: "viewed",
          label: "Abierto por el cliente",
          detail: "El cliente visualizó el presupuesto",
          timestamp: new Date(quote.viewedAt).getTime(),
        });
      }

      // 5. Aceptado
      if (quote.acceptedAt) {
        events.push({
          id: "accepted",
          type: "accepted",
          label: "Presupuesto aceptado",
          detail: "El cliente aceptó el presupuesto",
          timestamp: new Date(quote.acceptedAt).getTime(),
        });
      }

      // 6. Pagado
      if (quote.paidAt) {
        events.push({
          id: "paid",
          type: "paid",
          label: "Pago confirmado",
          detail: quote.invoiceNumber ? `Factura ${quote.invoiceNumber} generada` : "Pago recibido",
          timestamp: new Date(quote.paidAt).getTime(),
        });
      }

      // 7. Perdido / Expirado / Rechazado (estado final negativo)
      if (quote.status === "perdido" || quote.status === "expirado" || quote.status === "rechazado") {
        events.push({
          id: "closed_negative",
          type: quote.status === "rechazado" ? "rejected" : "lost",
          label: quote.status === "rechazado" ? "Rechazado por el cliente" : quote.status === "expirado" ? "Presupuesto expirado" : "Marcado como perdido",
          timestamp: new Date(quote.updatedAt).getTime(),
        });
      }

      // 8. Actividad manual del CRM (notas, cambios de estado manuales)
      const activityLogs = await db.select().from(crmActivityLog)
        .where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, input.quoteId)))
        .orderBy(desc(crmActivityLog.createdAt))
        .limit(20);

      for (const log of activityLogs) {
        // Evitar duplicados con eventos sintéticos ya añadidos
        const isDuplicate = events.some(e =>
          Math.abs(e.timestamp - new Date(log.createdAt).getTime()) < 2000 &&
          (e.type === "sent" || e.type === "paid" || e.type === "accepted")
        );
        if (!isDuplicate) {
          events.push({
            id: `log_${log.id}`,
            type: "activity",
            label: log.action,
            detail: log.details ? JSON.stringify(log.details) : undefined,
            actor: log.actorName ?? undefined,
            timestamp: new Date(log.createdAt).getTime(),
          });
        }
      }

      // Ordenar cronológicamente
      events.sort((a, b) => a.timestamp - b.timestamp);

      return {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        events,
      };
    }),

    // --- Aplicar código de descuento / bono a un presupuesto -----------------
    // El descuento se registra en quotes.discount, se recalcula el total,
    // y se marca el código como usado (sincronizando el bono si origin=voucher).
    applyDiscountCode: staff
      .input(z.object({
        id: z.number(),
        code: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const normalizedCode = input.code.toUpperCase().trim();

        // 1. Cargar el presupuesto
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        if (quote.status === "pagado" || quote.status === "facturado" || quote.status === "convertido_reserva") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede aplicar un descuento a un presupuesto ya pagado o convertido" });
        }
        if (quote.discount && Number(quote.discount) > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya tiene un descuento aplicado" });
        }

        // 2. Validar el código
        const [dc] = await db.select().from(discountCodes)
          .where(eq(discountCodes.code, normalizedCode))
          .limit(1);

        if (!dc) throw new TRPCError({ code: "NOT_FOUND", message: "Código no encontrado" });
        if (dc.status === "inactive") throw new TRPCError({ code: "BAD_REQUEST", message: "El código está inactivo" });
        if (dc.expiresAt && new Date(dc.expiresAt) < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El código ha caducado" });
        }
        if (dc.maxUses !== null && dc.currentUses >= dc.maxUses) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El código ya ha alcanzado el límite de usos" });
        }

        // 3. Calcular importe del descuento
        const subtotalEur = Number(quote.subtotal);
        let discountEur: number;
        if (dc.discountType === "fixed") {
          discountEur = Math.min(Number(dc.discountAmount ?? 0), subtotalEur);
        } else {
          discountEur = (subtotalEur * Number(dc.discountPercent)) / 100;
        }
        discountEur = Math.round(discountEur * 100) / 100;

        // 4. Recalcular total: subtotal - descuento + IVA sobre base descontada
        const taxRate = quote.tax && subtotalEur > 0 ? Number(quote.tax) / subtotalEur : 0;
        const newTaxBase = subtotalEur - discountEur;
        const newTax = Math.round(newTaxBase * taxRate * 100) / 100;
        const newTotal = Math.max(0, newTaxBase + newTax);

        // 5. Actualizar presupuesto
        await db.update(quotes).set({
          discount: String(discountEur.toFixed(2)),
          tax: String(newTax.toFixed(2)),
          total: String(newTotal.toFixed(2)),
          updatedAt: new Date(),
        }).where(eq(quotes.id, input.id));

        // 6. Registrar uso del código (también sincroniza el bono si origin=voucher)
        await recordDiscountUse({
          discountCodeId: dc.id,
          code: dc.code,
          discountPercent: Number(dc.discountPercent),
          discountAmount: discountEur,
          originalAmount: subtotalEur,
          finalAmount: Math.max(0, subtotalEur - discountEur),
          channel: "crm",
          appliedByUserId: String(ctx.user.id),
        });

        // 7. Log de actividad
        await logActivity("quote", input.id, "discount_applied", ctx.user.id, ctx.user.name, {
          code: dc.code,
          name: dc.name,
          discountType: dc.discountType,
          discountEur,
          newTotal,
        });

        return { success: true, discountEur, newTotal, code: dc.code, name: dc.name };
      }),
  }),

  // --- RESERVATIONSS ----------------------------------------------------------

  reservations: router({
    list: staff
      .input(
        z.object({
          status: z.string().optional(),
          channel: z.string().optional(),
          search: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        const conditions = [];

        if (input.status) {
          conditions.push(eq(reservations.status, input.status as "draft" | "pending_payment" | "paid" | "failed" | "cancelled"));
        } else {
          // Regla de negocio: solo mostrar reservas reales.
          // - "paid": confirmadas por Redsys o admin.
          // - "cancelled": anuladas (deben seguir visibles con estado "Anulada").
          // - "pending_payment" + canal NO ONLINE_DIRECTO: autorizadas por admin (link de pago desde CRM).
          // Quedan excluidos: intentos de checkout web no pagados (pending_payment+ONLINE_DIRECTO)
          // y pagos fallidos (failed).
          conditions.push(
            or(
              eq(reservations.status, "paid"),
              eq(reservations.status, "cancelled"),
              and(
                eq(reservations.status, "pending_payment"),
                ne(reservations.channel, "ONLINE_DIRECTO")
              )
            ) as ReturnType<typeof and>
          );
        }

        if (input.channel) {
          if (input.channel === "coupon") {
            // Filtrar por origen cupón (cualquier plataforma)
            conditions.push(eq(reservations.originSource, "coupon_redemption"));
          } else {
            conditions.push(eq(reservations.channel, input.channel as
              "ONLINE_DIRECTO" | "ONLINE_ASISTIDO" | "VENTA_DELEGADA" |
              "TELEFONO" | "EMAIL" |
              "TPV_FISICO" | "PARTNER" | "TICKETING" | "MANUAL" | "API"));
          }
        }
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(
            or(
              like(reservations.reservationNumber, s),
              like(reservations.customerName, s),
              like(reservations.customerEmail, s),
              like(reservations.customerPhone, s),
              like(reservations.merchantOrder, s),
              like(reservations.invoiceNumber, s),
              like(reservations.productName, s),
              like(reservations.bookingDate, s),
              like(reservations.notes, s)
            )
          );
        }
        if (input.from) conditions.push(gte(reservations.createdAt, new Date(input.from).getTime()));
        if (input.to) conditions.push(lte(reservations.createdAt, new Date(input.to).getTime()));

        const where = conditions.length ? and(...conditions) : undefined;

        // Subquery agregada de operaciones del datáfono por reserva.
        // Garantiza 1 fila por reservation_id incluso cuando hay varias cto
        // vinculadas a la misma reserva (caso real RES-2026-0196: dos
        // procesos de auto-vinculación enlazaron operaciones distintas a la
        // misma reserva, causando duplicado visual en el listado del CRM).
        // Devolvemos MAX(operation_number) para que el link "ver operación"
        // siga apuntando a un valor concreto y funcional.
        const ctoAgg = db
          .select({
            reservationId: cardTerminalOperations.linkedEntityId,
            operationNumber: sql<string>`MAX(${cardTerminalOperations.operationNumber})`.as("operationNumber"),
          })
          .from(cardTerminalOperations)
          .where(eq(cardTerminalOperations.linkedEntityType, "reservation"))
          .groupBy(cardTerminalOperations.linkedEntityId)
          .as("cto_agg");

        const [rows, [{ total }]] = await Promise.all([
          db
            .select({
              ...getTableColumns(reservations),
              invoicePdfUrl: invoices.pdfUrl,
              clientId: clients.id,
              tpvOperationNumber: ctoAgg.operationNumber,
            })
            .from(reservations)
            .leftJoin(invoices, eq(invoices.id, reservations.invoiceId as any))
            .leftJoin(quotes, eq(quotes.id, reservations.quoteId as any))
            .leftJoin(clients, eq(clients.leadId, quotes.leadId))
            .leftJoin(ctoAgg, eq(ctoAgg.reservationId, reservations.id))
            .where(where)
            .orderBy(desc(reservations.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(reservations).where(where),
        ]);
        return { rows, total };
      }),

    counters: staff.query(async () => {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).getTime();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const endOfWeekStr = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const [
        confirmadas, importeConfirmadas,
        pendientePago, importePendientePago,
        canceladas,
        servicioHoy, importeServicioHoy,
        proximasSemana, importeProximasSemana,
        esteMes, importeEsteMes,
        ingresos, facturas,
      ] = await Promise.all([
        // Confirmadas (paid)
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "paid")),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations).where(eq(reservations.status, "paid")),
        // Pendiente de pago
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "pending_payment")),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations).where(eq(reservations.status, "pending_payment")),
        // Canceladas
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "cancelled")),
        // Servicio hoy (bookingDate = hoy, cualquier estado activo)
        db.select({ cnt: count() }).from(reservations)
          .where(and(eq(reservations.bookingDate, todayStr), sql`${reservations.status} != 'cancelled'`)),
        // Importe servicio hoy: usa amountTotal cuando está disponible, si no cae a pendingPayments.amountCents
        // (las reservas placeholder del flujo pendingPayments tienen amountTotal=0)
        db.select({
          total: sql<number>`
            COALESCE(SUM(
              CASE WHEN r.amount_total > 0 THEN r.amount_total
                   ELSE COALESCE(pp.amount_cents, 0)
              END
            ), 0)
          `
        })
        .from(sql`reservations r`)
        .leftJoin(sql`pending_payments pp`, sql`pp.reservation_id = r.id AND pp.pp_status = 'paid'`)
        .where(sql`r.booking_date = ${todayStr} AND r.status != 'cancelled'`),
        // Próximas 7 días (servicio confirmado)
        db.select({ cnt: count() }).from(reservations)
          .where(and(eq(reservations.status, "paid"), sql`${reservations.bookingDate} > ${todayStr}`, sql`${reservations.bookingDate} <= ${endOfWeekStr}`)),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations)
          .where(and(eq(reservations.status, "paid"), sql`${reservations.bookingDate} > ${todayStr}`, sql`${reservations.bookingDate} <= ${endOfWeekStr}`)),
        // Este mes (creadas este mes, pagadas)
        db.select({ cnt: count() }).from(reservations)
          .where(and(eq(reservations.status, "paid"), gte(reservations.createdAt, startOfMonth))),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations)
          .where(and(eq(reservations.status, "paid"), gte(reservations.createdAt, startOfMonth))),
        // Legacy: ingresos totales (amountPaid) y facturas
        db.select({ total: sum(reservations.amountPaid) }).from(reservations).where(eq(reservations.status, "paid")),
        db.select({ cnt: count() }).from(invoices).where(eq(invoices.status, "generada")),
      ]);

      return {
        confirmadas: confirmadas[0]?.cnt ?? 0,
        importeConfirmadas: ((importeConfirmadas[0]?.total ?? 0) as number) / 100,
        pendientePago: pendientePago[0]?.cnt ?? 0,
        importePendientePago: ((importePendientePago[0]?.total ?? 0) as number) / 100,
        canceladas: canceladas[0]?.cnt ?? 0,
        servicioHoy: servicioHoy[0]?.cnt ?? 0,
        importeServicioHoy: ((importeServicioHoy[0]?.total ?? 0) as number) / 100,
        proximasSemana: proximasSemana[0]?.cnt ?? 0,
        importeProximasSemana: ((importeProximasSemana[0]?.total ?? 0) as number) / 100,
        esteMes: esteMes[0]?.cnt ?? 0,
        importeEsteMes: ((importeEsteMes[0]?.total ?? 0) as number) / 100,
        // legacy
        hoy: servicioHoy[0]?.cnt ?? 0,
        proximas: proximasSemana[0]?.cnt ?? 0,
        ingresos: ((ingresos[0]?.total ?? 0) as number) / 100,
        facturas: facturas[0]?.cnt ?? 0,
      };
    }),

    // --- Auditoría: reservas pagadas sin factura o sin expediente REAV ------
    auditOrphans: staff.query(async () => {
      // 1. Reservas pagadas sin factura asociada
      // Excluir canal PARTNER: se facturan mediante liquidaciones agrupadas, nunca tienen factura individual
      // Intentamos filtrar las exentas (columna invoice_exempt, añadida por migración 0091).
      // Si la columna aún no existe en MySQL (migración pendiente), reintentamos sin el filtro.
      const baseSelect = db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          customerName: reservations.customerName,
          customerEmail: reservations.customerEmail,
          productName: reservations.productName,
          amountTotal: reservations.amountTotal,
          createdAt: reservations.createdAt,
          quoteId: reservations.quoteId,
          invoiceId: reservations.invoiceId,
          productId: reservations.productId,
          paymentMethod: reservations.paymentMethod,
        })
        .from(reservations);

      const baseWhere = and(eq(reservations.status, "paid"), ne(reservations.channel, "PARTNER"));

      let paidRes: Awaited<typeof baseSelect>;
      try {
        paidRes = await baseSelect.where(and(baseWhere, sql`(COALESCE(\`invoice_exempt\`, 0) = 0)`));
      } catch {
        // Columna invoice_exempt no existe aún — mostramos todo sin filtrar exentas
        paidRes = await baseSelect.where(baseWhere);
      }

      const paidIds = paidRes.map(r => r.id);
      const paidQuoteIds = paidRes.map(r => r.quoteId).filter((q): q is number => q != null);

      // Facturas vinculadas por reservationId o quoteId
      const linkedInvoices = paidIds.length > 0
        ? await db.select({ reservationId: invoices.reservationId, quoteId: invoices.quoteId })
            .from(invoices)
            .where(
              or(
                inArray(invoices.reservationId, paidIds),
                paidQuoteIds.length > 0 ? inArray(invoices.quoteId, paidQuoteIds) : sql`false`
              )
            )
        : [];

      // Ventas de caja cobradas con su ticket (factura simplificada): documentadas, no son una incidencia
      const ticketed = paidIds.length > 0
        ? await db.select({ reservationId: tpvSales.reservationId })
            .from(tpvSales)
            .where(and(inArray(tpvSales.reservationId, paidIds), eq(tpvSales.status, "paid"), sql`${tpvSales.ticketNumber} <> ''`))
        : [];

      // Documentada: factura por la reserva, por su presupuesto o enlazada en la reserva, o ticket de caja
      const sinFactura = ordersWithoutInvoice(paidRes, linkedInvoices, ticketed.map(t => t.reservationId).filter((id): id is number => id != null)).map(r => ({
        id: r.id,
        reservationNumber: r.reservationNumber,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        productName: r.productName,
        amountEur: (r.amountTotal ?? 0) / 100,
        createdAt: r.createdAt,
        paymentMethod: r.paymentMethod ?? null,
      }));

      // 2. Reservas pagadas vinculadas a producto REAV sin expediente REAV
      const reavProductIds = paidRes
        .map(r => r.productId)
        .filter((pid): pid is number => pid != null && pid > 0);

      let reavProductSet = new Set<number>();
      if (reavProductIds.length > 0) {
        const reavProds = await db
          .select({ id: experiences.id })
          .from(experiences)
          .where(and(inArray(experiences.id, reavProductIds), eq(experiences.fiscalRegime, "reav")));
        reavProductSet = new Set(reavProds.map(p => p.id));
      }

      const reavReservationIds = paidRes
        .filter(r => r.productId != null && reavProductSet.has(r.productId!))
        .map(r => r.id);

      let expedientedIds = new Set<number>();
      if (reavReservationIds.length > 0) {
        const expedients = await db
          .select({ reservationId: reavExpedients.reservationId })
          .from(reavExpedients)
          .where(inArray(reavExpedients.reservationId, reavReservationIds));
        expedientedIds = new Set(expedients.map(e => e.reservationId).filter((id): id is number => id != null));
      }

      const sinReav = paidRes
        .filter(r => r.productId != null && reavProductSet.has(r.productId!) && !expedientedIds.has(r.id))
        .map(r => ({
          id: r.id,
          reservationNumber: r.reservationNumber,
          customerName: r.customerName,
          customerEmail: r.customerEmail,
          productName: r.productName,
          amountEur: (r.amountTotal ?? 0) / 100,
          createdAt: r.createdAt,
        }));

      return {
        sinFactura,
        sinReav,
        totalPagadas: paidRes.length,
        sinFacturaCount: sinFactura.length,
        sinReavCount: sinReav.length,
      };
    }),

    setInvoiceExempt: staff
      .input(z.object({ reservationId: z.number(), exempt: z.boolean() }))
      .mutation(async ({ input }) => {
        // Sin DDL en tiempo de ejecución: la columna la garantiza el mantenimiento explícito
        // (ensureInvoiceExemptColumn en --schema-maintenance) y la vigila la comprobación del arranque.
        await db.execute(
          sql`UPDATE \`reservations\` SET \`invoice_exempt\` = ${input.exempt ? 1 : 0} WHERE \`id\` = ${input.reservationId}`
        );
        return { ok: true };
      }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [reservation] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!reservation) throw new TRPCError({ code: "NOT_FOUND" });

        // Buscar facturas por reservationId O por quoteId (planes de pago multi-cuota
        // vinculan la factura a la reserva de la última cuota, no necesariamente a la primera)
        const invoiceCondition = reservation.quoteId
          ? or(eq(invoices.reservationId, input.id), eq(invoices.quoteId, reservation.quoteId))
          : eq(invoices.reservationId, input.id);
        const relatedInvoices = await db.select().from(invoices)
          .where(invoiceCondition)
          .orderBy(desc(invoices.createdAt));
        const activity = await db
          .select()
          .from(crmActivityLog)
          .where(and(eq(crmActivityLog.entityType, "reservation"), eq(crmActivityLog.entityId, input.id)))
          .orderBy(desc(crmActivityLog.createdAt))
          .limit(30);

        return { reservation, invoices: relatedInvoices, activity };
      }),

    // --- Actualizar estado/notas de una reserva -----------------------------
    update: staff
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "pending_payment", "paid", "failed", "cancelled"]).optional(),
        notes: z.string().optional(),
        bookingDate: z.string().optional(),
        people: z.number().optional(),
        channel: z.string().optional(),
        channelDetail: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...fields } = input;
        const [current] = await db.select().from(reservations).where(eq(reservations.id, id));
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });

        // GUARD: cancelar una reserva NO puede hacerse por este endpoint —
        // dejaba huérfanas la operativa, los REAV, las transacciones y
        // facturas. El flujo correcto es Anular (cancellations.requestCancellation
        // ? approveRequest), que propaga el estado a todas las tablas
        // dependientes y deja trazabilidad completa.
        if (fields.status === "cancelled") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Para anular una reserva usa el botón 'Anular reserva' (módulo Anulaciones). El cambio rápido a 'cancelled' está bloqueado para preservar trazabilidad y cascada en operativa, REAV y contabilidad.",
          });
        }

        const updateData: Record<string, unknown> = { updatedAt: Date.now() };
        if (fields.status !== undefined) updateData.status = fields.status;
        if (fields.notes !== undefined) updateData.notes = fields.notes;
        if (fields.bookingDate !== undefined) updateData.bookingDate = fields.bookingDate;
        if (fields.people !== undefined) updateData.people = fields.people;
        if (fields.channel !== undefined) updateData.channel = fields.channel;
        if (fields.channelDetail !== undefined) updateData.channelDetail = fields.channelDetail;

        // Si cambia status (a algo distinto de cancelled), registrar también
        // en `reservations.changesLog` para trazabilidad in-row.
        if (fields.status !== undefined && fields.status !== current.status) {
          const existingLog = Array.isArray(current.changesLog) ? current.changesLog : [];
          updateData.changesLog = [...existingLog, {
            ts: Date.now(),
            actor: ctx.user.name ?? String(ctx.user.id),
            action: "status_change",
            from: current.status,
            to: fields.status,
          }];
        }

        await db.update(reservations).set(updateData).where(eq(reservations.id, id));
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: id,
          action: "reservation_updated",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { fields: Object.keys(fields), statusFrom: current.status, statusTo: fields.status },
          createdAt: new Date(),
        });

        // Email de confirmación al cliente solo en la transición a "paid".
        if (fields.status === "paid" && current.status !== "paid") {
          confirmReservationAndNotify(id).catch(e =>
            console.error("[crm.reservations.update] Error enviando email de confirmación:", e)
          );
        }

        return { ok: true };
      }),

    // --- Actualizar estados separados (statusReservation + statusPayment) ---------------
    updateStatuses: staff
      .input(z.object({
        id: z.number(),
        statusReservation: z.enum(["PENDIENTE_CONFIRMACION", "CONFIRMADA", "EN_CURSO", "FINALIZADA", "NO_SHOW", "ANULADA"]).optional(),
        statusPayment: z.enum(["PENDIENTE", "PAGO_PARCIAL", "PENDIENTE_VALIDACION", "PAGADO"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [current] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });

        // GUARD: marcar como ANULADA por aquí dejaba sin propagar la cascada
        // a operativa/REAV/transacciones/abonos. La anulación correcta vive
        // en cancellations.requestCancellation + approveRequest.
        if (input.statusReservation === "ANULADA") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Para anular una reserva usa el botón 'Anular reserva' (módulo Anulaciones). El cambio directo a 'ANULADA' está bloqueado para preservar trazabilidad y cascada en operativa, REAV y contabilidad.",
          });
        }
        const now = Date.now();
        const logEntry = {
          ts: now,
          actor: ctx.user.name ?? String(ctx.user.id),
          action: "status_change",
          from: JSON.stringify({ statusReservation: current.statusReservation, statusPayment: current.statusPayment }),
          to: JSON.stringify({ statusReservation: input.statusReservation, statusPayment: input.statusPayment }),
        };
        const existingLog = Array.isArray(current.changesLog) ? current.changesLog : [];
        const updateData: Record<string, unknown> = { updatedAt: now, changesLog: [...existingLog, logEntry] };
        if (input.statusReservation !== undefined) updateData.statusReservation = input.statusReservation;
        if (input.statusPayment !== undefined) updateData.statusPayment = input.statusPayment;
        // Sincronizar status legacy según los estados nuevos.
        // Nota: el caso ANULADA se descartó arriba (guard) — la anulación
        // correcta vive en cancellations.requestCancellation/approveRequest.
        if (input.statusPayment === "PAGADO") {
          updateData.status = "paid";
          updateData.paidAt = now;
        } else if (input.statusPayment !== undefined) {
          // Si el pago retrocede desde pagado, liberar el status legacy para permitir borrado
          updateData.status = "pending_payment";
        }
        await db.update(reservations).set(updateData).where(eq(reservations.id, input.id));
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.id,
          action: "status_updated",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { from: logEntry.from, to: logEntry.to },
          createdAt: new Date(),
        });

        // Email de confirmación al cliente solo en la transición a "PAGADO".
        if (input.statusPayment === "PAGADO" && current.statusPayment !== "PAGADO") {
          confirmReservationAndNotify(input.id).catch(e =>
            console.error("[crm.reservations.updateStatuses] Error enviando email de confirmación:", e)
          );
        }

        return { ok: true };
      }),

    // --- Cambio de fecha con motivo obligatorio + trazabilidad ---------------------
    changeDate: staff
      .input(z.object({
        id: z.number(),
        newDate: z.string().min(1, "La nueva fecha es obligatoria"),
        reason: z.string().min(3, "El motivo del cambio es obligatorio"),
      }))
      .mutation(async ({ input, ctx }) => {
        const [current] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });
        const now = Date.now();
        const logEntry = {
          ts: now,
          actor: ctx.user.name ?? String(ctx.user.id),
          action: "date_change",
          from: String(current.bookingDate),
          to: input.newDate,
          reason: input.reason,
        };
        const existingLog = Array.isArray(current.changesLog) ? current.changesLog : [];
        await db.update(reservations).set({
          bookingDate: input.newDate,
          dateChangedReason: input.reason,
          dateModified: true,
          changesLog: [...existingLog, logEntry],
          updatedAt: now,
        }).where(eq(reservations.id, input.id));
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.id,
          action: "date_changed",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { from: current.bookingDate, to: input.newDate, reason: input.reason },
          createdAt: new Date(),
        });
        return { ok: true };
      }),

    // --- Reenviar email de confirmación al cliente --------------------------
    resendConfirmation: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
        const isTransfer = res.paymentMethod === "transferencia";
        const base = publicBaseUrl();
        const reservationUrl = (res as any).publicToken ? `${base}/presupuesto/${(res as any).publicToken}` : undefined;
        let html: string;
        let subject: string;
        if (isTransfer) {
          const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
          html = buildTransferConfirmationHtml({
            clientName: res.customerName,
            invoiceNumber: res.invoiceNumber ?? res.merchantOrder,
            reservationRef: res.merchantOrder,
            quoteTitle: res.productName,
            items: [{
              description: res.productName,
              quantity: res.people,
              unitPrice: amountEur / res.people,
              total: amountEur,
            }],
            subtotal: amountEur.toFixed(2),
            taxAmount: "0.00",
            total: amountEur.toFixed(2),
            invoiceUrl: null,
            reservationUrl,
          });
          subject = `?? Confirmación de reserva — ${res.productName} — ${companyName()}`;
        } else {
          html = buildConfirmationHtml({
            clientName: res.customerName,
            reservationRef: res.merchantOrder,
            quoteTitle: res.productName,
            items: [{
              description: res.productName,
              quantity: res.people,
              unitPrice: (res.amountTotal / res.people) / 100,
              total: res.amountTotal / 100,
            }],
            total: (res.amountTotal / 100).toFixed(2),
            bookingDate: res.bookingDate,
            contactEmail: await getBusinessEmail('reservations'),
            contactPhone: brandSetting("brand_support_phone", ""),
            reservationUrl,
          });
          subject = `? Confirmación de reserva — ${res.productName} — ${companyName()}`;
        }
        await sendEmail({ to: res.customerEmail ?? "", subject, html });
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.id,
          action: "email_resent",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { to: res.customerEmail ?? "", subject },
          createdAt: new Date(),
        });
        return { ok: true, sentTo: res.customerEmail ?? "" };
      }),

    // --- Destinatario propuesto para canjear el ticket por factura ----------
    invoiceRecipient: staff
      .input(z.object({ reservationId: z.number() }))
      .query(async ({ input }) => {
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.reservationId));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido no encontrado" });
        const [sale] = await db.select({ clientId: tpvSales.clientId }).from(tpvSales).where(eq(tpvSales.reservationId, input.reservationId)).limit(1);
        const clientId = res.clientId ?? sale?.clientId ?? null;
        const [client] = clientId ? await db.select().from(clients).where(eq(clients.id, clientId)).limit(1) : [];
        return proposeTicketInvoiceRecipient(client ?? null, res.customerName);
      }),

    // --- Generar factura desde reserva TPV --------------------------------
    // Factura completa: exige nombre o razón social, NIF y domicilio del destinatario (art. 6 RD 1619/2012).
    generateInvoice: staff
      .input(z.object({
        reservationId: z.number(),
        clientName: z.string().max(256).optional(),
        clientNif: z.string().max(32).optional(),
        clientAddress: z.string().max(512).optional(),
        clientPostalCode: z.string().max(16).optional(),
        clientCity: z.string().max(128).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const recipient = {
          name: (input.clientName ?? "").trim(),
          nif: (input.clientNif ?? "").trim().toUpperCase(),
          address: (input.clientAddress ?? "").trim(),
          postalCode: (input.clientPostalCode ?? "").trim(),
          city: (input.clientCity ?? "").trim(),
        };
        const recipientAddress = formatRecipientAddress(recipient);
        // 1. Load reservation
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.reservationId));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
        if (res.invoiceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Esta reserva ya tiene factura generada" });
        const recipientErrors = Object.values(validateTicketInvoiceRecipient(recipient));
        if (recipientErrors.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `No se puede emitir la factura: ${recipientErrors.join(" ")}` });
        }
        // ?? GUARD: Reservas Groupon/Smartbox/etc. (canje de cupón) no son
        // facturables desde el CRM — su liquidación pertenece al flujo de
        // conciliación del proveedor. Tras la normalización del canal, el
        // ENUM ya no incluye "groupon"; identificamos estas reservas por
        // originSource = 'coupon_redemption'.
        if (res.originSource === "coupon_redemption") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Las reservas procedentes de canje de cupón Groupon no pueden facturarse desde el CRM. Su liquidación económica pertenece al flujo de conciliación del proveedor ticketing.",
          });
        }

        // 2. Load TPV sale and items if available
        const tpvSaleRows = await db.select().from(tpvSales).where(eq(tpvSales.reservationId, input.reservationId));
        const tpvSale = tpvSaleRows[0] ?? null;
        let items: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; taxRate?: number }[] = [];

        if (tpvSale) {
          const saleItems = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, tpvSale.id));
          // Cada línea conserva el tipo de IVA del ticket (antes se perdía y todo se facturaba al 21 %)
          items = saleItems.map(i => {
            const reav = i.fiscalRegime === "reav";
            const rate = Number(i.taxRate);
            return {
              description: i.productName,
              quantity: i.quantity,
              unitPrice: parseFloat(String(i.unitPrice)),
              total: parseFloat(String(i.subtotal)),
              fiscalRegime: (reav ? "reav" : "general") as "reav" | "general",
              ...(reav ? {} : { taxRate: Number.isFinite(rate) ? rate : 21 }),
            };
          });
        } else {
          // Fallback: single line from reservation data
          const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
          items = [{ description: res.productName, quantity: res.people, unitPrice: amountEur / res.people, total: amountEur }];
        }

        const now = new Date();
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        let bdTpv = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
        let taxAmount = totalTaxAmount(bdTpv);
        let taxRate = bdTpv.length === 1 ? bdTpv[0].rate : 21;
        // El total de las líneas ya incluye el IVA: la base imponible se EXTRAE
        // (total - IVA) y el total se mantiene en el bruto. No se suma el IVA encima.
        let total = parseFloat(items.reduce((s, i) => s + i.total, 0).toFixed(2));
        let subtotal = parseFloat((total - taxAmount).toFixed(2));
        if (tpvSale) {
          // Ticket de caja: lo cobrado, con la base y la cuota de cada tipo como en el ticket (y su descuento)
          const charged = chargedInvoiceAmounts(items, Number(tpvSale.total));
          bdTpv = charged.taxBreakdown;
          taxAmount = charged.taxAmount;
          taxRate = charged.taxRate;
          total = charged.total;
          subtotal = charged.subtotal;
        }
        const ticketDiscount = tpvSale ? Number(tpvSale.discountAmount ?? 0) : 0;
        // El ticket ya está cobrado: la factura nace «cobrada», con la forma de pago del ticket
        const alreadyPaid = tpvSale ? tpvSale.status === "paid" : res.statusPayment === "PAGADO";
        const ticketPayments = tpvSale
          ? await db.select({ method: tpvSalePayments.method, amount: tpvSalePayments.amount }).from(tpvSalePayments).where(eq(tpvSalePayments.saleId, tpvSale.id))
          : [];
        const paymentMethod = invoicePaymentMethodFromTicket(ticketPayments, res.paymentMethod);
        const paidAtMs = tpvSale?.paidAt ?? res.paidAt ?? null;

        // 3. Generate PDF
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: recipient.name,
            clientEmail: res.customerEmail ?? "",
            clientPhone: res.customerPhone,
            clientNif: recipient.nif,
            clientAddress: recipientAddress,
            itemsJson: items,
            subtotal: String(subtotal.toFixed(2)),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total.toFixed(2)),
            taxBreakdown: bdTpv,
            discount: ticketDiscount > 0 ? ticketDiscount.toFixed(2) : null,
            discountReason: ticketDiscount > 0 ? tpvSale?.discountReason ?? null : null,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("Invoice PDF generation failed:", e);
        }

        // 4. Insert invoice record
        const [invResult] = await db.insert(invoices).values({
          issuerSnapshot: await issuerSnapshotForNewInvoice(),
          invoiceNumber,
          reservationId: input.reservationId,
          clientName: recipient.name,
          clientEmail: res.customerEmail ?? "",
          clientPhone: res.customerPhone,
          itemsJson: items,
          subtotal: String(subtotal.toFixed(2)),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdTpv.length > 0 ? bdTpv : undefined,
          total: String(total.toFixed(2)),
          ...(ticketDiscount > 0 ? { discount: ticketDiscount.toFixed(2), discountReason: tpvSale?.discountReason ?? null } : {}),
          pdfUrl,
          pdfKey,
          clientNif: recipient.nif,
          clientAddress: recipientAddress,
          isAutomatic: false,
          status: alreadyPaid ? "cobrada" : "generada",
          ...(alreadyPaid ? { paymentMethod, paymentValidatedAt: paidAtMs ? new Date(Number(paidAtMs)) : now } : {}),
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;

        // 5. Update reservation with invoiceId and invoiceNumber
        await db.update(reservations).set({
          invoiceId,
          invoiceNumber,
          updatedAt: Date.now(),
        }).where(eq(reservations.id, input.reservationId));

        // 6. Update tpvSale with invoiceId if applicable (no new REAV expedient)
        if (tpvSale) {
          await db.update(tpvSales).set({ invoiceId }).where(eq(tpvSales.id, tpvSale.id));
        }

        // 7. Attach invoice PDF to existing REAV expedient (if any) — NO new expedient created
        if (pdfUrl) {
          const reavRows = await db.select({ id: reavExpedients.id })
            .from(reavExpedients)
            .where(eq(reavExpedients.sourceRef, tpvSale?.ticketNumber ?? res.merchantOrder ?? ""))
            .limit(1);
          const reavId = reavRows[0]?.id ?? null;
          if (reavId) {
            await attachReavDocument({
              expedientId: reavId,
              side: "client",
              docType: "factura_emitida",
              title: `Factura ${invoiceNumber}`,
              fileUrl: pdfUrl,
              notes: `Factura generada desde reserva TPV ${res.merchantOrder}`,
            });
          }
        }

        // 8. Log activity
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.reservationId,
          action: "invoice_generated",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { invoiceId, invoiceNumber, pdfUrl },
          createdAt: new Date(),
        });

        return { ok: true, invoiceId, invoiceNumber, pdfUrl };
      }),

    // --- Eliminar reserva ---------------------------------------------------
    //
    // Hard-delete con CASCADA atómica. Política por tabla:
    //   - reservation_operational ? DELETE (operativa pura, sin valor fiscal)
    //   - reav_expedients         ? UPDATE op_status='anulado' (preserva
    //                                el expediente para auditoría fiscal aunque
    //                                la reserva desaparezca de `reservations`)
    //   - tpvSales                ? UPDATE status='cancelled' (preserva el
    //                                ticket TPV para arqueo y control diario)
    //   - crm_activity_log        ? DELETE (rastro de UI, sin valor legal)
    //   - reservations            ? DELETE (hard-delete, igual que antes)
    //
    // Guards: si la reserva tiene cobros contabilizados (transactions con
    // status='completado') o está en una liquidación de partner (partner_
    // billing_batch_items), se BLOQUEA el borrado. El flujo correcto en ese
    // caso es Anular (que preserva todo el rastro). Antes del fix, el
    // borrado dejaba huérfanas las filas en `reservation_operational` y
    // `reav_expedients`, ensuciando informes operativos y fiscales.
    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const [res] = await db.select({ id: reservations.id, status: reservations.status }).from(reservations).where(eq(reservations.id, input.id));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
        if (res.status === "paid") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se puede eliminar una reserva pagada. Cancélala primero desde Editar." });

        const [billingItem] = await db
          .select({ id: partnerBillingBatchItems.id, batchId: partnerBillingBatchItems.batchId })
          .from(partnerBillingBatchItems)
          .where(eq(partnerBillingBatchItems.reservationId, input.id))
          .limit(1);
        if (billingItem) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No se puede eliminar: forma parte de la liquidación del partner #${billingItem.batchId}. Anúlala desde Editar para preservar el rastro contable.`,
          });
        }

        const [completedTx] = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(
            eq(transactions.reservationId, input.id),
            eq(transactions.type, "ingreso"),
            eq(transactions.status, "completado"),
          ))
          .limit(1);
        if (completedTx) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se puede eliminar: tiene cobros contabilizados. Anúlala desde Editar para registrar el reembolso.",
          });
        }

        await db.transaction(async (tx) => {
          await tx.delete(reservationOperational)
            .where(eq(reservationOperational.reservationId, input.id));
          await tx.update(reavExpedients)
            .set({ operativeStatus: "anulado", fiscalStatus: "anulado", closedAt: new Date() })
            .where(eq(reavExpedients.reservationId, input.id));
          await tx.update(tpvSales).set({ status: "cancelled" })
            .where(eq(tpvSales.reservationId, input.id));
          await tx.delete(crmActivityLog).where(and(
            eq(crmActivityLog.entityType, "reservation"),
            eq(crmActivityLog.entityId, input.id),
          ));
          await tx.delete(reservations).where(eq(reservations.id, input.id));
        });
        return { ok: true };
      }),

    // Misma cascada que `delete`, en lote. Salta las que no se puedan borrar
    // (status='paid', liquidación pendiente o cobros contabilizados) y
    // devuelve el desglose de saltadas con motivo.
    bulkDelete: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const rows = await db.select({ id: reservations.id, status: reservations.status }).from(reservations).where(inArray(reservations.id, input.ids));

        const skippedReasons: Array<{ id: number; reason: string }> = [];
        let candidates = rows.filter(r => r.status !== "paid").map(r => r.id);
        for (const r of rows) {
          if (r.status === "paid") skippedReasons.push({ id: r.id, reason: "pagada" });
        }

        // Filtrar las que están en una liquidación o tienen cobros contabilizados.
        if (candidates.length > 0) {
          const inBilling = await db
            .select({ reservationId: partnerBillingBatchItems.reservationId })
            .from(partnerBillingBatchItems)
            .where(inArray(partnerBillingBatchItems.reservationId, candidates));
          const billingSet = new Set(inBilling.map(b => b.reservationId));
          for (const id of candidates) {
            if (billingSet.has(id)) skippedReasons.push({ id, reason: "en liquidación de partner" });
          }
          candidates = candidates.filter(id => !billingSet.has(id));
        }
        if (candidates.length > 0) {
          const withTx = await db
            .select({ reservationId: transactions.reservationId })
            .from(transactions)
            .where(and(
              inArray(transactions.reservationId, candidates),
              eq(transactions.type, "ingreso"),
              eq(transactions.status, "completado"),
            ));
          const txSet = new Set(withTx.map(t => t.reservationId).filter((x): x is number => x != null));
          for (const id of candidates) {
            if (txSet.has(id)) skippedReasons.push({ id, reason: "tiene cobros contabilizados" });
          }
          candidates = candidates.filter(id => !txSet.has(id));
        }

        if (candidates.length > 0) {
          await db.transaction(async (tx) => {
            await tx.delete(reservationOperational).where(inArray(reservationOperational.reservationId, candidates));
            await tx.update(reavExpedients)
              .set({ operativeStatus: "anulado", fiscalStatus: "anulado", closedAt: new Date() })
              .where(inArray(reavExpedients.reservationId, candidates));
            await tx.update(tpvSales).set({ status: "cancelled" }).where(inArray(tpvSales.reservationId, candidates));
            for (const id of candidates) {
              await tx.delete(crmActivityLog).where(and(
                eq(crmActivityLog.entityType, "reservation"),
                eq(crmActivityLog.entityId, id),
              ));
            }
            await tx.delete(reservations).where(inArray(reservations.id, candidates));
          });
        }
        return { deleted: candidates.length, skipped: skippedReasons.length, skippedReasons };
      }),

    bulkUpdateStatus: staff
      .input(z.object({
        ids: z.array(z.number()).min(1),
        status: z.enum(["draft", "pending_payment", "paid", "failed", "cancelled"]),
      }))
      .mutation(async ({ input, ctx }) => {
        // GUARD: cancelar en lote dejaba reservas en estado "zombie"
        // (cancelled + PAGADO + CONFIRMADA + op_status confirmado) sin
        // ningún rastro en logs. Caso real documentado: RES-2026-0157.
        // Para anular, usa el módulo de Anulaciones (1 reserva a la vez).
        if (input.status === "cancelled") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Para anular reservas usa el botón 'Anular reserva' (módulo Anulaciones, 1 a 1). El bulk update a 'cancelled' está bloqueado para preservar trazabilidad y cascada en operativa, REAV y contabilidad.",
          });
        }

        // Cargar estados actuales para registrar el cambio en changesLog y log.
        const rows = await db
          .select({ id: reservations.id, status: reservations.status, changesLog: reservations.changesLog })
          .from(reservations)
          .where(inArray(reservations.id, input.ids));
        const now = Date.now();
        const actor = ctx.user.name ?? String(ctx.user.id);

        // Cada reserva con su propio changesLog actualizado.
        for (const r of rows) {
          if (r.status === input.status) continue;
          const existingLog = Array.isArray(r.changesLog) ? r.changesLog : [];
          const newLog = [...existingLog, {
            ts: now, actor, action: "bulk_status_change",
            from: r.status, to: input.status,
          }];
          await db.update(reservations)
            .set({ status: input.status, changesLog: newLog, updatedAt: now })
            .where(eq(reservations.id, r.id));
          await db.insert(crmActivityLog).values({
            entityType: "reservation",
            entityId: r.id,
            action: "bulk_status_change",
            actorId: ctx.user.id,
            actorName: ctx.user.name ?? null,
            details: { from: r.status, to: input.status },
            createdAt: new Date(),
          });

          // Email de confirmación al cliente solo en la transición a "paid".
          if (input.status === "paid" && r.status !== "paid") {
            confirmReservationAndNotify(r.id).catch(e =>
              console.error("[crm.reservations.bulkUpdateStatus] Error enviando email de confirmación:", e)
            );
          }
        }

        return { updated: rows.filter(r => r.status !== input.status).length };
      }),

    // --- Crear reserva manual (admin) -----------------------------------------------------------------------------
    // Crea una reserva directa sin pasar por presupuesto, ejecutando el mismo
    // postConfirmOperation que los flujos automáticos (CRM, Redsys, Ticketing, TPV).
    createManual: staff
      .input(
        z.object({
          // Cliente
          customerName: z.string().min(2),
          customerEmail: z.string().email(),
          customerPhone: z.string().optional(),
          // Producto
          productId: z.number(),
          productName: z.string().min(1),
          // Servicio
          bookingDate: z.string().min(1),   // YYYY-MM-DD
          people: z.number().min(1),
          // Económico
          amountTotal: z.number().min(0),    // en euros
          amountPaid: z.number().min(0),     // en euros
          paymentMethod: z.enum(["efectivo", "transferencia", "redsys", "otro"]).default("efectivo"),
          // Opcionales
          notes: z.string().optional(),
          channel: z.enum(["VENTA_DELEGADA", "TELEFONO", "EMAIL", "MANUAL"]).default("VENTA_DELEGADA"),
          sendConfirmationEmail: z.boolean().default(true),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const now = new Date();
        const merchantOrder = `MAN-${Date.now().toString(36).toUpperCase()}`;

        // 1. Upsert cliente
        await upsertClientFromReservation({
          name: input.customerName,
          email: input.customerEmail,
          phone: input.customerPhone ?? null,
          source: "admin",
        });

        // 2. Generar número de factura
        const invoiceNumber = await generateInvoiceNumber("crm:manual", String(ctx.user.id));

        // 3. Construir líneas de factura
        const unitPrice = input.people > 0 ? input.amountTotal / input.people : input.amountTotal;
        // Tipo de IVA del producto (régimen general); antes se aplicaba siempre el 21 %
        const [manualProduct] = await db.select({ fiscalRegime: experiences.fiscalRegime, taxRate: experiences.taxRate }).from(experiences).where(eq(experiences.id, input.productId)).limit(1);
        const manualRate = manualProduct?.fiscalRegime === "general" && manualProduct.taxRate != null ? parseFloat(String(manualProduct.taxRate)) : NaN;
        const items = [{
          description: input.productName,
          quantity: input.people,
          unitPrice,
          total: input.amountTotal,
          fiscalRegime: "general" as const,
          ...(Number.isFinite(manualRate) ? { taxRate: manualRate } : {}),
        }];
        const bdManual = groupTaxBreakdown(items);
        const taxAmount = totalTaxAmount(bdManual);
        const taxRate = bdManual.length === 1 ? bdManual[0].rate : 21;
        // El importe introducido ya incluye el IVA: la base imponible se EXTRAE
        // (total - IVA) y el total se mantiene en el bruto. No se suma el IVA encima.
        const total = parseFloat(input.amountTotal.toFixed(2));
        const subtotal = parseFloat((input.amountTotal - taxAmount).toFixed(2));

        // 4. Generar PDF de factura
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: input.customerName,
            clientEmail: input.customerEmail,
            clientPhone: input.customerPhone ?? null,
            itemsJson: items,
            subtotal: String(subtotal),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total),
            taxBreakdown: bdManual,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("[createManual] PDF generation failed:", e);
        }

        // 5. Insertar factura
        const [invResult] = await db.insert(invoices).values({
          issuerSnapshot: await issuerSnapshotForNewInvoice(),
          invoiceNumber,
          clientName: input.customerName,
          clientEmail: input.customerEmail,
          clientPhone: input.customerPhone ?? null,
          itemsJson: items,
          subtotal: String(subtotal),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdManual.length > 0 ? bdManual : undefined,
          total: String(total),
          pdfUrl,
          pdfKey,
          isAutomatic: false,
          status: "generada",
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;

        // 6. Insertar reserva
        const reservationNumberManual = await generateReservationNum("crm:createManual", String(ctx.user.id));
        const [resResult] = await db.insert(reservations).values({
          productId: input.productId,
          productName: input.productName,
          bookingDate: input.bookingDate,
          people: input.people,
          amountTotal: Math.round(input.amountTotal * 100),
          amountPaid: Math.round(input.amountPaid * 100),
          status: "paid",
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? "",
          channel: input.channel,
          paymentMethod: input.paymentMethod,
          merchantOrder,
          reservationNumber: reservationNumberManual,
          invoiceId,
          invoiceNumber,
          notes: input.notes ?? `Reserva creada manualmente por ${ctx.user.name ?? ctx.user.id}`,
          createdAt: now.getTime(),
          updatedAt: now.getTime(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // 7. Actualizar reservationId en la factura
        await db.update(invoices).set({ reservationId }).where(eq(invoices.id, invoiceId));

        // 8. postConfirmOperation: booking + transacción + reservation_operational
        try {
          await postConfirmOperation({
            reservationId,
            productId: input.productId,
            productName: input.productName,
            serviceDate: input.bookingDate,
            people: input.people,
            amountCents: Math.round(input.amountPaid * 100),
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone ?? null,
            totalAmount: input.amountPaid,
            paymentMethod: (input.paymentMethod as string) === "tarjeta_fisica" ? "tarjeta_fisica" : (input.paymentMethod as string) === "tarjeta_redsys" ? "tarjeta_redsys" : input.paymentMethod === "redsys" ? "redsys" : input.paymentMethod === "transferencia" ? "transferencia" : input.paymentMethod === "efectivo" ? "efectivo" : "otro",
            saleChannel: "admin",
            invoiceNumber,
            reservationRef: merchantOrder,
          });
        } catch (e) {
          console.error("[createManual] postConfirmOperation error:", e);
        }

        // 9. Email de confirmación al cliente
        if (input.sendConfirmationEmail && input.customerEmail) {
          try {
            // Recuperar publicToken de la reserva recién creada (lo genera MySQL por DEFAULT)
            const [resRow] = await db.select({ publicToken: reservations.publicToken })
              .from(reservations).where(eq(reservations.id, reservationId)).limit(1);
            const base = publicBaseUrl();
            const reservationUrl = resRow?.publicToken ? `${base}/presupuesto/${resRow.publicToken}` : undefined;
            const html = buildConfirmationHtml({
              clientName: input.customerName,
              reservationRef: merchantOrder,
              quoteTitle: input.productName,
              items: [{ description: input.productName, quantity: input.people, unitPrice, total: input.amountTotal }],
              total: input.amountTotal.toFixed(2),
              bookingDate: input.bookingDate,
              contactEmail: await getBusinessEmail('reservations'),
              contactPhone: brandSetting("brand_support_phone", ""),
              reservationUrl,
            });
            await sendEmail({
              to: input.customerEmail,
              subject: `? Confirmación de reserva — ${input.productName} — ${companyName()}`,
              html,
            });
          } catch (e) {
            console.error("[createManual] Email send error:", e);
          }
        }

        // 10. GHL: crear/actualizar contacto y disparar workflow siempre
        try {
          const ghlCreds = await getGHLCredentials();
          if (ghlCreds) {
            // Reutilizar ghlContactId del lead existente, o crear contacto nuevo
            const [existingLead] = await db
              .select({ ghlContactId: leads.ghlContactId })
              .from(leads)
              .where(eq(leads.email, input.customerEmail))
              .limit(1);

            const ghlContactId = existingLead?.ghlContactId
              ?? await createGHLContact({
                name: input.customerName,
                email: input.customerEmail,
                phone: input.customerPhone ?? undefined,
                tags: ["reserva_confirmada", "reserva_admin"],
              }, ghlCreds);

            if (ghlContactId) {
              // 1. Actualizar campos personalizados del contacto en GHL
              //    para que el workflow pueda usarlos en plantillas (WhatsApp, email, etc.)
              // Sincronizar invoice + presupuesto_url (publicToken) en el contacto.
              // El workflow WhatsApp lee {{contact.presupuesto_url}} para el botón.
              const [resForUrl] = await db.select({ publicToken: reservations.publicToken })
                .from(reservations).where(eq(reservations.id, reservationId)).limit(1);
              const baseUrl = publicBaseUrl();
              const publicReservationUrl = resForUrl?.publicToken
                ? `${baseUrl}/presupuesto/${resForUrl.publicToken}`
                : undefined;
              if (pdfUrl || publicReservationUrl) {
                syncLeadUrlsToGHL({
                  ghlContactId,
                  invoiceUrl: pdfUrl ?? undefined,
                  invoiceNumber: pdfUrl ? invoiceNumber : undefined,
                  quoteUrl: publicReservationUrl,
                  email: input.customerEmail,
                  phone: input.customerPhone ?? undefined,
                  credentials: ghlCreds,
                });
              }

              // 2. Disparar el workflow
              const webhookUrl = integrationEnv("GHL_RESERVATION_WEBHOOK_URL");
              if (webhookUrl) {
                await triggerGHLWorkflow(webhookUrl, {
                  contactId: ghlContactId,
                  reservationId,
                  reservationNumber: reservationNumberManual,
                  merchantOrder,
                  productName: input.productName,
                  bookingDate: input.bookingDate,
                  people: input.people,
                  amountPaid: Math.round(input.amountPaid * 100),
                  customerName: input.customerName,
                  customerEmail: input.customerEmail,
                  customerPhone: input.customerPhone ?? null,
                  invoiceUrl: pdfUrl ?? null,
                  invoiceNumber,
                  source: "reserva_admin",
                });
              }
            }
          }
        } catch (ghlErr: any) {
          console.error("[createManual] Error en integración GHL:", ghlErr.message);
        }

        // 11. Registrar actividad
        await logActivity(
          "reservation",
          reservationId,
          "reservation_created",
          ctx.user.id,
          ctx.user.name,
          {
            productName: input.productName,
            customerName: input.customerName,
            bookingDate: input.bookingDate,
            people: input.people,
            amountPaid: input.amountPaid,
            invoiceNumber,
            merchantOrder,
            channel: input.channel,
            createdBy: ctx.user.name ?? ctx.user.id,
          }
        ).catch(() => {});

         return {
          ok: true,
          reservationId,
          invoiceId,
          invoiceNumber,
          merchantOrder,
          pdfUrl,
        };
      }),

    // --- Descargar PDF de reserva --------------------------------------------------
    downloadPdf: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!res) throw new TRPCError({ code: "NOT_FOUND" });
        const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
        const channelLabels: Record<string, string> = {
          ONLINE_DIRECTO: "Online Directo", ONLINE_ASISTIDO: "Online Asistido",
          VENTA_DELEGADA: "Venta Delegada", TPV_FISICO: "TPV Físico",
          PARTNER: "Partner", MANUAL: "Manual", API: "API",
          web: "Web", crm: "CRM", telefono: "Teléfono", email: "Email",
          otro: "Otro", tpv: "TPV", groupon: "Groupon",
        };
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          body{font-family:Arial,sans-serif;color:#1a1a2e;margin:0;padding:32px;}
          .header{background:#1a3a5c;color:#fff;padding:24px 32px;border-radius:8px 8px 0 0;}
          .header h1{margin:0;font-size:22px;} .header p{margin:4px 0;font-size:13px;opacity:.8;}
          .section{padding:20px 0;border-bottom:1px solid #e5e7eb;}
          .section h2{font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;}
          .row{display:flex;justify-content:space-between;margin:6px 0;font-size:13px;}
          .label{color:#6b7280;} .value{font-weight:600;color:#1a1a2e;}
          .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;}
          .badge-blue{background:#dbeafe;color:#1d4ed8;} .badge-green{background:#dcfce7;color:#15803d;}
          .badge-amber{background:#fef3c7;color:#92400e;} .badge-red{background:#fee2e2;color:#b91c1c;}
          .badge-gray{background:#f3f4f6;color:#374151;}
          .total-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin-top:16px;}
          .total-box .amount{font-size:28px;font-weight:800;color:#1a3a5c;}
          .footer{margin-top:32px;text-align:center;font-size:11px;color:#9ca3af;}
          .tag{display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-left:8px;}
        </style></head><body>
          <div class="header">
            <h1>Reserva #${res.merchantOrder}${res.dateModified ? '<span class="tag">?? FECHA MODIFICADA</span>' : ""}</h1>
            <p>${companyName()}</p>
          </div>
          <div style="padding:0 0 0 0;">
            <div class="section">
              <h2>Cliente</h2>
              <div class="row"><span class="label">Nombre</span><span class="value">${res.customerName}</span></div>
              ${res.customerEmail ? `<div class="row"><span class="label">Email</span><span class="value">${res.customerEmail}</span></div>` : ""}
              ${res.customerPhone ? `<div class="row"><span class="label">Teléfono</span><span class="value">${res.customerPhone}</span></div>` : ""}
            </div>
            <div class="section">
              <h2>Actividad</h2>
              <div class="row"><span class="label">Producto</span><span class="value">${res.productName}</span></div>
              <div class="row"><span class="label">Fecha actividad</span><span class="value">${res.bookingDate}</span></div>
              <div class="row"><span class="label">Personas</span><span class="value">${res.people}</span></div>
              ${res.dateModified && res.dateChangedReason ? `<div class="row"><span class="label">Motivo cambio fecha</span><span class="value" style="color:#92400e">${res.dateChangedReason}</span></div>` : ""}
            </div>
            <div class="section">
              <h2>Estado</h2>
              <div class="row">
                <span class="label">Estado reserva</span>
                <span class="value">${res.statusReservation ?? "PENDIENTE_CONFIRMACION"}</span>
              </div>
              <div class="row">
                <span class="label">Estado pago</span>
                <span class="value">${res.statusPayment ?? "PENDIENTE"}</span>
              </div>
              <div class="row"><span class="label">Canal</span><span class="value">${channelLabels[res.channel ?? ""] ?? res.channel ?? ""}${res.channelDetail ? " — " + res.channelDetail : ""}</span></div>
              <div class="row"><span class="label">Método de pago</span><span class="value">${({ tarjeta_fisica: "Tarjeta Física", tarjeta_redsys: "Tarjeta Redsys", redsys: "Tarjeta Redsys", tarjeta: "Tarjeta", transferencia: "Transferencia", efectivo: "Efectivo", otro: "Otro" } as Record<string, string>)[res.paymentMethod ?? ""] ?? res.paymentMethod ?? "—"}</span></div>
              <div class="row"><span class="label">Fecha de compra</span><span class="value">${new Date(res.createdAt).toLocaleDateString("es-ES")}</span></div>
            </div>
            <div class="total-box">
              <div class="row"><span class="label">Importe total</span></div>
              <div class="amount">${amountEur.toFixed(2)}€</div>
              ${res.invoiceNumber ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Factura: ${res.invoiceNumber}</div>` : ""}
            </div>
          </div>
          <div class="footer">Generado por ${companyName()} CRM — ${new Date().toLocaleDateString("es-ES")}</div>
        </body></html>`;
        const pdfBuffer = await htmlToPdf(html);
        const key = `reservations/pdf-${res.merchantOrder}-${Date.now()}.pdf`;
        const { url } = await storagePut(key, pdfBuffer, "application/pdf", { category: "reservation", originalName: `Reserva-${res.merchantOrder}.pdf`, owner: { type: "reservation", id: res.id } });
        return { url };
      }),
  }),
  // --- INVOICES --------------------------------------------------------------

  invoices: router({
    list: staff
      .input(z.object({ quoteId: z.number().optional(), limit: z.number().default(50), offset: z.number().default(0) }))
      .query(async ({ input }) => {
        const conditions = input.quoteId ? [eq(invoices.quoteId, input.quoteId)] : [];
        return db
          .select()
          .from(invoices)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(invoices.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.id));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        return invoice;
      }),

    // --- Exportar para la gestoría: ZIP con los PDF y el libro de facturas emitidas ----
    // Consulta (no cambia nada): con la facturación en solo lectura se sigue pudiendo exportar. Solo quien
    // ve los informes contables (administración por defecto). Datos de la empresa en curso, nunca de otra.
    exportForGestoria: permissionProcedure("accounting.reports.view", ["admin"])
      .input(z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("month"), year: z.number().int(), month: z.number().int() }),
        z.object({ kind: z.literal("quarter"), year: z.number().int(), quarter: z.number().int() }),
        z.object({ kind: z.literal("range"), from: z.string().max(10), to: z.string().max(10) }),
      ]))
      .query(async ({ input }) => {
        let period;
        try {
          period = resolveExportPeriod(input);
        } catch (e) {
          if (e instanceof ExportPeriodError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        const [stored, tickets] = await Promise.all([listInvoicesForExport(period), listTicketsForExport(period)]);
        // Periodo sin documentos (ni facturas ni tickets de caja): se rechaza sin montar nada
        if (stored.length === 0 && tickets.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: emptyExportMessage(period.label) });
        if (stored.length > MAX_EXPORT_DOCUMENTS) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `El periodo tiene ${stored.length} documentos y el máximo por exportación es ${MAX_EXPORT_DOCUMENTS}. Exporta por meses o con un rango más corto.` });
        }
        const byId = new Map(stored.map((r) => [r.id, r]));
        try {
          const zip = await buildGestoriaInvoiceZip({
            companyName: companyName(),
            period,
            rows: stored.map(toExportRow),
            originalNumbers: await originalInvoiceNumbers(stored),
            tickets,
            pdfFor: (row) => storedInvoicePdf(byId.get(row.id)!),
          });
          return {
            fileName: zip.fileName,
            mimeType: "application/zip",
            contentBase64: zip.buffer.toString("base64"),
            period: { from: period.from, to: period.to, label: period.label },
            invoices: zip.invoices,
            creditNotes: zip.creditNotes,
            tickets: zip.tickets,
            missingPdfs: zip.missingPdfs,
          };
        } catch (e) {
          if (e instanceof ExportTooLargeError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
      }),

    // --- Descargar el PDF de una factura o abono ------------------------------
    // El mismo documento que va en el ZIP de la gestoría: el PDF guardado si existe o, si no, el generado con
    // los datos guardados (sin recalcular nada). Consulta: también con la facturación en solo lectura.
    downloadPdf: staff
      .input(z.object({ invoiceId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "No se ha encontrado el documento" });
        let pdf: Buffer;
        try {
          pdf = await storedInvoicePdf(invoice);
        } catch (e) {
          console.error("[PDF] Error preparando la descarga de", invoice.invoiceNumber, e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se ha podido preparar el PDF. Inténtalo de nuevo en unos minutos." });
        }
        return {
          fileName: `${invoice.invoiceNumber}.pdf`,
          mimeType: "application/pdf",
          contentBase64: pdf.toString("base64"),
        };
      }),

    // --- Regenerar PDF de factura existente -----------------------------------
    regeneratePdf: staff
      .input(z.object({ invoiceId: z.number() }))
      .mutation(async ({ input }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

        const pdf = await generateInvoicePdf({
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.clientName,
          clientEmail: invoice.clientEmail,
          clientPhone: invoice.clientPhone,
          clientNif: invoice.clientNif,
          clientAddress: invoice.clientAddress,
          itemsJson: (invoice.itemsJson as any[]) ?? [],
          subtotal: invoice.subtotal,
          discount: (invoice as any).discount ?? null,
          discountReason: (invoice as any).discountReason ?? null,
          taxRate: invoice.taxRate ?? "21",
          taxAmount: invoice.taxAmount ?? "0",
          taxBreakdown: (invoice.taxBreakdown as any) ?? undefined,
          total: invoice.total,
          issuedAt: invoice.issuedAt,
        });

        await db.update(invoices)
          .set({ pdfUrl: pdf.url, pdfKey: pdf.key, updatedAt: new Date() })
          .where(eq(invoices.id, input.invoiceId));

        return { pdfUrl: pdf.url };
      }),

    // --- Listado completo con filtros ------------------------------------------
    listAll: staff
      .input(z.object({
        status: z.enum(["generada", "enviada", "cobrada", "anulada", "abonada"]).optional(),
        invoiceType: z.enum(["factura", "abono"]).optional(),
        paymentMethod: z.enum(["redsys", "transferencia", "efectivo", "otro"]).optional(),
        search: z.string().optional(),
        dateFrom: z.string().optional(), // ISO date string YYYY-MM-DD
        dateTo: z.string().optional(),   // ISO date string YYYY-MM-DD
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        const conditions: SQL[] = [];
        if (input.status) conditions.push(eq(invoices.status, input.status));
        if (input.invoiceType) conditions.push(eq(invoices.invoiceType, input.invoiceType));
        if (input.paymentMethod) conditions.push(eq(invoices.paymentMethod, input.paymentMethod));
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(or(
            like(invoices.invoiceNumber, s),
            like(invoices.clientName, s),
            like(invoices.clientEmail, s),
            like(invoices.clientPhone, s),
            like(invoices.clientNif, s),
            like(invoices.clientAddress, s),
          ) as SQL);
        }
        if (input.dateFrom) {
          const from = new Date(input.dateFrom);
          from.setHours(0, 0, 0, 0);
          conditions.push(gte(invoices.createdAt, from));
        }
        if (input.dateTo) {
          const to = new Date(input.dateTo);
          to.setHours(23, 59, 59, 999);
          conditions.push(lte(invoices.createdAt, to));
        }
        const whereClause = conditions.length ? and(...conditions) : undefined;

        // Condiciones base solo sobre facturas originales (no abonos) para el cálculo neto
        const facturaOnlyConditions = [...conditions, eq(invoices.invoiceType, "factura")];
        const abonoOnlyConditions = [...conditions, eq(invoices.invoiceType, "abono")];

        const [rows, [{ total }], [{ subtotalSum, taxSum, grandTotal }], [{ abonosTotal }]] = await Promise.all([
          db.select().from(invoices)
            .where(whereClause)
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(invoices).where(whereClause),
          db.select({
            subtotalSum: sql<string>`COALESCE(SUM(CASE WHEN \`invoiceType\` = 'factura' THEN \`subtotal\` ELSE 0 END), 0)`,
            taxSum: sql<string>`COALESCE(SUM(CASE WHEN \`invoiceType\` = 'factura' THEN \`taxAmount\` ELSE 0 END), 0)`,
            grandTotal: sql<string>`COALESCE(SUM(CASE WHEN \`invoiceType\` = 'factura' THEN \`total\` ELSE 0 END), 0)`,
          }).from(invoices).where(whereClause),
          db.select({
            abonosTotal: sql<string>`COALESCE(SUM(ABS(\`total\`)), 0)`,
          }).from(invoices).where(and(...(abonoOnlyConditions.length ? abonoOnlyConditions : [eq(invoices.invoiceType, "abono")]))),
        ]);

        // Enriquecer filas: para facturas abonadas ? buscar su nº de abono; para abonos ? nº de factura original
        const abonadaIds = rows.filter(r => r.status === "abonada").map(r => r.id);
        const abonoRows = rows.filter(r => r.invoiceType === "abono" && r.creditNoteForId);
        const originalIds = abonoRows.map(r => r.creditNoteForId!);

        // Batch-fetch credit notes linked to abonada invoices
        const creditNoteMap: Record<number, string> = {}; // originalInvoiceId ? abonoInvoiceNumber
        if (abonadaIds.length > 0) {
          const creditNotes = await db.select({ creditNoteForId: invoices.creditNoteForId, invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(sql`${invoices.creditNoteForId} IN (${sql.join(abonadaIds.map(id => sql`${id}`), sql`, `)})`);
          for (const cn of creditNotes) {
            if (cn.creditNoteForId) creditNoteMap[cn.creditNoteForId] = cn.invoiceNumber;
          }
        }

        // Batch-fetch original invoice numbers for abono rows
        const originalInvoiceMap: Record<number, string> = {}; // abonoId ? originalInvoiceNumber
        const originalMethodMap: Record<number, string | null> = {}; // abonoId → forma de pago de la factura original
        if (originalIds.length > 0) {
          const originals = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, paymentMethod: invoices.paymentMethod })
            .from(invoices)
            .where(sql`${invoices.id} IN (${sql.join(originalIds.map(id => sql`${id}`), sql`, `)})`);
          for (const orig of originals) {
            // map by creditNoteForId (the abono's FK pointing to original); una factura puede tener varios abonos
            for (const abonoRow of abonoRows.filter(r => r.creditNoteForId === orig.id)) {
              originalInvoiceMap[abonoRow.id] = orig.invoiceNumber;
              originalMethodMap[abonoRow.id] = orig.paymentMethod ?? null;
            }
          }
        }

        const enrichedRows = rows.map(r => ({
          ...r,
          // Si esta factura está abonada, el nº del abono emitido
          creditNoteNumber: r.status === "abonada" ? (creditNoteMap[r.id] ?? null) : null,
          // Si este documento ES un abono, el nº de la factura original que rectifica
          originalInvoiceNumber: r.invoiceType === "abono" ? (originalInvoiceMap[r.id] ?? null) : null,
          // Forma de pago que se muestra: la de la factura que rectifica el abono (el abono no guarda la suya) o «Abono»
          paymentMethodShown: r.invoiceType === "abono" ? (originalMethodMap[r.id] ?? "abono") : r.paymentMethod,
        }));

        const grossTotal = Number(grandTotal);
        const abonosAmt = Number(abonosTotal);

        return {
          items: enrichedRows,
          total,
          summary: {
            subtotal: Number(subtotalSum),
            tax: Number(taxSum),
            grandTotal: grossTotal,
            abonosTotal: abonosAmt,
            netTotal: grossTotal - abonosAmt,
          },
        };
      }),

    // --- Confirmar pago manual (transferencia / efectivo) ----------------------
    confirmManualPayment: staff
      .input(z.object({
        invoiceId: z.number(),
        paymentMethod: z.enum(["transferencia", "efectivo", "otro"]),
        transferProofUrl: z.string().refine(isAcceptableFileUrl, "URL no válida").optional(),
        transferProofKey: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        if (invoice.status === "cobrada") throw new TRPCError({ code: "BAD_REQUEST", message: "La factura ya está marcada como cobrada" });

        const now = new Date();
        await db.update(invoices).set({
          status: "cobrada",
          paymentMethod: input.paymentMethod,
          paymentValidatedBy: ctx.user.id,
          paymentValidatedAt: now,
          transferProofUrl: input.transferProofUrl ?? null,
          transferProofKey: input.transferProofKey ?? null,
          isAutomatic: false,
          updatedAt: now,
        }).where(eq(invoices.id, input.invoiceId));

        // Update linked reservation if exists
        if (invoice.reservationId) {
          await db.update(reservations).set({
            status: "paid",
            paymentMethod: input.paymentMethod,
            paymentValidatedBy: ctx.user.id,
            paymentValidatedAt: Date.now(),
            transferProofUrl: input.transferProofUrl ?? null,
            paidAt: Date.now(),
            updatedAt: Date.now(),
          }).where(eq(reservations.id, invoice.reservationId));
        }
        // Update linked quote if exists
        if (invoice.quoteId) {
          await db.update(quotes).set({
            status: "aceptado",
            paidAt: now,
            updatedAt: now,
          }).where(eq(quotes.id, invoice.quoteId));
        }

        // Send confirmation email to client
        try {
          const [linkedQuote] = invoice.quoteId
            ? await db.select().from(quotes).where(eq(quotes.id, invoice.quoteId))
            : [null];
          const [linkedLead] = linkedQuote?.leadId
            ? await db.select().from(leads).where(eq(leads.id, linkedQuote.leadId))
            : [null];
          if (invoice.clientEmail) {
            const reservationRef = invoice.invoiceNumber.replace("FAC", "RES");
            await sendConfirmationEmail({
              clientName: invoice.clientName ?? "Cliente",
              clientEmail: invoice.clientEmail,
              reservationRef,
              quoteTitle: invoice.invoiceNumber,
              total: Number(invoice.total).toFixed(2),
              items: (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
              invoiceUrl: invoice.pdfUrl ?? undefined,
            });
          }
        } catch (emailErr) {
          console.error("[confirmManualPayment] Email error:", emailErr);
        }

        await logActivity("invoice", invoice.id, "payment_confirmed_manual", ctx.user.id, ctx.user.name, {
          paymentMethod: input.paymentMethod,
          transferProofUrl: input.transferProofUrl,
          notes: input.notes,
        });
        // -- PARIDAD: Generar PDF de factura si no existe ya ----------------------
        const items = (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; productId?: number }[]) ?? [];
        let finalPdfUrl = invoice.pdfUrl ?? null;
        let finalPdfKey = invoice.pdfKey ?? null;
        // Regenerar si no hay URL o si apunta a /local-storage (archivo temporal ya perdido)
        if (!finalPdfUrl || finalPdfUrl.startsWith("/local-storage")) {
          try {
            const pdf = await generateInvoicePdf({
              invoiceNumber: invoice.invoiceNumber,
              clientName: invoice.clientName ?? "Cliente",
              clientEmail: invoice.clientEmail ?? undefined,
              clientPhone: invoice.clientPhone ?? undefined,
              itemsJson: items,
              subtotal: invoice.subtotal ?? "0",
              // El documento con su desglose y descuento guardados (no recalculado desde las líneas)
              discount: invoice.discount ?? null,
              discountReason: invoice.discountReason ?? null,
              taxRate: invoice.taxRate ?? "21",
              taxAmount: invoice.taxAmount ?? "0",
              taxBreakdown: invoice.taxBreakdown ?? undefined,
              total: invoice.total ?? "0",
              issuedAt: now,
            });
            finalPdfUrl = pdf.url;
            finalPdfKey = pdf.key;
            await db.update(invoices).set({ pdfUrl: finalPdfUrl, pdfKey: finalPdfKey, updatedAt: now }).where(eq(invoices.id, input.invoiceId));
            await logActivity("invoice", invoice.id, "pdf_generated", ctx.user.id, ctx.user.name, { pdfUrl: finalPdfUrl });
          } catch (pdfErr) {
            console.error("[confirmManualPayment] PDF generation failed:", pdfErr);
          }
        }

        // -- PARIDAD: Crear expediente REAV si hay líneas REAV ---------------------
        const reavLines = items.filter(i => i.fiscalRegime === "reav");
        let reavExpedientId: number | undefined;
        let reavExpedientNumber: string | undefined;
        if (reavLines.length > 0 && invoice.reservationId) {
          try {
            // Comprobar si ya existe un expediente REAV para esta reserva (evitar duplicados)
            const [existingReav] = await db.select({ id: reavExpedients.id })
              .from(reavExpedients)
              .where(eq(reavExpedients.reservationId, invoice.reservationId))
              .limit(1);
            if (!existingReav) {
              const reavSaleAmount = reavLines.reduce((s, i) => s + i.total, 0);
              let reavCostePct = 60;
              let reavMargenPct = 40;
              const firstReavLine = reavLines[0] as any;
              const reavProductId = firstReavLine?.productId;
              if (reavProductId) {
                const [reavProduct] = await db.select({
                  providerPercent: experiences.providerPercent,
                  agencyMarginPercent: experiences.agencyMarginPercent,
                  fiscalRegime: experiences.fiscalRegime,
                }).from(experiences).where(eq(experiences.id, reavProductId)).limit(1);
                if (reavProduct && reavProduct.fiscalRegime === "reav") {
                  const errores = validarConfiguracionREAV(reavProduct);
                  if (errores.length === 0) {
                    reavCostePct = parseFloat(String(reavProduct.providerPercent ?? 60));
                    reavMargenPct = parseFloat(String(reavProduct.agencyMarginPercent ?? 40));
                  } else {
                    console.warn("[confirmManualPayment] Configuración REAV inválida, usando fallback 60/40:", errores);
                  }
                }
              }
              const reavCalc = calcularREAVSimple(reavSaleAmount, reavCostePct, reavMargenPct);
              const [res] = await db.select().from(reservations).where(eq(reservations.id, invoice.reservationId));
              const serviceDate = res?.bookingDate ?? now.toISOString().split("T")[0];
              const reavResult = await createReavExpedient({
                invoiceId: invoice.id,
                reservationId: invoice.reservationId,
                quoteId: invoice.quoteId ?? undefined,
                serviceDescription: reavLines.map(i => i.description).join(" | "),
                serviceDate,
                numberOfPax: res?.people ?? 1,
                saleAmountTotal: String(reavSaleAmount),
                providerCostEstimated: String(reavCalc.costeProveedor),
                agencyMarginEstimated: String(reavCalc.margenAgencia),
                clientName: invoice.clientName ?? undefined,
                clientEmail: invoice.clientEmail ?? undefined,
                clientPhone: invoice.clientPhone ?? undefined,
                channel: "crm",
                sourceRef: invoice.invoiceNumber,
                internalNotes: [
                  `Expediente creado automáticamente al confirmar pago manual de la factura ${invoice.invoiceNumber}.`,
                  invoice.clientName ? `Cliente: ${invoice.clientName}` : null,
                  invoice.clientEmail ? `Email: ${invoice.clientEmail}` : null,
                  invoice.clientPhone ? `Teléfono: ${invoice.clientPhone}` : null,
                  `Importe REAV: ${reavSaleAmount.toFixed(2)}€`,
                  `Agente: ${ctx.user.name ?? ctx.user.email}`,
                ].filter(Boolean).join(" — "),
              });
              reavExpedientId = reavResult.id;
              reavExpedientNumber = reavResult.expedientNumber;
              // Adjuntar factura PDF al expediente
              if (finalPdfUrl && reavExpedientId) {
                await attachReavDocument({
                  expedientId: reavExpedientId,
                  side: "client",
                  docType: "factura_emitida",
                  title: `Factura ${invoice.invoiceNumber}`,
                  fileUrl: finalPdfUrl,
                  mimeType: "application/pdf",
                  notes: `Factura generada al confirmar pago manual. Método: ${input.paymentMethod}.`,
                  uploadedBy: ctx.user.id,
                });
              }
              // Adjuntar presupuesto PDF al expediente si existe
              const [linkedQuoteForReav] = invoice.quoteId
                ? await db.select().from(quotes).where(eq(quotes.id, invoice.quoteId))
                : [null];
              if (linkedQuoteForReav && (linkedQuoteForReav as any).pdfUrl && reavExpedientId) {
                await attachReavDocument({
                  expedientId: reavExpedientId,
                  side: "client",
                  docType: "otro",
                  title: `Presupuesto ${(linkedQuoteForReav as any).quoteNumber ?? invoice.quoteId}`,
                  fileUrl: (linkedQuoteForReav as any).pdfUrl,
                  mimeType: "application/pdf",
                  notes: `Presupuesto original aceptado por el cliente.`,
                  uploadedBy: ctx.user.id,
                });
              }
              await logActivity("invoice", invoice.id, "reav_expedient_created", ctx.user.id, ctx.user.name, { expedientId: reavExpedientId, expedientNumber: reavExpedientNumber });
            }
          } catch (reavErr) {
            console.error("[confirmManualPayment] Error al crear expediente REAV:", reavErr);
          }
        }

        // -- Crear booking operativo + transacción contable ------------------------
        if (invoice.reservationId) {
          try {
            const [res] = await db.select().from(reservations).where(eq(reservations.id, invoice.reservationId));
            if (res) {
              const generalSubtotalForTx = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
              const reavSubtotalForTx = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
              const taxAmountForTx = totalTaxAmount(groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav")));
              const fiscalRegimeForTx = reavSubtotalForTx > 0 && generalSubtotalForTx > 0 ? "mixed"
                : reavSubtotalForTx > 0 ? "reav" : "general";
              await postConfirmOperation({
                reservationId: res.id,
                productId: res.productId,
                productName: res.productName,
                serviceDate: res.bookingDate ?? now.toISOString().split("T")[0],
                people: res.people,
                amountCents: res.amountPaid ?? res.amountTotal,
                customerName: res.customerName,
                customerEmail: res.customerEmail ?? "",
                customerPhone: res.customerPhone,
                totalAmount: parseFloat(invoice.total ?? "0"),
                paymentMethod: input.paymentMethod as "transferencia" | "efectivo" | "otro",
                saleChannel: "admin",
                invoiceNumber: invoice.invoiceNumber,
                reservationRef: invoice.invoiceNumber.replace("FAC", "RES"),
                sellerUserId: ctx.user.id,
                sellerName: ctx.user.name ?? undefined,
                taxBase: generalSubtotalForTx,
                taxAmount: taxAmountForTx,
                reavMargin: reavSubtotalForTx,
                fiscalRegime: fiscalRegimeForTx,
                description: `Pago manual — ${invoice.invoiceNumber} — ${res.customerName}`,
                quoteId: invoice.quoteId ?? null,
                sourceChannel: input.paymentMethod as "transferencia" | "efectivo" | "otro",
              });
            }
          } catch (e) { console.error("[confirmManualPayment] Error en postConfirmOperation:", e); }
        }
        return { success: true, pdfUrl: finalPdfUrl, reavExpedientId, reavExpedientNumber };
      }),
    // --- Generar factura de abonono (rectificativa) ------------------------------
    createCreditNote: staff
      .input(z.object({
        invoiceId: z.number(),
        reason: z.string().trim().min(1, "Indica el motivo del abono"),
        ...creditNoteSelectionShape,
      }).refine((v) => !(v.partialAmount !== undefined && v.lines?.length), { message: "Abona por importe o por líneas, no ambas cosas", path: ["lines"] }))
      .mutation(async ({ input, ctx }) => {
        const done = await issueCreditNote(input);
        await logActivity("invoice", input.invoiceId, "credit_note_created", ctx.user.id, ctx.user.name, { creditNoteId: done.creditNoteId, creditNoteNumber: done.creditNoteNumber, reason: input.reason, amount: done.creditTotal });
        return { success: true, creditNoteId: done.creditNoteId, creditNoteNumber: done.creditNoteNumber };
      }),

    // --- Vista previa del abono (no emite nada ni consume numeración) ------------
    // Devuelve la factura, sus líneas con lo que queda por abonar de cada una, los abonos ya emitidos y el
    // abono que saldría con la selección dada (las mismas reglas que createCreditNote) o el motivo por el
    // que no se puede emitir.
    creditNotePreview: staff
      .input(z.object({ invoiceId: z.number(), ...creditNoteSelectionShape }))
      .query(async ({ input }) => {
        const [original] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
        if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Factura no encontrada" });
        const previous = await db.select().from(invoices)
          .where(and(eq(invoices.creditNoteForId, original.id), eq(invoices.invoiceType, "abono")))
          .orderBy(invoices.id);
        const credited = alreadyCredited(previous as any[]);
        const invoice = {
          id: original.id,
          invoiceNumber: original.invoiceNumber,
          clientName: original.clientName,
          issuedAt: original.issuedAt,
          status: original.status,
          total: round2(Number(original.total)),
          credited,
          remaining: round2(Math.max(0, Number(original.total) - credited)),
        };
        const lines = creditNoteLineStatus(original as any, previous as any[]);
        const previousNotes = previous.map((p) => ({ invoiceNumber: p.invoiceNumber, total: round2(Math.abs(Number(p.total))), reason: p.creditNoteReason ?? "", issuedAt: p.issuedAt }));
        let error: string | null = null;
        if (original.invoiceType === "abono") error = "No se puede abonar una factura de abono";
        else if (original.status === "anulada") error = "La factura ya está anulada";
        let preview: null | { subtotal: number; taxAmount: number; total: number; taxBreakdown: { rate: number; base: number; amount: number }[]; items: { description: string; quantity: number; total: number; taxRate?: number }[]; closesInvoice: boolean; remainingAfter: number } = null;
        if (!error) {
          try {
            const plan = planCreditNote(original as any, previous as any[], { partialAmount: input.partialAmount, lines: input.lines });
            const a = plan.amounts;
            preview = {
              subtotal: a.subtotal,
              taxAmount: a.taxAmount,
              total: a.total,
              taxBreakdown: a.taxBreakdown,
              items: a.items.map((i) => ({ description: i.description, quantity: i.quantity, total: i.total, ...(i.taxRate !== undefined ? { taxRate: i.taxRate } : {}) })),
              closesInvoice: plan.closesInvoice,
              remainingAfter: plan.remainingAfter,
            };
          } catch (e) {
            if (!(e instanceof CreditNoteSelectionError)) throw e;
            error = e.message;
          }
        }
        return { invoice, lines, previous: previousNotes, preview, error };
      }),

    // --- Reenviar factura por email --------------------------------------------
    resend: staff
      .input(z.object({
        invoiceId: z.number(),
        toEmail: z.string().email().optional(), // override recipient
      }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

        const COPY_EMAIL = await getBusinessEmail('reservations');
        const recipient = input.toEmail ?? invoice.clientEmail;
        const now = new Date();

        try {
          const isCredit = invoice.invoiceType === "abono";
          const subject = isCredit
            ? `Factura rectificativa ${invoice.invoiceNumber} — ${companyName()}`
            : `Tu factura ${invoice.invoiceNumber} — ${companyName()}`;
          // Abono: la factura que rectifica (número y fecha) y, sin PDF guardado, el enlace firmado a su documento
          const [rectified] = isCredit && invoice.creditNoteForId
            ? await db.select({ invoiceNumber: invoices.invoiceNumber, issuedAt: invoices.issuedAt }).from(invoices).where(eq(invoices.id, invoice.creditNoteForId)).limit(1)
            : [];
          const base = publicBaseUrl();
          const docUrl = invoice.pdfUrl ? externalFileUrl(invoice.pdfUrl) : isCredit && base ? `${base}${invoicePreviewPath(invoice.invoiceNumber)}` : null;

          const items = (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
          const htmlBody = buildInvoiceEmailHtml({
            clientName: invoice.clientName ?? "",
            invoiceNumber: invoice.invoiceNumber,
            isCreditNote: isCredit,
            items,
            subtotal: Number(invoice.subtotal),
            taxRate: invoice.taxRate ?? "",
            taxAmount: Number(invoice.taxAmount),
            total: Number(invoice.total),
            pdfUrl: docUrl,
            attached: !!invoice.pdfUrl,
            rectifies: rectified ?? null,
            reason: invoice.creditNoteReason ?? null,
            taxBreakdown: (invoice.taxBreakdown as { rate: number; base: number; amount: number }[] | null) ?? null,
          });

          // El PDF se adjunta al correo (Brevo lo descarga del CDN), para que el
          // cliente lo tenga aunque el enlace de descarga falle.
          const pdfAttachment = invoice.pdfUrl
            ? [{ name: `${invoice.invoiceNumber}.pdf`, url: invoice.pdfUrl }]
            : undefined;

          await sharedSendEmail({ to: recipient, subject, html: htmlBody, attachments: pdfAttachment });
          if (COPY_EMAIL) await sharedSendEmail({ to: COPY_EMAIL, subject: `[COPIA] ${subject}`, html: htmlBody, attachments: pdfAttachment });

          await db.update(invoices).set({
            status: invoice.status === "generada" ? "enviada" : invoice.status,
            sentAt: invoice.sentAt ?? now,
            lastSentAt: now,
            sentCount: (invoice.sentCount ?? 0) + 1,
            updatedAt: now,
          }).where(eq(invoices.id, input.invoiceId));

          await logActivity("invoice", invoice.id, "invoice_resent", ctx.user.id, ctx.user.name, { recipient });

          return { success: true, sentTo: recipient };
          } catch (e) {
          console.error("[Invoice Resend] Error:", e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al enviar el email" });
        }
      }),


    // --- Anular factura --------------------------------------------------------
    void: staff
      .input(z.object({ invoiceId: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        // Todas las facturas están emitidas (no hay borradores): anular una factura no se limita a cambiar
        // su estado, sino que emite un abono total (factura rectificativa) por lo pendiente de abonar. La
        // factura conserva su número y queda «abonada»; el abono toma el siguiente número de su serie.
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        if (invoice.invoiceType === "abono") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Un abono no se anula. Si es necesario, emite una nueva factura." });
        }
        if (["anulada", "abonada"].includes(invoice.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `La factura ya está ${invoice.status}` });
        }
        const reason = input.reason?.trim() || `Anulación de la factura ${invoice.invoiceNumber}`;
        const done = await issueCreditNote({ invoiceId: invoice.id, reason });
        await logActivity("invoice", invoice.id, "invoice_voided", ctx.user.id, ctx.user.name, { reason, creditNoteId: done.creditNoteId, creditNoteNumber: done.creditNoteNumber, amount: done.creditTotal });
        return { success: true, creditNoteId: done.creditNoteId, creditNoteNumber: done.creditNoteNumber };
      }),

    // --- Factura libre (sin venta, reserva, caja ni presupuesto) ---------------
    createDirect: staff
      .input(z.object({
        clientId: z.number().int().positive().optional(),
        client: z.object({
          name: z.string().trim().min(1, "Indica el nombre o la razón social del cliente").max(256),
          email: z.union([z.literal(""), z.string().trim().email("El correo electrónico no es válido").max(320)]).optional(),
          phone: z.string().trim().max(32).optional(),
          nif: z.string().trim().max(32).optional(),
          address: z.string().trim().max(1000).optional(),
        }).optional(),
        lines: z.array(z.object({
          description: z.string().trim().min(1, "Indica el concepto").max(500),
          quantity: z.number().positive("La cantidad debe ser mayor que cero").max(1_000_000),
          unitPrice: z.number().min(0, "El precio no puede ser negativo").max(10_000_000),
          taxRate: z.union([z.literal(21), z.literal(10), z.literal(4), z.literal(0)], { error: `Tipo de IVA no válido (${DIRECT_INVOICE_TAX_RATES.join(", ")} %)` }),
          // Con IVA al 0 %: motivo de la exención (figura en la factura)
          exemptionReason: z.string().trim().max(300).optional(),
        }).refine((l) => !needsExemptionReason(l), { message: "Con IVA al 0 % indica el motivo de la exención", path: ["exemptionReason"] })).min(1, "Añade al menos una línea").max(100, "Máximo 100 líneas por factura"),
        // true: los precios llevan el IVA incluido (como productos y presupuestos); false o sin indicar: sin IVA
        pricesIncludeTax: z.boolean().default(false),
      }).refine((v) => v.clientId !== undefined || v.client !== undefined, { message: "Elige un cliente o escribe sus datos", path: ["client"] }))
      .mutation(async ({ input, ctx }) => {
        // Cliente: uno existente de esta empresa o los datos escritos en la factura
        let client: { name: string; email: string; phone: string | null; nif: string | null; address: string | null };
        if (input.clientId !== undefined) {
          const [c] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
          if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "El cliente no existe" });
          client = { name: c.company || c.name, email: c.email ?? "", phone: c.phone || null, nif: c.nif || null, address: [c.address, c.postalCode, c.city].filter(Boolean).join(", ") || null };
        } else {
          const c = input.client!;
          client = { name: c.name, email: c.email ?? "", phone: c.phone || null, nif: c.nif || null, address: c.address || null };
        }
        const amounts = computeDirectInvoice(input.lines, { pricesIncludeTax: input.pricesIncludeTax });
        if (!(amounts.total > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "El total de la factura debe ser mayor que cero" });

        // Número de la serie oficial de facturas (mismo contador que el resto de facturas de la empresa)
        const invoiceNumber = await generateInvoiceNumber("crm:createDirect", String(ctx.user.id));
        const now = new Date();
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: client.name,
            clientEmail: client.email,
            clientPhone: client.phone,
            clientNif: client.nif,
            clientAddress: client.address,
            itemsJson: amounts.items,
            subtotal: amounts.subtotal.toFixed(2),
            taxRate: String(amounts.taxRate),
            taxAmount: amounts.taxAmount.toFixed(2),
            taxBreakdown: amounts.taxBreakdown,
            total: amounts.total.toFixed(2),
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("[createDirect] PDF generation failed:", e);
        }

        const [res] = await db.insert(invoices).values({
          issuerSnapshot: await issuerSnapshotForNewInvoice(),
          invoiceNumber,
          clientName: client.name,
          clientEmail: client.email,
          clientPhone: client.phone,
          clientNif: client.nif,
          clientAddress: client.address,
          itemsJson: amounts.items,
          subtotal: amounts.subtotal.toFixed(2),
          taxRate: String(amounts.taxRate),
          taxAmount: amounts.taxAmount.toFixed(2),
          taxBreakdown: amounts.taxBreakdown,
          total: amounts.total.toFixed(2),
          pdfUrl,
          pdfKey,
          status: "generada",
          invoiceType: "factura",
          paymentMethod: "otro",
          isAutomatic: false,
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (res as { insertId: number }).insertId;
        await logActivity("invoice", invoiceId, "invoice_created_direct", ctx.user.id, ctx.user.name, { invoiceNumber, total: amounts.total, clientId: input.clientId ?? null, pricesIncludeTax: input.pricesIncludeTax });
        return { success: true, invoiceId, invoiceNumber, total: amounts.total, pdfUrl };
      }),

    delete: staff
      .input(z.object({ invoiceId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        // Integridad fiscal: una factura emitida (todas lo están: no hay borradores) no se borra; se
        // anula o se rectifica con un abono, y el número de la serie queda consumido.
        await logActivity("invoice", invoice.id, "invoice_delete_refused", ctx.user.id, ctx.user.name, { invoiceNumber: invoice.invoiceNumber });
        throw new TRPCError({ code: "FORBIDDEN", message: "Las facturas emitidas no se pueden borrar: anúlala o emite un abono (factura rectificativa)." });
      }),
  }),

  // --- CLIENTS ----------------------------------------------------------------
  clients: router({
    list: staff.input(z.object({
      search: z.string().optional(),
      tagId: z.number().int().positive().optional(),
      type: z.enum(CLIENT_KINDS).optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    })).query(async ({ input }) => {
      const where = clientListConditions(input);
      const rows = await db.select().from(clients)
        .where(where)
        .orderBy(desc(clients.createdAt), desc(clients.id))
        .limit(input.limit)
        .offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(clients)
        .where(where);
      return { items: rows, total };
    }),
    stats: staff.query(() => clientStats()),
    // Aviso de duplicados antes del alta o al cambiar el correo o el NIF
    findDuplicates: staff.input(z.object({
      email: z.string().max(320).optional(),
      nif: z.string().max(64).optional(),
      excludeId: z.number().int().positive().optional(),
    })).query(({ input }) => findClientDuplicates(input)),
    notes: staff.input(z.object({ clientId: z.number().int().positive() })).query(({ input }) => listClientNotes(input.clientId)),
    addNote: staff.input(z.object({
      clientId: z.number().int().positive(),
      body: z.string().max(NOTE_MAX, `La nota no puede pasar de ${NOTE_MAX} caracteres.`),
    })).mutation(({ input, ctx }) => addClientNote(input.clientId, input.body, { id: ctx.user.id, name: ctx.user.name ?? null })),
    deleteNote: staff.input(z.object({ clientId: z.number().int().positive(), noteId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteClientNote(input.clientId, input.noteId);
        return { success: true };
      }),
    get: staff.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const [client] = await db.select().from(clients).where(eq(clients.id, input.id));
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      // Get associated quotes
      const clientQuotes = await db.select().from(quotes)
        .where(like(quotes.title, `%${client.name}%`))
        .orderBy(desc(quotes.createdAt)).limit(20);
      return { ...client, quotes: clientQuotes };
    }),
    create: staff.input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      company: z.string().optional(),
      nif: z.string().optional(),
      address: z.string().optional(),
      city: z.string().max(128).optional(),
      postalCode: z.string().max(16).optional(),
      country: z.string().max(64).optional(),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      // Cuota de contactos del plan (solo el alta manual: reservas, compras y formularios nunca se bloquean)
      await assertBusinessQuota("contacts", async () => Number((await db.select({ n: count() }).from(clients))[0]?.n ?? 0));
      try {
        const [result] = await db.execute(sql`
          INSERT INTO \`clients\` (\`name\`, \`email\`, \`phone\`, \`company\`, \`nif\`, \`address\`, \`city\`, \`postalCode\`, \`country\`, \`birthDate\`, \`notes\`, \`source\`)
          VALUES (${input.name}, ${input.email}, ${input.phone ?? ""}, ${input.company ?? ""}, ${input.nif ?? ""}, ${input.address ?? null}, ${input.city ?? ""}, ${input.postalCode ?? ""}, ${input.country || "ES"}, ${input.birthDate || null}, ${input.notes ?? null}, 'manual')
        `);
        return { id: (result as any).insertId };
      } catch (e: any) {
        const cause = e?.cause ?? e;
        if (cause?.code === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "CONFLICT", message: "Ya existe un cliente con ese email" });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause?.sqlMessage ?? cause?.message ?? e?.message ?? "Error al crear cliente",
        });
      }
    }),
    // Importar desde CSV: vista previa (no escribe nada) y confirmación con la misma huella
    importPreview: staff.input(z.object({ csv: clientCsvInput })).mutation(async ({ input }) => {
      return planImportOrThrow(input.csv, await loadClientsForImport());
    }),
    importApply: staff.input(z.object({
      csv: clientCsvInput,
      fingerprint: z.string().min(8).max(64),
      excludeLines: z.array(z.number().int().positive()).max(CLIENT_CSV_MAX_ROWS).default([]),
    })).mutation(async ({ input }) => {
      const plan = planImportOrThrow(input.csv, await loadClientsForImport());
      if (plan.fingerprint !== input.fingerprint) {
        throw new TRPCError({ code: "CONFLICT", message: "Los clientes han cambiado desde la vista previa. Revisa de nuevo el fichero antes de importarlo." });
      }
      return applyClientImport(plan, new Set(input.excludeLines));
    }),
    // Sin filtros, todos los clientes; con filtros, solo lo que se ve en el listado
    exportCsv: staff.input(z.object({
      search: z.string().optional(),
      tagId: z.number().int().positive().optional(),
      type: z.enum(CLIENT_KINDS).optional(),
    }).optional()).query(async ({ input }) => {
      const rows = input && (input.search?.trim() || input.tagId || input.type)
        ? await listFilteredClientsForExport(input)
        : await listClientsForExport();
      return { csv: toClientCsv(rows), count: rows.length };
    }),
    update: staff.input(z.object({
      id: z.number(),
      name: z.string().trim().min(1, "Indica el nombre del cliente.").max(256).optional(),
      email: z.string().trim().email("El correo electrónico no es válido (por ejemplo, nombre@empresa.com).").max(256).optional(),
      phone: z.string().max(64).optional(),
      company: z.string().max(256).optional(),
      nif: z.string().max(64).optional(),
      address: z.string().optional(),
      city: z.string().max(128).optional(),
      postalCode: z.string().max(16).optional(),
      country: z.string().max(64).optional(),
      birthDate: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;

      // Get current client to find its leadId for cascade
      const [current] = await db.select({ leadId: clients.leadId, nif: clients.nif, country: clients.country }).from(clients).where(eq(clients.id, id));
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "El cliente no existe" });
      // NIF, NIE o CIF español: solo se valida si cambia (fichas antiguas con otros formatos se respetan)
      const country = (data.country ?? current.country ?? "ES").trim().toUpperCase();
      if (data.nif !== undefined && data.nif.trim() && data.nif !== current.nif && (!country || country === "ES") && !isValidSpanishTaxId(data.nif)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El NIF, NIE o CIF no es válido. Revisa los números y la letra." });
      }

      try {
        await db.update(clients).set(data as any).where(eq(clients.id, id));
      } catch (e: any) {
        if ((e?.cause ?? e)?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe otro cliente con ese correo electrónico" });
        throw e;
      }

      // Propagate name/email/phone changes to lead, quotes and reservations
      if (current?.leadId) {
        const leadUpdate: Record<string, string> = {};
        if (data.name) leadUpdate.name = data.name;
        if (data.email) leadUpdate.email = data.email;
        if (data.phone !== undefined) leadUpdate.phone = data.phone as string;

        if (Object.keys(leadUpdate).length > 0) {
          await db.update(leads).set(leadUpdate as any).where(eq(leads.id, current.leadId));

          // Propagate to reservations linked through quotes
          const relatedQuotes = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.leadId, current.leadId));
          if (relatedQuotes.length > 0) {
            const qIds = relatedQuotes.map((q) => q.id);
            const resUpdate: Record<string, string> = {};
            if (data.name) resUpdate.customerName = data.name;
            if (data.email) resUpdate.customerEmail = data.email;
            if (data.phone !== undefined) resUpdate.customerPhone = data.phone as string;
            await db.update(reservations).set(resUpdate as any).where(inArray(reservations.quoteId, qIds));
          }
        }
      }

      return { success: true };
    }),
    // Ampliar datos del cliente cuando se convierte (presupuesto ? reserva)
    expand: staff.input(z.object({
      id: z.number(),
      nif: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      birthDate: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(clients)
        .set({ ...data as any, isConverted: true })
        .where(eq(clients.id, id));
      return { success: true };
    }),
    delete: staff.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.delete(clients).where(eq(clients.id, input.id));
      await deleteNotesOfClient(input.id);
      return { success: true };
    }),

    getHistory: staff.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const [client] = await db.select().from(clients).where(eq(clients.id, input.id));
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });

      // Lead vinculado
      const lead = client.leadId
        ? (await db.select().from(leads).where(eq(leads.id, client.leadId)))[0] ?? null
        : null;

      // Presupuestos vinculados al lead y a cualquier otra oportunidad con el correo del cliente
      // (cada presupuesto directo a un cliente crea o reutiliza una oportunidad con su correo)
      let clientQuotes: typeof quotes.$inferSelect[] = [];
      let resolvedLeadId = client.leadId;
      const quoteLeadIds = new Set<number>(client.leadId ? [client.leadId] : []);
      if (client.email) {
        const leadsByEmail = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, client.email)).orderBy(desc(leads.createdAt));
        for (const l of leadsByEmail) quoteLeadIds.add(l.id);
        if (!resolvedLeadId && leadsByEmail[0]) resolvedLeadId = leadsByEmail[0].id;
      }
      if (quoteLeadIds.size) {
        clientQuotes = await db.select().from(quotes)
          .where(inArray(quotes.leadId, Array.from(quoteLeadIds)))
          .orderBy(desc(quotes.createdAt));
      }

      const quoteIds = clientQuotes.map((q) => q.id);

      // Reservas, facturas, anulaciones en paralelo
      // Reservas: por quoteId, por email del cliente (cubre reservas directas sin presupuesto) o enlazadas al cliente
      // (ventas del TPV con el cliente elegido, aunque se cobraran con otro correo)
      const reservationCondition = or(
        eq(reservations.clientId, client.id),
        ...(quoteIds.length ? [inArray(reservations.quoteId, quoteIds)] : []),
        ...(client.email ? [eq(reservations.customerEmail, client.email)] : []),
      );

      // Reservas primero — necesitamos sus IDs para ampliar la búsqueda de facturas
      const clientReservations = await db.select().from(reservations).where(reservationCondition).orderBy(desc(reservations.createdAt));

      const reservationIds = clientReservations.map((r) => r.id);

      // Facturas: por quoteId (flujo CRM) OR por reservationId (flujo Redsys/TPV directo)
      // Las reservas online no pasan por presupuesto ? quoteId = null en la factura
      const invoiceConditions: ReturnType<typeof inArray>[] = [];
      if (quoteIds.length) invoiceConditions.push(inArray(invoices.quoteId, quoteIds));
      if (reservationIds.length) invoiceConditions.push(inArray(invoices.reservationId, reservationIds));
      // Facturas libres y del resto de canales emitidas a nombre del cliente (mismo correo o mismo NIF)
      if (client.email) invoiceConditions.push(eq(invoices.clientEmail, client.email) as ReturnType<typeof inArray>);
      if ((client.nif ?? "").trim().length >= 8) invoiceConditions.push(eq(invoices.clientNif, client.nif!.trim()) as ReturnType<typeof inArray>);

      // Condiciones de anulaciones: por quoteId O por reservationId (las creadas manualmente usan linkedReservationId)
      const cancellationConditions: ReturnType<typeof inArray>[] = [];
      if (quoteIds.length) cancellationConditions.push(inArray(cancellationRequests.linkedQuoteId, quoteIds));
      if (reservationIds.length) cancellationConditions.push(inArray(cancellationRequests.linkedReservationId, reservationIds));

      const [clientInvoices, clientCancellations] = await Promise.all([
        invoiceConditions.length
          ? db.select().from(invoices)
              .where(invoiceConditions.length === 1 ? invoiceConditions[0] : or(...invoiceConditions))
              .orderBy(desc(invoices.createdAt))
          : Promise.resolve([]),
        cancellationConditions.length
          ? db.select().from(cancellationRequests)
              .where(cancellationConditions.length === 1 ? cancellationConditions[0] : or(...cancellationConditions))
              .orderBy(desc(cancellationRequests.createdAt))
          : Promise.resolve([]),
      ]);

      // Deduplicar facturas por si aparecen por ambas condiciones (quoteId y reservationId)
      const seenInvoiceIds = new Set<number>();
      const dedupedInvoices = clientInvoices.filter((inv) => {
        if (seenInvoiceIds.has(inv.id)) return false;
        seenInvoiceIds.add(inv.id);
        return true;
      });

      // Usos de descuento vinculados a las reservas
      const clientDiscountUses = reservationIds.length
        ? await db.select().from(discountCodeUses).where(inArray(discountCodeUses.reservationId, reservationIds)).orderBy(desc(discountCodeUses.appliedAt))
        : [];

      // Activity log para todas las entidades relacionadas
      const invoiceIds = dedupedInvoices.map((i) => i.id);
      const leadIds = lead ? [lead.id] : [];

      const activityConditions = [];
      if (leadIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "lead"), inArray(crmActivityLog.entityId, leadIds)));
      if (quoteIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "quote"), inArray(crmActivityLog.entityId, quoteIds)));
      if (reservationIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "reservation"), inArray(crmActivityLog.entityId, reservationIds)));
      if (invoiceIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "invoice"), inArray(crmActivityLog.entityId, invoiceIds)));

      const activityLog = activityConditions.length
        ? await db.select().from(crmActivityLog)
            .where(or(...activityConditions))
            .orderBy(desc(crmActivityLog.createdAt))
            .limit(200)
        : [];

      // KPIs — totalSpentCents desde facturas activas (fuente de verdad del cobro real)
      const totalSpentCents = dedupedInvoices
        .filter((inv) => inv.status !== "anulada" && inv.status !== "abonada")
        .reduce((acc, inv) => acc + Math.round(parseFloat(inv.total ?? "0") * 100), 0);

      // -- Conversaciones WhatsApp (por teléfono o email) --------------------
      // GHL puede guardar teléfonos con o sin '+'; se normaliza eliminándolo en ambos lados.
      const waConditions: any[] = [];
      if (client.phone) {
        const normalizedPhone = client.phone.replace(/^\+/, "");
        waConditions.push(sql`REPLACE(${ghlConversations.phone}, '+', '') = ${normalizedPhone}`);
      }
      if (client.email) waConditions.push(eq(ghlConversations.email, client.email));
      const clientWhatsApp = waConditions.length
        ? await db.select({
            ghlConversationId: ghlConversations.ghlConversationId,
            customerName: ghlConversations.customerName,
            phone: ghlConversations.phone,
            lastMessagePreview: ghlConversations.lastMessagePreview,
            lastMessageAt: ghlConversations.lastMessageAt,
            status: ghlConversations.status,
            unreadCount: ghlConversations.unreadCount,
          }).from(ghlConversations)
            .where(waConditions.length === 1 ? waConditions[0] : or(...waConditions))
            .orderBy(desc(ghlConversations.lastMessageAt))
        : [];

      // -- Llamadas Vapi (por leadId, teléfono o email) ----------------------
      const vapiConditions: any[] = [];
      if (resolvedLeadId) vapiConditions.push(eq(vapiCalls.linkedLeadId, resolvedLeadId));
      if (client.phone) vapiConditions.push(eq(vapiCalls.phoneNumber, client.phone));
      if (client.email) vapiConditions.push(eq(vapiCalls.customerEmail, client.email));
      const rawVapiCalls = vapiConditions.length
        ? await db.select({
            id: vapiCalls.id,
            vapiCallId: vapiCalls.vapiCallId,
            phoneNumber: vapiCalls.phoneNumber,
            customerName: vapiCalls.customerName,
            startedAt: vapiCalls.startedAt,
            durationSeconds: vapiCalls.durationSeconds,
            status: vapiCalls.status,
            endedReason: vapiCalls.endedReason,
            summary: vapiCalls.summary,
            recordingUrl: vapiCalls.recordingUrl,
          }).from(vapiCalls)
            .where(vapiConditions.length === 1 ? vapiConditions[0] : or(...vapiConditions))
            .orderBy(desc(vapiCalls.startedAt))
        : [];
      // Deduplicar por vapiCallId
      const seenVapi = new Set<string>();
      const clientVapiCalls = rawVapiCalls.filter(c => {
        if (seenVapi.has(c.vapiCallId)) return false;
        seenVapi.add(c.vapiCallId);
        return true;
      });

      // Tickets de caja de sus pedidos y correos que se le han enviado
      const extras = await loadClientHistoryExtras(client, { reservationIds });

      return {
        client,
        lead,
        quotes: clientQuotes,
        reservations: clientReservations,
        invoices: dedupedInvoices,
        tpvTickets: extras.tpvTickets,
        emails: extras.emails,
        cancellations: clientCancellations,
        discountUses: clientDiscountUses,
        activityLog,
        whatsappConversations: clientWhatsApp,
        vapiCalls: clientVapiCalls,
        kpis: {
          totalQuotes: clientQuotes.length,
          totalReservations: clientReservations.length,
          totalInvoices: dedupedInvoices.length,
          totalCancellations: clientCancellations.length,
          totalSpentCents,
          paidReservations: clientReservations.filter((r) => r.status === "paid").length,
          totalWhatsApp: clientWhatsApp.length,
          totalVapiCalls: clientVapiCalls.length,
        },
      };
    }),
  }),

  // --- PRODUCTS SEARCH (para líneas de presupuesto) ----------------------------
  products: router({
    search: staff.input(z.object({
      q: z.string().optional(),
      limit: z.number().default(20),
      sourceType: z.enum(["all", "experience", "legoPack"]).default("all"),
    })).query(async ({ input }) => {
      const expConditions = input.q
        ? [or(like(experiences.title, `%${input.q}%`), like(experiences.shortDescription, `%${input.q}%`))]
        : [];
      const legoConditions = input.q
        ? [like(legoPacks.title, `%${input.q}%`)]
        : [];
      const fetchExp = input.sourceType === "all" || input.sourceType === "experience";
      const fetchLego = input.sourceType === "all" || input.sourceType === "legoPack";
      const [expRows, legoRows] = await Promise.all([
        fetchExp
          ? db.select({
              id: experiences.id,
              title: experiences.title,
              basePrice: experiences.basePrice,
              pricingType: experiences.pricingType,
              image: experiences.image1,
              coverImage: experiences.coverImageUrl,
              fiscalRegime: experiences.fiscalRegime,
              taxRate: experiences.taxRate,
              category: sql<string>`'experience'`,
              productType: sql<string>`'experience'`,
            }).from(experiences)
              .where(and(eq(experiences.isActive, true), ...(expConditions as any[])))
              .orderBy(experiences.title)
              .limit(input.limit)
          : Promise.resolve([]),
        fetchLego
          ? db.select({
              id: legoPacks.id,
              title: legoPacks.title,
              basePrice: sql<string>`'0'`,
              image: legoPacks.coverImageUrl,
              coverImage: legoPacks.coverImageUrl,
              fiscalRegime: sql<string>`'general'`,
              taxRate: sql<string>`'21'`,
              category: legoPacks.category,
              productType: sql<string>`'legoPack'`,
            }).from(legoPacks)
              .where(and(eq(legoPacks.isActive, true), ...(legoConditions as any[])))
              .orderBy(legoPacks.title)
              .limit(input.limit)
          : Promise.resolve([]),
      ]);

      // Attach variants to experience rows
      const expIds = (expRows as any[]).map((r: any) => r.id as number);
      const variantsByExpId: Record<number, any[]> = {};
      if (expIds.length > 0) {
        const varRows = await db.select({
          id: experienceVariants.id,
          experienceId: experienceVariants.experienceId,
          name: experienceVariants.name,
          description: experienceVariants.description,
          priceModifier: experienceVariants.priceModifier,
          priceType: experienceVariants.priceType,
          isRequired: experienceVariants.isRequired,
          sortOrder: experienceVariants.sortOrder,
        }).from(experienceVariants)
          .where(inArray(experienceVariants.experienceId, expIds))
          .orderBy(experienceVariants.sortOrder);
        for (const v of varRows) {
          if (!variantsByExpId[v.experienceId]) variantsByExpId[v.experienceId] = [];
          variantsByExpId[v.experienceId].push(v);
        }
      }
      return [
        ...(expRows as any[]).map((r: any) => ({ ...r, variants: variantsByExpId[r.id] ?? [] })),
        ...(legoRows as any[]),
      ];
    }),
  }),

  // --- PIPELINE (embudo comercial) ---
  pipeline: router({
    summary: staff.query(async () => {
      const [leadsData, quotesData, reservationsData] = await Promise.all([
        db.select({ cnt: count(), status: leads.opportunityStatus }).from(leads).groupBy(leads.opportunityStatus),
        db.select({ cnt: count(), status: quotes.status, total: sum(quotes.total) }).from(quotes).groupBy(quotes.status),
        db.select({ cnt: count(), total: sum(reservations.amountPaid) }).from(reservations).where(eq(reservations.status, "paid")),
      ]);

      return { leads: leadsData, quotes: quotesData, reservations: reservationsData };
    }),
  }),

  // --- PAGOS PENDIENTES ------------------------------------------------------
  pendingPayments: router({
    create: staff
      .input(z.object({
        quoteId: z.number(),
        reservationId: z.number().optional(),
        clientName: z.string(),
        clientEmail: z.string().optional(),
        clientPhone: z.string().optional(),
        productName: z.string(),
        amountCents: z.number(),
        dueDate: z.string(),
        reason: z.string(),
        origin: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const now = Date.now();

        // Si no se pasa reservationId, buscar una existente para este quote antes de crear una nueva
        let resolvedReservationId = input.reservationId;
        if (!resolvedReservationId) {
          // Reutilizar reserva existente no cancelada del mismo presupuesto
          const [existingRes] = await db.select({ id: reservations.id })
            .from(reservations)
            .where(and(eq(reservations.quoteId, input.quoteId), sql`${reservations.status} != 'cancelled'`))
            .orderBy(desc(reservations.createdAt))
            .limit(1);

          if (existingRes) {
            resolvedReservationId = existingRes.id;
          } else {
            // Solo crear placeholder si no hay ninguna reserva para este presupuesto
            const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
            const reservationRef = `PP-${Date.now().toString(36).toUpperCase()}`;
            const reservationNumberPP = await generateReservationNum("crm:pagoPendiente", String(ctx.user.id));
            const resProd = reservationProductFromQuoteItems(quote?.items);
            const [resResult] = await db.insert(reservations).values({
              productId: resProd.productId,
              productName: input.productName,
              extrasJson: resProd.extrasJson,
              bookingDate: resProd.mainServiceDate ?? new Date().toISOString().split("T")[0],
              people: 1,
              amountTotal: input.amountCents,
              amountPaid: 0,
              status: "pending_payment",
              statusReservation: "CONFIRMADA",
              statusPayment: "PENDIENTE",
              customerName: input.clientName,
              customerEmail: input.clientEmail,
              customerPhone: input.clientPhone,
              merchantOrder: reservationRef.substring(0, 12),
              reservationNumber: reservationNumberPP,
              channel: "ONLINE_ASISTIDO",
              quoteId: input.quoteId,
              quoteSource: "presupuesto",
              notes: `Pago pendiente desde presupuesto ${quote?.quoteNumber ?? input.quoteId}`,
              createdAt: now,
              updatedAt: now,
            });
            resolvedReservationId = (resResult as { insertId: number }).insertId;
          }
        }

        const [result] = await db.insert(pendingPayments).values({
          quoteId: input.quoteId,
          reservationId: resolvedReservationId,
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          clientPhone: input.clientPhone,
          productName: input.productName,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          reason: input.reason,
          status: "pending",
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        });
        const ppId = (result as { insertId: number }).insertId;
        if (input.clientEmail) {
          const legal = await getLegalCompanySettings();
          const dueDateFormatted = new Date(input.dueDate + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
          const html = buildPendingPaymentHtml({
            clientName: input.clientName,
            productName: input.productName,
            amountFormatted: (input.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €",
            dueDate: dueDateFormatted,
            ibanInfo: legal.iban ? `Banco: ${companyName()}\nIBAN: ${legal.iban}\nConcepto: Reserva ${input.productName}` : undefined,
            origin: input.origin ?? "",
          });
          await sendManagedEmail({
            templateKey: "pending_payment",
            triggerEvent: "pending_payment",
            recipientEmail: input.clientEmail,
            subject: `Reserva confirmada — Pago pendiente hasta el ${dueDateFormatted}`,
            html,
            relatedEntityType: "pending_payment",
            relatedEntityId: ppId,
            quoteId: input.quoteId,
          });
        }
        await logActivity("quote", input.quoteId, "pending_payment_created", ctx.user.id, ctx.user.name, { ppId, dueDate: input.dueDate, amountCents: input.amountCents });
        return { success: true, id: ppId };
      }),

    list: staff
      .input(z.object({
        status: z.enum(["pending", "paid", "cancelled", "incidentado"]).optional(),
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        const conditions = [];
        if (input.status) conditions.push(eq(pendingPayments.status, input.status));
        if (input.search) {
          conditions.push(or(
            like(pendingPayments.clientName, `%${input.search}%`),
            like(pendingPayments.clientEmail ?? "", `%${input.search}%`),
            like(pendingPayments.productName ?? "", `%${input.search}%`),
          ) as ReturnType<typeof and>);
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [items, [{ total }]] = await Promise.all([
          db.select().from(pendingPayments).where(whereClause).orderBy(desc(pendingPayments.createdAt)).limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(pendingPayments).where(whereClause),
        ]);
        const [kpis] = await db.select({ totalPending: count(), totalAmountCents: sum(pendingPayments.amountCents) }).from(pendingPayments).where(eq(pendingPayments.status, "pending"));
        return { items, total, kpis };
      }),

    confirm: staff
      .input(z.object({
        id: z.number(),
        paymentMethod: z.enum(["efectivo", "transferencia", "tarjeta_fisica"]),
        paymentNote: z.string().optional(),
        transferProofUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        if (pp.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Este pago ya no está pendiente" });
        await db.update(pendingPayments).set({
          status: "paid",
          paymentMethod: input.paymentMethod,
          paymentNote: input.paymentNote,
          transferProofUrl: input.transferProofUrl,
          paidAt: Date.now(),
          updatedAt: Date.now(),
        }).where(eq(pendingPayments.id, input.id));
        if (pp.reservationId) {
          // Obtener datos completos de la reserva para postConfirmOperation
          const [existingRes] = await db.select().from(reservations).where(eq(reservations.id, pp.reservationId));
          const legacyChannels = ["web", "crm", "telefono", "email", "otro", "tpv", "groupon", null, undefined];
          const currentChannel = existingRes?.channel;
          const channelToSet = legacyChannels.includes(currentChannel as string) ? "ONLINE_ASISTIDO" : currentChannel;

          // 1. Actualizar estado de la reserva
          await db.update(reservations).set({
            status: "paid",
            amountPaid: pp.amountCents,
            statusReservation: "CONFIRMADA",
            statusPayment: "PAGADO",
            channel: channelToSet as "ONLINE_ASISTIDO",
            paidAt: Date.now(),
            updatedAt: Date.now(),
          }).where(eq(reservations.id, pp.reservationId));

          // 2. Registrar transacción contable + booking operativo (igual que todos los demás flujos de cobro)
          try {
            await postConfirmOperation({
              reservationId: pp.reservationId,
              productId: existingRes?.productId ?? 0,
              productName: pp.productName ?? "Experiencia",
              serviceDate: existingRes?.bookingDate ?? new Date().toISOString().split("T")[0],
              people: existingRes?.people ?? 1,
              amountCents: pp.amountCents,
              customerName: pp.clientName,
              customerEmail: pp.clientEmail ?? "",  // postConfirmOperation requiere string
              customerPhone: pp.clientPhone ?? null,
              totalAmount: pp.amountCents / 100,
              paymentMethod: input.paymentMethod,
              saleChannel: "crm",
              quoteId: pp.quoteId ?? null,
              description: `Pago pendiente confirmado — ${pp.productName} — ${pp.clientName}`,
              sellerUserId: ctx.user.id,
              sellerName: ctx.user.name,
              // Este flujo hoy no envía ningún email de confirmación al cliente — gap real.
              sendConfirmationEmail: true,
            });
          } catch (e) {
            console.error("[pendingPayments.confirm] Error en postConfirmOperation:", e);
          }
        }
        // Generar factura si la reserva no tiene una aún
        if (pp.reservationId) {
          try {
            const [resForInv] = await db.select().from(reservations).where(eq(reservations.id, pp.reservationId));
            if (resForInv && !resForInv.invoiceId) {
              const now = new Date();
              const invoiceNumber = await generateInvoiceNumber("crm:pendingPayment", String(ctx.user.id));
              const amountEur = pp.amountCents / 100;
              const items = [{ description: pp.productName ?? resForInv.productName, quantity: resForInv.people, unitPrice: amountEur / resForInv.people, total: amountEur }];
              // Lo facturado es lo cobrado (IVA incluido): la base se extrae, no se suma el IVA encima.
              const amountsPp = chargedInvoiceAmounts(items, amountEur);
              const { subtotal, taxAmount, total } = amountsPp;
              const bdPp = amountsPp.taxBreakdown;
              const taxRatePp = amountsPp.taxRate;
              let pdfUrl: string | null = null;
              let pdfKey: string | null = null;
              try {
                const pdf = await generateInvoicePdf({ invoiceNumber, clientName: pp.clientName, clientEmail: pp.clientEmail ?? "", clientPhone: pp.clientPhone, itemsJson: items, subtotal: String(subtotal.toFixed(2)), taxRate: String(taxRatePp), taxAmount: String(taxAmount), taxBreakdown: bdPp, total: String(total.toFixed(2)), issuedAt: now });
                pdfUrl = pdf.url;
                pdfKey = pdf.key;
              } catch (pdfErr) {
                console.error("[pendingPayments.confirm] PDF generation failed:", pdfErr);
              }
              const [invRes] = await db.insert(invoices).values({ issuerSnapshot: await issuerSnapshotForNewInvoice(), invoiceNumber, reservationId: pp.reservationId, quoteId: pp.quoteId ?? null, clientName: pp.clientName, clientEmail: pp.clientEmail ?? "", clientPhone: pp.clientPhone, itemsJson: items, subtotal: String(subtotal.toFixed(2)), taxRate: String(taxRatePp), taxAmount: String(taxAmount), taxBreakdown: bdPp.length > 0 ? bdPp : undefined, total: String(total.toFixed(2)), pdfUrl, pdfKey, isAutomatic: true, status: "cobrada", paymentMethod: input.paymentMethod as any, issuedAt: now, createdAt: now, updatedAt: now });
              const invoiceId = (invRes as { insertId: number }).insertId;
              await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() } as any).where(eq(reservations.id, pp.reservationId));
              console.log(`[pendingPayments.confirm] Factura ${invoiceNumber} generada para reserva ${pp.reservationId}`);

              // Crear expediente REAV si el producto tiene régimen REAV
              try {
                const productId = resForInv.productId;
                if (productId && productId > 0) {
                  const [prod] = await db.select({
                    fiscalRegime: experiences.fiscalRegime,
                    providerPercent: experiences.providerPercent,
                    agencyMarginPercent: experiences.agencyMarginPercent,
                  }).from(experiences).where(eq(experiences.id, productId)).limit(1);

                  if (prod?.fiscalRegime === "reav") {
                    const reavErrors = validarConfiguracionREAV(prod);
                    const costePct = reavErrors.length === 0 ? parseFloat(String(prod.providerPercent)) : 0;
                    const margenPct = reavErrors.length === 0 ? parseFloat(String(prod.agencyMarginPercent)) : 0;
                    const calc = calcularREAVSimple(amountEur, costePct, margenPct);
                    const reavResult = await createReavExpedient({
                      invoiceId,
                      reservationId: pp.reservationId!,
                      quoteId: pp.quoteId ?? undefined,
                      serviceDescription: resForInv.productName,
                      serviceDate: resForInv.bookingDate,
                      numberOfPax: resForInv.people,
                      saleAmountTotal: String(amountEur.toFixed(2)),
                      providerCostEstimated: String(calc.costeProveedor.toFixed(2)),
                      agencyMarginEstimated: String(calc.margenAgencia.toFixed(2)),
                      clientName: pp.clientName,
                      clientEmail: pp.clientEmail ?? undefined,
                      clientPhone: pp.clientPhone ?? undefined,
                      channel: "crm",
                      sourceRef: invoiceNumber,
                      internalNotes: [
                        `Expediente creado automáticamente al confirmar pago pendiente.`,
                        `Cliente: ${pp.clientName}`,
                        pp.clientEmail ? `Email: ${pp.clientEmail}` : null,
                        `Factura: ${invoiceNumber}`,
                        `Agente: ${ctx.user.name ?? ctx.user.email}`,
                        reavErrors.length > 0 ? `? Config REAV incompleta — revisar producto ${productId}` : null,
                      ].filter(Boolean).join(" — "),
                    });
                    if (pdfUrl && reavResult?.id) {
                      await attachReavDocument({
                        expedientId: reavResult.id,
                        side: "client",
                        docType: "factura_emitida",
                        title: `Factura ${invoiceNumber}`,
                        fileUrl: pdfUrl,
                        mimeType: "application/pdf",
                        notes: `Generada al confirmar pago pendiente.`,
                        uploadedBy: ctx.user.id,
                      });
                    }
                    console.log(`[pendingPayments.confirm] Expediente REAV ${reavResult?.expedientNumber} creado para reserva ${pp.reservationId}`);
                  }
                }
              } catch (reavErr) {
                console.error("[pendingPayments.confirm] Error creando expediente REAV:", reavErr);
              }
            }
          } catch (invErr) {
            console.error("[pendingPayments.confirm] Error generando factura:", invErr);
          }
        }

        await logActivity("quote", pp.quoteId, "pending_payment_confirmed", ctx.user.id, ctx.user.name, { ppId: input.id, method: input.paymentMethod });
        return { success: true };
      }),

    cancel: staff
      .input(z.object({
        id: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        await db.update(pendingPayments).set({ status: "cancelled", paymentNote: input.reason, updatedAt: Date.now() }).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_cancelled", ctx.user.id, ctx.user.name, { ppId: input.id });
        return { success: true };
      }),

    resendReminder: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        if (!pp.clientEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "El cliente no tiene email registrado" });
        const legal = await getLegalCompanySettings();
        const dueDateFormatted = new Date(pp.dueDate + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
        const html = buildPendingPaymentReminderHtml({
          clientName: pp.clientName,
          productName: pp.productName ?? `Actividad ${companyName()}`,
          amountFormatted: (pp.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €",
          dueDate: dueDateFormatted,
          ibanInfo: legal.iban ? `Banco: ${companyName()}\nIBAN: ${legal.iban}\nConcepto: Reserva ${pp.productName}` : undefined,
          origin: "",
        });
        await sendManagedEmail({
          templateKey: "pending_payment_reminder",
          triggerEvent: "pending_payment_reminder",
          recipientEmail: pp.clientEmail,
          subject: `Recordatorio urgente: pago pendiente hasta el ${dueDateFormatted}`,
          html,
          relatedEntityType: "pending_payment",
          relatedEntityId: input.id,
          quoteId: pp.quoteId,
        });
        await db.update(pendingPayments).set({ reminderSentAt: Date.now(), updatedAt: Date.now() }).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_reminder_sent", ctx.user.id, ctx.user.name, { ppId: input.id });
        return { success: true };
      }),

    markIncident: staff
      .input(z.object({
        id: z.number(),
        note: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        await db.update(pendingPayments).set({ status: "incidentado", paymentNote: input.note, updatedAt: Date.now() }).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_incident", ctx.user.id, ctx.user.name, { ppId: input.id, note: input.note });
        return { success: true };
      }),

    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        await db.delete(pendingPayments).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_deleted", ctx.user.id, ctx.user.name, { ppId: input.id });
        return { success: true };
      }),
  }),

  // --- CATALOG SEARCH (autocomplete en líneas de presupuesto) ------------------
  catalog: router({
    search: staff
      .input(z.object({ q: z.string().min(1) }))
      .query(async ({ input }) => {
        const term = `%${input.q}%`;
        // Buscar en experiences
        const expRows = await db
          .select({
            id: experiences.id,
            title: experiences.title,
            basePrice: experiences.basePrice,
            fiscalRegime: experiences.fiscalRegime,
          })
          .from(experiences)
          .where(and(eq(experiences.isActive, true), like(experiences.title, term)))
          .limit(8);
        // Buscar en packs
        const packRows = await db
          .select({
            id: packs.id,
            title: packs.title,
            basePrice: packs.basePrice,
            fiscalRegime: packs.fiscalRegime,
          })
          .from(packs)
          .where(like(packs.title, term))
          .limit(6);
        // Buscar en legoPacks (sin basePrice — precio 0 por defecto, se edita manualmente)
        const legoRows = await db
          .select({
            id: legoPacks.id,
            title: legoPacks.title,
            priceLabel: legoPacks.priceLabel,
          })
          .from(legoPacks)
          .where(and(eq(legoPacks.isActive, true), like(legoPacks.title, term)))
          .limit(6);
        const results = [
          ...expRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: parseFloat(String(r.basePrice ?? "0")),
            fiscalRegime: (r.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
            type: "experience" as const,
          })),
          ...packRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: parseFloat(String(r.basePrice ?? "0")),
            fiscalRegime: (r.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
            type: "pack" as const,
          })),
          ...legoRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: 0,
            fiscalRegime: "general" as "reav" | "general",
            type: "legopack" as const,
          })),
        ];
        return { results };
      }),
  }),
});
