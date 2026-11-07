/**
 * Persistencia de Ski Net · Escuela en la BD de la empresa (migración `db/migrations/0031_ski_school.sql`).
 * Nada se borra: profesores y productos se archivan (`active = 0`), las ausencias y los alumnos se anulan
 * (`cancelled_at` / `status`), las sesiones cambian de estado y la sede se desactiva. Si las tablas no existen
 * (migración no aplicada) se lanza `ModuleNotInstalled`.
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { ModuleNotInstalled } from "../sdk";
import { SKI_SCHOOL_ID } from "./manifest";
import { overlaps, type AbsenceKind, type ProductKind, type SchoolConfig, type SessionStatus, type WeeklySlot } from "./rules";

export interface SiteRow {
  siteId: string;
  active: boolean;
  /** Configuración guardada (null = plantilla por defecto). */
  config: Partial<SchoolConfig> | null;
}
export interface Instructor {
  id: number;
  siteId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  modalities: string[];
  levels: string[];
  languages: string[];
  minAge: number | null;
  maxAge: number | null;
  weekly: WeeklySlot[];
  notes: string | null;
  active: boolean;
}
export interface Absence {
  id: number;
  siteId: string;
  instructorId: number;
  startDate: string;
  endDate: string;
  kind: AbsenceKind;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}
export interface Product {
  id: number;
  siteId: string;
  name: string;
  kind: ProductKind;
  durationMinutes: number;
  capacity: number;
  level: string | null;
  modality: string | null;
  minAge: number | null;
  maxAge: number | null;
  active: boolean;
}
export interface Session {
  id: number;
  siteId: string;
  productId: number;
  date: string;
  startTime: string;
  endTime: string;
  modality: string | null;
  level: string | null;
  language: string | null;
  capacity: number;
  instructorId: number | null;
  status: SessionStatus;
  reservationId: number | null;
  meetingPoint: string | null;
  notes: string | null;
}
export interface Participant {
  id: number;
  siteId: string;
  sessionId: number;
  name: string;
  age: number | null;
  level: string | null;
  notes: string | null;
  status: "enrolled" | "cancelled";
}
/** Datos mínimos de una reserva del Core (sin datos personales del cliente). */
export interface ReservationRef {
  id: number;
  productName: string;
  bookingDate: string;
  people: number;
  status: string;
}

export type NewInstructor = Omit<Instructor, "id" | "active">;
export type InstructorPatch = Partial<Omit<Instructor, "id" | "siteId">>;
export type NewAbsence = Omit<Absence, "id">;
export type NewProduct = Omit<Product, "id" | "active">;
export type ProductPatch = Partial<Omit<Product, "id" | "siteId">>;
export type NewSession = Omit<Session, "id" | "status" | "instructorId">;
export type SessionPatch = Partial<Pick<Session, "capacity" | "level" | "language" | "meetingPoint" | "notes" | "status">>;
export type NewParticipant = Omit<Participant, "id" | "status">;

/** Lo que ve la comprobación de una asignación, leído dentro de la transacción. */
export interface AssignContext {
  session: Session;
  instructor: Instructor;
  absences: Absence[];
  /** Sesiones no canceladas del profesor ese día, sin la propia. */
  busy: Session[];
  /** Edades conocidas de los alumnos inscritos. */
  ages: number[];
}
/** Lo que ve la comprobación de una inscripción, leído dentro de la transacción. */
export interface EnrollContext {
  session: Session;
  enrolled: number;
  /** Alumnos inscritos en otras sesiones no canceladas de la sede ese día. */
  sameDay: Array<{ sessionId: number; startTime: string; endTime: string; participantName: string }>;
}

export interface SkiSchoolStore {
  site(siteId: string): Promise<SiteRow | null>;
  setSiteActive(siteId: string, active: boolean, actor: string): Promise<void>;
  setConfig(siteId: string, config: SchoolConfig, actor: string): Promise<void>;

