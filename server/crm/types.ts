/**
 * Big Elephant CRM — dominio comercial: leads, empresas, contactos, oportunidades,
 * contratos y actividad. Persistencia en una BD propia (`db/crm`), separada del registro de
 * tenants y de los datos de los clientes.
 */

export type LeadStatus = "new" | "contacted" | "qualified" | "disqualified" | "converted";
export type LeadPriority = "low" | "normal" | "high" | "urgent";
export type OpportunityStage =
  | "prospecting"
  | "contacted"
  | "qualification"
  | "demo"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";
export type ContractStatus = "draft" | "sent" | "signed" | "active" | "cancelled";
export type ActivityKind = "call" | "email" | "meeting" | "note" | "task";
export type EntityType = "lead" | "company" | "contact" | "opportunity" | "contract";
/** Estado comercial gestionado por el operador. */
export type CompanyStatus = "active" | "inactive" | "churned";
/** Fase derivada de los datos: prospecto, cliente con contrato/venta o tenant aprovisionado. */
export type CompanyLifecycle = "prospect" | "customer" | "tenant";
export type ContactStatus = "active" | "inactive";

export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "disqualified", "converted"];
export const LEAD_PRIORITIES: LeadPriority[] = ["low", "normal", "high", "urgent"];
export const OPEN_STAGES: OpportunityStage[] = ["prospecting", "contacted", "qualification", "demo", "proposal", "negotiation"];
export const STAGES: OpportunityStage[] = [...OPEN_STAGES, "won", "lost"];
export const COMPANY_STATUSES: CompanyStatus[] = ["active", "inactive", "churned"];

export interface Company {
  id: number;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  sector: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alfa-2. */
  country: string | null;
  billingEmail: string | null;
  notes: string | null;
  /** Tenant del registro, cuando la empresa ya es cliente. Solo lo fija la activación de contrato. */
  tenantId: string | null;
  owner: string | null;
  status: CompanyStatus;
  createdAt: number;
  updatedAt: number | null;
}

export interface Contact {
  id: number;
  companyId: number | null;
  /** Nombre completo para mostrar (nombre + apellidos). */
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  status: ContactStatus;
  notes: string | null;
  createdAt: number;
  updatedAt: number | null;
}

export interface Lead {
  id: number;
  source: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  owner: string | null;
  notes: string | null;
  /** Empresa existente con la que se relaciona el lead (opcional; no exige tenant). */
  companyId: number | null;
  convertedCompanyId: number | null;
  convertedOpportunityId: number | null;
  createdAt: number;
  updatedAt: number | null;
}

export interface Opportunity {
  id: number;
  companyId: number;
  contactId: number | null;
  title: string;
  stage: OpportunityStage;
  amountCents: number | null;
  currency: string;
  expectedClose: number | null;
  probability: number;
  owner: string | null;
  /** Plan de interés (id del catálogo) y módulos solicitados. */
  planId: string | null;
  modules: string[];
  nextAction: string | null;
  nextActionAt: number | null;
  lostReason: string | null;
  createdAt: number;
  updatedAt: number | null;
  closedAt: number | null;
}

export interface Contract {
  id: number;
  companyId: number;
  opportunityId: number | null;
  planId: string | null;
  modules: string[];
  status: ContractStatus;
  amountCents: number | null;
  currency: string;
  startDate: number | null;
  endDate: number | null;
  documentUrl: string | null;
  signedAt: number | null;
  /** Tenant creado al activar el contrato. */
  tenantId: string | null;
  createdAt: number;
}

export interface Activity {
  id: number;
  entityType: EntityType;
  entityId: number;
  kind: ActivityKind;
  summary: string;
  dueAt: number | null;
  doneAt: number | null;
  author: string;
  createdAt: number;
}

export class CrmError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_state" | "invalid_input" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "CrmError";
  }
}

/**
 * Transiciones válidas de etapa de oportunidad. Entre etapas abiertas se avanza o retrocede
 * libremente; `won` exige haber llegado a propuesta o negociación; `won`/`lost` son finales y
 * solo se reabren a negociación / inicio.
 */
export const STAGE_TRANSITIONS: Record<OpportunityStage, OpportunityStage[]> = {
  prospecting: ["contacted", "qualification", "demo", "proposal", "negotiation", "lost"],
  contacted: ["prospecting", "qualification", "demo", "proposal", "negotiation", "lost"],
  qualification: ["prospecting", "contacted", "demo", "proposal", "negotiation", "lost"],
  demo: ["prospecting", "contacted", "qualification", "proposal", "negotiation", "lost"],
  proposal: ["prospecting", "contacted", "qualification", "demo", "negotiation", "won", "lost"],
  negotiation: ["prospecting", "contacted", "qualification", "demo", "proposal", "won", "lost"],
  won: ["negotiation"],
  lost: ["prospecting"],
};

export const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  prospecting: 10,
  contacted: 15,
  qualification: 20,
  demo: 25,
  proposal: 30,
  negotiation: 60,
  won: 100,
  lost: 0,
};

export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["signed", "draft", "cancelled"],
  signed: ["active", "cancelled"],
  active: ["cancelled"],
  cancelled: [],
};
