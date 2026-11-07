/**
 * Informes sectoriales de Elephant Net con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos
 * empresas nuevas desde la baseline y las migraciones de empresa, con datos ficticios insertados en la de A.
 *  - Cada informe exige la licencia de su producto y un rol de gestión; la otra empresa no ve nada de A.
 *  - Restaurant Net, Care Net, Ski Net y Travel Net: totales y desgloses del periodo, y exportación CSV.
 * Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const P = { from: "2026-05-01", to: "2026-05-31" };
const ms = (iso: string) => Date.parse(iso);

describe.skipIf(!URL_)("Informes sectoriales de Elephant Net (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let site = "";

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "netinformes");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    site = data(await ess.q("a", "sites.list", undefined, adA)).primarySiteId;
    const now = Date.now();
    const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);

    // Restaurant Net: dos comandas cobradas en mayo (una fuera del periodo) con platos y tiempos de cocina
    await sql("INSERT INTO restaurants (slug, name, isActive) VALUES ('casa', 'Casa', 1)");
    const [rest] = await sql("SELECT id FROM restaurants WHERE slug = 'casa'");
    await sql("INSERT INTO dining_rooms (restaurant_id, name, created_at, updated_at) VALUES (?, 'Terraza', ?, ?)", [rest.id, now, now]);
    const [room] = await sql("SELECT id FROM dining_rooms LIMIT 1");
    await sql("INSERT INTO dining_tables (room_id, restaurant_id, code, created_at, updated_at) VALUES (?, ?, 'T1', ?, ?)", [room.id, rest.id, now, now]);
    const [table] = await sql("SELECT id FROM dining_tables LIMIT 1");
    for (const [opened, total, guests, tableId] of [[ms("2026-05-10T12:00:00Z"), 60, 2, table.id], [ms("2026-05-10T19:00:00Z"), 90, 3, null], [ms("2026-06-02T19:00:00Z"), 500, 4, null]] as const) {
      await sql("INSERT INTO hospo_orders (restaurant_id, table_id, status, guests, subtotal, total, opened_at, closed_at) VALUES (?, ?, 'paid', ?, ?, ?, ?, ?)", [rest.id, tableId, guests, total, total, opened, opened + 3_600_000]);
    }
    await sql("INSERT INTO hospo_orders (restaurant_id, status, guests, total, opened_at) VALUES (?, 'open', 2, 40, ?)", [rest.id, ms("2026-05-11T12:00:00Z")]);
    const orders = await sql("SELECT id FROM hospo_orders ORDER BY id");
    await sql("INSERT INTO hospo_order_items (order_id, name, quantity, unit_price, station, status, fired_at, ready_at, created_at, updated_at) VALUES (?, 'Paella', 2, 18, 'Cocina', 'ready', 0, 600000, ?, ?), (?, 'Paella', 1, 18, 'Cocina', 'ready', 0, 1800000, ?, ?), (?, 'Agua', 1, 2, NULL, 'void', NULL, NULL, ?, ?)",
      [orders[0].id, now, now, orders[1].id, now, now, orders[1].id, now, now]);

    // Care Net: una cabina con dos franjas (una reservada y cobrada) y un bono vendido y consumido
    await sql("INSERT INTO spa_resources (type, name) VALUES ('cabina', 'Cabina 1')");
    const [cab] = await sql("SELECT id FROM spa_resources LIMIT 1");
    await sql("INSERT INTO spa_treatments (slug, name, price) VALUES ('masaje', 'Masaje', 50)");
    const [tr] = await sql("SELECT id FROM spa_treatments LIMIT 1");
    await sql("INSERT INTO spa_slots (treatmentId, resourceId, date, startTime, endTime, capacity, bookedCount, status) VALUES (?, ?, '2026-05-12', '10:00', '11:00', 1, 1, 'reservado'), (?, ?, '2026-05-12', '11:00', '12:00', 1, 0, 'disponible')", [tr.id, cab.id, tr.id, cab.id]);
    const [slot] = await sql("SELECT id FROM spa_slots WHERE bookedCount = 1");
    await sql("INSERT INTO reservations (product_id, product_name, booking_date, amount_total, customer_name, merchant_order, status, created_at, updated_at, inventory_kind, inventory_ref_id, inventory_units, hold_status) VALUES (?, 'Masaje', '2026-05-12', 5000, 'Cliente Spa', 'SPA0001', 'paid', ?, ?, 'spa_slot', ?, 1, 'confirmada')", [tr.id, now, now, slot.id]);
    await sql("INSERT INTO care_session_packs (name, sessions, validity_days, price, created_at, updated_at) VALUES ('Bono 5', 5, 180, 200, ?, ?)", [now, now]);
    const [pack] = await sql("SELECT id FROM care_session_packs LIMIT 1");
    await sql("INSERT INTO care_pack_purchases (pack_id, pack_name, client_id, client_name, sessions_total, sessions_used, price, validity_days, status, purchased_at, expires_at, created_at, updated_at) VALUES (?, 'Bono 5', 1, 'Cliente Spa', 5, 1, 200, 180, 'active', ?, ?, ?, ?)",
      [pack.id, ms("2026-05-05T10:00:00Z"), ms("2026-11-01T10:00:00Z"), now, now]);
    const [purchase] = await sql("SELECT id FROM care_pack_purchases LIMIT 1");
    await sql("INSERT INTO care_pack_consumptions (purchase_id, client_id, source, status, consumed_at) VALUES (?, 1, 'desk', 'consumed', ?)", [purchase.id, ms("2026-05-12T10:00:00Z")]);

    // Ski Net: una colectiva con dos alumnos y profesor; un alquiler de dos unidades y un parte de taller
    await sql("INSERT INTO ski_school_instructors (site_id, full_name, modalities, levels, languages, weekly_availability) VALUES (?, 'Marta Profe', '[]', '[]', '[]', '[]')", [site]);
    const [ins] = await sql("SELECT id FROM ski_school_instructors LIMIT 1");
    await sql("INSERT INTO ski_school_products (site_id, name, kind, duration_minutes, capacity, level) VALUES (?, 'Colectiva', 'group', 120, 8, 'iniciacion')", [site]);
    const [prod] = await sql("SELECT id FROM ski_school_products LIMIT 1");
    await sql("INSERT INTO ski_school_sessions (site_id, product_id, session_date, start_time, end_time, capacity, instructor_id, status) VALUES (?, ?, '2026-05-14', '10:00', '12:00', 8, ?, 'completed'), (?, ?, '2026-05-15', '10:00', '12:00', 8, NULL, 'cancelled')", [site, prod.id, ins.id, site, prod.id]);
    const [ses] = await sql("SELECT id FROM ski_school_sessions WHERE status = 'completed'");
    await sql("INSERT INTO ski_school_participants (site_id, session_id, full_name, status) VALUES (?, ?, 'Alumno Uno', 'enrolled'), (?, ?, 'Alumno Dos', 'enrolled'), (?, ?, 'Alumno Tres', 'cancelled')", [site, ses.id, site, ses.id, site, ses.id]);
    await sql("INSERT INTO ski_rental_stores (site_id, name, opening_time, closing_time, overdue_return_time) VALUES (?, 'Tienda', '08:00', '18:00', '18:30')", [site]);
    const [store] = await sql("SELECT id FROM ski_rental_stores LIMIT 1");
    await sql("INSERT INTO ski_rental_models (site_id, asset_type, name, size) VALUES (?, 'ski', 'Esquí', '160')", [site]);
    const [model] = await sql("SELECT id FROM ski_rental_models LIMIT 1");
    await sql("INSERT INTO ski_rental_units (site_id, model_id, store_id, code, status) VALUES (?, ?, ?, 'U1', 'available'), (?, ?, ?, 'U2', 'available'), (?, ?, ?, 'U3', 'available'), (?, ?, ?, 'U4', 'available')", [site, model.id, store.id, site, model.id, store.id, site, model.id, store.id, site, model.id, store.id]);
    const units = await sql("SELECT id FROM ski_rental_units ORDER BY id");
    await sql("INSERT INTO ski_rental_deliveries (site_id, store_id, customer_name, start_date, expected_return_date, status) VALUES (?, ?, 'Cliente Ski', '2026-05-14', '2026-05-15', 'returned')", [site, store.id]);
    const [del] = await sql("SELECT id FROM ski_rental_deliveries LIMIT 1");
    await sql("INSERT INTO ski_rental_delivery_lines (site_id, delivery_id, unit_id, requested_type, returned_at) VALUES (?, ?, ?, 'ski', NOW(3)), (?, ?, ?, 'ski', NOW(3))", [site, del.id, units[0].id, site, del.id, units[1].id]);
    await sql("INSERT INTO ski_rental_workshop_tickets (site_id, unit_id, reason, status, created_at) VALUES (?, ?, 'Canto dañado', 'open', '2026-05-16 10:00:00')", [site, units[2].id]);

    // Travel Net: un expediente reservado con dos servicios y una operación pendiente vencida
    await sql("INSERT INTO suppliers (fiscalName, commercialName) VALUES ('Hoteles Ejemplo SL', 'Hoteles')");
    const [sup] = await sql("SELECT id FROM suppliers LIMIT 1");
    await sql("INSERT INTO travel_files (title, status, client_name, start_date, created_at, updated_at) VALUES ('Viaje', 'reservado', 'Cliente Viaje', '2026-05-20', ?, ?), ('Otro', 'borrador', 'Otro Cliente', NULL, ?, ?)",
      [ms("2026-05-03T10:00:00Z"), now, ms("2026-05-04T10:00:00Z"), now]);
    const [file] = await sql("SELECT id FROM travel_files WHERE status = 'reservado'");
    await sql("INSERT INTO travel_file_services (file_id, kind, source, supplier_id, title, service_date, pricing_mode, net_cents, selling_cents, created_at, updated_at) VALUES (?, 'alojamiento', 'proveedor', ?, 'Hotel', '2026-05-20', 'neto', 30000, 39000, ?, ?), (?, 'actividad', 'proveedor', ?, 'Ruta', '2026-05-21', 'comision', 10800, 12000, ?, ?)",
      [file.id, sup.id, now, now, file.id, sup.id, now, now]);
    const svcs = await sql("SELECT id FROM travel_file_services ORDER BY id");
    await sql("INSERT INTO travel_operations (file_id, service_id, supplier_id, status, sla_deadline_at, created_at, updated_at) VALUES (?, ?, ?, 'submitted', 1000, ?, ?), (?, ?, ?, 'consolidated', NULL, ?, ?)",
      [file.id, svcs[0].id, sup.id, now, now, file.id, svcs[1].id, sup.id, now, now]);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la licencia de su producto no se llega a cada informe", async () => {
    expect(isLicenseDenied(await ess.q("a", "travelReports.report", P, adA), "travel-net")).toBe(true);
    // Care y Restaurant Net exigen además la licencia del módulo (SPA, restaurantes): responde antes ese guardián
    expect(errCode(await ess.q("a", "careReports.report", P, adA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "restaurantReports.report", P, adA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "skiReports.report", { ...P, siteId: site }, adA))).toBe("FORBIDDEN");
    for (const co of ["a", "b"] as const) {
      for (const cap of ["restaurant-net", "care-net", "ski-school", "ski-rental", "travel-net"]) await ess.setCapability(co, cap, "active");
      await ess.grantModule(co, "restaurants");
      await ess.grantModule(co, "spa");
    }
  });

  it("solo roles de gestión", async () => {
    expect(errCode(await ess.q("a", "restaurantReports.report", P, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "careReports.report", P, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "skiReports.report", { ...P, siteId: site }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "travelReports.report", P, agA))).toBe("FORBIDDEN");
  });

  it("Restaurant Net: ventas cobradas del periodo, ticket medio, platos y cocina; CSV", async () => {
    const r = data(await ess.q("a", "restaurantReports.report", P, adA));
    expect(r.totals).toEqual({ orders: 2, guests: 5, salesCents: 15000, avgTicketCents: 7500, avgPerGuestCents: 3000 });
    expect(r.byShift.map((s: any) => [s.label, s.orders])).toEqual([["Cena", 1], ["Comida", 1]]);
    expect(r.byRoom.map((s: any) => s.key)).toEqual(["Sin sala", "Terraza"]);
    expect(r.topDishes).toEqual([{ name: "Paella", quantity: 3, salesCents: 5400 }]);
    expect(r.kitchen).toEqual([expect.objectContaining({ station: "Cocina", items: 2, avgMinutes: 20, p90Minutes: 30 })]);
    const csv = data(await ess.q("a", "restaurantReports.csv", { ...P, section: "platos" }, adA));
    expect(csv.csv).toBe('"Plato";"Unidades";"Ventas (€)"\r\n"Paella";"3";"54,00"');
    expect(data(await ess.q("b", "restaurantReports.report", P, adB)).totals.orders).toBe(0);
  });

  it("Care Net: ocupación de la cabina, citas por tratamiento, ingresos y bonos", async () => {
    const r = data(await ess.q("a", "careReports.report", P, adA));
    expect(r.occupancy).toEqual([expect.objectContaining({ name: "Cabina 1", offeredMinutes: 120, bookedMinutes: 60, occupancyBp: 5000 })]);
    expect(r.byTreatment).toEqual([expect.objectContaining({ name: "Masaje", appointments: 1, revenueCents: 5000 })]);
    expect(r.totals).toMatchObject({ appointments: 1, revenueCents: 25000, packRevenueCents: 20000 });
    expect(r.packs).toMatchObject({ sold: 1, consumedSessions: 1, expired: 0 });
    expect(data(await ess.q("a", "careReports.csv", { ...P, section: "bonos" }, adA)).csv).toContain('"Bono 5";"1";"200,00"');
    expect(data(await ess.q("b", "careReports.report", P, adB)).totals.appointments).toBe(0);
  });

  it("Ski Net: sesiones, horas, rotación del material y taller de la sede", async () => {
    const r = data(await ess.q("a", "skiReports.report", { ...P, siteId: site }, adA));
    expect(r).toMatchObject({ school: true, rental: true });
    expect(r.totals).toMatchObject({ sessions: 1, participants: 2, cancelled: 1, instructorHours: 2, deliveries: 1, rentedUnits: 2 });
    expect(r.byInstructor).toEqual([expect.objectContaining({ name: "Marta Profe", hours: 2, completed: 1 })]);
    expect(r.rotation).toEqual([{ assetType: "ski", units: 4, rentals: 2, rotation: 0.5 }]);
    expect(r.workshop).toMatchObject({ opened: 1, open: 1, closed: 0 });
    expect(data(await ess.q("a", "skiReports.csv", { ...P, siteId: site, section: "profesores" }, adA)).csv).toContain('"Marta Profe";"1";"1";"2"');
  });

  it("Travel Net: expedientes, margen y comisiones por proveedor, operaciones pendientes", async () => {
    const r = data(await ess.q("a", "travelReports.report", P, adA));
    expect(r.totals).toMatchObject({ files: 2, sellingCents: 51000, netCents: 40800, marginCents: 10200, commissionCents: 1200 });
    expect(r.bySupplier).toEqual([expect.objectContaining({ name: "Hoteles", sellingCents: 51000 })]);
    expect(r.operations).toMatchObject({ pending: 1, overdue: 1 });
    expect(data(await ess.q("a", "travelReports.csv", { ...P, section: "proveedores" }, adA)).csv).toContain('"Hoteles";"2";"510,00";"408,00";"102,00"');
    expect(data(await ess.q("b", "travelReports.report", P, adB)).totals.files).toBe(0);
  });
});
