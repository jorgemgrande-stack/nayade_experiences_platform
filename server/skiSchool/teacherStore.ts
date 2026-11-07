/**
 * Persistencia de Ski Net · Profesores en la BD de la empresa (migración `db/migrations/0039_ski_profesores.sql`):
 * condiciones y vínculo con el usuario, asistencia, cierres de sesión y liquidaciones. Una liquidación cerrada no se
 * edita: se anula (sus líneas dejan de contar y las sesiones vuelven a poder liquidarse). Sin las tablas → `ModuleNotInstalled`.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { ModuleNotInstalled } from "../sdk";
import { SKI_SCHOOL_ID } from "./manifest";
import type { MemorySkiSchoolStore, Session } from "./store";
import type { AttendanceStatus, PayMode, PayTerms, SettlementDraft } from "./teachers";

export interface Profile {
  instructorId: number;
  siteId: string;
  terms: PayTerms;
  userId: number | null;
}
export interface Closure {
  sessionId: number;
  instructorId: number | null;
  present: number;
  absent: number;
  closedAt: string;
}
export interface Settlement {
  id: number;
  siteId: string;
  instructorId: number;
  periodStart: string;
  periodEnd: string;
  payMode: PayMode;
  terms: PayTerms;
  minutes: number;
  sessions: number;
  baseCents: number;
  totalCents: number;
  status: "closed" | "voided";
  createdAt: string;
  voidReason: string | null;
}
export interface SettlementLine {
  id: number;
  settlementId: number;
  sessionId: number | null;
  date: string | null;
  description: string;
  minutes: number;
  baseCents: number;
  amountCents: number;
  active: boolean;
}
export interface CoreUser {
  id: number;
  role: string;
  name: string | null;
}
/** Lo que ve el cálculo de una liquidación, leído dentro de la transacción. */
export interface SettleContext {
  /** Sesiones impartidas por el profesor en el periodo y sin liquidar. */
  sessions: Array<Session & { productName: string }>;
  /** Reservas de esas sesiones: lo cobrado y sus sesiones no canceladas. */
  reservations: Array<{ id: number; amountPaidCents: number; sessionIds: number[] }>;
  /** Liquidaciones vigentes del profesor que se solapan con el periodo. */
  overlapping: number;
}

const EMPTY_TERMS: PayTerms = { payMode: null, hourlyRateCents: null, percentBp: null, monthlyCents: null, requiredMinutesWeek: null };

export interface SkiTeacherStore {
  profile(instructorId: number): Promise<Profile | null>;
  profiles(siteId: string): Promise<Profile[]>;
  saveTerms(instructorId: number, siteId: string, terms: PayTerms, actor: string): Promise<void>;
  /** Vincula (o desvincula con null) el usuario del Core; un usuario solo puede ser un profesor. */
  setUser(instructorId: number, siteId: string, userId: number | null, actor: string): Promise<void>;
  profileByUser(userId: number): Promise<Profile | null>;
  userByEmail(email: string): Promise<CoreUser | null>;

  attendance(sessionId: number): Promise<Array<{ participantId: number; status: AttendanceStatus }>>;
  closure(sessionId: number): Promise<Closure | null>;
  /** Pasar lista (una sola vez): bloquea la sesión, `check` lanza si no procede; guarda la asistencia y la da por impartida. */
  closeSession(sessionId: number, entries: Array<{ participantId: number; status: AttendanceStatus }>, check: (s: Session, enrolledIds: number[], alreadyClosed: boolean) => void, actor: string): Promise<void>;