  instructors(siteId: string): Promise<Instructor[]>;
  instructor(id: number): Promise<Instructor | null>;
  insertInstructor(x: NewInstructor): Promise<number>;
  updateInstructor(id: number, patch: InstructorPatch): Promise<void>;

  /** Ausencias vigentes (no anuladas) de la sede que tocan [from, to]; opcionalmente de un profesor. */
  absences(siteId: string, from: string, to: string, instructorId?: number): Promise<Absence[]>;
  absence(id: number): Promise<Absence | null>;
  insertAbsence(x: NewAbsence, actor: string): Promise<number>;
  cancelAbsence(id: number): Promise<boolean>;

  products(siteId: string): Promise<Product[]>;
  product(id: number): Promise<Product | null>;
  insertProduct(x: NewProduct): Promise<number>;
  updateProduct(id: number, patch: ProductPatch): Promise<void>;

  sessions(siteId: string, from: string, to: string): Promise<Session[]>;
  session(id: number): Promise<Session | null>;
  insertSession(x: NewSession, actor: string): Promise<number>;
  updateSession(id: number, patch: SessionPatch): Promise<void>;
  /** Asignación atómica: bloquea profesor y sesión, lee su contexto y llama a `check`, que lanza si no encaja. */
  assign(sessionId: number, instructorId: number, check: (c: AssignContext) => void): Promise<void>;
  unassign(sessionId: number): Promise<boolean>;

  participants(sessionIds: number[]): Promise<Participant[]>;
  participant(id: number): Promise<Participant | null>;
  /** Inscripción atómica: bloquea la sesión (dos inscripciones a la vez no superan el aforo). */
  enroll(x: NewParticipant, check: (c: EnrollContext) => void): Promise<number>;
  cancelParticipant(id: number): Promise<boolean>;
  /**
   * Mueve alumnos inscritos de una sesión a otra (fusión o división de grupos) de forma atómica: bloquea las dos
   * sesiones, `check` lanza si no procede (aforo, estado) y, con `cancelSource`, cancela la de origen.
   */
  moveParticipants(fromId: number, toId: number, participantIds: number[] | "all", cancelSource: boolean, check: (from: Session, to: Session, moving: number, enrolledTo: number) => void): Promise<number>;

  reservation(id: number): Promise<ReservationRef | null>;
}

// ── En memoria (pruebas) ─────────────────────────────────────────────────────────

const clone = <T>(x: T): T => structuredClone(x);

export class MemorySkiSchoolStore implements SkiSchoolStore {
  private sites = new Map<string, SiteRow>();
  private ins: Instructor[] = [];
  private abs: Array<Absence & { cancelled: boolean }> = [];
  private prods: Product[] = [];
  private sess: Session[] = [];
  private parts: Participant[] = [];
  reservations = new Map<number, ReservationRef>();

