/**
 * Persistencia de los acuerdos de condiciones personalizadas (BD del CRM, migración 0048) + implementación en memoria.
 *
 * - Un borrador se guarda por REVISIONES: cada guardado escribe partidas y ajustes nuevos con la revisión siguiente y
 *   comprueba la revisión leída (dos administradores no se pisan). Nada se reescribe ni se borra.
 * - Todo cambio escribe su evento en el historial (solo inserciones) en la misma transacción.
 */
import type mysql from "mysql2/promise";
import type { Adjustment, Terms, TermsLine, TermsStatus } from "./model";

export type AcceptanceStatus = "not_required" | "pending" | "accepted" | "rejected" | "expired";
export type SyncStatus = "none" | "pending" | "synced" | "failed";

export interface TermsRecord extends Terms {
  acceptanceStatus: AcceptanceStatus;
  contractId: number | null;
  contractVersion: number | null;
  acceptanceId: number | null;
  reason: string;
  /** Versión del borrador (concurrencia optimista). */
  revision: number;
  /** Resumen económico congelado al activar. */
  summary: unknown | null;
  inputHash: string | null;
  syncStatus: SyncStatus;
  syncDetail: unknown | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number | null;
  updatedBy: string | null;
  activatedAt: number | null;
  activatedBy: string | null;
  closedAt: number | null;
}

export interface TermsEvent {
  id: number;
  termsId: number;
  companyId: number;
  subscriptionId: number | null;
  kind: string;
  before: unknown;
  after: unknown;
  reason: string;
  actor: string;
  effectiveAt: number | null;
  acceptanceStatus: string | null;
  syncResult: string | null;
  economic: unknown;
  createdAt: number;
}
export type TermsEventDraft = Pick<TermsEvent, "kind" | "before" | "after" | "reason" | "actor" | "effectiveAt" | "acceptanceStatus" | "syncResult" | "economic">;

export type LineDraft = Omit<TermsLine, "id">;
/** El ajuste señala su partida por la referencia estable (`ref`); null = global. */
export type AdjustmentDraft = Omit<Adjustment, "id" | "lineId"> & { lineRef: string | null };

export type TermsHead = Pick<
  TermsRecord,
  "companyId" | "subscriptionId" | "pricingMode" | "globalAmountCents" | "interval" | "currency" | "presentation" | "packageName" | "conditions" | "effectiveFrom" | "effectiveTo" | "afterEnd" | "nextTermsId" | "requiresAcceptance" | "reason"
>;
export type TermsPatch = Partial<
  Pick<
    TermsRecord,
    | "status"
    | "versionNo"
    | "subscriptionId"
    | "effectiveFrom"
    | "effectiveTo"
    | "nextTermsId"
    | "acceptanceStatus"
    | "contractId"
    | "contractVersion"
    | "acceptanceId"
    | "summary"
    | "inputHash"
    | "syncStatus"
    | "syncDetail"
    | "activatedAt"
    | "activatedBy"
    | "closedAt"
  >
>;

export class TermsConflict extends Error {
  constructor(public readonly current: number) {
    super(`Otra persona modificó estas condiciones antes (revisión actual ${current}). Recarga para no perder cambios.`);
    this.name = "TermsConflict";
  }
}

export interface TermsStore {
  create(head: TermsHead, lines: LineDraft[], adjustments: AdjustmentDraft[], event: TermsEventDraft, now: number): Promise<TermsRecord>;
  /** Guarda una revisión nueva del borrador (cabecera, partidas y ajustes). */
  saveDraft(id: number, expectedRevision: number, head: Omit<TermsHead, "companyId" | "subscriptionId">, lines: LineDraft[], adjustments: AdjustmentDraft[], event: TermsEventDraft, now: number): Promise<TermsRecord>;
  /** Cambia el estado u otros datos de gestión; con `expectedRevision`, solo si nadie lo tocó. Sube la revisión. */
  patch(id: number, patch: TermsPatch, event: TermsEventDraft | null, now: number, expectedRevision?: number): Promise<TermsRecord>;
  get(id: number): Promise<TermsRecord | null>;
  list(f: { subscriptionId?: number; companyId?: number; status?: TermsStatus[] }): Promise<TermsRecord[]>;
  events(f: { termsId?: number; subscriptionId?: number; companyId?: number }): Promise<TermsEvent[]>;
  /** Solo registra un evento (p. ej. un intento rechazado o el resultado de una sincronización). */
  log(termsId: number, event: TermsEventDraft, now: number): Promise<void>;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ── Memoria (pruebas y desarrollo) ──────────────────────────────────────────────

export class MemoryTermsStore implements TermsStore {
  private rows = new Map<number, TermsRecord>();
  private evs: TermsEvent[] = [];
  private seq = 0;

