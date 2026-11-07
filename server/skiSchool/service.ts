/**
 * Reglas de Ski Net · Escuela. Cada operación, en este orden:
 *  1. Sede válida y activa en la empresa (directorio de sedes del SDK).
 *  2. Licencia por capacidad `ski-school` para esa sede (`ModuleGate`): sin licencia → `ModuleNotLicensed`;
 *     `read_only` o caducada → consultas sí, operaciones `ModuleReadOnly`.
 *  3. Operaciones (no consultas): la escuela debe estar ACTIVADA en la sede (`ModuleNotActive`). Las consultas
 *     siguen disponibles en una sede desactivada: los datos se conservan y se pueden revisar.
 * Los rechazos de negocio salen como `SkiSchoolError` con un mensaje claro para el panel.
 */
import { ModuleNotActive, assertSite, runWithSite, type EventBus, type ModuleGate } from "../sdk";
import { SKI_SCHOOL_ID, type SkiSchoolEvents } from "./manifest";
import {
  ABSENCE_KINDS,
  PRODUCT_KINDS,
  RuleError,
  checkEnrollment,
  checkRange,
  checkSlot,
  dayNumber,
  evaluateInstructor,
  findOverlappingEnrollment,
  fromMinutes,
  normalizeConfig,
  normalizeWeekly,
  pickCode,
  pickCodes,
  proposeInstructors,
  toMinutes,
  type AbsenceKind,
  type AbsencePeriod,
  type InstructorProfile,
  type PlanningLimits,
  type ProductKind,
  type SchoolConfig,
  type SlotRequest,
  type WeeklySlot,
} from "./rules";
import type { Absence, Instructor, Participant, Product, Session, SkiSchoolStore } from "./store";

export class SkiSchoolError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "SkiSchoolError";
  }
}

const isDuplicate = (err: unknown) => {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  return false;
};

/** Ejecuta una regla pura y traduce su error a `invalid_input`. */
function rule<T>(fn: () => T, code: SkiSchoolError["code"] = "invalid_input"): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) throw new SkiSchoolError(code, e.message);
    throw e;
  }
}

const text = (v: string | null | undefined, max: number, what: string, min = 0): string | null => {
  const t = (v ?? "").trim();
  if (!t) {
    if (min > 0) throw new SkiSchoolError("invalid_input", `${what}: obligatorio`);
    return null;
  }
  if (t.length < min || t.length > max) throw new SkiSchoolError("invalid_input", `${what}: entre ${min || 1} y ${max} caracteres`);
  return t;
};
const age = (v: number | null | undefined, what: string): number | null => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 0 || v > 120) throw new SkiSchoolError("invalid_input", `${what}: edad no válida`);
  return v;
};
function ageRange(min: number | null | undefined, max: number | null | undefined) {
  const a = age(min, "Edad mínima");
  const b = age(max, "Edad máxima");
  if (a != null && b != null && b < a) throw new SkiSchoolError("invalid_input", "La edad máxima es menor que la mínima");
  return { minAge: a, maxAge: b };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InstructorInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  modalities?: string[];
  levels?: string[];
  languages?: string[];
  minAge?: number | null;
  maxAge?: number | null;
  weekly?: WeeklySlot[];
  notes?: string | null;
}
export interface ProductInput {
  name: string;
  kind: ProductKind;
  durationMinutes: number;
  capacity: number;
  level?: string | null;
  modality?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
}
export interface SessionInput {
  productId: number;
  date: string;
  startTime: string;
  /** Por defecto, inicio + duración del producto. */
  endTime?: string;
  modality?: string | null;
  level?: string | null;
  language?: string | null;
  capacity?: number;
  reservationId?: number | null;
  meetingPoint?: string | null;
  notes?: string | null;
}

export interface SkiSchoolDeps {
  store: SkiSchoolStore;
  gate: () => ModuleGate;
  events: () => EventBus<SkiSchoolEvents>;
  /** Por defecto, el directorio de sedes del SDK. */
  assertSite?: (siteId: string) => Promise<void>;
}

