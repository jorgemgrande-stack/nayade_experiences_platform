/**
 * Proposals Router — Nayade Experiences
 * Módulo Propuestas Comerciales: pre-presupuesto configurable o multi-opción.
 * Flujo: Lead → Propuesta → (cliente acepta) → Presupuesto → Reserva → Factura
 */
import { router, staffProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { proposals, proposalOptions, leads, quotes } from "../../drizzle/schema";
import { eq, desc, and, gte, lte, inArray, like, or, count } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { generateDocumentNumber } from "../documentNumbers";
import { buildProposalHtml } from "../emailTemplates";
import { getSystemSettingSync, getBusinessEmail } from "../config";
import { logActivity } from "../db";
import { groupTaxBreakdown, totalTaxAmount } from "../taxUtils";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

async function sendEmail(args: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!args.to) { console.warn("[proposals] Lead sin email, no se puede enviar"); return false; }
  const sent = await sharedSendEmail(args);
  if (!sent) { console.warn("[proposals] SMTP/Brevo no configurado, email omitido"); return false; }
  const copyEmail = getSystemSettingSync("email_copy_recipient", "");
  if (copyEmail) await sharedSendEmail({ to: copyEmail, subject: `[COPIA] ${args.subject}`, html: args.html });
  return true;
}

async function generateProposalNumber(userId?: string): Promise<string> {
  return generateDocumentNumber("propuesta", "proposals:create", userId ?? "system");
}

// ─── Item schema (shared between configurable & options) ──────────────────────
const proposalItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  fiscalRegime: z.enum(["reav", "general"]).optional(),
  taxRate: z.number().optional(),
  isOptional: z.boolean().optional(),
  productId: z.number().int().optional(),
});

const proposalOptionSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  items: z.array(proposalItemSchema).default([]),
  subtotal: z.number().nonnegative().default(0),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  total: z.number().nonnegative().default(0),
  isRecommended: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const proposalsRouter = router({

  // ── list ──────────────────────────────────────────────────────────────────
  list: staffProcedure
    .input(z.object({
      leadId: z.number().int().optional(),
      status: z.enum(["borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado"]).optional(),
      search: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.leadId) conditions.push(eq(proposals.leadId, input.leadId));
      if (input.status) conditions.push(eq(proposals.status, input.status));
      if (input.from) conditions.push(gte(proposals.createdAt, new Date(input.from)));
      if (input.to) conditions.push(lte(proposals.createdAt, new Date(input.to)));
      if (input.search) {
        const s = `%${input.search}%`;
        conditions.push(or(like(proposals.proposalNumber, s), like(proposals.title, s), like(leads.name, s), like(leads.email, s)));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: proposals.id,
          proposalNumber: proposals.proposalNumber,
          leadId: proposals.leadId,
          title: proposals.title,
          mode: proposals.mode,
          status: proposals.status,
          total: proposals.total,
          sentAt: proposals.sentAt,
          createdAt: proposals.createdAt,
          convertedToQuoteId: proposals.convertedToQuoteId,
          publicUrl: proposals.publicUrl,
          leadName: leads.name,
          leadEmail: leads.email,
        }).from(proposals)
          .leftJoin(leads, eq(leads.id, proposals.leadId))
          .where(where)
          .orderBy(desc(proposals.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(proposals)
          .leftJoin(leads, eq(leads.id, proposals.leadId))
          .where(where),
      ]);
      return { rows, total };
    }),

  // ── getById ───────────────────────────────────────────────────────────────
  getById: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [proposal] = await db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      const options = await db.select().from(proposalOptions)
        .where(eq(proposalOptions.proposalId, input.id))
        .orderBy(proposalOptions.sortOrder);
      return { ...proposal, options };
    }),

  // ── getByLeadId ───────────────────────────────────────────────────────────
  getByLeadId: staffProcedure
    .input(z.object({ leadId: z.number().int() }))
    .query(async ({ input }) => {
      return db.select().from(proposals)
        .where(eq(proposals.leadId, input.leadId))
        .orderBy(desc(proposals.createdAt));
    }),

  // ── create ────────────────────────────────────────────────────────────────
  create: staffProcedure
    .input(z.object({
      leadId: z.number().int(),
      title: z.string().min(1),
      description: z.string().optional(),
      mode: z.enum(["configurable", "multi_option"]).default("configurable"),
      items: z.array(proposalItemSchema).default([]),
      subtotal: z.number().nonnegative().default(0),
      discount: z.number().nonnegative().default(0),
      tax: z.number().nonnegative().default(0),
      total: z.number().nonnegative().default(0),
      currency: z.string().default("EUR"),
      validUntil: z.string().optional(),
      conditions: z.string().optional(),
      notes: z.string().optional(),
      options: z.array(proposalOptionSchema).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const agentId = (ctx.user as { id: number }).id;
      const proposalNumber = await generateProposalNumber(String(agentId));

      const [result] = await db.insert(proposals).values({
        proposalNumber,
        leadId: input.leadId,
        agentId,
        title: input.title,
        description: input.description,
        mode: input.mode,
        items: input.items,
        subtotal: String(input.subtotal),
        discount: String(input.discount),
        tax: String(input.tax),
        total: String(input.total),
        currency: input.currency,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        conditions: input.conditions,
        notes: input.notes,
        status: "borrador",
      });

      const proposalId = (result as unknown as { insertId: number }).insertId;

      // Insert options for multi_option mode
      if (input.mode === "multi_option" && input.options?.length) {
        for (const opt of input.options) {
          await db.insert(proposalOptions).values({
            proposalId,
            title: opt.title,
            description: opt.description,
            items: opt.items,
            subtotal: String(opt.subtotal),
            discount: String(opt.discount),
            tax: String(opt.tax),
            total: String(opt.total),
            isRecommended: opt.isRecommended,
            sortOrder: opt.sortOrder,
          });
        }
      }

      await logActivity("lead", input.leadId, "proposal_created", agentId, String(agentId), { proposalNumber, proposalId });

      return { proposalId, proposalNumber };
    }),

  // ── update ────────────────────────────────────────────────────────────────
  update: staffProcedure
    .input(z.object({
      id: z.number().int(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      items: z.array(proposalItemSchema).optional(),
      subtotal: z.number().nonnegative().optional(),
      discount: z.number().nonnegative().optional(),
      tax: z.number().nonnegative().optional(),
      total: z.number().nonnegative().optional(),
      validUntil: z.string().nullable().optional(),
      conditions: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado"]).optional(),
      options: z.array(proposalOptionSchema).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, options, ...fields } = input;
      const agentId = (ctx.user as { id: number }).id;

      const updates: Record<string, unknown> = {};
      if (fields.title !== undefined) updates.title = fields.title;
      if (fields.description !== undefined) updates.description = fields.description;
      if (fields.items !== undefined) updates.items = fields.items;
      if (fields.subtotal !== undefined) updates.subtotal = String(fields.subtotal);
      if (fields.discount !== undefined) updates.discount = String(fields.discount);
      if (fields.tax !== undefined) updates.tax = String(fields.tax);
      if (fields.total !== undefined) updates.total = String(fields.total);
      if (fields.validUntil !== undefined) updates.validUntil = fields.validUntil ? new Date(fields.validUntil) : null;
      if (fields.conditions !== undefined) updates.conditions = fields.conditions;
      if (fields.notes !== undefined) updates.notes = fields.notes;
      if (fields.status !== undefined) updates.status = fields.status;

      if (Object.keys(updates).length) {
        await db.update(proposals).set(updates).where(eq(proposals.id, id));
      }

      // Replace options if provided
      if (options !== undefined) {
        await db.delete(proposalOptions).where(eq(proposalOptions.proposalId, id));
        for (const opt of options) {
          await db.insert(proposalOptions).values({
            proposalId: id,
            title: opt.title,
            description: opt.description,
            items: opt.items,
            subtotal: String(opt.subtotal),
            discount: String(opt.discount),
            tax: String(opt.tax),
            total: String(opt.total),
            isRecommended: opt.isRecommended,
            sortOrder: opt.sortOrder,
          });
        }
      }

      await logActivity("lead", id, "proposal_updated", agentId, String(agentId), { proposalId: id });
      return { success: true };
    }),

  // ── send ──────────────────────────────────────────────────────────────────
  send: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const agentId = (ctx.user as { id: number }).id;
      const [proposal] = await db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });

      const [lead] = await db.select().from(leads).where(eq(leads.id, proposal.leadId)).limit(1);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });

      // Generate token if not yet set
      const { randomBytes } = await import("crypto");
      const token = proposal.token ?? randomBytes(32).toString("hex");
      const origin = process.env.VITE_OAUTH_PORTAL_URL ?? "https://www.nayadeexperiences.es";
      const publicUrl = `${origin}/propuesta/${token}`;

      // Fetch options for multi_option
      const opts = proposal.mode === "multi_option"
        ? await db.select().from(proposalOptions).where(eq(proposalOptions.proposalId, input.id)).orderBy(proposalOptions.sortOrder)
        : [];

      const html = buildProposalHtml({
        proposalNumber: proposal.proposalNumber,
        title: proposal.title,
        clientName: lead.name,
        mode: proposal.mode,
        items: (proposal.items as { description: string; quantity: number; unitPrice: number; total: number; isOptional?: boolean }[]) ?? [],
        subtotal: proposal.subtotal ?? "0",
        discount: proposal.discount ?? "0",
        tax: proposal.tax ?? "0",
        total: proposal.total ?? "0",
        options: opts.map(o => ({
          title: o.title,
          description: o.description ?? undefined,
          items: (o.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: o.subtotal ?? "0",
          tax: o.tax ?? "0",
          total: o.total ?? "0",
          isRecommended: o.isRecommended,
        })),
        validUntil: proposal.validUntil ?? undefined,
        notes: proposal.notes ?? undefined,
        conditions: proposal.conditions ?? undefined,
        publicUrl,
      });

      const emailSent = await sendEmail({
        to: lead.email,
        subject: `Tu Propuesta Comercial — ${proposal.proposalNumber} · Náyade Experiences`,
        html,
      });

      await db.update(proposals).set({
        token,
        publicUrl,
        status: "enviado",
        sentAt: new Date(),
      }).where(eq(proposals.id, input.id));

      await logActivity("lead", proposal.leadId, "proposal_sent", agentId, String(agentId), { proposalNumber: proposal.proposalNumber, to: lead.email, emailSent });

      return { success: true, publicUrl, token, emailSent, clientEmail: lead.email };
    }),

  // ── generateLink (genera token/URL sin enviar email) ─────────────────────
  generateLink: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const [proposal] = await db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      if (proposal.publicUrl) return { publicUrl: proposal.publicUrl, token: proposal.token! };
      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const origin = process.env.VITE_OAUTH_PORTAL_URL ?? "https://www.nayadeexperiences.es";
      const publicUrl = `${origin}/propuesta/${token}`;
      await db.update(proposals).set({ token, publicUrl }).where(eq(proposals.id, input.id));
      return { publicUrl, token };
    }),

  // ── delete ────────────────────────────────────────────────────────────────
  delete: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const agentId = (ctx.user as { id: number }).id;
      const [proposal] = await db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      if (proposal.status !== "borrador") throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden eliminar propuestas en borrador" });

      await db.delete(proposalOptions).where(eq(proposalOptions.proposalId, input.id));
      await db.delete(proposals).where(eq(proposals.id, input.id));
      await logActivity("lead", proposal.leadId, "proposal_deleted", agentId, String(agentId), { proposalNumber: proposal.proposalNumber });
      return { success: true };
    }),

  // ── bulkDelete ────────────────────────────────────────────────────────────
  bulkDelete: staffProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1) }))
    .mutation(async ({ input }) => {
      const rows = await db.select({ id: proposals.id, status: proposals.status }).from(proposals).where(inArray(proposals.id, input.ids));
      const deletable = rows.filter(r => r.status === "borrador").map(r => r.id);
      const skipped = input.ids.length - deletable.length;
      if (deletable.length > 0) {
        await db.delete(proposalOptions).where(inArray(proposalOptions.proposalId, deletable));
        await db.delete(proposals).where(inArray(proposals.id, deletable));
      }
      return { deleted: deletable.length, skipped };
    }),

  // ── bulkUpdateStatus ──────────────────────────────────────────────────────
  bulkUpdateStatus: staffProcedure
    .input(z.object({
      ids: z.array(z.number().int()).min(1),
      status: z.enum(["borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado"]),
    }))
    .mutation(async ({ input }) => {
      await db.update(proposals).set({ status: input.status }).where(inArray(proposals.id, input.ids));
      return { updated: input.ids.length };
    }),

  // ── convertToQuote ────────────────────────────────────────────────────────
  convertToQuote: staffProcedure
    .input(z.object({
      id: z.number().int(),
      selectedOptionId: z.number().int().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const agentId = (ctx.user as { id: number }).id;
      const [proposal] = await db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });

      type QuoteItem = { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; taxRate?: number; productId?: number };
      // Resolve items: if multi_option, use selected option's items
      let items = (proposal.items as QuoteItem[]) ?? [];
      let subtotal = proposal.subtotal ?? "0";
      let tax = proposal.tax ?? "0";
      let total = proposal.total ?? "0";
      let discount = proposal.discount ?? "0";

      if (proposal.mode === "multi_option" && input.selectedOptionId) {
        const [opt] = await db.select().from(proposalOptions).where(eq(proposalOptions.id, input.selectedOptionId)).limit(1);
        if (opt) {
          items = (opt.items as QuoteItem[]) ?? [];
          subtotal = opt.subtotal ?? "0";
          tax = opt.tax ?? "0";
          total = opt.total ?? "0";
          discount = opt.discount ?? "0";
        }
      }

      // Import generateDocumentNumber for quote
      const { generateDocumentNumber: genNum } = await import("../documentNumbers");
      const quoteNumber = await genNum("presupuesto", "proposals:convertToQuote", String(agentId));

      const [quoteResult] = await db.insert(quotes).values({
        quoteNumber,
        leadId: proposal.leadId,
        agentId,
        title: proposal.title,
        description: proposal.description,
        items,
        subtotal: String(subtotal),
        discount: String(discount),
        tax: String(tax),
        total: String(total),
        currency: proposal.currency ?? "EUR",
        validUntil: proposal.validUntil,
        conditions: proposal.conditions,
        notes: proposal.notes,
        status: "borrador",
      });

      const quoteId = (quoteResult as unknown as { insertId: number }).insertId;

      await db.update(proposals).set({
        convertedToQuoteId: quoteId,
        status: "aceptado",
        acceptedAt: new Date(),
        selectedOptionId: input.selectedOptionId ?? null,
      }).where(eq(proposals.id, input.id));

      await logActivity("lead", proposal.leadId, "proposal_converted", agentId, String(agentId), { proposalId: input.id, quoteId, quoteNumber });

      return { success: true, quoteId, quoteNumber };
    }),

  // ── PUBLIC: getByToken (client view) ─────────────────────────────────────
  getByToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const [proposal] = await db.select().from(proposals).where(eq(proposals.token, input.token)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });

      const [lead] = await db.select({
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
      }).from(leads).where(eq(leads.id, proposal.leadId)).limit(1);

      const opts = proposal.mode === "multi_option"
        ? await db.select().from(proposalOptions).where(eq(proposalOptions.proposalId, proposal.id)).orderBy(proposalOptions.sortOrder)
        : [];

      // Mark as visualizado on first view
      if (proposal.status === "enviado") {
        await db.update(proposals).set({ status: "visualizado", viewedAt: new Date() }).where(eq(proposals.id, proposal.id));
      }

      return {
        proposal: { ...proposal, status: proposal.status === "enviado" ? "visualizado" : proposal.status },
        lead,
        options: opts,
      };
    }),

  // ── PUBLIC: acceptOption (client selects an option) ──────────────────────
  acceptOption: publicProcedure
    .input(z.object({
      token: z.string().min(1),
      selectedOptionId: z.number().int().optional(),
      message: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [proposal] = await db.select().from(proposals).where(eq(proposals.token, input.token)).limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada" });
      if (!["enviado", "visualizado"].includes(proposal.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta propuesta ya no está disponible para aceptar" });
      }

      await db.update(proposals).set({
        status: "aceptado",
        acceptedAt: new Date(),
        selectedOptionId: input.selectedOptionId ?? null,
        notes: input.message ? `${proposal.notes ?? ""}\n\nMensaje del cliente: ${input.message}`.trim() : proposal.notes,
      }).where(eq(proposals.id, proposal.id));

      // Notify internal team
      const [lead] = await db.select().from(leads).where(eq(leads.id, proposal.leadId)).limit(1);
      if (lead) {
        const businessEmail = await getBusinessEmail("reservations");
        const optionInfo = input.selectedOptionId ? ` — Opción seleccionada: #${input.selectedOptionId}` : "";
        await sharedSendEmail({
          to: businessEmail,
          subject: `✅ Propuesta aceptada "${lead.name}" — ${proposal.proposalNumber}`,
          html: `<p>El cliente <strong>${lead.name}</strong> (${lead.email}) ha aceptado la propuesta <strong>${proposal.proposalNumber}</strong>${optionInfo}.</p>${input.message ? `<p>Mensaje: ${input.message}</p>` : ""}`,
        });
      }

      return { success: true };
    }),
});
