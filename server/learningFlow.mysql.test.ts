/**
 * LMS entrega 4: circuito comercial → matrícula con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Sin cobros reales: el cobro es el manual del CRM (`crm.quotes.confirmPayment`); sin correos reales (proveedor falso).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { resetProductRequestLimits } from "./productRequests";
import { addDaysToDate } from "../shared/editionSessions";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const TAG = Date.now().toString(36);
// Claves de prueba generadas en cada ejecución (nada con aspecto de secreto en el código)
const NEW_PW = `Pw-${randomBytes(9).toString("hex")}`;
const OTHER_PW = `Pw-${randomBytes(9).toString("hex")}`;
const mail = (who: string) => `${who}.${TAG}@lms-flow.example`;
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

describe.skipIf(!URL_)("LMS: pago confirmado → matrícula (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  const ids = { exp: 0, edition: 0, course: 0, m1: 0, m2: 0, m3: 0, l1: 0, vLive: 0, vM1: 0, vOnline: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const request = (email: string, variantId: number, name = "Alumna Prueba") => {
    resetProductRequestLimits();
    return ess.m("a", "crm.leads.submitTestRequest", { experienceId: ids.exp, editionId: ids.edition, variantId, seats: 1, lang: "de", name, email }, adm);
  };
  const enrollmentOf = async (leadId: number) => (await sql("SELECT * FROM edition_enrollments WHERE lead_id = ? ORDER BY id", [leadId]))[0];
  const quoteFor = async (enrollmentId: number) => ok(await ess.m("a", "products.editions.prepareQuote", { enrollmentId }, adm), "presupuesto").quoteId as number;
  const pay = async (quoteId: number) => ok(await ess.m("a", "crm.quotes.confirmPayment", { quoteId, paymentMethod: "transferencia", paymentNote: "Transferencia verificada (prueba)" }, adm), "cobro");
  const confirm = (enrollmentId: number, reason?: string) => ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId, status: "confirmada", ...(reason ? { reason } : {}) }, adm);
  const learning = async (email: string) => sql("SELECT le.id, le.status, le.source, le.variant_id, le.payment_ref, le.payment_amount_cents FROM learning_enrollments le JOIN users u ON u.id = le.user_id WHERE u.email = ?", [email]);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsflow");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm), "lugar");
    const cat = (await sql("SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await sql("SELECT id FROM locations LIMIT 1"))[0].id;
    ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, offerMode: "priced_request", slug: `reconnect-${TAG}`, title: "Reconnect", basePrice: "555.00" }, adm), "producto");
    ids.exp = (await sql("SELECT id FROM experiences WHERE slug = ?", [`reconnect-${TAG}`]))[0].id;
    for (const [name, price] of [["LIVE", "111.00"], ["+ MÓDULO 1", "199.00"], ["ONLINE COMPLETO", "333.00"]]) ok(await ess.m("a", "products.createVariant", { experienceId: ids.exp, name, priceModifier: price, priceType: "fixed" }, adm), name);
    const vs = await sql("SELECT id, name FROM experience_variants WHERE experienceId = ?", [ids.exp]);
    ids.vLive = vs.find((v) => v.name === "LIVE").id;
    ids.vM1 = vs.find((v) => v.name === "+ MÓDULO 1").id;
    ids.vOnline = vs.find((v) => v.name === "ONLINE COMPLETO").id;
    ids.edition = ok(await ess.m("a", "products.editions.create", { experienceId: ids.exp, form: { label: "Grupo", startsLocal: `${addDaysToDate(today(), 7)}T10:00`, endsLocal: null, timezone: "Europe/Madrid", scheduleNote: "", mode: "online", locationNote: "", capacity: 20, showAvailability: false, status: "open", priceOverride: null } }, adm), "convocatoria").id;
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
    const rule = (variantId: number, mods: number[]) => ess.m("a", "learning.admin.saveRule", { experienceId: ids.exp, variantId, courseId: ids.course, moduleIds: mods, durationDays: 90, startMode: "on_grant", fixedStart: null, active: true }, adm);
    ok(await rule(ids.vM1, [ids.m1]), "regla +M1");
    ok(await rule(ids.vOnline, [ids.m1, ids.m2, ids.m3]), "regla ONLINE");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("solicitud, presupuesto sin cobrar y confirmación sin pago (con motivo) NO abren la formación", async () => {
    const email = mail("sinpago");
    const r = ok(await request(email, ids.vOnline), "solicitud");
    const e = await enrollmentOf(r.leadId);
    expect(await learning(email)).toEqual([]); // solicitud: nada
    await quoteFor(e.id);
    expect(await learning(email)).toEqual([]); // presupuesto creado: nada
    ok(await confirm(e.id, "Acuerdo de pago aplazado con Indira (prueba)"), "confirmar sin pago");
    expect(await learning(email)).toEqual([]); // confirmada sin cobro: nada
    const g = ok(await ess.m("a", "learning.admin.grantForEnrollment", { enrollmentId: e.id }, adm), "liberar sin cobro");
    expect(g).toMatchObject({ status: "skipped", reason: "payment_not_confirmed" });
    expect(await sql("SELECT id FROM users WHERE email = ?", [email])).toEqual([]); // ni siquiera se crea la cuenta
  });

  it("cobro confirmado después de confirmar la plaza: «Liberar acceso» crea matrícula y cuenta; repetirlo no duplica", async () => {
    const email = mail("despues");
    const r = ok(await request(email, ids.vOnline, "Alumna Después"), "solicitud");
    const e = await enrollmentOf(r.leadId);
    const q = await quoteFor(e.id);
    ok(await confirm(e.id, "Confirmada antes del cobro (prueba)"), "confirmar");
    await pay(q);
    const g1 = ok(await ess.m("a", "learning.admin.grantForEnrollment", { enrollmentId: e.id }, adm), "liberar");
    expect(g1).toMatchObject({ status: "granted", created: 1, existing: 0, accountCreated: true, invitationSent: false, invitePending: true });
    const g2 = ok(await ess.m("a", "learning.admin.grantForEnrollment", { enrollmentId: e.id }, adm), "repetir");
    expect(g2).toMatchObject({ status: "granted", created: 0, existing: 1 });
    const rows = await learning(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", source: "payment", variant_id: ids.vOnline, payment_amount_cents: 33300 });
    expect(String(rows[0].payment_ref)).toMatch(/\S/);
    expect(ess.mails.filter((m) => m.to.some((t) => t.email === email) && m.htmlContent.includes("/mi-formacion/activar"))).toEqual([]); // la invitación no sale sola
  });

  it("cobrado y confirmado: la matrícula se abre sola; el alumno activa su cuenta con la invitación de un solo uso y ve solo lo contratado", async () => {
    const email = mail("auto");
    const r = ok(await request(email, ids.vM1, "Alumna Auto"), "solicitud");
    const e = await enrollmentOf(r.leadId);
    await pay(await quoteFor(e.id));
    expect(await learning(email)).toEqual([]); // cobrada pero sin confirmar la plaza: aún nada
    ok(await confirm(e.id), "confirmar con cobro");
    const rows = await learning(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].variant_id).toBe(ids.vM1);
    const [u] = await sql("SELECT id FROM users WHERE email = ?", [email]);
    // El token no se guarda en claro: la persona lo recibe por correo (acción expresa de la administración) y solo sirve una vez
    expect(ok(await ess.m("a", "learning.admin.sendInvite", { userId: u.id }, adm), "invitar")).toMatchObject({ sent: true });
    const token = /token=([A-Za-z0-9%_.-]+)/.exec(ess.mails.filter((m) => m.to.some((x) => x.email === email)).pop()!.htmlContent)![1];
    const act = await ess.m("a", "public.setPassword", { token: decodeURIComponent(token), password: NEW_PW });
    expect(act.status, JSON.stringify(act.json)).toBe(200);
    expect((await ess.m("a", "public.setPassword", { token: decodeURIComponent(token), password: OTHER_PW })).status).not.toBe(200); // un solo uso
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: NEW_PW } });
    expect(login.status, login.text).toBe(200);
    const cookie = login.cookie!;
    const mine = ok(await ess.q("a", "learning.my.courses", undefined, cookie), "mis cursos");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "active", moduleIds: [ids.m1], totalLessons: 1 });
    const outline = ok(await ess.q("a", "learning.my.course", { courseId: ids.course }, cookie), "índice");
    expect(outline.modules.map((m: any) => m.unlocked)).toEqual([true, false, false]);
    expect(errCode(await ess.q("a", "learning.my.lesson", { lessonId: ids.l1 + 1 }, cookie))).toBe("FORBIDDEN"); // módulo 2
  });

  it("RECONNECT LIVE (sin regla) cobrado y confirmado: no hay matrícula", async () => {
    const email = mail("live");
    const r = ok(await request(email, ids.vLive, "Alumna Live"), "solicitud");
    const e = await enrollmentOf(r.leadId);
    await pay(await quoteFor(e.id));
    ok(await confirm(e.id), "confirmar");
    expect(await learning(email)).toEqual([]);
    expect(ok(await ess.m("a", "learning.admin.grantForEnrollment", { enrollmentId: e.id }, adm), "liberar")).toMatchObject({ status: "skipped", reason: "no_rule" });
  });

  it("la invitación solo se envía por acción expresa de la administración", async () => {
    const email = mail("auto");
    const [u] = await sql("SELECT id FROM users WHERE email = ?", [email]);
    const alreadyActive = ok(await ess.m("a", "learning.admin.sendInvite", { userId: u.id }, adm), "invitar");
    expect(alreadyActive).toMatchObject({ sent: false, reason: "already_active" }); // ya activó su cuenta: no se reenvía
    const [d] = await sql("SELECT id FROM users WHERE email = ?", [mail("despues")]);
    const sent = ok(await ess.m("a", "learning.admin.sendInvite", { userId: d.id }, adm), "invitar pendiente");
    expect(sent.sent).toBe(true);
    // (la confirmación de la plaza tiene su propio aviso: aquí solo cuentan las invitaciones al aula)
    const out = ess.mails.filter((m) => m.to.some((t) => t.email === mail("despues")) && m.htmlContent.includes("/mi-formacion/activar?token="));
    expect(out).toHaveLength(1);
  });
  it("demostración por correo: cuenta sin correo, 60 minutos, un solo disparador, y el panel lista cursos y recursos pendientes", async () => {
    const email = mail("taller");
    const before = ess.mails.length;
    const a = ok(await ess.m("a", "learning.admin.grantDemoByEmail", { email, name: "Participante Taller", courseId: ids.course, moduleIds: [ids.m1], trigger: `taller-${TAG}` }, adm), "demo");
    expect(a).toMatchObject({ created: true, accountCreated: true, invitePending: true });
    expect(a.enrollment.source).toBe("demo");
    expect(a.enrollment.endsAt - a.enrollment.startsAt).toBe(60 * 60_000);
    expect(ess.mails.length).toBe(before); // no se envía nada
    const b = ok(await ess.m("a", "learning.admin.grantDemoByEmail", { email, name: "Participante Taller", courseId: ids.course, moduleIds: [ids.m1], trigger: `taller-${TAG}` }, adm), "repetida");
    expect(b.created).toBe(false);
    expect(await learning(email)).toHaveLength(1);
    const courses = ok(await ess.q("a", "learning.admin.courses", undefined, adm), "cursos");
    expect(courses.find((c: any) => c.id === ids.course)).toMatchObject({ status: "published", modules: expect.any(Array), coverage: { files: { verified: 0, pending: 0 } } });
    expect(errCode(await ess.q("a", "learning.admin.courses", undefined, await ess.login("a", "user")))).toBe("FORBIDDEN"); // un alumno no administra
  });
});