  /** Sesiones impartidas del profesor en el periodo y sin liquidar (vista previa). */
  settleContext(siteId: string, instructorId: number, from: string, to: string): Promise<SettleContext>;
  /** Cierre atómico: bloquea al profesor, relee el contexto y guarda la liquidación con sus importes congelados. */
  createSettlement(siteId: string, instructorId: number, from: string, to: string, build: (c: SettleContext) => SettlementDraft, actor: string): Promise<number>;
  voidSettlement(id: number, reason: string, actor: string): Promise<boolean>;
  settlements(siteId: string, instructorId?: number): Promise<Settlement[]>;
  settlement(id: number): Promise<Settlement | null>;
  settlementLines(settlementId: number): Promise<SettlementLine[]>;
  /** Liquidaciones vigentes que contienen cada sesión (para marcar lo ya liquidado). */
  settledSessionIds(sessionIds: number[]): Promise<Set<number>>;
}

// ── En memoria (pruebas): usa los datos de la escuela en memoria ─────────────────

const clone = <T>(x: T): T => structuredClone(x);
const dup = () => Object.assign(new Error("duplicado"), { code: "ER_DUP_ENTRY" });

export class MemorySkiTeacherStore implements SkiTeacherStore {
  private prof = new Map<number, Profile>();
  private att = new Map<number, Array<{ participantId: number; status: AttendanceStatus }>>();
  private clo = new Map<number, Closure>();
  private set: Settlement[] = [];
  private lines: SettlementLine[] = [];
  users: CoreUser[] = [];
  userEmails = new Map<string, number>();

  constructor(private school: MemorySkiSchoolStore) {}

  async profile(instructorId: number) {
    const p = this.prof.get(instructorId);
    return p ? clone(p) : null;
  }
  async profiles(siteId: string) {
    return Array.from(this.prof.values()).filter((p) => p.siteId === siteId).map(clone);
  }
  private ensure(instructorId: number, siteId: string) {
    const p = this.prof.get(instructorId) ?? { instructorId, siteId, terms: { ...EMPTY_TERMS }, userId: null };
    this.prof.set(instructorId, p);
    return p;
  }
  async saveTerms(instructorId: number, siteId: string, terms: PayTerms) {
    this.ensure(instructorId, siteId).terms = clone(terms);
  }
  async setUser(instructorId: number, siteId: string, userId: number | null) {
    if (userId != null && Array.from(this.prof.values()).some((p) => p.userId === userId && p.instructorId !== instructorId)) throw dup();
    this.ensure(instructorId, siteId).userId = userId;
  }
  async profileByUser(userId: number) {
    const p = Array.from(this.prof.values()).find((x) => x.userId === userId);
    return p ? clone(p) : null;
  }
  async userByEmail(email: string) {
    const id = this.userEmails.get(email.toLowerCase());
    return this.users.find((u) => u.id === id) ?? null;
  }
  async attendance(sessionId: number) {
    return clone(this.att.get(sessionId) ?? []);
  }
  async closure(sessionId: number) {
    const c = this.clo.get(sessionId);
    return c ? clone(c) : null;
  }
  async closeSession(sessionId: number, entries: Array<{ participantId: number; status: AttendanceStatus }>, check: (s: Session, enrolledIds: number[], alreadyClosed: boolean) => void) {
    const s = (await this.school.session(sessionId))!;
    const enrolled = (await this.school.participants([sessionId])).filter((p) => p.status === "enrolled").map((p) => p.id);
    check(s, enrolled, this.clo.has(sessionId));
    this.att.set(sessionId, clone(entries));
    this.clo.set(sessionId, { sessionId, instructorId: s.instructorId, present: entries.filter((e) => e.status !== "absent").length, absent: entries.filter((e) => e.status === "absent").length, closedAt: new Date().toISOString() });
    if (s.status === "assigned") await this.school.updateSession(sessionId, { status: "completed" });
  }
  async settleContext(siteId: string, instructorId: number, from: string, to: string): Promise<SettleContext> {
    const settled = new Set(this.lines.filter((l) => l.active && l.sessionId != null).map((l) => l.sessionId!));
    const products = await this.school.products(siteId);
    const all = await this.school.sessions(siteId, "0000-01-01", "9999-12-31");
    const sessions = all
      .filter((s) => s.instructorId === instructorId && s.status === "completed" && s.date >= from && s.date <= to && !settled.has(s.id))
      .map((s) => ({ ...s, productName: products.find((p) => p.id === s.productId)?.name ?? "—" }));
    const resIds = Array.from(new Set(sessions.map((s) => s.reservationId).filter((x): x is number => x != null)));
    const reservations = resIds.map((id) => ({ id, amountPaidCents: this.paid.get(id) ?? 0, sessionIds: all.filter((s) => s.reservationId === id && s.status !== "cancelled").map((s) => s.id) }));
    const overlapping = this.set.filter((x) => x.instructorId === instructorId && x.status === "closed" && x.periodStart <= to && x.periodEnd >= from).length;
    return { sessions, reservations, overlapping };
  }
  /** Lo cobrado por reserva (céntimos), para el modo %. */
  paid = new Map<number, number>();
  async createSettlement(siteId: string, instructorId: number, from: string, to: string, build: (c: SettleContext) => SettlementDraft, actor: string) {
    void actor;
    const d = build(await this.settleContext(siteId, instructorId, from, to));
    const id = this.set.length + 1;
    this.set.push({ id, siteId, instructorId, periodStart: from, periodEnd: to, payMode: d.payMode, terms: clone(d.terms), minutes: d.minutes, sessions: d.sessions, baseCents: d.baseCents, totalCents: d.totalCents, status: "closed", createdAt: new Date().toISOString(), voidReason: null });
    for (const l of d.lines) this.lines.push({ id: this.lines.length + 1, settlementId: id, ...l, active: true });
    return id;
  }
  async voidSettlement(id: number, reason: string) {
    const s = this.set.find((x) => x.id === id);
    if (!s || s.status !== "closed") return false;
    s.status = "voided";
    s.voidReason = reason;
    for (const l of this.lines) if (l.settlementId === id) l.active = false;
    return true;
  }
  async settlements(siteId: string, instructorId?: number) {
    return this.set.filter((s) => s.siteId === siteId && (instructorId == null || s.instructorId === instructorId)).map(clone);
  }
  async settlement(id: number) {
    const s = this.set.find((x) => x.id === id);
    return s ? clone(s) : null;
  }
  async settlementLines(settlementId: number) {
    return this.lines.filter((l) => l.settlementId === settlementId).map(clone);
  }
  async settledSessionIds(sessionIds: number[]) {
    return new Set(this.lines.filter((l) => l.active && l.sessionId != null && sessionIds.includes(l.sessionId)).map((l) => l.sessionId!));
  }
}

