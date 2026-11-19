/**
 * LMS: PEDIDO de tienda pagado → matrícula, con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Compra con el checkout existente (`reservations.createAndPay`) y notificación de pago de Redsys FIRMADA en la prueba
 * (ninguna llamada a una pasarela real, ningún cobro, correo con proveedor falso). Cubre el circuito RECONNECT:
 * variante comprada → regla → matrícula solo en los módulos contratados, idempotencia, pagos no confirmados y recuperación.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const KEY = crypto.randomBytes(24).toString("base64");
const TAG = Date.now().toString(36);
const mail = (who: string) => `${who}.${TAG}@lms-order.example`;

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
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

describe.skipIf(!URL_)("LMS: pedido pagado → matrícula automática (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  const ids = { exp: 0, other: 0, course: 0, m1: 0, m2: 0, m3: 0, vLive: 0, vM1: 0, vOnline: 0, vIntensiv: 0, vOther: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  /** Compra con el checkout existente; devuelve el número de pedido. */
  const buy = async (productId: number, variantId: number, email: string, name = "Alumna Prueba") => {
    const r = await ess.m("a", "reservations.createAndPay", { productId, bookingDate: "2030-06-01", people: 1, variantId, customerName: name, customerEmail: email, origin: `https://${ess.host("a")}` });
    return ok(r, "checkout").merchantOrder as string;
  };
  const notify = async (merchantOrder: string, cents: number, response = "0000") => {
    const r = await ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: merchantOrder, Ds_Response: response, Ds_Amount: String(cents), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.text).toBe("OK");
  };
  const paid = (merchantOrder: string) => waitFor(() => sql("SELECT status FROM reservations WHERE merchant_order = ?", [merchantOrder]), (rows) => rows[0]?.status === "paid");
  const enrollments = (email: string) => sql("SELECT le.id, le.status, le.source, le.variant_id, le.order_id, le.payment_ref FROM learning_enrollments le JOIN users u ON u.id = le.user_id WHERE u.email = ? ORDER BY le.id", [email]);
  const modulesOf = async (enrollmentId: number) => (await sql("SELECT module_id FROM learning_enrollment_modules WHERE enrollment_id = ? ORDER BY module_id", [enrollmentId])).map((r) => Number(r.module_id));
  const accessMails = (email: string) => ess.mails.filter((m) => m.to.some((t) => t.email === email) && /mi-formacion/.test(m.htmlContent));

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsorder");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, adm);
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm), "lugar");
    const cat = (await sql("SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await sql("SELECT id FROM locations LIMIT 1"))[0].id;
    const mkProduct = async (slug: string, title: string, price: string) => {
      ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, offerMode: "fixed", slug, title, basePrice: price }, adm), title);
      return Number((await sql("SELECT id FROM experiences WHERE slug = ?", [slug]))[0].id);
    };
    ids.exp = await mkProduct(`reconnect-${TAG}`, "Reconnect", "555.00");
    ids.other = await mkProduct(`otro-${TAG}`, "Otro curso sin regla", "50.00");
    const mkVariant = async (exp: number, name: string, price: string) => {
      ok(await ess.m("a", "products.createVariant", { experienceId: exp, name, priceModifier: price, priceType: "fixed" }, adm), name);
      return Number((await sql("SELECT id FROM experience_variants WHERE experienceId = ? AND name = ?", [exp, name]))[0].id);
    };
    ids.vLive = await mkVariant(ids.exp, "LIVE", "111.00");
    ids.vM1 = await mkVariant(ids.exp, "+ MODUL 1", "199.00");
    ids.vOnline = await mkVariant(ids.exp, "ONLINE KOMPLETT", "333.00");
    ids.vIntensiv = await mkVariant(ids.exp, "INTENSIV", "555.00");
    ids.vOther = await mkVariant(ids.other, "Único", "50.00");
    const now = Date.now();
    await sql("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES (?,?,?,?,?,?)", [`curso-${TAG}`, "RECONNECT", "de", "published", now, now]);
    ids.course = Number((await sql("SELECT id FROM learning_courses WHERE slug = ?", [`curso-${TAG}`]))[0].id);
    for (const k of [1, 2, 3]) {
      await sql("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ids.course, k, `TEIL ${k}`, `m${k}`, now, now]);
      (ids as any)[`m${k}`] = Number((await sql("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [ids.course, `m${k}`]))[0].id);
    }
    const rule = (variantId: number, mods: number[]) => ess.m("a", "learning.admin.saveRule", { experienceId: ids.exp, variantId, courseId: ids.course, moduleIds: mods, durationDays: 90, startMode: "on_grant", fixedStart: null, active: true }, adm);
    // LIVE: sin regla (no incluye formación). +MODUL 1: solo el módulo 1. ONLINE e INTENSIV: los tres.
    ok(await rule(ids.vM1, [ids.m1]), "regla +M1");
    ok(await rule(ids.vOnline, [ids.m1, ids.m2, ids.m3]), "regla ONLINE");
    ok(await rule(ids.vIntensiv, [ids.m1, ids.m2, ids.m3]), "regla INTENSIV");
    // El correo de acceso sale al abrir la venta: aquí lo encendemos desde el principio (antes de cualquier lectura del ajuste)
    await sql("INSERT INTO system_settings (`key`, value, value_type, category, label) VALUES ('learning_invite_emails', 'true', 'boolean', 'general', 'Correo de acceso al aula')");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("pago pendiente o fallido: ni matrícula ni cuenta ni correo", async () => {
    const email = mail("pendiente");
    const pending = await buy(ids.exp, ids.vOnline, email);
    expect(await enrollments(email)).toEqual([]);
    expect(await sql("SELECT id FROM users WHERE email = ?", [email])).toEqual([]);
    await notify(pending, 33300, "0190"); // denegado por el banco
    await waitFor(() => sql("SELECT status FROM reservations WHERE merchant_order = ?", [pending]), (r) => r[0]?.status === "failed");
    expect(await enrollments(email)).toEqual([]);
    expect(await sql("SELECT id FROM users WHERE email = ?", [email])).toEqual([]);
    expect(accessMails(email)).toEqual([]);
  });

  it("+ MODUL 1 pagado: matrícula SOLO en el módulo 1, con la variante, el pedido y la referencia; cuenta nueva con invitación", async () => {
    const email = mail("m1");
    const order = await buy(ids.exp, ids.vM1, email, "Alumna Uno");
    expect((await sql("SELECT variant_id FROM reservations WHERE merchant_order = ?", [order]))[0].variant_id).toBe(ids.vM1); // variante guardada al crear la línea
    await notify(order, 19900);
    await paid(order);
    const rows = await waitFor(() => enrollments(email), (r) => r.length > 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", source: "payment", variant_id: ids.vM1 });
    expect(String(rows[0].payment_ref)).toContain(order);
    expect(await modulesOf(rows[0].id)).toEqual([ids.m1]); // no puede abrir el 2 ni el 3
    const invites = await waitFor(async () => ess.mails.filter((m) => m.to.some((t) => t.email === email) && m.htmlContent.includes("/mi-formacion/activar?token=")), (m) => m.length > 0);
    expect(invites).toHaveLength(1);
  });

  it("la misma notificación repetida y la recuperación manual no duplican matrícula ni correo", async () => {
    const email = mail("m1");
    const [{ merchant_order: order }] = await sql("SELECT merchant_order FROM reservations WHERE customer_email = ? LIMIT 1", [email]);
    await notify(order, 19900);
    await notify(order, 19900);
    const g1 = ok(await ess.m("a", "learning.admin.grantForOrder", { merchantOrder: order }, adm), "recuperar");
    const g2 = ok(await ess.m("a", "learning.admin.grantForOrder", { merchantOrder: order }, adm), "recuperar de nuevo");
    expect(g1).toMatchObject({ status: "granted", created: 0, existing: 1 });
    expect(g2).toMatchObject({ status: "granted", created: 0, existing: 1 });
    expect(await enrollments(email)).toHaveLength(1);
    expect(ess.mails.filter((m) => m.to.some((t) => t.email === email) && /mi-formacion/.test(m.htmlContent))).toHaveLength(1);
  });

  it("RECONNECT LIVE pagado (sin regla) y un producto sin regla: no conceden formación", async () => {
    const live = mail("live");
    const o1 = await buy(ids.exp, ids.vLive, live);
    await notify(o1, 11100);
    await paid(o1);
    const other = mail("otro");
    const o2 = await buy(ids.other, ids.vOther, other);
    await notify(o2, 5000);
    await paid(o2);
    await new Promise((r) => setTimeout(r, 600));
    expect(await enrollments(live)).toEqual([]);
    expect(await enrollments(other)).toEqual([]);
    expect(await sql("SELECT id FROM users WHERE email IN (?, ?)", [live, other])).toEqual([]); // ni cuenta
  });

  it("ONLINE KOMPLETT e INTENSIV: los tres módulos; una cuenta ya activa recibe el aviso con enlace a /mi-formacion", async () => {
    const [existing] = await sql("SELECT email FROM users WHERE role = 'user' AND passwordHash IS NOT NULL LIMIT 1");
    const email = String(existing.email);
    const o = await buy(ids.exp, ids.vIntensiv, email, "Alumno Activo");
    await notify(o, 55500);
    await paid(o);
    const rows = await waitFor(() => enrollments(email), (r) => r.length > 0);
    expect(rows[0]).toMatchObject({ source: "payment", variant_id: ids.vIntensiv });
    expect(await modulesOf(rows[0].id)).toEqual([ids.m1, ids.m2, ids.m3].sort((a, b) => a - b));
    const notice = await waitFor(async () => accessMails(email), (m) => m.length > 0);
    expect(notice).toHaveLength(1);
    expect(notice[0].htmlContent).toContain("/mi-formacion");
    expect(notice[0].htmlContent).not.toContain("/activar?token="); // ya tiene contraseña: no se reinicia su acceso
  });

  it("compra posterior del mismo alumno: una matrícula por compra (idempotente por pedido); el acceso es la unión de lo contratado", async () => {
    const email = mail("m1");
    const o = await buy(ids.exp, ids.vOnline, email, "Alumna Uno");
    await notify(o, 33300);
    await paid(o);
    const rows = await waitFor(() => enrollments(email), (r) => r.length === 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.variant_id).sort()).toEqual([ids.vM1, ids.vOnline].sort());
    const union = new Set<number>();
    for (const r of rows) for (const m of await modulesOf(r.id)) union.add(m);
    expect([...union].sort()).toEqual([ids.m1, ids.m2, ids.m3].sort((a, b) => a - b));
    // La compra anterior sigue acotada al módulo 1
    expect(await modulesOf(rows.find((r) => r.variant_id === ids.vM1)!.id)).toEqual([ids.m1]);
    // Reintento del cobro de la segunda compra: sigue habiendo dos matrículas
    await notify(o, 33300);
    ok(await ess.m("a", "learning.admin.grantForOrder", { merchantOrder: o }, adm), "recuperar");
    expect(await enrollments(email)).toHaveLength(2);
  });
});
