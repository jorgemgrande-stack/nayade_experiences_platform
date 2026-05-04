/**
 * vapiCalls.ts — tRPC router para el módulo Agente IA Vapi.
 * Todos los procedimientos de lectura/escritura que consume el frontend.
 */

import { z } from "zod";
import { staffProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc, and, sql, isNull, isNotNull, gte, lte } from "drizzle-orm";
import { vapiCalls, leads } from "../../drizzle/schema";
import { createLead } from "../db";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const VAPI_BASE_URL = "https://api.vapi.ai";

function getVapiApiKey(): string | null {
  return process.env.VAPI_API_KEY ?? null;
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
      apiConfigured: !!getVapiApiKey(),
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

      const leadId = await createLead({
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

  // ─── Sincronizar llamadas desde API de Vapi ───────────────────────────────
  syncCalls: staffProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .mutation(async ({ input }) => {
      const apiKey = getVapiApiKey();
      if (!apiKey) {
        throw new Error("VAPI_API_KEY no configurada. Añádela en las variables de entorno de Railway.");
      }

      const res = await fetch(`${VAPI_BASE_URL}/call?limit=${input.limit}&sortOrder=DESC`, {
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
        const customerName = c.customer?.name ?? undefined;

        try {
          const existing = await db.select({ id: vapiCalls.id }).from(vapiCalls)
            .where(eq(vapiCalls.vapiCallId, vapiCallId)).limit(1);

          if (existing.length === 0) {
            await db.insert(vapiCalls).values({
              vapiCallId,
              assistantId: c.assistantId ?? undefined,
              phoneNumber,
              customerName,
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

      return {
        ok: true,
        total: calls.length,
        inserted,
        updated,
        errors,
      };
    }),
});
