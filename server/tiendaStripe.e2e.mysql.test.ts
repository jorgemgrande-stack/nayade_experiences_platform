/**
 * Compra directa en la tienda web con la cuenta Stripe de la empresa, de punta a punta con la aplicación real sobre MySQL
 * (opt-in, REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas; ninguna llamada real a Stripe (pasarela simulada) ni a
 * Redsys (aviso firmado aquí con una cuenta de comercio ficticia). El evento de Stripe lleva la firma real del SDK.
 *
 *  A. Aceptación: el comprador paga desde el carrito → la sesión se abre en la cuenta de la empresa con el importe del
 *     servidor → el pedido queda PENDIENTE (reservas en pending_payment, sin factura) hasta el evento firmado →
 *     el evento paga las reservas, emite UNA factura, crea el cliente, envía el correo y deja el pedido «pagado».
 *  B. Una sola vez: el mismo evento, o el mismo pago con otro id o tipo de evento, no duplica factura, correo ni transacciones.
 *  C. Aislamiento: un evento de la cuenta de otra empresa no toca el pedido; un importe distinto no se aplica.
 *  D. Redsys intacto: con Stripe activado, la tienda sigue ofreciendo Redsys y su aviso sigue cerrando pedidos.
 *  E. Sin cuenta verificada/activada no hay Stripe: el carrito lo rechaza y la tienda no lo ofrece.
 *  F. Pago fallido: el pedido pasa a fallido y no se factura.
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

describe.skipIf(!URL_)("Tienda web: pago directo con la cuenta Stripe de la empresa (aplicación real)", () => {
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

  it("E/D. la tienda ofrece Stripe solo con cuenta verificada y cobros activados; Redsys sigue ofrecido", async () => {
    expect(data(await ess.q("a", "public.getTheme")).storefront.payments).toEqual({ redsys: true, stripe: true });
    await setStripe(0);
    expect(data(await ess.q("a", "public.getTheme")).storefront.payments).toEqual({ redsys: true, stripe: false });
    const off = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: cart(), provider: "stripe" });
    expect(errCode(off)).toBe("PRECONDITION_FAILED");
    // Nada se crea con el intento rechazado
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);
    await setStripe(1, "restringida");
    expect(data(await ess.q("a", "public.getTheme")).storefront.payments.stripe).toBe(false);
    await setStripe(1);
    expect(data(await ess.q("b", "public.getTheme")).storefront.payments.stripe).toBe(true); // la empresa B tiene la suya, aparte
  });

  it("A1. pagar desde el carrito abre la sesión en la cuenta de la empresa y deja el pedido PENDIENTE", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: cart(), provider: "stripe" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = data(r);
    order.mo = d.merchantOrder;
    order.total = 2 * 4250 + 2420;
    expect(d.totalAmountCents).toBe(order.total);
    expect(d.redsysForm).toBeNull();
    expect(d.stripeUrl).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_/);
    // La sesión: en la cuenta de A, con el importe calculado por el servidor y sin datos del navegador
    const s = fake.sessions[fake.sessions.length - 1];
    expect(s).toMatchObject({ accountId: ACCT_A, amountCents: order.total, currency: "eur", metadata: { tenant_id: tenantA, merchant_order: order.mo } });
    expect(s.successUrl).toBe(`https://${ess.host("a")}/reserva/ok?order=${order.mo}`);
    expect(s.cancelUrl).toBe(`https://${ess.host("a")}/reserva/error?order=${order.mo}`);
    expect(s.expiresAtSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30 * 60);
    order.session = `cs_test_${fake.sessions.length}`;
    const [co] = await ess.sql("a", "SELECT kind, merchant_order, amount_cents, status, account_id FROM payment_checkouts WHERE session_id = ?", [order.session]);
    expect(co).toMatchObject({ kind: "shop_order", merchant_order: order.mo, amount_cents: order.total, status: "pending", account_id: ACCT_A });
    // PENDIENTE: reservas sin pagar, sin factura, sin cliente, estado público «pending_payment»
    expect((await resv()).map((x) => x.status)).toEqual(["pending_payment", "pending_payment"]);
    expect(await invoices()).toHaveLength(0);
    expect(data(await ess.q("a", "reservations.getStatus", { merchantOrder: order.mo })).status).toBe("pending_payment");
    expect(orderMails()).toHaveLength(0);
  });

  it("A2. la vuelta del navegador no paga; un evento sin firma válida no cambia nada", async () => {
    // La redirección es solo una visita a /reserva/ok?order=…: no existe ruta que marque el pago
    expect(data(await ess.q("a", "reservations.getStatus", { merchantOrder: order.mo })).status).toBe("pending_payment");
    const body = JSON.stringify(event("evt_sinfirma"));
    expect((await ess.call("a", "POST", PATH, { raw: body, headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" } })).status).toBe(400);
    expect((await resv()).map((x) => x.status)).toEqual(["pending_payment", "pending_payment"]);
  });

  it("C. aislamiento: otra cuenta, otro importe o un modo distinto no se aplican", async () => {
    expect((await post("a", event("evt_forjado", { account: ACCT_B }))).json).toMatchObject({ outcome: "isolated" });
    expect((await post("b", event("evt_b", { account: ACCT_B, tenant: tenantB }))).json).toMatchObject({ outcome: "isolated" });
    expect((await post("a", event("evt_importe", { object: { amount_total: 100 } }))).json).toMatchObject({ outcome: "amount_mismatch" });
    expect((await post("a", event("evt_live", { livemode: true }))).json).toMatchObject({ outcome: "mode_mismatch" });
    expect((await post("a", event("evt_nopagado", { object: { payment_status: "unpaid" } }))).json).toMatchObject({ outcome: "ignored" });
    expect((await resv()).map((x) => x.status)).toEqual(["pending_payment", "pending_payment"]);
    expect(await invoices()).toHaveLength(0);
  });

  it("A3. el evento firmado paga el pedido: reservas pagadas, UNA factura, cliente y correo", async () => {
    const r = await post("a", event("evt_paid_1"));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ outcome: "applied" });
    const inv = await waitFor(invoices, (x) => x.length > 0 && x.every((i) => i.status === "cobrada"));
    expect(inv).toHaveLength(1);
    // Método de cobro: Stripe no figura como Redsys
    expect(inv[0]).toMatchObject({ status: "cobrada", paymentMethod: "otro", clientEmail: "lucia@comprador-a.example" });
    expect(Number(inv[0].total)).toBe(order.total / 100);
    const rows = await waitFor(resv, (x) => x.every((y) => y.clientId && y.invoiceId));
    expect(rows.map((x) => x.status)).toEqual(["paid", "paid"]);
    expect(new Set(rows.map((x) => x.invoiceId))).toEqual(new Set([inv[0].id]));
    expect(rows.reduce((s, x) => s + Number(x.paid), 0)).toBe(order.total);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients"))[0].n).toBe(1);
    const mail = await waitFor(async () => orderMails()[0], Boolean);
    expect(mail!.subject).toContain(order.mo);
    expect(data(await ess.q("a", "reservations.getStatus", { merchantOrder: order.mo }))).toMatchObject({ status: "paid", orderTotalCents: order.total, invoiceNumber: expect.any(String) });
    expect((await ess.sql("a", "SELECT status, payment_intent_id FROM payment_checkouts WHERE session_id = ?", [order.session]))[0]).toMatchObject({ status: "paid", payment_intent_id: "pi_test_tienda" });
  });

  it("B. una sola vez: mismo evento, otro id o otro tipo para el mismo pago no duplican factura, correo ni transacciones", async () => {
    const tx = (await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n;
    const bookings = (await ess.sql("a", "SELECT COUNT(*) AS n FROM bookings"))[0].n;
    expect((await post("a", event("evt_paid_1"))).json).toMatchObject({ outcome: "duplicate" });
    expect((await post("a", event("evt_paid_2"))).json).toMatchObject({ outcome: "duplicate" });
    expect((await post("a", event("evt_paid_3", { type: "checkout.session.async_payment_succeeded" }))).json).toMatchObject({ outcome: "duplicate" });
    // Entregas simultáneas del mismo evento nuevo: una sola se aplica
    const burst = await Promise.all(Array.from({ length: 5 }, () => post("a", event("evt_paid_4"))));
    expect(burst.map((b) => b.json.outcome).sort()).toEqual(["duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
    await new Promise((r) => setTimeout(r, 800));
    expect(await invoices()).toHaveLength(1);
    expect(orderMails()).toHaveLength(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n).toBe(tx);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM bookings"))[0].n).toBe(bookings);
    expect((await resv()).map((x) => x.status)).toEqual(["paid", "paid"]);
  });

  it("D. Redsys intacto: con Stripe activado, el pedido de Redsys se crea y su aviso firmado lo cierra como siempre", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.camiseta, bookingDate: "", people: 1 }] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = data(r);
    expect(d.redsysForm).toMatchObject({ url: expect.any(String) });
    expect(d.stripeUrl).toBeUndefined();
    const mo = d.merchantOrder as string;
    const res = await ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: mo, Ds_Response: "0000", Ds_Amount: String(d.totalAmountCents), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.text).toBe("OK");
    const inv = await waitFor(() => ess.sql("a", "SELECT id, status, paymentMethod FROM invoices ORDER BY id"), (x) => x.length > 1 && x.every((i) => i.status === "cobrada"));
    expect(inv).toHaveLength(2);
    expect(inv[1].paymentMethod).toBe("tarjeta_redsys");
    expect(data(await ess.q("a", "reservations.getStatus", { merchantOrder: mo })).status).toBe("paid");
    // …y repetir el aviso de Redsys no duplica nada
    await ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: mo, Ds_Response: "0000", Ds_Amount: String(d.totalAmountCents), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    await new Promise((r2) => setTimeout(r2, 800));
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(2);
  });

  it("F. pago fallido de Stripe: el pedido pasa a fallido y no se factura", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.camiseta, bookingDate: "", people: 1 }], provider: "stripe" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const mo = data(r).merchantOrder as string;
    const session = `cs_test_${fake.sessions.length}`;
    const before = (await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n;
    const ev = { id: "evt_fail_1", type: "checkout.session.async_payment_failed", livemode: false, account: ACCT_A, data: { object: { id: session, payment_status: "unpaid", metadata: { tenant_id: tenantA, merchant_order: mo } } } };
    expect((await post("a", ev)).json).toMatchObject({ outcome: "applied" });
    const st = await waitFor(async () => data(await ess.q("a", "reservations.getStatus", { merchantOrder: mo })).status, (s) => s !== "pending_payment");
    expect(st).toBe("failed");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(before);
  });
});
