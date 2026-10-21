/**
 * Compra de módulos y ampliaciones (`/cp/v1/commerce/*`). La llama el Core en nombre de un usuario autorizado de
 * la empresa: el tenant de la ruta es el de la SESIÓN del Core (nunca lo elige el navegador) y el token de
 * servicio del Core es el único con `commerce:purchase`. Importes y derechos los calcula el servidor.
 *
 *   GET  /commerce/purchases/status                              ops:read            interruptores y modo
 *   POST /commerce/tenants/:tenantId/purchases/preview           commerce:purchase   prorrateo y partidas (no cambia nada)
 *   POST /commerce/tenants/:tenantId/purchases                   commerce:purchase   compra (idempotente por clave)
 *   GET  /commerce/tenants/:tenantId/purchases/:orderId          commerce:purchase   estado releído en Stripe
 *   POST /commerce/tenants/:tenantId/reductions/preview          commerce:purchase   bajas y reducciones a fin de periodo (no cambia nada)
 *   POST /commerce/tenants/:tenantId/reductions                  commerce:purchase   baja o reducción (idempotente; nunca bajo el uso real)
 *   POST /commerce/purchases/sync                                orders:write        conciliación de compras pendientes
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { StripeGatewayError } from "./gateway";
import { PurchaseError, type ModulePurchaseService } from "./purchases";
import { BillingPortalError, type BillingPortalService } from "./billingPortal";

const STATUS: Record<string, number> = { disabled: 503, not_found: 404, invalid_input: 400, invalid_state: 409, unavailable: 409, conflict: 409, async_payment_method: 409 };
const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const body = z
  .object({
    add: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(20).optional(),
    users: z.number().int().min(0).max(100_000).optional(),
    sites: z.number().int().min(0).max(10_000).optional(),
    storageGb: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
const reductionBody = z
  .object({
    remove: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(20).optional(),
    users: z.number().int().min(0).max(100_000).optional(),
    sites: z.number().int().min(0).max(10_000).optional(),
    storageGb: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
/** Usuario del Core que compra (solo para la auditoría: el permiso lo comprueba el Core). */
const buyer = z.string().regex(/^[A-Za-z0-9:_.@-]{1,80}$/);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof PurchaseError) return void res.status(STATUS[e.code] ?? 400).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "Purchases", "gateway_error", { code: e.code, retryable: e.retryable });
        recordFailure("stripe.gateway_error");
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable });
      }
      opsLog("error", "Purchases", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("purchases.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

export function createPurchasesRouter(svc: ModulePurchaseService): Router {
  const r = express.Router();
  const actor = (req: Request, user: string) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}/${user}`.slice(0, 100);
  r.get("/purchases/status", requireScope("ops:read"), wrap(async (_req, res) => void res.json(svc.status)));
  r.post("/purchases/sync", requireScope("orders:write"), wrap(async (_req, res) => void res.json(await svc.syncPending(50))));
  r.post("/tenants/:tenantId/purchases/preview", requireScope("commerce:purchase"), wrap(async (req, res) => {
    res.json({ preview: await svc.preview(tenant.parse(req.params.tenantId), body.parse(req.body ?? {})) });
  }));
  r.post("/tenants/:tenantId/purchases", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const { idempotencyKey, buyer: who, ...input } = z.object({ idempotencyKey: z.string(), buyer }).passthrough().parse(req.body ?? {});
    const result = await svc.purchase(t, body.parse(input), { idempotencyKey, actor: actor(req, who) });
    opsLog("info", "Purchases", "purchase", { tenantId: t, orderId: result.orderId, status: result.status, created: result.created });
    res.status(result.created ? 201 : 200).json({ purchase: result });
  }));
  r.post("/tenants/:tenantId/reductions/preview", requireScope("commerce:purchase"), wrap(async (req, res) => {
    res.json({ preview: await svc.previewReduction(tenant.parse(req.params.tenantId), reductionBody.parse(req.body ?? {})) });
  }));
  r.post("/tenants/:tenantId/reductions", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const { idempotencyKey, buyer: who, ...input } = z.object({ idempotencyKey: z.string(), buyer }).passthrough().parse(req.body ?? {});
    const result = await svc.reduce(t, reductionBody.parse(input), { idempotencyKey, actor: actor(req, who) });
    opsLog("info", "Purchases", "reduction", { tenantId: t, orderId: result.orderId, status: result.status, created: result.created });
    res.status(result.created ? 201 : 200).json({ reduction: result });
  }));
  r.get("/tenants/:tenantId/purchases/:orderId", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const orderId = z.coerce.number().int().positive().parse(req.params.orderId);
    res.json({ purchase: await svc.statusOf(t, orderId) });
  }));
  return r;
}

const PORTAL_STATUS: Record<BillingPortalError["code"], number> = { disabled: 503, not_found: 404, unsafe: 409, invalid: 400 };

/**
 * Portal de facturación de Stripe para la empresa (solo consulta de facturas y método de pago; ver
 * ./billingPortal.ts). Lo pide el Core en nombre de la persona propietaria con el token de comercio.
 */
export function createBillingPortalRouter(svc: BillingPortalService): Router {
  const r = express.Router();
  r.get("/billing-portal/status", requireScope("commerce:purchase"), (_req, res) => void res.json(svc.status));
  r.post("/tenants/:tenantId/billing-portal", requireScope("commerce:purchase"), (req, res) => {
    const run = async () => {
      const t = tenant.parse(req.params.tenantId);
      const { returnUrl } = z.object({ returnUrl: z.string().url().max(300) }).strict().parse(req.body ?? {});
      const session = await svc.open(t, returnUrl);
      opsLog("info", "BillingPortal", "opened", { tenantId: t });
      res.json({ url: session.url });
    };
    run().catch((e) => {
      if (e instanceof BillingPortalError) {
        if (e.code === "unsafe") recordFailure("stripe.portal_unsafe");
        return void res.status(PORTAL_STATUS[e.code]).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable });
      opsLog("error", "BillingPortal", "internal_error", { error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  });
  return r;
}
