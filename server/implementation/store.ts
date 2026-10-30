/**
 * Implantación asistida (CRM 0035): expediente de una solución que necesita preparación técnica antes de habilitarse,
 * con su orden de implantación (hitos y pendientes) y su historial (solo se añaden filas).
 *
 *   requested ─propuesta→ proposal ─contrato aceptado→ accepted (orden de implantación en curso)
 *     ─preparada→ ready ─habilitar→ enabled ─comunicar→ available ─iniciar→ started
 *   cualquier estado anterior a `started` ─cancelar→ cancelled
 *
 * Las condiciones y el plazo los escribe una persona; nada aquí calcula fechas.
 */
import crypto from "node:crypto";
import type mysql from "mysql2/promise";

export const IMPLEMENTATION_STATUSES = ["requested", "proposal", "accepted", "ready", "enabled", "available", "started", "cancelled"] as const;
export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];
/** Estados en los que el expediente sigue abierto (el índice único `open_slot` los cubre). */
export const OPEN_IMPLEMENTATION: readonly ImplementationStatus[] = ["requested", "proposal", "accepted", "ready", "enabled", "available"];
export const STATUS_LABEL: Record<ImplementationStatus, string> = {
  requested: "Solicitada",
  proposal: "Propuesta preparada",
  accepted: "En implantación",
  ready: "Técnicamente preparada",
  enabled: "Habilitada",
  available: "Comunicada al cliente",
  started: "Iniciada",
  cancelled: "Cancelada",
};
export const START_MODES = ["trial", "subscription"] as const;
export type StartMode = (typeof START_MODES)[number];
export const IMPLEMENTATION_QUEUES = ["implantacion", "comercial", "tecnica"] as const;
export type ImplementationQueue = (typeof IMPLEMENTATION_QUEUES)[number];
export const MILESTONE_KINDS = ["milestone", "pending"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];
export type MilestoneStatus = "open" | "done";
export const IMPLEMENTATION_EVENT_TYPES = [
  "created",
  "assigned",
  "proposal",
  "accepted",
  "milestone_added",
  "milestone_updated",
  "milestone_done",
  "milestone_reopened",
  "ready",
  "enabled",
  "communicated",
  "started",
  "cancelled",
  "note",
  "step_failed",
] as const;
export type ImplementationEventType = (typeof IMPLEMENTATION_EVENT_TYPES)[number];

