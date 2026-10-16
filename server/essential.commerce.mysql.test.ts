/**
 * Essential — Comercio (shop-catalog, shop-variants, shop-store, shop-checkout, shop-orders,
 * shop-coupons) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Empresas nuevas desde la baseline. Pasarela: cuenta de comercio FICTICIA guardada como credencial
 * de la empresa; la notificación de pago se firma aquí (ninguna llamada a la pasarela real).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");

/** Firma de referencia de la notificación (3DES del pedido + HMAC-SHA256), independiente del código. */
function signedNotification(data: Record<string, string>) {
  const params = Buffer.from(JSON.stringify(data)).toString("base64");
  const order = data.Ds_Order;
  const key = Buffer.from(KEY, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(order) / 8) * 8, 0);
  Buffer.from(order).copy(padded);
  const c = crypto.createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  c.setAutoPadding(false);
  const derived = Buffer.concat([c.update(padded), c.final()]);
  const sig = crypto.createHmac("sha256", derived).update(params).digest("base64");
  return new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: params, Ds_Signature: sig }).toString();
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

describe.skipIf(!URL_)("Essential — Comercio (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let agB: string;
  let productId = 0;
  let variantId = 0;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "shop");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("shop-catalog: categoría, ubicación y producto en una empresa vacía; escaparate público; aislamiento; licencia", async () => {
    const cat = await ess.m("a", "products.createCategory", { slug: "servicios", name: "Servicios" }, admA);
    expect(cat.status).toBe(200);
    const loc = await ess.m("a", "products.createLocation", { slug: "sede", name: "Sede central" }, admA);
    expect(loc.status).toBe(200);
    const [c] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'servicios'");
    const [l] = await ess.sql("a", "SELECT id FROM locations WHERE slug = 'sede'");
    const p = await ess.m("a", "products.create", { slug: "servicio-basico", title: "Servicio básico", categoryId: c.id, locationId: l.id, basePrice: "40.00" }, admA);
    expect(p.status).toBe(200);
    const [row] = await ess.sql("a", "SELECT id, title, basePrice, isActive FROM experiences WHERE slug = 'servicio-basico'");
    productId = row.id;
    expect(Number(row.basePrice)).toBe(40);
    // Solo administración edita el catálogo
    expect(errCode(await ess.m("a", "products.create", { slug: "x", title: "x", categoryId: c.id, locationId: l.id, basePrice: "1" }, agA))).toBe("FORBIDDEN");

    // Escaparate: A lo publica, B (vacía) no ve nada
    const pubA = data(await ess.q("a", "public.getExperiences", {}));
    expect(JSON.stringify(pubA)).toContain("servicio-basico");
    expect(JSON.stringify(data(await ess.q("b", "public.getExperiences", {})))).not.toContain("servicio-basico");
    expect(data(await ess.q("b", "products.getAll", undefined, admB))).toEqual([]);

    const lic = await licenseMatrix(ess, "shop-catalog", {
      query: () => ess.q("a", "products.getAll", undefined, admA),
      mutation: () => ess.m("a", "products.createCategory", { slug: "bloqueada", name: "Bloqueada" }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "shop-catalog")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "shop-catalog")).toBe(true);
  });

  it("shop-variants: variante con precio y su efecto en el precio calculado en servidor", async () => {
    const v = await ess.m("a", "products.createVariant", { experienceId: productId, name: "Premium", priceModifier: "55.00", priceType: "fixed" }, admA);
    expect(v.status).toBe(200);
    const pubV = data(await ess.q("a", "public.getVariantsByExperience", { experienceId: productId }));
    expect(pubV.map((x: any) => x.name)).toEqual(["Premium"]);
    variantId = pubV[0].id;
    expect(data(await ess.q("b", "public.getVariantsByExperience", { experienceId: productId }))).toEqual([]);
  });

  it("shop-checkout: sin pasarela configurada se rechaza SIN dejar pre-reservas; con la cuenta de la empresa, formulario firmado, cobro y factura", async () => {
    const input = { productId, bookingDate: "2030-06-01", people: 2, variantId, customerName: "Cliente Web", customerEmail: "web@cliente-a.example", origin: `https://${ess.host("a")}` };
    const pre = await ess.m("a", "reservations.createAndPay", input);
    expect(errCode(pre)).toBe("PRECONDITION_FAILED");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);

    const save = await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admA);
    expect(save.status).toBe(200);
    const r = await ess.m("a", "reservations.createAndPay", input);
    expect(r.status).toBe(200);
    const out = data(r);
    // Precio en servidor: variante fija 55 € × 2 personas (el cliente no envía importes)
    expect(out.amountCents).toBe(11000);
    expect(out.redsysForm.url).toContain("sis-t.redsys.es");
    const [res] = await ess.sql("a", "SELECT id, status, amount_total AS amountTotal FROM reservations WHERE merchant_order = ?", [out.merchantOrder]);
    expect(res).toMatchObject({ status: "pending_payment", amountTotal: 11000 });
    // La empresa B no tiene pasarela: la credencial de A no se usa en B
    expect(errCode(await ess.m("b", "reservations.createAndPay", input))).toBe("PRECONDITION_FAILED");

    // Notificación firmada con la clave de A: la reserva pasa a pagada
    const ipn = await ess.call("a", "POST", "/api/redsys/notification", {
      raw: signedNotification({ Ds_Order: out.merchantOrder, Ds_Response: "0000", Ds_Amount: "11000", Ds_AuthorisationCode: "123456" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(ipn.text).toBe("OK");
    const paid = await waitFor(() => ess.sql("a", "SELECT status, status_payment AS statusPayment FROM reservations WHERE id = ?", [res.id]), (rows) => rows[0]?.status === "paid");
    expect(paid[0]).toMatchObject({ status: "paid" });
    // Factura automática del cobro online, con la numeración propia de la empresa
    const inv = await waitFor(() => ess.sql("a", "SELECT invoiceNumber, total, status FROM invoices WHERE reservationId = ?", [res.id]), (rows) => rows.length > 0);
    expect(inv[0].invoiceNumber).toMatch(/^FAC-\d{4}-0001$/);
    expect(Number(inv[0].total)).toBe(110);
    // La misma notificación enviada al host de B (otra clave): rechazada
    const cross = await ess.call("b", "POST", "/api/redsys/notification", {
      raw: signedNotification({ Ds_Order: out.merchantOrder, Ds_Response: "0000", Ds_Amount: "11000" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(cross.status).toBe(400);

    const lic = await licenseMatrix(ess, "shop-checkout", { mutation: () => ess.m("a", "reservations.createAndPay", input) });
    expect(isLicenseDenied(lic.readOnlyMutation, "shop-checkout")).toBe(true);
    expect(isLicenseDenied(lic.noneMutation, "shop-checkout")).toBe(true);
  });

  let manualId = 0;
  it("shop-orders: pedido manual, estados, anulación con devolución; aislamiento; licencia", async () => {
    const r = await ess.m("a", "crm.reservations.createManual", { customerName: "Cliente Mostrador", customerEmail: "mostrador@cliente-a.example", productId, productName: "Servicio básico", bookingDate: "2030-07-01", people: 1, amountTotal: 40, amountPaid: 0, sendConfirmationEmail: false }, agA);
    expect(r.status).toBe(200);
    const [row] = await ess.sql("a", "SELECT id FROM reservations WHERE customer_email = 'mostrador@cliente-a.example'");
    manualId = row.id;
    expect((await ess.m("a", "crm.reservations.updateStatuses", { id: manualId, statusReservation: "CONFIRMADA", statusPayment: "PAGADO" }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT status_reservation AS statusReservation, status_payment AS statusPayment FROM reservations WHERE id = ?", [manualId]))[0]).toEqual({ statusReservation: "CONFIRMADA", statusPayment: "PAGADO" });
    const list = data(await ess.q("a", "crm.reservations.list", {}, agA));
    expect(list.total).toBeGreaterThanOrEqual(2);

    // Anulación (devolución) desde el módulo de anulaciones: requiere el flag sembrado al aprovisionar
    const cancel = await ess.m("a", "cancellations.cancelReservationDirect", { reservationId: manualId, reason: "desistimiento", compensationType: "devolucion", refundAmount: 40 }, admA);
    expect(cancel.status).toBe(200);
    expect((await ess.sql("a", "SELECT status FROM reservations WHERE id = ?", [manualId]))[0].status).toBe("cancelled");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM cancellation_requests"))[0].n).toBe(1);

    expect(data(await ess.q("b", "crm.reservations.list", {}, agB)).total).toBe(0);
    expect(errCode(await ess.q("b", "crm.reservations.get", { id: manualId }, agB))).toBe("NOT_FOUND");

    const lic = await licenseMatrix(ess, "shop-orders", {
      query: () => ess.q("a", "crm.reservations.list", {}, agA),
      mutation: () => ess.m("a", "crm.reservations.updateStatuses", { id: manualId, statusPayment: "PENDIENTE" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "shop-orders")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "shop-orders")).toBe(true);
  });

  it("shop-coupons: alta (administración), consulta (comercial), validación pública y aislamiento; licencia", async () => {
    const c = await ess.m("a", "discounts.create", { code: "bienvenida10", name: "Bienvenida", discountPercent: 10 }, admA);
    expect(c.status).toBe(200);
    expect((await ess.sql("a", "SELECT code, discount_percent FROM discount_codes"))[0]).toMatchObject({ code: "BIENVENIDA10" });
    expect(errCode(await ess.m("a", "discounts.create", { code: "AGENTE", name: "No", discountPercent: 5 }, agA))).toBe("FORBIDDEN");
    expect(data(await ess.q("a", "discounts.list", {}, agA)).items ?? data(await ess.q("a", "discounts.list", {}, agA))).toBeTruthy();
    const v = await ess.m("a", "discounts.validate", { code: "BIENVENIDA10", amount: 100 });
    expect(data(v)).toMatchObject({ valid: true });
    const vb = await ess.m("b", "discounts.validate", { code: "BIENVENIDA10", amount: 100 });
    expect(data(vb)?.valid === true).toBe(false);

    const lic = await licenseMatrix(ess, "shop-coupons", {
      query: () => ess.q("a", "discounts.list", {}, admA),
      mutation: () => ess.m("a", "discounts.create", { code: "BLOQUEADO", name: "x", discountPercent: 5 }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "shop-coupons")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "shop-coupons")).toBe(true);
  });

  it("shop-store: el carrito vive en el navegador; el servidor solo expone el pago del carrito (precio recalculado)", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", {
      items: [{ productId, bookingDate: "2030-08-01", people: 3 }],
      customerName: "Cliente Carrito",
      customerEmail: "carrito@cliente-a.example",
      origin: `https://${ess.host("a")}`,
    });
    expect(r.status).toBe(200);
    expect(data(r).amountCents ?? data(r).totalAmountCents ?? data(r).amount).toBeDefined();
    const rows = await ess.sql("a", "SELECT amount_total AS amountTotal FROM reservations WHERE customer_email = 'carrito@cliente-a.example'");
    expect(rows.map((x) => x.amountTotal)).toEqual([12000]);
  });
});
