/**
 * Solicitudes de derechos de protección de datos (RGPD), registradas desde el CRM cuando llegan por cualquier canal
 * (correo, web, teléfono, correo postal). Plazo legal de respuesta: 30 días desde la recepción (art. 12.3 RGPD).
 *
 * Cada cambio (alta, estado, responsable, nota, escalada) deja un evento en el historial con quién lo hizo.
 *
 * Alertas administrativas (`admin.data_request`):
 *  - al registrarse, una vez por solicitud;
 *  - si quedan 7 días o menos del plazo sin resolver, una escalada crítica;
 *  - si vence el plazo sin resolver, otra (hecho distinto).
 * La alerta nunca rompe el registro: `raise` no lanza y se llama después de guardar.
 */
import { z } from "zod";
import { opsLog } from "../_core/ops/log";
import type { AlertFacts } from "../adminAlerts/catalog";
import { dateTime } from "../adminAlerts/templates";
import { CrmError } from "../crm/types";
import { ROLE_SCOPES, isRole } from "../controlPlane/operatorRoles";
import {
  DATA_REQUEST_CHANNELS,
  DATA_REQUEST_KINDS,
  KIND_LABEL,
  OPEN_STATUSES,
  type DataRequest,
  type DataRequestEvent,
  type DataRequestEventType,
  type DataRequestQuery,
  type DataRequestStatus,
  type DataRequestStore,
} from "./store";

export const LEGAL_DEADLINE_DAYS = 30;
export const WARN_DAYS = 7;
const DAY = 24 * 3600_000;

export const STATUS_LABEL: Record<DataRequestStatus, string> = { received: "Recibida", in_progress: "En curso", resolved: "Resuelta", rejected: "Rechazada" };

export const registerSchema = z
  .object({
    kind: z.enum(DATA_REQUEST_KINDS),
    channel: z.enum(DATA_REQUEST_CHANNELS),
    requesterName: z.string().trim().min(2).max(160),
    requesterEmail: z.string().trim().toLowerCase().email().max(254),
    companyId: z.number().int().positive().nullable().optional(),
    tenantId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/).nullable().optional(),
    details: z.string().trim().max(2000).nullable().optional(),
    /** Fecha de RECEPCIÓN (ms): el plazo corre desde que llegó, no desde que se registra. Por defecto, ahora. */
    receivedAt: z.number().int().positive().optional(),
  })
  .strict();

/** Transiciones permitidas: recibida → en curso → resuelta o rechazada (también se puede cerrar directamente). */
export const TRANSITIONS: Record<DataRequestStatus, DataRequestStatus[]> = { received: ["in_progress", "resolved", "rejected"], in_progress: ["resolved", "rejected"], resolved: [], rejected: [] };

type Raise = (alertId: string, f: AlertFacts) => Promise<unknown>;
export interface Assignee {
  id: string;
  name: string;
}
type AssigneeSource = () => Promise<Assignee[]>;

