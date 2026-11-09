/**
 * Webhook de WhatsApp Cloud API de CADA empresa: GET y POST /api/whatsapp/webhook en el dominio de la empresa (la URL
 * que la empresa escribe en su app de Meta). Fuera de /api/trpc (no cambia la lista blanca de server/authGuard.ts),
 * como el webhook de Postmark de cada empresa.
 *
 *  - La empresa sale del dominio de la petición (resolución de empresas del arranque), nunca del cuerpo. Además, solo se
 *    aceptan cambios del número de la empresa (`phone_number_id` de su credencial): nada entra en otra empresa.
 *  - GET (alta de la suscripción en Meta): `hub.verify_token` igual al token de la empresa (≥ 24 caracteres, tiempo
 *    constante) y licencia `whatsapp-ai` activa → `hub.challenge`; si no, 403.
 *  - POST: firma `X-Hub-Signature-256` del cuerpo EXACTO con el App Secret de la empresa (tiempo constante). Sin App
 *    Secret o con otra firma, 401 y nada cambia. Cuerpo como mucho de 512 KB, leído aquí ANTES del lector general.
 *  - Idempotente por id de mensaje (wamid). Sin licencia activa (o sin las tablas) responde 200 sin guardar nada, para
 *    que Meta no reintente; la respuesta automática de la IA, si está activada, se hace tras responder a Meta.
 */
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { withTenantDb } from "../_core/dbRegistry";
import { getTenantId, getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { WHATSAPP_WEBHOOK_PATH } from "../../shared/whatsappCloud";
import { whatsappCredentials, whatsappLicensed, whatsappService } from "./runtime";
import type { WhatsappService } from "./service";
import { WEBHOOK_MAX_BYTES, signatureValid, verifyChallenge } from "./webhook";

const raw = express.raw({ type: () => true, limit: WEBHOOK_MAX_BYTES });

/** Lector del cuerpo (bytes exactos para la firma). Se monta ANTES del lector general (50 MB) del arranque. */
export const whatsappWebhookBodyParser: RequestHandler = (req, res, next) => {
  if (req.method !== "POST" || req.path.replace(/\/+$/, "") !== WHATSAPP_WEBHOOK_PATH) return next();
  if (Number(req.headers["content-length"] ?? 0) > WEBHOOK_MAX_BYTES) return void res.status(413).json({ error: "too_large" });
  raw(req, res, (err?: unknown) => {
    if (err) return void res.status((err as { type?: string }).type === "entity.too.large" ? 413 : 400).json({ error: "invalid_body" });
    next();
  });
};

/** Lo único que se registra de un error: su nombre y su código (nunca el mensaje). */
export const errorInfo = (e: unknown) => ({ error: e instanceof Error ? e.name.slice(0, 60) : "error", code: typeof (e as { code?: unknown })?.code === "string" || typeof (e as { code?: unknown })?.code === "number" ? String((e as { code: unknown }).code).slice(0, 40) : null });

const log = (event: string, extra: Record<string, unknown> = {}) => console.warn(JSON.stringify({ ctx: "WhatsAppAI", event, ...extra }));

export interface WebhookDeps {
  credentials?: () => Promise<Record<string, string>>;
  licensed?: (write: boolean) => Promise<boolean>;
  service?: () => WhatsappService;
  /** Ejecuta la respuesta automática tras responder a Meta (las pruebas pueden esperarla). */
  defer?: (fn: () => Promise<unknown>) => void;
}

export function whatsappVerifyHandler(d: WebhookDeps = {}) {
  return async (req: Request, res: Response) => {
    if (!isMultiTenant()) return void res.status(404).json({ error: "not_found" });
    const creds = await (d.credentials ?? whatsappCredentials)();
    const challenge = verifyChallenge(req.query as Record<string, unknown>, creds.verifyToken);
    if (!challenge || !(await (d.licensed ?? whatsappLicensed)(true))) {
      log("verify_rejected");
      return void res.status(403).type("text/plain").send("Forbidden");
    }
    res.status(200).type("text/plain").send(challenge);
  };
}

export function whatsappEventsHandler(d: WebhookDeps = {}) {
  return async (req: Request, res: Response) => {
    if (!isMultiTenant()) return void res.status(404).json({ error: "not_found" });
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body) return void res.status(400).json({ error: "invalid_body" });
    const creds = await (d.credentials ?? whatsappCredentials)();
    if (!signatureValid(body, req.headers["x-hub-signature-256"], creds.appSecret)) {
      log("signature_rejected", { configured: !!creds.appSecret });
      return void res.status(401).json({ error: "unauthorized" });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return void res.status(400).json({ error: "invalid_body" });
    }
    if (!(await (d.licensed ?? whatsappLicensed)(true))) {
      log("ignored_not_licensed");
      return void res.status(200).json({ ok: true, ignored: "not_licensed" });
    }
    const svc = (d.service ?? (() => whatsappService()))();
    let r: Awaited<ReturnType<WhatsappService["handleWebhook"]>>;
    try {
      r = await svc.handleWebhook(payload);
    } catch (e) {
      if (e instanceof Error && e.name === "WhatsappNotInstalled") {
        log("ignored_not_installed");
        return void res.status(200).json({ ok: true, ignored: "not_installed" });
      }
      // Solo el tipo y el código del error: el mensaje puede llevar datos del cliente o de la conexión
      log("webhook_error", errorInfo(e));
      return void res.status(500).json({ error: "error" });
    }
    res.status(200).json({ ok: true, received: r.inbound.length, duplicates: r.duplicates, statuses: r.statuses });
    if (r.foreign) log("foreign_changes_ignored", { count: r.foreign });
    if (!r.inbound.length) return;
    const run = async () => {
      for (const m of r.inbound) await svc.autoReply(m.conversationId, m.messageId);
    };
    (d.defer ?? tenantDeferral())(run);
  };
}

/**
 * Ejecución diferida (tras responder a Meta) EN LA EMPRESA de la petición: la empresa se fija al recibir el webhook y la
 * tarea corre con `withTenantDb` (contexto y conexión propios de esa empresa), no con el contexto de una petición ya
 * terminada. Nunca lanza.
 */
export function tenantDeferral(o: { tenantId?: () => string; run?: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>; schedule?: (cb: () => void) => void } = {}) {
  return (fn: () => Promise<unknown>) => {
    const tenantId = (o.tenantId ?? getTenantId)();
    const run = o.run ?? withTenantDb;
    (o.schedule ?? setImmediate)(() => {
      void run(tenantId, fn).catch((e: unknown) => log("auto_reply_error", errorInfo(e)));
    });
  };
}

/** Clave del límite de peticiones: empresa del dominio e IP (una empresa no agota el cupo de otra). */
const rateKey = (req: Request) => `wa-webhook:${getTenantIdOrDefault()}:${ipKeyGenerator(req.ip ?? "")}`;

export function createWhatsappWebhookRouter(opts: { perIpMinute?: number } & WebhookDeps = {}): Router {
  const r = express.Router({ caseSensitive: true });
  const limiter = rateLimit({ windowMs: 60_000, limit: opts.perIpMinute ?? 1200, standardHeaders: true, legacyHeaders: false, keyGenerator: rateKey });
  r.get(WHATSAPP_WEBHOOK_PATH, limiter, (req, res, next) => void whatsappVerifyHandler(opts)(req, res).catch(next));
  r.post(WHATSAPP_WEBHOOK_PATH, limiter, (req, res, next) => void whatsappEventsHandler(opts)(req, res).catch(next));
  return r;
}
