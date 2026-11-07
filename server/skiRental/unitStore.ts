/**
 * Persistencia de Ski Net · Alquiler v1 por unidad en la BD de la empresa (migración `db/migrations/0032_ski_rental_v1.sql`).
 * Nada se borra: tiendas y modelos se archivan, las unidades se retiran, las entregas se cierran al devolver y los
 * contratos firmados no se modifican. Cada cambio de estado de una unidad deja un evento. Si las tablas no existen
 * (migración no aplicada) se lanza `ModuleNotInstalled`.
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { ModuleNotInstalled } from "../sdk";
import { SKI_RENTAL_ID } from "./manifest";
import type { CodeLabel, UnitStatus } from "./units";

export interface RentalSettings {
  siteId: string;
  assetTypes: CodeLabel[] | null;
  contractTerms: string | null;
  termsVersion: number;
}
export interface RentalStore {
  id: number;
  siteId: string;
  name: string;
  openingTime: string;
  closingTime: string;
  overdueReturnTime: string;
  active: boolean;
}
export interface AssetModel {
  id: number;
  siteId: string;
  assetType: string;
  name: string;
  brand: string | null;
  size: string;
  replacementValueCents: number | null;
  active: boolean;
}
export interface Unit {
  id: number;
  siteId: string;
  modelId: number;
  storeId: number | null;
  code: string;
  status: UnitStatus;
  notes: string | null;
}
export interface UnitEvent {
  id: number;
  unitId: number;
  fromStatus: UnitStatus | null;
  toStatus: UnitStatus;
  kind: string;
  refId: number | null;
  note: string | null;
  actor: string | null;
  createdAt: string;
}
export interface Delivery {
  id: number;
  siteId: string;
  storeId: number;
  customerName: string;
  reservationId: number | null;
  startDate: string;
  expectedReturnDate: string;
  status: "open" | "returned";
  createdAt: string;
}
export type ReturnCondition = "ok" | "damaged" | "lost";
export interface DeliveryLine {
  id: number;
  siteId: string;
  deliveryId: number;
  unitId: number;
  requestedType: string;
  requestedSize: string | null;
  sizeMismatchReason: string | null;
  returnedAt: string | null;
  returnCondition: ReturnCondition | null;
  returnNote: string | null;
}
export interface Contract {
  id: number;
  siteId: string;
  deliveryId: number;
  status: "pending" | "signed";
  termsVersion: number;
  content: string;
  contentHash: string;
  signerName: string | null;
  signedAt: string | null;
  signedIp: string | null;
  signedUserAgent: string | null;
  signedBy: string | null;
}
export interface WorkshopTicket {
  id: number;
  siteId: string;
  unitId: number;
  reason: string;
  status: "open" | "done";
  resolution: "available" | "incident" | "retired" | null;
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
}

export type NewStore = Omit<RentalStore, "id" | "active">;
export type NewModel = Omit<AssetModel, "id" | "active">;
export type NewDelivery = Omit<Delivery, "id" | "status" | "createdAt">;
export interface LineRequest {
  code: string;
  requestedType: string;
  requestedSize: string | null;
  reason: string | null;
}
export interface Picked {
  unit: Unit;
  model: AssetModel;
}
export interface UnitChange {
  to: UnitStatus;
  kind: string;
  refId?: number | null;
  note?: string | null;
}
export interface ContractDraft {
  termsVersion: number;
  content: string;
  contentHash: string;
}
export interface Signature {
  signerName: string;
  ip: string | null;
  userAgent: string | null;
  signedBy: string;
}

export interface SkiRentalUnitStore {
  settings(siteId: string): Promise<RentalSettings | null>;
  saveSettings(siteId: string, patch: { assetTypes?: CodeLabel[]; contractTerms?: string | null }, actor: string): Promise<void>;

  stores(siteId: string): Promise<RentalStore[]>;
  store(id: number): Promise<RentalStore | null>;
  insertStore(x: NewStore): Promise<number>;
  updateStore(id: number, patch: Partial<Omit<RentalStore, "id" | "siteId">>): Promise<void>;

  models(siteId: string): Promise<AssetModel[]>;
  model(id: number): Promise<AssetModel | null>;
  insertModel(x: NewModel): Promise<number>;
  updateModel(id: number, patch: Partial<Omit<AssetModel, "id" | "siteId">>): Promise<void>;
  /** Unidades por modelo y estado (disponibilidad del inventario). */
  unitCounts(siteId: string): Promise<Array<{ modelId: number; status: UnitStatus; n: number }>>;

  units(siteId: string, f: { modelId?: number; status?: UnitStatus }): Promise<Unit[]>;
  unit(id: number): Promise<Unit | null>;
  unitByCode(siteId: string, code: string): Promise<Unit | null>;
  /** Alta atómica: con `codes` usa esos; si no, reserva `count` correlativos de la sede y genera el código con `autoCode`. */
  insertUnits(siteId: string, modelId: number, storeId: number | null, codes: string[] | null, count: number, autoCode: (seq: number) => string, actor: string): Promise<number[]>;
  unitEvents(unitId: number): Promise<UnitEvent[]>;
  /** Cambio de estado atómico: bloquea la unidad, `decide` lanza si no procede, y queda el evento. */
  changeUnit(unitId: number, decide: (u: Unit) => UnitChange, actor: string): Promise<Unit>;

  deliveries(siteId: string, status?: Delivery["status"]): Promise<Delivery[]>;
  delivery(id: number): Promise<Delivery | null>;
  lines(deliveryIds: number[]): Promise<DeliveryLine[]>;
  line(id: number): Promise<DeliveryLine | null>;
  contract(deliveryId: number): Promise<Contract | null>;
  contracts(siteId: string, status?: Contract["status"]): Promise<Contract[]>;
  /**
   * Entrega atómica: bloquea las unidades pedidas por código, `check` lanza si alguna no encaja, crea la entrega, sus
   * líneas y el contrato pendiente (`draft`) y pasa las unidades a alquiladas con su evento.
   */
  createDelivery(d: NewDelivery, lines: LineRequest[], check: (picked: Picked[]) => void, draft: (deliveryId: number, picked: Picked[]) => ContractDraft, actor: string): Promise<number>;
  /** Devolución atómica de una línea; la entrega se cierra al devolver la última. */
  returnLine(lineId: number, condition: ReturnCondition, note: string | null, decide: (line: DeliveryLine, unit: Unit) => UnitStatus, actor: string): Promise<{ deliveryClosed: boolean }>;
  /** Firma solo un contrato pendiente; devuelve si se firmó ahora. */
  signContract(deliveryId: number, s: Signature): Promise<boolean>;

  tickets(siteId: string, status?: WorkshopTicket["status"]): Promise<WorkshopTicket[]>;
  ticket(id: number): Promise<WorkshopTicket | null>;
  openTicket(siteId: string, unitId: number, reason: string, check: (u: Unit) => void, actor: string): Promise<number>;
  closeTicket(ticketId: number, resolution: NonNullable<WorkshopTicket["resolution"]>, notes: string | null, check: (t: WorkshopTicket, u: Unit) => void, actor: string): Promise<void>;

  reservationExists(id: number): Promise<boolean>;
}

