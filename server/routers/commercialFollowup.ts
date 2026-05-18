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
  quoteCommercialTracking,
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

    // Reminders sent today — desde email_comm_log (todos los emails automáticos a presupuestos)
    const remToday = await db
      .select({ cnt: count() })
      .from(emailCommLog)
      .where(
        and(
          eq(emailCommLog.relatedEntityType, "quote"),
          eq(emailCommLog.isAutomatic, true),
          eq(emailCommLog.status, "sent"),
          gte(emailCommLog.createdAt, todayStart),
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

      // Comunicaciones desde email_comm_log (emails) + quote_internal_notes (notas)
      const [emails, notes] = await Promise.all([
        db.select({
          id: emailCommLog.id,
          quoteId: emailCommLog.quoteId,
          customerEmail: emailCommLog.recipientEmail,
          type: sql<string>`CASE WHEN ${emailCommLog.isAutomatic} = 1 THEN 'automatic_reminder' ELSE 'manual_reminder' END`,
          channel: emailCommLog.channel,
          subject: emailCommLog.subject,
          ruleId: emailCommLog.ruleId,
          status: emailCommLog.status,
          errorMessage: emailCommLog.errorMessage,
          sentByUserId: emailCommLog.sentByUserId,
          sentAt: emailCommLog.createdAt,
          templateKey: emailCommLog.templateKey,
        })
          .from(emailCommLog)
          .where(and(
            eq(emailCommLog.relatedEntityType, "quote"),
            eq(emailCommLog.quoteId, input.quoteId),
          ))
          .orderBy(desc(emailCommLog.createdAt))
          .limit(50),
        db.select({
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
        })
          .from(quoteInternalNotes)
          .where(eq(quoteInternalNotes.quoteId, input.quoteId))
          .orderBy(desc(quoteInternalNotes.createdAt))
          .limit(50),
      ]);

      const communications = [...emails, ...notes].sort((a, b) => {
        const ta = a.sentAt ? new Date(a.sentAt as any).getTime() : 0;
        const tb = b.sentAt ? new Date(b.sentAt as any).getTime() : 0;
        return tb - ta;
      });

      return { tracking, communications };
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

      // Registrar el motivo de pérdida como nota interna (Fase 5)
      if (input.status === "lost" && input.lostReason) {
        await db.insert(quoteInternalNotes).values({
          quoteId: input.quoteId,
          channel: "internal",
          body: `[Marcado como perdido] ${input.lostReason}`,
          authorUserId: (ctx.user as any).id,
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

      // El tope cumulativo lo definen ahora las reglas en email_automation_rules
      // (maxCumulativeSendsPerEntity). Para el manual usamos el mayor de las
      // reglas comerciales activas, con fallback a 3.
      const cumulativeCaps = await db
        .select({ cap: emailAutomationRules.maxCumulativeSendsPerEntity })
        .from(emailAutomationRules)
        .where(and(
          eq(emailAutomationRules.isActive, true),
          eq(emailAutomationRules.respectCommercialPause, true),
        ));
      const maxReminders = Math.max(
        3,
        ...cumulativeCaps.map(c => c.cap ?? 0).filter(n => n > 0),
      );

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

      // En Fase 5 commercial_communications fue borrada; sus emails y notas se
      // migraron a email_comm_log y quote_internal_notes respectivamente, así
      // que con las 2 fuentes anteriores cubrimos todo el histórico.

      // ── Merge, ordenar y paginar en memoria ──────────────────────────────
      const merged = [...emailRows, ...noteRows].sort((a, b) => {
        const ta = a.sentAt ? new Date(a.sentAt as any).getTime() : 0;
        const tb = b.sentAt ? new Date(b.sentAt as any).getTime() : 0;
        return tb - ta;
      });

      const total = merged.length;
      const rows = merged.slice(input.offset, input.offset + input.limit);

      return { rows, total };
    }),

  // Endpoints listRules/createRule/updateRule/deleteRule eliminados en Fase 5:
  // las reglas comerciales se gestionan ahora en email_automation_rules vía el
  // router emailTemplatesRouter / la UI de "Plantillas".
  //
  // getSettings/updateSettings también eliminados: la configuración global
  // (horario, máximos, etc.) vive en cada regla de email_automation_rules.
});
