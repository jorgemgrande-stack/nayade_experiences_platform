/**
 * Ski Net · Profesores: condiciones de pago y horas exigidas, control de horas por semana o mes, asistencia por sesión
 * (pasar lista una vez da la sesión por impartida), liquidaciones con importes congelados al cerrarlas, exportación
 * CSV y PDF (generador del Core) y la vista «Mis clases y horas» del portal del empleado.
 *
 * Mismo orden que la escuela (`service.ts`): sede válida → licencia `ski-school` de la sede → para operar, la escuela
 * activada en la sede. El portal identifica al profesor por el usuario del Core vinculado a su ficha.
 * Registro de la liquidación como gasto de contabilidad: fuera de esta entrega (el alta de gastos del Core exige
 * categoría, centro de coste y su propio flujo de permisos y caja).
 */
import { ModuleNotActive, assertSite, runWithSite, type EventBus, type ModuleGate } from "../sdk";
import { SKI_SCHOOL_ID, type SkiSchoolEvents } from "./manifest";
import { RuleError, dayNumber } from "./rules";
import { SkiSchoolError } from "./service";
import type { SkiSchoolStore } from "./store";
import {
  checkAttendance,
  computeSettlement,
  hoursByInstructor,
  normalizePayTerms,
  periodDays,
  proratedRequiredMinutes,
  sessionMinutes,
  settlementCsv,
  settlementHtml,
  splitReservation,
  type AttendanceStatus,
  type PayTerms,
  type SettlementExport,
  type SettleSession,
} from "./teachers";
import type { SettleContext, SkiTeacherStore } from "./teacherStore";

function rule<T>(fn: () => T, code: SkiSchoolError["code"] = "invalid_input"): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) throw new SkiSchoolError(code, e.message);
    throw e;
  }
}
const isDuplicate = (err: unknown) => {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  return false;
};

/** Roles del Core que entran en el portal del empleado. */
export const PORTAL_ROLES = ["employee", "monitor"];

export interface TeacherDeps {
  store: SkiTeacherStore;
  school: SkiSchoolStore;
  gate: () => ModuleGate;
  events: () => EventBus<SkiSchoolEvents>;
  assertSite?: (siteId: string) => Promise<void>;
  /** Hoy en la sede (por defecto, Madrid). */
  today?: () => string;
  /** Generador de PDF (por defecto, el del Core). */
  pdf?: (html: string) => Promise<Buffer>;
}

