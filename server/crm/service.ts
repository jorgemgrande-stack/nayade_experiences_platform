/**
 * Servicio del CRM comercial: reglas de negocio sobre el almacén.
 *
 * Flujo: lead → (conversión) empresa + contacto + oportunidad → contrato → activación
 * (aprovisiona el tenant y arranca la suscripción mediante el puerto de activación).
 */
import type { CrmStore } from "./store";
import {
  CONTRACT_TRANSITIONS,
  CrmError,
  STAGE_PROBABILITY,
  STAGE_TRANSITIONS,
  type Activity,
  type ActivityKind,
  type Company,
  type Contact,
  type Contract,
  type ContractStatus,
  type EntityType,
  type Lead,
  type LeadStatus,
  type Opportunity,
  type OpportunityStage,
} from "./types";

export interface ContractActivationPort {
  /** Crea el tenant/suscripción del cliente. Devuelve el identificador de tenant. */
  activate(input: { contract: Contract; company: Company; contact: Contact | null }): Promise<{ tenantId: string }>;
}

export interface CrmDeps {
  store: CrmStore;
  activation?: ContractActivationPort;
  now?: () => number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (s: string | null | undefined, max = 300): string | null => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, max) : null;
};

export class CrmService {
  private now: () => number;
  private store: CrmStore;

  constructor(private d: CrmDeps) {
    this.now = d.now ?? Date.now;
    this.store = d.store;
  }

  // ── Leads ──────────────────────────────────────────────────────────────────

  async createLead(input: { name: string; email?: string; phone?: string; companyName?: string; source?: string; owner?: string; notes?: string }, author: string): Promise<Lead> {
    const name = clean(input.name, 200);
    if (!name) throw new CrmError("invalid_input", "El nombre es obligatorio");
    const email = clean(input.email, 320);
    if (email && !EMAIL_RE.test(email)) throw new CrmError("invalid_input", "Correo no válido");
    if (!email && !clean(input.phone, 40)) throw new CrmError("invalid_input", "Indica un correo o un teléfono");
    // Deduplicación por correo: un lead abierto con el mismo correo no se duplica
    if (email) {
      const dup = (await this.store.list("leads", {})).find((l) => l.email?.toLowerCase() === email.toLowerCase() && l.status !== "converted" && l.status !== "disqualified");
      if (dup) throw new CrmError("conflict", `Ya existe un lead abierto con ese correo (#${dup.id})`);
    }
    const lead = await this.store.insert("leads", {
      source: clean(input.source, 60),
      name,
      email,
      phone: clean(input.phone, 40),
      companyName: clean(input.companyName, 200),
      status: "new",
      owner: clean(input.owner, 100),
      notes: clean(input.notes, 2000),
      convertedCompanyId: null,
      convertedOpportunityId: null,
      createdAt: this.now(),
    });
    await this.log("lead", lead.id, "note", "Lead creado", author);
    return lead;
  }

  async setLeadStatus(id: number, status: Exclude<LeadStatus, "converted">, author: string): Promise<Lead> {
    const lead = await this.must("leads", id);
    if (lead.status === "converted") throw new CrmError("invalid_state", "El lead ya está convertido");
    const upd = await this.store.update("leads", id, { status });
    await this.log("lead", id, "note", `Estado: ${lead.status} → ${status}`, author);
    return upd;
  }

  async convertLead(
    id: number,
    input: { companyName?: string; opportunity?: { title: string; amountCents?: number; currency?: string; expectedClose?: number } },
    author: string,
  ): Promise<{ company: Company; contact: Contact; opportunity: Opportunity | null; lead: Lead }> {
    const lead = await this.must("leads", id);
    if (lead.status === "converted") throw new CrmError("invalid_state", "El lead ya está convertido");
    if (lead.status === "disqualified") throw new CrmError("invalid_state", "El lead está descartado");
    const companyName = clean(input.companyName, 200) ?? lead.companyName ?? lead.name;

    // Reutiliza la empresa si ya existe con el mismo nombre
    let company = (await this.store.list("companies")).find((c) => c.name.toLowerCase() === companyName.toLowerCase()) ?? null;
    if (!company) {
      company = await this.store.insert("companies", {
        name: companyName,
        taxId: null,
        website: null,
        sector: null,
        address: null,
        notes: null,
        tenantId: null,
        owner: lead.owner,
        createdAt: this.now(),
      });
    }
    const contact = await this.store.insert("contacts", {
      companyId: company.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      role: null,
      createdAt: this.now(),
    });
    let opportunity: Opportunity | null = null;
    if (input.opportunity) {
      opportunity = await this.createOpportunity({ companyId: company.id, ...input.opportunity, owner: lead.owner ?? undefined }, author);
    }
    const upd = await this.store.update("leads", id, {
      status: "converted",
      convertedCompanyId: company.id,
      convertedOpportunityId: opportunity?.id ?? null,
    });
    await this.log("lead", id, "note", `Convertido en empresa #${company.id}`, author);
    return { company, contact, opportunity, lead: upd };
  }

