/**
 * Recuperación de un pedido de la tienda que quedó PAGADO pero sin cerrar, con la aplicación real sobre MySQL
 * (opt-in, REGISTRY_TEST_DATABASE_URL). Con inventario y puntos activados en la empresa.
 *
 * El fallo se provoca en la base de datos (un disparador que rechaza la inserción) DESPUÉS de registrar el pago y ANTES de
 * terminar el pedido; después se retira y se reenvía el aviso:
 *  S1. Stripe, fallo que interrumpe el aviso: el webhook responde 500, el pago consta, el stock ya se descontó UNA vez,
 *      no hay factura ni puntos. El reenvío del MISMO evento completa lo pendiente (cliente, puntos, factura, correo,
 *      contabilidad) sin descontar el stock otra vez.
 *  S2. Stripe, fallo absorbido dentro del cierre del pedido (la factura no se pudo crear): el evento se da por fallido
 *      para que Stripe reintente, y el reintento completa la factura una sola vez.
 *  S3. Redsys: mismo escenario con el aviso firmado; reenviarlo completa lo pendiente; repetirlo después no hace nada.
 *  S4. Un evento repetido de un pedido ya cerrado no cambia nada (stock, puntos, facturas, correos).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import Stripe from "stripe";
import mysql from "mysql2/promise";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { setConnectGatewayFactoryForTests } from "./paymentsConnect/runtime";
import { FakeConnectGateway } from "./paymentsConnect/testing";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");
const SECRET = "whsec_" + "e".repeat(32);
const ACCT_A = "acct_1TiendaEmpresaA001";
const ACCT_B = "acct_1TiendaEmpresaB002";
const PATH = "/api/stripe/connect/webhook";

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
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

describe.skipIf(!URL_)("Tienda web: recuperación de un pedido pagado que no llegó a cerrarse (Stripe y Redsys, aplicación real)", () => {
  let ess: EssentialApp;
  let reg: mysql.Pool;
  let admA = "";
  let tenantA = "";
  let tenantB = "";
  const fake = new FakeConnectGateway(ACCT_A);
  const ids = { camiseta: 0, sudadera: 0, xl: 0 };
  const order = { mo: "", session: "", total: 0 };
  const origin = () => `https://${ess.host("a")}`;
  const buyer = () => ({ customerName: "Lucía Prueba Pérez", customerEmail: "lucia@comprador-a.example", customerPhone: "600 111 222", origin: origin() });
  const cart = () => [{ productId: ids.sudadera, bookingDate: "", people: 2, variantId: ids.xl }, { productId: ids.camiseta, bookingDate: "", people: 1 }];

  const event = (id: string, o: { type?: string; account?: string; tenant?: string; livemode?: boolean; object?: Record<string, unknown> } = {}) => ({
    id,
    type: o.type ?? "checkout.session.completed",
    livemode: o.livemode ?? false,
    account: o.account ?? ACCT_A,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: order.session, payment_status: "paid", amount_total: order.total, currency: "eur", payment_intent: "pi_test_tienda", metadata: { tenant_id: o.tenant ?? tenantA, merchant_order: order.mo }, ...(o.object ?? {}) } },
  });
  const post = (host: "a" | "b", ev: unknown) => {
    const body = JSON.stringify(ev);
    return ess.call(host, "POST", PATH, { raw: body, headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) } });
  };
  const resv = () => ess.sql("a", "SELECT status, amount_paid AS paid, invoiceId, client_id AS clientId FROM reservations WHERE merchant_order = ? ORDER BY id", [order.mo]);
  const invoices = () => ess.sql("a", "SELECT id, status, paymentMethod, total, clientEmail FROM invoices");
  const orderMails = () => ess.mails.filter((m) => m.subject.startsWith("Pedido confirmado") && m.to.some((t) => t.email === "lucia@comprador-a.example"));
  const setStripe = (online: 0 | 1, status = "verificada") => ess.sql("a", "UPDATE payment_accounts SET online_enabled = ?, status = ? WHERE mode='test'", [online, status]);

  beforeAll(async () => {
    process.env.CONNECT_STRIPE_MODE = "test";
    process.env.CONNECT_STRIPE_API_KEY = "rk_test_" + "d".repeat(24);
    process.env.CONNECT_STRIPE_WEBHOOK_SECRET = SECRET;
    setConnectGatewayFactoryForTests(() => fake);
    ess = await startEssentialApp(URL_!, "tiendastripe");
    tenantA = ess.ids.a;
    tenantB = ess.ids.b;
    admA = await ess.login("a", "admin");
    await ess.markPaid("a");
    reg = mysql.createPool({ uri: process.env.REGISTRY_DATABASE_URL!, connectionLimit: 3 });
    for (const [acct, tid] of [[ACCT_A, tenantA], [ACCT_B, tenantB]] as const) await reg.query("INSERT INTO tenant_payment_accounts (account_id, tenant_id, provider, mode, claimed_at) VALUES (?, ?, 'stripe', 'test', ?)", [acct, tid, Date.now()]);
    const now = Date.now();
    for (const [co, acct] of [["a", ACCT_A], ["b", ACCT_B]] as const) await ess.sql(co, "INSERT INTO payment_accounts (provider, mode, account_id, status, charges_enabled, payouts_enabled, details_submitted, online_enabled, connected_at, verified_at, updated_at) VALUES ('stripe','test',?,'verificada',1,1,1,1,?,?,?)", [acct, now, now, now]);

    expect((await ess.m("a", "products.createCategory", { slug: "ropa", name: "Ropa" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "tienda", name: "Tienda" }, admA)).status).toBe(200);
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    const mk = (slug: string, title: string, basePrice: string, extra: Record<string, unknown> = {}) => ess.m("a", "products.create", { slug, title, categoryId: c.id, locationId: l.id, basePrice, productType: "own", ...extra }, admA);
    expect((await mk("camiseta-logo", "Camiseta logo", "24.20")).status).toBe(200);
    expect((await mk("sudadera-capucha", "Sudadera con capucha", "39.90", { taxRate: "10" })).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, slug FROM experiences")) {
      if (r.slug === "camiseta-logo") ids.camiseta = r.id;
      if (r.slug === "sudadera-capucha") ids.sudadera = r.id;
    }
    for (const [i, [name, price]] of [["Talla M", "39.90"], ["Talla XL", "42.50"]].entries()) {
      expect((await ess.m("a", "products.createVariant", { experienceId: ids.sudadera, name, priceModifier: price, priceType: "fixed", isRequired: true, sortOrder: i }, admA)).status).toBe(200);
    }
    ids.xl = (await ess.sql("a", "SELECT id FROM experience_variants WHERE name = 'Talla XL'"))[0].id;
    // Redsys también configurado (cuenta de comercio FICTICIA): el comprador puede elegir
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admA)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    setConnectGatewayFactoryForTests(null);
    await reg?.end();
    await ess?.close();
  });


  const k = (n: number) => ({ key: `recup-${Date.now()}-${n}-abcdefgh` });
  const stock = async () => Object.fromEntries((await ess.sql("a", "SELECT i.product_id AS p, i.variant_id AS v, l.on_hand AS n FROM inventory_items i JOIN inventory_levels l ON l.item_id = i.id")).map((r) => [`${r.p}:${r.v}`, Number(r.n)]));
  const stockMoves = async () => Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM inventory_movements WHERE source_type = 'reservation'"))[0].n);
  const pointsMoves = async () => Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM loyalty_ledger WHERE source_type = 'reservation'"))[0].n);
  const pointsTotal = async () => Number((await ess.sql("a", "SELECT COALESCE(SUM(amount),0) AS n FROM loyalty_ledger WHERE source_type = 'reservation'"))[0].n);
  const invoicesOf = async (mo: string) => Number((await ess.sql("a", "SELECT COUNT(DISTINCT i.id) AS n FROM invoices i JOIN reservations r ON r.invoiceId = i.id WHERE r.merchant_order = ?", [mo]))[0].n);
  const statusOf = async (mo: string) => (await ess.sql("a", "SELECT status FROM reservations WHERE merchant_order = ? ORDER BY id", [mo])).map((r) => r.status);
  const mailsOf = (mo: string) => ess.mails.filter((m) => m.subject.includes(mo) && m.to.some((t) => t.email === "lucia@comprador-a.example"));
  // Los disparadores necesitan privilegios de administrador: se crean con la conexión raíz del servidor de pruebas
  const asRoot = async (q: string) => {
    const [{ db }] = await ess.sql("a", "SELECT DATABASE() AS db");
    const c = await mysql.createConnection({ uri: URL_!, database: db });
    try {
      await c.query(q);
    } finally {
      await c.end();
    }
  };
  const failOn = (table: string) => asRoot(`CREATE TRIGGER fallo_provocado BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo provocado por la prueba'`);
  // Falla el reparto del importe entre las reservas del carrito: ocurre DESPUÉS de registrar el pago y del descuento de stock
  const failAmountSplit = () => asRoot("CREATE TRIGGER fallo_provocado BEFORE UPDATE ON reservations FOR EACH ROW BEGIN IF OLD.status = 'paid' AND NEW.status = 'paid' AND NEW.amount_paid <> OLD.amount_paid THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo provocado por la prueba'; END IF; END");
  const heal = () => asRoot("DROP TRIGGER IF EXISTS fallo_provocado");
  const evFor = (o: { mo: string; session: string; total: number }, id: string, type = "checkout.session.completed") => ({
    id,
    type,
    livemode: false,
    account: ACCT_A,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: o.session, payment_status: "paid", amount_total: o.total, currency: "eur", payment_intent: "pi_" + id, metadata: { tenant_id: tenantA, merchant_order: o.mo } } },
  });
  const stripeOrder = async (items: unknown[], total: number) => {
    const r = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items, provider: "stripe" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return { mo: data(r).merchantOrder as string, session: `cs_test_${fake.sessions.length}`, total };
  };

  beforeAll(async () => {
    process.env.PAYMENT_RECOVERY_MIN_AGE_MS = "0";
    await ess.setCapability("a", "inventory-basic", "active");
    await ess.setCapability("a", "social-token-net-tokens", "active");
    // Inventario: camiseta (sin variante) y sudadera XL, 10 unidades cada una
    for (const [n, [productId, variantId]] of [[ids.camiseta, 0], [ids.sudadera, ids.xl]].entries()) {
      const t = await ess.m("a", "inventory.track", { productId, variantId, policy: "block", minStock: 0 }, admA);
      expect(t.status, JSON.stringify(t.json)).toBe(200);
      const [it] = await ess.sql("a", "SELECT id FROM inventory_items WHERE product_id = ? AND variant_id = ?", [productId, variantId]);
      const rc = await ess.m("a", "inventory.receive", { itemId: it.id, quantity: 10, reason: "alta de prueba", ...k(n) }, admA);
      expect(rc.status, JSON.stringify(rc.json)).toBe(200);
    }
    // Puntos: 1 punto por euro gastado en la tienda
    const pr = await ess.m("a", "loyalty.saveProgram", { enabled: true, pointsName: "Puntos", eqPoints: 1, eqEuros: 1, expiryMonths: null }, admA);
    expect(pr.status, JSON.stringify(pr.json)).toBe(200);
    const ru = await ess.m("a", "loyalty.saveRule", { id: null, rule: { name: "Compra online", trigger: "purchase", actionKey: null, scope: "all", scopeId: null, calc: "per_euro", rate: 1, fixedPoints: null, minSpend: null, maxPoints: null, limitCount: null, limitPeriod: null, priority: 0, active: true, startsAt: null, endsAt: null } }, admA);
    expect(ru.status, JSON.stringify(ru.json)).toBe(200);
    await setStripe(1);
  }, 120_000);

  it("S1. Stripe: un fallo tras registrar el pago interrumpe el aviso; reenviar el mismo evento completa lo pendiente sin repetir lo aplicado", async () => {
    const o = await stripeOrder([{ productId: ids.sudadera, bookingDate: "", people: 2, variantId: ids.xl }, { productId: ids.camiseta, bookingDate: "", people: 1 }], 2 * 4250 + 2420);
    const before = await stock();
    expect(before).toEqual({ [`${ids.camiseta}:0`]: 10, [`${ids.sudadera}:${ids.xl}`]: 10 });

    await failAmountSplit();
    const first = await post("a", evFor(o, "evt_recup_1"));
    expect(first.status).toBe(500);
    // El pago consta; lo aplicado hasta el fallo (stock) está hecho UNA vez; lo posterior no
    expect(await statusOf(o.mo)).toEqual(["paid", "paid"]);
    expect(await stock()).toEqual({ [`${ids.camiseta}:0`]: 9, [`${ids.sudadera}:${ids.xl}`]: 8 });
    const movesAfterFail = await stockMoves();
    expect(movesAfterFail).toBe(2);
    expect(await invoicesOf(o.mo)).toBe(0);
    expect(await pointsMoves()).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients"))[0].n).toBe(0);
    expect(mailsOf(o.mo)).toHaveLength(0);
    // Stripe verá el evento como fallido: la sesión vuelve a «pendiente» y el evento queda reabrible
    expect((await ess.sql("a", "SELECT status FROM payment_checkouts WHERE session_id = ?", [o.session]))[0].status).toBe("pending");
    expect((await ess.sql("a", "SELECT outcome FROM payment_events WHERE event_id = 'evt_recup_1'"))[0].outcome).toBe("failed");

    await heal();
    const retry = await post("a", evFor(o, "evt_recup_1"));
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ outcome: "applied" });
    await waitFor(() => mailsOf(o.mo), (m) => m.length > 0);
    expect(await invoicesOf(o.mo)).toBe(1);
    expect(await statusOf(o.mo)).toEqual(["paid", "paid"]);
    // El importe se reparte entre las reservas en proporción a cada una (suma = lo cobrado), también tras la recuperación
    const paid = (await ess.sql("a", "SELECT amount_paid AS p FROM reservations WHERE merchant_order = ? ORDER BY id", [o.mo])).map((r) => Number(r.p));
    expect(paid.reduce((a, b) => a + b, 0)).toBe(o.total);
    expect(paid.every((v) => v < o.total)).toBe(true);
    // Efectos pendientes completados…
    expect(await pointsMoves()).toBe(2);
    expect(await pointsTotal()).toBeGreaterThan(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients"))[0].n).toBe(1);
    expect(mailsOf(o.mo)).toHaveLength(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions WHERE reservationRef LIKE ?", [`%${o.mo}%`]))[0].n).toBeGreaterThan(0);
    // …y lo ya aplicado NO se repite
    expect(await stock()).toEqual({ [`${ids.camiseta}:0`]: 9, [`${ids.sudadera}:${ids.xl}`]: 8 });
    expect(await stockMoves()).toBe(movesAfterFail);
    expect(data(await ess.q("a", "reservations.getStatus", { merchantOrder: o.mo }))).toMatchObject({ status: "paid", orderTotalCents: o.total });
  });

  it("S4. un evento repetido de un pedido ya cerrado no cambia nada (stock, puntos, facturas, correos)", async () => {
    const [mo] = (await ess.sql("a", "SELECT merchant_order AS mo FROM reservations ORDER BY id LIMIT 1")).map((r) => r.mo as string);
    const snap = async () => JSON.stringify({ s: await stock(), sm: await stockMoves(), pm: await pointsMoves(), pt: await pointsTotal(), inv: await invoicesOf(mo), mails: mailsOf(mo).length, cl: (await ess.sql("a", "SELECT COUNT(*) AS n FROM clients"))[0].n, tx: (await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n });
    const before = await snap();
    const o = { mo, session: (await ess.sql("a", "SELECT session_id FROM payment_checkouts WHERE merchant_order = ?", [mo]))[0].session_id as string, total: 2 * 4250 + 2420 };
    for (const [i, t] of ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.completed"].entries()) {
      expect((await post("a", evFor(o, `evt_recup_dup_${i}`, t))).json).toMatchObject({ outcome: "duplicate" });
    }
    await new Promise((r) => setTimeout(r, 800));
    expect(await snap()).toBe(before);
  });

  it("S2. Stripe: si el cierre del pedido absorbe un fallo (sin factura), el evento se da por fallido y el reintento la emite una sola vez", async () => {
    const o = await stripeOrder([{ productId: ids.camiseta, bookingDate: "", people: 1 }], 2420);
    await failOn("invoices");
    const first = await post("a", evFor(o, "evt_recup_2"));
    expect(first.status).toBe(500);
    expect(await statusOf(o.mo)).toEqual(["paid"]);
    expect(await invoicesOf(o.mo)).toBe(0);
    await heal();
    const retry = await post("a", evFor(o, "evt_recup_2"));
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ outcome: "applied" });
    await waitFor(() => mailsOf(o.mo), (m) => m.length > 0);
    expect(await invoicesOf(o.mo)).toBe(1);
    // El camiseta: una unidad por pedido, descontada una sola vez por cada uno (S1 y S2)
    expect((await stock())[`${ids.camiseta}:0`]).toBe(8);
    expect(mailsOf(o.mo)).toHaveLength(1);
  });

  it("S3. Redsys: el aviso cortado a medias se completa al reenviarlo y repetirlo después no duplica nada", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.camiseta, bookingDate: "", people: 1 }] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = data(r);
    const mo = d.merchantOrder as string;
    const notify = () => ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: mo, Ds_Response: "0000", Ds_Amount: String(d.totalAmountCents), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const stockBefore = (await stock())[`${ids.camiseta}:0`];
    const pointsBefore = await pointsMoves();

    await failOn("invoices");
    expect((await notify()).text).toBe("OK"); // Redsys recibe OK antes de procesar; el fallo queda dentro
    await waitFor(() => statusOf(mo), (s) => s[0] === "paid");
    await new Promise((r2) => setTimeout(r2, 800));
    expect(await invoicesOf(mo)).toBe(0);
    expect((await stock())[`${ids.camiseta}:0`]).toBe(stockBefore - 1);

    await heal();
    expect((await notify()).text).toBe("OK");
    await waitFor(() => invoicesOf(mo), (n) => n > 0);
    expect(await invoicesOf(mo)).toBe(1);
    expect(await pointsMoves()).toBe(pointsBefore + 1);
    expect((await stock())[`${ids.camiseta}:0`]).toBe(stockBefore - 1);
    expect((await ess.sql("a", "SELECT paymentMethod FROM invoices WHERE id = (SELECT invoiceId FROM reservations WHERE merchant_order = ? LIMIT 1)", [mo]))[0].paymentMethod).toBe("tarjeta_redsys");

    // Repetirlo con el pedido ya cerrado no hace nada
    const inv = Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n);
    await notify();
    await new Promise((r2) => setTimeout(r2, 800));
    expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n)).toBe(inv);
    expect(mailsOf(mo)).toHaveLength(1);
    expect(await pointsMoves()).toBe(pointsBefore + 1);
    expect((await stock())[`${ids.camiseta}:0`]).toBe(stockBefore - 1);
  });
});