// ── BD de la empresa ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>;
type Exec = Pick<Db, "execute">;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const insertIdOf = (res: unknown) => Number((res as [{ insertId: number }])[0].insertId);
const affectedOf = (res: unknown) => Number((res as [{ affectedRows: number }])[0].affectedRows);
const num = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /ski_school_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

const toProfile = (r: Row): Profile => ({
  instructorId: Number(r.instructor_id),
  siteId: String(r.site_id),
  userId: num(r.user_id),
  terms: { payMode: (r.pay_mode as PayMode | null) ?? null, hourlyRateCents: num(r.hourly_rate_cents), percentBp: num(r.percent_bp), monthlyCents: num(r.monthly_cents), requiredMinutesWeek: num(r.required_minutes_week) },
});
const SETTLEMENT_COLS = sql.raw(
  "id, site_id, instructor_id, DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start, DATE_FORMAT(period_end, '%Y-%m-%d') AS period_end, pay_mode, terms, minutes, sessions, base_cents, total_cents, status, created_at, void_reason",
);
const toSettlement = (r: Row): Settlement => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  instructorId: Number(r.instructor_id),
  periodStart: String(r.period_start),
  periodEnd: String(r.period_end),
  payMode: r.pay_mode as PayMode,
  terms: json<PayTerms>(r.terms, EMPTY_TERMS),
  minutes: Number(r.minutes),
  sessions: Number(r.sessions),
  baseCents: Number(r.base_cents),
  totalCents: Number(r.total_cents),
  status: r.status as Settlement["status"],
  createdAt: iso(r.created_at)!,
  voidReason: r.void_reason == null ? null : String(r.void_reason),
});
const SESSION_COLS = sql.raw(
  "s.id, s.site_id, s.product_id, DATE_FORMAT(s.session_date, '%Y-%m-%d') AS session_date, s.start_time, s.end_time, s.modality, s.level, s.language, s.capacity, s.instructor_id, s.status, s.reservation_id, s.meeting_point, s.notes",
);
const toSession = (r: Row): Session => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  productId: Number(r.product_id),
  date: String(r.session_date),
  startTime: String(r.start_time),
  endTime: String(r.end_time),
  modality: r.modality == null ? null : String(r.modality),
  level: r.level == null ? null : String(r.level),
  language: r.language == null ? null : String(r.language),
  capacity: Number(r.capacity),
  instructorId: num(r.instructor_id),
  status: r.status as Session["status"],
  reservationId: num(r.reservation_id),
  meetingPoint: r.meeting_point == null ? null : String(r.meeting_point),
  notes: r.notes == null ? null : String(r.notes),
});

