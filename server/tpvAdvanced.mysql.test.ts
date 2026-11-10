/**
 * TPV Advanced (capacidad pos-advanced, migración 0065) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL; TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se
 * fusionan las anteriores). Dos empresas sintéticas nuevas; ningún cobro real.
 *  - Sin la capacidad: 403 en el guardián; con ella, todo el circuito: turnos, arqueos con conciliación, entrega y
 *    recepción (también dos a la vez con la misma clave), autorizaciones con umbral y sin autoaprobarse.
 *  - Caja cerrada: ni turnos ni entregas nuevas; arqueo de cierre frente a la foto inmutable (que no cambia).
 *  - Correcciones aparte, auditoría e informes con CSV, solo lectura, licencia retirada sin borrar nada, aislamiento.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "pos-advanced";
const key = (s: string) => `k-${s}-${Math.random().toString(36).slice(2, 10)}`;
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

describe.skipIf(!URL_)("TPV Advanced (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "", agA = "", admB = "";
  let adminId = 0, agentId = 0;
  let sessionId = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvadv");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    adminId = await ess.userId("a", "admin");
    agentId = await ess.userId("a", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin TPV Advanced: el panel lo sabe y el servidor lo rechaza (lectura y escritura)", async () => {
    expect(data(await ess.q("a", "tpv.planInfo", undefined, admA)).advanced).toBe(false);
    expect(isLicenseDenied(await ess.q("a", "tpvAdvanced.status", undefined, admA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "tpvAdvanced.startShift", { sessionId: 1, openingCash: 0, idempotencyKey: key("x") }, agA), CAP)).toBe(true);
  });

  it("con la licencia: turno, arqueo intermedio con conciliación e idempotencia", async () => {
    await ess.setCapability("a", CAP, "active");
    expect(data(await ess.q("a", "tpv.planInfo", undefined, admA)).advanced).toBe(true);
    const st = data(await ess.q("a", "tpvAdvanced.status", undefined, agA));
    expect([st.canWrite, st.isManager, st.isSupervisor]).toEqual([true, false, false]);
    expect(data(await ess.q("a", "tpvAdvanced.status", undefined, admA)).isSupervisor).toBe(true);

    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA));
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 50 }, agA));
    sessionId = s.id;
    const sk = key("turno");
    const t1 = data(await ess.m("a", "tpvAdvanced.startShift", { sessionId, openingCash: 50, idempotencyKey: sk }, agA));
    const t1b = data(await ess.m("a", "tpvAdvanced.startShift", { sessionId, openingCash: 50, idempotencyKey: sk }, agA));
    expect(t1b.id).toBe(t1.id);
    expect(errCode(await ess.m("a", "tpvAdvanced.startShift", { sessionId, openingCash: 0, idempotencyKey: key("t2") }, admA))).toBe("CONFLICT");

    expect((await ess.m("a", "tpv.addCashMovement", { sessionId, type: "in", amount: 10, reason: "Cambio" }, agA)).status).toBe(200);
    // Una venta con tarjeta de 25 € (directa en la BD: el flujo de cobro no es de este módulo)
    const now = Date.now();
    await ess.sql("a", "INSERT INTO tpv_sales (ticketNumber, sessionId, subtotal, total, status_ts, createdAt, paidAt) VALUES (?, ?, 25, 25, 'paid', ?, ?)", [`T-${now}`, sessionId, now, now]);
    const [sale] = await ess.sql("a", "SELECT id FROM tpv_sales WHERE sessionId = ?", [sessionId]);
    await ess.sql("a", "INSERT INTO tpv_sale_payments (saleId, method_tsp, amount_tsp, status_tsp, createdAt) VALUES (?, 'card', 25, 'completed', ?)", [sale.id, now]);

    const ck = key("arqueo");
    const count = { sessionId, kind: "intermediate", denominations: { "5000": 1, "1000": 1 }, declaredCard: 20, idempotencyKey: ck };
    const c1 = data(await ess.m("a", "tpvAdvanced.createCount", count, agA));
    expect([c1.countedCash, c1.expectedCash, c1.cashDifference, c1.expected.card, c1.differences.card, c1.differences.bizum]).toEqual([60, 60, 0, 25, -5, null]);
    expect(data(await ess.m("a", "tpvAdvanced.createCount", count, agA)).id).toBe(c1.id);
    expect(errCode(await ess.m("a", "tpvAdvanced.createCount", { ...count, denominations: { "5000": 2 } }, agA))).toBe("CONFLICT");
    // La misma clave con otro importe del datáfono tampoco devuelve el antiguo en silencio
    expect(errCode(await ess.m("a", "tpvAdvanced.createCount", { ...count, declaredCard: 25 }, agA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "tpvAdvanced.createCount", { ...count, denominations: { "300": 1 }, idempotencyKey: key("mal") }, agA))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_adv_counts"))[0].n).toBe(1);
  });

  it("entrega de caja: dos a la vez con la misma clave dan una sola; quien entrega no recibe; diferencia anotada", async () => {
    const hk = key("entrega");
    const input = { sessionId, declaredCash: 60, toUserId: adminId, idempotencyKey: hk };
    const both = await Promise.all([ess.m("a", "tpvAdvanced.declareHandover", input, agA), ess.m("a", "tpvAdvanced.declareHandover", input, agA)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(data(both[0]).id).toBe(data(both[1]).id);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_adv_handovers WHERE idempotency_key = ?", [hk]))[0].n).toBe(1);
    // Otra entrega mientras hay una pendiente: no
    expect(errCode(await ess.m("a", "tpvAdvanced.declareHandover", { ...input, idempotencyKey: key("otra") }, agA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "tpvAdvanced.declareHandover", { ...input, toUserId: null }, agA))).toBe("CONFLICT");
    const h = data(both[0]);
    expect(errCode(await ess.m("a", "tpvAdvanced.receiveHandover", { handoverId: h.id, receivedCash: 60, idempotencyKey: key("r0") }, agA))).toBe("FORBIDDEN");
    const rk = key("recibir");
    const r = data(await ess.m("a", "tpvAdvanced.receiveHandover", { handoverId: h.id, receivedCash: 58, notes: "Faltan 2 €", idempotencyKey: rk }, admA));
    expect([r.status, r.difference, r.toUserId]).toEqual(["disputed", -2, adminId]);
    expect(data(await ess.m("a", "tpvAdvanced.receiveHandover", { handoverId: h.id, receivedCash: 58, idempotencyKey: rk }, admA)).id).toBe(h.id);
    const d = data(await ess.q("a", "tpvAdvanced.sessionDetail", { sessionId }, admA));
    expect(d.shifts.map((t: any) => [t.operatorUserId, t.status, t.openingCash, t.closingCash])).toEqual([[agentId, "closed", 50, 60], [adminId, "open", 58, null]]);
    expect(d.pendingHandover).toBeNull();
  });

  it("autorizaciones: umbral configurable, nadie se autoriza a sí mismo y se aplican una vez", async () => {
    expect(errCode(await ess.m("a", "tpvAdvanced.setRule", { kind: "cash_out", enabled: true, threshold: 100 }, agA))).toBe("FORBIDDEN");
    expect(data(await ess.m("a", "tpvAdvanced.setRule", { kind: "cash_out", enabled: true, threshold: 100 }, admA)).enabled).toBe(true);
    expect(errCode(await ess.m("a", "tpvAdvanced.setRule", { kind: "discount", enabled: true, threshold: 150 }, admA))).toBe("BAD_REQUEST");
    expect(data(await ess.q("a", "tpvAdvanced.checkAuthorization", { kind: "cash_out", amount: 150 }, agA)).required).toBe(true);
    expect(errCode(await ess.m("a", "tpvAdvanced.requestAuthorization", { kind: "cash_out", sessionId, amount: 50, reason: "Pago a proveedor", idempotencyKey: key("a0") }, agA))).toBe("BAD_REQUEST");
    const ak = key("aut");
    const a = data(await ess.m("a", "tpvAdvanced.requestAuthorization", { kind: "cash_out", sessionId, amount: 150, reason: "Pago a proveedor", idempotencyKey: ak }, agA));
    expect(data(await ess.m("a", "tpvAdvanced.requestAuthorization", { kind: "cash_out", sessionId, amount: 150, reason: "Pago a proveedor", idempotencyKey: ak }, agA)).id).toBe(a.id);
    expect(errCode(await ess.m("a", "tpvAdvanced.decideAuthorization", { id: a.id, approve: true }, agA))).toBe("FORBIDDEN");
    // El supervisor no aprueba la suya
    const own = data(await ess.m("a", "tpvAdvanced.requestAuthorization", { kind: "cash_out", amount: 200, reason: "Retirada al banco", idempotencyKey: key("own") }, admA));
    expect(errCode(await ess.m("a", "tpvAdvanced.decideAuthorization", { id: own.id, approve: true }, admA))).toBe("FORBIDDEN");
    const ok = data(await ess.m("a", "tpvAdvanced.decideAuthorization", { id: a.id, approve: true, note: "Conforme" }, admA));
    expect([ok.status, ok.usable]).toEqual(["approved", true]);
    expect(errCode(await ess.m("a", "tpvAdvanced.useAuthorization", { id: a.id, kind: "cash_out", amount: 180, sessionId, usedRef: "Mov 1" }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "tpvAdvanced.useAuthorization", { id: a.id, kind: "cash_out", sessionId, usedRef: "Mov 1" }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "tpvAdvanced.useAuthorization", { id: a.id, kind: "cash_out", amount: 150, usedRef: "Mov 1" }, agA))).toBe("BAD_REQUEST");
    expect(data(await ess.m("a", "tpvAdvanced.useAuthorization", { id: a.id, kind: "cash_out", amount: 150, sessionId, usedRef: "Mov 1" }, agA)).status).toBe("used");
    expect(data(await ess.m("a", "tpvAdvanced.useAuthorization", { id: a.id, kind: "cash_out", amount: 150, sessionId, usedRef: "Mov 1" }, agA)).status).toBe("used");
    expect(errCode(await ess.m("a", "tpvAdvanced.useAuthorization", { id: a.id, kind: "cash_out", amount: 150, sessionId, usedRef: "Mov 2" }, agA))).toBe("CONFLICT");
    // El agente ve solo las suyas; el supervisor, todas
    expect(data(await ess.q("a", "tpvAdvanced.authorizations", undefined, agA)).map((x: any) => x.id)).toEqual([a.id]);
    expect(data(await ess.q("a", "tpvAdvanced.authorizations", undefined, admA))).toHaveLength(2);
  });

  it("caja cerrada: sin turnos ni entregas nuevas; arqueo de cierre frente al cierre, que no cambia", async () => {
    expect((await ess.m("a", "tpv.closeSession", { sessionId, countedCash: 58 }, admA)).status).toBe(200);
    const [before] = await ess.sql("a", "SELECT * FROM tpv_session_closures WHERE session_id = ?", [sessionId]);
    expect(Number(before.expected_cash)).toBe(60);
    const st = await ess.m("a", "tpvAdvanced.startShift", { sessionId, openingCash: 0, idempotencyKey: key("tc") }, agA);
    expect(errCode(st)).toBe("CONFLICT");
    expect(st.json.error.json.message).toMatch(/cerrada/);
    expect(errCode(await ess.m("a", "tpvAdvanced.declareHandover", { sessionId, declaredCash: 1, idempotencyKey: key("hc") }, admA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "tpvAdvanced.createCount", { sessionId, kind: "intermediate", denominations: {}, idempotencyKey: key("ic") }, admA))).toBe("CONFLICT");
    const cc = data(await ess.m("a", "tpvAdvanced.createCount", { sessionId, kind: "closing", denominations: { "5000": 1, "500": 1, "200": 1, "100": 1 }, declaredCard: 25, idempotencyKey: key("cc") }, admA));
    expect([cc.countedCash, cc.expectedCash, cc.cashDifference, cc.differences.card]).toEqual([58, 60, -2, 0]);
    expect(errCode(await ess.m("a", "tpvAdvanced.createCount", { sessionId, kind: "closing", denominations: {}, idempotencyKey: key("cc2") }, admA))).toBe("CONFLICT");
    // El turno abierto sí puede terminarse
    const open = data(await ess.q("a", "tpvAdvanced.sessionDetail", { sessionId }, admA)).openShift;
    expect(data(await ess.m("a", "tpvAdvanced.endShift", { shiftId: open.id, closingCash: 58, idempotencyKey: key("fin") }, admA)).status).toBe("closed");
    const [after] = await ess.sql("a", "SELECT * FROM tpv_session_closures WHERE session_id = ?", [sessionId]);
    expect(after).toEqual(before);
  });

  it("corrección aparte (idempotente, administración): el arqueo original no cambia", async () => {
    const [c] = await ess.sql("a", "SELECT * FROM tpv_adv_counts WHERE kind = 'closing'");
    const k = key("corr");
    const input = { targetKind: "count", targetId: c.id, amount: 2, reason: "Billete de 2 € apuntado en otra bolsa", idempotencyKey: k };
    expect(errCode(await ess.m("a", "tpvAdvanced.addCorrection", input, agA))).toBe("FORBIDDEN");
    const r1 = data(await ess.m("a", "tpvAdvanced.addCorrection", input, admA));
    expect(data(await ess.m("a", "tpvAdvanced.addCorrection", input, admA)).id).toBe(r1.id);
    const [same] = await ess.sql("a", "SELECT * FROM tpv_adv_counts WHERE id = ?", [c.id]);
    expect(same).toEqual(c);
  });

  it("auditoría unificada e informes con CSV (solo administración del TPV)", async () => {
    const day = today();
    expect(errCode(await ess.q("a", "tpvAdvanced.audit", { from: day, to: day }, agA))).toBe("FORBIDDEN");
    const audit = data(await ess.q("a", "tpvAdvanced.audit", { from: day, to: day }, admA));
    const types = new Set(audit.events.map((e: any) => e.type));
    for (const t of ["session_open", "session_close", "sale", "cash_movement", "shift_start", "shift_end", "handover_declared", "handover_received", "count", "auth_requested", "auth_decided", "record_correction"]) expect(types.has(t), t).toBe(true);
    const onlyCounts = data(await ess.q("a", "tpvAdvanced.audit", { from: day, to: day, types: ["count"] }, admA));
    expect(onlyCounts.events.every((e: any) => e.type === "count")).toBe(true);
    const auditCsv = data(await ess.q("a", "tpvAdvanced.exportCsv", { from: day, to: day, section: "auditoria", types: ["count"] }, admA)).csv;
    expect(auditCsv.split(/\r\n/).filter(Boolean)).toHaveLength(1 + onlyCounts.events.length);
    // El agente no ve en el detalle las solicitudes de otros
    expect(data(await ess.q("a", "tpvAdvanced.sessionDetail", { sessionId }, agA)).authorizations.every((x: any) => x.requestedBy === agentId)).toBe(true);
    const shifts = data(await ess.q("a", "tpvAdvanced.report", { from: day, to: day, section: "turnos" }, admA)).turnos;
    const agentShift = shifts.find((s: any) => s.operatorUserId === agentId);
    expect([agentShift.card, agentShift.cashIn, agentShift.expectedCash, agentShift.difference]).toEqual([25, 10, 60, 0]);
    const ops = data(await ess.q("a", "tpvAdvanced.report", { from: day, to: day, section: "operadores" }, admA)).operadores;
    expect(ops.find((o: any) => o.operatorUserId === adminId).handoverDifference).toBe(-2);
    const csv = data(await ess.q("a", "tpvAdvanced.exportCsv", { from: day, to: day, section: "arqueos" }, admA));
    expect(csv.filename).toBe(`tpv-avanzado-arqueos-${day}_${day}.csv`);
    expect(csv.csv.startsWith("﻿")).toBe(true);
    expect(csv.csv.split("\r\n").filter(Boolean)).toHaveLength(3);
    expect(errCode(await ess.q("a", "tpvAdvanced.report", { from: "2026-01-01", to: "2026-12-31", section: "turnos" }, admA))).toBe("BAD_REQUEST");
  });

  it("solo lectura: el histórico se consulta, no se registra; sin licencia, nada se borra", async () => {
    const rows = async () => (await ess.sql("a", "SELECT (SELECT COUNT(*) FROM tpv_adv_counts) + (SELECT COUNT(*) FROM tpv_adv_shifts) + (SELECT COUNT(*) FROM tpv_adv_handovers) + (SELECT COUNT(*) FROM tpv_adv_authorizations) + (SELECT COUNT(*) FROM tpv_adv_corrections) AS n"))[0].n;
    const n = await rows();
    await ess.setCapability("a", CAP, "read_only");
    expect(data(await ess.q("a", "tpvAdvanced.status", undefined, admA)).canWrite).toBe(false);
    expect((await ess.q("a", "tpvAdvanced.sessionDetail", { sessionId }, admA)).status).toBe(200);
    expect((await ess.q("a", "tpvAdvanced.audit", { from: today(), to: today() }, admA)).status).toBe(200);
    expect(isLicenseDenied(await ess.m("a", "tpvAdvanced.setRule", { kind: "drawer_open", enabled: true, threshold: null }, admA), CAP)).toBe(true);
    await ess.setCapability("a", CAP, null);
    expect(isLicenseDenied(await ess.q("a", "tpvAdvanced.sessionDetail", { sessionId }, admA), CAP)).toBe(true);
    expect(await rows()).toBe(n);
    await ess.setCapability("a", CAP, "active");
    expect(data(await ess.q("a", "tpvAdvanced.sessionDetail", { sessionId }, admA)).counts).toHaveLength(2);
  });

  it("aislamiento: B no ve ni opera las cajas de A", async () => {
    await ess.setCapability("b", CAP, "active");
    expect(errCode(await ess.q("b", "tpvAdvanced.sessionDetail", { sessionId }, admB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "tpvAdvanced.sessions", undefined, admB))).toEqual([]);
    expect(data(await ess.q("b", "tpvAdvanced.authorizations", undefined, admB))).toEqual([]);
    expect(data(await ess.q("b", "tpvAdvanced.audit", { from: today(), to: today() }, admB)).events).toEqual([]);
    const [h] = await ess.sql("a", "SELECT id FROM tpv_adv_handovers LIMIT 1");
    expect(errCode(await ess.m("b", "tpvAdvanced.cancelHandover", { handoverId: h.id }, admB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_adv_counts"))[0].n).toBe(0);
  });

  it("autorizaciones aplicadas al TPV: salida por encima del umbral y corrección de caja cerrada exigen una autorización aprobada, que se consume una vez", async () => {
    await ess.setCapability("a", "pos-advanced", "active");
    const [reg] = await ess.sql("a", "SELECT id FROM cash_registers WHERE isActive = 1 LIMIT 1");
    const [prev] = await ess.sql("a", "SELECT id FROM cash_sessions WHERE registerId = ? AND status_cs = 'open'", [reg.id]);
    if (prev) await ess.m("a", "tpv.closeSession", { sessionId: prev.id, countedCash: 0 }, admA);
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 500, idempotencyKey: key("ab") }, agA));
    data(await ess.m("a", "tpvAdvanced.setRule", { kind: "cash_out", enabled: true, threshold: 100 }, admA));
    // Por debajo del umbral, como siempre
    expect((await ess.m("a", "tpv.addCashMovement", { sessionId: s.id, type: "out", amount: 20, reason: "Cambio", outKind: "traspaso", idempotencyKey: key("m1") }, agA)).status).toBe(200);
    // Por encima: sin autorización, no
    const mk = key("m2");
    const big = { sessionId: s.id, type: "out", amount: 150, reason: "Pago a proveedor", outKind: "traspaso", idempotencyKey: mk };
    expect(errCode(await ess.m("a", "tpv.addCashMovement", big, agA))).toBe("FORBIDDEN");
    const a = data(await ess.m("a", "tpvAdvanced.requestAuthorization", { kind: "cash_out", sessionId: s.id, amount: 150, reason: "Pago a proveedor", idempotencyKey: key("rq") }, agA));
    data(await ess.m("a", "tpvAdvanced.decideAuthorization", { id: a.id, approve: true }, admA));
    expect((await ess.m("a", "tpv.addCashMovement", { ...big, authorizationId: a.id }, agA)).status).toBe(200);
    // La misma autorización no vale para otra salida
    expect(errCode(await ess.m("a", "tpv.addCashMovement", { ...big, idempotencyKey: key("m3"), authorizationId: a.id }, agA))).toBe("CONFLICT");
    // Quien puede autorizar no necesita pedirla
    expect((await ess.m("a", "tpv.addCashMovement", { ...big, idempotencyKey: key("m4") }, admA)).status).toBe(200);
    data(await ess.m("a", "tpvAdvanced.setRule", { kind: "cash_out", enabled: false, threshold: 100 }, admA));
    expect((await ess.m("a", "tpv.addCashMovement", { ...big, idempotencyKey: key("m5") }, agA)).status).toBe(200);
  });
});
