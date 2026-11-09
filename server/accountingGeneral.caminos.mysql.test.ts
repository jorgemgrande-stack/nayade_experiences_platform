/**
 * Contabilidad general por los CAMINOS REALES del Core (opt-in, REGISTRY_TEST_DATABASE_URL), sin datos insertados a
 * mano: ventas y movimientos de la caja del TPV (`tpv.createSale`, `tpv.addCashMovement` con cada tipo), anulaciones
 * (`dailyControl.cancelOperation`, `cancellations.cancelReservationDirect`), gastos (`financial.expenses.create`/`update`)
 * y la confirmación del IVA en la contabilidad (`accountingGeneral.confirmExpenseTax`).
 * Requisitos: cada movimiento de caja se contabiliza una vez y contra su contrapartida real, el puente de caja (555)
 * vuelve a cero en los casos normales y el IVA soportado sale solo de datos confirmados.
 * TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se fusionan las anteriores.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "accounting-general";
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!URL_)("Contabilidad general · caminos reales del Core (TPV, anulaciones y gastos)", () => {
  let ess: EssentialApp;
  let adA = "";
  let agA = "";
  let sessionId = 0;
  let productId = 0;
  let catId = 0;
  let ccId = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const sync = async () => {
    const s = ok(await ess.m("a", "accountingGeneral.sync", undefined, adA), "generar asientos");
    expect(s.errors).toEqual([]);
    return s;
  };
  const period = () => ({ from: `${today().slice(0, 4)}-01-01`, to: `${today().slice(0, 4)}-12-31` });
  const balance = async (code: string) => {
    const tb = ok(await ess.q("a", "accountingGeneral.trialBalance", period(), adA), "sumas y saldos");
    return tb.items.filter((r: any) => r.code === code).reduce((a: number, r: any) => a + r.balanceCents, 0);
  };
  const balances = async (codes: string[]) => Object.fromEntries(await Promise.all(codes.map(async (c) => [c, await balance(c)] as const)));
  const delta = async (before: Record<string, number>) => Object.fromEntries(await Promise.all(Object.keys(before).map(async (c) => [c, (await balance(c)) - before[c]] as const)));
  const cashSale = async (amount = 24.2) => ok(await ess.m("a", "tpv.createSale", { sessionId, items: [{ productType: "experience", productId, productName: "Escobillas", quantity: 1, unitPrice: amount }], payments: [{ method: "cash", amount }] }, agA), "venta en efectivo").sale;
  const move = async (input: Record<string, unknown>) => ok(await ess.m("a", "tpv.addCashMovement", { sessionId, ...input }, agA), "movimiento de caja");
  /** El gasto de una retirada del TPV se crea en segundo plano: se espera a que aparezca enlazado con su movimiento. */
  const tpvExpense = async (concept: string) => {
    for (let i = 0; i < 40; i++) {
      const [e] = await ess.sql("a", "SELECT x.id, x.date FROM expenses x JOIN acc_cash_movement_kinds k ON k.expense_id = x.id WHERE x.source = 'tpv' AND x.concept LIKE ?", [`%${concept}%`]);
      if (e) return e; // creado y enlazado con su movimiento
      await sleep(150);
    }
    return null;
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "contabcaminos");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    await ess.setCapability("a", CAP, "active");
    ok(await ess.m("a", "products.createCategory", { slug: "general", name: "General" }, adA), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, adA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("a", "products.create", { slug: "escobillas", title: "Escobillas", categoryId: c.id, locationId: l.id, basePrice: "24.20", taxRate: "21", productType: "own" }, adA), "producto");
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'escobillas'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    // Datos maestros de Gastos (la categoría que usa el TPV para sus retiradas y un centro de coste)
    await ess.sql("a", "INSERT INTO expense_categories (name) VALUES ('Salidas de caja')");
    await ess.sql("a", "INSERT INTO cost_centers (name) VALUES ('General')");
    catId = (await ess.sql("a", "SELECT id FROM expense_categories WHERE name = 'Salidas de caja'"))[0].id;
    ccId = (await ess.sql("a", "SELECT id FROM cost_centers WHERE name = 'General'"))[0].id;
    const registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, adA), "caja").id;
    sessionId = ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA), "abrir caja").id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  /** Gasto del TPV sin esperar enlace (sin la contabilidad en uso no se enlaza nada). */
  const coreTpvExpense = async (concept: string) => {
    for (let i = 0; i < 40; i++) {
      const [e] = await ess.sql("a", "SELECT id FROM expenses WHERE source = 'tpv' AND concept LIKE ?", [`%${concept}%`]);
      if (e) return e;
      await sleep(150);
    }
    return null;
  };
  const kindOf = async (movementId: number) => {
    const r = await ess.sql("a", "SELECT kind FROM acc_cash_movement_kinds WHERE movement_id = ?", [movementId]);
    return r.length ? r[0].kind : "sin fila";
  };

  it("con la licencia pero la contabilidad sin iniciar (como la instalación única): el TPV y su modal son los de siempre", async () => {
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_settings")).toEqual([{ n: 0 }]);
    expect(ok(await ess.q("a", "tpv.cashMovementMode", undefined, agA), "modo")).toEqual({ typed: false });
    expect((await ess.m("a", "tpv.addCashMovement", { sessionId, type: "out", amount: 1, reason: "x", outKind: "devolucion" }, agA)).status).toBe(400);
    const mv = await move({ type: "out", amount: 1, reason: "Devolución en efectivo (sin contabilidad)", outKind: "gasto" });
    expect(await coreTpvExpense("Devolución en efectivo (sin contabilidad)")).not.toBeNull(); // crea el gasto, como siempre
    expect(await kindOf(mv.id)).toBe("sin fila"); // nada de la contabilidad: ni fila de tipo ni enlace
    // Al iniciar la contabilidad (primera generación), el modal pide el tipo
    await sync();
    expect(ok(await ess.q("a", "tpv.cashMovementMode", undefined, agA), "modo")).toEqual({ typed: true });
  });

  it("si el registro de licencias falla, el TPV se comporta como siempre (sin tipos), sin fallar", async () => {
    const { getCapabilityAccess } = await import("./_core/capabilities/access");
    const access = getCapabilityAccess();
    const original = access.check.bind(access);
    // Solo falla la consulta de la licencia de la contabilidad (el resto del panel sigue funcionando)
    const spy = vi.spyOn(access, "check").mockImplementation((cap, o) => (cap === "accounting-general" ? Promise.reject(new Error("registro de licencias caído")) : original(cap, o)));
    try {
      expect((await ess.m("a", "tpv.addCashMovement", { sessionId, type: "out", amount: 1, reason: "x", outKind: "devolucion" }, agA)).status).toBe(400);
      const mv = await move({ type: "out", amount: 1, reason: "Hielo con el registro caído", outKind: "gasto" });
      expect(await coreTpvExpense("Hielo con el registro caído")).not.toBeNull();
      expect(await kindOf(mv.id)).toBe("sin fila");
    } finally {
      spy.mockRestore();
    }
    // Si falla la consulta de acc_settings (tabla no disponible), también como siempre
    await ess.sql("a", "RENAME TABLE acc_settings TO acc_settings_fuera");
    try {
      expect(ok(await ess.q("a", "tpv.cashMovementMode", undefined, agA), "modo")).toEqual({ typed: false });
      const mv2 = await move({ type: "out", amount: 1, reason: "Hielo sin acc_settings", outKind: "gasto" });
      expect(await coreTpvExpense("Hielo sin acc_settings")).not.toBeNull();
      expect(await kindOf(mv2.id)).toBe("sin fila");
    } finally {
      await ess.sql("a", "RENAME TABLE acc_settings_fuera TO acc_settings");
    }
    await sync(); // las pruebas siguientes parten de todo contabilizado
  });


  const count = async (q: string, p: unknown[] = []) => Number((await ess.sql("a", q, p))[0].n);

  it("retirada de tipo gasto: la caja baja una vez, el 555 vuelve a cero y sin IVA sin confirmar (aunque el Core la marque «revisada»)", async () => {
    const b = await balances(["570", "555", "472"]);
    await move({ type: "out", amount: 30, reason: "Compra de hielo", outKind: "gasto" });
    const e = await tpvExpense("Compra de hielo");
    expect(e).not.toBeNull();
    await sync();
    expect(await delta(b)).toEqual({ "570": -3000, "555": 0, "472": 0 });
    // Editarla en Gastos con un 21 %: el Core la marca «revisada» como siempre, pero la contabilidad no deduce sin confirmar
    ok(await ess.m("a", "financial.expenses.update", { id: e.id, date: e.date, concept: "Retirada de caja TPV — Compra de hielo", amount: "30.00", categoryId: catId, costCenterId: ccId, paymentMethod: "cash", taxRate: "21" }, adA), "editar el gasto");
    expect((await ess.sql("a", "SELECT fiscalReviewStatus FROM expenses WHERE id = ?", [e.id]))[0].fiscalReviewStatus).toBe("revisado");
    await sync();
    expect(await delta(b)).toEqual({ "570": -3000, "555": 0, "472": 0 });
  });

  it("«Reembolso de gasolina» elegido como gasto sigue creando el gasto y contabilizándose como gasto (el motivo no pisa el tipo)", async () => {
    const b = await balances(["570", "555", "629"]);
    await move({ type: "out", amount: 15, reason: "Reembolso de gasolina", outKind: "gasto" });
    expect(await tpvExpense("Reembolso de gasolina")).not.toBeNull();
    await sync();
    expect(await delta(b)).toEqual({ "570": -1500, "555": 0, "629": 1500 });
  });

  it("venta en efectivo anulada (control diario) y devuelta con «Devolución» elegida por el cajero: sin gasto y sin 555", async () => {
    const b = await balances(["570", "555", "430", "700", "477"]);
    const s = await cashSale(24.2);
    await sync();
    expect((await delta(b))["570"]).toBe(2420);
    ok(await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id: s.id }, adA), "anular la venta");
    await move({ type: "out", amount: 24.2, reason: "Devolución efectivo", outKind: "devolucion" });
    await sleep(800);
    expect(await count("SELECT COUNT(*) AS n FROM expenses WHERE concept LIKE '%Devolución efectivo%'")).toBe(0);
    await sync();
    expect(await delta(b)).toEqual({ "570": 0, "555": 0, "430": 0, "700": 0, "477": 0 });
  });

  it("devolución por API sin tipo: el TPV crea el gasto como siempre; la contabilidad la trata como devolución y la marca para revisar", async () => {
    const b = await balances(["570", "555", "430", "629"]);
    const s = await cashSale(12.1);
    await sync();
    ok(await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id: s.id }, adA), "anular la venta");
    const mv = await move({ type: "out", amount: 12.1, reason: "Devolución ticket API" }); // sin outKind
    const e = await tpvExpense("Devolución ticket API");
    expect(e).not.toBeNull(); // el Core no cambia
    const r = await sync();
    expect(r.review.map((x: any) => x.key)).toEqual(expect.arrayContaining([`gasto:${e.id}`, `cajamov:${mv.id}`]));
    expect(await delta(b)).toEqual({ "570": 0, "555": 0, "430": 0, "629": 0 });
  });

  it("anulación sin salida de efectivo (anulaciones, compensación con bono): no toca la caja ni el 555", async () => {
    const b = await balances(["570", "555", "430", "700"]);
    const s = await cashSale(12.1);
    await sync();
    const [sale] = await ess.sql("a", "SELECT reservationId FROM tpv_sales WHERE id = ?", [s.id]);
    expect(sale.reservationId).toBeTruthy();
    ok(await ess.m("a", "cancellations.cancelReservationDirect", { reservationId: sale.reservationId, reason: "desistimiento", compensationType: "bono" }, adA), "anular con bono");
    expect((await ess.sql("a", "SELECT status_ts AS s FROM tpv_sales WHERE id = ?", [s.id]))[0].s).toBe("cancelled");
    await sync();
    expect(await delta(b)).toEqual({ "570": 1210, "555": 0, "430": -1210, "700": 0 });
  });

  it("traspaso a la Caja Central y fondo desde ella: contra la Caja Central (5701, subcuenta de la 570), nunca el 555", async () => {
    const b = await balances(["570", "5701", "555"]);
    await move({ type: "out", amount: 50, reason: "Cambio de caja", outKind: "traspaso" });
    await sync();
    expect(await delta(b)).toEqual({ "570": -5000, "5701": 5000, "555": 0 });
    await move({ type: "in", amount: 50, reason: "Fondo adicional", inKind: "fondo" });
    await sync();
    expect(await delta(b)).toEqual({ "570": 0, "5701": 0, "555": 0 });
    expect((await ess.sql("a", "SELECT parent_code FROM acc_accounts WHERE code = '5701'"))[0].parent_code).toBe("570");
  });

  it("entrada de un cobro pendiente: contra clientes", async () => {
    const b = await balances(["570", "430", "555"]);
    await move({ type: "in", amount: 10, reason: "Cobro pendiente", inKind: "cobro" });
    await sync();
    expect(await delta(b)).toEqual({ "570": 1000, "430": -1000, "555": 0 });
  });

  it("IVA solo confirmado en la contabilidad: el gasto del Core no cambia; sin confirmar, sin IVA; confirmado, su IVA; si cambia, otra vez sin", async () => {
    const b = await balances(["472"]);
    const base = { date: today(), concept: "Material QA", amount: "121.00", categoryId: catId, costCenterId: ccId, paymentMethod: "transfer" };
    const { id } = ok(await ess.m("a", "financial.expenses.create", base, adA), "crear gasto");
    // El Core guarda su desglose como siempre (21 % si no llega el tipo)
    const [row] = await ess.sql("a", "SELECT taxRate, taxBase, taxAmount, fiscalReviewStatus FROM expenses WHERE id = ?", [id]);
    expect([Number(row.taxRate), Number(row.taxBase), Number(row.taxAmount), row.fiscalReviewStatus]).toEqual([21, 100, 21, "revisado"]);
    const s1 = await sync();
    expect(s1.review.find((r: any) => r.key === `gasto:${id}`)).toMatchObject({ expenseId: id, canConfirm: true });
    expect((await delta(b))["472"]).toBe(0);
    // Confirmado con la factura: su IVA, sin tocar el gasto
    ok(await ess.m("a", "accountingGeneral.confirmExpenseTax", { expenseId: id, confirmed: true }, adA), "confirmar IVA");
    expect(await ess.sql("a", "SELECT taxRate, taxBase, taxAmount, fiscalReviewStatus FROM expenses WHERE id = ?", [id])).toEqual([row]);
    await sync();
    expect((await delta(b))["472"]).toBe(2100);
    // Pasa a «sin factura»: la confirmación deja de valer y no se puede confirmar
    ok(await ess.m("a", "financial.expenses.update", { id, ...base, taxRate: "21", invoiceType: "sin_factura" }, adA), "sin factura");
    await sync();
    expect((await delta(b))["472"]).toBe(0);
    expect((await ess.m("a", "accountingGeneral.confirmExpenseTax", { expenseId: id, confirmed: true }, adA)).status).toBe(409);
  });

  it("al final, el puente de caja (555) está a cero y todo cuadra", async () => {
    expect(await balance("555")).toBe(0);
    expect(ok(await ess.q("a", "accountingGeneral.overview", undefined, adA), "resumen").balanced).toBe(true);
  });

  it("entrada sin tipo (por API): al puente de caja y para revisar, nunca a la Caja Central", async () => {
    const b = await balances(["570", "5701", "555"]);
    const mv = await move({ type: "in", amount: 5, reason: "Fondo adicional" });
    const r = await sync();
    expect(r.review.map((x: any) => x.key)).toContain(`cajamov:${mv.id}`);
    expect(await delta(b)).toEqual({ "570": 500, "5701": 0, "555": -500 });
  });

  it("sin la 0060 (sin acc_cash_movement_kinds): el movimiento se guarda igual y solo se avisa una vez", async () => {
    await ess.sql("a", "DROP TABLE acc_cash_movement_kinds");
    const warn = vi.spyOn(console, "warn");
    try {
      const before = await count("SELECT COUNT(*) AS n FROM cash_movements");
      const m1 = await move({ type: "out", amount: 2, reason: "Hielo sin 0060", outKind: "gasto" });
      const m2 = await move({ type: "in", amount: 2, reason: "Fondo sin 0060", inKind: "fondo" });
      expect([m1.id, m2.id].every(Boolean)).toBe(true);
      expect(await count("SELECT COUNT(*) AS n FROM cash_movements")).toBe(before + 2);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("0060")).length).toBe(1);
      // El TPV sigue creando el gasto de la retirada
      let n = 0;
      for (let i = 0; i < 40 && n === 0; i++) {
        await sleep(150);
        n = await count("SELECT COUNT(*) AS n FROM expenses WHERE concept LIKE '%Hielo sin 0060%'");
      }
      expect(n).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});