  async site(siteId: string) {
    const s = this.sites.get(siteId);
    return s ? clone(s) : null;
  }
  async setSiteActive(siteId: string, active: boolean) {
    this.sites.set(siteId, { siteId, active, config: this.sites.get(siteId)?.config ?? null });
  }
  async setConfig(siteId: string, config: SchoolConfig) {
    this.sites.set(siteId, { siteId, active: this.sites.get(siteId)?.active ?? false, config: clone(config) });
  }
  async instructors(siteId: string) {
    return this.ins.filter((i) => i.siteId === siteId).map(clone);
  }
  async instructor(id: number) {
    const i = this.ins.find((x) => x.id === id);
    return i ? clone(i) : null;
  }
  async insertInstructor(x: NewInstructor) {
    const id = this.ins.length + 1;
    this.ins.push({ ...clone(x), id, active: true });
    return id;
  }
  async updateInstructor(id: number, patch: InstructorPatch) {
    const i = this.ins.find((x) => x.id === id);
    if (i) Object.assign(i, clone(patch));
  }
  async absences(siteId: string, from: string, to: string, instructorId?: number) {
    return this.abs
      .filter((a) => a.siteId === siteId && !a.cancelled && a.startDate <= to && a.endDate >= from && (instructorId == null || a.instructorId === instructorId))
      .map(({ cancelled: _c, ...a }) => clone(a));
  }
  async absence(id: number) {
    const a = this.abs.find((x) => x.id === id && !x.cancelled);
    if (!a) return null;
    const { cancelled: _c, ...rest } = a;
    return clone(rest);
  }
  async insertAbsence(x: NewAbsence) {
    const id = this.abs.length + 1;
    this.abs.push({ ...clone(x), id, cancelled: false });
    return id;
  }
  async cancelAbsence(id: number) {
    const a = this.abs.find((x) => x.id === id && !x.cancelled);
    if (!a) return false;
    a.cancelled = true;
    return true;
  }
  async products(siteId: string) {
    return this.prods.filter((p) => p.siteId === siteId).map(clone);
  }
  async product(id: number) {
    const p = this.prods.find((x) => x.id === id);
    return p ? clone(p) : null;
  }
  async insertProduct(x: NewProduct) {
    if (this.prods.some((p) => p.siteId === x.siteId && p.name === x.name)) throw Object.assign(new Error("duplicado"), { code: "ER_DUP_ENTRY" });
    const id = this.prods.length + 1;
    this.prods.push({ ...clone(x), id, active: true });
    return id;
  }
  async updateProduct(id: number, patch: ProductPatch) {
    const p = this.prods.find((x) => x.id === id);
    if (p) Object.assign(p, clone(patch));
  }
  async sessions(siteId: string, from: string, to: string) {
    return this.sess
      .filter((s) => s.siteId === siteId && s.date >= from && s.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id - b.id)
      .map(clone);
  }
  async session(id: number) {
    const s = this.sess.find((x) => x.id === id);
    return s ? clone(s) : null;
  }
  async insertSession(x: NewSession) {
    const id = this.sess.length + 1;
    this.sess.push({ ...clone(x), id, status: "pending", instructorId: null });
    return id;
  }
  async updateSession(id: number, patch: SessionPatch) {
    const s = this.sess.find((x) => x.id === id);
    if (s) Object.assign(s, clone(patch));
  }
  // Sin `await` entre la lectura y la escritura: atómico en memoria
  async assign(sessionId: number, instructorId: number, check: (c: AssignContext) => void) {
    const session = this.sess.find((s) => s.id === sessionId)!;
    const instructor = this.ins.find((i) => i.id === instructorId)!;
    const absences = this.abs.filter((a) => a.instructorId === instructorId && !a.cancelled && a.startDate <= session.date && a.endDate >= session.date).map(({ cancelled: _c, ...a }) => clone(a));
    const busy = this.sess.filter((s) => s.instructorId === instructorId && s.date === session.date && s.id !== sessionId && s.status !== "cancelled").map(clone);
    const ages = this.parts.filter((p) => p.sessionId === sessionId && p.status === "enrolled" && p.age != null).map((p) => p.age!);
    check({ session: clone(session), instructor: clone(instructor), absences, busy, ages });
    session.instructorId = instructorId;
    session.status = "assigned";
  }
  async unassign(sessionId: number) {
    const s = this.sess.find((x) => x.id === sessionId);
    if (!s || s.status !== "assigned") return false;
    s.instructorId = null;
    s.status = "pending";
    return true;
  }
  async participants(sessionIds: number[]) {
    return this.parts.filter((p) => sessionIds.includes(p.sessionId)).map(clone);
  }
  async participant(id: number) {
    const p = this.parts.find((x) => x.id === id);
    return p ? clone(p) : null;
  }
  async enroll(x: NewParticipant, check: (c: EnrollContext) => void) {
    const session = this.sess.find((s) => s.id === x.sessionId)!;
    const enrolled = this.parts.filter((p) => p.sessionId === x.sessionId && p.status === "enrolled").length;
    const others = new Map(this.sess.filter((s) => s.siteId === session.siteId && s.date === session.date && s.id !== session.id && s.status !== "cancelled").map((s) => [s.id, s]));
    const sameDay = this.parts
      .filter((p) => p.status === "enrolled" && others.has(p.sessionId))
      .map((p) => ({ sessionId: p.sessionId, startTime: others.get(p.sessionId)!.startTime, endTime: others.get(p.sessionId)!.endTime, participantName: p.name }));
    check({ session: clone(session), enrolled, sameDay });
    const id = this.parts.length + 1;
    this.parts.push({ ...clone(x), id, status: "enrolled" });
    return id;
  }
  async cancelParticipant(id: number) {
    const p = this.parts.find((x) => x.id === id);
    if (!p || p.status !== "enrolled") return false;
    p.status = "cancelled";
    return true;
  }
  async moveParticipants(fromId: number, toId: number, ids: number[] | "all", cancelSource: boolean, check: (from: Session, to: Session, moving: number, enrolledTo: number) => void) {
    const from = this.sess.find((x) => x.id === fromId)!;
    const to = this.sess.find((x) => x.id === toId)!;
    const moving = this.parts.filter((p) => p.sessionId === fromId && p.status === "enrolled" && (ids === "all" || ids.includes(p.id)));
    check(clone(from), clone(to), moving.length, this.parts.filter((p) => p.sessionId === toId && p.status === "enrolled").length);
    for (const p of moving) p.sessionId = toId;
    if (cancelSource) from.status = "cancelled";
    return moving.length;
  }
  async reservation(id: number) {
    const r = this.reservations.get(id);
    return r ? clone(r) : null;
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const insertIdOf = (res: unknown) => Number((res as [{ insertId: number }])[0].insertId);
const affectedOf = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows);

/** Tabla del módulo inexistente (ER_NO_SUCH_TABLE), también envuelta por el ORM. */
function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /ski_school_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

/** mysql2 devuelve las columnas JSON ya interpretadas; por si llega texto, se interpreta aquí. */
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
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const jsonText = (v: unknown) => JSON.stringify(v);

const toInstructor = (r: Row): Instructor => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  fullName: String(r.full_name),
  email: str(r.email),
  phone: str(r.phone),
  modalities: json<string[]>(r.modalities, []),
  levels: json<string[]>(r.levels, []),
  languages: json<string[]>(r.languages, []),
  minAge: num(r.min_age),
  maxAge: num(r.max_age),
  weekly: json<WeeklySlot[]>(r.weekly_availability, []),
  notes: str(r.notes),
  active: Number(r.active) === 1,
});
const INSTRUCTOR_COLS = sql.raw("id, site_id, full_name, email, phone, modalities, levels, languages, min_age, max_age, weekly_availability, notes, active");

