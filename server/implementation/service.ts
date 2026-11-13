/**
 * Implantación asistida: circuito genérico para vender una solución que necesita preparación técnica antes de
 * habilitarse (sin aprovisionamiento inmediato). Orquesta lo que ya existe sin duplicarlo:
 *
 *   1-3  solicitud de la web (intake público) → lead → empresa, contacto y oportunidad (conversión del CRM)
 *   4-5  expediente con la solución solicitada y su responsable o cola
 *   6-7  propuesta: contrato del CRM en borrador con las condiciones y el plazo ESCRITOS POR UNA PERSONA
 *   8-9  aceptación del cliente = contrato firmado (firma registrada o aceptación electrónica existentes)
 *   10-11 orden de implantación con hitos y pendientes
 *   12   confirmación de que está técnicamente preparada (todos los hitos obligatorios hechos)
 *   13   habilitación: alta de la plataforma (aprovisionamiento idempotente) o la que ya tenía la empresa
 *   14   comunicación de la disponibilidad al cliente (bandeja de salida; MAIL_MODE decide si sale)
 *   15   inicio de la prueba (15 días desde la comunicación, nunca desde la solicitud) o de la suscripción pactada
 *        (modo sombra: sin cargos reales), con sus licencias, y el contrato pasa a activo.
 *
 * Idempotente: abrir, aceptar, confirmar «preparada», habilitar, comunicar o iniciar dos veces no duplica nada (cada
 * paso comprueba su estado y las escrituras van con versión; las operaciones de un expediente se serializan).
 * Nunca calcula plazos ni acepta por el cliente.
 */
import { opsLog } from "../_core/ops/log";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import type { Company, Contact, Contract, LeadRequest } from "../crm/types";
import {
  OPEN_IMPLEMENTATION,
  ImplementationDuplicateError,
  type ImplementationEventType,
  type ImplementationOrder,
  type ImplementationPatch,
  type ImplementationQuery,
  type ImplementationQueue,
  type ImplementationStatus,
  type ImplementationStore,
  type Milestone,
  type MilestoneKind,
  type StartMode,
} from "./store";
import { connectOverlap } from "../../shared/connectAssisted";
import { addonAssistedOf } from "../../shared/addonAssisted";
import { GENERIC_TEMPLATE, checklistEventDetail, checklistKeyOf, netCommitmentsText, sectionOf, templateFor } from "./templates";

export const ASSISTED_TRIAL_DAYS = 15;
const DAY = 86_400_000;
export const DEFAULT_QUEUE: ImplementationQueue = "implantacion";
/** Hitos de partida de toda orden de implantación (genéricos, sin fechas: las fija una persona si quiere). */
export const DEFAULT_MILESTONES: ReadonlyArray<{ title: string; kind: MilestoneKind }> = [
  { title: "Reunión de arranque con el cliente", kind: "milestone" },
  { title: "Configuración técnica del entorno", kind: "milestone" },
  { title: "Carga o migración de datos", kind: "milestone" },
  { title: "Formación del equipo del cliente", kind: "milestone" },
  { title: "Validación del cliente", kind: "milestone" },
];
/** Circuitos de pago que abren solos el expediente de un producto Net (nadie paga sin implantación). */
export const PAID_CIRCUITS = ["panel_purchase", "trial_conversion", "public_checkout", "custom_terms", "order"] as const;
export type PaidCircuit = (typeof PAID_CIRCUITS)[number];
export const PAID_CIRCUIT_LABEL: Record<PaidCircuit, string> = {
  panel_purchase: "compra desde el panel",
  trial_conversion: "contratación desde la prueba",
  public_checkout: "contratación en la web",
  custom_terms: "condiciones personalizadas aceptadas",
  order: "pedido",
};
/** ¿Expediente abierto por un pago? (su suscripción ya existe: iniciarlo no crea otra). */
export const isPaidOrder = (o: Pick<ImplementationOrder, "requestSnapshot">) => (o.requestSnapshot as { source?: unknown } | null)?.source === "paid";
/** Tipos de solicitud de la web que pueden pedir una solución asistida. */
const INTAKE_TYPES = new Set(["module_info", "extension_info", "configuration", "onboarding"]);

export class ImplementationError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_state" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ImplementationError";
  }
}

export interface Assignee {
  id: string;
  name: string;
}
/** Solución del catálogo publicado. `mode`: modalidad de la oferta (`catalog.offer`), o null si aún no existe. */
export interface SolutionInfo {
  key: string;
  name: string;
  mode: "assisted" | "immediate" | null;
  commercialStatus: string | null;
}
export interface PlatformPort {
  activate(input: { contract: Contract; company: Company; contact: Contact | null }): Promise<{ tenantId: string }>;
}
/** Inicio de la prueba o de la suscripción pactada: suscripción del contrato (modo sombra) y sus licencias. */
export interface StartPort {
  start(input: { companyId: number; contract: Contract; tenantId: string; solutionKey: string; trialDays: number; reason: string }, actor: string): Promise<{ subscriptionId: number; trialEndsAt: number | null }>;
}
export interface AvailabilityNotice {
  orderId: number;
  reference: string;
  tenantId: string;
  companyName: string;
  solutionName: string;
  domain: string | null;
  /** Enlace para definir la contraseña si el administrador aún no la tiene; null si ya entró. */
  inviteToken: string | null;
  startMode: StartMode;
  trialEndsAt: number | null;
}
export type AvailabilityNotifier = (to: string, n: AvailabilityNotice) => Promise<{ queued: boolean }>;

export interface ImplementationDeps {
  store: ImplementationStore;
  crm: CrmService;
  crmStore: CrmStore;
  solution: (key: string) => Promise<SolutionInfo | null>;
  platform?: PlatformPort | null;
  starter?: StartPort | null;
  notify?: AvailabilityNotifier | null;
  /** Invitación nueva del administrador si aún no definió su contraseña (null si ya entró). */
  reissueInvite?: ((tenantId: string) => Promise<string | null>) | null;
  platformDomain?: string | null;
  assignees?: (() => Promise<Assignee[]>) | null;
  /** Marca la solicitud de la web como atendida al abrir el expediente. */
  markAttended?: ((leadRequestId: number, actor: string) => Promise<unknown>) | null;
  /**
   * Paquete personalizado de la contratación asistida (clase B, 11/11/2026): borrador de condiciones personalizadas
   * (server/commercialTerms) con el plan Core si la empresa no lo tiene, el producto Net a su precio publicado y los
   * compromisos de implantación como condiciones especiales. El operador lo revisa y lo envía a aceptación.
   */
  packages?: PackagePort | null;
  now?: () => number;
}

