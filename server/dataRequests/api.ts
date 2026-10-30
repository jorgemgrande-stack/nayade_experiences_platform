/**
 * /cp/v1/data-requests — solicitudes de derechos de protección de datos (RGPD) registradas desde el CRM.
 *   GET  /data-requests?status=&open=1      crm:read    listado
 *   GET  /data-requests/:id                 crm:read    detalle
 *   POST /data-requests                     crm:write   registra una solicitud recibida (plazo legal de 30 días)
 *   POST /data-requests/:id/status          crm:write   en curso, resuelta o rechazada (con la resolución)
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError } from "../crm/types";
import type { DataRequestService } from "./service";
import { DATA_REQUEST_STATUSES } from "./store";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof CrmError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      console.error("[DataRequests] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();

export function createDataRequestsRouter(svc: DataRequestService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  r.get("/", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z.object({ status: z.enum(DATA_REQUEST_STATUSES).optional(), open: z.enum(["1", "0"]).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(req.query);
    res.json({ requests: await svc.list({ status: q.status, open: q.open === "1", limit: q.limit }) });
  }));
  r.get("/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const x = await svc.get(id.parse(req.params.id));
    if (!x) throw new CrmError("not_found", "Solicitud no encontrada");
    res.json({ request: x });
  }));
  r.post("/", requireScope("crm:write"), wrap(async (req, res) => void res.status(201).json({ request: await svc.register(req.body, who(req)) })));
  r.post("/:id/status", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ status: z.enum(["in_progress", "resolved", "rejected"]), resolution: z.string().trim().max(2000).nullable().optional() }).strict().parse(req.body);
    res.json({ request: await svc.setStatus(id.parse(req.params.id), b.status, b.resolution ?? null, who(req)) });
  }));
  return r;
}
