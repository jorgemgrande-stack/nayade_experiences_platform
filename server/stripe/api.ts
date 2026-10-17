/**
 * Stripe Billing en el plano de control (`/cp/v1/stripe/*`). SOLO MODO PRUEBAS y solo operadores.
 *
 *   GET  /stripe/status                         ops:read      configuración (sin secretos) y catálogo enlazado
 *   GET  /stripe/catalog/plan                   ops:read      escrituras que FALTAN en Stripe (las ejecuta una persona)
 *   POST /stripe/catalog/sync                   orders:write  enlaza los Prices que ya existen (solo lectura en Stripe)
 *   POST /stripe/orders/:id/checkout            orders:write  abre o reutiliza la Checkout Session del pedido (*)
 *   POST /stripe/orders/:id/checkout/expire     orders:write  cierra la sesión abierta del pedido
 *   POST /stripe/checkout/:sessionId/sync       orders:read   relee sesión y suscripción (no confirma nada)
 *   GET  /stripe/events                         ops:read      eventos por estado (pendientes, fallidos…)
 *   POST /stripe/events/:id/retry               orders:write  reprograma ya un evento fallido
 *   POST /stripe/reconcile                      orders:write  conciliación manual (la misma que la periódica)
 *
 * El webhook (`POST /cp/v1/stripe/webhook`) no usa token: se autentica por firma y se monta aparte, antes
 * del analizador JSON global (server/stripe/webhook.ts).
 *
 * (*) Además exige CP_STRIPE_CHECKOUT_ENABLED=1 y las URL de vuelta; si no, 409 `checkout_disabled`.
 * No hay ninguna ruta pública: el registro público sigue cerrado. El Customer Portal no se expone
 * hasta que sus cambios se sincronicen con webhooks (Fase C/E).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CatalogPort } from "../subscriptions/ports";
import { StripeCatalogError, desiredCatalog, planCatalogWrites, syncCatalog } from "./catalog";
import { StripeCheckoutError, type StripeCheckoutService } from "./checkout";
import { describeStripeConfig, type StripeConfig } from "./config";
import { StripeGatewayError, type StripeGateway } from "./gateway";
import { StripeStoreError, type StripeStore } from "./store";
import type { StripeEventProcessor } from "./events";
import type { StripeReconciler } from "./reconcile";

const STATUS: Record<string, number> = { not_found: 404, invalid_state: 409, unsupported: 422, unavailable: 409, conflict: 409, price_conflict: 409, open_session_exists: 409 };

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof StripeCheckoutError || e instanceof StripeStoreError) return void res.status(STATUS[e.code] ?? 400).json({ error: e.code, message: e.message });
      if (e instanceof StripeCatalogError) return void res.status(409).json({ error: "catalog_invalid", message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "Stripe", "gateway_error", { code: e.code, retryable: e.retryable });
        recordFailure("stripe.gateway_error");
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable });
      }
      opsLog("error", "Stripe", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("stripe.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const sessionId = z.string().regex(/^cs_test_[A-Za-z0-9]{8,240}$/);
const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

export interface StripeRouterDeps {
  config: StripeConfig;
  store: StripeStore;
  gateway: StripeGateway;
  catalog: CatalogPort;
  /** null si faltan las URL de vuelta o no está CP_STRIPE_CHECKOUT_ENABLED=1. */
  checkout: StripeCheckoutService | null;
  processor?: StripeEventProcessor;
  reconciler?: StripeReconciler;
  now?: () => number;
}

export function createStripeRouter(d: StripeRouterDeps): Router {
  const r = express.Router();
  const now = d.now ?? Date.now;

  r.get("/status", requireScope("ops:read"), wrap(async (_req, res) => {
    res.json({ ...describeStripeConfig(d.config), checkoutEnabled: !!d.checkout, prices: await d.store.listPrices() });
  }));
  r.get("/catalog/plan", requireScope("ops:read"), wrap(async (_req, res) => {
    const desired = await desiredCatalog(d.catalog);
    res.json({ desired, ...(await planCatalogWrites(desired, d.gateway)) });
  }));
  r.post("/catalog/sync", requireScope("orders:write"), wrap(async (req, res) => {
    const report = await syncCatalog(await desiredCatalog(d.catalog), d.gateway, d.store, now());
    opsLog("info", "Stripe", "catalog_sync", { linked: report.linked.length, missing: report.missing.length, conflicts: report.conflicts.length, actor: who(req) });
    if (report.conflicts.length) recordFailure("stripe.catalog_conflict");
    res.status(report.conflicts.length ? 409 : 200).json(report);
  }));
  r.post("/orders/:id/checkout", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.checkout) return void res.status(409).json({ error: "checkout_disabled", message: "Checkout desactivado (CP_STRIPE_CHECKOUT_ENABLED y URL de vuelta)" });
    res.json(await d.checkout.start(id.parse(req.params.id), who(req)));
  }));
  r.post("/orders/:id/checkout/expire", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.checkout) return void res.status(409).json({ error: "checkout_disabled", message: "Checkout desactivado" });
    res.json(await d.checkout.expire(id.parse(req.params.id), who(req)));
  }));
  r.post("/checkout/:sessionId/sync", requireScope("orders:read"), wrap(async (req, res) => {
    if (!d.checkout) return void res.status(409).json({ error: "checkout_disabled", message: "Checkout desactivado" });
    res.json(await d.checkout.sync(sessionId.parse(req.params.sessionId)));
  }));
  r.get("/events", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ counts: await d.store.eventCounts() })));
  r.post("/events/:id/retry", requireScope("orders:write"), wrap(async (req, res) => {
    const eventId = z.string().regex(/^evt_[A-Za-z0-9]{8,240}$/).parse(req.params.id);
    const ev = await d.store.event(eventId);
    if (!ev) return void res.status(404).json({ error: "not_found", message: "Evento no registrado" });
    if (ev.status !== "failed") return void res.status(409).json({ error: "invalid_state", message: `El evento está en «${ev.status}»: solo se reprograma uno fallido` });
    await d.store.failEvent(eventId, ev.lastError ?? "Reintento manual", now());
    opsLog("info", "Stripe", "event_retry", { eventId, actor: who(req) });
    res.json({ scheduled: true, result: d.processor ? await d.processor.processDue(10) : null });
  }));
  r.post("/reconcile", requireScope("orders:write"), wrap(async (req, res) => {
    if (!d.reconciler) return void res.status(409).json({ error: "unavailable", message: "Conciliación no disponible" });
    const out = await d.reconciler.tick();
    opsLog("info", "Stripe", "reconcile_manual", { actor: who(req), skipped: out.skipped, recovered: out.recovered });
    res.status(out.skipped ? 409 : 200).json(out);
  }));
  return r;
}