const toAbsence = (r: Row): Absence => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  instructorId: Number(r.instructor_id),
  startDate: String(r.start_date),
  endDate: String(r.end_date),
  kind: r.kind as AbsenceKind,
  startTime: str(r.start_time),
  endTime: str(r.end_time),
  reason: str(r.reason),
});
const ABSENCE_COLS = sql.raw("id, site_id, instructor_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, kind, start_time, end_time, reason");

const toProduct = (r: Row): Product => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  name: String(r.name),
  kind: r.kind as ProductKind,
  durationMinutes: Number(r.duration_minutes),
  capacity: Number(r.capacity),
  level: str(r.level),
  modality: str(r.modality),
  minAge: num(r.min_age),
  maxAge: num(r.max_age),
  active: Number(r.active) === 1,
});
const PRODUCT_COLS = sql.raw("id, site_id, name, kind, duration_minutes, capacity, level, modality, min_age, max_age, active");

const toSession = (r: Row): Session => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  productId: Number(r.product_id),
  date: String(r.session_date),
  startTime: String(r.start_time),
  endTime: String(r.end_time),
  modality: str(r.modality),
  level: str(r.level),
  language: str(r.language),
  capacity: Number(r.capacity),
  instructorId: num(r.instructor_id),
  status: r.status as SessionStatus,
  reservationId: num(r.reservation_id),
  meetingPoint: str(r.meeting_point),
  notes: str(r.notes),
});
const SESSION_COLS = sql.raw(
  "id, site_id, product_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date, start_time, end_time, modality, level, language, capacity, instructor_id, status, reservation_id, meeting_point, notes",
);

