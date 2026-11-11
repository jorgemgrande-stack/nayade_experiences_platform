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
 *   POST  /external-ops/:id/periods/:pid/offline-payment orders:approve  pago externo con su referencia (sin 0050)
 *   POST  /external-ops/:id/periods/:pid/transfer        orders:approve + billing:write  transferencia con justificante PDF
 *   POST  /external-ops/:id/periods/:pid/transfers/:payId/rectify  orders:approve + billing:write  rectificación auditada
 *   POST  /external-ops/:id/periods/:pid/transfers/:payId/void     orders:approve + billing:write  anulación con motivo
 *   GET   /external-ops/:id/periods/:pid/receipts/:docId orders:approve  justificante (PDF privado, sin caché)
 *   (un descuento o recargo comercial exige además orders:approve)
 *
 * La transferencia y su rectificación llevan el PDF en base64 dentro del JSON (hasta 10 MB): esas rutas leen su propio
 * cuerpo (`EXTERNAL_UPLOAD_PATHS`, fuera del lector general de 256 KB del plano de control).
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

/** Rutas con justificante en el cuerpo: el lector general del plano de control no las lee (lo hacen ellas). */
export const EXTERNAL_UPLOAD_PATHS = /^\/cp\/v1\/external-ops\/\d+\/periods\/\d+\/(transfer|transfers\/\d+\/rectify)\/?(\?|$)/;
const uploadJson = express.json({ limit: "15mb" });
const receiptBody = z.object({ filename: z.string().max(200), contentBase64: z.string().max(15_000_000) }).strict();
const transferBody = z
  .object({ amountCents: cents, receivedOn: z.string().max(10), reference: z.string().max(120).nullable().optional(), receipt: receiptBody, idempotencyKey: z.string().max(80), confirmed: z.literal(true) })
  .strict();
const rectifyBody = z.object({ reason: z.string().max(300), receivedOn: z.string().max(10).nullable().optional(), reference: z.string().max(120).nullable().optional(), receipt: receiptBody.nullable().optional() }).strict();

export function createExternalOperationsRouter(svc: ExternalOperationsService): Router {
  const r = express.Router();
  // Pagos por transferencia: antes del lector de 64 KB (llevan el PDF). Registrarlos es financiero: orders:approve y
  // billing:write; ver el justificante, orders:approve
  r.post("/:id/periods/:pid/transfer", requireScope("orders:approve"), requireScope("billing:write"), uploadJson, wrap(async (req, res) => {
    const b = transferBody.parse(req.body ?? {});
    const out = await svc.transferPayment(id(req), id(req, "pid"), b, actor(req));
    opsLog("info", "ExternalOps", "transfer_recorded", { operationId: out.period.operationId, period: out.period.period, replay: out.replay, links: out.stripe.map((x) => x.outcome) });
    res.json(out);
  }));
  r.post("/:id/periods/:pid/transfers/:payId/rectify", requireScope("orders:approve"), requireScope("billing:write"), uploadJson, wrap(async (req, res) => {
    const out = await svc.rectifyTransfer(id(req), id(req, "pid"), id(req, "payId"), rectifyBody.parse(req.body ?? {}), actor(req));
    opsLog("info", "ExternalOps", "transfer_rectified", { operationId: out.period.operationId, period: out.period.period });
    res.json(out);
  }));
  r.use(express.json({ limit: "64kb" }));
  r.post("/:id/periods/:pid/transfers/:payId/void", requireScope("orders:approve"), requireScope("billing:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(300) }).strict().parse(req.body ?? {});
    const out = await svc.voidTransfer(id(req), id(req, "pid"), id(req, "payId"), b, actor(req));
    opsLog("info", "ExternalOps", "transfer_voided", { operationId: out.period.operationId, period: out.period.period });
    res.json(out);
  }));
  r.get("/:id/periods/:pid/receipts/:docId", requireScope("orders:approve"), wrap(async (req, res) => {
    const { doc, content } = await svc.transferReceipt(id(req), id(req, "pid"), id(req, "docId"));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/[^\w.\- ()]/g, "_")}"`);
    res.send(content);
  }));
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
