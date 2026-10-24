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
import { COMPANY_STATUSES, CrmError, LEAD_PRIORITIES, LEAD_REQUEST_STATUSES, LEAD_REQUEST_TYPES, LEAD_STATUSES, STAGES, type EntityType, type LeadRequestStatus, type LeadRequestType } from "./types";
import type { WebRequestService } from "./webRequests";
import type { CrmService } from "./service";
import type { CrmStore, Tables } from "./store";
import type { BillingStore } from "../_core/billing/ports";
import { billingSummary } from "./dashboard";
import { crmReports, madridMonth, toCsv, madridDayRange } from "./reports";
import type { CrmOnboarding } from "./onboarding";
import type { ContractConfiguration } from "./types";
import { parseQuoteRequest } from "../catalog/request";
import type { QuoteRequest, QuoteResult } from "../catalog/quote";

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

const contractTerms = {
  planId: nullStr(64),
  modules: z.array(z.string().max(32)).max(30).optional(),
  amountCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).optional(),
  startDate: time.nullable().optional(),
  renewalDate: time.nullable().optional(),
  billingInterval: z.enum(["month", "year"]).nullable().optional(),
  autoRenew: z.boolean().optional(),
  noticeDays: z.number().int().min(0).max(365).nullable().optional(),
  conditions: nullStr(20000),
};

