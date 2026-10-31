/**
 * TPV de cualquier comercio con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): selección de
 * caja, catálogo por categorías propias, pago dividido, venta atómica, cierre con anulaciones, cierre simultáneo,
 * búsqueda de clientes y aislamiento entre empresas. Solo empresas sintéticas nuevas; ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("TPV — venta y caja (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let agA: string;
  let agB: string;
  let admB: string;
  let productId = 0;
  let reg1 = 0;
  let reg2 = 0;

  const item = (o: Record<string, unknown> = {}) => ({ productType: "experience", productId, productName: "Corte de pelo", quantity: 1, unitPrice: 100, ...o });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpv");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    agB = await ess.login("b", "agente");
    await ess.m("a", "products.createCategory", { slug: "peluqueria", name: "Peluquería" }, admA);
    await ess.m("a", "products.createCategory", { slug: "sin-uso", name: "Sin productos" }, admA);
    await ess.m("a", "products.createLocation", { slug: "local", name: "Local" }, admA);
    const [c] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'peluqueria'");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    await ess.m("a", "products.create", { slug: "corte", title: "Corte de pelo", categoryId: c.id, locationId: l.id, basePrice: "100.00", taxRate: "21" }, admA);
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'corte'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [productId]);
    reg1 = data(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA)).id;
    reg2 = data(await ess.m("a", "tpv.createRegister", { name: "Terraza" }, admA)).id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("selector de caja: estado por caja; abrir una no abre la otra; B no ve las cajas de A", async () => {
    const before = data(await ess.q("a", "tpv.getRegisterStatus", undefined, agA));
    expect(before.map((r: any) => [r.name, r.openSession])).toEqual([["Mostrador", null], ["Terraza", null]]);
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg2, openingAmount: 0 }, agA));
    const after = data(await ess.q("a", "tpv.getRegisterStatus", undefined, agA));
    expect(after.find((r: any) => r.id === reg2).openSession.id).toBe(s.id);
    expect(after.find((r: any) => r.id === reg1).openSession).toBeNull();
    expect(data(await ess.q("a", "tpv.getActiveSession", { registerId: reg1 }, agA))).toBeNull();
    // Aislamiento: B no ve las cajas ni la sesión de A, ni puede cerrarla
    expect(data(await ess.q("b", "tpv.getRegisterStatus", undefined, agB))).toEqual([]);
    expect(data(await ess.q("b", "tpv.getActiveSession", { registerId: reg2 }, agB))).toBeNull();
    expect(errCode(await ess.m("b", "tpv.closeSession", { sessionId: s.id, countedCash: 0 }, agB))).toBe("NOT_FOUND");
    expect((await ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 0 }, agA)).status).toBe(200);
  });

  it("catálogo de una pyme: sus categorías con productos, sin lo sectorial no contratado (ni en la vista ni al cobrar)", async () => {
    const cat = data(await ess.q("a", "tpv.getCatalog", undefined, agA));
    expect(cat.licensed).toBe(true);
    expect(cat.categories.map((c: any) => c.name)).toEqual(["Peluquería"]);
    expect(cat.experiences.map((e: any) => e.title)).toEqual(["Corte de pelo"]);
    expect([cat.packs, cat.legoPacks, cat.spa, cat.hotel]).toEqual([[], [], [], []]);
    expect(data(await ess.q("b", "tpv.getCatalog", undefined, agB)).experiences).toEqual([]);
    // Sin contratar no se vende aunque el cliente lo pida
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg1, openingAmount: 0 }, agA));
    expect(errCode(await ess.m("a", "tpv.createSale", { sessionId: s.id, items: [item({ productType: "hotel" })], payments: [{ method: "card", amount: 100 }] }, agA))).toBe("FORBIDDEN");
    await ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 0 }, agA);
  });

  it("venta con pago dividido efectivo/tarjeta/Bizum y concepto libre con IVA general; resumen y cierre cuadran", async () => {
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg1, openingAmount: 50 }, agA));
    const sale = await ess.m("a", "tpv.createSale", {
      sessionId: s.id,
      customerName: "Lucía Pérez", customerEmail: "lucia@cliente-a.example",
      items: [item(), { productType: "extra", productId: 0, productName: "Tinte", quantity: 1, unitPrice: 20, isManual: true, conceptText: "Tinte" }],
      payments: [{ method: "cash", amount: 40 }, { method: "card", amount: 50 }, { method: "bizum", amount: 30 }],
    }, admA);
    expect(sale.status).toBe(200);
    expect(data(sale).sale.status).toBe("paid");
    expect(data(sale).payments).toHaveLength(3);
    const lines = await ess.sql("a", "SELECT fiscalRegime_tsi AS fiscalRegime FROM tpv_sale_items WHERE saleId = ? ORDER BY id", [data(sale).sale.id]);
    expect(lines.map((x: any) => x.fiscalRegime)).toEqual(["general", "general"]);
    const sum = data(await ess.q("a", "tpv.getSessionSummary", { sessionId: s.id }, agA));
    expect([sum.totalCash, sum.totalCard, sum.totalBizum]).toEqual([40, 50, 30]);
    const closed = data(await ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 90 }, agA));
    expect(Number(closed.cashDifference)).toBe(0);
    // El cliente queda en el CRM de A y se encuentra al cobrar; B no lo ve
    expect(data(await ess.q("a", "tpv.searchClients", { q: "lucia" }, agA)).map((c: any) => c.email)).toEqual(["lucia@cliente-a.example"]);
    expect(data(await ess.q("b", "tpv.searchClients", { q: "lucia" }, agB))).toEqual([]);
    expect(errCode(await ess.q("a", "tpv.searchClients", { q: "lu" }, agA))).toBe("BAD_REQUEST");
  });

  it("cierre con una anulación parcial: venta de 100 € y devolución de 30 € en efectivo deja descuadre 0", async () => {
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg1, openingAmount: 0 }, agA));
    const sale = data(await ess.m("a", "tpv.createSale", { sessionId: s.id, items: [item()], payments: [{ method: "cash", amount: 100 }] }, agA));
    // La venta se anula (devolución) y lo devuelto sale del cajón como salida manual
    await ess.sql("a", "UPDATE tpv_sales SET status_ts = 'refunded' WHERE id = ?", [sale.sale.id]);
    expect((await ess.m("a", "tpv.addCashMovement", { sessionId: s.id, type: "out", amount: 30, reason: "Devolución parcial", outKind: "traspaso" }, agA)).status).toBe(200);
    const sum = data(await ess.q("a", "tpv.getSessionSummary", { sessionId: s.id }, agA));
    expect(sum.totalCash).toBe(100);
    const closed = data(await ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 70 }, agA));
    expect(Number(closed.cashDifference)).toBe(0);
    expect(Number(closed.closingAmount)).toBe(70);
  });

  it("dos cierres a la vez dejan un solo cierre; no se cobra en una caja cerrada", async () => {
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg1, openingAmount: 10 }, agA));
    const [r1, r2] = await Promise.all([
      ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 10 }, agA),
      ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 10 }, agA),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM fin_cash_closures WHERE source_entity_type = 'tpv_session' AND source_entity_id = ?", [s.id]))[0].n).toBeLessThanOrEqual(1);
    const n = (await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n;
    expect(errCode(await ess.m("a", "tpv.createSale", { sessionId: s.id, items: [item()], payments: [{ method: "cash", amount: 100 }] }, agA))).toBe("CONFLICT");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(n);
  });

  it("venta atómica: si falla al grabarla no queda nada a medias y la venta queda anulada con motivo", async () => {
    const s = data(await ess.m("a", "tpv.openSession", { registerId: reg1, openingAmount: 0 }, agA));
    const resBefore = (await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n;
    // eventTime supera la columna (varchar 10): el INSERT de la línea falla dentro de la transacción
    const r = await ess.m("a", "tpv.createSale", { sessionId: s.id, items: [item({ eventTime: "x".repeat(40) })], payments: [{ method: "card", amount: 100 }] }, agA);
    expect(errCode(r)).toBe("INTERNAL_SERVER_ERROR");
    expect(r.json.error.json.message).toMatch(/no se ha registrado/);
    const [sale] = await ess.sql("a", "SELECT id, status_ts AS status, notes FROM tpv_sales ORDER BY id DESC LIMIT 1");
    expect(sale.status).toBe("cancelled");
    expect(sale.notes).toMatch(/VENTA NO REGISTRADA/);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sale_items WHERE saleId = ?", [sale.id]))[0].n).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sale_payments WHERE saleId = ?", [sale.id]))[0].n).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions WHERE tpvSaleId = ?", [sale.id]))[0].n).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(resBefore);
    // La venta fallida no cuenta en la caja
    const sum = data(await ess.q("a", "tpv.getSessionSummary", { sessionId: s.id }, agA));
    expect([sum.sales.length, sum.totalCard]).toEqual([0, 0]);
    await ess.m("a", "tpv.closeSession", { sessionId: s.id, countedCash: 0 }, agA);
    void admB;
  });
});