function madridToday(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "01";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const addDays = (d: string, n: number) => new Date((dayNumber(d) + n) * 86_400_000).toISOString().slice(0, 10);
const monthOf = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return { from: `${d.slice(0, 7)}-01`, to: `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
};

export class SkiTeacherService {
  constructor(private d: TeacherDeps) {}

  private within<T>(siteId: string, write: boolean, fn: () => Promise<T>): Promise<T> {
    return runWithSite(siteId, async () => {
      await (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_SCHOOL_ID)))(siteId);
      await this.d.gate().assert(SKI_SCHOOL_ID, { write, siteId });
      if (write && !(await this.d.school.site(siteId))?.active) throw new ModuleNotActive(SKI_SCHOOL_ID, siteId);
      return fn();
    });
  }
  private async siteInstructor(siteId: string, id: number) {
    const i = await this.d.school.instructor(id);
    if (!i || i.siteId !== siteId) throw new SkiSchoolError("not_found", "Profesor no encontrado en esta sede");
    return i;
  }
  private async siteSettlement(siteId: string, id: number) {
    const s = await this.d.store.settlement(id);
    if (!s || s.siteId !== siteId) throw new SkiSchoolError("not_found", "Liquidación no encontrada en esta sede");
    return s;
  }

  // ── Condiciones y vínculo con el usuario ─────────────────────────────────────

  updateTerms(siteId: string, instructorId: number, terms: Partial<PayTerms>, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteInstructor(siteId, instructorId);
      const t = rule(() => normalizePayTerms(terms));
      await this.d.store.saveTerms(instructorId, siteId, t, actor);
      return (await this.d.store.profile(instructorId))!;
    });
  }

  /** Vincula la ficha con un usuario del Core del portal del empleado (por su correo) o la desvincula (null). */
  linkUser(siteId: string, instructorId: number, email: string | null, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteInstructor(siteId, instructorId);
      let userId: number | null = null;
      if (email != null && email.trim()) {
        const u = await this.d.store.userByEmail(email.trim());
        if (!u) throw new SkiSchoolError("not_found", "No hay ningún usuario con ese correo en la empresa");
        if (!PORTAL_ROLES.includes(u.role)) throw new SkiSchoolError("invalid_input", "Ese usuario no tiene acceso al portal del empleado (rol empleado o monitor)");
        userId = u.id;
      }
      try {
        await this.d.store.setUser(instructorId, siteId, userId, actor);
      } catch (e) {
        if (isDuplicate(e)) throw new SkiSchoolError("conflict", "Ese usuario ya está vinculado a otro profesor");
        throw e;
      }
      return (await this.d.store.profile(instructorId))!;
    });
  }

  // ── Control de horas ─────────────────────────────────────────────────────────

  /** Por profesor: horas programadas e impartidas del periodo frente a las exigidas (prorrateadas). */
  hoursSummary(siteId: string, from: string, to: string) {
    return this.within(siteId, false, async () => {
      rule(() => periodDays(from, to));
      const [instructors, sessions, profiles] = await Promise.all([this.d.school.instructors(siteId), this.d.school.sessions(siteId, from, to), this.d.store.profiles(siteId)]);
      const hours = hoursByInstructor(sessions.filter((s) => s.instructorId != null).map((s) => ({ instructorId: s.instructorId!, status: s.status, startTime: s.startTime, endTime: s.endTime })));
      return instructors
        .filter((i) => i.active || hours.has(i.id))
        .map((i) => {
          const h = hours.get(i.id) ?? { scheduled: 0, taught: 0, sessions: 0 };
          const p = profiles.find((x) => x.instructorId === i.id);
          const required = proratedRequiredMinutes(p?.terms.requiredMinutesWeek ?? null, from, to);
          return { instructorId: i.id, fullName: i.fullName, active: i.active, ...h, requiredMinutes: required, balanceMinutes: required == null ? null : h.scheduled - required, terms: p?.terms ?? null, userLinked: p?.userId != null };
        });
    });
  }

  // ── Asistencia ───────────────────────────────────────────────────────────────

  getAttendance(siteId: string, sessionId: number) {
    return this.within(siteId, false, async () => {
      const s = await this.d.school.session(sessionId);
      if (!s || s.siteId !== siteId) throw new SkiSchoolError("not_found", "Sesión no encontrada en esta sede");
      const [closure, entries] = await Promise.all([this.d.store.closure(sessionId), this.d.store.attendance(sessionId)]);
      return { closure, entries };
    });
  }

  /** Pasar lista una sola vez (todos los inscritos); la sesión queda impartida. */
  recordAttendance(siteId: string, sessionId: number, entries: Array<{ participantId: number; status: AttendanceStatus }>, actor: string) {
    return this.within(siteId, true, async () => {
      const s = await this.d.school.session(sessionId);
      if (!s || s.siteId !== siteId) throw new SkiSchoolError("not_found", "Sesión no encontrada en esta sede");
      await this.d.store.closeSession(
        sessionId,
        entries,
        (cur, enrolled, closed) => {
          if (closed) throw new SkiSchoolError("conflict", "Ya se pasó lista en esta sesión");
          if (cur.status === "cancelled") throw new SkiSchoolError("conflict", "La sesión está cancelada");
          if (cur.instructorId == null) throw new SkiSchoolError("conflict", "Asigna un profesor antes de pasar lista");
          rule(() => checkAttendance(enrolled, entries));
        },
        actor,
      );
      // Pasar lista da la sesión por impartida: mismo evento que «Marcar como impartida»
      if (s.status === "assigned") await this.d.events().emit("ski_school.session.completed", { sessionId, reservationId: s.reservationId });
      return { closure: await this.d.store.closure(sessionId), entries: await this.d.store.attendance(sessionId) };
    });
  }

  // ── Liquidaciones ────────────────────────────────────────────────────────────

  private draft(terms: PayTerms, c: SettleContext, from: string, to: string) {
    const bases = new Map<number, number>();
    for (const r of c.reservations) splitReservation(r.amountPaidCents, r.sessionIds).forEach((cents, sid) => bases.set(sid, cents));
    const sessions: SettleSession[] = c.sessions.map((s) => ({ sessionId: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime, productName: s.productName, baseCents: bases.get(s.id) ?? 0 }));
    return rule(() => computeSettlement(terms, sessions, from, to), "conflict");
  }

  /** Vista previa (no guarda nada): sesiones impartidas sin liquidar del periodo con sus importes. */
  previewSettlement(siteId: string, instructorId: number, from: string, to: string) {
    return this.within(siteId, false, async () => {
      await this.siteInstructor(siteId, instructorId);
      rule(() => periodDays(from, to));
      const terms = (await this.d.store.profile(instructorId))?.terms;
      if (!terms?.payMode) throw new SkiSchoolError("conflict", "El profesor no tiene condiciones de pago configuradas");
      const c = await this.d.store.settleContext(siteId, instructorId, from, to);
      return { ...this.draft(terms, c, from, to), overlapping: c.overlapping > 0 };
    });
  }

  /** Cierra la liquidación: importes congelados; no se solapa con otra vigente del mismo profesor. */
  closeSettlement(siteId: string, instructorId: number, from: string, to: string, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteInstructor(siteId, instructorId);
      rule(() => periodDays(from, to));
      const terms = (await this.d.store.profile(instructorId))?.terms;
      if (!terms?.payMode) throw new SkiSchoolError("conflict", "El profesor no tiene condiciones de pago configuradas");
      let id: number;
      try {
        id = await this.d.store.createSettlement(
          siteId,
          instructorId,
          from,
          to,
          (c) => {
            if (c.overlapping > 0) throw new SkiSchoolError("conflict", "Ya hay una liquidación vigente de este profesor que se solapa con ese periodo");
            return this.draft(terms, c, from, to);
          },
          actor,
        );
      } catch (e) {
        if (isDuplicate(e)) throw new SkiSchoolError("conflict", "Alguna sesión ya está en otra liquidación");
        throw e;
      }
      const s = (await this.d.store.settlement(id))!;
      await this.d.events().emit("ski_school.settlement.closed", { settlementId: id, instructorId, totalCents: s.totalCents });
      return s;
    });
  }

  /** Anula una liquidación cerrada (queda registrada; sus sesiones pueden volver a liquidarse). */
  voidSettlement(siteId: string, id: number, reason: string, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteSettlement(siteId, id);
      const r = reason.trim();
      if (r.length < 3 || r.length > 300) throw new SkiSchoolError("invalid_input", "Indica el motivo de la anulación");
      if (!(await this.d.store.voidSettlement(id, r, actor))) throw new SkiSchoolError("conflict", "La liquidación ya estaba anulada");
      return (await this.d.store.settlement(id))!;
    });
  }

  listSettlements(siteId: string, instructorId?: number) {
    return this.within(siteId, false, async () => {
      const [rows, instructors] = await Promise.all([this.d.store.settlements(siteId, instructorId), this.d.school.instructors(siteId)]);
      return rows.map((s) => ({ ...s, instructorName: instructors.find((i) => i.id === s.instructorId)?.fullName ?? "—" }));
    });
  }

  getSettlement(siteId: string, id: number) {
    return this.within(siteId, false, () => this.exportData(siteId, id));
  }

  private async exportData(siteId: string, id: number): Promise<SettlementExport & { instructorId: number; createdAt: string; voidReason: string | null; baseCents: number; sessions: number }> {
    const s = await this.siteSettlement(siteId, id);
    const [lines, instr] = await Promise.all([this.d.store.settlementLines(id), this.d.school.instructor(s.instructorId)]);
    return { ...s, instructorName: instr?.fullName ?? "—", lines };
  }

  exportCsv(siteId: string, id: number) {
    return this.within(siteId, false, async () => {
      const s = await this.exportData(siteId, id);
      return { filename: `liquidacion-${s.id}-${s.periodStart}.csv`, content: settlementCsv(s) };
    });
  }

  exportPdf(siteId: string, id: number, companyName: string) {
    return this.within(siteId, false, async () => {
      const s = await this.exportData(siteId, id);
      const html = settlementHtml(s, companyName);
      const pdf = this.d.pdf ?? (async (h: string) => (await import("../pdfGenerator")).htmlToPdf(h));
      return { filename: `liquidacion-${s.id}-${s.periodStart}.pdf`, base64: (await pdf(html)).toString("base64") };
    });
  }

  // ── Portal del empleado ──────────────────────────────────────────────────────

  /** «Mis clases y horas»: próximas sesiones del profesor vinculado al usuario y sus horas del mes. */
  async myClasses(userId: number) {
    const p = await this.d.store.profileByUser(userId);
    if (!p) throw new SkiSchoolError("not_found", "Tu usuario no está vinculado a ningún profesor de la escuela");
    return this.within(p.siteId, false, async () => {
      const instr = await this.d.school.instructor(p.instructorId);
      if (!instr) throw new SkiSchoolError("not_found", "Profesor no encontrado");
      const today = (this.d.today ?? madridToday)();
      const month = monthOf(today);
      const [upcoming, monthSessions, products] = await Promise.all([this.d.school.sessions(p.siteId, today, addDays(today, 13)), this.d.school.sessions(p.siteId, month.from, month.to), this.d.school.products(p.siteId)]);
      const mine = (list: typeof upcoming) => list.filter((s) => s.instructorId === instr.id && s.status !== "cancelled");
      const parts = await this.d.school.participants(mine(upcoming).map((s) => s.id));
      const h = hoursByInstructor(mine(monthSessions).map((s) => ({ instructorId: instr.id, status: s.status, startTime: s.startTime, endTime: s.endTime }))).get(instr.id) ?? { scheduled: 0, taught: 0, sessions: 0 };
      return {
        fullName: instr.fullName,
        month: { ...month, ...h, requiredMinutes: proratedRequiredMinutes(p.terms.requiredMinutesWeek, month.from, month.to) },
        upcoming: mine(upcoming).map((s) => ({
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          minutes: sessionMinutes(s.startTime, s.endTime),
          status: s.status,
          productName: products.find((x) => x.id === s.productId)?.name ?? "—",
          level: s.level,
          meetingPoint: s.meetingPoint,
          // Solo nombre y nivel del alumno: lo que necesita el profesor para preparar la clase
          participants: parts.filter((x) => x.sessionId === s.id && x.status === "enrolled").map((x) => ({ name: x.name, age: x.age, level: x.level })),
        })),
      };
    });
  }
}
