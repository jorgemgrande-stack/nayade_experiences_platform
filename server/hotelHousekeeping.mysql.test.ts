/**
 * Hotel Net · housekeeping con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluidas la 0032 y la 0038).
 *  - Generar las tareas del día según salidas, huéspedes que siguen y habitaciones sucias (sin repetir).
 *  - Asignar a usuarios del panel; la persona asignada avanza su tarea y la habitación cambia de estado con su historial;
 *    solo quien gestiona inspecciona; nadie toca tareas ajenas; sin rol de equipo no hay acceso.
 *  - Incidencias con tipos configurables que bloquean y desbloquean la habitación; aislamiento entre empresas.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Hotel Net · housekeeping (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let usA: string;
  let adB: string;
  const d = (n: number) => addDaysIso(todayInTimeZone(), n);
  const day = d(1);
  const rooms: Record<string, number> = {};
  const task = async (code: string) => data(await ess.q("a", "hotel.adminHkTasks", { date: day }, adA)).find((t: any) => t.roomCode === code);
  const roomStatus = async (code: string) => data(await ess.q("a", "hotel.adminGetRooms", undefined, adA)).find((r: any) => r.code === code).operationalStatus;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "hotelhk");
    for (const co of ["a", "b"] as const) {
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      await ess.grantModule(co, "hotel");
      await ess.setCapability(co, "hotel-net", "active");
    }
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    usA = await ess.login("a", "user");
    adB = await ess.login("b", "admin");
    const typeId = data(await ess.m("a", "hotel.adminCreateRoomType", { slug: "doble", name: "Doble", basePrice: "100", totalUnits: 4, maxAdults: 2 }, adA)).id;
    for (const code of ["101", "102", "103", "104"]) rooms[code] = data(await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code }, adA)).id;
    const reserve = async (checkIn: string, checkOut: string, hotelRoomId: number) =>
      ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn, checkOut, adults: 2, customerName: "Huésped HK", customerEmail: "hk@cliente-a.example", hotelRoomId }, adA);
    expect((await reserve(d(-1), d(1), rooms["101"])).status).toBe(200); // sale el día de la tarea
    expect((await reserve(d(0), d(2), rooms["102"])).status).toBe(200); // sigue alojado
    await ess.m("a", "hotel.adminSetRoomState", { hotelRoomId: rooms["103"], toStatus: "sucia" }, adA);
    await ess.m("a", "hotel.adminSetRoomState", { hotelRoomId: rooms["104"], toStatus: "fuera_de_servicio" }, adA);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("genera las tareas del día según la ocupación y el estado, sin repetir", async () => {
    expect(data(await ess.m("a", "hotel.adminHkGenerateTasks", { date: day }, adA))).toMatchObject({ created: 3 });
    expect(data(await ess.m("a", "hotel.adminHkGenerateTasks", { date: day }, adA))).toMatchObject({ created: 0 });
    const list = data(await ess.q("a", "hotel.adminHkTasks", { date: day }, adA));
    expect(list.map((t: any) => [t.roomCode, t.kind, t.status])).toEqual([["101", "salida", "pendiente"], ["102", "repaso", "pendiente"], ["103", "limpieza", "pendiente"]]);
    // La otra empresa no ve nada
    expect(data(await ess.q("b", "hotel.adminHkTasks", { date: day }, adB))).toEqual([]);
  });

  it("asignación a usuarios del panel y recorrido de la persona; inspección solo de quien gestiona", async () => {
    const agentId = await ess.userId("a", "agente");
    const userId = await ess.userId("a", "user");
    const assignees = data(await ess.q("a", "hotel.adminHkAssignees", undefined, adA)).map((u: any) => u.id);
    expect(assignees).toContain(agentId);
    expect(assignees).not.toContain(userId);
    const t101 = await task("101");
    const t102 = await task("102");
    expect(errCode(await ess.m("a", "hotel.adminHkAssignTask", { taskId: t101.id, assignedUserId: userId }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "hotel.adminHkAssignTask", { taskId: t101.id, assignedUserId: agentId }, adA)).status).toBe(200);

    // La persona: solo sus tareas, sin gestión
    const mine = data(await ess.q("a", "hotel.hkMyTasks", { date: day }, agA));
    expect(mine.canManage).toBe(false);
    expect(mine.tasks.map((t: any) => t.roomCode)).toEqual(["101"]);
    expect(errCode(await ess.q("a", "hotel.adminHkTasks", { date: day }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "hotel.hkMyTasks", { date: day }, usA))).toBe("FORBIDDEN");

    expect((await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t101.id, to: "en_curso" }, agA)).status).toBe(200);
    expect(await roomStatus("101")).toBe("limpieza_en_curso");
    expect(errCode(await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t102.id, to: "en_curso" }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t101.id, to: "inspeccionada" }, agA))).toBe("FORBIDDEN");
    expect((await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t101.id, to: "hecha", notes: "Toallas repuestas" }, agA)).status).toBe(200);
    expect(await roomStatus("101")).toBe("libre");
    expect((await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t101.id, to: "inspeccionada" }, adA)).status).toBe(200);
    expect(await roomStatus("101")).toBe("revisada");
    expect(errCode(await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t101.id, to: "hecha" }, adA))).toBe("BAD_REQUEST");
    expect(await task("101")).toMatchObject({ status: "inspeccionada", notes: "Toallas repuestas", assignedUserId: agentId });
    const hist = data(await ess.q("a", "hotel.adminGetRoomStateHistory", { hotelRoomId: rooms["101"] }, adA)).map((e: any) => e.toStatus);
    expect(hist.slice(0, 3)).toEqual(["revisada", "libre", "limpieza_en_curso"]);

    // El repaso de una habitación ocupada no cambia su estado
    const before = await roomStatus("102");
    expect((await ess.m("a", "hotel.hkSetTaskStatus", { taskId: t102.id, to: "hecha" }, adA)).status).toBe(200);
    expect(await roomStatus("102")).toBe(before);
  });

  it("incidencias con tipos configurables que bloquean y desbloquean la habitación", async () => {
    const types = data(await ess.q("a", "hotel.adminHkIncidentTypes", undefined, adA));
    expect(types.map((t: any) => t.name)).toEqual(["Iluminación", "Televisión", "Climatización", "Fontanería", "Limpieza especial", "Otro"]);
    expect((await ess.m("a", "hotel.adminHkSaveIncidentType", { name: "Caja fuerte" }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "hotel.adminHkSaveIncidentType", { name: "Caja fuerte" }, adA))).toBe("CONFLICT");
    const fontaneria = types.find((t: any) => t.name === "Fontanería").id;
    await ess.m("a", "hotel.adminHkSaveIncidentType", { id: types.find((t: any) => t.name === "Televisión").id, name: "Televisión", isActive: false }, adA);
    expect(data(await ess.q("a", "hotel.hkIncidentTypes", undefined, agA)).map((t: any) => t.name)).not.toContain("Televisión");

    expect((await ess.m("a", "hotel.hkReportIncident", { hotelRoomId: rooms["103"], typeId: fontaneria, description: "Gotea el grifo", priority: "alta", blocksRoom: true }, agA)).status).toBe(200);
    expect(await roomStatus("103")).toBe("bloqueada_mantenimiento");
    const open = data(await ess.q("a", "hotel.adminHkIncidents", { status: "abiertas" }, adA));
    expect(open).toEqual([expect.objectContaining({ roomCode: "103", typeName: "Fontanería", priority: "alta", status: "abierta", blocksRoom: true })]);
    expect((await ess.m("a", "hotel.adminHkSetIncidentStatus", { id: open[0].id, status: "resuelta" }, adA)).status).toBe(200);
    expect(await roomStatus("103")).toBe("sucia");
    expect(errCode(await ess.m("a", "hotel.adminHkSetIncidentStatus", { id: open[0].id, status: "en_curso" }, adA))).toBe("BAD_REQUEST");
    // La otra empresa: sus propios tipos por defecto, sin incidencias de A
    expect(data(await ess.q("b", "hotel.adminHkIncidents", undefined, adB))).toEqual([]);
  });
});
