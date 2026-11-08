/**
 * Care Net · recordatorios de cita: lógica pura (qué citas tocan, ventanas de antelación con el huso de Madrid y el
 * cambio de hora, idempotencia), plantilla sin datos clínicos, tarea por empresa y envío manual con dobles.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_REMINDER_SETTINGS,
  HOUR_MS,
  appointmentProblem,
  dayIn,
  normalizeLeads,
  planReminder,
  reminderSummary,
  settingsProblem,
  wallToUtc,
  type SendRecord,
} from "../shared/careNetReminders";
import { NET_PRODUCTS } from "../shared/netProducts";
import { jobMultiPolicy } from "./_core/tenantRegistry/jobPolicy";
import {
  CARE_REMINDER_CATEGORY,
  CARE_REMINDERS_JOB,
  MANUAL_COOLDOWN_MS,
  reminderEmail,
  reminderKey,
  runCareReminders,
  sendReminderNow,
  validEmail,
  type CareReminderDeps,
  type ManualDeps,
} from "./careNetReminders";
import type { ReminderAppointment, SendRow } from "./careNetRemindersDb";

const iso = (ms: number) => new Date(ms).toISOString();

describe("hora de la cita en Europe/Madrid", () => {
  it("invierno (UTC+1) y verano (UTC+2)", () => {
    expect(iso(wallToUtc("2026-11-09", "10:30")!)).toBe("2026-11-09T09:30:00.000Z");
    expect(iso(wallToUtc("2026-07-15", "10:30")!)).toBe("2026-07-15T08:30:00.000Z");
  });
  it("cambio de hora: hora inexistente de marzo y hora repetida de octubre", () => {
    // 29/03/2026: de 02:00 se pasa a 03:00 → 02:30 no existe y se lleva a 03:30 CEST (01:30Z)
    expect(iso(wallToUtc("2026-03-29", "02:30")!)).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(wallToUtc("2026-03-29", "03:00")!)).toBe("2026-03-29T01:00:00.000Z");
    // 25/10/2026: 02:30 se repite; se toma la segunda (CET, 01:30Z)
    expect(iso(wallToUtc("2026-10-25", "02:30")!)).toBe("2026-10-25T01:30:00.000Z");
    expect(iso(wallToUtc("2026-10-25", "10:00")!)).toBe("2026-10-25T09:00:00.000Z");
  });
  it("fecha u hora no válidas", () => {
    expect(wallToUtc("2026-13-40", "10:00")).toBeNull();
    expect(wallToUtc("09/11/2026", "10:00")).toBeNull();
    expect(wallToUtc("2026-11-09", "")).toBeNull();
  });
  it("día en Madrid de un instante (medianoche)", () => {
    expect(dayIn(Date.parse("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
    expect(dayIn(Date.parse("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });
  it("antelación de 24 h en horas reales a través del cambio de hora", () => {
    // Cita el lunes 26/10 a las 10:00 (CET): 24 h antes es el domingo 25/10 a las 10:00 CET (09:00Z)
    const at = wallToUtc("2026-10-26", "10:00")!;
    expect(planReminder(at, Date.parse("2026-10-25T08:59:00Z"), [24], []).send).toBeNull();
    expect(planReminder(at, Date.parse("2026-10-25T09:00:00Z"), [24], []).send).toBe(24);
  });
});

describe("qué recordatorio toca", () => {
  const at = Date.parse("2026-11-10T09:00:00Z");
  const h = (n: number) => at - n * HOUR_MS;
  it("nada antes de abrirse la ventana ni con la cita empezada", () => {
    expect(planReminder(at, h(25), [24, 2], [])).toEqual({ send: null, supersede: [] });
    expect(planReminder(at, at, [24, 2], [])).toEqual({ send: null, supersede: [] });
    expect(planReminder(at, at + 60_000, [24], [])).toEqual({ send: null, supersede: [] });
  });
  it("24 h y después 2 h: uno por antelación", () => {
    expect(planReminder(at, h(23), [24, 2], [])).toEqual({ send: 24, supersede: [] });
    const after24: SendRecord[] = [{ leadHours: 24, status: "sent", attempts: 1 }];
    expect(planReminder(at, h(10), [24, 2], after24)).toEqual({ send: null, supersede: [] });
    expect(planReminder(at, h(1.5), [24, 2], after24)).toEqual({ send: 2, supersede: [] });
    const both: SendRecord[] = [...after24, { leadHours: 2, status: "sent", attempts: 1 }];
    expect(planReminder(at, h(1), [24, 2], both)).toEqual({ send: null, supersede: [] });
  });
  it("cita reservada con poco margen: solo el más cercano; los largos se omiten", () => {
    expect(planReminder(at, h(1), [48, 24, 2], [])).toEqual({ send: 2, supersede: [24, 48] });
  });
  it("idempotencia: enviado u omitido no se repite; fallido se reintenta con límite", () => {
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "skipped", attempts: 0 }]).send).toBeNull();
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "sending", attempts: 1 }]).send).toBeNull();
    // «Enviando» atascado (caída a mitad de envío): reintentable pasados 15 minutos y con intentos libres
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "sending", attempts: 1, at: h(3) - 10 * 60_000 }]).send).toBeNull();
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "sending", attempts: 1, at: h(3) - 16 * 60_000 }]).send).toBe(24);
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "sending", attempts: 3, at: h(3) - 16 * 60_000 }]).send).toBeNull();
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "failed", attempts: 1 }]).send).toBe(24);
    expect(planReminder(at, h(3), [24], [{ leadHours: 24, status: "failed", attempts: 3 }]).send).toBeNull();
  });
  it("el envío manual (antelación 0) no cuenta como automático", () => {
    expect(planReminder(at, h(3), [24], [{ leadHours: 0, status: "sent", attempts: 1 }]).send).toBe(24);
  });
  it("solo citas confirmadas y futuras", () => {
    const now = Date.parse("2026-11-09T09:00:00Z");
    expect(appointmentProblem({ state: "confirmada", date: "2026-11-10", startTime: "10:00" }, now)).toBeNull();
    expect(appointmentProblem({ state: "pendiente", date: "2026-11-10", startTime: "10:00" }, now)).toMatch(/confirmadas/);
    expect(appointmentProblem({ state: "anulada", date: "2026-11-10", startTime: "10:00" }, now)).toMatch(/confirmadas/);
    expect(appointmentProblem({ state: "confirmada", date: "2026-11-09", startTime: "09:00" }, now)).toMatch(/pasado/);
  });
  it("ajustes: antelaciones válidas, apagado por defecto", () => {
    expect(DEFAULT_REMINDER_SETTINGS.enabled).toBe(false);
    expect(normalizeLeads([2, 24, 24, 5, "48"])).toEqual([48, 24, 2]);
    expect(normalizeLeads("[24]")).toEqual([24]);
    expect(normalizeLeads("x")).toEqual([]);
    expect(settingsProblem({ enabled: true, leadHours: [], extraText: "" })).toMatch(/antelación/);
    expect(settingsProblem({ enabled: false, leadHours: [], extraText: "" })).toBeNull();
    expect(settingsProblem({ enabled: true, leadHours: [24], extraText: "x".repeat(501) })).toMatch(/500/);
  });
  it("resumen para el panel", () => {
    expect(reminderSummary([])).toBeNull();
    expect(reminderSummary([{ leadHours: 24, status: "sent", reason: null, at: 1 }, { leadHours: 48, status: "skipped", reason: "superado", at: 2 }])?.label).toBe("Enviado · 24 h antes");
    expect(reminderSummary([{ leadHours: 24, status: "skipped", reason: "sin_correo", at: 1 }])?.label).toMatch(/^Omitido · El cliente no tiene/);
    expect(reminderSummary([{ leadHours: 2, status: "failed", reason: "envio_fallido", at: 1 }])?.status).toBe("failed");
  });
});

const appt = (o: Partial<ReminderAppointment> = {}): ReminderAppointment => ({
  reservationId: 7, reservationNumber: "SPA-0007", date: "2026-11-10", startTime: "10:00", endTime: "11:00", treatmentName: "Masaje relajante",
  resourceType: "terapeuta", resourceName: "Lucía", customerName: "Ana Ficticia", customerEmail: "ana@clientes.example", people: 1, state: "confirmada", ...o,
});
const BRAND = { company: "Centro Demo", address: "Calle Falsa 1, Madrid", phone: "910 000 000", email: "citas@centro.example" };

describe("plantilla del correo", () => {
  it("lleva la marca, la fecha y hora de Madrid, el tratamiento, el profesional, la dirección y cómo avisar", () => {
    const c = reminderEmail(appt(), BRAND, "Llega 10 minutos antes.");
    expect(c.subject).toBe("Recordatorio de tu cita en Centro Demo: martes, 10 de noviembre de 2026, 10:00");
    for (const s of ["Centro Demo", "martes, 10 de noviembre de 2026", "10:00", "Masaje relajante", "Profesional: Lucía", "Calle Falsa 1, Madrid", "910 000 000", "citas@centro.example", "SPA-0007", "Llega 10 minutos antes."]) {
      expect(c.text).toContain(s);
    }
    expect(c.html).toContain("Masaje relajante");
    expect(reminderEmail(appt({ resourceType: "cabina", resourceName: "Cabina 2" }), BRAND, "").text).toContain("Cabina: Cabina 2");
  });
  it("sin datos clínicos ni HTML del texto adicional", () => {
    const c = reminderEmail(appt(), BRAND, "<script>alert(1)</script>");
    expect(c.html).not.toContain("<script>alert");
    expect(c.text).not.toMatch(/diagn|alergi|patolog|historial/i);
  });
  it("clave de idempotencia por cita y antelación", () => {
    expect(reminderKey(7, 24)).toBe("care:reminder:7:24h");
    expect(reminderKey(7, 0, 123)).toBe("care:reminder:7:manual:123");
    expect(validEmail(" Ana@Clientes.Example ")).toBe("ana@clientes.example");
    expect(validEmail("no es correo")).toBeNull();
    expect(CARE_REMINDER_CATEGORY).toBe("operational");
  });
});

/** Registro en memoria con la misma semántica que care_reminder_sends (clave única cita + antelación). */
function fakeStore() {
  const rows = new Map<string, SendRow>();
  const k = (id: number, l: number) => `${id}:${l}`;
  return {
    rows,
    sends: async (ids: number[]) => Array.from(rows.values()).filter((r) => ids.includes(r.reservationId)),
    claim: async (id: number, l: number) => {
      const r = rows.get(k(id, l));
      if (!r) { rows.set(k(id, l), { reservationId: id, leadHours: l, status: "sending", reason: null, attempts: 1, at: 0 }); return true; }
      // Reintento de un fallido o de un «enviando» atascado (la base lo condiciona a updated_at; aquí decide el plan)
      if ((r.status === "failed" || r.status === "sending") && r.attempts < 3) { r.status = "sending"; r.attempts++; return true; }
      return false;
    },
    settle: async (id: number, l: number, status: "sent" | "failed" | "skipped", reason: string | null) => {
      const r = rows.get(k(id, l))!;
      if (r.status === "sending") Object.assign(r, { status, reason });
    },
    skip: async (id: number, l: number, _at: number, reason: string) => {
      if (!rows.has(k(id, l))) rows.set(k(id, l), { reservationId: id, leadHours: l, status: "skipped", reason, attempts: 0, at: 0 });
    },
  };
}

