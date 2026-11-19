/**
 * Receptor del webhook de cuentas conectadas (`POST /api/stripe/connect/webhook`), UN solo destino central para todas
 * las empresas. Se monta ANTES de resolver la empresa por el host (como el acceso centralizado), porque Stripe llama
 * siempre a la misma URL.
 *
 *  - Firma verificada sobre los bytes originales con el secreto del destino Connect (`CONNECT_STRIPE_WEBHOOK_SECRET`,
 *    distinto del webhook del Stripe corporativo). Sin firma válida: 400, sin efecto.
 *  - La empresa sale del metadato `tenant_id` que pusimos nosotros al crear la cuenta o la sesión; NO se confía en él:
 *    la empresa solo aplica el evento si `event.account` es EXACTAMENTE la cuenta que ella tiene vinculada. Un evento de
 *    otra cuenta queda aislado (200, sin efecto, sin tocar nada).
 *  - Cada evento se aplica una sola vez (clave `event.id` en la base de la empresa).
 *  - Responde 200 a lo ajeno/ignorado/repetido y 500 solo si falla aplicar un pago real (Stripe reintenta).
 *  - Nunca se registra el cuerpo, la firma ni el secreto.
 */
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { opsLog } from "../_core/ops/log";
import { connectConfigState, type ConnectConfig } from "./config";
import { verifyConnectEvent } from "./gateway";
import { claimedTenantId, handleConnectEvent, type ConnectEvent, type EventOutcome, type PaymentsDeps } from "./service";

export const CONNECT_WEBHOOK_PATH = "/api/stripe/connect/webhook";

export interface ConnectWebhookDeps {
  config?: () => ConnectConfig | null;
  verify?: (cfg: ConnectConfig, raw: Buffer, signature: string) => ConnectEvent;
  /** ¿La empresa existe y está servible? */
  tenantAllowed: (tenantId: string) => Promise<boolean>;
  /** Ejecuta la aplicación del evento EN la empresa (contexto y conexión propios). */
  runInTenant: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>;
  /** Dependencias del servicio ya ligadas a la empresa en curso (almacén, pasarela, presupuestos). */
  paymentsFor: (tenantId: string, cfg: ConnectConfig) => PaymentsDeps;
}

/** Cuerpo original (bytes exactos) solo para este POST; debe montarse antes de `express.json`. */
export const connectWebhookBodyParser: RequestHandler = (req, res, next) =>
  req.method === "POST" && req.path === CONNECT_WEBHOOK_PATH ? express.raw({ type: "*/*", limit: "1mb" })(req, res, next) : next();

export function connectWebhookHandler(d: ConnectWebhookDeps) {
  return async (req: Request, res: Response) => {
    const cfg = (d.config ?? (() => connectConfigState().config))();
    if (!cfg) return void res.status(404).json({ error: "not_found" });
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !signature || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return void res.status(400).json({ error: "invalid_request" });
    }
    let ev: ConnectEvent;
    try {
      ev = (d.verify ?? ((c, r, s) => verifyConnectEvent(c, r, s) as unknown as ConnectEvent))(cfg, req.body, signature);
    } catch {
      opsLog("warn", "StripeConnectWebhook", "invalid_signature", {});
      return void res.status(400).json({ error: "invalid_signature" });
    }
    const tenantId = claimedTenantId(ev);
    if (!tenantId || !(await d.tenantAllowed(tenantId).catch(() => false))) {
      opsLog("warn", "StripeConnectWebhook", "unknown_tenant", { eventId: ev.id, type: ev.type });
      return void res.status(200).json({ received: true, ignored: "unknown_tenant" });
    }
    let outcome: EventOutcome;
    try {
      outcome = await d.runInTenant(tenantId, () => handleConnectEvent(d.paymentsFor(tenantId, cfg), ev));
    } catch (e) {
      opsLog("error", "StripeConnectWebhook", "apply_failed", { eventId: ev.id, type: ev.type, tenantId, error: e instanceof Error ? e.name : "error" });
      return void res.status(500).json({ error: "apply_failed" });
    }
    if (outcome === "isolated" || outcome === "amount_mismatch") opsLog("warn", "StripeConnectWebhook", outcome, { eventId: ev.id, type: ev.type, tenantId });
    res.status(200).json({ received: true, outcome });
  };
}

export function createConnectWebhookRouter(d: ConnectWebhookDeps, opts: { perIpMinute?: number } = {}): Router {
  const r = express.Router({ caseSensitive: true });
  const limiter = rateLimit({ windowMs: 60_000, limit: opts.perIpMinute ?? 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `connect-webhook:${ipKeyGenerator(req.ip ?? "")}` });
  r.post(CONNECT_WEBHOOK_PATH, connectWebhookBodyParser, limiter, (req, res, next) => void connectWebhookHandler(d)(req, res).catch(next));
  return r;
}