export interface ImplementationOrder {
  id: number;
  reference: string;
  status: ImplementationStatus;
  companyId: number;
  opportunityId: number | null;
  leadRequestId: number | null;
  contractId: number | null;
  solutionKey: string;
  solutionName: string;
  /** Lo que pidió el cliente (configuración o interés de la solicitud), como referencia. */
  requestSnapshot: Record<string, unknown> | null;
  assigneeId: string | null;
  assigneeName: string | null;
  queue: ImplementationQueue | null;
  /** Condiciones y plazo escritos por una persona; `targetDate` solo si una persona la fija. */
  conditions: string | null;
  timeline: string | null;
  targetDate: number | null;
  startMode: StartMode | null;
  termsBy: string | null;
  termsAt: number | null;
  acceptedAt: number | null;
  readyAt: number | null;
  readyBy: string | null;
  tenantId: string | null;
  enabledAt: number | null;
  communicatedAt: number | null;
  subscriptionId: number | null;
  startedAt: number | null;
  trialEndsAt: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
  lastError: string | null;
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
export type NewImplementationOrder = Pick<
  ImplementationOrder,
  "companyId" | "opportunityId" | "leadRequestId" | "solutionKey" | "solutionName" | "requestSnapshot" | "assigneeId" | "assigneeName" | "queue" | "createdBy" | "createdAt"
>;
export type ImplementationPatch = Partial<Omit<ImplementationOrder, "id" | "reference" | "companyId" | "leadRequestId" | "solutionKey" | "version" | "createdBy" | "createdAt">>;

export interface Milestone {
  id: number;
  orderId: number;
  kind: MilestoneKind;
  title: string;
  required: boolean;
  status: MilestoneStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: number | null;
  note: string | null;
  position: number;
  doneAt: number | null;
  doneBy: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
export type NewMilestone = Omit<Milestone, "id" | "status" | "doneAt" | "doneBy" | "updatedAt">;
export type MilestonePatch = Partial<Pick<Milestone, "title" | "required" | "status" | "assigneeId" | "assigneeName" | "dueAt" | "note" | "doneAt" | "doneBy">>;

export interface ImplementationEvent {
  id: number;
  orderId: number;
  at: number;
  actor: string;
  type: ImplementationEventType;
  detail: string | null;
}
export type NewImplementationEvent = Omit<ImplementationEvent, "id">;

export interface ImplementationQuery {
  status?: ImplementationStatus;
  open?: boolean;
  companyId?: number;
  opportunityId?: number;
  /** Identificador del responsable; `null` = sin responsable. */
  assigneeId?: string | null;
  queue?: ImplementationQueue;
  limit?: number;
}

/** Ya existe un expediente abierto para esa empresa y solución, o para esa solicitud. */
export class ImplementationDuplicateError extends Error {
  constructor() {
    super("Expediente duplicado");
    this.name = "ImplementationDuplicateError";
  }
}

export interface ImplementationStore {
  create(o: NewImplementationOrder): Promise<ImplementationOrder>;
  get(id: number): Promise<ImplementationOrder | null>;
  byLeadRequest(leadRequestId: number): Promise<ImplementationOrder | null>;
  /** Expediente abierto de una empresa para una solución (como mucho uno). */
  openFor(companyId: number, solutionKey: string): Promise<ImplementationOrder | null>;
  list(q: ImplementationQuery): Promise<ImplementationOrder[]>;
  /** Aplica el cambio si la versión sigue siendo `expectedVersion` (concurrencia); null si cambió mientras tanto. */
  update(id: number, expectedVersion: number, patch: ImplementationPatch, updatedAt: number): Promise<ImplementationOrder | null>;
  addMilestone(m: NewMilestone): Promise<Milestone>;
  milestone(id: number): Promise<Milestone | null>;
  milestones(orderId: number): Promise<Milestone[]>;
  updateMilestone(id: number, patch: MilestonePatch, updatedAt: number): Promise<Milestone | null>;
  addEvent(e: NewImplementationEvent): Promise<ImplementationEvent>;
  events(orderId: number): Promise<ImplementationEvent[]>;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newImplementationReference(now: number): string {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  return `IMP-${d}-${Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

const MAX = 200;
const blank = (o: NewImplementationOrder): ImplementationOrder => ({
  ...o,
  id: 0,
  reference: newImplementationReference(o.createdAt),
  status: "requested",
  contractId: null,
  conditions: null,
  timeline: null,
  targetDate: null,
  startMode: null,
  termsBy: null,
  termsAt: null,
  acceptedAt: null,
  readyAt: null,
  readyBy: null,
  tenantId: null,
  enabledAt: null,
  communicatedAt: null,
  subscriptionId: null,
  startedAt: null,
  trialEndsAt: null,
  cancelledAt: null,
  cancelReason: null,
  lastError: null,
  version: 1,
  updatedAt: o.createdAt,
});
const isOpen = (s: ImplementationStatus) => OPEN_IMPLEMENTATION.includes(s);
const matches = (x: ImplementationOrder, q: ImplementationQuery) =>
  (!q.status || x.status === q.status) &&
  (!q.open || isOpen(x.status)) &&
  (q.companyId === undefined || x.companyId === q.companyId) &&
  (q.opportunityId === undefined || x.opportunityId === q.opportunityId) &&
  (q.assigneeId === undefined || x.assigneeId === q.assigneeId) &&
  (!q.queue || x.queue === q.queue);

export class MemoryImplementationStore implements ImplementationStore {
  rows: ImplementationOrder[] = [];
  milestoneRows: Milestone[] = [];
  eventRows: ImplementationEvent[] = [];
  async create(o: NewImplementationOrder) {
    if (o.leadRequestId !== null && this.rows.some((x) => x.leadRequestId === o.leadRequestId)) throw new ImplementationDuplicateError();
    if (this.rows.some((x) => isOpen(x.status) && x.companyId === o.companyId && x.solutionKey === o.solutionKey)) throw new ImplementationDuplicateError();
    const row = { ...blank(o), id: this.rows.length + 1 };
    this.rows.push(row);
    return structuredClone(row);
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async byLeadRequest(leadRequestId: number) {
    const r = this.rows.find((x) => x.leadRequestId === leadRequestId);
    return r ? structuredClone(r) : null;
  }
  async openFor(companyId: number, solutionKey: string) {
    const r = this.rows.find((x) => isOpen(x.status) && x.companyId === companyId && x.solutionKey === solutionKey);
    return r ? structuredClone(r) : null;
  }
  async list(q: ImplementationQuery) {
    return this.rows
      .filter((x) => matches(x, q))
      .sort((a, b) => b.id - a.id)
      .slice(0, Math.min(q.limit ?? 50, MAX))
      .map((x) => structuredClone(x));
  }
  async update(id: number, expectedVersion: number, patch: ImplementationPatch, updatedAt: number) {
    const r = this.rows.find((x) => x.id === id && x.version === expectedVersion);
    if (!r) return null;
    const next = { ...r, ...patch };
    if (patch.status && isOpen(patch.status) && !isOpen(r.status)) throw new Error("Un expediente cerrado no se reabre");
    if (isOpen(next.status) && this.rows.some((x) => x.id !== id && isOpen(x.status) && x.companyId === r.companyId && x.solutionKey === r.solutionKey)) throw new ImplementationDuplicateError();
    Object.assign(r, patch, { version: r.version + 1, updatedAt });
    return structuredClone(r);
  }
  async addMilestone(m: NewMilestone) {
    const row: Milestone = { ...m, id: this.milestoneRows.length + 1, status: "open", doneAt: null, doneBy: null, updatedAt: m.createdAt };
    this.milestoneRows.push(row);
    return { ...row };
  }
  async milestone(id: number) {
    const r = this.milestoneRows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async milestones(orderId: number) {
    return this.milestoneRows
      .filter((x) => x.orderId === orderId)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((x) => ({ ...x }));
  }
  async updateMilestone(id: number, patch: MilestonePatch, updatedAt: number) {
    const r = this.milestoneRows.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt });
    return { ...r };
  }
  async addEvent(e: NewImplementationEvent) {
    const row: ImplementationEvent = { ...e, id: this.eventRows.length + 1 };
    this.eventRows.push(row);
    return { ...row };
  }
  async events(orderId: number) {
    return this.eventRows.filter((e) => e.orderId === orderId).sort((a, b) => a.id - b.id).map((e) => ({ ...e }));
  }
}

// ── MySQL ────────────────────────────────────────────────────────────────────

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const json = (v: unknown): Record<string, unknown> | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return v as Record<string, unknown>;
};

/** Campo del dominio ↔ columna. */
const COLUMNS: Record<keyof ImplementationPatch, string> = {
  status: "status",
  opportunityId: "opportunity_id",
  contractId: "contract_id",
  solutionName: "solution_name",
  requestSnapshot: "request_snapshot",
  assigneeId: "assignee_id",
  assigneeName: "assignee_name",
  queue: "queue",
  conditions: "conditions",
  timeline: "timeline",
  targetDate: "target_date",
  startMode: "start_mode",
  termsBy: "terms_by",
  termsAt: "terms_at",
  acceptedAt: "accepted_at",
  readyAt: "ready_at",
  readyBy: "ready_by",
  tenantId: "tenant_id",
  enabledAt: "enabled_at",
  communicatedAt: "communicated_at",
  subscriptionId: "subscription_id",
  startedAt: "started_at",
  trialEndsAt: "trial_ends_at",
  cancelledAt: "cancelled_at",
  cancelReason: "cancel_reason",
  lastError: "last_error",
  updatedAt: "updated_at",
};

const orderRow = (r: Record<string, unknown>): ImplementationOrder => ({
  id: Number(r.id),
  reference: String(r.reference),
  status: r.status as ImplementationStatus,
  companyId: Number(r.company_id),
  opportunityId: num(r.opportunity_id),
  leadRequestId: num(r.lead_request_id),
  contractId: num(r.contract_id),
  solutionKey: String(r.solution_key),
  solutionName: String(r.solution_name),
  requestSnapshot: json(r.request_snapshot),
  assigneeId: str(r.assignee_id),
  assigneeName: str(r.assignee_name),
  queue: str(r.queue) as ImplementationQueue | null,
  conditions: str(r.conditions),
  timeline: str(r.timeline),
  targetDate: num(r.target_date),
  startMode: str(r.start_mode) as StartMode | null,
  termsBy: str(r.terms_by),
  termsAt: num(r.terms_at),
  acceptedAt: num(r.accepted_at),
  readyAt: num(r.ready_at),
  readyBy: str(r.ready_by),
  tenantId: str(r.tenant_id),
  enabledAt: num(r.enabled_at),
  communicatedAt: num(r.communicated_at),
  subscriptionId: num(r.subscription_id),
  startedAt: num(r.started_at),
  trialEndsAt: num(r.trial_ends_at),
  cancelledAt: num(r.cancelled_at),
  cancelReason: str(r.cancel_reason),
  lastError: str(r.last_error),
  version: Number(r.version),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const milestoneRow = (r: Record<string, unknown>): Milestone => ({
  id: Number(r.id),
  orderId: Number(r.order_id),
  kind: r.kind as MilestoneKind,
  title: String(r.title),
  required: Number(r.required) === 1,
  status: r.status as MilestoneStatus,
  assigneeId: str(r.assignee_id),
  assigneeName: str(r.assignee_name),
  dueAt: num(r.due_at),
  note: str(r.note),
  position: Number(r.position),
  doneAt: num(r.done_at),
  doneBy: str(r.done_by),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const eventRow = (r: Record<string, unknown>): ImplementationEvent => ({
  id: Number(r.id),
  orderId: Number(r.order_id),
  at: Number(r.at),
  actor: String(r.actor),
  type: r.type as ImplementationEventType,
  detail: str(r.detail),
});
const isDuplicate = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";
const MILESTONE_COLUMNS: Record<keyof MilestonePatch, string> = {
  title: "title",
  required: "required",
  status: "status",
  assigneeId: "assignee_id",
  assigneeName: "assignee_name",
  dueAt: "due_at",
  note: "note",
  doneAt: "done_at",
  doneBy: "done_by",
};

type Rows = [Record<string, unknown>[]];
type Res = [{ insertId: number; affectedRows: number }];

export class MysqlImplementationStore implements ImplementationStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}
  private async one(sql: string, args: unknown[]) {
    const [rows] = (await this.pool.query(sql, args)) as unknown as Rows;
    return rows[0] ? orderRow(rows[0]) : null;
  }
  async create(o: NewImplementationOrder) {
    const reference = newImplementationReference(o.createdAt);
    try {
      const [res] = (await this.pool.query(
        "INSERT INTO implementation_orders (reference, status, company_id, opportunity_id, lead_request_id, solution_key, solution_name, request_snapshot, assignee_id, assignee_name, queue, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [reference, "requested", o.companyId, o.opportunityId, o.leadRequestId, o.solutionKey, o.solutionName, o.requestSnapshot ? JSON.stringify(o.requestSnapshot) : null, o.assigneeId, o.assigneeName, o.queue, o.createdBy, o.createdAt, o.createdAt],
      )) as unknown as Res;
      return (await this.get(Number(res.insertId)))!;
    } catch (e) {
      if (isDuplicate(e)) throw new ImplementationDuplicateError();
      throw e;
    }
  }
  get(id: number) {
    return this.one("SELECT * FROM implementation_orders WHERE id = ?", [id]);
  }
  byLeadRequest(leadRequestId: number) {
    return this.one("SELECT * FROM implementation_orders WHERE lead_request_id = ?", [leadRequestId]);
  }
  openFor(companyId: number, solutionKey: string) {
    return this.one("SELECT * FROM implementation_orders WHERE open_slot = ?", [`${companyId}:${solutionKey}`]);
  }
  async list(q: ImplementationQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.open) w.push("open_slot IS NOT NULL");
    if (q.companyId !== undefined) (w.push("company_id = ?"), a.push(q.companyId));
    if (q.opportunityId !== undefined) (w.push("opportunity_id = ?"), a.push(q.opportunityId));
    if (q.assigneeId === null) w.push("assignee_id IS NULL");
    else if (q.assigneeId !== undefined) (w.push("assignee_id = ?"), a.push(q.assigneeId));
    if (q.queue) (w.push("queue = ?"), a.push(q.queue));
    const [rows] = (await this.pool.query(`SELECT * FROM implementation_orders ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...a, Math.min(q.limit ?? 50, MAX)])) as unknown as Rows;
    return rows.map(orderRow);
  }
  async update(id: number, expectedVersion: number, patch: ImplementationPatch, updatedAt: number) {
    const sets: string[] = ["version = version + 1", "updated_at = ?"];
    const args: unknown[] = [updatedAt];
    for (const [k, v] of Object.entries(patch) as Array<[keyof ImplementationPatch, unknown]>) {
      if (k === "updatedAt" || v === undefined) continue;
      sets.push(`${COLUMNS[k]} = ?`);
      args.push(k === "requestSnapshot" && v !== null ? JSON.stringify(v) : v);
    }
    try {
      const [res] = (await this.pool.query(`UPDATE implementation_orders SET ${sets.join(", ")} WHERE id = ? AND version = ?`, [...args, id, expectedVersion])) as unknown as Res;
      return res.affectedRows ? this.get(id) : null;
    } catch (e) {
      if (isDuplicate(e)) throw new ImplementationDuplicateError();
      throw e;
    }
  }
  async addMilestone(m: NewMilestone) {
    const [res] = (await this.pool.query(
      "INSERT INTO implementation_milestones (order_id, kind, title, required, status, assignee_id, assignee_name, due_at, note, position, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [m.orderId, m.kind, m.title, m.required ? 1 : 0, "open", m.assigneeId, m.assigneeName, m.dueAt, m.note, m.position, m.createdBy, m.createdAt, m.createdAt],
    )) as unknown as Res;
    return (await this.milestone(Number(res.insertId)))!;
  }
  async milestone(id: number) {
    const [rows] = (await this.pool.query("SELECT * FROM implementation_milestones WHERE id = ?", [id])) as unknown as Rows;
    return rows[0] ? milestoneRow(rows[0]) : null;
  }
  async milestones(orderId: number) {
    const [rows] = (await this.pool.query("SELECT * FROM implementation_milestones WHERE order_id = ? ORDER BY position, id", [orderId])) as unknown as Rows;
    return rows.map(milestoneRow);
  }
  async updateMilestone(id: number, patch: MilestonePatch, updatedAt: number) {
    const sets: string[] = ["updated_at = ?"];
    const args: unknown[] = [updatedAt];
    for (const [k, v] of Object.entries(patch) as Array<[keyof MilestonePatch, unknown]>) {
      if (v === undefined) continue;
      sets.push(`${MILESTONE_COLUMNS[k]} = ?`);
      args.push(k === "required" ? (v ? 1 : 0) : v);
    }
    const [res] = (await this.pool.query(`UPDATE implementation_milestones SET ${sets.join(", ")} WHERE id = ?`, [...args, id])) as unknown as Res;
    return res.affectedRows ? this.milestone(id) : null;
  }
  async addEvent(e: NewImplementationEvent) {
    const [res] = (await this.pool.query("INSERT INTO implementation_events (order_id, at, actor, type, detail) VALUES (?,?,?,?,?)", [e.orderId, e.at, e.actor.slice(0, 100), e.type, e.detail?.slice(0, 2000) ?? null])) as unknown as Res;
    return { ...e, id: Number(res.insertId) };
  }
  async events(orderId: number) {
    const [rows] = (await this.pool.query("SELECT * FROM implementation_events WHERE order_id = ? ORDER BY id", [orderId])) as unknown as Rows;
    return rows.map(eventRow);
  }
}

/** ¿Existe la migración 0035 (expedientes, hitos e historial)? */
export async function implementationTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const t of ["implementation_orders", "implementation_milestones", "implementation_events"]) {
    if (!(await pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false))) return false;
  }
  return true;
}
