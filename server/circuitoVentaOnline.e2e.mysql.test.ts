/**
 * CIRCUITO COMPLETO de la venta online de Quantum con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas; pasarela Stripe SIMULADA (ninguna llamada real), webhook con la firma real del SDK, Redsys sin
 * configurar. Cobros reales apagados. La versión con BD simulada (circuitoVentaOnline.test.ts) cubre el mismo circuito sin MySQL;
 * aquí se comprueban las consultas SQL reales (huella, retención atómica, cupón condicional, cierre del pedido).
 *
 *  A. Retiro con edición (precio de la edición, opción «desde 2 participantes», cupón de un solo uso, condiciones y nombres):
 *     importe del servidor, plazas retenidas, historial, sesión en la cuenta de la empresa; el evento firmado paga UNA vez,
 *     confirma la plaza, consume el cupón una vez y deja factura única y correo en el idioma del comprador.
 *  B. Doble clic: dos peticiones seguidas y en paralelo comparten pedido, plazas y sesión (también con las últimas plazas).
 *  C. Dos compradores a la última plaza: solo uno.
 *  D. Sesión caducada: cancela el pedido y libera plazas; pago tardío re-ocupa o queda en conflicto sin sobrevender.
 *  E. Reembolso y disputa: marcan y avisan sin tocar plazas ni reservas; repetidos, idempotentes.
 *  F. Aislamiento: un evento de la cuenta de otra empresa no afecta; un producto de otra empresa es NOT_FOUND.
 *  G. Producto no vendible o con ediciones sin ninguna abierta: no entra al carrito.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Stripe from "stripe";
import mysql from "mysql2/promise";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { setConnectGatewayFactoryForTests } from "./paymentsConnect/runtime";
import { FakeConnectGateway } from "./paymentsConnect/testing";
import { ConnectGatewayError, type CheckoutParams } from "./paymentsConnect/gateway";

/** Como Stripe: la misma clave de idempotencia con los MISMOS parámetros devuelve la misma sesión; con otros, error de idempotencia. */
class ReplayGateway extends FakeConnectGateway {
  private seen = new Map<string, { body: string; result: { id: string; url: string } }>();
  async createCheckoutSession(p: CheckoutParams) {
    const body = JSON.stringify({ ...p, idempotencyKey: undefined });
    const prev = this.seen.get(p.idempotencyKey);
    if (prev) {
      if (prev.body !== body) throw new ConnectGatewayError("Stripe rechazó la operación", "idempotency_error");
      return prev.result;
    }
    const result = await super.createCheckoutSession(p);
    this.seen.set(p.idempotencyKey, { body, result });
    return result;
  }
}

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const SECRET = "whsec_" + "f".repeat(32);
const ACCT_A = "acct_1CircuitoEmpresaA01";
const ACCT_B = "acct_1CircuitoEmpresaB02";
const PATH = "/api/stripe/connect/webhook";
const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

