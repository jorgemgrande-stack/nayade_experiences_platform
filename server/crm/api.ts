/**
 * API del CRM comercial (`/cp/v1/crm/*`), montada por el servicio del plano de control con
 * los ámbitos `crm:read` / `crm:write`. Cada escritura queda atribuida al actor del token.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { CrmError } from "./types";
import type { CrmService } from "./service";
import type { CrmStore } from "./store";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof CrmError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) {
        return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".")).join(", ") });
      }
      console.error("[CRM] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const optStr = (n: number) => z.string().max(n).optional();

export function createCrmRouter(crm: CrmService, store: CrmStore): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

  r.get("/dashboard", requireScope("crm:read"), wrap(async (_q, res) => void res.json(await crm.dashboard())));

  // ── Leads ──
  r.get("/leads", requireScope("crm:read"), wrap(async (req, res) => {
    const status = z.enum(["new", "contacted", "qualified", "disqualified", "converted"]).optional().parse(req.query.status);
    res.json({ leads: await store.list("leads", status ? { status } : {}, { desc: true, limit: 500 }) });
  }));
  r.post("/leads", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ name: z.string().min(1).max(200), email: optStr(320), phone: optStr(40), companyName: optStr(200), source: optStr(60), owner: optStr(100), notes: optStr(2000) }).parse(req.body);
    res.status(201).json({ lead: await crm.createLead(b, who(req)) });
  }));
  r.post("/leads/:id/status", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ status: z.enum(["new", "contacted", "qualified", "disqualified"]) }).parse(req.body);
    res.json({ lead: await crm.setLeadStatus(id.parse(req.params.id), b.status, who(req)) });
  }));
  r.post("/leads/:id/convert", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({
        companyName: optStr(200),
        opportunity: z.object({ title: z.string().min(1).max(200), amountCents: z.number().int().min(0).optional(), currency: optStr(3) }).optional(),
      })
      .parse(req.body ?? {});
    res.json(await crm.convertLead(id.parse(req.params.id), b, who(req)));
  }));

  // ── Empresas y contactos ──
  r.get("/companies", requireScope("crm:read"), wrap(async (_q, res) => void res.json({ companies: await store.list("companies", {}, { desc: true, limit: 1000 }) })));
  r.get("/companies/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const cid = id.parse(req.params.id);
    const company = await store.get("companies", cid);
    if (!company) throw new CrmError("not_found", "Empresa no encontrada");
    res.json({
      company,
      contacts: await store.list("contacts", { companyId: cid }),
      opportunities: await store.list("opportunities", { companyId: cid }),
      contracts: await store.list("contracts", { companyId: cid }),
      timeline: await crm.timeline("company", cid),
    });
  }));
  r.post("/companies", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ name: z.string().min(1).max(200), taxId: optStr(40), website: optStr(300), sector: optStr(100), address: optStr(300), notes: optStr(2000) }).parse(req.body);
    const c = await store.insert("companies", {
      name: b.name.trim(), taxId: b.taxId ?? null, website: b.website ?? null, sector: b.sector ?? null,
      address: b.address ?? null, notes: b.notes ?? null, tenantId: null, owner: who(req), createdAt: Date.now(),
    });
    res.status(201).json({ company: c });
  }));
  r.post("/companies/:id/contacts", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ name: z.string().min(1).max(200), email: z.string().email().max(320).optional(), phone: optStr(40), role: optStr(100) }).parse(req.body);
    const cid = id.parse(req.params.id);
    if (!(await store.get("companies", cid))) throw new CrmError("not_found", "Empresa no encontrada");
    res.status(201).json({ contact: await store.insert("contacts", { companyId: cid, name: b.name, email: b.email ?? null, phone: b.phone ?? null, role: b.role ?? null, createdAt: Date.now() }) });
  }));

  // ── Oportunidades ──
  r.get("/opportunities", requireScope("crm:read"), wrap(async (_q, res) => void res.json({ opportunities: await store.list("opportunities", {}, { desc: true, limit: 1000 }), pipeline: await crm.pipeline() })));
  r.post("/opportunities", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ companyId: id, title: z.string().min(1).max(200), amountCents: z.number().int().min(0).optional(), currency: optStr(3), expectedClose: z.number().int().optional() }).parse(req.body);
    res.status(201).json({ opportunity: await crm.createOpportunity({ ...b, owner: who(req) }, who(req)) });
  }));
  r.post("/opportunities/:id/stage", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ stage: z.enum(["prospecting", "proposal", "negotiation", "won", "lost"]), lostReason: optStr(300) }).parse(req.body);
    res.json({ opportunity: await crm.moveStage(id.parse(req.params.id), b.stage, who(req), { lostReason: b.lostReason }) });
  }));

  // ── Contratos ──
  r.get("/contracts", requireScope("crm:read"), wrap(async (_q, res) => void res.json({ contracts: await store.list("contracts", {}, { desc: true, limit: 1000 }) })));
  r.post("/contracts", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ companyId: id, opportunityId: id.optional(), planId: optStr(64), modules: z.array(z.string().max(32)).max(30).optional(), amountCents: z.number().int().min(0).optional(), currency: optStr(3) }).parse(req.body);
    res.status(201).json({ contract: await crm.createContract(b, who(req)) });
  }));
  r.post("/contracts/:id/status", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ status: z.enum(["draft", "sent", "signed", "active", "cancelled"]) }).parse(req.body);
    res.json({ contract: await crm.setContractStatus(id.parse(req.params.id), b.status, who(req)) });
  }));

  // ── Actividad ──
  r.get("/timeline/:type/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const t = z.enum(["lead", "company", "contact", "opportunity", "contract"]).parse(req.params.type);
    res.json({ activities: await crm.timeline(t, id.parse(req.params.id)) });
  }));
  r.post("/activities", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({
      entityType: z.enum(["lead", "company", "contact", "opportunity", "contract"]), entityId: id,
      kind: z.enum(["call", "email", "meeting", "note", "task"]), summary: z.string().min(1).max(1000), dueAt: z.number().int().optional(),
    }).parse(req.body);
    const a = b.kind === "task" && b.dueAt
      ? await crm.addTask(b.entityType, b.entityId, b.summary, b.dueAt, who(req))
      : await crm.log(b.entityType, b.entityId, b.kind, b.summary, who(req));
    res.status(201).json({ activity: a });
  }));
  r.get("/tasks", requireScope("crm:read"), wrap(async (req, res) => {
    const until = req.query.until ? Number(req.query.until) : undefined;
    res.json({ tasks: await crm.tasks({ until, includeDone: req.query.done === "1" }) });
  }));
  r.post("/tasks/:id/done", requireScope("crm:write"), wrap(async (req, res) => void res.json({ task: await crm.completeTask(id.parse(req.params.id)) })));

  return r;
}
