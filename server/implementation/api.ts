/**
 * /cp/v1/implementations — implantación asistida (CRM 0035), detrás de CP_ASSISTED_IMPLEMENTATION_ENABLED.
 *   GET  /implementations?status=&open=1&companyId=&opportunityId=&assignee=&queue=   crm:read   listado
 *   GET  /implementations/assignees                     crm:read    responsables posibles
 *   GET  /implementations/:id                           crm:read    detalle: hitos, historial, contrato y siguiente paso
 *   POST /implementations                               crm:write   abre el expediente ({ leadRequestId } u { opportunityId, solutionKey })
 *   POST /implementations/:id/assignee                  crm:write   responsable y cola
 *   POST /implementations/:id/proposal                  crm:write   condiciones, plazo y modalidad (contrato en borrador)
 *   POST /implementations/:id/acceptance                crm:write   comprueba si el cliente aceptó (contrato firmado)
 *   POST /implementations/:id/milestones                crm:write   añade un hito o pendiente
 *   PATCH /implementations/:id/milestones/:mid          crm:write   cambia un hito
 *   POST /implementations/:id/milestones/:mid/done      crm:write   hecho ({ done: true }) o reabierto ({ done: false })
 *   POST /implementations/:id/ready                     crm:write   técnicamente preparada
 *   POST /implementations/:id/enable                    crm:write   habilita el entorno
 *   POST /implementations/:id/communicate               crm:write   comunica la disponibilidad e inicia la prueba o la suscripción
 *   POST /implementations/:id/start                     crm:write   reintenta el inicio tras un fallo
 *   POST /implementations/:id/cancel                    crm:write   cancela (con motivo)
 *   POST /implementations/:id/notes                     crm:write   nota en el historial
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError } from "../crm/types";
import { ImplementationError, type ImplementationService } from "./service";
import { IMPLEMENTATION_QUEUES, IMPLEMENTATION_STATUSES, MILESTONE_KINDS, START_MODES } from "./store";

const STATUS: Record<string, number> = { not_found: 404, invalid_input: 400, invalid_state: 409, conflict: 409, unavailable: 503 };
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof ImplementationError || e instanceof CrmError) return void res.status(STATUS[e.code] ?? 409).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      console.error("[Implementation] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const key = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const assignee = z.string().trim().min(1).max(100).nullable();
const when = z.number().int().positive().nullable();

export function createImplementationRouter(svc: ImplementationService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  r.get("/", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z
      .object({
        status: z.enum(IMPLEMENTATION_STATUSES).optional(),
        open: z.enum(["1", "0"]).optional(),
        companyId: id.optional(),
        opportunityId: id.optional(),
        assignee: z.string().trim().min(1).max(100).optional(),
        queue: z.enum(IMPLEMENTATION_QUEUES).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict()
      .parse(req.query);
    const assigneeId = q.assignee === undefined ? undefined : q.assignee === "none" ? null : q.assignee;
    res.json({ implementations: await svc.list({ status: q.status, open: q.open === "1", companyId: q.companyId, opportunityId: q.opportunityId, assigneeId, queue: q.queue, limit: q.limit }) });
  }));
  r.get("/assignees", requireScope("crm:read"), wrap(async (_req, res) => void res.json({ assignees: await svc.assigneeOptions() })));
  r.get("/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.detail(id.parse(req.params.id)))));
  r.post("/", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({ leadRequestId: z.number().int().positive().optional(), opportunityId: z.number().int().positive().optional(), solutionKey: key.optional(), assigneeId: assignee.optional(), queue: z.enum(IMPLEMENTATION_QUEUES).nullable().optional() })
      .strict()
      .parse(req.body);
    const out = await svc.open(b, who(req));
    res.status(out.created ? 201 : 200).json(out);
  }));
  r.post("/:id/assignee", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ assigneeId: assignee, queue: z.enum(IMPLEMENTATION_QUEUES).nullable().optional() }).strict().parse(req.body);
    res.json({ implementation: await svc.assign(id.parse(req.params.id), b, who(req)) });
  }));
  r.post("/:id/proposal", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({
        conditions: z.string().max(4000),
        timeline: z.string().max(2000),
        startMode: z.enum(START_MODES),
        targetDate: when.optional(),
        contractId: z.number().int().positive().nullable().optional(),
        planId: key.nullable().optional(),
        billingInterval: z.enum(["month", "year"]).nullable().optional(),
        amountCents: z.number().int().min(0).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.json({ implementation: await svc.prepareProposal(id.parse(req.params.id), b, who(req)) });
  }));
  r.post("/:id/acceptance", requireScope("crm:write"), wrap(async (req, res) => {
    const out = await svc.syncAcceptance(id.parse(req.params.id), who(req));
    res.json({ implementation: out.order, accepted: out.accepted });
  }));
  r.post("/:id/milestones", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({ title: z.string().max(200), kind: z.enum(MILESTONE_KINDS).optional(), required: z.boolean().optional(), assigneeId: assignee.optional(), dueAt: when.optional(), note: z.string().max(1000).nullable().optional() })
      .strict()
      .parse(req.body);
    res.status(201).json({ milestone: await svc.addMilestone(id.parse(req.params.id), b, who(req)) });
  }));
  r.patch("/:id/milestones/:mid", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({ title: z.string().max(200).optional(), required: z.boolean().optional(), assigneeId: assignee.optional(), dueAt: when.optional(), note: z.string().max(1000).nullable().optional() })
      .strict()
      .parse(req.body);
    res.json({ milestone: await svc.updateMilestone(id.parse(req.params.id), id.parse(req.params.mid), b, who(req)) });
  }));
  r.post("/:id/milestones/:mid/done", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ done: z.boolean() }).strict().parse(req.body);
    res.json({ milestone: await svc.setMilestoneDone(id.parse(req.params.id), id.parse(req.params.mid), b.done, who(req)) });
  }));
  r.post("/:id/ready", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ note: z.string().max(1000).nullable().optional() }).strict().parse(req.body ?? {});
    res.json({ implementation: await svc.markReady(id.parse(req.params.id), b, who(req)) });
  }));
  r.post("/:id/enable", requireScope("crm:write"), wrap(async (req, res) => void res.json({ implementation: await svc.enable(id.parse(req.params.id), who(req)) })));
  r.post("/:id/communicate", requireScope("crm:write"), wrap(async (req, res) => void res.json({ implementation: await svc.communicate(id.parse(req.params.id), who(req)) })));
  r.post("/:id/start", requireScope("crm:write"), wrap(async (req, res) => void res.json({ implementation: await svc.start(id.parse(req.params.id), who(req)) })));
  r.post("/:id/cancel", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(500) }).strict().parse(req.body);
    res.json({ implementation: await svc.cancel(id.parse(req.params.id), b, who(req)) });
  }));
  r.post("/:id/notes", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ text: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    res.status(201).json({ event: await svc.addNote(id.parse(req.params.id), b.text, who(req)) });
  }));
  return r;
}
