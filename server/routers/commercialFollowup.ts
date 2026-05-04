/**
 * commercialFollowup.ts — Router tRPC para el módulo Atención Comercial.
 * Gestión de seguimiento de presupuestos no convertidos.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  quotes,
  leads,
  commercialFollowupSettings,
  commercialFollowupRules,
  quoteCommercialTracking,
  commercialCommunications,
} from "../../drizzle/schema";
import {
  eq, desc, asc, and, or, gte, lte, like, isNull, isNotNull, count, sql,
} from "drizzle-orm";
import { sendEmail } from "../mailer";
import {
  buildCommercialReminder1Html,
  buildCommercialReminder2Html,
  buildCommercialReminder3Html,
  type CommercialReminderEmailData,
} from "../emailTemplates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const staff = protectedProcedure;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureTracking(quoteId: number): Promise<void> {
  await db
    .insert(quoteCommercialTracking)
    .values({ quoteId })
    .onDuplicateKeyUpdate({ set: { quoteId } });
}

async function getOrCreateTracking(quoteId: number) {
  const [row] = await db
    .select()
    .from(quoteCommercialTracking)
    .where(eq(quoteCommercialTracking.quoteId, quoteId))
    .limit(1);
  if (row) return row;
  await ensureTracking(quoteId);
  const [newRow] = await db
    .select()
    .from(quoteCommercialTracking)
    .where(eq(quoteCommercialTracking.quoteId, quoteId))
    .limit(1);
  return newRow!;
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending_followup: "Pendiente",
    reminder_1_sent: "Recordatorio 1",
    reminder_2_sent: "Recordatorio 2",
    reminder_3_sent: "Recordatorio 3",
    interested: "Interesado",
    paused: "Pausado",
    lost: "Perdido",
    converted: "Convertido",
    discarded: "Descartado",
  };
  return map[s] ?? s;
}

function pickReminderTemplate(reminderCount: number, data: CommercialReminderEmailData): string {
  if (reminderCount <= 1) return buildCommercialReminder1Html(data);
  if (reminderCount === 2) return buildCommercialReminder2Html(data);
  return buildCommercialReminder3Html(data);
}

// ─── Dashboard KPIs ───────────────────────────────────────────────────────────

const sentStatuses = ["enviado"] as const;

export const commercialFollowupRouter = router({

  getDashboard: staff.query(async () => {
    // Quotes that are "enviado" and not paid/converted/lost
    const openStatuses = ["enviado"];
    const rows = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        status: quotes.status,
        sentAt: quotes.sentAt,
        viewedAt: quotes.viewedAt,
        paidAt: quotes.paidAt,
        total: quotes.total,
        reminderCount: quotes.reminderCount,
        lastReminderAt: quotes.lastReminderAt,
        leadId: quotes.leadId,
        paymentLinkUrl: quotes.paymentLinkUrl,
        clientName: leads.name,
        clientEmail: leads.email,
        clientPhone: leads.phone,
        commercialStatus: quoteCommercialTracking.commercialStatus,
        reminderPaused: quoteCommercialTracking.reminderPaused,
        nextFollowupAt: quoteCommercialTracking.nextFollowupAt,
        lastContactAt: quoteCommercialTracking.lastContactAt,
        trackingReminderCount: quoteCommercialTracking.reminderCount,
      })
      .from(quotes)
      .leftJoin(leads, eq(leads.id, quotes.leadId))
      .leftJoin(quoteCommercialTracking, eq(quoteCommercialTracking.quoteId, quotes.id))
      .where(
        and(
          eq(quotes.status, "enviado"),
          isNull(quotes.paidAt),
          isNotNull(quotes.sentAt),
        )
      )
      .orderBy(desc(quotes.sentAt));

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const kpis = {
      total: rows.length,
      notViewed: rows.filter(r => !r.viewedAt).length,
      viewed: rows.filter(r => r.viewedAt).length,
      paused: rows.filter(r => r.reminderPaused).length,
      needsAttention: rows.filter(r => {
        if (r.reminderPaused) return false;
        const commercialSt = r.commercialStatus ?? "pending_followup";
        return !["lost", "converted", "discarded"].includes(commercialSt);
      }).length,
      sentToday: 0, // filled below
      cold: rows.filter(r => {
        if (!r.sentAt) return false;
        const daysSince = (now.getTime() - new Date(r.sentAt).getTime()) / 86400000;
        return daysSince >= 7;
      }).length,
    };

    // Reminders sent today
    const remToday = await db
      .select({ cnt: count() })
      .from(commercialCommunications)
      .where(
        and(
          eq(commercialCommunications.type, "automatic_reminder"),
          gte(commercialCommunications.sentAt, todayStart),
        )
      );
    kpis.sentToday = Number(remToday[0]?.cnt ?? 0);

    // Converted and lost counts (from tracking)
    const [convertedRow] = await db
      .select({ cnt: count() })
      .from(quoteCommercialTracking)
      .where(eq(quoteCommercialTracking.commercialStatus, "converted"));
    const [lostRow] = await db
      .select({ cnt: count() })
      .from(quoteCommercialTracking)
      .where(eq(quoteCommercialTracking.commercialStatus, "lost"));

    return {
      kpis: {
        ...kpis,
        converted: Number(convertedRow?.cnt ?? 0),
        lost: Number(lostRow?.cnt ?? 0),
      },
      attentionList: rows.slice(0, 50),
    };
  }),

  // ─── Presupuestos abiertos con filtros ────────────────────────────────────

  listOpen: staff
    .input(z.object({
      search: z.string().optional(),
      commercialStatus: z.string().optional(),
      viewed: z.enum(["yes", "no", "all"]).optional().default("all"),
      reminderPaused: z.boolean().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      amountMin: z.number().optional(),
      amountMax: z.number().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [
        eq(quotes.status, "enviado"),
        isNull(quotes.paidAt),
        isNotNull(quotes.sentAt),
      ];

      if (input.search) {
        const s = `%${input.search}%`;
        conditions.push(
          or(
            like(quotes.quoteNumber, s),
            like(leads.name, s),
            like(leads.email, s),
            like(leads.phone, s),
          )
        );
      }
      if (input.commercialStatus) {
        conditions.push(eq(quoteCommercialTracking.commercialStatus, input.commercialStatus as any));
      }
      if (input.viewed === "yes") conditions.push(isNotNull(quotes.viewedAt));
      if (input.viewed === "no") conditions.push(isNull(quotes.viewedAt));
      if (input.reminderPaused !== undefined) {
        conditions.push(eq(quoteCommercialTracking.reminderPaused, input.reminderPaused));
      }
      if (input.dateFrom) conditions.push(gte(quotes.sentAt, new Date(input.dateFrom)));
      if (input.dateTo) conditions.push(lte(quotes.sentAt, new Date(input.dateTo)));

      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: quotes.id,
          quoteNumber: quotes.quoteNumber,
          status: quotes.status,
          title: quotes.title,
          total: quotes.total,
          sentAt: quotes.sentAt,
          viewedAt: quotes.viewedAt,
          reminderCount: quotes.reminderCount,
          lastReminderAt: quotes.lastReminderAt,
          paymentLinkUrl: quotes.paymentLinkUrl,
          clientName: leads.name,
          clientEmail: leads.email,
          clientPhone: leads.phone,
          commercialStatus: quoteCommercialTracking.commercialStatus,
          reminderPaused: quoteCommercialTracking.reminderPaused,
          reminderPausedReason: quoteCommercialTracking.reminderPausedReason,
          nextFollowupAt: quoteCommercialTracking.nextFollowupAt,
          lastContactAt: quoteCommercialTracking.lastContactAt,
          lastContactChannel: quoteCommercialTracking.lastContactChannel,
          trackingReminderCount: quoteCommercialTracking.reminderCount,
        })
          .from(quotes)
          .leftJoin(leads, eq(leads.id, quotes.leadId))
          .leftJoin(quoteCommercialTracking, eq(quoteCommercialTracking.quoteId, quotes.id))
          .where(and(...conditions))
          .orderBy(desc(quotes.sentAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() })
          .from(quotes)
          .leftJoin(leads, eq(leads.id, quotes.leadId))
          .leftJoin(quoteCommercialTracking, eq(quoteCommercialTracking.quoteId, quotes.id))
          .where(and(...conditions)),
      ]);

      return { rows, total };
    }),

  // ─── Tracking de un presupuesto concreto ─────────────────────────────────

  getTracking: staff
    .input(z.object({ quoteId: z.number() }))
    .query(async ({ input }) => {
      const tracking = await getOrCreateTracking(input.quoteId);

      const comms = await db
        .select()
        .from(commercialCommunications)
        .where(eq(commercialCommunications.quoteId, input.quoteId))
        .orderBy(desc(commercialCommunications.sentAt))
        .limit(50);

      return { tracking, communications: comms };
    }),

  // ─── Actualizar estado comercial ─────────────────────────────────────────

  updateCommercialStatus: staff
    .input(z.object({
      quoteId: z.number(),
      status: z.enum(["pending_followup", "reminder_1_sent", "reminder_2_sent", "reminder_3_sent", "interested", "paused", "lost", "converted", "discarded"]),
      lostReason: z.string().optional(),
      internalNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureTracking(input.quoteId);

      const updateData: Record<string, any> = {
        commercialStatus: input.status,
        updatedAt: new Date(),
      };
      if (input.lostReason !== undefined) updateData.lostReason = input.lostReason;
      if (input.internalNotes !== undefined) updateData.internalNotes = input.internalNotes;
      if (input.status === "paused") updateData.reminderPaused = true;
      if (input.status === "pending_followup" || input.status === "interested") {
        updateData.reminderPaused = false;
      }

      await db.update(quoteCommercialTracking)
        .set(updateData)
        .where(eq(quoteCommercialTracking.quoteId, input.quoteId));

      // Log communication if marking as lost
      if (input.status === "lost" && input.lostReason) {
        await db.insert(commercialCommunications).values({
          quoteId: input.quoteId,
          type: "lost_reason",
          channel: "internal",
          subject: "Marcado como perdido",
          bodySnapshot: input.lostReason,
          status: "sent",
          sentByUserId: (ctx.user as any).id,
          sentAt: new Date(),
        });
      }

      return { ok: true };
    }),

  // ─── Pausar recordatorios ─────────────────────────────────────────────────

  pauseReminders: staff
    .input(z.object({
      quoteId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await ensureTracking(input.quoteId);
      await db.update(quoteCommercialTracking)
        .set({ reminderPaused: true, reminderPausedReason: input.reason ?? null, updatedAt: new Date() })
        .where(eq(quoteCommercialTracking.quoteId, input.quoteId));
      return { ok: true };
    }),

  resumeReminders: staff
    .input(z.object({ quoteId: z.number() }))
    .mutation(async ({ input }) => {
      await ensureTracking(input.quoteId);
      await db.update(quoteCommercialTracking)
        .set({ reminderPaused: false, reminderPausedReason: null, updatedAt: new Date() })
        .where(eq(quoteCommercialTracking.quoteId, input.quoteId));
      return { ok: true };
    }),

  // ─── Enviar recordatorio manual ───────────────────────────────────────────

  sendManualReminder: staff
    .input(z.object({
      quoteId: z.number(),
      customSubject: z.string().optional(),
      customBody: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [quote] = await db
        .select({
          id: quotes.id, quoteNumber: quotes.quoteNumber, title: quotes.title,
          total: quotes.total, paymentLinkUrl: quotes.paymentLinkUrl,
          status: quotes.status, paidAt: quotes.paidAt,
          clientName: leads.name, clientEmail: leads.email,
        })
        .from(quotes)
        .leftJoin(leads, eq(leads.id, quotes.leadId))
        .where(eq(quotes.id, input.quoteId))
        .limit(1);

      if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
      if (!quote.clientEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "El presupuesto no tiene email de cliente" });
      if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "El presupuesto ya está pagado" });

      await ensureTracking(input.quoteId);
      const tracking = await getOrCreateTracking(input.quoteId);
      const newCount = (tracking.reminderCount ?? 0) + 1;

      const emailData: CommercialReminderEmailData = {
        clientName: quote.clientName ?? "Cliente",
        quoteNumber: quote.quoteNumber,
        quoteTitle: quote.title,
        total: quote.total,
        paymentLinkUrl: quote.paymentLinkUrl,
        customSubject: input.customSubject,
        customBody: input.customBody,
      };

      const subject = input.customSubject ?? `Recordatorio — tu propuesta ${quote.quoteNumber} · ${process.env.BRAND_NAME ?? "Náyade Experiences"}`;
      const html = pickReminderTemplate(newCount, emailData);

      const sent = await sendEmail({
        to: quote.clientEmail,
        subject,
        html,
      });

      await db.insert(commercialCommunications).values({
        quoteId: input.quoteId,
        customerEmail: quote.clientEmail,
        type: "manual_reminder",
        channel: "email",
        subject,
        bodySnapshot: input.customBody ?? `Recordatorio manual #${newCount}`,
        status: sent ? "sent" : "failed",
        sentByUserId: (ctx.user as any).id,
        sentAt: new Date(),
      });

      if (sent) {
        const newStatus = newCount === 1 ? "reminder_1_sent" : newCount === 2 ? "reminder_2_sent" : "reminder_3_sent";
        await db.update(quoteCommercialTracking)
          .set({
            reminderCount: newCount,
            lastReminderAt: new Date(),
            lastContactAt: new Date(),
            lastContactChannel: "email",
            commercialStatus: newStatus as any,
            updatedAt: new Date(),
          })
          .where(eq(quoteCommercialTracking.quoteId, input.quoteId));
      }

      return { ok: sent };
    }),

  // ─── Añadir nota interna ──────────────────────────────────────────────────

  addNote: staff
    .input(z.object({
      quoteId: z.number(),
      note: z.string().min(1),
      channel: z.enum(["email", "phone", "whatsapp", "internal"]).optional().default("internal"),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureTracking(input.quoteId);

      await db.insert(commercialCommunications).values({
        quoteId: input.quoteId,
        type: "internal_note",
        channel: input.channel,
        subject: "Nota interna",
        bodySnapshot: input.note,
        status: "sent",
        sentByUserId: (ctx.user as any).id,
        sentAt: new Date(),
      });

      await db.update(quoteCommercialTracking)
        .set({
          lastContactAt: new Date(),
          lastContactChannel: input.channel,
          updatedAt: new Date(),
        })
        .where(eq(quoteCommercialTracking.quoteId, input.quoteId));

      return { ok: true };
    }),

  // ─── Historial de comunicaciones ─────────────────────────────────────────

  listCommunications: staff
    .input(z.object({
      quoteId: z.number().optional(),
      type: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input.quoteId) conditions.push(eq(commercialCommunications.quoteId, input.quoteId));
      if (input.type) conditions.push(eq(commercialCommunications.type, input.type as any));
      if (input.dateFrom) conditions.push(gte(commercialCommunications.sentAt, new Date(input.dateFrom)));
      if (input.dateTo) conditions.push(lte(commercialCommunications.sentAt, new Date(input.dateTo)));

      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: commercialCommunications.id,
          quoteId: commercialCommunications.quoteId,
          customerEmail: commercialCommunications.customerEmail,
          type: commercialCommunications.type,
          channel: commercialCommunications.channel,
          subject: commercialCommunications.subject,
          ruleId: commercialCommunications.ruleId,
          status: commercialCommunications.status,
          errorMessage: commercialCommunications.errorMessage,
          sentByUserId: commercialCommunications.sentByUserId,
          sentAt: commercialCommunications.sentAt,
          quoteNumber: quotes.quoteNumber,
          clientName: leads.name,
        })
          .from(commercialCommunications)
          .leftJoin(quotes, eq(quotes.id, commercialCommunications.quoteId))
          .leftJoin(leads, eq(leads.id, quotes.leadId))
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(commercialCommunications.sentAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() })
          .from(commercialCommunications)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);

      return { rows, total };
    }),

  // ─── Reglas de recordatorio ───────────────────────────────────────────────

  listRules: staff.query(async () => {
    return db.select().from(commercialFollowupRules).orderBy(asc(commercialFollowupRules.sortOrder));
  }),

  createRule: staff
    .input(z.object({
      name: z.string().min(1).max(200),
      isActive: z.boolean().default(true),
      delayHours: z.number().min(1).max(8760),
      triggerFrom: z.enum(["quote_sent_at", "last_reminder_at"]).default("quote_sent_at"),
      onlyIfNotViewed: z.boolean().default(false),
      allowIfViewedButUnpaid: z.boolean().default(true),
      maxSendsPerQuoteForThisRule: z.number().min(1).max(10).default(1),
      emailSubject: z.string().min(1).max(500),
      emailBody: z.string().min(1),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const [result] = await db.insert(commercialFollowupRules).values(input);
      return { id: (result as any).insertId };
    }),

  updateRule: staff
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200).optional(),
      isActive: z.boolean().optional(),
      delayHours: z.number().min(1).max(8760).optional(),
      triggerFrom: z.enum(["quote_sent_at", "last_reminder_at"]).optional(),
      onlyIfNotViewed: z.boolean().optional(),
      allowIfViewedButUnpaid: z.boolean().optional(),
      maxSendsPerQuoteForThisRule: z.number().min(1).max(10).optional(),
      emailSubject: z.string().min(1).max(500).optional(),
      emailBody: z.string().min(1).optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(commercialFollowupRules)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(commercialFollowupRules.id, id));
      return { ok: true };
    }),

  deleteRule: staff
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(commercialFollowupRules).where(eq(commercialFollowupRules.id, input.id));
      return { ok: true };
    }),

  // ─── Configuración global ─────────────────────────────────────────────────

  getSettings: staff.query(async () => {
    const [settings] = await db.select().from(commercialFollowupSettings).limit(1);
    if (settings) return settings;
    // Create default settings if missing
    await db.insert(commercialFollowupSettings).values({ id: 1, enabled: true });
    const [created] = await db.select().from(commercialFollowupSettings).limit(1);
    return created!;
  }),

  updateSettings: staff
    .input(z.object({
      enabled: z.boolean().optional(),
      maxTotalRemindersPerQuote: z.number().min(1).max(20).optional(),
      maxEmailsPerRun: z.number().min(1).max(500).optional(),
      allowedSendStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      allowedSendEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      timezone: z.string().optional(),
      stopAfterDays: z.number().min(1).max(365).optional(),
      internalCcEmail: z.string().email().optional().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.update(commercialFollowupSettings)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(commercialFollowupSettings.id, 1));
      return { ok: true };
    }),
});
