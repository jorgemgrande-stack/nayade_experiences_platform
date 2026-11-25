/**
 * Lifetime Access de RECONNECT con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Pago con la notificación de Redsys FIRMADA en la prueba (ninguna pasarela ni cobro real, correo con proveedor falso).
 * Producto, opciones, suplemento y reglas se crean en la empresa de PRUEBA (jamás en una real).
 *  - El suplemento solo se admite con las opciones de su ámbito, con un participante, y el importe lo fija el servidor.
 *  - El pedido guarda el suplemento realmente elegido; sin pagar no concede nada; pagado concede UNA matrícula permanente.
 *  - Reembolsar solo el suplemento retira ese derecho y deja el del programa; la recuperación no lo vuelve a conceder.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const KEY = crypto.randomBytes(24).toString("base64");
const TAG = Date.now().toString(36);

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
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

describe.skipIf(!URL_)("Lifetime Access (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  const ids = { course: 0, m: [0, 0, 0] as number[], exp: 0, live: 0, online: 0, lifetime: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const origin = () => `https://${ess.host("a")}`;
  const cart = (item: Record<string, unknown>, email: string) => ess.m("a", "reservations.cartCheckout", { customerName: "Alumna Lifetime", customerEmail: email, origin: origin(), items: [{ productId: ids.exp, bookingDate: "", people: 1, extras: [], ...item }] });
  const notify = async (merchantOrder: string, cents: number) => {
    const r = await ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: merchantOrder, Ds_Response: "0000", Ds_Amount: String(cents), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } } as any);
    expect(r.text).toBe("OK");
  };
  const enrollments = (email: string) => sql("SELECT e.* FROM learning_enrollments e JOIN users u ON u.id = e.user_id WHERE LOWER(u.email) = ? ORDER BY e.id", [email.toLowerCase()]);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lifetime");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, adm);
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm), "lugar");
    const cat = (await sql("SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await sql("SELECT id FROM locations LIMIT 1"))[0].id;
    ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, offerMode: "fixed", slug: `reconnect-${TAG}`, title: "RECONNECT", basePrice: "111.00", minPersons: 1, maxPersons: 5 }, adm), "producto");
    ids.exp = Number((await sql("SELECT id FROM experiences WHERE slug = ?", [`reconnect-${TAG}`]))[0].id);
    const mk = async (name: string, price: string, extra: Record<string, unknown> = {}) => {
      ok(await ess.m("a", "products.createVariant", { experienceId: ids.exp, name, priceModifier: price, priceType: "fixed", ...extra }, adm), name);
      return Number((await sql("SELECT id FROM experience_variants WHERE experienceId = ? AND name = ?", [ids.exp, name]))[0].id);
    };
    ids.live = await mk("LIVE", "111.00");
    ids.online = await mk("ONLINE COMPLETO", "555.00");
    ids.lifetime = await mk("Lifetime Access", "144.00", { supplementGroup: "lifetime", minQty: 1, maxQty: 1 });
    ok(await ess.m("a", "products.setSupplementScope", { supplementVariantId: ids.lifetime, programmeVariantIds: [ids.online] }, adm), "ámbito");
    const now = Date.now();
    await sql("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES (?,?,?,?,?,?)", [`curso-${TAG}`, "RECONNECT", "de", "published", now, now]);
    ids.course = Number((await sql("SELECT id FROM learning_courses WHERE slug = ?", [`curso-${TAG}`]))[0].id);
    for (const k of [0, 1, 2]) {
      await sql("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ids.course, k + 1, `TEIL ${k + 1}`, `m${k}`, now, now]);
      ids.m[k] = Number((await sql("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [ids.course, `m${k}`]))[0].id);
      await sql("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ids.m[k], 1, `Lektion ${k + 1}`, `l${k}`, now, now]);
    }
    const sched = (dur: number | null) => ids.m.map((m, i) => ({ moduleId: m, unlockOffsetDays: i * 30, durationDays: dur }));
    ok(await ess.m("a", "learning.admin.saveRule", { experienceId: ids.exp, variantId: ids.online, courseId: ids.course, moduleIds: ids.m, durationDays: 30, startMode: "on_grant", fixedStart: null, active: true, moduleSettings: sched(30) }, adm), "regla programa");
    ok(await ess.m("a", "learning.admin.saveRule", { experienceId: ids.exp, variantId: ids.lifetime, courseId: ids.course, moduleIds: ids.m, durationDays: null, startMode: "on_grant", fixedStart: null, active: true, permanent: true, moduleSettings: sched(null) }, adm), "regla Lifetime");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("el suplemento solo se admite con las opciones de su ámbito y con un participante; el importe lo fija el servidor", async () => {
    // Sin marcar: el programa no cambia
    expect(data(await cart({ variantId: ids.online }, `a1.${TAG}@lifetime.example`)).totalAmountCents).toBe(55500);
    // Marcado con ONLINE: +144 € (un importe enviado por el cliente se ignora)
    const con = await cart({ variantId: ids.online, supplementIds: [ids.lifetime], supplementCents: 1 }, `a2.${TAG}@lifetime.example`);
    expect(data(con).totalAmountCents).toBe(55500 + 14400);
    // Con LIVE (fuera del ámbito) o sin opción: rechazado, sin cobro
    const live = await cart({ variantId: ids.live, supplementIds: [ids.lifetime] }, `a3.${TAG}@lifetime.example`);
    expect(errCode(live)).toBe("BAD_REQUEST");
    expect(String(live.json?.error?.json?.message)).toContain("No se ha realizado ningún cobro");
    expect(errCode(await cart({ supplementIds: [ids.lifetime] }, `a4.${TAG}@lifetime.example`))).toBe("BAD_REQUEST");
    // Dos participantes: el suplemento es de una sola persona
    expect(errCode(await cart({ variantId: ids.online, people: 2, supplementIds: [ids.lifetime] }, `a5.${TAG}@lifetime.example`))).toBe("BAD_REQUEST");
    // El suplemento no es una opción del programa
    expect(errCode(await cart({ variantId: ids.lifetime }, `a6.${TAG}@lifetime.example`))).toBe("BAD_REQUEST");
  });

  it("el pedido guarda el suplemento elegido; sin pagar no concede; pagado concede una matrícula permanente; repetir no duplica", async () => {
    const email = `b1.${TAG}@lifetime.example`;
    const order = data(await cart({ variantId: ids.online, supplementIds: [ids.lifetime] }, email)).merchantOrder as string;
    const [line] = await sql("SELECT * FROM order_supplement_lines WHERE merchant_order = ?", [order]);
    expect(line).toMatchObject({ variant_id: ids.lifetime, supplement_group: "lifetime", quantity: 1, unit_cents: 14400, total_cents: 14400, status: "active", product_id: ids.exp });
    expect(await enrollments(email)).toEqual([]); // pedido sin pagar: nada
    await notify(order, 69900);
    const got = await waitFor(() => enrollments(email), (r) => r.length >= 2);
    expect(got).toHaveLength(2);
    expect(got.filter((e) => e.ends_at == null)).toHaveLength(1);
    await notify(order, 69900);
    ok(await ess.m("a", "learning.admin.grantForOrder", { merchantOrder: order }, adm), "recuperación");
    ok(await ess.m("a", "learning.admin.grantForOrder", { merchantOrder: order }, adm), "recuperación 2");
    expect(await enrollments(email)).toHaveLength(2);
    const life = got.find((e) => e.ends_at == null)!;
    expect((await sql("SELECT learning_enrollment_id FROM order_supplement_lines WHERE merchant_order = ?", [order]))[0].learning_enrollment_id).toBe(life.id);
    // La factura del pedido sigue su curso normal
    const inv = await waitFor(() => sql("SELECT invoiceId AS invoice_id FROM reservations WHERE merchant_order = ?", [order]), (r) => r[0]?.invoice_id != null);
    expect(inv[0].invoice_id).not.toBeNull();
    // Reembolso del suplemento SOLO: retira Lifetime, no el programa, y la recuperación no lo concede de nuevo
    const r = ok(await ess.m("a", "learning.admin.refundSupplement", { merchantOrder: order, group: "lifetime", reason: "Prueba de reembolso del suplemento" }, adm), "reembolso");
    expect(r).toMatchObject({ refunded: true, revokedEnrollmentId: life.id });
    ok(await ess.m("a", "learning.admin.grantForOrder", { merchantOrder: order }, adm), "recuperación tras reembolso");
    const after = await enrollments(email);
    expect(after).toHaveLength(2);
    expect(after.find((e) => e.id === life.id)!.status).toBe("revoked");
    expect(after.find((e) => e.ends_at != null)!.status).toBe("active");
  });

  it("el reembolso de un suplemento exige administración y un pedido que lo tenga", async () => {
    expect((await ess.m("a", "learning.admin.refundSupplement", { merchantOrder: "LT-NO", group: "lifetime", reason: "x" })).status).toBe(401);
    expect((await ess.m("a", "learning.admin.refundSupplement", { merchantOrder: "LT-NO", group: "lifetime", reason: "x" }, adm)).status).toBe(400);
  });

  it("el ámbito del suplemento solo admite opciones del programa del mismo producto", async () => {
    expect(errCode(await ess.m("a", "products.setSupplementScope", { supplementVariantId: ids.live, programmeVariantIds: [ids.online] }, adm))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "products.setSupplementScope", { supplementVariantId: ids.lifetime, programmeVariantIds: [ids.lifetime] }, adm))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "products.setSupplementScope", { supplementVariantId: ids.lifetime, programmeVariantIds: [ids.online] })).status).toBe(401);
  });

  it("la ficha pública indica con qué opciones se ofrece el suplemento", async () => {
    const offers = data(await ess.q("a", "public.getSupplementsByExperience", { experienceId: ids.exp })) as any[];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ group: "lifetime", forVariantIds: [ids.online] });
    expect(offers[0].tiers).toHaveLength(1);
    expect(JSON.stringify(offers)).not.toMatch(/reservation|email|merchant/i);
  });
});
