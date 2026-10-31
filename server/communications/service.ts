/**
 * Centro de envíos del CRM: circuito MANUAL de las plantillas que no tienen disparador automático.
 *
 *   Servicio:   product.update · ops.maintenance · ops.customer_incident · support.survey
 *   Comercial:  marketing.news · marketing.recommendation · marketing.campaign (exigen consentimiento por finalidad)
 *
 * Flujo: borrador (plantilla + contenido + destinatarios) → vista previa con el render real → elegibilidad por
 * destinatario (cada no elegible con su motivo) → confirmación del operador con el número EXACTO de elegibles que acaba
 * de ver → envío por lotes por la bandeja de salida de la plataforma.
 *
 * Garantías:
 *  - Nada sale solo: cada envío lo confirma un operador.
 *  - Comerciales: solo a contactos con consentimiento vigente para la finalidad de la plantilla y sin baja; se vuelve a
 *    comprobar justo antes de cada correo (una baja reciente manda). Llevan el enlace personal de baja en el pie y en
 *    la cabecera List-Unsubscribe (baja en un clic).
 *  - Idempotencia: los destinatarios se congelan al confirmar con clave única (envío, huella del correo) y cada correo
 *    va a la bandeja con la clave `comm:<envío>:r<destinatario>`. Repetir la confirmación, reanudar o dos réplicas no
 *    duplican ningún correo.
 *  - La política de correo manda (modo, buzones autorizados en sandbox, ámbito, supresiones y límites de la bandeja):
 *    este módulo no amplía a quién puede salir un correo. No añade franjas horarias propias.
 */
import crypto from "node:crypto";
import { z } from "zod";
import type { CrmStore } from "../crm/store";
import { COMPANY_STATUSES, CrmError, type Company, type CompanyStatus, type Contact } from "../crm/types";
import { extraTemplates as x } from "../mail/extraTemplates";
import { maskRecipient, normalizeEmail, recipientHash } from "../mail/policy";
import type { SendResult } from "../mail/service";
import type { MailCategory, MailContent, MailStatus } from "../mail/types";
import { CONSENT_PURPOSES, PURPOSE_LABEL, consentBlock, type ConsentPurpose, type ConsentRecord, type ConsentService } from "./consent";
import type { LinkSigner, UnsubscribeScope } from "./links";
import type { NewRecipient, RecipientRow, RecipientSource, SendRow, SendStore, StatusBreakdownRow } from "./store";

/** Empresa de la bandeja para los envíos del centro: separa sus límites por hora de los avisos transaccionales. */
export const COMMS_TENANT = "comunicaciones";
export const PLATFORM_TENANT = "platform";
export const PUBLIC_PATH = "/cp/v1/public/comunicaciones";
/** Máximo de destinatarios elegibles por envío (uno mayor se parte en varios). */
export const MAX_RECIPIENTS = 5000;
const BATCH = 100;

// ── Plantillas del centro ──
export type FieldType = "text" | "textarea" | "url" | "datetime" | "number" | "boolean" | "list" | "items";
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  max?: number;
  help?: string;
}
export type AudienceSource = "contacts" | "billing" | "tickets";
interface TemplateSpec {
  name: string;
  kind: "service" | "commercial";
  category: MailCategory;
  purpose: ConsentPurpose | null;
  sources: AudienceSource[];
  fields: FieldSpec[];
}
const URL_FIELD: FieldSpec = { key: "url", label: "Enlace del botón (https://…)", type: "url", required: true, max: 500 };
export const SEND_TEMPLATES = {
  "product.update": {
    name: "Actualización importante del producto",
    kind: "service",
    category: "service_notice",
    purpose: null,
    sources: ["contacts", "billing"],
    fields: [{ key: "title", label: "Título", type: "text", required: true, max: 120 }, { key: "points", label: "Puntos (uno por línea, máximo 6)", type: "list", required: true, max: 160 }, URL_FIELD],
  },
  "ops.maintenance": {
    name: "Mantenimiento programado",
    kind: "service",
    category: "service_notice",
    purpose: null,
    sources: ["contacts", "billing"],
    fields: [{ key: "start", label: "Inicio (hora de Madrid)", type: "datetime", required: true }, { key: "minutes", label: "Duración estimada (minutos)", type: "number", required: true }],
  },
  "ops.customer_incident": {
    name: "Incidencia técnica y resolución",
    kind: "service",
    category: "service_notice",
    purpose: null,
    sources: ["contacts", "billing"],
    fields: [{ key: "title", label: "Título", type: "text", required: true, max: 120 }, { key: "detail", label: "Detalle", type: "textarea", required: true, max: 1000 }, { key: "resolved", label: "Incidencia resuelta", type: "boolean", required: false }],
  },
  "support.survey": {
    name: "Encuesta de satisfacción",
    kind: "service",
    category: "survey",
    purpose: null,
    sources: ["tickets"],
    fields: [],
  },
  "marketing.news": {
    name: "Novedades y funcionalidades",
    kind: "commercial",
    category: "marketing",
    purpose: "newsletter",
    sources: ["contacts", "billing"],
    fields: [{ key: "intro", label: "Entradilla (opcional)", type: "textarea", required: false, max: 300 }, { key: "items", label: "Novedades (título | texto, una por línea, máximo 4)", type: "items", required: false, max: 200 }, URL_FIELD],
  },
  "marketing.recommendation": {
    name: "Recomendación personalizada de módulos",
    kind: "commercial",
    category: "marketing",
    purpose: "recommendations",
    sources: ["contacts", "billing"],
    fields: [{ key: "module", label: "Módulo recomendado", type: "text", required: true, max: 80 }, { key: "reason", label: "Por qué se lo recomendamos", type: "textarea", required: true, max: 400 }, URL_FIELD],
  },
  "marketing.campaign": {
    name: "Campaña promocional o lanzamiento",
    kind: "commercial",
    category: "marketing",
    purpose: "promotions",
    sources: ["contacts", "billing"],
    fields: [{ key: "title", label: "Título", type: "text", required: true, max: 120 }, { key: "text", label: "Texto", type: "textarea", required: true, max: 600 }, URL_FIELD],
  },
} as const satisfies Record<string, TemplateSpec>;
export type SendTemplateId = keyof typeof SEND_TEMPLATES;
export const SEND_TEMPLATE_IDS = Object.keys(SEND_TEMPLATES) as SendTemplateId[];
const templateEnum = z.enum(SEND_TEMPLATE_IDS as [SendTemplateId, ...SendTemplateId[]]);
export const isCommercial = (t: SendTemplateId) => SEND_TEMPLATES[t].kind === "commercial";