describe.skipIf(!URL_)("Circuito de venta online de Quantum: edición, cupón, Stripe, webhook e incidencias (aplicación real)", () => {
  let ess: EssentialApp;
  let reg: mysql.Pool;
  let admA = "";
  let tenantA = "";
  let tenantB = "";
  let retiro = 0;
  let curso = 0;
  let ajeno = 0;
  let n = 0;
  const fake = new ReplayGateway(ACCT_A);
  const origin = () => `https://${ess.host("a")}`;
  const buyer = () => ({ customerName: "Lena Beispiel", customerEmail: `lena${++n}@comprador.example`, origin: origin(), provider: "stripe" as const, consentAccepted: true });
  const sessionNo = () => fake.sessions.length;

  const mkEdition = async (over: Record<string, unknown> = {}) => {
    const r = await ess.m("a", "products.editions.create", { experienceId: retiro, form: { label: "Edición", startsLocal: "2037-03-10T10:00", endsLocal: "2037-03-12T14:00", timezone: "Europe/Madrid", scheduleNote: "", mode: "presencial", locationNote: "Casa de retiros", capacity: 6, showAvailability: false, status: "open", priceOverride: 450, ...over } }, admA);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return data(r).id as number;
  };
  const edRow = async (id: number) => (await ess.sql("a", "SELECT * FROM product_editions WHERE id = ?", [id]))[0];
  const checkout = (items: Array<Record<string, unknown>>, over: Record<string, unknown> = {}, email?: string) => ess.m("a", "reservations.cartCheckout", { ...buyer(), ...(email ? { customerEmail: email } : {}), items, ...over });
  const line = (over: Record<string, unknown> = {}) => ({ productId: retiro, bookingDate: "", people: 2, ...over });
  const post = (ev: unknown, secret = SECRET) => {
    const body = JSON.stringify(ev);
    return ess.call("a", "POST", PATH, { raw: body, headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) } });
  };
  let evn = 0;
  const completed = (session: string, mo: string, amount: number, o: { account?: string; tenant?: string; pi?: string } = {}) => ({
    id: `evt_circuito_${++evn}`, type: "checkout.session.completed", livemode: false, account: o.account ?? ACCT_A, created: Math.floor(Date.now() / 1000),
    data: { object: { id: session, payment_status: "paid", amount_total: amount, currency: "eur", payment_intent: o.pi ?? `pi_${session}`, metadata: { tenant_id: o.tenant ?? tenantA, merchant_order: mo } } },
  });
  const expired = (session: string) => ({ id: `evt_circuito_${++evn}`, type: "checkout.session.expired", livemode: false, account: ACCT_A, data: { object: { id: session } } });
  const charge = (type: string, pi: string, o: Record<string, unknown>) => ({ id: `evt_circuito_${++evn}`, type, livemode: false, account: ACCT_A, data: { object: { id: "ch_1", payment_intent: pi, currency: "eur", ...o } } });
  const rows = (mo: string) => ess.sql("a", "SELECT id, status, amount_total AS total, amount_paid AS paid, hold_status AS h, inventory_ref_id AS ed, inventory_units AS u, invoiceId, notes, changes_log FROM reservations WHERE merchant_order = ? ORDER BY id", [mo]);
  const log = (r: { changes_log: unknown }) => (typeof r.changes_log === "string" ? JSON.parse(r.changes_log) : (r.changes_log as any[])) ?? [];
  const invoices = () => ess.sql("a", "SELECT id, status, total FROM invoices");

  beforeAll(async () => {
    process.env.CONNECT_STRIPE_MODE = "test";
    process.env.CONNECT_STRIPE_API_KEY = "rk_test_" + "d".repeat(24);
    process.env.CONNECT_STRIPE_WEBHOOK_SECRET = SECRET;
    setConnectGatewayFactoryForTests(() => fake);
    ess = await startEssentialApp(URL_!, "circuitoventa");
    tenantA = ess.ids.a;
    tenantB = ess.ids.b;
    admA = await ess.login("a", "admin");
    await ess.markPaid("a");
    reg = mysql.createPool({ uri: process.env.REGISTRY_DATABASE_URL!, connectionLimit: 3 });
    for (const [acct, tid] of [[ACCT_A, tenantA], [ACCT_B, tenantB]] as const) await reg.query("INSERT INTO tenant_payment_accounts (account_id, tenant_id, provider, mode, claimed_at) VALUES (?, ?, 'stripe', 'test', ?)", [acct, tid, Date.now()]);
    const now = Date.now();
    for (const [co, acct] of [["a", ACCT_A], ["b", ACCT_B]] as const) await ess.sql(co, "INSERT INTO payment_accounts (provider, mode, account_id, status, charges_enabled, payouts_enabled, details_submitted, online_enabled, connected_at, verified_at, updated_at) VALUES ('stripe','test',?,'verificada',1,1,1,1,?,?,?)", [acct, now, now, now]);
    expect((await ess.m("a", "products.createCategory", { slug: "retiros", name: "Retiros" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "casa", name: "Casa" }, admA)).status).toBe(200);
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    const mk = (slug: string, title: string, basePrice: string, extra: Record<string, unknown> = {}) => ess.m("a", "products.create", { slug, title, categoryId: c.id, locationId: l.id, basePrice, productType: "own", ...extra }, admA);
    expect((await mk("retiro", "Retiro Quantum", "500.00")).status).toBe(200);
    expect((await mk("curso-solicitud", "Curso bajo solicitud", "90.00", { offerMode: "priced_request" })).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, slug FROM experiences")) {
      if (r.slug === "retiro") retiro = r.id;
      if (r.slug === "curso-solicitud") curso = r.id;
    }
    // Opciones: «Individual» (máx. 1) y «Desde 2 participantes» (mín. 2), precio por persona
    expect((await ess.m("a", "products.createVariant", { experienceId: retiro, name: "Individual", priceModifier: "480.00", priceType: "fixed", isRequired: false, sortOrder: 0, maxQty: 1 }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createVariant", { experienceId: retiro, name: "Desde 2 participantes", priceModifier: "400.00", priceType: "per_person", isRequired: false, sortOrder: 1, minQty: 2 }, admA)).status).toBe(200);
    // Condiciones y nombres de participantes: ajustes de la empresa
    for (const [key, value] of [["checkout_consent_required", "true"], ["checkout_terms_url", "/agb"], ["checkout_privacy_url", "/datenschutz"], ["checkout_participants_enabled", "true"]]) {
      await ess.sql("a", "INSERT INTO system_settings (`key`, value, label) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value, key]);
    }
    // Un producto de la empresa B con id propio (no debe existir en A)
    admB = await ess.login("b", "admin");
    await ess.markPaid("b");
    expect((await ess.m("b", "products.createCategory", { slug: "cat", name: "Cat" }, admB)).status).toBe(200);
    expect((await ess.m("b", "products.createLocation", { slug: "loc", name: "Loc" }, admB)).status).toBe(200);
    const [cb] = await ess.sql("b", "SELECT id FROM categories LIMIT 1");
    const [lb] = await ess.sql("b", "SELECT id FROM locations LIMIT 1");
    for (let i = 0; i < 4; i++) expect((await ess.m("b", "products.create", { slug: `b-${i}`, title: `B ${i}`, categoryId: cb.id, locationId: lb.id, basePrice: "10.00", productType: "own" }, admB)).status).toBe(200);
    ajeno = Math.max(...(await ess.sql("b", "SELECT id FROM experiences")).map((r: any) => r.id));
  }, 300_000);
  let admB = "";
  afterAll(async () => {
    setConnectGatewayFactoryForTests(null);
    await reg?.end();
    await ess?.close();
  });

  const variantId = async (name: string) => (await ess.sql("a", "SELECT id FROM experience_variants WHERE name = ?", [name]))[0].id as number;
  const setCode = async (over: { maxUses?: number | null; uses?: number } = {}) => {
    await ess.sql("a", "DELETE FROM discount_codes WHERE code = 'AMIGOS'");
    await ess.sql("a", "INSERT INTO discount_codes (code, name, discount_type, discount_percent, status, max_uses, current_uses) VALUES ('AMIGOS', 'Amigos', 'percent', 10, 'active', ?, ?)", [over.maxUses === undefined ? 1 : over.maxUses, over.uses ?? 0]);
    const [c] = await ess.sql("a", "SELECT id FROM discount_codes WHERE code = 'AMIGOS'");
    return { discountCodeId: c.id as number, discountCode: "AMIGOS" };
  };

  it("A. retiro con edición, opción «desde 2», cupón, condiciones y participantes: de la compra al pago, una sola vez", async () => {
    const coupon = await setCode();
    const ed = await mkEdition({ capacity: 6 });
    const desde2 = await variantId("Desde 2 participantes");
    const r = await checkout([line({ people: 2, variantId: desde2, editionId: ed, participants: ["Lena Beispiel", "Jonas Muster"] })], { ...coupon, locale: "de" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = data(r);
    expect(d.totalAmountCents).toBe(80000); // la opción por persona (400 €) sustituye al precio de la edición
    const sess = fake.sessions[fake.sessions.length - 1];
    expect(sess).toMatchObject({ accountId: ACCT_A, amountCents: 72000, currency: "eur", metadata: { tenant_id: tenantA, merchant_order: d.merchantOrder } });
    const [row] = await rows(d.merchantOrder);
    expect(row).toMatchObject({ status: "pending_payment", h: "retenida", ed, u: 2 });
    expect(Number((await edRow(ed)).reserved)).toBe(2);
    const entries = log(row);
    expect(entries.some((e: any) => e.action === "checkout_huella")).toBe(true);
    expect(JSON.parse(entries.find((e: any) => e.action === "descuento_codigo").to)).toMatchObject({ discountCents: 8000, finalCents: 72000 });
    expect(entries.some((e: any) => e.action === "aceptacion_condiciones")).toBe(true);
    expect((await ess.sql("a", "SELECT current_uses AS u FROM discount_codes WHERE code = 'AMIGOS'"))[0].u).toBe(0);
    expect(await invoices()).toHaveLength(0);

    const session = `cs_test_${sessionNo()}`;
    expect((await post(completed(session, d.merchantOrder, 72000))).json).toMatchObject({ outcome: "applied" });
    const inv = await waitFor(invoices, (x) => x.length > 0 && x.every((i) => i.status === "cobrada"));
    expect(inv).toHaveLength(1);
    expect(Number(inv[0].total)).toBe(720);
    const [paid] = await waitFor(() => rows(d.merchantOrder), (x) => x.every((y) => y.status === "paid" && y.invoiceId));
    expect(paid).toMatchObject({ status: "paid", h: "confirmada" });
    expect(Number((await edRow(ed)).reserved)).toBe(2);
    expect((await ess.sql("a", "SELECT current_uses AS u FROM discount_codes WHERE code = 'AMIGOS'"))[0].u).toBe(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM discount_code_uses WHERE reservation_id = ?", [paid.id]))[0].n).toBe(1);
    const mail = await waitFor(async () => ess.mails.find((m) => m.to.some((t) => t.email.endsWith("@comprador.example")) && m.subject.includes(d.merchantOrder)), Boolean);
    expect(mail!.subject).toContain("Bestellung bestätigt");
    expect(mail!.htmlContent).toContain("Jonas Muster");
    // Repetidos: ni factura, ni cupón, ni correo de más
    const burst = await Promise.all(Array.from({ length: 4 }, () => post(completed(session, d.merchantOrder, 72000))));
    expect(burst.every((b) => b.json.outcome === "duplicate" || b.json.outcome === "applied")).toBe(true);
    await new Promise((res) => setTimeout(res, 800));
    expect(await invoices()).toHaveLength(1);
    expect((await ess.sql("a", "SELECT current_uses AS u FROM discount_codes WHERE code = 'AMIGOS'"))[0].u).toBe(1);
    expect(ess.mails.filter((m) => m.subject.includes(d.merchantOrder) && m.to.some((t) => t.email.endsWith("@comprador.example")))).toHaveLength(1);
  });

  it("B. doble clic: seguido y en paralelo, un pedido, una retención y la misma sesión; también con las últimas plazas", async () => {
    await ess.sql("a", "DELETE FROM discount_codes WHERE code = 'AMIGOS'");
    const ed = await mkEdition({ capacity: 2 });
    const desde2 = await variantId("Desde 2 participantes");
    const email = `doble${++n}@comprador.example`;
    const go = () => checkout([line({ people: 2, variantId: desde2, editionId: ed })], {}, email);
    const a = await go();
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    await new Promise((res) => setTimeout(res, 1100));
    const b = await go(); // la edición ya está llena con este mismo pedido
    expect(b.status, JSON.stringify(b.json)).toBe(200);
    expect(data(b).merchantOrder).toBe(data(a).merchantOrder);
    expect(data(b).stripeUrl).toBe(data(a).stripeUrl);
    const ed2 = await mkEdition({ capacity: 6, label: "Otra" });
    const email2 = `doble${++n}@comprador.example`;
    const par = await Promise.all([1, 2, 3].map(() => checkout([line({ people: 2, variantId: desde2, editionId: ed2 })], {}, email2)));
    expect(new Set(par.map((x) => data(x).merchantOrder)).size).toBe(1);
    expect(Number((await edRow(ed)).reserved)).toBe(2);
    expect(Number((await edRow(ed2)).reserved)).toBe(2);
    const ed3 = await mkEdition({ capacity: 6, label: "Tercera" });
    const otra = await checkout([line({ people: 2, variantId: desde2, editionId: ed3 })], {}, email2);
    expect(data(otra).merchantOrder).not.toBe(data(par[0]).merchantOrder); // otra edición, otro pedido
  });

  it("C. dos compradores a la última plaza: solo uno; el otro no deja pedido ni plazas", async () => {
    const ed = await mkEdition({ capacity: 1 });
    const out = await Promise.all([checkout([line({ people: 1, editionId: ed })]), checkout([line({ people: 1, editionId: ed })])]);
    expect(out.filter((x) => x.status === 200)).toHaveLength(1);
    expect(Number((await edRow(ed)).reserved)).toBe(1);
    const live = await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE inventory_ref_id = ? AND hold_status = 'retenida' AND status = 'pending_payment'", [ed]);
    expect(Number(live[0].n)).toBe(1);
  });

  it("D. sesión caducada libera plazas; el pago tardío re-ocupa si hay sitio y, si no, queda en conflicto sin sobrevender", async () => {
    const ed = await mkEdition({ capacity: 2 });
    const r = await checkout([line({ people: 2, editionId: ed })]);
    const mo = data(r).merchantOrder as string;
    const session = `cs_test_${sessionNo()}`;
    expect(Number((await edRow(ed)).reserved)).toBe(2);
    const expiredEv = expired(session); // el MISMO evento (mismo id) reenviado por Stripe
    expect((await post(expiredEv)).json).toMatchObject({ outcome: "applied" });
    expect((await rows(mo))[0]).toMatchObject({ status: "cancelled", h: "liberada" });
    expect(Number((await edRow(ed)).reserved)).toBe(0);
    expect((await post(expiredEv)).json).toMatchObject({ outcome: "duplicate" });
    // Otra persona se queda las plazas antes del pago tardío
    const other = await checkout([line({ people: 2, editionId: ed })]);
    expect(other.status, JSON.stringify(other.json)).toBe(200);
    expect((await post(completed(session, mo, data(r).totalAmountCents))).json).toMatchObject({ outcome: "applied" });
    await waitFor(() => rows(mo), (x) => x.every((y) => y.status === "paid"));
    expect((await rows(mo))[0]).toMatchObject({ status: "paid", h: "conflicto" });
    expect(Number((await edRow(ed)).reserved)).toBe(2); // sin sobreventa
  });

  it("E. reembolso y disputa tras el pago: marcan y avisan, sin tocar plaza ni reserva; repetidos no duplican", async () => {
    const ed = await mkEdition({ capacity: 4 });
    const r = await checkout([line({ people: 2, editionId: ed })]);
    const mo = data(r).merchantOrder as string;
    const total = data(r).totalAmountCents as number;
    const session = `cs_test_${sessionNo()}`;
    const pi = "pi_circuito_inc";
    await post(completed(session, mo, total, { pi }));
    await waitFor(() => rows(mo), (x) => x.every((y) => y.status === "paid"));
    const refund = charge("charge.refunded", pi, { amount: total, amount_refunded: total, refunded: true });
    expect((await post(refund)).json).toMatchObject({ outcome: "refunded" });
    expect((await post(refund)).json).toMatchObject({ outcome: "duplicate" });
    expect((await post(charge("charge.dispute.created", pi, { id: "dp_1", amount: total, status: "needs_response", reason: "fraudulent" }))).json).toMatchObject({ outcome: "dispute_open" });
    expect((await post(charge("charge.dispute.closed", pi, { id: "dp_1", amount: total, status: "won", reason: "fraudulent" }))).json).toMatchObject({ outcome: "dispute_won" });
    const [row] = await rows(mo);
    expect(row).toMatchObject({ status: "paid", h: "confirmada" });
    expect(log(row).filter((e: any) => e.action === "stripe_refund_full")).toHaveLength(1);
    expect(Number((await edRow(ed)).reserved)).toBe(2);
    expect(await invoices()).toBeTruthy();
  });

  it("F. aislamiento: un evento de la cuenta de otra empresa no paga el pedido; un producto de otra empresa es NOT_FOUND", async () => {
    const ed = await mkEdition({ capacity: 4 });
    const r = await checkout([line({ people: 1, editionId: ed })]);
    const mo = data(r).merchantOrder as string;
    const session = `cs_test_${sessionNo()}`;
    const total = data(r).totalAmountCents as number;
    expect((await post(completed(session, mo, total, { account: ACCT_B, tenant: tenantB }))).json).toMatchObject({ outcome: "isolated" });
    expect((await post(completed(session, mo, total, { tenant: tenantB }))).json).toMatchObject({ outcome: "isolated" });
    expect((await post(completed(session, mo, total), "whsec_" + "x".repeat(32))).status).toBe(400);
    expect((await rows(mo))[0].status).toBe("pending_payment");
    const own = await ess.sql("a", "SELECT COUNT(*) AS n FROM experiences WHERE id = ?", [ajeno]);
    if (Number(own[0].n) === 0) expect(errCode(await checkout([{ productId: ajeno, bookingDate: "", people: 1 }]))).toBe("NOT_FOUND");
    // Una edición de otro producto o inexistente
    expect(msg(await checkout([line({ people: 1, editionId: 999999 })]))).toContain("no corresponde");
  });

  it("G. producto no vendible o con ediciones sin ninguna abierta: no entra al carrito ni al Checkout", async () => {
    const before = fake.sessions.length;
    expect(errCode(await checkout([{ productId: curso, bookingDate: "", people: 1 }]))).toBe("BAD_REQUEST");
    await ess.sql("a", "UPDATE product_editions SET status = 'closed' WHERE experience_id = ?", [retiro]);
    const r = await checkout([line({ people: 1 })]);
    expect(errCode(r)).toBe("BAD_REQUEST");
    expect(msg(r)).toContain("no tiene fechas abiertas");
    expect(fake.sessions.length).toBe(before);
  });
});
