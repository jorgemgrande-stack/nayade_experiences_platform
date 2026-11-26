/**
 * Activación voluntaria del acceso con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Sin pasarela ni cobros:
 * el pago verificado lo registra la administración (grantFromPayment). Dos empresas sintéticas, dos alumnos.
 *  - El derecho llega pendiente: el aula lo muestra y el módulo sigue cerrado.
 *  - Solo el titular lo activa; otro alumno, otra empresa y una persona sin sesión, no.
 *  - Al activar se abre el módulo; repetir no mueve la ventana.
 */
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const TAG = Date.now().toString(36);
const DAY = 86_400_000;

describe.skipIf(!URL_)("Activación voluntaria del acceso (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  const ids = { course: 0, m1: 0, exp: 0, variant: 0, userA: 0, userB: 0, enr: 0 };
  let cookieA = "";
  let cookieB = "";
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const mkUser = async (name: string) => {
    const email = `${name}.${TAG}@activacion.example`;
    await sql("INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES (?, ?, ?, 'local', 'user', 1, ?, 1)", [`local_${name}_${TAG}`, `Alumno ${name}`, email, await bcrypt.hash("clave-de-prueba-1", 4)]);
    const id = Number((await sql("SELECT id FROM users WHERE email = ?", [email]))[0].id);
    const r = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: "clave-de-prueba-1" } });
    expect(r.status).toBe(200);
    return { id, cookie: r.cookie! };
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "activacion");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "retiros", name: "Retiros" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "sierra", name: "Sierra" }, adm), "lugar");
    const cat = (await sql("SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await sql("SELECT id FROM locations LIMIT 1"))[0].id;
    ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, offerMode: "priced_request", slug: `retiro-${TAG}`, title: "Retiro de seis días", basePrice: "1290" }, adm), "producto");
    ids.exp = Number((await sql("SELECT id FROM experiences WHERE slug = ?", [`retiro-${TAG}`]))[0].id);
    ok(await ess.m("a", "products.createVariant", { experienceId: ids.exp, name: "Einzel-Retreat · 6 Tage", priceModifier: "1290", priceType: "fixed" }, adm), "opción");
    ids.variant = Number((await sql("SELECT id FROM experience_variants WHERE experienceId = ?", [ids.exp]))[0].id);
    const now = Date.now();
    await sql("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES (?,?,?,?,?,?)", [`curso-${TAG}`, "RECONNECT", "de", "published", now, now]);
    ids.course = Number((await sql("SELECT id FROM learning_courses WHERE slug = ?", [`curso-${TAG}`]))[0].id);
    await sql("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ids.course, 1, "TEIL 1", "m1", now, now]);
    ids.m1 = Number((await sql("SELECT id FROM learning_modules WHERE course_id = ?", [ids.course]))[0].id);
    await sql("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ids.m1, 1, "Lektion 1", "l1", now, now]);
    ok(await ess.m("a", "learning.admin.saveRule", { experienceId: ids.exp, variantId: ids.variant, courseId: ids.course, moduleIds: [ids.m1], durationDays: 30, startMode: "on_grant", fixedStart: null, active: true, activationRequired: true }, adm), "regla");
    const A = await mkUser("alumnaa");
    const B = await mkUser("alumnob");
    ({ id: ids.userA, cookie: cookieA } = A);
    ({ id: ids.userB, cookie: cookieB } = B);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("el pago verificado concede un derecho pendiente: el aula lo muestra y el módulo sigue cerrado", async () => {
    const g = ok(await ess.m("a", "learning.admin.grantFromPayment", { userId: ids.userA, experienceId: ids.exp, variantId: ids.variant, operation: { kind: "order", id: 9001 }, payment: { reference: "pedido:PRUEBA1", amountCents: 129000 } }, adm), "concesión");
    ids.enr = g.granted[0].enrollment.id;
    const courses = ok(await ess.q("a", "learning.my.courses", undefined, cookieA), "cursos") as any[];
    expect(courses[0]).toMatchObject({ status: "pending_activation", pendingActivation: { enrollmentId: ids.enr, days: 30 } });
    const idx = ok(await ess.q("a", "learning.my.course", { courseId: ids.course }, cookieA), "índice") as any;
    expect(idx.pendingActivation).toEqual({ enrollmentId: ids.enr, days: 30 });
    expect(idx.modules[0]).toMatchObject({ state: "pending_activation", unlocked: false });
  });

  it("solo el titular activa: otro alumno, sin sesión o con un id inexistente se rechazan sin cambiar nada", async () => {
    expect(errCode(await ess.m("a", "learning.my.activate", { enrollmentId: ids.enr }, cookieB))).toBe("FORBIDDEN");
    expect((await ess.m("a", "learning.my.activate", { enrollmentId: ids.enr })).status).toBe(401);
    expect(errCode(await ess.m("a", "learning.my.activate", { enrollmentId: 987654 }, cookieA))).toBe("NOT_FOUND");
    const e = (await sql("SELECT pending_activation_days AS p, ends_at FROM learning_enrollments WHERE id = ?", [ids.enr]))[0];
    expect([e.p, e.ends_at]).toEqual([30, null]);
  });

  it("al activar se abre el módulo 30 días desde ese instante; repetirlo no mueve la ventana", async () => {
    const before = Date.now();
    const r1 = ok(await ess.m("a", "learning.my.activate", { enrollmentId: ids.enr }, cookieA), "activar");
    expect(r1.activated).toBe(true);
    expect(r1.startsAt).toBeGreaterThanOrEqual(before);
    expect(r1.endsAt - r1.startsAt).toBe(30 * DAY);
    const r2 = ok(await ess.m("a", "learning.my.activate", { enrollmentId: ids.enr }, cookieA), "activar de nuevo");
    expect(r2).toMatchObject({ activated: false, startsAt: r1.startsAt, endsAt: r1.endsAt });
    const idx = ok(await ess.q("a", "learning.my.course", { courseId: ids.course }, cookieA), "índice") as any;
    expect(idx.pendingActivation).toBeNull();
    expect(idx.modules[0]).toMatchObject({ state: "open", unlocked: true });
    const courses = ok(await ess.q("a", "learning.my.courses", undefined, cookieA), "cursos") as any[];
    expect(courses[0].status).toBe("active");
    // el otro alumno no ve nada de este curso
    expect(errCode(await ess.q("a", "learning.my.course", { courseId: ids.course }, cookieB))).toBe("FORBIDDEN");
  });

  it("la empresa B no tiene este derecho ni puede activarlo", async () => {
    const admB = await ess.login("b", "admin");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM learning_enrollments"))[0].n).toBe(0);
    expect((await ess.m("b", "learning.my.activate", { enrollmentId: ids.enr }, admB)).status).not.toBe(200);
  });
});