  private build(lines: LineDraft[], adjustments: AdjustmentDraft[]) {
    const ls: TermsLine[] = lines.map((l) => ({ ...clone(l), id: ++this.seq }));
    const as: Adjustment[] = adjustments.map(({ lineRef, ...a }) => {
      const line = lineRef === null ? null : ls.find((l) => l.ref === lineRef);
      if (lineRef !== null && !line) throw new Error("Un ajuste apunta a una partida que no existe");
      return { ...clone(a), id: ++this.seq, lineId: line ? line.id : null };
    });
    return { lines: ls, adjustments: as };
  }
  private push(t: TermsRecord, e: TermsEventDraft, now: number) {
    this.evs.push({ ...clone(e), id: ++this.seq, termsId: t.id, companyId: t.companyId, subscriptionId: t.subscriptionId, createdAt: now });
  }

  async create(head: TermsHead, lines: LineDraft[], adjustments: AdjustmentDraft[], event: TermsEventDraft, now: number) {
    const id = ++this.seq;
    const built = this.build(lines, adjustments);
    const row: TermsRecord = {
      ...clone(head),
      ...built,
      id,
      versionNo: 1 + Array.from(this.rows.values()).filter((r) => r.companyId === head.companyId && r.subscriptionId === head.subscriptionId).length,
      status: "draft",
      acceptanceStatus: head.requiresAcceptance ? "pending" : "not_required",
      contractId: null,
      contractVersion: null,
      acceptanceId: null,
      revision: 1,
      summary: null,
      inputHash: null,
      syncStatus: "none",
      syncDetail: null,
      createdAt: now,
      createdBy: event.actor,
      updatedAt: null,
      updatedBy: null,
      activatedAt: null,
      activatedBy: null,
      closedAt: null,
    };
    this.rows.set(id, row);
    this.push(row, event, now);
    return clone(row);
  }

  async saveDraft(id: number, expectedRevision: number, head: Omit<TermsHead, "companyId" | "subscriptionId">, lines: LineDraft[], adjustments: AdjustmentDraft[], event: TermsEventDraft, now: number) {
    const cur = this.rows.get(id);
    if (!cur) throw new Error("Condiciones no encontradas");
    if (cur.revision !== expectedRevision) throw new TermsConflict(cur.revision);
    const next: TermsRecord = { ...cur, ...clone(head), ...this.build(lines, adjustments), acceptanceStatus: head.requiresAcceptance ? "pending" : "not_required", revision: cur.revision + 1, updatedAt: now, updatedBy: event.actor };
    this.rows.set(id, next);
    this.push(next, event, now);
    return clone(next);
  }

  async patch(id: number, patch: TermsPatch, event: TermsEventDraft | null, now: number, expectedRevision?: number) {
    const cur = this.rows.get(id);
    if (!cur) throw new Error("Condiciones no encontradas");
    if (expectedRevision !== undefined && cur.revision !== expectedRevision) throw new TermsConflict(cur.revision);
    const next: TermsRecord = { ...cur, ...clone(patch), revision: cur.revision + 1, updatedAt: now, updatedBy: event?.actor ?? cur.updatedBy };
    this.rows.set(id, next);
    if (event) this.push(next, event, now);
    return clone(next);
  }