const toParticipant = (r: Row): Participant => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  sessionId: Number(r.session_id),
  name: String(r.full_name),
  age: num(r.age),
  level: str(r.level),
  notes: str(r.notes),
  status: r.status as Participant["status"],
});
const PARTICIPANT_COLS = sql.raw("id, site_id, session_id, full_name, age, level, notes, status");

type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;

/** Almacén sobre la BD de la empresa en curso (contexto de tenant del Core). */
export class TenantDbSkiSchoolStore implements SkiSchoolStore {
  private async run<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new ModuleNotInstalled(SKI_SCHOOL_ID);
      throw e;
    }
  }

  site(siteId: string) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT site_id, active, config FROM ski_school_sites WHERE site_id = ${siteId}`));
      return r ? { siteId: String(r.site_id), active: Number(r.active) === 1, config: json<Partial<SchoolConfig> | null>(r.config, null) } : null;
    });
  }
  setSiteActive(siteId: string, active: boolean, actor: string) {
    return this.run(async (db) => {
      await db.execute(sql`
        INSERT INTO ski_school_sites (site_id, active, activated_at, deactivated_at, updated_by)
        VALUES (${siteId}, ${active ? 1 : 0}, ${active ? sql`CURRENT_TIMESTAMP(3)` : null}, ${active ? null : sql`CURRENT_TIMESTAMP(3)`}, ${actor.slice(0, 100)})
        ON DUPLICATE KEY UPDATE active = VALUES(active),
          activated_at = IF(VALUES(active) = 1, CURRENT_TIMESTAMP(3), activated_at),
          deactivated_at = IF(VALUES(active) = 0, CURRENT_TIMESTAMP(3), deactivated_at),
          updated_by = VALUES(updated_by)`);
    });
  }
  setConfig(siteId: string, config: SchoolConfig, actor: string) {
    return this.run(async (db) => {
      await db.execute(sql`
        INSERT INTO ski_school_sites (site_id, active, config, updated_by) VALUES (${siteId}, 0, ${jsonText(config)}, ${actor.slice(0, 100)})
        ON DUPLICATE KEY UPDATE config = VALUES(config), updated_by = VALUES(updated_by)`);
    });
  }

  instructors(siteId: string) {
    return this.run(async (db) => rowsOf(await db.execute(sql`SELECT ${INSTRUCTOR_COLS} FROM ski_school_instructors WHERE site_id = ${siteId} ORDER BY active DESC, full_name, id`)).map(toInstructor));
  }
  instructor(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${INSTRUCTOR_COLS} FROM ski_school_instructors WHERE id = ${id}`));
      return r ? toInstructor(r) : null;
    });
  }
  insertInstructor(x: NewInstructor) {
    return this.run(async (db) =>
      insertIdOf(
        await db.execute(sql`
          INSERT INTO ski_school_instructors (site_id, full_name, email, phone, modalities, levels, languages, min_age, max_age, weekly_availability, notes)
          VALUES (${x.siteId}, ${x.fullName}, ${x.email}, ${x.phone}, ${jsonText(x.modalities)}, ${jsonText(x.levels)}, ${jsonText(x.languages)}, ${x.minAge}, ${x.maxAge}, ${jsonText(x.weekly)}, ${x.notes})`),
      ),
    );
  }
  updateInstructor(id: number, p: InstructorPatch) {
    const sets: SQL[] = [];
    if (p.fullName !== undefined) sets.push(sql`full_name = ${p.fullName}`);
    if (p.email !== undefined) sets.push(sql`email = ${p.email}`);
    if (p.phone !== undefined) sets.push(sql`phone = ${p.phone}`);
    if (p.modalities !== undefined) sets.push(sql`modalities = ${jsonText(p.modalities)}`);
    if (p.levels !== undefined) sets.push(sql`levels = ${jsonText(p.levels)}`);
    if (p.languages !== undefined) sets.push(sql`languages = ${jsonText(p.languages)}`);
    if (p.minAge !== undefined) sets.push(sql`min_age = ${p.minAge}`);
    if (p.maxAge !== undefined) sets.push(sql`max_age = ${p.maxAge}`);
    if (p.weekly !== undefined) sets.push(sql`weekly_availability = ${jsonText(p.weekly)}`);
    if (p.notes !== undefined) sets.push(sql`notes = ${p.notes}`);
    if (p.active !== undefined) sets.push(sql`active = ${p.active ? 1 : 0}`);
    if (!sets.length) return Promise.resolve();
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_school_instructors SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }

  absences(siteId: string, from: string, to: string, instructorId?: number) {
    return this.run(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT ${ABSENCE_COLS} FROM ski_school_absences
          WHERE site_id = ${siteId} AND cancelled_at IS NULL AND start_date <= ${to} AND end_date >= ${from}
          ${instructorId == null ? sql`` : sql`AND instructor_id = ${instructorId}`}
          ORDER BY start_date, id`),
      ).map(toAbsence),
    );
  }
  absence(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${ABSENCE_COLS} FROM ski_school_absences WHERE id = ${id} AND cancelled_at IS NULL`));
      return r ? toAbsence(r) : null;
    });
  }
  insertAbsence(x: NewAbsence, actor: string) {
    return this.run(async (db) =>
      insertIdOf(
        await db.execute(sql`
          INSERT INTO ski_school_absences (site_id, instructor_id, start_date, end_date, kind, start_time, end_time, reason, created_by)
          VALUES (${x.siteId}, ${x.instructorId}, ${x.startDate}, ${x.endDate}, ${x.kind}, ${x.startTime}, ${x.endTime}, ${x.reason}, ${actor.slice(0, 100)})`),
      ),
    );
  }
  cancelAbsence(id: number) {
    return this.run(async (db) => affectedOf(await db.execute(sql`UPDATE ski_school_absences SET cancelled_at = CURRENT_TIMESTAMP(3) WHERE id = ${id} AND cancelled_at IS NULL`)) === 1);
  }

  products(siteId: string) {
    return this.run(async (db) => rowsOf(await db.execute(sql`SELECT ${PRODUCT_COLS} FROM ski_school_products WHERE site_id = ${siteId} ORDER BY active DESC, kind, name, id`)).map(toProduct));
  }
  product(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${PRODUCT_COLS} FROM ski_school_products WHERE id = ${id}`));
      return r ? toProduct(r) : null;
    });
  }
  insertProduct(x: NewProduct) {
    return this.run(async (db) =>
      insertIdOf(
        await db.execute(sql`
          INSERT INTO ski_school_products (site_id, name, kind, duration_minutes, capacity, level, modality, min_age, max_age)
          VALUES (${x.siteId}, ${x.name}, ${x.kind}, ${x.durationMinutes}, ${x.capacity}, ${x.level}, ${x.modality}, ${x.minAge}, ${x.maxAge})`),
      ),
    );
  }
  updateProduct(id: number, p: ProductPatch) {
    const sets: SQL[] = [];
    if (p.name !== undefined) sets.push(sql`name = ${p.name}`);
    if (p.kind !== undefined) sets.push(sql`kind = ${p.kind}`);
    if (p.durationMinutes !== undefined) sets.push(sql`duration_minutes = ${p.durationMinutes}`);
    if (p.capacity !== undefined) sets.push(sql`capacity = ${p.capacity}`);
    if (p.level !== undefined) sets.push(sql`level = ${p.level}`);
    if (p.modality !== undefined) sets.push(sql`modality = ${p.modality}`);
    if (p.minAge !== undefined) sets.push(sql`min_age = ${p.minAge}`);
    if (p.maxAge !== undefined) sets.push(sql`max_age = ${p.maxAge}`);
    if (p.active !== undefined) sets.push(sql`active = ${p.active ? 1 : 0}`);
    if (!sets.length) return Promise.resolve();
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_school_products SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }

  sessions(siteId: string, from: string, to: string) {
    return this.run(async (db) =>
      rowsOf(await db.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions WHERE site_id = ${siteId} AND session_date BETWEEN ${from} AND ${to} ORDER BY session_date, start_time, id`)).map(toSession),
    );
  }
  session(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions WHERE id = ${id}`));
      return r ? toSession(r) : null;
    });
  }
  insertSession(x: NewSession, actor: string) {
    return this.run(async (db) =>
      insertIdOf(
        await db.execute(sql`
          INSERT INTO ski_school_sessions (site_id, product_id, session_date, start_time, end_time, modality, level, language, capacity, reservation_id, meeting_point, notes, created_by)
          VALUES (${x.siteId}, ${x.productId}, ${x.date}, ${x.startTime}, ${x.endTime}, ${x.modality}, ${x.level}, ${x.language}, ${x.capacity}, ${x.reservationId}, ${x.meetingPoint}, ${x.notes}, ${actor.slice(0, 100)})`),
      ),
    );
  }
  updateSession(id: number, p: SessionPatch) {
    const sets: SQL[] = [];
    if (p.capacity !== undefined) sets.push(sql`capacity = ${p.capacity}`);
    if (p.level !== undefined) sets.push(sql`level = ${p.level}`);
    if (p.language !== undefined) sets.push(sql`language = ${p.language}`);
    if (p.meetingPoint !== undefined) sets.push(sql`meeting_point = ${p.meetingPoint}`);
    if (p.notes !== undefined) sets.push(sql`notes = ${p.notes}`);
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (!sets.length) return Promise.resolve();
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_school_sessions SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }
  assign(sessionId: number, instructorId: number, check: (c: AssignContext) => void) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        // El bloqueo de la fila del profesor serializa dos asignaciones simultáneas al mismo profesor
        const [ir] = rowsOf(await tx.execute(sql`SELECT ${INSTRUCTOR_COLS} FROM ski_school_instructors WHERE id = ${instructorId} FOR UPDATE`));
        const [sr] = rowsOf(await tx.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions WHERE id = ${sessionId} FOR UPDATE`));
        const session = toSession(sr);
        const absences = rowsOf(
          await tx.execute(sql`SELECT ${ABSENCE_COLS} FROM ski_school_absences WHERE instructor_id = ${instructorId} AND cancelled_at IS NULL AND start_date <= ${session.date} AND end_date >= ${session.date}`),
        ).map(toAbsence);
        const busy = rowsOf(
          await tx.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions WHERE instructor_id = ${instructorId} AND session_date = ${session.date} AND id <> ${sessionId} AND status <> 'cancelled'`),
        ).map(toSession);
        const ages = rowsOf(await tx.execute(sql`SELECT age FROM ski_school_participants WHERE session_id = ${sessionId} AND status = 'enrolled' AND age IS NOT NULL`)).map((r) => Number(r.age));
        check({ session, instructor: toInstructor(ir), absences, busy, ages });
        await tx.execute(sql`UPDATE ski_school_sessions SET instructor_id = ${instructorId}, status = 'assigned' WHERE id = ${sessionId}`);
      }),
    );
  }
  unassign(sessionId: number) {
    return this.run(async (db) => affectedOf(await db.execute(sql`UPDATE ski_school_sessions SET instructor_id = NULL, status = 'pending' WHERE id = ${sessionId} AND status = 'assigned'`)) === 1);
  }

  participants(sessionIds: number[]) {
    if (!sessionIds.length) return Promise.resolve([]);
    return this.run(async (db) =>
      rowsOf(
        await db.execute(sql`SELECT ${PARTICIPANT_COLS} FROM ski_school_participants WHERE session_id IN (${sql.join(sessionIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY session_id, id`),
      ).map(toParticipant),
    );
  }
  participant(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${PARTICIPANT_COLS} FROM ski_school_participants WHERE id = ${id}`));
      return r ? toParticipant(r) : null;
    });
  }
  enroll(x: NewParticipant, check: (c: EnrollContext) => void) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [sr] = rowsOf(await tx.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions WHERE id = ${x.sessionId} FOR UPDATE`));
        const session = toSession(sr);
        const [c] = rowsOf(await tx.execute(sql`SELECT COUNT(*) AS n FROM ski_school_participants WHERE session_id = ${x.sessionId} AND status = 'enrolled'`));
        const sameDay = rowsOf(
          await tx.execute(sql`
            SELECT p.session_id, p.full_name, s.start_time, s.end_time
            FROM ski_school_participants p JOIN ski_school_sessions s ON s.id = p.session_id
            WHERE s.site_id = ${session.siteId} AND s.session_date = ${session.date} AND s.id <> ${session.id} AND s.status <> 'cancelled' AND p.status = 'enrolled'`),
        )
          .map((r) => ({ sessionId: Number(r.session_id), startTime: String(r.start_time), endTime: String(r.end_time), participantName: String(r.full_name) }))
          .filter((r) => overlaps(r.startTime, r.endTime, session.startTime, session.endTime));
        check({ session, enrolled: Number(c.n), sameDay });
        return insertIdOf(
          await tx.execute(sql`
            INSERT INTO ski_school_participants (site_id, session_id, full_name, age, level, notes)
            VALUES (${x.siteId}, ${x.sessionId}, ${x.name}, ${x.age}, ${x.level}, ${x.notes})`),
        );
      }),
    );
  }
  cancelParticipant(id: number) {
    return this.run(async (db) => affectedOf(await db.execute(sql`UPDATE ski_school_participants SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP(3) WHERE id = ${id} AND status = 'enrolled'`)) === 1);
  }

  moveParticipants(fromId: number, toId: number, ids: number[] | "all", cancelSource: boolean, check: (from: Session, to: Session, moving: number, enrolledTo: number) => void) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        // Orden fijo de bloqueo (id menor primero): dos fusiones cruzadas no se interbloquean
        const locked = rowsOf(await tx.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions WHERE id IN (${fromId}, ${toId}) ORDER BY id FOR UPDATE`)).map(toSession);
        const from = locked.find((x) => x.id === fromId)!;
        const to = locked.find((x) => x.id === toId)!;
        const filter = ids === "all" ? sql`` : sql`AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
        const [m] = rowsOf(await tx.execute(sql`SELECT COUNT(*) AS n FROM ski_school_participants WHERE session_id = ${fromId} AND status = 'enrolled' ${filter}`));
        const [t] = rowsOf(await tx.execute(sql`SELECT COUNT(*) AS n FROM ski_school_participants WHERE session_id = ${toId} AND status = 'enrolled'`));
        check(from, to, Number(m.n), Number(t.n));
        const res = await tx.execute(sql`UPDATE ski_school_participants SET session_id = ${toId} WHERE session_id = ${fromId} AND status = 'enrolled' ${filter}`);
        if (cancelSource) await tx.execute(sql`UPDATE ski_school_sessions SET status = 'cancelled' WHERE id = ${fromId}`);
        return Number((res as unknown as [{ affectedRows: number }])[0].affectedRows);
      }),
    );
  }

  /** Reserva del Core (tabla `reservations`): solo producto, fecha, personas y estado. */
  reservation(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT id, product_name, booking_date, people, status FROM reservations WHERE id = ${id}`));
      return r ? { id: Number(r.id), productName: String(r.product_name), bookingDate: String(r.booking_date).slice(0, 10), people: Number(r.people), status: String(r.status) } : null;
    });
  }
}
