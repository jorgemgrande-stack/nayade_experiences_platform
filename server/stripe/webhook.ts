/**
 * Receptor del webhook de Stripe (`POST /cp/v1/stripe/webhook`). SOLO MODO PRUEBAS.
 *
 *  - Cuerpo HTTP ORIGINAL (`express.raw`, montado ANTES del `express.json` global): la firma se verifica
 *    sobre los bytes exactos recibidos con la función oficial del SDK (`constructEvent`): varios `v1`,
 *    `v0` ignorada y tolerancia de 300 s frente a repeticiones. Sin firma válida: 400 y no se guarda nada.
 *  - Evento live: 400 y alerta. Tipos no gestionados: 200 sin guardar.
 *  - El evento se GUARDA una sola vez (`stripe_events`) y se responde 2xx al momento; el efecto lo
 *    calcula el procesador releyendo el objeto en Stripe (asíncrono y con reintentos).
 *  - Nunca se registra el cuerpo, la firma ni el secreto.
 */
import type { Request, Response } from "express";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { HANDLED } from "./events";
import type { GwEvent } from "./gateway";
import type { StripeStore } from "./store";

export interface WebhookDeps {
  verify: (rawBody: Buffer, signature: string) => GwEvent;
  store: Pick<StripeStore, "recordEvent">;
  now?: () => number;
  /** Se llama tras guardar un evento nuevo (p. ej. para procesarlo enseguida). No bloquea la respuesta. */
  onRecorded?: (eventId: string) => void;
}

export function stripeWebhookHandler(d: WebhookDeps) {
  const now = d.now ?? Date.now;
  return async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !signature || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return void res.status(400).json({ error: "invalid_request" });
    }
    let ev: GwEvent;
    try {
      ev = d.verify(req.body, signature);
    } catch {
      opsLog("warn", "StripeWebhook", "invalid_signature", {});
      recordFailure("stripe.webhook_invalid_signature");
      return void res.status(400).json({ error: "invalid_signature" });
    }
    if (ev.livemode !== false) {
      opsLog("error", "StripeWebhook", "live_event_rejected", { eventId: ev.id, type: ev.type });
      recordFailure("stripe.live_event_rejected");
      return void res.status(400).json({ error: "live_event_rejected" });
    }
    if (!HANDLED.has(ev.type)) return void res.json({ received: true, ignored: true });
    try {
      const r = await d.store.recordEvent({ eventId: ev.id, type: ev.type, apiVersion: ev.apiVersion, objectType: ev.objectType, objectId: ev.objectId, stripeCreated: ev.created, source: "webhook", now: now() });
      res.json({ received: true, duplicate: !r.created });
      if (r.created && d.onRecorded) setImmediate(() => d.onRecorded!(ev.id));
    } catch (e) {
      // Sin guardar no se confirma: Stripe reintentará la entrega
      opsLog("error", "StripeWebhook", "store_failed", { eventId: ev.id, error: e instanceof Error ? e.name : "error" });
      recordFailure("stripe.webhook_store_failed");
      res.status(500).json({ error: "store_failed" });
    }
  };
}
