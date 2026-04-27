/**
 * cancellationStaleJob.ts
 * Job programado que se ejecuta cada 6 horas y envía una alerta interna
 * para expedientes de anulación que llevan más de 48h en estado "recibida"
 * sin ninguna actividad del equipo.
 */
import cron from "node-cron";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, eq, lt, sql } from "drizzle-orm";
import { cancellationRequests, cancellationLogs } from "../drizzle/schema";
import { sendEmail } from "./mailer";
import { getBusinessEmail, getSystemSettingSync } from "./config";
const STALE_HOURS = 48;

async function runCancellationStaleJob() {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
  const db = drizzle(pool);

  try {
    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

    // Expedientes en "recibida" creados hace más de 48h — aún sin tocar
    const stale = await db
      .select({
        id: cancellationRequests.id,
        fullName: cancellationRequests.fullName,
        email: cancellationRequests.email,
        reason: cancellationRequests.reason,
        activityDate: cancellationRequests.activityDate,
        locator: cancellationRequests.locator,
        createdAt: cancellationRequests.createdAt,
      })
      .from(cancellationRequests)
      .where(
        and(
          eq(cancellationRequests.operationalStatus, "recibida"),
          lt(cancellationRequests.createdAt, cutoff)
        )
      )
      .limit(50);

    if (stale.length === 0) return;

    // Filtrar los que ya tienen algún log de acción admin (excluir el log "created")
    const staleIds = stale.map((r) => r.id);
    const touched = await db
      .select({ requestId: cancellationLogs.requestId })
      .from(cancellationLogs)
      .where(
        and(
          sql`${cancellationLogs.requestId} IN (${sql.join(staleIds.map((id) => sql`${id}`), sql`, `)})`,
          sql`${cancellationLogs.actionType} NOT IN ('created', 'linked_reservation')`
        )
      );
    const touchedIds = new Set(touched.map((t) => t.requestId));
    const trulyStale = stale.filter((r) => !touchedIds.has(r.id));

    if (trulyStale.length === 0) return;

    // Email de alerta al equipo interno
    const rows = trulyStale
      .map((r) => {
        const hours = Math.round((Date.now() - new Date(r.createdAt).getTime()) / (60 * 60 * 1000));
        return `<tr>
          <td style="padding:4px 8px;border:1px solid #333;">#${r.id}</td>
          <td style="padding:4px 8px;border:1px solid #333;">${r.fullName}</td>
          <td style="padding:4px 8px;border:1px solid #333;">${r.email ?? "—"}</td>
          <td style="padding:4px 8px;border:1px solid #333;">${r.reason}</td>
          <td style="padding:4px 8px;border:1px solid #333;">${r.locator ?? "—"}</td>
          <td style="padding:4px 8px;border:1px solid #333;">${hours}h sin atender</td>
        </tr>`;
      })
      .join("");

    const html = `
      <h2 style="color:#d97706;">⚠ Anulaciones sin atender (más de ${STALE_HOURS}h)</h2>
      <p>Los siguientes expedientes de anulación llevan más de ${STALE_HOURS} horas en estado <strong>recibida</strong> sin ninguna acción del equipo:</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr style="background:#1a1a1a;color:#fff;">
            <th style="padding:4px 8px;border:1px solid #333;">#</th>
            <th style="padding:4px 8px;border:1px solid #333;">Cliente</th>
            <th style="padding:4px 8px;border:1px solid #333;">Email</th>
            <th style="padding:4px 8px;border:1px solid #333;">Motivo</th>
            <th style="padding:4px 8px;border:1px solid #333;">Localizador</th>
            <th style="padding:4px 8px;border:1px solid #333;">Tiempo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;">Gestiona estos expedientes en <a href="${process.env.APP_URL ?? getSystemSettingSync('brand_website_url', '')}/admin/crm?tab=anulaciones">CRM → Anulaciones</a>.</p>
    `;

    const copyEmail = await getBusinessEmail('cancellations');
    await sendEmail({
      to: copyEmail,
      subject: `⚠ ${trulyStale.length} anulación${trulyStale.length > 1 ? "es" : ""} sin atender (>48h)`,
      html,
    }).catch(() => {});

    console.log(`[CancellationStale] Alerta enviada: ${trulyStale.length} expedientes sin atender`);
  } catch (err) {
    console.error("[CancellationStale] Error en job:", err);
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Inicia el job programado.
 * Se ejecuta cada 6 horas (a las 8h, 14h, 20h, 2h).
 */
export function startCancellationStaleJob() {
  console.log("[CancellationStale] Job de expedientes sin atender iniciado (cada 6h)");
  cron.schedule("0 8,14,20,2 * * *", () => {
    runCancellationStaleJob().catch(console.error);
  });
}