// ── En memoria (pruebas) ─────────────────────────────────────────────────────────

const clone = <T>(x: T): T => structuredClone(x);
const dup = () => Object.assign(new Error("duplicado"), { code: "ER_DUP_ENTRY" });
const stamp = () => new Date().toISOString();

export class MemorySkiRentalUnitStore implements SkiRentalUnitStore {
  private set = new Map<string, RentalSettings & { seq: number }>();
  private storeRows: RentalStore[] = [];
  private modelRows: AssetModel[] = [];
  private unitRows: Unit[] = [];
  private eventRows: UnitEvent[] = [];
  private deliveryRows: Delivery[] = [];
  private lineRows: DeliveryLine[] = [];
  private contractRows: Contract[] = [];
  private ticketRows: WorkshopTicket[] = [];
  reservations = new Set<number>();

  private ev(u: Unit, from: UnitStatus | null, c: UnitChange, actor: string) {
    this.eventRows.push({ id: this.eventRows.length + 1, unitId: u.id, fromStatus: from, toStatus: c.to, kind: c.kind, refId: c.refId ?? null, note: c.note ?? null, actor, createdAt: stamp() });
  }

  async settings(siteId: string) {
    const s = this.set.get(siteId);
    if (!s) return null;
    const { seq: _s, ...rest } = s;
    return clone(rest);
  }
  async saveSettings(siteId: string, patch: { assetTypes?: CodeLabel[]; contractTerms?: string | null }) {
    const cur = this.set.get(siteId) ?? { siteId, assetTypes: null, contractTerms: null, termsVersion: 1, seq: 0 };
    if (patch.assetTypes !== undefined) cur.assetTypes = clone(patch.assetTypes);
    if (patch.contractTerms !== undefined) {
      cur.contractTerms = patch.contractTerms;
      cur.termsVersion += 1;
    }
    this.set.set(siteId, cur);
  }
  async stores(siteId: string) {
    return this.storeRows.filter((s) => s.siteId === siteId).map(clone);
  }
  async store(id: number) {
    const s = this.storeRows.find((x) => x.id === id);
    return s ? clone(s) : null;
  }
  async insertStore(x: NewStore) {
    if (this.storeRows.some((s) => s.siteId === x.siteId && s.name === x.name)) throw dup();
    this.storeRows.push({ ...x, id: this.storeRows.length + 1, active: true });
    return this.storeRows.length;
  }
  async updateStore(id: number, patch: Partial<RentalStore>) {
    Object.assign(this.storeRows.find((x) => x.id === id)!, patch);
  }
  async models(siteId: string) {
    return this.modelRows.filter((m) => m.siteId === siteId).map(clone);
  }
  async model(id: number) {
    const m = this.modelRows.find((x) => x.id === id);
    return m ? clone(m) : null;
  }
  async insertModel(x: NewModel) {
    if (this.modelRows.some((m) => m.siteId === x.siteId && m.assetType === x.assetType && m.name === x.name && m.size === x.size)) throw dup();
    this.modelRows.push({ ...x, id: this.modelRows.length + 1, active: true });
    return this.modelRows.length;
  }
  async updateModel(id: number, patch: Partial<AssetModel>) {
    Object.assign(this.modelRows.find((x) => x.id === id)!, patch);
  }
  async unitCounts(siteId: string) {
    const out = new Map<string, { modelId: number; status: UnitStatus; n: number }>();
    for (const u of this.unitRows.filter((x) => x.siteId === siteId)) {
      const k = `${u.modelId}:${u.status}`;
      const cur = out.get(k) ?? { modelId: u.modelId, status: u.status, n: 0 };
      cur.n++;
      out.set(k, cur);
    }
    return Array.from(out.values());
  }
  async units(siteId: string, f: { modelId?: number; status?: UnitStatus }) {
    return this.unitRows.filter((u) => u.siteId === siteId && (f.modelId == null || u.modelId === f.modelId) && (!f.status || u.status === f.status)).map(clone);
  }
  async unit(id: number) {
    const u = this.unitRows.find((x) => x.id === id);
    return u ? clone(u) : null;
  }
  async unitByCode(siteId: string, code: string) {
    const u = this.unitRows.find((x) => x.siteId === siteId && x.code === code);
    return u ? clone(u) : null;
  }
  async insertUnits(siteId: string, modelId: number, storeId: number | null, codes: string[] | null, count: number, autoCode: (seq: number) => string, actor: string) {
    const s = this.set.get(siteId) ?? { siteId, assetTypes: null, contractTerms: null, termsVersion: 1, seq: 0 };
    let list = codes;
    if (!list) {
      list = Array.from({ length: count }, (_, i) => autoCode(s.seq + i + 1));
      s.seq += count;
      this.set.set(siteId, s);
    }
    if (list.some((c) => this.unitRows.some((u) => u.siteId === siteId && u.code === c)) || new Set(list).size !== list.length) throw dup();
    return list.map((code) => {
      const u: Unit = { id: this.unitRows.length + 1, siteId, modelId, storeId, code, status: "available", notes: null };
      this.unitRows.push(u);
      this.ev(u, null, { to: "available", kind: "created" }, actor);
      return u.id;
    });
  }
  async unitEvents(unitId: number) {
    return this.eventRows.filter((e) => e.unitId === unitId).map(clone);
  }
  async changeUnit(unitId: number, decide: (u: Unit) => UnitChange, actor: string) {
    const u = this.unitRows.find((x) => x.id === unitId)!;
    const c = decide(clone(u));
    const from = u.status;
    u.status = c.to;
    this.ev(u, from, c, actor);
    return clone(u);
  }
  async deliveries(siteId: string, status?: Delivery["status"]) {
    return this.deliveryRows.filter((d) => d.siteId === siteId && (!status || d.status === status)).map(clone);
  }
  async delivery(id: number) {
    const d = this.deliveryRows.find((x) => x.id === id);
    return d ? clone(d) : null;
  }
  async lines(deliveryIds: number[]) {
    return this.lineRows.filter((l) => deliveryIds.includes(l.deliveryId)).map(clone);
  }
  async line(id: number) {
    const l = this.lineRows.find((x) => x.id === id);
    return l ? clone(l) : null;
  }
  async contract(deliveryId: number) {
    const c = this.contractRows.find((x) => x.deliveryId === deliveryId);
    return c ? clone(c) : null;
  }
  async contracts(siteId: string, status?: Contract["status"]) {
    return this.contractRows.filter((c) => c.siteId === siteId && (!status || c.status === status)).map(clone);
  }
  // Sin `await` entre lecturas y escrituras: atómico en memoria
  async createDelivery(d: NewDelivery, lines: LineRequest[], check: (picked: Picked[]) => void, draft: (id: number, picked: Picked[]) => ContractDraft, actor: string) {
    const picked = lines.map((l) => {
      const unit = this.unitRows.find((u) => u.siteId === d.siteId && u.code === l.code);
      if (!unit) throw Object.assign(new Error(`unidad ${l.code}`), { missingCode: l.code });
      return { unit: clone(unit), model: clone(this.modelRows.find((m) => m.id === unit.modelId)!) };
    });
    check(picked);
    const id = this.deliveryRows.length + 1;
    this.deliveryRows.push({ ...d, id, status: "open", createdAt: stamp() });
    lines.forEach((l, i) => {
      const unit = this.unitRows.find((u) => u.id === picked[i].unit.id)!;
      this.lineRows.push({ id: this.lineRows.length + 1, siteId: d.siteId, deliveryId: id, unitId: unit.id, requestedType: l.requestedType, requestedSize: l.requestedSize, sizeMismatchReason: l.reason, returnedAt: null, returnCondition: null, returnNote: null });
      const from = unit.status;
      unit.status = "rented";
      this.ev(unit, from, { to: "rented", kind: "delivered", refId: id }, actor);
    });
    const c = draft(id, picked);
    this.contractRows.push({ id: this.contractRows.length + 1, siteId: d.siteId, deliveryId: id, status: "pending", ...c, signerName: null, signedAt: null, signedIp: null, signedUserAgent: null, signedBy: null });
    return id;
  }
  async returnLine(lineId: number, condition: ReturnCondition, note: string | null, decide: (line: DeliveryLine, unit: Unit) => UnitStatus, actor: string) {
    const l = this.lineRows.find((x) => x.id === lineId)!;
    const u = this.unitRows.find((x) => x.id === l.unitId)!;
    const to = decide(clone(l), clone(u));
    l.returnedAt = stamp();
    l.returnCondition = condition;
    l.returnNote = note;
    const from = u.status;
    u.status = to;
    this.ev(u, from, { to, kind: "returned", refId: l.deliveryId, note: condition === "ok" ? note : `${condition}${note ? `: ${note}` : ""}` }, actor);
    const open = this.lineRows.some((x) => x.deliveryId === l.deliveryId && x.returnedAt == null);
    if (!open) this.deliveryRows.find((d) => d.id === l.deliveryId)!.status = "returned";
    return { deliveryClosed: !open };
  }
  async signContract(deliveryId: number, s: Signature) {
    const c = this.contractRows.find((x) => x.deliveryId === deliveryId);
    if (!c || c.status !== "pending") return false;
    Object.assign(c, { status: "signed", signerName: s.signerName, signedAt: stamp(), signedIp: s.ip, signedUserAgent: s.userAgent, signedBy: s.signedBy });
    return true;
  }
  async tickets(siteId: string, status?: WorkshopTicket["status"]) {
    return this.ticketRows.filter((t) => t.siteId === siteId && (!status || t.status === status)).map(clone);
  }
  async ticket(id: number) {
    const t = this.ticketRows.find((x) => x.id === id);
    return t ? clone(t) : null;
  }
  async openTicket(siteId: string, unitId: number, reason: string, check: (u: Unit) => void, actor: string) {
    const u = this.unitRows.find((x) => x.id === unitId)!;
    check(clone(u));
    const id = this.ticketRows.length + 1;
    this.ticketRows.push({ id, siteId, unitId, reason, status: "open", resolution: null, notes: null, createdAt: stamp(), closedAt: null });
    const from = u.status;
    u.status = "workshop";
    this.ev(u, from, { to: "workshop", kind: "workshop_in", refId: id, note: reason }, actor);
    return id;
  }
  async closeTicket(ticketId: number, resolution: NonNullable<WorkshopTicket["resolution"]>, notes: string | null, check: (t: WorkshopTicket, u: Unit) => void, actor: string) {
    const t = this.ticketRows.find((x) => x.id === ticketId)!;
    const u = this.unitRows.find((x) => x.id === t.unitId)!;
    check(clone(t), clone(u));
    Object.assign(t, { status: "done", resolution, notes, closedAt: stamp() });
    const from = u.status;
    u.status = resolution;
    this.ev(u, from, { to: resolution, kind: "workshop_out", refId: ticketId, note: notes }, actor);
  }
  async reservationExists(id: number) {
    return this.reservations.has(id);
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
type Exec = Pick<Db, "execute">;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const insertIdOf = (res: unknown) => Number((res as [{ insertId: number }])[0].insertId);
const affectedOf = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows);
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const cut = (s: string | null, n: number) => (s == null ? null : s.slice(0, n));

function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /ski_rental_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}
function json<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

