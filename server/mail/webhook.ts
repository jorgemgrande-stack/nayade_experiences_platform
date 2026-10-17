/**
 * Webhook de eventos transaccionales de Brevo (entregado, rebote duro/temporal, bloqueado, queja, baja…).
 *
 * AUTENTICIDAD — único mecanismo implementado, documentado oficialmente por Brevo: cabeceras propias que
 * Brevo añade a cada llamada del webhook, definidas al crearlo (`headers: [{ key, value }]` en
 * POST /v3/webhooks).
 *   - https://developers.brevo.com/docs/secured-webhooks («Cloudflare headers»: Brevo envía esas cabeceras
 *     con cada evento para que el destino las autentique; admite varias).
 *   - https://developers.brevo.com/reference/create-webhook (campo `headers`, «Custom headers to be send
 *     with webhooks»).
 * El webhook se crea con la cabecera `x-elephant-webhook-token: <BREVO_WEBHOOK_TOKEN>`; aquí se compara en
 * tiempo constante. Brevo no documenta firma HMAC. Otras opciones oficiales (usuario y contraseña en la URL,
 * `auth` de tipo bearer, lista de IP) NO se usan: la del token bearer no documenta en qué cabecera llega.
 *
 * Sin token configurado (≥ 32 caracteres) el webhook responde 503 y no cambia nada; con un token que no
 * coincide, 401 y no cambia nada.
 *
 * Formato de los eventos: https://developers.brevo.com/docs/transactional-webhooks (campos `event`,
 * `email`, `message-id`, `ts_event`/`ts_epoch`, `X-Mailin-custom`, `reason`). Brevo puede enviarlos en lote
 * (array) si el webhook se crea con `batched: true`.
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { opsLog, scrubText } from "../_core/ops/log";
import { parseMailRef, type MailService } from "./service";
import type { MailLane, ProviderEvent, ProviderEventKind } from "./types";

export const WEBHOOK_TOKEN_HEADER = "x-elephant-webhook-token";

const KINDS: Record<string, ProviderEventKind> = {
  delivered: "delivered",
  soft_bounce: "soft_bounce",
  softbounce: "soft_bounce",
  hard_bounce: "hard_bounce",
  hardbounce: "hard_bounce",
  blocked: "blocked",
  spam: "spam",
  complaint: "spam",
  invalid_email: "invalid",
  invalid: "invalid",
  unsubscribed: "unsubscribed",
  deferred: "deferred",
  error: "error",
};

/** Evento de Brevo → evento interno; `null` si no nos interesa (aperturas, clics, «request»…). */
export function parseBrevoEvent(raw: unknown): ProviderEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS[String(r.event ?? "").toLowerCase()];
  if (!kind) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const messageId = str(r["message-id"]) ?? str(r.messageId);
  const ref = str(r["X-Mailin-custom"]) ?? str(r["x-mailin-custom"]);
  const email = str(r.email);
  const when = String(r.ts_epoch ?? r.ts_event ?? r.ts ?? r.date ?? "");
  const eventId = crypto.createHash("sha256").update(`${kind}\n${messageId ?? ""}\n${ref ?? ""}\n${when}\n${(email ?? "").toLowerCase()}`).digest("hex");
  const reason = str(r.reason);
  return { kind, ref, messageId, email, eventId, reason: reason ? scrubText(reason).slice(0, 200) : null };
}

/** Comparación en tiempo constante del token del webhook. */
export function webhookTokenValid(expected: string | null | undefined, received: unknown): boolean {
  if (!expected || expected.length < 32 || typeof received !== "string") return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(received).digest();
  return crypto.timingSafeEqual(a, b);
}

export interface BrevoWebhookDeps {
  token: string | null | undefined;
  /** Servicio de correo del carril y la empresa de la referencia, o `null` si no existe. */
  resolve: (lane: MailLane, tenantId: string) => Promise<MailService | null>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export function brevoWebhookHandler(d: BrevoWebhookDeps) {
  const log = d.log ?? ((event, data) => opsLog(event === "rejected" ? "warn" : "info", "MailWebhook", event, data));
  return async (req: Request, res: Response) => {
    if (!d.token || d.token.length < 32) return void res.status(503).json({ error: "webhook_not_configured" });
    if (!webhookTokenValid(d.token, req.headers[WEBHOOK_TOKEN_HEADER])) {
      log("rejected", { reason: "invalid_token" });
      return void res.status(401).json({ error: "unauthorized" });
    }
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const out = { received: items.length, applied: 0, duplicate: 0, ignored: 0 };
    for (const raw of items.slice(0, 500)) {
      const ev = parseBrevoEvent(raw);
      const ref = parseMailRef(ev?.ref);
      if (!ev || !ref) {
        out.ignored++;
        continue;
      }
      try {
        const svc = await d.resolve(ref.lane, ref.tenantId);
        const r = svc ? await svc.applyEvent(ev) : "ignored";
        out[r]++;
      } catch (e) {
        // Un fallo de una empresa no tumba el lote: Brevo reintenta si la respuesta no es 2xx
        log("apply_failed", { lane: ref.lane, tenantId: ref.tenantId, error: e instanceof Error ? e.name : "error" });
        return void res.status(500).json({ error: "apply_failed" });
      }
    }
    log("processed", out);
    res.json(out);
  };
}

/** Router propio (útil fuera del plano de control y en pruebas): JSON hasta 1 MB. */
export function createBrevoWebhookRouter(d: BrevoWebhookDeps, path = "/webhooks/brevo"): Router {
  const r = express.Router();
  r.post(path, express.json({ limit: "1mb" }), (req, res, next) => void brevoWebhookHandler(d)(req, res).catch(next));
  return r;
}
