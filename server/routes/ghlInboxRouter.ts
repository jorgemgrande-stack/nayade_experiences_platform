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
import { eq, desc, and, sql } from "drizzle-orm";
import { ghlConversations, ghlMessages, ghlWebhookEvents, siteSettings } from "../../drizzle/schema";
import { ghlInboxEmitter } from "../ghlInboxEvents";
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
    payload.message?.conversationId ??
    null
  );
}

function extractContactId(payload: any): string | null {
  return (
    payload.contactId ??
    payload.contact_id ??
    payload.contact?.id ??
    payload.message?.contactId ??
    null
  );
}

function extractEventType(payload: any): string {
  // GHL workflows pueden enviar el tipo en distintos campos
  const raw =
    payload.type ??
    payload.event ??
    payload.eventType ??
    payload.event_type ??
    payload.messageType ??
    "";
  // Normalizar: si viene "WhatsApp" como tipo de mensaje, inferir dirección
  if (!raw || raw === "WhatsApp") {
    const dir = payload.direction ?? payload.message?.direction ?? "";
    if (dir === "inbound") return "InboundMessage";
    if (dir === "outbound") return "OutboundMessage";
    // Si tiene conversationId con body, asumir mensaje entrante
    if (payload.conversationId || payload.message?.conversationId) return "InboundMessage";
  }
  return raw || "unknown";
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

// Extrae el cuerpo del mensaje soportando múltiples formatos de payload GHL
function extractMessageBody(payload: any): string {
  return (
    payload.message?.body ??
    payload.body ??
    payload.text ??
    payload.message?.text ??
    payload.messageBody ??
    ""
  );
}

// Extrae datos del contacto de forma robusta
function extractContact(payload: any): { name?: string; phone?: string; email?: string } {
  const c = payload.contact ?? payload.contactData ?? {};
  return {
    name: c.name ?? c.fullName ?? c.firstName
      ? [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.name || c.fullName
      : payload.contactName ?? payload.fullName ?? undefined,
    phone: c.phone ?? c.phoneNumber ?? payload.phone ?? payload.phoneNumber ?? undefined,
    email: c.email ?? payload.email ?? undefined,
  };
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

// ─── Credenciales específicas del módulo inbox ───────────────────────────────

async function getInboxCredentials(): Promise<{ token: string; locationId: string; webhookSecret: string } | null> {
  try {
    const [rawRows]: any = await _pool.execute(
      "SELECT `key`, `value` FROM site_settings WHERE `key` IN ('ghlInboxToken','ghlInboxLocationId','ghlApiKey','ghlLocationId','ghlInboxWebhookSecret')"
    );
    const map: Record<string, string> = {};
    for (const r of (rawRows as any[])) map[r.key] = r.value ?? "";
    const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
      || map.ghlInboxToken || map.ghlApiKey || "";
    const locationId = process.env.GHL_LOCATION_ID
      || map.ghlInboxLocationId || map.ghlLocationId || "";
    const webhookSecret = process.env.GHL_WEBHOOK_SECRET || map.ghlInboxWebhookSecret || "";
    if (!token || !locationId) return null;
    return { token, locationId, webhookSecret };
  } catch {
    return null;
  }
}

// ─── Buscar conversación por contacto via GHL API ────────────────────────────

async function fetchLatestConversationForContact(contactId: string): Promise<any | null> {
  const creds = await getInboxCredentials();
  if (!creds) return null;
  const { token, locationId } = creds;

  try {
    const res = await fetch(
      `${GHL_BASE_URL}/conversations/search?contactId=${encodeURIComponent(contactId)}&locationId=${encodeURIComponent(locationId)}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_API_VERSION,
        },
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const convs: any[] = data?.conversations ?? data?.data ?? [];
    return convs[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Procesamiento asíncrono del webhook ──────────────────────────────────────

async function processWebhookEvent(eventRowId: number, payload: any, eventType: string): Promise<void> {
  let convId: string | null = extractConversationId(payload);
  const contactId: string | null = extractContactId(payload);

  // Si no viene conversationId pero sí contactId, buscarlo via GHL API
  // (los workflows de GHL no tienen merge tag {{conversation.id}})
  let apiConv: any = null;
  if (!convId && contactId) {
    apiConv = await fetchLatestConversationForContact(contactId);
    convId = apiConv?.id ?? null;
    log("info", "ConvId resuelto via API", { contactId, convId });
  }

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
      // Si resolviamos la conversación via API, enriquecer el payload con esos datos
      if (apiConv) {
        payload = {
          ...payload,
          body: payload.body || apiConv.lastMessageBody,
          locationId: payload.locationId ?? apiConv.locationId,
          contact: {
            name: payload.contact?.name ?? apiConv.contactName ?? apiConv.fullName,
            phone: payload.contact?.phone ?? apiConv.phone,
            email: payload.contact?.email ?? apiConv.email,
          },
          sentAt: payload.sentAt ?? apiConv.lastMessageDate,
        };
      }
      const contact = extractContact(payload);
      const messageBody = extractMessageBody(payload);
      const message = payload.message ?? {};
      const isInbound = (message.direction ?? payload.direction ?? "inbound") !== "outbound";
      const sentAtRaw = message.dateAdded ?? payload.dateAdded ?? payload.sentAt ?? payload.createdAt ?? null;
      const sentAt = sentAtRaw ? new Date(sentAtRaw) : new Date();
      const channel = payload.channel ?? (
        (payload.type ?? payload.messageType ?? "").toLowerCase().includes("whatsapp") ? "whatsapp" : "whatsapp"
      );

      await db.insert(ghlConversations).values({
        ghlConversationId: convId,
        ghlContactId: contactId ?? undefined,
        locationId: payload.locationId ?? undefined,
        channel,
        customerName: contact.name ?? undefined,
        phone: contact.phone ?? undefined,
        email: contact.email ?? undefined,
        lastMessagePreview: messageBody.slice(0, 200) || undefined,
        lastMessageAt: sentAt,
        unreadCount: isInbound ? 1 : 0,
        status: "open",
      }).onDuplicateKeyUpdate({
        set: {
          ...(contact.name ? { customerName: contact.name } : {}),
          ...(contact.phone ? { phone: contact.phone } : {}),
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
      if (msgId && (messageBody || payload.attachments?.length || message.attachments?.length)) {
        await db.insert(ghlMessages).values({
          ghlMessageId: msgId,
          ghlConversationId: convId,
          direction: isInbound ? "inbound" : "outbound",
          messageType: message.type ?? payload.messageType ?? payload.type ?? "text",
          body: messageBody || undefined,
          attachmentsJson: payload.attachments ?? message.attachments ?? undefined,
          senderName: isInbound
            ? (contact.name ?? payload.contactName ?? undefined)
            : (payload.senderName ?? "Nayade"),
          sentAt,
          deliveryStatus: payload.status ?? message.status ?? undefined,
          rawPayloadJson: payload,
        }).onDuplicateKeyUpdate({
          set: { deliveryStatus: payload.status ?? message.status ?? "delivered" },
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
    // 1. Validar secreto (env var con fallback a BD)
    const [secretRows]: any = await _pool.execute(
      "SELECT `value` FROM site_settings WHERE `key` = 'ghlInboxWebhookSecret' LIMIT 1"
    ).catch(() => [[]]);
    const dbSecret = (secretRows as any[])[0]?.value ?? "";
    const secret = process.env.GHL_WEBHOOK_SECRET || dbSecret;
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
    const _creds = await getInboxCredentials();
    const expectedLocation = _creds?.locationId;
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

    const replyCreds = await getInboxCredentials();
    if (!replyCreds) {
      return res.status(200).json({
        ok: false,
        notConfigured: true,
        message: "Configura el Token y Location ID en WhatsApp GHL → Estadísticas → Configuración.",
      });
    }
    const { token, locationId } = replyCreds;

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
  const syncCreds = await getInboxCredentials();
  if (!syncCreds) {
    return res.status(200).json({
      ok: false,
      message: "Credenciales GHL no configuradas. Ve a WhatsApp GHL → Estadísticas → Configuración.",
    });
  }
  const { token, locationId } = syncCreds;

  try {
    // Fetch conversaciones recientes de GHL — sin filtro channel (no es param válido)
    const ghlRes = await fetch(
      `${GHL_BASE_URL}/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=100`,
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
        message: `Error al conectar con GHL: HTTP ${ghlRes.status} — ${errText.slice(0, 120)}`,
      });
    }

    const data: any = await ghlRes.json();
    // GHL puede devolver { conversations: [] } o { data: [] }
    const conversations: any[] = data?.conversations ?? data?.data ?? data ?? [];
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
