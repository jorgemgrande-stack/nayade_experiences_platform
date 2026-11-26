/**
 * Suplementos opcionales (migración 0090) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas; ningún cobro real (cuenta Redsys de prueba ficticia, el carrito solo calcula el importe).
 *  - Un suplemento (variante con supplementGroup) NO es una opción del programa: no sale en las opciones, ni en el «desde»,
 *    ni se puede elegir como modalidad.
 *  - Sin marcarlo, el total del programa no cambia. Marcado, suma por participantes y con el tramo que decide el servidor.
 *  - La solicitud lo anota en el lead (sin cobro). Un id de otro producto / otra empresa se rechaza.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { resetProductRequestLimits } from "./productRequests";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const KEY = crypto.randomBytes(24).toString("base64");
const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");
const toLead = (p: Record<string, any>) => {
  const { name, email, phone, message, ...rest } = p;
  return { name, email, phone, message, productRequest: rest };
};

describe.skipIf(!URL_)("Suplementos opcionales (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let admB = "";
  let cat = 0;
  let loc = 0;
  const ids = { retiro: 0, taller: 0, retiroB: 0, indiv: 0, grupo: 0, comida: 0, progIndiv: 0, progGrupo: 0 };
  const origin = () => `https://${ess.host("a")}`;
  const mk = (co: "a" | "b", slug: string, title: string, extra: Record<string, unknown>) =>
    ess.m(co, "products.create", { slug, title, categoryId: cat, locationId: loc, productType: "own", ...extra }, co === "a" ? admA : admB);
  const variant = async (co: "a" | "b", experienceId: number, name: string, over: Record<string, unknown>) => {
    const r = await ess.m(co, "products.createVariant", { experienceId, name, priceModifier: "0", priceType: "fixed", ...over }, co === "a" ? admA : admB);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return Number((await ess.sql(co, "SELECT id FROM experience_variants WHERE experienceId = ? AND name = ?", [experienceId, name]))[0].id);
  };
  const request = (co: "a" | "b", p: Record<string, any>) => ess.m(co, "public.submitLead", toLead({ consent: true, name: "Marta Interesada", ...p }));
  const cart = (items: any[]) => ess.m("a", "reservations.cartCheckout", { customerName: "Lucía Prueba", customerEmail: "lucia@comprador-a.example", origin: origin(), items });

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "suplementos");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    await ess.markPaid("a");
    for (const [co, adm] of [["a", admA], ["b", admB]] as const) {
      expect((await ess.m(co, "products.createCategory", { slug: "retiros", name: "Retiros" }, adm)).status).toBe(200);
      expect((await ess.m(co, "products.createLocation", { slug: "sierra", name: "Sierra" }, adm)).status).toBe(200);
    }
    cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    expect((await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admA)).status).toBe(200);

    // Retiro «solo por solicitud» con precio visible y dos opciones de programa
    expect((await mk("a", "retiro-sup", "Retiro del Alma", { offerMode: "priced_request", basePrice: "1290", minPersons: 1, maxPersons: 5 })).status).toBe(200);
    ids.retiro = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'retiro-sup'"))[0].id;
    ids.progIndiv = await variant("a", ids.retiro, "Individual", { priceModifier: "1290", priceType: "fixed", minQty: 1, maxQty: 1 });
    ids.progGrupo = await variant("a", ids.retiro, "Desde 2", { priceModifier: "1190", priceType: "fixed", minQty: 2, maxQty: 5 });
    // Suplemento «alimentación»: dos tramos del MISMO grupo
    ids.indiv = await variant("a", ids.retiro, "Alimentación ayurvédica", { priceModifier: "120", priceType: "per_person", minQty: 1, maxQty: 1, supplementGroup: "alimentacion" });
    ids.grupo = await variant("a", ids.retiro, "Alimentación ayurvédica (desde 2)", { priceModifier: "90", priceType: "per_person", minQty: 2, maxQty: 5, supplementGroup: "alimentacion" });

    // Taller de precio fijo (se compra) con su propio suplemento
    expect((await mk("a", "taller-sup", "Taller con comida", { offerMode: "fixed", basePrice: "49" })).status).toBe(200);
    ids.taller = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'taller-sup'"))[0].id;
    ids.comida = await variant("a", ids.taller, "Comida", { priceModifier: "10", priceType: "per_person", supplementGroup: "comida" });

    // Otra empresa, mismo tipo de producto pero SIN suplementos
    expect((await mk("b", "retiro-sup", "Retiro del Alma", { offerMode: "priced_request", basePrice: "1290" })).status).toBe(200);
    ids.retiroB = (await ess.sql("b", "SELECT id FROM experiences WHERE slug = 'retiro-sup'"))[0].id;
    await variant("b", ids.retiroB, "Individual", { priceModifier: "1290", priceType: "fixed" });
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("la migración deja las opciones de siempre como opciones (supplementGroup NULL) y el suplemento queda aparte", async () => {
    const rows = await ess.sql("a", "SELECT name, supplementGroup FROM experience_variants WHERE experienceId = ? ORDER BY id", [ids.retiro]);
    expect(rows.map((r: any) => [r.name, r.supplementGroup])).toEqual([["Individual", null], ["Desde 2", null], ["Alimentación ayurvédica", "alimentacion"], ["Alimentación ayurvédica (desde 2)", "alimentacion"]]);
    // La web: opciones del programa SIN el suplemento; el suplemento por separado, agrupado en tramos y nunca marcado
    expect((data(await ess.q("a", "public.getVariantsByExperience", { experienceId: ids.retiro })) as any[]).map((v) => v.name)).toEqual(["Individual", "Desde 2"]);
    const offers = data(await ess.q("a", "public.getSupplementsByExperience", { experienceId: ids.retiro })) as any[];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ group: "alimentacion", name: "Alimentación ayurvédica" });
    expect(offers[0].tiers.map((t: any) => [t.priceModifier, t.minQty, t.maxQty])).toEqual([["120.00", 1, 1], ["90.00", 2, 5]]);
    // El administrador sí ve todas las filas (incluido el grupo)
    expect((data(await ess.q("a", "products.getVariants", { experienceId: ids.retiro }, admA)) as any[]).length).toBe(4);
    // Un suplemento no puede ser un porcentaje
    expect(errCode(await ess.m("a", "products.createVariant", { experienceId: ids.retiro, name: "Mal", priceModifier: "10", priceType: "percentage", supplementGroup: "x" }, admA))).toBe("BAD_REQUEST");
  });

  it("solicitud SIN marcar: el lead no lleva suplemento; MARCADO: lo anota con importe por participantes y sin cobro", async () => {
    resetProductRequestLimits();
    const sin = await request("a", { experienceId: ids.retiro, email: "sin@suplemento.example", variantId: ids.progGrupo, seats: 2 });
    expect(sin.status, JSON.stringify(sin.json)).toBe(200);
    const [l1] = await ess.sql("a", "SELECT message, variant_id AS variantId FROM leads WHERE id = ?", [data(sin).leadId]);
    expect(l1.message).not.toContain("Suplementos opcionales");
    expect(l1.variantId).toBe(ids.progGrupo);

    // Dos participantes y el id del tramo INDIVIDUAL: el servidor aplica el tramo «desde 2» (90 €) → 180 €
    const con = await request("a", { experienceId: ids.retiro, email: "con@suplemento.example", variantId: ids.progGrupo, seats: 2, supplementIds: [ids.indiv] });
    expect(con.status, JSON.stringify(con.json)).toBe(200);
    const [l2] = await ess.sql("a", "SELECT message, variant_id AS variantId, numberOfPersons FROM leads WHERE id = ?", [data(con).leadId]);
    expect(l2.message).toContain("Suplementos opcionales elegidos (NO incluidos en el precio del programa; sin cobro");
    expect(l2.message).toContain("Alimentación ayurvédica (desde 2): 90,00 € por persona × 2 = 180,00 €");
    expect(l2.message).toContain("Modalidad elegida: Desde 2");
    expect(l2.variantId).toBe(ids.progGrupo); // la modalidad del lead sigue siendo la del programa
    expect(l2.numberOfPersons).toBe(2);

    // Participante único: tarifa individual (120 €) aunque envíe el id del tramo de grupo
    const solo = await request("a", { experienceId: ids.retiro, email: "solo@suplemento.example", variantId: ids.progIndiv, seats: 1, supplementIds: [ids.grupo] });
    expect(solo.status, JSON.stringify(solo.json)).toBe(200);
    const [l3] = await ess.sql("a", "SELECT message FROM leads WHERE id = ?", [data(solo).leadId]);
    expect(l3.message).toContain("Alimentación ayurvédica: 120,00 € por persona × 1 = 120,00 €");
    expect(l3.message).not.toContain(" 90,00 € por persona");
    // Ni compra ni pedido
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);
  });

  it("un suplemento no es una modalidad; ids de otro producto, de otra empresa o inexistentes se rechazan sin crear nada", async () => {
    resetProductRequestLimits();
    // Como modalidad del programa: no se toma como tal (el lead queda sin modalidad ni suplemento)
    const modal = await request("a", { experienceId: ids.retiro, email: "m1@x.example", variantId: ids.indiv, seats: 1 });
    const [lm] = await ess.sql("a", "SELECT variant_id AS variantId, message FROM leads WHERE id = ?", [data(modal).leadId]);
    expect(lm.variantId).toBeNull();
    expect(lm.message).not.toContain("Suplementos");
    // Suplemento de OTRO producto de la misma empresa
    expect(errCode(await request("a", { experienceId: ids.retiro, email: "m2@x.example", seats: 1, supplementIds: [ids.comida] }))).toBe("BAD_REQUEST");
    // Inexistente
    expect(errCode(await request("a", { experienceId: ids.retiro, email: "m3@x.example", seats: 1, supplementIds: [999999] }))).toBe("BAD_REQUEST");
    // Otra empresa: el producto de B no tiene suplementos, el id de A no vale
    const b = await request("b", { experienceId: ids.retiroB, email: "m4@x.example", seats: 1, supplementIds: [ids.indiv] });
    expect(errCode(b)).toBe("BAD_REQUEST");
    expect(msg(b)).toContain("suplemento");
    // Tramo grupo fuera de rango (6 participantes > máx. del producto)
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE email LIKE 'm_@x.example'"))[0].n).toBe(1); // solo la de la modalidad
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM leads"))[0].n).toBe(0);
  });

  it("carrito de un producto de precio fijo: sin marcar = programa intacto; marcado suma por participantes; el cliente no fija importes", async () => {
    const base = { productId: ids.taller, bookingDate: "", people: 3 };
    const sin = await cart([base]);
    expect(sin.status, JSON.stringify(sin.json)).toBe(200);
    expect(data(sin).totalAmountCents).toBe(3 * 4900);
    // Marcado: 3 × 10 € más
    const con = await cart([{ ...base, supplementIds: [ids.comida] }]);
    expect(data(con).totalAmountCents).toBe(3 * 4900 + 3 * 1000);
    // Un importe enviado por el cliente se ignora (el esquema no lo admite)
    const forzado = await cart([{ ...base, supplementIds: [ids.comida], supplementCents: 1, supplementPrice: 0.01 }]);
    expect(data(forzado).totalAmountCents).toBe(3 * 4900 + 3 * 1000);
    // El suplemento no se puede elegir como opción del programa
    expect(errCode(await cart([{ ...base, variantId: ids.comida }]))).toBe("BAD_REQUEST");
    // Suplemento de otro producto
    const ajeno = await cart([{ ...base, supplementIds: [ids.indiv] }]);
    expect(errCode(ajeno)).toBe("BAD_REQUEST");
    expect(msg(ajeno)).toContain("No se ha realizado ningún cobro");
    // La línea del pedido lo nombra aparte
    const names = (await ess.sql("a", "SELECT product_name AS productName FROM reservations WHERE merchant_order = ?", [data(con).merchantOrder])).map((r: any) => r.productName);
    expect(names).toEqual(["Taller con comida + Comida (suplemento opcional)"]);
  });

  it("el «desde» del catálogo no cuenta el suplemento", async () => {
    const shop = data(await ess.q("a", "public.getExperiences", { limit: 50, offset: 0, withFromPrice: true })) as any[];
    const retiro = shop.find((p) => p.slug === "retiro-sup");
    expect(Number(retiro.fromPrice)).toBe(1190);
  });
});
