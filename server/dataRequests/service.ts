/**
 * Solicitudes de derechos de protección de datos (RGPD), registradas desde el CRM cuando llegan por cualquier canal
 * (correo, web, teléfono, correo postal). Plazo legal de respuesta: 30 días desde la recepción (art. 12.3 RGPD).
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
import { DATA_REQUEST_CHANNELS, DATA_REQUEST_KINDS, KIND_LABEL, OPEN_STATUSES, type DataRequest, type DataRequestStatus, type DataRequestStore } from "./store";

export const LEGAL_DEADLINE_DAYS = 30;
export const WARN_DAYS = 7;
const DAY = 24 * 3600_000;

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

const TRANSITIONS: Record<DataRequestStatus, DataRequestStatus[]> = { received: ["in_progress", "resolved", "rejected"], in_progress: ["resolved", "rejected"], resolved: [], rejected: [] };

type Raise = (alertId: string, f: AlertFacts) => Promise<unknown>;

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

export class DataRequestService {
  private now: () => number;
  constructor(private d: { store: DataRequestStore; raise?: Raise | null; now?: () => number }) {
    this.now = d.now ?? Date.now;
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
    opsLog("info", "DataRequests", "registered", { id: r.id, kind: r.kind, by: by.slice(0, 100) });
    if (this.d.raise) {
      const a = dataRequestReceivedAlert(r);
      await this.d.raise(a.id, a.facts).catch(() => undefined);
    }
    return r;
  }

  async setStatus(id: number, to: DataRequestStatus, resolution: string | null, by: string): Promise<DataRequest> {
    const r = await this.d.store.get(id);
    if (!r) throw new CrmError("not_found", "Solicitud no encontrada");
    if (!TRANSITIONS[r.status].includes(to)) throw new CrmError("invalid_state", `No se puede pasar de «${r.status}» a «${to}»`);
    const closing = to === "resolved" || to === "rejected";
    if (closing && !resolution?.trim()) throw new CrmError("invalid_input", "Indica cómo se ha resuelto la solicitud");
    const now = this.now();
    const out = await this.d.store.setStatus(id, r.status, to, { resolvedAt: closing ? now : null, resolution: resolution?.trim().slice(0, 2000) || null, updatedAt: now });
    if (!out) throw new CrmError("conflict", "La solicitud ha cambiado entretanto; vuelve a cargarla");
    opsLog("info", "DataRequests", "status_changed", { id, from: r.status, to, by: by.slice(0, 100) });
    return out;
  }

  get(id: number) {
    return this.d.store.get(id);
  }
  list(q: { status?: DataRequestStatus; open?: boolean; limit?: number }) {
    return this.d.store.list(q);
  }
  open() {
    return this.d.store.list({ open: true, limit: 200 });
  }
}