/** Lo que la implantación usa de las condiciones personalizadas y del catálogo publicado (sin duplicarlos). */
export interface PackagePort {
  /** Productos publicados con sus precios aprobados. */
  offer(): Promise<Array<{ key: string; name: string; family: string; prices: Array<{ id: number; kind: string; status: string; amountCents?: number }> }>>;
  /**
   * Suscripción SaaS viva de la empresa (de pago, no en prueba, con plan Core vigente) o null. Con ella, la contratación
   * es un ACUERDO NUEVO sobre esa suscripción (nunca una segunda suscripción); sin ella (o en prueba), un paquete nuevo.
   */
  liveSubscription(companyId: number): Promise<number | null>;
  /** Punto de partida de un acuerdo nuevo sobre la suscripción: el acuerdo en vigor o sus partidas contratadas. */
  subscriptionBase?(subscriptionId: number): Promise<SubscriptionBase>;
  createForSubscription?(subscriptionId: number, input: Record<string, unknown>, actor: string): Promise<{ id: number; status: string }>;
  create(companyId: number, input: PackageDraftInput, actor: string): Promise<{ id: number; status: string }>;
  get(id: number): Promise<{ id: number; status: string; companyId: number } | null>;
  /** Acuerdos de la empresa (para no preparar una segunda oferta del mismo producto). */
  ofCompany?(companyId: number): Promise<Array<{ id: number; status: string; companyId: number; acceptanceStatus: string; productKeys: string[] }>>;
}
/** Lo que se usa de `CommercialTermsService.base` (sin depender de sus tipos). */
export interface SubscriptionBase {
  interval: "month" | "year";
  input: { pricingMode: string; globalAmountCents?: number | null; conditions?: string | null; lines: Array<{ productKey?: string | null } & Record<string, unknown>> } & Record<string, unknown>;
}
const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
/** Estados de un acuerdo que siguen siendo una oferta viva o un contrato en vigor (no se prepara otro). */
const LIVE_TERMS = new Set(["draft", "pending_acceptance", "scheduled", "active"]);
export interface PackageDraftInput {
  pricingMode: "per_item";
  presentation: "breakdown";
  packageName: string;
  conditions: string;
  interval: "month";
  requiresAcceptance: true;
  lines: Array<{ kind: "catalog"; productKey: string; priceId: number; quantity: number }>;
  reason: string;
}

const clean = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const message = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);
const DONE_OR_LATER: Record<string, readonly ImplementationStatus[]> = {
  accepted: ["accepted", "ready", "enabled", "available", "started"],
  ready: ["ready", "enabled", "available", "started"],
  enabled: ["enabled", "available", "started"],
  available: ["available", "started"],
  started: ["started"],
};
const EDITABLE_MILESTONES: readonly ImplementationStatus[] = ["requested", "proposal", "accepted"];

export class ImplementationService {
  private now: () => number;
  private chains = new Map<number, Promise<unknown>>();
  constructor(private d: ImplementationDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Serializa las operaciones de un mismo expediente dentro del proceso (las de otros procesos las frena la versión). */
  private serial<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const mine = prev.then(fn, fn);
    const tail = mine.catch(() => undefined);
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return mine;
  }

  async must(id: number): Promise<ImplementationOrder> {
    const o = await this.d.store.get(id);
    if (!o) throw new ImplementationError("not_found", "Expediente de implantación no encontrado");
    return o;
  }

  private async event(orderId: number, type: ImplementationEventType, actor: string, detail: string | null = null) {
    await this.d.store.addEvent({ orderId, at: this.now(), actor: actor.slice(0, 100), type, detail: detail?.slice(0, 2000) ?? null });
  }

  /** Cambio con versión: si otro proceso lo cambió, conflicto (se reintenta desde el CRM). */
  private async patch(o: ImplementationOrder, patch: ImplementationPatch): Promise<ImplementationOrder> {
    const upd = await this.d.store.update(o.id, o.version, patch, this.now());
    if (!upd) throw new ImplementationError("conflict", "El expediente cambió mientras tanto: vuelve a cargarlo");
    return upd;
  }

  private async crmNote(o: ImplementationOrder, text: string, actor: string) {
    const target = o.opportunityId ? (["opportunity", o.opportunityId] as const) : (["company", o.companyId] as const);
    await this.d.crm.log(target[0], target[1], "note", `Implantación ${o.reference}: ${text}`, actor).catch(() => undefined);
  }

  private async moveOpportunity(o: ImplementationOrder, to: "proposal" | "won", actor: string) {
    if (!o.opportunityId) return;
    const opp = await this.d.crmStore.get("opportunities", o.opportunityId);
    if (!opp || opp.stage === to || opp.stage === "won" || opp.stage === "lost") return;
    if (to === "proposal" && opp.stage === "negotiation") return;
    // La etapa comercial acompaña al expediente; si el pipeline no admite el salto, se queda como está
    await this.d.crm.moveStage(opp.id, to, actor).catch(() => undefined);
  }

  private async resolveAssignee(assigneeId: string | null | undefined): Promise<Assignee | null> {
    if (!assigneeId) return null;
    if (!this.d.assignees) return { id: assigneeId.slice(0, 100), name: assigneeId.slice(0, 160) };
    const a = (await this.d.assignees()).find((x) => x.id === assigneeId);
    if (!a) throw new ImplementationError("invalid_input", "El responsable no es un operador con permiso de edición del CRM");
    return a;
  }

  async assigneeOptions(): Promise<Assignee[]> {
    return this.d.assignees ? this.d.assignees() : [];
  }

  private async solutionOf(key: string): Promise<SolutionInfo> {
    const s = await this.d.solution(key).catch(() => null);
    return s ?? { key, name: key, mode: null, commercialStatus: null };
  }

  // ── 1-5 Solicitud, oportunidad y responsable ──────────────────────────────────

