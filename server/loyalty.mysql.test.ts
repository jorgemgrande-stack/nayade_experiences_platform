/**
 * Social Token Net · Tokens internos (social-token-net-tokens) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0026).
 * Sin la extensión no hay pantalla ni emisión; con ella, las ventas del TPV cobradas y los pedidos pagados de la tienda
 * (compras simuladas, sin movimientos bancarios) emiten puntos una sola vez, las anulaciones los retiran una sola vez,
 * los ajustes exigen administración y motivo y nunca dejan el saldo en negativo (también a la vez), las campañas
 * respetan su presupuesto y el límite por cliente (también con ventas simultáneas), los puntos caducan y cada empresa
 * solo ve lo suyo.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "social-token-net-tokens";
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

const baseRule = { trigger: "purchase", actionKey: null, scope: "all", scopeId: null, calc: "per_euro", rate: 1, fixedPoints: null, minSpend: null, maxPoints: null, limitCount: null, limitPeriod: null, priority: 0, active: true, startsAt: null, endsAt: null };

describe.skipIf(!URL_)("Tokens internos (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const productId: Record<"a" | "b", number> = { a: 0, b: 0 };
  const session: Record<"a" | "b", number> = { a: 0, b: 0 };
  const client: Record<string, number> = {};

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tokens");
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
      session[co] = data(open).id;
    }
    for (const [co, name] of [["a", "Ana"], ["a", "Bea"], ["a", "Dani"], ["a", "Eva"], ["b", "Carla"]] as const) {
      await ess.sql(co, "INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [name, `${name.toLowerCase()}@cliente-${co}.example`]);
      client[name] = (await ess.sql(co, "SELECT id FROM clients WHERE email = ?", [`${name.toLowerCase()}@cliente-${co}.example`]))[0].id;
    }
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  const sell = (co: "a" | "b", quantity: number, extra: Record<string, unknown> = {}) =>
    ess.m(co, "tpv.createSale", {
      sessionId: session[co],
      items: [{ productType: "experience", productId: productId[co], productName: "Camiseta", quantity, unitPrice: 10 }],
      payments: [{ method: "cash", amount: 10 * quantity }],
      ...extra,
    }, co === "a" ? adA : adB);
  const balance = async (name: string, co: "a" | "b" = "a") => Number((await ess.sql(co, "SELECT balance FROM loyalty_wallets WHERE client_id = ?", [client[name]]))[0]?.balance ?? 0);
  const key = () => crypto.randomBytes(12).toString("hex");

  it("sin la extensión: ni pantalla, ni ajustes, ni puntos al vender (aunque haya un programa y reglas guardados)", async () => {
    expect(isLicenseDenied(await ess.q("b", "loyalty.overview", undefined, adB), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("b", "loyalty.adjust", { clientId: client.Carla, direction: "credit", amount: 10, reason: "prueba", key: key() }, adB), CAP)).toBe(true);
    await ess.sql("b", "INSERT INTO loyalty_program (id, enabled, points_name, updated_at) VALUES (1, 1, 'puntos', 0)");
    await ess.sql("b", "INSERT INTO loyalty_rules (name, trigger_kind, scope, calc, rate, priority, active, created_at, updated_at) VALUES ('1 por euro', 'purchase', 'all', 'per_euro', 1, 0, 1, 0, 0)");
    const sale = await sell("b", 3, { clientId: client.Carla });
    expect(sale.status).toBe(200);
    expect(data(sale).loyalty).toBeNull();
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM loyalty_ledger"))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM loyalty_wallets"))[0].n).toBe(0);
  });

  it("con la extensión: programa y reglas solo los configura administración; la venta del TPV cobrada emite una vez", async () => {
    await ess.setCapability("a", CAP, "active");
    // El equipo consulta, pero no configura ni ajusta
    const ov = await ess.q("a", "loyalty.overview", undefined, agA);
    expect(ov.status).toBe(200);
    expect(data(ov).canManage).toBe(false);
    expect(errCode(await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "estrellas", eqPoints: null, eqEuros: null, expiryMonths: null }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "loyalty.adjust", { clientId: client.Ana, direction: "credit", amount: 5, reason: "prueba", key: key() }, agA))).toBe("FORBIDDEN");

    // Programa desactivado: la venta no da puntos
    expect((await ess.m("a", "loyalty.saveRule", { id: null, rule: { ...baseRule, name: "1 estrella por euro" } }, adA)).status).toBe(200);
    expect(data(await sell("a", 1, { clientId: client.Ana })).loyalty).toBeNull();
    expect(await balance("Ana")).toBe(0);

    expect((await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "estrellas", eqPoints: 100, eqEuros: 1, expiryMonths: null }, adA)).status).toBe(200);
    const idem = key();
    const sale = await sell("a", 2, { clientId: client.Ana, idempotencyKey: idem });
    expect(sale.status).toBe(200);
    expect(data(sale).loyalty).toMatchObject({ points: 20, balance: 20, pointsName: "estrellas", applied: true });
    const saleId = data(sale).sale.id;
    const [mv] = await ess.sql("a", "SELECT kind, direction, amount, balance_after, source_ref, user_id FROM loyalty_ledger WHERE source_type = 'tpv_sale' AND source_id = ?", [String(saleId)]);
    expect(mv).toMatchObject({ kind: "emision", direction: "credit", amount: 20, balance_after: 20, source_ref: data(sale).sale.ticketNumber });
    expect(mv.user_id).toBe(await ess.userId("a", "admin"));
    // Reintento del cobro con la misma clave: se devuelve la venta grabada y no se emite otra vez
    const again = await sell("a", 2, { clientId: client.Ana, idempotencyKey: idem });
    expect(data(again).replayed).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_ledger WHERE source_id = ?", [String(saleId)]))[0].n).toBe(1);
    expect(await balance("Ana")).toBe(20);

    // Regla de producto (más específica con la misma prioridad): 3 por euro en la camiseta
    const pr = data(await ess.m("a", "loyalty.saveRule", { id: null, rule: { ...baseRule, name: "Triple camiseta", scope: "product", scopeId: productId.a, rate: 3 } }, adA));
    expect(data(await sell("a", 1, { clientId: client.Ana })).loyalty.points).toBe(30);
    expect((await ess.m("a", "loyalty.saveRule", { id: pr.id, rule: { ...baseRule, name: "Triple camiseta", scope: "product", scopeId: productId.a, rate: 3, active: false } }, adA)).status).toBe(200);
    expect(await balance("Ana")).toBe(50);
  });

  it("venta identificada solo por correo: los puntos llegan al enlazar el cliente tras el cobro", async () => {
    const sale = await sell("a", 1, { customerName: "Bea", customerEmail: "bea@cliente-a.example" });
    expect(sale.status).toBe(200);
    expect(data(sale).loyalty).toMatchObject({ points: 10, applied: true });
    expect(await balance("Bea")).toBe(10);
  });

  it("anular la venta del TPV retira los puntos una sola vez", async () => {
    const before = await balance("Ana");
    const sale = await sell("a", 4, { clientId: client.Ana });
    expect(await balance("Ana")).toBe(before + 40);
    const id = data(sale).sale.id;
    expect((await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id }, adA)).status).toBe(200);
    expect((await ess.m("a", "dailyControl.cancelOperation", { type: "tpv", id }, adA)).status).toBe(200);
    expect(await balance("Ana")).toBe(before);
    const rev = await ess.sql("a", "SELECT kind, direction, amount FROM loyalty_ledger WHERE source_type = 'tpv_sale' AND source_id = ? AND kind = 'anulacion'", [String(id)]);
    expect(rev).toEqual([{ kind: "anulacion", direction: "debit", amount: 40 }]);
  });

  it("ajustes: motivo obligatorio, idempotentes, nunca en negativo; descuentos simultáneos no gastan dos veces el mismo saldo", async () => {
    expect(errCode(await ess.m("a", "loyalty.adjust", { clientId: client.Dani, direction: "credit", amount: 10, reason: "", key: key() }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "loyalty.adjust", { clientId: client.Dani, direction: "debit", amount: 10, reason: "corrección", key: key() }, adA))).toBe("BAD_REQUEST");
    const k = key();
    expect(data(await ess.m("a", "loyalty.adjust", { clientId: client.Dani, direction: "credit", amount: 100, reason: "bienvenida", key: k }, adA))).toMatchObject({ applied: true, balance: 100 });
    expect(data(await ess.m("a", "loyalty.adjust", { clientId: client.Dani, direction: "credit", amount: 100, reason: "bienvenida", key: k }, adA))).toMatchObject({ applied: false, balance: 100 });
    const results = await Promise.all(Array.from({ length: 5 }, () => ess.m("a", "loyalty.adjust", { clientId: client.Dani, direction: "debit", amount: 30, reason: "corrección", key: key() }, adA)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 200)) expect(errCode(r)).toBe("BAD_REQUEST");
    expect(await balance("Dani")).toBe(10);
    expect((await ess.sql("a", "SELECT MIN(balance_after) AS m FROM loyalty_ledger WHERE client_id = ?", [client.Dani]))[0].m).toBeGreaterThanOrEqual(0);
    // Anular el ajuste de bienvenida (ya gastado) deja deuda: es la única vía que puede bajar de cero
    const [welcome] = await ess.sql("a", "SELECT id FROM loyalty_ledger WHERE idem_key = ?", [`manual:${k}`]);
    expect(data(await ess.m("a", "loyalty.reverse", { ledgerId: welcome.id, reason: "error de alta" }, adA))).toMatchObject({ applied: true, balance: -90 });
    expect(errCode(await ess.m("a", "loyalty.reverse", { ledgerId: welcome.id, reason: "error de alta" }, adA))).toBe("CONFLICT");
  });

  it("campañas: multiplicador con límite por cliente y presupuesto total, también con ventas simultáneas", async () => {
    const c = data(await ess.m("a", "loyalty.saveCampaign", { id: null, campaign: { name: "Dobles", scope: "all", scopeId: null, multiplier: 2, bonusPoints: null, budgetPoints: 25, perClientLimit: 15, limitPeriod: "month", priority: 0, active: true, startsAt: null, endsAt: null } }, adA));
    const before = await balance("Ana");
    expect(data(await sell("a", 1, { clientId: client.Ana })).loyalty.points).toBe(20);
    // Límite por cliente (15 al mes): solo quedan 5 de extra
    expect(data(await sell("a", 1, { clientId: client.Ana })).loyalty.points).toBe(15);
    expect(data(await sell("a", 1, { clientId: client.Ana })).loyalty.points).toBe(10);
    expect(await balance("Ana")).toBe(before + 45);
    // Presupuesto: quedan 10 de 25; tres ventas simultáneas de Eva nunca lo superan
    const sales = await Promise.all(Array.from({ length: 3 }, () => sell("a", 1, { clientId: client.Eva })));
    for (const s of sales) expect(s.status).toBe(200);
    const [used] = await ess.sql("a", "SELECT SUM(campaign_points) AS u FROM loyalty_ledger WHERE campaign_id = ?", [c.id]);
    expect(Number(used.u)).toBe(25);
    expect(await balance("Eva")).toBe(40);
    const list = data(await ess.q("a", "loyalty.campaigns", undefined, adA));
    expect(list.find((x: any) => x.id === c.id).used).toBe(25);
    await ess.m("a", "loyalty.saveCampaign", { id: c.id, campaign: { name: "Dobles", scope: "all", scopeId: null, multiplier: 2, bonusPoints: null, budgetPoints: 25, perClientLimit: 15, limitPeriod: "month", priority: 0, active: false, startsAt: null, endsAt: null } }, adA);
  });

  it("acciones permitidas: puntos fijos con límite por cliente e idempotencia por clave", async () => {
    await ess.m("a", "loyalty.saveRule", { id: null, rule: { ...baseRule, name: "Reseña", trigger: "action", actionKey: "resena", calc: "fixed", rate: null, fixedPoints: 15, limitCount: 1, limitPeriod: "lifetime" } }, adA);
    const before = await balance("Bea");
    const k = key();
    expect(data(await ess.m("a", "loyalty.awardAction", { clientId: client.Bea, action: "resena", key: k }, adA))).toMatchObject({ points: 15, applied: true });
    expect(data(await ess.m("a", "loyalty.awardAction", { clientId: client.Bea, action: "resena", key: k }, adA)).applied).toBe(false);
    expect(errCode(await ess.m("a", "loyalty.awardAction", { clientId: client.Bea, action: "resena", key: key() }, adA))).toBe("BAD_REQUEST");
    expect(await balance("Bea")).toBe(before + 15);
  });

  it("tienda online: el pedido pagado emite una vez (notificaciones repetidas) y anularlo retira los puntos una vez", async () => {
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, adA)).status).toBe(200);
    const r = await ess.m("a", "reservations.cartCheckout", { items: [{ productId: productId.a, bookingDate: "2030-06-01", people: 2 }], customerName: "Bea", customerEmail: "bea@cliente-a.example", origin: `https://${ess.host("a")}` });
    expect(r.status).toBe(200);
    const merchantOrder = data(r).merchantOrder;
    const [res] = await ess.sql("a", "SELECT id, amount_total FROM reservations WHERE merchant_order = ?", [merchantOrder]);
    const before = await balance("Bea");
    const expected = Math.floor(Number(res.amount_total) / 100);
    expect(expected).toBeGreaterThan(0);
    const ipn = () => ess.call("a", "POST", "/api/redsys/notification", {
      raw: signedNotification({ Ds_Order: merchantOrder, Ds_Response: "0000", Ds_Amount: String(res.amount_total), Ds_AuthorisationCode: "123456" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const notes = await Promise.all([ipn(), ipn(), ipn()]);
    for (const nn of notes) expect(nn.text).toBe("OK");
    let now = before;
    for (let i = 0; i < 40 && now === before; i++) {
      await new Promise((ok) => setTimeout(ok, 150));
      now = await balance("Bea");
    }
    await new Promise((ok) => setTimeout(ok, 500));
    expect(await balance("Bea")).toBe(before + expected);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_ledger WHERE source_type = 'reservation' AND source_id = ?", [String(res.id)]))[0].n).toBe(1);

    expect((await ess.m("a", "cancellations.cancelReservationDirect", { reservationId: res.id, reason: "desistimiento", compensationType: "devolucion", refundAmount: expected }, adA)).status).toBe(200);
    expect(await balance("Bea")).toBe(before);
    await ess.m("a", "dailyControl.cancelOperation", { type: "reservation", id: res.id }, adA);
    expect(await balance("Bea")).toBe(before);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_ledger WHERE source_type = 'reservation' AND source_id = ? AND kind = 'anulacion'", [String(res.id)]))[0].n).toBe(1);
  });

  it("caducidad: los puntos vencidos se retiran al consultar el monedero y quedan en el historial", async () => {
    await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "estrellas", eqPoints: 100, eqEuros: 1, expiryMonths: 12 }, adA);
    const before = await balance("Eva");
    const sale = await sell("a", 2, { clientId: client.Eva });
    expect(data(sale).loyalty.points).toBe(20);
    const [mv] = await ess.sql("a", "SELECT id, expires_at FROM loyalty_ledger WHERE source_type = 'tpv_sale' AND source_id = ?", [String(data(sale).sale.id)]);
    expect(Number(mv.expires_at)).toBeGreaterThan(Date.now());
    // Los créditos sin caducidad (emitidos antes de configurarla) siguen vigentes; el nuevo vence
    await ess.sql("a", "UPDATE loyalty_ledger SET expires_at = ? WHERE id = ?", [Date.now() - 1000, mv.id]);
    const w = data(await ess.q("a", "loyalty.wallet", { clientId: client.Eva }, agA));
    expect(w.wallet.balance).toBe(before);
    expect(w.ledger[0]).toMatchObject({ kind: "caducidad", amount: 20 });
    // Repetir no caduca más
    expect(data(await ess.m("a", "loyalty.runExpiry", undefined, adA))).toEqual({ wallets: 0, points: 0 });
    await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "estrellas", eqPoints: 100, eqEuros: 1, expiryMonths: null }, adA);
  });

  it("estadísticas de emisión, uso y saldos", async () => {
    const s = data(await ess.q("a", "loyalty.overview", undefined, adA)).stats;
    const [sum] = await ess.sql("a", "SELECT COALESCE(SUM(balance), 0) AS b FROM loyalty_wallets");
    expect(s.outstanding).toBe(Number(sum.b));
    expect(s.issued).toBeGreaterThan(0);
    expect(s.expired).toBe(20);
    expect(s.wallets).toBeGreaterThanOrEqual(4);
  });

  it("aislamiento: la empresa B no ve ni toca los puntos de A", async () => {
    await ess.setCapability("b", CAP, "active");
    const ov = data(await ess.q("b", "loyalty.overview", undefined, adB));
    expect(ov.stats.issued).toBe(0);
    expect(data(await ess.q("b", "loyalty.wallets", {}, adB)).total).toBe(0);
    const [aLedger] = await ess.sql("a", "SELECT MAX(id) AS id FROM loyalty_ledger");
    expect(errCode(await ess.m("b", "loyalty.reverse", { ledgerId: Number(aLedger.id), reason: "intento" }, adB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM loyalty_ledger"))[0].n).toBe(0);
  });
});
