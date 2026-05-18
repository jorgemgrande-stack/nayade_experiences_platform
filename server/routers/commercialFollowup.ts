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
  quoteInternalNotes,
  emailCommLog,
  emailScheduledJobs,
  emailAutomationRules,
} from "../../drizzle/schema";
import {
  eq, desc, asc, and, or, gte, lte, like, isNull, isNotNull, count, sql,
} from "drizzle-orm";
import { sendManagedEmail } from "../emailManager";
import {
  buildCommercialReminder1Html,
  buildCommercialReminder2Html,
  buildCommercialReminder3Html,
  type CommercialReminderEmailData,
} from "../emailTemplates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
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

      const [baseRows, [{ total }]] = await Promise.all([
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

      // Próximo envío programado por quote (Fase 4D): consultamos email_scheduled_jobs
      const quoteIds = baseRows.map(r => r.id);
      const nextJobsByQuote = new Map<number, { scheduledFor: Date; templateKey: string; ruleName: string | null }>();

      if (quoteIds.length) {
        const nextJobs = await db
          .select({
            quoteId: emailScheduledJobs.relatedEntityId,
            scheduledFor: emailScheduledJobs.scheduledFor,
            templateKey: emailScheduledJobs.templateKey,
            ruleName: emailAutomationRules.name,
          })
          .from(emailScheduledJobs)
          .leftJoin(emailAutomationRules, eq(emailAutomationRules.id, emailScheduledJobs.ruleId))
          .where(and(
            eq(emailScheduledJobs.relatedEntityType, "quote"),
            eq(emailScheduledJobs.status, "pending"),
            sql`${emailScheduledJobs.relatedEntityId} IN (${sql.join(quoteIds.map(i => sql`${i}`), sql`, `)})`,
          ))
          .orderBy(asc(emailScheduledJobs.scheduledFor));

        for (const j of nextJobs) {
          if (!nextJobsByQuote.has(j.quoteId)) {
            nextJobsByQuote.set(j.quoteId, {
              scheduledFor: j.scheduledFor as Date,
              templateKey: j.templateKey,
              ruleName: j.ruleName ?? null,
            });
          }
        }
      }

      const rows = baseRows.map(r => ({
        ...r,
        nextScheduledAt: nextJobsByQuote.get(r.id)?.scheduledFor ?? null,
        nextScheduledRule: nextJobsByQuote.get(r.id)?.ruleName ?? null,
        nextScheduledTemplate: nextJobsByQuote.get(r.id)?.templateKey ?? null,
      }));

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

      // Cargar settings para conocer maxTotalRemindersPerQuote
      const [settings] = await db.select().from(commercialFollowupSettings).limit(1);
      const maxReminders = settings?.maxTotalRemindersPerQuote ?? 3;

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

      const templateKey = `commercial_reminder_${Math.min(newCount, 3)}` as "commercial_reminder_1" | "commercial_reminder_2" | "commercial_reminder_3";
      // sendManagedEmail registra el envío en email_comm_log con isAutomatic=false
      // (manual). No duplicamos en commercial_communications: esa tabla ya solo
      // sirve como red de seguridad histórica hasta Fase 5.
      const result = await sendManagedEmail({
        templateKey,
        triggerEvent: "manual_reminder_sent",
        recipientEmail: quote.clientEmail,
        subject,
        html,
        relatedEntityType: "quote",
        relatedEntityId: input.quoteId,
        quoteId: input.quoteId,
        sentByUserId: (ctx.user as any).id,
      });
      const sent = result.sent;

      if (sent) {
        // Si llegamos al máximo permitido, pausamos los recordatorios.
        // commercialStatus es ENUM (sin "max_reached"); usamos "paused" + reminderPaused=true.
        const reachedMax = newCount >= maxReminders;
        const newStatus = reachedMax
          ? "paused"
          : newCount === 1 ? "reminder_1_sent"
          : newCount === 2 ? "reminder_2_sent"
          : "reminder_3_sent";

        await db.update(quoteCommercialTracking)
          .set({
            reminderCount: newCount,
            lastReminderAt: new Date(),
            lastContactAt: new Date(),
            lastContactChannel: "email",
            commercialStatus: newStatus as any,
            reminderPaused: reachedMax ? true : undefined as any,
            reminderPausedReason: reachedMax ? "max_reminders_reached" : undefined as any,
            updatedAt: new Date(),
          })
          .where(eq(quoteCommercialTracking.quoteId, input.quoteId));

        // Sincronizar campos legacy en quotes (antes solo lo hacía el cron)
        await db.update(quotes)
          .set({
            reminderCount: newCount,
            lastReminderAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(quotes.id, input.quoteId));
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

      await db.insert(quoteInternalNotes).values({
        quoteId: input.quoteId,
        channel: input.channel,
        body: input.note,
        authorUserId: (ctx.user as any).id,
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
      // Tras Fase 3-4: los emails nuevos van a email_comm_log y las notas a
      // quote_internal_notes. commercial_communications se mantiene como red
      // de seguridad para histórico (envíos previos a Fase 3) hasta Fase 5.
      const dateFrom = input.dateFrom ? new Date(input.dateFrom) : null;
      const dateTo = input.dateTo ? new Date(input.dateTo) : null;
      const fetchLimit = Math.min(input.limit + input.offset + 50, 1000);

      // ── 1. Emails desde email_comm_log (Fase 3+) ─────────────────────────
      const emailConditions: any[] = [eq(emailCommLog.relatedEntityType, "quote")];
      if (input.quoteId) emailConditions.push(eq(emailCommLog.quoteId, input.quoteId));
      if (dateFrom) emailConditions.push(gte(emailCommLog.createdAt, dateFrom));
      if (dateTo) emailConditions.push(lte(emailCommLog.createdAt, dateTo));

      const includeEmails = !input.type || ["automatic_reminder", "manual_reminder"].includes(input.type);
      const emailRows = !includeEmails ? [] : await db.select({
        id: emailCommLog.id,
        quoteId: emailCommLog.quoteId,
        customerEmail: emailCommLog.recipientEmail,
        type: sql<string>`CASE WHEN ${emailCommLog.isAutomatic} = 1 THEN 'automatic_reminder' ELSE 'manual_reminder' END`,
        channel: emailCommLog.channel,
        subject: emailCommLog.subject,
        body: sql<string | null>`NULL`,
        ruleId: emailCommLog.ruleId,
        status: emailCommLog.status,
        errorMessage: emailCommLog.errorMessage,
        sentByUserId: emailCommLog.sentByUserId,
        sentAt: emailCommLog.createdAt,
        templateKey: emailCommLog.templateKey,
        source: sql<string>`'email_comm_log'`,
        quoteNumber: quotes.quoteNumber,
        clientName: leads.name,
      })
        .from(emailCommLog)
        .leftJoin(quotes, eq(quotes.id, emailCommLog.quoteId))
        .leftJoin(leads, eq(leads.id, quotes.leadId))
        .where(and(...emailConditions))
        .orderBy(desc(emailCommLog.createdAt))
        .limit(fetchLimit);

      // ── 2. Notas desde quote_internal_notes (Fase 4+) ────────────────────
      const noteConditions: any[] = [];
      if (input.quoteId) noteConditions.push(eq(quoteInternalNotes.quoteId, input.quoteId));
      if (dateFrom) noteConditions.push(gte(quoteInternalNotes.createdAt, dateFrom));
      if (dateTo) noteConditions.push(lte(quoteInternalNotes.createdAt, dateTo));

      const includeNotes = !input.type || input.type === "internal_note";
      const noteRows = !includeNotes ? [] : await db.select({
        id: quoteInternalNotes.id,
        quoteId: quoteInternalNotes.quoteId,
        customerEmail: sql<string | null>`NULL`,
        type: sql<string>`'internal_note'`,
        channel: quoteInternalNotes.channel,
        subject: sql<string>`'Nota interna'`,
        body: quoteInternalNotes.body,
        ruleId: sql<number | null>`NULL`,
        status: sql<string>`'sent'`,
        errorMessage: sql<string | null>`NULL`,
        sentByUserId: quoteInternalNotes.authorUserId,
        sentAt: quoteInternalNotes.createdAt,
        templateKey: sql<string | null>`NULL`,
        source: sql<string>`'quote_internal_notes'`,
        quoteNumber: quotes.quoteNumber,
        clientName: leads.name,
      })
        .from(quoteInternalNotes)
        .leftJoin(quotes, eq(quotes.id, quoteInternalNotes.quoteId))
        .leftJoin(leads, eq(leads.id, quotes.leadId))
        .where(noteConditions.length ? and(...noteConditions) : undefined)
        .orderBy(desc(quoteInternalNotes.createdAt))
        .limit(fetchLimit);

      // ── 3. Histórico antiguo desde commercial_communications ─────────────
      //   Solo emails (las notas ya migradas en 0097, evitamos duplicar).
      const histConditions: any[] = [
        sql`${commercialCommunications.type} IN ('automatic_reminder', 'manual_reminder')`,
      ];
      if (input.quoteId) histConditions.push(eq(commercialCommunications.quoteId, input.quoteId));
      if (input.type) histConditions.push(eq(commercialCommunications.type, input.type as any));
      if (dateFrom) histConditions.push(gte(commercialCommunications.sentAt, dateFrom));
      if (dateTo) histConditions.push(lte(commercialCommunications.sentAt, dateTo));

      const includeHist = !input.type || ["automatic_reminder", "manual_reminder"].includes(input.type);
      const histRows = !includeHist ? [] : await db.select({
        id: commercialCommunications.id,
        quoteId: commercialCommunications.quoteId,
        customerEmail: commercialCommunications.customerEmail,
        type: commercialCommunications.type,
        channel: commercialCommunications.channel,
        subject: commercialCommunications.subject,
        body: commercialCommunications.bodySnapshot,
        ruleId: commercialCommunications.ruleId,
        status: commercialCommunications.status,
        errorMessage: commercialCommunications.errorMessage,
        sentByUserId: commercialCommunications.sentByUserId,
        sentAt: commercialCommunications.sentAt,
        templateKey: sql<string | null>`NULL`,
        source: sql<string>`'commercial_communications'`,
        quoteNumber: quotes.quoteNumber,
        clientName: leads.name,
      })
        .from(commercialCommunications)
        .leftJoin(quotes, eq(quotes.id, commercialCommunications.quoteId))
        .leftJoin(leads, eq(leads.id, quotes.leadId))
        .where(and(...histConditions))
        .orderBy(desc(commercialCommunications.sentAt))
        .limit(fetchLimit);

      // ── Merge, ordenar y paginar en memoria ──────────────────────────────
      const merged = [...emailRows, ...noteRows, ...histRows].sort((a, b) => {
        const ta = a.sentAt ? new Date(a.sentAt as any).getTime() : 0;
        const tb = b.sentAt ? new Date(b.sentAt as any).getTime() : 0;
        return tb - ta;
      });

      const total = merged.length;
      const rows = merged.slice(input.offset, input.offset + input.limit);

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