const https = z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "El enlace debe empezar por https://");
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const CONTENT_SCHEMAS = {
  "product.update": z.object({ title: text(3, 120), points: z.array(text(3, 160)).min(1).max(6), url: https }).strict(),
  "ops.maintenance": z.object({ start: z.number().int().positive(), minutes: z.number().int().min(5).max(1440) }).strict(),
  "ops.customer_incident": z.object({ title: text(3, 120), detail: text(10, 1000), resolved: z.boolean().default(false) }).strict(),
  "support.survey": z.object({}).strict(),
  "marketing.news": z.object({ intro: text(10, 300).optional(), items: z.array(z.object({ title: text(3, 80), text: text(3, 200) }).strict()).max(4).optional(), url: https }).strict(),
  "marketing.recommendation": z.object({ module: text(2, 80), reason: text(10, 400), url: https }).strict(),
  "marketing.campaign": z.object({ title: text(3, 120), text: text(10, 600), url: https }).strict(),
} satisfies Record<SendTemplateId, z.ZodTypeAny>;

const ids = z.array(z.number().int().positive()).max(5000).default([]);
export const audienceSchema = z
  .object({
    /** contacts: contactos del CRM · billing: correo de facturación de cada empresa · tickets: solicitantes de tickets resueltos. */
    source: z.enum(["contacts", "billing", "tickets"]),
    /** Selección explícita de empresas (vacía = todas las que pasen los demás filtros). */
    companyIds: ids,
    /** Selección explícita de contactos (solo `contacts`); si se indica, manda sobre los filtros de empresa. */
    contactIds: ids,
    companyStatus: z.array(z.enum(COMPANY_STATUSES as [CompanyStatus, ...CompanyStatus[]])).max(3).default([]),
    /** Solo empresas con plataforma (tenant) en servicio. */
    tenantsOnly: z.boolean().default(false),
    /** Plan contratado de la plataforma (implica tenant). */
    plans: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    primaryOnly: z.boolean().default(false),
    /** Encuesta: tickets resueltos en los últimos N días, o los tickets elegidos. */
    resolvedWithinDays: z.number().int().min(1).max(365).default(30),
    ticketIds: ids,
  })
  .strict();
export type Audience = z.infer<typeof audienceSchema>;

const draftSchema = z.object({ templateId: templateEnum, title: text(3, 160), content: z.unknown(), audience: audienceSchema }).strict();

// ── Puertos ──
export interface CommsMailer {
  send(tenantId: string | null, idempotencyKey: string, category: MailCategory, to: string, c: MailContent, o?: { deferOnRateLimit?: boolean }): Promise<SendResult>;
  status(outboxId: number): Promise<{ status: MailStatus; reason: string | null } | null>;
}
export interface SurveyTicket {
  id: number;
  tenantId: string;
  title: string;
  status: string;
  requester: string | null;
  resolvedAt: number | null;
}
export interface TicketSource {
  /** Tickets resueltos o cerrados desde `since`. */
  resolved(since: number): Promise<SurveyTicket[]>;
  get(id: number): Promise<SurveyTicket | null>;
}

