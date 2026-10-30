/**
 * Servicio del CRM comercial: reglas de negocio sobre el almacén.
 *
 * Flujo: lead → (conversión) empresa + contacto + oportunidad → contrato → activación
 * (aprovisiona el tenant y arranca la suscripción mediante el puerto de activación).
 *
 * Fases de una empresa: prospecto (sin venta), cliente (oportunidad ganada o contrato firmado/
 * activo) y tenant (aprovisionada en la plataforma). Registrar leads o empresas no crea tenants.
 */
import type { CrmStore } from "./store";
import { applySort, COMPANY_SORT, CONTACT_SORT, CONTRACT_SORT, LEAD_SORT, type CompanySortKey, type ContactSortKey, type ContractSortKey, type LeadSortKey, type SortOpts } from "./sorting";
import {
  CONTRACT_TRANSITIONS,
  CrmError,
  OPEN_STAGES,
  STAGES,
  STAGE_PROBABILITY,
  STAGE_TRANSITIONS,
  type Activity,
  type ActivityKind,
  type Company,
  type CompanyLifecycle,
  type CompanyStatus,
  type Contact,
  type ContactStatus,
  type BillingInterval,
  type Contract,
  type ContractConfiguration,
  type ContractStatus,
  type SignatureMethod,
  type ContractVersion,
  type EntityType,
  type Lead,
  type LeadPriority,
  type LeadStatus,
  type Opportunity,
  type OpportunityStage,
  type TaskPriority,
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

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageOpts {
  limit?: number;
  offset?: number;
}

export type CompanyView = Company & { lifecycle: CompanyLifecycle };

export interface DuplicateMatch {
  type: "lead" | "contact" | "company";
  id: number;
  label: string;
  reason: "email" | "phone" | "company_name" | "tax_id";
}

/** Nombres legibles para el historial (los valores de datos personales no se registran). */
const FIELD_LABEL: Record<string, string> = {
  name: "nombre", legalName: "razón social", taxId: "NIF", email: "correo", phone: "teléfono", website: "web",
  sector: "sector", address: "dirección", city: "ciudad", postalCode: "código postal", country: "país",
  billingEmail: "correo de facturación", notes: "notas", owner: "responsable", status: "estado",
  firstName: "nombre", lastName: "apellidos", role: "cargo", isPrimary: "principal", companyName: "empresa",
  source: "origen", priority: "prioridad", companyId: "empresa", title: "título", amountCents: "importe",
  currency: "moneda", expectedClose: "cierre estimado", planId: "plan", modules: "módulos", contactId: "contacto",
  nextAction: "próxima acción", nextActionAt: "fecha de próxima acción", conditions: "condiciones", billingInterval: "periodicidad",
  startDate: "inicio", renewalDate: "renovación", autoRenew: "renovación automática", noticeDays: "preaviso",
  configuration: "configuración",
};
const STAGE_NAME: Record<OpportunityStage, string> = {
  prospecting: "Nuevo", contacted: "Contactado", qualification: "Cualificación", demo: "Demostración",
  proposal: "Propuesta enviada", negotiation: "Negociación", won: "Ganada", lost: "Perdida",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODULE_RE = /^[a-z][a-z0-9_]{1,31}$/;
const SCAN_LIMIT = 5000;
/** Responsable de una tarea: texto recortado (como `owner`); vacío = sin asignar. */
const cleanAssignee = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim().slice(0, 100) : null);

const clean = (s: string | null | undefined, max = 300): string | null => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, max) : null;
};
/** Minúsculas, sin acentos ni espacios repetidos (búsqueda y deduplicación). */
export const normalizeText = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** Nombre de empresa comparable: sin forma jurídica ni puntuación. */
export const normalizeCompanyName = (s: string | null | undefined): string =>
  normalizeText(s)
    .replace(/[.,]/g, " ")
    .replace(/\b(s\s?l\s?u?|s\s?a\s?u?|s\s?l\s?l|s\s?c\s?p?|ltd|llc|inc|gmbh|sas)\b/g, " ")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Teléfono comparable: últimos 9 dígitos (ignora prefijo internacional y formato). */
export const normalizePhone = (s: string | null | undefined): string => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d.slice(-9) : "";
};

function validEmail(v: string | null, field = "Correo"): string | null {
  if (v && !EMAIL_RE.test(v)) throw new CrmError("invalid_input", `${field} no válido`);
  return v ? v.toLowerCase() : null;
}
function validCountry(v: string | null): string | null {
  if (!v) return null;
  const c = v.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new CrmError("invalid_input", "País no válido (código ISO de 2 letras)");
  return c;
}
function validWebsite(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw new CrmError("invalid_input", "Web no válida");
  }
}
function validModules(list: string[] | undefined): string[] {
  const out = Array.from(new Set((list ?? []).map((m) => m.trim()).filter(Boolean)));
  const bad = out.find((m) => !MODULE_RE.test(m));
  if (bad) throw new CrmError("invalid_input", `Módulo no válido: ${bad}`);
  return out;
}
function paginate<T>(rows: T[], o: PageOpts): Page<T> {
  const limit = Math.min(500, Math.max(1, Math.floor(o.limit ?? 50)));
  const offset = Math.max(0, Math.floor(o.offset ?? 0));
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}
function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}
const has = <T extends object>(o: T, k: keyof T) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

export interface CompanyInput {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  sector?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  billingEmail?: string | null;
  notes?: string | null;
  owner?: string | null;
  status?: CompanyStatus;
}

export interface ContactInput {
  firstName?: string;
  lastName?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isPrimary?: boolean;
  status?: ContactStatus;
  notes?: string | null;
  companyId?: number | null;
}

export interface LeadInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  source?: string | null;
  owner?: string | null;
  notes?: string | null;
  priority?: LeadPriority;
  companyId?: number | null;
}

export interface OpportunityInput {
  title?: string;
  amountCents?: number | null;
  currency?: string;
  expectedClose?: number | null;
  owner?: string | null;
  planId?: string | null;
  modules?: string[];
  contactId?: number | null;
  nextAction?: string | null;
  nextActionAt?: number | null;
}

export interface ContractInput {
  planId?: string | null;
  modules?: string[];
  amountCents?: number | null;
  currency?: string;
  startDate?: number | null;
  endDate?: number;
  renewalDate?: number | null;
  billingInterval?: BillingInterval | null;
  autoRenew?: boolean;
  noticeDays?: number | null;
  conditions?: string | null;
  previousContractId?: number;
  /** Configuración cotizada (la calcula la API con el cotizador; ver server/catalog/quote.ts). */
  configuration?: ContractConfiguration | null;
}

/** Términos que se versionan (instantánea de cada versión). */
const CONTRACT_TERM_KEYS = ["planId", "modules", "amountCents", "currency", "billingInterval", "startDate", "renewalDate", "autoRenew", "noticeDays", "conditions", "configuration"] as const;
const CONTRACT_NAME: Record<ContractStatus, string> = { draft: "Borrador", sent: "Enviado", signed: "Firmado", active: "Activo", cancelled: "Cancelado" };

