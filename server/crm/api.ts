/**
 * API del CRM comercial (`/cp/v1/crm/*`), montada por el servicio del plano de control con
 * los ámbitos `crm:read` / `crm:write`. Cada escritura queda atribuida al actor del token.
 *
 * Listados: `q` (búsqueda), filtros, `limit` (1–500, defecto 200) y `offset`; devuelven `total`.
 * Ediciones (PATCH): solo los campos declarados; cualquier otro (p. ej. `tenantId`) → 400.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { COMPANY_STATUSES, CrmError, LEAD_PRIORITIES, LEAD_STATUSES, STAGES, type EntityType } from "./types";
import type { CrmService } from "./service";
import type { CrmStore, Tables } from "./store";

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof CrmError) {
        const status = e.code === "not_found" ? 404 : e.code === "invalid_input" ? 400 : 409;
        return void res.status(status).json({ error: e.code, message: e.message });
      }
      if (e instanceof z.ZodError) {
        return void res.status(400).json({ error: "invalid_request", message: e.issues.map((i) => i.path.join(".") || i.message).join(", ") });
      }
      console.error("[CRM] error interno:", e instanceof Error ? e.name : "error");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

const id = z.coerce.number().int().positive();
const optStr = (n: number) => z.string().max(n).optional();
const nullStr = (n: number) => z.string().max(n).nullable().optional();
const time = z.number().int().min(0);
const ENTITY_TABLE: Record<EntityType, keyof Tables> = {
  lead: "leads",
  company: "companies",
  contact: "contacts",
  opportunity: "opportunities",
  contract: "contracts",
};

const page = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const companyBody = {
  name: z.string().min(1).max(200),
  legalName: nullStr(200),
  taxId: nullStr(40),
  email: nullStr(320),
  phone: nullStr(40),
  website: nullStr(300),
  sector: nullStr(100),
  address: nullStr(300),
  city: nullStr(120),
  postalCode: nullStr(20),
  country: nullStr(2),
  billingEmail: nullStr(320),
  notes: nullStr(5000),
  owner: nullStr(100),
  status: z.enum(COMPANY_STATUSES as [string, ...string[]]).optional(),
};

const contactBody = {
  firstName: z.string().min(1).max(100).optional(),
  lastName: nullStr(150),
  name: z.string().min(1).max(200).optional(),
  email: nullStr(320),
  phone: nullStr(40),
  role: nullStr(100),
  isPrimary: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  notes: nullStr(5000),
};

const leadBody = {
  name: z.string().min(1).max(200),
  email: nullStr(320),
  phone: nullStr(40),
  companyName: nullStr(200),
  source: nullStr(60),
  owner: nullStr(100),
  notes: nullStr(5000),
  priority: z.enum(LEAD_PRIORITIES as [string, ...string[]]).optional(),
  companyId: id.nullable().optional(),
};

const opportunityBody = {
  title: z.string().min(1).max(200),
  amountCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).optional(),
  expectedClose: time.nullable().optional(),
  owner: nullStr(100),
  planId: nullStr(64),
  modules: z.array(z.string().max(32)).max(30).optional(),
  contactId: id.nullable().optional(),
  nextAction: nullStr(300),
  nextActionAt: time.nullable().optional(),
};

export function createCrmRouter(crm: CrmService, store: CrmStore): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

  r.get("/dashboard", requireScope("crm:read"), wrap(async (_q, res) => void res.json(await crm.dashboard())));

  r.get("/duplicates", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z.object({ email: optStr(320), phone: optStr(40), companyName: optStr(200), taxId: optStr(40) }).parse(req.query);
    res.json({ duplicates: await crm.findDuplicates(q) });
  }));

  // ── Leads ──
  r.get("/leads", requireScope("crm:read"), wrap(async (req, res) => {
    const f = page
      .extend({
        status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
        priority: z.enum(LEAD_PRIORITIES as [string, ...string[]]).optional(),
        owner: optStr(100),
      })
      .parse(req.query);
    const p = await crm.listLeads(f as Parameters<CrmService["listLeads"]>[0]);
    res.json({ leads: p.items, total: p.total, limit: p.limit, offset: p.offset });
  }));
  r.get("/leads/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const lid = id.parse(req.params.id);
    const lead = await store.get("leads", lid);
    if (!lead) throw new CrmError("not_found", "Lead no encontrado");
    res.json({ lead, timeline: await crm.timeline("lead", lid) });
  }));
  r.post("/leads", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object(leadBody).strict().parse(req.body);
    const lead = await crm.createLead(b as Parameters<CrmService["createLead"]>[0], who(req));
    // Aviso no bloqueante: coincidencias por teléfono, empresa o contactos/empresas existentes
    const duplicates = await crm.findDuplicates({ email: lead.email, phone: lead.phone, companyName: lead.companyName, excludeLeadId: lead.id });
    res.status(201).json({ lead, duplicates });
  }));
  r.patch("/leads/:id", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object(leadBody).partial().strict().parse(req.body);
    res.json({ lead: await crm.updateLead(id.parse(req.params.id), b as Parameters<CrmService["updateLead"]>[1], who(req)) });
  }));
  r.post("/leads/:id/status", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ status: z.enum(["new", "contacted", "qualified", "disqualified"]) }).parse(req.body);
    res.json({ lead: await crm.setLeadStatus(id.parse(req.params.id), b.status, who(req)) });
  }));
  r.post("/leads/:id/convert", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({
        companyId: id.optional(),
        companyName: optStr(200),
        opportunity: z
          .object({
            title: z.string().min(1).max(200),
            amountCents: z.number().int().min(0).optional(),
            currency: z.string().length(3).optional(),
            expectedClose: time.optional(),
            planId: optStr(64),
            modules: z.array(z.string().max(32)).max(30).optional(),
          })
          .optional(),
      })
      .parse(req.body ?? {});
    res.json(await crm.convertLead(id.parse(req.params.id), b, who(req)));
  }));

  // ── Empresas ──
  r.get("/companies", requireScope("crm:read"), wrap(async (req, res) => {
    const f = page
      .extend({
        status: z.enum(COMPANY_STATUSES as [string, ...string[]]).optional(),
        lifecycle: z.enum(["prospect", "customer", "tenant"]).optional(),
        owner: optStr(100),
      })
      .parse(req.query);
    const p = await crm.listCompanies(f as Parameters<CrmService["listCompanies"]>[0]);
    res.json({ companies: p.items, total: p.total, limit: p.limit, offset: p.offset });
  }));
  r.get("/companies/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const cid = id.parse(req.params.id);
    const company = await crm.getCompany(cid);
    const leads = (await store.list("leads", {}, { limit: 5000 })).filter((l) => l.convertedCompanyId === cid || l.companyId === cid);
    res.json({
      company,
      contacts: (await crm.listContacts({ companyId: cid, limit: 500 })).items,
      opportunities: await store.list("opportunities", { companyId: cid }),
      contracts: await store.list("contracts", { companyId: cid }),
      leads,
      timeline: await crm.timeline("company", cid),
    });
  }));
  r.post("/companies", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object(companyBody).strict().parse(req.body);
    res.status(201).json({ company: await crm.createCompany(b as Parameters<CrmService["createCompany"]>[0], who(req)) });
  }));
  r.patch("/companies/:id", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object(companyBody).partial().strict().parse(req.body);
    res.json({ company: await crm.updateCompany(id.parse(req.params.id), b as Parameters<CrmService["updateCompany"]>[1], who(req)) });
  }));

  // ── Contactos ──
  r.post("/companies/:id/contacts", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object(contactBody).strict().parse(req.body);
    res.status(201).json({ contact: await crm.createContact(id.parse(req.params.id), b, who(req)) });
  }));
  r.get("/contacts", requireScope("crm:read"), wrap(async (req, res) => {
    const f = page.extend({ companyId: id.optional(), status: z.enum(["active", "inactive"]).optional() }).parse(req.query);
    const p = await crm.listContacts(f);
    res.json({ contacts: p.items, total: p.total, limit: p.limit, offset: p.offset });
  }));
  r.get("/contacts/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const contact = await store.get("contacts", id.parse(req.params.id));
    if (!contact) throw new CrmError("not_found", "Contacto no encontrado");
    res.json({ contact });
  }));
  r.patch("/contacts/:id", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ ...contactBody, companyId: id.nullable().optional() }).strict().parse(req.body);
    res.json({ contact: await crm.updateContact(id.parse(req.params.id), b, who(req)) });
  }));

  // ── Oportunidades ──
  r.get("/opportunities", requireScope("crm:read"), wrap(async (req, res) => {
    const f = page
      .extend({
        stage: z.enum(STAGES as [string, ...string[]]).optional(),
        owner: optStr(100),
        companyId: id.optional(),
        open: z.enum(["1", "0"]).optional(),
      })
      .parse(req.query);
    const p = await crm.listOpportunities({ ...(f as Parameters<CrmService["listOpportunities"]>[0]), open: f.open === "1" });
    res.json({ opportunities: p.items, total: p.total, limit: p.limit, offset: p.offset, pipeline: await crm.pipeline() });
  }));
  r.get("/opportunities/:id", requireScope("crm:read"), wrap(async (req, res) => {
    const oid = id.parse(req.params.id);
    const opportunity = await store.get("opportunities", oid);
    if (!opportunity) throw new CrmError("not_found", "Oportunidad no encontrada");
    res.json({ opportunity, timeline: await crm.timeline("opportunity", oid) });
  }));
  r.post("/opportunities", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ companyId: id, ...opportunityBody }).strict().parse(req.body);
    res.status(201).json({ opportunity: await crm.createOpportunity({ ...b, owner: b.owner ?? who(req) } as Parameters<CrmService["createOpportunity"]>[0], who(req)) });
  }));
  r.patch("/opportunities/:id", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object(opportunityBody).partial().strict().parse(req.body);
    res.json({ opportunity: await crm.updateOpportunity(id.parse(req.params.id), b as Parameters<CrmService["updateOpportunity"]>[1], who(req)) });
  }));
  r.post("/opportunities/:id/stage", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ stage: z.enum(STAGES as [string, ...string[]]), lostReason: optStr(300) }).parse(req.body);
    res.json({ opportunity: await crm.moveStage(id.parse(req.params.id), b.stage as (typeof STAGES)[number], who(req), { lostReason: b.lostReason }) });
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
      kind: z.enum(["call", "email", "meeting", "note", "task"]), summary: z.string().min(1).max(1000), dueAt: time.optional(),
    }).parse(req.body);
    // La actividad solo se registra sobre una entidad existente
    if (!(await store.get(ENTITY_TABLE[b.entityType], b.entityId))) throw new CrmError("not_found", "Entidad no encontrada");
    const a = b.kind === "task" && b.dueAt
      ? await crm.addTask(b.entityType, b.entityId, b.summary, b.dueAt, who(req))
      : await crm.log(b.entityType, b.entityId, b.kind, b.summary, who(req), { dueAt: b.dueAt });
    res.status(201).json({ activity: a });
  }));
  r.get("/tasks", requireScope("crm:read"), wrap(async (req, res) => {
    const until = req.query.until ? Number(req.query.until) : undefined;
    res.json({ tasks: await crm.tasks({ until, includeDone: req.query.done === "1" }) });
  }));
  r.post("/tasks/:id/done", requireScope("crm:write"), wrap(async (req, res) => void res.json({ task: await crm.completeTask(id.parse(req.params.id)) })));

  return r;
}
