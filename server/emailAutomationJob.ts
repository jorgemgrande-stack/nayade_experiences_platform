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
 * 4. Verificar condiciones (template activa, cliente no pausado, entidad no pagada/convertida).
 * 5. Verificar maxSendsPerEntity para no superar el límite de envíos por entidad.
 * 6. Intentar enviar via sendEmail() (CC global via mergeGlobalCc en mailer.ts).
 * 7. Registrar en email_comm_log.
 * 8. Marcar job como sent/skipped/failed.
 *
 * Único cron de recordatorios desde Fase 5 (quoteReminderJob y commercialFollowupJob eliminados).
 * Procesa jobs creados explícitamente en email_scheduled_jobs y auto-programa
 * los recordatorios comerciales (commercial_reminder_*) basándose en quote.sentAt.
 * emailManager.ts bloquea el auto-scheduling para templates con cobertura legacy.
 */

import cron from "node-cron";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, lte, isNull, sql, count } from "drizzle-orm";
import {
  emailScheduledJobs,
  emailAutomationRules,
  emailTemplateConfigs,
  emailCommLog,
  customerEmailPrefs,
  quotes,
  leads,
  emailTemplates,
  quoteCommercialTracking,
} from "../drizzle/schema";
import { sendEmail } from "./mailer";
import { getFeatureFlag } from "./config";
import {
  buildCommercialReminder1Html,
  buildCommercialReminder2Html,
  buildCommercialReminder3Html,
  type CommercialReminderEmailData,
} from "./emailTemplates";

const COMMERCIAL_TEMPLATE_BUILDERS: Record<string, (d: CommercialReminderEmailData) => string> = {
  commercial_reminder_1: buildCommercialReminder1Html,
  commercial_reminder_2: buildCommercialReminder2Html,
  commercial_reminder_3: buildCommercialReminder3Html,
};

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
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

const PAID_STATUSES = ["pagado", "convertido_reserva", "facturado"] as const;
const CONVERTED_STATUSES = ["convertido_reserva", "pagado", "facturado"] as const;

export interface AutomationJobResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Auto-programar jobs para reglas comerciales (respectCommercialPause=true).
 * Encuentra los quotes que cumplen los criterios de delayHours de cada regla
 * y crea un job pendiente en email_scheduled_jobs.
 * Los checks finos (paused, terminal, viewed, etc.) se aplican al procesarlo.
 */
async function scheduleCommercialReminders(): Promise<number> {
  const rules = await db
    .select()
    .from(emailAutomationRules)
    .where(and(
      eq(emailAutomationRules.isActive, true),
      eq(emailAutomationRules.respectCommercialPause, true),
    ));

  if (!rules.length) return 0;

  const now = new Date();
  let scheduled = 0;

  for (const rule of rules) {
    const triggerBefore = new Date(now.getTime() - rule.delayHours * 3600 * 1000);
    const stopBefore = rule.stopAfterDays != null
      ? new Date(now.getTime() - rule.stopAfterDays * 86400 * 1000)
      : new Date(0);

    // Candidatos: quotes enviados que cumplen el delay de esta regla y no son demasiado antiguos.
    // El email del lead se usa como recipient.
    const candidates = await db
      .select({
        id: quotes.id,
        clientEmail: leads.email,
      })
      .from(quotes)
      .leftJoin(leads, eq(leads.id, quotes.leadId))
      .where(and(
        eq(quotes.status, "enviado"),
        isNull(quotes.paidAt),
        lte(quotes.sentAt, triggerBefore),
        sql`${quotes.sentAt} >= ${stopBefore}`,
      ))
      .limit(200);

    for (const c of candidates) {
      if (!c.clientEmail) continue;

      // ¿Ya existe un job para esta combinación quote+rule+template? (cualquier status)
      const existing = await db
        .select({ id: emailScheduledJobs.id })
        .from(emailScheduledJobs)
        .where(and(
          eq(emailScheduledJobs.relatedEntityType, "quote"),
          eq(emailScheduledJobs.relatedEntityId, c.id),
          eq(emailScheduledJobs.ruleId, rule.id),
          eq(emailScheduledJobs.templateKey, rule.templateKey),
        ))
        .limit(1);

      if (existing.length > 0) continue;

      try {
        await db.insert(emailScheduledJobs).values({
          relatedEntityType: "quote",
          relatedEntityId: c.id,
          templateKey: rule.templateKey,
          ruleId: rule.id,
          recipientEmail: c.clientEmail,
          scheduledFor: now,
          status: "pending",
          metadataJson: { autoScheduled: true, source: "commercial_scan" },
        });
        scheduled++;
      } catch (err: any) {
        log("warn", "No se pudo programar job comercial", { quoteId: c.id, ruleId: rule.id, error: err?.message });
      }
    }
  }

  if (scheduled > 0) log("info", `Programados ${scheduled} jobs comerciales`);
  return scheduled;
}

