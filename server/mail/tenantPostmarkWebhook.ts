/**
 * Webhook de Postmark de CADA empresa en el Core: POST /api/mail/postmark/webhook en el dominio de la empresa.
 *
 * Fuera de /api/trpc (no cambia la lista blanca de server/authGuard.ts), como las rutas públicas de server/netPublic.
 *  - La empresa sale del dominio de la petición (resolución de empresas del arranque), nunca del cuerpo.
 *  - Autenticidad: cabecera `x-elephant-webhook-token` con el token PROPIO de la empresa (bóveda, `postmark.webhookToken`,
 *    generado en su panel), comparada en tiempo constante. Sin token configurado, 503; con otro token (p. ej. el de otra
 *    empresa), 401. Nada cambia en ninguno de los dos casos.
 *  - Solo se aplican eventos de mensajes de esta empresa (referencia `es1.t.<empresa>.<id>`); los de otra se ignoran.
 *  - Idempotente: cada evento se aplica una vez (`mail_events.provider_event_id` único). Misma lógica que el webhook de la
 *    plataforma: entregado, rebote (duro → supresión), queja (supresión) y baja (supresión).
 */
import express, { type Request, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { postmarkWebhookHandler, type BrevoWebhookDeps } from "./webhook";
import { tenantMailService } from "./tenantMail";
import { TENANT_POSTMARK_WEBHOOK_PATH, tenantPostmarkWebhookToken } from "./tenantPostmark";

/** Cuerpo máximo admitido (Postmark envía un evento por llamada). */
export const TENANT_POSTMARK_WEBHOOK_MAX_BYTES = 1024 * 1024;

/** Manejador (sin el límite de peticiones), inyectable en pruebas. */
export function tenantPostmarkWebhookHandler(o: { token?: () => string | null; resolve?: BrevoWebhookDeps["resolve"]; log?: BrevoWebhookDeps["log"] } = {}) {
  return async (req: Request, res: Response) => {
    if (!isMultiTenant()) return void res.status(404).json({ error: "not_found" });
    const tenantId = getTenantIdOrDefault();
    if (tenantId === "unresolved") return void res.status(404).json({ error: "not_found" });
    if (Number(req.headers["content-length"] ?? 0) > TENANT_POSTMARK_WEBHOOK_MAX_BYTES) return void res.status(413).json({ error: "too_large" });
    const handler = postmarkWebhookHandler({
      token: o.token ?? tenantPostmarkWebhookToken,
      // Solo el carril de la empresa del dominio; una referencia de otra empresa no encuentra servicio
      resolve: o.resolve ?? (async (lane, ref) => (lane === "tenant" && ref === tenantId ? tenantMailService() : null)),
      log: o.log,
    });
    await handler(req, res);
  };
}

export function createTenantPostmarkWebhookRouter(opts: { perIpMinute?: number } = {}): Router {
  const r = express.Router({ caseSensitive: true });
  r.post(
    TENANT_POSTMARK_WEBHOOK_PATH,
    rateLimit({ windowMs: 60_000, limit: opts.perIpMinute ?? 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `pm-webhook:ip:${ipKeyGenerator(req.ip ?? "")}` }),
    (req, res, next) => void tenantPostmarkWebhookHandler()(req, res).catch(next),
  );
  return r;
}
