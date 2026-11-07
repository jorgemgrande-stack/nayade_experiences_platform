/**
 * Informes sectoriales de Elephant Net — cálculos puros: periodo en hora de Madrid, turnos, ventas y ticket medio,
 * platos y tiempos de cocina (Restaurant Net); ocupación, tratamientos y bonos (Care Net); sesiones, horas, rotación y
 * taller (Ski Net); estados, márgenes, comisiones y operaciones (Travel Net); y CSV seguro.
 */
import { describe, it, expect } from "vitest";
import { careReport, localDayStartMs, localParts, percentile, periodMs, restaurantReport, shiftOf, skiReport, toCsv, travelReport, csvEuros } from "./netReports/aggregate";

describe("periodo en hora de Madrid", () => {
  it("el día local empieza a las 23:00 o 22:00 UTC del día anterior (invierno y verano)", () => {
    expect(new Date(localDayStartMs("2026-01-15")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(new Date(localDayStartMs("2026-07-15")).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    const { fromMs, toMs } = periodMs("2026-03-01", "2026-03-31");
    expect(new Date(fromMs).toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(new Date(toMs).toISOString()).toBe("2026-03-31T22:00:00.000Z");
  });
  it("fecha y hora locales", () => {
    expect(localParts(Date.parse("2026-12-31T23:30:00Z"))).toEqual({ date: "2027-01-01", hour: 0 });
  });
  it("turnos", () => {
    expect([shiftOf(9), shiftOf(12), shiftOf(16), shiftOf(17), shiftOf(23)]).toEqual(["manana", "comida", "comida", "cena", "cena"]);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 90)).toBe(0);
  });
});

describe("Restaurant Net", () => {
  const at = (iso: string) => Date.parse(iso);
  const orders = [
    { id: 1, openedAt: at("2026-05-10T12:00:00Z"), totalCents: 6000, guests: 2, roomName: "Salón", waiterName: "Luis" }, // 14:00 local, comida
    { id: 2, openedAt: at("2026-05-10T19:00:00Z"), totalCents: 9000, guests: 3, roomName: "Terraza", waiterName: "Ana" }, // 21:00, cena
    { id: 3, openedAt: at("2026-05-11T19:30:00Z"), totalCents: 3000, guests: 1, roomName: null, waiterName: "Ana" },
  ];
  const items = [
    { orderId: 1, name: "Paella", quantity: 2, amountCents: 3600, station: "Cocina", firedAt: 0, readyAt: 10 * 60_000 },
    { orderId: 2, name: "Paella", quantity: 1, amountCents: 1800, station: "Cocina", firedAt: 0, readyAt: 30 * 60_000 },
    { orderId: 2, name: "Café", quantity: 3, amountCents: 450, station: "Barra", firedAt: 0, readyAt: 2 * 60_000 },
    { orderId: 3, name: "Ensalada", quantity: 1, amountCents: 900, station: "Cocina", firedAt: null, readyAt: null },
  ];
  const r = restaurantReport(orders, items, new Map([["Cocina", 15], ["Barra", 5]]));
  it("totales y ticket medio por comanda y comensal", () => {
    expect(r.totals).toEqual({ orders: 3, guests: 6, salesCents: 18000, avgTicketCents: 6000, avgPerGuestCents: 3000 });
  });
  it("por día, turno, sala y camarero", () => {
    expect(r.byDay.map((d) => [d.key, d.orders, d.salesCents])).toEqual([["2026-05-10", 2, 15000], ["2026-05-11", 1, 3000]]);
    expect(r.byShift.map((s) => [s.label, s.orders])).toEqual([["Cena", 2], ["Comida", 1]]);
    expect(r.byRoom.map((s) => [s.key, s.salesCents])).toEqual([["Terraza", 9000], ["Salón", 6000], ["Sin sala", 3000]]);
    expect(r.byWaiter.map((s) => [s.key, s.orders, s.avgTicketCents])).toEqual([["Ana", 2, 6000], ["Luis", 1, 6000]]);
  });
  it("platos más vendidos y tiempos de cocina con el % fuera de plazo", () => {
    expect(r.topDishes.map((d) => [d.name, d.quantity])).toEqual([["Paella", 3], ["Café", 3], ["Ensalada", 1]]);
    expect(r.kitchen).toEqual([
      { station: "Barra", items: 1, avgMinutes: 2, p90Minutes: 2, slaMinutes: 5, lateBp: 0 },
      { station: "Cocina", items: 2, avgMinutes: 20, p90Minutes: 30, slaMinutes: 15, lateBp: 5000 },
    ]);
  });
  it("sin comandas, todo a cero", () => {
    expect(restaurantReport([], [], new Map()).totals).toEqual({ orders: 0, guests: 0, salesCents: 0, avgTicketCents: 0, avgPerGuestCents: 0 });
  });
});

describe("Care Net", () => {
  const slot = (id: number, resourceId: number | null, bookedCount: number, opts: Partial<{ capacity: number; blocked: boolean; minutes: number }> = {}) => ({
    id, resourceId, resourceName: resourceId ? `Cabina ${resourceId}` : null, resourceType: resourceId ? "cabina" : null, treatmentId: 1, minutes: opts.minutes ?? 60,
    capacity: opts.capacity ?? 1, bookedCount, blocked: opts.blocked ?? false,
  });
  const r = careReport({
    slots: [slot(1, 1, 1), slot(2, 1, 0), slot(3, 1, 1, { blocked: true }), slot(4, 2, 1, { capacity: 2 })],
    appointments: [
      { slotId: 1, treatmentId: 1, treatmentName: "Masaje", amountCents: 5000, paid: true, people: 1 },
      { slotId: 4, treatmentId: 2, treatmentName: "Facial", amountCents: 4000, paid: false, people: 1 },
    ],
    purchases: [{ packName: "Bono 5", priceCents: 20000, purchasedAt: 1 }, { packName: "Bono 5", priceCents: 20000, purchasedAt: 2 }],
    consumptions: [{ consumedAt: 1 }, { consumedAt: 2 }, { consumedAt: 3 }],
    expired: [{ packName: "Bono 5", sessionsLeft: 2 }],
  });
  it("ocupación por recurso sin las franjas bloqueadas", () => {
    expect(r.occupancy.map((o) => [o.name, o.offeredMinutes, o.bookedMinutes, o.occupancyBp])).toEqual([["Cabina 1", 120, 60, 5000], ["Cabina 2", 120, 60, 5000]]);
    expect(r.totals.occupancyBp).toBe(5000);
  });
  it("citas e ingresos cobrados por tratamiento y bonos", () => {
    expect(r.byTreatment.map((t) => [t.name, t.appointments, t.revenueCents])).toEqual([["Facial", 1, 0], ["Masaje", 1, 5000]]);
    expect(r.totals).toMatchObject({ appointments: 2, appointmentRevenueCents: 5000, packRevenueCents: 40000, revenueCents: 45000 });
    expect(r.packs).toMatchObject({ sold: 2, consumedSessions: 3, expired: 1, expiredSessionsLeft: 2, byPack: [{ name: "Bono 5", sold: 2, revenueCents: 40000 }] });
  });
});

describe("Ski Net", () => {
  const s = (id: number, over: Partial<{ productName: string; level: string | null; minutes: number; instructorId: number | null; status: string; participants: number }>) => ({
    id, productName: "Colectiva", level: "iniciacion", minutes: 120, instructorId: 1, instructorName: "Marta", status: "assigned", participants: 4, ...over,
  });
  const r = skiReport({
    sessions: [s(1, {}), s(2, { status: "completed", participants: 3 }), s(3, { status: "cancelled" }), s(4, { productName: "Particular", level: null, minutes: 60, instructorId: null, status: "pending", participants: 1 })],
    deliveries: 2,
    lines: [{ assetType: "ski", unitId: 1 }, { assetType: "ski", unitId: 2 }, { assetType: "ski", unitId: 1 }, { assetType: "boots", unitId: 9 }],
    unitsByType: new Map([["ski", 2], ["boots", 4], ["helmet", 3]]),
    tickets: [{ status: "done", resolution: "available", openedAt: 0, closedAt: 2 * 86_400_000 }, { status: "open", resolution: null, openedAt: 0, closedAt: null }],
  });
  it("sesiones y alumnos por producto y nivel, sin canceladas", () => {
    expect(r.byProduct).toEqual([{ product: "Colectiva", level: "iniciacion", sessions: 2, participants: 7 }, { product: "Particular", level: "—", sessions: 1, participants: 1 }]);
    expect(r.totals).toMatchObject({ sessions: 3, participants: 8, cancelled: 1, instructorHours: 4, deliveries: 2, rentedUnits: 4 });
  });
  it("horas por profesor (asignadas o completadas)", () => {
    expect(r.byInstructor).toEqual([{ instructorId: 1, name: "Marta", sessions: 2, hours: 4, completed: 1 }]);
  });
  it("rotación del material y taller", () => {
    expect(r.rotation).toEqual([
      { assetType: "ski", units: 2, rentals: 3, rotation: 1.5 },
      { assetType: "boots", units: 4, rentals: 1, rotation: 0.25 },
      { assetType: "helmet", units: 3, rentals: 0, rotation: 0 },
    ]);
    expect(r.workshop).toEqual({ opened: 2, open: 1, closed: 1, avgDaysToClose: 2, byResolution: [{ resolution: "available", tickets: 1 }] });
  });
});

describe("Travel Net", () => {
  const sv = (over: Partial<{ fileStatus: string; supplierId: number | null; supplierName: string | null; month: string; netCents: number; sellingCents: number; pricingMode: string }>) => ({
    fileId: 1, fileStatus: "reservado", supplierId: 7, supplierName: "Hoteles", month: "2026-12", netCents: 10000, sellingCents: 13000, commissionBp: null, pricingMode: "neto", ...over,
  });
  const r = travelReport({
    files: [{ id: 1, status: "reservado", createdAt: 0 }, { id: 2, status: "borrador", createdAt: 0 }, { id: 3, status: "reservado", createdAt: 0 }],
    services: [
      sv({}),
      sv({ supplierId: 8, supplierName: "Aventura", netCents: 4500, sellingCents: 5000, pricingMode: "comision", month: "2027-01" }),
      sv({ supplierId: null, supplierName: null, netCents: 0, sellingCents: 2000, pricingMode: "manual" }),
      sv({ fileStatus: "presupuestado", sellingCents: 99999 }),
    ],
    operations: [{ status: "pending_submission", slaDeadlineAt: null }, { status: "submitted", slaDeadlineAt: 100 }, { status: "consolidated", slaDeadlineAt: 50 }],
    now: 1000,
  });
  it("solo cuenta la venta de expedientes reservados o cerrados", () => {
    expect(r.totals).toMatchObject({ files: 3, services: 3, sellingCents: 20000, netCents: 14500, marginCents: 5500, marginBp: 2750, commissionCents: 500 });
  });
  it("por estado, proveedor y mes", () => {
    expect(r.byStatus).toEqual([{ status: "reservado", files: 2 }, { status: "borrador", files: 1 }]);
    expect(r.bySupplier.map((s) => [s.name, s.sellingCents, s.marginCents, s.commissionCents])).toEqual([["Hoteles", 13000, 3000, 0], ["Aventura", 5000, 500, 500], ["Inventario propio", 2000, 2000, 0]]);
    expect(r.byMonth.map((m) => [m.month, m.sellingCents])).toEqual([["2026-12", 15000], ["2027-01", 5000]]);
  });
  it("operaciones pendientes y fuera de plazo", () => {
    expect(r.operations).toEqual({ pending: 2, overdue: 1, byStatus: [{ status: "pending_submission", operations: 1 }, { status: "submitted", operations: 1 }] });
  });
});

describe("CSV", () => {
  it("separador «;», comillas, sin fórmulas y euros con coma", () => {
    expect(toCsv([{ Plato: "=SUMA(A1)", "Ventas (€)": csvEuros(123456), Uds: 3 }])).toBe('"Plato";"Ventas (€)";"Uds"\r\n"\'=SUMA(A1)";"1234,56";"3"');
    expect(toCsv([])).toBe("");
  });
});
