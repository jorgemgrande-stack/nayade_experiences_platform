/**
 * quoteService.ts — Lógica compartida de creación de presupuestos.
 * Usada por crm.ts (createDirect) y partners.ts (partner landing).
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc, sql } from "drizzle-orm";
import { leads, quotes, clients } from "../../drizzle/schema";
import { generateDocumentNumber } from "../documentNumbers";
import { groupTaxBreakdown, totalTaxAmount } from "../taxUtils";
import { buildQuoteHtml } from "../emailTemplates";
import { sendEmail as sharedSendEmail } from "../mailer";
import { logActivity } from "../db";
import { getSystemSettingSync } from "../config";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(_pool);

async function sendEmailWithCopy(to: string, subject: string, html: string) {
  const sent = await sharedSendEmail({ to, subject, html });
  if (!sent) { console.warn("[quoteService] SMTP no configurado, email omitido"); return; }
  const copy = getSystemSettingSync("email_copy_recipient", "");
  if (copy) await sharedSendEmail({ to: copy, subject: `[COPIA] ${subject}`, html });
}

export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  fiscalRegime?: "reav" | "general";
  taxRate?: number;
  productId?: number;
}

export interface CreateQuoteInput {
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  clientCompany?: string;
  title: string;
  description?: string;
  items: QuoteItem[];
  subtotal: number;
  discount: number;
  total: number;
  validUntil?: string;
  notes?: string;
  conditions?: string;
  sendNow?: boolean;
  origin?: string;
  /** 0 = sistema/partner sin agente humano */
  agentId: number;
  source?: string;
  partnerId?: number;
}

export async function createQuote(input: CreateQuoteInput): Promise<{
  success: true;
  quoteId: number;
  quoteNumber: string;
  leadId: number;
  sent: boolean;
  paymentLinkUrl?: string;
}> {
  const source = input.source ?? "presupuesto_directo";

  // 1. Buscar o crear lead por email
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
    const [leadResult] = await db.insert(leads).values({
      name: input.clientName,
      email: input.clientEmail,
      phone: input.clientPhone ?? "",
      company: input.clientCompany ?? "",
      source,
      status: "en_proceso",
      opportunityStatus: "nueva",
      priority: "media",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    leadId = (leadResult as { insertId: number }).insertId;
    await logActivity("lead", leadId, "lead_created_from_quote", null, null, {
      name: input.clientName,
      source,
      ...(input.partnerId != null && { partnerId: input.partnerId }),
    });
  }

  // 2. Upsert cliente (no falla si hay error de unicidad)
  try {
    await db.insert(clients).values({
      leadId,
      source,
      name: input.clientName,
      email: input.clientEmail,
      phone: input.clientPhone ?? "",
      company: input.clientCompany ?? "",
      tags: [],
      isConverted: false,
      totalBookings: 0,
    }).onDuplicateKeyUpdate({
      set: {
        leadId,
        name: sql`IF(TRIM(${clients.name}) = '' OR ${clients.name} IS NULL, ${input.clientName}, ${clients.name})`,
        phone: sql`IF(TRIM(${clients.phone}) = '' OR ${clients.phone} IS NULL, ${input.clientPhone ?? ""}, ${clients.phone})`,
        company: sql`IF(TRIM(${clients.company}) = '' OR ${clients.company} IS NULL, ${input.clientCompany ?? ""}, ${clients.company})`,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    console.warn("[quoteService] No se pudo crear/vincular cliente:", e);
  }

  // 3. Calcular IVA extrayéndolo del precio (IVA incluido en base)
  const breakdown = groupTaxBreakdown(input.items.filter(i => i.fiscalRegime !== "reav"));
  const taxAmount = totalTaxAmount(breakdown);

  const context = input.partnerId != null ? "partners:createQuote" : "service:createQuote";
  const quoteNumber = await generateDocumentNumber("presupuesto", context, String(input.agentId));

  const [quoteResult] = await db.insert(quotes).values({
    quoteNumber,
    leadId,
    agentId: input.agentId,
    title: input.title,
    description: input.description,
    items: input.items,
    subtotal: String(input.subtotal),
    discount: String(input.discount),
    tax: String(taxAmount),
    total: String(input.total),
    validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    notes: input.notes,
    conditions: input.conditions,
    status: "borrador",
    ...(input.partnerId != null && { partnerId: input.partnerId }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const quoteId = (quoteResult as { insertId: number }).insertId;

  await logActivity("quote", quoteId, "quote_created", null, null, {
    leadId,
    quoteNumber,
    ...(input.partnerId != null && { partnerId: input.partnerId }),
  });

  // 4. Enviar si sendNow=true
  let sent = false;
  let paymentLinkUrl: string | undefined;

  if (input.sendNow) {
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const origin = input.origin ?? "https://www.nayadeexperiences.es";
    paymentLinkUrl = `${origin}/presupuesto/${token}`;

    await db.update(quotes).set({
      status: "enviado",
      sentAt: new Date(),
      paymentLinkToken: token,
      paymentLinkUrl,
      updatedAt: new Date(),
    }).where(eq(quotes.id, quoteId));

    await db.update(leads).set({
      opportunityStatus: "enviada",
      status: "contactado",
      lastContactAt: new Date(),
      seenAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(leads.id, leadId));

    const html = buildQuoteHtml({
      quoteNumber,
      title: input.title,
      clientName: input.clientName,
      items: input.items,
      subtotal: String(input.subtotal),
      discount: String(input.discount),
      tax: String(taxAmount),
      total: String(input.total),
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      notes: input.notes ?? undefined,
      conditions: input.conditions ?? undefined,
      paymentLinkUrl,
    });

    await sendEmailWithCopy(
      input.clientEmail,
      `Tu propuesta de Náyade Experiences — ${quoteNumber}`,
      html,
    );

    await logActivity("quote", quoteId, "quote_sent", null, null, {
      email: input.clientEmail,
      paymentLinkUrl,
      ...(input.partnerId != null && { partnerId: input.partnerId }),
    });

    sent = true;
  }

  return { success: true, quoteId, quoteNumber, leadId, sent, paymentLinkUrl };
}
