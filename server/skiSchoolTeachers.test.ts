/**
 * Ski Net · Profesores: reglas puras (condiciones de pago, horas exigidas prorrateadas, cálculo de la liquidación,
 * reparto de lo facturado, asistencia, CSV y HTML) y servicio con la licencia REAL por capacidad (`ski-school`) en
 * memoria: pasar lista, control de horas, liquidaciones congeladas, solapes, anulación y portal del empleado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { runWithTenant } from "./_core/tenant";
import { EventBus, ModuleGate, ModuleNotLicensed, ModuleReadOnly, SdkModuleRegistry, SiteUnknown, type EventEnvelope } from "./sdk";
import { CORE_EXTENSION_PANELS } from "../shared/panelExtensions";
import { SKI_SCHOOL_ID, skiSchoolModule, type SkiSchoolEvents } from "./skiSchool/manifest";
import { RuleError } from "./skiSchool/rules";
import { SkiSchoolService } from "./skiSchool/service";
import { MemorySkiSchoolStore } from "./skiSchool/store";
import { SkiTeacherService } from "./skiSchool/teacherService";
import { MemorySkiTeacherStore } from "./skiSchool/teacherStore";
import {
  checkAttendance,
  computeSettlement,
  hoursByInstructor,
  normalizePayTerms,
  proratedRequiredMinutes,
  settlementCsv,
  settlementHtml,
  splitReservation,
  wholeMonths,
  type PayTerms,
} from "./skiSchool/teachers";

const T0: PayTerms = { payMode: null, hourlyRateCents: null, percentBp: null, monthlyCents: null, requiredMinutesWeek: null };
const ses = (id: number, date: string, start: string, end: string, baseCents = 0) => ({ sessionId: id, date, startTime: start, endTime: end, productName: "Cursillo", baseCents });

describe("reglas puras de profesores", () => {
  it("condiciones: el modo elegido exige su importe; porcentaje hasta el 100 %", () => {
    expect(normalizePayTerms({ payMode: "hourly", hourlyRateCents: 2000 })).toMatchObject({ payMode: "hourly", hourlyRateCents: 2000 });
    expect(() => normalizePayTerms({ payMode: "hourly" })).toThrow(/tarifa/);
    expect(() => normalizePayTerms({ payMode: "percent", percentBp: 12_000 })).toThrow(RuleError);
    expect(() => normalizePayTerms({ payMode: "monthly" })).toThrow(/fijo/);
    expect(normalizePayTerms({}).payMode).toBeNull();
  });

  it("horas exigidas prorrateadas al periodo y horas programadas frente a impartidas", () => {
    expect(proratedRequiredMinutes(1200, "2026-12-07", "2026-12-13")).toBe(1200);
    expect(proratedRequiredMinutes(1200, "2026-12-01", "2026-12-31")).toBe(Math.round((1200 * 31) / 7));
    expect(proratedRequiredMinutes(null, "2026-12-01", "2026-12-31")).toBeNull();
    const h = hoursByInstructor([
      { instructorId: 1, status: "assigned", startTime: "09:00", endTime: "11:00" },
      { instructorId: 1, status: "completed", startTime: "11:00", endTime: "12:30" },
      { instructorId: 1, status: "cancelled", startTime: "13:00", endTime: "14:00" },
    ]);
    expect(h.get(1)).toEqual({ scheduled: 210, taught: 90, sessions: 2 });
  });

  it("liquidación por hora, por % de lo facturado y fijo mensual por meses completos", () => {
    const list = [ses(1, "2026-12-02", "09:00", "11:00", 10_000), ses(2, "2026-12-01", "11:00", "12:30", 5_001)];
    const hourly = computeSettlement({ ...T0, payMode: "hourly", hourlyRateCents: 2050 }, list, "2026-12-01", "2026-12-31");
    expect(hourly.lines.map((l) => [l.sessionId, l.amountCents])).toEqual([
      [2, 3075],
      [1, 4100],
    ]);
    expect(hourly).toMatchObject({ minutes: 210, sessions: 2, totalCents: 7175, baseCents: 0 });
    const pct = computeSettlement({ ...T0, payMode: "percent", percentBp: 2500 }, list, "2026-12-01", "2026-12-31");
    expect(pct).toMatchObject({ baseCents: 15_001, totalCents: 1250 + 2500 });
    const fixed = computeSettlement({ ...T0, payMode: "monthly", monthlyCents: 150_000 }, [], "2026-12-01", "2027-01-31");
    expect(fixed.totalCents).toBe(300_000);
    expect(fixed.lines.at(-1)).toMatchObject({ sessionId: null, description: "Fijo mensual × 2" });
    expect(() => wholeMonths("2026-12-02", "2026-12-31")).toThrow(/meses completos/);
    expect(() => computeSettlement({ ...T0, payMode: "hourly", hourlyRateCents: 1 }, [], "2026-12-01", "2026-12-31")).toThrow(/No hay sesiones/);
    expect(() => computeSettlement(T0, list, "2026-12-01", "2026-12-31")).toThrow(/condiciones/);
  });

  it("lo facturado de una reserva se reparte entre sus sesiones sin perder céntimos", () => {
    const m = splitReservation(10_000, [7, 3, 5]);
    expect([m.get(3), m.get(5), m.get(7)]).toEqual([3334, 3333, 3333]);
    expect(Array.from(m.values()).reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("asistencia: todos los inscritos, sin repetidos ni ajenos", () => {
    expect(() => checkAttendance([1, 2], [{ participantId: 1, status: "present" }, { participantId: 2, status: "absent" }])).not.toThrow();
    expect(() => checkAttendance([1, 2], [{ participantId: 1, status: "present" }])).toThrow(/Falta/);
    expect(() => checkAttendance([1], [{ participantId: 1, status: "present" }, { participantId: 1, status: "late" }])).toThrow(/repetido/);
    expect(() => checkAttendance([1], [{ participantId: 9, status: "present" }])).toThrow(/no está inscrito/);
    expect(() => checkAttendance([1], [{ participantId: 1, status: "dormido" }])).toThrow(/no válido/);
  });

  it("exportación: CSV con «;», coma decimal y sin fórmulas; HTML escapado", () => {
    const data = { id: 4, instructorName: "=HYPERLINK(\"x\")", periodStart: "2026-12-01", periodEnd: "2026-12-31", payMode: "hourly" as const, minutes: 90, totalCents: 3075, status: "closed", lines: [{ date: "2026-12-01", description: "Cursillo; mañana", minutes: 90, baseCents: 0, amountCents: 3075 }] };
    const csv = settlementCsv(data);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"Cursillo; mañana\";1,50;0,00;30,75");
    expect(csv).toContain("Total;;1,50;;30,75");
    expect(settlementHtml({ ...data, instructorName: "<script>" }, "Empresa & Cía")).toContain("&lt;script&gt;");
  });
});

const NOW = Date.UTC(2026, 11, 1, 9);
const T = "acme";
const MON = "2026-12-07";

describe("servicio de profesores con licencia por capacidad", () => {
  let caps: MemoryCapabilityStore;
  let school: MemorySkiSchoolStore;
  let store: MemorySkiTeacherStore;
  let svc: SkiSchoolService;
  let teachers: SkiTeacherService;
  let events: EventEnvelope[];
  const sites = new Set(["s1", "s2"]);
  const license = (status: "active" | "read_only", siteId = "") =>
    caps.apply(T, [{ capabilityId: "ski-school", siteId, status, validUntil: null, source: "operator" }], { actor: "test", reason: null, now: NOW });
  const inT = <R>(fn: () => Promise<R>) => runWithTenant(T, fn);

  beforeEach(() => {
    caps = new MemoryCapabilityStore();
    school = new MemorySkiSchoolStore();
    store = new MemorySkiTeacherStore(school);
    const registry = new SdkModuleRegistry();
    registry.registerAll([skiSchoolModule]);
    const access = new CapabilityAccess(caps, { enforce: true, ttlMs: 0, now: () => NOW });
    const gate = new ModuleGate(registry, { capabilities: () => access });
    const bus = new EventBus<SkiSchoolEvents>({ now: () => NOW });
    events = [];
    for (const t of skiSchoolModule.events ?? []) bus.on(t as keyof SkiSchoolEvents, (e) => void events.push(e));
    const assert = async (s: string) => {
      if (!sites.has(s)) throw new SiteUnknown(SKI_SCHOOL_ID, s);
    };
    svc = new SkiSchoolService({ store: school, gate: () => gate, events: () => bus, assertSite: assert });
    teachers = new SkiTeacherService({ store, school, gate: () => gate, events: () => bus, assertSite: assert, today: () => MON, pdf: async (h) => Buffer.from(h) });
  });

  /** Escuela con un profesor, dos sesiones del lunes (una con reserva) y alumnos. */
  async function day() {
    await svc.activateSite("s1", "u");
    const ana = await svc.createInstructor("s1", { fullName: "Ana Ficticia" });
    const p = await svc.createProduct("s1", { name: "Cursillo", kind: "group", durationMinutes: 120, capacity: 6 });
    school.reservations.set(5, { id: 5, productName: "Cursillo", bookingDate: MON, people: 1, status: "paid" });
    store.paid.set(5, 12_000);
    const s1 = await svc.createSession("s1", { productId: p.id, date: MON, startTime: "09:00" }, "u");
    const s2 = await svc.createSession("s1", { productId: p.id, date: MON, startTime: "11:00", endTime: "12:30", reservationId: 5 }, "u");
    for (const s of [s1, s2]) await svc.assignInstructor("s1", s.id, ana.id);
    const a = await svc.addParticipant("s1", s1.id, { name: "Alumno A" });
    const b = await svc.addParticipant("s1", s1.id, { name: "Alumno B" });
    return { ana, s1, s2, a, b };
  }

  it("sin licencia: error tipado; solo lectura: consulta sí, opera no", async () => {
    await inT(async () => {
      await expect(teachers.hoursSummary("s1", MON, MON)).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
    await license("active");
    const { ana } = await inT(() => day());
    await license("read_only");
    await inT(async () => {
      expect(await teachers.hoursSummary("s1", MON, MON)).toHaveLength(1);
      await expect(teachers.updateTerms("s1", ana.id, { payMode: "hourly", hourlyRateCents: 2000 }, "u")).rejects.toBeInstanceOf(ModuleReadOnly);
    });
  });

  it("pasar lista una vez: todos los inscritos, y la sesión queda impartida", async () => {
    await license("active");
    await inT(async () => {
      const { s1, a, b } = await day();
      await expect(teachers.recordAttendance("s1", s1.id, [{ participantId: a.id, status: "present" }], "u")).rejects.toThrow(/Falta/);
      const r = await teachers.recordAttendance("s1", s1.id, [{ participantId: a.id, status: "present" }, { participantId: b.id, status: "absent" }], "u");
      expect(r.closure).toMatchObject({ present: 1, absent: 1 });
      expect((await school.session(s1.id))!.status).toBe("completed");
      await expect(teachers.recordAttendance("s1", s1.id, [{ participantId: a.id, status: "present" }, { participantId: b.id, status: "present" }], "u")).rejects.toThrow(/Ya se pasó lista/);
    });
  });

  it("control de horas: programadas, impartidas y exigidas prorrateadas", async () => {
    await license("active");
    await inT(async () => {
      const { ana, s1, a, b } = await day();
      await teachers.updateTerms("s1", ana.id, { payMode: "hourly", hourlyRateCents: 2000, requiredMinutesWeek: 1200 }, "u");
      await teachers.recordAttendance("s1", s1.id, [{ participantId: a.id, status: "present" }, { participantId: b.id, status: "present" }], "u");
      const [row] = await teachers.hoursSummary("s1", "2026-12-07", "2026-12-13");
      expect(row).toMatchObject({ fullName: "Ana Ficticia", scheduled: 210, taught: 120, sessions: 2, requiredMinutes: 1200, balanceMinutes: 210 - 1200 });
      await expect(teachers.hoursSummary("s1", "2026-12-01", "2027-06-01")).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  it("liquidación: solo lo impartido, importes congelados, sin solapes ni sesiones repetidas; anular libera", async () => {
    await license("active");
    await inT(async () => {
      const { ana, s1, s2, a, b } = await day();
      await expect(teachers.previewSettlement("s1", ana.id, "2026-12-01", "2026-12-31")).rejects.toThrow(/condiciones/);
      await teachers.updateTerms("s1", ana.id, { payMode: "percent", percentBp: 3000 }, "u");
      await teachers.recordAttendance("s1", s1.id, [{ participantId: a.id, status: "present" }, { participantId: b.id, status: "present" }], "u");
      await svc.completeSession("s1", s2.id);
      const preview = await teachers.previewSettlement("s1", ana.id, "2026-12-01", "2026-12-31");
      // La reserva #5 (120 €) solo tiene la sesión s2: 30 % de 120 € = 36 €
      expect(preview).toMatchObject({ totalCents: 3600, baseCents: 12_000, sessions: 2, overlapping: false });
      const closed = await teachers.closeSettlement("s1", ana.id, "2026-12-01", "2026-12-31", "user:1");
      expect(closed).toMatchObject({ status: "closed", totalCents: 3600, payMode: "percent" });
      // Cambiar después las condiciones no toca la cerrada
      await teachers.updateTerms("s1", ana.id, { payMode: "hourly", hourlyRateCents: 99_00 }, "u");
      expect((await teachers.getSettlement("s1", closed.id)).totalCents).toBe(3600);
      await expect(teachers.closeSettlement("s1", ana.id, "2026-12-07", "2026-12-07", "u")).rejects.toThrow(/solapa/);
      await expect(teachers.previewSettlement("s1", ana.id, "2027-01-01", "2027-01-31")).rejects.toThrow(/No hay sesiones/);
      const csv = await teachers.exportCsv("s1", closed.id);
      expect(csv.filename).toBe(`liquidacion-${closed.id}-2026-12-01.csv`);
      expect(csv.content).toContain("Ana Ficticia");
      const pdf = await teachers.exportPdf("s1", closed.id, "Empresa de pruebas");
      expect(Buffer.from(pdf.base64, "base64").toString()).toContain("Liquidación nº");
      await expect(teachers.voidSettlement("s1", closed.id, "", "u")).rejects.toMatchObject({ code: "invalid_input" });
      expect((await teachers.voidSettlement("s1", closed.id, "Error de tarifa", "u")).status).toBe("voided");
      const again = await teachers.closeSettlement("s1", ana.id, "2026-12-01", "2026-12-31", "u");
      expect(again.totalCents).toBe(Math.round((210 * 9900) / 60));
      expect(events.filter((e) => e.type === "ski_school.settlement.closed")).toHaveLength(2);
      await expect(teachers.getSettlement("s2", again.id)).rejects.toMatchObject({ code: "not_found" });
    });
  });

  it("portal: vincular por correo a un usuario del portal y ver «Mis clases y horas»", async () => {
    await license("active");
    store.users.push({ id: 10, role: "employee", name: "Ana" }, { id: 11, role: "admin", name: "Jefe" });
    store.userEmails.set("ana@ejemplo.test", 10).set("jefe@ejemplo.test", 11);
    await inT(async () => {
      const { ana, s1 } = await day();
      await expect(teachers.myClasses(10)).rejects.toMatchObject({ code: "not_found" });
      await expect(teachers.linkUser("s1", ana.id, "jefe@ejemplo.test", "u")).rejects.toThrow(/portal/);
      await expect(teachers.linkUser("s1", ana.id, "nadie@ejemplo.test", "u")).rejects.toMatchObject({ code: "not_found" });
      await teachers.linkUser("s1", ana.id, "ANA@ejemplo.test", "u");
      const other = await svc.createInstructor("s1", { fullName: "Bruno" });
      await expect(teachers.linkUser("s1", other.id, "ana@ejemplo.test", "u")).rejects.toMatchObject({ code: "conflict" });
      const mine = await teachers.myClasses(10);
      expect(mine.fullName).toBe("Ana Ficticia");
      expect(mine.upcoming.map((s) => [s.id, s.startTime])).toEqual([
        [s1.id, "09:00"],
        [s1.id + 1, "11:00"],
      ]);
      expect(mine.upcoming[0].participants).toEqual([
        { name: "Alumno A", age: null, level: null },
        { name: "Alumno B", age: null, level: null },
      ]);
      expect(mine.month).toMatchObject({ from: "2026-12-01", to: "2026-12-31", scheduled: 210, taught: 0 });
    });
  });

  it("menú: Control de horas y Liquidaciones en la sección Ski Net con ski-school", () => {
    const items = CORE_EXTENSION_PANELS.skiNet.panel.section!.items;
    expect(items.filter((i) => ["/admin/ski/horas", "/admin/ski/liquidaciones"].includes(i.path)).map((i) => i.capabilities)).toEqual([["ski-school"], ["ski-school"]]);
  });
});