  async get(id: number) {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async list(f: { subscriptionId?: number; companyId?: number; status?: TermsStatus[] }) {
    return Array.from(this.rows.values())
      .filter((r) => (f.subscriptionId === undefined || r.subscriptionId === f.subscriptionId) && (f.companyId === undefined || r.companyId === f.companyId) && (!f.status || f.status.includes(r.status)))
      .sort((a, b) => a.id - b.id)
      .map(clone);
  }
  async events(f: { termsId?: number; subscriptionId?: number; companyId?: number }) {
    return clone(this.evs.filter((e) => (f.termsId === undefined || e.termsId === f.termsId) && (f.subscriptionId === undefined || e.subscriptionId === f.subscriptionId) && (f.companyId === undefined || e.companyId === f.companyId)));
  }
  async log(termsId: number, event: TermsEventDraft, now: number) {
    const cur = this.rows.get(termsId);
    if (!cur) throw new Error("Condiciones no encontradas");
    this.push(cur, event, now);
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? null));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const toJson = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

function lineRow(r: Record<string, unknown>): TermsLine {
  return {
    id: Number(r.id),
    ref: String(r.line_ref),
    kind: r.line_kind as TermsLine["kind"],
    concept: r.concept as TermsLine["concept"],
    productKey: str(r.product_key),
    priceId: num(r.price_id),
    catalog: json(r.catalog_json),
    name: String(r.name),
    description: str(r.description),
    conditions: str(r.conditions),
    chargeClass: r.charge_class as TermsLine["chargeClass"],
    quantity: Number(r.quantity),
    officialUnitCents: num(r.official_unit_cents),
    negotiatedUnitCents: num(r.negotiated_unit_cents),
    taxRateBp: Number(r.tax_rate_bp),
    startsAt: num(r.starts_at),
    endsAt: num(r.ends_at),
    sort: Number(r.sort_order),
  };
}
function adjustmentRow(r: Record<string, unknown>): Adjustment {
  return {
    id: Number(r.id),
    lineId: num(r.line_id),
    type: r.adjustment_type as Adjustment["type"],
    mode: r.adjustment_mode as Adjustment["mode"],
    value: Number(r.value),
    recurrence: r.recurrence as Adjustment["recurrence"],
    endsAt: num(r.ends_at),
    note: str(r.note),
  };
}
function headRow(r: Record<string, unknown>): Omit<TermsRecord, "lines" | "adjustments"> {
  return {
    id: Number(r.id),
    companyId: Number(r.company_id),
    subscriptionId: num(r.subscription_id),
    versionNo: Number(r.version_no),
    status: r.status as TermsStatus,
    pricingMode: r.pricing_mode as TermsRecord["pricingMode"],
    globalAmountCents: num(r.global_amount_cents),
    interval: r.billing_interval as TermsRecord["interval"],
    currency: String(r.currency),
    presentation: r.presentation as TermsRecord["presentation"],
    packageName: str(r.package_name),
    conditions: str(r.conditions),
    effectiveFrom: num(r.effective_from),
    effectiveTo: num(r.effective_to),
    afterEnd: (r.after_end as TermsRecord["afterEnd"]) ?? null,
    nextTermsId: num(r.next_terms_id),
    requiresAcceptance: Number(r.requires_acceptance) === 1,
    acceptanceStatus: r.acceptance_status as AcceptanceStatus,
    contractId: num(r.contract_id),
    contractVersion: num(r.contract_version),
    acceptanceId: num(r.acceptance_id),
    reason: String(r.reason),
    revision: Number(r.revision),
    summary: json(r.summary_json),
    inputHash: str(r.input_hash),
    syncStatus: r.sync_status as SyncStatus,
    syncDetail: json(r.sync_detail),
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
    updatedAt: num(r.updated_at),
    updatedBy: str(r.updated_by),
    activatedAt: num(r.activated_at),
    activatedBy: str(r.activated_by),
    closedAt: num(r.closed_at),
  };
}

const PATCH_COLS: Record<keyof TermsPatch, string> = {
  status: "status",
  versionNo: "version_no",
  subscriptionId: "subscription_id",
  effectiveFrom: "effective_from",
  effectiveTo: "effective_to",
  nextTermsId: "next_terms_id",
  acceptanceStatus: "acceptance_status",
  contractId: "contract_id",
  contractVersion: "contract_version",
  acceptanceId: "acceptance_id",
  summary: "summary_json",
  inputHash: "input_hash",
  syncStatus: "sync_status",
  syncDetail: "sync_detail",
  activatedAt: "activated_at",
  activatedBy: "activated_by",
  closedAt: "closed_at",
};
const JSON_PATCH = new Set<keyof TermsPatch>(["summary", "syncDetail"]);

type Conn = mysql.Pool | mysql.PoolConnection;

export class MysqlTermsStore implements TermsStore {
  constructor(private pool: mysql.Pool) {}