function deps(o: Partial<CareReminderDeps> & { list?: ReminderAppointment[] } = {}) {
  const store = fakeStore();
  const sent: Array<{ id: number; lead: number; email: string }> = [];
  const d: CareReminderDeps = {
    licensed: async () => true,
    settings: async () => ({ enabled: true, leadHours: [24, 2], extraText: "" }),
    mailBlock: async () => null,
    appointments: async () => o.list ?? [appt()],
    sends: store.sends,
    claim: store.claim,
    settle: store.settle,
    skip: store.skip,
    trialBlocks: async () => false,
    send: async (a, lead, email) => { sent.push({ id: a.reservationId, lead, email }); return true; },
    ...o,
  };
  return { d, store, sent };
}

describe("tarea por empresa (dobles)", () => {
  const now = new Date("2026-11-09T10:00:00Z"); // cita 10/11 10:00 Madrid = 09:00Z → faltan 23 h
  it("está registrada por empresa", () => {
    expect(jobMultiPolicy(CARE_REMINDERS_JOB).mode).toBe("per-tenant");
  });
  it("sin licencia, apagado o sin correo configurado: no toca nada", async () => {
    for (const [o, why] of [
      [{ licensed: async () => false }, "sin_licencia"],
      [{ licensed: async () => { throw new Error("x"); } }, "licencia_no_verificable"],
      [{ settings: async () => ({ ...DEFAULT_REMINDER_SETTINGS }) }, "desactivado"],
      [{ mailBlock: async () => "sin_remitente" }, "sin_remitente"],
    ] as const) {
      const { d, sent, store } = deps(o as Partial<CareReminderDeps>);
      expect((await runCareReminders(now, d)).skippedAll).toBe(why);
      expect(sent).toHaveLength(0);
      expect(store.rows.size).toBe(0);
    }
  });
  it("envía una sola vez por cita y antelación aunque se repita la pasada", async () => {
    const { d, sent, store } = deps();
    expect(await runCareReminders(now, d)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await runCareReminders(new Date(now.getTime() + 10 * 60_000), d)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sent).toEqual([{ id: 7, lead: 24, email: "ana@clientes.example" }]);
    // Dentro de las 2 h: el segundo recordatorio
    expect((await runCareReminders(new Date("2026-11-10T07:30:00Z"), d)).sent).toBe(1);
    expect(sent.map((s) => s.lead)).toEqual([24, 2]);
    expect(Array.from(store.rows.values()).every((r) => r.status === "sent")).toBe(true);
  });
  it("solo citas confirmadas y futuras", async () => {
    const list = [appt({ reservationId: 1, state: "pendiente" }), appt({ reservationId: 2, state: "anulada" }), appt({ reservationId: 3, date: "2026-11-09", startTime: "09:00" }), appt({ reservationId: 4 })];
    const { d, sent } = deps({ list });
    await runCareReminders(now, d);
    expect(sent.map((s) => s.id)).toEqual([4]);
  });
  it("sin correo del cliente: omitido con motivo, una vez", async () => {
    const { d, sent, store } = deps({ list: [appt({ customerEmail: null })] });
    expect((await runCareReminders(now, d)).skipped).toBe(1);
    expect((await runCareReminders(now, d)).skipped).toBe(0);
    expect(sent).toHaveLength(0);
    expect(store.rows.get("7:24")).toMatchObject({ status: "skipped", reason: "sin_correo" });
  });
  it("reserva con poco margen: solo el de 2 h y el de 24 h queda omitido", async () => {
    const { d, sent, store } = deps();
    await runCareReminders(new Date("2026-11-10T08:00:00Z"), d);
    expect(sent.map((s) => s.lead)).toEqual([2]);
    expect(store.rows.get("7:24")).toMatchObject({ status: "skipped", reason: "superado" });
  });
  it("fallido: se reintenta en la siguiente pasada hasta el límite", async () => {
    let ok = false;
    const { d, store } = deps({ send: async () => ok });
    expect((await runCareReminders(now, d)).failed).toBe(1);
    expect(store.rows.get("7:24")).toMatchObject({ status: "failed", reason: "envio_fallido", attempts: 1 });
    expect((await runCareReminders(now, d)).failed).toBe(1);
    expect((await runCareReminders(now, d)).failed).toBe(1);
    expect((await runCareReminders(now, d)).failed).toBe(0); // 3 intentos agotados
    ok = true;
    expect((await runCareReminders(now, d)).sent).toBe(0);
  });
  it("prueba gratuita: si la política del Core deja fuera al destinatario, omitido sin enviar y sin reintentos", async () => {
    const { d, store, sent } = deps({ trialBlocks: async () => true });
    expect(await runCareReminders(now, d)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect(store.rows.get("7:24")).toMatchObject({ status: "skipped", reason: "prueba_gratuita" });
    expect((await runCareReminders(now, d)).skipped).toBe(0);
  });
  it("cualquier otro fallo (también en prueba gratuita con destinatario permitido) queda fallido y se reintenta", async () => {
    const { d, store } = deps({ trialBlocks: async () => false, send: async () => false });
    expect((await runCareReminders(now, d)).failed).toBe(1);
    expect(store.rows.get("7:24")).toMatchObject({ status: "failed", reason: "envio_fallido" });
    // Comprobación de la política que falla: no se da por omitido, decide el envío
    const x = deps({ trialBlocks: async () => { throw new Error("x"); }, send: async () => false });
    expect((await runCareReminders(now, x.d)).failed).toBe(1);
  });
  it("«enviando» atascado tras una caída: se vuelve a reservar pasados 15 minutos, no antes", async () => {
    const t = now.getTime();
    const stuck = (minutes: number) => {
      const x = deps();
      x.store.rows.set("7:24", { reservationId: 7, leadHours: 24, status: "sending", reason: null, attempts: 1, at: t - minutes * 60_000 });
      return x;
    };
    const recent = stuck(5);
    expect((await runCareReminders(now, recent.d)).sent).toBe(0);
    expect(recent.sent).toHaveLength(0);
    const old = stuck(20);
    expect((await runCareReminders(now, old.d)).sent).toBe(1);
    expect(old.store.rows.get("7:24")).toMatchObject({ status: "sent", attempts: 2 });
  });
  it("por páginas: una cita confirmada detrás de 500 que no tocan también se recuerda", async () => {
    const all = [...Array.from({ length: 500 }, (_, i) => appt({ reservationId: 1000 + i, state: "pendiente" })), appt({ reservationId: 7 })];
    const offsets: number[] = [];
    const { d, sent } = deps({ appointments: async (_f, _t, limit, offset) => { offsets.push(offset); return all.slice(offset, offset + limit); } });
    expect((await runCareReminders(now, d)).sent).toBe(1);
    expect(sent.map((x) => x.id)).toEqual([7]);
    expect(offsets).toEqual([0, 500]);
  });
  it("otra réplica ya lo reservó: no se envía", async () => {
    const { d, sent } = deps({ claim: async () => false });
    await runCareReminders(now, d);
    expect(sent).toHaveLength(0);
  });
});

describe("«Enviar recordatorio ahora» (dobles)", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  function manual(o: Partial<ManualDeps> = {}) {
    const calls: string[] = [];
    let last: SendRow | null = null;
    const d: ManualDeps = {
      appointment: async () => appt(),
      mailBlock: async () => null,
      lastManual: async () => last,
      claim: async () => { calls.push("claim"); return true; },
      settle: async (_id, status) => { calls.push(status); last = { reservationId: 7, leadHours: 0, status, reason: null, attempts: 1, at: now }; },
      trialBlocks: async () => false,
      send: async () => { calls.push("send"); return true; },
      ...o,
    };
    return { d, calls };
  }
  it("envía y registra; un segundo clic inmediato se rechaza", async () => {
    const { d, calls } = manual();
    expect(await sendReminderNow(7, 1, now, d)).toEqual({ ok: true, status: "sent" });
    expect(calls).toEqual(["claim", "send", "sent"]);
    expect((await sendReminderNow(7, 1, now + 30_000, d)).ok).toBe(false);
    expect((await sendReminderNow(7, 1, now + MANUAL_COOLDOWN_MS + 1, d)).ok).toBe(true);
  });
  it("rechaza citas no confirmadas, pasadas, sin correo o sin correo de empresa", async () => {
    for (const o of [
      { appointment: async () => null },
      { appointment: async () => appt({ state: "pendiente" }) },
      { appointment: async () => appt({ date: "2026-11-01" }) },
      { appointment: async () => appt({ customerEmail: "" }) },
      { mailBlock: async () => "correo_desactivado" },
    ] as Partial<ManualDeps>[]) {
      const { d, calls } = manual(o);
      const r = await sendReminderNow(7, 1, now, d);
      expect(r).toMatchObject({ ok: false, status: "refused" });
      expect(calls).toHaveLength(0);
    }
  });
  it("fallo del envío y prueba gratuita", async () => {
    expect((await sendReminderNow(7, 1, now, manual({ send: async () => false }).d)).status).toBe("failed");
    const t = manual({ trialBlocks: async () => true });
    expect((await sendReminderNow(7, 1, now, t.d)).status).toBe("skipped");
    expect(t.calls).toEqual(["claim", "skipped"]);
  });
});

describe("ficha de Care Net", () => {
  it("«Recordatorios y comunicaciones» ya está disponible dentro del producto", () => {
    const care = NET_PRODUCTS.find((p) => p.key === "care-net-complete")!;
    const f = care.areas.flatMap((a) => a.features).find((x) => x.label === "Recordatorios y comunicaciones");
    expect(f?.status).toBe("available");
  });
});
