/**
 * emailAutomationJob.ts — Cron centralizado de automatizaciones de email.
 *
 * Frecuencia: cada 10 minutos ("* /10 * * * *")
 * Feature flag: email_automation_job_enabled
 *
 * Flujo:
 * 1. Buscar jobs en estado "pending" con scheduledFor <= NOW().
 * 2. Bloquear el job (lockedAt) para evitar doble ejecución.
 * 3. Cargar la regla y config de plantilla.
 * 4. Verificar condiciones (template activa, cliente no pausado).
 * 5. Intentar enviar via sendEmail().
 * 6. Registrar en email_comm_log.
 * 7. Marcar job como sent/skipped/failed.
 *
 * Este job convive con los crons legacy (quoteReminderJob, etc.).
 * Solo procesa jobs creados explícitamente en email_scheduled_jobs.
 */

import cron from "node-cron";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, lte, isNull, sql } from "drizzle-orm";
import {
  emailScheduledJobs,
  emailAutomationRules,
  emailTemplateConfigs,
  emailCommLog,
  customerEmailPrefs,
} from "../drizzle/schema";
import { sendEmail } from "./mailer";
import { getFeatureFlag } from "./config";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(_pool);

function log(level: "info" | "warn" | "error", msg: string, ctx?: object) {
  const entry = { ts: new Date().toISOString(), context: "EmailAutomationJob", msg, ...ctx };
  if (level === "error") console.error(JSON.stringify(entry));
  else if (level === "warn") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

function madridHHMM(): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function isWithinWindow(start: string, end: string): boolean {
  const now = madridHHMM();
  return now >= start && now <= end;
}

export async function runEmailAutomationJob(): Promise<void> {
  // Feature flag
  const enabled = await getFeatureFlag("email_automation_job_enabled");
  if (!enabled) {
    log("info", "Feature flag desactivado — job omitido");
    return;
  }

  const now = new Date();

  // Buscar jobs pendientes cuyo scheduledFor ya ha llegado
  const jobs = await db
    .select()
    .from(emailScheduledJobs)
    .where(
      and(
        eq(emailScheduledJobs.status, "pending"),
        lte(emailScheduledJobs.scheduledFor, now),
        isNull(emailScheduledJobs.lockedAt)
      )
    )
    .limit(50);

  if (!jobs.length) {
    log("info", "Sin jobs pendientes");
    return;
  }

  log("info", `Procesando ${jobs.length} jobs`);
  let sent = 0, skipped = 0, failed = 0;

  for (const job of jobs) {
    // Bloquear el job
    await db
      .update(emailScheduledJobs)
      .set({ lockedAt: new Date(), attempts: sql`${emailScheduledJobs.attempts} + 1`, lastAttemptAt: new Date() })
      .where(and(eq(emailScheduledJobs.id, job.id), isNull(emailScheduledJobs.lockedAt)));

    let status: "sent" | "skipped" | "failed" = "skipped";
    let skipReason: string | undefined;
    let errorMessage: string | undefined;
    let provider: string | undefined;

    try {
      // Cargar regla
      const [rule] = await db
        .select()
        .from(emailAutomationRules)
        .where(eq(emailAutomationRules.id, job.ruleId))
        .limit(1);

      if (!rule || !rule.isActive) {
        skipReason = "rule_inactive";
        await finalize(job.id, "skipped", { skipReason });
        skipped++;
        continue;
      }

      // Verificar ventana horaria
      if (!isWithinWindow(rule.allowedSendStart, rule.allowedSendEnd)) {
        // Reprogramar para dentro de 1h en lugar de saltar
        const nextTry = new Date(now.getTime() + 60 * 60 * 1000);
        await db.update(emailScheduledJobs).set({ lockedAt: null, scheduledFor: nextTry }).where(eq(emailScheduledJobs.id, job.id));
        log("info", `Job ${job.id} reprogramado por horario`, { ruleId: job.ruleId });
        continue;
      }

      // Verificar configuración de plantilla
      const [config] = await db
        .select({ isActive: emailTemplateConfigs.isActive })
        .from(emailTemplateConfigs)
        .where(eq(emailTemplateConfigs.key, job.templateKey))
        .limit(1);

      if (config && !config.isActive) {
        skipReason = "template_inactive";
        await finalize(job.id, "skipped", { skipReason });
        skipped++;
        continue;
      }

      // Verificar preferencias del cliente
      if (job.recipientEmail) {
        const [prefs] = await db
          .select({ automationsPaused: customerEmailPrefs.automationsPaused })
          .from(customerEmailPrefs)
          .where(eq(customerEmailPrefs.email, job.recipientEmail.toLowerCase()))
          .limit(1);

        if (prefs?.automationsPaused) {
          skipReason = "customer_paused";
          await finalize(job.id, "skipped", { skipReason });
          skipped++;
          continue;
        }
      }

      // Construir email desde la regla
      if (!rule.emailSubject || !rule.emailBody || !job.recipientEmail) {
        skipReason = "missing_content";
        await finalize(job.id, "skipped", { skipReason });
        skipped++;
        continue;
      }

      const subject = rule.emailSubject;
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">${rule.emailBody}</div>`;

      // Enviar
      const ok = await sendEmail({ to: job.recipientEmail, subject, html });
      status = ok ? "sent" : "failed";
      provider = process.env.BREVO_API_KEY ? "brevo" : "smtp";

      if (ok) {
        sent++;
        log("info", "Email automático enviado", { jobId: job.id, to: job.recipientEmail, rule: rule.name });
      } else {
        failed++;
        errorMessage = "sendEmail returned false";
      }

    } catch (err: any) {
      status = "failed";
      errorMessage = err?.message ?? "Unknown error";
      failed++;
      log("error", "Error procesando job", { jobId: job.id, error: errorMessage });
    }

    // Registrar en log
    try {
      await db.insert(emailCommLog).values({
        templateKey: job.templateKey,
        ruleId: job.ruleId,
        triggerEvent: `auto_rule_${job.ruleId}`,
        channel: "email",
        recipientEmail: job.recipientEmail ?? "",
        subject: "",
        status,
        provider,
        errorMessage,
        isAutomatic: true,
        skipReason,
        relatedEntityType: job.relatedEntityType,
        relatedEntityId: job.relatedEntityId,
      });
    } catch { /* no interrumpir */ }

    await finalize(job.id, status, { skipReason, errorMessage });
  }

  log("info", `Job completado — sent:${sent} skipped:${skipped} failed:${failed}`);
}

async function finalize(
  id: number,
  status: "sent" | "skipped" | "failed",
  extras: { skipReason?: string; errorMessage?: string } = {}
) {
  await db.update(emailScheduledJobs).set({
    status,
    lockedAt: null,
    skipReason: extras.skipReason,
    errorMessage: extras.errorMessage,
    updatedAt: new Date(),
  }).where(eq(emailScheduledJobs.id, id));
}

export function startEmailAutomationJob(): void {
  log("info", "Iniciando cron email_automation_job (*/10 * * * *)");
  cron.schedule("*/10 * * * *", async () => {
    try {
      await runEmailAutomationJob();
    } catch (err: any) {
      log("error", "Error inesperado en EmailAutomationJob", { stack: err?.stack });
    }
  });
}
