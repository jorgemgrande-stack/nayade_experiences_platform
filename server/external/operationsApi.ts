/**
 * Operaciones de clientes externos (`/cp/v1/external-ops/*`, operadores del CRM): cobros únicos e infraestructura
 * recurrente. Guardar nunca cobra ni envía; emitir y enviar son órdenes explícitas.
 *
 *   GET   /external-ops?companyId=                       crm:read        operaciones
 *   POST  /external-ops                                  orders:write    nueva operación (borrador)
 *   GET   /external-ops/:id                              crm:read        detalle: periodos, cobros e historial
 *   PATCH /external-ops/:id                              orders:write    edición del borrador
 *   POST  /external-ops/:id/activate                     orders:approve  infraestructura: borrador → activa
 *   POST  /external-ops/:id/cancel                       orders:write    cancelación (lo emitido sigue su curso)
 *   POST  /external-ops/:id/periods                      orders:write    prepara un periodo de infraestructura
 *   PATCH /external-ops/:id/periods/:pid                 orders:write    consumo; ajustes y exceso con orders:approve
 *   POST  /external-ops/:id/periods/:pid/issue           orders:approve  emite: cargo con desglose y factura
 *   POST  /external-ops/:id/periods/:pid/payment-link    billing:write   enlace de pago de Stripe
 *   POST  /external-ops/:id/periods/:pid/send            orders:write    nota de cobro al cliente con el enlace
 *   POST  /external-ops/:id/periods/:pid/offline-payment orders:approve  pago externo con su referencia
 *   (un descuento o recargo comercial exige además orders:approve)
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { StripeGatewayError } from "../stripe/gateway";
import { ExternalError } from "./types";
import type { ExternalOperationsService } from "./operations";

const STATUS: Record<ExternalError["code"], number> = { forbidden: 403, not_found: 404, invalid_input: 400, invalid_state: 409, conflict: 409, unavailable: 503 };

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof ExternalError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "ExternalOps", "gateway_error", { code: e.code, retryable: e.retryable });
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable, message: "Stripe ha devuelto un error" });
      }
      opsLog("error", "ExternalOps", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("external.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const cents = z.number().int();
const line = z
  .object({
    key: z.string().max(40),
    concept: z.string().max(200),
    category: z.enum(["service", "server", "railway", "storage", "domain", "ai_tokens", "other"]),
    pricing: z.enum(["fixed", "variable"]),
    quantity: z.number().int().optional(),
    unitCents: cents.optional(),
    provider: z.string().max(80).optional(),
    marginBp: z.number().int().optional(),
    marginCents: cents.optional(),
    capCents: cents.nullable().optional(),
  })
  .strict();
const fields = {
  title: z.string().max(200),
  taxRateBp: z.number().int(),
  lines: z.array(line).max(40),
  adjustment: z.object({ type: z.enum(["discount", "surcharge"]), mode: z.enum(["percent", "amount"]), value: z.number().int(), reason: z.string().max(300) }).strict().nullable().optional(),
  dueDate: z.string().max(10).nullable().optional(),
  billingDay: z.number().int().nullable().optional(),
  dueDays: z.number().int().nullable().optional(),
  startPeriod: z.string().max(7).nullable().optional(),
  capCents: cents.nullable().optional(),
  recipientName: z.string().max(160).nullable().optional(),
  recipientEmail: z.string().max(254).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
};
const createBody = z.object({ companyId: z.number().int().positive(), kind: z.enum(["one_off", "infrastructure"]), ...fields }).strict();
const updateBody = z.object(fields).strict();
const usage = z.record(z.string().max(40), cents);
const id = (req: Request, k = "id") => z.coerce.number().int().positive().parse(req.params[k]);
const actor = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`.slice(0, 100);
const canAuthorize = (req: Request) => !!getAuth(req)?.scopes.has("orders:approve");

export function createExternalOperationsRouter(svc: ExternalOperationsService): Router {
  const r = express.Router();
  r.use(express.json({ limit: "64kb" }));
  r.get("/", requireScope("crm:read"), wrap(async (req, res) => {
    const companyId = req.query.companyId === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.companyId);
    res.json({ operations: await svc.list({ companyId }) });
  }));
  r.post("/", requireScope("orders:write"), wrap(async (req, res) => {
    const out = await svc.create(createBody.parse(req.body ?? {}), actor(req), { canAuthorize: canAuthorize(req) });
    opsLog("info", "ExternalOps", "created", { operationId: out.operation.id, kind: out.operation.kind, companyId: out.operation.companyId });
    res.status(201).json(out);
  }));
  r.get("/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.detail(id(req)))));
  r.patch("/:id", requireScope("orders:write"), wrap(async (req, res) => void res.json(await svc.update(id(req), updateBody.parse(req.body ?? {}), actor(req), { canAuthorize: canAuthorize(req) }))));
  r.post("/:id/activate", requireScope("orders:approve"), wrap(async (req, res) => void res.json(await svc.activate(id(req), actor(req)))));
  r.post("/:id/cancel", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(300) }).strict().parse(req.body ?? {});
    res.json(await svc.cancel(id(req), b.reason, actor(req)));
  }));
  r.post("/:id/periods", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ period: z.string().max(7), usage: usage.nullable().optional() }).strict().parse(req.body ?? {});
    res.status(201).json({ period: await svc.period(id(req), b, actor(req)) });
  }));
  r.patch("/:id/periods/:pid", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z
      .object({ usage: usage.nullable().optional(), adjustments: z.array(z.object({ key: z.string().max(40), amountCents: cents, reason: z.string().max(300) }).strict()).max(40).optional(), authorizeOverCap: z.object({ reason: z.string().max(300) }).strict().optional() })
      .strict()
      .parse(req.body ?? {});
    res.json({ period: await svc.updatePeriod(id(req), id(req, "pid"), b, actor(req), { canAuthorize: canAuthorize(req) }) });
  }));
  r.post("/:id/periods/:pid/issue", requireScope("orders:approve"), wrap(async (req, res) => {
    const p = await svc.issue(id(req), id(req, "pid"), actor(req));
    opsLog("info", "ExternalOps", "issued", { operationId: p.operationId, period: p.period, chargeId: p.chargeId, invoiceId: p.invoiceId });
    res.json({ period: p });
  }));
  r.post("/:id/periods/:pid/payment-link", requireScope("billing:write"), wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ link: await svc.paymentLink(id(req), id(req, "pid"), actor(req)) });
  }));
  r.post("/:id/periods/:pid/send", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ to: z.string().max(254).nullable().optional() }).strict().parse(req.body ?? {});
    const out = await svc.send(id(req), id(req, "pid"), b, actor(req));
    opsLog("info", "ExternalOps", "sent", { operationId: out.period.operationId, period: out.period.period, status: out.mail.status });
    res.json(out);
  }));
  r.post("/:id/periods/:pid/offline-payment", requireScope("orders:approve"), wrap(async (req, res) => {
    const b = z.object({ reference: z.string().max(120), paidAt: z.number().int().positive().nullable().optional() }).strict().parse(req.body ?? {});
    res.json({ period: await svc.offlinePayment(id(req), id(req, "pid"), b, actor(req)) });
  }));
  return r;
}
