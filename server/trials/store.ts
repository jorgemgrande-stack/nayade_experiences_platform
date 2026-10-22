/**
 * Persistencia de las solicitudes de prueba (BD del CRM, migración 0007) + memoria. Cada cambio de
 * estado es una transacción con versión optimista y su evento de auditoría. Con registro de eventos
 * comerciales (migración 0015 del CRM), el evento comercial va en esa misma transacción.
 */
import type mysql from "mysql2/promise";
import { trialChanged } from "../commercialEvents/derive";
import type { CommercialEventSink } from "../commercialEvents/types";
import type { TrialAction, TrialState } from "./machine";
import { canonicalMailbox } from "./mailbox";

export interface TrialRequest {
  id: number;
  email: string;
  emailDomain: string;
  companyName: string;
  configuration: { plan: string | null; addons: string[] };
  state: TrialState;
  verificationTokenHash: string | null;
  verificationExpiresAt: number | null;
  verifiedAt: number | null;
  tenantId: string | null;
  startsAt: number | null;
  endsAt: number | null;
  extensionsUsed: number;
  extensionRequestedAt: number | null;
  extensionReason: string | null;
  suspendedReason: string | null;
  convertedSubscriptionId: number | null;
  idempotencyKey: string;
  ipHash: string | null;
  version: number;
  createdAt: number;
  updatedAt: number | null;
}
export interface TrialEvent {
  id: number;
  trialId: number;
  /** `notice_queued`: aviso encolado (anotación sin cambio de estado ni de versión). */
  action: TrialAction | "registered" | "notice_queued";
  fromState: TrialState | null;
  toState: TrialState;
  version: number;
  detail: string | null;
  actor: string;
  createdAt: number;
}
export type TrialPatch = Partial<Omit<TrialRequest, "id" | "email" | "emailDomain" | "idempotencyKey" | "createdAt" | "version">>;

export class TrialConflict extends Error {
  constructor(public readonly code: "version_conflict" | "duplicate_email" | "duplicate_key" | "duplicate_tenant", message: string) {
    super(message);
    this.name = "TrialConflict";
  }
}

export interface TrialStore {
  /** Alta. Lanza TrialConflict si ya hay una prueba abierta con ese correo o la clave se repite. */
  insert(t: Omit<TrialRequest, "id" | "version" | "updatedAt">, actor: string): Promise<TrialRequest>;
  byIdempotencyKey(key: string): Promise<TrialRequest | null>;
  openByEmail(email: string): Promise<TrialRequest | null>;
  /**
   * Prueba abierta del mismo buzón con otro alias: `base@dominio` o `base+loquesea@dominio`
   * (`base` ya sin la etiqueta +). Evita abrir varias pruebas a la vez con alias +etiqueta.
   */
  openByAlias(base: string, domain: string): Promise<TrialRequest | null>;
  /**
   * Prueba abierta del mismo buzón canónico (alias +etiqueta y variantes de Gmail; ver ./mailbox). En MySQL usa la
   * columna `open_mailbox` (CRM 0023); sin ella, cae en `openByAlias(alias)` (sin la regla de Gmail).
   */
  openByMailbox(mailbox: string, alias: { base: string; domain: string }): Promise<TrialRequest | null>;
  get(id: number): Promise<TrialRequest | null>;
  /** Cambio de estado con versión esperada y evento, todo o nada. */
  transition(id: number, expectedVersion: number, patch: TrialPatch, event: { action: TrialAction; fromState: TrialState; detail: string | null; actor: string; at: number }): Promise<TrialRequest>;
  count(f: { state?: TrialState; emailDomain?: string; ipHash?: string; since?: number }): Promise<number>;
  list(f: TrialListFilter): Promise<TrialRequest[]>;
  events(trialId: number): Promise<TrialEvent[]>;
  /** Anotación de auditoría SIN cambio de estado ni de versión (p. ej. aviso encolado). */
  note(trialId: number, e: { action: "notice_queued"; detail: string; actor: string; at: number }): Promise<void>;
}

export interface TrialListFilter {
  states?: TrialState[];
  endsBefore?: number;
  extensionRequested?: boolean;
  /** Enlace de verificación caducado antes de este instante. */
  verificationExpiredBefore?: number;
  /** Creadas antes de este instante. */
  createdBefore?: number;
  limit?: number;
}

