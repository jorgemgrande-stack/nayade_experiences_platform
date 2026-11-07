/**
 * Fidelización por sector (Social Token Net · tokens internos) y Ski Net · Cursillos y grupos con la aplicación real
 * sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Dos empresas con restaurante, Care, hotel y Ski; solo la A tiene la
 * capacidad `social-token-net-tokens`. Programa y reglas iguales en las dos (en la B, guardados por SQL).
 *  - Restaurante (comanda cobrada en el TPV) y Care (bono cobrado en el TPV): puntos por la venta, una sola vez.
 *  - Hotel: folio cerrado con factura → puntos de sus cargos, una sola vez.
 *  - Ski: alquiler entregado y clase impartida (con reserva del cliente) → puntos de su acción, una sola vez.
 *  - Empresa B (sin tokens): nada de lo anterior da puntos; todo lo demás funciona igual.
 *  - Grupos: bolsa del turno, propuesta con huella, aplicación, fusión y división por los routers reales.
 * TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se fusionan las anteriores.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { startEssentialApp, data, type EssentialApp } from "./essentialApp.testkit";
import { addDaysIso, todayInTimeZone } from "./hotelPms";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const TOKENS = "social-token-net-tokens";
type Co = "a" | "b";

describe.skipIf(!URL_)("Fidelización por sector y grupos de Ski (aplicación real)", () => {
  let ess: EssentialApp;
  let reg: mysql.Pool;
  const ad: Record<Co, string> = { a: "", b: "" };
  const cliente: Record<Co, number> = { a: 0, b: 0 };
  const caja: Record<Co, number> = { a: 0, b: 0 };
  const today = todayInTimeZone();
  const SITE = { siteId: "principal" };

  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const ledger = async (co: Co, sourceType?: string) =>
    (await ess.sql(co, `SELECT source_type, source_id, amount FROM loyalty_ledger WHERE kind = 'emision' ${sourceType ? "AND source_type = ?" : ""} ORDER BY id`, sourceType ? [sourceType] : [])) as Array<{ source_type: string; source_id: string; amount: number }>;
  const reservation = async (co: Co, name: string) => {
    const now = Date.now();
    await ess.sql(co, "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, status, customer_name, customer_email, merchant_order, created_at, updated_at) VALUES (1, ?, ?, 1, 0, 'paid', 'Ana Cliente', ?, ?, ?, ?)", [name, today, `ana@cliente-${co}.example`, `SKI${now}${co}`.slice(0, 20), now, now]);
    return (await ess.sql(co, "SELECT MAX(id) AS id FROM reservations"))[0].id as number;
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "fidsector");
    // Sedes de Elephant Control (las exige Ski Net, módulo por sede)
    reg = mysql.createPool({ uri: process.env.REGISTRY_DATABASE_URL!, connectionLimit: 2 });
    const { MysqlOrganizationStore } = await import("./organization/service");
    const { configureSiteDirectory, siteDirectoryFrom } = await import("./sdk");
    const org = new MysqlOrganizationStore(reg);
    for (const co of ["a", "b"] as Co[]) await org.insertSite({ tenantId: ess.ids[co], siteId: "principal", name: "Principal", fiscalEntityId: null, status: "active", createdAt: 1, createdBy: "test", updatedAt: 1 });
    configureSiteDirectory(siteDirectoryFrom(org));

    for (const co of ["a", "b"] as Co[]) {
      for (const mod of ["restaurants", "spa", "hotel"]) await ess.grantModule(co, mod);
      for (const cap of ["restaurant-net", "care-net", "hotel-net", "ski-school", "ski-rental"]) await ess.setCapability(co, cap, "active");
      await ess.sql(co, "INSERT INTO feature_flags (`key`, name, enabled) VALUES ('hotel_module_enabled', 'Hotel', 1) ON DUPLICATE KEY UPDATE enabled = 1");
      ad[co] = await ess.login(co, "admin");
      await ess.sql(co, "INSERT INTO clients (name, email, source) VALUES ('Ana Cliente', ?, 'manual')", [`ana@cliente-${co}.example`]);
      cliente[co] = (await ess.sql(co, "SELECT id FROM clients"))[0].id;
      const r = data(await ess.m(co, "tpv.createRegister", { name: "Caja" }, ad[co]));
      caja[co] = data(await ess.m(co, "tpv.openSession", { registerId: r.id, openingAmount: 0 }, ad[co])).id;
    }
    // Programa de puntos con las mismas reglas en las dos: 1 punto por euro, 50 por alquiler, 30 por clase
    await ess.setCapability("a", TOKENS, "active");
    await ok(ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "puntos", eqPoints: null, eqEuros: null, expiryMonths: null }, ad.a));
    const rule = { trigger: "purchase", actionKey: null, scope: "all", scopeId: null, calc: "per_euro", rate: 1, fixedPoints: null, minSpend: null, maxPoints: null, limitCount: null, limitPeriod: null, priority: 0, active: true, startsAt: null, endsAt: null };
    await ok(ess.m("a", "loyalty.saveRule", { id: null, rule: { ...rule, name: "1 por euro" } }, ad.a));
    for (const [action, pts] of [["alquiler_ski", 50], ["clase_ski", 30]] as const) {
      await ok(ess.m("a", "loyalty.saveRule", { id: null, rule: { ...rule, name: action, trigger: "action", actionKey: action, calc: "fixed", rate: null, fixedPoints: pts } }, ad.a));
    }
    await ess.sql("b", "INSERT INTO loyalty_program (id, enabled, points_name, updated_at) VALUES (1, 1, 'puntos', 0)");
    await ess.sql("b", "INSERT INTO loyalty_rules (name, trigger_kind, scope, calc, rate, priority, active, created_at, updated_at) VALUES ('1 por euro', 'purchase', 'all', 'per_euro', 1, 0, 1, 0, 0)");
    for (const [action, pts] of [["alquiler_ski", 50], ["clase_ski", 30]] as const) {
      await ess.sql("b", "INSERT INTO loyalty_rules (name, trigger_kind, action_key, scope, calc, fixed_points, priority, active, created_at, updated_at) VALUES (?, 'action', ?, 'all', 'fixed', ?, 0, 1, 0, 0)", [action, action, pts]);
    }
  }, 300_000);
  afterAll(async () => {
    const { configureSiteDirectory } = await import("./sdk");
    configureSiteDirectory(null);
    await reg?.end();
    await ess?.close();
  });

  it("restaurante: la comanda cobrada en el TPV da puntos una vez (con tokens); sin tokens, ninguno", async () => {
    for (const co of ["a", "b"] as Co[]) {
      const rn = (proc: string, input: unknown) => ok(ess.m(co, `restaurantNet.${proc}`, input, ad[co]));
      await ess.sql(co, "INSERT INTO restaurants (slug, name) VALUES ('casa', 'Casa')");
      const rest = (await ess.sql(co, "SELECT id FROM restaurants"))[0].id;
      const room = (await rn("createRoom", { restaurantId: rest, name: "Salón" })).id;
      const table = (await rn("createTable", { roomId: room, code: "1" })).id;
      const menu = (await rn("upsertMenuItem", { restaurantId: rest, name: "Menú del día", price: 20, taxRate: 10 })).id;
      const order = (await rn("openOrder", { tableId: table, guests: 1 })).id;
      await rn("addItem", { orderId: order, menuItemId: menu, quantity: 2 });
      const pay = { orderId: order, sessionId: caja[co], payments: [{ method: "card", amount: 40 }], customerEmail: `ana@cliente-${co}.example` };
      await rn("checkout", pay);
      await rn("checkout", pay); // repetido: misma venta, sin puntos dobles
    }
    expect((await ledger("a", "tpv_sale")).map((l) => l.amount)).toEqual([40]);
    expect(await ledger("b")).toEqual([]);
  });

  it("Care: el bono cobrado en el TPV da puntos una vez (con tokens); sin tokens, ninguno", async () => {
    for (const co of ["a", "b"] as Co[]) {
      const pack = (await ok(ess.m(co, "careNet.upsertPack", { name: "Bono 2 masajes", sessions: 2, validityDays: 30, price: 80 }, ad[co]))).id;
      const sell = { packId: pack, clientId: cliente[co], sessionId: caja[co], payments: [{ method: "card", amount: 80 }], requestKey: "bono-cliente-0001" };
      await ok(ess.m(co, "careNet.sellPack", sell, ad[co]));
      await ess.m(co, "careNet.sellPack", sell, ad[co]); // misma clave: no hay otra venta
    }
    expect((await ledger("a", "tpv_sale")).map((l) => l.amount)).toEqual([40, 80]);
    expect(await ledger("b")).toEqual([]);
  });

  it("hotel: el folio cerrado con factura da puntos de sus cargos una vez; sin tokens, ninguno", async () => {
    for (const co of ["a", "b"] as Co[]) {
      const typeId = data(await ess.m(co, "hotel.adminCreateRoomType", { slug: "doble", name: "Doble", basePrice: "100", totalUnits: 1, maxAdults: 2 }, ad[co])).id;
      await ess.m(co, "hotel.adminCreateRoom", { roomTypeId: typeId, code: "101" }, ad[co]);
      const guest = data(await ess.m(co, "hotel.adminCreateReservation", { roomTypeId: typeId, checkIn: today, checkOut: addDaysIso(today, 1), adults: 1, customerName: "Ana Cliente", customerEmail: `ana@cliente-${co}.example` }, ad[co])).id;
      await ok(ess.m(co, "hotel.adminCheckIn", { reservationId: guest }, ad[co]));
      await ok(ess.m(co, "hotel.adminAddFolioCharge", { reservationId: guest, category: "minibar", description: "Agua", quantity: 2, unitPriceCents: 250, taxRateBp: 1000 }, ad[co]));
      const f = await ok(ess.q(co, "hotel.adminGetFolio", { reservationId: guest }, ad[co]));
      await ok(ess.m(co, "hotel.adminAddFolioPayment", { reservationId: guest, method: "tarjeta", amountCents: f.totals.balanceCents }, ad[co]));
      const closed = await ok(ess.m(co, "hotel.adminCloseFolio", { reservationId: guest }, ad[co]));
      expect(closed.invoiceNumber).toBeTruthy();
      expect((await ess.m(co, "hotel.adminCloseFolio", { reservationId: guest }, ad[co])).status).not.toBe(200);
      if (co === "a") {
        const [l] = await ledger("a", "hotel_folio");
        // Alojamiento (100 €) + minibar (5 €): la reserva no se había pagado en línea, así que cuenta todo
        expect(l.amount).toBe(Math.floor(f.totals.chargesCents / 100));
      }
    }
    expect(await ledger("a", "hotel_folio")).toHaveLength(1);
    expect(await ledger("b")).toEqual([]);
  });

  it("Ski: alquiler entregado y clase impartida dan los puntos de su acción una vez; sin tokens, ninguno", async () => {
    for (const co of ["a", "b"] as Co[]) {
      const m = (proc: string, input: unknown) => ok(ess.m(co, proc, { ...SITE, ...(input as object) }, ad[co]));
      // Alquiler
      await m("skiRental.activateSite", {});
      const store = (await m("skiRental.createStore", { name: "Tienda", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" })).id;
      const model = (await m("skiRental.createModel", { assetType: "ski", name: "Allround", size: "160" })).id;
      const [unit] = await m("skiRental.createUnits", { modelId: model, storeId: store, count: 1 });
      const resRental = await reservation(co, "Alquiler");
      await m("skiRental.createDelivery", { storeId: store, customerName: "Ana Cliente", reservationId: resRental, startDate: today, expectedReturnDate: today, lines: [{ code: unit.code, requestedType: "ski" }] });
      // Clase
      await m("skiSchool.activateSite", {});
      const prof = (await m("skiSchool.createInstructor", { fullName: "Profe Ficticio" })).id;
      const prod = (await m("skiSchool.createProduct", { name: "Particular", kind: "private", durationMinutes: 60, capacity: 2 })).id;
      const resClass = await reservation(co, "Clase");
      const ses = (await m("skiSchool.createSession", { productId: prod, date: today, startTime: "10:00", reservationId: resClass })).id;
      await m("skiSchool.assignInstructor", { sessionId: ses, instructorId: prof });
      await m("skiSchool.completeSession", { sessionId: ses });
      expect((await ess.m(co, "skiSchool.completeSession", { ...SITE, sessionId: ses }, ad[co])).status).not.toBe(200);
    }
    const a = await ess.sql("a", "SELECT source_ref, amount FROM loyalty_ledger WHERE source_type = 'action' ORDER BY id");
    expect(a.map((x: any) => [x.source_ref, x.amount])).toEqual([
      ["alquiler_ski", 50],
      ["clase_ski", 30],
    ]);
    expect(await ledger("b")).toEqual([]);
    // Saldo de la clienta A: 40 (comanda) + 80 (bono) + folio + 50 + 30, sin duplicados
    const [w] = await ess.sql("a", "SELECT balance FROM loyalty_wallets WHERE client_id = ?", [cliente.a]);
    const folioPts = (await ledger("a", "hotel_folio"))[0].amount;
    expect(Number(w.balance)).toBe(40 + 80 + folioPts + 50 + 30);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM loyalty_wallets"))[0].n).toBe(0);
  });

  it("cursillos y grupos: bolsa, propuesta revisable, aplicación, fusión y división por los routers reales", async () => {
    const m = (proc: string, input: unknown) => ok(ess.m("a", proc, { ...SITE, ...(input as object) }, ad.a));
    const q = (proc: string, input: unknown) => ok(ess.q("a", proc, { ...SITE, ...(input as object) }, ad.a));
    const prod = (await m("skiSchool.createProduct", { name: "Cursillo mañanas", kind: "group", durationMinutes: 120, capacity: 4 })).id;
    const turn = { productId: prod, date: today, startTime: "10:00" };
    for (let i = 1; i <= 6; i++) await m("skiSchool.addToPool", { ...turn, name: `Alumno ${i}`, age: 10, level: i <= 5 ? "B" : "C", language: "es" });
    const p = await q("skiSchool.proposeGroups", turn);
    expect(p.groups.map((g: any) => [g.kind, g.level, g.poolIds.length])).toEqual([
      ["new_session", "B", 3],
      ["new_session", "B", 2],
      ["new_session", "C", 1],
    ]);
    await m("skiSchool.addToPool", { ...turn, name: "Llega tarde", age: 10, level: "C", language: "es" });
    expect((await ess.m("a", "skiSchool.applyGroups", { ...SITE, ...turn, fingerprint: p.fingerprint }, ad.a)).status).toBe(409);
    const p2 = await q("skiSchool.proposeGroups", turn);
    expect(await m("skiSchool.applyGroups", { ...turn, fingerprint: p2.fingerprint })).toMatchObject({ created: 3, placed: 7 });
    const v = await q("skiSchool.groupTurn", turn);
    const [b1, b2, c] = v.sessions;
    expect([b1.participants.length, b2.participants.length, c.participants.length]).toEqual([3, 2, 2]);
    expect((await ess.m("a", "skiSchool.mergeGroups", { ...SITE, targetId: b1.id, sourceId: c.id }, ad.a)).status).toBe(409);
    // 3 + 2 no caben en 4: primero se divide el grupo grande y después se fusiona
    expect((await ess.m("a", "skiSchool.mergeGroups", { ...SITE, targetId: b1.id, sourceId: b2.id }, ad.a)).status).toBe(409);
    const sp = await m("skiSchool.splitGroup", { sessionId: b1.id, participantIds: b1.participants.slice(0, 2).map((x: any) => x.id) });
    expect(sp.moved).toBe(2);
    expect(await m("skiSchool.mergeGroups", { targetId: b1.id, sourceId: b2.id })).toMatchObject({ moved: 2 });
    const [st] = await ess.sql("a", "SELECT status FROM ski_school_sessions WHERE id = ?", [b2.id]);
    expect(st.status).toBe("cancelled");
    const after = await q("skiSchool.groupTurn", turn);
    expect(after.sessions.map((x: any) => x.participants.length).sort()).toEqual([2, 2, 3]);
    const [n] = await ess.sql("a", "SELECT COUNT(*) AS n FROM ski_school_participants WHERE status = 'enrolled' AND session_id IN (SELECT id FROM ski_school_sessions WHERE product_id = ?)", [prod]);
    expect(Number(n.n)).toBe(7);
  });
});
