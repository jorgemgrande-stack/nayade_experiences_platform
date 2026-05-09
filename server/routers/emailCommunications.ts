/**
 * emailCommunications.ts — Router tRPC para el Centro de Comunicaciones.
 * Gestión de configuraciones de plantillas, reglas de automatización,
 * log global de emails, cola de jobs y preferencias por cliente.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  emailTemplateConfigs,
  emailAutomationRules,
  emailCommLog,
  emailScheduledJobs,
  customerEmailPrefs,
} from "../../drizzle/schema";
import { eq, and, desc, asc, gte, lte, like, count, sql, inArray } from "drizzle-orm";
import { sendEmail } from "../mailer";
import { runEmailAutomationJob } from "../emailAutomationJob";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const staff = protectedProcedure;

// ─── Catálogo estático (source of truth para keys + metadatos) ───────────────
// Lista de todas las plantillas conocidas. La DB solo guarda overrides.
const CATALOG_DEFAULTS: Record<string, { category: string; friendlyName: string; sendToCustomer: boolean; sendToAdmin: boolean }> = {
  budget_request_user:          { category: "Leads",                 friendlyName: "Solicitud de presupuesto (cliente)",      sendToCustomer: true,  sendToAdmin: false },
  budget_request_admin:         { category: "Leads",                 friendlyName: "Solicitud de presupuesto (admin)",         sendToCustomer: false, sendToAdmin: true  },
  quote:                        { category: "Presupuestos",          friendlyName: "Email de presupuesto",                    sendToCustomer: true,  sendToAdmin: false },
  proposal:                     { category: "Presupuestos",          friendlyName: "Propuesta comercial",                     sendToCustomer: true,  sendToAdmin: false },
  commercial_reminder_1:        { category: "Presupuestos",          friendlyName: "Recordatorio comercial #1",               sendToCustomer: true,  sendToAdmin: false },
  commercial_reminder_2:        { category: "Presupuestos",          friendlyName: "Recordatorio comercial #2",               sendToCustomer: true,  sendToAdmin: false },
  commercial_reminder_3:        { category: "Presupuestos",          friendlyName: "Recordatorio comercial #3",               sendToCustomer: true,  sendToAdmin: false },
  reservation_confirm:          { category: "Reservas",              friendlyName: "Confirmación de reserva",                 sendToCustomer: true,  sendToAdmin: false },
  reservation_failed:           { category: "Reservas",              friendlyName: "Fallo en pago de reserva",                sendToCustomer: true,  sendToAdmin: false },
  confirmation:                 { category: "Reservas",              friendlyName: "Confirmación completa (post-pago)",       sendToCustomer: true,  sendToAdmin: false },
  transfer_confirmation:        { category: "Pagos / Transferencias",friendlyName: "Confirmación de transferencia",           sendToCustomer: false, sendToAdmin: true  },
  pending_payment:              { category: "Pagos / Transferencias",friendlyName: "Aviso pago pendiente",                   sendToCustomer: true,  sendToAdmin: false },
  pending_payment_reminder:     { category: "Pagos / Transferencias",friendlyName: "Recordatorio pago pendiente",            sendToCustomer: true,  sendToAdmin: false },
  installment_reminder:         { category: "Pagos / Transferencias",friendlyName: "Recordatorio de cuota",                  sendToCustomer: true,  sendToAdmin: false },
  cancellation_received:        { category: "Anulaciones",           friendlyName: "Anulación recibida",                     sendToCustomer: true,  sendToAdmin: false },
  cancellation_rejected:        { category: "Anulaciones",           friendlyName: "Anulación rechazada",                    sendToCustomer: true,  sendToAdmin: false },
  cancellation_accepted_refund: { category: "Anulaciones",           friendlyName: "Anulación aceptada — devolución",        sendToCustomer: true,  sendToAdmin: false },
  cancellation_accepted_voucher:{ category: "Anulaciones",           friendlyName: "Anulación aceptada — bono",              sendToCustomer: true,  sendToAdmin: false },
  cancellation_documentation:   { category: "Anulaciones",           friendlyName: "Solicitud de documentación",             sendToCustomer: true,  sendToAdmin: false },
  cancellation_refund_executed: { category: "Anulaciones",           friendlyName: "Devolución ejecutada",                   sendToCustomer: true,  sendToAdmin: false },
  coupon_received:              { category: "Cupones",               friendlyName: "Cupón recibido / confirmación",           sendToCustomer: true,  sendToAdmin: true  },
  coupon_postponed:             { category: "Cupones",               friendlyName: "Cupón pospuesto",                        sendToCustomer: true,  sendToAdmin: false },
  coupon_internal_alert:        { category: "Cupones",               friendlyName: "Alerta interna de cupón",                sendToCustomer: false, sendToAdmin: true  },
  restaurant_confirm:           { category: "Restaurantes",          friendlyName: "Confirmación reserva restaurante",       sendToCustomer: true,  sendToAdmin: false },
  restaurant_payment_link:      { category: "Restaurantes",          friendlyName: "Link de pago restaurante",               sendToCustomer: true,  sendToAdmin: false },
  tpv_ticket:                   { category: "Operaciones internas",  friendlyName: "Ticket TPV",                             sendToCustomer: false, sendToAdmin: true  },
  cash_open:                    { category: "Operaciones internas",  friendlyName: "Apertura de caja",                       sendToCustomer: false, sendToAdmin: true  },
  cash_close:                   { category: "Operaciones internas",  friendlyName: "Cierre de caja",                         sendToCustomer: false, sendToAdmin: true  },
  invite:                       { category: "Administración",        friendlyName: "Invitación de usuario",                  sendToCustomer: false, sendToAdmin: false },
  password_reset:               { category: "Administración",        friendlyName: "Reset de contraseña",                   sendToCustomer: false, sendToAdmin: false },
};

function mergeWithDefaults(dbRow: typeof emailTemplateConfigs.$inferSelect | null, key: string) {
  const def = CATALOG_DEFAULTS[key];
  if (!def) return dbRow;
  return {
    id: dbRow?.id ?? null,
    key,
    category: dbRow?.category ?? def.category,
    friendlyName: dbRow?.friendlyName ?? def.friendlyName,
    isActive: dbRow?.isActive ?? true,
    sendToCustomer: dbRow?.sendToCustomer ?? def.sendToCustomer,
    sendToAdmin: dbRow?.sendToAdmin ?? def.sendToAdmin,
    adminCopyEmail: dbRow?.adminCopyEmail ?? null,
    customSubject: dbRow?.customSubject ?? null,
    notes: dbRow?.notes ?? null,
    createdAt: dbRow?.createdAt ?? null,
    updatedAt: dbRow?.updatedAt ?? null,
    _fromDb: !!dbRow,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const emailCommunicationsRouter = router({

  // ── Template configs ───────────────────────────────────────────────────────

  listTemplateConfigs: staff.query(async () => {
    const dbRows = await db.select().from(emailTemplateConfigs).orderBy(asc(emailTemplateConfigs.category), asc(emailTemplateConfigs.key));
    const dbMap = new Map(dbRows.map((r) => [r.key, r]));
    return Object.keys(CATALOG_DEFAULTS).map((key) => mergeWithDefaults(dbMap.get(key) ?? null, key));
  }),

  upsertTemplateConfig: staff
    .input(z.object({
      key: z.string(),
      isActive: z.boolean().optional(),
      sendToCustomer: z.boolean().optional(),
      sendToAdmin: z.boolean().optional(),
      adminCopyEmail: z.string().email().nullable().optional(),
      customSubject: z.string().max(512).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { key, ...fields } = input;
      const existing = await db.select({ id: emailTemplateConfigs.id }).from(emailTemplateConfigs).where(eq(emailTemplateConfigs.key, key)).limit(1);
      const def = CATALOG_DEFAULTS[key];
      if (!def) throw new TRPCError({ code: "BAD_REQUEST", message: "Template key desconocida" });

      const values = {
        key,
        category: def.category,
        friendlyName: def.friendlyName,
        isActive: fields.isActive ?? true,
        sendToCustomer: fields.sendToCustomer ?? def.sendToCustomer,
        sendToAdmin: fields.sendToAdmin ?? def.sendToAdmin,
        adminCopyEmail: fields.adminCopyEmail ?? undefined,
        customSubject: fields.customSubject ?? undefined,
        notes: fields.notes ?? undefined,
      };

      if (existing.length > 0) {
        await db.update(emailTemplateConfigs).set(values).where(eq(emailTemplateConfigs.key, key));
      } else {
        await db.insert(emailTemplateConfigs).values(values);
      }
      return { ok: true };
    }),

  // ── Automation rules ───────────────────────────────────────────────────────

  listRules: staff
    .input(z.object({ templateKey: z.string().optional() }))
    .query(async ({ input }) => {
      const conditions = input.templateKey
        ? [eq(emailAutomationRules.templateKey, input.templateKey)]
        : [];
      return db.select().from(emailAutomationRules)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(emailAutomationRules.templateKey), asc(emailAutomationRules.sortOrder));
    }),

  createRule: staff
    .input(z.object({
      templateKey: z.string(),
      name: z.string().min(1).max(256),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      delayHours: z.number().int().min(1).max(8760),
      calculateFrom: z.enum(["trigger_time", "last_reminder", "created_at", "viewed_at", "expires_at"]).default("trigger_time"),
      maxSendsPerEntity: z.number().int().min(1).max(10).default(1),
      allowedSendStart: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
      allowedSendEnd: z.string().regex(/^\d{2}:\d{2}$/).default("21:00"),
      stopIfConverted: z.boolean().default(true),
      stopIfPaid: z.boolean().default(true),
      emailSubject: z.string().max(512).optional(),
      emailBody: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!CATALOG_DEFAULTS[input.templateKey]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Template key desconocida" });
      }
      await db.insert(emailAutomationRules).values(input);
      return { ok: true };
    }),

  updateRule: staff
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(256).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      delayHours: z.number().int().min(1).max(8760).optional(),
      calculateFrom: z.enum(["trigger_time", "last_reminder", "created_at", "viewed_at", "expires_at"]).optional(),
      maxSendsPerEntity: z.number().int().min(1).max(10).optional(),
      allowedSendStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      allowedSendEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      stopIfConverted: z.boolean().optional(),
      stopIfPaid: z.boolean().optional(),
      emailSubject: z.string().max(512).nullable().optional(),
      emailBody: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if (Object.keys(cleanFields).length === 0) return { ok: true };
      await db.update(emailAutomationRules).set(cleanFields).where(eq(emailAutomationRules.id, id));
      return { ok: true };
    }),

  deleteRule: staff
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(emailAutomationRules).where(eq(emailAutomationRules.id, input.id));
      return { ok: true };
    }),

  // ── Communication log ──────────────────────────────────────────────────────

  listCommLog: staff
    .input(z.object({
      templateKey: z.string().optional(),
      recipientEmail: z.string().optional(),
      status: z.enum(["sent", "failed", "skipped"]).optional(),
      isAutomatic: z.boolean().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input.templateKey) conditions.push(eq(emailCommLog.templateKey, input.templateKey));
      if (input.status) conditions.push(eq(emailCommLog.status, input.status));
      if (input.isAutomatic !== undefined) conditions.push(eq(emailCommLog.isAutomatic, input.isAutomatic));
      if (input.recipientEmail) conditions.push(like(emailCommLog.recipientEmail, `%${input.recipientEmail}%`));
      if (input.dateFrom) conditions.push(gte(emailCommLog.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) conditions.push(lte(emailCommLog.createdAt, new Date(input.dateTo)));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(emailCommLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(emailCommLog.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(emailCommLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      return { rows, total };
    }),

  // ── Scheduled jobs ─────────────────────────────────────────────────────────

  listScheduledJobs: staff
    .input(z.object({
      status: z.enum(["pending", "sent", "skipped", "failed", "cancelled"]).optional(),
      templateKey: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input.status) conditions.push(eq(emailScheduledJobs.status, input.status));
      if (input.templateKey) conditions.push(eq(emailScheduledJobs.templateKey, input.templateKey));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(emailScheduledJobs)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(emailScheduledJobs.scheduledFor))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(emailScheduledJobs)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      return { rows, total };
    }),

  cancelJob: staff
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const [job] = await db.select({ status: emailScheduledJobs.status }).from(emailScheduledJobs).where(eq(emailScheduledJobs.id, input.id)).limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      if (job.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Solo se pueden cancelar jobs pendientes" });
      await db.update(emailScheduledJobs).set({ status: "cancelled" }).where(eq(emailScheduledJobs.id, input.id));
      return { ok: true };
    }),

  // ── Customer email preferences ─────────────────────────────────────────────

  getCustomerPrefs: staff
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(customerEmailPrefs).where(eq(customerEmailPrefs.email, input.email.toLowerCase())).limit(1);
      return row ?? { email: input.email.toLowerCase(), automationsPaused: false, pauseReason: null };
    }),

  setCustomerPrefs: staff
    .input(z.object({
      email: z.string().email(),
      automationsPaused: z.boolean(),
      pauseReason: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const existing = await db.select({ id: customerEmailPrefs.id }).from(customerEmailPrefs).where(eq(customerEmailPrefs.email, email)).limit(1);
      const values = {
        email,
        automationsPaused: input.automationsPaused,
        pauseReason: input.pauseReason ?? undefined,
        pausedAt: input.automationsPaused ? new Date() : undefined,
        pausedByUserId: (ctx as any).userId ?? undefined,
      };
      if (existing.length > 0) {
        await db.update(customerEmailPrefs).set(values).where(eq(customerEmailPrefs.email, email));
      } else {
        await db.insert(customerEmailPrefs).values(values);
      }
      return { ok: true };
    }),

  listPausedCustomers: staff.query(async () => {
    return db
      .select()
      .from(customerEmailPrefs)
      .where(eq(customerEmailPrefs.automationsPaused, true))
      .orderBy(desc(customerEmailPrefs.pausedAt));
  }),

  // ── Dashboard KPIs ─────────────────────────────────────────────────────────

  getDashboardKpis: staff.query(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      [{ totalToday }],
      [{ totalFailed }],
      [{ totalAutomatic }],
      [{ pendingJobs }],
      [{ activeTemplates }],
      [{ activeRules }],
    ] = await Promise.all([
      db.select({ totalToday: count() }).from(emailCommLog).where(and(eq(emailCommLog.status, "sent"), gte(emailCommLog.createdAt, todayStart))),
      db.select({ totalFailed: count() }).from(emailCommLog).where(and(eq(emailCommLog.status, "failed"), gte(emailCommLog.createdAt, todayStart))),
      db.select({ totalAutomatic: count() }).from(emailCommLog).where(and(eq(emailCommLog.isAutomatic, true), gte(emailCommLog.createdAt, todayStart))),
      db.select({ pendingJobs: count() }).from(emailScheduledJobs).where(eq(emailScheduledJobs.status, "pending")),
      db.select({ activeTemplates: count() }).from(emailTemplateConfigs).where(eq(emailTemplateConfigs.isActive, true)),
      db.select({ activeRules: count() }).from(emailAutomationRules).where(eq(emailAutomationRules.isActive, true)),
    ]);

    return {
      sentToday: totalToday,
      failedToday: totalFailed,
      automaticToday: totalAutomatic,
      manualToday: totalToday - totalAutomatic,
      pendingJobs,
      activeTemplates,
      activeRules,
    };
  }),

  // ── Manual trigger del automation job ────────────────────────────────────

  runAutomationJobNow: staff.mutation(async () => {
    try {
      const result = await runEmailAutomationJob(true); // forceRun=true omite el feature flag
      return { ok: true, ...result };
    } catch (err: any) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err?.message ?? "Error ejecutando job" });
    }
  }),

  // ── Test email ─────────────────────────────────────────────────────────────

  sendTestEmail: staff
    .input(z.object({
      to: z.string().email(),
      templateKey: z.string(),
    }))
    .mutation(async ({ input }) => {
      const def = CATALOG_DEFAULTS[input.templateKey];
      if (!def) throw new TRPCError({ code: "BAD_REQUEST", message: "Template key desconocida" });
      const subject = `[TEST] ${def.friendlyName}`;
      const html = `<div style="font-family:sans-serif;padding:24px;max-width:600px;margin:0 auto;">
        <h2 style="color:#0a1628;">Email de prueba — ${def.friendlyName}</h2>
        <p>Plantilla: <code>${input.templateKey}</code></p>
        <p>Categoría: ${def.category}</p>
        <p>Este es un email de prueba enviado desde el Centro de Comunicaciones de Nayade Experiences.</p>
      </div>`;
      const ok = await sendEmail({ to: input.to, subject, html });
      return { ok, to: input.to };
    }),
});

export type EmailCommunicationsRouter = typeof emailCommunicationsRouter;