export async function runEmailAutomationJob(forceRun = false): Promise<AutomationJobResult> {
  // Feature flag (omitir si se fuerza la ejecución manual)
  if (!forceRun) {
    const enabled = await getFeatureFlag("email_automation_job_enabled");
    if (!enabled) {
      log("info", "Feature flag desactivado — job omitido");
      return { processed: 0, sent: 0, skipped: 0, failed: 0 };
    }
  }

  const now = new Date();

  // Auto-programar reminders comerciales antes de procesar
  await scheduleCommercialReminders();

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
    return { processed: 0, sent: 0, skipped: 0, failed: 0 };
  }

  log("info", `Procesando ${jobs.length} jobs`);
  let sent = 0, skipped = 0, failed = 0;

  for (const job of jobs) {
    // Bloquear el job para evitar procesamiento concurrente
    await db
      .update(emailScheduledJobs)
      .set({ lockedAt: new Date(), attempts: sql`${emailScheduledJobs.attempts} + 1`, lastAttemptAt: new Date() })
      .where(and(eq(emailScheduledJobs.id, job.id), isNull(emailScheduledJobs.lockedAt)));

    let status: "sent" | "skipped" | "failed" = "skipped";
    let skipReason: string | undefined;
    let errorMessage: string | undefined;
    let provider: string | undefined;
    let finalSubject = "";

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

      // Verificar ventana horaria — reprogramar en lugar de saltar
      if (!isWithinWindow(rule.allowedSendStart, rule.allowedSendEnd)) {
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

      // Cargar contenido del template desde email_templates (fuente de verdad del diseño)
      const [template] = await db
        .select({ subject: emailTemplates.subject, bodyHtml: emailTemplates.bodyHtml })
        .from(emailTemplates)
        .where(eq(emailTemplates.id, job.templateKey))
        .limit(1);

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

      // Verificar estado de la entidad (stopIfPaid / stopIfConverted) + checks comerciales
      const entityType = job.relatedEntityType;
      const entityId = job.relatedEntityId;

      // Datos para renderizar templates comerciales con builders dinámicos
      let commercialEmailData: CommercialReminderEmailData | null = null;

      if (entityType === "quote" && entityId) {
        const [q] = await db
          .select({
            quoteNumber: quotes.quoteNumber,
            title: quotes.title,
            total: quotes.total,
            paymentLinkUrl: quotes.paymentLinkUrl,
            status: quotes.status,
            paidAt: quotes.paidAt,
            sentAt: quotes.sentAt,
            viewedAt: quotes.viewedAt,
            clientName: leads.name,
            trackingReminderCount: quoteCommercialTracking.reminderCount,
            trackingPaused: quoteCommercialTracking.reminderPaused,
            commercialStatus: quoteCommercialTracking.commercialStatus,
          })
          .from(quotes)
          .leftJoin(leads, eq(leads.id, quotes.leadId))
          .leftJoin(quoteCommercialTracking, eq(quoteCommercialTracking.quoteId, quotes.id))
          .where(eq(quotes.id, entityId))
          .limit(1);

        if (q) {
          commercialEmailData = {
            clientName: q.clientName ?? "Cliente",
            quoteNumber: q.quoteNumber,
            quoteTitle: q.title,
            total: q.total,
            paymentLinkUrl: q.paymentLinkUrl,
          };

          if (rule.stopIfPaid && (q.paidAt !== null || (PAID_STATUSES as readonly string[]).includes(q.status))) {
            skipReason = "entity_paid";
            await finalize(job.id, "skipped", { skipReason });
            skipped++;
            log("info", `Job ${job.id} saltado — presupuesto ya pagado`, { entityId });
            continue;
          }
          if (rule.stopIfConverted && (CONVERTED_STATUSES as readonly string[]).includes(q.status)) {
            skipReason = "entity_converted";
            await finalize(job.id, "skipped", { skipReason });
            skipped++;
            log("info", `Job ${job.id} saltado — presupuesto convertido en reserva`, { entityId });
            continue;
          }

          // Checks comerciales (Fase 2): solo si la regla está marcada como commercial-aware
          if (rule.respectCommercialPause) {
            if (q.trackingPaused) {
              skipReason = "commercial_paused";
              await finalize(job.id, "skipped", { skipReason });
              skipped++;
              log("info", `Job ${job.id} saltado — recordatorios pausados`, { entityId });
              continue;
            }
            const cst = q.commercialStatus;
            if (cst && ["lost", "converted", "discarded"].includes(cst)) {
              skipReason = "commercial_terminal";
              await finalize(job.id, "skipped", { skipReason });
              skipped++;
              log("info", `Job ${job.id} saltado — estado comercial terminal`, { entityId, commercialStatus: cst });
              continue;
            }
            if (rule.maxCumulativeSendsPerEntity != null) {
              const cum = q.trackingReminderCount ?? 0;
              if (cum >= rule.maxCumulativeSendsPerEntity) {
                skipReason = "max_cumulative_reached";
                await finalize(job.id, "skipped", { skipReason });
                skipped++;
                log("info", `Job ${job.id} saltado — máx. cumulativo alcanzado`, { entityId, cum });
                continue;
              }
            }
          }

          // Filtros por estado de visualización
          if (rule.onlyIfNotViewed && q.viewedAt) {
            skipReason = "already_viewed";
            await finalize(job.id, "skipped", { skipReason });
            skipped++;
            continue;
          }
          if (q.viewedAt && !rule.allowIfViewedButUnpaid) {
            skipReason = "viewed_unpaid_not_allowed";
            await finalize(job.id, "skipped", { skipReason });
            skipped++;
            continue;
          }

          // Ventana máxima desde el envío del presupuesto
          if (rule.stopAfterDays != null && q.sentAt) {
            const ageDays = (Date.now() - new Date(q.sentAt).getTime()) / 86400000;
            if (ageDays > rule.stopAfterDays) {
              skipReason = "too_old";
              await finalize(job.id, "skipped", { skipReason });
              skipped++;
              log("info", `Job ${job.id} saltado — presupuesto demasiado antiguo`, { entityId, ageDays });
              continue;
            }
          }
        }
      }

      if (entityType === "lead" && entityId && rule.stopIfConverted) {
        const [l] = await db
          .select({ status: leads.status })
          .from(leads)
          .where(eq(leads.id, entityId))
          .limit(1);

        if (l?.status === "convertido") {
          skipReason = "entity_converted";
          await finalize(job.id, "skipped", { skipReason });
          skipped++;
          log("info", `Job ${job.id} saltado — lead ya convertido`, { entityId });
          continue;
        }
      }

      // Verificar maxSendsPerEntity — contar envíos anteriores de esta regla sobre la misma entidad
      const [{ alreadySent }] = await db
        .select({ alreadySent: count() })
        .from(emailScheduledJobs)
        .where(and(
          eq(emailScheduledJobs.relatedEntityType, entityType),
          eq(emailScheduledJobs.relatedEntityId, entityId),
          eq(emailScheduledJobs.templateKey, job.templateKey),
          eq(emailScheduledJobs.ruleId, job.ruleId),
          eq(emailScheduledJobs.status, "sent"),
        ));

      if ((alreadySent as number) >= rule.maxSendsPerEntity) {
        skipReason = "max_sends_reached";
        await finalize(job.id, "skipped", { skipReason });
        skipped++;
        continue;
      }

      // Resolver contenido. Para templates comerciales (commercial_reminder_X)
      // renderizamos con el builder usando datos reales del quote — el bodyHtml
      // seedeado en email_templates tiene datos de ejemplo hardcodeados.
      // Para el resto, prioridad: email_templates.bodyHtml > rule.emailBody.
      const commercialBuilder = COMMERCIAL_TEMPLATE_BUILDERS[job.templateKey];
      const useCommercialBuilder = commercialBuilder && commercialEmailData;

      const resolvedSubject = rule.emailSubject ?? template?.subject ?? null;
      const resolvedHtml = useCommercialBuilder
        ? commercialBuilder!(commercialEmailData!)
        : template?.bodyHtml
          ? template.bodyHtml
          : rule.emailBody
            ? `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">${rule.emailBody}</div>`
            : null;

      if (!resolvedSubject || !resolvedHtml || !job.recipientEmail) {
        skipReason = "missing_content";
        await finalize(job.id, "skipped", { skipReason });
        skipped++;
        continue;
      }

      finalSubject = resolvedSubject;
      const html = resolvedHtml;

      // Enviar (mergeGlobalCc en mailer.ts añade reservas@ automáticamente)
      const ok = await sendEmail({ to: job.recipientEmail, subject: finalSubject, html });
      status = ok ? "sent" : "failed";
      provider = process.env.BREVO_API_KEY ? "brevo" : "smtp";

      if (ok) {
        sent++;
        log("info", "Email automático enviado", { jobId: job.id, to: job.recipientEmail, rule: rule.name, subject: finalSubject, contentSource: template ? "email_templates" : "rule_body" });

        // Si la regla es commercial-aware, sincronizar tracking comercial + campos legacy en quotes.
        if (rule.respectCommercialPause && entityType === "quote" && entityId) {
          try {
            const now = new Date();
            // Garantizar la fila de tracking
            await db.insert(quoteCommercialTracking)
              .values({ quoteId: entityId })
              .onDuplicateKeyUpdate({ set: { quoteId: entityId } });

            const [track] = await db
              .select({ reminderCount: quoteCommercialTracking.reminderCount })
              .from(quoteCommercialTracking)
              .where(eq(quoteCommercialTracking.quoteId, entityId))
              .limit(1);

            const newCount = (track?.reminderCount ?? 0) + 1;
            const cap = rule.maxCumulativeSendsPerEntity ?? null;
            const reachedMax = cap != null && newCount >= cap;
            const newStatus = reachedMax
              ? "paused"
              : newCount === 1 ? "reminder_1_sent"
              : newCount === 2 ? "reminder_2_sent"
              : "reminder_3_sent";

            await db.update(quoteCommercialTracking)
              .set({
                reminderCount: newCount,
                lastReminderAt: now,
                lastContactAt: now,
                lastContactChannel: "email",
                commercialStatus: newStatus as any,
                reminderPaused: reachedMax ? true : undefined as any,
                reminderPausedReason: reachedMax ? "max_reminders_reached" : undefined as any,
                updatedAt: now,
              })
              .where(eq(quoteCommercialTracking.quoteId, entityId));

            // Sincronizar campos legacy en quotes para que la UI antigua y los reportes
            // sigan viendo coherente reminderCount/lastReminderAt.
            await db.update(quotes)
              .set({
                reminderCount: newCount,
                lastReminderAt: now,
                updatedAt: now,
              } as any)
              .where(eq(quotes.id, entityId));
          } catch (trackErr: any) {
            log("warn", "No se pudo sincronizar tracking comercial", { jobId: job.id, entityId, error: trackErr?.message });
          }
        }
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

    // Registrar en email_comm_log
    try {
      await db.insert(emailCommLog).values({
        templateKey: job.templateKey,
        ruleId: job.ruleId,
        triggerEvent: `auto_rule_${job.ruleId}`,
        channel: "email",
        recipientEmail: job.recipientEmail ?? "",
        subject: finalSubject,
        status,
        provider,
        errorMessage,
        isAutomatic: true,
        skipReason,
        relatedEntityType: job.relatedEntityType,
        relatedEntityId: job.relatedEntityId,
      });
    } catch { /* no interrumpir el flujo */ }

    await finalize(job.id, status, { skipReason, errorMessage });
  }

  log("info", `Job completado — sent:${sent} skipped:${skipped} failed:${failed}`);
  return { processed: jobs.length, sent, skipped, failed };
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
