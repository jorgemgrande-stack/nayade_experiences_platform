/**
 * API del Centro de envíos y del consentimiento comercial (montada en la raíz de /cp/v1, antes del router del CRM).
 *
 *  Consentimiento por contacto y finalidad
 *   GET  /crm/contacts/:id/consent                 crm:read   estado vigente por finalidad e historial
 *   POST /crm/contacts/:id/consent                 crm:write  concede o retira una finalidad (añade al historial)
 *
 *  Centro de envíos (Comunicaciones › Centro de envíos)
 *   GET  /communications/center/templates          crm:read   plantillas, campos de contenido y orígenes admitidos
 *   POST /communications/center/preview            crm:read   render real con el contenido indicado
 *   POST /communications/center/eligibility        crm:read   elegibilidad de un borrador sin guardarlo
 *   GET  /communications/sends                     crm:read   historial con contadores por estado
 *   POST /communications/sends                     escritura  crea el borrador
 *   GET  /communications/sends/:id                 crm:read   detalle, contadores y vista previa
 *   PUT  /communications/sends/:id                 escritura  modifica el borrador (versión optimista)
 *   POST /communications/sends/:id/cancel          escritura  descarta el borrador
 *   GET  /communications/sends/:id/eligibility     crm:read   elegibilidad por destinatario con su motivo
 *   POST /communications/sends/:id/confirm         escritura  confirma (número exacto de elegibles); idempotente
 *   GET  /communications/sends/:id/recipients      crm:read   destinatarios congelados y estado de su correo
 *   GET  /communications/surveys/responses         crm:read   valoraciones de la encuesta de soporte
 *
 *  «Escritura»: plantillas comerciales `crm:write`; comunicados de servicio y encuesta `ops:write`.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError } from "../crm/types";
import { CONSENT_PURPOSES, PURPOSE_LABEL } from "./consent";
import { INELIGIBLE_REASONS, SEND_TEMPLATES, isCommercial, type CommunicationsService, type SendTemplateId } from "./service";
import { RECIPIENT_STATUSES } from "./store";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof CrmError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => `${i.path.join(".") || "datos"}: ${i.message}`).join(", ") });
      console.error("[Communications] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = (v: unknown) => z.coerce.number().int().positive().parse(v);
const templateOf = (body: unknown): SendTemplateId | null => {
  const t = (body as { templateId?: unknown } | null)?.templateId;
  return typeof t === "string" && t in SEND_TEMPLATES ? (t as SendTemplateId) : null;
};

export function createCommunicationsRouter(svc: CommunicationsService): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;
  /** Escribir un envío: comerciales con crm:write; servicio y encuesta con ops:write. */
  const mayWrite = (req: Request, res: Response, templateId: SendTemplateId | null): boolean => {
    const scope = templateId && !isCommercial(templateId) ? "ops:write" : "crm:write";
    if (getAuth(req)?.scopes.has(scope)) return true;
    res.status(403).json({ error: "forbidden", message: `Hace falta el permiso ${scope}` });
    return false;
  };
  const anyWrite = (req: Request, res: Response, next: NextFunction) => {
    const s = getAuth(req)?.scopes;
    if (s?.has("crm:write") || s?.has("ops:write")) return next();
    res.status(403).json({ error: "forbidden", message: "Hace falta el permiso crm:write u ops:write" });
  };

  // ── Consentimiento ──
  r.get("/crm/contacts/:id/consent", requireScope("crm:read"), wrap(async (req, res) => {
    res.json({ ...(await svc.consents.view(id(req.params.id))), labels: PURPOSE_LABEL, order: CONSENT_PURPOSES });
  }));
  r.post("/crm/contacts/:id/consent", requireScope("crm:write"), wrap(async (req, res) => {
    res.json({ ...(await svc.consents.record(id(req.params.id), req.body, who(req))), labels: PURPOSE_LABEL, order: CONSENT_PURPOSES });
  }));

  // ── Centro de envíos ──
  r.get("/communications/center/templates", requireScope("crm:read"), wrap(async (_req, res) => {
    res.json({ templates: svc.templates(), purposes: PURPOSE_LABEL, reasons: INELIGIBLE_REASONS, available: svc.available });
  }));
  r.post("/communications/center/preview", requireScope("crm:read"), wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ preview: svc.preview(req.body) });
  }));
  r.post("/communications/center/eligibility", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.eligibilityOf(req.body))));

  r.get("/communications/sends", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).strict().parse(req.query);
    res.json({ sends: await svc.list(q.limit ?? 50), available: svc.available });
  }));
  r.post("/communications/sends", anyWrite, wrap(async (req, res) => {
    if (!mayWrite(req, res, templateOf(req.body))) return;
    res.status(201).json({ send: await svc.create(req.body, who(req)) });
  }));
  r.get("/communications/sends/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.detail(id(req.params.id)))));
  r.put("/communications/sends/:id", anyWrite, wrap(async (req, res) => {
    const cur = await svc.require(id(req.params.id));
    if (!mayWrite(req, res, cur.templateId as SendTemplateId) || !mayWrite(req, res, templateOf(req.body))) return;
    const { expectedVersion, ...draft } = z.object({ expectedVersion: z.number().int().min(1) }).passthrough().parse(req.body);
    res.json({ send: await svc.update(cur.id, draft, expectedVersion) });
  }));
  r.post("/communications/sends/:id/cancel", anyWrite, wrap(async (req, res) => {
    const cur = await svc.require(id(req.params.id));
    if (!mayWrite(req, res, cur.templateId as SendTemplateId)) return;
    const b = z.object({ expectedVersion: z.number().int().min(1) }).strict().parse(req.body);
    res.json({ send: await svc.cancel(cur.id, b.expectedVersion) });
  }));
  r.get("/communications/sends/:id/eligibility", requireScope("crm:read"), wrap(async (req, res) => void res.json(await svc.eligibility(id(req.params.id)))));
  r.post("/communications/sends/:id/confirm", anyWrite, wrap(async (req, res) => {
    const cur = await svc.require(id(req.params.id));
    if (!mayWrite(req, res, cur.templateId as SendTemplateId)) return;
    const b = z.object({ confirm: z.literal(true), expectedEligible: z.number().int().min(1), expectedVersion: z.number().int().min(1) }).strict().parse(req.body);
    const out = await svc.confirm(cur.id, b, who(req));
    res.status(out.alreadyConfirmed ? 200 : 202).json(out);
  }));
  r.get("/communications/sends/:id/recipients", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z.object({ afterId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).optional(), status: z.enum(RECIPIENT_STATUSES).optional() }).strict().parse(req.query);
    res.json({ recipients: await svc.recipients(id(req.params.id), q) });
  }));
  r.get("/communications/surveys/responses", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z.object({ sendId: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
    res.json(await svc.responses(q.sendId ?? null));
  }));
  return r;
}