async function readContext(tx: Exec, siteId: string, instructorId: number, from: string, to: string): Promise<SettleContext> {
  const sessions = rowsOf(
    await tx.execute(sql`
      SELECT ${SESSION_COLS}, p.name AS product_name
      FROM ski_school_sessions s JOIN ski_school_products p ON p.id = s.product_id
      WHERE s.site_id = ${siteId} AND s.instructor_id = ${instructorId} AND s.status = 'completed' AND s.session_date BETWEEN ${from} AND ${to}
        AND NOT EXISTS (SELECT 1 FROM ski_school_settlement_lines l WHERE l.open_session_id = s.id)
      ORDER BY s.session_date, s.start_time, s.id`),
  ).map((r) => ({ ...toSession(r), productName: String(r.product_name) }));
  const resIds = Array.from(new Set(sessions.map((s) => s.reservationId).filter((x): x is number => x != null)));
  const reservations: SettleContext["reservations"] = [];
  if (resIds.length) {
    const list = sql.join(resIds.map((i) => sql`${i}`), sql`, `);
    const paid = rowsOf(await tx.execute(sql`SELECT id, amount_paid FROM reservations WHERE id IN (${list})`));
    const linked = rowsOf(await tx.execute(sql`SELECT id, reservation_id FROM ski_school_sessions WHERE site_id = ${siteId} AND reservation_id IN (${list}) AND status <> 'cancelled'`));
    for (const id of resIds) {
      reservations.push({
        id,
        amountPaidCents: Number(paid.find((p) => Number(p.id) === id)?.amount_paid ?? 0),
        sessionIds: linked.filter((l) => Number(l.reservation_id) === id).map((l) => Number(l.id)),
      });
    }
  }
  const [ov] = rowsOf(
    await tx.execute(sql`SELECT COUNT(*) AS n FROM ski_school_settlements WHERE instructor_id = ${instructorId} AND status = 'closed' AND period_start <= ${to} AND period_end >= ${from}`),
  );
  return { sessions, reservations, overlapping: Number(ov.n) };
}

/** Almacén sobre la BD de la empresa en curso (contexto de tenant del Core). */
export class TenantDbSkiTeacherStore implements SkiTeacherStore {
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

