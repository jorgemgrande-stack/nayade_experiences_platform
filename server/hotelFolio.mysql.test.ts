/**
 * Hotel Net · folio de estancia y cierre del día con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas nuevas desde la baseline y las migraciones de empresa (incluidas la 0032 y la 0034).
 *  - El alojamiento entra en el folio al hacer el check-in, noche a noche y con el IVA de alojamiento de la empresa.
 *  - Extras y pagos; no se cierra con saldo; el cierre emite UNA factura cobrada con la numeración de la empresa, aunque
 *    se pida dos veces a la vez, y deja la reserva pagada y enlazada.
 *  - IVA de alojamiento configurable; cierre del día e informes (ocupación, ADR, RevPAR); aislamiento entre empresas.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Hotel Net · folio y cierre del día (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  const today = todayInTimeZone();
  const d = (n: number) => addDaysIso(today, n);
  let typeId = 0;
  let r1 = 0;

  const reserve = async (input: Record<string, unknown>) =>
    data(await ess.m("a", "hotel.adminCreateReservation", { adults: 2, customerName: "Huésped Folio", customerEmail: "folio@cliente-a.example", ...input }, adA)).id as number;
  const folio = async (reservationId: number) => data(await ess.q("a", "hotel.adminGetFolio", { reservationId }, adA));

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "hotelfolio");
    for (const co of ["a", "b"] as const) {
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      await ess.grantModule(co, "hotel");
      await ess.setCapability(co, "hotel-net", "active");
    }
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    typeId = data(await ess.m("a", "hotel.adminCreateRoomType", { slug: "doble", name: "Doble", basePrice: "100", totalUnits: 2, maxAdults: 2 }, adA)).id;
    for (const code of ["101", "102"]) await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code }, adA);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("el alojamiento entra al hacer el check-in, noche a noche con el IVA del alojamiento", async () => {
    r1 = await reserve({ roomTypeId: typeId, checkIn: d(0), checkOut: d(2) });
    const before = await folio(r1);
    expect(before.items).toEqual([]);
    expect(before.closeBlocker).toMatch(/tras el check-in/);
    expect((await ess.m("a", "hotel.adminCheckIn", { reservationId: r1 }, adA)).status).toBe(200);
    const f = await folio(r1);
    expect(f.items.filter((i: any) => i.category === "alojamiento").map((i: any) => [i.nightDate, i.amountCents, i.taxRateBp, i.automatic])).toEqual([
      [d(0), 10000, 1000, true],
      [d(1), 10000, 1000, true],
    ]);
    // Repetir la lectura no duplica las noches
    expect((await folio(r1)).items).toHaveLength(2);
  });

  it("extras y pagos; sin saldo 0 no se cierra; dos cierres a la vez emiten una sola factura", async () => {
    expect((await ess.m("a", "hotel.adminAddFolioCharge", { reservationId: r1, category: "restaurante", description: "Cena", quantity: 2, unitPriceCents: 2500, taxRateBp: 1000 }, adA)).status).toBe(200);
    expect((await ess.m("a", "hotel.adminAddFolioCharge", { reservationId: r1, category: "minibar", description: "Minibar", quantity: 1, unitPriceCents: 450, taxRateBp: 2100 }, adA)).status).toBe(200);
    // No se cargan noches a mano ni se borran las automáticas
    expect(errCode(await ess.m("a", "hotel.adminAddFolioCharge", { reservationId: r1, category: "alojamiento", description: "Noche", quantity: 1, unitPriceCents: 100, taxRateBp: 1000 }, adA))).toBe("BAD_REQUEST");
    const night = (await folio(r1)).items.find((i: any) => i.category === "alojamiento");
    expect(errCode(await ess.m("a", "hotel.adminDeleteFolioItem", { reservationId: r1, itemId: night.id }, adA))).toBe("BAD_REQUEST");

    expect(errCode(await ess.m("a", "hotel.adminCloseFolio", { reservationId: r1 }, adA))).toBe("BAD_REQUEST");
    await ess.m("a", "hotel.adminAddFolioPayment", { reservationId: r1, method: "tarjeta", amountCents: 20000 }, adA);
    const f = await folio(r1);
    expect(f.totals).toEqual({ chargesCents: 25450, paymentsCents: 20000, balanceCents: 5450 });
    await ess.m("a", "hotel.adminAddFolioPayment", { reservationId: r1, method: "efectivo", amountCents: 5450 }, adA);
    expect((await folio(r1)).closeBlocker).toBeNull();

    const both = await Promise.all([1, 2].map(() => ess.m("a", "hotel.adminCloseFolio", { reservationId: r1, clientNif: "B00000000" }, adA)));
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    const done = data(both.find((r) => r.status === 200)!);
    expect(done.invoiceNumber).toBeTruthy();

    const inv = await ess.sql("a", "SELECT invoiceNumber, reservationId, total, status, paymentMethod, clientNif, taxBreakdown, itemsJson FROM invoices WHERE reservationId = ?", [r1]);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ invoiceNumber: done.invoiceNumber, total: "254.50", status: "cobrada", paymentMethod: "tarjeta_fisica", clientNif: "B00000000" });
    const breakdown = typeof inv[0].taxBreakdown === "string" ? JSON.parse(inv[0].taxBreakdown) : inv[0].taxBreakdown;
    expect(breakdown.map((b: any) => b.rate)).toEqual([21, 10]);
    const lines = typeof inv[0].itemsJson === "string" ? JSON.parse(inv[0].itemsJson) : inv[0].itemsJson;
    expect(lines[0].description).toMatch(/^Alojamiento · Doble · 2 noches/);

    const [res] = await ess.sql("a", "SELECT status, status_payment, amount_paid, invoiceNumber FROM reservations WHERE id = ?", [r1]);
    expect(res).toMatchObject({ status: "paid", status_payment: "PAGADO", amount_paid: 20000, invoiceNumber: done.invoiceNumber });
    // Cerrado: ya no se carga nada
    expect(errCode(await ess.m("a", "hotel.adminAddFolioCharge", { reservationId: r1, category: "extra", description: "Tarde", quantity: 1, unitPriceCents: 100, taxRateBp: 2100 }, adA))).toBe("BAD_REQUEST");
    expect((await folio(r1)).folio).toMatchObject({ status: "cerrado", invoiceNumber: done.invoiceNumber });
  });

  it("IVA del alojamiento configurable por empresa", async () => {
    expect(data(await ess.q("a", "hotel.adminGetPmsSettings", undefined, adA))).toEqual({ accommodationTaxBp: 1000 });
    expect(errCode(await ess.m("a", "hotel.adminSetPmsSettings", { accommodationTaxBp: 4000 }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "hotel.adminSetPmsSettings", { accommodationTaxBp: 1500 }, adA)).status).toBe(200);
    const r2 = await reserve({ roomTypeId: typeId, checkIn: d(0), checkOut: d(1) });
    await ess.m("a", "hotel.adminCheckIn", { reservationId: r2 }, adA);
    expect((await folio(r2)).items.map((i: any) => i.taxRateBp)).toEqual([1500]);
    // La otra empresa conserva su 10 % y no ve los folios de A
    expect(data(await ess.q("b", "hotel.adminGetPmsSettings", undefined, adB))).toEqual({ accommodationTaxBp: 1000 });
    expect(errCode(await ess.q("b", "hotel.adminGetFolio", { reservationId: r2 }, adB))).toBe("NOT_FOUND");
  });

  it("cierre del día e informes: ocupación, ingresos, ADR y RevPAR", async () => {
    const k = data(await ess.m("a", "hotel.adminRunNightAudit", { businessDate: d(0) }, adA));
    // Dos habitaciones físicas; esta noche ocupan r1 (100 €) y r2 (100 €)
    expect(k).toMatchObject({ arrivals: 2, inHouse: 2, roomsOccupied: 2, capacity: 2, occupancyBp: 10000, roomRevenueCents: 20000, adrCents: 10000, revparCents: 10000 });
    expect((await ess.m("a", "hotel.adminRunNightAudit", { businessDate: d(0) }, adA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hotel_night_audit"))[0].n).toBe(1);
    expect(errCode(await ess.m("a", "hotel.adminRunNightAudit", { businessDate: d(1) }, adA))).toBe("BAD_REQUEST");

    const rep = data(await ess.q("a", "hotel.adminGetReport", { from: d(0), to: d(1) }, adA));
    expect(rep.days.map((x: any) => [x.businessDate, x.roomsOccupied, x.roomRevenueCents])).toEqual([[d(0), 2, 20000], [d(1), 1, 10000]]);
    expect(rep.summary).toMatchObject({ roomNightsSold: 3, roomNightsAvailable: 4, occupancyBp: 7500, roomRevenueCents: 30000, adrCents: 10000, revparCents: 7500 });
    expect(rep.audits).toEqual([expect.objectContaining({ businessDate: d(0), source: "manual", occupancyBp: 10000 })]);
    // La otra empresa no tiene cierres
    expect(data(await ess.q("b", "hotel.adminGetReport", { from: d(0), to: d(0) }, adB)).audits).toEqual([]);
  });
});
