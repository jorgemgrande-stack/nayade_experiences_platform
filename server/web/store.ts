/**
 * Persistencia del catálogo comercial y los contenidos web (BD del CRM, migración 0004).
 * Guardar un borrador es atómico y con concurrencia optimista: si otro operador guardó antes
 * (versión distinta), no se pisa su trabajo.
 */
import type mysql from "mysql2/promise";
import type { EntryKind, PriceKind } from "./schemas";

export type Publication = "draft" | "published" | "unpublished";
export interface WebEntry {
  id: number;
  kind: EntryKind;
  key: string;
  family: string | null;
  sortOrder: number;
  publication: Publication;
  draft: Record<string, unknown>;
  draftVersion: number;
  published: Record<string, unknown> | null;
  publishedVersion: number | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  publishedAt: number | null;
  publishedBy: string | null;
}
export interface EntryVersion {
  version: number;
  snapshot: Record<string, unknown>;
  author: string;
  createdAt: number;
}
export type PriceStatus = "draft" | "approved" | "retired";
export interface WebPrice {
  id: number;
  entryId: number;
  kind: PriceKind;
  amountCents: number;
  currency: string;
  unit: string | null;
  taxRateBp: number;
  taxIncluded: boolean;
  status: PriceStatus;
  note: string | null;
  createdAt: number;
  createdBy: string;
  approvedAt: number | null;
  approvedBy: string | null;
  retiredAt: number | null;
  retiredBy: string | null;
}
export interface WebEvent {
  id: number;
  entity: "product" | "promotion" | "faq" | "menu" | "seo" | "page" | "forms" | "capability" | "price" | "preview";
  entityKey: string;
  action: string;
  author: string;
  detail: string | null;
  createdAt: number;
}

export class VersionConflictError extends Error {
  constructor(public current: number) {
    super("version_conflict");
  }
}
export class DuplicateEntryError extends Error {
  constructor() {
    super("duplicate_entry");
  }
}
/** El precio ya no está en el estado esperado (otra persona lo aprobó, retiró o borró antes). */
export class PriceStateError extends Error {
  constructor(public current: PriceStatus | null) {
    super("price_state");
  }
}
export interface ApprovePriceInput {
  author: string;
  now: number;
  /** Clave del producto, para la auditoría. */
  entryKey: string;
  detail: string;
}

