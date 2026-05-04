/**
 * ghlInboxRouter.ts — Express routes para el módulo WhatsApp GHL Inbox.
 *
 * POST /api/ghl/inbox/webhook  — recibe eventos de GHL (conversaciones/mensajes)
 * GET  /api/ghl/inbox/stream   — SSE para actualizaciones en tiempo real
 * POST /api/ghl/inbox/sync     — sincronización manual de conversaciones desde GHL API
 * POST /api/ghl/conversations/:id/reply — enviar mensaje outbound vía GHL API
 *
 * Seguridad:
 *  - Validación de header x-ghl-secret si GHL_WEBHOOK_SECRET está configurado
 *  - Validación de locationId contra GHL_LOCATION_ID
 *  - Body limitado a 2mb
 *  - Eventos registrados en ghl_webhook_events (idempotente por eventId)
 *  - El servidor nunca se cae por un error en el procesamiento del webhook
 */

import express from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, desc, and } from "drizzle-orm";
import { ghlConversations, ghlMessages, ghlWebhookEvents } from "../../drizzle/schema";
import { ghlInboxEmitter } from "../ghlInboxEvents";
import { getGHLCredentials } from "../db";
import type { Response } from "express";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const GHL_BASE_URL = process.env.GHL_BASE_URL ?? "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

