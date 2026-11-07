/**
 * Hotel Net · núcleo PMS — lógica pura: solapes de estancias, asignación automática, máquina de estados de la
 * estancia (check-in, check-out, no-show), restricciones de estancia, panel de recepción y lectura de la reserva.
 */
import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  assignmentBlocker,
  decideStayTransition,
  earlyCheckoutDate,
  findAssignmentConflict,
  hotelStayDetails,
  isIsoDate,
  nightsBetween,
  pickRoomForStay,
  receptionSummary,
  reservationOccupies,
  restrictionInputError,
  roomInService,
  stayRestrictionViolation,
  staysOverlap,
  todayInTimeZone,
  type RoomCandidate,
  type StayReservation,
} from "./hotelPms";

const stay = (checkIn: string, checkOut: string) => ({ checkIn, checkOut });

describe("fechas", () => {
  it("valida fechas reales AAAA-MM-DD", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
  });
  it("cuenta noches y suma días (cambio de mes y de año)", () => {
    expect(nightsBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(nightsBetween("2026-05-05", "2026-05-05")).toBe(0);
    expect(nightsBetween("2026-05-06", "2026-05-05")).toBe(0);
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("«hoy» se calcula en la zona horaria del hotel (Europe/Madrid por defecto)", () => {
    // 23:30 UTC del 31/12 ya es 1 de enero en Madrid (UTC+1 en invierno)
    expect(todayInTimeZone(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayInTimeZone(new Date("2026-12-31T23:30:00Z"), "UTC")).toBe("2026-12-31");
  });
});

describe("solapes de estancias", () => {
  it("dos estancias que se tocan (salida = entrada) no solapan", () => {
    expect(staysOverlap(stay("2026-07-01", "2026-07-04"), stay("2026-07-04", "2026-07-06"))).toBe(false);
    expect(staysOverlap(stay("2026-07-04", "2026-07-06"), stay("2026-07-01", "2026-07-04"))).toBe(false);
  });
  it("detecta solape parcial, contenido y total", () => {
    expect(staysOverlap(stay("2026-07-01", "2026-07-04"), stay("2026-07-03", "2026-07-05"))).toBe(true);
    expect(staysOverlap(stay("2026-07-01", "2026-07-10"), stay("2026-07-03", "2026-07-05"))).toBe(true);
    expect(staysOverlap(stay("2026-07-01", "2026-07-04"), stay("2026-07-01", "2026-07-04"))).toBe(true);
  });
  it("busca el conflicto en la misma habitación e ignora la propia reserva", () => {
    const list = [
      { reservationId: 1, hotelRoomId: 10, ...stay("2026-07-01", "2026-07-04") },
      { reservationId: 2, hotelRoomId: 11, ...stay("2026-07-01", "2026-07-04") },
    ];
    expect(findAssignmentConflict(list, 10, stay("2026-07-02", "2026-07-03"))?.reservationId).toBe(1);
    expect(findAssignmentConflict(list, 10, stay("2026-07-02", "2026-07-03"), 1)).toBeNull();
    expect(findAssignmentConflict(list, 12, stay("2026-07-02", "2026-07-03"))).toBeNull();
  });
});

const room = (id: number, code: string, over: Partial<RoomCandidate> = {}): RoomCandidate => ({
  id, roomTypeId: 1, code, isActive: true, operationalStatus: "libre", sortOrder: 0, ...over,
});

describe("asignación de habitación", () => {
  it("rechaza otra tipología, habitaciones fuera de servicio o desactivadas y solapes", () => {
    const s = stay("2026-08-01", "2026-08-03");
    expect(assignmentBlocker(room(1, "101", { roomTypeId: 2 }), 1, s, [], 9)).toMatch(/otra tipología/);
    expect(assignmentBlocker(room(1, "101", { operationalStatus: "fuera_de_servicio" }), 1, s, [], 9)).toMatch(/no está en servicio/);
    expect(assignmentBlocker(room(1, "101", { operationalStatus: "bloqueada_mantenimiento" }), 1, s, [], 9)).toMatch(/no está en servicio/);
    expect(assignmentBlocker(room(1, "101", { isActive: false }), 1, s, [], 9)).toMatch(/no está en servicio/);
    const busy = [{ reservationId: 5, hotelRoomId: 1, ...stay("2026-08-02", "2026-08-05") }];
    expect(assignmentBlocker(room(1, "101"), 1, s, busy, 9)).toMatch(/ocupada del 2026-08-02 al 2026-08-05/);
    // La propia reserva no se bloquea a sí misma (reasignar a la misma habitación)
    expect(assignmentBlocker(room(1, "101"), 1, s, busy, 5)).toBeNull();
    // Una habitación sucia sí se puede asignar (se limpiará antes de la llegada)
    expect(assignmentBlocker(room(1, "101", { operationalStatus: "sucia" }), 1, s, [], 9)).toBeNull();
    expect(roomInService({ isActive: true, operationalStatus: "revisada" })).toBe(true);
  });

  it("la automática elige la primera libre por orden y código (numérico) de la tipología", () => {
    const rooms = [room(3, "110"), room(1, "102"), room(2, "9"), room(4, "001", { roomTypeId: 2 })];
    const s = stay("2026-08-01", "2026-08-03");
    expect(pickRoomForStay(rooms, 1, s, [], 1)?.code).toBe("9");
    const busy = [{ reservationId: 7, hotelRoomId: 2, ...stay("2026-07-30", "2026-08-02") }];
    expect(pickRoomForStay(rooms, 1, s, busy, 1)?.code).toBe("102");
    expect(pickRoomForStay([room(1, "B", { sortOrder: 2 }), room(2, "A", { sortOrder: 1 })], 1, s, [], 1)?.code).toBe("A");
  });

  it("sin habitación libre toda la estancia no asigna nada (no parte la estancia)", () => {
    const rooms = [room(1, "101"), room(2, "102", { operationalStatus: "fuera_de_servicio" })];
    const busy = [{ reservationId: 7, hotelRoomId: 1, ...stay("2026-08-02", "2026-08-03") }];
    expect(pickRoomForStay(rooms, 1, stay("2026-08-01", "2026-08-05"), busy, 1)).toBeNull();
    expect(pickRoomForStay(rooms, 3, stay("2026-08-01", "2026-08-05"), [], 1)).toBeNull();
  });
});

const res = (over: Partial<StayReservation> = {}): StayReservation => ({
  checkIn: "2026-09-10",
  checkOut: "2026-09-12",
  status: "paid",
  statusReservation: "CONFIRMADA",
  holdStatus: "confirmada",
  holdLive: true,
  ...over,
});

describe("ocupación de una reserva", () => {
  it("pagada o confirmada por el personal ocupa; cancelada, anulada, no-show, caducada o en conflicto, no", () => {
    expect(reservationOccupies(res())).toBe(true);
    expect(reservationOccupies(res({ status: "pending_payment", holdStatus: "confirmada" }))).toBe(true);
    expect(reservationOccupies(res({ status: "pending_payment", holdStatus: "retenida", holdLive: true }))).toBe(true);
    expect(reservationOccupies(res({ status: "pending_payment", holdStatus: "retenida", holdLive: false }))).toBe(false);
    expect(reservationOccupies(res({ status: "pending_payment", holdStatus: "liberada" }))).toBe(false);
    expect(reservationOccupies(res({ status: "cancelled" }))).toBe(false);
    expect(reservationOccupies(res({ status: "failed" }))).toBe(false);
    expect(reservationOccupies(res({ statusReservation: "ANULADA" }))).toBe(false);
    expect(reservationOccupies(res({ statusReservation: "NO_SHOW" }))).toBe(false);
    expect(reservationOccupies(res({ holdStatus: "conflicto" }))).toBe(false);
    // Reserva antigua sin retención (anterior a 0004): ocupa si no está anulada
    expect(reservationOccupies(res({ status: "pending_payment", holdStatus: null }))).toBe(true);
  });
});

describe("máquina de estados de la estancia", () => {
  it("check-in válido el día de llegada y durante la estancia: pasa a EN_CURSO y la habitación a ocupada", () => {
    expect(decideStayTransition(res(), "checkin", "2026-09-10")).toEqual({ ok: true, nextStatusReservation: "EN_CURSO", roomStatus: "ocupada" });
    expect(decideStayTransition(res(), "checkin", "2026-09-11").ok).toBe(true);
    expect(decideStayTransition(res({ statusReservation: null }), "checkin", "2026-09-10").ok).toBe(true);
    expect(decideStayTransition(res({ statusReservation: "PENDIENTE_CONFIRMACION", status: "pending_payment", holdStatus: "retenida" }), "checkin", "2026-09-10").ok).toBe(true);
  });

  it("check-in inválido: cancelada, anulada, caducada, antes de la llegada, tras la salida o repetido", () => {
    const no = (r: StayReservation, today = "2026-09-10") => {
      const d = decideStayTransition(r, "checkin", today);
      return d.ok ? null : d.reason;
    };
    expect(no(res({ status: "cancelled" }))).toMatch(/cancelada/);
    expect(no(res({ status: "failed" }))).toMatch(/cancelada/);
    expect(no(res({ statusReservation: "ANULADA" }))).toMatch(/cancelada/);
    expect(no(res({ status: "pending_payment", holdStatus: "retenida", holdLive: false }))).toMatch(/no tiene habitación retenida/);
    expect(no(res(), "2026-09-09")).toMatch(/La llegada es el 2026-09-10/);
    expect(no(res(), "2026-09-12")).toMatch(/ya no admite check-in/);
    expect(no(res({ statusReservation: "EN_CURSO" }))).toMatch(/ya hizo el check-in/);
    expect(no(res({ statusReservation: "FINALIZADA" }))).toMatch(/ya terminó/);
    expect(no(res({ statusReservation: "NO_SHOW" }))).toMatch(/no-show/);
  });

  it("no hay check-out sin check-in; con la estancia en curso, finaliza y la habitación queda sucia", () => {
    for (const sr of ["CONFIRMADA", "PENDIENTE_CONFIRMACION", "NO_SHOW", "ANULADA", null]) {
      const d = decideStayTransition(res({ statusReservation: sr }), "checkout", "2026-09-12");
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.reason).toMatch(/sin check-in/);
    }
    const twice = decideStayTransition(res({ statusReservation: "FINALIZADA" }), "checkout", "2026-09-12");
    expect(twice.ok ? null : twice.reason).toMatch(/ya tiene el check-out/);
    expect(decideStayTransition(res({ statusReservation: "EN_CURSO" }), "checkout", "2026-09-12"))
      .toEqual({ ok: true, nextStatusReservation: "FINALIZADA", roomStatus: "sucia" });
    // Salida anticipada o tardía: se permite con el huésped dentro
    expect(decideStayTransition(res({ statusReservation: "EN_CURSO" }), "checkout", "2026-09-11").ok).toBe(true);
    expect(decideStayTransition(res({ statusReservation: "EN_CURSO" }), "checkout", "2026-09-14").ok).toBe(true);
  });

  it("no-show: solo una reserva viva sin entrar y alcanzada la llegada; libera la habitación", () => {
    expect(decideStayTransition(res(), "noshow", "2026-09-10")).toEqual({ ok: true, nextStatusReservation: "NO_SHOW", roomStatus: "libre" });
    expect(decideStayTransition(res(), "noshow", "2026-09-09").ok).toBe(false);
    expect(decideStayTransition(res({ statusReservation: "EN_CURSO" }), "noshow", "2026-09-10").ok).toBe(false);
    expect(decideStayTransition(res({ statusReservation: "NO_SHOW" }), "noshow", "2026-09-10").ok).toBe(false);
    expect(decideStayTransition(res({ status: "cancelled" }), "noshow", "2026-09-10").ok).toBe(false);
  });

  it("la salida anticipada acorta la asignación hasta hoy; en la fecha prevista o después, no", () => {
    expect(earlyCheckoutDate(stay("2026-09-10", "2026-09-14"), "2026-09-12")).toBe("2026-09-12");
    expect(earlyCheckoutDate(stay("2026-09-10", "2026-09-14"), "2026-09-14")).toBeNull();
    expect(earlyCheckoutDate(stay("2026-09-10", "2026-09-14"), "2026-09-10")).toBe("2026-09-10");
    expect(earlyCheckoutDate(stay("2026-09-10", "2026-09-14"), "2026-09-16")).toBeNull();
    // Una estancia acortada a 0 noches no choca con la siguiente llegada
    expect(staysOverlap(stay("2026-09-10", "2026-09-10"), stay("2026-09-10", "2026-09-12"))).toBe(false);
  });
});

describe("restricciones de estancia", () => {
  const none = { minStay: null, maxStay: null, closedToArrival: false, closedToDeparture: false };
  it("sin restricciones (o a 0) no se bloquea nada", () => {
    expect(stayRestrictionViolation(null, null, 1)).toBeNull();
    expect(stayRestrictionViolation(none, none, 1)).toBeNull();
    expect(stayRestrictionViolation({ ...none, minStay: 0, maxStay: 0 }, null, 1)).toBeNull();
  });
  it("aplica estancia mínima y máxima del día de llegada", () => {
    expect(stayRestrictionViolation({ ...none, minStay: 3 }, null, 2)).toMatch(/mínima es de 3 noches/);
    expect(stayRestrictionViolation({ ...none, minStay: 3 }, null, 3)).toBeNull();
    expect(stayRestrictionViolation({ ...none, maxStay: 7 }, null, 8)).toMatch(/máxima es de 7 noches/);
    expect(stayRestrictionViolation({ ...none, maxStay: 1 }, null, 2)).toMatch(/máxima es de 1 noche\./);
  });
  it("cierre a llegadas en la entrada y a salidas en la salida", () => {
    expect(stayRestrictionViolation({ ...none, closedToArrival: true }, null, 2)).toMatch(/llegadas/);
    expect(stayRestrictionViolation(null, { ...none, closedToDeparture: true }, 2)).toMatch(/salidas/);
    // El cierre a salidas del día de llegada no afecta (solo cuenta el del día de salida)
    expect(stayRestrictionViolation({ ...none, closedToDeparture: true }, null, 2)).toBeNull();
  });
  it("valida la restricción antes de guardarla", () => {
    expect(restrictionInputError({ ...none, minStay: 5, maxStay: 3 })).toMatch(/no puede superar/);
    expect(restrictionInputError({ ...none, minStay: -1 })).toMatch(/negativa/);
    expect(restrictionInputError({ ...none, minStay: 2, maxStay: 7 })).toBeNull();
  });
});

describe("panel de recepción", () => {
  const today = "2026-09-10";
  const rows = [
    { id: 1, ...res({ checkIn: today, checkOut: "2026-09-12" }) }, // llega hoy
    { id: 2, ...res({ checkIn: "2026-09-08", checkOut: today, statusReservation: "EN_CURSO" }) }, // sale hoy
    { id: 3, ...res({ checkIn: "2026-09-09", checkOut: "2026-09-13", statusReservation: "EN_CURSO" }) }, // en casa
    { id: 4, ...res({ checkIn: today, checkOut: "2026-09-11", status: "cancelled" }) }, // cancelada
    { id: 5, ...res({ checkIn: today, checkOut: "2026-09-11", statusReservation: "NO_SHOW" }) }, // no-show de hoy
    { id: 6, ...res({ checkIn: "2026-09-09", checkOut: "2026-09-11" }) }, // llegada atrasada sin check-in
    { id: 7, ...res({ checkIn: "2026-09-07", checkOut: "2026-09-09", statusReservation: "EN_CURSO" }) }, // salida vencida
    { id: 8, ...res({ checkIn: "2026-09-08", checkOut: today, statusReservation: "FINALIZADA" }) }, // ya salió hoy
  ];
  const s = receptionSummary(rows, today);
  it("llegadas: hoy y atrasadas vivas, sin canceladas ni no-shows", () => {
    expect(s.arrivals.map((r) => r.id).sort()).toEqual([1, 6]);
  });
  it("salidas: las de hoy (dentro o ya salidas) y las vencidas con el huésped dentro", () => {
    expect(s.departures.map((r) => r.id).sort()).toEqual([2, 7, 8]);
  });
  it("en casa, no-shows y ocupación de esta noche", () => {
    expect(s.inHouse.map((r) => r.id).sort()).toEqual([2, 3, 7]);
    expect(s.noShowsToday).toBe(1);
    // Cubren la noche del 10: 1, 3 y 6 (la 2 y la 8 salen hoy, la 7 debía salir el 9)
    expect(s.occupiedTonight).toBe(3);
  });
});

describe("lectura de la reserva de hotel", () => {
  const base = { bookingDate: "2026-10-01", productId: 4, productName: "Hotel: Doble (2 noches)" };
  it("lee la estancia del extras_json de la reserva pública", () => {
    const d = hotelStayDetails({ ...base, extrasJson: JSON.stringify({ type: "hotel", roomTypeId: 4, roomName: "Doble", checkIn: "2026-10-01", checkOut: "2026-10-03", adults: 2, children: 1 }) });
    expect(d).toMatchObject({ roomTypeId: 4, roomName: "Doble", checkIn: "2026-10-01", checkOut: "2026-10-03", nights: 2, adults: 2, children: 1 });
  });
  it("las columnas de la retención mandan sobre el extras_json", () => {
    const d = hotelStayDetails({ ...base, extrasJson: JSON.stringify({ checkIn: "2026-10-01", checkOut: "2026-10-03" }), stayCheckIn: "2026-10-02", stayCheckOut: "2026-10-05", inventoryRefId: 9 });
    expect(d).toMatchObject({ checkIn: "2026-10-02", checkOut: "2026-10-05", nights: 3, roomTypeId: 9 });
  });
  it("tolera extras_json vacío o corrupto", () => {
    const d = hotelStayDetails({ ...base, extrasJson: "{no es json" });
    expect(d).toMatchObject({ checkIn: "2026-10-01", checkOut: null, roomTypeId: 4, roomName: "Hotel: Doble (2 noches)" });
  });
});
