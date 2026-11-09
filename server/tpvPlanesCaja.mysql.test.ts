/**
 * Caja por plan y reglas de funcionamiento (estrategia TPV 09/11/2026) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas; ningún cobro real.
 *  - Límite de cajas en el servidor: Essential 1, Business 3; con más cajas que su límite, la empresa sigue operando
 *    con todas y solo no puede añadir otra; dos altas a la vez no superan el máximo.
 *  - Caja cerrada sin movimientos ordinarios; corrección trazable aparte; foto inmutable del cierre.
 *  - Idempotencia de apertura, movimiento, cierre y corrección; concurrencia de aperturas y movimientos.
 *  - Licencia en solo lectura: el histórico se consulta, no se opera.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const key = (s: string) => `k-${s}-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!URL_)("Caja por plan: límites, cierres e idempotencia (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "", agA = "", admB = "", agB = "";

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvplan");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    agB = await ess.login("b", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("Essential: una caja activa; la segunda se rechaza en el servidor con su explicación", async () => {
    const plan = data(await ess.q("a", "tpv.planInfo", undefined, admA));
    expect([plan.plan.tier, plan.plan.maxActiveRegisters, plan.activeRegisters]).toEqual(["essential", 1, 0]);
    expect((await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA)).status).toBe(200);
    const r = await ess.m("a", "tpv.createRegister", { name: "Terraza" }, admA);
    expect(errCode(r)).toBe("FORBIDDEN");
    expect(r.json.error.json.message).toMatch(/Tu plan Essential incluye una caja activa/);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM cash_registers"))[0].n).toBe(1);
  });

  it("empresa con más cajas que su límite: sigue operando con todas, no puede añadir ni reactivar otra", async () => {
    // Tres cajas que ya tenía antes del límite (como una empresa existente)
    const now = Date.now();
    for (const n of ["Antigua 1", "Antigua 2"]) await ess.sql("a", "INSERT INTO cash_registers (name, isActive, createdAt) VALUES (?, 1, ?)", [n, now]);
    const regs = data(await ess.q("a", "tpv.getRegisterStatus", undefined, agA));
    expect(regs).toHaveLength(3);
    for (const reg of regs) {
      const s = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 10 }, agA));
      expect(s.status).toBe("open");
      expect((await ess.m("a", "tpv.addCashMovement", { sessionId: s.id, type: "in", amount: 5, reason: "Cambio" }, agA)).status).toBe(200);
      const c = data(await ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 15 }, agA));
      expect([c.status, Number(c.cashDifference)]).toEqual(["closed", 0]);
    }
    expect(errCode(await ess.m("a", "tpv.createRegister", { name: "Cuarta" }, admA))).toBe("FORBIDDEN");
    // Desactivar una conserva su histórico; volver a activarla no cabe (siguen 2 > 1)
    const off = data(await ess.m("a", "tpv.setRegisterActive", { registerId: regs[2].id, active: false }, admA));
    expect(off.isActive).toBe(false);
    expect(errCode(await ess.m("a", "tpv.setRegisterActive", { registerId: regs[2].id, active: true }, admA))).toBe("FORBIDDEN");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM cash_sessions WHERE registerId = ?", [regs[2].id]))[0].n).toBe(1);
    expect(data(await ess.q("a", "tpv.listAllRegisters", undefined, admA))).toHaveLength(3);
  });

  it("Business: hasta 3 cajas; dos altas a la vez no superan el máximo", async () => {
    await ess.setCapability("b", "reports-advanced", "active"); // capacidad de Business → plan Business
    expect(data(await ess.q("b", "tpv.planInfo", undefined, admB)).plan.tier).toBe("business");
    expect((await ess.m("b", "tpv.createRegister", { name: "B1" }, admB)).status).toBe(200);
    expect((await ess.m("b", "tpv.createRegister", { name: "B2" }, admB)).status).toBe(200);
    const both = await Promise.all([ess.m("b", "tpv.createRegister", { name: "B3" }, admB), ess.m("b", "tpv.createRegister", { name: "B3bis" }, admB)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 403]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM cash_registers WHERE isActive = 1"))[0].n).toBe(3);
  });

  it("apertura idempotente y una sola sesión abierta por caja aunque se abra dos veces a la vez", async () => {
    const [reg] = await ess.sql("b", "SELECT id FROM cash_registers WHERE name = 'B1'");
    const k = key("abrir");
    const s1 = data(await ess.m("b", "tpv.openSession", { registerId: reg.id, openingAmount: 0, idempotencyKey: k }, agB));
    const s2 = data(await ess.m("b", "tpv.openSession", { registerId: reg.id, openingAmount: 0, idempotencyKey: k }, agB));
    expect(s2.id).toBe(s1.id);
    await ess.m("b", "tpv.closeSession", { sessionId: s1.id, countedCash: 0 }, agB);
    const [reg2] = await ess.sql("b", "SELECT id FROM cash_registers WHERE name = 'B2'");
    const race = await Promise.all([1, 2, 3].map(() => ess.m("b", "tpv.openSession", { registerId: reg2.id, openingAmount: 0, idempotencyKey: key("r") }, agB)));
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM cash_sessions WHERE registerId = ? AND status_cs = 'open'", [reg2.id]))[0].n).toBe(1);
  });

  it("movimiento idempotente (también dos a la vez) y caja cerrada sin movimientos ordinarios", async () => {
    const [reg2] = await ess.sql("b", "SELECT id FROM cash_registers WHERE name = 'B2'");
    const [open] = await ess.sql("b", "SELECT id FROM cash_sessions WHERE registerId = ? AND status_cs = 'open'", [reg2.id]);
    const k = key("mov");
    const mv = { sessionId: open.id, type: "out", amount: 7, reason: "Compra de cambio", outKind: "traspaso", idempotencyKey: k };
    const two = await Promise.all([ess.m("b", "tpv.addCashMovement", mv, agB), ess.m("b", "tpv.addCashMovement", mv, agB)]);
    expect(two.map((r) => r.status)).toEqual([200, 200]);
    expect(data(two[0]).id).toBe(data(two[1]).id);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM cash_movements WHERE idempotency_key = ?", [k]))[0].n).toBe(1);
    // La misma clave con otro importe: conflicto
    expect(errCode(await ess.m("b", "tpv.addCashMovement", { ...mv, amount: 8 }, agB))).toBe("CONFLICT");
    // Importe con más de dos decimales: se guarda en céntimos y la repetición devuelve el mismo movimiento
    const k3 = key("dec");
    const d1 = data(await ess.m("b", "tpv.addCashMovement", { sessionId: open.id, type: "in", amount: 7.005, reason: "Redondeo", idempotencyKey: k3 }, agB));
    const d2 = data(await ess.m("b", "tpv.addCashMovement", { sessionId: open.id, type: "in", amount: 7.005, reason: "Redondeo", idempotencyKey: k3 }, agB));
    expect([d2.id, Number(d2.amount)]).toEqual([d1.id, 7.01]);
    // La misma clave de apertura en otra caja: conflicto (no un error del servidor)
    const [reg1] = await ess.sql("b", "SELECT id FROM cash_registers WHERE name = 'B1'");
    const [used] = await ess.sql("b", "SELECT open_key FROM cash_sessions WHERE open_key IS NOT NULL AND registerId <> ? LIMIT 1", [reg1.id]);
    expect(errCode(await ess.m("b", "tpv.openSession", { registerId: reg1.id, openingAmount: 0, idempotencyKey: used.open_key }, agB))).toBe("CONFLICT");
    // Cierre idempotente
    const ck = key("cierre");
    const c1 = await ess.m("b", "tpv.closeSession", { sessionId: open.id, countedCash: 0.01, idempotencyKey: ck }, agB);
    // Si el primer cierre hubiera caído antes de la foto, la repetición la rehace
    await ess.sql("b", "DELETE FROM tpv_session_closures WHERE session_id = ?", [open.id]);
    const c2 = await ess.m("b", "tpv.closeSession", { sessionId: open.id, countedCash: 0.01, idempotencyKey: ck }, agB);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_session_closures WHERE session_id = ?", [open.id]))[0].n).toBe(1);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    expect(errCode(await ess.m("b", "tpv.closeSession", { sessionId: open.id, countedCash: 0.01 }, agB))).toBe("CONFLICT");
    // Caja cerrada: ningún movimiento ordinario
    const late = await ess.m("b", "tpv.addCashMovement", { sessionId: open.id, type: "in", amount: 3, reason: "Tarde" }, agB);
    expect(errCode(late)).toBe("CONFLICT");
    expect(late.json.error.json.message).toMatch(/Corrección de caja cerrada/);
  });

  it("cierre inmutable y corrección trazable aparte (idempotente, solo administración)", async () => {
    const [s] = await ess.sql("b", "SELECT id, cashDifference FROM cash_sessions WHERE close_key IS NOT NULL ORDER BY id DESC LIMIT 1");
    const [snap] = await ess.sql("b", "SELECT * FROM tpv_session_closures WHERE session_id = ?", [s.id]);
    expect([Number(snap.manual_out), Number(snap.expected_cash), Number(snap.counted_cash), Number(snap.difference)]).toEqual([7, 0.01, 0.01, 0]);
    expect(snap.operational_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ck = key("corr");
    const input = { sessionId: s.id, kind: "cash_in", amount: 3, reason: "Venta en efectivo apuntada tarde", idempotencyKey: ck };
    expect(errCode(await ess.m("b", "tpv.addClosedSessionCorrection", input, agB))).toBe("FORBIDDEN");
    const a1 = data(await ess.m("b", "tpv.addClosedSessionCorrection", input, admB));
    const a2 = data(await ess.m("b", "tpv.addClosedSessionCorrection", input, admB));
    expect(a2.id).toBe(a1.id);
    const sum = data(await ess.q("b", "tpv.getSessionSummary", { sessionId: s.id }, admB));
    expect([sum.corrections.length, sum.correctionsCashDelta, Number(sum.closure.difference)]).toEqual([1, 3, 0]);
    // El cierre no cambia
    const [after] = await ess.sql("b", "SELECT cashDifference FROM cash_sessions WHERE id = ?", [s.id]);
    expect(Number(after.cashDifference)).toBe(Number(s.cashDifference));
    // Resumen diario: la caja con su corrección
    const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
    const day = data(await ess.q("b", "tpv.dailySummary", { day: today }, agB));
    expect(day.registers.find((r: any) => r.registerName === "B2").corrections).toBe(3);
  });

  it("hora de corte configurable por empresa y por caja", async () => {
    expect((await ess.m("b", "tpv.setCutoffTime", { cutoff: "04:00" }, admB)).status).toBe(200);
    expect(data(await ess.q("b", "tpv.planInfo", undefined, admB)).cutoff.cutoff).toBe("04:00");
    const [reg] = await ess.sql("b", "SELECT id FROM cash_registers WHERE name = 'B1'");
    expect((await ess.m("b", "tpv.setCutoffTime", { registerId: reg.id, cutoff: "06:30" }, admB)).status).toBe(200);
    expect((await ess.sql("b", "SELECT cutoff_time AS c FROM cash_registers WHERE id = ?", [reg.id]))[0].c).toBe("06:30");
    expect(errCode(await ess.m("b", "tpv.setCutoffTime", { cutoff: "4h" }, admB))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("b", "tpv.setCutoffTime", { cutoff: "04:00" }, agB))).toBe("FORBIDDEN");
  });

  it("aislamiento: A no ve ni corrige las cajas de B", async () => {
    // Cada empresa tiene su base de datos: una sesión que A no tiene no existe para A, y B no cambia
    const before = (await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_session_corrections"))[0].n;
    expect(errCode(await ess.m("a", "tpv.addClosedSessionCorrection", { sessionId: 999999, kind: "cash_in", amount: 1, reason: "intrusión", idempotencyKey: key("x") }, admA))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_session_corrections"))[0].n).toBe(before);
    expect(data(await ess.q("a", "tpv.listAllRegisters", undefined, admA)).map((r: any) => r.name)).not.toContain("B1");
  });

  it("licencia en solo lectura: el histórico se consulta; no se crean cajas", async () => {
    await ess.setCapability("a", "bill-cash", "read_only");
    expect((await ess.q("a", "tpv.getBackoffice", { page: 1, limit: 20 }, admA)).status).toBe(200);
    expect((await ess.q("a", "tpv.listAllRegisters", undefined, admA)).status).toBe(200);
    expect((await ess.m("a", "tpv.createRegister", { name: "Otra" }, admA)).status).toBe(403);
    await ess.setCapability("a", "bill-cash", "active");
  });
});
