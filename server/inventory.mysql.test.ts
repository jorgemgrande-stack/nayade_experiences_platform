/**
 * Inventario (Business, inventory-basic) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos
 * empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0025). Essential sigue igual; con
 * Business, las ventas del TPV y los pedidos pagados de la tienda descuentan, las anulaciones reponen una sola vez, la
 * política «bloquear» impide vender sin existencias (también con ventas simultáneas), los traspasos mueven unidades
 * entre sedes y cada empresa solo ve lo suyo. Las sedes vienen de una fuente de prueba (como el registro).
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { setSiteSourceForTests, type SiteSource } from "./sitesDb";
import type { PanelSites } from "../shared/sites";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "inventory-basic";
const KEY = crypto.randomBytes(24).toString("base64");

/** Firma de referencia de la notificación de Redsys (3DES del pedido + HMAC-SHA256), independiente del código. */
function signedNotification(d: Record<string, string>) {
  const params = Buffer.from(JSON.stringify(d)).toString("base64");
  const key = Buffer.from(KEY, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(d.Ds_Order) / 8) * 8, 0);
  Buffer.from(d.Ds_Order).copy(padded);
  const c = crypto.createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  c.setAutoPadding(false);
  const derived = Buffer.concat([c.update(padded), c.final()]);
  const sig = crypto.createHmac("sha256", derived).update(params).digest("base64");
  return new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: params, Ds_Signature: sig }).toString();
}

const site = (siteId: string, name: string, isPrimary: boolean) => ({ siteId, name, status: "active" as const, isPrimary, virtual: false, address: null, phone: null, email: null, createdAt: null });