  /**
   * Abre el expediente de una solución. Desde una solicitud de la web (`leadRequestId`): convierte el lead si hace
   * falta (empresa y contacto creados o reutilizados, y oportunidad). Desde una oportunidad (`opportunityId`). La
   * solución sale de lo pedido si no se indica. Idempotente: la misma solicitud, o la misma empresa y solución con un
   * expediente abierto, devuelven el existente (`created: false`).
   */
  async open(
    input: { leadRequestId?: number; opportunityId?: number; solutionKey?: string; assigneeId?: string | null; queue?: ImplementationQueue | null },
    actor: string,
  ): Promise<{ order: ImplementationOrder; created: boolean }> {
    if (!input.leadRequestId === !input.opportunityId) throw new ImplementationError("invalid_input", "Indica la solicitud de la web o la oportunidad (una de las dos)");
    if (input.leadRequestId) {
      const existing = await this.d.store.byLeadRequest(input.leadRequestId);
      if (existing) return { order: existing, created: false };
    }
    const assignee = await this.resolveAssignee(input.assigneeId);
    let companyId: number;
    let opportunityId: number | null;
    let leadRequest: LeadRequest | null = null;
    let solutionKey = clean(input.solutionKey, 64);
    if (input.leadRequestId) {
      leadRequest = await this.d.crmStore.get("leadRequests", input.leadRequestId);
      if (!leadRequest) throw new ImplementationError("not_found", "Solicitud no encontrada");
      solutionKey ??= requestedSolution(leadRequest);
      if (!solutionKey) throw new ImplementationError("invalid_input", "La solicitud no indica la solución: elígela al abrir el expediente");
      const lead = await this.d.crmStore.get("leads", leadRequest.leadId);
      if (!lead) throw new ImplementationError("not_found", "Lead no encontrado");
      const sol = await this.solutionOf(solutionKey);
      if (lead.status === "converted" && lead.convertedCompanyId) {
        companyId = lead.convertedCompanyId;
        opportunityId = lead.convertedOpportunityId;
        if (!opportunityId) {
          const opp = await this.d.crm.createOpportunity({ companyId, title: `${sol.name} — implantación asistida`, ...(leadRequest.configuration?.plan ? { planId: leadRequest.configuration.plan } : {}) }, actor);
          opportunityId = opp.id;
        }
      } else {
        // Paso 2 y 3: contacto creado o relacionado y oportunidad (la conversión del CRM reutiliza empresa y contacto)
        const r = await this.d.crm.convertLead(lead.id, { opportunity: { title: `${sol.name} — implantación asistida`, ...(leadRequest.configuration?.plan ? { planId: leadRequest.configuration.plan } : {}) } }, actor);
        companyId = r.company.id;
        opportunityId = r.opportunity?.id ?? null;
      }
    } else {
      const opp = await this.d.crmStore.get("opportunities", input.opportunityId!);
      if (!opp) throw new ImplementationError("not_found", "Oportunidad no encontrada");
      if (!solutionKey) throw new ImplementationError("invalid_input", "Indica la solución solicitada");
      companyId = opp.companyId;
      opportunityId = opp.id;
    }
    const open = await this.d.store.openFor(companyId, solutionKey!);
    if (open) {
      // La solicitud que llega con un expediente ya abierto queda atendida por él: si se quedara pendiente, al cerrar
      // ese expediente bloquearía una contratación nueva de la empresa (server/commerce/panelRequests.ts)
      if (leadRequest && this.d.markAttended) await this.d.markAttended(leadRequest.id, actor).catch(() => undefined);
      return { order: open, created: false };
    }
    const sol = await this.solutionOf(solutionKey!);
    let order: ImplementationOrder;
    try {
      order = await this.d.store.create({
        companyId,
        opportunityId,
        leadRequestId: input.leadRequestId ?? null,
        solutionKey: sol.key,
        solutionName: sol.name.slice(0, 200),
        requestSnapshot: leadRequest ? { type: leadRequest.type, reference: leadRequest.reference, interest: leadRequest.interest, configuration: leadRequest.configuration } : null,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.name ?? null,
        queue: assignee ? (input.queue ?? null) : (input.queue ?? DEFAULT_QUEUE),
        createdBy: actor.slice(0, 100),
        createdAt: this.now(),
      });
    } catch (e) {
      // Carrera con otra apertura de lo mismo: se devuelve la que ganó
      if (!(e instanceof ImplementationDuplicateError)) throw e;
      const same = (input.leadRequestId ? await this.d.store.byLeadRequest(input.leadRequestId) : null) ?? (await this.d.store.openFor(companyId, sol.key));
      if (!same) throw new ImplementationError("conflict", "Ya existe un expediente para esa solicitud");
      return { order: same, created: false };
    }
    await this.event(order.id, "created", actor, `${sol.name}${sol.mode === "immediate" ? " (el catálogo la ofrece con alta inmediata)" : ""}${leadRequest ? ` · solicitud ${leadRequest.reference}` : ""}`);
    if (assignee || order.queue) await this.event(order.id, "assigned", actor, assignee ? `Responsable: ${assignee.name}` : `Cola: ${order.queue}`);
    await this.crmNote(order, `expediente abierto para ${sol.name}`, actor);
    if (leadRequest && this.d.markAttended) await this.d.markAttended(leadRequest.id, actor).catch(() => undefined);
    return { order, created: true };
  }

  /**
   * Solicitud nueva de la web: si pide una solución que el catálogo ofrece con implantación asistida, abre su
   * expediente en la cola por defecto. Nunca rompe la captación (los fallos solo se registran).
   */
  async fromIntake(r: LeadRequest): Promise<ImplementationOrder | null> {
    try {
      if (!INTAKE_TYPES.has(r.type)) return null;
      const key = requestedSolution(r);
      if (!key) return null;
      const sol = await this.d.solution(key).catch(() => null);
      const assisted = sol ? sol.mode === "assisted" || (sol.mode === null && sol.commercialStatus === "on_request") : false;
      if (!assisted) return null;
      return (await this.open({ leadRequestId: r.id, solutionKey: key }, "system:intake")).order;
    } catch (e) {
      opsLog("warn", "Implementation", "intake_failed", { leadRequestId: r.id, error: e instanceof Error ? e.name : "error" });
      return null;
    }
  }