const toProfile = (i: Instructor): InstructorProfile => ({
  id: i.id,
  fullName: i.fullName,
  active: i.active,
  modalities: i.modalities,
  levels: i.levels,
  languages: i.languages,
  minAge: i.minAge,
  maxAge: i.maxAge,
  weekly: i.weekly,
});
const toPeriod = (a: Absence): AbsencePeriod => ({ startDate: a.startDate, endDate: a.endDate, kind: a.kind, startTime: a.startTime, endTime: a.endTime });
const busyOf = (s: Session) => ({ id: s.id, startTime: s.startTime, endTime: s.endTime, meetingPoint: s.meetingPoint });

export class SkiSchoolService {
  constructor(private d: SkiSchoolDeps) {}

  private checkSite(siteId: string) {
    return (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_SCHOOL_ID)))(siteId);
  }

  private async guard(siteId: string, write: boolean, requireActive = write): Promise<void> {
    await this.checkSite(siteId);
    await this.d.gate().assert(SKI_SCHOOL_ID, { write, siteId });
    if (requireActive && !(await this.d.store.site(siteId))?.active) throw new ModuleNotActive(SKI_SCHOOL_ID, siteId);
  }

  private within<T>(siteId: string, write: boolean, fn: () => Promise<T>, requireActive = write): Promise<T> {
    return runWithSite(siteId, async () => {
      await this.guard(siteId, write, requireActive);
      return fn();
    });
  }

  private async config(siteId: string): Promise<SchoolConfig> {
    const s = await this.d.store.site(siteId);
    try {
      return normalizeConfig(s?.config ?? null);
    } catch {
      // Configuración guardada que ya no valida (no debería ocurrir): se usa la plantilla
      return normalizeConfig(null);
    }
  }

  private async siteInstructor(siteId: string, id: number): Promise<Instructor> {
    const i = await this.d.store.instructor(id);
    if (!i || i.siteId !== siteId) throw new SkiSchoolError("not_found", "Profesor no encontrado en esta sede");
    return i;
  }
  private async siteProduct(siteId: string, id: number): Promise<Product> {
    const p = await this.d.store.product(id);
    if (!p || p.siteId !== siteId) throw new SkiSchoolError("not_found", "Producto docente no encontrado en esta sede");
    return p;
  }
  private async siteSession(siteId: string, id: number): Promise<Session> {
    const s = await this.d.store.session(id);
    if (!s || s.siteId !== siteId) throw new SkiSchoolError("not_found", "Sesión no encontrada en esta sede");
    return s;
  }

  // ── Estado, activación y configuración ─────────────────────────────────────────

  /** Estado de la escuela en la sede (no lanza por licencia: es para pantallas de estado). */
  async status(siteId: string) {
    return runWithSite(siteId, async () => {
      await this.checkSite(siteId);
      const [read, write, site] = await Promise.all([
        this.d.gate().status(SKI_SCHOOL_ID, { write: false, siteId }),
        this.d.gate().status(SKI_SCHOOL_ID, { write: true, siteId }),
        this.d.store.site(siteId),
      ]);
      let config: SchoolConfig;
      try {
        config = normalizeConfig(site?.config ?? null);
      } catch {
        config = normalizeConfig(null);
      }
      return {
        siteId,
        license: { read: read.allowed, write: write.allowed, code: write.code ?? read.code, reason: write.reason ?? read.reason },
        active: !!site?.active,
        config,
      };
    });
  }

  activateSite(siteId: string, actor: string) {
    return this.within(
      siteId,
      true,
      async () => {
        await this.d.store.setSiteActive(siteId, true, actor);
        await this.d.events().emit("ski_school.site.activated", { siteId });
        return { siteId, active: true };
      },
      false,
    );
  }

  /** Desactiva la escuela en la sede. No borra nada. */
  deactivateSite(siteId: string, actor: string) {
    return this.within(
      siteId,
      true,
      async () => {
        await this.d.store.setSiteActive(siteId, false, actor);
        await this.d.events().emit("ski_school.site.deactivated", { siteId });
        return { siteId, active: false };
      },
      false,
    );
  }

  /** Niveles, modalidades, idiomas, horario y límites de la sede (sin datos = plantilla por defecto). */
  updateConfig(siteId: string, patch: Omit<Partial<SchoolConfig>, "limits"> & { limits?: Partial<PlanningLimits> }, actor: string) {
    return this.within(siteId, true, async () => {
      const current = await this.config(siteId);
      const next = rule(() => normalizeConfig({ ...current, ...patch, limits: { ...current.limits, ...(patch.limits ?? {}) } }));
      await this.d.store.setConfig(siteId, next, actor);
      return next;
    });
  }

  // ── Profesores ─────────────────────────────────────────────────────────────────

  listInstructors(siteId: string) {
    return this.within(siteId, false, () => this.d.store.instructors(siteId));
  }

  private instructorFields(input: Partial<InstructorInput>, cfg: SchoolConfig) {
    const out: Partial<Omit<Instructor, "id" | "siteId" | "active">> = {};
    if (input.fullName !== undefined) out.fullName = text(input.fullName, 120, "Nombre del profesor", 2)!;
    if (input.email !== undefined) {
      out.email = text(input.email, 200, "Correo");
      if (out.email && !EMAIL_RE.test(out.email)) throw new SkiSchoolError("invalid_input", "Correo no válido");
    }
    if (input.phone !== undefined) out.phone = text(input.phone, 30, "Teléfono");
    if (input.modalities !== undefined) out.modalities = rule(() => pickCodes(input.modalities, cfg.modalities, "Modalidades"));
    if (input.levels !== undefined) out.levels = rule(() => pickCodes(input.levels, cfg.levels, "Niveles"));
    if (input.languages !== undefined) out.languages = rule(() => pickCodes(input.languages, cfg.languages, "Idiomas"));
    if (input.weekly !== undefined) out.weekly = rule(() => normalizeWeekly(input.weekly!));
    if (input.notes !== undefined) out.notes = text(input.notes, 1000, "Notas");
    return out;
  }

  createInstructor(siteId: string, input: InstructorInput) {
    return this.within(siteId, true, async () => {
      const cfg = await this.config(siteId);
      const f = this.instructorFields({ modalities: [], levels: [], languages: [], weekly: [], email: null, phone: null, notes: null, ...input }, cfg);
      const id = await this.d.store.insertInstructor({
        siteId,
        fullName: f.fullName!,
        email: f.email ?? null,
        phone: f.phone ?? null,
        modalities: f.modalities ?? [],
        levels: f.levels ?? [],
        languages: f.languages ?? [],
        weekly: f.weekly ?? [],
        notes: f.notes ?? null,
        ...ageRange(input.minAge, input.maxAge),
      });
      return (await this.d.store.instructor(id))!;
    });
  }

  /** Cambia la ficha o archiva/reactiva (`active`). No se borra a nadie. */
  updateInstructor(siteId: string, id: number, input: Partial<InstructorInput> & { active?: boolean }) {
    return this.within(siteId, true, async () => {
      const cur = await this.siteInstructor(siteId, id);
      const cfg = await this.config(siteId);
      const f = this.instructorFields(input, cfg);
      const ages = input.minAge !== undefined || input.maxAge !== undefined ? ageRange(input.minAge !== undefined ? input.minAge : cur.minAge, input.maxAge !== undefined ? input.maxAge : cur.maxAge) : {};
      await this.d.store.updateInstructor(id, { ...f, ...ages, ...(input.active !== undefined ? { active: input.active } : {}) });
      return (await this.d.store.instructor(id))!;
    });
  }

  listAbsences(siteId: string, from: string, to: string, instructorId?: number) {
    return this.within(siteId, false, async () => {
      rule(() => {
        dayNumber(from);
        dayNumber(to);
        if (to < from) throw new RuleError("La fecha final es anterior a la inicial");
      });
      return this.d.store.absences(siteId, from, to, instructorId);
    });
  }

  /** Ausencia (día completo) o bloqueo parcial de un profesor en un periodo. */
  addAbsence(siteId: string, input: { instructorId: number; startDate: string; endDate?: string; kind: AbsenceKind; startTime?: string | null; endTime?: string | null; reason?: string | null }, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteInstructor(siteId, input.instructorId);
      const endDate = input.endDate ?? input.startDate;
      if (!ABSENCE_KINDS.includes(input.kind)) throw new SkiSchoolError("invalid_input", "Tipo de ausencia no válido");
      rule(() => {
        const a = dayNumber(input.startDate);
        const b = dayNumber(endDate);
        if (b < a) throw new RuleError("La fecha final es anterior a la inicial");
        if (b - a > 366) throw new RuleError("Una ausencia no puede superar un año");
        if (input.kind === "partial_block") checkSlot(input.startTime ?? "", input.endTime ?? "", "Bloqueo");
      });
      const partial = input.kind === "partial_block";
      const id = await this.d.store.insertAbsence(
        {
          siteId,
          instructorId: input.instructorId,
          startDate: input.startDate,
          endDate,
          kind: input.kind,
          startTime: partial ? input.startTime! : null,
          endTime: partial ? input.endTime! : null,
          reason: text(input.reason, 200, "Motivo"),
        },
        actor,
      );
      return (await this.d.store.absence(id))!;
    });
  }

  /** Anula una ausencia (queda registrada, deja de bloquear). */
  cancelAbsence(siteId: string, absenceId: number) {
    return this.within(siteId, true, async () => {
      const a = await this.d.store.absence(absenceId);
      if (!a || a.siteId !== siteId) throw new SkiSchoolError("not_found", "Ausencia no encontrada en esta sede");
      await this.d.store.cancelAbsence(absenceId);
      return { absenceId, cancelled: true };
    });
  }

  // ── Productos docentes ─────────────────────────────────────────────────────────

  listProducts(siteId: string) {
    return this.within(siteId, false, () => this.d.store.products(siteId));
  }

  private productFields(input: Partial<ProductInput>, cfg: SchoolConfig) {
    const out: Partial<Omit<Product, "id" | "siteId" | "active">> = {};
    if (input.name !== undefined) out.name = text(input.name, 120, "Nombre del producto", 2)!;
    if (input.kind !== undefined) {
      if (!PRODUCT_KINDS.includes(input.kind)) throw new SkiSchoolError("invalid_input", "Tipo de producto no válido");
      out.kind = input.kind;
    }
    if (input.durationMinutes !== undefined) {
      if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 600) throw new SkiSchoolError("invalid_input", "Duración: entre 15 y 600 minutos");
      out.durationMinutes = input.durationMinutes;
    }
    if (input.capacity !== undefined) {
      if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 100) throw new SkiSchoolError("invalid_input", "Capacidad: entre 1 y 100 alumnos");
      out.capacity = input.capacity;
    }
    if (input.level !== undefined) out.level = rule(() => pickCode(input.level, cfg.levels, "Nivel"));
    if (input.modality !== undefined) out.modality = rule(() => pickCode(input.modality, cfg.modalities, "Modalidad"));
    return out;
  }

  createProduct(siteId: string, input: ProductInput) {
    return this.within(siteId, true, async () => {
      const cfg = await this.config(siteId);
      const f = this.productFields({ level: null, modality: null, ...input }, cfg);
      try {
        const id = await this.d.store.insertProduct({
          siteId,
          name: f.name!,
          kind: f.kind!,
          durationMinutes: f.durationMinutes!,
          capacity: f.capacity!,
          level: f.level ?? null,
          modality: f.modality ?? null,
          ...ageRange(input.minAge, input.maxAge),
        });
        return (await this.d.store.product(id))!;
      } catch (e) {
        if (isDuplicate(e)) throw new SkiSchoolError("conflict", "Ya existe un producto docente con ese nombre en la sede");
        throw e;
      }
    });
  }

  updateProduct(siteId: string, id: number, input: Partial<ProductInput> & { active?: boolean }) {
    return this.within(siteId, true, async () => {
      const cur = await this.siteProduct(siteId, id);
      const cfg = await this.config(siteId);
      const f = this.productFields(input, cfg);
      const ages = input.minAge !== undefined || input.maxAge !== undefined ? ageRange(input.minAge !== undefined ? input.minAge : cur.minAge, input.maxAge !== undefined ? input.maxAge : cur.maxAge) : {};
      try {
        await this.d.store.updateProduct(id, { ...f, ...ages, ...(input.active !== undefined ? { active: input.active } : {}) });
      } catch (e) {
        if (isDuplicate(e)) throw new SkiSchoolError("conflict", "Ya existe un producto docente con ese nombre en la sede");
        throw e;
      }
      return (await this.d.store.product(id))!;
    });
  }

  // ── Sesiones y alumnos ─────────────────────────────────────────────────────────

  /** Sesiones de [from, to] con su producto, profesor y ocupación. */
  listSessions(siteId: string, from: string, to: string) {
    return this.within(siteId, false, async () => {
      rule(() => checkRange(from, to));
      const [sessions, products, instructors] = await Promise.all([this.d.store.sessions(siteId, from, to), this.d.store.products(siteId), this.d.store.instructors(siteId)]);
      const parts = await this.d.store.participants(sessions.map((s) => s.id));
      return sessions.map((s) => this.describe(s, products, instructors, parts));
    });
  }

  private describe(s: Session, products: Product[], instructors: Instructor[], parts: Participant[]) {
    const p = products.find((x) => x.id === s.productId);
    const i = s.instructorId == null ? null : instructors.find((x) => x.id === s.instructorId);
    return {
      ...s,
      productName: p?.name ?? "—",
      productKind: p?.kind ?? null,
      instructorName: i?.fullName ?? null,
      enrolled: parts.filter((x) => x.sessionId === s.id && x.status === "enrolled").length,
    };
  }

  /** Ficha de una sesión con sus alumnos (también los anulados). */
  getSession(siteId: string, sessionId: number) {
    return this.within(siteId, false, async () => {
      const s = await this.siteSession(siteId, sessionId);
      const [products, instructors, parts] = await Promise.all([this.d.store.products(siteId), this.d.store.instructors(siteId), this.d.store.participants([s.id])]);
      return { ...this.describe(s, products, instructors, parts), participants: parts };
    });
  }

  /** Reserva del Core para vincularla a una sesión (solo producto, fecha, personas y estado). */
  findReservation(siteId: string, reservationId: number) {
    return this.within(siteId, false, async () => {
      const r = await this.d.store.reservation(reservationId);
      if (!r) throw new SkiSchoolError("not_found", `No existe la reserva #${reservationId}`);
      return r;
    });
  }

  createSession(siteId: string, input: SessionInput, actor: string) {
    return this.within(siteId, true, async () => {
      const cfg = await this.config(siteId);
      const product = await this.siteProduct(siteId, input.productId);
      if (!product.active) throw new SkiSchoolError("invalid_input", "El producto docente está archivado");
      rule(() => dayNumber(input.date));
      const endTime = input.endTime ?? rule(() => fromMinutes(toMinutes(input.startTime) + product.durationMinutes));
      rule(() => checkSlot(input.startTime, endTime, "Sesión"));
      if (input.startTime < cfg.dayStart || endTime > cfg.dayEnd) throw new SkiSchoolError("invalid_input", `La sesión debe estar dentro del horario de la escuela (${cfg.dayStart}–${cfg.dayEnd})`);
      const capacity = input.capacity ?? product.capacity;
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new SkiSchoolError("invalid_input", "Capacidad: entre 1 y 100 alumnos");
      let reservationId: number | null = null;
      if (input.reservationId != null) {
        const r = await this.d.store.reservation(input.reservationId);
        if (!r) throw new SkiSchoolError("not_found", `No existe la reserva #${input.reservationId}`);
        if (r.status === "cancelled" || r.status === "failed") throw new SkiSchoolError("conflict", `La reserva #${r.id} está ${r.status === "cancelled" ? "anulada" : "fallida"}`);
        reservationId = r.id;
      }
      const id = await this.d.store.insertSession(
        {
          siteId,
          productId: product.id,
          date: input.date,
          startTime: input.startTime,
          endTime,
          modality: input.modality !== undefined ? rule(() => pickCode(input.modality, cfg.modalities, "Modalidad")) : product.modality,
          level: input.level !== undefined ? rule(() => pickCode(input.level, cfg.levels, "Nivel")) : product.level,
          language: rule(() => pickCode(input.language, cfg.languages, "Idioma")),
          capacity,
          reservationId,
          meetingPoint: text(input.meetingPoint, 120, "Punto de encuentro"),
          notes: text(input.notes, 1000, "Notas"),
        },
        actor,
      );
      await this.d.events().emit("ski_school.session.created", { sessionId: id, productId: product.id, date: input.date, reservationId });
      return (await this.d.store.session(id))!;
    });
  }

  /** Cambia capacidad, nivel, idioma, punto de encuentro o notas. La capacidad no baja de los inscritos. */
  updateSession(siteId: string, sessionId: number, patch: { capacity?: number; level?: string | null; language?: string | null; meetingPoint?: string | null; notes?: string | null }) {
    return this.within(siteId, true, async () => {
      const s = await this.siteSession(siteId, sessionId);
      if (s.status === "cancelled") throw new SkiSchoolError("conflict", "La sesión está cancelada");
      const cfg = await this.config(siteId);
      const out: Parameters<SkiSchoolStore["updateSession"]>[1] = {};
      if (patch.capacity !== undefined) {
        if (!Number.isInteger(patch.capacity) || patch.capacity < 1 || patch.capacity > 100) throw new SkiSchoolError("invalid_input", "Capacidad: entre 1 y 100 alumnos");
        const enrolled = (await this.d.store.participants([s.id])).filter((p) => p.status === "enrolled").length;
        if (patch.capacity < enrolled) throw new SkiSchoolError("conflict", `Hay ${enrolled} alumnos inscritos: la capacidad no puede ser menor`);
        out.capacity = patch.capacity;
      }
      if (patch.level !== undefined) out.level = rule(() => pickCode(patch.level, cfg.levels, "Nivel"));
      if (patch.language !== undefined) out.language = rule(() => pickCode(patch.language, cfg.languages, "Idioma"));
      if (patch.meetingPoint !== undefined) out.meetingPoint = text(patch.meetingPoint, 120, "Punto de encuentro");
      if (patch.notes !== undefined) out.notes = text(patch.notes, 1000, "Notas");
      await this.d.store.updateSession(sessionId, out);
      return (await this.d.store.session(sessionId))!;
    });
  }

  /** Cancela la sesión (queda registrada y libera al profesor). */
  cancelSession(siteId: string, sessionId: number) {
    return this.within(siteId, true, async () => {
      const s = await this.siteSession(siteId, sessionId);
      if (s.status === "cancelled" || s.status === "completed") throw new SkiSchoolError("conflict", "La sesión ya está cerrada");
      await this.d.store.updateSession(sessionId, { status: "cancelled" });
      return (await this.d.store.session(sessionId))!;
    });
  }

  /** Marca como impartida una sesión con profesor. */
  completeSession(siteId: string, sessionId: number) {
    return this.within(siteId, true, async () => {
      const s = await this.siteSession(siteId, sessionId);
      if (s.status !== "assigned") throw new SkiSchoolError("conflict", "Solo se puede dar por impartida una sesión con profesor asignado");
      await this.d.store.updateSession(sessionId, { status: "completed" });
      return (await this.d.store.session(sessionId))!;
    });
  }

  private request(s: Session, ages: number[]): SlotRequest {
    return { date: s.date, startTime: s.startTime, endTime: s.endTime, modality: s.modality, level: s.level, language: s.language, ages, meetingPoint: s.meetingPoint };
  }

  /**
   * Asigna (o cambia) el profesor de una sesión respetando jornada, ausencias, solapes, modalidad, nivel, idioma,
   * edad y límites de carga. Si no encaja: `conflict` con el motivo.
   */
  assignInstructor(siteId: string, sessionId: number, instructorId: number) {
    return this.within(siteId, true, async () => {
      const s = await this.siteSession(siteId, sessionId);
      if (s.status === "cancelled" || s.status === "completed") throw new SkiSchoolError("conflict", "La sesión ya está cerrada");
      const instr = await this.siteInstructor(siteId, instructorId);
      const cfg = await this.config(siteId);
      await this.d.store.assign(sessionId, instr.id, (c) => {
        if (c.session.status === "cancelled" || c.session.status === "completed") throw new SkiSchoolError("conflict", "La sesión ya está cerrada");
        const v = evaluateInstructor(toProfile(c.instructor), this.request(c.session, c.ages), c.absences.map(toPeriod), c.busy.map(busyOf), cfg.limits);
        if (!v.ok) throw new SkiSchoolError("conflict", `${c.instructor.fullName} no puede dar esta sesión: ${v.reason}`);
      });
      await this.d.events().emit("ski_school.session.assigned", { sessionId, instructorId: instr.id });
      return (await this.d.store.session(sessionId))!;
    });
  }

  unassignInstructor(siteId: string, sessionId: number) {
    return this.within(siteId, true, async () => {
      await this.siteSession(siteId, sessionId);
      if (!(await this.d.store.unassign(sessionId))) throw new SkiSchoolError("conflict", "La sesión no tiene profesor asignado");
      await this.d.events().emit("ski_school.session.assigned", { sessionId, instructorId: null });
      return (await this.d.store.session(sessionId))!;
    });
  }

  /** Propuesta simple: profesores compatibles (menos carga ese día primero) y descartados con su motivo. */
  suggestInstructors(siteId: string, sessionId: number) {
    return this.within(siteId, false, async () => {
      const s = await this.siteSession(siteId, sessionId);
      const cfg = await this.config(siteId);
      const [instructors, absences, sameDay, parts] = await Promise.all([
        this.d.store.instructors(siteId),
        this.d.store.absences(siteId, s.date, s.date),
        this.d.store.sessions(siteId, s.date, s.date),
        this.d.store.participants([s.id]),
      ]);
      const ages = parts.filter((p) => p.status === "enrolled" && p.age != null).map((p) => p.age!);
      return proposeInstructors(
        instructors.filter((i) => i.active).map(toProfile),
        this.request(s, ages),
        (id) => absences.filter((a) => a.instructorId === id).map(toPeriod),
        (id) => sameDay.filter((x) => x.instructorId === id && x.id !== s.id && x.status !== "cancelled").map(busyOf),
        cfg.limits,
      );
    });
  }

  /** Inscribe un alumno (nombre, edad, nivel): plaza libre, nivel de la sesión, edad del producto y sin otra clase a la vez. */
  addParticipant(siteId: string, sessionId: number, input: { name: string; age?: number | null; level?: string | null; notes?: string | null }) {
    return this.within(siteId, true, async () => {
      const s = await this.siteSession(siteId, sessionId);
      const cfg = await this.config(siteId);
      const product = await this.siteProduct(siteId, s.productId);
      const name = text(input.name, 120, "Nombre del alumno", 2)!;
      const a = age(input.age, "Alumno");
      const level = rule(() => pickCode(input.level, cfg.levels, "Nivel"));
      const id = await this.d.store.enroll({ siteId, sessionId, name, age: a, level, notes: text(input.notes, 500, "Notas") }, (c) => {
        if (c.session.status === "cancelled" || c.session.status === "completed") throw new SkiSchoolError("conflict", "La sesión ya está cerrada");
        rule(() => checkEnrollment({ capacity: c.session.capacity, level: c.session.level, enrolled: c.enrolled }, product, { age: a, level }), "conflict");
        const clash = findOverlappingEnrollment(c.sameDay, { startTime: c.session.startTime, endTime: c.session.endTime, participantName: name });
        if (clash) throw new SkiSchoolError("conflict", `${name} ya está en otra clase a esa hora (sesión #${clash.sessionId}, ${clash.startTime}–${clash.endTime})`);
      });
      await this.d.events().emit("ski_school.participant.enrolled", { sessionId, participantId: id });
      return (await this.d.store.participant(id))!;
    });
  }

  /** Anula la inscripción de un alumno (libera la plaza; queda registrada). */
  cancelParticipant(siteId: string, participantId: number) {
    return this.within(siteId, true, async () => {
      const p = await this.d.store.participant(participantId);
      if (!p || p.siteId !== siteId) throw new SkiSchoolError("not_found", "Alumno no encontrado en esta sede");
      if (!(await this.d.store.cancelParticipant(participantId))) throw new SkiSchoolError("conflict", "La inscripción ya estaba anulada");
      return (await this.d.store.participant(participantId))!;
    });
  }

  /** Planning de un día: cada profesor activo con sus sesiones y ausencias, y las sesiones sin profesor. */
  planning(siteId: string, date: string) {
    return this.within(siteId, false, async () => {
      rule(() => dayNumber(date));
      const [sessions, products, instructors, absences] = await Promise.all([
        this.d.store.sessions(siteId, date, date),
        this.d.store.products(siteId),
        this.d.store.instructors(siteId),
        this.d.store.absences(siteId, date, date),
      ]);
      const parts = await this.d.store.participants(sessions.map((s) => s.id));
      const live = sessions.filter((s) => s.status !== "cancelled").map((s) => this.describe(s, products, instructors, parts));
      const dow = new Date(dayNumber(date) * 86_400_000).getUTCDay();
      return {
        date,
        instructors: instructors
          .filter((i) => i.active || live.some((s) => s.instructorId === i.id))
          .map((i) => ({
            id: i.id,
            fullName: i.fullName,
            active: i.active,
            weeklyToday: i.weekly.filter((w) => w.day === dow),
            absences: absences.filter((a) => a.instructorId === i.id),
            sessions: live.filter((s) => s.instructorId === i.id),
          })),
        unassigned: live.filter((s) => s.instructorId == null),
      };
    });
  }
}