export function createCrmRouter(
  crm: CrmService,
  store: CrmStore,
  opts: {
    billing?: Pick<BillingStore, "listSubscriptions">;
    onboarding?: CrmOnboarding;
    /** Solicitudes recibidas desde la web pública (cuelgan de los leads). */
    requests?: WebRequestService;
    /** Personas que pueden ser responsables comerciales (operadores activos con permisos de CRM). */
    assignees?: () => Promise<Array<{ value: string; label: string }>>;
    /** Cotizador sobre el catálogo publicado (contratos con configuración de Elephant Source). */
    quote?: (r: QuoteRequest) => Promise<QuoteResult>;
    /** Empresas del registro (para detectar fichas comerciales con una plataforma inexistente). */
    knownTenants?: () => Promise<Set<string>>;
  } = {},
): Router {
  const r = express.Router();
  const who = (req: Request) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}`;

  // ── Informes (solo lectura). Fechas AAAA-MM-DD en hora de Madrid; «to» incluido; máximo 2 años ──
  const REPORT_SCAN = 20_000;
  const reportRange = (q: Record<string, unknown>) => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const f = z.object({ from: day, to: day }).parse({ from: q.from, to: q.to });
    for (const iso of [f.from, f.to]) {
      const noon = Date.parse(`${iso}T12:00:00Z`);
      if (!Number.isFinite(noon) || new Date(noon).toISOString().slice(0, 10) !== iso) throw new CrmError("invalid_input", `Fecha no válida: ${iso}`);
    }
    // Medianoches reales de Madrid (también los días del cambio de hora, de 23 o 25 horas)
    const { from, to } = madridDayRange(f.from, f.to);
    if (!(from < to) || to - from > 731 * 86_400_000) throw new CrmError("invalid_input", "Periodo no válido (máximo 2 años)");
    return { from, to };
  };
  const reportData = async () => {
    const [leads, opportunities, companies, contacts, activities] = await Promise.all([
      store.list("leads", {}, { limit: REPORT_SCAN }),
      store.list("opportunities", {}, { limit: REPORT_SCAN }),
      store.list("companies", {}, { limit: REPORT_SCAN }),
      store.list("contacts", {}, { limit: REPORT_SCAN }),
      store.list("activities", {}, { limit: REPORT_SCAN }),
    ]);
    // Si se alcanza el límite, el informe lo dice: nunca se presenta como completo un recuento truncado
    const truncated = [leads, opportunities, companies, contacts, activities].some((x) => x.length >= REPORT_SCAN);
    return { data: { leads, opportunities, companies, contacts, activities }, truncated };
  };
  r.get("/reports", requireScope("crm:read"), wrap(async (req, res) => {
    const range = reportRange(req.query as Record<string, unknown>);
    const { data, truncated } = await reportData();
    const knownTenants = opts.knownTenants ? await opts.knownTenants().catch(() => undefined) : undefined;
    res.json({ ...crmReports(data, { ...range, now: Date.now(), knownTenants }), truncated });
  }));
  r.get("/reports/export", requireScope("crm:read"), wrap(async (req, res) => {
    const range = reportRange(req.query as Record<string, unknown>);
    const kind = z.enum(["leads", "opportunities"]).parse(req.query.kind);
    const { data } = await reportData();
    const inR = (t: number | null) => t !== null && t >= range.from && t < range.to;
    // Sin datos de contacto personales (correo, teléfono): solo lo necesario para el seguimiento comercial
    const rows =
      kind === "leads"
        ? data.leads.filter((l) => inR(l.createdAt)).map((l) => ({ id: l.id, mes: madridMonth(l.createdAt), origen: l.source ?? "", estado: l.status, prioridad: l.priority, responsable: l.owner ?? "", empresa: l.companyName ?? "" }))
        : data.opportunities.filter((o) => inR(o.createdAt)).map((o) => ({ id: o.id, mes: madridMonth(o.createdAt), titulo: o.title, etapa: o.stage, importe_cent: o.amountCents ?? null, responsable: o.owner ?? "", cerrada: o.closedAt ? new Date(o.closedAt).toISOString().slice(0, 10) : "" }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${kind}-${String(req.query.from)}-${String(req.query.to)}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send("﻿" + toCsv(rows));
  }));

  r.get("/dashboard", requireScope("crm:read"), wrap(async (req, res) => {
    const base = await crm.dashboard();
    // Datos de suscripciones solo con facturación configurada y el ámbito billing:read
    const canBilling = getAuth(req)!.scopes.has("billing:read");
    const billing = opts.billing && canBilling ? billingSummary(await opts.billing.listSubscriptions(), Date.now()) : null;
    const webRequests = opts.requests ? await opts.requests.summary() : null;
    res.json({ ...base, billing, billingUnavailable: billing ? null : !opts.billing ? "not_configured" : "forbidden", webRequests });
  }));

  // ── Responsables comerciales disponibles ──
  r.get("/assignees", requireScope("crm:read"), wrap(async (_req, res) => {
    res.json({ assignees: opts.assignees ? await opts.assignees() : [] });
  }));

  // ── Solicitudes de la web (bandeja = leads con solicitudes; no es un circuito aparte) ──
  r.get("/requests", requireScope("crm:read"), wrap(async (req, res) => {
    const f = z
      .object({
        q: z.string().max(100).optional(),
        type: z.enum(LEAD_REQUEST_TYPES as [string, ...string[]]).optional(),
        status: z.enum(LEAD_REQUEST_STATUSES as [string, ...string[]]).optional(),
        owner: optStr(100),
        companyId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      })
      .parse(req.query);
    if (!opts.requests) return void res.json({ available: false, requests: [], total: 0, limit: f.limit, offset: f.offset });
    if (f.companyId !== undefined && !(await store.get("companies", f.companyId))) throw new CrmError("not_found", "Empresa no encontrada");
    const p = await opts.requests.list({ ...f, type: f.type as LeadRequestType | undefined, status: f.status as LeadRequestStatus | undefined });
    res.json({ available: true, requests: p.rows, total: p.total, limit: f.limit, offset: f.offset });
  }));
  r.post("/requests/:id/status", requireScope("crm:write"), wrap(async (req, res) => {
    if (!opts.requests) throw new CrmError("invalid_state", "Las solicitudes web no están configuradas");
    const b = z.object({ status: z.enum(LEAD_REQUEST_STATUSES as [string, ...string[]]) }).strict().parse(req.body);
    res.json({ request: await opts.requests.setStatus(id.parse(req.params.id), b.status as LeadRequestStatus, who(req)) });
  }));

  r.get("/duplicates", requireScope("crm:read"), wrap(async (req, res) => {
    const q = z.object({ email: optStr(320), phone: optStr(40), companyName: optStr(200), taxId: optStr(40) }).parse(req.query);
    res.json({ duplicates: await crm.findDuplicates(q) });
  }));

  // ── Onboarding (alta de plataforma desde la ficha comercial) ──
  r.get("/onboarding/config", requireScope("crm:read"), wrap(async (_q, res) => {
    res.json(opts.onboarding ? { available: true, ...opts.onboarding.config() } : { available: false });
  }));
  r.get("/onboarding/check", requireScope("crm:read"), wrap(async (req, res) => {
    if (!opts.onboarding) throw new CrmError("invalid_state", "El aprovisionamiento no está configurado");
    const q = z.object({ tenantId: z.string().min(1).max(63), companyId: id.optional() }).parse(req.query);
    res.json(await opts.onboarding.check(q.tenantId, q.companyId));
  }));
  r.post("/companies/:id/onboard", requireScope("crm:write"), requireScope("provisioning:write"), wrap(async (req, res) => {
    const b = z
      .object({
        tenantId: z.string().min(1).max(63),
        adminContactId: id,
        planId: optStr(64),
        modules: z.array(z.string().max(32)).max(30).optional(),
        templateId: optStr(64),
        trialDays: z.number().int().min(1).max(90).optional(),
      })
      .strict()
      .parse(req.body);
    // Iniciar la prueba de un plan es una operación de facturación: exige además billing:write
    if (b.planId && !getAuth(req)!.scopes.has("billing:write")) {
      return void res.status(403).json({ error: "forbidden", message: "Ámbito requerido: billing:write" });
    }
    if (!opts.onboarding) throw new CrmError("invalid_state", "El aprovisionamiento no está configurado");
    const r = await opts.onboarding.onboard(id.parse(req.params.id), b, getAuth(req)!.actor);
    res.status(r.status === "completed" ? 201 : 202).json(r);
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
    res.json({ lead, timeline: await crm.timeline("lead", lid), requests: opts.requests ? await opts.requests.forLead(lid) : [] });
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
  r.get("/contracts", requireScope("crm:read"), wrap(async (req, res) => {
    const f = page
      .extend({
        status: z.enum(["draft", "sent", "signed", "active", "cancelled"]).optional(),
        companyId: id.optional(),
        // Renovaciones próximas: contratos activos cuya renovación vence antes de esta fecha (ms)
        renewalBefore: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query);
    const p = await crm.listContracts(f);
    res.json({ contracts: p.items, total: p.total, limit: p.limit, offset: p.offset });
  }));
  r.get("/contracts/:id", requireScope("crm:read"), wrap(async (req, res) => void res.json(await crm.getContract(id.parse(req.params.id)))));
  /**
   * Configuración de Elephant Source en un contrato: el cliente envía SOLO la petición; el servidor
   * cotiza con el catálogo publicado y de ahí salen plan, periodicidad, moneda e importe (mensual o,
   * si es anual, el coste anualizado). Nunca se aceptan importes calculados fuera.
   */
  const withConfiguration = async (b: Record<string, unknown>, res: Response, current?: { configuration?: ContractConfiguration | null }): Promise<boolean> => {
    if (!("configuration" in b) || b.configuration === undefined) {
      // Un contrato configurado no se desalinea a mano: plan, importe, periodicidad y moneda salen de la cotización
      const touched = ["planId", "amountCents", "billingInterval", "currency"].filter((k) => b[k] !== undefined);
      if (current?.configuration && touched.length) return void res.status(409).json({ error: "invalid_state", message: `El contrato tiene configuración cotizada: cambia la configuración (no ${touched.join(", ")}) o quítala con configuration: null` }), false;
      return true;
    }
    if (b.configuration === null) return true;
    if (!opts.quote) return void res.status(409).json({ error: "unavailable", message: "Catálogo de Elephant Source no disponible: no se puede cotizar" }), false;
    const parsed = parseQuoteRequest((b.configuration as { request?: unknown }).request, { allowOwned: true });
    if (!parsed.ok) return void res.status(400).json({ error: "invalid_input", message: parsed.message }), false;
    // Misma petición que la vigente: no se recotiza (no crea una versión nueva sin cambios)
    if (current?.configuration && JSON.stringify(current.configuration.request) === JSON.stringify(parsed.value)) {
      delete b.configuration;
      return true;
    }
    const q = await opts.quote(parsed.value);
    if (!q.ok) return void res.status(400).json({ error: "invalid_configuration", message: q.errors.join("; "), errors: q.errors }), false;
    const configuration: ContractConfiguration = {
      request: parsed.value as ContractConfiguration["request"],
      quote: {
        catalogVersion: q.catalogVersion,
        currency: q.currency,
        lines: q.lines.map((l) => ({ key: l.key, name: l.name, family: l.family, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents, interval: l.interval, status: l.status, commercialStatus: l.commercialStatus, note: l.note })),
        totals: q.totals,
        capabilities: q.capabilities,
        contractable: q.contractable,
        blocking: q.blocking,
        warnings: q.warnings,
      },
      quotedAt: Date.now(),
    };
    b.configuration = configuration;
    b.planId = parsed.value.plan;
    b.billingInterval = parsed.value.interval;
    b.currency = q.currency;
    b.amountCents = parsed.value.interval === "month" ? q.totals.monthlyCents : q.totals.annualizedCents;
    return true;
  };
  const configurationField = z.object({ request: z.unknown() }).strict().nullable().optional();
  r.post("/contracts", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ companyId: id, opportunityId: id.optional(), ...contractTerms, configuration: configurationField }).strict().parse(req.body);
    if (!(await withConfiguration(b, res))) return;
    res.status(201).json({ contract: await crm.createContract(b as Parameters<CrmService["createContract"]>[0], who(req)) });
  }));
  r.patch("/contracts/:id", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ ...contractTerms, reason: optStr(300), configuration: configurationField }).strict().parse(req.body);
    const current = await store.get("contracts", id.parse(req.params.id));
    if (!(await withConfiguration(b, res, current ?? undefined))) return;
    res.json({ contract: await crm.updateContract(id.parse(req.params.id), b as Parameters<CrmService["updateContract"]>[1], who(req)) });
  }));
  r.post("/contracts/:id/status", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z.object({ status: z.enum(["draft", "sent", "signed", "active", "cancelled"]), signatureRef: optStr(200), approvalReason: optStr(300) }).parse(req.body);
    const cid = id.parse(req.params.id);
    // Activar un contrato crea el tenant y concede licencias: exige los mismos permisos que el alta
    // (/companies/:id/onboard), no solo crm:write.
    if (b.status === "active") {
      const contract = await store.get("contracts", cid);
      const scopes = getAuth(req)!.scopes;
      const missing = (contract?.planId ? (["provisioning:write", "billing:write"] as const) : (["provisioning:write"] as const)).filter((s) => !scopes.has(s));
      if (missing.length) return void res.status(403).json({ error: "forbidden", message: `Ámbito requerido: ${missing.join(", ")}` });
    }
    res.json({ contract: await crm.setContractStatus(cid, b.status, who(req), { signatureRef: b.signatureRef, approvalReason: b.approvalReason }) });
  }));
  r.post("/contracts/:id/renew", requireScope("crm:write"), wrap(async (req, res) => {
    res.status(201).json({ contract: await crm.renewContract(id.parse(req.params.id), who(req)) });
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
      assignee: nullStr(100).optional(), priority: z.enum(["low", "normal", "high"]).optional(),
    }).parse(req.body);
    // La actividad solo se registra sobre una entidad existente
    if (!(await store.get(ENTITY_TABLE[b.entityType], b.entityId))) throw new CrmError("not_found", "Entidad no encontrada");
    const a = b.kind === "task" && b.dueAt
      ? await crm.addTask(b.entityType, b.entityId, b.summary, b.dueAt, who(req), { assignee: b.assignee, priority: b.priority })
      : await crm.log(b.entityType, b.entityId, b.kind, b.summary, who(req), { dueAt: b.dueAt });
    res.status(201).json({ activity: a });
  }));
  r.get("/tasks", requireScope("crm:read"), wrap(async (req, res) => {
    const until = req.query.until ? z.coerce.number().int().min(0).parse(req.query.until) : undefined;
    // assignee: nombre del responsable, o «none» para las tareas sin asignar
    const f = z.object({ assignee: z.string().trim().min(1).max(100).optional(), priority: z.enum(["low", "normal", "high"]).optional() }).parse(req.query);
    res.json({ tasks: await crm.tasks({ until, includeDone: req.query.done === "1", assignee: f.assignee === undefined ? undefined : f.assignee === "none" ? null : f.assignee, priority: f.priority }) });
  }));
  r.patch("/tasks/:id", requireScope("crm:write"), wrap(async (req, res) => {
    const b = z
      .object({ assignee: nullStr(100).optional(), priority: z.enum(["low", "normal", "high"]).optional(), dueAt: time.optional(), summary: z.string().trim().min(1).max(1000).optional() })
      .strict()
      .parse(req.body ?? {});
    res.json({ task: await crm.updateTask(id.parse(req.params.id), b) });
  }));
  r.post("/tasks/:id/done", requireScope("crm:write"), wrap(async (req, res) => void res.json({ task: await crm.completeTask(id.parse(req.params.id)) })));

  return r;
}
