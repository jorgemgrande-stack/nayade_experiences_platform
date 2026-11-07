/**
 * Hotel Net · fichas de huésped y planes de tarifa con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0043).
 *  - Planes por tipología en el buscador público (el precio base no cambia) y en el alta de recepción.
 *  - Fichas de huésped: titular vinculado al cliente del CRM sin duplicarlo, acompañantes, registro incompleto,
 *    historial de estancias por documento y búsqueda; solo para quien gestiona el hotel.
 *  - Conservación desactivada por defecto (no toca nada) y anonimización al configurarla; aislamiento entre empresas.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Hotel Net · huéspedes y planes de tarifa (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let typeId = 0;
  let otherType = 0;
  let nr = 0;
  let r1 = 0;
  let guestId = 0;
  const d = (n: number) => addDaysIso(todayInTimeZone(), n);
  const adult = {
    firstName: "Ana", lastName: "Prueba", sex: "M", birthDate: "1990-05-10", nationality: "España", docType: "DNI", docNumber: "12345678Z",
    docSupportNumber: "ABC123456", address: "Calle Ejemplo 1", country: "España", email: "titular@cliente-a.example",
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "hotelguests");
    for (const co of ["a", "b"] as const) {
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      await ess.grantModule(co, "hotel");
      await ess.setCapability(co, "hotel-net", "active");
    }
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    typeId = data(await ess.m("a", "hotel.adminCreateRoomType", { slug: "doble", name: "Doble", basePrice: "100", totalUnits: 3, maxAdults: 2 }, adA)).id;
    otherType = data(await ess.m("a", "hotel.adminCreateRoomType", { slug: "suite", name: "Suite", basePrice: "200", totalUnits: 1, maxAdults: 2 }, adA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("planes de tarifa por tipología en el buscador y en la reserva de recepción", async () => {
    nr = data(await ess.m("a", "hotel.adminSaveRatePlan", { roomTypeId: typeId, name: "No reembolsable", code: "NR", refundable: false, includesBreakfast: false, adjustType: "percent", adjustValue: -1000 }, adA)).id;
    await ess.m("a", "hotel.adminSaveRatePlan", { roomTypeId: typeId, name: "Con desayuno", refundable: true, includesBreakfast: true, adjustType: "fixed", adjustValue: 1200 }, adA);
    expect(errCode(await ess.m("a", "hotel.adminSaveRatePlan", { roomTypeId: typeId, name: "Raro", refundable: true, includesBreakfast: false, adjustType: "percent", adjustValue: -9500 }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "hotel.adminSaveRatePlan", { roomTypeId: typeId, name: "No", refundable: true, includesBreakfast: false, adjustType: "none", adjustValue: 0 }, agA))).toBe("FORBIDDEN");

    const search = data(await ess.q("a", "hotel.searchAvailability", { checkIn: d(30), checkOut: d(32), adults: 2, children: 0 }));
    const doble = search.find((t: any) => t.id === typeId);
    expect(doble.totalPrice).toBe(200);
    expect(doble.ratePlans.map((p: any) => [p.name, p.totalPrice, p.refundable, p.includesBreakfast])).toEqual([
      ["No reembolsable", 180, false, false],
      ["Con desayuno", 224, true, true],
    ]);
    // Sin planes, nada cambia
    expect(search.find((t: any) => t.id === otherType)).toMatchObject({ totalPrice: 400, ratePlans: [] });

    const res = data(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: d(0), checkOut: d(2), adults: 2, customerName: "Ana Prueba", customerEmail: "titular@cliente-a.example", ratePlanId: nr }, adA));
    r1 = res.id;
    expect(res.amountCents).toBe(18000);
    const [row] = await ess.sql("a", "SELECT extras_json FROM reservations WHERE id = ?", [r1]);
    expect(JSON.parse(row.extras_json).ratePlan).toMatchObject({ id: nr, name: "No reembolsable", refundable: false });
    expect(errCode(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: otherType, checkIn: d(0), checkOut: d(1), adults: 2, customerName: "Otro Cliente", ratePlanId: nr }, adA))).toBe("BAD_REQUEST");
  });

  it("fichas de huésped: titular vinculado al cliente del CRM, acompañantes y registro de viajeros", async () => {
    await ess.sql("a", "INSERT INTO clients (source, name, email, createdAt, updatedAt) VALUES ('manual', 'Ana Prueba', 'titular@cliente-a.example', NOW(), NOW())");
    const [client] = await ess.sql("a", "SELECT id FROM clients WHERE email = 'titular@cliente-a.example'");
    const clientsBefore = (await ess.sql("a", "SELECT COUNT(*) AS n FROM clients"))[0].n;

    const lead = data(await ess.m("a", "hotel.adminSaveStayGuest", { reservationId: r1, isLead: true, guest: adult }, adA));
    guestId = lead.guestId;
    expect(lead.missing).toEqual([]);
    const kid = data(await ess.m("a", "hotel.adminSaveStayGuest", { reservationId: r1, isLead: false, guest: { firstName: "Leo", lastName: "Prueba", sex: "H", birthDate: "2020-01-01", nationality: "España" } }, adA));
    expect(kid.missing).toEqual(["Falta el parentesco del menor con el adulto que lo acompaña."]);
    await ess.m("a", "hotel.adminSaveStayGuest", { reservationId: r1, guestId: kid.guestId, isLead: false, kinship: "Hijo", guest: { firstName: "Leo", lastName: "Prueba", sex: "H", birthDate: "2020-01-01", nationality: "España" } }, adA);

    const list = data(await ess.q("a", "hotel.adminGetStayGuests", { reservationId: r1 }, adA));
    expect(list.map((g: any) => [g.displayName, g.isLead, g.kinship, g.missing.length])).toEqual([["Ana Prueba", true, null, 0], ["Leo Prueba", false, "Hijo", 0]]);
    expect(list[0].clientId).toBe(Number(client.id));
    // No se crean clientes desde la ficha
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients"))[0].n).toBe(clientsBefore);

    // El mismo documento en otra estancia es la misma ficha: historial de dos estancias
    const r2 = data(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: d(10), checkOut: d(12), adults: 1, customerName: "Ana Prueba" }, adA)).id;
    const again = data(await ess.m("a", "hotel.adminSaveStayGuest", { reservationId: r2, isLead: true, guest: { ...adult, docNumber: "12345678-z" } }, adA));
    expect(again.guestId).toBe(guestId);
    const detail = data(await ess.q("a", "hotel.adminGetGuest", { id: guestId }, adA));
    expect(detail.stays.map((s: any) => s.reservationId)).toEqual([r2, r1]);
    expect(detail.guest.lastStayAt).toBe(d(12));

    expect(data(await ess.q("a", "hotel.adminSearchGuests", { q: "12345678" }, adA)).map((g: any) => g.id)).toEqual([guestId]);
    expect(data(await ess.q("a", "hotel.adminSearchGuests", { q: "Leo" }, adA))).toHaveLength(1);
    // Datos personales: solo quien gestiona el hotel; la otra empresa no ve nada
    expect(errCode(await ess.q("a", "hotel.adminSearchGuests", { q: "" }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "hotel.adminGetStayGuests", { reservationId: r1 }, agA))).toBe("FORBIDDEN");
    expect(data(await ess.q("b", "hotel.adminSearchGuests", { q: "" }, adB))).toEqual([]);
  });

  it("conservación: desactivada por defecto no toca nada; configurada, anonimiza las fichas vencidas", async () => {
    expect(data(await ess.q("a", "hotel.adminGetGuestSettings", undefined, adA))).toEqual({ retentionMonths: null });
    expect(data(await ess.m("a", "hotel.adminRunGuestRetention", undefined, adA))).toEqual({ cutoff: null, anonymized: 0 });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hotel_guests WHERE anonymized_at IS NULL"))[0].n).toBe(2);

    expect(errCode(await ess.m("a", "hotel.adminSetGuestSettings", { retentionMonths: 6 }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "hotel.adminSetGuestSettings", { retentionMonths: 24 }, adA)).status).toBe(200);
    // La ficha del menor tuvo su última estancia hace tres años
    await ess.sql("a", "UPDATE hotel_guests SET last_stay_at = ? WHERE id <> ?", [addDaysIso(todayInTimeZone(), -1100), guestId]);
    const run = data(await ess.m("a", "hotel.adminRunGuestRetention", undefined, adA));
    expect(run.anonymized).toBe(1);
    const rowsLeft = await ess.sql("a", "SELECT id, first_name, birth_date, anonymized_at FROM hotel_guests ORDER BY id");
    expect(rowsLeft.find((g: any) => g.id === guestId)).toMatchObject({ first_name: "Ana" });
    expect(rowsLeft.find((g: any) => g.id !== guestId)).toMatchObject({ first_name: null, birth_date: null });
    // La estancia se conserva (sin datos personales)
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hotel_stay_guests"))[0].n).toBe(3);
  });
});
