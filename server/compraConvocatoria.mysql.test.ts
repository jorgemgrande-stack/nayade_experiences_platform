/**
 * Compra de tienda ligada a una convocatoria, con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Cuenta de comercio Redsys FICTICIA; ninguna llamada a la pasarela. Cobros reales: no se activa nada.
 *  - Producto con ediciones: exige elegir fecha; ajena, cerrada o llena se rechazan; priceOverride manda en el cobro.
 *  - La reserva guarda la fecha de la edición (no la de hoy) y retiene las plazas.
 *  - Dos compradores a la última plaza (concurrencia real): solo uno; el otro no deja pedido a medias.
 *  - Pago firmado confirma la retención (idempotente); un producto sin ediciones se vende como siempre.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");
const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");

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

describe.skipIf(!URL_)("Compra ligada a convocatoria (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let retiro = 0;
  let suelto = 0;
  let n = 0;
  const origin = () => `https://${ess.host("a")}`;
  const buyer = () => ({ customerName: "Persona Prueba", customerEmail: `persona${++n}@ejemplo.example`, origin: origin() });
  const checkout = (items: Array<Record<string, unknown>>) => ess.m("a", "reservations.cartCheckout", { ...buyer(), items });
  const mkEdition = async (over: Record<string, unknown> = {}) => {
    const r = await ess.m("a", "products.editions.create", { experienceId: retiro, form: { label: "Edición", startsLocal: "2037-03-10T10:00", endsLocal: "2037-03-12T14:00", timezone: "Europe/Madrid", scheduleNote: "", mode: "presencial", locationNote: "Casa de retiros", capacity: 2, showAvailability: false, status: "open", priceOverride: null, ...over } }, admA);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return data(r).id as number;
  };
  const edRow = async (id: number) => (await ess.sql("a", "SELECT * FROM product_editions WHERE id = ?", [id]))[0];
  const ipn = (o: string, amount: number) =>
    ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: o, Ds_Response: "0000", Ds_Amount: String(amount), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "compraconv");
    admA = await ess.login("a", "admin");
    await ess.markPaid("a");
    expect((await ess.m("a", "products.createCategory", { slug: "retiros", name: "Retiros" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "casa", name: "Casa" }, admA)).status).toBe(200);
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    const mk = (slug: string, title: string, basePrice: string) => ess.m("a", "products.create", { slug, title, categoryId: c.id, locationId: l.id, basePrice, productType: "own" }, admA);
    expect((await mk("retiro", "Retiro", "500.00")).status).toBe(200);
    expect((await mk("camiseta", "Camiseta", "20.00")).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, slug FROM experiences")) {
      if (r.slug === "retiro") retiro = r.id;
      if (r.slug === "camiseta") suelto = r.id;
    }
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admA)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("producto con fecha y sin ediciones abiertas: la compra directa se bloquea; sin ediciones (camiseta) se vende como siempre", async () => {
    const loose = await checkout([{ productId: suelto, bookingDate: "", people: 1 }]);
    expect(loose.status).toBe(200);
    const closed = await mkEdition({ status: "closed" });
    const r = await checkout([{ productId: retiro, bookingDate: "", people: 1, editionId: closed }]);
    expect(errCode(r)).toBe("BAD_REQUEST");
    expect(msg(r)).toContain("no tiene fechas abiertas");
  });

  it("exige fecha; usa el precio de la edición y guarda su fecha y plazas en la reserva", async () => {
    const e = await mkEdition({ capacity: 3, priceOverride: 450 });
    expect(msg(await checkout([{ productId: retiro, bookingDate: "", people: 1 }]))).toContain("Elige la fecha");
    expect(msg(await checkout([{ productId: suelto, bookingDate: "", people: 1, editionId: e }]))).toContain("no corresponde");
    const r = await checkout([{ productId: retiro, bookingDate: "", people: 2, editionId: e }]);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(data(r).totalAmountCents).toBe(2 * 45000);
    const [row] = await ess.sql("a", "SELECT booking_date AS d, notes, inventory_kind AS k, inventory_ref_id AS ref, inventory_units AS u, hold_status AS h FROM reservations WHERE merchant_order = ?", [data(r).merchantOrder]);
    expect(row).toMatchObject({ d: "2037-03-10", k: "edition_seat", ref: e, u: 2, h: "retenida" });
    expect(row.notes).toContain("Casa de retiros");
    expect(Number((await edRow(e)).reserved)).toBe(2);
  });

  it("dos compradores a la última plaza: solo uno; el otro no deja reserva ni plazas retenidas", async () => {
    const e = await mkEdition({ capacity: 1 });
    const out = await Promise.all([checkout([{ productId: retiro, bookingDate: "", people: 1, editionId: e }]), checkout([{ productId: retiro, bookingDate: "", people: 1, editionId: e }])]);
    expect(out.filter((x) => x.status === 200)).toHaveLength(1);
    expect(Number((await edRow(e)).reserved)).toBe(1);
    const live = await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE inventory_ref_id = ? AND hold_status = 'retenida' AND status = 'pending_payment'", [e]);
    expect(Number(live[0].n)).toBe(1);
  });

  it("el pago firmado confirma la retención una sola vez y no mueve el contador", async () => {
    const e = await mkEdition({ capacity: 2 });
    const r = await checkout([{ productId: retiro, bookingDate: "", people: 1, editionId: e }]);
    const order = data(r).merchantOrder as string;
    expect((await ipn(order, data(r).totalAmountCents)).text).toBe("OK");
    expect((await ipn(order, data(r).totalAmountCents)).text).toBe("OK");
    const [row] = await ess.sql("a", "SELECT status, hold_status AS h FROM reservations WHERE merchant_order = ?", [order]);
    expect(row).toMatchObject({ status: "paid", h: "confirmada" });
    expect(Number((await edRow(e)).reserved)).toBe(1);
  });
});