  // ── Oportunidades ──────────────────────────────────────────────────────────

  async createOpportunity(
    input: { companyId: number; title: string; amountCents?: number; currency?: string; expectedClose?: number; owner?: string },
    author: string,
  ): Promise<Opportunity> {
    await this.must("companies", input.companyId);
    const title = clean(input.title, 200);
    if (!title) throw new CrmError("invalid_input", "El título es obligatorio");
    if (input.amountCents !== undefined && (!Number.isInteger(input.amountCents) || input.amountCents < 0)) {
      throw new CrmError("invalid_input", "Importe no válido");
    }
    const o = await this.store.insert("opportunities", {
      companyId: input.companyId,
      title,
      stage: "prospecting",
      amountCents: input.amountCents ?? null,
      currency: (input.currency ?? "EUR").toUpperCase().slice(0, 3),
      expectedClose: input.expectedClose ?? null,
      probability: STAGE_PROBABILITY.prospecting,
      owner: clean(input.owner, 100),
      lostReason: null,
      createdAt: this.now(),
      closedAt: null,
    });
    await this.log("opportunity", o.id, "note", "Oportunidad creada", author);
    return o;
  }

  async moveStage(id: number, to: OpportunityStage, author: string, opts: { lostReason?: string } = {}): Promise<Opportunity> {
    const o = await this.must("opportunities", id);
    if (o.stage === to) return o;
    if (!STAGE_TRANSITIONS[o.stage].includes(to)) throw new CrmError("invalid_state", `Transición no permitida: ${o.stage} → ${to}`);
    if (to === "lost" && !clean(opts.lostReason)) throw new CrmError("invalid_input", "El motivo de pérdida es obligatorio");
    const final = to === "won" || to === "lost";
    const upd = await this.store.update("opportunities", id, {
      stage: to,
      probability: STAGE_PROBABILITY[to],
      lostReason: to === "lost" ? clean(opts.lostReason) : null,
      closedAt: final ? this.now() : null,
    });
    await this.log("opportunity", id, "note", `Etapa: ${o.stage} → ${to}`, author);
    return upd;
  }

  async pipeline() {
    const opps = await this.store.list("opportunities");
    const stages: OpportunityStage[] = ["prospecting", "proposal", "negotiation", "won", "lost"];
    return stages.map((stage) => {
      const rows = opps.filter((o) => o.stage === stage);
      const total = rows.reduce((a, o) => a + (o.amountCents ?? 0), 0);
      const weighted = rows.reduce((a, o) => a + Math.round(((o.amountCents ?? 0) * o.probability) / 100), 0);
      return { stage, count: rows.length, totalCents: total, weightedCents: stage === "won" || stage === "lost" ? total : weighted };
    });
  }

  // ── Contratos ──────────────────────────────────────────────────────────────

  async createContract(
    input: { companyId: number; opportunityId?: number; planId?: string; modules?: string[]; amountCents?: number; currency?: string; startDate?: number; endDate?: number },
    author: string,
  ): Promise<Contract> {
    await this.must("companies", input.companyId);
    if (input.opportunityId) {
      const o = await this.must("opportunities", input.opportunityId);
      if (o.companyId !== input.companyId) throw new CrmError("invalid_input", "La oportunidad no pertenece a la empresa");
    }
    const c = await this.store.insert("contracts", {
      companyId: input.companyId,
      opportunityId: input.opportunityId ?? null,
      planId: clean(input.planId, 64),
      modules: (input.modules ?? []).filter((m) => /^[a-z][a-z0-9_]{1,31}$/.test(m)),
      status: "draft",
      amountCents: input.amountCents ?? null,
      currency: (input.currency ?? "EUR").toUpperCase().slice(0, 3),
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      documentUrl: null,
      signedAt: null,
      tenantId: null,
      createdAt: this.now(),
    });
    await this.log("contract", c.id, "note", "Contrato creado", author);
    return c;
  }