// ── Elegibilidad ──
export const INELIGIBLE_REASONS = {
  no_email: "Sin correo",
  invalid_email: "Correo no válido",
  inactive_contact: "Contacto inactivo",
  duplicate: "Duplicado (mismo correo en este envío)",
  no_consent: "Sin consentimiento para esta finalidad",
  unsubscribed: "Dado de baja de esta finalidad",
  suppressed: "Suprimido (rebote, queja o baja en el proveedor)",
  already_surveyed: "Ya recibió la encuesta de este ticket",
  ticket_not_resolved: "El ticket ya no está resuelto",
} as const;
export type IneligibleReason = keyof typeof INELIGIBLE_REASONS;

interface Candidate {
  source: RecipientSource;
  contactId: number | null;
  companyId: number | null;
  companyName: string | null;
  tenantId: string | null;
  ticketId: number | null;
  label: string;
  email: string | null;
  rawEmail: string | null;
  contactActive: boolean;
}
export interface EligibilityRow {
  key: string;
  source: RecipientSource;
  contactId: number | null;
  companyId: number | null;
  ticketId: number | null;
  label: string;
  company: string | null;
  email: string | null;
  eligible: boolean;
  reason: IneligibleReason | null;
}
export interface EligibilityReport {
  total: number;
  eligible: number;
  ineligible: Partial<Record<IneligibleReason, number>>;
  rows: EligibilityRow[];
  truncated: boolean;
}

/** Contenido de muestra para la vista previa sin datos (el operador lo sustituye por el suyo). */
export function renderSend(templateId: SendTemplateId, content: unknown, links: { unsubscribeUrl?: string | null; surveyUrl?: string | null; ticketRef?: string | null; recipient?: string | null }): MailContent {
  switch (templateId) {
    case "product.update":
      return x.productUpdate(CONTENT_SCHEMAS["product.update"].parse(content));
    case "ops.maintenance":
      return x.maintenance(CONTENT_SCHEMAS["ops.maintenance"].parse(content));
    case "ops.customer_incident":
      return x.incident(CONTENT_SCHEMAS["ops.customer_incident"].parse(content));
    case "support.survey":
      CONTENT_SCHEMAS["support.survey"].parse(content);
      return x.survey({ ticketRef: links.ticketRef ?? "T-0000", url: links.surveyUrl ?? "https://www.bigelephant.es/soporte" });
    case "marketing.news": {
      const c = CONTENT_SCHEMAS["marketing.news"].parse(content);
      return x.news({ url: c.url, intro: c.intro ?? null, items: c.items ?? null, unsubscribeUrl: links.unsubscribeUrl ?? null, recipient: links.recipient ?? null });
    }
    case "marketing.recommendation":
      return x.recommendation({ ...CONTENT_SCHEMAS["marketing.recommendation"].parse(content), unsubscribeUrl: links.unsubscribeUrl ?? null, recipient: links.recipient ?? null });
    case "marketing.campaign":
      return x.campaign({ ...CONTENT_SCHEMAS["marketing.campaign"].parse(content), unsubscribeUrl: links.unsubscribeUrl ?? null, recipient: links.recipient ?? null });
  }
}

/** Contadores del historial a partir del estado del destinatario y del correo en la bandeja (webhooks incluidos). */
export interface SendCounters {
  total: number;
  ineligible: number;
  pending: number;
  queued: number;
  sent: number;
  delivered: number;
  bounced: number;
  error: number;
  skipped: number;
}
export function countersFrom(rows: StatusBreakdownRow[]): SendCounters {
  const c: SendCounters = { total: 0, ineligible: 0, pending: 0, queued: 0, sent: 0, delivered: 0, bounced: 0, error: 0, skipped: 0 };
  for (const r of rows) {
    c.total += r.n;
    if (r.recipientStatus === "pending") c.pending += r.n;
    else if (r.recipientStatus === "failed") c.error += r.n;
    else if (r.recipientStatus === "skipped" && !r.mailStatus) c.ineligible += r.n;
    else
      switch (r.mailStatus) {
        case "pending":
        case "sending":
        case null:
          c.queued += r.n;
          break;
        case "accepted":
          c.sent += r.n;
          break;
        case "delivered":
          c.delivered += r.n;
          break;
        case "soft_bounced":
        case "bounced":
        case "blocked":
        case "complained":
          c.bounced += r.n;
          break;
        case "failed":
          c.error += r.n;
          break;
        case "skipped":
          c.skipped += r.n;
          break;
      }
  }
  return c;
}

