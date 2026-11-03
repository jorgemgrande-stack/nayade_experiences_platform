/**
 * Varias sedes (Business, multi-site) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos
 * empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0024) y del registro (incluida la 0017).
 * Las sedes viven en el registro y el Core llega a ellas por el canal real (commerceClient → HTTP → plano de control).
 * Essential sigue igual; con Business, cajas, sesiones y ventas del TPV llevan su sede, se filtran por sede, los usuarios
 * solo abren cajas de sus sedes y cada empresa solo ve lo suyo.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { MysqlOrganizationStore, OrganizationService } from "./organization/service";
import { authenticate, hashToken } from "./controlPlane/auth";
import { createPanelSitesRouter } from "./commerce/panelSites";
import { commerceClientFromEnv } from "./commerceClient";
import { setSiteSourceForTests, siteSourceFromClient } from "./sitesDb";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "multi-site";
const TOKEN = "token-del-core-de-prueba-sedes-0123456789";

describe.skipIf(!URL_)("Varias sedes (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let cp: http.Server;
  let adA: string;
  let agA: string;
  let adB: string;
  const realFetch = globalThis.fetch;
  const productId: Record<"a" | "b", number> = { a: 0, b: 0 };
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "sedes");
    // Plano de control: sedes del registro con los límites del plan (A: Business, 5 sedes; B: sin suscripción, Essential)
    const regPool = (ess.registry.store as { q: any }).q;
    const org = new OrganizationService({
      store: new MysqlOrganizationStore(regPool),
      subscriptions: {
        list: async () => [{ id: 1, tenantId: ess.ids.a, status: "active" }] as never,
        items: async () => [{ family: "core_plan", productKey: "business", effectiveFrom: 0, effectiveTo: null, quantity: 1 }] as never,
      },
      catalog: async () => ({ products: [{ key: "business", quotas: [{ metric: "sites", included: 5 }] }] }) as never,
    });
    const app = express();
    app.use(express.json());
    const router = express.Router();
    router.use(authenticate([{ id: "core-commerce", sha256: hashToken(TOKEN), scopes: ["commerce:purchase", "commerce:support"] }]));
    router.use("/commerce", createPanelSitesRouter({ org, tenantExists: async (t) => !!(await ess.registry.store.getTenant(t)) }));
    app.use("/cp/v1", router);
    cp = http.createServer(app);
    await new Promise<void>((r) => cp.listen(0, "127.0.0.1", r));
    const port = (cp.address() as AddressInfo).port;
    // La salida de red de la aplicación está bloqueada en pruebas: el canal usa el fetch real solo hacia este servidor
    setSiteSourceForTests(siteSourceFromClient(commerceClientFromEnv({ CP_COMMERCE_URL: `http://127.0.0.1:${port}`, CP_COMMERCE_TOKEN: TOKEN, NODE_ENV: "test" }, realFetch as never)));
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    // Un producto vendible en caja en cada empresa (el equipo no puede cobrar conceptos libres)
    for (const [co, cookie] of [["a", adA], ["b", adB]] as const) {
      await ess.m(co, "products.createCategory", { slug: "general", name: "General" }, cookie);
      await ess.m(co, "products.createLocation", { slug: "local", name: "Local" }, cookie);
      const [c] = await ess.sql(co, "SELECT id FROM categories WHERE slug = 'general'");
      const [l] = await ess.sql(co, "SELECT id FROM locations LIMIT 1");
      await ess.m(co, "products.create", { slug: "servicio", title: "Servicio", categoryId: c.id, locationId: l.id, basePrice: "10.00", taxRate: "21" }, cookie);
      productId[co] = (await ess.sql(co, "SELECT id FROM experiences WHERE slug = 'servicio'"))[0].id;
      await ess.sql(co, "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [productId[co]]);
    }
  }, 300_000);
  afterAll(async () => {
    setSiteSourceForTests(undefined);
    cp?.closeAllConnections();
    await new Promise<void>((r) => (cp ? cp.close(() => r()) : r()));
    await ess?.close();
  });

  const openAndSell = async (co: "a" | "b", cookie: string, registerId: number) => {
    const open = await ess.m(co, "tpv.openSession", { registerId, openingAmount: 50 }, cookie);
    expect(open.status).toBe(200);
    const sessionId = data(open).id;
    const sale = await ess.m(co, "tpv.createSale", {
      sessionId,
      items: [{ productType: "experience", productId: productId[co], productName: "Servicio", quantity: 1, unitPrice: 10 }],
      payments: [{ method: "cash", amount: 10 }],
    }, cookie);
    return { sessionId, sale };
  };

  it("Essential: una sola sede, sin añadir ni filtrar; la caja y sus ventas como siempre (sin sede)", async () => {
    const list = data(await ess.q("b", "sites.list", undefined, adB));
    expect(list).toMatchObject({ multiSite: false, canManage: false, limit: 1, used: 1, primarySiteId: "principal" });
    expect(list.sites).toHaveLength(1);
    expect(errCode(await ess.m("b", "sites.create", { name: "Segunda" }, adB))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("b", "sites.userAssignments", undefined, adB))).toBe("FORBIDDEN");
    // Puede poner nombre y contacto a su sede principal
    expect(data(await ess.m("b", "sites.update", { siteId: "principal", name: "Tienda B", phone: "+34 900 111 222" }, adB)).sites[0]).toMatchObject({ name: "Tienda B", phone: "+34 900 111 222" });
    const reg = data(await ess.m("b", "tpv.createRegister", { name: "Caja B" }, adB));
    expect(reg.siteId).toBeNull();
    expect(errCode(await ess.m("b", "tpv.createRegister", { name: "Caja B2", siteId: "otra" }, adB))).toBe("FORBIDDEN");
    const { sessionId, sale } = await openAndSell("b", adB, reg.id);
    expect(sale.status).toBe(200);
    expect((await ess.sql("b", "SELECT site_id FROM tpv_sales WHERE sessionId = ?", [sessionId]))[0].site_id).toBeNull();
    expect(errCode(await ess.q("b", "tpv.getBackoffice", { page: 1, limit: 20, siteId: "principal" }, adB))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("b", "tpv.reports.summary", { dateFrom: "2026-01-01", dateTo: "2026-12-31", siteId: "principal" }, adB))).toBe("FORBIDDEN");
    // Sin filtro, todo como siempre
    expect(data(await ess.q("b", "tpv.getBackoffice", { page: 1, limit: 20 }, adB)).map((s: any) => s.id)).toContain(sessionId);
    const rows = await ess.sql("b", "SELECT COUNT(*) AS n FROM user_sites");
    expect(rows[0].n).toBe(0);
  });

  it("Business: sedes hasta el límite, cajas y ventas por sede, filtros e informes por sede y usuarios por sede", async () => {
    // Sin la capacidad, igual que Essential
    const denied = await ess.m("a", "sites.create", { name: "Norte" }, adA);
    expect(isLicenseDenied(denied, CAP) || errCode(denied) === "FORBIDDEN").toBe(true);
    await ess.setCapability("a", CAP, "active");
    const created = data(await ess.m("a", "sites.create", { name: "Norte", address: "Calle Norte 1" }, adA));
    expect(created.sites.map((s: any) => [s.siteId, s.isPrimary])).toEqual([["principal", true], ["norte", false]]);
    for (const n of ["Sur", "Este", "Oeste"]) expect((await ess.m("a", "sites.create", { name: n }, adA)).status).toBe(200);
    const sixth = await ess.m("a", "sites.create", { name: "Sexta" }, adA);
    expect(errCode(sixth)).toBe("BAD_REQUEST");
    expect(sixth.json.error.json.message).toMatch(/5 sede/);
    // Solo administración
    expect(errCode(await ess.m("a", "sites.create", { name: "Otra" }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "sites.archive", { siteId: "principal" }, adA))).toBe("CONFLICT");

    // Cajas: una en la principal (como siempre) y otra en Norte
    const central = data(await ess.m("a", "tpv.createRegister", { name: "Caja central" }, adA));
    const norte = data(await ess.m("a", "tpv.createRegister", { name: "Caja norte", siteId: "norte" }, adA));
    expect([central.siteId, norte.siteId]).toEqual([null, "norte"]);
    expect(errCode(await ess.m("a", "tpv.createRegister", { name: "Caja fantasma", siteId: "no-existe" }, adA))).toBe("BAD_REQUEST");

    // Usuario solo en Norte: ve y abre solo la caja de Norte
    const agId = await ess.userId("a", "agente");
    expect((await ess.m("a", "sites.setUserSites", { userId: agId, siteIds: ["norte"] }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "sites.setUserSites", { userId: agId, siteIds: ["no-existe"] }, adA))).toBe("BAD_REQUEST");
    expect(data(await ess.q("a", "sites.userAssignments", undefined, adA))[agId]).toEqual(["norte"]);
    const visible = data(await ess.q("a", "tpv.getRegisterStatus", undefined, agA)).map((r: any) => r.id);
    expect(visible).toEqual([norte.id]);
    expect(errCode(await ess.m("a", "tpv.openSession", { registerId: central.id, openingAmount: 0 }, agA))).toBe("FORBIDDEN");

    // Ventas: cada una con la sede de su caja
    const n = await openAndSell("a", agA, norte.id);
    expect(n.sale.status).toBe(200);
    const c = await openAndSell("a", adA, central.id);
    expect(c.sale.status).toBe(200);
    expect((await ess.sql("a", "SELECT site_id FROM cash_sessions WHERE id = ?", [n.sessionId]))[0].site_id).toBe("norte");
    expect((await ess.sql("a", "SELECT site_id FROM tpv_sales WHERE sessionId = ?", [n.sessionId]))[0].site_id).toBe("norte");
    expect((await ess.sql("a", "SELECT site_id FROM tpv_sales WHERE sessionId = ?", [c.sessionId]))[0].site_id).toBeNull();

    // Mover la caja de sede no cambia las sesiones anteriores
    expect(data(await ess.m("a", "tpv.setRegisterSite", { registerId: norte.id, siteId: "sur" }, adA)).siteId).toBe("sur");
    expect((await ess.sql("a", "SELECT site_id FROM cash_sessions WHERE id = ?", [n.sessionId]))[0].site_id).toBe("norte");
    await ess.m("a", "tpv.setRegisterSite", { registerId: norte.id, siteId: "norte" }, adA);

    // Filtros: historial de cajas e informes por sede (la principal incluye lo que no tiene sede)
    const ids = async (siteId?: string) => data(await ess.q("a", "tpv.getBackoffice", { page: 1, limit: 50, ...(siteId ? { siteId } : {}) }, adA)).map((s: any) => s.id);
    expect(await ids("norte")).toEqual([n.sessionId]);
    expect(await ids("principal")).toEqual([c.sessionId]);
    expect((await ids()).sort()).toEqual([n.sessionId, c.sessionId].sort());
    expect(errCode(await ess.q("a", "tpv.getBackoffice", { page: 1, limit: 50, siteId: "no-existe" }, adA))).toBe("NOT_FOUND");
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const range = { dateFrom: day(-1), dateTo: day(1) };
    const tickets = async (siteId?: string) => data(await ess.q("a", "tpv.reports.summary", { ...range, ...(siteId ? { siteId } : {}) }, adA)).summary.tickets;
    expect([await tickets(), await tickets("norte"), await tickets("principal"), await tickets("sur")]).toEqual([2, 1, 1, 0]);
    // Cierres por la sede de su sesión
    await ess.m("a", "tpv.closeSession", { sessionId: n.sessionId, countedCash: 60 }, agA);
    const closures = async (siteId: string) => data(await ess.q("a", "tpv.reports.summary", { ...range, siteId }, adA)).closures.sessions.map((x: any) => x.sessionId);
    expect(await closures("norte")).toEqual([n.sessionId]);
    expect(await closures("principal")).toEqual([]);
    expect((await ess.q("a", "tpv.reports.exportCsv", { ...range, siteId: "norte", section: "dias" }, adA)).status).toBe(200);
    // Un agente con sede asignada no ve los informes (solo administración, como siempre)
    expect(errCode(await ess.q("a", "tpv.reports.summary", { ...range, siteId: "norte" }, agA))).toBe("FORBIDDEN");

    // Desactivar una sede: no se pueden asignar cajas a ella; reactivar
    expect((await ess.m("a", "sites.archive", { siteId: "oeste" }, adA)).status).toBe(200);
    expect(errCode(await ess.m("a", "tpv.setRegisterSite", { registerId: central.id, siteId: "oeste" }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "sites.restore", { siteId: "oeste" }, adA)).status).toBe(200);
  });

  it("aislamiento: la empresa B no ve las sedes, cajas ni ventas de A", async () => {
    const b = data(await ess.q("b", "sites.list", undefined, adB));
    expect(b.sites.map((s: any) => s.siteId)).toEqual(["principal"]);
    expect(errCode(await ess.m("b", "sites.update", { siteId: "norte", name: "Robada" }, adB))).toBe("FORBIDDEN");
    const regsB = await ess.sql("b", "SELECT name, site_id FROM cash_registers");
    expect(regsB.map((r: any) => r.name)).toEqual(["Caja B"]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM tpv_sales WHERE site_id IS NOT NULL"))[0].n).toBe(0);
  });
});
