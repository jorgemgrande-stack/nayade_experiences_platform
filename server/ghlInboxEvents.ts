/**
 * ghlInboxEvents.ts — EventEmitter singleton para SSE del inbox de WhatsApp GHL.
 *
 * Cuando llega un webhook, el procesador emite un evento aquí.
 * Los clientes SSE conectados escuchan y reciben la actualización en tiempo real.
 * Funciona perfectamente en Railway (instancia única de Node.js).
 */

import { TenantEventEmitter } from "./_core/tenantScope";

export interface GhlInboxEvent {
  type: "conversation_updated" | "message_received" | "sync_complete";
  conversationId?: string;
  timestamp: number;
}

// Emisor aislado por tenant: un evento de una empresa nunca llega a las conexiones SSE de otra.
// Hasta 200 conexiones SSE simultáneas.
export const ghlInboxEmitter = new TenantEventEmitter(200);