  private async inTx<T>(fn: (c: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const out = await fn(c);
      await c.commit();
      return out;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  private async insertParts(c: Conn, id: number, revision: number, lines: LineDraft[], adjustments: AdjustmentDraft[]) {
    const ids = new Map<string, number>();
    for (const l of lines) {
      const [res] = await c.query<mysql.ResultSetHeader>(
        `INSERT INTO commercial_terms_lines (terms_id, revision, line_kind, line_ref, concept, product_key, price_id, catalog_json, name, description, conditions,
           charge_class, quantity, official_unit_cents, negotiated_unit_cents, tax_rate_bp, starts_at, ends_at, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, revision, l.kind, l.ref, l.concept, l.productKey, l.priceId, toJson(l.catalog), l.name, l.description, l.conditions, l.chargeClass, l.quantity, l.officialUnitCents, l.negotiatedUnitCents, l.taxRateBp, l.startsAt, l.endsAt, l.sort],
      );
      ids.set(l.ref, res.insertId);
    }
    for (const a of adjustments) {
      if (a.lineRef !== null && !ids.has(a.lineRef)) throw new Error("Un ajuste apunta a una partida que no existe");
      await c.query("INSERT INTO commercial_terms_adjustments (terms_id, revision, line_id, adjustment_type, adjustment_mode, value, recurrence, ends_at, note) VALUES (?,?,?,?,?,?,?,?,?)", [
        id,
        revision,
        a.lineRef === null ? null : ids.get(a.lineRef)!,
        a.type,
        a.mode,
        a.value,
        a.recurrence,
        a.endsAt,
        a.note,
      ]);
    }
  }
  private async insertEvent(c: Conn, t: Pick<TermsRecord, "id" | "companyId" | "subscriptionId">, e: TermsEventDraft, now: number) {
    await c.query(
      "INSERT INTO commercial_terms_events (terms_id, company_id, subscription_id, kind, before_json, after_json, reason, actor, effective_at, acceptance_status, sync_result, economic_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [t.id, t.companyId, t.subscriptionId, e.kind, toJson(e.before), toJson(e.after), e.reason, e.actor, e.effectiveAt, e.acceptanceStatus, e.syncResult, toJson(e.economic), now],
    );
  }
  private async load(c: Conn, id: number, lock = false): Promise<TermsRecord | null> {
    const [rows] = await c.query<mysql.RowDataPacket[]>(`SELECT * FROM commercial_terms WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!rows[0]) return null;
    const head = headRow(rows[0]);
    const [ls] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_terms_lines WHERE terms_id = ? AND revision = (SELECT MAX(revision) FROM commercial_terms_lines WHERE terms_id = ?) ORDER BY sort_order, id", [id, id]);
    const [as] = ls.length ? await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_terms_adjustments WHERE terms_id = ? AND revision = ? ORDER BY id", [id, Number(ls[0].revision)]) : [[] as mysql.RowDataPacket[]];
    return { ...head, lines: ls.map(lineRow), adjustments: as.map(adjustmentRow) };
  }

  create(head: TermsHead, lines: LineDraft[], adjustments: AdjustmentDraft[], event: TermsEventDraft, now: number) {
    return this.inTx(async (c) => {
      // Bloqueo de la empresa: dos altas simultáneas no reciben el mismo número de versión
      await c.query("SELECT id FROM crm_companies WHERE id = ? FOR UPDATE", [head.companyId]);
      const [n] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM commercial_terms WHERE company_id = ? AND subscription_id <=> ?", [head.companyId, head.subscriptionId]);
      const [res] = await c.query<mysql.ResultSetHeader>(
        `INSERT INTO commercial_terms (company_id, subscription_id, version_no, status, pricing_mode, global_amount_cents, billing_interval, currency, presentation, package_name,
           conditions, effective_from, effective_to, after_end, next_terms_id, requires_acceptance, acceptance_status, reason, revision, created_at, created_by)
         VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        [
          head.companyId, head.subscriptionId, Number(n[0].n) + 1, head.pricingMode, head.globalAmountCents, head.interval, head.currency, head.presentation, head.packageName,
          head.conditions, head.effectiveFrom, head.effectiveTo, head.afterEnd, head.nextTermsId, head.requiresAcceptance ? 1 : 0, head.requiresAcceptance ? "pending" : "not_required", head.reason, now, event.actor,
        ],
      );
      await this.insertParts(c, res.insertId, 1, lines, adjustments);
      await this.insertEvent(c, { id: res.insertId, companyId: head.companyId, subscriptionId: head.subscriptionId }, event, now);
      return (await this.load(c, res.insertId))!;
    });
  }

  saveDraft(id: number, expectedRevision: number, head: Omit<TermsHead, "companyId" | "subscriptionId">, lines: LineDraft[], adjustments: AdjustmentDraft[], event: TermsEventDraft, now: number) {
    return this.inTx(async (c) => {
      const cur = await this.load(c, id, true);
      if (!cur) throw new Error("Condiciones no encontradas");
      if (cur.revision !== expectedRevision) throw new TermsConflict(cur.revision);
      const [upd] = await c.query<mysql.ResultSetHeader>(
        `UPDATE commercial_terms SET pricing_mode = ?, global_amount_cents = ?, billing_interval = ?, currency = ?, presentation = ?, package_name = ?, conditions = ?, effective_from = ?,
           effective_to = ?, after_end = ?, next_terms_id = ?, requires_acceptance = ?, acceptance_status = ?, reason = ?, revision = revision + 1, updated_at = ?, updated_by = ?
         WHERE id = ? AND revision = ?`,
        [
          head.pricingMode, head.globalAmountCents, head.interval, head.currency, head.presentation, head.packageName, head.conditions, head.effectiveFrom,
          head.effectiveTo, head.afterEnd, head.nextTermsId, head.requiresAcceptance ? 1 : 0, head.requiresAcceptance ? "pending" : "not_required", head.reason, now, event.actor, id, expectedRevision,
        ],
      );
      if (upd.affectedRows !== 1) throw new TermsConflict(cur.revision);
      await this.insertParts(c, id, expectedRevision + 1, lines, adjustments);
      await this.insertEvent(c, cur, event, now);
      return (await this.load(c, id))!;
    });
  }

  patch(id: number, patch: TermsPatch, event: TermsEventDraft | null, now: number, expectedRevision?: number) {
    return this.inTx(async (c) => {
      const cur = await this.load(c, id, true);
      if (!cur) throw new Error("Condiciones no encontradas");
      if (expectedRevision !== undefined && cur.revision !== expectedRevision) throw new TermsConflict(cur.revision);
      const sets = ["revision = revision + 1", "updated_at = ?"];
      const args: unknown[] = [now];
      if (event) {
        sets.push("updated_by = ?");
        args.push(event.actor);
      }
      for (const [k, v] of Object.entries(patch) as Array<[keyof TermsPatch, unknown]>) {
        sets.push(`${PATCH_COLS[k]} = ?`);
        args.push(JSON_PATCH.has(k) ? toJson(v) : v);
      }
      await c.query(`UPDATE commercial_terms SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
      const next = (await this.load(c, id))!;
      if (event) await this.insertEvent(c, next, event, now);
      return next;
    });
  }

  async get(id: number) {
    return this.load(this.pool, id);
  }
  async list(f: { subscriptionId?: number; companyId?: number; status?: TermsStatus[] }) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.subscriptionId !== undefined) {
      where.push("subscription_id = ?");
      args.push(f.subscriptionId);
    }
    if (f.companyId !== undefined) {
      where.push("company_id = ?");
      args.push(f.companyId);
    }
    if (f.status?.length) {
      where.push(`status IN (${f.status.map(() => "?").join(",")})`);
      args.push(...f.status);
    }
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT id FROM commercial_terms${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id LIMIT 500`, args);
    const out: TermsRecord[] = [];
    for (const r of rows) out.push((await this.load(this.pool, Number(r.id)))!);
    return out;
  }
  async events(f: { termsId?: number; subscriptionId?: number; companyId?: number }) {
    const where: string[] = [];
    const args: unknown[] = [];
    for (const [col, v] of [["terms_id", f.termsId], ["subscription_id", f.subscriptionId], ["company_id", f.companyId]] as const) {
      if (v === undefined) continue;
      where.push(`${col} = ?`);
      args.push(v);
    }
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT * FROM commercial_terms_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id LIMIT 2000`, args);
    return rows.map((r) => ({
      id: Number(r.id),
      termsId: Number(r.terms_id),
      companyId: Number(r.company_id),
      subscriptionId: num(r.subscription_id),
      kind: String(r.kind),
      before: json(r.before_json),
      after: json(r.after_json),
      reason: String(r.reason),
      actor: String(r.actor),
      effectiveAt: num(r.effective_at),
      acceptanceStatus: str(r.acceptance_status),
      syncResult: str(r.sync_result),
      economic: json(r.economic_json),
      createdAt: Number(r.created_at),
    }));
  }
  async log(termsId: number, event: TermsEventDraft, now: number) {
    const cur = await this.load(this.pool, termsId);
    if (!cur) throw new Error("Condiciones no encontradas");
    await this.insertEvent(this.pool, cur, event, now);
  }
}
