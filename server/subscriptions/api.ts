/**
 * Suscripciones (`/cp/v1/subscriptions/*`), modo sombra. Ámbitos: `subscriptions:read` (consultar y
 * previsualizar) y `subscriptions:write` (operaciones contractuales y simulaciones registradas).
 * Nada de lo que expone cobra, emite facturas fiscales ni toca licencias reales.
 *
 * Con `billingOf` (pedidos activos), el listado y la ficha dicen de dónde sale el cobro (`billing`): Stripe
 * Billing o simulación. Una suscripción cobrada en Stripe la gobiernan Stripe y el orquestador, así que aquí
 * se rechazan sus operaciones de simulación (409 `invalid_state`, `details.reason: "stripe_billed"`).
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import type { SubscriptionBilling } from "../orchestrator/subscriptionBilling";
import type { SubscriptionService } from "./service";
import type { ShadowBillingService } from "./shadow";
import { SubscriptionError } from "./types";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof SubscriptionError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      opsLog("error", "Subscriptions", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("orders.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const version = z.number().int().min(1);
const productKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const discount = z
  .object({ kind: z.enum(["percent", "amount"]), value: z.number().int().min(1).max(100_000_000), endsAt: z.number().int().min(0).nullable().default(null), note: z.string().max(200).nullable().default(null) })
  .strict()
  .nullable()
  .optional();
const itemSpec = z.object({ productKey, priceId: z.number().int().positive(), quantity: z.number().int().min(1).max(10_000).optional(), discount }).strict();
const when = z.enum(["now", "period_end"]).optional();
const reason = z.string().trim().max(500).nullable().optional();

export function createSubscriptionsRouter(svc: SubscriptionService, shadow: ShadowBillingService, billingOf?: (subscriptionId: number) => Promise<SubscriptionBilling>): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  const billing = async (subscriptionId: number): Promise<SubscriptionBilling> => (billingOf ? billingOf(subscriptionId) : { source: "shadow" });
  /** Id de la ruta, si la suscripción admite operaciones de simulación (no se cobra en Stripe). */
  const writable = async (req: Request) => {
    const sid = id.parse(req.params.id);
    const b = await billing(sid);
    if (b.source === "stripe") {
      throw new SubscriptionError("invalid_state", "Esta suscripción se cobra en Stripe: los cambios, renovaciones y cancelaciones se hacen desde su contratación o en Stripe", {
        reason: "stripe_billed",
        orderId: b.orderId,
      });
    }
    return sid;
  };

  r.get("/", requireScope("subscriptions:read"), wrap(async (req, res) => {
    const q = z.object({ companyId: z.coerce.number().int().positive().optional(), status: z.enum(["trialing", "active", "canceled"]).optional() }).parse(req.query);
    const list = await svc.list(q);
    res.json({ subscriptions: await Promise.all(list.map(async (s) => ({ ...s, billing: await billing(s.id) }))) });
  }));
  // Productos publicados con precios aprobados: lo que se puede contratar hoy
  r.get("/offer", requireScope("subscriptions:read"), wrap(async (_req, res) => void res.json({ products: await svc.offer() })));
  r.post("/", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z
      .object({
        companyId: z.number().int().positive(),
        contractId: z.number().int().positive().nullable().optional(),
        interval: z.enum(["month", "year"]),
        currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
        trialDays: z.number().int().min(0).max(60).optional(),
        plan: itemSpec,
        addons: z.array(itemSpec).max(30).optional(),
        reason,
      })
      .strict()
      .parse(req.body);
    res.status(201).json({ subscription: await svc.create(b, who(req)) });
  }));
  r.get("/:id", requireScope("subscriptions:read"), wrap(async (req, res) => {
    const sid = id.parse(req.params.id);
    res.json({ ...(await svc.detail(sid)), billing: await billing(sid) });
  }));
  r.get("/:id/preview", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await shadow.preview(id.parse(req.params.id)))));

  r.post("/:id/plan", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z.object({ plan: itemSpec, when, reason, expectedVersion: version }).strict().parse(req.body);
    res.json(await svc.changePlan(await writable(req), b, b.expectedVersion, who(req)));
  }));
  r.post("/:id/items", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z.object({ item: itemSpec, when, reason, expectedVersion: version }).strict().parse(req.body);
    res.status(201).json(await svc.addItem(await writable(req), b, b.expectedVersion, who(req)));
  }));
  r.post("/:id/items/:itemId/remove", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z.object({ when, reason, expectedVersion: version }).strict().parse(req.body);
    res.json(await svc.removeItem(await writable(req), id.parse(req.params.itemId), b, b.expectedVersion, who(req)));
  }));
  r.post("/:id/cancel", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(1).max(500), expectedVersion: version }).strict().parse(req.body);
    res.json(await svc.scheduleCancel(await writable(req), b, b.expectedVersion, who(req)));
  }));
  r.post("/:id/reactivate", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z.object({ reason, expectedVersion: version }).strict().parse(req.body);
    res.json(await svc.reactivate(await writable(req), b, b.expectedVersion, who(req)));
  }));
  r.post("/:id/interval", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z
      .object({ interval: z.enum(["month", "year"]), prices: z.array(z.object({ itemId: z.number().int().positive(), priceId: z.number().int().positive() }).strict()).max(40), reason, expectedVersion: version })
      .strict()
      .parse(req.body);
    res.json(await svc.changeInterval(await writable(req), b, b.expectedVersion, who(req)));
  }));
  r.post("/:id/usage", requireScope("subscriptions:write"), wrap(async (req, res) => {
    const b = z
      .object({ itemId: z.number().int().positive(), quantity: z.number().int().min(0).max(1e12), idempotencyKey: z.string().regex(/^[A-Za-z0-9:._-]{8,128}$/), source: z.string().regex(/^[a-z0-9_-]{1,40}$/) })
      .strict()
      .parse(req.body);
    const out = await svc.recordUsage(id.parse(req.params.id), b);
    res.status(out.created ? 201 : 200).json(out);
  }));
  // Simulación: aplica las renovaciones vencidas (nada lo programa solo)
  r.post("/:id/renewals", requireScope("subscriptions:write"), wrap(async (req, res) => void res.json({ subscription: await svc.applyRenewals(await writable(req), who(req)) })));
  // Simulación de facturación del periodo vigente: registra, idempotente; NUNCA cobra
  r.post("/:id/shadow", requireScope("subscriptions:write"), wrap(async (req, res) => void res.json(await shadow.simulateCurrent(await writable(req), who(req)))));
  return r;
}
