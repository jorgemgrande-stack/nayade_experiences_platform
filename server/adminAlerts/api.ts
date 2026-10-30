/**
 * /cp/v1/admin-alerts/* — Comunicaciones › Alertas administrativas del CRM.
 *  - Consultar (catálogo con la configuración efectiva, vista previa, historial de avisos y de ajustes): `ops:read`.
 *  - Cambiar destinatarios, prioridades, activación y frecuencia, y enviar pruebas: `operators:write` (administración).
 * Las pruebas solo van al destinatario de pruebas configurado; toda escritura queda en el historial de ajustes.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError } from "../crm/types";
import type { AdminAlertService } from "./service";
import { LOG_STATUSES } from "./store";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof CrmError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      console.error("[AdminAlerts] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const alertId = z.string().regex(/^admin\.[a-z_]{2,60}$/);

export function createAdminAlertsRouter(svc: AdminAlertService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

  r.get("/", requireScope("ops:read"), wrap(async (_req, res) => void res.json(await svc.catalog())));
  r.put("/", requireScope("operators:write"), wrap(async (req, res) => {
    const b = z.object({ settings: z.unknown(), expectedVersion: z.number().int().min(0) }).parse(req.body);
    res.json(await svc.save(b.settings, b.expectedVersion, who(req)));
  }));
  r.get("/history", requireScope("ops:read"), wrap(async (_req, res) => void res.json({ history: await svc.history() })));
  r.get("/log", requireScope("ops:read"), wrap(async (req, res) => {
    const q = z.object({ alertId: alertId.optional(), status: z.enum(LOG_STATUSES).optional(), tenantId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/).optional(), beforeId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(req.query);
    res.json({ entries: await svc.log(q) });
  }));
  r.get("/:id/preview", requireScope("ops:read"), wrap(async (req, res) => {
    const p = svc.preview(alertId.parse(req.params.id));
    if (!p) throw new CrmError("not_found", "Alerta no encontrada");
    res.setHeader("Cache-Control", "no-store");
    res.json({ preview: p });
  }));
  r.post("/test", requireScope("operators:write"), wrap(async (req, res) => {
    const b = z.object({ to: z.string().trim().email().max(254), ids: z.array(alertId).max(60).optional() }).strict().parse(req.body);
    res.json(await svc.test(b.to, b.ids ?? null, who(req)));
  }));
  return r;
}
