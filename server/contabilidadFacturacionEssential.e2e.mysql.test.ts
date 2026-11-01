/**
 * Contabilidad y facturación de una empresa Essential con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Empresas sintéticas nuevas; ningún cobro real.
 *  - Contabilidad › Resumen: vacío con guía, y con datos reales (ventas, cobros, facturas, gastos, categorías);
 *    lo que no está contratado no se consulta.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33441/registro_test \
 *     pnpm vitest run server/contabilidadFacturacionEssential.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, isLicenseDenied, type EssentialApp, type Res } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!URL_)("contabilidad y facturación Essential (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let productId = 0;
  let product10Id = 0;
  let registerId = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const item = (o: Record<string, unknown> = {}) => ({ productType: "experience", productId, productName: "Asesoría fiscal", quantity: 1, unitPrice: 121, ...o });
  const openSession = async () => ok(await ess.m("a", "tpv.openSession", { registerId, openingAmount: 0 }, agA), "abrir caja").id as number;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "contab");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "asesoria", name: "Asesoría" }, admA), "categoría");
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, admA), "categoría 2");
    ok(await ess.m("a", "products.createLocation", { slug: "oficina", name: "Oficina" }, admA), "lugar");
    const [c] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'asesoria'");
    const [c2] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'formacion'");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    ok(await ess.m("a", "products.create", { slug: "asesoria-fiscal", title: "Asesoría fiscal", categoryId: c.id, locationId: l.id, basePrice: "121.00", taxRate: "21" }, admA), "producto");
    ok(await ess.m("a", "products.create", { slug: "curso", title: "Curso", categoryId: c2.id, locationId: l.id, basePrice: "110.00", taxRate: "10" }, admA), "producto 10");
    productId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'asesoria-fiscal'"))[0].id;
    product10Id = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'curso'"))[0].id;
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1");
    registerId = ok(await ess.m("a", "tpv.createRegister", { name: "Mostrador" }, admA), "caja").id;
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  describe("Contabilidad › Resumen", () => {
    it("empresa vacía: sin datos (la pantalla guía) y sin consultar lo no contratado", async () => {
      const s = ok(await ess.q("a", "accounting.getSummary", { withQuotes: true }, admA), "resumen");
      expect(s.hasData).toBe(false);
      expect(s.months).toHaveLength(6);
      expect(s.categories).toEqual([]);
      expect(s.pendingQuotes).toBe(0);
      expect(ok(await ess.q("a", "accounting.getTransactions", { limit: 20, offset: 0 }, admA), "cobros")).toEqual([]);
      // Lo que la pantalla ya no pide en Essential: sin el módulo, el servidor lo rechaza
      expect(isLicenseDenied(await ess.q("a", "gestoria.executiveSummary", { year: 2026 }, admA), "tax-filings")).toBe(true);
      expect(isLicenseDenied(await ess.q("a", "bankMovements.getCashflowForecast", undefined, admA), "bank-import-pos")).toBe(true);
      expect(isLicenseDenied(await ess.q("a", "cardTerminalBatches.getReconciliationStats", undefined, admA), "bank-import-pos")).toBe(true);
    });

    it("con datos: ventas y cobros de caja, factura y gasto del mes, y ventas por la categoría real del producto", async () => {
      const sid = await openSession();
      // 121 € de asesoría + 110 € de curso, 23,10 € de descuento → 207,90 € en efectivo
      ok(await ess.m("a", "tpv.createSale", { sessionId: sid, discountAmount: 23.1, items: [item(), item({ productId: product10Id, productName: "Curso", quantity: 2, unitPrice: 55 })], payments: [{ method: "cash", amount: 207.9 }] }, agA), "venta");
      await ess.m("a", "tpv.closeSession", { sessionId: sid, countedCash: 207.9 }, agA);
      ok(await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente factura" }, pricesIncludeTax: false, lines: [{ description: "Informe", quantity: 1, unitPrice: 100, taxRate: 21 }] }, agA), "factura libre");
      const today = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
      const [cc] = await ess.sql("a", "SELECT id FROM cost_centers LIMIT 1").catch(() => [{ id: 1 }]);
      await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId) VALUES (?, 'Alquiler', 40, 1, ?)", [today, cc?.id ?? 1]);

      const s = ok(await ess.q("a", "accounting.getSummary", {}, admA), "resumen");
      expect(s.hasData).toBe(true);
      const cur = s.months[s.months.length - 1];
      expect(cur.sales).toBe(207.9);
      expect(cur.payments).toBe(207.9);
      expect(cur.invoiced).toBe(121);
      expect(cur.expenses).toBe(40);
      expect(s.hasExpenses).toBe(true);
      expect(s.totals).toMatchObject({ sales: 207.9, salesCount: 1, invoiced: 121, invoiceCount: 1 });
      // Ventas por categoría con el descuento del ticket repartido: 121 × 0,9 y 110 × 0,9
      expect(s.categories).toEqual([
        { name: "Asesoría", amount: 108.9, percent: 52.4 },
        { name: "Formación", amount: 99, percent: 47.6 },
      ]);
      expect(r2(s.categories.reduce((a: number, c: any) => a + c.amount, 0))).toBe(207.9);
      expect(s.pendingQuotes).toBeNull();
    });
  });
});