  profile(instructorId: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM ski_school_instructor_profiles WHERE instructor_id = ${instructorId}`));
      return r ? toProfile(r) : null;
    });
  }
  profiles(siteId: string) {
    return this.run(async (db) => rowsOf(await db.execute(sql`SELECT * FROM ski_school_instructor_profiles WHERE site_id = ${siteId}`)).map(toProfile));
  }
  saveTerms(instructorId: number, siteId: string, t: PayTerms, actor: string) {
    return this.run(async (db) => {
      await db.execute(sql`
        INSERT INTO ski_school_instructor_profiles (instructor_id, site_id, required_minutes_week, pay_mode, hourly_rate_cents, percent_bp, monthly_cents, updated_by)
        VALUES (${instructorId}, ${siteId}, ${t.requiredMinutesWeek}, ${t.payMode}, ${t.hourlyRateCents}, ${t.percentBp}, ${t.monthlyCents}, ${actor.slice(0, 100)})
        ON DUPLICATE KEY UPDATE required_minutes_week = VALUES(required_minutes_week), pay_mode = VALUES(pay_mode), hourly_rate_cents = VALUES(hourly_rate_cents),
          percent_bp = VALUES(percent_bp), monthly_cents = VALUES(monthly_cents), updated_by = VALUES(updated_by)`);
    });
  }
  setUser(instructorId: number, siteId: string, userId: number | null, actor: string) {
    return this.run(async (db) => {
      await db.execute(sql`
        INSERT INTO ski_school_instructor_profiles (instructor_id, site_id, user_id, updated_by) VALUES (${instructorId}, ${siteId}, ${userId}, ${actor.slice(0, 100)})
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), updated_by = VALUES(updated_by)`);
    });
  }
  profileByUser(userId: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM ski_school_instructor_profiles WHERE user_id = ${userId}`));
      return r ? toProfile(r) : null;
    });
  }
  userByEmail(email: string) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT id, role, name FROM users WHERE LOWER(email) = ${email.toLowerCase()} LIMIT 1`));
      return r ? { id: Number(r.id), role: String(r.role), name: r.name == null ? null : String(r.name) } : null;
    });
  }

  attendance(sessionId: number) {
    return this.run(async (db) =>
      rowsOf(await db.execute(sql`SELECT participant_id, status FROM ski_school_attendance WHERE session_id = ${sessionId} ORDER BY id`)).map((r) => ({ participantId: Number(r.participant_id), status: r.status as AttendanceStatus })),
    );
  }
  closure(sessionId: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT * FROM ski_school_session_closures WHERE session_id = ${sessionId}`));
      return r ? { sessionId: Number(r.session_id), instructorId: num(r.instructor_id), present: Number(r.present), absent: Number(r.absent), closedAt: iso(r.closed_at)! } : null;
    });
  }
  closeSession(sessionId: number, entries: Array<{ participantId: number; status: AttendanceStatus }>, check: (s: Session, enrolledIds: number[], alreadyClosed: boolean) => void, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const [sr] = rowsOf(await tx.execute(sql`SELECT ${SESSION_COLS} FROM ski_school_sessions s WHERE s.id = ${sessionId} FOR UPDATE`));
        const s = toSession(sr);
        const enrolled = rowsOf(await tx.execute(sql`SELECT id FROM ski_school_participants WHERE session_id = ${sessionId} AND status = 'enrolled'`)).map((r) => Number(r.id));
        const [c] = rowsOf(await tx.execute(sql`SELECT session_id FROM ski_school_session_closures WHERE session_id = ${sessionId}`));
        check(s, enrolled, !!c);
        for (const e of entries) await tx.execute(sql`INSERT INTO ski_school_attendance (site_id, session_id, participant_id, status) VALUES (${s.siteId}, ${sessionId}, ${e.participantId}, ${e.status})`);
        await tx.execute(sql`
          INSERT INTO ski_school_session_closures (session_id, site_id, instructor_id, present, absent, closed_by)
          VALUES (${sessionId}, ${s.siteId}, ${s.instructorId}, ${entries.filter((e) => e.status !== "absent").length}, ${entries.filter((e) => e.status === "absent").length}, ${actor.slice(0, 100)})`);
        if (s.status === "assigned") await tx.execute(sql`UPDATE ski_school_sessions SET status = 'completed' WHERE id = ${sessionId}`);
      }),
    );
  }

  settleContext(siteId: string, instructorId: number, from: string, to: string) {
    return this.run((db) => readContext(db, siteId, instructorId, from, to));
  }
  createSettlement(siteId: string, instructorId: number, from: string, to: string, build: (c: SettleContext) => SettlementDraft, actor: string) {
    return this.run(async (db) => {
      // La fila del profesor se crea fuera de la transacción (dos INSERT IGNORE dentro se bloquean mutuamente)
      await db.execute(sql`INSERT IGNORE INTO ski_school_instructor_profiles (instructor_id, site_id) VALUES (${instructorId}, ${siteId})`);
      return db.transaction(async (tx) => {
        // Bloquear al profesor serializa dos cierres simultáneos del mismo periodo
        await tx.execute(sql`SELECT instructor_id FROM ski_school_instructor_profiles WHERE instructor_id = ${instructorId} FOR UPDATE`);
        const d = build(await readContext(tx, siteId, instructorId, from, to));
        const id = insertIdOf(
          await tx.execute(sql`
            INSERT INTO ski_school_settlements (site_id, instructor_id, period_start, period_end, pay_mode, terms, minutes, sessions, base_cents, total_cents, created_by)
            VALUES (${siteId}, ${instructorId}, ${from}, ${to}, ${d.payMode}, ${JSON.stringify(d.terms)}, ${d.minutes}, ${d.sessions}, ${d.baseCents}, ${d.totalCents}, ${actor.slice(0, 100)})`),
        );
        for (const l of d.lines) {
          await tx.execute(sql`
            INSERT INTO ski_school_settlement_lines (site_id, settlement_id, session_id, session_date, description, minutes, base_cents, amount_cents)
            VALUES (${siteId}, ${id}, ${l.sessionId}, ${l.date}, ${l.description.slice(0, 200)}, ${l.minutes}, ${l.baseCents}, ${l.amountCents})`);
        }
        return id;
      });
    });
  }
  voidSettlement(id: number, reason: string, actor: string) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        const n = affectedOf(
          await tx.execute(sql`UPDATE ski_school_settlements SET status = 'voided', voided_by = ${actor.slice(0, 100)}, voided_at = CURRENT_TIMESTAMP(3), void_reason = ${reason.slice(0, 300)} WHERE id = ${id} AND status = 'closed'`),
        );
        if (n === 1) await tx.execute(sql`UPDATE ski_school_settlement_lines SET active = 0 WHERE settlement_id = ${id}`);
        return n === 1;
      }),
    );
  }
  settlements(siteId: string, instructorId?: number) {
    return this.run(async (db) =>
      rowsOf(
        await db.execute(
          sql`SELECT ${SETTLEMENT_COLS} FROM ski_school_settlements WHERE site_id = ${siteId} ${instructorId == null ? sql`` : sql`AND instructor_id = ${instructorId}`} ORDER BY period_start DESC, id DESC LIMIT 500`,
        ),
      ).map(toSettlement),
    );
  }
  settlement(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${SETTLEMENT_COLS} FROM ski_school_settlements WHERE id = ${id}`));
      return r ? toSettlement(r) : null;
    });
  }
  settlementLines(settlementId: number) {
    return this.run(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT id, settlement_id, session_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date, description, minutes, base_cents, amount_cents, active
          FROM ski_school_settlement_lines WHERE settlement_id = ${settlementId} ORDER BY session_date IS NULL, session_date, id`),
      ).map((r) => ({
        id: Number(r.id),
        settlementId: Number(r.settlement_id),
        sessionId: num(r.session_id),
        date: r.session_date == null ? null : String(r.session_date),
        description: String(r.description),
        minutes: Number(r.minutes),
        baseCents: Number(r.base_cents),
        amountCents: Number(r.amount_cents),
        active: Number(r.active) === 1,
      })),
    );
  }
  settledSessionIds(sessionIds: number[]) {
    if (!sessionIds.length) return Promise.resolve(new Set<number>());
    return this.run(async (db) => new Set(rowsOf(await db.execute(sql`SELECT open_session_id FROM ski_school_settlement_lines WHERE open_session_id IN (${sql.join(sessionIds.map((i) => sql`${i}`), sql`, `)})`)).map((r) => Number(r.open_session_id))));
  }
}
