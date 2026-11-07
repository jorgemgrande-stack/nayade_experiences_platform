/**
 * Ski Net · Escuela (módulo del SDK): reglas puras (disponibilidad, ausencias, solapes, desplazamientos, rachas,
 * aforo, niveles configurables) y servicio con la licencia REAL por capacidad (`ski-school`) en memoria: sin
 * licencia, solo lectura, activación por sede, asignación con rechazo claro y planning por día y profesor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore, type CapabilityChange } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { runWithTenant } from "./_core/tenant";
import { EventBus, ModuleGate, ModuleNotActive, ModuleNotLicensed, ModuleReadOnly, SdkModuleRegistry, SiteUnknown, type EventEnvelope } from "./sdk";
import { CORE_EXTENSION_PANELS, CORE_EXTENSION_ROUTES } from "../shared/panelExtensions";
import { SKI_SCHOOL_ID, skiSchoolModule, type SkiSchoolEvents } from "./skiSchool/manifest";
import {
  DEFAULT_SCHOOL_CONFIG,
  RuleError,
  blockingAbsence,
  checkEnrollment,
  dayOfWeek,
  evaluateInstructor,
  findOverlappingEnrollment,
  normalizeConfig,
  normalizeWeekly,
  overlaps,
  pickCodes,
  proposeInstructors,
  type InstructorProfile,
  type SlotRequest,
} from "./skiSchool/rules";
import { SkiSchoolError, SkiSchoolService } from "./skiSchool/service";
import { MemorySkiSchoolStore } from "./skiSchool/store";

const LIMITS = DEFAULT_SCHOOL_CONFIG.limits;
// 2026-12-07 es lunes
const MON = "2026-12-07";
const prof = (o: Partial<InstructorProfile> = {}): InstructorProfile => ({ id: 1, fullName: "Profesor Uno", active: true, modalities: [], levels: [], languages: [], minAge: null, maxAge: null, weekly: [], ...o });
const req = (o: Partial<SlotRequest> = {}): SlotRequest => ({ date: MON, startTime: "10:00", endTime: "12:00", modality: null, level: null, language: null, ages: [], meetingPoint: null, ...o });

describe("reglas puras", () => {
  it("fechas y horas: día de la semana sin depender de la zona horaria, solape estricto", () => {
    expect(dayOfWeek(MON)).toBe(1);
    expect(dayOfWeek("2026-12-13")).toBe(0);
    expect(() => dayOfWeek("2026-02-30")).toThrow(RuleError);
    expect(overlaps("10:00", "12:00", "11:00", "13:00")).toBe(true);
    expect(overlaps("10:00", "12:00", "12:00", "13:00")).toBe(false);
  });

  it("configuración: plantilla por defecto (A–D, esquí/snowboard) y niveles propios de cada empresa", () => {
    const d = normalizeConfig(null);
    expect(d.levels.map((l) => l.code)).toEqual(["A", "B", "C", "D"]);
    expect(d.modalities.map((m) => m.code)).toEqual(["ski", "snowboard"]);
    expect([d.dayStart, d.dayEnd]).toEqual(["09:00", "17:00"]);
    const own = normalizeConfig({ levels: [{ code: "oso", label: "Osito" }, { code: "lince", label: "Lince" }], modalities: [{ code: "telemark", label: "Telemark" }], dayStart: "08:30", dayEnd: "15:00" });
    expect(own.levels.map((l) => l.code)).toEqual(["oso", "lince"]);
    expect(pickCodes(["LINCE"], own.levels, "Niveles")).toEqual(["lince"]);
    expect(() => pickCodes(["A"], own.levels, "Niveles")).toThrow(/no está configurado/);
    expect(() => normalizeConfig({ levels: [] })).toThrow(/al menos uno/);
    expect(() => normalizeConfig({ levels: [{ code: "A", label: "x" }, { code: "a", label: "y" }] })).toThrow(/repetido/);
    expect(() => normalizeConfig({ dayStart: "17:00", dayEnd: "09:00" })).toThrow(/posterior/);
  });

  it("jornada semanal: ordenada y sin franjas solapadas el mismo día", () => {
    expect(normalizeWeekly([{ day: 2, start: "09:00", end: "13:00" }, { day: 1, start: "14:00", end: "17:00" }]).map((w) => w.day)).toEqual([1, 2]);
    expect(() => normalizeWeekly([{ day: 1, start: "09:00", end: "13:00" }, { day: 1, start: "12:00", end: "15:00" }])).toThrow(/solapadas/);
    expect(() => normalizeWeekly([{ day: 7, start: "09:00", end: "13:00" }])).toThrow(/Día/);
  });

  it("disponibilidad semanal: sin declarar = disponible; declarada = solo dentro de sus franjas", () => {
    expect(evaluateInstructor(prof(), req(), [], [], LIMITS).ok).toBe(true);
    const weekly = [{ day: 1, start: "09:00", end: "13:00" }];
    expect(evaluateInstructor(prof({ weekly }), req(), [], [], LIMITS).ok).toBe(true);
    expect(evaluateInstructor(prof({ weekly }), req({ startTime: "12:00", endTime: "14:00" }), [], [], LIMITS)).toMatchObject({ ok: false, reason: "fuera de su disponibilidad semanal" });
    expect(evaluateInstructor(prof({ weekly }), req({ date: "2026-12-08" }), [], [], LIMITS).ok).toBe(false);
  });

  it("ausencias: día completo en un periodo y bloqueo parcial solo si se solapa", () => {
    const off = [{ startDate: "2026-12-05", endDate: "2026-12-08", kind: "day_off" as const, startTime: null, endTime: null }];
    expect(evaluateInstructor(prof(), req(), off, [], LIMITS)).toMatchObject({ ok: false, reason: "tiene una ausencia ese día" });
    expect(evaluateInstructor(prof(), req({ date: "2026-12-09" }), off, [], LIMITS).ok).toBe(true);
    const partial = [{ startDate: MON, endDate: MON, kind: "partial_block" as const, startTime: "11:30", endTime: "12:30" }];
    expect(blockingAbsence(partial, MON, "10:00", "11:30")).toBeNull();
    expect(evaluateInstructor(prof(), req(), partial, [], LIMITS)).toMatchObject({ ok: false, reason: "tiene un bloqueo de 11:30 a 12:30" });
  });

  it("solapes, carga diaria, rachas seguidas y desplazamiento entre puntos de encuentro", () => {
    expect(evaluateInstructor(prof(), req(), [], [{ id: 9, startTime: "11:00", endTime: "13:00", meetingPoint: null }], LIMITS)).toMatchObject({ ok: false, reason: "se solapa con otra sesión suya (11:00–13:00)" });
    expect(evaluateInstructor(prof(), req(), [], [{ id: 9, startTime: "12:00", endTime: "13:00", meetingPoint: null }], LIMITS).ok).toBe(true);
    const busy = ["09:00", "13:00", "14:00"].map((s, i) => ({ id: i, startTime: s, endTime: `${String(Number(s.slice(0, 2)) + 1).padStart(2, "0")}:00`, meetingPoint: null }));
    expect(evaluateInstructor(prof(), req(), [], busy, { ...LIMITS, maxDailySessions: 3 })).toMatchObject({ ok: false });
    // 09-10, [10-12], 12-13? no: 13-14, 14-15 → racha 09–12 = 2 seguidas
    expect(evaluateInstructor(prof(), req(), [], busy, { ...LIMITS, maxConsecutiveSessions: 2 }).ok).toBe(true);
    const chain = [{ id: 1, startTime: "09:00", endTime: "10:00", meetingPoint: null }, { id: 2, startTime: "12:00", endTime: "13:00", meetingPoint: null }];
    expect(evaluateInstructor(prof(), req(), [], chain, { ...LIMITS, maxConsecutiveSessions: 2 })).toMatchObject({ ok: false, reason: "supera el máximo de sesiones seguidas (2)" });
    const far = [{ id: 1, startTime: "09:00", endTime: "09:55", meetingPoint: "Cota 2000" }];
    expect(evaluateInstructor(prof(), req({ meetingPoint: "Pie de pistas" }), [], far, LIMITS).ok).toBe(false);
    expect(evaluateInstructor(prof(), req({ meetingPoint: "cota 2000 " }), [], far, LIMITS).ok).toBe(true);
  });

  it("modalidad, nivel, idioma y edad (sin dato declarado no descarta)", () => {
    expect(evaluateInstructor(prof({ modalities: ["ski"] }), req({ modality: "snowboard" }), [], [], LIMITS)).toMatchObject({ ok: false, reason: "no imparte la modalidad snowboard" });
    expect(evaluateInstructor(prof({ levels: ["A", "B"] }), req({ level: "D" }), [], [], LIMITS)).toMatchObject({ ok: false });
    expect(evaluateInstructor(prof({ languages: ["es"] }), req({ language: "en" }), [], [], LIMITS)).toMatchObject({ ok: false });
    expect(evaluateInstructor(prof({ minAge: 12 }), req({ ages: [8] }), [], [], LIMITS)).toMatchObject({ ok: false });
    expect(evaluateInstructor(prof({ active: false }), req(), [], [], LIMITS)).toMatchObject({ ok: false, reason: "el profesor está dado de baja" });
    expect(evaluateInstructor(prof(), req({ modality: "ski", level: "D", language: "en", ages: [8] }), [], [], LIMITS).ok).toBe(true);
  });

  it("propuesta simple: compatibles primero los de menos carga, y descartados con motivo", () => {
    const pool = [prof({ id: 1, fullName: "Ana" }), prof({ id: 2, fullName: "Bea", languages: ["en", "es"] }), prof({ id: 3, fullName: "Carla", modalities: ["snowboard"] })];
    const busy: Record<number, Array<{ id: number; startTime: string; endTime: string; meetingPoint: null }>> = { 1: [{ id: 7, startTime: "14:00", endTime: "15:00", meetingPoint: null }] };
    const p = proposeInstructors(pool, req({ modality: "ski", language: "en" }), () => [], (id) => busy[id] ?? [], LIMITS);
    expect(p.candidates.map((c) => c.fullName)).toEqual(["Bea", "Ana"]);
    expect(p.discarded).toEqual([{ instructorId: 3, fullName: "Carla", reason: "no imparte la modalidad ski" }]);
  });

  it("alumnos: aforo, nivel de la sesión, edad del producto y el mismo alumno en dos clases a la vez", () => {
    expect(() => checkEnrollment({ capacity: 2, level: null, enrolled: 2 }, { minAge: null, maxAge: null }, { age: null, level: null })).toThrow(/completa/);
    expect(() => checkEnrollment({ capacity: 8, level: "B", enrolled: 0 }, { minAge: null, maxAge: null }, { age: null, level: "C" })).toThrow(/nivel C/);
    expect(() => checkEnrollment({ capacity: 8, level: null, enrolled: 0 }, { minAge: 3, maxAge: 6 }, { age: 9, level: null })).toThrow(/hasta 6/);
    expect(() => checkEnrollment({ capacity: 8, level: "B", enrolled: 7 }, { minAge: 3, maxAge: 6 }, { age: 5, level: "b" })).not.toThrow();
    const slot = { sessionId: 257, startTime: "10:00", endTime: "13:00", participantName: "Alumno Ficticio" };
    expect(findOverlappingEnrollment([slot], { startTime: "12:00", endTime: "14:00", participantName: " alumno  ficticio " })?.sessionId).toBe(257);
    expect(findOverlappingEnrollment([slot], { startTime: "13:00", endTime: "14:00", participantName: "Alumno Ficticio" })).toBeNull();
    expect(findOverlappingEnrollment([slot], { startTime: "10:00", endTime: "13:00", participantName: "Otro Alumno" })).toBeNull();
  });
});

describe("manifiesto, menú e independencia", () => {
  it("valida en el registro del SDK con la capacidad ski-school y sus permisos", () => {
    const r = new SdkModuleRegistry();
    r.registerAll([skiSchoolModule]);
    expect(r.get(SKI_SCHOOL_ID)?.capability).toBe("ski-school");
    expect(r.manifest(SKI_SCHOOL_ID)?.version).toMatch(/^0\./);
    expect(r.manifest(SKI_SCHOOL_ID)?.permissions?.map((p) => p.key)).toEqual(["ski_school.view", "ski_school.manage"]);
    r.unregister(SKI_SCHOOL_ID);
    r.validate();
    expect(BUILTIN_MODULES.some((m) => (m.dependsOn ?? []).some((d) => d.id === SKI_SCHOOL_ID))).toBe(false);
  });

  it("sección Ski Net: panel general con cualquiera de sus licencias y pantallas de la escuela con ski-school", () => {
    const s = CORE_EXTENSION_PANELS.skiNet.panel.section!;
    expect([s.id, s.label]).toEqual(["ski-net", "Ski Net"]);
    expect(s.items[0]).toMatchObject({ label: "Panel general", path: "/admin/net/ski", capabilities: ["ski-school", "ski-rental"] });
    expect(s.items.slice(1).map((i) => [i.label, i.path, i.capabilities])).toEqual([
      ["Escuela: planning", "/admin/ski/escuela", ["ski-school"]],
      ["Profesores", "/admin/ski/profesores", ["ski-school"]],
      ["Productos docentes", "/admin/ski/productos-docentes", ["ski-school"]],
      ["Sesiones y alumnos", "/admin/ski/sesiones", ["ski-school"]],
    ]);
    expect(CORE_EXTENSION_ROUTES).toContainEqual({ path: "/admin/ski/profesores", capabilities: ["ski-school"] });
  });
});

const NOW = Date.UTC(2026, 11, 1, 9);
const T = "acme";

describe("servicio con licencia por capacidad", () => {
  let caps: MemoryCapabilityStore;
  let store: MemorySkiSchoolStore;
  let svc: SkiSchoolService;
  let events: Array<EventEnvelope>;
  const sites = new Set(["s1", "s2"]);

  const license = (changes: Array<Pick<CapabilityChange, "status" | "siteId">>) =>
    caps.apply(T, changes.map((c) => ({ capabilityId: "ski-school", siteId: c.siteId, status: c.status, validUntil: null, source: "operator" })), { actor: "test", reason: null, now: NOW });
  const inT = <R>(fn: () => Promise<R>) => runWithTenant(T, fn);

  beforeEach(() => {
    caps = new MemoryCapabilityStore();
    store = new MemorySkiSchoolStore();
    const registry = new SdkModuleRegistry();
    registry.registerAll([skiSchoolModule]);
    const access = new CapabilityAccess(caps, { enforce: true, ttlMs: 0, now: () => NOW });
    const gate = new ModuleGate(registry, { capabilities: () => access });
    const bus = new EventBus<SkiSchoolEvents>({ now: () => NOW });
    events = [];
    for (const t of skiSchoolModule.events ?? []) bus.on(t as keyof SkiSchoolEvents, (e) => void events.push(e));
    svc = new SkiSchoolService({
      store,
      gate: () => gate,
      events: () => bus,
      assertSite: async (s) => {
        if (!sites.has(s)) throw new SiteUnknown(SKI_SCHOOL_ID, s);
      },
    });
  });

  async function school(siteId = "s1") {
    await svc.activateSite(siteId, "user:1");
    const ana = await svc.createInstructor(siteId, { fullName: "Ana Ficticia", modalities: ["ski"], levels: ["A", "B"], languages: ["es", "en"], weekly: [{ day: 1, start: "09:00", end: "14:00" }] });
    const bruno = await svc.createInstructor(siteId, { fullName: "Bruno Ficticio", modalities: ["ski", "snowboard"] });
    const curso = await svc.createProduct(siteId, { name: "Cursillo mañanas", kind: "group", durationMinutes: 120, capacity: 3, level: "B" });
    const peques = await svc.createProduct(siteId, { name: "Escuelita", kind: "kids", durationMinutes: 180, capacity: 8, minAge: 3, maxAge: 6 });
    return { ana, bruno, curso, peques };
  }

  it("sin licencia: ModuleNotLicensed (error tipado) al consultar y al operar", async () => {
    await inT(async () => {
      await expect(svc.listInstructors("s1")).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(svc.activateSite("s1", "user:1")).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(svc.planning("s1", MON)).rejects.toMatchObject({ code: "module_not_licensed" });
      expect(await svc.status("s1")).toMatchObject({ license: { read: false, write: false, code: "module_not_licensed" }, active: false });
    });
  });

  it("con licencia pero sin activar en la sede: consulta sí, opera no (ModuleNotActive)", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      expect(await svc.listInstructors("s1")).toEqual([]);
      await expect(svc.createInstructor("s1", { fullName: "Ana" })).rejects.toBeInstanceOf(ModuleNotActive);
      expect((await svc.status("s1")).config.levels).toHaveLength(4);
    });
  });

  it("recorrido: profesores, productos, sesión manual y desde reserva, alumnos, asignación y planning", async () => {
    await license([{ status: "active", siteId: "" }]);
    store.reservations.set(41, { id: 41, productName: "Clases particulares", bookingDate: MON, people: 2, status: "paid" });
    await inT(async () => {
      const { ana, bruno, curso } = await school();
      const s1 = await svc.createSession("s1", { productId: curso.id, date: MON, startTime: "10:00" }, "user:1");
      expect(s1).toMatchObject({ endTime: "12:00", capacity: 3, level: "B", status: "pending", reservationId: null });
      expect((await svc.findReservation("s1", 41)).productName).toBe("Clases particulares");
      const s2 = await svc.createSession("s1", { productId: curso.id, date: MON, startTime: "11:00", reservationId: 41, language: "en" }, "user:1");
      expect(s2.reservationId).toBe(41);
      await expect(svc.createSession("s1", { productId: curso.id, date: MON, startTime: "10:00", reservationId: 99 }, "u")).rejects.toMatchObject({ code: "not_found" });

      await svc.addParticipant("s1", s1.id, { name: "Alumno Uno", age: 9, level: "B" });
      await expect(svc.addParticipant("s1", s1.id, { name: "Alumno Dos", level: "D" })).rejects.toMatchObject({ code: "conflict" });
      await expect(svc.addParticipant("s1", s2.id, { name: "alumno uno" })).rejects.toThrow(/ya está en otra clase/);

      expect((await svc.assignInstructor("s1", s1.id, ana.id)).status).toBe("assigned");
      // Ana ya tiene 10–12: la de 11–13 se solapa
      await expect(svc.assignInstructor("s1", s2.id, ana.id)).rejects.toThrow(/Ana Ficticia no puede dar esta sesión: se solapa/);
      const sug = await svc.suggestInstructors("s1", s2.id);
      expect(sug.candidates.map((c) => c.fullName)).toEqual(["Bruno Ficticio"]);
      expect(sug.discarded[0]).toMatchObject({ fullName: "Ana Ficticia" });
      await svc.assignInstructor("s1", s2.id, bruno.id);

      const plan = await svc.planning("s1", MON);
      expect(plan.instructors.map((i) => [i.fullName, i.sessions.map((s) => s.startTime)])).toEqual([
        ["Ana Ficticia", ["10:00"]],
        ["Bruno Ficticio", ["11:00"]],
      ]);
      expect(plan.unassigned).toEqual([]);
      expect(plan.instructors[0].sessions[0]).toMatchObject({ productName: "Cursillo mañanas", enrolled: 1, instructorName: "Ana Ficticia" });
      expect(events.map((e) => e.type)).toEqual([
        "ski_school.site.activated",
        "ski_school.session.created",
        "ski_school.session.created",
        "ski_school.participant.enrolled",
        "ski_school.session.assigned",
        "ski_school.session.assigned",
      ]);
      expect(events.every((e) => e.tenantId === T && e.siteId === "s1")).toBe(true);
    });
  });

  it("asignación: ausencias, disponibilidad semanal, edad y cancelación liberan o bloquean", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const { ana, bruno, curso, peques } = await school();
      // Fuera de la jornada semanal de Ana (lunes 9–14)
      const tarde = await svc.createSession("s1", { productId: curso.id, date: MON, startTime: "14:00" }, "u");
      await expect(svc.assignInstructor("s1", tarde.id, ana.id)).rejects.toThrow(/fuera de su disponibilidad semanal/);
      // Ausencia de Bruno toda la semana
      const abs = await svc.addAbsence("s1", { instructorId: bruno.id, startDate: "2026-12-06", endDate: "2026-12-12", kind: "day_off", reason: "Formación" }, "u");
      await expect(svc.assignInstructor("s1", tarde.id, bruno.id)).rejects.toThrow(/ausencia/);
      expect(await svc.listAbsences("s1", MON, MON, bruno.id)).toHaveLength(1);
      await svc.cancelAbsence("s1", abs.id);
      expect((await svc.assignInstructor("s1", tarde.id, bruno.id)).instructorId).toBe(bruno.id);
      // Edad: escuelita de 3 a 6 años y el producto rechaza un alumno de 9
      const kids = await svc.createSession("s1", { productId: peques.id, date: MON, startTime: "09:00" }, "u");
      await expect(svc.addParticipant("s1", kids.id, { name: "Peque", age: 9 })).rejects.toThrow(/hasta 6 años/);
      // Cancelar una sesión libera al profesor
      const otra = await svc.createSession("s1", { productId: curso.id, date: MON, startTime: "14:00" }, "u");
      await expect(svc.assignInstructor("s1", otra.id, bruno.id)).rejects.toThrow(/se solapa/);
      await svc.cancelSession("s1", tarde.id);
      await svc.assignInstructor("s1", otra.id, bruno.id);
      await expect(svc.assignInstructor("s1", tarde.id, bruno.id)).rejects.toMatchObject({ code: "conflict" });
      // Fuera del horario de la escuela
      await expect(svc.createSession("s1", { productId: curso.id, date: MON, startTime: "16:00" }, "u")).rejects.toThrow(/horario de la escuela/);
      // Dar de baja a un profesor lo descarta
      await svc.updateInstructor("s1", ana.id, { active: false });
      const pronto = await svc.createSession("s1", { productId: curso.id, date: "2026-12-14", startTime: "09:00" }, "u");
      await expect(svc.assignInstructor("s1", pronto.id, ana.id)).rejects.toThrow(/dado de baja/);
    });
  });

  it("capacidad de sesión: aforo completo, anulación libera plaza, la capacidad no baja de los inscritos", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const { curso } = await school();
      const s = await svc.createSession("s1", { productId: curso.id, date: MON, startTime: "10:00", capacity: 2 }, "u");
      const a = await svc.addParticipant("s1", s.id, { name: "Alumno A" });
      await svc.addParticipant("s1", s.id, { name: "Alumno B" });
      await expect(svc.addParticipant("s1", s.id, { name: "Alumno C" })).rejects.toThrow(/completa \(2 plazas\)/);
      await expect(svc.updateSession("s1", s.id, { capacity: 1 })).rejects.toMatchObject({ code: "conflict" });
      expect((await svc.cancelParticipant("s1", a.id)).status).toBe("cancelled");
      await svc.addParticipant("s1", s.id, { name: "Alumno C" });
      const detail = await svc.getSession("s1", s.id);
      expect(detail.enrolled).toBe(2);
      expect(detail.participants).toHaveLength(3);
    });
  });

  it("niveles configurables por sede: los nuevos códigos valen y los de la plantilla dejan de valer", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      await svc.activateSite("s1", "u");
      const cfg = await svc.updateConfig("s1", { levels: [{ code: "oso", label: "Osito" }, { code: "lince", label: "Lince" }], dayStart: "08:00", limits: { maxDailySessions: 2 } }, "u");
      expect(cfg).toMatchObject({ dayStart: "08:00", dayEnd: "17:00", limits: { maxDailySessions: 2, maxConsecutiveSessions: 4 } });
      const p = await svc.createProduct("s1", { name: "Grupo Lince", kind: "group", durationMinutes: 60, capacity: 6, level: "lince" });
      await expect(svc.createProduct("s1", { name: "Grupo A", kind: "group", durationMinutes: 60, capacity: 6, level: "A" })).rejects.toThrow(/no está configurado/);
      await expect(svc.createInstructor("s1", { fullName: "Prof", levels: ["B"] })).rejects.toBeInstanceOf(SkiSchoolError);
      const prof1 = await svc.createInstructor("s1", { fullName: "Prof Lince", levels: ["lince"] });
      const ses = await svc.createSession("s1", { productId: p.id, date: MON, startTime: "08:00" }, "u");
      expect(ses.level).toBe("lince");
      await svc.assignInstructor("s1", ses.id, prof1.id);
      await svc.assignInstructor("s1", (await svc.createSession("s1", { productId: p.id, date: MON, startTime: "10:00" }, "u")).id, prof1.id);
      // Límite configurado de 2 sesiones al día
      const third = await svc.createSession("s1", { productId: p.id, date: MON, startTime: "12:00" }, "u");
      await expect(svc.assignInstructor("s1", third.id, prof1.id)).rejects.toThrow(/carga máxima diaria \(2/);
      await expect(svc.updateConfig("s1", { levels: [] }, "u")).rejects.toMatchObject({ code: "invalid_input" });
      // La otra sede sigue con la plantilla
      expect((await svc.status("s2")).config.levels.map((l) => l.code)).toEqual(["A", "B", "C", "D"]);
    });
  });

  it("solo lectura: consulta sí, operar no; licencia y datos aislados por sede", async () => {
    await license([{ status: "active", siteId: "s1" }]);
    await inT(async () => {
      await school("s1");
      await expect(svc.activateSite("s2", "u")).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(svc.listProducts("s2")).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(svc.listProducts("s9")).rejects.toBeInstanceOf(SiteUnknown);
    });
    await license([{ status: "active", siteId: "s2" }]);
    await inT(async () => {
      await svc.activateSite("s2", "u");
      expect(await svc.listInstructors("s2")).toEqual([]);
      const s1Instructor = (await svc.listInstructors("s1"))[0];
      const p2 = await svc.createProduct("s2", { name: "Particular", kind: "private", durationMinutes: 60, capacity: 2 });
      const ses = await svc.createSession("s2", { productId: p2.id, date: MON, startTime: "10:00" }, "u");
      await expect(svc.assignInstructor("s2", ses.id, s1Instructor.id)).rejects.toMatchObject({ code: "not_found" });
    });
    await license([{ status: "read_only", siteId: "s1" }]);
    await inT(async () => {
      expect(await svc.listInstructors("s1")).toHaveLength(2);
      await expect(svc.createInstructor("s1", { fullName: "Nuevo" })).rejects.toBeInstanceOf(ModuleReadOnly);
      expect(await svc.status("s1")).toMatchObject({ license: { read: true, write: false, code: "module_read_only" }, active: true });
    });
  });

  it("validaciones de entrada", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const { ana, curso } = await school();
      await expect(svc.createInstructor("s1", { fullName: "X" })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.createInstructor("s1", { fullName: "Prof", email: "no-es-correo" })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.createInstructor("s1", { fullName: "Prof", minAge: 12, maxAge: 6 })).rejects.toThrow(/menor que la mínima/);
      await expect(svc.createProduct("s1", { name: "Cursillo mañanas", kind: "group", durationMinutes: 60, capacity: 4 })).rejects.toMatchObject({ code: "conflict" });
      await expect(svc.createProduct("s1", { name: "Corto", kind: "group", durationMinutes: 5, capacity: 4 })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.addAbsence("s1", { instructorId: ana.id, startDate: "2026-12-10", endDate: "2026-12-09", kind: "day_off" }, "u")).rejects.toThrow(/anterior/);
      await expect(svc.addAbsence("s1", { instructorId: ana.id, startDate: MON, kind: "partial_block" }, "u")).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.listSessions("s1", "2026-12-01", "2027-02-01")).rejects.toMatchObject({ code: "invalid_input" });
      await svc.updateProduct("s1", curso.id, { active: false });
      await expect(svc.createSession("s1", { productId: curso.id, date: MON, startTime: "10:00" }, "u")).rejects.toThrow(/archivado/);
    });
  });
});
