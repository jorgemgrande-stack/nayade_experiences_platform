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

// ─── Auto-creación de tablas ─────────────────────────────────────────────────
// Garantiza que las tablas existen aunque la migración de Drizzle no haya corrido.
// CREATE TABLE IF NOT EXISTS es idempotente y seguro en producción.

async function initGhlTables(): Promise<void> {
  try {
    await _pool.execute(`
      CREATE TABLE IF NOT EXISTS ghl_conversations (
        id int AUTO_INCREMENT PRIMARY KEY,
        ghlConversationId varchar(64) NOT NULL,
        ghlContactId varchar(64),
        locationId varchar(64),
        channel varchar(32) NOT NULL DEFAULT 'whatsapp',
        customerName varchar(255),
        phone varchar(32),
        email varchar(320),
        lastMessagePreview text,
        lastMessageAt timestamp NULL,
        unreadCount int NOT NULL DEFAULT 0,
        inbox varchar(64),
        starred boolean NOT NULL DEFAULT false,
        status enum('new','open','pending','replied','closed') NOT NULL DEFAULT 'new',
        assignedUserId int NULL,
        linkedQuoteId int NULL,
        linkedReservationId int NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ghl_conv_id (ghlConversationId),
        INDEX idx_ghl_conv_status (status),
        INDEX idx_ghl_conv_lastMsg (lastMessageAt),
        INDEX idx_ghl_conv_contact (ghlContactId)
      )
    `);
    await _pool.execute(`
      CREATE TABLE IF NOT EXISTS ghl_messages (
        id int AUTO_INCREMENT PRIMARY KEY,
        ghlMessageId varchar(64) NOT NULL,
        ghlConversationId varchar(64) NOT NULL,
        direction enum('inbound','outbound') NOT NULL DEFAULT 'inbound',
        messageType varchar(32) DEFAULT 'text',
        body text,
        attachmentsJson json,
        senderName varchar(255),
        sentAt timestamp NULL,
        deliveryStatus varchar(32),
        rawPayloadJson json,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ghl_msg_id (ghlMessageId),
        INDEX idx_ghl_msg_conv (ghlConversationId),
        INDEX idx_ghl_msg_sentAt (sentAt)
      )
    `);
    await _pool.execute(`
      CREATE TABLE IF NOT EXISTS ghl_webhook_events (
        id int AUTO_INCREMENT PRIMARY KEY,
        eventId varchar(128) NULL,
        eventType varchar(128) NOT NULL,
        ghlConversationId varchar(64),
        ghlContactId varchar(64),
        locationId varchar(64),
        rawPayloadJson json,
        processedStatus enum('pending','processed','failed','ignored') NOT NULL DEFAULT 'pending',
        errorMessage text,
        receivedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processedAt timestamp NULL,
        UNIQUE KEY uq_ghl_event_id (eventId),
        INDEX idx_ghl_evt_conv (ghlConversationId),
        INDEX idx_ghl_evt_status (processedStatus),
        INDEX idx_ghl_evt_received (receivedAt)
      )
    `);
    console.log(JSON.stringify({ ts: new Date().toISOString(), context: "GHLInbox", msg: "Tablas GHL verificadas/creadas OK" }));
  } catch (err: any) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), context: "GHLInbox", msg: "Error creando tablas GHL", error: err.message }));
  }
}

// Ejecutar al cargar el módulo (asíncrono, no bloquea arranque)
initGhlTables();

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
    // Credenciales específicas del inbox (siguen en site_settings)
    const [rawRows]: any = await _pool.execute(
      "SELECT `key`, `value` FROM site_settings WHERE `key` IN ('ghlInboxToken','ghlInboxLocationId','ghlApiKey','ghlLocationId','ghlInboxWebhookSecret')"
    );
    const map: Record<string, string> = {};
    for (const r of (rawRows as any[])) map[r.key] = r.value ?? "";

    // Credenciales principales GHL: systemSettings es la fuente de verdad desde Fase 1
    const [sysRows]: any = await _pool.execute(
      "SELECT `key`, `value` FROM system_settings WHERE `key` IN ('site_ghl_api_key','site_ghl_location_id')"
    );
    const sysMap: Record<string, string> = {};
    for (const r of (sysRows as any[])) sysMap[r.key] = r.value ?? "";

    const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
      || map.ghlInboxToken
      || sysMap.site_ghl_api_key || map.ghlApiKey || "";
    const locationId = process.env.GHL_LOCATION_ID
      || map.ghlInboxLocationId
      || sysMap.site_ghl_location_id || map.ghlLocationId || "";
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

