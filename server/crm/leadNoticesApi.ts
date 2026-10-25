/**
 * /cp/v1/crm/lead-notices/* — configuración y trazabilidad de los avisos internos de solicitudes web.
 *  - Consultar (ajustes, historial, avisos de una solicitud): `crm:read`.
 *  - Cambiar destinatarios, recuperar una versión y enviar un aviso de prueba: `operators:write` (administración).
 *  - Reenviar el aviso de una solicitud: `crm:write`.
 * Toda escritura queda en el historial de ajustes o en el de la solicitud, con el operador que la hizo.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError, LEAD_REQUEST_TYPES, type LeadRequestType } from "./types";
import type { LeadNoticeService } from "./leadNotices";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof CrmError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      console.error("[LeadNotices] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const version = z.number().int().min(0);

export function createLeadNoticesRouter(svc: LeadNoticeService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

  r.get("/", requireScope("crm:read"), wrap(async (_req, res) => {
    const [s, candidates] = await Promise.all([svc.settings(), svc.candidates()]);
    res.json({ ...svc.status(), ...s, candidates });
  }));
  r.put("/", requireScope("operators:write"), wrap(async (req, res) => {
    const b = z.object({ settings: z.unknown(), expectedVersion: version }).parse(req.body);
    res.json(await svc.save(b.settings, b.expectedVersion, who(req)));
  }));
  r.get("/history", requireScope("crm:read"), wrap(async (_req, res) => void res.json({ history: await svc.history() })));
  r.post("/restore", requireScope("operators:write"), wrap(async (req, res) => {
    const b = z.object({ version: z.number().int().positive(), expectedVersion: version }).parse(req.body);
    res.json(await svc.restore(b.version, b.expectedVersion, who(req)));
  }));
  r.post("/test", requireScope("operators:write"), wrap(async (req, res) => {
    const b = z.object({ type: z.enum(LEAD_REQUEST_TYPES as [LeadRequestType, ...LeadRequestType[]]) }).parse(req.body);
    res.json(await svc.test(b.type, who(req)));
  }));
  r.get("/requests/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json({ notices: await svc.notices(id.parse(req.params.id)) })));
  r.post("/requests/:id/resend", requireScope("crm:write"), wrap(async (req, res) => {
    res.json(await svc.notify(id.parse(req.params.id), "resend", who(req)));
  }));
  return r;
}
