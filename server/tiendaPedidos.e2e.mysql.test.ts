/**
 * Tienda online de una pyme, de principio a fin, con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): catálogo con agotado y opciones, pedido de dos artículos con datos fiscales, pago
 * confirmado por una notificación firmada aquí (cuenta de comercio FICTICIA; ninguna llamada a la pasarela), cliente
 * del CRM y UNA factura para el pedido, correos genéricos, estados del pedido en el panel y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");
const SECTOR = /experiencia|reserva|hu[eé]sped|personas?\b|actividad|fecha del servicio/i;

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

const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");

describe.skipIf(!URL_)("Tienda online: pedido completo, agotado, estados y aislamiento (aplicación real)", () => {
  let ess: EssentialApp;
  let admA: string;
  let agA: string;
  let agB: string;
  const ids = { camiseta: 0, sudadera: 0, taza: 0, xl: 0 };
  let order = "";
  const origin = () => `https://${ess.host("a")}`;
  const ipn = (o: string, amount: number, response = "0000") =>
    ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: o, Ds_Response: response, Ds_Amount: String(amount), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "tienda");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    // A ya ha contratado (los correos llegan a los compradores); B sigue en la prueba gratuita
    await ess.markPaid("a");
    expect((await ess.m("a", "products.createCategory", { slug: "ropa", name: "Ropa" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "tienda", name: "Tienda" }, admA)).status).toBe(200);
    const [c] = await ess.sql("a", "SELECT id FROM categories LIMIT 1");
    const [l] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    const mk = (slug: string, title: string, basePrice: string, extra: Record<string, unknown> = {}) => ess.m("a", "products.create", { slug, title, categoryId: c.id, locationId: l.id, basePrice, productType: "own", ...extra }, admA);
    expect((await mk("camiseta-logo", "Camiseta logo", "24.20")).status).toBe(200);
    expect((await mk("sudadera-capucha", "Sudadera con capucha", "39.90", { taxRate: "10" })).status).toBe(200);
    expect((await mk("taza-agotada", "Taza esmaltada", "12.00", { isActive: false })).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, slug FROM experiences")) {
      if (r.slug === "camiseta-logo") ids.camiseta = r.id;
      if (r.slug === "sudadera-capucha") ids.sudadera = r.id;
      if (r.slug === "taza-agotada") ids.taza = r.id;
    }
    for (const [i, [name, price]] of [["Talla M", "39.90"], ["Talla XL", "42.50"]].entries()) {
      expect((await ess.m("a", "products.createVariant", { experienceId: ids.sudadera, name, priceModifier: price, priceType: "fixed", isRequired: true, sortOrder: i }, admA)).status).toBe(200);
    }
    ids.xl = (await ess.sql("a", "SELECT id FROM experience_variants WHERE name = 'Talla XL'"))[0].id;
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admA)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("catálogo: el agotado sale en la tienda (marcado) pero no se vende; sin opción obligatoria tampoco", async () => {
    const shop = data(await ess.q("a", "public.getExperiences", { limit: 50, offset: 0, includeSoldOut: true })) as any[];
    expect(shop.map((p) => p.slug).sort()).toEqual(["camiseta-logo", "sudadera-capucha", "taza-agotada"]);
    expect(shop.find((p) => p.slug === "taza-agotada").isActive).toBe(false);
    // El catálogo de siempre no cambia: sin la opción, solo lo que está a la venta
    expect((data(await ess.q("a", "public.getExperiences", { limit: 50, offset: 0 })) as any[]).map((p) => p.slug)).not.toContain("taza-agotada");
    // La ficha del agotado se puede ver
    expect(data(await ess.q("a", "public.getExperienceBySlug", { slug: "taza-agotada" })).isActive).toBe(false);

    const buyer = { customerName: "Lucía Prueba", customerEmail: "lucia@comprador-a.example", origin: origin() };
    const soldOut = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: ids.camiseta, bookingDate: "", people: 1 }, { productId: ids.taza, bookingDate: "", people: 1 }] });
    expect(errCode(soldOut)).toBe("BAD_REQUEST");
    expect(msg(soldOut)).toContain("«Taza esmaltada» está agotado");
    const noOption = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: ids.sudadera, bookingDate: "", people: 1 }] });
    expect(msg(noOption)).toContain("Elige una opción");
    const badNif = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: ids.camiseta, bookingDate: "", people: 1 }], billing: { nif: "12345678A" } });
    expect(msg(badNif)).toMatch(/NIF, NIE o CIF no es válido/);
    // Nada se ha guardado con los intentos rechazados
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);
  });

  it("pedido completo: dos artículos, NIF y comentarios; pago confirmado → cliente del CRM, una factura y correo genérico", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", {
      customerName: "Lucía Prueba Pérez",
      customerEmail: "lucia@comprador-a.example",
      customerPhone: "600 111 222",
      origin: origin(),
      comments: "Dejar en conserjería",
      billing: { nif: "b-12345674", name: "Prueba Textil, S.L.", address: "Calle Mayor 1, 28001 Madrid" },
      items: [
        { productId: ids.sudadera, bookingDate: "", people: 2, variantId: ids.xl },
        { productId: ids.camiseta, bookingDate: "", people: 1 },
      ],
    });
    expect(r.status).toBe(200);
    order = data(r).merchantOrder;
    expect(data(r).totalAmountCents).toBe(2 * 4250 + 2420);
    const rows = await ess.sql("a", "SELECT product_name AS name, people, amount_total AS total, notes, status FROM reservations WHERE merchant_order = ? ORDER BY id", [order]);
    expect(rows.map((x) => [x.name, x.people, x.total])).toEqual([["Sudadera con capucha · Talla XL", 2, 8500], ["Camiseta logo", 1, 2420]]);
    expect(rows[0].notes).toContain("Comentarios del cliente: Dejar en conserjería");

    // Antes de pagar: pendiente de pago, sin factura ni cliente
    let detail = data(await ess.q("a", "reservations.onlineOrder", { merchantOrder: order }, agA));
    expect(detail).toMatchObject({ stage: "pending_payment", stageLabel: "Pendiente de pago", invoices: [], stageChanges: ["cancelled"] });

    expect((await ipn(order, 10920)).text).toBe("OK");
    const inv = await waitFor(() => ess.sql("a", "SELECT * FROM invoices"), (x) => x.length > 0 && x.every((i) => i.status === "cobrada"));
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ clientNif: "B12345674", clientName: "Prueba Textil, S.L.", clientAddress: "Calle Mayor 1, 28001 Madrid", clientEmail: "lucia@comprador-a.example" });
    expect(Number(inv[0].total)).toBe(109.2);
    const items = typeof inv[0].itemsJson === "string" ? JSON.parse(inv[0].itemsJson) : inv[0].itemsJson;
    expect(items.map((i: any) => [i.description, i.quantity, i.total, i.taxRate])).toEqual([["Sudadera con capucha · Talla XL", 2, 85, 10], ["Camiseta logo", 1, 24.2, 21]]);
    const breakdown = typeof inv[0].taxBreakdown === "string" ? JSON.parse(inv[0].taxBreakdown) : inv[0].taxBreakdown;
    expect(breakdown).toEqual([{ rate: 21, base: 20, amount: 4.2 }, { rate: 10, base: 77.27, amount: 7.73 }]);

    // Las dos líneas, con la misma factura y el mismo cliente; el cliente con su NIF
    const linked = await waitFor(() => ess.sql("a", "SELECT invoiceId, client_id AS clientId, status FROM reservations WHERE merchant_order = ?", [order]), (x) => x.every((y) => y.clientId));
    expect(new Set(linked.map((x) => x.invoiceId))).toEqual(new Set([inv[0].id]));
    const [client] = await ess.sql("a", "SELECT id, email, nif, company, address FROM clients");
    expect(client).toMatchObject({ email: "lucia@comprador-a.example", nif: "B12345674", company: "Prueba Textil, S.L." });
    expect(new Set(linked.map((x) => x.clientId))).toEqual(new Set([client.id]));

    // Correo de confirmación al comprador: genérico, con las dos líneas, el número de pedido y la factura
    const mail = await waitFor(async () => ess.mails.find((m) => m.to.some((t) => t.email === "lucia@comprador-a.example") && m.subject.startsWith("Pedido confirmado")), Boolean);
    expect(mail).toBeTruthy();
    expect(mail!.subject).toContain(order);
    expect(mail!.htmlContent).toContain("Sudadera con capucha · Talla XL");
    expect(mail!.htmlContent).toContain("109,20");
    expect(mail!.htmlContent).toContain(inv[0].invoiceNumber);
    expect(mail!.htmlContent).not.toMatch(SECTOR);

    // Página de pago correcto: todas las líneas, el número de pedido y si el correo llega
    const st = data(await ess.q("a", "reservations.getStatus", { merchantOrder: order }));
    expect(st).toMatchObject({ status: "paid", orderTotalCents: 10920, invoiceNumber: inv[0].invoiceNumber, buyerEmails: true });
    expect(st.lines).toHaveLength(2);

    // Una notificación repetida no duplica la factura ni el correo
    expect((await ipn(order, 10920)).text).toBe("OK");
    await new Promise((r) => setTimeout(r, 800));
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(1);
    expect(ess.mails.filter((m) => m.subject.startsWith("Pedido confirmado") && m.to.some((t) => t.email === "lucia@comprador-a.example"))).toHaveLength(1);

    // Ficha del cliente del CRM: el pedido y su factura
    const hist = data(await ess.q("a", "crm.clients.getHistory", { id: client.id }, agA));
    expect(hist.reservations.map((x: any) => x.merchantOrder)).toEqual([order, order]);
    expect(hist.invoices.map((x: any) => x.invoiceNumber)).toEqual([inv[0].invoiceNumber]);

    detail = data(await ess.q("a", "reservations.onlineOrder", { merchantOrder: order }, agA));
    expect(detail).toMatchObject({ stage: "paid", clientId: client.id, billing: { nif: "B12345674" }, comments: "Dejar en conserjería", totalCents: 10920 });
    expect(detail.invoices.map((x: any) => x.invoiceNumber)).toEqual([inv[0].invoiceNumber]);
    expect(detail.stageChanges).toEqual(["prepared", "delivered"]);
    // Inicio: «Pedidos online pendientes» cuenta el pedido (no sus dos líneas) mientras está pagado
    expect(data(await ess.q("a", "coreHome.indicators", undefined, agA)).pendingOnlineOrders).toEqual({ count: 1 });
  });

  it("estados en el panel: preparado → entregado con aviso al comprador; cambios no permitidos rechazados", async () => {
    const before = ess.mails.length;
    const prep = await ess.m("a", "reservations.setOnlineOrderStage", { merchantOrder: order, stage: "prepared" }, agA);
    expect(data(prep)).toEqual({ stage: "prepared", emailed: true });
    // Preparado o enviado sigue «sin finalizar» en el Inicio
    expect(data(await ess.q("a", "coreHome.indicators", undefined, agA)).pendingOnlineOrders).toEqual({ count: 1 });
    expect((await ess.sql("a", "SELECT DISTINCT status_reservation AS s FROM reservations WHERE merchant_order = ?", [order])).map((x) => x.s)).toEqual(["EN_CURSO"]);
    expect(data(await ess.m("a", "reservations.setOnlineOrderStage", { merchantOrder: order, stage: "delivered" }, agA)).stage).toBe("delivered");
    const notices = ess.mails.slice(before).filter((m) => m.to.some((t) => t.email === "lucia@comprador-a.example"));
    expect(notices.map((m) => m.subject.split(" · ")[0])).toEqual(["Tu pedido está preparado o en camino", "Tu pedido consta como entregado"]);
    for (const m of notices) expect(m.htmlContent).not.toMatch(SECTOR);
    // Un pedido pagado no se cancela desde aquí (se anula con abono)
    const bad = await ess.m("a", "reservations.setOnlineOrderStage", { merchantOrder: order, stage: "cancelled" }, agA);
    expect(errCode(bad)).toBe("BAD_REQUEST");
    expect(msg(bad)).toContain("no puede pasar a «cancelado»");
    const d = data(await ess.q("a", "reservations.onlineOrder", { merchantOrder: order }, agA));
    expect(d.stage).toBe("delivered");
    expect(d.history.map((h: any) => h.to)).toEqual(["prepared", "delivered"]);
    // Entregado: ya no está pendiente en el Inicio
    expect(data(await ess.q("a", "coreHome.indicators", undefined, agA)).pendingOnlineOrders).toEqual({ count: 0 });

    // Un pedido sin pagar sí se cancela; el listado cuenta cada estado
    const p = await ess.m("a", "reservations.cartCheckout", { customerName: "Otro Comprador", customerEmail: "otro@comprador-a.example", origin: origin(), items: [{ productId: ids.camiseta, bookingDate: "", people: 3 }] });
    const pending = data(p).merchantOrder;
    expect(data(await ess.m("a", "reservations.setOnlineOrderStage", { merchantOrder: pending, stage: "cancelled" }, agA)).stage).toBe("cancelled");
    const list = data(await ess.q("a", "reservations.onlineOrders", { stage: "all" }, agA));
    expect(list.counts).toMatchObject({ delivered: 1, cancelled: 1 });
    expect(list.items.map((x: any) => x.merchantOrder).sort()).toEqual([order, pending].sort());
    expect(data(await ess.q("a", "reservations.onlineOrders", { stage: "delivered", search: "lucia" }, agA)).items).toHaveLength(1);
  });

  it("pago rechazado: pedido «pago no completado», sin factura y aviso genérico", async () => {
    const p = await ess.m("a", "reservations.cartCheckout", { customerName: "Pago Rechazado", customerEmail: "rechazo@comprador-a.example", origin: origin(), items: [{ productId: ids.camiseta, bookingDate: "", people: 1 }] });
    const o = data(p).merchantOrder;
    expect((await ipn(o, 2420, "0190")).text).toBe("OK");
    const d = await waitFor(async () => data(await ess.q("a", "reservations.onlineOrder", { merchantOrder: o }, agA)), (x) => x?.stage === "failed");
    expect(d).toMatchObject({ stage: "failed", invoices: [], stageChanges: [] });
    const mail = await waitFor(async () => ess.mails.find((m) => m.to.some((t) => t.email === "rechazo@comprador-a.example")), Boolean);
    expect(mail!.subject).toContain("Pago no completado");
    expect(mail!.htmlContent).not.toMatch(SECTOR);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(1);
  });

  it("aislamiento: la otra empresa no ve ni cambia los pedidos; en prueba gratuita no se promete el correo; licencia", async () => {
    expect(data(await ess.q("b", "reservations.onlineOrders", { stage: "all" }, agB))).toMatchObject({ items: [], total: 0 });
    expect(errCode(await ess.q("b", "reservations.onlineOrder", { merchantOrder: order }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "reservations.setOnlineOrderStage", { merchantOrder: order, stage: "prepared" }, agB))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT DISTINCT status_reservation AS s FROM reservations WHERE merchant_order = ?", [order]))[0].s).toBe("FINALIZADA");
    // El catálogo de A no aparece en B
    expect(data(await ess.q("b", "public.getExperiences", { limit: 50, offset: 0, includeSoldOut: true }))).toEqual([]);
    expect(data(await ess.q("b", "public.getTheme")).storefront).toMatchObject({ kind: "generic", buyerEmails: false });
    expect(data(await ess.q("a", "public.getTheme")).storefront).toMatchObject({ kind: "generic", buyerEmails: true });
    // Sin sesión del equipo, nada
    expect(errCode(await ess.q("a", "reservations.onlineOrders", { stage: "all" }))).toBe("UNAUTHORIZED");

    const lic = await licenseMatrix(ess, "shop-orders", {
      query: () => ess.q("a", "reservations.onlineOrders", { stage: "all" }, agA),
      mutation: () => ess.m("a", "reservations.setOnlineOrderStage", { merchantOrder: order, stage: "prepared" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "shop-orders")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "shop-orders")).toBe(true);
  });
});
