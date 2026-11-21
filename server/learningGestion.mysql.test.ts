/**
 * Elephant Learning · gestión comercial y de alumnos (lote 4), con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas. Sin cobros, sin correos, sin ventas.
 *
 *  - Catálogo con nombres comerciales para configurar reglas (productos, modalidades, cursos y módulos).
 *  - Una regla nueva guardada como inactiva NO concede acceso a un pago confirmado.
 *  - Progreso de las personas matriculadas, solo lectura y aislado por empresa.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });

describe.skipIf(!URL_)("Gestión: catálogo con nombres, reglas inactivas y progreso de alumnos", () => {
  let ess: EssentialApp;
  let adm = "";
  let stu = "";
  let admB = "";
  let studentId = 0;
  const k = { course: 0, m1: 0, m2: 0, l1: 0, l2: 0, exp: 0, variant: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsges");
    adm = await ess.login("a", "admin");
    stu = await ess.login("a", "user");
    admB = await ess.login("b", "admin");
    studentId = await ess.userId("a", "user");
    const now = Date.now();
    const ins = async (q: string, p: unknown[], find: [string, unknown[]]) => { await sql(q, p); return Number((await sql(find[0], find[1]))[0].id); };
    k.exp = await ins("INSERT INTO experiences (slug, title, categoryId, locationId, basePrice) VALUES ('formacion-test','Formación online de prueba',1,1,10.00)", [], ["SELECT id FROM experiences WHERE slug = 'formacion-test'", []]);
    k.variant = await ins("INSERT INTO experience_variants (experienceId, name) VALUES (?,?)", [k.exp, "Acceso anual"], ["SELECT id FROM experience_variants WHERE experienceId = ? AND name = 'Acceso anual'", [k.exp]]);
    k.course = await ins("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('gestion-curso','Curso de gestión','de','published',?,?)", [now, now], ["SELECT id FROM learning_courses WHERE slug = 'gestion-curso'", []]);
    k.m1 = await ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.course, 1, "Teil 1", "gm1", now, now], ["SELECT id FROM learning_modules WHERE source_key = 'gm1'", []]);
    k.m2 = await ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.course, 2, "Teil 2", "gm2", now, now], ["SELECT id FROM learning_modules WHERE source_key = 'gm2'", []]);
    k.l1 = await ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.m1, 1, "Lektion 1", "gl1", now, now], ["SELECT id FROM learning_lessons WHERE source_key = 'gl1'", []]);
    k.l2 = await ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.m2, 1, "Lektion 2", "gl2", now, now], ["SELECT id FROM learning_lessons WHERE source_key = 'gl2'", []]);
    ok(await ess.m("a", "learning.admin.grant", { userId: studentId, courseId: k.course, moduleIds: [k.m1, k.m2], durationDays: 30, reason: "Alumna en curso para la prueba", nonce: `ge${Date.now()}abcd` }, adm), "matrícula");
    await sql("INSERT INTO learning_progress (user_id, lesson_id, status, last_block_id, completed_at, updated_at) VALUES (?,?,?,?,?,?)", [studentId, k.l1, "completed", null, now, now]);
    await sql("INSERT INTO learning_progress (user_id, lesson_id, status, last_block_id, completed_at, updated_at) VALUES (?,?,?,?,?,?)", [studentId, k.l2, "in_progress", null, null, now]);
  }, 300_000);

  afterAll(async () => { await ess?.close(); });

  it("el catálogo ofrece nombres comerciales: productos con modalidades, cursos con módulos", async () => {
    const c = ok(await ess.q("a", "learning.admin.catalog", undefined, adm), "catálogo");
    const e = c.experiences.find((x: any) => x.id === k.exp); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(e).toMatchObject({ title: "Formación online de prueba", variants: [{ id: k.variant, name: "Acceso anual" }] });
    const course = c.courses.find((x: any) => x.id === k.course); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(course.modules.map((m: any) => m.title)).toEqual(["Teil 1", "Teil 2"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("una regla nueva guardada como inactiva se muestra con nombres y no concede acceso a un pago", async () => {
    const id = ok(await ess.m("a", "learning.admin.saveRule", { experienceId: k.exp, variantId: k.variant, courseId: k.course, moduleIds: [k.m1], durationDays: 365, startMode: "on_grant", fixedStart: null, active: false }, adm), "guardar").id;
    const list = ok(await ess.q("a", "learning.admin.rules", undefined, adm), "reglas");
    const r = list.find((x: any) => x.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r).toMatchObject({ active: false, experienceName: "Formación online de prueba", variantName: "Acceso anual", courseTitle: "Curso de gestión", moduleTitles: ["Teil 1"], courseId: k.course });
    // activar y volver a desactivar no cambia nada más (misma forma): se actualiza la misma regla
    const same = ok(await ess.m("a", "learning.admin.saveRule", { id, experienceId: k.exp, variantId: k.variant, courseId: k.course, moduleIds: [k.m1], durationDays: 365, startMode: "on_grant", fixedStart: null, active: false }, adm), "repetir").id;
    expect(same).toBe(id);
  });

  it("el progreso muestra lecciones completadas, en curso y última actividad", async () => {
    const p = ok(await ess.q("a", "learning.admin.progress", { courseId: k.course }, adm), "progreso");
    expect(p.lessonsTotal).toBe(2);
    expect(p.learners).toHaveLength(1);
    expect(p.learners[0]).toMatchObject({ userId: studentId, completed: 1, inProgress: 1, status: "active" });
    expect(p.learners[0].lastActivity).toBeGreaterThan(0);
  });

  it("solo la administración: alumno 403, sin sesión 401", async () => {
    for (const proc of ["learning.admin.catalog"]) {
      expect((await ess.q("a", proc, undefined, stu)).status).toBe(403);
      expect((await ess.q("a", proc, undefined, "")).status).toBe(401);
    }
    expect((await ess.q("a", "learning.admin.progress", { courseId: k.course }, stu)).status).toBe(403);
  });

  it("otra empresa no ve el curso ni el progreso de la primera", async () => {
    const c = ok(await ess.q("b", "learning.admin.catalog", undefined, admB), "catálogo B");
    expect(c.courses.find((x: any) => x.title === "Curso de gestión")).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = ok(await ess.q("b", "learning.admin.progress", { courseId: k.course }, admB), "progreso B");
    expect(p.learners).toEqual([]);
    expect(p.lessonsTotal).toBe(0);
  });
});
