/**
 * ghlInboxEvents.ts — EventEmitter singleton para SSE del inbox de WhatsApp GHL.
 *
 * Cuando llega un webhook, el procesador emite un evento aquí.
 * Los clientes SSE conectados escuchan y reciben la actualización en tiempo real.
 * Funciona perfectamente en Railway (instancia única de Node.js).
 */

import { EventEmitter } from "events";

export interface GhlInboxEvent {
  type: "conversation_updated" | "message_received" | "sync_complete";
  conversationId?: string;
  timestamp: number;
}

class GhlInboxEmitter extends EventEmitter {}

export const ghlInboxEmitter = new GhlInboxEmitter();
ghlInboxEmitter.setMaxListeners(200); // permite hasta 200 conexiones SSE simultáneas
