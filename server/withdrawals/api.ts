/**
 * Rutas del desistimiento de consumidores.
 *
 * Del Core, en nombre del usuario de la empresa (el tenant es el de la SESIÓN del Core; ámbito propio y mínimo):
 *   GET  /commerce/tenants/:tenantId/withdrawal         commerce:withdrawal   ¿se puede desistir ahora? y última solicitud
 *   POST /commerce/tenants/:tenantId/withdrawal         commerce:withdrawal   solicitud (idempotente) → justificante
 *
 * De operadores:
 *   GET  /withdrawals?status=                            orders:read           solicitudes
 *   GET  /withdrawals/:id                                orders:read           detalle e historial
 *   POST /withdrawals                                    orders:write          registra una solicitud recibida por otro canal
 *   POST /withdrawals/:id/decision                       orders:write          revisar, aceptar, rechazar o completar
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { WITHDRAWAL_STATES } from "./store";
import { WithdrawalError, type WithdrawalService } from "./service";

const STATUS: Record<WithdrawalError["code"], number> = { invalid_input: 400, not_found: 404, not_applicable: 409, conflict: 409, invalid_state: 409 };
const tenant = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const user = z.string().regex(/^[A-Za-z0-9:_.@-]{1,80}$/);
const id = z.coerce.number().int().positive();
const requestBody = z
  .object({
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    requestedBy: user,
    contactEmail: z.string().trim().max(200),
    statement: z.string().trim().max(1000).optional(),
  })
  .strict();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof WithdrawalError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      opsLog("error", "Withdrawals", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };
const who = (req: Request, extra?: string) => {
  const a = getAuth(req)!.actor;
  return `${a.type}:${a.id}${extra ? `/${extra}` : ""}`.slice(0, 120);
};

/** Rutas del Core (montar bajo /commerce). */
export function createWithdrawalCommerceRouter(svc: WithdrawalService): Router {
  const r = express.Router();
  r.get("/tenants/:tenantId/withdrawal", requireScope("commerce:withdrawal"), wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ withdrawal: await svc.status(tenant.parse(req.params.tenantId)) });
  }));
  r.post("/tenants/:tenantId/withdrawal", requireScope("commerce:withdrawal"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const b = requestBody.parse(req.body ?? {});
    // Origen «cliente» en los eventos: el actor empieza por «customer»
    const out = await svc.request(t, { idempotencyKey: b.idempotencyKey, requestedBy: b.requestedBy, contactEmail: b.contactEmail, statement: b.statement ?? null, channel: "platform" }, `customer:${t}/${b.requestedBy}`.slice(0, 120));
    res.status(out.created ? 201 : 200).json(out);
  }));
  return r;
}

/** Rutas de operadores (montar bajo /withdrawals). */
export function createWithdrawalAdminRouter(svc: WithdrawalService): Router {
  const r = express.Router();
  r.get("/", requireScope("orders:read"), wrap(async (req, res) => {
    const status = z.enum(WITHDRAWAL_STATES).optional().parse(req.query.status || undefined);
    res.json({ withdrawals: await svc.list({ status, limit: 200 }) });
  }));
  r.get("/:id", requireScope("orders:read"), wrap(async (req, res) => void res.json(await svc.detail(id.parse(req.params.id)))));
  // Solicitud recibida por otro canal (correo, teléfono, formulario en papel): la registra soporte con su fecha real
  r.post("/", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z.object({ tenantId: tenant, contactEmail: z.string().trim().max(200), statement: z.string().trim().max(1000).optional(), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict().parse(req.body ?? {});
    const out = await svc.request(b.tenantId, { idempotencyKey: b.idempotencyKey, requestedBy: who(req), contactEmail: b.contactEmail, statement: b.statement ?? null, channel: "support" }, who(req));
    res.status(out.created ? 201 : 200).json(out);
  }));
  r.post("/:id/decision", requireScope("orders:write"), wrap(async (req, res) => {
    const b = z
      .object({ action: z.enum(["review", "accept", "reject", "complete"]), note: z.string().trim().max(1000).optional(), refundReference: z.string().trim().max(120).optional(), expectedVersion: z.number().int().positive() })
      .strict()
      .parse(req.body ?? {});
    res.json({ withdrawal: await svc.decide(id.parse(req.params.id), b.action, { note: b.note ?? null, refundReference: b.refundReference ?? null, expectedVersion: b.expectedVersion }, who(req)) });
  }));
  return r;
}
