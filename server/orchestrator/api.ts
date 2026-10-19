/**
 * Pedidos de contratación (`/cp/v1/orders/*`) y webhook del proveedor de pagos de PRUEBA.
 *
 * Ámbitos: `orders:read` (consultar), `orders:write` (crear, aceptar, pedir el pago, cancelar,
 * renovar), `orders:approve` (aprobación administrativa sin pago). Lo que da de alta plataformas o
 * concede licencias exige además `provisioning:write`, `subscriptions:write` y `entitlements:write`.
 *
 * El webhook (`/cp/v1/payments/test/webhook`) no usa token: se autentica por firma HMAC y solo existe
 * si hay proveedor de pruebas configurado.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError } from "../crm/types";
import { LicensingError } from "../licensing/service";
import { SubscriptionError } from "../subscriptions/types";
import { TrialError } from "../trials/service";
import { PaymentSignatureError } from "./payments";
import type { CommercialOrchestrator } from "./service";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { APPROVAL_CATEGORIES, ORDER_STATES, OrderError } from "./types";

const STATUS: Record<string, number> = { not_found: 404, invalid_input: 400, invalid_state: 409, conflict: 409, forbidden: 403, unavailable: 409, version_conflict: 409, limit: 429 };
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof OrderError || e instanceof CrmError || e instanceof SubscriptionError || e instanceof TrialError || e instanceof LicensingError) {
        return void res.status(STATUS[e.code] ?? 400).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      opsLog("error", "Orders", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("orders.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
/** Lo que crea plataformas o concede licencias: los mismos permisos que el alta y las licencias. */
const ACTIVATION = [requireScope("provisioning:write"), requireScope("subscriptions:write"), requireScope("entitlements:write")];

export function createOrdersRouter(svc: CommercialOrchestrator): Router {
  const r = express.Router();
  const send = (res: Response, out: Awaited<ReturnType<CommercialOrchestrator["advance"]>>, ok = 200) =>
    void res.status(out.error ? 409 : out.waitingFor ? 202 : ok).json(out);

  r.get("/payments/config", requireScope("orders:read"), (_req, res) => void res.json(svc.paymentsConfig));
  r.get("/", requireScope("orders:read"), wrap(async (req, res) => {
    const q = z.object({ state: z.enum(ORDER_STATES).optional(), companyId: z.coerce.number().int().positive().optional() }).parse(req.query);
    res.json({ orders: await svc.list({ states: q.state ? [q.state] : undefined, companyId: q.companyId }) });
  }));
  r.post("/review", requireScope("orders:write"), ...ACTIVATION, wrap(async (req, res) => void res.json(await svc.review(who(req)))));
  r.post("/", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z
      .object({
        idempotencyKey: z.string().max(80).optional(),
        leadRequestId: id.optional(),
        trialId: id.optional(),
        companyId: id.optional(),
        changeOf: id.optional(),
        request: z.unknown().optional(),
        interval: z.enum(["month", "year"]).optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const key = b.idempotencyKey ?? String(req.headers["idempotency-key"] ?? "");
    const out = await svc.create({ ...b, idempotencyKey: key }, who(req));
    res.status(out.created ? 201 : 200).json(out);
  }));
  r.get("/:id", requireScope("orders:read"), wrap(async (req, res) => void res.json(await svc.detail(id.parse(req.params.id)))));
  r.post("/:id/advance", requireScope("orders:write"), ...ACTIVATION, wrap(async (req, res) => send(res, await svc.advance(id.parse(req.params.id), who(req)))));
  r.post("/:id/accept", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ signatureRef: z.string().trim().min(3).max(200), approvalReason: z.string().trim().max(300).optional() }).strict().parse(req.body);
    send(res, await svc.accept(id.parse(req.params.id), b, who(req)));
  }));
  r.post("/:id/payments", requireScope("orders:write"), wrap(async (req, res) => {
    const out = await svc.requestPayment(id.parse(req.params.id), who(req));
    res.status(out.created ? 201 : 200).json(out);
  }));
  r.post("/:id/approve", requireScope("orders:approve"), ...ACTIVATION, wrap(async (req, res) => {
    // En live el servicio exige además la categoría (y la referencia si es un cobro fuera de Stripe)
    const b = z.object({ reason: z.string().trim().min(5).max(300), category: z.enum(APPROVAL_CATEGORIES).optional(), reference: z.string().trim().min(3).max(80).optional() }).strict().parse(req.body);
    send(res, await svc.approve(id.parse(req.params.id), b, who(req)));
  }));
  r.post("/:id/cancel", requireScope("orders:write"), requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse(req.body);
    res.json(await svc.cancel(id.parse(req.params.id), b, who(req)));
  }));
  r.post("/:id/reject", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse(req.body);
    res.json({ order: await svc.reject(id.parse(req.params.id), b, who(req)) });
  }));
  r.post("/:id/renew", requireScope("orders:write"), ...ACTIVATION, wrap(async (req, res) => void res.json(await svc.renew(id.parse(req.params.id), who(req)))));
  return r;
}

/** Webhook firmado del proveedor de pruebas. Respuesta mínima: no revela pedidos ni importes. */
export function paymentsWebhookHandler(svc: CommercialOrchestrator) {
  return (req: Request, res: Response) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
    const sig = String(req.headers["x-test-signature"] ?? "");
    svc
      .handlePaymentEvent(raw, sig)
      .then((out) => void res.json(out))
      .catch((e) => {
        if (e instanceof PaymentSignatureError) return void res.status(400).json({ error: "invalid_signature" });
        opsLog("error", "Orders", "payment_event_failed", { error: e instanceof Error ? e.name : "error" });
        recordFailure("orders.failed");
        // 500: el proveedor reintenta; si el evento llegó a registrarse, el reintento es un duplicado sin efecto
        res.status(500).json({ error: "internal_error" });
      });
  };
}
