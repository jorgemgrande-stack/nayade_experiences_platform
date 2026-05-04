/**
 * commercialFollowupJob.ts — Cron de seguimiento comercial de presupuestos.
 *
 * Sustituye la lógica rígida de quoteReminderJob.ts con reglas configurables
 * desde la interfaz de Atención Comercial. quoteReminderJob.ts se mantiene
 * intacto para compatibilidad; ambos pueden coexistir con sus propios flags.
 *
 * Frecuencia: cada hora ("0 * * * *")
 * Feature flag: commercial_followup_job_enabled
 *
 * Flujo:
 * 1. Cargar configuración global y reglas activas.
 * 2. Verificar ventana horaria permitida (Europe/Madrid).
 * 3. Para cada regla, buscar presupuestos elegibles.
 * 4. Validar anti-duplicados (uq_comm_quote_rule).
 * 5. Enviar email, registrar comunicación, actualizar tracking.
 */

import cron from "node-cron";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, isNull, isNotNull, lte, sql, lt } from "drizzle-orm";
import {
  quotes,
  leads,
  commercialFollowupSettings,
  commercialFollowupRules,
  quoteCommercialTracking,
  commercialCommunications,
} from "../drizzle/schema";
import { sendEmail } from "./mailer";
import {
  buildCommercialReminder1Html,
  buildCommercialReminder2Html,
  buildCommercialReminder3Html,
  type CommercialReminderEmailData,
} from "./emailTemplates";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
const db = drizzle(_pool);

