/**
 * emailManager.ts — Capa central de gestión de envío de emails.
 *
 * sendManagedEmail():
 *  1. Consulta configuración de la plantilla en email_template_configs.
 *  2. Si la plantilla está inactiva, omite el envío y lo registra.
 *  3. Envía via mailer.ts (Brevo/SMTP) según config.
 *  4. Registra resultado en email_comm_log.
 *  5. Programa jobs futuros si la plantilla tiene reglas de automatización.
 *
 * Los emails existentes NO necesitan migrar a esta función de golpe.
 * Se puede llamar progresivamente desde los routers que ya existen.
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import {
  emailTemplateConfigs,
  emailAutomationRules,
  emailCommLog,
  emailScheduledJobs,
  customerEmailPrefs,
} from "../drizzle/schema";
import { sendEmail } from "./mailer";
import { getSystemSettingSync } from "./config";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

// Templates con cron legacy propio — no programar jobs automáticos para evitar duplicados.
// - "quote": gestionado por quoteReminderJob (48h, reminderCount).
// - "commercial_reminder_1/2/3": gestionado por commercialFollowupJob (reglas configurables)
//   y por el botón manual de sendManualReminder. Si no se excluyeran aquí, cada envío
//   manual programaría jobs automáticos extra a través de email_automation_rules.
const LEGACY_CRON_TEMPLATES = new Set([
  "quote",
  "commercial_reminder_1",
  "commercial_reminder_2",
  "commercial_reminder_3",
]);

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface ManagedEmailOptions {
  templateKey: string;
  triggerEvent: string;
  recipientEmail: string;
  subject: string;
  html: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
  leadId?: number;
  quoteId?: number;
  reservationId?: number;
  sentByUserId?: number;
  isAutomatic?: boolean;
  /** Override: enviar al cliente aunque config diga false */
  forceCustomer?: boolean;
  /** CC adicional aparte del adminCopyEmail de config */
  extraCc?: string;
}

export interface ManagedEmailResult {
  sent: boolean;
  skipped: boolean;
  skipReason?: string;
  logId?: number;
  jobsScheduled?: number;
}

// ─── sendManagedEmail ─────────────────────────────────────────────────────────

export async function sendManagedEmail(opts: ManagedEmailOptions): Promise<ManagedEmailResult> {
  const {
    templateKey, triggerEvent, recipientEmail, subject, html,
    relatedEntityType, relatedEntityId, leadId, quoteId, reservationId,
    sentByUserId, isAutomatic = false, forceCustomer = false, extraCc,
  } = opts;

  // 1. Cargar configuración de plantilla (usa defaults si no existe en DB)
  let config = await db
    .select()
    .from(emailTemplateConfigs)
    .where(eq(emailTemplateConfigs.key, templateKey))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const isActive = config?.isActive ?? true;
  const sendToCustomer = config?.sendToCustomer ?? true;
  const sendToAdmin = config?.sendToAdmin ?? false;
  const adminCopyEmail =
    config?.adminCopyEmail ??
    getSystemSettingSync("email_reservations", process.env.GLOBAL_CC_EMAIL ?? "");

  // 2. Verificar si está activa
  if (!isActive) {
    await logComm({
      templateKey, ruleId: null, triggerEvent, channel: "email",
      recipientEmail, subject, status: "skipped", isAutomatic,
      sentByUserId, skipReason: "template_inactive",
      leadId, quoteId, reservationId, relatedEntityType, relatedEntityId,
    });
    return { sent: false, skipped: true, skipReason: "template_inactive" };
  }

  // 3. Verificar preferencias del cliente (automatizaciones pausadas)
  if (isAutomatic && recipientEmail) {
    const prefs = await db
      .select({ automationsPaused: customerEmailPrefs.automationsPaused })
      .from(customerEmailPrefs)
      .where(eq(customerEmailPrefs.email, recipientEmail.toLowerCase()))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (prefs?.automationsPaused) {
      await logComm({
        templateKey, ruleId: null, triggerEvent, channel: "email",
        recipientEmail, subject, status: "skipped", isAutomatic,
        sentByUserId, skipReason: "customer_paused",
        leadId, quoteId, reservationId, relatedEntityType, relatedEntityId,
      });
      return { sent: false, skipped: true, skipReason: "customer_paused" };
    }
  }

  // 4. Enviar email al cliente si corresponde
  let sent = false;
  let errorMessage: string | undefined;
  let provider = "none";

  if (sendToCustomer || forceCustomer) {
    const ccList: string[] = [];
    if (extraCc) ccList.push(extraCc);
    if (sendToAdmin && adminCopyEmail) ccList.push(adminCopyEmail);

    try {
      const ok = await sendEmail({
        to: recipientEmail,
        subject,
        html,
        cc: ccList.length > 0 ? ccList.join(",") : undefined,
      });
      sent = ok;
      provider = process.env.BREVO_API_KEY ? "brevo" : "smtp";
    } catch (err: any) {
      errorMessage = err?.message ?? "Unknown error";
    }
  } else if (sendToAdmin && adminCopyEmail) {
    // Solo envío admin
    try {
      const ok = await sendEmail({ to: adminCopyEmail, subject, html });
      sent = ok;
      provider = process.env.BREVO_API_KEY ? "brevo" : "smtp";
    } catch (err: any) {
      errorMessage = err?.message ?? "Unknown error";
    }
  }

  // 5. Registrar en log
  const logId = await logComm({
    templateKey, ruleId: null, triggerEvent, channel: "email",
    recipientEmail, ccEmail: sendToAdmin ? adminCopyEmail : undefined,
    subject, status: sent ? "sent" : errorMessage ? "failed" : "skipped",
    provider, errorMessage, isAutomatic, sentByUserId,
    leadId, quoteId, reservationId, relatedEntityType, relatedEntityId,
  });

  // 6. Programar jobs de automatización si hay reglas activas
  let jobsScheduled = 0;
  if (sent && relatedEntityType && relatedEntityId && !LEGACY_CRON_TEMPLATES.has(templateKey)) {
    try {
      const rules = await db
        .select()
        .from(emailAutomationRules)
        .where(
          and(
            eq(emailAutomationRules.templateKey, templateKey),
            eq(emailAutomationRules.isActive, true)
          )
        )
        .orderBy(emailAutomationRules.sortOrder);

      for (const rule of rules) {
        const scheduledFor = new Date(Date.now() + rule.delayHours * 3600 * 1000);
        await db.insert(emailScheduledJobs).values({
          relatedEntityType,
          relatedEntityId,
          templateKey,
          ruleId: rule.id,
          recipientEmail,
          scheduledFor,
          status: "pending",
          metadataJson: { leadId, quoteId, reservationId, triggerEvent },
        });
        jobsScheduled++;
      }
    } catch { /* no interrumpir el flujo principal */ }
  }

  return { sent, skipped: false, logId, jobsScheduled };
}

