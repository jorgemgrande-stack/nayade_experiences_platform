/**
 * Oferta permanente de compra directa (migración 0098) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Empresa sintética nueva; ningún cobro real (cuenta de comercio ficticia).
 *  - Variante activa/inactiva: la web y los pedidos solo ven las activas y vigentes; el panel las ve todas.
 *  - El carrito y el pago directo rechazan una variante retirada o caducada con «ya no está disponible».
 *  - Fecha de servicio por producto: «sin fecha» limpia la fecha del pedido; «obligatoria» rechaza una vacía.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");
const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");

describe.skipIf(!URL_)("Oferta permanente: variantes activas y fecha de servicio (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  let cat = 0;
  let loc = 0;
  const ids = { permanente: 0, conFecha: 0 };
  const vid = { activa: 0, retirada: 0, caducada: 0 };
  const buyer = () => ({ customerName: "Lucía Prueba", customerEmail: "lucia@comprador-a.example", origin: `https://${ess.host("a")}` });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "permanente");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    expect((await ess.m("a", "products.createCategory", { slug: "programas", name: "Programas" }, adm)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm)).status).toBe(200);
    cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, adm)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("la migración 0098 deja las columnas con sus valores por defecto y el producto guarda su modo de fecha", async () => {
    expect((await ess.m("a", "products.create", { slug: "reconnect", title: "RECONNECT", categoryId: cat, locationId: loc, productType: "actividad", basePrice: "555.00", serviceDateMode: "none" }, adm)).status).toBe(200);
    expect((await ess.m("a", "products.create", { slug: "taller", title: "Taller con fecha", categoryId: cat, locationId: loc, productType: "own", basePrice: "49.00" }, adm)).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, slug, service_date_mode AS mode FROM experiences ORDER BY id")) {
      if (r.slug === "reconnect") { ids.permanente = r.id; expect(r.mode).toBe("none"); }
      if (r.slug === "taller") { ids.conFecha = r.id; expect(r.mode).toBe("auto"); }
    }
    expect((await ess.m("a", "products.update", { id: ids.conFecha, serviceDateMode: "required" }, adm)).status).toBe(200);
    expect((await ess.sql("a", "SELECT service_date_mode AS mode FROM experiences WHERE id = ?", [ids.conFecha]))[0].mode).toBe("required");
    // La web recibe el dato
    expect(data(await ess.q("a", "public.getExperienceBySlug", { slug: "reconnect" }))).toMatchObject({ serviceDateMode: "none" });
  });

  it("variantes: una activa, una retirada y una caducada; la web solo ve la activa, el panel las tres", async () => {
    const mk = (name: string, price: string, extra: Record<string, unknown> = {}) =>
      ess.m("a", "products.createVariant", { experienceId: ids.permanente, name, priceModifier: price, priceType: "fixed", isRequired: true, sortOrder: 0, ...extra }, adm);
    expect((await mk("LIVE", "111")).status).toBe(200);
    expect((await mk("Einführungspreis", "333", { isActive: false })).status).toBe(200);
    expect((await mk("Promo caducada", "99", { validUntil: "2020-01-01" })).status).toBe(200);
    for (const r of await ess.sql("a", "SELECT id, name, is_active AS a FROM experience_variants ORDER BY id")) {
      if (r.name === "LIVE") { vid.activa = r.id; expect(Number(r.a)).toBe(1); }
      if (r.name === "Einführungspreis") { vid.retirada = r.id; expect(Number(r.a)).toBe(0); }
      if (r.name === "Promo caducada") { vid.caducada = r.id; expect(Number(r.a)).toBe(1); }
    }
    expect((data(await ess.q("a", "public.getVariantsByExperience", { experienceId: ids.permanente })) as any[]).map((v) => v.name)).toEqual(["LIVE"]);
    const panel = data(await ess.q("a", "products.getVariants", { experienceId: ids.permanente }, adm)) as any[];
    expect(panel.map((v) => [v.name, v.isActive]).sort()).toEqual([["Einführungspreis", false], ["LIVE", true], ["Promo caducada", true]]);
    // El precio «desde» del catálogo ignora la retirada (333) y la caducada (99): el menor entre la base (555) y la activa (111)
    const shop = data(await ess.q("a", "public.getExperiences", { limit: 50, offset: 0, withFromPrice: true })) as any[];
    expect(shop.find((p) => p.id === ids.permanente)).toMatchObject({ fromPrice: 111, hasOptions: true });
  });

  it("el carrito y el pago directo rechazan la variante retirada o caducada; la activa se compra sin fecha (se limpia)", async () => {
    const retirada = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.permanente, bookingDate: "", people: 1, variantId: vid.retirada }] });
    expect(errCode(retirada)).toBe("BAD_REQUEST");
    expect(msg(retirada)).toContain("ya no está disponible");
    const caducada = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.permanente, bookingDate: "", people: 1, variantId: vid.caducada }] });
    expect(errCode(caducada)).toBe("BAD_REQUEST");
    expect(msg(caducada)).toContain("ya no está disponible");
    const directa = await ess.m("a", "reservations.createAndPay", { ...buyer(), productId: ids.permanente, bookingDate: "", people: 1, variantId: vid.retirada });
    expect(errCode(directa)).toBe("BAD_REQUEST");
    expect(msg(directa)).toContain("ya no está disponible");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);
    // Oferta permanente: aunque el carrito traiga una fecha, el pedido se guarda sin ella
    const ok = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.permanente, bookingDate: "2027-03-01", people: 1, variantId: vid.activa }] });
    expect(ok.status).toBe(200);
    expect(data(ok).totalAmountCents).toBe(11100);
    const rows = await ess.sql("a", "SELECT booking_date AS d, amount_total AS a FROM reservations");
    expect(rows.map((r) => [r.d, Number(r.a)])).toEqual([["", 11100]]);
  });

  it("reactivar la variante retirada la devuelve a la web y al pedido", async () => {
    expect((await ess.m("a", "products.updateVariant", { id: vid.retirada, isActive: true }, adm)).status).toBe(200);
    expect((data(await ess.q("a", "public.getVariantsByExperience", { experienceId: ids.permanente })) as any[]).map((v) => v.name).sort()).toEqual(["Einführungspreis", "LIVE"]);
    const ok = await ess.m("a", "reservations.createAndPay", { ...buyer(), productId: ids.permanente, bookingDate: "2027-03-01", people: 1, variantId: vid.retirada });
    expect(ok.status).toBe(200);
    expect((await ess.sql("a", "SELECT booking_date AS d FROM reservations WHERE amount_total = 33300"))[0].d).toBe("");
  });

  it("fecha obligatoria: el carrito y el pago directo rechazan una fecha vacía y aceptan una válida", async () => {
    const sin = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.conFecha, bookingDate: "", people: 1 }] });
    expect(errCode(sin)).toBe("BAD_REQUEST");
    expect(msg(sin)).toContain("Indica la fecha del servicio");
    const sinDirecta = await ess.m("a", "reservations.createAndPay", { ...buyer(), productId: ids.conFecha, bookingDate: "", people: 1 });
    expect(errCode(sinDirecta)).toBe("BAD_REQUEST");
    expect(msg(sinDirecta)).toContain("Indica la fecha del servicio");
    const con = await ess.m("a", "reservations.cartCheckout", { ...buyer(), items: [{ productId: ids.conFecha, bookingDate: "2027-03-01", people: 2 }] });
    expect(con.status).toBe(200);
    expect((await ess.sql("a", "SELECT booking_date AS d FROM reservations WHERE product_id = ?", [ids.conFecha]))[0].d).toBe("2027-03-01");
  });
});