export interface WebStore {
  listEntries(f?: { kind?: EntryKind }): Promise<WebEntry[]>;
  getEntry(kind: EntryKind, key: string): Promise<WebEntry | null>;
  /** Crea la entrada y su versión 1. */
  createEntry(e: Omit<WebEntry, "id">): Promise<WebEntry>;
  /** Nuevo borrador (versión + 1) solo si la versión actual es `expected`. */
  saveDraft(id: number, expected: number, draft: Record<string, unknown>, sortOrder: number, author: string, now: number): Promise<WebEntry>;
  setPublication(id: number, p: Pick<WebEntry, "publication" | "published" | "publishedVersion" | "publishedAt" | "publishedBy" | "updatedAt" | "updatedBy">): Promise<WebEntry>;
  versions(entryId: number): Promise<EntryVersion[]>;
  listPrices(entryId?: number): Promise<WebPrice[]>;
  getPrice(id: number): Promise<WebPrice | null>;
  insertPrice(p: Omit<WebPrice, "id">): Promise<WebPrice>;
  /** Solo cambia estado y sellos de aprobación/retirada: el importe es inmutable. */
  setPriceStatus(id: number, p: Pick<WebPrice, "status" | "approvedAt" | "approvedBy" | "retiredAt" | "retiredBy">): Promise<WebPrice>;
  /**
   * Aprueba un precio en borrador y retira el vigente del mismo tipo, moneda y unidad en UNA
   * operación atómica (con su auditoría). Si el precio ya no está en borrador: `PriceStateError`.
   */
  approvePrice(id: number, a: ApprovePriceInput): Promise<{ approved: WebPrice; retired: WebPrice[] }>;
  /** `false` si ya no era un borrador (nada se borra). */
  deleteDraftPrice(id: number): Promise<boolean>;
  addEvent(e: Omit<WebEvent, "id">): Promise<void>;
  listEvents(f?: { entity?: string; key?: string; limit?: number }): Promise<WebEvent[]>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class MemoryWebStore implements WebStore {
  private entries = new Map<number, WebEntry>();
  private vers = new Map<number, EntryVersion[]>();
  private prices = new Map<number, WebPrice>();
  private events: WebEvent[] = [];
  private seq = 0;

  async listEntries(f: { kind?: EntryKind } = {}) {
    return Array.from(this.entries.values())
      .filter((e) => !f.kind || e.kind === f.kind)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map(clone);
  }
  async getEntry(kind: EntryKind, key: string) {
    const e = Array.from(this.entries.values()).find((x) => x.kind === kind && x.key === key);
    return e ? clone(e) : null;
  }
  async createEntry(e: Omit<WebEntry, "id">) {
    if (await this.getEntry(e.kind, e.key)) throw new DuplicateEntryError();
    const full = { ...clone(e), id: ++this.seq };
    this.entries.set(full.id, full);
    this.vers.set(full.id, [{ version: full.draftVersion, snapshot: clone(full.draft), author: full.createdBy, createdAt: full.createdAt }]);
    return clone(full);
  }
  async saveDraft(id: number, expected: number, draft: Record<string, unknown>, sortOrder: number, author: string, now: number) {
    const e = this.entries.get(id)!;
    if (e.draftVersion !== expected) throw new VersionConflictError(e.draftVersion);
    const next = { ...e, draft: clone(draft), sortOrder, draftVersion: e.draftVersion + 1, updatedAt: now, updatedBy: author };
    this.entries.set(id, next);
    this.vers.get(id)!.push({ version: next.draftVersion, snapshot: clone(draft), author, createdAt: now });
    return clone(next);
  }
  async setPublication(id: number, p: Parameters<WebStore["setPublication"]>[1]) {
    const next = { ...this.entries.get(id)!, ...clone(p) };
    this.entries.set(id, next);
    return clone(next);
  }
  async versions(entryId: number) {
    return clone(this.vers.get(entryId) ?? []).reverse();
  }
  async listPrices(entryId?: number) {
    return Array.from(this.prices.values())
      .filter((p) => entryId === undefined || p.entryId === entryId)
      .sort((a, b) => b.id - a.id)
      .map(clone);
  }
  async getPrice(id: number) {
    const p = this.prices.get(id);
    return p ? clone(p) : null;
  }
  async insertPrice(p: Omit<WebPrice, "id">) {
    const full = { ...clone(p), id: ++this.seq };
    this.prices.set(full.id, full);
    return clone(full);
  }
  async setPriceStatus(id: number, p: Parameters<WebStore["setPriceStatus"]>[1]) {
    const next = { ...this.prices.get(id)!, ...p };
    this.prices.set(id, next);
    return clone(next);
  }
  // Sin `await` intermedios: en memoria la operación es atómica.
  async approvePrice(id: number, a: ApprovePriceInput) {
    const p = this.prices.get(id);
    if (!p || p.status !== "draft") throw new PriceStateError(p?.status ?? null);
    const retired: WebPrice[] = [];
    for (const old of Array.from(this.prices.values())) {
      if (old.entryId === p.entryId && old.status === "approved" && old.kind === p.kind && old.currency === p.currency && old.unit === p.unit) {
        const r = { ...old, status: "retired" as const, retiredAt: a.now, retiredBy: a.author };
        this.prices.set(old.id, r);
        retired.push(clone(r));
        this.events.push({ id: ++this.seq, entity: "price", entityKey: `${a.entryKey}#${old.id}`, action: "retire", author: a.author, detail: `Sustituido por #${id}`, createdAt: a.now });
      }
    }
    const approved = { ...p, status: "approved" as const, approvedAt: a.now, approvedBy: a.author, retiredAt: null, retiredBy: null };
    this.prices.set(id, approved);
    this.events.push({ id: ++this.seq, entity: "price", entityKey: `${a.entryKey}#${id}`, action: "approve", author: a.author, detail: a.detail, createdAt: a.now });
    return { approved: clone(approved), retired };
  }
  async deleteDraftPrice(id: number) {
    if (this.prices.get(id)?.status !== "draft") return false;
    this.prices.delete(id);
    return true;
  }
  async addEvent(e: Omit<WebEvent, "id">) {
    this.events.push({ ...e, id: ++this.seq });
  }
  async listEvents(f: { entity?: string; key?: string; limit?: number } = {}) {
    return this.events
      .filter((e) => (!f.entity || e.entity === f.entity) && (!f.key || e.entityKey === f.key))
      .slice()
      .reverse()
      .slice(0, f.limit ?? 100)
      .map(clone);
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function entryRow(r: Record<string, unknown>): WebEntry {
  return {
    id: Number(r.id),
    kind: r.kind as EntryKind,
    key: String(r.entry_key),
    family: (r.family as string) ?? null,
    sortOrder: Number(r.sort_order),
    publication: r.publication as Publication,
    draft: json(r.draft),
    draftVersion: Number(r.draft_version),
    published: r.published === null ? null : json(r.published),
    publishedVersion: num(r.published_version),
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
    updatedAt: Number(r.updated_at),
    updatedBy: String(r.updated_by),
    publishedAt: num(r.published_at),
    publishedBy: (r.published_by as string) ?? null,
  };
}
function priceRow(r: Record<string, unknown>): WebPrice {
  return {
    id: Number(r.id),
    entryId: Number(r.entry_id),
    kind: r.kind as PriceKind,
    amountCents: Number(r.amount_cents),
    currency: String(r.currency),
    unit: (r.unit as string) ?? null,
    taxRateBp: Number(r.tax_rate_bp),
    taxIncluded: Number(r.tax_included) === 1,
    status: r.status as PriceStatus,
    note: (r.note as string) ?? null,
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
    approvedAt: num(r.approved_at),
    approvedBy: (r.approved_by as string) ?? null,
    retiredAt: num(r.retired_at),
    retiredBy: (r.retired_by as string) ?? null,
  };
}

export class MysqlWebStore implements WebStore {
  constructor(private pool: mysql.Pool) {}

  async listEntries(f: { kind?: EntryKind } = {}) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM web_entries${f.kind ? " WHERE kind = ?" : ""} ORDER BY sort_order, id`,
      f.kind ? [f.kind] : [],
    );
    return rows.map(entryRow);
  }
  async getEntry(kind: EntryKind, key: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM web_entries WHERE kind = ? AND entry_key = ?", [kind, key]);
    return rows[0] ? entryRow(rows[0]) : null;
  }
  private async byId(c: Pick<mysql.Pool, "query">, id: number) {
    const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM web_entries WHERE id = ?", [id]);
    return entryRow(rows[0]);
  }
  async createEntry(e: Omit<WebEntry, "id">) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [res] = await c.query<mysql.ResultSetHeader>(
        `INSERT INTO web_entries (kind, entry_key, family, sort_order, publication, draft, draft_version, published, published_version,
           created_at, created_by, updated_at, updated_by, published_at, published_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [e.kind, e.key, e.family, e.sortOrder, e.publication, JSON.stringify(e.draft), e.draftVersion, e.published ? JSON.stringify(e.published) : null, e.publishedVersion, e.createdAt, e.createdBy, e.updatedAt, e.updatedBy, e.publishedAt, e.publishedBy],
      );
      await c.query("INSERT INTO web_entry_versions (entry_id, version, snapshot, author, created_at) VALUES (?,?,?,?,?)", [res.insertId, e.draftVersion, JSON.stringify(e.draft), e.createdBy, e.createdAt]);
      await c.commit();
      return this.byId(c, res.insertId);
    } catch (err) {
      await c.rollback();
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw new DuplicateEntryError();
      throw err;
    } finally {
      c.release();
    }
  }
  async saveDraft(id: number, expected: number, draft: Record<string, unknown>, sortOrder: number, author: string, now: number) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [res] = await c.query<mysql.ResultSetHeader>(
        "UPDATE web_entries SET draft = ?, sort_order = ?, draft_version = draft_version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND draft_version = ?",
        [JSON.stringify(draft), sortOrder, now, author, id, expected],
      );
      if (res.affectedRows !== 1) {
        await c.rollback();
        throw new VersionConflictError((await this.byId(c, id)).draftVersion);
      }
      await c.query("INSERT INTO web_entry_versions (entry_id, version, snapshot, author, created_at) VALUES (?,?,?,?,?)", [id, expected + 1, JSON.stringify(draft), author, now]);
      await c.commit();
      return this.byId(c, id);
    } catch (err) {
      if (!(err instanceof VersionConflictError)) await c.rollback().catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
  async setPublication(id: number, p: Parameters<WebStore["setPublication"]>[1]) {
    await this.pool.query(
      "UPDATE web_entries SET publication = ?, published = ?, published_version = ?, published_at = ?, published_by = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      [p.publication, p.published ? JSON.stringify(p.published) : null, p.publishedVersion, p.publishedAt, p.publishedBy, p.updatedAt, p.updatedBy, id],
    );
    return this.byId(this.pool, id);
  }
  async versions(entryId: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM web_entry_versions WHERE entry_id = ? ORDER BY version DESC LIMIT 200", [entryId]);
    return rows.map((r) => ({ version: Number(r.version), snapshot: json(r.snapshot), author: String(r.author), createdAt: Number(r.created_at) }));
  }
  async listPrices(entryId?: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM web_prices${entryId === undefined ? "" : " WHERE entry_id = ?"} ORDER BY id DESC LIMIT 5000`,
      entryId === undefined ? [] : [entryId],
    );
    return rows.map(priceRow);
  }
  async getPrice(id: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM web_prices WHERE id = ?", [id]);
    return rows[0] ? priceRow(rows[0]) : null;
  }
  async insertPrice(p: Omit<WebPrice, "id">) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO web_prices (entry_id, kind, amount_cents, currency, unit, tax_rate_bp, tax_included, status, note, created_at, created_by,
         approved_at, approved_by, retired_at, retired_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.entryId, p.kind, p.amountCents, p.currency, p.unit, p.taxRateBp, p.taxIncluded ? 1 : 0, p.status, p.note, p.createdAt, p.createdBy, p.approvedAt, p.approvedBy, p.retiredAt, p.retiredBy],
    );
    return (await this.getPrice(res.insertId))!;
  }
  async setPriceStatus(id: number, p: Parameters<WebStore["setPriceStatus"]>[1]) {
    await this.pool.query("UPDATE web_prices SET status = ?, approved_at = ?, approved_by = ?, retired_at = ?, retired_by = ? WHERE id = ?", [p.status, p.approvedAt, p.approvedBy, p.retiredAt, p.retiredBy, id]);
    return (await this.getPrice(id))!;
  }
  /**
   * Una sola transacción: bloquea la fila del producto (serializa las aprobaciones concurrentes
   * del mismo producto), relee sus precios bajo bloqueo, retira el vigente equivalente, aprueba y
   * audita. El índice único de la migración 0005 respalda la invariante en la propia BD.
   */
  async approvePrice(id: number, a: ApprovePriceInput) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [heads] = await c.query<mysql.RowDataPacket[]>("SELECT entry_id FROM web_prices WHERE id = ?", [id]);
      if (!heads[0]) throw new PriceStateError(null);
      const entryId = Number(heads[0].entry_id);
      await c.query("SELECT id FROM web_entries WHERE id = ? FOR UPDATE", [entryId]);
      const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM web_prices WHERE entry_id = ? FOR UPDATE", [entryId]);
      const all = rows.map(priceRow);
      const p = all.find((x) => x.id === id);
      if (!p || p.status !== "draft") throw new PriceStateError(p?.status ?? null);
      const olds = all.filter((x) => x.status === "approved" && x.kind === p.kind && x.currency === p.currency && x.unit === p.unit);
      for (const old of olds) {
        await c.query("UPDATE web_prices SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ? AND status = 'approved'", [a.now, a.author, old.id]);
        await c.query("INSERT INTO web_events (entity, entity_key, action, author, detail, created_at) VALUES ('price', ?, 'retire', ?, ?, ?)", [`${a.entryKey}#${old.id}`, a.author, `Sustituido por #${id}`, a.now]);
      }
      const [res] = await c.query<mysql.ResultSetHeader>(
        "UPDATE web_prices SET status = 'approved', approved_at = ?, approved_by = ?, retired_at = NULL, retired_by = NULL WHERE id = ? AND status = 'draft'",
        [a.now, a.author, id],
      );
      if (res.affectedRows !== 1) throw new PriceStateError(null);
      await c.query("INSERT INTO web_events (entity, entity_key, action, author, detail, created_at) VALUES ('price', ?, 'approve', ?, ?, ?)", [`${a.entryKey}#${id}`, a.author, a.detail, a.now]);
      await c.commit();
      const [after] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM web_prices WHERE entry_id = ?", [entryId]);
      const byId = new Map(after.map((r) => [Number(r.id), priceRow(r)]));
      return { approved: byId.get(id)!, retired: olds.map((o) => byId.get(o.id)!) };
    } catch (err) {
      await c.rollback().catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
  async deleteDraftPrice(id: number) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>("DELETE FROM web_prices WHERE id = ? AND status = 'draft'", [id]);
    return res.affectedRows === 1;
  }
  async addEvent(e: Omit<WebEvent, "id">) {
    await this.pool.query("INSERT INTO web_events (entity, entity_key, action, author, detail, created_at) VALUES (?,?,?,?,?,?)", [e.entity, e.entityKey, e.action, e.author, e.detail, e.createdAt]);
  }
  async listEvents(f: { entity?: string; key?: string; limit?: number } = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.entity) {
      where.push("entity = ?");
      args.push(f.entity);
    }
    if (f.key) {
      where.push("entity_key = ?");
      args.push(f.key);
    }
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM web_events${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${Math.min(500, Math.max(1, Math.floor(f.limit ?? 100)))}`,
      args,
    );
    return rows.map((r) => ({ id: Number(r.id), entity: r.entity as WebEvent["entity"], entityKey: String(r.entity_key), action: String(r.action), author: String(r.author), detail: (r.detail as string) ?? null, createdAt: Number(r.created_at) }));
  }
}