  async assign(id: number, input: { assigneeId: string | null; queue?: ImplementationQueue | null }, actor: string) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (o.status === "started" || o.status === "cancelled") throw new ImplementationError("invalid_state", "El expediente está cerrado");
      const a = await this.resolveAssignee(input.assigneeId);
      const queue = input.queue === undefined ? o.queue : input.queue;
      if (o.assigneeId === (a?.id ?? null) && o.queue === queue) return o;
      const upd = await this.patch(o, { assigneeId: a?.id ?? null, assigneeName: a?.name ?? null, queue });
      await this.event(o.id, "assigned", actor, a ? `Responsable: ${a.name}${queue ? ` · cola ${queue}` : ""}` : queue ? `Sin responsable · cola ${queue}` : "Sin responsable");
      return upd;
    });
  }

  // ── 6-9 Propuesta, condiciones, plazo y aceptación ────────────────────────────

  /**
   * Propuesta o presupuesto: condiciones y plazo escritos por una persona, modalidad de arranque pactada y contrato
   * del CRM en borrador (se crea o se enlaza uno existente de la empresa). Mientras el contrato no esté firmado se
   * puede rehacer; el contrato enviado vuelve a borrador al cambiar sus condiciones (regla del CRM).
   */
  async prepareProposal(
    id: number,
    input: { conditions: string; timeline: string; startMode: StartMode; targetDate?: number | null; contractId?: number | null; planId?: string | null; billingInterval?: "month" | "year" | null; amountCents?: number | null },
    actor: string,
  ) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (o.status !== "requested" && o.status !== "proposal") throw new ImplementationError("invalid_state", `El expediente está «${o.status}»: la propuesta ya no se cambia`);
      const conditions = clean(input.conditions, 4000);
      const timeline = clean(input.timeline, 2000);
      if (!conditions || conditions.length < 20) throw new ImplementationError("invalid_input", "Escribe las condiciones de la propuesta (al menos 20 caracteres)");
      if (!timeline || timeline.length < 5) throw new ImplementationError("invalid_input", "Escribe el plazo de implantación acordado (lo fija una persona)");
      if (input.startMode !== "trial" && input.startMode !== "subscription") throw new ImplementationError("invalid_input", "Indica si arranca con prueba o con suscripción");
      if (input.targetDate !== undefined && input.targetDate !== null && (!Number.isInteger(input.targetDate) || input.targetDate <= 0)) throw new ImplementationError("invalid_input", "Fecha objetivo no válida");
      let contract: Contract | null = null;
      const wanted = input.contractId ?? o.contractId;
      if (wanted) {
        contract = await this.d.crmStore.get("contracts", wanted);
        if (!contract || contract.companyId !== o.companyId) throw new ImplementationError("invalid_input", "El contrato no pertenece a la empresa del expediente");
        if (contract.status === "cancelled") throw new ImplementationError("invalid_state", "El contrato está cancelado");
        if ((contract.status === "draft" || contract.status === "sent") && contract.conditions !== conditions) {
          contract = await this.d.crm.updateContract(contract.id, { conditions, reason: `Propuesta de implantación ${o.reference}` }, actor);
        }
      } else {
        const opp = o.opportunityId ? await this.d.crmStore.get("opportunities", o.opportunityId) : null;
        const planId = clean(input.planId, 64) ?? opp?.planId ?? null;
        if (!planId) throw new ImplementationError("invalid_input", "Indica el plan del contrato (la oportunidad no lo tiene)");
        contract = await this.d.crm.createContract(
          {
            companyId: o.companyId,
            ...(o.opportunityId ? { opportunityId: o.opportunityId } : {}),
            planId,
            modules: opp?.modules ?? [],
            conditions,
            billingInterval: input.billingInterval ?? "month",
            ...(input.amountCents !== undefined && input.amountCents !== null ? { amountCents: input.amountCents } : {}),
          },
          actor,
        );
      }
      const upd = await this.patch(o, { status: "proposal", contractId: contract.id, conditions, timeline, targetDate: input.targetDate ?? null, startMode: input.startMode, termsBy: actor.slice(0, 100), termsAt: this.now(), lastError: null });
      await this.event(o.id, "proposal", actor, `Contrato ${contract.reference ?? `#${contract.id}`} · arranque: ${input.startMode === "trial" ? `prueba de ${ASSISTED_TRIAL_DAYS} días desde la comunicación` : "suscripción"} · plazo: ${timeline}`);
      await this.moveOpportunity(upd, "proposal", actor);
      await this.crmNote(upd, `propuesta preparada (contrato ${contract.reference ?? `#${contract.id}`})`, actor);
      return upd;
    });
  }

  /**
   * Aceptación del cliente (pasos 8 y 9): se COMPRUEBA en el contrato (firmado o activo), nunca se acepta en su
   * nombre. Abre la orden de implantación con los hitos de partida. Idempotente.
   */
  async syncAcceptance(id: number, actor: string): Promise<{ order: ImplementationOrder; accepted: boolean }> {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (DONE_OR_LATER.accepted.includes(o.status)) return { order: o, accepted: true };
      if (o.status !== "proposal" || !o.contractId) return { order: o, accepted: false };
      const c = await this.d.crmStore.get("contracts", o.contractId);
      if (!c || (c.status !== "signed" && c.status !== "active")) return { order: o, accepted: false };
      const upd = await this.patch(o, { status: "accepted", acceptedAt: c.signedAt ?? this.now() });
      await this.event(o.id, "accepted", actor, `Contrato ${c.reference ?? `#${c.id}`} ${c.signatureMethod === "electronic" ? "aceptado electrónicamente" : "firmado"}${c.signatureRef ? ` (${c.signatureRef})` : ""}`);
      await this.seedChecklist(upd, actor);
      await this.moveOpportunity(upd, "won", actor);
      await this.crmNote(upd, "contrato aceptado: orden de implantación abierta", actor);
      return { order: upd, accepted: true };
    });
  }

  /**
   * Abre (idempotente) el expediente de un producto Net YA PAGADO: pedido activo (compra del panel, conversión de la
   * prueba, contratación en la web) o condiciones personalizadas aceptadas. Nadie paga sin implantación: el expediente
   * entra directamente «en implantación» (sin propuesta: ya está contratado) con la checklist de su solución, y al
   * iniciarlo se usa la suscripción pagada (no se crea otra). Las licencias siguen como siempre: este paso no las toca.
   * Si la empresa ya tiene un expediente de esa solución (abierto o iniciado), se devuelve ese.
   */
  async openPaid(
    input: { companyId: number; solutionKey: string; contractId: number | null; subscriptionId: number | null; circuit: PaidCircuit; reference: string },
    actor: string,
  ): Promise<{ order: ImplementationOrder; created: boolean }> {
    const key = clean(input.solutionKey, 64);
    if (!key || !Number.isInteger(input.companyId) || input.companyId <= 0) throw new ImplementationError("invalid_input", "Empresa o solución no válida");
    const same = async () => (await this.d.store.list({ companyId: input.companyId, limit: 500 })).find((o) => o.solutionKey === key && o.status !== "cancelled") ?? null;
    const reference = (clean(input.reference, 80) ?? "").replace(/\s+/g, " ");
    const what = `${PAID_CIRCUIT_LABEL[input.circuit]}${reference ? ` ${reference}` : ""}`;
    const existing = await same();
    // Un expediente de la contratación asistida aún sin contrato (clase B): el pago lo pone en implantación
    if (existing && input.contractId && (existing.status === "requested" || existing.status === "proposal")) {
      const order = await this.serial(existing.id, async () => {
        const cur = await this.must(existing.id);
        if (cur.status !== "requested" && cur.status !== "proposal") return cur;
        const at = this.now();
        const upd = await this.patch(cur, { status: "accepted", contractId: input.contractId, acceptedAt: at, startMode: "subscription", subscriptionId: input.subscriptionId, conditions: cur.conditions ?? `Contratado (${what}). Las condiciones son las del contrato.`, timeline: cur.timeline ?? "A acordar con el cliente en la reunión de arranque", termsBy: cur.termsBy ?? actor.slice(0, 100), termsAt: cur.termsAt ?? at, requestSnapshot: { ...(cur.requestSnapshot ?? {}), source: "paid", circuit: input.circuit, reference, contractId: input.contractId, subscriptionId: input.subscriptionId } });
        await this.event(cur.id, "paid", actor, `Contratado (${what}): contrato #${input.contractId}${input.subscriptionId ? ` · suscripción #${input.subscriptionId}` : ""}; orden de implantación abierta`);
        await this.seedChecklist(upd, actor);
        await this.moveOpportunity(upd, "won", actor);
        await this.crmNote(upd, `contratado (${what}): orden de implantación abierta`, actor);
        return upd;
      });
      return { order, created: false };
    }
    if (existing) return { order: existing, created: false };
    const sol = await this.solutionOf(key);
    let order: ImplementationOrder;
    try {
      order = await this.d.store.create({
        companyId: input.companyId,
        opportunityId: null,
        leadRequestId: null,
        solutionKey: sol.key,
        solutionName: sol.name.slice(0, 200),
        requestSnapshot: { source: "paid", circuit: input.circuit, reference, contractId: input.contractId, subscriptionId: input.subscriptionId },
        assigneeId: null,
        assigneeName: null,
        queue: DEFAULT_QUEUE,
        createdBy: actor.slice(0, 100),
        createdAt: this.now(),
      });
    } catch (e) {
      if (!(e instanceof ImplementationDuplicateError)) throw e;
      const won = await same();
      if (!won) throw new ImplementationError("conflict", "Ya existe un expediente de esa solución para la empresa");
      return { order: won, created: false };
    }
    // Condiciones personalizadas: contratado (su cobro tiene interruptor propio; no se dice «pagado»). Activación
    // inmediata (clase A): las licencias ya están activas y la implantación acompaña, sin bloquear el uso
    const word = input.circuit === "custom_terms" ? "contratado" : "pagado";
    await this.event(order.id, "created", actor, `${sol.name} · ${word} (${what}): ${sol.mode === "immediate" ? "licencias ya activas; puesta en marcha acompañada (no bloquea el uso)" : "implantación obligatoria antes de ponerlo en marcha"}`);
    await this.event(order.id, "assigned", actor, `Cola: ${order.queue}`);
    if (input.contractId) {
      const at = this.now();
      order = await this.patch(order, { status: "accepted", contractId: input.contractId, acceptedAt: at, startMode: "subscription", subscriptionId: input.subscriptionId, conditions: `${input.circuit === "custom_terms" ? "Contratado" : "Contratado y pagado"} (${what}). Las condiciones son las del contrato.`, timeline: "A acordar con el cliente en la reunión de arranque", termsBy: actor.slice(0, 100), termsAt: at });
      await this.event(order.id, "paid", actor, `Contrato #${input.contractId}${input.subscriptionId ? ` · suscripción #${input.subscriptionId}` : ""}: orden de implantación abierta sin propuesta (ya está contratado)`);
      await this.seedChecklist(order, actor);
    }
    await this.crmNote(order, `expediente abierto por la contratación de ${sol.name} (${what})`, actor);
    return { order, created: true };
  }

  /** Checklist de su solución en un expediente SIN hitos (los que ya tienen hitos los conservan). */
  private async seedChecklist(o: ImplementationOrder, actor: string) {
    if ((await this.d.store.milestones(o.id)).length) return;
    const t = templateFor(o.solutionKey);
    let position = 0;
    for (const m of t.items) await this.d.store.addMilestone({ orderId: o.id, kind: m.kind, title: m.title, required: m.required, assigneeId: o.assigneeId, assigneeName: o.assigneeName, dueAt: null, note: m.note ?? null, position: position++, createdBy: actor.slice(0, 100), createdAt: this.now() });
    await this.event(o.id, "checklist", actor, checklistEventDetail(t));
  }

  /**
   * Borrador del paquete personalizado de un producto Net (clase B) desde su expediente: plan Core si la empresa no lo
   * tiene (el de la oportunidad o Essential), el producto Net a su precio mensual publicado y las condiciones especiales
   * con la prestación y los compromisos de implantación (alcance, disponible hoy y EN IMPLANTACIÓN, nunca como
   * terminado), sacados del catálogo. Requiere aceptación del cliente. Idempotente: mientras el borrador siga sin
   * enviar se devuelve el mismo. Nada se cobra (el cobro de las condiciones personalizadas tiene su propio interruptor).
   */
  async preparePackage(id: number, actor: string): Promise<{ termsId: number; created: boolean }> {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (!this.d.packages) throw new ImplementationError("unavailable", "Las condiciones personalizadas no están disponibles en este entorno");
      if (o.status !== "requested" && o.status !== "proposal") throw new ImplementationError("invalid_state", "El expediente ya tiene el contrato aceptado: el paquete ya no se prepara desde aquí");
      if (isPaidOrder(o)) throw new ImplementationError("invalid_state", "Este expediente lo abrió una contratación ya hecha: no se prepara otro contrato");
      const commitments = netCommitmentsText(o.solutionKey);
      if (!commitments) throw new ImplementationError("invalid_input", "El paquete con compromisos de implantación es solo para los productos Net de empresa, los Connect de contratación asistida y las ampliaciones de capacidad");
      const prev = [...(await this.d.store.events(o.id))].reverse().find((e) => e.type === "package");
      const prevId = Number(/condiciones #(\d+)/.exec(prev?.detail ?? "")?.[1] ?? 0);
      if (prevId) {
        const t = await this.d.packages.get(prevId).catch(() => null);
        if (t && t.companyId === o.companyId && LIVE_TERMS.has(t.status)) return { termsId: t.id, created: false };
      }
      // Ampliación de capacidad (13/11/2026): se contrata por unidades, una más sobre las que ya tenga la empresa
      const addonOf = addonAssistedOf(o.solutionKey);
      const addon = !!addonOf;
      // Otra oferta viva (borrador, enviada, pendiente de aceptación o en vigor) del mismo producto para la empresa: esa.
      // De una ampliación, el acuerdo en vigor con sus unidades no cuenta (es el punto de partida); sí una oferta pendiente
      const other = this.d.packages.ofCompany ? (await this.d.packages.ofCompany(o.companyId)).filter((t) => t.companyId === o.companyId && LIVE_TERMS.has(t.status) && !(addon && (t.status === "active" || t.status === "scheduled")) && t.acceptanceStatus !== "rejected" && t.acceptanceStatus !== "expired" && t.productKeys.includes(o.solutionKey)).sort((a, b) => b.id - a.id)[0] : undefined;
      if (other) return { termsId: other.id, created: false };
      // Ampliación con OTRO acuerdo pendiente o programado en la empresa: los dos partirían de la misma base y el que se
      // aceptara después borraría la unidad del otro. Primero se resuelve ese (aceptarlo, retirarlo o ampliarlo en él)
      if (addon && this.d.packages.ofCompany) {
        const pending = (await this.d.packages.ofCompany(o.companyId)).find((t) => t.companyId === o.companyId && (t.status === "draft" || t.status === "pending_acceptance" || t.status === "scheduled") && t.acceptanceStatus !== "rejected" && t.acceptanceStatus !== "expired");
        if (pending) throw new ImplementationError("invalid_state", `La empresa tiene otro acuerdo sin cerrar (condiciones #${pending.id}): acéptalo, retíralo o añade ahí ${o.solutionName} antes de preparar otro`);
      }
      const offer = await this.d.packages.offer();
      const monthly = (key: string) => offer.find((p) => p.key === key)?.prices.find((x) => x.kind === "monthly" && x.status === "approved") ?? null;
      const product = offer.find((p) => p.key === o.solutionKey);
      const productPrice = monthly(o.solutionKey);
      if (!product || !productPrice) throw new ImplementationError("invalid_state", `«${o.solutionName}» no tiene precio mensual publicado: no se puede preparar el paquete`);
      const provision = `Prestación: el servicio se presta en la plataforma Big Elephant de la empresa, con las condiciones generales de contratación vigentes. Se pone en marcha cuando la implantación está completada (expediente ${o.reference}).`;
      const reason = `Contratación de ${product.name} con implantación asistida (expediente ${o.reference})`.slice(0, 500);
      // Con una suscripción SaaS viva: acuerdo nuevo sobre ELLA (lo que ya tiene + el Net), nunca una segunda suscripción
      const subscriptionId = await this.d.packages.liveSubscription(o.companyId);
      if (subscriptionId !== null) {
        if (!this.d.packages.subscriptionBase || !this.d.packages.createForSubscription) throw new ImplementationError("unavailable", "Las condiciones personalizadas sobre una suscripción no están disponibles en este entorno");
        const base = await this.d.packages.subscriptionBase(subscriptionId);
        // Una ampliación ya contratada no bloquea: el acuerdo nuevo lleva esa partida con una unidad más (el operador puede
        // cambiar las unidades en el CRM antes de enviarlo); cualquier otro producto no se contrata dos veces
        // Ampliación de otro plan (p. ej. usuarios Essential sobre una suscripción Business): no
        if (addonOf?.plans?.length) {
          const corePlan = base.input.lines.map((l) => l.productKey).find((k) => !!k && offer.some((p) => p.key === k && p.family === "core_plan"));
          if (corePlan && !addonOf.plans.includes(corePlan)) throw new ImplementationError("invalid_state", `${product.name} no es para el plan de la suscripción #${subscriptionId} (${corePlan})`);
        }
        const existing = addon ? base.input.lines.findIndex((l) => l.productKey === o.solutionKey) : -1;
        if (!addon && base.input.lines.some((l) => l.productKey === o.solutionKey)) throw new ImplementationError("invalid_state", `La suscripción #${subscriptionId} ya incluye ${product.name}`);
        // Paquete Connect sobre un componente que ya se paga (o al revés): sería cobrar dos veces lo mismo
        // (una ampliación no forma paquetes: su propia partida es la que se amplía, arriba)
        const overlap = addon ? undefined : base.input.lines.find((l) => !!l.productKey && connectOverlap(l.productKey, o.solutionKey));
        if (overlap) throw new ImplementationError("invalid_state", `La suscripción #${subscriptionId} ya incluye «${overlap.productKey}», que forma parte de ${product.name} (o al revés): se resuelve como sustitución, no con un segundo contrato`);
        const kind = base.interval === "year" ? "yearly" : "monthly";
        const price = product.prices.find((x) => x.kind === kind && x.status === "approved");
        if (!price) throw new ImplementationError("invalid_state", `«${product.name}» no tiene precio ${base.interval === "year" ? "anual" : "mensual"} publicado, y la suscripción #${subscriptionId} es ${base.interval === "year" ? "anual" : "mensual"}`);
        const amount = price.amountCents ?? 0;
        const period = base.interval === "year" ? "al año" : "al mes";
        // Cuota global pactada: se conserva tal cual y se le SUMA el precio publicado del Net (nunca se reparte ni se
        // rebaja en silencio); por partidas: el Net entra a su precio publicado y las demás no cambian
        const global = base.input.pricingMode === "global";
        const prevGlobal = base.input.globalAmountCents ?? 0;
        const prevUnits = existing >= 0 ? Math.max(1, Number(base.input.lines[existing].quantity ?? 1) || 1) : 0;
        const units = prevUnits + 1;
        const unitsText = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
        const pricing = existing >= 0
          ? global
            ? `Precio: la cuota global pactada (${eur(prevGlobal)} ${period}) se mantiene sin cambios y se le suma el precio publicado de una unidad más de ${product.name} (${eur(amount)} ${period}): cuota global de ${eur(prevGlobal + amount)} ${period}, IVA aparte. ${product.name}: ${unitsText(units)} (antes ${unitsText(prevUnits)}).`
            : `Precio: ${product.name} pasa de ${unitsText(prevUnits)} a ${unitsText(units)}, a su precio por unidad (${eur(amount)} ${period} cada una, IVA aparte); las demás partidas y sus precios pactados no cambian.`
          : global
            ? `Precio: la cuota global pactada (${eur(prevGlobal)} ${period}) se mantiene sin cambios y se le suma el precio publicado de ${product.name} (${eur(amount)} ${period}): cuota global de ${eur(prevGlobal + amount)} ${period}, IVA aparte.`
            : `Precio: ${product.name} se añade a su precio publicado (${eur(amount)} ${period}, IVA aparte); las demás partidas y sus precios pactados no cambian.`;
        const conditions = [base.input.conditions?.trim() || null, `Ampliación: ${product.name}${addon ? ` (${unitsText(units)})` : ""}, contratado sobre la suscripción en vigor.`, pricing, provision, commitments].filter(Boolean).join("\n\n");
        const lines = existing >= 0 ? base.input.lines.map((l, i) => (i === existing ? { ...l, quantity: units } : l)) : [...base.input.lines, { kind: "catalog", productKey: o.solutionKey, priceId: price.id, quantity: 1 }];
        const t = await this.d.packages.createForSubscription(subscriptionId, { ...base.input, ...(global ? { globalAmountCents: prevGlobal + amount } : {}), conditions: conditions.slice(0, 5000), requiresAcceptance: true, lines, reason }, actor);
        await this.event(o.id, "package", actor, `Acuerdo nuevo sobre la suscripción #${subscriptionId}: condiciones #${t.id} (borrador para revisar y enviar a aceptación)`);
        await this.crmNote(o, `ampliación preparada sobre la suscripción #${subscriptionId} (condiciones #${t.id})`, actor);
        return { termsId: t.id, created: true };
      }
      // Sin suscripción SaaS viva (o en prueba): paquete nuevo con el plan Core
      const lines: PackageDraftInput["lines"] = [];
      {
        const opp = o.opportunityId ? await this.d.crmStore.get("opportunities", o.opportunityId) : null;
        // Una ampliación va con un plan al que amplía (Usuario adicional Business → Business)
        const compatible = (k: string) => !addonOf?.plans?.length || addonOf.plans.includes(k);
        const planKey = [opp?.planId, "essential", ...(addonOf?.plans ?? [])].find((k) => !!k && compatible(k) && offer.some((p) => p.key === k && p.family === "core_plan" && !!monthly(k))) ?? null;
        if (!planKey) throw new ImplementationError("invalid_state", "No hay un plan Core con precio mensual publicado para incluirlo en el paquete");
        lines.push({ kind: "catalog", productKey: planKey, priceId: monthly(planKey)!.id, quantity: 1 });
      }
      lines.push({ kind: "catalog", productKey: o.solutionKey, priceId: productPrice.id, quantity: 1 });
      const conditions = [`Servicio contratado: ${product.name}, al precio publicado en el catálogo de Big Elephant (partidas de este acuerdo, IVA aparte).`, provision, commitments].join("\n\n");
      const t = await this.d.packages.create(o.companyId, { pricingMode: "per_item", presentation: "breakdown", packageName: `${product.name} con implantación`.slice(0, 160), conditions: conditions.slice(0, 5000), interval: "month", requiresAcceptance: true, lines, reason }, actor);
      await this.event(o.id, "package", actor, `Paquete personalizado: condiciones #${t.id} (borrador para revisar y enviar a aceptación)`);
      await this.crmNote(o, `paquete personalizado preparado (condiciones #${t.id})`, actor);
      return { termsId: t.id, created: true };
    });
  }

  // ── 10-11 Hitos y pendientes ──────────────────────────────────────────────────

  /** Hitos editables hasta «preparada»; las INCIDENCIAS, en cualquier momento salvo cancelado. */
  private assertEditable(o: ImplementationOrder, kind: MilestoneKind | undefined) {
    if (kind === "incidencia" ? o.status === "cancelled" : !EDITABLE_MILESTONES.includes(o.status)) throw new ImplementationError("invalid_state", kind === "incidencia" ? "El expediente está cancelado" : "Con la implantación ya preparada, los hitos no se cambian");
  }
  private async editable(id: number, kind?: MilestoneKind) {
    const o = await this.must(id);
    this.assertEditable(o, kind);
    return o;
  }
  private async ownMilestone(o: ImplementationOrder, milestoneId: number) {
    const m = await this.d.store.milestone(milestoneId);
    if (!m || m.orderId !== o.id) throw new ImplementationError("not_found", "Hito no encontrado");
    return m;
  }

  async addMilestone(id: number, input: { title: string; kind?: MilestoneKind; required?: boolean; assigneeId?: string | null; dueAt?: number | null; note?: string | null }, actor: string) {
    return this.serial(id, async () => {
      const o = await this.editable(id, input.kind);
      const title = clean(input.title, 200);
      if (!title || title.length < 3) throw new ImplementationError("invalid_input", input.kind === "incidencia" ? "Describe la incidencia" : "Escribe el hito o pendiente");
      const a = await this.resolveAssignee(input.assigneeId);
      const position = (await this.d.store.milestones(o.id)).reduce((m, x) => Math.max(m, x.position + 1), 0);
      const m = await this.d.store.addMilestone({ orderId: o.id, kind: input.kind ?? "milestone", title, required: input.required ?? true, assigneeId: a?.id ?? null, assigneeName: a?.name ?? null, dueAt: input.dueAt ?? null, note: clean(input.note, 1000), position, createdBy: actor.slice(0, 100), createdAt: this.now() });
      await this.event(o.id, "milestone_added", actor, `${KIND_TEXT[m.kind]}: ${m.title}${m.required ? "" : " (opcional)"}`);
      return m;
    });
  }

  async updateMilestone(id: number, milestoneId: number, input: { title?: string; required?: boolean; assigneeId?: string | null; dueAt?: number | null; note?: string | null }, actor: string) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      const m = await this.ownMilestone(o, milestoneId);
      this.assertEditable(o, m.kind);
      const patch: Parameters<ImplementationStore["updateMilestone"]>[1] = {};
      if (input.title !== undefined) {
        const t = clean(input.title, 200);
        if (!t || t.length < 3) throw new ImplementationError("invalid_input", "Escribe el hito o pendiente");
        patch.title = t;
      }
      if (input.required !== undefined) patch.required = input.required;
      if (input.assigneeId !== undefined) {
        const a = await this.resolveAssignee(input.assigneeId);
        patch.assigneeId = a?.id ?? null;
        patch.assigneeName = a?.name ?? null;
      }
      if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
      if (input.note !== undefined) patch.note = clean(input.note, 1000);
      if (!Object.keys(patch).length) return m;
      const upd = (await this.d.store.updateMilestone(m.id, patch, this.now()))!;
      await this.event(o.id, "milestone_updated", actor, upd.title);
      return upd;
    });
  }

  async setMilestoneDone(id: number, milestoneId: number, done: boolean, actor: string): Promise<Milestone> {
    return this.serial(id, async () => {
      const o = await this.must(id);
      const m = await this.ownMilestone(o, milestoneId);
      this.assertEditable(o, m.kind);
      if ((m.status === "done") === done) return m;
      const upd = (await this.d.store.updateMilestone(m.id, done ? { status: "done", doneAt: this.now(), doneBy: actor.slice(0, 100) } : { status: "open", doneAt: null, doneBy: null }, this.now()))!;
      await this.event(o.id, done ? "milestone_done" : "milestone_reopened", actor, upd.title);
      return upd;
    });
  }

  // ── 12-15 Preparada, habilitada, comunicada e iniciada ───────────────────────

  /** Paso 12: lo confirma una persona; exige todos los hitos obligatorios hechos. Idempotente. */
  async markReady(id: number, input: { note?: string | null }, actor: string) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (DONE_OR_LATER.ready.includes(o.status)) return o;
      if (o.status !== "accepted") throw new ImplementationError("invalid_state", "Solo se confirma una implantación con el contrato aceptado");
      const open = (await this.d.store.milestones(o.id)).filter((m) => m.required && m.status !== "done");
      if (open.length) throw new ImplementationError("invalid_state", `Faltan hitos obligatorios: ${open.map((m) => m.title).join(", ")}`);
      const upd = await this.patch(o, { status: "ready", readyAt: this.now(), readyBy: actor.slice(0, 100), lastError: null });
      await this.event(o.id, "ready", actor, clean(input.note, 1000) ?? "Técnicamente preparada");
      await this.crmNote(upd, "técnicamente preparada", actor);
      return upd;
    });
  }

  private async contractAndCompany(o: ImplementationOrder) {
    const contract = o.contractId ? await this.d.crmStore.get("contracts", o.contractId) : null;
    if (!contract) throw new ImplementationError("invalid_state", "El expediente no tiene contrato");
    if (contract.status !== "signed" && contract.status !== "active") throw new ImplementationError("invalid_state", "El contrato del expediente no está firmado");
    const company = await this.d.crmStore.get("companies", o.companyId);
    if (!company) throw new ImplementationError("not_found", "Empresa no encontrada");
    const contacts = (await this.d.crmStore.list("contacts", { companyId: company.id })).filter((x) => x.status !== "inactive" && x.email);
    const contact = contacts.find((x) => x.isPrimary) ?? contacts[0] ?? null;
    return { contract, company, contact };
  }

  private async failed(o: ImplementationOrder, step: string, e: unknown, actor: string): Promise<never> {
    const cur = (await this.d.store.get(o.id)) ?? o;
    await this.d.store.update(cur.id, cur.version, { lastError: `${step}: ${message(e)}`.slice(0, 300) }, this.now()).catch(() => null);
    await this.event(o.id, "step_failed", actor, `${step}: ${message(e)}`);
    if (e instanceof ImplementationError) throw e;
    throw new ImplementationError("conflict", `No se pudo completar «${step}»: ${message(e)}`);
  }

  /**
   * Paso 13: habilita el entorno. Sin plataforma, la crea (aprovisionamiento idempotente por tenant, sin enviar
   * ningún correo: la comunicación es el paso siguiente); con plataforma, se usa la que ya tiene la empresa (sus
   * módulos se licencian al iniciar). Idempotente.
   */
  async enable(id: number, actor: string) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (DONE_OR_LATER.enabled.includes(o.status)) return o;
      if (o.status !== "ready") throw new ImplementationError("invalid_state", "Primero confirma que la implantación está técnicamente preparada");
      const { contract, company, contact } = await this.contractAndCompany(o);
      let tenantId = company.tenantId;
      if (!tenantId) {
        if (!this.d.platform) throw new ImplementationError("unavailable", "El alta de plataformas no está configurada");
        if (!contact) throw new ImplementationError("invalid_state", "La empresa necesita un contacto activo con correo (será el administrador de la plataforma)");
        try {
          tenantId = (await this.d.platform.activate({ contract, company, contact })).tenantId;
        } catch (e) {
          return this.failed(o, "habilitar", e, actor);
        }
        await this.d.crmStore.update("companies", company.id, { tenantId, updatedAt: this.now() });
      }
      const upd = await this.patch(o, { status: "enabled", tenantId, enabledAt: this.now(), lastError: null });
      await this.event(o.id, "enabled", actor, `Plataforma ${tenantId}${company.tenantId ? " (ya existía)" : " (creada)"}`);
      await this.crmNote(upd, `habilitada en ${tenantId}`, actor);
      return upd;
    });
  }

  /**
   * Pasos 14 y 15: comunica al cliente que su entorno está disponible y, en la misma operación, inicia la prueba (15
   * días DESDE ESTA COMUNICACIÓN) o la suscripción pactada. Si el inicio falla, la comunicación queda registrada y
   * `start` lo reintenta sin volver a avisar. Idempotente.
   */
  async communicate(id: number, actor: string) {
    const o = await this.serial(id, async () => {
      const cur = await this.must(id);
      if (DONE_OR_LATER.available.includes(cur.status)) return cur;
      if (cur.status !== "enabled") throw new ImplementationError("invalid_state", "Primero habilita el entorno");
      if (!this.d.notify) throw new ImplementationError("unavailable", "El correo de la plataforma no está configurado");
      const { company, contact } = await this.contractAndCompany(cur);
      if (!contact?.email) throw new ImplementationError("invalid_state", "La empresa no tiene un contacto activo con correo al que comunicarlo");
      const at = this.now();
      const trialEndsAt = cur.startMode === "trial" ? at + ASSISTED_TRIAL_DAYS * DAY : null;
      const inviteToken = this.d.reissueInvite ? await this.d.reissueInvite(cur.tenantId!).catch(() => null) : null;
      let queued = false;
      try {
        ({ queued } = await this.d.notify(contact.email, {
          orderId: cur.id,
          reference: cur.reference,
          tenantId: cur.tenantId!,
          companyName: company.name,
          solutionName: cur.solutionName,
          domain: this.d.platformDomain ? `${cur.tenantId}.${this.d.platformDomain}` : null,
          inviteToken,
          startMode: cur.startMode ?? "subscription",
          trialEndsAt,
        }));
      } catch (e) {
        return this.failed(cur, "comunicar", e, actor);
      }
      const upd = await this.patch(cur, { status: "available", communicatedAt: at, trialEndsAt, lastError: null });
      await this.event(cur.id, "communicated", actor, `Disponibilidad comunicada a ${contact.name ?? "el contacto principal"}${queued ? "" : " (la bandeja de salida no la envía en este entorno)"}`);
      await this.crmNote(upd, "disponibilidad comunicada al cliente", actor);
      return upd;
    });
    return o.status === "available" ? this.start(id, actor) : o;
  }

  /** Paso 15: prueba (desde la comunicación) o suscripción pactada, licencias y contrato activo. Idempotente. */
  async start(id: number, actor: string) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (o.status === "started") return o;
      if (o.status !== "available") throw new ImplementationError("invalid_state", "Primero comunica al cliente que su entorno está disponible");
      // Expediente de un pago: la suscripción pagada ya existe (no se crea otra ni se tocan sus licencias)
      const paid = isPaidOrder(o) && o.subscriptionId !== null;
      if (!paid && !this.d.starter) throw new ImplementationError("unavailable", "Las suscripciones no están configuradas");
      const { contract } = await this.contractAndCompany(o);
      const trialDays = o.startMode === "trial" ? Math.max(1, Math.ceil(((o.trialEndsAt ?? this.now() + ASSISTED_TRIAL_DAYS * DAY) - this.now()) / DAY)) : 0;
      let r: { subscriptionId: number; trialEndsAt: number | null };
      try {
        r = paid ? { subscriptionId: o.subscriptionId!, trialEndsAt: null } : await this.d.starter!.start({ companyId: o.companyId, contract, tenantId: o.tenantId!, solutionKey: o.solutionKey, trialDays, reason: `Implantación ${o.reference}` }, actor);
      } catch (e) {
        return this.failed(o, "iniciar", e, actor);
      }
      // El contrato pasa a activo con la plataforma ya creada (el alta es idempotente y no vuelve a invitar)
      if (!paid && contract.status === "signed") {
        await this.d.crm.setContractStatus(contract.id, "active", actor).catch((e) => this.event(o.id, "step_failed", actor, `activar el contrato: ${message(e)}`));
      }
      const upd = await this.patch(o, { status: "started", subscriptionId: r.subscriptionId, startedAt: this.now(), trialEndsAt: o.startMode === "trial" ? (o.trialEndsAt ?? r.trialEndsAt) : null, lastError: null });
      await this.event(o.id, "started", actor, o.startMode === "trial" ? `Prueba de ${ASSISTED_TRIAL_DAYS} días hasta ${new Date(upd.trialEndsAt ?? 0).toISOString().slice(0, 10)} · suscripción #${r.subscriptionId}` : `Suscripción #${r.subscriptionId} iniciada`);
      await this.crmNote(upd, o.startMode === "trial" ? "prueba iniciada" : "suscripción iniciada", actor);
      return upd;
    });
  }

  async cancel(id: number, input: { reason: string }, actor: string) {
    return this.serial(id, async () => {
      const o = await this.must(id);
      if (o.status === "cancelled") return o;
      if (o.status === "started") throw new ImplementationError("invalid_state", "Una implantación iniciada no se cancela aquí: gestiona la suscripción o el contrato");
      const reason = clean(input.reason, 500);
      if (!reason || reason.length < 5) throw new ImplementationError("invalid_input", "Indica el motivo de la cancelación");
      const upd = await this.patch(o, { status: "cancelled", cancelledAt: this.now(), cancelReason: reason });
      await this.event(o.id, "cancelled", actor, reason);
      await this.crmNote(upd, `cancelada: ${reason}`, actor);
      return upd;
    });
  }

  async addNote(id: number, text: string, actor: string) {
    const o = await this.must(id);
    const t = clean(text, 2000);
    if (!t) throw new ImplementationError("invalid_input", "Escribe la nota");
    await this.event(o.id, "note", actor, t);
    return (await this.d.store.events(o.id)).at(-1)!;
  }

  // ── Lectura ───────────────────────────────────────────────────────────────────

  list(q: ImplementationQuery) {
    return this.d.store.list(q);
  }

  async detail(id: number) {
    const order = await this.must(id);
    const contract = order.contractId ? await this.d.crmStore.get("contracts", order.contractId) : null;
    const company = await this.d.crmStore.get("companies", order.companyId);
    const opportunity = order.opportunityId ? await this.d.crmStore.get("opportunities", order.opportunityId) : null;
    const milestones = await this.d.store.milestones(order.id);
    const events = await this.d.store.events(order.id);
    // Plantilla aplicada (la que consta en el historial); sin ella, hitos anteriores a las plantillas o aún sin hitos
    const appliedKey = checklistKeyOf([...events].reverse().find((e) => e.type === "checklist")?.detail ?? null);
    const applied = appliedKey ? (appliedKey === GENERIC_TEMPLATE.key ? GENERIC_TEMPLATE : templateFor(appliedKey)) : null;
    const suggested = templateFor(order.solutionKey);
    const snap = order.requestSnapshot as { source?: string; circuit?: string; reference?: string } | null;
    return {
      order,
      milestones: milestones.map((m) => ({ ...m, section: sectionOf(m) })),
      events,
      checklist: applied
        ? { key: applied.key, name: applied.name, generic: applied.generic, applied: true }
        : { key: milestones.length ? null : suggested.key, name: milestones.length ? "Hitos propios del expediente (anteriores a las plantillas)" : `${suggested.name} (se aplica al aceptarse el contrato)`, generic: milestones.length ? true : suggested.generic, applied: false },
      // `billed`: hubo cobro (no en condiciones personalizadas, cuyo cobro tiene su propio interruptor)
      paid: snap?.source === "paid" ? { circuit: snap.circuit ?? null, reference: snap.reference ?? null, billed: snap.circuit !== "custom_terms" } : null,
      company: company ? { id: company.id, name: company.name, tenantId: company.tenantId } : null,
      opportunity: opportunity ? { id: opportunity.id, title: opportunity.title, stage: opportunity.stage, owner: opportunity.owner } : null,
      contract: contract ? { id: contract.id, reference: contract.reference, status: contract.status, planId: contract.planId, signedAt: contract.signedAt, signatureMethod: contract.signatureMethod } : null,
      next: nextStep(order),
    };
  }
}