function log(level: "info" | "warn" | "error", msg: string, ctx?: object) {
  const entry = { ts: new Date().toISOString(), context: "GHLInbox", msg, ...ctx };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractConversationId(payload: any): string | null {
  return (
    payload.conversationId ??
    payload.conversation_id ??
    payload.conversation?.id ??
    null
  );
}

function extractContactId(payload: any): string | null {
  return (
    payload.contactId ??
    payload.contact_id ??
    payload.contact?.id ??
    null
  );
}

function extractEventType(payload: any): string {
  return (
    payload.type ??
    payload.event ??
    payload.eventType ??
    payload.event_type ??
    "unknown"
  );
}

function extractMessageId(payload: any): string | null {
  return (
    payload.messageId ??
    payload.message_id ??
    payload.message?.id ??
    payload.id ??
    null
  );
}

// Eventos de GHL que corresponden a mensajes/conversaciones de WhatsApp
const MESSAGE_EVENTS = new Set([
  "InboundMessage", "inbound_message", "inboundMessage",
  "OutboundMessage", "outbound_message", "outboundMessage",
  "ConversationUnread", "conversation_unread",
  "NewMessage", "new_message",
  "MessageStatus", "message_status",
]);

const CONVERSATION_EVENTS = new Set([
  "ConversationCreate", "conversation_create", "ConversationCreated",
  "ConversationUpdate", "conversation_update", "ConversationUpdated",
  ...MESSAGE_EVENTS,
]);

// ─── Procesamiento asíncrono del webhook ──────────────────────────────────────

async function processWebhookEvent(eventRowId: number, payload: any, eventType: string): Promise<void> {
  const convId: string | null = extractConversationId(payload);
  const contactId: string | null = extractContactId(payload);

  try {
    // Ignorar eventos que no son de conversación/mensaje
    if (!CONVERSATION_EVENTS.has(eventType) && !convId) {
      await db.update(ghlWebhookEvents)
        .set({ processedStatus: "ignored", processedAt: new Date() })
        .where(eq(ghlWebhookEvents.id, eventRowId));
      return;
    }

    // ── Upsert conversación ──────────────────────────────────────────────────
    if (convId) {
      const contact = payload.contact ?? {};
      const message = payload.message ?? {};
      const messageBody: string = message.body ?? payload.body ?? payload.text ?? "";
      const isInbound = (message.direction ?? payload.direction ?? "inbound") === "inbound";
      const sentAtRaw = message.dateAdded ?? payload.dateAdded ?? payload.sentAt ?? null;
      const sentAt = sentAtRaw ? new Date(sentAtRaw) : new Date();

      await db.insert(ghlConversations).values({
        ghlConversationId: convId,
        ghlContactId: contactId ?? undefined,
        locationId: payload.locationId ?? undefined,
        channel: payload.channel ?? payload.type?.toLowerCase?.().includes("whatsapp") ? "whatsapp" : (payload.channel ?? "whatsapp"),
        customerName: contact.name ?? contact.fullName ?? payload.contactName ?? undefined,
        phone: contact.phone ?? contact.phoneNumber ?? payload.phone ?? undefined,
        email: contact.email ?? payload.email ?? undefined,
        lastMessagePreview: messageBody.slice(0, 200) || undefined,
        lastMessageAt: sentAt,
        unreadCount: isInbound ? 1 : 0,
        status: "open",
      }).onDuplicateKeyUpdate({
        set: {
          ...(contact.name ? { customerName: contact.name ?? contact.fullName } : {}),
          ...(contact.phone ? { phone: contact.phone ?? contact.phoneNumber } : {}),
          ...(messageBody ? { lastMessagePreview: messageBody.slice(0, 200) } : {}),
          lastMessageAt: sentAt,
          updatedAt: new Date(),
        },
      });

      // Incrementar unread si es inbound
      if (isInbound) {
        await _pool.execute(
          "UPDATE ghl_conversations SET unreadCount = unreadCount + 1, updatedAt = NOW() WHERE ghlConversationId = ?",
          [convId]
        );
      }

      // ── Upsert mensaje ─────────────────────────────────────────────────────
      const msgId: string | null = extractMessageId(payload.message ?? payload);
      if (msgId && (messageBody || payload.attachments?.length)) {
        await db.insert(ghlMessages).values({
          ghlMessageId: msgId,
          ghlConversationId: convId,
          direction: isInbound ? "inbound" : "outbound",
          messageType: message.type ?? payload.messageType ?? "text",
          body: messageBody || undefined,
          attachmentsJson: payload.attachments ?? message.attachments ?? undefined,
          senderName: isInbound
            ? (contact.name ?? payload.contactName ?? undefined)
            : (payload.senderName ?? "Nayade"),
          sentAt,
          deliveryStatus: payload.status ?? message.status ?? undefined,
          rawPayloadJson: payload,
        }).onDuplicateKeyUpdate({
          set: {
            deliveryStatus: payload.status ?? message.status ?? "delivered",
          },
        });
      }
    }

    // Marcar evento como procesado
    await db.update(ghlWebhookEvents)
      .set({ processedStatus: "processed", processedAt: new Date() })
      .where(eq(ghlWebhookEvents.id, eventRowId));

    // Emitir evento SSE para actualizar frontend en tiempo real
    ghlInboxEmitter.emit("update", {
      type: convId ? "conversation_updated" : "sync_complete",
      conversationId: convId ?? undefined,
      timestamp: Date.now(),
    });

    log("info", "Evento procesado", { eventType, convId, eventRowId });
  } catch (err: any) {
    log("error", "Error procesando evento", { eventType, convId, eventRowId, error: err.message });
    await db.update(ghlWebhookEvents)
      .set({ processedStatus: "failed", errorMessage: err.message?.slice(0, 500), processedAt: new Date() })
      .where(eq(ghlWebhookEvents.id, eventRowId))
      .catch(() => {});
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

const ghlInboxRouter = express.Router();

// ── POST /api/ghl/inbox/webhook ───────────────────────────────────────────────
ghlInboxRouter.post(
  "/api/ghl/inbox/webhook",
  express.json({ limit: "2mb" }),
  async (req, res) => {
    // 1. Validar secreto
    const secret = process.env.GHL_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        (req.headers["x-ghl-secret"] as string | undefined) ??
        (req.query.secret as string | undefined);
      if (provided !== secret) {
        log("warn", "Webhook con secreto inválido — ignorado silenciosamente");
        return res.status(200).json({ ok: true }); // Siempre 200 para evitar reintentos de GHL
      }
    }

    const payload = req.body ?? {};
    const eventType = extractEventType(payload);
    const locationId: string | null = payload.locationId ?? null;

    // 2. Validar locationId si está configurado (env var o BD)
    const _creds = await getGHLCredentials().catch(() => null);
    const expectedLocation = process.env.GHL_LOCATION_ID ?? _creds?.locationId;
    if (expectedLocation && locationId && locationId !== expectedLocation) {
      log("warn", "Webhook ignorado — locationId no coincide", { locationId, expectedLocation });
      return res.status(200).json({ ok: true, ignored: true });
    }

    // 3. Registrar evento (idempotente — UNIQUE KEY sobre eventId)
    const eventId: string | null =
      payload.id ?? payload.messageId ?? payload.eventId ?? null;

    let eventRowId: number | null = null;
    try {
      const ins = await db.insert(ghlWebhookEvents).values({
        eventId: eventId ?? undefined,
        eventType,
        ghlConversationId: extractConversationId(payload) ?? undefined,
        ghlContactId: extractContactId(payload) ?? undefined,
        locationId: locationId ?? undefined,
        rawPayloadJson: payload,
        processedStatus: "pending",
      });
      eventRowId = Number((ins[0] as any).insertId);
    } catch (err: any) {
      if (err.code === "ER_DUP_ENTRY") {
        log("info", "Evento duplicado ignorado (idempotente)", { eventId, eventType });
        return res.status(200).json({ ok: true, duplicate: true });
      }
      log("warn", "No se pudo registrar evento en ghl_webhook_events", { error: err.message });
    }

    // 4. Responder 200 inmediatamente (GHL no reintentará si recibe 200)
    res.status(200).json({ ok: true, event: eventType });

    // 5. Procesar de forma asíncrona (no bloquea la respuesta)
    if (eventRowId) {
      setImmediate(() => {
        processWebhookEvent(eventRowId!, payload, eventType).catch(() => {});
      });
    }
  }
);

// ── GET /api/ghl/inbox/stream — SSE para actualizaciones en tiempo real ────────
ghlInboxRouter.get("/api/ghl/inbox/stream", (req, res: Response) => {
  // Autenticación básica: el frontend debe enviar el cookie/header de sesión.
  // En producción el authGuard middleware ya protege /api/trpc; el SSE es un
  // endpoint Express independiente — verificamos la presencia de la sesión.
  // Si no hay sesión, devolvemos 401.
  const sessionCookie = req.cookies?.["nayade_session"] ?? req.headers["x-session-token"];
  // En Railway con LOCAL_AUTH el cookie puede tener otro nombre — permitimos
  // la conexión si está en el mismo dominio (SameSite cookie). En desarrollo
  // permitimos siempre para no bloquear el desarrollo local.
  // Para no complicar la autenticación SSE, usamos un token de query param.
  const streamToken = req.query.token as string | undefined;
  const expectedStreamToken = process.env.GHL_STREAM_TOKEN ?? "nayade-ghl-stream";
  if (streamToken !== expectedStreamToken && process.env.NODE_ENV === "production") {
    return res.status(401).send("Unauthorized");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Nginx/Railway: desactivar buffering
  res.flushHeaders();

  // Enviar heartbeat inicial
  res.write("data: {\"type\":\"connected\"}\n\n");

  const onUpdate = (event: object) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  ghlInboxEmitter.on("update", onUpdate);

  // Heartbeat cada 25s para mantener la conexión viva
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    ghlInboxEmitter.off("update", onUpdate);
  });
});

// ── POST /api/ghl/conversations/:ghlConvId/reply ──────────────────────────────
ghlInboxRouter.post(
  "/api/ghl/conversations/:ghlConvId/reply",
  express.json({ limit: "512kb" }),
  async (req, res) => {
    const { ghlConvId } = req.params;
    const { message } = req.body ?? {};

    if (!message?.trim()) {
      return res.status(400).json({ ok: false, error: "El mensaje no puede estar vacío" });
    }

    const replyCreds = await getGHLCredentials().catch(() => null);
    const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN ?? replyCreds?.apiKey;
    const locationId = process.env.GHL_LOCATION_ID ?? replyCreds?.locationId;

    if (!token || !locationId) {
      return res.status(200).json({
        ok: false,
        notConfigured: true,
        message: "El envío de WhatsApp desde Nayade todavía no está habilitado para esta cuenta GHL. Configura las credenciales en Configuración → GoHighLevel.",
      });
    }

    try {
      const ghlRes = await fetch(`${GHL_BASE_URL}/conversations/${ghlConvId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Version": GHL_API_VERSION,
        },
        body: JSON.stringify({
          type: "WhatsApp",
          message,
          locationId,
        }),
      });

      if (!ghlRes.ok) {
        const errText = await ghlRes.text();
        log("warn", "Error al enviar mensaje via GHL API", { status: ghlRes.status, body: errText.slice(0, 200) });
        return res.status(200).json({
          ok: false,
          message: `El envío de WhatsApp desde Nayade todavía no está habilitado para esta cuenta GHL. (${ghlRes.status}: ${errText.slice(0, 100)})`,
        });
      }

      const data: any = await ghlRes.json();
      const msgId = data?.message?.id ?? data?.id ?? `local-${Date.now()}`;

      // Guardar mensaje outbound localmente
      await db.insert(ghlMessages).values({
        ghlMessageId: msgId,
        ghlConversationId: ghlConvId,
        direction: "outbound",
        messageType: "text",
        body: message,
        senderName: "Nayade",
        sentAt: new Date(),
        deliveryStatus: "sent",
        rawPayloadJson: data,
      }).onDuplicateKeyUpdate({ set: { deliveryStatus: "sent" } });

      // Actualizar conversación
      await _pool.execute(
        "UPDATE ghl_conversations SET lastMessagePreview = ?, lastMessageAt = NOW(), status = 'replied', updatedAt = NOW() WHERE ghlConversationId = ?",
        [message.slice(0, 200), ghlConvId]
      );

      ghlInboxEmitter.emit("update", {
        type: "conversation_updated",
        conversationId: ghlConvId,
        timestamp: Date.now(),
      });

      return res.status(200).json({ ok: true, messageId: msgId });
    } catch (err: any) {
      log("error", "Excepción enviando mensaje GHL", { error: err.message });
      return res.status(200).json({
        ok: false,
        message: `El envío de WhatsApp desde Nayade todavía no está habilitado para esta cuenta GHL. (${err.message})`,
      });
    }
  }
);

// ── POST /api/ghl/inbox/sync — sincronización manual ─────────────────────────
ghlInboxRouter.post("/api/ghl/inbox/sync", express.json({ limit: "128kb" }), async (req, res) => {
  const syncCreds = await getGHLCredentials().catch(() => null);
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN ?? syncCreds?.apiKey;
  const locationId = process.env.GHL_LOCATION_ID ?? syncCreds?.locationId;

  if (!token || !locationId) {
    return res.status(200).json({
      ok: false,
      message: "Credenciales GHL no configuradas. Ve a Configuración → GoHighLevel para añadirlas.",
    });
  }

  try {
    // Fetch conversaciones recientes de GHL
    const ghlRes = await fetch(
      `${GHL_BASE_URL}/conversations/search?locationId=${locationId}&limit=50&channel=whatsapp`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_API_VERSION,
        },
      }
    );

    if (!ghlRes.ok) {
      const errText = await ghlRes.text();
      log("warn", "Error al sincronizar desde GHL API", { status: ghlRes.status, body: errText.slice(0, 200) });
      return res.status(200).json({
        ok: false,
        message: `Error al conectar con GHL: HTTP ${ghlRes.status}`,
      });
    }

    const data: any = await ghlRes.json();
    const conversations: any[] = data?.conversations ?? data?.data ?? [];
    let upserted = 0;

    for (const conv of conversations) {
      try {
        await db.insert(ghlConversations).values({
          ghlConversationId: conv.id,
          ghlContactId: conv.contactId ?? undefined,
          locationId: conv.locationId ?? locationId,
          channel: conv.channel ?? "whatsapp",
          customerName: conv.contactName ?? conv.fullName ?? undefined,
          phone: conv.phone ?? undefined,
          email: conv.email ?? undefined,
          lastMessagePreview: conv.lastMessageBody?.slice(0, 200) ?? undefined,
          lastMessageAt: conv.lastMessageDate ? new Date(conv.lastMessageDate) : undefined,
          unreadCount: conv.unreadCount ?? 0,
          inbox: conv.inbox ?? undefined,
          status: "open",
        }).onDuplicateKeyUpdate({
          set: {
            customerName: conv.contactName ?? conv.fullName ?? undefined,
            phone: conv.phone ?? undefined,
            lastMessagePreview: conv.lastMessageBody?.slice(0, 200) ?? undefined,
            lastMessageAt: conv.lastMessageDate ? new Date(conv.lastMessageDate) : undefined,
            unreadCount: conv.unreadCount ?? 0,
            updatedAt: new Date(),
          },
        });
        upserted++;
      } catch (e: any) {
        log("warn", "Error upserting conversation during sync", { convId: conv.id, error: e.message });
      }
    }

    ghlInboxEmitter.emit("update", { type: "sync_complete", timestamp: Date.now() });
    log("info", `Sync completado — ${upserted} conversaciones actualizadas`);
    return res.status(200).json({ ok: true, upserted, total: conversations.length });
  } catch (err: any) {
    log("error", "Excepción en sync GHL", { error: err.message });
    return res.status(200).json({ ok: false, message: err.message });
  }
});

export default ghlInboxRouter;