// ─── logComm helper ───────────────────────────────────────────────────────────

async function logComm(params: {
  templateKey: string;
  ruleId: number | null;
  triggerEvent: string;
  channel: string;
  recipientEmail: string;
  ccEmail?: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  provider?: string;
  errorMessage?: string;
  isAutomatic: boolean;
  sentByUserId?: number;
  skipReason?: string;
  leadId?: number;
  quoteId?: number;
  reservationId?: number;
  relatedEntityType?: string;
  relatedEntityId?: number;
}): Promise<number | undefined> {
  try {
    const result = await db.insert(emailCommLog).values({
      leadId: params.leadId,
      quoteId: params.quoteId,
      reservationId: params.reservationId,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
      templateKey: params.templateKey,
      ruleId: params.ruleId ?? undefined,
      triggerEvent: params.triggerEvent,
      channel: params.channel,
      recipientEmail: params.recipientEmail,
      ccEmail: params.ccEmail,
      subject: params.subject,
      status: params.status,
      provider: params.provider,
      errorMessage: params.errorMessage,
      sentByUserId: params.sentByUserId,
      isAutomatic: params.isAutomatic,
      skipReason: params.skipReason,
    });
    return (result as any).insertId as number;
  } catch {
    return undefined;
  }
}

// ─── scheduleJob — helper para crear jobs desde routers existentes ────────────

export async function scheduleEmailJob(opts: {
  relatedEntityType: string;
  relatedEntityId: number;
  templateKey: string;
  ruleId: number;
  recipientEmail: string;
  delayHours: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const scheduledFor = new Date(Date.now() + opts.delayHours * 3600 * 1000);
  await db.insert(emailScheduledJobs).values({
    relatedEntityType: opts.relatedEntityType,
    relatedEntityId: opts.relatedEntityId,
    templateKey: opts.templateKey,
    ruleId: opts.ruleId,
    recipientEmail: opts.recipientEmail,
    scheduledFor,
    status: "pending",
    metadataJson: opts.metadata ?? {},
  });
}

// ─── logDirectEmail — registrar emails enviados directamente (sin sendManagedEmail) ──

export async function logDirectEmail(opts: {
  templateKey: string;
  triggerEvent: string;
  recipientEmail: string;
  subject: string;
  sent: boolean;
  errorMessage?: string;
  isAutomatic?: boolean;
  sentByUserId?: number;
  relatedEntityType?: string;
  relatedEntityId?: number;
  leadId?: number;
  quoteId?: number;
  reservationId?: number;
  ccEmail?: string;
}): Promise<void> {
  await logComm({
    ...opts,
    ruleId: null,
    channel: "email",
    status: opts.sent ? "sent" : "failed",
    provider: process.env.BREVO_API_KEY ? "brevo" : "smtp",
    isAutomatic: opts.isAutomatic ?? false,
  });
}
