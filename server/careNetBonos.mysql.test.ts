/**
 * Care Net · bonos y paquetes de sesiones y reservas de SPA con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0037).
 * Definir bonos, venderlos a un cliente del CRM cobrándolos con el TPV del Core (idempotente), cita en mostrador con
 * bono, pagar una reserva de la web con bono, bono que no vale, sesiones agotadas y caducadas, devolver una sesión
 * (con y sin anular la reserva), listado de reservas de SPA, permisos, licencia, aislamiento y respuesta sin la
 * migración. Ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "care-net";
const OP = { type: "operator" as const, id: "prueba-care-net" };
const DAY = "2031-05-20";

describe.skipIf(!URL_)("Care Net · bonos y reservas de SPA (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let sessionId = 0;
  let ana = 0;
  let luis = 0;
  let masaje = 0;
  let facial = 0;
  const slot: Record<string, number> = {};
  let packMasaje = 0;
  let purchase = 0;

  const m = (proc: string, input: unknown, cookie = adA) => ess.m("a", `careNet.${proc}`, input, cookie);
  const q = (proc: string, input: unknown, cookie = adA) => ess.q("a", `careNet.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const used = async (id: number) => Number((await ess.sql("a", "SELECT sessions_used AS n FROM care_pack_purchases WHERE id = ?", [id]))[0].n);
  const booked = async (id: number) => Number((await ess.sql("a", "SELECT bookedCount AS n FROM spa_slots WHERE id = ?", [id]))[0].n);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "carenet");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const ent = new EntitlementAdmin((ess.registry.store as any).q);
    for (const co of ["a", "b"] as const) await ent.grant(ess.ids[co], "spa", OP);
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES ('Ana Ficticia', 'ana@clientes.example', 'manual'), ('Luis Ficticio', 'luis@clientes.example', 'manual')");
    const cs = await ess.sql("a", "SELECT id, email FROM clients ORDER BY id");
    ana = cs.find((c) => c.email === "ana@clientes.example").id;
    luis = cs.find((c) => c.email === "luis@clientes.example").id;
    await ess.sql("a", "INSERT INTO spa_categories (slug, name) VALUES ('masajes', 'Masajes'), ('faciales', 'Faciales')");
    const cats = await ess.sql("a", "SELECT id, slug FROM spa_categories");
    const catM = cats.find((c) => c.slug === "masajes").id;
    const catF = cats.find((c) => c.slug === "faciales").id;
    await ess.sql("a", "INSERT INTO spa_treatments (slug, name, categoryId, price) VALUES ('masaje', 'Masaje relajante', ?, 45), ('facial', 'Limpieza facial', ?, 35)", [catM, catF]);
    const ts = await ess.sql("a", "SELECT id, slug FROM spa_treatments");
    masaje = ts.find((t) => t.slug === "masaje").id;
    facial = ts.find((t) => t.slug === "facial").id;
    for (const [k, t, time] of [["m10", masaje, "10:00"], ["m11", masaje, "11:00"], ["m12", masaje, "12:00"], ["m13", masaje, "13:00"], ["f10", facial, "10:00"]] as const) {
      await ess.sql("a", "INSERT INTO spa_slots (treatmentId, date, startTime, endTime, capacity) VALUES (?, ?, ?, ?, 2)", [t, DAY, time, time.replace(":00", ":50")]);
      slot[k] = (await ess.sql("a", "SELECT id FROM spa_slots WHERE treatmentId = ? AND startTime = ?", [t, time]))[0].id;
    }
    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Recepción" }, adA));
    sessionId = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 0 }, adA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad care-net no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("listPacks", {}), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("definir bonos: validaciones, ámbito y solo la administración", async () => {
    expect(errCode(await m("upsertPack", { name: "Malo", sessions: 0, validityDays: 30, price: 10 }))).toBe("BAD_REQUEST");
    expect(errCode(await m("upsertPack", { name: "Raro", sessions: 3, validityDays: 30, price: 10, treatmentIds: [999999] }))).toBe("NOT_FOUND");
    expect((await m("upsertPack", { name: "Del agente", sessions: 3, validityDays: 30, price: 10 }, agA)).status).toBe(403);
    packMasaje = (await ok(m("upsertPack", { name: "Bono 3 masajes", sessions: 3, validityDays: 30, price: 120, treatmentIds: [masaje] }))).id;
    const viejo = (await ok(m("upsertPack", { name: "Bono antiguo", sessions: 5, validityDays: 90, price: 150 }))).id;
    await ok(m("setPackActive", { id: viejo, active: false }));
    expect((await ok(q("listPacks", {}, agA))).map((p: any) => p.name)).toEqual(["Bono 3 masajes"]);
    expect((await ok(q("listPacks", { includeArchived: true }))).length).toBe(2);
  });

  it("vender un bono: se cobra con el TPV del Core, una sola venta aunque se repita", async () => {
    expect(errCode(await m("sellPack", { packId: packMasaje, clientId: ana, sessionId, payments: [{ method: "card", amount: 100 }], requestKey: "venta-ana-0001" }, agA))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM care_pack_purchases"))[0].n).toBe(0);
    const r1 = await ok(m("sellPack", { packId: packMasaje, clientId: ana, sessionId, payments: [{ method: "card", amount: 120 }], requestKey: "venta-ana-0001" }, agA));
    const r2 = await ok(m("sellPack", { packId: packMasaje, clientId: ana, sessionId, payments: [{ method: "card", amount: 120 }], requestKey: "venta-ana-0001" }, agA));
    purchase = r1.purchase.id;
    expect(r2.purchase.id).toBe(purchase);
    expect(r2.saleId).toBe(r1.saleId);
    expect(r1.purchase).toMatchObject({ state: "active", remaining: 3, sessionsTotal: 3, clientId: ana });
    expect(r1.purchase.expiresAt - r1.purchase.purchasedAt).toBe(30 * 86_400_000);
    const sales = await ess.sql("a", "SELECT id, total, clientId, status_ts AS status FROM tpv_sales WHERE idempotencyKey = ?", [`care-pack-${purchase}`]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ id: r1.saleId, clientId: ana, status: "paid" });
    expect(Number(sales[0].total)).toBe(120);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM care_pack_purchases"))[0].n).toBe(1);
  });

  it("cita en mostrador con bono: plaza ocupada, reserva pagada con bono y una sesión menos", async () => {
    const r = await ok(m("counterAppointment", { clientId: ana, slotId: slot.m10 }, agA));
    expect(r.purchase.remaining).toBe(2);
    expect(await booked(slot.m10)).toBe(1);
    const [res] = await ess.sql("a", "SELECT status, hold_status, client_id, status_reservation FROM reservations WHERE id = ?", [r.reservationId]);
    expect(res).toEqual({ status: "paid", hold_status: "confirmada", client_id: ana, status_reservation: "CONFIRMADA" });
  });

  it("el bono no vale para otro tratamiento: no queda la plaza ocupada", async () => {
    const before = await booked(slot.f10);
    expect(errCode(await m("counterAppointment", { clientId: ana, slotId: slot.f10 }, agA))).toBe("BAD_REQUEST");
    expect(await booked(slot.f10)).toBe(before);
    expect(await used(purchase)).toBe(1);
    // Luis no tiene bono
    expect(errCode(await m("counterAppointment", { clientId: luis, slotId: slot.m11 }, agA))).toBe("BAD_REQUEST");
  });

  it("pagar con bono una reserva de la web (por el correo del cliente), una sola vez", async () => {
    const now = Date.now();
    await ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, status, customer_name, customer_email, merchant_order, created_at, updated_at, inventory_kind, inventory_ref_id, inventory_units, hold_status, hold_expires_at) VALUES (?, 'SPA: Masaje relajante · 11:00', ?, 1, 4500, 'pending_payment', 'Ana Ficticia', 'ana@clientes.example', 'WEB0000001', ?, ?, 'spa_slot', ?, 1, 'retenida', ?)", [masaje, DAY, now, now, slot.m11, now + 3_600_000]);
    await ess.sql("a", "UPDATE spa_slots SET bookedCount = bookedCount + 1 WHERE id = ?", [slot.m11]);
    const [web] = await ess.sql("a", "SELECT id FROM reservations WHERE merchant_order = 'WEB0000001'");
    const c = await ok(m("consumeForReservation", { reservationId: web.id }, agA));
    expect(c.purchase.remaining).toBe(1);
    expect(errCode(await m("consumeForReservation", { reservationId: web.id }, agA))).toBe("BAD_REQUEST");
    expect(await used(purchase)).toBe(2);
    const list = await ok(q("spaReservations", { from: DAY, to: DAY }, agA));
    expect(list.filter((x: any) => x.state !== "anulada").map((x: any) => [x.startTime, x.treatmentName, x.state, x.consumption?.purchaseId ?? null])).toEqual([
      ["10:00", "Masaje relajante", "confirmada", purchase],
      ["11:00", "Masaje relajante", "confirmada", purchase],
    ]);
    // Los intentos rechazados (bono que no vale, cliente sin bono) quedan anulados y sin plaza
    expect(list.filter((x: any) => x.state === "anulada").map((x: any) => x.customerName).sort()).toEqual(["Ana Ficticia", "Luis Ficticio"]);
  });

  it("agotado: la última sesión se consume y la siguiente se rechaza", async () => {
    await ok(m("counterAppointment", { clientId: ana, slotId: slot.m12 }, agA));
    expect(await used(purchase)).toBe(3);
    expect(errCode(await m("counterAppointment", { clientId: ana, slotId: slot.m13 }, agA))).toBe("BAD_REQUEST");
    expect(await booked(slot.m13)).toBe(0);
  });

  it("devolver una sesión: con anulación de la reserva libera la plaza; sin ella, la reserva queda pendiente de pago", async () => {
    const hist = await ok(q("clientPacks", { clientId: ana }, agA));
    expect(hist.consumptions).toHaveLength(3);
    const at12 = hist.consumptions.find((k: any) => k.time === "12:00");
    const at11 = hist.consumptions.find((k: any) => k.time === "11:00");
    expect(errCode(await m("revertConsumption", { consumptionId: at12.id, reason: "x" }, agA))).toBe("BAD_REQUEST");
    await ok(m("revertConsumption", { consumptionId: at12.id, reason: "Cliente anula la cita", cancelReservation: true }, agA));
    expect(await used(purchase)).toBe(2);
    expect(await booked(slot.m12)).toBe(0);
    expect(errCode(await m("revertConsumption", { consumptionId: at12.id, reason: "Otra vez" }, agA))).toBe("BAD_REQUEST");
    await ok(m("revertConsumption", { consumptionId: at11.id, reason: "Paga con tarjeta" }, agA));
    expect(await used(purchase)).toBe(1);
    const [w] = await ess.sql("a", "SELECT status FROM reservations WHERE merchant_order = 'WEB0000001'");
    expect(w.status).toBe("pending_payment");
    // Reserva liberada: no se puede volver a pagar con bono
    const [r12] = await ess.sql("a", "SELECT reservation_id FROM care_pack_consumptions WHERE id = ?", [at12.id]);
    expect(errCode(await m("consumeForReservation", { reservationId: r12.reservation_id }, agA))).toBe("BAD_REQUEST");
    const after = await ok(q("clientPacks", { clientId: ana }, agA));
    expect(after.consumptions.filter((k: any) => k.status === "reverted").map((k: any) => k.revertReason).sort()).toEqual(["Cliente anula la cita", "Paga con tarjeta"]);
  });

  it("caducado: no se usa y aparece en los clientes con bono caducado", async () => {
    expect((await ok(q("clientsWithPacks", { filter: "active" }, agA))).map((c: any) => [c.clientId, c.remaining])).toEqual([[ana, 2]]);
    await ess.sql("a", "UPDATE care_pack_purchases SET expires_at = ? WHERE id = ?", [Date.now() - 1000, purchase]);
    expect(errCode(await m("counterAppointment", { clientId: ana, slotId: slot.m13 }, agA))).toBe("BAD_REQUEST");
    expect(await ok(q("clientsWithPacks", { filter: "active" }, agA))).toEqual([]);
    const exp = await ok(q("clientsWithPacks", { filter: "expired" }, agA));
    expect(exp.map((c: any) => [c.clientId, c.purchases[0].state, c.purchases[0].remaining])).toEqual([[ana, "expired", 2]]);
  });

  it("bono pendiente de cobro: no se usa, se anula y un rol sin caja no vende", async () => {
    expect((await m("sellPack", { packId: packMasaje, clientId: luis, sessionId, payments: [{ method: "cash", amount: 120 }], requestKey: "venta-luis-0001" }, await ess.login("a", "controler"))).status).toBe(403);
    await ess.sql("a", "INSERT INTO care_pack_purchases (pack_id, pack_name, client_id, client_name, sessions_total, price, validity_days, status, created_at, updated_at) VALUES (?, 'Bono 3 masajes', ?, 'Luis Ficticio', 3, 120, 30, 'pending', 0, 0)", [packMasaje, luis]);
    const [p] = await ess.sql("a", "SELECT id FROM care_pack_purchases WHERE client_id = ?", [luis]);
    expect(errCode(await m("counterAppointment", { clientId: luis, slotId: slot.m13 }, agA))).toBe("BAD_REQUEST");
    await ok(m("cancelPendingPurchase", { purchaseId: p.id }, agA));
    expect(errCode(await m("cancelPendingPurchase", { purchaseId: p.id }, agA))).toBe("BAD_REQUEST");
  });

  it("aislamiento: la otra empresa no ve los bonos ni las reservas de esta", async () => {
    expect(await ok(ess.q("b", "careNet.listPacks", {}, adB))).toEqual([]);
    expect(await ok(ess.q("b", "careNet.spaReservations", { from: DAY, to: DAY }, adB))).toEqual([]);
    expect(errCode(await ess.m("b", "careNet.revertConsumption", { consumptionId: 1, reason: "Intento ajeno" }, adB))).toBe("NOT_FOUND");
  });

  it("sin la migración responde «no instalado» con un mensaje claro", async () => {
    await ess.sql("b", "RENAME TABLE care_session_packs TO care_session_packs_fuera");
    try {
      const r = await ess.q("b", "careNet.listPacks", {}, adB);
      expect(errCode(r)).toBe("PRECONDITION_FAILED");
      expect(r.json.error.json.message).toMatch(/aún no están instalados/);
    } finally {
      await ess.sql("b", "RENAME TABLE care_session_packs_fuera TO care_session_packs");
    }
  });
});
