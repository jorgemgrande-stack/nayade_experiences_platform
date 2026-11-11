/**
 * Reserva pública de restaurante con la aplicación REAL sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): el servidor
 * aplica aforo, cierres y turnos aunque el formulario se salte (antes `restaurants.createBooking` insertaba sin
 * comprobar nada). Reservas simultáneas sobre las últimas plazas: solo entran las que caben. Sin depósito (ningún cobro).
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { weekdayOf } from "./restaurantBookingRules";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("restaurante · reserva pública con aforo, cierres y turnos en servidor", () => {
  let ess: EssentialApp;
  let rest = 0;
  let other = 0;
  let lunch = 0;
  let weekdaysOnly = 0;
  let foreign = 0;
  let seq = 0;
  // Fechas futuras fijas: martes 4 y 11 de junio de 2030, domingo 9 de junio de 2030
  const TUE = "2030-06-04";
  const TUE2 = "2030-06-11";
  const SUN = "2030-06-09";

  const book = (o: Partial<{ restaurantId: number; shiftId: number; date: string; time: string; guests: number }>) =>
    ess.m("a", "restaurants.createBooking", {
      restaurantId: rest, shiftId: lunch, date: TUE, time: "13:30", guests: 2,
      guestName: `Cliente ${++seq}`, guestEmail: `cliente${seq}@reservas.example`, ...o,
    });
  const occupied = async (shiftId: number, date: string) =>
    Number((await ess.sql("a", "SELECT COALESCE(SUM(guests), 0) AS g FROM restaurant_bookings WHERE shiftId = ? AND date = ? AND status IN ('confirmed', 'pending_payment')", [shiftId, date]))[0].g);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "restpub");
    await ess.grantModule("a", "restaurants");
    await ess.setCapability("a", "restaurant-net", "active");
    await ess.sql("a", "INSERT INTO restaurants (slug, name, depositPerGuest, maxGroupSize) VALUES ('casa', 'Casa', '0.00', 8), ('otra', 'Otra', '0.00', 8)");
    const rs = await ess.sql("a", "SELECT id, slug FROM restaurants");
    rest = rs.find((r) => r.slug === "casa").id;
    other = rs.find((r) => r.slug === "otra").id;
    const shift = async (restaurantId: number, name: string, days: number[], cap: number) => {
      await ess.sql("a", "INSERT INTO restaurant_shifts (restaurantId, name, startTime, endTime, maxCapacity, daysOfWeek, slotMinutes, isActive) VALUES (?, ?, '13:00', '16:00', ?, ?, 30, 1)",
        [restaurantId, name, cap, JSON.stringify(days)]);
      return (await ess.sql("a", "SELECT id FROM restaurant_shifts WHERE restaurantId = ? AND name = ?", [restaurantId, name]))[0].id as number;
    };
    lunch = await shift(rest, "Comida", [0, 1, 2, 3, 4, 5, 6], 6);
    weekdaysOnly = await shift(rest, "Comida laborables", [1, 2, 3, 4, 5], 10);
    foreign = await shift(other, "Comida otra", [0, 1, 2, 3, 4, 5, 6], 10);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("aforo: entra lo que cabe y se rechaza el exceso", async () => {
    expect(weekdayOf(TUE)).toBe(2);
    expect((await book({ guests: 4 })).status).toBe(200);
    const over = await book({ guests: 3 });
    expect(errCode(over)).toBe("BAD_REQUEST");
    expect(over.text).toContain("Solo quedan 2 plazas");
    expect((await book({ guests: 2 })).status).toBe(200);
    expect(errCode(await book({ guests: 1 }))).toBe("BAD_REQUEST");
    expect(await occupied(lunch, TUE)).toBe(6);
    // Grupo mayor que el máximo online
    expect(errCode(await book({ shiftId: weekdaysOnly, guests: 9 }))).toBe("BAD_REQUEST");
  });

  it("simultáneas sobre las últimas plazas: nunca se supera el aforo", async () => {
    const res = await Promise.all(Array.from({ length: 6 }, () => book({ date: TUE2, guests: 2 })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(3);
    expect(res.filter((r) => errCode(r) === "BAD_REQUEST")).toHaveLength(3);
    expect(await occupied(lunch, TUE2)).toBe(6);
  });

  it("cierres, turnos ajenos, día sin turno y hora fuera del turno se rechazan; la disponibilidad lo refleja", async () => {
    const d = "2030-06-05";
    await ess.sql("a", "INSERT INTO restaurant_closures (restaurantId, date, shiftId, reason) VALUES (?, ?, ?, 'Evento privado')", [rest, d, lunch]);
    expect(errCode(await book({ date: d }))).toBe("BAD_REQUEST");
    expect((await book({ date: d, shiftId: weekdaysOnly })).status).toBe(200);
    const closedDay = "2030-06-06";
    await ess.sql("a", "INSERT INTO restaurant_closures (restaurantId, date, shiftId, reason) VALUES (?, ?, NULL, 'Cerrado')", [rest, closedDay]);
    expect(errCode(await book({ date: closedDay, shiftId: weekdaysOnly }))).toBe("BAD_REQUEST");
    expect(data(await ess.q("a", "restaurants.getAvailability", { restaurantId: rest, date: closedDay }))).toEqual([]);

    expect(errCode(await book({ shiftId: foreign, date: "2030-06-07" }))).toBe("BAD_REQUEST");
    expect(errCode(await book({ shiftId: weekdaysOnly, date: SUN }))).toBe("BAD_REQUEST");
    const sunday = data(await ess.q("a", "restaurants.getAvailability", { restaurantId: rest, date: SUN })) as { shiftId: number }[];
    expect(sunday.map((s) => s.shiftId)).toEqual([lunch]);
    expect(errCode(await book({ date: "2030-06-07", time: "17:30" }))).toBe("BAD_REQUEST");
    expect(errCode(await book({ date: "2020-01-07" }))).toBe("BAD_REQUEST");
    await ess.sql("a", "UPDATE restaurant_shifts SET isActive = 0 WHERE id = ?", [weekdaysOnly]);
    expect(errCode(await book({ shiftId: weekdaysOnly, date: "2030-06-07" }))).toBe("BAD_REQUEST");
    // Ninguna de las rechazadas dejó fila
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM restaurant_bookings WHERE date IN ('2030-06-06', '2030-06-07', '2030-06-09', '2020-01-07')"))[0].n)).toBe(0);
  });
});