/** Solución pedida en una solicitud de la web: el interés, o la primera pieza de la configuración. */
export function requestedSolution(r: Pick<LeadRequest, "interest" | "configuration">): string | null {
  const k = r.interest ?? r.configuration?.industries?.[0] ?? r.configuration?.extensions?.[0] ?? null;
  return k && /^[a-z0-9][a-z0-9-]{0,63}$/.test(k) ? k : null;
}

/** Siguiente paso del circuito (texto para el CRM). */
export function nextStep(o: Pick<ImplementationOrder, "status">): string | null {
  const NEXT: Partial<Record<ImplementationStatus, string>> = {
    requested: "Preparar la propuesta con las condiciones y el plazo",
    proposal: "Esperar la aceptación del cliente (contrato firmado)",
    accepted: "Completar los hitos y confirmar que está técnicamente preparada",
    ready: "Habilitar el entorno",
    enabled: "Comunicar al cliente que está disponible (inicia la prueba o la suscripción)",
    available: "Iniciar la prueba o la suscripción pactada",
  };
  return NEXT[o.status] ?? null;
}

export const OPEN_STATUSES = OPEN_IMPLEMENTATION;
const KIND_TEXT: Record<MilestoneKind, string> = { milestone: "Hito", pending: "Pendiente", check: "Comprobación", incidencia: "Incidencia" };
