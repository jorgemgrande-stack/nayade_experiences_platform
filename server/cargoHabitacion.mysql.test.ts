/**
 * Cargo a habitación desde Restaurant Net y Care Net al folio de Hotel Net con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): la empresa A tiene hotel, restaurante y SPA; la B, restaurante y SPA sin hotel. Huéspedes
 * en casa, cargo de una comanda (líneas con su IVA, comanda cerrada sin venta del TPV), doble cobro imposible (TPV y
 * folio, también a la vez), reversión desde el folio, cargo de una reserva de SPA y de un bono, bono con sesiones usadas
 * que no se puede anular, huésped sin check-in, sin licencia de hotel y cierre del folio con la factura. Ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Cargo a habitación: restaurante y SPA al folio del hotel (aplicación real)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  let guest = 0;
  let future = 0;
  let sessionId = 0;
  const t: Record<string, number> = {};
  const menu: Record<string, number> = {};
  let masaje = 0;
  let slot = 0;
  let ana = 0;
  const today = todayInTimeZone();

  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const rn = (proc: string, input: unknown, co: "a" | "b" = "a") => ess.m(co, `restaurantNet.${proc}`, input, co === "a" ? adA : adB);
  const folio = async () => ok(ess.q("a", "hotel.adminGetFolio", { reservationId: guest }, adA));
  const order = async (table: string, items: Array<[number, number]>) => {
    const id = (await ok(rn("openOrder", { tableId: t[table], guests: 2 }))).id;
    for (const [m, q] of items) await ok(rn("addItem", { orderId: id, menuItemId: m, quantity: q }));
    return id as number;
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "cargohab");
    for (const co of ["a", "b"] as const) {
      for (const mod of ["restaurants", "spa"]) await ess.grantModule(co, mod);
      for (const cap of ["restaurant-net", "care-net"]) await ess.setCapability(co, cap, "active");
    }
    await ess.sql("a", "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
    await ess.grantModule("a", "hotel");
    await ess.setCapability("a", "hotel-net", "active");
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    // Hotel: un huésped en casa (check-in hecho) y otra reserva futura
    const typeId = data(await ess.m("a", "hotel.adminCreateRoomType", { slug: "doble", name: "Doble", basePrice: "100", totalUnits: 2, maxAdults: 2 }, adA)).id;
    for (const code of ["101", "102"]) await ess.m("a", "hotel.adminCreateRoom", { roomTypeId: typeId, code }, adA);
    guest = data(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: today, checkOut: addDaysIso(today, 2), adults: 2, customerName: "Ana Huésped", customerEmail: "ana@clientes.example" }, adA)).id;
    future = data(await ess.m("a", "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: addDaysIso(today, 5), checkOut: addDaysIso(today, 6), adults: 1, customerName: "Futuro Huésped" }, adA)).id;
    expect((await ess.m("a", "hotel.adminCheckIn", { reservationId: guest }, adA)).status).toBe(200);
    // Restaurante con carta
    for (const co of ["a", "b"] as const) await ess.sql(co, "INSERT INTO restaurants (slug, name) VALUES ('casa', 'Casa')");
    const rest = (await ess.sql("a", "SELECT id FROM restaurants"))[0].id;
    const room = (await ok(rn("createRoom", { restaurantId: rest, name: "Salón" }))).id;
    for (const code of ["1", "2", "3"]) t[code] = (await ok(rn("createTable", { roomId: room, code }))).id;
    menu.croquetas = (await ok(rn("upsertMenuItem", { restaurantId: rest, name: "Croquetas", price: 9.5, taxRate: 10 }))).id;
    menu.vino = (await ok(rn("upsertMenuItem", { restaurantId: rest, name: "Vino", price: 3, taxRate: 21 }))).id;
    // SPA y cliente del CRM
    await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES ('Ana Huésped', 'ana@clientes.example', 'manual')");
    ana = (await ess.sql("a", "SELECT id FROM clients"))[0].id;
    await ess.sql("a", "INSERT INTO spa_treatments (slug, name, price, taxRate) VALUES ('masaje', 'Masaje', 45, 21)");
    masaje = (await ess.sql("a", "SELECT id FROM spa_treatments"))[0].id;
    await ess.sql("a", "INSERT INTO spa_slots (treatmentId, date, startTime, endTime, capacity) VALUES (?, ?, '10:00', '10:50', 3)", [masaje, addDaysIso(today, 1)]);
    slot = (await ess.sql("a", "SELECT id FROM spa_slots"))[0].id;
    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Caja" }, adA));
    sessionId = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 0 }, adA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("huéspedes en casa solo con Hotel Net; sin hotel la opción no existe", async () => {
    const a = await ok(ess.q("a", "restaurantNet.roomGuests", undefined, adA));
    expect(a.available).toBe(true);
    expect(a.guests.map((g: any) => [g.reservationId, g.guestName])).toEqual([[guest, "Ana Huésped"]]);
    expect(await ok(ess.q("b", "restaurantNet.roomGuests", undefined, adB))).toEqual({ available: false, guests: [] });
    expect(await ok(ess.q("b", "careNet.roomGuests", undefined, adB))).toEqual({ available: false, guests: [] });
  });

  let o1 = 0;
  it("comanda a la habitación: líneas con su IVA en el folio, comanda cerrada sin venta del TPV y mesa libre", async () => {
    o1 = await order("1", [[menu.croquetas, 2], [menu.vino, 1]]);
    const r = await ok(rn("chargeToRoom", { orderId: o1, hotelReservationId: guest }));
    expect(r.amountCents).toBe(2200);
    const f = await folio();
    const ext = f.items.filter((i: any) => i.external);
    expect(ext.map((i: any) => [i.category, i.description, i.quantity, i.amountCents, i.taxRateBp, i.automatic])).toEqual([
      ["restaurante", "Croquetas", 2, 1900, 1000, false],
      ["restaurante", "Vino", 1, 300, 2100, false],
    ]);
    const [o] = await ess.sql("a", "SELECT status, tpv_sale_id FROM hospo_orders WHERE id = ?", [o1]);
    expect(o).toEqual({ status: "room_charged", tpv_sale_id: null });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(0);
    const [c] = await ess.sql("a", "SELECT source_module, source_ref, status, amount_cents FROM hotel_folio_external_charges");
    expect(c).toEqual({ source_module: "restaurant", source_ref: `hospo_order:${o1}`, status: "charged", amount_cents: 2200 });
    // La mesa queda libre para otra comanda
    expect((await ok(ess.q("a", "restaurantNet.getFloor", { restaurantId: (await ess.sql("a", "SELECT id FROM restaurants"))[0].id }, adA))).openOrders.some((x: any) => x.id === o1)).toBe(false);
  });

  it("doble cobro imposible: una comanda cargada no va al TPV ni se carga otra vez; a la vez, solo gana uno", async () => {
    expect(errCode(await rn("checkout", { orderId: o1, sessionId, payments: [{ method: "card", amount: 22 }] }))).toBe("BAD_REQUEST");
    expect(errCode(await rn("chargeToRoom", { orderId: o1, hotelReservationId: guest }))).toBe("BAD_REQUEST");
    const o2 = await order("2", [[menu.croquetas, 1]]);
    const [a, b] = await Promise.all([
      rn("checkout", { orderId: o2, sessionId, payments: [{ method: "card", amount: 9.5 }] }),
      rn("chargeToRoom", { orderId: o2, hotelReservationId: guest }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const sales = Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales WHERE status_ts = 'paid' AND idempotencyKey = ?", [`rnet-order-${o2}`]))[0].n);
    const charges = Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM hotel_folio_external_charges WHERE source_ref = ? AND status = 'charged'", [`hospo_order:${o2}`]))[0].n);
    expect(sales + charges).toBe(1);
  });

  it("huésped sin check-in: no se carga", async () => {
    const o3 = await order("3", [[menu.vino, 1]]);
    expect(errCode(await rn("chargeToRoom", { orderId: o3, hotelReservationId: future }))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [o3]))[0].status).toBe("open");
    await ok(rn("releaseTable", { orderId: o3, reason: "Prueba sin cobrar" }));
  });

  it("reversión desde el folio: se anula el cargo entero y la comanda vuelve a pendiente de cobro", async () => {
    const item = (await folio()).items.find((i: any) => i.external && i.description === "Vino");
    expect((await ess.m("a", "hotel.adminDeleteFolioItem", { reservationId: guest, itemId: item.id }, adA)).status).toBe(200);
    expect((await folio()).items.filter((i: any) => i.description === "Croquetas" || i.description === "Vino").filter((i: any) => i.external && i.quantity === 2)).toEqual([]);
    const [c] = await ess.sql("a", "SELECT status FROM hotel_folio_external_charges WHERE source_ref = ?", [`hospo_order:${o1}`]);
    expect(c.status).toBe("reverted");
    const [o] = await ess.sql("a", "SELECT status, table_id FROM hospo_orders WHERE id = ?", [o1]);
    expect(o).toEqual({ status: "bill_requested", table_id: t["1"] });
    // Ahora sí se cobra en el TPV (y una sola vez)
    await ok(rn("checkout", { orderId: o1, sessionId, payments: [{ method: "cash", amount: 22 }] }));
    // Volver a cargarla tras cobrarla: rechazado
    expect(errCode(await rn("chargeToRoom", { orderId: o1, hotelReservationId: guest }))).toBe("BAD_REQUEST");
  });

  it("reversión con la mesa ocupada por otra comanda: queda pendiente de cobro sin mesa", async () => {
    const o4 = await order("3", [[menu.vino, 2]]);
    await ok(rn("chargeToRoom", { orderId: o4, hotelReservationId: guest }));
    const o5 = await order("3", [[menu.vino, 1]]);
    const item = (await folio()).items.find((i: any) => i.external && i.description === "Vino" && i.quantity === 2);
    await ok(ess.m("a", "hotel.adminDeleteFolioItem", { reservationId: guest, itemId: item.id }, adA));
    expect((await ess.sql("a", "SELECT status, table_id FROM hospo_orders WHERE id = ?", [o4]))[0]).toEqual({ status: "bill_requested", table_id: null });
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [o5]))[0].status).toBe("open");
  });

  it("reserva de SPA a la habitación: pagada sin TPV ni bono, IVA del tratamiento; se revierte a pendiente", async () => {
    const now = Date.now();
    await ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, status, customer_name, customer_email, merchant_order, created_at, updated_at, inventory_kind, inventory_ref_id, inventory_units, hold_status, hold_expires_at) VALUES (?, 'SPA: Masaje · 10:00', ?, 1, 4500, 'pending_payment', 'Ana Huésped', 'ana@clientes.example', 'SPA0000001', ?, ?, 'spa_slot', ?, 1, 'retenida', ?)", [masaje, addDaysIso(today, 1), now, now, slot, now + 3_600_000]);
    await ess.sql("a", "UPDATE spa_slots SET bookedCount = 1 WHERE id = ?", [slot]);
    const [spa] = await ess.sql("a", "SELECT id FROM reservations WHERE merchant_order = 'SPA0000001'");
    expect(errCode(await ess.m("b", "careNet.chargeReservationToRoom", { reservationId: spa.id, hotelReservationId: guest }, adB))).toBe("FORBIDDEN");
    const r = await ok(ess.m("a", "careNet.chargeReservationToRoom", { reservationId: spa.id, hotelReservationId: guest }, adA));
    expect(r.amountCents).toBe(4500);
    expect((await ess.sql("a", "SELECT status, hold_status FROM reservations WHERE id = ?", [spa.id]))[0]).toEqual({ status: "paid", hold_status: "confirmada" });
    const line = (await folio()).items.find((i: any) => i.external && i.category === "spa");
    expect([line.amountCents, line.taxRateBp]).toEqual([4500, 2100]);
    expect(errCode(await ess.m("a", "careNet.chargeReservationToRoom", { reservationId: spa.id, hotelReservationId: guest }, adA))).toBe("BAD_REQUEST");
    await ok(ess.m("a", "hotel.adminDeleteFolioItem", { reservationId: guest, itemId: line.id }, adA));
    expect((await ess.sql("a", "SELECT status FROM reservations WHERE id = ?", [spa.id]))[0].status).toBe("pending_payment");
  });

  it("bono a la habitación: activo sin venta del TPV; con sesiones usadas no se anula el cargo", async () => {
    const pack = (await ok(ess.m("a", "careNet.upsertPack", { name: "Bono 2 masajes", sessions: 2, validityDays: 30, price: 80 }, adA))).id;
    const s = await ok(ess.m("a", "careNet.sellPackToRoom", { packId: pack, clientId: ana, hotelReservationId: guest, requestKey: "habitacion-0001" }, adA));
    expect(s.purchase).toMatchObject({ state: "active", tpvSaleId: null, remaining: 2 });
    expect(errCode(await ess.m("a", "careNet.payPurchase", { purchaseId: s.purchase.id, sessionId, payments: [{ method: "card", amount: 80 }] }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "careNet.sellPackToRoom", { packId: pack, clientId: ana, hotelReservationId: guest, requestKey: "habitacion-0001" }, adA))).toBe("CONFLICT");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey = ?", [`care-pack-${s.purchase.id}`]))[0].n).toBe(0);
    const cita = await ok(ess.m("a", "careNet.counterAppointment", { clientId: ana, slotId: slot }, adA));
    const line = (await folio()).items.find((i: any) => i.external && /^Bono/.test(i.description));
    expect(errCode(await ess.m("a", "hotel.adminDeleteFolioItem", { reservationId: guest, itemId: line.id }, adA))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT status FROM hotel_folio_external_charges WHERE source_ref = ?", [`care_pack:${s.purchase.id}`]))[0].status).toBe("charged");
    await ok(ess.m("a", "careNet.revertConsumption", { consumptionId: cita.consumptionId, reason: "Anula la cita", cancelReservation: true }, adA));
    await ok(ess.m("a", "hotel.adminDeleteFolioItem", { reservationId: guest, itemId: line.id }, adA));
    expect((await ess.sql("a", "SELECT status, expires_at FROM care_pack_purchases WHERE id = ?", [s.purchase.id]))[0]).toEqual({ status: "pending", expires_at: null });
  });

  it("al cerrar el folio, la factura recoge los cargos de restaurante con su IVA", async () => {
    const o6 = await order("2", [[menu.croquetas, 1]]);
    await ok(rn("chargeToRoom", { orderId: o6, hotelReservationId: guest }));
    const f = await folio();
    await ok(ess.m("a", "hotel.adminAddFolioPayment", { reservationId: guest, method: "tarjeta", amountCents: f.totals.balanceCents }, adA));
    const closed = await ok(ess.m("a", "hotel.adminCloseFolio", { reservationId: guest }, adA));
    const [inv] = await ess.sql("a", "SELECT itemsJson, taxBreakdown FROM invoices WHERE invoiceNumber = ?", [closed.invoiceNumber]);
    const items = typeof inv.itemsJson === "string" ? JSON.parse(inv.itemsJson) : inv.itemsJson;
    expect(items.some((i: any) => /Croquetas/.test(i.description))).toBe(true);
    // Folio cerrado: ya no se carga ni se anula nada
    const o7 = await order("1", [[menu.vino, 1]]);
    expect(errCode(await rn("chargeToRoom", { orderId: o7, hotelReservationId: guest }))).toBe("BAD_REQUEST");
  });
});
