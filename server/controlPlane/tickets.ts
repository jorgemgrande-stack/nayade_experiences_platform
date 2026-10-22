/**
 * API de tickets de soporte (`/cp/v1/tickets/*`).
 *
 * Ámbitos: `tickets:read` (consultar) y `tickets:write` (crear, asignar, cambiar estado/prioridad,
 * comentar). Cada actuación queda atribuida al actor del token. Un ticket siempre pertenece a un
 * tenant; el filtrado por `tenantId` es explícito y obligatorio en las rutas anidadas.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "./auth";
import { TICKET_PRIORITIES, TICKET_STATUSES, TicketError, type TicketService } from "../_core/support/tickets";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof TicketError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) {
        return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".")).join(", ") });
      }
      console.error("[Tickets] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const idSchema = z.coerce.number().int().positive();
const tenantSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const status = z.enum(TICKET_STATUSES);
const priority = z.enum(TICKET_PRIORITIES);

const listQuery = z.object({
  tenantId: tenantSchema.optional(),
  status: status.optional(),
  priority: priority.optional(),
  assignee: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export function createTicketsRouter(tickets: TicketService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

  r.get(
    "/",
    requireScope("tickets:read"),
    wrap(async (req, res) => {
      const f = listQuery.parse(req.query);
      const { items, total } = await tickets.list(f);
      res.json({ tickets: items, total, limit: f.limit, offset: f.offset });
    }),
  );

  r.post(
    "/",
    requireScope("tickets:write"),
    wrap(async (req, res) => {
      const b = z
        .object({
          tenantId: tenantSchema,
          title: z.string().min(1).max(200),
          description: z.string().min(1).max(10_000),
          category: z.string().min(1).max(40).optional(),
          priority: priority.optional(),
          requester: z.string().max(200).nullable().optional(),
        })
        .parse(req.body);
      res.status(201).json({ ticket: await tickets.create(b, who(req)) });
    }),
  );

  r.get(
    "/:id",
    requireScope("tickets:read"),
    wrap(async (req, res) => {
      const tenantId = tenantSchema.optional().parse(req.query.tenantId);
      res.json(await tickets.get(idSchema.parse(req.params.id), { tenantId }));
    }),
  );

  r.post(
    "/:id/assign",
    requireScope("tickets:write"),
    wrap(async (req, res) => {
      const b = z.object({ assignee: z.string().min(1).max(100).nullable() }).parse(req.body);
      res.json({ ticket: await tickets.assign(idSchema.parse(req.params.id), b.assignee, who(req)) });
    }),
  );

  r.post(
    "/:id/status",
    requireScope("tickets:write"),
    wrap(async (req, res) => {
      const b = z.object({ status, comment: z.string().max(5000).optional() }).parse(req.body);
      res.json({ ticket: await tickets.setStatus(idSchema.parse(req.params.id), b.status, who(req), b.comment) });
    }),
  );

  r.post(
    "/:id/priority",
    requireScope("tickets:write"),
    wrap(async (req, res) => {
      const b = z.object({ priority }).parse(req.body);
      res.json({ ticket: await tickets.setPriority(idSchema.parse(req.params.id), b.priority, who(req)) });
    }),
  );

  r.post(
    "/:id/comments",
    requireScope("tickets:write"),
    wrap(async (req, res) => {
      const b = z.object({ text: z.string().min(1).max(5000), internal: z.boolean().default(false) }).parse(req.body);
      const events = await tickets.comment(idSchema.parse(req.params.id), b.text, who(req), { internal: b.internal });
      res.status(201).json({ events });
    }),
  );

  return r;
}