  async setContractStatus(id: number, to: ContractStatus, author: string): Promise<Contract> {
    const c = await this.must("contracts", id);
    if (c.status === to) return c;
    if (!CONTRACT_TRANSITIONS[c.status].includes(to)) throw new CrmError("invalid_state", `Transición no permitida: ${c.status} → ${to}`);
    if (to === "active") return this.activateContract(c, author);
    const upd = await this.store.update("contracts", id, { status: to, ...(to === "signed" ? { signedAt: this.now() } : {}) });
    await this.log("contract", id, "note", `Estado: ${c.status} → ${to}`, author);
    return upd;
  }

  private async activateContract(c: Contract, author: string): Promise<Contract> {
    if (!this.d.activation) throw new CrmError("invalid_state", "La activación de contratos no está configurada");
    if (!c.planId) throw new CrmError("invalid_input", "El contrato necesita un plan");
    const company = await this.must("companies", c.companyId);
    const contact = (await this.store.list("contacts", { companyId: company.id }))[0] ?? null;
    const { tenantId } = await this.d.activation.activate({ contract: c, company, contact });
    await this.store.update("companies", company.id, { tenantId });
    const upd = await this.store.update("contracts", c.id, { status: "active", tenantId, startDate: c.startDate ?? this.now() });
    await this.log("contract", c.id, "note", `Contrato activo; tenant ${tenantId}`, author);
    await this.log("company", company.id, "note", `Alta de plataforma: ${tenantId}`, author);
    return upd;
  }

  // ── Actividad y seguimiento ────────────────────────────────────────────────

  async log(entityType: EntityType, entityId: number, kind: ActivityKind, summary: string, author: string, opts: { dueAt?: number } = {}): Promise<Activity> {
    return this.store.insert("activities", {
      entityType,
      entityId,
      kind,
      summary: summary.slice(0, 1000),
      dueAt: opts.dueAt ?? null,
      doneAt: null,
      author: author.slice(0, 100),
      createdAt: this.now(),
    });
  }

  async addTask(entityType: EntityType, entityId: number, summary: string, dueAt: number, author: string): Promise<Activity> {
    if (!Number.isFinite(dueAt)) throw new CrmError("invalid_input", "Fecha no válida");
    return this.log(entityType, entityId, "task", summary, author, { dueAt });
  }

  async completeTask(id: number): Promise<Activity> {
    const a = await this.must("activities", id);
    if (a.kind !== "task") throw new CrmError("invalid_state", "No es una tarea");
    return this.store.update("activities", id, { doneAt: this.now() });
  }

  async tasks(opts: { author?: string; until?: number; includeDone?: boolean } = {}): Promise<Activity[]> {
    const all = await this.store.list("activities", { kind: "task" });
    return all
      .filter((a) => (opts.includeDone ? true : a.doneAt === null))
      .filter((a) => !opts.author || a.author === opts.author)
      .filter((a) => opts.until === undefined || (a.dueAt ?? Infinity) <= opts.until)
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  }

  async timeline(entityType: EntityType, entityId: number): Promise<Activity[]> {
    return (await this.store.list("activities", { entityType, entityId })).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  }

  async dashboard() {
    const leads = await this.store.list("leads");
    const byStatus: Record<string, number> = {};
    for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    const now = this.now();
    const overdue = (await this.tasks({ until: now })).length;
    const contracts = await this.store.list("contracts");
    const mrrCents = contracts.filter((c) => c.status === "active").reduce((a, c) => a + (c.amountCents ?? 0), 0);
    return { leadsByStatus: byStatus, pipeline: await this.pipeline(), overdueTasks: overdue, activeContracts: contracts.filter((c) => c.status === "active").length, contractedCents: mrrCents };
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async must<K extends Parameters<CrmStore["get"]>[0]>(table: K, id: number) {
    const r = await this.store.get(table, id);
    if (!r) throw new CrmError("not_found", `No encontrado (${table} #${id})`);
    return r;
  }
}
