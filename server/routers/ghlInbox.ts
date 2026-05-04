/**
 * ghlInbox.ts — tRPC router para el módulo WhatsApp GHL Inbox.
 * Proporciona todos los procedimientos de lectura/escritura que consume el frontend.
 */

import { z } from "zod";
import { staffProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc, and, or, like, isNotNull, sql } from "drizzle-orm";
import { ghlConversations, ghlMessages, ghlWebhookEvents, siteSettings } from "../../drizzle/schema";
import { getGHLCredentials } from "../db";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

export const ghlInboxRouter = router({
  // ─── Listar conversaciones ────────────────────────────────────────────────
  listConversations: staffProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(["new", "open", "pending", "replied", "closed", "all"]).default("all"),
      filter: z.enum(["all", "unread", "starred", "linked_quote", "linked_reservation"]).default("all"),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];

      if (input.status !== "all") {
        conditions.push(eq(ghlConversations.status, input.status));
      }

      if (input.filter === "unread") {
        conditions.push(sql`${ghlConversations.unreadCount} > 0`);
      } else if (input.filter === "starred") {
        conditions.push(eq(ghlConversations.starred, true));
      } else if (input.filter === "linked_quote") {
        conditions.push(isNotNull(ghlConversations.linkedQuoteId));
      } else if (input.filter === "linked_reservation") {
        conditions.push(isNotNull(ghlConversations.linkedReservationId));
      }

      if (input.search) {
        const s = `%${input.search}%`;
        conditions.push(
          or(
            like(ghlConversations.customerName, s),
            like(ghlConversations.phone, s),
            like(ghlConversations.email, s),
            like(ghlConversations.lastMessagePreview, s),
          )
        );
      }

      const where = conditions.length ? and(...conditions) : undefined;

      const [rows, countRows] = await Promise.all([
        db.select().from(ghlConversations)
          .where(where)
          .orderBy(desc(ghlConversations.lastMessageAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(ghlConversations).where(where),
      ]);

      return {
        rows,
        total: Number(countRows[0]?.count ?? 0),
      };
    }),

  // ─── Obtener mensajes de una conversación ─────────────────────────────────
  getMessages: staffProcedure
    .input(z.object({
      ghlConversationId: z.string(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const msgs = await db.select().from(ghlMessages)
        .where(eq(ghlMessages.ghlConversationId, input.ghlConversationId))
        .orderBy(ghlMessages.sentAt)
        .limit(input.limit);

      // Marcar como leído al abrir
      await _pool.execute(
        "UPDATE ghl_conversations SET unreadCount = 0, updatedAt = NOW() WHERE ghlConversationId = ?",
        [input.ghlConversationId]
      );

      return msgs;
    }),

  // ─── Actualizar estado de conversación ───────────────────────────────────
  updateStatus: staffProcedure
    .input(z.object({
      ghlConversationId: z.string(),
      status: z.enum(["new", "open", "pending", "replied", "closed"]),
    }))
    .mutation(async ({ input }) => {
      await db.update(ghlConversations)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(ghlConversations.ghlConversationId, input.ghlConversationId));
      return { ok: true };
    }),

  // ─── Marcar como destacada ───────────────────────────────────────────────
  toggleStarred: staffProcedure
    .input(z.object({
      ghlConversationId: z.string(),
      starred: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await db.update(ghlConversations)
        .set({ starred: input.starred, updatedAt: new Date() })
        .where(eq(ghlConversations.ghlConversationId, input.ghlConversationId));
      return { ok: true };
    }),

  // ─── Vincular presupuesto ────────────────────────────────────────────────
  linkQuote: staffProcedure
    .input(z.object({
      ghlConversationId: z.string(),
      quoteId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.update(ghlConversations)
        .set({ linkedQuoteId: input.quoteId ?? undefined, updatedAt: new Date() })
        .where(eq(ghlConversations.ghlConversationId, input.ghlConversationId));
      return { ok: true };
    }),

  // ─── Vincular reserva ────────────────────────────────────────────────────
  linkReservation: staffProcedure
    .input(z.object({
      ghlConversationId: z.string(),
      reservationId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.update(ghlConversations)
        .set({ linkedReservationId: input.reservationId ?? undefined, updatedAt: new Date() })
        .where(eq(ghlConversations.ghlConversationId, input.ghlConversationId));
      return { ok: true };
    }),

  // ─── Asignar usuario interno ─────────────────────────────────────────────
  assignUser: staffProcedure
    .input(z.object({
      ghlConversationId: z.string(),
      userId: z.number().nullable(),
    }))
    .mutation(async ({ input }) => {
      await db.update(ghlConversations)
        .set({ assignedUserId: input.userId ?? undefined, updatedAt: new Date() })
        .where(eq(ghlConversations.ghlConversationId, input.ghlConversationId));
      return { ok: true };
    }),

  // ─── Credenciales del módulo inbox ──────────────────────────────────────
  getInboxCredentials: staffProcedure
    .query(async () => {
      const rows = await db.select().from(siteSettings)
        .where(sql`${siteSettings.key} IN ('ghlInboxToken','ghlInboxLocationId')`);
      const map = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
      const token = map.ghlInboxToken ?? "";
      return {
        hasToken: !!token,
        tokenMasked: token ? `${token.slice(0, 10)}…${token.slice(-4)}` : "",
        locationId: map.ghlInboxLocationId ?? "",
      };
    }),

  saveInboxCredentials: staffProcedure
    .input(z.object({
      token: z.string().min(1),
      locationId: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      await _pool.execute(
        "INSERT INTO site_settings (`key`, `value`, `type`, updatedAt) VALUES (?, ?, 'text', NOW()) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updatedAt = NOW()",
        ["ghlInboxToken", input.token]
      );
      await _pool.execute(
        "INSERT INTO site_settings (`key`, `value`, `type`, updatedAt) VALUES (?, ?, 'text', NOW()) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updatedAt = NOW()",
        ["ghlInboxLocationId", input.locationId]
      );
      return { ok: true };
    }),

  // ─── Diagnóstico: últimos eventos de webhook ─────────────────────────────
  listWebhookEvents: staffProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(30) }))
    .query(async ({ input }) => {
      const rows = await db.select().from(ghlWebhookEvents)
        .orderBy(desc(ghlWebhookEvents.receivedAt))
        .limit(input.limit);
      return rows;
    }),

  // ─── KPIs rápidos ────────────────────────────────────────────────────────
  getStats: staffProcedure
    .query(async () => {
      const [stats] = await db.select({
        total: sql<number>`COUNT(*)`,
        unread: sql<number>`SUM(CASE WHEN unreadCount > 0 THEN 1 ELSE 0 END)`,
        open: sql<number>`SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)`,
        replied: sql<number>`SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END)`,
        closed: sql<number>`SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END)`,
        withQuote: sql<number>`SUM(CASE WHEN linkedQuoteId IS NOT NULL THEN 1 ELSE 0 END)`,
        withReservation: sql<number>`SUM(CASE WHEN linkedReservationId IS NOT NULL THEN 1 ELSE 0 END)`,
      }).from(ghlConversations);

      const [evtStats] = await db.select({
        totalEvents: sql<number>`COUNT(*)`,
        failed: sql<number>`SUM(CASE WHEN processedStatus = 'failed' THEN 1 ELSE 0 END)`,
        lastReceived: sql<string>`MAX(receivedAt)`,
      }).from(ghlWebhookEvents);

      return {
        conversations: {
          total: Number(stats?.total ?? 0),
          unread: Number(stats?.unread ?? 0),
          open: Number(stats?.open ?? 0),
          pending: Number(stats?.pending ?? 0),
          replied: Number(stats?.replied ?? 0),
          closed: Number(stats?.closed ?? 0),
          withQuote: Number(stats?.withQuote ?? 0),
          withReservation: Number(stats?.withReservation ?? 0),
        },
        webhooks: {
          total: Number(evtStats?.totalEvents ?? 0),
          failed: Number(evtStats?.failed ?? 0),
          lastReceived: evtStats?.lastReceived ?? null,
        },
        configured: await (async () => {
          const rows = await db.select().from(siteSettings)
            .where(sql`${siteSettings.key} IN ('ghlInboxToken','ghlInboxLocationId','ghlApiKey','ghlLocationId')`);
          const map = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
          const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
            || map.ghlInboxToken || map.ghlApiKey || "";
          const locId = process.env.GHL_LOCATION_ID
            || map.ghlInboxLocationId || map.ghlLocationId || "";
          return {
            hasToken: !!token,
            hasLocation: !!locId,
            webhookEnabled: process.env.GHL_WEBHOOK_ENABLED !== "false",
            webhookSecret: process.env.GHL_WEBHOOK_SECRET || "",
          };
        })(),
      };
    }),
});