/** Patrón LIKE literal (escapa %, _ y el carácter de escape `!`). */
const likeLiteral = (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class MemoryTrialStore implements TrialStore {
  private rows = new Map<number, TrialRequest>();
  private evs: TrialEvent[] = [];
  private seq = 0;
  constructor(private commercialEvents?: CommercialEventSink) {}
  async insert(t: Omit<TrialRequest, "id" | "version" | "updatedAt">, actor: string) {
    if (Array.from(this.rows.values()).some((r) => r.idempotencyKey === t.idempotencyKey)) throw new TrialConflict("duplicate_key", "Solicitud repetida");
    // Como los índices únicos de la BD: correo exacto (0007) y buzón canónico (0023)
    if ((await this.openByEmail(t.email)) || (await this.openByMailbox(canonicalMailbox(t.email))))
      throw new TrialConflict("duplicate_email", "Ya hay una prueba abierta con ese correo");
    const full: TrialRequest = { ...clone(t), id: ++this.seq, version: 1, updatedAt: null };
    this.rows.set(full.id, full);
    this.evs.push({ id: ++this.seq, trialId: full.id, action: "registered", fromState: null, toState: full.state, version: 1, detail: null, actor, createdAt: t.createdAt });
    await this.commercialEvents?.append(null, trialChanged(full, "registered", null, actor, t.createdAt));
    return clone(full);
  }
  async byIdempotencyKey(key: string) {
    const r = Array.from(this.rows.values()).find((x) => x.idempotencyKey === key);
    return r ? clone(r) : null;
  }
  async openByEmail(email: string) {
    const r = Array.from(this.rows.values()).find((x) => x.email === email && !["converted", "rejected", "cancelled"].includes(x.state));
    return r ? clone(r) : null;
  }
  async openByAlias(base: string, domain: string) {
    const r = Array.from(this.rows.values()).find(
      (x) => !["converted", "rejected", "cancelled"].includes(x.state) && (x.email === `${base}@${domain}` || (x.email.startsWith(`${base}+`) && x.email.endsWith(`@${domain}`))),
    );
    return r ? clone(r) : null;
  }
  async openByMailbox(mailbox: string) {
    const r = Array.from(this.rows.values()).find((x) => !["converted", "rejected", "cancelled"].includes(x.state) && canonicalMailbox(x.email) === mailbox);
    return r ? clone(r) : null;
  }
  async note(trialId: number, e: { action: "notice_queued"; detail: string; actor: string; at: number }) {
    const cur = this.rows.get(trialId);
    if (!cur) return;
    this.evs.push({ id: ++this.seq, trialId, action: e.action, fromState: cur.state, toState: cur.state, version: cur.version, detail: e.detail, actor: e.actor, createdAt: e.at });
  }
  async get(id: number) {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async transition(id: number, expectedVersion: number, patch: TrialPatch, e: { action: TrialAction; fromState: TrialState; detail: string | null; actor: string; at: number }) {
    const cur = this.rows.get(id);
    if (!cur || cur.version !== expectedVersion) throw new TrialConflict("version_conflict", "La solicitud cambió mientras tanto; recarga");
    if (patch.tenantId && Array.from(this.rows.values()).some((r) => r.id !== id && r.tenantId === patch.tenantId)) throw new TrialConflict("duplicate_tenant", "Ese tenant ya pertenece a otra prueba");
    const next = { ...cur, ...clone(patch), version: cur.version + 1, updatedAt: e.at };
    this.rows.set(id, next);
    this.evs.push({ id: ++this.seq, trialId: id, action: e.action, fromState: e.fromState, toState: next.state, version: next.version, detail: e.detail, actor: e.actor, createdAt: e.at });
    await this.commercialEvents?.append(null, trialChanged(next, e.action, e.fromState, e.actor, e.at));
    return clone(next);
  }
  async count(f: { state?: TrialState; emailDomain?: string; ipHash?: string; since?: number }) {
    return Array.from(this.rows.values()).filter(
      (r) => (!f.state || r.state === f.state) && (!f.emailDomain || r.emailDomain === f.emailDomain) && (!f.ipHash || r.ipHash === f.ipHash) && (f.since === undefined || r.createdAt >= f.since),
    ).length;
  }
  async list(f: TrialListFilter) {
    return Array.from(this.rows.values())
      .filter(
        (r) =>
          (!f.states || f.states.includes(r.state)) &&
          (f.endsBefore === undefined || (r.endsAt !== null && r.endsAt <= f.endsBefore)) &&
          (f.extensionRequested === undefined || (r.extensionRequestedAt !== null) === f.extensionRequested) &&
          (f.verificationExpiredBefore === undefined || (r.verificationExpiresAt !== null && r.verificationExpiresAt <= f.verificationExpiredBefore)) &&
          (f.createdBefore === undefined || r.createdAt <= f.createdBefore),
      )
      .slice(0, f.limit ?? 200)
      .map(clone);
  }
  async events(trialId: number) {
    return clone(this.evs.filter((e) => e.trialId === trialId));
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function row(r: Record<string, unknown>): TrialRequest {
  return {
    id: Number(r.id),
    email: String(r.email),
    emailDomain: String(r.email_domain),
    companyName: String(r.company_name),
    configuration: typeof r.configuration === "string" ? JSON.parse(r.configuration) : (r.configuration as TrialRequest["configuration"]),
    state: r.state as TrialState,
    verificationTokenHash: (r.verification_token_hash as string) ?? null,
    verificationExpiresAt: num(r.verification_expires_at),
    verifiedAt: num(r.verified_at),
    tenantId: (r.tenant_id as string) ?? null,
    startsAt: num(r.starts_at),
    endsAt: num(r.ends_at),
    extensionsUsed: Number(r.extensions_used),
    extensionRequestedAt: num(r.extension_requested_at),
    extensionReason: (r.extension_reason as string) ?? null,
    suspendedReason: (r.suspended_reason as string) ?? null,
    convertedSubscriptionId: num(r.converted_subscription_id),
    idempotencyKey: String(r.idempotency_key),
    ipHash: (r.ip_hash as string) ?? null,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: num(r.updated_at),
  };
}
const COLS: Record<keyof TrialPatch, string> = {
  companyName: "company_name",
  configuration: "configuration",
  state: "state",
  verificationTokenHash: "verification_token_hash",
  verificationExpiresAt: "verification_expires_at",
  verifiedAt: "verified_at",
  tenantId: "tenant_id",
  startsAt: "starts_at",
  endsAt: "ends_at",
  extensionsUsed: "extensions_used",
  extensionRequestedAt: "extension_requested_at",
  extensionReason: "extension_reason",
  suspendedReason: "suspended_reason",
  convertedSubscriptionId: "converted_subscription_id",
  ipHash: "ip_hash",
  updatedAt: "updated_at",
};
const dup = (e: unknown, key: string) => (e as { code?: string }).code === "ER_DUP_ENTRY" && new RegExp(key).test((e as Error).message);

export class MysqlTrialStore implements TrialStore {
  constructor(
    private pool: mysql.Pool,
    /** Registro de eventos comerciales (0015); sin él, todo funciona igual y no se registra nada. */
    private commercialEvents?: CommercialEventSink,
  ) {}
  async insert(t: Omit<TrialRequest, "id" | "version" | "updatedAt">, actor: string) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [res] = await c.query<mysql.ResultSetHeader>(
        `INSERT INTO trial_requests (email, email_domain, company_name, configuration, state, verification_token_hash, verification_expires_at, verified_at,
           tenant_id, starts_at, ends_at, extensions_used, extension_requested_at, extension_reason, suspended_reason, converted_subscription_id,
           idempotency_key, ip_hash, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        [
          t.email, t.emailDomain, t.companyName, JSON.stringify(t.configuration), t.state, t.verificationTokenHash, t.verificationExpiresAt, t.verifiedAt,
          t.tenantId, t.startsAt, t.endsAt, t.extensionsUsed, t.extensionRequestedAt, t.extensionReason, t.suspendedReason, t.convertedSubscriptionId,
          t.idempotencyKey, t.ipHash, t.createdAt,
        ],
      );
      await c.query("INSERT INTO trial_events (trial_id, action, from_state, to_state, version, actor, created_at) VALUES (?, 'registered', NULL, ?, 1, ?, ?)", [res.insertId, t.state, actor, t.createdAt]);
      if (this.commercialEvents) await this.commercialEvents.append(c, trialChanged({ ...t, id: res.insertId, version: 1, updatedAt: null }, "registered", null, actor, t.createdAt));
      await c.commit();
      // Con la MISMA conexión: pedir otra al pool mientras se retiene esta bloquea para siempre cuando
      // hay tantas altas simultáneas como conexiones (cada una espera una conexión que nadie suelta)
      const [after] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE id = ?", [res.insertId]);
      return row(after[0]);
    } catch (e) {
      await c.rollback().catch(() => undefined);
      if (dup(e, "uq_trial_idempotency")) throw new TrialConflict("duplicate_key", "Solicitud repetida");
      if (dup(e, "uq_trial_open_email") || dup(e, "uq_trial_open_mailbox")) throw new TrialConflict("duplicate_email", "Ya hay una prueba abierta con ese correo");
      throw e;
    } finally {
      c.release();
    }
  }
  async byIdempotencyKey(key: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE idempotency_key = ?", [key]);
    return r[0] ? row(r[0]) : null;
  }
  async openByEmail(email: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE open_email = ?", [email]);
    return r[0] ? row(r[0]) : null;
  }
  async openByAlias(base: string, domain: string) {
    // Prefijo constante: usa el índice único de `open_email` (rango) y solo ve pruebas abiertas
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE open_email = ? OR open_email LIKE ? ESCAPE '!' ORDER BY id LIMIT 1", [
      `${base}@${domain}`,
      `${likeLiteral(base)}+%@${likeLiteral(domain)}`,
    ]);
    return r[0] ? row(r[0]) : null;
  }
  async openByMailbox(mailbox: string, alias: { base: string; domain: string }) {
    try {
      const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE open_mailbox = ?", [mailbox]);
      return r[0] ? row(r[0]) : null;
    } catch (e) {
      // Sin la migración 0023 todavía: la búsqueda por alias +etiqueta de siempre
      if ((e as { code?: string }).code === "ER_BAD_FIELD_ERROR") return this.openByAlias(alias.base, alias.domain);
      throw e;
    }
  }
  async note(trialId: number, e: { action: "notice_queued"; detail: string; actor: string; at: number }) {
    await this.pool.query(
      "INSERT INTO trial_events (trial_id, action, from_state, to_state, version, detail, actor, created_at) SELECT id, ?, state, state, version, ?, ?, ? FROM trial_requests WHERE id = ?",
      [e.action, e.detail.slice(0, 300), e.actor, e.at, trialId],
    );
  }
  async get(id: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE id = ?", [id]);
    return r[0] ? row(r[0]) : null;
  }
  async transition(id: number, expectedVersion: number, patch: TrialPatch, e: { action: TrialAction; fromState: TrialState; detail: string | null; actor: string; at: number }) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const entries = Object.entries({ ...patch, updatedAt: e.at }) as Array<[keyof TrialPatch, unknown]>;
      const [res] = await c.query<mysql.ResultSetHeader>(
        `UPDATE trial_requests SET ${entries.map(([k]) => `${COLS[k]} = ?`).join(", ")}, version = version + 1 WHERE id = ? AND version = ?`,
        [...entries.map(([k, v]) => (k === "configuration" ? JSON.stringify(v) : v)), id, expectedVersion],
      );
      if (res.affectedRows !== 1) throw new TrialConflict("version_conflict", "La solicitud cambió mientras tanto; recarga");
      const [after] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM trial_requests WHERE id = ?", [id]);
      const t = row(after[0]);
      await c.query("INSERT INTO trial_events (trial_id, action, from_state, to_state, version, detail, actor, created_at) VALUES (?,?,?,?,?,?,?,?)", [
        id, e.action, e.fromState, t.state, t.version, e.detail, e.actor, e.at,
      ]);
      if (this.commercialEvents) await this.commercialEvents.append(c, trialChanged(t, e.action, e.fromState, e.actor, e.at));
      await c.commit();
      return t;
    } catch (err) {
      await c.rollback().catch(() => undefined);
      if (dup(err, "uq_trial_tenant")) throw new TrialConflict("duplicate_tenant", "Ese tenant ya pertenece a otra prueba");
      throw err;
    } finally {
      c.release();
    }
  }
  async count(f: { state?: TrialState; emailDomain?: string; ipHash?: string; since?: number }) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (f.state) (w.push("state = ?"), a.push(f.state));
    if (f.emailDomain) (w.push("email_domain = ?"), a.push(f.emailDomain));
    if (f.ipHash) (w.push("ip_hash = ?"), a.push(f.ipHash));
    if (f.since !== undefined) (w.push("created_at >= ?"), a.push(f.since));
    const [r] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM trial_requests${w.length ? ` WHERE ${w.join(" AND ")}` : ""}`, a);
    return Number(r[0].n);
  }
  async list(f: TrialListFilter) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (f.states?.length) (w.push(`state IN (${f.states.map(() => "?").join(",")})`), a.push(...f.states));
    if (f.endsBefore !== undefined) (w.push("ends_at IS NOT NULL AND ends_at <= ?"), a.push(f.endsBefore));
    if (f.extensionRequested !== undefined) w.push(f.extensionRequested ? "extension_requested_at IS NOT NULL" : "extension_requested_at IS NULL");
    if (f.verificationExpiredBefore !== undefined) (w.push("verification_expires_at IS NOT NULL AND verification_expires_at <= ?"), a.push(f.verificationExpiredBefore));
    if (f.createdBefore !== undefined) (w.push("created_at <= ?"), a.push(f.createdBefore));
    const [r] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT * FROM trial_requests${w.length ? ` WHERE ${w.join(" AND ")}` : ""} ORDER BY id LIMIT ?`, [...a, Math.min(f.limit ?? 200, 1000)]);
    return r.map(row);
  }
  async events(trialId: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM trial_events WHERE trial_id = ? ORDER BY id", [trialId]);
    return r.map((x) => ({
      id: Number(x.id),
      trialId: Number(x.trial_id),
      action: x.action,
      fromState: (x.from_state as TrialState) ?? null,
      toState: x.to_state as TrialState,
      version: Number(x.version),
      detail: (x.detail as string) ?? null,
      actor: String(x.actor),
      createdAt: Number(x.created_at),
    }));
  }
}
