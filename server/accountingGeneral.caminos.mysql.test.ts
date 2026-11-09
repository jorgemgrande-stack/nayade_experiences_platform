/**
 * Contabilidad general por los CAMINOS REALES del Core (opt-in, REGISTRY_TEST_DATABASE_URL), sin datos insertados a
 * mano: ventas y movimientos de la caja del TPV (`tpv.createSale`, `tpv.addCashMovement` con cada tipo), anulaciones
 * (`dailyControl.cancelOperation`, `cancellations.cancelReservationDirect`) y gastos (`expenses.create`/`update`).
 * Requisitos: cada movimiento de caja se contabiliza una vez y contra su contrapartida real, el puente de caja (555)
 * vuelve a cero en los casos normales y el IVA soportado sale solo de datos confirmados.
 * TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se fusionan las anteriores.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  /** El gasto de una retirada del TPV se crea en segundo plano: se espera a que aparezca. */
  const tpvExpense = async (concept: string) => {
    for (let i = 0; i < 40; i++) {
      const [e] = await ess.sql("a", "SELECT id, date FROM expenses WHERE source = 'tpv' AND concept LIKE ?", [`%${concept}%`]);
      if (e) return e;
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
    await sync();
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("retirada de tipo gasto: la caja baja una vez, el 555 vuelve a cero, sin IVA inventado y con la fecha de Madrid", async () => {
    const b = await balances(["570", "555", "472"]);
    await move({ type: "out", amount: 30, reason: "Compra de hielo", outKind: "gasto" });
    const e = await tpvExpense("Compra de hielo");
    expect(e).not.toBeNull();
    expect(e.date).toBe(today());
    await sync();
    expect(await delta(b)).toEqual({ "570": -3000, "555": 0, "472": 0 });
    // Editarla en Gastos con un tipo de IVA pero sin confirmar el desglose no deduce nada
    ok(await ess.m("a", "financial.expenses.update", { id: e.id, date: e.date, concept: "Retirada de caja TPV — Compra de hielo", amount: "30.00", categoryId: catId, costCenterId: ccId, paymentMethod: "cash", taxRate: "21" }, adA), "editar el gasto");
    expect((await ess.sql("a", "SELECT fiscalReviewStatus FROM expenses WHERE id = ?", [e.id]))[0].fiscalReviewStatus).toBe("pendiente");
    await sync();
    expect(await delta(b)).toEqual({ "570": -3000, "555": 0, "472": 0 });
  });

  it("venta en efectivo anulada (control diario) y devuelta con la opción por defecto «gasto»: ni gasto falso ni 555", async () => {
    const b = await balances(["570", "555", "430", "700", "477"]);
    const s = await cashSale(24.2);
    await sync();
    expect((await delta(b))["570"]).toBe(2420);
    ok(await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id: s.id }, adA), "anular la venta");
    // El cajero devuelve el efectivo con la opción que el TPV traía por defecto (gasto) y el motivo rápido
    await move({ type: "out", amount: 24.2, reason: "Devolución efectivo", outKind: "gasto" });
    await sleep(800);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM expenses WHERE concept LIKE '%Devolución efectivo%'")).toEqual([{ n: 0 }]);
    await sync();
    expect(await delta(b)).toEqual({ "570": 0, "555": 0, "430": 0, "700": 0, "477": 0 });
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
    // El efectivo sigue en el cajón; queda a favor del cliente (430) y la venta deja de contar
    expect(await delta(b)).toEqual({ "570": 1210, "555": 0, "430": -1210, "700": 0 });
  });

  it("traspaso a la Caja Central y fondo desde ella: contra la Caja Central (5701), nunca el 555", async () => {
    const b = await balances(["570", "5701", "555"]);
    await move({ type: "out", amount: 50, reason: "Cambio de caja", outKind: "traspaso" });
    await sync();
    expect(await delta(b)).toEqual({ "570": -5000, "5701": 5000, "555": 0 });
    await move({ type: "in", amount: 20, reason: "Fondo adicional", inKind: "fondo" });
    await move({ type: "in", amount: 30, reason: "Reposición caja" }); // sin tipo: fondo
    await sync();
    expect(await delta(b)).toEqual({ "570": 0, "5701": 0, "555": 0 });
  });

  it("entrada de un cobro pendiente: contra clientes", async () => {
    const b = await balances(["570", "430", "555"]);
    await move({ type: "in", amount: 10, reason: "Cobro pendiente", inKind: "cobro" });
    await sync();
    expect(await delta(b)).toEqual({ "570": 1000, "430": -1000, "555": 0 });
  });

  it("IVA solo de datos confirmados (expenses.create/update): sin tipo, sin IVA; confirmado, su IVA; sin factura, nunca", async () => {
    const b = await balances(["472"]);
    const base = { date: today(), concept: "Material QA", amount: "110.00", categoryId: catId, costCenterId: ccId, paymentMethod: "transfer" };
    const { id } = ok(await ess.m("a", "financial.expenses.create", base, adA), "crear gasto sin tipo");
    const [row] = await ess.sql("a", "SELECT taxBase, taxAmount, fiscalReviewStatus FROM expenses WHERE id = ?", [id]);
    expect(row).toEqual({ taxBase: null, taxAmount: null, fiscalReviewStatus: "pendiente" });
    const s1 = await sync();
    expect(s1.review.map((r: any) => r.key)).toContain(`gasto:${id}`);
    expect((await delta(b))["472"]).toBe(0);
    // Con tipo y desglose confirmado: su IVA real (10 %)
    ok(await ess.m("a", "financial.expenses.update", { id, ...base, taxRate: "10", invoiceType: "ordinaria", taxReviewed: true }, adA), "confirmar el desglose");
    await sync();
    expect((await delta(b))["472"]).toBe(1000);
    // Sin factura: aunque se marque, nunca deduce
    ok(await ess.m("a", "financial.expenses.update", { id, ...base, taxRate: "10", invoiceType: "sin_factura", taxReviewed: true }, adA), "sin factura");
    expect((await ess.sql("a", "SELECT fiscalReviewStatus FROM expenses WHERE id = ?", [id]))[0].fiscalReviewStatus).toBe("pendiente");
    const s3 = await sync();
    expect((await delta(b))["472"]).toBe(0);
    expect(s3.review.map((r: any) => r.key)).not.toContain(`gasto:${id}`);
  });

  it("al final, el puente de caja (555) está a cero y todo cuadra", async () => {
    expect(await balance("555")).toBe(0);
    expect(ok(await ess.q("a", "accountingGeneral.overview", undefined, adA), "resumen").balanced).toBe(true);
  });
});
