/**
 * vapiCalls.ts — tRPC router para el módulo Agente IA Vapi.
 * Todos los procedimientos de lectura/escritura que consume el frontend.
 */

import { z } from "zod";
import { staffProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc, and, sql, isNotNull } from "drizzle-orm";
import { vapiCalls } from "../../drizzle/schema";
import { createLead } from "../db";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const VAPI_BASE_URL = "https://api.vapi.ai";

// ─── Extracción de nombre/email desde transcript ──────────────────────────────

export function extractFromTranscript(transcript: string | null | undefined): {
  name: string | null;
  email: string | null;
} {
  if (!transcript) return { name: null, email: null };

  // Email: primera dirección de email válida que aparece en el texto
  const emailMatch = transcript.match(
    /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/,
  );
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;

  // Nombre: patrones en español comunes en conversaciones de voz
  const namePatterns = [
    /(?:mi nombre es|me llamo|soy)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+){1,3})/i,
    /(?:User:|Cliente:)\s*(?:.*?(?:mi nombre es|me llamo|soy)\s+)([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+){1,3})/i,
  ];
  let name: string | null = null;
  for (const pattern of namePatterns) {
    const m = transcript.match(pattern);
    if (m?.[1]) {
      name = m[1].trim();
      break;
    }
  }

  return { name, email };
}