/**
 * Referencia comercial única: CT-<año UTC de la creación>-<id con al menos 6 dígitos, sin truncar>.
 * Misma regla que el relleno de db/crm/migrations/0002 (año de created_at).
 */
export const contractReference = (id: number, now: number) => `CT-${new Date(now).getUTCFullYear()}-${String(id).padStart(6, "0")}`;
/** Suma un periodo de facturación (mes/año natural, en UTC). */
export function addInterval(ms: number, interval: BillingInterval): number {
  const d = new Date(ms);
  if (interval === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}

export class CrmService {
  private now: () => number;
  private store: CrmStore;

  constructor(private d: CrmDeps) {
    this.now = d.now ?? Date.now;
    this.store = d.store;
  }

  // ── Empresas ───────────────────────────────────────────────────────────────

  async createCompany(input: CompanyInput & { name: string }, author: string): Promise<Company> {
    const fields = this.companyFields(input);
    if (!fields.name) throw new CrmError("invalid_input", "El nombre es obligatorio");
    await this.assertCompanyUnique(fields.name, fields.taxId ?? null);
    const c = await this.store.insert("companies", {
      name: fields.name,
      legalName: fields.legalName ?? null,
      taxId: fields.taxId ?? null,
      email: fields.email ?? null,
      phone: fields.phone ?? null,
      website: fields.website ?? null,
      sector: fields.sector ?? null,
      address: fields.address ?? null,
      city: fields.city ?? null,
      postalCode: fields.postalCode ?? null,
      country: fields.country ?? null,
      billingEmail: fields.billingEmail ?? null,
      notes: fields.notes ?? null,
      tenantId: null,
      owner: fields.owner ?? clean(author, 100),
      status: fields.status ?? "active",
      createdAt: this.now(),
      updatedAt: null,
    });
    await this.log("company", c.id, "note", "Empresa creada", author);
    return c;
  }

  async updateCompany(id: number, input: CompanyInput, author: string): Promise<Company> {
    const cur = await this.must("companies", id);
    const fields = this.companyFields(input);
    if (has(input, "name") && !fields.name) throw new CrmError("invalid_input", "El nombre es obligatorio");
    if ((fields.name && normalizeCompanyName(fields.name) !== normalizeCompanyName(cur.name)) || (fields.taxId && fields.taxId !== cur.taxId)) {
      await this.assertCompanyUnique(fields.name ?? cur.name, fields.taxId ?? null, id);
    }
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => fields[k] !== cur[k]);
    if (!changed.length) return cur;
    const patch: Partial<Company> = { updatedAt: this.now() };
    for (const k of changed) (patch as Record<string, unknown>)[k] = fields[k];
    const upd = await this.store.update("companies", id, patch);
    await this.log("company", id, "note", this.describeChanges(changed, cur, upd, ["status", "owner"]), author);
    return upd;
  }

  async getCompany(id: number): Promise<CompanyView> {
    const c = await this.must("companies", id);
    return (await this.withLifecycle([c]))[0];
  }

  async listCompanies(
    f: { q?: string; status?: CompanyStatus; lifecycle?: CompanyLifecycle; owner?: string } & PageOpts & SortOpts<CompanySortKey> = {},
  ): Promise<Page<CompanyView>> {
    let rows = await this.withLifecycle(await this.store.list("companies", f.status ? { status: f.status } : {}, { desc: true, limit: SCAN_LIMIT }));
    const q = normalizeText(f.q);
    if (q) {
      rows = rows.filter((c) =>
        [c.name, c.legalName, c.taxId, c.email, c.city, c.tenantId].some((v) => normalizeText(v).includes(q)),
      );
    }
    if (f.lifecycle) rows = rows.filter((c) => c.lifecycle === f.lifecycle);
    if (f.owner) rows = rows.filter((c) => c.owner === f.owner);
    return paginate(applySort(rows, COMPANY_SORT, f), f);
  }

  private async withLifecycle(companies: Company[]): Promise<CompanyView[]> {
    if (!companies.length) return [];
    const [contracts, opps] = await Promise.all([
      this.store.list("contracts", {}, { limit: SCAN_LIMIT }),
      this.store.list("opportunities", { stage: "won" }, { limit: SCAN_LIMIT }),
    ]);
    const customers = new Set<number>([
      ...contracts.filter((c) => c.status === "signed" || c.status === "active").map((c) => c.companyId),
      ...opps.map((o) => o.companyId),
    ]);
    return companies.map((c) => ({
      ...c,
      lifecycle: c.tenantId ? "tenant" : customers.has(c.id) ? "customer" : "prospect",
    }));
  }

  private companyFields(input: CompanyInput) {
    const out: Partial<Omit<Company, "id" | "tenantId" | "createdAt" | "updatedAt">> = {};
    if (has(input, "name")) out.name = clean(input.name, 200) ?? "";
    if (has(input, "legalName")) out.legalName = clean(input.legalName, 200);
    if (has(input, "taxId")) {
      const t = clean(input.taxId, 40)?.toUpperCase().replace(/\s+/g, "") ?? null;
      if (t && !/^[A-Z0-9-]{3,40}$/.test(t)) throw new CrmError("invalid_input", "Identificador fiscal no válido");
      out.taxId = t;
    }
    if (has(input, "email")) out.email = validEmail(clean(input.email, 320));
    if (has(input, "billingEmail")) out.billingEmail = validEmail(clean(input.billingEmail, 320), "Correo de facturación");
    if (has(input, "phone")) out.phone = clean(input.phone, 40);
    if (has(input, "website")) out.website = validWebsite(clean(input.website, 300));
    if (has(input, "sector")) out.sector = clean(input.sector, 100);
    if (has(input, "address")) out.address = clean(input.address, 300);
    if (has(input, "city")) out.city = clean(input.city, 120);
    if (has(input, "postalCode")) out.postalCode = clean(input.postalCode, 20);
    if (has(input, "country")) out.country = validCountry(clean(input.country, 10));
    if (has(input, "notes")) out.notes = clean(input.notes, 5000);
    if (has(input, "owner")) out.owner = clean(input.owner, 100);
    if (has(input, "status")) out.status = input.status;
    return out;
  }

  private async assertCompanyUnique(name: string, taxId: string | null, exceptId?: number) {
    const all = await this.store.list("companies", {}, { limit: SCAN_LIMIT });
    const n = normalizeCompanyName(name);
    for (const c of all) {
      if (c.id === exceptId) continue;
      if (taxId && c.taxId && c.taxId === taxId) throw new CrmError("conflict", `Ya existe una empresa con ese identificador fiscal (#${c.id})`);
      if (n && normalizeCompanyName(c.name) === n) throw new CrmError("conflict", `Ya existe una empresa con ese nombre (#${c.id})`);
    }
  }

  // ── Contactos ──────────────────────────────────────────────────────────────

  async createContact(companyId: number, input: ContactInput, author: string): Promise<Contact> {
    await this.must("companies", companyId);
    const f = this.contactFields(input);
    const name = f.name ?? "";
    if (!name) throw new CrmError("invalid_input", "El nombre es obligatorio");
    await this.assertContactEmailFree(companyId, f.email ?? null);
    const existing = await this.store.list("contacts", { companyId });
    const primary = input.isPrimary === true || !existing.some((c) => c.isPrimary);
    if (primary) await this.clearPrimary(companyId);
    const c = await this.store.insert("contacts", {
      companyId,
      name,
      firstName: f.firstName ?? null,
      lastName: f.lastName ?? null,
      email: f.email ?? null,
      phone: f.phone ?? null,
      role: f.role ?? null,
      isPrimary: primary,
      status: f.status ?? "active",
      notes: f.notes ?? null,
      createdAt: this.now(),
      updatedAt: null,
    });
    await this.log("company", companyId, "note", `Contacto añadido: ${c.name}${primary ? " (principal)" : ""}`, author);
    return c;
  }

  async updateContact(id: number, input: ContactInput, author: string): Promise<Contact> {
    const cur = await this.must("contacts", id);
    const f = this.contactFields(input, cur);
    if (has(input, "companyId") && input.companyId !== cur.companyId) {
      if (input.companyId !== null && input.companyId !== undefined) await this.must("companies", input.companyId);
      (f as Partial<Contact>).companyId = input.companyId ?? null;
      (f as Partial<Contact>).isPrimary = false;
    }
    const companyId = (f as Partial<Contact>).companyId !== undefined ? (f as Partial<Contact>).companyId! : cur.companyId;
    if (f.email && f.email !== cur.email && companyId) await this.assertContactEmailFree(companyId, f.email, id);
    if (input.isPrimary === true && companyId) {
      if ((f.status ?? cur.status) !== "active") throw new CrmError("invalid_input", "Un contacto inactivo no puede ser el principal");
      await this.clearPrimary(companyId, id);
      (f as Partial<Contact>).isPrimary = true;
    } else if (input.isPrimary === false) {
      (f as Partial<Contact>).isPrimary = false;
    }
    if (f.status === "inactive") (f as Partial<Contact>).isPrimary = false;
    const changed = (Object.keys(f) as (keyof Contact)[]).filter((k) => (f as Partial<Contact>)[k] !== cur[k]);
    if (!changed.length) return cur;
    const patch: Partial<Contact> = { updatedAt: this.now() };
    for (const k of changed) (patch as Record<string, unknown>)[k] = (f as Partial<Contact>)[k];
    const upd = await this.store.update("contacts", id, patch);
    if (upd.companyId) await this.log("company", upd.companyId, "note", `Contacto ${upd.name}: ${this.describeChanges(changed, cur, upd, ["status", "isPrimary"])}`, author);
    return upd;
  }

  async listContacts(f: { q?: string; companyId?: number; status?: ContactStatus } & PageOpts & SortOpts<ContactSortKey> = {}): Promise<Page<Contact>> {
    const filter: Partial<Contact> = {};
    if (f.companyId) filter.companyId = f.companyId;
    if (f.status) filter.status = f.status;
    let rows = await this.store.list("contacts", filter, { desc: true, limit: SCAN_LIMIT });
    const q = normalizeText(f.q);
    if (q) {
      const qp = normalizePhone(f.q);
      rows = rows.filter(
        (c) => [c.name, c.email, c.role].some((v) => normalizeText(v).includes(q)) || (qp !== "" && normalizePhone(c.phone) === qp),
      );
    }
    rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    return paginate(applySort(rows, CONTACT_SORT, f), f);
  }

  private contactFields(input: ContactInput, cur?: Contact) {
    const out: Partial<Pick<Contact, "name" | "firstName" | "lastName" | "email" | "phone" | "role" | "status" | "notes">> = {};
    if (has(input, "firstName") || has(input, "lastName") || has(input, "name")) {
      let first = has(input, "firstName") ? clean(input.firstName, 100) : (cur?.firstName ?? null);
      let last = has(input, "lastName") ? clean(input.lastName, 150) : (cur?.lastName ?? null);
      if (!first && has(input, "name") && clean(input.name, 200)) {
        const s = splitName(clean(input.name, 200)!);
        first = s.firstName.slice(0, 100);
        last = s.lastName?.slice(0, 150) ?? null;
      }
      if (!first) throw new CrmError("invalid_input", "El nombre es obligatorio");
      out.firstName = first;
      out.lastName = last;
      out.name = [first, last].filter(Boolean).join(" ").slice(0, 200);
    }
    if (has(input, "email")) out.email = validEmail(clean(input.email, 320));
    if (has(input, "phone")) out.phone = clean(input.phone, 40);
    if (has(input, "role")) out.role = clean(input.role, 100);
    if (has(input, "status")) out.status = input.status;
    if (has(input, "notes")) out.notes = clean(input.notes, 5000);
    return out;
  }

  private async clearPrimary(companyId: number, exceptId?: number) {
    for (const c of await this.store.list("contacts", { companyId, isPrimary: true })) {
      if (c.id !== exceptId) await this.store.update("contacts", c.id, { isPrimary: false, updatedAt: this.now() });
    }
  }

  private async assertContactEmailFree(companyId: number, email: string | null, exceptId?: number) {
    if (!email) return;
    const dup = (await this.store.list("contacts", { companyId })).find((c) => c.id !== exceptId && c.email?.toLowerCase() === email);
    if (dup) throw new CrmError("conflict", `La empresa ya tiene un contacto con ese correo (#${dup.id})`);
  }

  // ── Leads ──────────────────────────────────────────────────────────────────

  async createLead(input: LeadInput & { name: string }, author: string): Promise<Lead> {
    const name = clean(input.name, 200);
    if (!name) throw new CrmError("invalid_input", "El nombre es obligatorio");
    const email = validEmail(clean(input.email, 320));
    if (!email && !clean(input.phone, 40)) throw new CrmError("invalid_input", "Indica un correo o un teléfono");
    // Deduplicación por correo: un lead abierto con el mismo correo no se duplica
    if (email) {
      const dup = (await this.store.list("leads", {}, { limit: SCAN_LIMIT })).find(
        (l) => l.email?.toLowerCase() === email && l.status !== "converted" && l.status !== "disqualified",
      );
      if (dup) throw new CrmError("conflict", `Ya existe un lead abierto con ese correo (#${dup.id})`);
    }
    if (input.companyId) await this.must("companies", input.companyId);
    const lead = await this.store.insert("leads", {
      source: clean(input.source, 60),
      name,
      email,
      phone: clean(input.phone, 40),
      companyName: clean(input.companyName, 200),
      status: "new",
      priority: input.priority ?? "normal",
      owner: clean(input.owner, 100),
      notes: clean(input.notes, 5000),
      companyId: input.companyId ?? null,
      convertedCompanyId: null,
      convertedOpportunityId: null,
      createdAt: this.now(),
      updatedAt: null,
    });
    await this.log("lead", lead.id, "note", "Lead creado", author);
    return lead;
  }

  async updateLead(id: number, input: LeadInput, author: string): Promise<Lead> {
    const cur = await this.must("leads", id);
    const out: Partial<Lead> = {};
    // Un lead convertido conserva sus datos de origen: solo admite notas, responsable y prioridad.
    const locked = cur.status === "converted";
    const editable: (keyof LeadInput)[] = locked
      ? ["notes", "owner", "priority"]
      : ["name", "email", "phone", "companyName", "source", "owner", "notes", "priority", "companyId"];
    for (const k of Object.keys(input) as (keyof LeadInput)[]) {
      if (input[k] !== undefined && !editable.includes(k)) throw new CrmError("invalid_state", `El lead convertido no admite cambios en «${k}»`);
    }
    if (has(input, "name")) {
      out.name = clean(input.name, 200) ?? "";
      if (!out.name) throw new CrmError("invalid_input", "El nombre es obligatorio");
    }
    if (has(input, "email")) out.email = validEmail(clean(input.email, 320));
    if (has(input, "phone")) out.phone = clean(input.phone, 40);
    if (has(input, "companyName")) out.companyName = clean(input.companyName, 200);
    if (has(input, "source")) out.source = clean(input.source, 60);
    if (has(input, "owner")) out.owner = clean(input.owner, 100);
    if (has(input, "notes")) out.notes = clean(input.notes, 5000);
    if (has(input, "priority")) out.priority = input.priority;
    if (has(input, "companyId")) {
      if (input.companyId) await this.must("companies", input.companyId);
      out.companyId = input.companyId ?? null;
    }
    const email = out.email !== undefined ? out.email : cur.email;
    const phone = out.phone !== undefined ? out.phone : cur.phone;
    if (!email && !phone) throw new CrmError("invalid_input", "Indica un correo o un teléfono");
    if (out.email && out.email !== cur.email) {
      const dup = (await this.store.list("leads", {}, { limit: SCAN_LIMIT })).find(
        (l) => l.id !== id && l.email?.toLowerCase() === out.email && l.status !== "converted" && l.status !== "disqualified",
      );
      if (dup) throw new CrmError("conflict", `Ya existe un lead abierto con ese correo (#${dup.id})`);
    }
    const changed = (Object.keys(out) as (keyof Lead)[]).filter((k) => out[k] !== cur[k]);
    if (!changed.length) return cur;
    const patch: Partial<Lead> = { updatedAt: this.now() };
    for (const k of changed) (patch as Record<string, unknown>)[k] = out[k];
    const upd = await this.store.update("leads", id, patch);
    await this.log("lead", id, "note", this.describeChanges(changed, cur, upd, ["priority", "owner", "source"]), author);
    return upd;
  }

  async listLeads(
    f: { q?: string; status?: LeadStatus; priority?: LeadPriority; owner?: string } & PageOpts & SortOpts<LeadSortKey> = {},
  ): Promise<Page<Lead>> {
    const filter: Partial<Lead> = {};
    if (f.status) filter.status = f.status;
    if (f.priority) filter.priority = f.priority;
    let rows = await this.store.list("leads", filter, { desc: true, limit: SCAN_LIMIT });
    if (f.owner) rows = rows.filter((l) => l.owner === f.owner);
    const q = normalizeText(f.q);
    if (q) {
      const qp = normalizePhone(f.q);
      rows = rows.filter(
        (l) => [l.name, l.email, l.companyName, l.source].some((v) => normalizeText(v).includes(q)) || (qp !== "" && normalizePhone(l.phone) === qp),
      );
    }
    return paginate(applySort(rows, LEAD_SORT, f), f);
  }

  /** Posibles duplicados de un lead/contacto/empresa por correo, teléfono, nombre de empresa o NIF. */
  async findDuplicates(input: { email?: string | null; phone?: string | null; companyName?: string | null; taxId?: string | null; excludeLeadId?: number }): Promise<DuplicateMatch[]> {
    const email = clean(input.email, 320)?.toLowerCase() ?? "";
    const phone = normalizePhone(input.phone);
    const company = normalizeCompanyName(input.companyName);
    const taxId = clean(input.taxId, 40)?.toUpperCase().replace(/\s+/g, "") ?? "";
    if (!email && !phone && !company && !taxId) return [];
    const out: DuplicateMatch[] = [];
    const [leads, contacts, companies] = await Promise.all([
      this.store.list("leads", {}, { limit: SCAN_LIMIT }),
      this.store.list("contacts", {}, { limit: SCAN_LIMIT }),
      this.store.list("companies", {}, { limit: SCAN_LIMIT }),
    ]);
    for (const l of leads) {
      if (l.id === input.excludeLeadId) continue;
      const reason = email && l.email?.toLowerCase() === email ? "email" : phone && normalizePhone(l.phone) === phone ? "phone" : company && normalizeCompanyName(l.companyName) === company ? "company_name" : null;
      if (reason) out.push({ type: "lead", id: l.id, label: `${l.name} (${l.status})`, reason });
    }
    for (const c of contacts) {
      const reason = email && c.email?.toLowerCase() === email ? "email" : phone && normalizePhone(c.phone) === phone ? "phone" : null;
      if (reason) out.push({ type: "contact", id: c.id, label: c.name, reason });
    }
    for (const c of companies) {
      const reason = taxId && c.taxId === taxId ? "tax_id" : company && normalizeCompanyName(c.name) === company ? "company_name" : null;
      if (reason) out.push({ type: "company", id: c.id, label: c.name, reason });
    }
    return out;
  }

  async setLeadStatus(id: number, status: Exclude<LeadStatus, "converted">, author: string): Promise<Lead> {
    const lead = await this.must("leads", id);
    if (lead.status === "converted") throw new CrmError("invalid_state", "El lead ya está convertido");
    if (lead.status === status) return lead;
    const upd = await this.store.update("leads", id, { status, updatedAt: this.now() });
    await this.log("lead", id, "note", `Estado: ${lead.status} → ${status}`, author);
    return upd;
  }

  async convertLead(
    id: number,
    input: {
      companyId?: number;
      companyName?: string;
      opportunity?: { title: string; amountCents?: number; currency?: string; expectedClose?: number; planId?: string; modules?: string[] };
    },
    author: string,
  ): Promise<{ company: Company; contact: Contact; opportunity: Opportunity | null; lead: Lead }> {
    const lead = await this.must("leads", id);
    if (lead.status === "converted") throw new CrmError("invalid_state", "El lead ya está convertido");
    if (lead.status === "disqualified") throw new CrmError("invalid_state", "El lead está descartado");
    if (input.opportunity) {
      // Valida antes de escribir nada: una conversión no queda a medias por datos incorrectos
      if (!clean(input.opportunity.title, 200)) throw new CrmError("invalid_input", "El título es obligatorio");
      validModules(input.opportunity.modules);
    }

    const targetId = input.companyId ?? lead.companyId ?? null;
    let company: Company | null = targetId ? await this.must("companies", targetId) : null;
    if (!company) {
      const companyName = clean(input.companyName, 200) ?? lead.companyName ?? lead.name;
      // Reutiliza la empresa si ya existe con el mismo nombre (sin forma jurídica ni acentos)
      const n = normalizeCompanyName(companyName);
      company = (await this.store.list("companies", {}, { limit: SCAN_LIMIT })).find((c) => normalizeCompanyName(c.name) === n) ?? null;
      if (!company) {
        company = await this.createCompany({ name: companyName, owner: lead.owner, email: null }, author);
      }
    }

    // Reutiliza el contacto de la empresa con el mismo correo; si no, lo crea con los datos del lead
    const companyContacts = await this.store.list("contacts", { companyId: company.id });
    let contact =
      (lead.email ? companyContacts.find((c) => c.email?.toLowerCase() === lead.email!.toLowerCase()) : undefined) ?? null;
    if (!contact) {
      const { firstName, lastName } = splitName(lead.name);
      contact = await this.createContact(
        company.id,
        { firstName, lastName, email: lead.email, phone: lead.phone, notes: lead.notes },
        author,
      );
    }

    let opportunity: Opportunity | null = null;
    if (input.opportunity) {
      opportunity = await this.createOpportunity(
        { companyId: company.id, contactId: contact.id, ...input.opportunity, owner: lead.owner ?? undefined },
        author,
      );
      await this.log("opportunity", opportunity.id, "note", `Origen: lead #${lead.id}${lead.source ? ` (${lead.source})` : ""}`, author);
    }
    const upd = await this.store.update("leads", id, {
      status: "converted",
      convertedCompanyId: company.id,
      convertedOpportunityId: opportunity?.id ?? null,
      updatedAt: this.now(),
    });
    await this.log("lead", id, "note", `Convertido en empresa #${company.id}`, author);
    await this.log(
      "company",
      company.id,
      "note",
      `Desde lead #${lead.id}${lead.source ? ` (origen: ${lead.source})` : ""}${lead.notes ? `. Notas del lead: ${lead.notes}` : ""}`,
      author,
    );
    return { company, contact, opportunity, lead: upd };
  }

  // ── Oportunidades ──────────────────────────────────────────────────────────

  async createOpportunity(input: OpportunityInput & { companyId: number; title: string }, author: string): Promise<Opportunity> {
    await this.must("companies", input.companyId);
    const f = await this.opportunityFields(input, input.companyId);
    if (!f.title) throw new CrmError("invalid_input", "El título es obligatorio");
    const o = await this.store.insert("opportunities", {
      companyId: input.companyId,
      contactId: f.contactId ?? null,
      title: f.title,
      stage: "prospecting",
      amountCents: f.amountCents ?? null,
      currency: f.currency ?? "EUR",
      expectedClose: f.expectedClose ?? null,
      probability: STAGE_PROBABILITY.prospecting,
      owner: f.owner ?? null,
      planId: f.planId ?? null,
      modules: f.modules ?? [],
      nextAction: f.nextAction ?? null,
      nextActionAt: f.nextActionAt ?? null,
      lostReason: null,
      createdAt: this.now(),
      updatedAt: null,
      closedAt: null,
    });
    await this.log("opportunity", o.id, "note", "Oportunidad creada", author);
    return o;
  }

  async updateOpportunity(id: number, input: OpportunityInput, author: string): Promise<Opportunity> {
    const cur = await this.must("opportunities", id);
    const f = await this.opportunityFields(input, cur.companyId);
    if (has(input, "title") && !f.title) throw new CrmError("invalid_input", "El título es obligatorio");
    const changed = (Object.keys(f) as (keyof Opportunity)[]).filter((k) => JSON.stringify((f as Partial<Opportunity>)[k]) !== JSON.stringify(cur[k]));
    if (!changed.length) return cur;
    const patch: Partial<Opportunity> = { updatedAt: this.now() };
    for (const k of changed) (patch as Record<string, unknown>)[k] = (f as Partial<Opportunity>)[k];
    const upd = await this.store.update("opportunities", id, patch);
    await this.log("opportunity", id, "note", this.describeChanges(changed, cur, upd, ["owner", "planId", "nextAction"]), author);
    return upd;
  }

  async listOpportunities(
    f: { q?: string; stage?: OpportunityStage; owner?: string; companyId?: number; open?: boolean } & PageOpts = {},
  ): Promise<Page<Opportunity>> {
    const filter: Partial<Opportunity> = {};
    if (f.stage) filter.stage = f.stage;
    if (f.companyId) filter.companyId = f.companyId;
    let rows = await this.store.list("opportunities", filter, { desc: true, limit: SCAN_LIMIT });
    if (f.owner) rows = rows.filter((o) => o.owner === f.owner);
    if (f.open) rows = rows.filter((o) => OPEN_STAGES.includes(o.stage));
    const q = normalizeText(f.q);
    if (q) rows = rows.filter((o) => normalizeText(o.title).includes(q) || normalizeText(o.planId).includes(q));
    return paginate(rows, f);
  }

  private async opportunityFields(input: OpportunityInput, companyId: number) {
    const out: Partial<Omit<Opportunity, "id" | "companyId" | "stage" | "probability" | "lostReason" | "createdAt" | "updatedAt" | "closedAt">> = {};
    if (has(input, "title")) out.title = clean(input.title, 200) ?? "";
    if (has(input, "amountCents")) {
      const a = input.amountCents;
      if (a !== null && (!Number.isInteger(a) || a! < 0)) throw new CrmError("invalid_input", "Importe no válido");
      out.amountCents = a ?? null;
    }
    if (has(input, "currency")) {
      const c = (input.currency ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(c)) throw new CrmError("invalid_input", "Moneda no válida");
      out.currency = c;
    }
    if (has(input, "expectedClose")) out.expectedClose = this.validTime(input.expectedClose, "Fecha de cierre");
    if (has(input, "owner")) out.owner = clean(input.owner, 100);
    if (has(input, "planId")) {
      const p = clean(input.planId, 64);
      if (p && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p)) throw new CrmError("invalid_input", "Plan no válido");
      out.planId = p;
    }
    if (has(input, "modules")) out.modules = validModules(input.modules);
    if (has(input, "contactId")) {
      if (input.contactId) {
        const c = await this.must("contacts", input.contactId);
        // El contacto debe pertenecer a la empresa de la oportunidad (no se enlazan datos ajenos)
        if (c.companyId !== companyId) throw new CrmError("invalid_input", "El contacto no pertenece a la empresa");
      }
      out.contactId = input.contactId ?? null;
    }
    if (has(input, "nextAction")) out.nextAction = clean(input.nextAction, 300);
    if (has(input, "nextActionAt")) out.nextActionAt = this.validTime(input.nextActionAt, "Fecha de la próxima acción");
    return out;
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
      updatedAt: this.now(),
    });
    await this.log("opportunity", id, "note", `Etapa: ${STAGE_NAME[o.stage]} → ${STAGE_NAME[to]}${to === "lost" ? ` (motivo: ${clean(opts.lostReason)})` : ""}`, author);
    return upd;
  }

  async pipeline() {
    const opps = await this.store.list("opportunities", {}, { limit: SCAN_LIMIT });
    return STAGES.map((stage) => {
      const rows = opps.filter((o) => o.stage === stage);
      const total = rows.reduce((a, o) => a + (o.amountCents ?? 0), 0);
      const weighted = rows.reduce((a, o) => a + Math.round(((o.amountCents ?? 0) * o.probability) / 100), 0);
      return { stage, count: rows.length, totalCents: total, weightedCents: stage === "won" || stage === "lost" ? total : weighted };
    });
  }

  // ── Contratos ──────────────────────────────────────────────────────────────

  async createContract(input: ContractInput & { companyId: number; opportunityId?: number }, author: string): Promise<Contract> {
    await this.must("companies", input.companyId);
    if (input.opportunityId) {
      const o = await this.must("opportunities", input.opportunityId);
      if (o.companyId !== input.companyId) throw new CrmError("invalid_input", "La oportunidad no pertenece a la empresa");
    }
    const terms = this.contractTerms(input);
    this.assertDates({ startDate: terms.startDate ?? null, renewalDate: terms.renewalDate ?? null });
    const c = await this.store.insert("contracts", {
      reference: null,
      companyId: input.companyId,
      opportunityId: input.opportunityId ?? null,
      planId: terms.planId ?? null,
      modules: terms.modules ?? [],
      status: "draft",
      amountCents: terms.amountCents ?? null,
      currency: terms.currency ?? "EUR",
      startDate: terms.startDate ?? null,
      endDate: input.endDate ?? null,
      documentUrl: null,
      signedAt: null,
      tenantId: null,
      conditions: terms.conditions ?? null,
      billingInterval: terms.billingInterval ?? null,
      renewalDate: terms.renewalDate ?? null,
      autoRenew: terms.autoRenew ?? false,
      noticeDays: terms.noticeDays ?? null,
      version: 1,
      previousContractId: input.previousContractId ?? null,
      signatureMethod: null,
      signatureRef: null,
      createdAt: this.now(),
      updatedAt: null,
      // Solo si viene: así los contratos sin configuración no dependen de la migración 0009
      ...(terms.configuration !== undefined ? { configuration: terms.configuration } : {}),
    });
    // La referencia se deriva de (id, createdAt): si la segunda escritura falla, se deshace el alta
    // para no dejar contratos sin referencia (y el relleno de la 0002 reconstruiría la misma).
    let withRef: Contract;
    try {
      withRef = await this.store.update("contracts", c.id, { reference: contractReference(c.id, c.createdAt) });
    } catch (err) {
      await this.store.remove("contracts", c.id).catch(() => undefined);
      throw err;
    }
    await this.snapshot(withRef, input.previousContractId ? `Renovación del contrato #${input.previousContractId}` : "Versión inicial", author);
    await this.log("contract", c.id, "note", `Contrato ${withRef.reference} creado`, author);
    return withRef;
  }

  /**
   * Cambia los términos. Solo en borrador o enviado (un contrato enviado vuelve a borrador y hay
   * que reenviarlo); firmados y activos son inmutables: los cambios van en una renovación.
   * Cada cambio de términos crea una versión nueva con su instantánea.
   */
  async updateContract(id: number, input: ContractInput & { reason?: string }, author: string): Promise<Contract> {
    const cur = await this.must("contracts", id);
    if (cur.status !== "draft" && cur.status !== "sent") {
      throw new CrmError("invalid_state", "Un contrato firmado, activo o cancelado no se modifica: crea una renovación");
    }
    const terms = this.contractTerms(input);
    const changed = (Object.keys(terms) as (keyof Contract)[]).filter((k) => JSON.stringify((terms as Partial<Contract>)[k]) !== JSON.stringify(cur[k]));
    if (!changed.length) return cur;
    const patch: Partial<Contract> = { updatedAt: this.now(), version: cur.version + 1 };
    for (const k of changed) (patch as Record<string, unknown>)[k] = (terms as Partial<Contract>)[k];
    if (cur.status === "sent") patch.status = "draft";
    this.assertDates({ startDate: patch.startDate !== undefined ? patch.startDate : cur.startDate, renewalDate: patch.renewalDate !== undefined ? patch.renewalDate : cur.renewalDate });
    const upd = await this.store.update("contracts", id, patch);
    await this.snapshot(upd, clean(input.reason, 300) ?? `Cambios: ${changed.map((k) => FIELD_LABEL[String(k)] ?? String(k)).join(", ")}`, author);
    await this.log(
      "contract",
      id,
      "note",
      `Versión ${upd.version}: ${this.describeChanges(changed, cur, upd, ["planId", "billingInterval", "autoRenew"])}${cur.status === "sent" ? " (vuelve a borrador)" : ""}`,
      author,
    );
    return upd;
  }

  async setContractStatus(id: number, to: ContractStatus, author: string, opts: { signatureRef?: string; approvalReason?: string; signatureMethod?: SignatureMethod } = {}): Promise<Contract> {
    const c = await this.must("contracts", id);
    if (c.status === to) return c;
    if (!CONTRACT_TRANSITIONS[c.status].includes(to)) throw new CrmError("invalid_state", `Transición no permitida: ${c.status} → ${to}`);
    const q = c.configuration?.quote;
    if (q && (to === "sent" || to === "signed" || to === "active")) {
      // Lo «Próximamente» o no publicado no se contrata: hay que quitarlo de la configuración
      if (q.blocking.length) throw new CrmError("invalid_state", `La configuración incluye productos que aún no se pueden contratar: ${q.blocking.join(", ")}`);
      // «Solicitar activación»: exige una aprobación explícita con motivo, registrada en esta operación
      const onRequest = q.lines.filter((l) => l.commercialStatus === "on_request").map((l) => l.name);
      if (onRequest.length && to !== "active") {
        const reason = clean(opts.approvalReason, 300);
        if (!reason || reason.length < 5) throw new CrmError("invalid_input", `Requiere aprobación de activación (motivo de al menos 5 caracteres) para: ${onRequest.join(", ")}`);
        await this.log("contract", id, "note", `Aprobada la activación de ${onRequest.join(", ")}: ${reason}`, author);
      }
    }
    if (to === "active") return this.activateContract(c, author);
    const patch: Partial<Contract> = { status: to, updatedAt: this.now() };
    if (to === "signed") {
      // Firma registrada por el operador, o aceptación electrónica con evidencias (servicios externos): queda trazada
      patch.signedAt = this.now();
      patch.signatureMethod = opts.signatureMethod === "electronic" ? "electronic" : "manual";
      patch.signatureRef = clean(opts.signatureRef, 200);
    }
    const upd = await this.store.update("contracts", id, patch);
    await this.log("contract", id, "note", `Estado: ${CONTRACT_NAME[c.status]} → ${CONTRACT_NAME[to]}${to === "signed" ? (opts.signatureMethod === "electronic" ? " (aceptación electrónica con evidencias)" : " (firma registrada manualmente)") : ""}`, author);
    return upd;
  }

  /** Crea el contrato de renovación (borrador) con los mismos términos y el periodo siguiente. */
  async renewContract(id: number, author: string): Promise<Contract> {
    const c = await this.must("contracts", id);
    if (c.status !== "active" && c.status !== "signed") throw new CrmError("invalid_state", "Solo se renuevan contratos firmados o activos");
    const open = (await this.store.list("contracts", { previousContractId: id })).find((x) => x.status !== "cancelled");
    if (open) throw new CrmError("conflict", `Ya existe la renovación ${open.reference ?? `#${open.id}`}`);
    const start = c.renewalDate ?? this.now();
    const next = await this.createContract(
      {
        companyId: c.companyId,
        planId: c.planId ?? undefined,
        modules: c.modules,
        amountCents: c.amountCents ?? undefined,
        currency: c.currency,
        billingInterval: c.billingInterval ?? undefined,
        startDate: start,
        renewalDate: c.billingInterval ? addInterval(start, c.billingInterval) : undefined,
        autoRenew: c.autoRenew,
        noticeDays: c.noticeDays ?? undefined,
        conditions: c.conditions ?? undefined,
        ...(c.configuration ? { configuration: c.configuration } : {}),
        previousContractId: c.id,
      },
      author,
    );
    await this.log("contract", c.id, "note", `Renovación creada: ${next.reference}`, author);
    return next;
  }

  async getContract(id: number): Promise<{ contract: Contract; versions: ContractVersion[]; timeline: Activity[] }> {
    const contract = await this.must("contracts", id);
    const versions = (await this.store.list("contractVersions", { contractId: id })).sort((a, b) => b.version - a.version);
    return { contract, versions, timeline: await this.timeline("contract", id) };
  }

  async listContracts(
    f: { q?: string; status?: ContractStatus; companyId?: number; renewalBefore?: number } & PageOpts & SortOpts<ContractSortKey> = {},
  ): Promise<Page<Contract>> {
    const filter: Partial<Contract> = {};
    if (f.status) filter.status = f.status;
    if (f.companyId) filter.companyId = f.companyId;
    let rows = await this.store.list("contracts", filter, { desc: true, limit: SCAN_LIMIT });
    if (f.renewalBefore !== undefined) {
      rows = rows
        .filter((c) => c.status === "active" && c.renewalDate !== null && c.renewalDate <= f.renewalBefore!)
        .sort((a, b) => a.renewalDate! - b.renewalDate!);
    }
    const q = normalizeText(f.q);
    if (q) rows = rows.filter((c) => normalizeText(c.reference).includes(q) || normalizeText(c.planId).includes(q));
    return paginate(applySort(rows, CONTRACT_SORT, f), f);
  }

  private contractTerms(input: ContractInput) {
    const out: Partial<Pick<Contract, "planId" | "modules" | "amountCents" | "currency" | "startDate" | "renewalDate" | "billingInterval" | "autoRenew" | "noticeDays" | "conditions" | "configuration">> = {};
    if (has(input, "configuration")) out.configuration = input.configuration ?? null;
    if (has(input, "planId")) {
      const p = clean(input.planId, 64);
      if (p && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p)) throw new CrmError("invalid_input", "Plan no válido");
      out.planId = p;
    }
    // Contratos: los módulos con formato no válido se descartan (comportamiento existente)
    if (has(input, "modules")) out.modules = Array.from(new Set((input.modules ?? []).map((m) => m.trim()).filter((m) => MODULE_RE.test(m))));
    if (has(input, "amountCents")) {
      const a = input.amountCents;
      if (a !== null && (!Number.isInteger(a) || a! < 0)) throw new CrmError("invalid_input", "Importe no válido");
      out.amountCents = a ?? null;
    }
    if (has(input, "currency")) {
      const c = (input.currency ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(c)) throw new CrmError("invalid_input", "Moneda no válida");
      out.currency = c;
    }
    if (has(input, "startDate")) out.startDate = this.validTime(input.startDate, "Fecha de inicio");
    if (has(input, "renewalDate")) out.renewalDate = this.validTime(input.renewalDate, "Fecha de renovación");
    if (has(input, "billingInterval")) out.billingInterval = input.billingInterval ?? null;
    if (has(input, "autoRenew")) out.autoRenew = Boolean(input.autoRenew);
    if (has(input, "noticeDays")) {
      const n = input.noticeDays;
      if (n !== null && (!Number.isInteger(n) || n! < 0 || n! > 365)) throw new CrmError("invalid_input", "Preaviso no válido (0–365 días)");
      out.noticeDays = n ?? null;
    }
    if (has(input, "conditions")) out.conditions = clean(input.conditions, 20000);
    return out;
  }

  private assertDates(c: { startDate: number | null; renewalDate: number | null }) {
    if (c.startDate !== null && c.renewalDate !== null && c.renewalDate <= c.startDate) {
      throw new CrmError("invalid_input", "La renovación debe ser posterior al inicio");
    }
  }

  private async snapshot(c: Contract, reason: string, author: string) {
    const snapshot: Record<string, unknown> = {};
    for (const k of CONTRACT_TERM_KEYS) snapshot[k] = c[k];
    await this.store.insert("contractVersions", { contractId: c.id, version: c.version, snapshot, reason, author: author.slice(0, 100), createdAt: this.now() });
  }

  private async activateContract(c: Contract, author: string): Promise<Contract> {
    if (!this.d.activation) throw new CrmError("invalid_state", "La activación de contratos no está configurada");
    if (!c.planId) throw new CrmError("invalid_input", "El contrato necesita un plan");
    const company = await this.must("companies", c.companyId);
    // El administrador de la plataforma sale de un contacto activo con correo (preferente el principal)
    const contacts = (await this.store.list("contacts", { companyId: company.id })).filter((x) => x.status !== "inactive" && x.email);
    const contact = contacts.find((x) => x.isPrimary) ?? contacts[0] ?? null;
    if (!contact) throw new CrmError("invalid_input", "El contrato necesita un contacto activo con correo (será el administrador de la plataforma)");
    let tenantId: string;
    try {
      ({ tenantId } = await this.d.activation.activate({ contract: c, company, contact }));
    } catch (e) {
      // Un fallo del alta no es un error interno: el contrato sigue firmado y se puede reintentar
      throw new CrmError("conflict", `No se pudo activar: ${e instanceof Error ? e.message : "error del alta"}`);
    }
    await this.store.update("companies", company.id, { tenantId, updatedAt: this.now() });
    const startDate = c.startDate ?? this.now();
    const renewalDate = c.renewalDate ?? (c.billingInterval ? addInterval(startDate, c.billingInterval) : null);
    const upd = await this.store.update("contracts", c.id, { status: "active", tenantId, startDate, renewalDate, updatedAt: this.now() });
    await this.log("contract", c.id, "note", `Contrato activo; tenant ${tenantId}`, author);
    await this.log("company", company.id, "note", `Alta de plataforma: ${tenantId}`, author);
    return upd;
  }

  // ── Actividad y seguimiento ────────────────────────────────────────────────

  async log(
    entityType: EntityType,
    entityId: number,
    kind: ActivityKind,
    summary: string,
    author: string,
    opts: { dueAt?: number; assignee?: string | null; priority?: TaskPriority } = {},
  ): Promise<Activity> {
    return this.store.insert("activities", {
      entityType,
      entityId,
      kind,
      summary: summary.slice(0, 1000),
      dueAt: opts.dueAt ?? null,
      doneAt: null,
      author: author.slice(0, 100),
      assignee: kind === "task" ? cleanAssignee(opts.assignee) : null,
      priority: kind === "task" ? (opts.priority ?? "normal") : "normal",
      createdAt: this.now(),
    });
  }

  async addTask(
    entityType: EntityType,
    entityId: number,
    summary: string,
    dueAt: number,
    author: string,
    opts: { assignee?: string | null; priority?: TaskPriority } = {},
  ): Promise<Activity> {
    if (!Number.isFinite(dueAt)) throw new CrmError("invalid_input", "Fecha no válida");
    return this.log(entityType, entityId, "task", summary, author, { dueAt, ...opts });
  }

  /** Reasignar, cambiar la prioridad, la fecha o el texto de una tarea pendiente (una hecha no se reabre aquí). */
  async updateTask(id: number, patch: { assignee?: string | null; priority?: TaskPriority; dueAt?: number; summary?: string }): Promise<Activity> {
    const a = await this.must("activities", id);
    if (a.kind !== "task") throw new CrmError("invalid_state", "No es una tarea");
    if (a.doneAt !== null) throw new CrmError("invalid_state", "La tarea ya está hecha");
    if (patch.dueAt !== undefined && !Number.isFinite(patch.dueAt)) throw new CrmError("invalid_input", "Fecha no válida");
    const next: Partial<Activity> = {};
    if (patch.assignee !== undefined) next.assignee = cleanAssignee(patch.assignee);
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
    if (patch.summary !== undefined) next.summary = patch.summary.slice(0, 1000);
    if (!Object.keys(next).length) return a;
    return this.store.update("activities", id, next);
  }

  async completeTask(id: number): Promise<Activity> {
    const a = await this.must("activities", id);
    if (a.kind !== "task") throw new CrmError("invalid_state", "No es una tarea");
    if (a.doneAt !== null) return a;
    return this.store.update("activities", id, { doneAt: this.now() });
  }

  async tasks(opts: { author?: string; until?: number; includeDone?: boolean; assignee?: string | null; priority?: TaskPriority } = {}): Promise<Activity[]> {
    const all = await this.store.list("activities", { kind: "task" }, { limit: SCAN_LIMIT });
    const rank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
    return all
      .filter((a) => (opts.includeDone ? true : a.doneAt === null))
      .filter((a) => !opts.author || a.author === opts.author)
      // assignee: null = sin asignar; texto = de ese responsable
      .filter((a) => opts.assignee === undefined || (opts.assignee === null ? !a.assignee : a.assignee === opts.assignee))
      .filter((a) => !opts.priority || (a.priority ?? "normal") === opts.priority)
      .filter((a) => opts.until === undefined || (a.dueAt ?? Infinity) <= opts.until)
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || rank[a.priority ?? "normal"] - rank[b.priority ?? "normal"]);
  }

  async timeline(entityType: EntityType, entityId: number): Promise<Activity[]> {
    return (await this.store.list("activities", { entityType, entityId })).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  }

  async dashboard() {
    const leads = await this.store.list("leads", {}, { limit: SCAN_LIMIT });
    const byStatus: Record<string, number> = {};
    for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    const now = this.now();
    const overdue = (await this.tasks({ until: now })).length;
    const contracts = await this.store.list("contracts", {}, { limit: SCAN_LIMIT });
    const mrrCents = contracts.filter((c) => c.status === "active").reduce((a, c) => a + (c.amountCents ?? 0), 0);
    const pipeline = await this.pipeline();
    const opps = await this.store.list("opportunities", {}, { limit: SCAN_LIMIT });
    const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
    const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    const wonMonth = opps.filter((o) => o.stage === "won" && (o.closedAt ?? 0) >= monthStart);
    const companies = await this.withLifecycle(await this.store.list("companies", {}, { limit: SCAN_LIMIT }));
    const renewalHorizon = now + 30 * 86_400_000;
    const metrics = {
      activeLeads: leads.filter((l) => l.status === "new" || l.status === "contacted" || l.status === "qualified").length,
      openOpportunities: open.length,
      pipelineOpenCents: open.reduce((a, o) => a + (o.amountCents ?? 0), 0),
      pipelineWeightedCents: open.reduce((a, o) => a + Math.round(((o.amountCents ?? 0) * o.probability) / 100), 0),
      overdueNextActions: open.filter((o) => o.nextActionAt !== null && o.nextActionAt < now).length,
      wonThisMonth: { count: wonMonth.length, amountCents: wonMonth.reduce((a, o) => a + (o.amountCents ?? 0), 0) },
      pendingContracts: {
        draft: contracts.filter((c) => c.status === "draft").length,
        sent: contracts.filter((c) => c.status === "sent").length,
        signed: contracts.filter((c) => c.status === "signed").length,
      },
      renewalsNext30Days: contracts.filter((c) => c.status === "active" && c.renewalDate !== null && c.renewalDate <= renewalHorizon).length,
      overdueTasks: overdue,
      activeCustomers: companies.filter((c) => c.status === "active" && c.lifecycle !== "prospect").length,
      customersWithPlatform: companies.filter((c) => c.status === "active" && c.lifecycle === "tenant").length,
      prospects: companies.filter((c) => c.status === "active" && c.lifecycle === "prospect").length,
    };
    return {
      leadsByStatus: byStatus,
      pipeline,
      overdueTasks: overdue,
      activeContracts: contracts.filter((c) => c.status === "active").length,
      contractedCents: mrrCents,
      metrics,
      generatedAt: now,
    };
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private validTime(v: number | null | undefined, field: string): number | null {
    if (v === null || v === undefined) return null;
    if (!Number.isInteger(v) || v < 0) throw new CrmError("invalid_input", `${field} no válida`);
    return v;
  }

  /** Resumen de cambios para el historial: nombres de campo y, para los no personales, sus valores. */
  private describeChanges<T>(changed: (keyof T)[], before: T, after: T, showValues: (keyof T)[]): string {
    const show = (v: unknown) => (v === true ? "sí" : v === false ? "no" : String(v ?? "—"));
    return `Actualizado: ${changed
      .map((k) => {
        const label = FIELD_LABEL[String(k)] ?? String(k);
        return showValues.includes(k) ? `${label} ${show(before[k])} → ${show(after[k])}` : label;
      })
      .join(", ")}`;
  }

  private async must<K extends Parameters<CrmStore["get"]>[0]>(table: K, id: number) {
    const r = await this.store.get(table, id);
    if (!r) throw new CrmError("not_found", `No encontrado (${table} #${id})`);
    return r;
  }
}