function log(level: "info" | "warn" | "error", msg: string, ctx?: object) {
  const entry = { ts: new Date().toISOString(), context: "CommercialFollowup", msg, ...ctx };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Hora actual en Europe/Madrid en formato "HH:MM" */
function madridTimeHHMM(): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function isWithinWindow(start: string, end: string): boolean {
  const now = madridTimeHHMM();
  return now >= start && now <= end;
}

function pickTemplate(reminderCount: number, data: CommercialReminderEmailData): string {
  if (reminderCount <= 1) return buildCommercialReminder1Html(data);
  if (reminderCount === 2) return buildCommercialReminder2Html(data);
  return buildCommercialReminder3Html(data);
}

async function ensureTracking(quoteId: number): Promise<void> {
  try {
    await db.insert(quoteCommercialTracking).values({ quoteId }).onDuplicateKeyUpdate({ set: { quoteId } });
  } catch { /* already exists */ }
}

export async function runCommercialFollowupJob(): Promise<void> {
  log("info", "Job iniciado");

  // 1. Cargar configuración global
  const [settings] = await db.select().from(commercialFollowupSettings).limit(1);
  if (!settings || !settings.enabled) {
    log("info", "Sistema desactivado en configuración — job omitido");
    return;
  }

  // 2. Ventana horaria
  if (!isWithinWindow(settings.allowedSendStart, settings.allowedSendEnd)) {
    log("info", `Fuera de ventana horaria ${settings.allowedSendStart}-${settings.allowedSendEnd} (Madrid) — job omitido`);
    return;
  }

  // 3. Cargar reglas activas
  const rules = await db
    .select()
    .from(commercialFollowupRules)
    .where(eq(commercialFollowupRules.isActive, true))
    .orderBy(commercialFollowupRules.sortOrder);

  if (!rules.length) {
    log("info", "Sin reglas activas — job omitido");
    return;
  }

  let totalSent = 0;
  const maxEmails = settings.maxEmailsPerRun;
  const stopAfterMs = settings.stopAfterDays * 86400 * 1000;

  for (const rule of rules) {
    if (totalSent >= maxEmails) break;

    const triggerMs = rule.delayHours * 3600 * 1000;
    const triggerBefore = new Date(Date.now() - triggerMs);

    // Condiciones base: presupuesto enviado, sin pagar, sin perder, sentAt viejo suficiente
    const conditions: any[] = [
      eq(quotes.status, "enviado"),
      isNull(quotes.paidAt),
      isNotNull(quotes.sentAt),
      lte(quotes.sentAt, triggerBefore),
    ];

    // Límite de días máximos
    const stopBefore = new Date(Date.now() - stopAfterMs);
    conditions.push(sql`${quotes.sentAt} >= ${stopBefore}`);

    // Solo si no ha sido visto (si la regla lo requiere)
    if (rule.onlyIfNotViewed) conditions.push(isNull(quotes.viewedAt));

    // Obtener candidatos (sin los ya enviados para esta regla — se filtra en el insert)
    const candidates = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        title: quotes.title,
        total: quotes.total,
        paymentLinkUrl: quotes.paymentLinkUrl,
        sentAt: quotes.sentAt,
        viewedAt: quotes.viewedAt,
        reminderCount: quotes.reminderCount,
        clientName: leads.name,
        clientEmail: leads.email,
        reminderPaused: quoteCommercialTracking.reminderPaused,
        trackingReminderCount: quoteCommercialTracking.reminderCount,
        commercialStatus: quoteCommercialTracking.commercialStatus,
      })
      .from(quotes)
      .leftJoin(leads, eq(leads.id, quotes.leadId))
      .leftJoin(quoteCommercialTracking, eq(quoteCommercialTracking.quoteId, quotes.id))
      .where(and(...conditions))
      .limit(maxEmails - totalSent + 10); // slight overquery, filter below

    for (const q of candidates) {
      if (totalSent >= maxEmails) break;

      // Skip if paused or terminal status
      if (q.reminderPaused) continue;
      const st = q.commercialStatus;
      if (st && ["lost", "converted", "discarded"].includes(st)) continue;

      // Skip if max total reminders exceeded
      const trackCount = q.trackingReminderCount ?? q.reminderCount ?? 0;
      if (trackCount >= settings.maxTotalRemindersPerQuote) continue;

      if (!q.clientEmail) continue;

      // Viewed but unpaid — check rule's allowIfViewedButUnpaid
      if (q.viewedAt && !rule.allowIfViewedButUnpaid) continue;

      // Anti-duplicate: insert with unique key quoteId+ruleId+type
      // If already sent for this rule, INSERT IGNORE will skip it
      const newCount = trackCount + 1;
      const emailData: CommercialReminderEmailData = {
        clientName: q.clientName ?? "Cliente",
        quoteNumber: q.quoteNumber,
        quoteTitle: q.title,
        total: q.total,
        paymentLinkUrl: q.paymentLinkUrl,
      };

      const subject = rule.emailSubject
        .replace("{{clientName}}", q.clientName ?? "Cliente")
        .replace("{{quoteNumber}}", q.quoteNumber);

      const emailDataWithCustom: CommercialReminderEmailData = {
        ...emailData,
        customSubject: subject,
        customBody: rule.emailBody
          .replace("{{clientName}}", q.clientName ?? "Cliente")
          .replace("{{quoteNumber}}", q.quoteNumber),
      };

      const html = pickTemplate(newCount, emailDataWithCustom);

      let sent = false;
      try {
        sent = await sendEmail({ to: q.clientEmail, subject, html });
      } catch (err: any) {
        log("error", "Error enviando email", { quoteId: q.id, error: err.message });
      }

      // Record communication — INSERT IGNORE because of UNIQUE KEY uq_comm_quote_rule
      try {
        await db.execute(sql`
          INSERT IGNORE INTO commercial_communications
            (quoteId, customerEmail, type, channel, subject, bodySnapshot, ruleId, status, errorMessage, sentAt, createdAt)
          VALUES
            (${q.id}, ${q.clientEmail}, 'automatic_reminder', 'email', ${subject},
             ${rule.emailBody.slice(0, 500)}, ${rule.id},
             ${sent ? "sent" : "failed"}, NULL, NOW(), NOW())
        `);
      } catch (err: any) {
        log("warn", "No se pudo registrar comunicación (posible duplicado)", { quoteId: q.id, ruleId: rule.id });
        continue; // already sent for this rule
      }

      if (sent) {
        totalSent++;
        await ensureTracking(q.id);

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
          .where(eq(quoteCommercialTracking.quoteId, q.id));

        // También actualizar campos legacy en quotes para compatibilidad con quoteReminderJob
        await db.update(quotes)
          .set({
            reminderCount: newCount,
            lastReminderAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(quotes.id, q.id));

        log("info", "Recordatorio enviado", { quoteId: q.id, quoteNumber: q.quoteNumber, ruleId: rule.id, reminderCount: newCount });
      }
    }

    log("info", `Regla "${rule.name}" procesada — totalSent hasta ahora: ${totalSent}`);
  }

  log("info", `Job completado — emails enviados: ${totalSent}`);
}

export function startCommercialFollowupJob(): void {
  log("info", "Iniciando cron commercial_followup_job (0 * * * *)");
  cron.schedule("0 * * * *", async () => {
    try {
      await runCommercialFollowupJob();
    } catch (err: any) {
      log("error", "Error inesperado en CommercialFollowupJob", { stack: err?.stack });
    }
  });
}