const toStore = (r: Row): RentalStore => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  name: String(r.name),
  openingTime: String(r.opening_time),
  closingTime: String(r.closing_time),
  overdueReturnTime: String(r.overdue_return_time),
  active: Number(r.active) === 1,
});
const toModel = (r: Row): AssetModel => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  assetType: String(r.asset_type),
  name: String(r.name),
  brand: str(r.brand),
  size: String(r.size ?? ""),
  replacementValueCents: num(r.replacement_value_cents),
  active: Number(r.active) === 1,
});
const UNIT_COLS = sql.raw("id, site_id, model_id, store_id, code, status, notes");
const toUnit = (r: Row): Unit => ({ id: Number(r.id), siteId: String(r.site_id), modelId: Number(r.model_id), storeId: num(r.store_id), code: String(r.code), status: r.status as UnitStatus, notes: str(r.notes) });
const DELIVERY_COLS = sql.raw(
  "id, site_id, store_id, customer_name, reservation_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(expected_return_date, '%Y-%m-%d') AS expected_return_date, status, created_at",
);
const toDelivery = (r: Row): Delivery => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  storeId: Number(r.store_id),
  customerName: String(r.customer_name),
  reservationId: num(r.reservation_id),
  startDate: String(r.start_date),
  expectedReturnDate: String(r.expected_return_date),
  status: r.status as Delivery["status"],
  createdAt: iso(r.created_at)!,
});
const LINE_COLS = sql.raw("id, site_id, delivery_id, unit_id, requested_type, requested_size, size_mismatch_reason, returned_at, return_condition, return_note");
const toLine = (r: Row): DeliveryLine => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  deliveryId: Number(r.delivery_id),
  unitId: Number(r.unit_id),
  requestedType: String(r.requested_type),
  requestedSize: str(r.requested_size),
  sizeMismatchReason: str(r.size_mismatch_reason),
  returnedAt: iso(r.returned_at),
  returnCondition: r.return_condition as ReturnCondition | null,
  returnNote: str(r.return_note),
});
const CONTRACT_COLS = sql.raw("id, site_id, delivery_id, status, terms_version, content, content_hash, signer_name, signed_at, signed_ip, signed_user_agent, signed_by");
const toContract = (r: Row): Contract => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  deliveryId: Number(r.delivery_id),
  status: r.status as Contract["status"],
  termsVersion: Number(r.terms_version),
  content: String(r.content),
  contentHash: String(r.content_hash),
  signerName: str(r.signer_name),
  signedAt: iso(r.signed_at),
  signedIp: str(r.signed_ip),
  signedUserAgent: str(r.signed_user_agent),
  signedBy: str(r.signed_by),
});
const TICKET_COLS = sql.raw("id, site_id, unit_id, reason, status, resolution, notes, created_at, closed_at");
const toTicket = (r: Row): WorkshopTicket => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  unitId: Number(r.unit_id),
  reason: String(r.reason),
  status: r.status as WorkshopTicket["status"],
  resolution: r.resolution as WorkshopTicket["resolution"],
  notes: str(r.notes),
  createdAt: iso(r.created_at)!,
  closedAt: iso(r.closed_at),
});

