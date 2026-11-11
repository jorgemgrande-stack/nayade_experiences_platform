/**
 * Restaurant Net · sala, carta y comandas con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos
 * empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0033). Recorrido completo: salas y mesas,
 * carta, abrir comanda (rechazo en mesa ocupada), platos con IVA, anular línea con motivo, pedir la cuenta, cobro con el
 * TPV del Core (idempotente: dos llamadas, también simultáneas, son una sola venta), liberar mesa sin cobrar, unir y
 * separar mesas, sentar una reserva, permisos del adminrest, licencia y aislamiento entre empresas. Ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { madridToday } from "../shared/restaurantNet";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "restaurant-net";
const OP = { type: "operator" as const, id: "prueba-restaurant-net" };

describe.skipIf(!URL_)("Restaurant Net · sala y comandas (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  let restA = 0;
  let restA2 = 0;
  let roomId = 0;
  const t: Record<string, number> = {};
  const menu: Record<string, number> = {};
  let sessionId = 0;

  const m = (proc: string, input: unknown, cookie = adA) => ess.m("a", `restaurantNet.${proc}`, input, cookie);
  const q = (proc: string, input: unknown, cookie = adA) => ess.q("a", `restaurantNet.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const orderOf = async (tableId: number): Promise<number> => (await ok(m("openOrder", { tableId, guests: 2 }))).id;
  const floorState = async () => {
    const f = await ok(q("getFloor", { restaurantId: restA }));
    return f as { tables: Array<{ id: number; code: string; mergedInto: number | null }>; openOrders: Array<{ id: number; tableId: number; status: string; total: number }> };
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "restnet");
    // Licencia de módulo (restaurantes) y de capacidad: como una empresa que contrata Restaurant Net
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const ent = new EntitlementAdmin((ess.registry.store as any).q);
    for (const co of ["a", "b"] as const) await ent.grant(ess.ids[co], "restaurants", OP);
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    await ess.sql("a", "INSERT INTO restaurants (slug, name) VALUES ('casa-prueba', 'Casa Prueba'), ('terraza-prueba', 'Terraza Prueba')");
    const rs = await ess.sql("a", "SELECT id, slug FROM restaurants ORDER BY id");
    restA = rs.find((r) => r.slug === "casa-prueba").id;
    restA2 = rs.find((r) => r.slug === "terraza-prueba").id;
    await ess.sql("b", "INSERT INTO restaurants (slug, name) VALUES ('otra-casa', 'Otra Casa')");
    // Caja del TPV del Core abierta
    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Barra" }, adA));
    sessionId = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 0 }, adA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad restaurant-net no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("getFloor", { restaurantId: restA }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    expect((await q("getFloor", { restaurantId: restA })).status).toBe(200);
  });

  it("salas y mesas: alta, código único por restaurante y posición en rejilla", async () => {
    roomId = (await ok(m("createRoom", { restaurantId: restA, name: "Salón", kind: "salon" }))).id;
    for (const code of ["1", "2", "3", "4"]) t[code] = (await ok(m("createTable", { roomId, code, capacity: 4 }))).id;
    expect(errCode(await m("createTable", { roomId, code: "1" }))).toBe("CONFLICT");
    const tables = await ok(q("listTables", { restaurantId: restA }));
    expect(tables.map((x: any) => x.code)).toEqual(["1", "2", "3", "4"]);
    expect(new Set(tables.map((x: any) => `${x.posX},${x.posY}`)).size).toBe(4);
    expect((await ok(m("updateTable", { id: t["4"], posX: 500, posY: 300, shape: "round" }))).ok).toBe(true);
  });

  it("carta: precio, IVA y alérgenos válidos; archivar sin borrar", async () => {
    menu.croquetas = (await ok(m("upsertMenuItem", { restaurantId: restA, name: "Croquetas", category: "Entrantes", price: 9.5, taxRate: 10, allergens: ["lacteos", "gluten", "inventado"] }))).id;
    menu.vino = (await ok(m("upsertMenuItem", { restaurantId: restA, name: "Copa de vino", category: "Bebidas", price: 3, taxRate: 21, station: "barra" }))).id;
    menu.pan = (await ok(m("upsertMenuItem", { restaurantId: restA, name: "Pan", category: "Entrantes", price: 0, taxRate: 10 }))).id;
    menu.viejo = (await ok(m("upsertMenuItem", { restaurantId: restA, name: "Plato retirado", price: 5, taxRate: 10 }))).id;
    expect(errCode(await m("upsertMenuItem", { restaurantId: restA, name: "IVA raro", price: 5, taxRate: 7 }))).toBe("BAD_REQUEST");
    await ok(m("setMenuItemActive", { id: menu.viejo, active: false }));
    const carta = await ok(q("listMenu", { restaurantId: restA }));
    expect(carta.map((x: any) => x.name)).toEqual(["Croquetas", "Copa de vino", "Pan"]);
    expect(carta[0].allergens).toEqual(["gluten", "lacteos"]);
    expect((await ok(q("listMenu", { restaurantId: restA, includeArchived: true }))).length).toBe(4);
  });

  let o1 = 0;
  it("abrir comanda: una sola por mesa (rechazo en mesa ocupada)", async () => {
    o1 = await orderOf(t["1"]);
    const again = await m("openOrder", { tableId: t["1"], guests: 2 });
    expect(errCode(again)).toBe("CONFLICT");
    expect(again.json.error.json.message).toMatch(/ya tiene una comanda abierta/);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM hospo_orders WHERE table_id = ?", [t["1"]]))[0].n).toBe(1);
  });

  it("platos: suma unidades de la misma línea, totales con IVA incluido y desglose por tipo", async () => {
    await ok(m("addItem", { orderId: o1, menuItemId: menu.croquetas, quantity: 2 }));
    await ok(m("addItem", { orderId: o1, menuItemId: menu.vino, quantity: 1 }));
    await ok(m("addItem", { orderId: o1, menuItemId: menu.croquetas, quantity: 1 }));
    await ok(m("addItem", { orderId: o1, menuItemId: menu.pan, quantity: 2 }));
    expect(errCode(await m("addItem", { orderId: o1, menuItemId: menu.viejo, quantity: 1 }))).toBe("NOT_FOUND");
    const d = await ok(q("getOrder", { orderId: o1 }));
    expect(d.items.map((i: any) => [i.name, i.quantity])).toEqual([["Croquetas", 3], ["Copa de vino", 1], ["Pan", 2]]);
    expect(d.totals.total).toBe(31.5);
    expect(d.totals.taxBreakdown).toEqual([{ rate: 21, base: 2.48, amount: 0.52 }, { rate: 10, base: 25.91, amount: 2.59 }]);
    expect(d.order.total).toBe(31.5);
    expect(d.order.subtotal).toBe(28.39);
  });

  it("anular línea: exige motivo, queda tachada y deja de contar", async () => {
    const d = await ok(q("getOrder", { orderId: o1 }));
    const vino = d.items.find((i: any) => i.name === "Copa de vino");
    expect(errCode(await m("voidItem", { itemId: vino.id, reason: "x" }))).toBe("BAD_REQUEST");
    const r = await ok(m("voidItem", { itemId: vino.id, reason: "Error al marcar" }));
    expect(r.totals.total).toBe(28.5);
    expect(errCode(await m("setItemQty", { itemId: vino.id, quantity: 2 }))).toBe("BAD_REQUEST");
    const [row] = await ess.sql("a", "SELECT status, void_reason FROM hospo_order_items WHERE id = ?", [vino.id]);
    expect(row).toEqual({ status: "void", void_reason: "Error al marcar" });
  });

  it("pedir la cuenta: la mesa pasa a «pide la cuenta»; añadir otro plato la reabre", async () => {
    await ok(m("requestBill", { orderId: o1 }));
    let f = await floorState();
    expect(f.openOrders.find((o) => o.id === o1)!.status).toBe("bill_requested");
    await ok(m("addItem", { orderId: o1, menuItemId: menu.croquetas, quantity: 1 }));
    f = await floorState();
    expect(f.openOrders.find((o) => o.id === o1)!.status).toBe("open");
    const d = await ok(q("getOrder", { orderId: o1 }));
    await ok(m("setItemQty", { itemId: d.items.find((i: any) => i.name === "Croquetas").id, quantity: 3 }));
    await ok(m("requestBill", { orderId: o1 }));
  });

  it("cobro con el TPV del Core: idempotente (dos llamadas = una venta), IVA del plato y mesa libre", async () => {
    expect(errCode(await m("checkout", { orderId: o1, sessionId, payments: [{ method: "card", amount: 10 }] }))).toBe("BAD_REQUEST");
    const r1 = await ok(m("checkout", { orderId: o1, sessionId, payments: [{ method: "card", amount: 20 }, { method: "cash", amount: 8.5 }] }));
    const r2 = await ok(m("checkout", { orderId: o1, sessionId, payments: [{ method: "card", amount: 28.5 }] }));
    expect(r2.saleId).toBe(r1.saleId);
    expect(r2.replayed).toBe(true);
    const sales = await ess.sql("a", "SELECT id, total, taxAmount, status_ts AS status FROM tpv_sales WHERE idempotencyKey = ?", [`rnet-order-${o1}`]);
    expect(sales).toHaveLength(1);
    expect(Number(sales[0].total)).toBe(28.5);
    expect(Number(sales[0].taxAmount)).toBe(2.59);
    expect(sales[0].status).toBe("paid");
    const lines = await ess.sql("a", "SELECT productType_tsi AS productType, productName, quantity, taxRate_tsi AS taxRate FROM tpv_sale_items WHERE saleId = ? ORDER BY id", [r1.saleId]);
    // Solo las líneas con importe: el pan a 0 € y el vino anulado no se cobran
    expect(lines.map((l: any) => [l.productType, l.productName, l.quantity, Number(l.taxRate)])).toEqual([["restaurant", "Croquetas", 3, 10]]);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sale_payments WHERE saleId = ?", [r1.saleId]))[0].n).toBe(2);
    const [o] = await ess.sql("a", "SELECT status, tpv_sale_id FROM hospo_orders WHERE id = ?", [o1]);
    expect(o).toEqual({ status: "paid", tpv_sale_id: r1.saleId });
    expect((await floorState()).openOrders.some((x) => x.id === o1)).toBe(false);
    expect(errCode(await m("addItem", { orderId: o1, menuItemId: menu.croquetas, quantity: 1 }))).toBe("BAD_REQUEST");
    // Una comanda nueva en la misma mesa ya se puede abrir
    const o1b = await orderOf(t["1"]);
    await ok(m("releaseTable", { orderId: o1b }));
  });

  it("cobro simultáneo de la misma comanda: una sola venta", async () => {
    const o = await orderOf(t["2"]);
    await ok(m("addItem", { orderId: o, menuItemId: menu.vino, quantity: 2 }));
    const pay = { orderId: o, sessionId, payments: [{ method: "cash", amount: 6 }] };
    const [a, b] = await Promise.all([m("checkout", pay), m("checkout", pay)]);
    const okOnes = [a, b].filter((r) => r.status === 200).map((r) => data(r).saleId);
    expect(okOnes.length).toBeGreaterThanOrEqual(1);
    expect(new Set(okOnes).size).toBe(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales WHERE idempotencyKey = ?", [`rnet-order-${o}`]))[0].n).toBe(1);
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [o]))[0].status).toBe("paid");
  });

  it("cuenta de más de 400 €: sin destinatario se rechaza y la comanda sigue cobrable; con sus datos, factura completa a su nombre", async () => {
    const o = await orderOf(t["2"]);
    await ok(m("addItem", { orderId: o, menuItemId: menu.croquetas, quantity: 50 })); // 475 €
    const pay = { orderId: o, sessionId, payments: [{ method: "card", amount: 475 }] };
    const rejected = await m("checkout", pay);
    expect(errCode(rejected)).toBe("BAD_REQUEST");
    expect(rejected.text).toContain("400");
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [o]))[0].status).toBe("bill_requested");
    // Datos incompletos: el TPV también los rechaza
    expect(errCode(await m("checkout", { ...pay, invoiceRecipient: { name: "Empresa Comensal SL", nif: "", address: "", postalCode: "", city: "" } }))).toBe("BAD_REQUEST");
    const recipient = { name: "Empresa Comensal SL", nif: "12345678z", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid" };
    const r = await ok(m("checkout", { ...pay, invoiceRecipient: recipient }));
    const [sale] = await ess.sql("a", "SELECT total, invoiceId FROM tpv_sales WHERE id = ?", [r.saleId]);
    expect(Number(sale.total)).toBe(475);
    expect(sale.invoiceId).not.toBeNull();
    const [inv] = await ess.sql("a", "SELECT clientName, clientNif, total FROM invoices WHERE id = ?", [sale.invoiceId]);
    expect(inv).toMatchObject({ clientName: "Empresa Comensal SL", clientNif: "12345678Z" });
    expect(Number(inv.total)).toBe(475);
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [o]))[0].status).toBe("paid");
  });

  it("liberar mesa sin cobrar: con platos exige motivo; queda cerrada sin venta y la mesa libre", async () => {
    const o = await orderOf(t["3"]);
    await ok(m("addItem", { orderId: o, menuItemId: menu.croquetas, quantity: 1 }));
    expect(errCode(await m("releaseTable", { orderId: o }))).toBe("BAD_REQUEST");
    expect((await ok(m("releaseTable", { orderId: o, reason: "Se van sin consumir" }))).status).toBe("cancelled");
    const [row] = await ess.sql("a", "SELECT status, tpv_sale_id, notes FROM hospo_orders WHERE id = ?", [o]);
    expect(row.status).toBe("cancelled");
    expect(row.tpv_sale_id).toBeNull();
    expect(row.notes).toMatch(/Liberada sin cobrar.*Se van sin consumir/);
    expect((await floorState()).openOrders.some((x) => x.tableId === t["3"])).toBe(false);
  });

  it("unir mesas: los platos pasan a la principal, la unida comparte comanda y se separa al cobrar", async () => {
    const p = await orderOf(t["2"]);
    await ok(m("addItem", { orderId: p, menuItemId: menu.croquetas, quantity: 1 }));
    const s = await orderOf(t["3"]);
    await ok(m("addItem", { orderId: s, menuItemId: menu.vino, quantity: 1 }));
    expect(errCode(await m("mergeTables", { primaryId: t["2"], secondaryId: t["2"] }))).toBe("BAD_REQUEST");
    await ok(m("mergeTables", { primaryId: t["2"], secondaryId: t["3"] }));
    const d = await ok(q("getOrder", { orderId: p }));
    expect(d.items.map((i: any) => i.name).sort()).toEqual(["Copa de vino", "Croquetas"]);
    expect(d.totals.total).toBe(12.5);
    expect(d.table.merged.map((x: any) => x.code)).toEqual(["3"]);
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [s]))[0].status).toBe("cancelled");
    // La unida abre la comanda de la principal: ya hay una abierta
    expect(errCode(await m("openOrder", { tableId: t["3"], guests: 1 }))).toBe("CONFLICT");
    expect(errCode(await m("mergeTables", { primaryId: t["3"], secondaryId: t["4"] }))).toBe("BAD_REQUEST");
    await ok(m("checkout", { orderId: p, sessionId, payments: [{ method: "card", amount: 12.5 }] }));
    const f = await floorState();
    expect(f.tables.find((x) => x.id === t["3"])!.mergedInto).toBeNull();
    // Separar a mano una mesa unida sin comanda
    await ok(m("mergeTables", { primaryId: t["2"], secondaryId: t["4"] }));
    await ok(m("unmergeTable", { tableId: t["4"] }));
    expect((await floorState()).tables.find((x) => x.id === t["4"])!.mergedInto).toBeNull();
  });

  it("reserva: asignar mesa y sentarla abre la comanda enlazada (una sola vez)", async () => {
    await ess.sql("a", "INSERT INTO restaurant_shifts (restaurantId, name, startTime, endTime, maxCapacity) VALUES (?, 'Cena', '20:00', '23:00', 40)", [restA]);
    const [sh] = await ess.sql("a", "SELECT id FROM restaurant_shifts WHERE restaurantId = ?", [restA]);
    await ess.sql("a", "INSERT INTO restaurant_bookings (locator, restaurantId, shiftId, date, time, guests, depositAmount, guestName, guestLastName, guestEmail, status, channel, paymentStatus) VALUES ('NR-PRUEB1', ?, ?, ?, '21:00', 3, 0, 'Ana', 'Ficticia', 'ana@clientes.example', 'confirmed', 'admin', 'pending')", [restA, sh.id, madridToday()]);
    const [bk] = await ess.sql("a", "SELECT id FROM restaurant_bookings WHERE locator = 'NR-PRUEB1'");
    expect(errCode(await m("seatBooking", { bookingId: bk.id }))).toBe("BAD_REQUEST");
    await ok(m("assignBookingTable", { bookingId: bk.id, tableId: t["4"] }));
    await ok(m("assignBookingTable", { bookingId: bk.id, tableId: t["3"] }));
    await ok(m("unassignBookingTable", { bookingId: bk.id, tableId: t["3"] }));
    const s1 = await ok(m("seatBooking", { bookingId: bk.id }));
    const s2 = await ok(m("seatBooking", { bookingId: bk.id }));
    expect(s2).toEqual({ orderId: s1.orderId, reused: true });
    const d = await ok(q("getOrder", { orderId: s1.orderId }));
    expect(d.order).toMatchObject({ tableId: t["4"], guests: 3, customerName: "Ana Ficticia", restaurantBookingId: bk.id });
    const day = await ok(q("listDayBookings", { restaurantId: restA }));
    expect(day[0]).toMatchObject({ locator: "NR-PRUEB1", hospoOrderId: s1.orderId, tables: [{ tableId: t["4"], code: "4" }] });
    expect(day[0].seatedAt).toBeGreaterThan(0);
    await ok(m("addItem", { orderId: s1.orderId, menuItemId: menu.croquetas, quantity: 1 }));
    await ok(m("checkout", { orderId: s1.orderId, sessionId, payments: [{ method: "card", amount: 9.5 }] }));
    expect((await ess.sql("a", "SELECT status FROM restaurant_bookings WHERE id = ?", [bk.id]))[0].status).toBe("completed");
  });

  it("adminrest: solo sus restaurantes; para cobrar necesita además permiso de caja", async () => {
    const email = "jefe-sala@empresa-a.example";
    await ess.sql("a", "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES ('local_adminrest_a', 'Jefe de sala', ?, 'local', 'adminrest', 1, ?, 1)", [email, await bcrypt.hash("clave-jefe-sala-1", 4)]);
    const [u] = await ess.sql("a", "SELECT id FROM users WHERE email = ?", [email]);
    await ess.sql("a", "INSERT INTO restaurant_staff (userId, restaurantId) VALUES (?, ?)", [u.id, restA]);
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: "clave-jefe-sala-1" } });
    expect(login.status).toBe(200);
    const jefe = login.cookie!;
    expect((await q("getFloor", { restaurantId: restA }, jefe)).status).toBe(200);
    expect(errCode(await q("getFloor", { restaurantId: restA2 }, jefe))).toBe("FORBIDDEN");
    const o = data(await m("openOrder", { tableId: t["1"], guests: 2 }, jefe)).id;
    await ok(m("addItem", { orderId: o, menuItemId: menu.croquetas, quantity: 1 }, jefe));
    expect(errCode(await m("checkout", { orderId: o, sessionId, payments: [{ method: "card", amount: 9.5 }] }, jefe))).toBe("FORBIDDEN");
    // El cobro rechazado no deja la comanda bloqueada: la administración la cobra
    expect((await ess.sql("a", "SELECT status FROM hospo_orders WHERE id = ?", [o]))[0].status).toBe("bill_requested");
    await ok(m("checkout", { orderId: o, sessionId, payments: [{ method: "card", amount: 9.5 }] }));
    // Un rol sin el módulo no entra
    expect((await q("getFloor", { restaurantId: restA }, await ess.login("a", "agente"))).status).toBe(403);
  });

  it("aislamiento: la otra empresa no ve ni toca las comandas de esta", async () => {
    expect(errCode(await ess.q("b", "restaurantNet.getOrder", { orderId: o1 }, adB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "restaurantNet.addItem", { orderId: o1, menuItemId: menu.croquetas }, adB))).toBe("NOT_FOUND");
    const [rb] = await ess.sql("b", "SELECT id FROM restaurants");
    expect(data(await ess.q("b", "restaurantNet.getFloor", { restaurantId: rb.id }, adB))).toEqual({ rooms: [], tables: [], openOrders: [] });
  });

  it("sin la migración responde «no instalado» con un mensaje claro", async () => {
    await ess.sql("b", "RENAME TABLE dining_rooms TO dining_rooms_fuera");
    try {
      const [rb] = await ess.sql("b", "SELECT id FROM restaurants");
      const r = await ess.q("b", "restaurantNet.getFloor", { restaurantId: rb.id }, adB);
      expect(errCode(r)).toBe("PRECONDITION_FAILED");
      expect(r.json.error.json.message).toMatch(/aún no están instaladas/);
    } finally {
      await ess.sql("b", "RENAME TABLE dining_rooms_fuera TO dining_rooms");
    }
  });
});