/** Responsables posibles: operadores activos cuyo rol puede editar el CRM (`crm:write`). Identificador = usuario. */
export function operatorAssignees(list: Array<{ username: string; displayName: string; role: string; status: string }>): Assignee[] {
  return list
    .filter((o) => o.status === "active" && isRole(o.role) && ROLE_SCOPES[o.role].includes("crm:write"))
    .map((o) => ({ id: o.username, name: o.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

const linkOf = (r: DataRequest) => (r.tenantId ? `#/clientes/${r.tenantId}` : r.companyId ? `#/comercial/empresas/${r.companyId}` : "#/soporte");
const baseFacts = (r: DataRequest) => ({
  tenantId: r.tenantId,
  companyId: r.companyId,
  reference: r.reference,
  link: linkOf(r),
  details: [
    { label: "Tipo de solicitud", value: KIND_LABEL[r.kind] },
    { label: "Recibida", value: dateTime(r.receivedAt) },
    { label: "Plazo legal", value: dateTime(r.dueAt) },
  ],
});

/** Alerta del registro de una solicitud (pura). */
export function dataRequestReceivedAlert(r: DataRequest): { id: string; facts: AlertFacts } {
  return { id: "admin.data_request", facts: { ...baseFacts(r), key: `dr:${r.id}:received`, occurredAt: r.receivedAt, summary: `Solicitud de ${KIND_LABEL[r.kind]} registrada. Hay que responder en ${LEGAL_DEADLINE_DAYS} días como máximo.`, status: { label: "Pendiente de resolver", tone: "warning" } } };
}

/** Escaladas de las solicitudes abiertas cerca o fuera de plazo (pura). */
export function dataRequestDeadlineAlerts(list: DataRequest[], now: number): Array<{ id: string; facts: AlertFacts }> {
  const out: Array<{ id: string; facts: AlertFacts }> = [];
  for (const r of list) {
    if (!OPEN_STATUSES.includes(r.status)) continue;
    const left = r.dueAt - now;
    if (left <= 0) out.push({ id: "admin.data_request", facts: { ...baseFacts(r), key: `dr:${r.id}:overdue`, occurredAt: now, summary: `La solicitud de ${KIND_LABEL[r.kind]} ha superado el plazo legal de ${LEGAL_DEADLINE_DAYS} días sin resolverse.`, status: { label: "Fuera de plazo", tone: "error" }, severity: "critical", escalated: "ha vencido el plazo legal de respuesta" } });
    else if (left <= WARN_DAYS * DAY) {
      const days = Math.ceil(left / DAY);
      out.push({ id: "admin.data_request", facts: { ...baseFacts(r), key: `dr:${r.id}:due`, occurredAt: now, summary: `Quedan ${days} ${days === 1 ? "día" : "días"} del plazo legal para responder a la solicitud de ${KIND_LABEL[r.kind]}.`, status: { label: "Plazo a punto de vencer", tone: "warning" }, severity: "critical", escalated: `quedan ${days} ${days === 1 ? "día" : "días"} del plazo legal sin resolver` } });
    }
  }
  return out;
}

/** Detalle del evento de escalada según la fase del plazo (uno por fase y solicitud). */
export const ESCALATION_DETAIL = {
  due: `Escalada: quedan ${WARN_DAYS} días o menos del plazo legal sin resolver`,
  overdue: "Escalada: ha vencido el plazo legal sin resolver",
} as const;

export interface DataRequestListFilter {
  status?: DataRequestStatus;
  kind?: DataRequest["kind"];
  open?: boolean;
  /** Identificador del responsable; `null` = sin asignar. */
  assigneeId?: string | null;
  deadline?: DataRequestQuery["deadline"];
  limit?: number;
}

export class DataRequestService {
  private now: () => number;
  constructor(private d: { store: DataRequestStore; raise?: Raise | null; now?: () => number; assignees?: AssigneeSource | null }) {
    this.now = d.now ?? Date.now;
  }

  private event(requestId: number, at: number, by: string, type: DataRequestEventType, detail: string | null) {
    return this.d.store.addEvent({ requestId, at, actor: by.slice(0, 100), type, detail: detail ? detail.slice(0, 2000) : null });
  }

  private async mustGet(id: number): Promise<DataRequest> {
    const r = await this.d.store.get(id);
    if (!r) throw new CrmError("not_found", "Solicitud no encontrada");
    return r;
  }

  async register(raw: unknown, by: string): Promise<DataRequest> {
    const p = registerSchema.safeParse(raw);
    if (!p.success) throw new CrmError("invalid_input", `Solicitud no válida: ${p.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`);
    const now = this.now();
    const receivedAt = p.data.receivedAt ?? now;
    if (receivedAt > now + 60_000) throw new CrmError("invalid_input", "La fecha de recepción no puede ser futura");
    const r = await this.d.store.create({
      kind: p.data.kind,
      status: "received",
      channel: p.data.channel,
      requesterName: p.data.requesterName,
      requesterEmail: p.data.requesterEmail,
      companyId: p.data.companyId ?? null,
      tenantId: p.data.tenantId ?? null,
      details: p.data.details || null,
      receivedAt,
      dueAt: receivedAt + LEGAL_DEADLINE_DAYS * DAY,
      createdBy: by.slice(0, 100),
      updatedAt: now,
    });
    await this.event(r.id, now, by, "created", `Solicitud de ${KIND_LABEL[r.kind]} registrada (${r.reference})`);
    opsLog("info", "DataRequests", "registered", { id: r.id, kind: r.kind, by: by.slice(0, 100) });
    if (this.d.raise) {
      const a = dataRequestReceivedAlert(r);
      await this.d.raise(a.id, a.facts).catch(() => undefined);
    }
    return r;
  }

  async setStatus(id: number, to: DataRequestStatus, resolution: string | null, by: string): Promise<DataRequest> {
    const r = await this.mustGet(id);
    if (!TRANSITIONS[r.status].includes(to)) throw new CrmError("invalid_state", `No se puede pasar de «${STATUS_LABEL[r.status]}» a «${STATUS_LABEL[to]}»`);
    const closing = to === "resolved" || to === "rejected";
    if (closing && !resolution?.trim()) throw new CrmError("invalid_input", "Indica cómo se ha resuelto la solicitud");
    const now = this.now();
    const text = resolution?.trim().slice(0, 2000) || null;
    const out = await this.d.store.setStatus(id, r.status, to, { resolvedAt: closing ? now : null, resolution: closing ? text : r.resolution, updatedAt: now });
    if (!out) throw new CrmError("conflict", "La solicitud ha cambiado entretanto; vuelve a cargarla");
    const change = `${STATUS_LABEL[r.status]} → ${STATUS_LABEL[to]}`;
    await this.event(id, now, by, to === "resolved" ? "resolved" : "status_changed", text ? `${change}: ${text}` : change);
    opsLog("info", "DataRequests", "status_changed", { id, from: r.status, to, by: by.slice(0, 100) });
    return out;
  }

  /** Asigna el responsable (operador con permiso de edición del CRM) o lo retira con null. */
  async assign(id: number, assigneeId: string | null, by: string): Promise<DataRequest> {
    const r = await this.mustGet(id);
    let a: Assignee | null = null;
    if (assigneeId !== null) {
      if (!this.d.assignees) throw new CrmError("invalid_state", "No hay operadores disponibles para asignar");
      a = (await this.d.assignees()).find((x) => x.id === assigneeId) ?? null;
      if (!a) throw new CrmError("invalid_input", "El responsable no es un operador activo con permiso de edición del CRM");
    }
    if ((a?.id ?? null) === r.assigneeId) return r;
    const now = this.now();
    const out = await this.d.store.setAssignee(id, a, now);
    if (!out) throw new CrmError("not_found", "Solicitud no encontrada");
    await this.event(id, now, by, "assigned", a ? `Responsable: ${a.name}${r.assigneeName ? ` (antes: ${r.assigneeName})` : ""}` : `Responsable retirado${r.assigneeName ? ` (era ${r.assigneeName})` : ""}`);
    opsLog("info", "DataRequests", "assigned", { id, assignee: a?.id ?? null, by: by.slice(0, 100) });
    return out;
  }

  async addNote(id: number, text: string, by: string): Promise<DataRequestEvent> {
    await this.mustGet(id);
    const t = text.trim();
    if (!t) throw new CrmError("invalid_input", "La nota está vacía");
    return this.event(id, this.now(), by, "note", t);
  }

  /**
   * Escaladas por plazo de las solicitudes abiertas: deja en el historial un evento `escalated` por fase (a punto de
   * vencer, vencida) y solicitud, una sola vez, y devuelve las alertas que hay que lanzar (la alerta se deduplica sola).
   */
  async escalate(now: number): Promise<Array<{ id: string; facts: AlertFacts }>> {
    const alerts = dataRequestDeadlineAlerts(await this.open(), now);
    for (const a of alerts) {
      const m = /^dr:(\d+):(due|overdue)$/.exec(a.facts.key);
      if (!m) continue;
      const detail = ESCALATION_DETAIL[m[2] as "due" | "overdue"];
      const id = Number(m[1]);
      if ((await this.d.store.events(id)).some((e) => e.type === "escalated" && e.detail === detail)) continue;
      await this.event(id, now, "system:alertas", "escalated", detail);
    }
    return alerts;
  }

  get(id: number) {
    return this.d.store.get(id);
  }
  async detail(id: number): Promise<{ request: DataRequest; events: DataRequestEvent[] }> {
    const request = await this.mustGet(id);
    return { request, events: await this.d.store.events(id) };
  }
  list(q: DataRequestListFilter) {
    return this.d.store.list({ ...q, now: this.now(), warnMs: WARN_DAYS * DAY });
  }
  open() {
    return this.d.store.list({ open: true, limit: 200 });
  }
  async assigneeOptions(): Promise<Assignee[]> {
    return this.d.assignees ? this.d.assignees() : [];
  }
}