async function event(tx: Exec, u: Unit, from: UnitStatus | null, c: UnitChange, actor: string) {
  await tx.execute(sql`
    INSERT INTO ski_rental_unit_events (site_id, unit_id, from_status, to_status, kind, ref_id, note, actor)
    VALUES (${u.siteId}, ${u.id}, ${from}, ${c.to}, ${c.kind}, ${c.refId ?? null}, ${cut(c.note ?? null, 300)}, ${actor.slice(0, 100)})`);
}

/** Almacén sobre la BD de la empresa en curso (contexto de tenant del Core). */
export class TenantDbSkiRentalUnitStore implements SkiRentalUnitStore {
  private async run<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new ModuleNotInstalled(SKI_RENTAL_ID);
      throw e;
    }
  }
  private one<T>(q: SQL, map: (r: Row) => T) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(q));
      return r ? map(r) : null;
    });
  }
  private many<T>(q: SQL, map: (r: Row) => T) {
    return this.run(async (db) => rowsOf(await db.execute(q)).map(map));
  }
  private update(table: string, id: number, sets: SQL[]) {
    if (!sets.length) return Promise.resolve();
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ${sql.raw(table)} SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }

  settings(siteId: string) {
    return this.one(sql`SELECT site_id, asset_types, contract_terms, terms_version FROM ski_rental_settings WHERE site_id = ${siteId}`, (r) => ({
      siteId: String(r.site_id),
      assetTypes: json<CodeLabel[] | null>(r.asset_types, null),
      contractTerms: str(r.contract_terms),
      termsVersion: Number(r.terms_version),
    }));
  }
  saveSettings(siteId: string, patch: { assetTypes?: CodeLabel[]; contractTerms?: string | null }, actor: string) {
    return this.run(async (db) => {
      await db.execute(sql`INSERT IGNORE INTO ski_rental_settings (site_id, updated_by) VALUES (${siteId}, ${actor.slice(0, 100)})`);
      const sets: SQL[] = [sql`updated_by = ${actor.slice(0, 100)}`];
      if (patch.assetTypes !== undefined) sets.push(sql`asset_types = ${JSON.stringify(patch.assetTypes)}`);
      // Cambiar el texto crea una versión nueva; los contratos ya generados guardan el suyo
      if (patch.contractTerms !== undefined) sets.push(sql`contract_terms = ${patch.contractTerms}`, sql`terms_version = terms_version + 1`);
      await db.execute(sql`UPDATE ski_rental_settings SET ${sql.join(sets, sql`, `)} WHERE site_id = ${siteId}`);
    });
  }

  stores(siteId: string) {
    return this.many(sql`SELECT * FROM ski_rental_stores WHERE site_id = ${siteId} ORDER BY active DESC, name, id`, toStore);
  }
  store(id: number) {
    return this.one(sql`SELECT * FROM ski_rental_stores WHERE id = ${id}`, toStore);
  }
  insertStore(x: NewStore) {
    return this.run(async (db) =>
      insertIdOf(await db.execute(sql`INSERT INTO ski_rental_stores (site_id, name, opening_time, closing_time, overdue_return_time) VALUES (${x.siteId}, ${x.name}, ${x.openingTime}, ${x.closingTime}, ${x.overdueReturnTime})`)),
    );
  }
  updateStore(id: number, p: Partial<Omit<RentalStore, "id" | "siteId">>) {
    const sets: SQL[] = [];
    if (p.name !== undefined) sets.push(sql`name = ${p.name}`);
    if (p.openingTime !== undefined) sets.push(sql`opening_time = ${p.openingTime}`);
    if (p.closingTime !== undefined) sets.push(sql`closing_time = ${p.closingTime}`);
    if (p.overdueReturnTime !== undefined) sets.push(sql`overdue_return_time = ${p.overdueReturnTime}`);
    if (p.active !== undefined) sets.push(sql`active = ${p.active ? 1 : 0}`);
    return this.update("ski_rental_stores", id, sets);
  }

  models(siteId: string) {
    return this.many(sql`SELECT * FROM ski_rental_models WHERE site_id = ${siteId} ORDER BY active DESC, asset_type, name, size, id`, toModel);
  }
  model(id: number) {
    return this.one(sql`SELECT * FROM ski_rental_models WHERE id = ${id}`, toModel);
  }
  insertModel(x: NewModel) {
    return this.run(async (db) =>
      insertIdOf(
        await db.execute(sql`
          INSERT INTO ski_rental_models (site_id, asset_type, name, brand, size, replacement_value_cents)
          VALUES (${x.siteId}, ${x.assetType}, ${x.name}, ${x.brand}, ${x.size}, ${x.replacementValueCents})`),
      ),
    );
  }
  updateModel(id: number, p: Partial<Omit<AssetModel, "id" | "siteId">>) {
    const sets: SQL[] = [];
    if (p.name !== undefined) sets.push(sql`name = ${p.name}`);
    if (p.brand !== undefined) sets.push(sql`brand = ${p.brand}`);
    if (p.size !== undefined) sets.push(sql`size = ${p.size}`);
    if (p.replacementValueCents !== undefined) sets.push(sql`replacement_value_cents = ${p.replacementValueCents}`);
    if (p.active !== undefined) sets.push(sql`active = ${p.active ? 1 : 0}`);
    return this.update("ski_rental_models", id, sets);
  }
  unitCounts(siteId: string) {
    return this.many(sql`SELECT model_id, status, COUNT(*) AS n FROM ski_rental_units WHERE site_id = ${siteId} GROUP BY model_id, status`, (r) => ({
      modelId: Number(r.model_id),
      status: r.status as UnitStatus,
      n: Number(r.n),
    }));
  }

  units(siteId: string, f: { modelId?: number; status?: UnitStatus }) {
    return this.many(
      sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE site_id = ${siteId}
        ${f.modelId == null ? sql`` : sql`AND model_id = ${f.modelId}`} ${f.status ? sql`AND status = ${f.status}` : sql``}
        ORDER BY code LIMIT 2000`,
      toUnit,
    );
  }
  unit(id: number) {
    return this.one(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE id = ${id}`, toUnit);
  }
  unitByCode(siteId: string, code: string) {
    return this.one(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE site_id = ${siteId} AND code = ${code}`, toUnit);
  }
  insertUnits(siteId: string, modelId: number, storeId: number | null, codes: string[] | null, count: number, autoCode: (seq: number) => string, actor: string) {
    return this.run(async (db) => {
      // La fila de ajustes se crea fuera de la transacción: dos INSERT IGNORE a la vez dentro de ella se bloquean mutuamente
      if (!codes) await db.execute(sql`INSERT IGNORE INTO ski_rental_settings (site_id) VALUES (${siteId})`);
      return db.transaction(async (tx) => {
        let list = codes;
        if (!list) {
          // Correlativo de la sede bloqueado: dos altas a la vez no repiten código
          const [s] = rowsOf(await tx.execute(sql`SELECT unit_seq FROM ski_rental_settings WHERE site_id = ${siteId} FOR UPDATE`));
          const base = Number(s.unit_seq);
          list = Array.from({ length: count }, (_, i) => autoCode(base + i + 1));
          await tx.execute(sql`UPDATE ski_rental_settings SET unit_seq = ${base + count} WHERE site_id = ${siteId}`);
        }
        const ids: number[] = [];
        for (const code of list) {
          const id = insertIdOf(await tx.execute(sql`INSERT INTO ski_rental_units (site_id, model_id, store_id, code) VALUES (${siteId}, ${modelId}, ${storeId}, ${code})`));
          await event(tx, { id, siteId, modelId, storeId, code, status: "available", notes: null }, null, { to: "available", kind: "created" }, actor);
          ids.push(id);
        }
        return ids;
      });
    });
  }
  unitEvents(unitId: number) {
    return this.many(sql`SELECT * FROM ski_rental_unit_events WHERE unit_id = ${unitId} ORDER BY id`, (r) => ({
      id: Number(r.id),
      unitId: Number(r.unit_id),
      fromStatus: r.from_status as UnitStatus | null,
      toStatus: r.to_status as UnitStatus,
      kind: String(r.kind),
      refId: num(r.ref_id),
      note: str(r.note),
      actor: str(r.actor),
      createdAt: iso(r.created_at)!,
    }));
  }
  changeUnit(unitId: number, decide: (u: Unit) => UnitChange, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [r] = rowsOf(await tx.execute(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE id = ${unitId} FOR UPDATE`));
        const u = toUnit(r);
        const c = decide(u);
        await tx.execute(sql`UPDATE ski_rental_units SET status = ${c.to} WHERE id = ${unitId}`);
        await event(tx, u, u.status, c, actor);
        return { ...u, status: c.to };
      }),
    );
  }

  deliveries(siteId: string, status?: Delivery["status"]) {
    return this.many(
      sql`SELECT ${DELIVERY_COLS} FROM ski_rental_deliveries WHERE site_id = ${siteId} ${status ? sql`AND status = ${status}` : sql``} ORDER BY status = 'open' DESC, expected_return_date, id DESC LIMIT 500`,
      toDelivery,
    );
  }
  delivery(id: number) {
    return this.one(sql`SELECT ${DELIVERY_COLS} FROM ski_rental_deliveries WHERE id = ${id}`, toDelivery);
  }
  lines(deliveryIds: number[]) {
    if (!deliveryIds.length) return Promise.resolve([]);
    return this.many(sql`SELECT ${LINE_COLS} FROM ski_rental_delivery_lines WHERE delivery_id IN (${sql.join(deliveryIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY delivery_id, id`, toLine);
  }
  line(id: number) {
    return this.one(sql`SELECT ${LINE_COLS} FROM ski_rental_delivery_lines WHERE id = ${id}`, toLine);
  }
  contract(deliveryId: number) {
    return this.one(sql`SELECT ${CONTRACT_COLS} FROM ski_rental_contracts WHERE delivery_id = ${deliveryId}`, toContract);
  }
  contracts(siteId: string, status?: Contract["status"]) {
    return this.many(sql`SELECT ${CONTRACT_COLS} FROM ski_rental_contracts WHERE site_id = ${siteId} ${status ? sql`AND status = ${status}` : sql``} ORDER BY id DESC LIMIT 500`, toContract);
  }
  createDelivery(d: NewDelivery, lines: LineRequest[], check: (picked: Picked[]) => void, draft: (id: number, picked: Picked[]) => ContractDraft, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const picked: Picked[] = [];
        // Bloqueo por código en orden fijo: dos entregas a la vez de la misma unidad se serializan
        for (const code of Array.from(new Set(lines.map((l) => l.code))).sort()) {
          const [r] = rowsOf(await tx.execute(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE site_id = ${d.siteId} AND code = ${code} FOR UPDATE`));
          if (!r) throw Object.assign(new Error(`unidad ${code}`), { missingCode: code });
        }
        for (const l of lines) {
          const [r] = rowsOf(await tx.execute(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE site_id = ${d.siteId} AND code = ${l.code}`));
          const unit = toUnit(r);
          const [m] = rowsOf(await tx.execute(sql`SELECT * FROM ski_rental_models WHERE id = ${unit.modelId}`));
          picked.push({ unit, model: toModel(m) });
        }
        check(picked);
        const id = insertIdOf(
          await tx.execute(sql`
            INSERT INTO ski_rental_deliveries (site_id, store_id, customer_name, reservation_id, start_date, expected_return_date, created_by)
            VALUES (${d.siteId}, ${d.storeId}, ${d.customerName}, ${d.reservationId}, ${d.startDate}, ${d.expectedReturnDate}, ${actor.slice(0, 100)})`),
        );
        for (let i = 0; i < lines.length; i++) {
          const { unit } = picked[i];
          await tx.execute(sql`
            INSERT INTO ski_rental_delivery_lines (site_id, delivery_id, unit_id, requested_type, requested_size, size_mismatch_reason)
            VALUES (${d.siteId}, ${id}, ${unit.id}, ${lines[i].requestedType}, ${lines[i].requestedSize}, ${cut(lines[i].reason, 200)})`);
          await tx.execute(sql`UPDATE ski_rental_units SET status = 'rented' WHERE id = ${unit.id}`);
          await event(tx, unit, unit.status, { to: "rented", kind: "delivered", refId: id }, actor);
        }
        const c = draft(id, picked);
        await tx.execute(sql`
          INSERT INTO ski_rental_contracts (site_id, delivery_id, terms_version, content, content_hash)
          VALUES (${d.siteId}, ${id}, ${c.termsVersion}, ${c.content}, ${c.contentHash})`);
        return id;
      }),
    );
  }
  returnLine(lineId: number, condition: ReturnCondition, note: string | null, decide: (line: DeliveryLine, unit: Unit) => UnitStatus, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [lr] = rowsOf(await tx.execute(sql`SELECT ${LINE_COLS} FROM ski_rental_delivery_lines WHERE id = ${lineId} FOR UPDATE`));
        const line = toLine(lr);
        const [ur] = rowsOf(await tx.execute(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE id = ${line.unitId} FOR UPDATE`));
        const unit = toUnit(ur);
        const to = decide(line, unit);
        await tx.execute(sql`UPDATE ski_rental_delivery_lines SET returned_at = CURRENT_TIMESTAMP(3), return_condition = ${condition}, return_note = ${cut(note, 300)} WHERE id = ${lineId}`);
        await tx.execute(sql`UPDATE ski_rental_units SET status = ${to} WHERE id = ${unit.id}`);
        await event(tx, unit, unit.status, { to, kind: "returned", refId: line.deliveryId, note: condition === "ok" ? note : `${condition}${note ? `: ${note}` : ""}` }, actor);
        const [open] = rowsOf(await tx.execute(sql`SELECT COUNT(*) AS n FROM ski_rental_delivery_lines WHERE delivery_id = ${line.deliveryId} AND returned_at IS NULL`));
        const closed = Number(open.n) === 0;
        if (closed) await tx.execute(sql`UPDATE ski_rental_deliveries SET status = 'returned', closed_at = CURRENT_TIMESTAMP(3) WHERE id = ${line.deliveryId}`);
        return { deliveryClosed: closed };
      }),
    );
  }
  signContract(deliveryId: number, s: Signature) {
    return this.run(
      async (db) =>
        affectedOf(
          await db.execute(sql`
            UPDATE ski_rental_contracts SET status = 'signed', signer_name = ${s.signerName}, signed_at = CURRENT_TIMESTAMP(3),
              signed_ip = ${cut(s.ip, 64)}, signed_user_agent = ${cut(s.userAgent, 300)}, signed_by = ${s.signedBy.slice(0, 100)}
            WHERE delivery_id = ${deliveryId} AND status = 'pending'`),
        ) === 1,
    );
  }

  tickets(siteId: string, status?: WorkshopTicket["status"]) {
    return this.many(sql`SELECT ${TICKET_COLS} FROM ski_rental_workshop_tickets WHERE site_id = ${siteId} ${status ? sql`AND status = ${status}` : sql``} ORDER BY status = 'open' DESC, id DESC LIMIT 500`, toTicket);
  }
  ticket(id: number) {
    return this.one(sql`SELECT ${TICKET_COLS} FROM ski_rental_workshop_tickets WHERE id = ${id}`, toTicket);
  }
  openTicket(siteId: string, unitId: number, reason: string, check: (u: Unit) => void, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [ur] = rowsOf(await tx.execute(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE id = ${unitId} FOR UPDATE`));
        const unit = toUnit(ur);
        check(unit);
        const id = insertIdOf(await tx.execute(sql`INSERT INTO ski_rental_workshop_tickets (site_id, unit_id, reason, created_by) VALUES (${siteId}, ${unitId}, ${reason}, ${actor.slice(0, 100)})`));
        await tx.execute(sql`UPDATE ski_rental_units SET status = 'workshop' WHERE id = ${unitId}`);
        await event(tx, unit, unit.status, { to: "workshop", kind: "workshop_in", refId: id, note: reason }, actor);
        return id;
      }),
    );
  }
  closeTicket(ticketId: number, resolution: NonNullable<WorkshopTicket["resolution"]>, notes: string | null, check: (t: WorkshopTicket, u: Unit) => void, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [tr] = rowsOf(await tx.execute(sql`SELECT ${TICKET_COLS} FROM ski_rental_workshop_tickets WHERE id = ${ticketId} FOR UPDATE`));
        const t = toTicket(tr);
        const [ur] = rowsOf(await tx.execute(sql`SELECT ${UNIT_COLS} FROM ski_rental_units WHERE id = ${t.unitId} FOR UPDATE`));
        const unit = toUnit(ur);
        check(t, unit);
        await tx.execute(sql`
          UPDATE ski_rental_workshop_tickets SET status = 'done', resolution = ${resolution}, notes = ${cut(notes, 500)}, closed_by = ${actor.slice(0, 100)}, closed_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${ticketId}`);
        await tx.execute(sql`UPDATE ski_rental_units SET status = ${resolution} WHERE id = ${unit.id}`);
        await event(tx, unit, unit.status, { to: resolution, kind: "workshop_out", refId: ticketId, note: notes }, actor);
      }),
    );
  }

  reservationExists(id: number) {
    return this.run(async (db) => rowsOf(await db.execute(sql`SELECT id FROM reservations WHERE id = ${id}`)).length > 0);
  }
}