// ─── Fetchear y sincronizar mensajes de una conversación via GHL API ────────

async function fetchAndSyncMessages(convId: string, limit = 25): Promise<void> {
  const creds = await getInboxCredentials();
  if (!creds) return;
  const { token } = creds;

  try {
    const res = await fetch(
      `${GHL_BASE_URL}/conversations/${encodeURIComponent(convId)}/messages?limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_API_VERSION } }
    );
    if (!res.ok) {
      log("warn", "fetchAndSyncMessages: respuesta no-OK de GHL", { convId, status: res.status });
      return;
    }
    const data: any = await res.json();
    // GHL puede devolver { messages: [...] } o { messages: { messages: [...] } }
    const raw = data?.messages;
    const msgs: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.messages)
        ? raw.messages
        : [];

    for (const m of msgs) {
      const msgId: string = m.id ?? m.messageId;
      if (!msgId) continue;
      const body: string = m.body ?? m.text ?? m.message ?? "";
      const dir = (m.direction ?? "inbound") === "outbound" ? "outbound" : "inbound";
      const sentAt = m.dateAdded ? new Date(m.dateAdded) : new Date();

      try {
        await db.insert(ghlMessages).values({
          ghlMessageId: msgId,
          ghlConversationId: convId,
          direction: dir,
          messageType: m.messageType ?? m.type?.toString() ?? "text",
          body: body || undefined,
          attachmentsJson: m.attachments?.length ? m.attachments : undefined,
          senderName: dir === "inbound" ? (m.contactName ?? undefined) : (m.userId ? "Nayade" : "Nayade"),
          sentAt,
          deliveryStatus: m.status ?? undefined,
          rawPayloadJson: m,
        }).onDuplicateKeyUpdate({
          set: { deliveryStatus: m.status ?? "delivered" },
        });
      } catch (e: any) {
        if (e.code !== "ER_DUP_ENTRY") {
          log("warn", "fetchAndSyncMessages: error upserting msg", { msgId, error: e.message });
        }
      }
    }
    log("info", "fetchAndSyncMessages OK", { convId, count: msgs.length });
  } catch (err: any) {
    log("warn", "fetchAndSyncMessages: excepción", { convId, error: err.message });
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
    // ── Manejar borrado de conversación ──────────────────────────────────────
    const DELETION_EVENTS = new Set([
      "ConversationDeleted", "conversation_deleted",
      "ConversationUnsubscribed", "conversation_unsubscribed",
    ]);
    if (DELETION_EVENTS.has(eventType)) {
      if (convId) {
        await _pool.execute("DELETE FROM ghl_messages WHERE ghlConversationId = ?", [convId]);
        await _pool.execute("DELETE FROM ghl_conversations WHERE ghlConversationId = ?", [convId]);
        ghlInboxEmitter.emit("update", { type: "conversation_deleted", conversationId: convId, timestamp: Date.now() });
        log("info", "Conversación eliminada por webhook", { eventType, convId });
      }
      await db.update(ghlWebhookEvents)
        .set({ processedStatus: "processed", processedAt: new Date() })
        .where(eq(ghlWebhookEvents.id, eventRowId));
      return;
    }

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

      // ── Intentar upsert del mensaje desde el propio payload ───────────────
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

      // ── Siempre fetchear mensajes desde GHL API (el payload del workflow
      //    no suele incluir el cuerpo completo del mensaje)
      await fetchAndSyncMessages(convId);
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

    // Leer el contactId desde la BD para incluirlo en la llamada a GHL
    const [convRows]: any = await _pool.execute(
      "SELECT ghlContactId FROM ghl_conversations WHERE ghlConversationId = ? LIMIT 1",
      [ghlConvId]
    ).catch(() => [[]]);
    const ghlContactId: string | null = (convRows as any[])[0]?.ghlContactId ?? null;

    try {
      const ghlRes = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Version": GHL_API_VERSION,
        },
        body: JSON.stringify({
          type: "WhatsApp",
          conversationId: ghlConvId,
          ...(ghlContactId ? { contactId: ghlContactId } : {}),
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

// ── GET /api/ghl/templates — listar plantillas WhatsApp aprobadas ─────────────
ghlInboxRouter.get("/api/ghl/templates", async (req, res) => {
  const creds = await getInboxCredentials();
  if (!creds) return res.status(200).json({ ok: false, templates: [], message: "Sin credenciales" });
  const { token, locationId } = creds;
  try {
    const r = await fetch(
      `${GHL_BASE_URL}/locations/${encodeURIComponent(locationId)}/templates?originId=${encodeURIComponent(locationId)}&limit=50&deleted=false`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_API_VERSION } }
    );
    const data: any = await r.json();
    const templates: any[] = data?.templates ?? data?.data ?? [];
    return res.status(200).json({ ok: true, templates });
  } catch (err: any) {
    return res.status(200).json({ ok: false, templates: [], message: err.message });
  }
});

// ── POST /api/ghl/conversations/new — iniciar nueva conversación ──────────────
ghlInboxRouter.post("/api/ghl/conversations/new", express.json({ limit: "512kb" }), async (req, res) => {
  const { phone, contactName, message, templateId } = req.body ?? {};

  if (!phone?.trim()) return res.status(400).json({ ok: false, message: "Teléfono requerido" });
  // message y templateId son opcionales: si no vienen solo se crea/recupera la conversación

  const creds = await getInboxCredentials();
  if (!creds) return res.status(200).json({ ok: false, message: "Credenciales GHL no configuradas." });
  const { token, locationId } = creds;

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Version: GHL_API_VERSION };

  try {
    // 1. Buscar contacto por teléfono
    let contactId: string | null = null;
    const searchRes = await fetch(
      `${GHL_BASE_URL}/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&number=${encodeURIComponent(phone)}`,
      { headers }
    );
    if (searchRes.ok) {
      const sd: any = await searchRes.json();
      contactId = sd?.contact?.id ?? null;
    }

    // 2. Crear contacto si no existe
    if (!contactId) {
      const [firstName, ...rest] = (contactName ?? "").trim().split(" ");
      const createRes = await fetch(`${GHL_BASE_URL}/contacts/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ locationId, phone, firstName: firstName || phone, lastName: rest.join(" ") || undefined }),
      });
      if (!createRes.ok) {
        const t = await createRes.text();
        return res.status(200).json({ ok: false, message: `Error creando contacto: ${t.slice(0, 120)}` });
      }
      const cd: any = await createRes.json();
      contactId = cd?.contact?.id ?? cd?.id ?? null;
    }

    if (!contactId) return res.status(200).json({ ok: false, message: "No se pudo obtener contactId de GHL" });

    // 3. Crear o recuperar conversación
    const convRes = await fetch(`${GHL_BASE_URL}/conversations/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ locationId, contactId }),
    });
    const convData: any = await convRes.json();
    // GHL devuelve el ID en distintos lugares según si la conversación es nueva o ya existía
    const conversationId: string | null =
      convData?.conversation?.id ?? convData?.id ?? convData?.conversationId ?? null;
    if (!conversationId) {
      return res.status(200).json({ ok: false, message: `No se pudo crear conversación en GHL: ${JSON.stringify(convData).slice(0, 120)}` });
    }

    // 4. Guardar conversación en BD local (siempre)
    await db.insert(ghlConversations).values({
      ghlConversationId: conversationId,
      ghlContactId: contactId,
      locationId,
      channel: "whatsapp",
      customerName: contactName ?? phone,
      phone,
      unreadCount: 0,
      status: "open",
    }).onDuplicateKeyUpdate({
      set: {
        customerName: contactName ?? phone,
        phone,
        updatedAt: new Date(),
      },
    });

    // 5. Enviar mensaje o plantilla solo si se proporcionaron
    if (message?.trim() || templateId) {
      const msgBody: any = { type: "WhatsApp", conversationId, contactId, locationId };
      if (templateId) msgBody.templateId = templateId;
      else msgBody.message = message;

      const msgRes = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(msgBody),
      });

      if (!msgRes.ok) {
        const errText = await msgRes.text();
        return res.status(200).json({ ok: false, message: `Error enviando mensaje: ${errText.slice(0, 150)}` });
      }
      const msgData: any = await msgRes.json();
      const msgId = msgData?.message?.id ?? msgData?.id ?? `local-${Date.now()}`;
      const preview = (templateId ? `[Plantilla: ${templateId}]` : message!).slice(0, 200);

      await db.update(ghlConversations)
        .set({ lastMessagePreview: preview, lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(ghlConversations.ghlConversationId, conversationId));

      await db.insert(ghlMessages).values({
        ghlMessageId: msgId,
        ghlConversationId: conversationId,
        direction: "outbound",
        messageType: "text",
        body: preview,
        senderName: "Nayade",
        sentAt: new Date(),
        deliveryStatus: "sent",
        rawPayloadJson: msgData,
      }).onDuplicateKeyUpdate({ set: { deliveryStatus: "sent" } });

      ghlInboxEmitter.emit("update", { type: "conversation_updated", conversationId, timestamp: Date.now() });

      return res.status(200).json({ ok: true, conversationId, contactId, messageId: msgId });
    }

    return res.status(200).json({ ok: true, conversationId, contactId, messageId: null });
  } catch (err: any) {
    log("error", "Error creando nueva conversación GHL", { error: err.message });
    return res.status(200).json({ ok: false, message: err.message });
  }
});

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
        // Fetchear mensajes de cada conversación en paralelo (máx 5 concurrentes)
        await fetchAndSyncMessages(conv.id, 50).catch(() => {});
      } catch (e: any) {
        log("warn", "Error upserting conversation during sync", { convId: conv.id, error: e.message });
      }
    }

    // ── Delta-delete: purgar conversaciones que ya no existen en GHL ─────────
    // Solo si GHL devolvió < 100 resultados (set completo, sin paginación pendiente)
    let purged = 0;
    if (conversations.length < 100) {
      const ghlIds = new Set(conversations.map((c: any) => c.id).filter(Boolean));
      const [localRows]: any = await _pool.execute(
        "SELECT ghlConversationId FROM ghl_conversations"
      );
      const toDelete = (localRows as any[]).filter(r => r.ghlConversationId && !ghlIds.has(r.ghlConversationId));
      for (const row of toDelete) {
        await _pool.execute("DELETE FROM ghl_messages WHERE ghlConversationId = ?", [row.ghlConversationId]);
        await _pool.execute("DELETE FROM ghl_conversations WHERE ghlConversationId = ?", [row.ghlConversationId]);
        log("info", "Conversación purgada (ausente en GHL)", { ghlConversationId: row.ghlConversationId });
        purged++;
      }
    }

    ghlInboxEmitter.emit("update", { type: "sync_complete", timestamp: Date.now() });
    log("info", `Sync completado — ${upserted} actualizadas, ${purged} purgadas`);
    return res.status(200).json({ ok: true, upserted, purged, total: conversations.length });
  } catch (err: any) {
    log("error", "Excepción en sync GHL", { error: err.message });
    return res.status(200).json({ ok: false, message: err.message });
  }
});

// ── GET /api/ghl/inbox/health — diagnóstico sin autenticación ─────────────────
ghlInboxRouter.get("/api/ghl/inbox/health", async (req, res) => {
  const result: Record<string, any> = { ok: false, tables: {}, credentials: {}, lastEvent: null };
  try {
    const tables = ["ghl_conversations", "ghl_messages", "ghl_webhook_events"];
    for (const t of tables) {
      try {
        const [rows]: any = await _pool.execute(`SELECT COUNT(*) as cnt FROM \`${t}\``);
        result.tables[t] = { exists: true, count: Number(rows[0]?.cnt ?? 0) };
      } catch {
        result.tables[t] = { exists: false, count: 0 };
      }
    }

    const creds = await getInboxCredentials();
    result.credentials = {
      hasToken: !!creds?.token,
      hasLocationId: !!creds?.locationId,
      hasWebhookSecret: !!creds?.webhookSecret,
    };

    try {
      const [evtRows]: any = await _pool.execute(
        "SELECT id, eventType, processedStatus, errorMessage, receivedAt FROM ghl_webhook_events ORDER BY receivedAt DESC LIMIT 1"
      );
      result.lastEvent = (evtRows as any[])[0] ?? null;
    } catch { /* tabla no existe */ }

    result.ok = Object.values(result.tables).every((t: any) => t.exists);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: err.message });
  }
});

export default ghlInboxRouter;
