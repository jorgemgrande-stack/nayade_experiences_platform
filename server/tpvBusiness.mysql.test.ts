/**
 * Caja de Business y Enterprise (estrategia TPV 09/11/2026) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Empresas sintéticas nuevas; cobros solo en efectivo simulado, ninguno real.
 *  - Essential: las funciones superiores se rechazan en el servidor con su explicación.
 *  - Business: operadores por caja, devoluciones y anulaciones autorizadas (idempotentes, sin autorizarse a uno
 *    mismo, una sola ejecución con dos aprobaciones a la vez), informes por periodo y supervisión de cierres.
 *  - Enterprise: supervisores por caja, supervisión centralizada e informes consolidados.
 *  - Bajar de plan conserva asignaciones y solicitudes (dejan de aplicarse) y no borra nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const key = (s: string) => `k-${s}-${Math.random().toString(36).slice(2, 10)}`;
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

describe.skipIf(!URL_)("Caja Business y Enterprise (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "", admB = "", agB = "";
  let agBId = 0, ctlBId = 0, regB = 0, productId = 0;

  const sell = async (sessionId: number, cookie: string) => {
    const r = await ess.m("b", "tpv.createSale", {
      sessionId,
      items: [{ productType: "experience", productId, productName: "Servicio", quantity: 1, unitPrice: 20 }],
      payments: [{ method: "cash", amount: 20 }],
      idempotencyKey: key("venta"),
    }, cookie);
    if (r.status !== 200) throw new Error(`venta: ${r.status} ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvbiz");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agB = await ess.login("b", "agente");
    agBId = await ess.userId("b", "agente");
    ctlBId = await ess.userId("b", "controler");
    // Empresas NUEVAS: la migración 0064 corre antes de crear su primer usuario y no les siembra derecho adquirido
    for (const co of ["a", "b"] as const) expect((await ess.sql(co, "SELECT COUNT(*) AS n FROM tpv_acquired_rights"))[0].n).toBe(0);
    await ess.setCapability("b", "reports-advanced", "active"); // capacidad de Business → plan Business
    regB = data(await ess.m("b", "tpv.createRegister", { name: "Mostrador B" }, admB)).id;
    await ess.m("b", "products.createCategory", { slug: "servicios", name: "Servicios" }, admB);
    await ess.m("b", "products.createLocation", { slug: "local", name: "Local" }, admB);
    const [c] = await ess.sql("b", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("b", "SELECT id FROM locations LIMIT 1");
    await ess.m("b", "products.create", { slug: "servicio", title: "Servicio", categoryId: c.id, locationId: l.id, basePrice: "20.00", taxRate: "21" }, admB);
    productId = (await ess.sql("b", "SELECT id FROM experiences WHERE slug = 'servicio'"))[0].id;
    await ess.sql("b", "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [productId]);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("Essential: operadores, devoluciones autorizadas, informes por periodo, supervisión y consolidado se rechazan con su explicación", async () => {
    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Mostrador A" }, admA)).id;
    const r = await ess.m("a", "tpv.setRegisterOperators", { registerId: reg, operators: [] }, admA);
    expect(errCode(r)).toBe("FORBIDDEN");
    expect(r.json.error.json.message).toMatch(/plan Business/);
    expect((await ess.q("a", "tpv.reports.summary", { dateFrom: today(), dateTo: today() }, admA)).status).toBe(403);
    expect(errCode(await ess.m("a", "tpv.requestReturn", { saleId: 1, action: "cancel", reason: "Prueba de plan", idempotencyKey: key("x") }, admA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "tpv.supervision", undefined, admA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "cashRegister.reviewClosure", { closureId: 999999, notes: "x" }, admA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "cashRegister.acceptDifference", { closureId: 999999, notes: "x" }, admA))).toBe("FORBIDDEN");
    // El resumen diario y el historial siguen en Essential
    expect((await ess.q("a", "tpv.dailySummary", { day: today() }, admA)).status).toBe(200);
    expect((await ess.q("a", "tpv.getBackoffice", { page: 1, limit: 10 }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "tpv.listReturnRequests", undefined, admA)).enabled).toBe(false);
  });

  it("Business: con operadores asignados, solo ellos y la administración operan la caja", async () => {
    data(await ess.m("b", "tpv.setRegisterOperators", { registerId: regB, operators: [{ userId: ctlBId, role: "operator" }] }, admB));
    expect(errCode(await ess.m("b", "tpv.openSession", { registerId: regB, openingAmount: 0 }, agB))).toBe("FORBIDDEN");
    // Supervisor por caja: gestión avanzada de permisos (Enterprise)
    expect(errCode(await ess.m("b", "tpv.setRegisterOperators", { registerId: regB, operators: [{ userId: agBId, role: "supervisor" }] }, admB))).toBe("FORBIDDEN");
    const ops = data(await ess.m("b", "tpv.setRegisterOperators", { registerId: regB, operators: [{ userId: agBId, role: "operator" }] }, admB));
    expect(ops.map((o: any) => [o.userId, o.role])).toEqual([[agBId, "operator"]]);
    // Retirar no borra: queda con fecha
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_register_operators WHERE user_id = ? AND removed_at IS NOT NULL", [ctlBId]))[0].n).toBe(1);
    const s = data(await ess.m("b", "tpv.openSession", { registerId: regB, openingAmount: 0, idempotencyKey: key("ab") }, agB));
    expect(s.status).toBe("open");
    // La administración del TPV también puede operar
    expect((await ess.m("b", "tpv.addCashMovement", { sessionId: s.id, type: "in", amount: 5, reason: "Fondo" }, admB)).status).toBe(200);
  });

  it("Business: anulación autorizada idempotente; nadie se autoriza a sí mismo; dos aprobaciones a la vez ejecutan una", async () => {
    const [s] = await ess.sql("b", "SELECT id FROM cash_sessions WHERE registerId = ? AND status_cs = 'open'", [regB]);
    const sale = await sell(s.id, agB);
    const k = key("dev");
    const req = { saleId: sale.sale.id, action: "cancel", reason: "Cliente se equivocó de servicio", idempotencyKey: k };
    const r1 = data(await ess.m("b", "tpv.requestReturn", req, agB));
    const r2 = data(await ess.m("b", "tpv.requestReturn", req, agB));
    expect([r2.id, r1.status]).toEqual([r1.id, "pending"]);
    // Una sola pendiente por venta
    expect(errCode(await ess.m("b", "tpv.requestReturn", { ...req, idempotencyKey: key("otra") }, agB))).toBe("CONFLICT");
    // El operador no puede autorizar
    expect(errCode(await ess.m("b", "tpv.decideReturn", { id: r1.id, approve: true }, agB))).toBe("FORBIDDEN");
    const both = await Promise.all([ess.m("b", "tpv.decideReturn", { id: r1.id, approve: true }, admB), ess.m("b", "tpv.decideReturn", { id: r1.id, approve: true }, admB)]);
    expect(both.map((x) => x.status)).toEqual([200, 200]);
    expect((await ess.sql("b", "SELECT status_ts AS st FROM tpv_sales WHERE id = ?", [sale.sale.id]))[0].st).toBe("cancelled");
    expect(errCode(await ess.m("b", "tpv.decideReturn", { id: r1.id, approve: false }, admB))).toBe("CONFLICT");
    // Quien la pide no la autoriza
    const sale2 = await sell(s.id, admB);
    const own = data(await ess.m("b", "tpv.requestReturn", { saleId: sale2.sale.id, action: "refund", reason: "Devolución del cliente", idempotencyKey: key("own") }, admB));
    expect(errCode(await ess.m("b", "tpv.decideReturn", { id: own.id, approve: true }, admB))).toBe("FORBIDDEN");
    const list = data(await ess.q("b", "tpv.listReturnRequests", { status: "pending" }, admB));
    expect([list.enabled, list.canAuthorize, list.requests.map((x: any) => x.id)]).toEqual([true, true, [own.id]]);
  });

  it("Business: informes por periodo y supervisión de cierres sí; consolidado y supervisión centralizada no", async () => {
    expect((await ess.q("b", "tpv.reports.summary", { dateFrom: today(), dateTo: today() }, admB)).status).toBe(200);
    expect(errCode(await ess.m("b", "cashRegister.reviewClosure", { closureId: 999999, notes: "x" }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.q("b", "tpv.reports.consolidated", { dateFrom: today(), dateTo: today() }, admB))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("b", "tpv.supervision", undefined, admB))).toBe("FORBIDDEN");
  });

  it("Enterprise: supervisor por caja que autoriza, supervisión centralizada e informe consolidado", async () => {
    await ess.setCapability("b", "audit-advanced", "active"); // capacidad de Enterprise → plan Enterprise
    data(await ess.m("b", "tpv.setRegisterOperators", { registerId: regB, operators: [{ userId: agBId, role: "supervisor" }] }, admB));
    const [pending] = await ess.sql("b", "SELECT id FROM tpv_return_requests WHERE status = 'pending'");
    const ok = data(await ess.m("b", "tpv.decideReturn", { id: pending.id, approve: true, notes: "Revisado" }, agB));
    expect(ok.status).toBe("approved");
    expect((await ess.sql("b", "SELECT status_ts AS st FROM tpv_sales WHERE id = ?", [ok.saleId]))[0].st).toBe("refunded");
    const sup = data(await ess.q("b", "tpv.supervision", undefined, admB));
    expect(sup.sites[0].registers.find((r: any) => r.id === regB).openSession).not.toBeNull();
    // Las dos ventas anteriores se devolvieron o anularon: el consolidado solo cuenta lo cobrado que sigue en pie
    const [open] = await ess.sql("b", "SELECT id FROM cash_sessions WHERE registerId = ? AND status_cs = 'open'", [regB]);
    await sell(open.id, agB);
    const cons = data(await ess.q("b", "tpv.reports.consolidated", { dateFrom: today(), dateTo: today() }, admB));
    expect([cons.tickets, cons.total]).toEqual([1, 20]);
  });

  it("correcciones de una caja cerrada: ajuste aparte en la caja contable, enlazado, una sola vez", async () => {
    await ess.sql("b", "INSERT INTO fin_cash_accounts (name, type, current_balance, initial_balance) VALUES ('Caja', 'principal', 100, 100)");
    const [s] = await ess.sql("b", "SELECT id FROM cash_sessions WHERE registerId = ? AND status_cs = 'open'", [regB]);
    await ess.m("b", "tpv.closeSession", { sessionId: s.id, countedCash: 25, idempotencyKey: key("cierre") }, admB);
    const k = key("corr");
    const input = { sessionId: s.id, kind: "cash_out", amount: 4.5, reason: "Cambio entregado y no anotado", idempotencyKey: k };
    const both = await Promise.all([ess.m("b", "tpv.addClosedSessionCorrection", input, admB), ess.m("b", "tpv.addClosedSessionCorrection", input, admB)]);
    expect(both.map((x) => x.status)).toEqual([200, 200]);
    const [corr] = await ess.sql("b", "SELECT id, fin_movement_id FROM tpv_session_corrections WHERE idempotency_key = ?", [k]);
    const moves = await ess.sql("b", "SELECT id, type_fcm AS t, amount, category, related_entity_id, notes FROM fin_cash_movements WHERE category = 'cash_adjustment'");
    expect(moves).toHaveLength(1);
    expect([moves[0].id, moves[0].t, Number(moves[0].amount), moves[0].related_entity_id]).toEqual([corr.fin_movement_id, "expense", 4.5, corr.id]);
    expect(moves[0].notes).toMatch(/Cambio entregado y no anotado/);
    expect(Number((await ess.sql("b", "SELECT current_balance AS b FROM fin_cash_accounts WHERE type = 'principal'"))[0].b)).toBe(95.5);
    // El cierre no cambia
    const [snap] = await ess.sql("b", "SELECT counted_cash FROM tpv_session_closures WHERE session_id = ?", [s.id]);
    expect(Number(snap.counted_cash)).toBe(25);
    // Las dos devoluciones autorizadas sacaron su efectivo de la caja (salidas de tipo devolución, una vez cada una)
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM cash_movements WHERE idempotency_key LIKE 'dev-%' AND type_cm = 'out' AND amount = 20"))[0].n).toBe(2);
    expect(Number((await ess.sql("b", "SELECT cashDifference AS d FROM cash_sessions WHERE id = ?", [s.id]))[0].d)).toBe(0);
  });

  it("derecho adquirido: la siembra de la 0064 en una empresa Essential existente conserva informes y supervisión de cierres, también al renovar", async () => {
    // Se ejecuta la MISMA sentencia de siembra de la migración sobre A, que ya tiene usuarios (empresa existente)
    const mig = fs.readFileSync(path.join(__dirname, "../db/migrations/0064_tpv_business.sql"), "utf8");
    const seed = mig.slice(mig.lastIndexOf("INSERT INTO tpv_acquired_rights")).trim().replace(/;$/, "");
    await ess.sql("a", seed);
    await ess.sql("a", seed); // idempotente: no duplica
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_acquired_rights WHERE status = 'seeded' AND origin = 'migracion-0064'"))[0].n).toBe(3);
    expect((await ess.q("a", "tpv.reports.summary", { dateFrom: today(), dateTo: today() }, admA)).status).toBe(200);
    expect(errCode(await ess.m("a", "cashRegister.reviewClosure", { closureId: 999999, notes: "x" }, admA))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("a", "cashRegister.acceptDifference", { closureId: 999999, notes: "x" }, admA))).toBe("NOT_FOUND");
    // Confirmado con sus licencias (tenía la caja del plan) y trazado
    const rows = await ess.sql("a", "SELECT feature, origin, status, confirmed_at FROM tpv_acquired_rights ORDER BY feature");
    expect(rows.map((r: any) => [r.feature, r.origin, r.status, r.confirmed_at != null])).toEqual([
      ["cashDifferences", "migracion-0064", "granted", true],
      ["closureSupervision", "migracion-0064", "granted", true],
      ["detailedReports", "migracion-0064", "granted", true],
    ]);
    // Lo nuevo de Business no forma parte del derecho adquirido
    expect(errCode(await ess.m("a", "tpv.requestReturn", { saleId: 1, action: "cancel", reason: "Prueba de plan", idempotencyKey: key("y") }, admA))).toBe("FORBIDDEN");
    const info = data(await ess.q("a", "tpv.planInfo", undefined, admA));
    expect([info.plan.tier, info.acquired.features.sort()]).toEqual(["essential", ["cashDifferences", "closureSupervision", "detailedReports"]]);
    // Renovación (las licencias del plan se vuelven a aplicar): lo conserva
    await ess.markPaid("a");
    expect((await ess.q("a", "tpv.reports.summary", { dateFrom: today(), dateTo: today() }, admA)).status).toBe(200);
    // Aislamiento: B no recibe nada de A
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_acquired_rights"))[0].n).toBe(0);
  });

  it("bajar de plan: se conservan asignaciones y solicitudes y dejan de aplicarse", async () => {
    await ess.setCapability("b", "audit-advanced", null);
    await ess.setCapability("b", "reports-advanced", null);
    expect(data(await ess.q("b", "tpv.planInfo", undefined, admB)).plan.tier).toBe("essential");
    // Con la función fuera del plan, la asignación ya no restringe (y sigue guardada)
    const ctl = await ess.login("b", "controler");
    expect(ctl).toBeTruthy();
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_register_operators WHERE removed_at IS NULL"))[0].n).toBe(1);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_return_requests"))[0].n).toBe(2);
    expect(data(await ess.q("b", "tpv.listReturnRequests", undefined, admB)).enabled).toBe(false);
    // Essential nueva (sin derecho adquirido): sin informes por periodo
    expect((await ess.q("b", "tpv.reports.summary", { dateFrom: today(), dateTo: today() }, admB)).status).toBe(403);
  });
});
