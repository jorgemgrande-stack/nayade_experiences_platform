/**
 * LMS: ampliar un módulo desde el aula, con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Pago con la notificación de Redsys FIRMADA en la prueba (ninguna pasarela ni cobro real, correo con proveedor falso).
 * El catálogo de ampliaciones se crea en la empresa de PRUEBA (jamás en una real).
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const KEY = crypto.randomBytes(24).toString("base64");
const TAG = Date.now().toString(36);
const DAY = 86_400_000;

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

describe.skipIf(!URL_)("LMS: «Ampliar este módulo» (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  let cookieA = "";
  let cookieB = "";
  const ids = { course: 0, m1: 0, m2: 0, m3: 0, l1: 0, extExp: 0, v30: 0, v60: 0, userA: 0, userB: 0, enrA: 0, enrB: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const notify = async (merchantOrder: string, cents: number, response = "0000") => {
    const r = await ess.call("a", "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: merchantOrder, Ds_Response: response, Ds_Amount: String(cents), Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.text).toBe("OK");
  };
  const effEnd = async (enrollmentId: number, moduleId: number) => Number((await sql("SELECT COALESCE(m.ends_at, e.ends_at) AS ends_at FROM learning_enrollment_modules m JOIN learning_enrollments e ON e.id = m.enrollment_id WHERE m.enrollment_id = ? AND m.module_id = ?", [enrollmentId, moduleId]))[0].ends_at);
  const ledger = (enrollmentId: number) => sql("SELECT * FROM learning_module_extensions WHERE enrollment_id = ?", [enrollmentId]);
  const mkUser = async (name: string) => {
    const email = `${name}.${TAG}@lms-aula.example`;
    await sql("INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, ?, ?, 'local', 'user', 1, ?, 1)", [`local_${name}_${TAG}`, `Alumno ${name}`, email, await bcrypt.hash("clave-de-prueba-1", 4)]);
    const id = Number((await sql("SELECT id FROM users WHERE email = ?", [email]))[0].id);
    const r = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: "clave-de-prueba-1" } });
    expect(r.status).toBe(200);
    return { id, cookie: r.cookie! };
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsaula");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, adm);
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm), "lugar");
    const cat = (await sql("SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await sql("SELECT id FROM locations LIMIT 1"))[0].id;
    ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, offerMode: "fixed", slug: `ampliacion-${TAG}`, title: "Ampliación de acceso", basePrice: "33.00" }, adm), "producto de ampliación");
    ids.extExp = Number((await sql("SELECT id FROM experiences WHERE slug = ?", [`ampliacion-${TAG}`]))[0].id);
    const mkVariant = async (name: string, price: string) => {
      ok(await ess.m("a", "products.createVariant", { experienceId: ids.extExp, name, priceModifier: price, priceType: "fixed" }, adm), name);
      return Number((await sql("SELECT id FROM experience_variants WHERE experienceId = ? AND name = ?", [ids.extExp, name]))[0].id);
    };
    ids.v30 = await mkVariant("+1 mes", "33.00");
    ids.v60 = await mkVariant("+2 meses", "55.00");
    // Catálogo de ampliaciones de la empresa de PRUEBA, antes de cualquier lectura del ajuste
    await sql("INSERT INTO system_settings (`key`, value, value_type, category, label) VALUES ('learning_extension_catalog', ?, 'string', 'general', 'Catálogo de ampliaciones')", [JSON.stringify({ experienceId: ids.extExp, variants: { "30": ids.v30, "60": ids.v60 } })]);
    const now = Date.now();
    await sql("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES (?,?,?,?,?,?)", [`curso-${TAG}`, "RECONNECT", "de", "published", now, now]);
    ids.course = Number((await sql("SELECT id FROM learning_courses WHERE slug = ?", [`curso-${TAG}`]))[0].id);
    for (const k of [1, 2, 3]) {
      await sql("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ids.course, k, `TEIL ${k}`, `m${k}`, now, now]);
      const m = Number((await sql("SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [ids.course, `m${k}`]))[0].id);
      (ids as any)[`m${k}`] = m;
      await sql("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [m, 1, `Lektion ${k}`, `l${k}`, now, now]);
    }
    ids.l1 = Number((await sql("SELECT id FROM learning_lessons WHERE module_id = ?", [ids.m1]))[0].id);
    const A = await mkUser("alumnaa");
    const B = await mkUser("alumnob");
    ({ id: ids.userA, cookie: cookieA } = A);
    ({ id: ids.userB, cookie: cookieB } = B);
    const grant = async (userId: number, mods: number[]) => ok(await ess.m("a", "learning.admin.grant", { userId, courseId: ids.course, moduleIds: mods, durationDays: 30, reason: "Concesión de prueba del aula", nonce: `nonce-${userId}-${TAG}` }, adm), "concesión").enrollment.id as number;
    ids.enrA = await grant(ids.userA, [ids.m1, ids.m2]);
    ids.enrB = await grant(ids.userB, [ids.m1]);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("el aula ofrece las ampliaciones con el precio del catálogo y marca qué módulos se pueden ampliar", async () => {
    const r = ok(await ess.q("a", "learning.my.course", { courseId: ids.course }, cookieA), "índice");
    expect(r.extensionOffers).toEqual([{ days: 30, priceCents: 3300 }, { days: 60, priceCents: 5500 }]);
    const byId = Object.fromEntries(r.modules.map((m: any) => [m.id, m]));
    expect(byId[ids.m1]).toMatchObject({ state: "open", unlocked: true, canExtend: true });
    expect(byId[ids.m2]).toMatchObject({ state: "open", canExtend: true });
    expect(byId[ids.m3]).toMatchObject({ state: "not_included", unlocked: false, canExtend: false });
    expect(byId[ids.m1].endsAt).toBeGreaterThan(Date.now());
  });

  it("(b) el alumno B no ve ni puede ampliar los módulos del alumno A", async () => {
    const rb = ok(await ess.q("a", "learning.my.course", { courseId: ids.course }, cookieB), "índice de B");
    const byId = Object.fromEntries(rb.modules.map((m: any) => [m.id, m]));
    expect(byId[ids.m1].canExtend).toBe(true); // el suyo
    expect(byId[ids.m2]).toMatchObject({ canExtend: false, state: "not_included" }); // el módulo 2 es solo de A
    const before = (await sql("SELECT COUNT(*) AS n FROM reservations WHERE customer_email LIKE '%@lms-aula.example'"))[0].n;
    const tryM2 = await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m2, days: 30 }, cookieB);
    expect(errCode(tryM2)).toBe("FORBIDDEN");
    const tryM3 = await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m3, days: 30 }, cookieA);
    expect(errCode(tryM3)).toBe("FORBIDDEN"); // módulo no incluido
    expect((await sql("SELECT COUNT(*) AS n FROM reservations WHERE customer_email LIKE '%@lms-aula.example'"))[0].n).toBe(before); // no se crea ningún pedido
    // días fuera del catálogo o sin sesión
    expect((await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m1, days: 31 }, cookieA)).status).toBe(400);
    expect((await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m1, days: 30 })).status).toBe(401);
  });

  it("compra y pago: el precio lo fija el servidor, el pedido repetido se reutiliza y solo el aviso firmado de pago amplía, una vez", async () => {
    const before = await effEnd(ids.enrA, ids.m1);
    const otherBefore = await effEnd(ids.enrA, ids.m2);
    await sql("INSERT INTO learning_progress (user_id, lesson_id, status, completed_at, updated_at) VALUES (?,?,?,?,?)", [ids.userA, ids.l1, "completed", Date.now(), Date.now()]);
    const s1 = ok(await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m1, days: 30, precio: 1 }, cookieA), "ampliar");
    expect(s1).toMatchObject({ amountCents: 3300 }); // cualquier precio del cliente se ignora
    expect(s1.redsysForm).toBeTruthy();
    const s2 = ok(await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m1, days: 30 }, cookieA), "ampliar de nuevo");
    expect(s2.merchantOrder).toBe(s1.merchantOrder); // clic repetido: mismo pedido pendiente
    const [line] = await sql("SELECT status, amount_total, product_id, variant_id FROM reservations WHERE merchant_order = ?", [s1.merchantOrder]);
    expect(line).toMatchObject({ status: "pending_payment", amount_total: 3300, product_id: ids.extExp, variant_id: ids.v30 });
    expect(await effEnd(ids.enrA, ids.m1)).toBe(before); // pedido sin pagar: nada cambia
    // pago fallido: nada
    const failed = ok(await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m2, days: 60 }, cookieA), "otro pedido");
    expect(failed.amountCents).toBe(5500);
    await notify(failed.merchantOrder, 5500, "0190");
    await waitFor(() => sql("SELECT status FROM reservations WHERE merchant_order = ?", [failed.merchantOrder]), (r) => r[0]?.status === "failed");
    expect(await effEnd(ids.enrA, ids.m2)).toBe(otherBefore);
    expect(await ledger(ids.enrA)).toEqual([]);
    // pago confirmado (firmado, repetido y recuperación manual): una sola ampliación
    await notify(s1.merchantOrder, 3300);
    await waitFor(() => ledger(ids.enrA), (r) => r.length > 0);
    await notify(s1.merchantOrder, 3300);
    ok(await ess.m("a", "learning.admin.applyExtensionsForOrder", { merchantOrder: s1.merchantOrder }, adm), "recuperación");
    ok(await ess.m("a", "learning.admin.applyExtensionsForOrder", { merchantOrder: s1.merchantOrder }, adm), "recuperación 2");
    expect(await ledger(ids.enrA)).toHaveLength(1);
    expect(await effEnd(ids.enrA, ids.m1)).toBe(before + 30 * DAY);
    expect(await effEnd(ids.enrA, ids.m2)).toBe(otherBefore); // el otro módulo no se toca
    expect((await sql("SELECT status FROM learning_progress WHERE user_id = ? AND lesson_id = ?", [ids.userA, ids.l1]))[0].status).toBe("completed"); // progreso intacto
    // la factura del pedido sigue su curso normal
    const inv = await waitFor(() => sql("SELECT invoiceId AS invoice_id FROM reservations WHERE merchant_order = ?", [s1.merchantOrder]), (r) => r[0]?.invoice_id != null);
    expect(inv[0].invoice_id).not.toBeNull();
    // B sigue sin cambios
    expect(await ledger(ids.enrB)).toEqual([]);
  });

  it("el producto de ampliación no se puede comprar por el carrito normal (sin marca de módulo no ampliaría nada)", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", { items: [{ productId: ids.extExp, bookingDate: "2030-06-01", people: 1, variantId: ids.v30, extras: [] }], customerName: "Alumna A", customerEmail: `alumnaa.${TAG}@lms-aula.example`, origin: `https://${ess.host("a")}` });
    expect(r.status).toBe(400);
    const r2 = await ess.m("a", "reservations.createAndPay", { productId: ids.extExp, bookingDate: "2030-06-01", people: 1, variantId: ids.v30, customerName: "Alumna A", customerEmail: `alumnaa.${TAG}@lms-aula.example`, origin: `https://${ess.host("a")}` });
    expect(r2.status).toBe(400);
  });

  it("matrícula revocada: no se puede pedir la ampliación", async () => {
    ok(await ess.m("a", "learning.admin.revoke", { enrollmentId: ids.enrB, reason: "Prueba de revocación del aula" }, adm), "revocar");
    const t = await ess.m("a", "learning.my.startExtension", { courseId: ids.course, moduleId: ids.m1, days: 30 }, cookieB);
    expect(errCode(t)).toBe("FORBIDDEN");
  });

  it("sin catálogo de ampliaciones en la empresa no se ofrece ni se crea nada", async () => {
    // La empresa B no tiene el ajuste: ni siquiera con sesión de administración se crea un pedido
    const admB = await ess.login("b", "admin");
    await ess.markPaid("b");
    await ess.m("b", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY } }, admB);
    const t = await ess.m("b", "learning.my.startExtension", { courseId: 1, moduleId: 1, days: 30 }, admB);
    expect(t.status).toBe(400);
    expect(JSON.stringify(t.json)).toContain("no está disponible");
  });
});
