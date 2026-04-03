/**
 * quoteReminderJob.ts
 * Job programado que se ejecuta cada hora y reenvía el email de presupuesto
 * a los clientes que no lo han abierto en 48 horas.
 * También notifica al agente en el CRM cuando se produce un reenvío.
 */
import cron from "node-cron";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, eq, isNull, lt, isNotNull } from "drizzle-orm";
import { quotes, leads } from "../drizzle/schema";
import { buildQuoteHtml } from "./emailTemplates";
import { sendEmail } from "./mailer";
import { notifyOwner } from "./_core/notification";

const MAX_REMINDERS = 2; // máximo de reenvíos automáticos por presupuesto

async function runQuoteReminderJob() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  const db = drizzle(pool);

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // hace 48h

    // Presupuestos enviados, no vistos, no pagados, no rechazados, con token,
    // enviados hace más de 48h y con menos de MAX_REMINDERS reenvíos
    const pendingQuotes = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.status, "enviado"),
          isNull(quotes.viewedAt),
          isNull(quotes.paidAt),
          isNotNull(quotes.sentAt),
          isNotNull(quotes.paymentLinkToken),
          lt(quotes.sentAt, cutoff)
        )
      )
      .limit(50); // procesar máximo 50 por ejecución

    if (!pendingQuotes.length) {
      return;
    }

    let sentCount = 0;

    for (const quote of pendingQuotes) {
      // Verificar límite de reenvíos
      const reminderCount = (quote.reminderCount ?? 0) as number;
      if (reminderCount >= MAX_REMINDERS) {
        continue;
      }

      // Obtener datos del lead/cliente
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, quote.leadId))
        .limit(1);

      const clientEmail = lead?.email;
      const clientName = lead?.name ?? "Cliente";

      if (!clientEmail) continue;

      // Construir URL de aceptación
      const origin = process.env.VITE_APP_URL ?? process.env.OAUTH_SERVER_URL?.replace("api.", "") ?? "";
      const paymentLinkUrl = `${origin}/presupuesto/${quote.paymentLinkToken}`;

      // Construir el HTML del email
      const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
      const html = buildQuoteHtml({
        quoteNumber: quote.quoteNumber,
        title: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
        clientName,
        items,
        subtotal: String(quote.subtotal ?? quote.total),
        discount: String(quote.discount ?? 0),
        tax: String(quote.tax ?? 0),
        total: String(quote.total),
        validUntil: quote.validUntil ?? undefined,
        notes: quote.notes ?? undefined,
        conditions: quote.conditions ?? undefined,
        paymentLinkUrl,
      });

      try {
        await sendEmail({
          to: clientEmail,
          subject: `⏰ Recordatorio: tu presupuesto ${quote.quoteNumber} sigue disponible — Náyade Experiences`,
          html,
        });

        // Actualizar contador de reenvíos y sentAt al nuevo envío
        const now = new Date();
        await db
          .update(quotes)
          .set({
            reminderCount: (reminderCount + 1) as unknown as number,
            lastReminderAt: now,
            updatedAt: now,
          })
          .where(eq(quotes.id, quote.id));

        sentCount++;
        console.log(`[QuoteReminder] Recordatorio #${reminderCount + 1} enviado a ${clientEmail} para presupuesto ${quote.quoteNumber}`);
      } catch (emailErr) {
        console.error(`[QuoteReminder] Error enviando recordatorio para ${quote.quoteNumber}:`, emailErr);
      }
    }

    if (sentCount > 0) {
      await notifyOwner({
        title: `📬 ${sentCount} recordatorio${sentCount > 1 ? "s" : ""} de presupuesto enviado${sentCount > 1 ? "s" : ""}`,
        content: `El sistema ha reenviado automáticamente ${sentCount} presupuesto${sentCount > 1 ? "s" : ""} que no habían sido abiertos en 48 horas.`,
      });
    }
  } catch (err) {
    console.error("[QuoteReminder] Error en el job:", err);
  } finally {
    await pool.end();
  }
}

/**
 * Inicia el job programado.
 * Se ejecuta cada hora en el minuto 0.
 */
export function startQuoteReminderJob() {
  console.log("[QuoteReminder] Job de recordatorios iniciado (cada hora)");
  // Ejecutar inmediatamente al arrancar para no esperar 1h
  runQuoteReminderJob().catch(console.error);
  // Luego cada hora
  cron.schedule("0 * * * *", () => {
    runQuoteReminderJob().catch(console.error);
  });
}
