/**
 * Big Elephant CRM — dominio comercial: leads, empresas, contactos, oportunidades,
 * contratos y actividad. Persistencia en una BD propia (`db/crm`), separada del registro de
 * tenants y de los datos de los clientes.
 */

export type LeadStatus = "new" | "contacted" | "qualified" | "disqualified" | "converted";
export type OpportunityStage = "prospecting" | "proposal" | "negotiation" | "won" | "lost";
export type ContractStatus = "draft" | "sent" | "signed" | "active" | "cancelled";
export type ActivityKind = "call" | "email" | "meeting" | "note" | "task";
export type EntityType = "lead" | "company" | "contact" | "opportunity" | "contract";

export interface Company {
  id: number;
  name: string;
  taxId: string | null;
  website: string | null;
  sector: string | null;
  address: string | null;
  notes: string | null;
  /** Tenant del registro, cuando la empresa ya es cliente. */
  tenantId: string | null;
  owner: string | null;
  createdAt: number;
}

export interface Contact {
  id: number;
  companyId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  createdAt: number;
}

export interface Lead {
  id: number;
  source: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  status: LeadStatus;
  owner: string | null;
  notes: string | null;
  convertedCompanyId: number | null;
  convertedOpportunityId: number | null;
  createdAt: number;
}

export interface Opportunity {
  id: number;
  companyId: number;
  title: string;
  stage: OpportunityStage;
  amountCents: number | null;
  currency: string;
  expectedClose: number | null;
  probability: number;
  owner: string | null;
  lostReason: string | null;
  createdAt: number;
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

/** Transiciones válidas de etapa de oportunidad. `won`/`lost` son finales (se reabren a negotiation). */
export const STAGE_TRANSITIONS: Record<OpportunityStage, OpportunityStage[]> = {
  prospecting: ["proposal", "lost"],
  proposal: ["negotiation", "prospecting", "won", "lost"],
  negotiation: ["proposal", "won", "lost"],
  won: ["negotiation"],
  lost: ["prospecting"],
};

export const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  prospecting: 10,
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
