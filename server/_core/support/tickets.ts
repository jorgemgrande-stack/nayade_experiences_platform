/**
 * Tickets de soporte de clientes (plano comercial).
 *
 *  - Cada ticket pertenece a un único tenant; nunca se mezclan datos entre empresas.
 *  - Ciclo: open → in_progress ⇄ waiting_customer → resolved → closed (resolved puede reabrirse).
 *  - Todo cambio (estado, prioridad, asignación, comentario) queda en el historial con su actor.
 */
import type mysql from "mysql2/promise";

export const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketEventKind = "created" | "status" | "priority" | "assignee" | "comment";

export interface Ticket {
  id: number;
  tenantId: string;
  title: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  requester: string | null;
  assignee: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface TicketEvent {
  id: number;
  ticketId: number;
  at: number;
  actor: string;
  kind: TicketEventKind;
  fromValue: string | null;
  toValue: string | null;
  comment: string | null;
  internal: boolean;
}

export interface TicketFilter {
  tenantId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee?: string;
  /** Texto en título/descripción. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface TicketStore {
  insert(t: Omit<Ticket, "id">): Promise<Ticket>;
  update(id: number, patch: Partial<Omit<Ticket, "id" | "tenantId">>): Promise<Ticket>;
  get(id: number): Promise<Ticket | null>;
  list(f: TicketFilter): Promise<{ items: Ticket[]; total: number }>;
  addEvent(e: Omit<TicketEvent, "id">): Promise<void>;
  events(ticketId: number): Promise<TicketEvent[]>;
}

export class TicketError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_transition",
    message: string,
  ) {
    super(message);
    this.name = "TicketError";
  }
}

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "waiting_customer", "resolved", "closed"],
  in_progress: ["open", "waiting_customer", "resolved", "closed"],
  waiting_customer: ["in_progress", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

// ── Memoria (pruebas) ─────────────────────────────────────────────────────────

export class MemoryTicketStore implements TicketStore {
  private rows: Ticket[] = [];
  private evs: TicketEvent[] = [];
  private seq = 0;
  private evSeq = 0;
  async insert(t: Omit<Ticket, "id">) {
    const r = { ...t, id: ++this.seq };
    this.rows.push(r);
    return { ...r };
  }
  async update(id: number, patch: Partial<Omit<Ticket, "id" | "tenantId">>) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, patch);
    return { ...r };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async list(f: TicketFilter) {
    const q = f.q?.toLowerCase();
    const all = this.rows
      .filter(
        (r) =>
          (!f.tenantId || r.tenantId === f.tenantId) &&
          (!f.status || r.status === f.status) &&
          (!f.priority || r.priority === f.priority) &&
          (!f.assignee || r.assignee === f.assignee) &&
          (!q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
    const off = f.offset ?? 0;
    return { items: all.slice(off, off + (f.limit ?? 50)).map((r) => ({ ...r })), total: all.length };
  }
  async addEvent(e: Omit<TicketEvent, "id">) {
    this.evs.push({ ...e, id: ++this.evSeq });
  }
  async events(ticketId: number) {
    return this.evs.filter((e) => e.ticketId === ticketId).sort((a, b) => a.at - b.at || a.id - b.id).map((e) => ({ ...e }));
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

const mapTicket = (r: any): Ticket => ({
  id: Number(r.id),
  tenantId: r.tenant_id,
  title: r.title,
  description: r.description,
  category: r.category,
  priority: r.priority,
  status: r.status,
  requester: r.requester ?? null,
  assignee: r.assignee ?? null,
  createdBy: r.created_by,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  resolvedAt: r.resolved_at === null || r.resolved_at === undefined ? null : Number(r.resolved_at),
});

const TICKET_COLS: Array<[keyof Ticket, string]> = [
  ["tenantId", "tenant_id"], ["title", "title"], ["description", "description"], ["category", "category"],
  ["priority", "priority"], ["status", "status"], ["requester", "requester"], ["assignee", "assignee"],
  ["createdBy", "created_by"], ["createdAt", "created_at"], ["updatedAt", "updated_at"], ["resolvedAt", "resolved_at"],
];

export class MysqlTicketStore implements TicketStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async insert(t: Omit<Ticket, "id">) {
    const cols = TICKET_COLS.map(([, c]) => c);
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO support_tickets (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      TICKET_COLS.map(([p]) => (t as Record<string, unknown>)[p] ?? null),
    );
    return (await this.get(res.insertId))!;
  }
  async update(id: number, patch: Partial<Omit<Ticket, "id" | "tenantId">>) {
    const used = TICKET_COLS.filter(([p]) => p in patch && p !== "tenantId");
    if (used.length) {
      await this.pool.query(`UPDATE support_tickets SET ${used.map(([, c]) => `${c} = ?`).join(",")} WHERE id = ?`, [
        ...used.map(([p]) => (patch as Record<string, unknown>)[p] ?? null),
        id,
      ]);
    }
    return (await this.get(id))!;
  }
  async get(id: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM support_tickets WHERE id = ?", [id]);
    return r[0] ? mapTicket(r[0]) : null;
  }
  async list(f: TicketFilter) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.tenantId) (where.push("tenant_id = ?"), args.push(f.tenantId));
    if (f.status) (where.push("status = ?"), args.push(f.status));
    if (f.priority) (where.push("priority = ?"), args.push(f.priority));
    if (f.assignee) (where.push("assignee = ?"), args.push(f.assignee));
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(title LIKE ? OR description LIKE ?)");
      args.push(like, like);
    }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(200, Math.max(1, Math.trunc(f.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(f.offset ?? 0));
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM support_tickets${w} ORDER BY updated_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      args,
    );
    const [cnt] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM support_tickets${w}`, args);
    return { items: rows.map(mapTicket), total: Number(cnt[0]?.n ?? 0) };
  }
  async addEvent(e: Omit<TicketEvent, "id">) {
    await this.pool.query(
      "INSERT INTO support_ticket_events (ticket_id, at, actor, kind, from_value, to_value, comment, internal) VALUES (?,?,?,?,?,?,?,?)",
      [e.ticketId, e.at, e.actor, e.kind, e.fromValue, e.toValue, e.comment, e.internal ? 1 : 0],
    );
  }
  async events(ticketId: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM support_ticket_events WHERE ticket_id = ? ORDER BY at ASC, id ASC",
      [ticketId],
    );
    return r.map((x) => ({
      id: Number(x.id),
      ticketId: Number(x.ticket_id),
      at: Number(x.at),
      actor: x.actor,
      kind: x.kind,
      fromValue: x.from_value ?? null,
      toValue: x.to_value ?? null,
      comment: x.comment ?? null,
      internal: Boolean(x.internal),
    }));
  }
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export class TicketService {
  constructor(
    private store: TicketStore,
    /** Comprueba que el tenant existe; un ticket nunca se crea para una empresa inexistente. */
    private tenantExists: (tenantId: string) => Promise<boolean>,
    private now: () => number = Date.now,
  ) {}