describe.skipIf(!URL_)("Inventario (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const productId: Record<"a" | "b", number> = { a: 0, b: 0 };
  let variantId = 0;
  let sessionA = 0;
  let sessionB = 0;
  let itemA = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "inventario");
    // Sedes de prueba: A tiene dos (principal y Norte); B, solo la principal
    const sitesOf = (t: string): PanelSites => t === ess.ids.a
      ? { sites: [site("principal", "Sede principal", true), site("norte", "Norte", false)], primarySiteId: "principal", limit: 5, used: 2, canAdd: true }
      : { sites: [site("principal", "Sede principal", true)], primarySiteId: "principal", limit: 1, used: 1, canAdd: false };
    const src: SiteSource = { list: async (t) => sitesOf(t), create: async (t) => sitesOf(t), update: async (t) => sitesOf(t), archive: async (t) => sitesOf(t), restore: async (t) => sitesOf(t) };
    setSiteSourceForTests(src);
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    for (const [co, cookie] of [["a", adA], ["b", adB]] as const) {
      await ess.m(co, "products.createCategory", { slug: "tienda", name: "Tienda" }, cookie);
      await ess.m(co, "products.createLocation", { slug: "local", name: "Local" }, cookie);
      const [c] = await ess.sql(co, "SELECT id FROM categories WHERE slug = 'tienda'");
      const [l] = await ess.sql(co, "SELECT id FROM locations LIMIT 1");
      expect((await ess.m(co, "products.create", { slug: "camiseta", title: "Camiseta", categoryId: c.id, locationId: l.id, basePrice: "10.00", taxRate: "21" }, cookie)).status).toBe(200);
      productId[co] = (await ess.sql(co, "SELECT id FROM experiences WHERE slug = 'camiseta'"))[0].id;
      await ess.sql(co, "UPDATE experiences SET isPresentialSale = 1 WHERE id = ?", [productId[co]]);
      const reg = data(await ess.m(co, "tpv.createRegister", { name: `Caja ${co}` }, cookie));
      const open = await ess.m(co, "tpv.openSession", { registerId: reg.id, openingAmount: 0 }, cookie);
      expect(open.status).toBe(200);
      if (co === "a") sessionA = data(open).id;
      else sessionB = data(open).id;
    }
    expect((await ess.m("a", "products.createVariant", { experienceId: productId.a, name: "Talla M", priceModifier: "12.00", priceType: "fixed" }, adA)).status).toBe(200);
    variantId = (await ess.sql("a", "SELECT id FROM experience_variants WHERE experienceId = ?", [productId.a]))[0].id;
  }, 300_000);
  afterAll(async () => {
    setSiteSourceForTests(undefined);
    await ess?.close();
  });

  const sell = (co: "a" | "b", cookie: string, sessionId: number, quantity: number, extra: Record<string, unknown> = {}) =>
    ess.m(co, "tpv.createSale", {
      sessionId,
      items: [{ productType: "experience", productId: productId[co], productName: "Camiseta", quantity, unitPrice: 10, ...extra }],
      payments: [{ method: "cash", amount: 10 * quantity }],
    }, cookie);
  const onHand = async (co: "a" | "b", item: number, siteId: string | null = null) =>
    Number((await ess.sql(co, "SELECT on_hand FROM inventory_levels WHERE item_id = ? AND site_key = ?", [item, siteId ?? ""]))[0]?.on_hand ?? 0);
  const key = () => crypto.randomBytes(12).toString("hex");

  it("Essential: sin la capacidad no hay pantalla ni descuento; ni un artículo marcado a mano bloquea la caja", async () => {
    const denied = await ess.q("b", "inventory.overview", undefined, adB);
    expect(isLicenseDenied(denied, CAP) || errCode(denied) === "FORBIDDEN").toBe(true);
    expect(isLicenseDenied(await ess.m("b", "inventory.track", { productId: productId.b, variantId: 0, policy: "block", minStock: 0 }, adB), CAP)).toBe(true);
    // Un artículo «bloquear» sin existencias (dato sembrado): Essential vende igual y no se mueve nada
    await ess.sql("b", "INSERT INTO inventory_items (product_id, variant_id, tracked, oversell_policy, min_stock, created_at, updated_at) VALUES (?, 0, 1, 'block', 0, 0, 0)", [productId.b]);
    const sale = await sell("b", adB, sessionB, 3);
    expect(sale.status).toBe(200);
    expect(data(sale).stockWarnings).toEqual([]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM inventory_movements"))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM inventory_levels"))[0].n).toBe(0);
  });

  it("Business: marcar, entrada, venta del TPV descuenta en la sede de la caja; bloqueo sin existencias; solo administración ajusta", async () => {
    await ess.setCapability("a", CAP, "active");
    const tracked = await ess.m("a", "inventory.track", { productId: productId.a, variantId: 0, policy: "block", minStock: 2 }, adA);
    expect(tracked.status).toBe(200);
    itemA = data(tracked).id;
    // El equipo consulta, pero no ajusta
    expect(errCode(await ess.m("a", "inventory.receive", { itemId: itemA, quantity: 5, key: key() }, agA))).toBe("FORBIDDEN");
    expect(data(await ess.q("a", "inventory.overview", undefined, agA)).canManage).toBe(false);
    const k = key();
    expect(data(await ess.m("a", "inventory.receive", { itemId: itemA, quantity: 5, reference: "ALB-1", key: k }, adA))).toMatchObject({ applied: true, onHand: 5 });
    // Doble clic con la misma clave: una sola entrada
    expect(data(await ess.m("a", "inventory.receive", { itemId: itemA, quantity: 5, reference: "ALB-1", key: k }, adA))).toMatchObject({ applied: false, onHand: 5 });

    const sale = await sell("a", adA, sessionA, 2);
    expect(sale.status).toBe(200);
    expect(await onHand("a", itemA)).toBe(3);
    const saleId = data(sale).sale.id;
    const [mv] = await ess.sql("a", "SELECT kind, quantity, balance_after, site_id, source_type, source_ref, user_id FROM inventory_movements WHERE source_type = 'tpv_sale' AND source_id = ?", [String(saleId)]);
    expect(mv).toMatchObject({ kind: "venta", quantity: -2, balance_after: 3, site_id: null, source_ref: data(sale).sale.ticketNumber });
    expect(mv.user_id).toBe(await ess.userId("a", "admin"));

    // Sin existencias suficientes con «bloquear»: no se cobra ni se numera
    const tickets = (await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n;
    const blocked = await sell("a", adA, sessionA, 4);
    expect(errCode(blocked)).toBe("BAD_REQUEST");
    expect(blocked.json.error.json.message).toMatch(/solo tiene 3 unidades/);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM tpv_sales"))[0].n).toBe(tickets);
    expect(await onHand("a", itemA)).toBe(3);

    // Alerta de mínimo: 3 > 2, sin alerta; tras vender 1, 2 <= 2, alerta
    expect(data(await ess.q("a", "inventory.overview", undefined, adA)).items[0]).toMatchObject({ low: false, total: 3 });
    expect((await sell("a", adA, sessionA, 1)).status).toBe(200);
    expect(data(await ess.q("a", "inventory.overview", undefined, adA)).items[0]).toMatchObject({ low: true, total: 2 });

    // «Permitir con aviso»: se vende y queda marcado
    expect((await ess.m("a", "inventory.update", { itemId: itemA, policy: "allow" }, adA)).status).toBe(200);
    const over = await sell("a", adA, sessionA, 3);
    expect(over.status).toBe(200);
    expect(data(over).stockWarnings).toEqual(["Camiseta"]);
    expect(await onHand("a", itemA)).toBe(-1);
    expect((await ess.sql("a", "SELECT shortfall FROM inventory_movements WHERE source_id = ?", [String(data(over).sale.id)]))[0].shortfall).toBe(1);

    // Ajuste: recuento con motivo; nunca negativo
    expect(errCode(await ess.m("a", "inventory.adjust", { itemId: itemA, mode: "delta", quantity: -5, reason: "rotura", key: key() }, adA))).toBe("BAD_REQUEST");
    expect(data(await ess.m("a", "inventory.adjust", { itemId: itemA, mode: "set", quantity: 10, reason: "recuento", key: key() }, adA))).toMatchObject({ applied: true, onHand: 10 });
    const [adj] = await ess.sql("a", "SELECT quantity, reason FROM inventory_movements WHERE kind = 'ajuste'");
    expect(adj).toEqual({ quantity: 11, reason: "recuento" });
    expect((await ess.m("a", "inventory.update", { itemId: itemA, policy: "block" }, adA)).status).toBe(200);
  });

  it("anular una venta del TPV repone una sola vez", async () => {
    const before = await onHand("a", itemA);
    const sale = await sell("a", adA, sessionA, 4);
    expect(sale.status).toBe(200);
    expect(await onHand("a", itemA)).toBe(before - 4);
    const id = data(sale).sale.id;
    expect((await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id }, adA)).status).toBe(200);
    expect(await onHand("a", itemA)).toBe(before);
    expect((await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id }, adA)).status).toBe(200);
    expect(await onHand("a", itemA)).toBe(before);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM inventory_movements WHERE kind = 'devolucion' AND source_id = ?", [String(id)]))[0].n).toBe(1);
  });

  it("concurrencia: cinco cobros simultáneos con 3 unidades y «bloquear» venden exactamente 3, sin negativos", async () => {
    await ess.m("a", "inventory.adjust", { itemId: itemA, mode: "set", quantity: 3, reason: "recuento", key: key() }, adA);
    const results = await Promise.all(Array.from({ length: 5 }, () => sell("a", adA, sessionA, 1)));
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 200)) expect(["BAD_REQUEST", "CONFLICT"]).toContain(errCode(r));
    expect(await onHand("a", itemA)).toBe(0);
    const ids = ok.map((r) => String(data(r).sale.id));
    expect((await ess.sql("a", `SELECT COUNT(*) AS n FROM inventory_movements WHERE kind = 'venta' AND source_id IN (${ids.map(() => "?").join(",")})`, ids))[0].n).toBe(3);
  });

  it("tienda online: se rechaza el pago sin existencias; el pedido pagado descuenta su variante una vez (notificaciones repetidas) y anularlo repone", async () => {
    const varItem = data(await ess.m("a", "inventory.track", { productId: productId.a, variantId, policy: "block", minStock: 0 }, adA)).id;
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, adA)).status).toBe(200);
    const order = (people: number) => ess.m("a", "reservations.cartCheckout", { items: [{ productId: productId.a, variantId, bookingDate: "2030-06-01", people }], customerName: "Cliente Web", customerEmail: "web@cliente-a.example", origin: `https://${ess.host("a")}` });
    const none = await order(1);
    expect(errCode(none)).toBe("BAD_REQUEST");
    expect(none.json.error.json.message).toMatch(/no tiene existencias/);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE customer_email = 'web@cliente-a.example'"))[0].n).toBe(0);

    await ess.m("a", "inventory.receive", { itemId: varItem, quantity: 5, key: key() }, adA);
    const r = await order(2);
    expect(r.status).toBe(200);
    const merchantOrder = data(r).merchantOrder;
    const [res] = await ess.sql("a", "SELECT id, stock_variant_id, amount_total FROM reservations WHERE merchant_order = ?", [merchantOrder]);
    expect(res.stock_variant_id).toBe(variantId);
    // Antes de pagar no se descuenta nada
    expect(await onHand("a", varItem)).toBe(5);
    const ipn = () => ess.call("a", "POST", "/api/redsys/notification", {
      raw: signedNotification({ Ds_Order: merchantOrder, Ds_Response: "0000", Ds_Amount: String(res.amount_total), Ds_AuthorisationCode: "123456" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const notes = await Promise.all([ipn(), ipn(), ipn()]);
    for (const n of notes) expect(n.text).toBe("OK");
    let left = 5;
    for (let i = 0; i < 40 && left === 5; i++) {
      await new Promise((ok) => setTimeout(ok, 150));
      left = await onHand("a", varItem);
    }
    expect(left).toBe(3);
    await new Promise((ok) => setTimeout(ok, 500));
    expect(await onHand("a", varItem)).toBe(3);
    // El producto entero no se ha tocado: se descontó la variante
    const whole = await onHand("a", itemA);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM inventory_movements WHERE source_type = 'reservation' AND source_id = ?", [String(res.id)]))[0].n).toBe(1);

    // Anular el pedido pagado (módulo de anulaciones, con devolución) repone, una vez
    expect((await ess.m("a", "cancellations.cancelReservationDirect", { reservationId: res.id, reason: "desistimiento", compensationType: "devolucion", refundAmount: 24 }, adA)).status).toBe(200);
    expect(await onHand("a", varItem)).toBe(5);
    await ess.m("a", "dailyControl.cancelOperation", { type: "reservation", id: res.id }, adA);
    expect(await onHand("a", varItem)).toBe(5);
    expect(await onHand("a", itemA)).toBe(whole);
  });

  it("varias sedes: traspaso entre sedes y venta en la caja de otra sede; sin multi-site no hay traspasos", async () => {
    await ess.m("a", "inventory.adjust", { itemId: itemA, mode: "set", quantity: 6, reason: "recuento", key: key() }, adA);
    expect(errCode(await ess.m("a", "inventory.transfer", { itemId: itemA, fromSiteId: "principal", toSiteId: "norte", quantity: 2, key: key() }, adA))).toBe("FORBIDDEN");
    await ess.setCapability("a", "multi-site", "active");
    const overview = data(await ess.q("a", "inventory.overview", undefined, adA));
    expect(overview.sites.map((s: any) => s.siteId)).toEqual(["principal", "norte"]);
    expect(overview.canTransfer).toBe(true);
    const k = key();
    expect(data(await ess.m("a", "inventory.transfer", { itemId: itemA, fromSiteId: "principal", toSiteId: "norte", quantity: 2, reason: "reposición", key: k }, adA))).toMatchObject({ applied: true, fromOnHand: 4, toOnHand: 2 });
    expect(data(await ess.m("a", "inventory.transfer", { itemId: itemA, fromSiteId: "principal", toSiteId: "norte", quantity: 2, reason: "reposición", key: k }, adA)).applied).toBe(false);
    expect(errCode(await ess.m("a", "inventory.transfer", { itemId: itemA, fromSiteId: "norte", toSiteId: "principal", quantity: 3, key: key() }, adA))).toBe("BAD_REQUEST");
    expect([await onHand("a", itemA), await onHand("a", itemA, "norte")]).toEqual([4, 2]);

    // Caja de Norte: descuenta en Norte; la tercera unidad no hay (bloquear)
    const reg = data(await ess.m("a", "tpv.createRegister", { name: "Caja norte", siteId: "norte" }, adA));
    const open = data(await ess.m("a", "tpv.openSession", { registerId: reg.id, openingAmount: 0 }, adA));
    expect((await sell("a", adA, open.id, 2)).status).toBe(200);
    expect([await onHand("a", itemA), await onHand("a", itemA, "norte")]).toEqual([4, 0]);
    expect(errCode(await sell("a", adA, open.id, 1))).toBe("BAD_REQUEST");

    // Historial filtrable por sede y tipo, y CSV
    const norte = data(await ess.q("a", "inventory.movements", { siteId: "norte" }, adA));
    expect(norte.items.map((m: any) => m.kind).sort()).toEqual(["traspaso_entrada", "venta"]);
    const transfers = data(await ess.q("a", "inventory.movements", { kind: "traspaso_salida" }, adA));
    expect(transfers.total).toBe(1);
    const csv = data(await ess.q("a", "inventory.exportCsv", { what: "existencias" }, adA));
    expect(csv.csv).toContain(`"Camiseta";"Norte";0`);
    const hist = data(await ess.q("a", "inventory.exportCsv", { what: "movimientos", siteId: "norte" }, agA));
    expect(hist.csv).toContain("Traspaso (entrada)");
    // Un agente con solo la sede principal no ve Norte
    await ess.m("a", "sites.setUserSites", { userId: await ess.userId("a", "agente"), siteIds: ["principal"] }, adA);
    const mine = data(await ess.q("a", "inventory.overview", undefined, agA));
    expect(mine.sites.map((s: any) => s.siteId)).toEqual(["principal"]);
    expect(data(await ess.q("a", "inventory.movements", {}, agA)).items.every((m: any) => m.siteId === null)).toBe(true);
  });

  it("aislamiento: la empresa B no ve ni toca el inventario de A", async () => {
    await ess.setCapability("b", CAP, "active");
    const b = data(await ess.q("b", "inventory.overview", undefined, adB));
    expect(b.items.map((i: any) => i.productId)).toEqual([productId.b]);
    expect(b.sites.map((s: any) => s.siteId)).toEqual(["principal"]);
    expect(errCode(await ess.m("b", "inventory.receive", { itemId: itemA + 100, quantity: 1, key: key() }, adB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "inventory.movements", {}, adB)).total).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM inventory_movements"))[0].n).toBe(0);
  });
});
