/**
 * Hotel Net · núcleo PMS con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0032).
 *  - Sin Hotel Net no se llega al PMS; con él, habitaciones físicas por empresa (código único) y aisladas entre empresas.
 *  - Asignación manual y automática sin solapes, también con dos asignaciones simultáneas a la misma habitación.
 *  - Recepción: check-in, check-out y no-show con transiciones válidas e inválidas, y estado de la habitación.
 *  - Restricciones de estancia aplicadas al buscador público y al alta de recepción.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "hotel-net";

describe.skipIf(!URL_)("Hotel Net · PMS (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  const today = todayInTimeZone();
  const d = (n: number) => addDaysIso(today, n);
  let typeId = 0;
  let room101 = 0;
  let room102 = 0;

  const createType = async (slug: string, totalUnits: number) =>
    data(await ess.m("a", "hotel.adminCreateRoomType", { slug, name: `Tipo ${slug}`, basePrice: "100", totalUnits, maxAdults: 2 }, adA)).id as number;
  const reserve = async (input: Record<string, unknown>) =>
    ess.m("a", "hotel.adminCreateReservation", { adults: 2, customerName: "Huésped Prueba", customerEmail: "huesped@cliente-a.example", ...input }, adA);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "hotelpms");
    for (const co of ["a", "b"] as const) {
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      // Hotel es un módulo con licencia propia: además de la capacidad hotel-net hace falta su licencia de módulo
      await ess.grantModule(co, "hotel");
    }
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin Hotel Net no se llega al PMS", async () => {
    expect(isLicenseDenied(await ess.q("a", "hotel.adminGetRooms", undefined, adA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.q("a", "hotel.adminGetReceptionDashboard", undefined, adA), CAP)).toBe(true);
  });

  it("habitaciones físicas: alta, código único por sede y aislamiento entre empresas", async () => {
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    typeId = await createType("doble", 2);
    room101 = data(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code: "101", floor: "1", attributes: ["Vistas"] }, adA)).id;
    room102 = data(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code: "102", floor: "1" }, adA)).id;
    expect(errCode(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code: "101" }, adA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: 999999, code: "999" }, adA))).toBe("BAD_REQUEST");
    const list = data(await ess.q("a", "hotel.adminGetRooms", undefined, adA));
    expect(list.map((r: any) => r.code)).toEqual(["101", "102"]);
    expect(list[0]).toMatchObject({ operationalStatus: "libre", isActive: true, attributes: ["Vistas"], siteId: null });
    // La otra empresa no ve nada
    expect(data(await ess.q("b", "hotel.adminGetRooms", undefined, adB))).toEqual([]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM hotel_rooms"))[0].n).toBe(0);
  });

  it("asignación manual y automática sin solapes; tipología completa sin forzar", async () => {
    const r1 = await reserve({ roomTypeId: typeId, checkIn: d(0), checkOut: d(2), hotelRoomId: room101 });
    expect(r1.status).toBe(200);
    const r2 = await reserve({ roomTypeId: typeId, checkIn: d(0), checkOut: d(2) });
    expect(r2.status).toBe(200);
    const [hold] = await ess.sql("a", "SELECT hold_status, status_reservation, channel, amount_total FROM reservations WHERE id = ?", [data(r1).id]);
    expect(hold).toMatchObject({ hold_status: "confirmada", status_reservation: "CONFIRMADA", channel: "MANUAL", amount_total: 20000 });

    const auto = data(await ess.m("a", "hotel.adminAutoAssignRoom", { reservationId: data(r2).id }, adA));
    expect(auto).toMatchObject({ ok: true, roomCode: "102" });

    // Dos de dos vendidas: sin forzar no hay sitio; forzando sí, pero sin habitación física libre
    expect(errCode(await reserve({ roomTypeId: typeId, checkIn: d(1), checkOut: d(3) }))).toBe("BAD_REQUEST");
    const r3 = data(await reserve({ roomTypeId: typeId, checkIn: d(1), checkOut: d(3), force: true }));
    expect(errCode(await ess.m("a", "hotel.adminAutoAssignRoom", { reservationId: r3.id }, adA))).toBe("BAD_REQUEST");
    const clash = await ess.m("a", "hotel.adminAssignRoom", { reservationId: r3.id, hotelRoomId: room101 }, adA);
    expect(errCode(clash)).toBe("CONFLICT");
    // Una habitación fuera de servicio no se asigna aunque esté libre
    const room103 = data(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code: "103" }, adA)).id;
    await ess.m("a", "hotel.adminSetRoomState", { hotelRoomId: room103, toStatus: "fuera_de_servicio", reason: "Avería" }, adA);
    expect(errCode(await ess.m("a", "hotel.adminAssignRoom", { reservationId: r3.id, hotelRoomId: room103 }, adA))).toBe("CONFLICT");
    await ess.m("a", "hotel.adminSetRoomState", { hotelRoomId: room103, toStatus: "libre" }, adA);
    expect(data(await ess.m("a", "hotel.adminAssignRoom", { reservationId: r3.id, hotelRoomId: room103 }, adA))).toMatchObject({ roomCode: "103" });
    const hist = data(await ess.q("a", "hotel.adminGetRoomStateHistory", { hotelRoomId: room103 }, adA));
    expect(hist.map((e: any) => e.toStatus)).toEqual(["libre", "fuera_de_servicio"]);

    const plan = data(await ess.q("a", "hotel.adminGetPlanning", { from: d(0), to: d(6) }, adA));
    expect(plan.rooms.map((r: any) => r.code)).toEqual(["101", "102", "103"]);
    expect(plan.assignments).toHaveLength(3);
    expect(plan.unassigned).toEqual([]);
  });

  it("dos asignaciones simultáneas de la misma habitación en noches solapadas: solo una gana", async () => {
    const single = await createType("individual", 1);
    const room = data(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: single, code: "201" }, adA)).id;
    const a = data(await reserve({ roomTypeId: single, checkIn: d(10), checkOut: d(13) })).id;
    const b = data(await reserve({ roomTypeId: single, checkIn: d(11), checkOut: d(12), force: true })).id;
    const res = await Promise.all([a, b].map((reservationId) => ess.m("a", "hotel.adminAssignRoom", { reservationId, hotelRoomId: room }, adA)));
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hotel_room_assignments WHERE hotel_room_id = ?", [room]))[0].n).toBe(1);
  });

  it("recepción: transiciones válidas e inválidas y estado de la habitación", async () => {
    const list = data(await ess.q("a", "hotel.adminListReservations", { range: { from: d(0), to: d(0) } }, adA));
    const onRoom = (code: string) => list.find((r: any) => r.assignment?.roomCode === code);
    const r1 = onRoom("101");
    const r2 = onRoom("102");
    expect(r1 && r2).toBeTruthy();

    // No hay check-out sin check-in
    expect(errCode(await ess.m("a", "hotel.adminCheckOut", { reservationId: r1.id }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "hotel.adminCheckIn", { reservationId: r1.id }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "hotel.adminCheckIn", { reservationId: r1.id }, adA))).toBe("BAD_REQUEST");
    let rooms = data(await ess.q("a", "hotel.adminGetRooms", undefined, adA));
    expect(rooms.find((r: any) => r.code === "101").operationalStatus).toBe("ocupada");

    const dash = data(await ess.q("a", "hotel.adminGetReceptionDashboard", undefined, adA));
    expect(dash.today).toBe(today);
    expect(dash.inHouse.map((r: any) => r.id)).toContain(r1.id);
    expect(dash.arrivals.map((r: any) => r.id)).toContain(r2.id);
    expect(dash.arrivals.map((r: any) => r.id)).not.toContain(r1.id);

    expect((await ess.m("a", "hotel.adminCheckOut", { reservationId: r1.id }, adA)).status).toBe(200);
    rooms = data(await ess.q("a", "hotel.adminGetRooms", undefined, adA));
    expect(rooms.find((r: any) => r.code === "101").operationalStatus).toBe("sucia");
    const [fin] = await ess.sql("a", "SELECT status_reservation, JSON_LENGTH(changes_log) AS n FROM reservations WHERE id = ?", [r1.id]);
    expect(fin).toMatchObject({ status_reservation: "FINALIZADA", n: 2 });
    // Salida anticipada (el mismo día de llegada): la asignación se acorta hasta hoy y la habitación queda libre el resto
    const [asg] = await ess.sql("a", "SELECT check_out FROM hotel_room_assignments WHERE reservation_id = ?", [r1.id]);
    expect(asg.check_out).toBe(d(0));

    // No-show: libera la habitación; después ni check-in ni otro no-show
    expect((await ess.m("a", "hotel.adminMarkNoShow", { reservationId: r2.id }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "hotel.adminCheckIn", { reservationId: r2.id }, adA))).toBe("BAD_REQUEST");
    rooms = data(await ess.q("a", "hotel.adminGetRooms", undefined, adA));
    expect(rooms.find((r: any) => r.code === "102").operationalStatus).toBe("libre");

    // Reserva cancelada: sin check-in. Reserva futura: tampoco antes de la llegada
    const cancelled = data(await reserve({ roomTypeId: typeId, checkIn: d(20), checkOut: d(21) })).id;
    const future = data(await reserve({ roomTypeId: typeId, checkIn: d(30), checkOut: d(31) })).id;
    await ess.sql("a", "UPDATE reservations SET status = 'cancelled' WHERE id = ?", [cancelled]);
    expect(errCode(await ess.m("a", "hotel.adminCheckIn", { reservationId: cancelled }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "hotel.adminCheckIn", { reservationId: future }, adA))).toBe("BAD_REQUEST");
    // La empresa B no opera reservas de A
    expect(errCode(await ess.m("b", "hotel.adminCheckIn", { reservationId: future }, adB))).toBe("NOT_FOUND");
  });

  it("restricciones de estancia en el buscador público y en el alta de recepción", async () => {
    const arrival = d(40);
    const set = await ess.m("a", "hotel.adminSetStayRestrictions", {
      roomTypeId: typeId, range: { from: arrival, to: arrival }, minStay: 3, maxStay: null, closedToArrival: false, closedToDeparture: false,
    }, adA);
    expect(set.status).toBe(200);
    expect(errCode(await ess.m("a", "hotel.adminSetStayRestrictions", {
      roomTypeId: typeId, range: { from: arrival, to: arrival }, minStay: 5, maxStay: 2, closedToArrival: false, closedToDeparture: false,
    }, adA))).toBe("BAD_REQUEST");
    // Tabla propia: el inventario por día (room_blocks) no se toca
    const [rst] = await ess.sql("a", "SELECT min_stay, max_stay FROM hotel_stay_restrictions WHERE room_type_id = ? AND date = ?", [typeId, arrival]);
    expect(rst).toMatchObject({ min_stay: 3, max_stay: null });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM room_blocks WHERE roomTypeId = ?", [typeId]))[0].n).toBe(0);

    const two = data(await ess.q("a", "hotel.searchAvailability", { checkIn: arrival, checkOut: addDaysIso(arrival, 2), adults: 2, children: 0 }));
    expect(two.find((t: any) => t.id === typeId)).toMatchObject({ isAvailable: false, availableUnits: 2 });
    expect(two.find((t: any) => t.id === typeId).restriction).toMatch(/mínima/);
    const three = data(await ess.q("a", "hotel.searchAvailability", { checkIn: arrival, checkOut: addDaysIso(arrival, 3), adults: 2, children: 0 }));
    expect(three.find((t: any) => t.id === typeId)).toMatchObject({ isAvailable: true, restriction: null });

    expect(errCode(await reserve({ roomTypeId: typeId, checkIn: arrival, checkOut: addDaysIso(arrival, 2) }))).toBe("BAD_REQUEST");
    expect((await reserve({ roomTypeId: typeId, checkIn: arrival, checkOut: addDaysIso(arrival, 2), force: true })).status).toBe(200);
    const listed = data(await ess.q("a", "hotel.adminGetStayRestrictions", { range: { from: arrival, to: arrival } }, adA));
    expect(listed).toEqual([expect.objectContaining({ roomTypeId: typeId, date: arrival, minStay: 3 })]);
    // Todo vacío quita la restricción
    await ess.m("a", "hotel.adminSetStayRestrictions", { roomTypeId: typeId, range: { from: arrival, to: arrival }, minStay: null, maxStay: null, closedToArrival: false, closedToDeparture: false }, adA);
    expect(data(await ess.q("a", "hotel.adminGetStayRestrictions", { range: { from: arrival, to: arrival } }, adA))).toEqual([]);
  });
});
