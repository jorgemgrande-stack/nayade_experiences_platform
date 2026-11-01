/**
 * Informes del TPV con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas,
 * ventas con varios IVA, una anulación, un cierre con descuadre, filtro por caja y por fechas, exportación CSV,
 * permisos por rol y aislamiento entre empresas. Solo empresas sintéticas; ningún cobro real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type Co, type EssentialApp } from "./essentialApp.testkit";
import { madridDateKey } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("TPV — informes (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  const adm: Record<Co, string> = { a: "", b: "" };
  let agA = "";
  const today = madridDateKey();

  async function product(co: Co, slug: string, title: string, category: string, taxRate: string, price: string) {
    await ess.m(co, "products.createCategory", { slug: `cat-${slug}`, name: category }, adm[co]);
    const [c] = await ess.sql(co, "SELECT id FROM categories WHERE slug = ?", [`cat-${slug}`]);
    let [l] = await ess.sql(co, "SELECT id FROM locations LIMIT 1");
    if (!l) {
      await ess.m(co, "products.createLocation", { slug: "local", name: "Local" }, adm[co]);
      [l] = await ess.sql(co, "SELECT id FROM locations LIMIT 1");
    }
    await ess.m(co, "products.create", { slug, title, categoryId: c.id, locationId: l.id, basePrice: price, taxRate }, adm[co]);
    const id = (await ess.sql(co, "SELECT id FROM experiences WHERE slug = ?", [slug]))[0].id as number;
    await ess.sql(co, "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [id]);
    return id;
  }

  let regA1 = 0;
  let regA2 = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tpvinf");
    adm.a = await ess.login("a", "admin");
    adm.b = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    const corte = await product("a", "corte", "Corte de pelo", "Peluquería", "21", "100.00");
    const libro = await product("a", "libro", "Libro", "Librería", "4", "20.00");
    const cafe = await product("b", "cafe", "Café", "Bebidas", "10", "2.00");
    regA1 = data(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, adm.a)).id;
    regA2 = data(await ess.m("a", "tpv.createRegister", { name: "Terraza" }, adm.a)).id;
    const regB = data(await ess.m("b", "tpv.createRegister", { name: "Barra" }, adm.b)).id;

    // A · Mostrador: dos ventas (21 % y 4 %), una venta anulada después; cierre con 5 € de menos
    const s1 = data(await ess.m("a", "tpv.openSession", { registerId: regA1, openingAmount: 50 }, agA));
    const v1 = await ess.m("a", "tpv.createSale", {
      sessionId: s1.id,
      items: [{ productType: "experience", productId: corte, productName: "Corte de pelo", quantity: 1, unitPrice: 100 }],
      payments: [{ method: "cash", amount: 60 }, { method: "card", amount: 40 }],
    }, agA);
    expect(v1.status).toBe(200);
    expect((await ess.m("a", "tpv.createSale", {
      sessionId: s1.id,
      items: [{ productType: "experience", productId: libro, productName: "Libro", quantity: 2, unitPrice: 20 }],
      payments: [{ method: "bizum", amount: 40 }],
    }, agA)).status).toBe(200);
    const anulada = data(await ess.m("a", "tpv.createSale", {
      sessionId: s1.id,
      items: [{ productType: "experience", productId: corte, productName: "Corte de pelo", quantity: 1, unitPrice: 100 }],
      payments: [{ method: "card", amount: 100 }],
    }, agA));
    await ess.sql("a", "UPDATE tpv_sales SET status_ts = 'cancelled' WHERE id = ?", [anulada.sale.id]);
    // Esperado en efectivo: 50 + 60 = 110; se cuentan 105
    expect((await ess.m("a", "tpv.closeSession", { sessionId: s1.id, countedCash: 105 }, agA)).status).toBe(200);

    // A · Terraza: una venta, caja aún abierta
    const s2 = data(await ess.m("a", "tpv.openSession", { registerId: regA2, openingAmount: 0 }, agA));
    expect((await ess.m("a", "tpv.createSale", {
      sessionId: s2.id,
      items: [{ productType: "experience", productId: corte, productName: "Corte de pelo", quantity: 1, unitPrice: 100 }],
      payments: [{ method: "cash", amount: 100 }],
    }, agA)).status).toBe(200);

    // B · Barra: una venta y cierre cuadrado
    const sb = data(await ess.m("b", "tpv.openSession", { registerId: regB, openingAmount: 0 }, adm.b));
    expect((await ess.m("b", "tpv.createSale", {
      sessionId: sb.id,
      items: [{ productType: "experience", productId: cafe, productName: "Café", quantity: 3, unitPrice: 2 }],
      payments: [{ method: "cash", amount: 6 }],
    }, adm.b)).status).toBe(200);
    expect((await ess.m("b", "tpv.closeSession", { sessionId: sb.id, countedCash: 6 }, adm.b)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("empresa A: ventas netas, IVA, formas de pago, anulaciones y cierre con descuadre", async () => {
    const r = data(await ess.q("a", "tpv.reports.summary", { dateFrom: today, dateTo: today }, adm.a));
    expect(r.summary).toMatchObject({ tickets: 3, netSales: 240, averageTicket: 80, units: 4, voidedTickets: 1, voidedAmount: 100 });
    expect(r.byDay.map((d: any) => [d.date, d.tickets, d.netSales])).toEqual([[today, 3, 240]]);
    expect(r.byCategory.map((c: any) => [c.category, c.units, c.amount])).toEqual([["Peluquería", 2, 200], ["Librería", 2, 40]]);
    expect(r.byTaxRate.map((t: any) => [t.label, t.amount])).toEqual([["IVA 4 %", 40], ["IVA 21 %", 200]]);
    expect(r.byTaxRate.find((t: any) => t.label === "IVA 21 %").taxAmount).toBe(34.72); // 2 × 17,36 (cuota redondeada por línea)
    expect(Object.fromEntries(r.byPaymentMethod.map((m: any) => [m.method, m.amount]))).toEqual({ cash: 160, card: 40, bizum: 40 });
    expect(r.voids.map((v: any) => [v.statusLabel, v.amount])).toEqual([["Anulada", 100]]);
    expect(r.closures).toMatchObject({ count: 1, withDifference: 1, shortage: 5, surplus: 0 });
    expect(r.closures.sessions[0]).toMatchObject({ register: "Mostrador", expectedCash: 110, countedCash: 105, difference: -5 });
  });

  it("filtro por caja y por fechas", async () => {
    const terraza = data(await ess.q("a", "tpv.reports.summary", { dateFrom: today, dateTo: today, registerId: regA2 }, adm.a));
    expect([terraza.summary.tickets, terraza.summary.netSales, terraza.closures.count]).toEqual([1, 100, 0]);
    const ayer = madridDateKey(new Date(Date.now() - 2 * 86_400_000));
    const vacio = data(await ess.q("a", "tpv.reports.summary", { dateFrom: ayer, dateTo: ayer }, adm.a));
    expect([vacio.summary.tickets, vacio.closures.count]).toEqual([0, 0]);
    expect(errCode(await ess.q("a", "tpv.reports.summary", { dateFrom: today, dateTo: ayer }, adm.a))).toBe("BAD_REQUEST");
    expect(errCode(await ess.q("a", "tpv.reports.summary", { dateFrom: "2020-01-01", dateTo: "2026-01-01" }, adm.a))).toBe("BAD_REQUEST");
  });

  it("exportación CSV de una sección", async () => {
    const r = data(await ess.q("a", "tpv.reports.exportCsv", { dateFrom: today, dateTo: today, section: "cierres" }, adm.a));
    expect(r.filename).toBe(`tpv-cierres-${today}_${today}.csv`);
    expect(r.csv).toContain("\"Mostrador\"");
    expect(r.csv).toContain(";110,00;105,00;-5,00;");
  });

  it("solo administración: un cajero no ve los informes", async () => {
    expect(errCode(await ess.q("a", "tpv.reports.summary", { dateFrom: today, dateTo: today }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "tpv.reports.registers", undefined, agA))).toBe("FORBIDDEN");
  });

  it("aislamiento: cada empresa ve solo sus ventas, cajas y cierres", async () => {
    const b = data(await ess.q("b", "tpv.reports.summary", { dateFrom: today, dateTo: today }, adm.b));
    expect(b.summary).toMatchObject({ tickets: 1, netSales: 6, voidedTickets: 0 });
    expect(b.byProduct.map((p: any) => p.product)).toEqual(["Café"]);
    expect(b.closures.sessions.map((s: any) => s.register)).toEqual(["Barra"]);
    expect(data(await ess.q("b", "tpv.reports.registers", undefined, adm.b)).map((x: any) => x.name)).toEqual(["Barra"]);
    // Filtrar B por una caja que solo existe en A no trae nada de A
    const cruzado = data(await ess.q("b", "tpv.reports.summary", { dateFrom: today, dateTo: today, registerId: regA2 }, adm.b));
    expect([cruzado.summary.tickets, cruzado.closures.count]).toEqual([0, 0]);
    const a = data(await ess.q("a", "tpv.reports.summary", { dateFrom: today, dateTo: today }, adm.a));
    expect(a.byProduct.map((p: any) => p.product)).not.toContain("Café");
  });
});