  async create(
    input: { tenantId: string; title: string; description: string; category?: string; priority?: TicketPriority; requester?: string | null },
    actor: string,
  ): Promise<Ticket> {
    if (!(await this.tenantExists(input.tenantId))) throw new TicketError("not_found", "Tenant no encontrado");
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) throw new TicketError("invalid_input", "Título y descripción son obligatorios");
    const t = this.now();
    const ticket = await this.store.insert({
      tenantId: input.tenantId,
      title: title.slice(0, 200),
      description: description.slice(0, 10_000),
      category: (input.category ?? "general").slice(0, 40),
      priority: input.priority ?? "normal",
      status: "open",
      requester: input.requester?.slice(0, 200) ?? null,
      assignee: null,
      createdBy: actor.slice(0, 100),
      createdAt: t,
      updatedAt: t,
      resolvedAt: null,
    });
    await this.event(ticket.id, actor, "created", null, ticket.priority, null, false);
    return ticket;
  }

  list(f: TicketFilter) {
    return this.store.list(f);
  }

  async get(id: number, opts: { tenantId?: string } = {}): Promise<{ ticket: Ticket; events: TicketEvent[] }> {
    const ticket = await this.must(id, opts.tenantId);
    return { ticket, events: await this.store.events(id) };
  }

  async assign(id: number, assignee: string | null, actor: string, tenantId?: string): Promise<Ticket> {
    const tk = await this.must(id, tenantId);
    if (tk.status === "closed") throw new TicketError("invalid_transition", "El ticket está cerrado");
    const to = assignee?.trim().slice(0, 100) || null;
    if (to === tk.assignee) return tk;
    const upd = await this.store.update(id, { assignee: to, updatedAt: this.now() });
    await this.event(id, actor, "assignee", tk.assignee, to, null, false);
    return upd;
  }

  async setPriority(id: number, priority: TicketPriority, actor: string, tenantId?: string): Promise<Ticket> {
    const tk = await this.must(id, tenantId);
    if (tk.status === "closed") throw new TicketError("invalid_transition", "El ticket está cerrado");
    if (priority === tk.priority) return tk;
    const upd = await this.store.update(id, { priority, updatedAt: this.now() });
    await this.event(id, actor, "priority", tk.priority, priority, null, false);
    return upd;
  }

  async setStatus(id: number, status: TicketStatus, actor: string, comment?: string, tenantId?: string): Promise<Ticket> {
    const tk = await this.must(id, tenantId);
    if (status === tk.status) return tk;
    if (!TRANSITIONS[tk.status].includes(status)) {
      throw new TicketError("invalid_transition", `No se puede pasar de ${tk.status} a ${status}`);
    }
    const t = this.now();
    const upd = await this.store.update(id, {
      status,
      updatedAt: t,
      resolvedAt: status === "resolved" || status === "closed" ? (tk.resolvedAt ?? t) : null,
    });
    await this.event(id, actor, "status", tk.status, status, comment?.trim().slice(0, 5000) || null, false);
    return upd;
  }

  async comment(id: number, text: string, actor: string, opts: { internal?: boolean; tenantId?: string } = {}): Promise<TicketEvent[]> {
    const tk = await this.must(id, opts.tenantId);
    const c = text.trim();
    if (!c) throw new TicketError("invalid_input", "El comentario no puede estar vacío");
    if (tk.status === "closed") throw new TicketError("invalid_transition", "El ticket está cerrado");
    await this.store.update(id, { updatedAt: this.now() });
    await this.event(id, actor, "comment", null, null, c.slice(0, 5000), opts.internal ?? false);
    return this.store.events(id);
  }

  /** Si se indica `tenantId`, un ticket de otra empresa se comporta como inexistente. */
  private async must(id: number, tenantId?: string) {
    const tk = await this.store.get(id);
    if (!tk || (tenantId && tk.tenantId !== tenantId)) throw new TicketError("not_found", "Ticket no encontrado");
    return tk;
  }

  private event(ticketId: number, actor: string, kind: TicketEventKind, from: string | null, to: string | null, comment: string | null, internal: boolean) {
    return this.store.addEvent({ ticketId, at: this.now(), actor: actor.slice(0, 100), kind, fromValue: from, toValue: to, comment, internal });
  }
}
