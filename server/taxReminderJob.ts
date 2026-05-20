/**
 * taxReminderJob.ts — Cron de avisos de vencimiento fiscal (Gestoría e Impuestos).
 *
 * Frecuencia: diario a las 08:00 ("0 8 * * *").
 * Feature flag: tax_reminder_job_enabled (activo por defecto).
 *
 * Flujo:
 * 1. Buscar obligaciones abiertas con vencimiento futuro.
 * 2. Para cada una, determinar el umbral de aviso aplicable (15 / 7 / 1 días).
 * 3. Si aún no se envió un aviso para ese umbral (o uno menor), enviar email
 *    al correo de contabilidad y a los correos de la gestoría, y registrar el
 *    umbral en `last_reminder_days` (idempotencia: nunca repite un aviso).
 */

import cron from "node-cron";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, gte, notInArray } from "drizzle-orm";
import { taxObligations, taxSettings } from "../drizzle/schema";
import { sendEmail } from "./mailer";
import { getBusinessEmail } from "./config";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

// Umbrales de aviso (días antes del vencimiento), de mayor a menor.
const THRESHOLDS = [15, 7, 1];

const MODEL_NAME: Record<string, string> = {
  "303": "Modelo 303 (IVA)",
  "390": "Modelo 390 (resumen anual IVA)",
  "111": "Modelo 111 (retenciones IRPF)",
  "190": "Modelo 190 (resumen anual retenciones)",
  "200": "Modelo 200 (Impuesto de Sociedades)",
  "202": "Modelo 202 (pago fraccionado IS)",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(date: string): number {
  const d = new Date(date + "T00:00:00");
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

function reminderHtml(o: { model: string; periodLabel: string; dueDate: string; estimatedAmount: string | null }, days: number): string {
  const amount = Number(o.estimatedAmount ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 });
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
      <h2 style="color:#ea580c">⏰ Vencimiento fiscal próximo</h2>
      <p>Se acerca el vencimiento de una obligación fiscal:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 0;color:#666">Modelo</td><td style="padding:6px 0;font-weight:bold">${MODEL_NAME[o.model] ?? o.model}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Periodo</td><td style="padding:6px 0">${o.periodLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Vencimiento</td><td style="padding:6px 0;font-weight:bold;color:#dc2626">${o.dueDate} (${days === 0 ? "hoy" : `en ${days} día(s)`})</td></tr>
        <tr><td style="padding:6px 0;color:#666">Importe estimado</td><td style="padding:6px 0">${amount} €</td></tr>
      </table>
      <p style="color:#666;font-size:13px">Aviso automático del módulo Gestoría e Impuestos · Náyade Experiences.
      El importe es una estimación; la presentación oficial corresponde a la gestoría.</p>
    </div>`;
}

/** Ejecuta una pasada del cron. Exportada para poder dispararla manualmente. */
export async function runTaxReminderJob(): Promise<{ checked: number; sent: number }> {
  const today = todayISO();

  const obs = await db
    .select()
    .from(taxObligations)
    .where(and(
      gte(taxObligations.dueDate, today),
      notInArray(taxObligations.status, ["pagado", "cerrado", "presentado", "aplazado"]),
    ));

  if (obs.length === 0) return { checked: 0, sent: 0 };

  // Destinatarios: contabilidad + correos de la gestoría configurados.
  const accountingEmail = await getBusinessEmail("accounting");
  const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.id, 1));
  const gestoriaEmails = (settings?.gestoriaEmails ?? "")
    .split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const recipients = Array.from(new Set([accountingEmail, ...gestoriaEmails].filter(Boolean)));
  if (recipients.length === 0) return { checked: obs.length, sent: 0 };

  let sent = 0;
  for (const o of obs) {
    const d = daysUntil(o.dueDate);
    // Umbral aplicable: el menor umbral que el plazo ya ha alcanzado.
    const bucket = THRESHOLDS.filter((t) => d <= t).sort((a, b) => a - b)[0];
    if (bucket == null) continue; // vencimiento aún lejano
    // ¿Ya se avisó de este umbral (o uno menor)? → no repetir.
    if (o.lastReminderDays != null && o.lastReminderDays <= bucket) continue;

    const html = reminderHtml(o, d);
    const subject = `⏰ Vencimiento fiscal — ${MODEL_NAME[o.model] ?? o.model} · ${o.periodLabel}`;
    for (const to of recipients) {
      try {
        await sendEmail({ to, subject, html });
      } catch (e) {
        console.warn(`[TaxReminderJob] Email no enviado a ${to}:`, (e as Error).message);
      }
    }
    await db.update(taxObligations)
      .set({ lastReminderDays: bucket })
      .where(eq(taxObligations.id, o.id));
    sent++;
  }

  console.log(`[TaxReminderJob] Comprobadas ${obs.length} obligaciones — ${sent} aviso(s) enviado(s)`);
  return { checked: obs.length, sent };
}

export function startTaxReminderJob(): void {
  console.log("[Jobs] Iniciando cron tax_reminder_job (0 8 * * *)");
  cron.schedule("0 8 * * *", async () => {
    try {
      await runTaxReminderJob();
    } catch (err: any) {
      console.error("[TaxReminderJob] Error inesperado:", err?.stack ?? err);
    }
  });
}
