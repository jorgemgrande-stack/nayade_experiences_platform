/**
 * Oferta «bajo petición» / «próximamente» (E-6, migración 0068) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas; ningún cobro real (cuenta de comercio ficticia).
 *  - Los productos de siempre quedan «precio fijo» y todo funciona igual.
 *  - Sin precio fijo el precio no es obligatorio (se guarda 0), no se enseñan opciones de precio y la web lo identifica.
 *  - El servidor rechaza cualquier compra (carrito, pago directo y caja) de un producto que no es de precio fijo.
 *  - La solicitud de información entra en el CRM con el producto como origen, con consentimiento, sin duplicados,
 *    con campo trampa y sin mezclar empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");
const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");

describe.skipIf(!URL_)("Oferta bajo petición y próximamente (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let admB = "";
  const ids = { fijo: 0, petición: 0, pronto: 0 };
  let cat = 0;
  let loc = 0;
  const origin = () => `https://${ess.host("a")}`;
  const mk = (co: "a" | "b", slug: string, title: string, extra: Record<string, unknown> = {}) =>
    ess.m(co, "products.create", { slug, title, categoryId: cat, locationId: loc, productType: "own", ...extra }, co === "a" ? admA : admB);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "oferta");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    await ess.markPaid("a");
    expect((await ess.m("a", "products.createCategory", { slug: "cursos", name: "Cursos" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, admA)).status).toBe(200);
    expect((await ess.m("b", "products.createCategory", { slug: "cursos", name: "Cursos" }, admB)).status).toBe(200);
    expect((await ess.m("b", "products.createLocation", { slug: "online", name: "Online" }, admB)).status).toBe(200);
    cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admA)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("un producto creado como siempre queda a precio fijo; sin precio no se puede crear uno de precio fijo", async () => {
    expect((await mk("a", "taller-fijo", "Taller de precio fijo", { basePrice: "49.00" })).status).toBe(200);
    const [row] = await ess.sql("a", "SELECT id, offer_mode AS mode, request_cta_label AS cta, basePrice FROM experiences WHERE slug = 'taller-fijo'");
    ids.fijo = row.id;
    expect([row.mode, row.cta, Number(row.basePrice)]).toEqual(["fixed", null, 49]);
    // Precio obligatorio con precio fijo (explícito o por defecto)
    expect(errCode(await mk("a", "sin-precio", "Sin precio", {}))).toBe("BAD_REQUEST");
    expect(errCode(await mk("a", "sin-precio-2", "Sin precio 2", { offerMode: "fixed", basePrice: "" }))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM experiences"))[0].n).toBe(1);
  });

  it("bajo petición y próximamente: sin precio (se guarda 0, también con precio y descuento enviados), con su botón", async () => {
    expect((await mk("a", "retiro-medida", "Retiro a medida", { offerMode: "on_request", requestCtaLabel: "  Pide  tu propuesta ", basePrice: "999", discountPercent: "10" })).status).toBe(200);
    expect((await mk("a", "curso-nuevo", "Curso nuevo", { offerMode: "coming_soon" })).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, slug FROM experiences")) {
      if (r.slug === "retiro-medida") ids.petición = r.id;
      if (r.slug === "curso-nuevo") ids.pronto = r.id;
    }
    const rows = await ess.sql("a", "SELECT slug, offer_mode AS mode, request_cta_label AS cta, basePrice, discountPercent FROM experiences WHERE id IN (?, ?) ORDER BY slug", [ids.petición, ids.pronto]);
    expect(rows.map((r) => [r.slug, r.mode, r.cta, Number(r.basePrice), r.discountPercent])).toEqual([
      ["curso-nuevo", "coming_soon", null, 0, null],
      ["retiro-medida", "on_request", "Pide tu propuesta", 0, null],
    ]);
    // La web los recibe con su modo y su botón
    const shop = data(await ess.q("a", "public.getExperiences", { limit: 50, offset: 0 })) as any[];
    expect(shop.map((p) => [p.slug, p.offerMode]).sort()).toEqual([["curso-nuevo", "coming_soon"], ["retiro-medida", "on_request"], ["taller-fijo", "fixed"]]);
    expect(data(await ess.q("a", "public.getExperienceBySlug", { slug: "retiro-medida" }))).toMatchObject({ offerMode: "on_request", requestCtaLabel: "Pide tu propuesta" });
  });

  it("sin precio fijo no se enseñan opciones de precio aunque existan", async () => {
    expect((await ess.m("a", "products.createVariant", { experienceId: ids.petición, name: "Grupo", priceModifier: "300", priceType: "fixed", isRequired: false, sortOrder: 0 }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createVariant", { experienceId: ids.fijo, name: "Premium", priceModifier: "99", priceType: "fixed", isRequired: false, sortOrder: 0 }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getVariantsByExperience", { experienceId: ids.petición }))).toEqual([]);
    expect((data(await ess.q("a", "public.getVariantsByExperience", { experienceId: ids.fijo })) as any[]).map((v) => v.name)).toEqual(["Premium"]);
  });

  it("el servidor rechaza comprar un producto que no es de precio fijo (carrito y pago directo) y no deja nada guardado", async () => {
    const buyer = { customerName: "Lucía Prueba", customerEmail: "lucia@comprador-a.example", origin: origin() };
    const cart = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: ids.fijo, bookingDate: "", people: 1 }, { productId: ids.petición, bookingDate: "", people: 1 }] });
    expect(errCode(cart)).toBe("BAD_REQUEST");
    expect(msg(cart)).toContain("«Retiro a medida» se ofrece bajo petición");
    expect(msg(cart)).not.toMatch(/agotado/i);
    const soon = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: ids.pronto, bookingDate: "", people: 1 }] });
    expect(msg(soon)).toContain("todavía no está a la venta");
    const direct = await ess.m("a", "reservations.createAndPay", { ...buyer, productId: ids.petición, bookingDate: "", people: 1 });
    expect(errCode(direct)).toBe("BAD_REQUEST");
    expect(msg(direct)).toContain("bajo petición");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);
    // Regresión: lo de precio fijo se sigue comprando como siempre
    const ok = await ess.m("a", "reservations.cartCheckout", { ...buyer, items: [{ productId: ids.fijo, bookingDate: "", people: 2 }] });
    expect(ok.status).toBe(200);
    expect(data(ok).totalAmountCents).toBe(2 * 4900);
  });

  it("la caja (TPV) no ofrece ni cobra lo que no es de precio fijo", async () => {
    await ess.sql("a", "UPDATE experiences SET isPresentialSale = 1 WHERE id IN (?, ?, ?)", [ids.fijo, ids.petición, ids.pronto]);
    const agA = await ess.login("a", "agente");
    const catalog = data(await ess.q("a", "tpv.getCatalog", undefined, agA));
    const titles = JSON.stringify(catalog);
    expect(titles).toContain("Taller de precio fijo");
    expect(titles).not.toContain("Retiro a medida");
    expect(titles).not.toContain("Curso nuevo");
  });

  it("cambiar de modo: a «bajo petición» pone el precio a 0; volver a precio fijo exige un precio", async () => {
    expect((await ess.m("a", "products.update", { id: ids.fijo, offerMode: "on_request", basePrice: "49" }, admA)).status).toBe(200);
    expect(Number((await ess.sql("a", "SELECT basePrice FROM experiences WHERE id = ?", [ids.fijo]))[0].basePrice)).toBe(0);
    // Editar otros campos de un producto sin precio fijo no le pone precio
    expect((await ess.m("a", "products.update", { id: ids.fijo, title: "Taller a medida", basePrice: "75" }, admA)).status).toBe(200);
    expect(Number((await ess.sql("a", "SELECT basePrice FROM experiences WHERE id = ?", [ids.fijo]))[0].basePrice)).toBe(0);
    // Volver a precio fijo sin precio válido: rechazado y sigue como estaba
    expect(errCode(await ess.m("a", "products.update", { id: ids.fijo, offerMode: "fixed" }, admA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "products.update", { id: ids.fijo, offerMode: "fixed", basePrice: "0" }, admA))).toBe("BAD_REQUEST");
    expect((await ess.sql("a", "SELECT offer_mode AS m FROM experiences WHERE id = ?", [ids.fijo]))[0].m).toBe("on_request");
    expect((await ess.m("a", "products.update", { id: ids.fijo, offerMode: "fixed", basePrice: "55" }, admA)).status).toBe(200);
    const [back] = await ess.sql("a", "SELECT offer_mode AS m, basePrice FROM experiences WHERE id = ?", [ids.fijo]);
    expect([back.m, Number(back.basePrice)]).toEqual(["fixed", 55]);
  });

  it("clonar conserva cómo se ofrece", async () => {
    expect((await ess.m("a", "products.clone", { id: ids.petición, newName: "Retiro a medida otoño" }, admA)).status).toBe(200);
    const [c] = await ess.sql("a", "SELECT offer_mode AS m, request_cta_label AS cta FROM experiences WHERE title = 'Retiro a medida otoño'");
    expect([c.m, c.cta]).toEqual(["on_request", "Pide tu propuesta"]);
  });

  it("solicitar información: entra en el CRM con el producto, el consentimiento y sin duplicarse", async () => {
    const reservationsBefore = (await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n;
    const base = { experienceId: ids.petición, name: "Marta Interesada", email: "Marta@Interesada.example", phone: "600 123 456", message: "Somos un grupo de 12 personas.", consent: true, page: "/tienda/retiro-medida" };
    const r = await ess.m("a", "public.requestProductInfo", base);
    expect(r.status).toBe(200);
    const leadId = data(r).leadId;
    expect(data(r)).toMatchObject({ ok: true, duplicate: false });
    const [lead] = await ess.sql("a", "SELECT id, name, email, phone, experienceId, selectedProduct, source, message FROM leads WHERE id = ?", [leadId]);
    expect(lead).toMatchObject({ name: "Marta Interesada", email: "marta@interesada.example", experienceId: ids.petición, selectedProduct: "Retiro a medida", source: "web_solicitud_producto" });
    expect(lead.message).toContain("Solicitud de información sobre «Retiro a medida» (bajo petición)");
    expect(lead.message).toContain("Somos un grupo de 12 personas.");
    expect(lead.message).toContain("Consentimiento RGPD: aceptado");
    expect(lead.message).toContain("Origen: /tienda/retiro-medida");
    // La misma persona y producto otra vez: se anota, no se crea otra oportunidad
    const again = await ess.m("a", "public.requestProductInfo", { ...base, message: "Otra pregunta" });
    expect(data(again)).toMatchObject({ duplicate: true, leadId });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE experienceId = ?", [ids.petición]))[0].n).toBe(1);
    const [notes] = await ess.sql("a", "SELECT internalNotes FROM leads WHERE id = ?", [leadId]);
    expect(JSON.stringify(notes.internalNotes)).toContain("Otra pregunta");
    // Y no hubo ninguna compra ni pedido nuevos
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(reservationsBefore);
  });

  it("validación y antirrobots: sin consentimiento, con datos inválidos, con campo trampa, sin etiquetas HTML", async () => {
    const ok = { experienceId: ids.pronto, name: "Pablo Prueba", email: "pablo@prueba.example", consent: true };
    expect(msg(await ess.m("a", "public.requestProductInfo", { ...ok, consent: false }))).toContain("privacidad");
    expect(msg(await ess.m("a", "public.requestProductInfo", { ...ok, email: "no-es-correo" }))).toContain("correo");
    expect(msg(await ess.m("a", "public.requestProductInfo", { ...ok, name: "x" }))).toContain("nombre");
    expect(msg(await ess.m("a", "public.requestProductInfo", { ...ok, phone: "abc" }))).toContain("teléfono");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE experienceId = ?", [ids.pronto]))[0].n).toBe(0);
    // Campo trampa o relleno instantáneo: respuesta de éxito sin guardar nada
    const trap = await ess.m("a", "public.requestProductInfo", { ...ok, website: "http://spam.example" });
    expect(trap.status).toBe(200);
    expect((await ess.m("a", "public.requestProductInfo", { ...ok, elapsedMs: 200 })).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE experienceId = ?", [ids.pronto]))[0].n).toBe(0);
    // HTML en los textos: se guarda como texto
    const html = await ess.m("a", "public.requestProductInfo", { ...ok, name: "Pablo <script>alert(1)</script> Prueba", message: "<b>Hola</b> <img src=x onerror=alert(1)>" });
    expect(html.status).toBe(200);
    const [l] = await ess.sql("a", "SELECT name, message FROM leads WHERE experienceId = ?", [ids.pronto]);
    expect(l.name).not.toMatch(/[<>]/);
    expect(l.message).not.toMatch(/<\s*(script|img|b)\b/i);
    // Una web ajena no puede enviar la solicitud (misma web de origen)
    const cross = await ess.call("a", "POST", "/api/trpc/public.requestProductInfo", { body: { json: { ...ok, email: "otra@prueba.example" } }, headers: { origin: "https://sitio-ajeno.example" } });
    expect(cross.status).toBe(403);
  });

  it("aislamiento: la solicitud solo existe en la empresa del producto y la otra no ve nada", async () => {
    // La empresa B no tiene ese producto: la solicitud se rechaza y no crea nada
    const r = await ess.m("b", "public.requestProductInfo", { experienceId: ids.petición, name: "Marta Interesada", email: "marta2@interesada.example", consent: true });
    expect(errCode(r)).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM leads"))[0].n).toBe(0);
    expect(data(await ess.q("b", "public.getExperiences", { limit: 50, offset: 0 }))).toEqual([]);
    // El mismo id en B, un producto de precio fijo propio, sigue vendiéndose sin verse afectado por A
    expect((await mk("b", "producto-b", "Producto B", { basePrice: "10.00" })).status).toBe(200);
    expect((await ess.sql("b", "SELECT offer_mode AS m FROM experiences"))[0].m).toBe("fixed");
  });
});