const KEY_RE = /^comm:\d+:r\d+:c(\d+):([a-z]+)$/;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export class CommunicationsService {
  private running = new Map<number, Promise<void>>();
  constructor(
    private d: {
      store: SendStore;
      crm: Pick<CrmStore, "get" | "list">;
      consents: ConsentService;
      signer: LinkSigner;
      /** Origen público del CRM (sirve /cp/v1), p. ej. https://admin.bigelephant.es. */
      publicOrigin: string;
      mailer: CommsMailer | null;
      /** Supresiones de la bandeja de la plataforma (rebotes duros, quejas, bajas del proveedor). */
      suppressed: (tenantId: string, recipientHash: string) => Promise<boolean>;
      tickets?: TicketSource | null;
      /** Plan contratado de la plataforma de una empresa (filtro por plan). */
      planOf?: (tenantId: string) => Promise<string | null>;
      now?: () => number;
      log?: (event: string, data: Record<string, unknown>) => void;
    },
  ) {}
  private get now() {
    return this.d.now?.() ?? Date.now();
  }
  get consents() {
    return this.d.consents;
  }
  get available() {
    return !!this.d.mailer;
  }

  // ── Enlaces públicos ──
  unsubscribeUrl(contactId: number, scope: UnsubscribeScope) {
    return `${this.d.publicOrigin}${PUBLIC_PATH}/baja?t=${this.d.signer.unsubscribeToken(contactId, scope)}`;
  }
  surveyUrl(ticketId: number) {
    return `${this.d.publicOrigin}${PUBLIC_PATH}/encuesta?t=${this.d.signer.surveyToken(ticketId)}`;
  }
  /** Cabeceras de baja (RFC 2369 y baja en un clic RFC 8058) de un correo comercial del centro. */
  headersFor(row: { category: string; idempotencyKey: string }): Record<string, string> | null {
    const m = row.category === "marketing" ? KEY_RE.exec(row.idempotencyKey) : null;
    if (!m || !(CONSENT_PURPOSES as readonly string[]).includes(m[2])) return null;
    return { "List-Unsubscribe": `<${this.unsubscribeUrl(Number(m[1]), m[2] as ConsentPurpose)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  }

  // ── Plantillas ──
  templates() {
    return SEND_TEMPLATE_IDS.map((id) => {
      const t: TemplateSpec = SEND_TEMPLATES[id];
      return { id, ...t, purposeLabel: t.purpose ? PURPOSE_LABEL[t.purpose] : null };
    });
  }

  /** Vista previa con la plantilla real (enlaces personales de muestra, que no abren nada). */
  preview(raw: unknown): MailContent {
    const p = z.object({ templateId: templateEnum, content: z.unknown() }).strict().parse(raw);
    return renderSend(p.templateId, p.content, { unsubscribeUrl: `${this.d.publicOrigin}${PUBLIC_PATH}/baja?t=muestra`, surveyUrl: `${this.d.publicOrigin}${PUBLIC_PATH}/encuesta?t=muestra`, ticketRef: "T-0000" });
  }

  // ── Envíos ──
  private parseDraft(raw: unknown) {
    const b = draftSchema.parse(raw);
    const content = CONTENT_SCHEMAS[b.templateId].parse(b.content) as Record<string, unknown>;
    if (!(SEND_TEMPLATES[b.templateId].sources as readonly string[]).includes(b.audience.source))
      throw new CrmError("invalid_input", b.templateId === "support.survey" ? "La encuesta solo se envía a los solicitantes de tickets resueltos" : "Esta plantilla no admite ese origen de destinatarios");
    if (b.audience.source !== "contacts" && b.audience.contactIds.length) throw new CrmError("invalid_input", "La selección de contactos solo vale con el origen «Contactos del CRM»");
    return { ...b, content };
  }

  async create(raw: unknown, actor: string) {
    const b = this.parseDraft(raw);
    return this.d.store.create({ templateId: b.templateId, title: b.title, content: b.content, audience: b.audience, createdBy: actor, createdAt: this.now });
  }

  async update(id: number, raw: unknown, expectedVersion: number) {
    const cur = await this.require(id);
    if (cur.status !== "draft") throw new CrmError("invalid_state", "Solo se puede modificar un borrador");
    const b = this.parseDraft(raw);
    const r = await this.d.store.update(id, expectedVersion, { templateId: b.templateId, title: b.title, content: b.content, audience: b.audience }, this.now, "draft");
    if (!r) throw new CrmError("conflict", "El envío ha cambiado: recárgalo");
    return r;
  }

  async cancel(id: number, expectedVersion: number) {
    const cur = await this.require(id);
    if (cur.status !== "draft") throw new CrmError("invalid_state", "Solo se puede descartar un borrador");
    const r = await this.d.store.update(id, expectedVersion, { status: "cancelled" }, this.now, "draft");
    if (!r) throw new CrmError("conflict", "El envío ha cambiado: recárgalo");
    return r;
  }

  async require(id: number) {
    const b = await this.d.store.get(id);
    if (!b) throw new CrmError("not_found", "Envío no encontrado");
    return b;
  }

  async list(limit = 50) {
    const rows = await this.d.store.list(limit);
    return Promise.all(rows.map(async (b) => ({ ...b, templateName: SEND_TEMPLATES[b.templateId as SendTemplateId]?.name ?? b.templateId, counters: b.status === "draft" || b.status === "cancelled" ? null : countersFrom(await this.d.store.breakdown(b.id)) })));
  }

  async detail(id: number) {
    const b = await this.require(id);
    return { send: { ...b, templateName: SEND_TEMPLATES[b.templateId as SendTemplateId]?.name ?? b.templateId }, counters: countersFrom(await this.d.store.breakdown(id)), running: this.running.has(id), preview: this.previewOf(b) };
  }

  private previewOf(b: SendRow): MailContent | null {
    try {
      return this.preview({ templateId: b.templateId, content: b.content });
    } catch {
      return null;
    }
  }

  // ── Destinatarios ──
  private async candidates(templateId: SendTemplateId, a: Audience): Promise<Candidate[]> {
    if (a.source === "tickets") return this.ticketCandidates(a);
    const allCompanies = await this.d.crm.list("companies");
    const plans = a.plans.length ? new Set(a.plans) : null;
    const companies: Company[] = [];
    for (const c of allCompanies) {
      if (a.companyIds.length && !a.companyIds.includes(c.id)) continue;
      if (a.companyStatus.length && !a.companyStatus.includes(c.status)) continue;
      if ((a.tenantsOnly || plans) && !c.tenantId) continue;
      if (plans && !(c.tenantId && this.d.planOf && plans.has((await this.d.planOf(c.tenantId).catch(() => null)) ?? ""))) continue;
      companies.push(c);
    }
    const byId = new Map(allCompanies.map((c) => [c.id, c]));
    const contacts = await this.d.crm.list("contacts");
    if (a.source === "billing") {
      const byEmail = new Map<string, Contact>();
      for (const k of contacts) {
        const e = normalizeEmail(k.email ?? "");
        if (e && k.status === "active" && !byEmail.has(e)) byEmail.set(e, k);
      }
      return companies.map((c) => {
        const email = normalizeEmail(c.billingEmail ?? "");
        const k = email ? byEmail.get(email) : undefined;
        return { source: "billing" as const, contactId: k?.id ?? null, companyId: c.id, companyName: c.name, tenantId: c.tenantId, ticketId: null, label: `Facturación de ${c.name}`, email, rawEmail: c.billingEmail, contactActive: true };
      });
    }
    const selected = a.contactIds.length
      ? contacts.filter((k) => a.contactIds.includes(k.id))
      : contacts.filter((k) => k.companyId !== null && companies.some((c) => c.id === k.companyId) && (!a.primaryOnly || k.isPrimary));
    return selected.map((k) => {
      const c = k.companyId !== null ? byId.get(k.companyId) : undefined;
      return { source: "contact" as const, contactId: k.id, companyId: c?.id ?? null, companyName: c?.name ?? null, tenantId: c?.tenantId ?? null, ticketId: null, label: k.name, email: normalizeEmail(k.email ?? ""), rawEmail: k.email, contactActive: k.status === "active" };
    });
  }

  private async ticketCandidates(a: Audience): Promise<Candidate[]> {
    if (!this.d.tickets) throw new CrmError("invalid_state", "Los tickets de soporte no están disponibles en este entorno");
    const since = this.now - a.resolvedWithinDays * 86_400_000;
    const companies = await this.d.crm.list("companies");
    const byTenant = new Map(companies.filter((c) => c.tenantId).map((c) => [c.tenantId!, c]));
    const allowedTenants = a.companyIds.length ? new Set(companies.filter((c) => a.companyIds.includes(c.id) && c.tenantId).map((c) => c.tenantId!)) : null;
    let list: SurveyTicket[];
    if (a.ticketIds.length) list = (await Promise.all(a.ticketIds.map((id) => this.d.tickets!.get(id)))).filter((t): t is SurveyTicket => !!t && (t.status === "resolved" || t.status === "closed"));
    else list = await this.d.tickets.resolved(since);
    return list
      .filter((t) => !allowedTenants || allowedTenants.has(t.tenantId))
      .map((t) => {
        const c = byTenant.get(t.tenantId);
        return { source: "ticket" as const, contactId: null, companyId: c?.id ?? null, companyName: c?.name ?? t.tenantId, tenantId: t.tenantId, ticketId: t.id, label: `Ticket T-${t.id}`, email: normalizeEmail(t.requester ?? ""), rawEmail: t.requester, contactActive: true };
      });
  }

  private async isSuppressed(email: string, tenantId: string | null) {
    const h = recipientHash(email);
    for (const t of Array.from(new Set([COMMS_TENANT, PLATFORM_TENANT, ...(tenantId ? [tenantId] : [])]))) if (await this.d.suppressed(t, h).catch(() => false)) return true;
    return false;
  }

  /** Elegibilidad de cada destinatario, con el motivo de los que no lo son. */
  private async evaluate(templateId: SendTemplateId, a: Audience): Promise<Array<{ c: Candidate; key: string; reason: IneligibleReason | null }>> {
    const t: TemplateSpec = SEND_TEMPLATES[templateId];
    const list = await this.candidates(templateId, a);
    const contactIds = Array.from(new Set(list.map((c) => c.contactId).filter((v): v is number => v !== null)));
    const consents: Map<number, ConsentRecord[]> = t.purpose ? await this.d.consents.recordsMany(contactIds) : new Map();
    const surveyed = templateId === "support.survey" ? await this.d.store.surveyedTickets(list.map((c) => c.ticketId!).filter(Boolean)) : new Set<number>();
    const seen = new Set<string>();
    const out: Array<{ c: Candidate; key: string; reason: IneligibleReason | null }> = [];
    for (const c of list) {
      const key = c.email ? recipientHash(c.email) : sha(`sin-correo:${c.source}:${c.contactId ?? c.companyId ?? c.ticketId}`);
      let reason: IneligibleReason | null = null;
      if (!c.email) reason = c.rawEmail && c.rawEmail.trim() ? "invalid_email" : "no_email";
      else if (!c.contactActive) reason = "inactive_contact";
      else if (seen.has(c.email)) reason = "duplicate";
      else if (t.purpose) reason = c.contactId === null ? "no_consent" : consentBlock(consents.get(c.contactId), t.purpose);
      if (!reason && c.ticketId !== null && surveyed.has(c.ticketId)) reason = "already_surveyed";
      if (!reason && (await this.isSuppressed(c.email!, c.tenantId))) reason = "suppressed";
      if (c.email && reason !== "duplicate") seen.add(c.email);
      // Un duplicado comparte huella con el elegible: su clave distingue la fila (nunca recibe correo)
      out.push({ c, key: reason === "duplicate" ? sha(`duplicado:${key}:${c.source}:${c.contactId ?? c.companyId ?? c.ticketId}`) : key, reason });
    }
    return out;
  }

  private report(rows: Array<{ c: Candidate; key: string; reason: IneligibleReason | null }>, limit = 1000): EligibilityReport {
    const ineligible: Partial<Record<IneligibleReason, number>> = {};
    for (const r of rows) if (r.reason) ineligible[r.reason] = (ineligible[r.reason] ?? 0) + 1;
    const sorted = [...rows].sort((p, q) => Number(!!q.reason) - Number(!!p.reason));
    return {
      total: rows.length,
      eligible: rows.filter((r) => !r.reason).length,
      ineligible,
      truncated: rows.length > limit,
      rows: sorted.slice(0, limit).map((r) => ({ key: r.key, source: r.c.source, contactId: r.c.contactId, companyId: r.c.companyId, ticketId: r.c.ticketId, label: r.c.label, company: r.c.companyName, email: r.c.email ? maskRecipient(r.c.email) : null, eligible: !r.reason, reason: r.reason })),
    };
  }

  async eligibility(id: number): Promise<EligibilityReport> {
    const b = await this.require(id);
    return this.report(await this.evaluate(b.templateId as SendTemplateId, audienceSchema.parse(b.audience)));
  }

  /** Elegibilidad de un borrador sin guardarlo (paso 3 del asistente). */
  async eligibilityOf(raw: unknown): Promise<EligibilityReport> {
    const b = this.parseDraft(raw);
    return this.report(await this.evaluate(b.templateId, b.audience));
  }

  /**
   * Confirmación del operador: comprueba el número exacto de elegibles que acaba de ver, congela los destinatarios y
   * lanza el envío por lotes. Repetirla no duplica nada: un envío ya confirmado se devuelve tal cual (y, si quedó a
   * medias, se reanuda con los pendientes).
   */
  async confirm(id: number, input: { expectedEligible: number; expectedVersion: number }, actor: string): Promise<{ send: SendRow; alreadyConfirmed: boolean }> {
    if (!this.d.mailer) throw new CrmError("invalid_state", "El correo de la plataforma no está disponible en este entorno");
    const b = await this.require(id);
    if (b.status === "cancelled") throw new CrmError("invalid_state", "El envío está descartado");
    if (b.status !== "draft") {
      if (b.status === "sending") this.start(id);
      return { send: b, alreadyConfirmed: true };
    }
    if (b.version !== input.expectedVersion) throw new CrmError("conflict", "El envío ha cambiado: revisa la vista previa y confirma de nuevo");
    const templateId = b.templateId as SendTemplateId;
    const content = CONTENT_SCHEMAS[templateId].parse(b.content);
    if (templateId === "ops.maintenance" && (content as { start: number }).start <= this.now) throw new CrmError("invalid_input", "La ventana de mantenimiento ya ha empezado: corrige la fecha");
    const rows = await this.evaluate(templateId, audienceSchema.parse(b.audience));
    const eligible = rows.filter((r) => !r.reason).length;
    if (!eligible) throw new CrmError("invalid_input", "No hay ningún destinatario elegible");
    if (eligible > MAX_RECIPIENTS) throw new CrmError("invalid_input", `Como mucho ${MAX_RECIPIENTS} destinatarios elegibles por envío`);
    if (eligible !== input.expectedEligible) throw new CrmError("conflict", `El número de destinatarios elegibles ha cambiado: ahora son ${eligible}. Revísalo y confirma de nuevo.`);
    const now = this.now;
    const started = await this.d.store.update(id, b.version, { status: "sending", recipientsCount: rows.length, eligibleCount: eligible, confirmedBy: actor.slice(0, 120), confirmedAt: now }, now, "draft");
    if (!started) {
      // Otra confirmación ganó la carrera: se devuelve su resultado
      const cur = await this.require(id);
      if (cur.status === "sending" || cur.status === "sent") return { send: cur, alreadyConfirmed: true };
      throw new CrmError("conflict", "El envío ha cambiado: recárgalo");
    }
    const recs: NewRecipient[] = rows.map((r) => ({
      recipientKey: r.key,
      source: r.c.source,
      contactId: r.c.contactId,
      companyId: r.c.companyId,
      tenantId: r.c.tenantId,
      ticketId: r.c.ticketId,
      label: r.c.label,
      emailMasked: r.c.email ? maskRecipient(r.c.email) : null,
      status: r.reason ? "skipped" : "pending",
      reason: r.reason,
    }));
    await this.d.store.addRecipients(id, recs, now);
    this.d.log?.("send_confirmed", { id, templateId, eligible, total: rows.length, actor });
    this.start(id);
    return { send: started, alreadyConfirmed: false };
  }

  /** Espera a que termine el envío en curso (pruebas y cierre ordenado). */
  async idle(id: number) {
    await this.running.get(id);
  }

  /** Reanuda los envíos que quedaron a medias (reinicio del servicio): solo los destinatarios pendientes. */
  async resumeAll() {
    for (const b of await this.d.store.list(50)) if (b.status === "sending") this.start(b.id);
  }

  private start(id: number) {
    if (this.running.has(id) || !this.d.mailer) return;
    const p = this.deliver(id)
      .catch((e) => this.d.log?.("send_error", { id, error: e instanceof Error ? e.name : "error" }))
      .finally(() => this.running.delete(id));
    this.running.set(id, p);
  }

  private async deliver(id: number) {
    const b = await this.require(id);
    const templateId = b.templateId as SendTemplateId;
    let after = 0;
    for (;;) {
      const batch = await this.d.store.recipients(id, { status: "pending", afterId: after, limit: BATCH });
      if (!batch.length) break;
      for (const r of batch) {
        after = r.id;
        await this.deliverOne(b, templateId, r);
      }
    }
    if ((await this.d.store.recipients(id, { status: "pending", limit: 1 })).length) return void this.d.log?.("send_incomplete", { id });
    const cur = await this.require(id);
    if (cur.status === "sending") await this.d.store.update(id, cur.version, { status: "sent", finishedAt: this.now }, this.now, "sending");
    this.d.log?.("send_finished", { id, ...countersFrom(await this.d.store.breakdown(id)) });
  }

  /** Dirección actual del destinatario (se relee del CRM o del ticket: nunca se guarda completa). */
  private async currentEmail(r: RecipientRow): Promise<{ email: string | null; reason: IneligibleReason | null }> {
    if (r.source === "contact") {
      const k = r.contactId ? await this.d.crm.get("contacts", r.contactId) : null;
      if (!k || k.status !== "active") return { email: null, reason: "inactive_contact" };
      return { email: normalizeEmail(k.email ?? ""), reason: null };
    }
    if (r.source === "billing") {
      const c = r.companyId ? await this.d.crm.get("companies", r.companyId) : null;
      return { email: normalizeEmail(c?.billingEmail ?? ""), reason: null };
    }
    const t = r.ticketId && this.d.tickets ? await this.d.tickets.get(r.ticketId) : null;
    if (!t || (t.status !== "resolved" && t.status !== "closed")) return { email: null, reason: "ticket_not_resolved" };
    return { email: normalizeEmail(t.requester ?? ""), reason: null };
  }

  private async deliverOne(b: SendRow, templateId: SendTemplateId, r: RecipientRow) {
    const t: TemplateSpec = SEND_TEMPLATES[templateId];
    const set = (status: RecipientRow["status"], reason: string | null, outboxId: number | null = null) => this.d.store.setRecipient(r.id, { status, reason, outboxId }, this.now);
    try {
      const cur = await this.currentEmail(r);
      if (cur.reason) return void (await set("skipped", cur.reason));
      // La dirección tiene que ser la misma que se revisó al confirmar
      if (!cur.email || recipientHash(cur.email) !== r.recipientKey) return void (await set("skipped", "email_changed"));
      // Las comerciales se vuelven a comprobar en el momento del envío (una baja reciente manda)
      if (t.purpose) {
        const block = r.contactId === null ? "no_consent" : consentBlock(await this.d.consents.records(r.contactId), t.purpose);
        if (block) return void (await set("skipped", block));
      }
      if (await this.isSuppressed(cur.email, r.tenantId)) return void (await set("skipped", "suppressed"));
      const content = renderSend(templateId, b.content, {
        unsubscribeUrl: t.purpose && r.contactId ? this.unsubscribeUrl(r.contactId, t.purpose) : null,
        surveyUrl: r.ticketId ? this.surveyUrl(r.ticketId) : null,
        ticketRef: r.ticketId ? `T-${r.ticketId}` : null,
        recipient: cur.email,
      });
      const key = t.purpose ? `comm:${b.id}:r${r.id}:c${r.contactId}:${t.purpose}` : `comm:${b.id}:r${r.id}`;
      const res = await this.d.mailer!.send(COMMS_TENANT, key, t.category, cur.email, content, { deferOnRateLimit: true });
      await set(res.status === "skipped" ? "skipped" : res.status === "failed" ? "failed" : "queued", res.reason, res.id);
    } catch (e) {
      this.d.log?.("send_recipient_error", { id: b.id, recipient: r.id, error: e instanceof Error ? e.name : "error" });
      await set("failed", "error");
    }
  }

  /** Destinatarios congelados con el estado de su correo en la bandeja (entregado, rebotado…). */
  async recipients(id: number, q: { afterId?: number; limit?: number; status?: RecipientRow["status"] } = {}) {
    await this.require(id);
    const rows = await this.d.store.recipients(id, { afterId: q.afterId, status: q.status, limit: Math.min(200, q.limit ?? 100) });
    return Promise.all(
      rows.map(async (r) => {
        const mail = r.outboxId && this.d.mailer ? await this.d.mailer.status(r.outboxId).catch(() => null) : null;
        const company = r.companyId ? await this.d.crm.get("companies", r.companyId) : null;
        return { ...r, recipientKey: undefined, company: company?.name ?? null, mailStatus: mail?.status ?? null, mailReason: mail?.reason ?? null };
      }),
    );
  }

  /** Respuestas de la encuesta (de un envío o todas): media, reparto y comentarios. */
  async responses(sendId: number | null) {
    const rows = await this.d.store.responses(sendId, 1000);
    const distribution = [1, 2, 3, 4, 5].map((n) => rows.filter((r) => r.rating === n).length);
    const companies = await this.d.crm.list("companies");
    const byTenant = new Map(companies.filter((c) => c.tenantId).map((c) => [c.tenantId!, c.name]));
    return {
      count: rows.length,
      average: rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null,
      distribution,
      items: rows.slice(0, 200).map((r) => ({ ...r, ticketRef: `T-${r.ticketId}`, company: r.tenantId ? (byTenant.get(r.tenantId) ?? r.tenantId) : null })),
    };
  }

  // ── Páginas públicas ──
  unsubscribeTarget(token: unknown) {
    return this.d.signer.verifyUnsubscribe(token);
  }
  async unsubscribe(token: unknown, o: { all: boolean; channel: "link" | "one_click"; ip: string | null }) {
    const t = this.d.signer.verifyUnsubscribe(token);
    if (!t || !(await this.d.crm.get("contacts", t.contactId))) return null;
    const purposes = o.all || t.scope === "all" ? CONSENT_PURPOSES : [t.scope];
    const ipHash = o.ip ? sha(`comm-ip:${o.ip}`).slice(0, 16) : null;
    const r = await this.d.consents.unsubscribe(t.contactId, purposes, { channel: o.channel, ipHash });
    this.d.log?.("unsubscribed", { contactId: t.contactId, purposes: r.changed, channel: o.channel });
    return { purposes, changed: r.changed };
  }

  private async surveyTicket(token: unknown) {
    const ticketId = this.d.signer.verifySurvey(token);
    if (!ticketId || !this.d.tickets) return null;
    return this.d.tickets.get(ticketId);
  }
  async surveyView(token: unknown) {
    const t = await this.surveyTicket(token);
    if (!t) return null;
    const prev = await this.d.store.getResponse(t.id);
    return { ticketRef: `T-${t.id}`, rating: prev?.rating ?? null, comment: prev?.comment ?? null };
  }
  async surveySubmit(token: unknown, raw: unknown) {
    const t = await this.surveyTicket(token);
    if (!t) return null;
    const v = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }).parse(raw);
    const sendId = await this.d.store.latestSendForTicket(t.id);
    await this.d.store.saveResponse({ ticketId: t.id, tenantId: t.tenantId, sendId, rating: v.rating, comment: v.comment || null, createdAt: this.now }, this.now);
    return { ticketRef: `T-${t.id}` };
  }
}