async function getVapiCredentials(): Promise<{ apiKey: string; webhookSecret: string }> {
  try {
    const [rows]: any = await _pool.execute(
      "SELECT `key`, `value` FROM site_settings WHERE `key` IN ('vapiApiKey','vapiWebhookSecret')"
    );
    const map: Record<string, string> = {};
    for (const r of (rows as any[])) map[r.key] = r.value ?? "";
    return {
      apiKey: process.env.VAPI_API_KEY || map.vapiApiKey || "",
      webhookSecret: process.env.VAPI_WEBHOOK_SECRET || map.vapiWebhookSecret || "",
    };
  } catch {
    return {
      apiKey: process.env.VAPI_API_KEY || "",
      webhookSecret: process.env.VAPI_WEBHOOK_SECRET || "",
    };
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const vapiCallsRouter = router({

  // ─── KPIs / estadísticas ─────────────────────────────────────────────────
  getStats: staffProcedure.query(async () => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const [stats] = await db.select({
      total: sql<number>`COUNT(*)`,
      today: sql<number>`SUM(CASE WHEN startedAt >= ${startOfToday} THEN 1 ELSE 0 END)`,
      last7: sql<number>`SUM(CASE WHEN startedAt >= ${sevenDaysAgo} THEN 1 ELSE 0 END)`,
      ended: sql<number>`SUM(CASE WHEN status = 'ended' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN endedReason IN ('assistant-error','pipeline-error','server-error','twilio-failed') THEN 1 ELSE 0 END)`,
      unreviewed: sql<number>`SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END)`,
      withLead: sql<number>`SUM(CASE WHEN linkedLeadId IS NOT NULL THEN 1 ELSE 0 END)`,
    }).from(vapiCalls);

    return {
      total: Number(stats?.total ?? 0),
      today: Number(stats?.today ?? 0),
      last7: Number(stats?.last7 ?? 0),
      ended: Number(stats?.ended ?? 0),
      failed: Number(stats?.failed ?? 0),
      unreviewed: Number(stats?.unreviewed ?? 0),
      withLead: Number(stats?.withLead ?? 0),
      apiConfigured: !!(await getVapiCredentials()).apiKey,
    };
  }),

  // ─── Listar llamadas ──────────────────────────────────────────────────────
  listCalls: staffProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
      search: z.string().optional(),
      onlyUnreviewed: z.boolean().default(false),
      onlyWithLead: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];

      if (input.onlyUnreviewed) {
        conditions.push(eq(vapiCalls.reviewed, false));
      }
      if (input.onlyWithLead) {
        conditions.push(isNotNull(vapiCalls.linkedLeadId));
      }
      if (input.search) {
        const s = `%${input.search}%`;
        conditions.push(
          sql`(${vapiCalls.phoneNumber} LIKE ${s} OR ${vapiCalls.customerName} LIKE ${s} OR ${vapiCalls.customerEmail} LIKE ${s})`
        );
      }

      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, countRows] = await Promise.all([
        db.select({
          id: vapiCalls.id,
          vapiCallId: vapiCalls.vapiCallId,
          phoneNumber: vapiCalls.phoneNumber,
          customerName: vapiCalls.customerName,
          customerEmail: vapiCalls.customerEmail,
          structuredData: vapiCalls.structuredData,
          startedAt: vapiCalls.startedAt,
          endedAt: vapiCalls.endedAt,
          durationSeconds: vapiCalls.durationSeconds,
          status: vapiCalls.status,
          endedReason: vapiCalls.endedReason,
          summary: vapiCalls.summary,
          reviewed: vapiCalls.reviewed,
          linkedLeadId: vapiCalls.linkedLeadId,
          recordingUrl: vapiCalls.recordingUrl,
          createdAt: vapiCalls.createdAt,
        })
          .from(vapiCalls)
          .where(where)
          .orderBy(desc(vapiCalls.startedAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(vapiCalls).where(where),
      ]);

      return {
        rows,
        total: Number(countRows[0]?.count ?? 0),
      };
    }),

  // ─── Detalle de una llamada ───────────────────────────────────────────────
  getCall: staffProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(vapiCalls)
        .where(eq(vapiCalls.id, input.id))
        .limit(1);
      if (!row) return null;
      return row;
    }),

  // ─── Marcar como revisada ─────────────────────────────────────────────────
  markReviewed: staffProcedure
    .input(z.object({ id: z.number(), reviewed: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(vapiCalls)
        .set({ reviewed: input.reviewed, updatedAt: new Date() })
        .where(eq(vapiCalls.id, input.id));
      return { ok: true };
    }),

  // ─── Crear lead desde llamada ─────────────────────────────────────────────
  createLeadFromCall: staffProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [call] = await db.select().from(vapiCalls)
        .where(eq(vapiCalls.id, input.id))
        .limit(1);

      if (!call) throw new Error("Llamada no encontrada");
      if (call.linkedLeadId) return { ok: true, leadId: call.linkedLeadId, existing: true };

      const notes = [
        call.summary ? `Resumen IA: ${call.summary}` : "",
        call.transcript ? `\nTranscripción:\n${call.transcript.slice(0, 2000)}` : "",
      ].filter(Boolean).join("\n");

      const { id: leadId } = await createLead({
        name: call.customerName || "Llamada Vapi",
        email: call.customerEmail || `vapi-${call.vapiCallId}@noreply.nayade`,
        phone: call.phoneNumber ?? undefined,
        message: notes || "Lead creado desde llamada del Agente IA Vapi",
        source: "Agente IA Vapi",
      });

      await db.update(vapiCalls)
        .set({ linkedLeadId: leadId, reviewed: true, updatedAt: new Date() })
        .where(eq(vapiCalls.id, input.id));

      return { ok: true, leadId, existing: false };
    }),

  // ─── Credenciales del módulo ─────────────────────────────────────────────
  getCredentials: staffProcedure.query(async () => {
    const [rows]: any = await _pool.execute(
      "SELECT `key`, `value` FROM site_settings WHERE `key` IN ('vapiApiKey','vapiWebhookSecret')"
    ).catch(() => [[]]);
    const map: Record<string, string> = {};
    for (const r of (rows as any[])) map[r.key] = r.value ?? "";
    const apiKey = process.env.VAPI_API_KEY || map.vapiApiKey || "";
    const webhookSecret = process.env.VAPI_WEBHOOK_SECRET || map.vapiWebhookSecret || "";
    return {
      hasApiKey: !!apiKey,
      apiKeyMasked: apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : "",
      webhookSecret,
    };
  }),

  saveCredentials: staffProcedure
    .input(z.object({
      apiKey: z.string().default(""),
      webhookSecret: z.string().default(""),
    }))
    .mutation(async ({ input }) => {
      // Solo actualizar si se proporciona un valor real (no "KEEP" ni vacío)
      if (input.apiKey && input.apiKey !== "KEEP") {
        await _pool.execute(
          "INSERT INTO site_settings (`key`, `value`, `type`, updatedAt) VALUES (?, ?, 'text', NOW()) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updatedAt = NOW()",
          ["vapiApiKey", input.apiKey]
        );
      }
      if (input.webhookSecret) {
        await _pool.execute(
          "INSERT INTO site_settings (`key`, `value`, `type`, updatedAt) VALUES (?, ?, 'text', NOW()) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updatedAt = NOW()",
          ["vapiWebhookSecret", input.webhookSecret]
        );
      }
      return { ok: true };
    }),

  // ─── Sincronizar llamadas desde API de Vapi ───────────────────────────────
  syncCalls: staffProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .mutation(async ({ input }) => {
      const { apiKey } = await getVapiCredentials();
      if (!apiKey) {
        throw new Error("API Key de Vapi no configurada. Guárdala en la sección de Configuración del módulo.");
      }

      const res = await fetch(`${VAPI_BASE_URL}/call?limit=${input.limit}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Error de Vapi API: HTTP ${res.status} — ${errText.slice(0, 120)}`);
      }

      const data: any = await res.json();
      const calls: any[] = Array.isArray(data) ? data : (data?.calls ?? data?.data ?? []);

      let inserted = 0;
      let updated = 0;
      let errors = 0;

      for (const c of calls) {
        const vapiCallId: string = c.id;
        if (!vapiCallId) continue;

        const startedAt = c.startedAt ? new Date(c.startedAt) : undefined;
        const endedAt = c.endedAt ? new Date(c.endedAt) : undefined;
        let durationSeconds: number | undefined;
        if (c.duration) durationSeconds = Math.round(c.duration);
        else if (startedAt && endedAt) {
          durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
        }

        const recordingUrl = c.recordingUrl ?? c.artifact?.recordingUrl ?? undefined;
        const transcript = c.transcript ?? c.artifact?.transcript ?? undefined;
        const summary = c.analysis?.summary ?? c.summary ?? undefined;
        const structuredData = c.analysis?.structuredData ?? undefined;
        const phoneNumber = c.customer?.number ?? c.customer?.phoneNumber ?? undefined;
        const sd = structuredData ?? {};
        const customerName =
          sd.name ?? sd.customerName ?? sd.nombre ?? sd.fullName ??
          c.customer?.name ?? undefined;
        const customerEmail =
          sd.email ?? sd.customerEmail ?? sd.correo ?? sd.emailAddress ??
          c.customer?.email ?? undefined;

        try {
          const existing = await db.select({ id: vapiCalls.id }).from(vapiCalls)
            .where(eq(vapiCalls.vapiCallId, vapiCallId)).limit(1);

          if (existing.length === 0) {
            await db.insert(vapiCalls).values({
              vapiCallId,
              assistantId: c.assistantId ?? undefined,
              phoneNumber,
              customerName,
              customerEmail,
              startedAt,
              endedAt,
              durationSeconds,
              status: c.status ?? undefined,
              endedReason: c.endedReason ?? undefined,
              recordingUrl,
              transcript,
              summary,
              structuredData,
              rawPayload: c,
            });
            inserted++;
          } else {
            await db.update(vapiCalls)
              .set({
                ...(customerName ? { customerName } : {}),
                ...(customerEmail ? { customerEmail } : {}),
                endedAt,
                durationSeconds,
                status: c.status ?? undefined,
                endedReason: c.endedReason ?? undefined,
                recordingUrl,
                transcript,
                summary,
                structuredData,
                updatedAt: new Date(),
              })
              .where(eq(vapiCalls.vapiCallId, vapiCallId));
            updated++;
          }
        } catch (e: any) {
          console.error("[VAPI Sync] Error upserting call:", vapiCallId, e.message);
          errors++;
        }
      }

      // Backfill: rellenar nombre/email desde rawPayload para registros sin datos
      try {
        await _pool.execute(`
          UPDATE vapi_calls SET
            customerName = COALESCE(
              customerName,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.name')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.customerName')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.nombre')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.fullName')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.analysis.structuredData.name')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.analysis.structuredData.nombre')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.call.customer.name')), 'null')
            ),
            customerEmail = COALESCE(
              customerEmail,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.email')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.customerEmail')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.correo')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.message.analysis.structuredData.emailAddress')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.analysis.structuredData.email')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.analysis.structuredData.correo')), 'null'),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rawPayload, '$.call.customer.email')), 'null')
            ),
            updatedAt = NOW()
          WHERE rawPayload IS NOT NULL
            AND (customerName IS NULL OR customerEmail IS NULL)
        `);
      } catch (backfillErr: any) {
        console.warn("[VAPI Sync] Backfill parcial:", backfillErr.message);
      }

      // Backfill desde transcript: para registros que siguen sin nombre/email
      // pero tienen transcript (structuredData vacío es lo habitual sin analysisPlan)
      try {
        const [missing]: any = await _pool.execute(
          `SELECT id, transcript FROM vapi_calls
           WHERE transcript IS NOT NULL
             AND (customerName IS NULL OR customerEmail IS NULL)
           LIMIT 200`,
        );
        let transcriptUpdates = 0;
        for (const row of missing as any[]) {
          const { name, email } = extractFromTranscript(row.transcript);
          if (!name && !email) continue;
          const sets: string[] = ["updatedAt = NOW()"];
          const vals: any[] = [];
          if (name)  { sets.push("customerName = COALESCE(customerName, ?)");  vals.push(name); }
          if (email) { sets.push("customerEmail = COALESCE(customerEmail, ?)"); vals.push(email); }
          vals.push(row.id);
          await _pool.execute(
            `UPDATE vapi_calls SET ${sets.join(", ")} WHERE id = ?`,
            vals,
          );
          transcriptUpdates++;
        }
        if (transcriptUpdates > 0) {
          console.log(`[VAPI Sync] Backfill transcript: ${transcriptUpdates} registros actualizados`);
        }
      } catch (transcriptErr: any) {
        console.warn("[VAPI Sync] Backfill transcript error:", transcriptErr.message);
      }

      return {
        ok: true,
        total: calls.length,
        inserted,
        updated,
        errors,
      };
    }),
});
