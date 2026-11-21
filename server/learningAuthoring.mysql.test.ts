/**
 * Elephant Learning · creación de formaciones (lote 3), con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas. Sin cobros, sin correos, sin ventas.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });

const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${marker}`, "latin1");
const multipart = (name: string, type: string, body: Buffer) => {
  const b = `----aut${crypto.randomBytes(6).toString("hex")}`;
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`;
  const raw = Buffer.concat([Buffer.from(head), body, Buffer.from(`\r\n--${b}--\r\n`)]).toString("latin1");
  return { raw, headers: { "content-type": `multipart/form-data; boundary=${b}` } };
};

describe.skipIf(!URL_)("Creación de formaciones: cursos, estructura, duplicado y archivado", () => {
  let ess: EssentialApp;
  let adm = "";
  let stu = "";
  let admB = "";
  let studentId = 0;
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const m = (proc: string, input: unknown, cookie = adm) => ess.m("a", `learning.admin.authoring.${proc}`, input, cookie);
  const outline = async (courseId: number) => ok(await ess.q("a", "learning.admin.authoring.outline", { courseId }, adm), "esquema");
  const k = { course: 0, mod: 0, lesson: 0, textBlock: 0, pdfBlock: 0, pdfRes: 0 };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsaut");
    await ess.grantQuotaException("a", "learning_storage_gb", 25);
    adm = await ess.login("a", "admin");
    stu = await ess.login("a", "user");
    admB = await ess.login("b", "admin");
    studentId = await ess.userId("a", "user");
  }, 300_000);

  afterAll(async () => { await ess?.close(); });

  it("un curso nuevo nace en borrador, con identificador único y auditado", async () => {
    const a = ok(await m("createCourse", { title: "Meditación: Sanación Interior", description: "  Curso creado por la administración  ", language: "es" }), "crear");
    expect(a.slug).toBe("meditacion-sanacion-interior");
    k.course = a.courseId;
    const b = ok(await m("createCourse", { title: "Meditación: Sanación Interior" }), "crear con el mismo título");
    expect(b.slug).toBe("meditacion-sanacion-interior-2");
    const o = await outline(k.course);
    expect(o.course).toMatchObject({ status: "draft", language: "es", description: "Curso creado por la administración" });
    expect(Number((await sql("SELECT COUNT(*) AS c FROM learning_access_events WHERE enrollment_id = 0 AND type = 'admin_course_created'"))[0].c)).toBe(2);
  });

  it("valida títulos y permisos; sin sesión 401; alumno 403", async () => {
    expect((await m("createCourse", { title: "   " })).status).toBe(400);
    expect((await m("createCourse", { title: "x" }, stu)).status).toBe(403);
    expect((await m("createCourse", { title: "x" }, "")).status).toBe(401);
  });

  it("módulos, lecciones y bloques se añaden al final y en orden", async () => {
    k.mod = ok(await m("addModule", { courseId: k.course, title: "Módulo 1" }), "módulo").moduleId;
    ok(await m("addModule", { courseId: k.course, title: "Módulo 2" }), "módulo 2");
    k.lesson = ok(await m("addLesson", { moduleId: k.mod, title: "Lección 1" }), "lección").lessonId;
    ok(await m("addLesson", { moduleId: k.mod, title: "Lección 2" }), "lección 2");
    k.textBlock = ok(await m("addBlock", { lessonId: k.lesson, kind: "text", title: "Introducción", body: "Bienvenida" }), "bloque de texto").blockId;
    const link = ok(await m("addBlock", { lessonId: k.lesson, kind: "external_link", title: "Recurso externo", externalUrl: "https://example.org/guia" }), "enlace");
    expect(link.resourceId).toBeNull();
    const o = await outline(k.course);
    expect(o.modules.map((x: any) => x.title)).toEqual(["Módulo 1", "Módulo 2"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(o.modules[0].lessons.map((x: any) => x.title)).toEqual(["Lección 1", "Lección 2"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(o.modules[0].lessons[0].blocks.map((x: any) => x.kind)).toEqual(["text", "external_link"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("enlaces inseguros y tipos no válidos se rechazan", async () => {
    expect((await m("addBlock", { lessonId: k.lesson, kind: "external_link", title: "x", externalUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await m("addBlock", { lessonId: k.lesson, kind: "external_link", title: "x", externalUrl: "http://sin-tls.example" })).status).toBe(400);
    expect((await m("addBlock", { lessonId: k.lesson, kind: "exercise", title: "x" })).status).toBe(400);
    expect((await m("addBlock", { lessonId: 999999, kind: "text", title: "x" })).status).toBe(404);
  });

  it("un bloque de PDF crea un material pendiente; se le sube un fichero y se activa por el flujo de materiales", async () => {
    const b = ok(await m("addBlock", { lessonId: k.lesson, kind: "pdf", title: "Guía de práctica" }), "bloque pdf");
    k.pdfBlock = b.blockId;
    k.pdfRes = b.resourceId;
    expect(b.resourceCreated).toBe(true);
    const up = await ess.call("a", "POST", `/api/learning/materials/${k.pdfRes}/stage`, { cookie: adm, ...multipart("guia.pdf", "application/pdf", pdf("GUIA")) });
    expect(up.status, up.text).toBe(200);
    const list = ok(await ess.q("a", "learning.admin.materials.list", undefined, adm), "materiales");
    const mine = list.find((x: any) => x.resourceId === k.pdfRes); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(mine.objectId).toBeNull();
    expect(mine.staged).not.toBeNull();
    ok(await ess.m("a", "learning.admin.materials.publish", { resourceId: k.pdfRes, fileId: mine.staged.id }, adm), "activar");
    const after = ok(await ess.q("a", "learning.admin.materials.list", undefined, adm), "materiales 2").find((x: any) => x.resourceId === k.pdfRes); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(after.status).toBe("verified");
    expect(after.history).toHaveLength(1); // solo el vigente; no había anterior
    expect(after.history[0].status).toBe("active");
  });

  it("reutilizar un material de la biblioteca NO duplica el recurso ni el fichero", async () => {
    const lesson2 = (await outline(k.course)).modules[0].lessons[1].id;
    const objectsBefore = Number((await sql("SELECT COUNT(*) AS c FROM stored_objects"))[0].c);
    const resourcesBefore = Number((await sql("SELECT COUNT(*) AS c FROM learning_resources"))[0].c);
    const b = ok(await m("addBlock", { lessonId: lesson2, kind: "pdf", title: "La misma guía", resourceId: k.pdfRes }), "reutilizar");
    expect(b.resourceId).toBe(k.pdfRes);
    expect(b.resourceCreated).toBe(false);
    expect(Number((await sql("SELECT COUNT(*) AS c FROM learning_resources"))[0].c)).toBe(resourcesBefore);
    expect(Number((await sql("SELECT COUNT(*) AS c FROM stored_objects"))[0].c)).toBe(objectsBefore);
    expect((await m("addBlock", { lessonId: lesson2, kind: "video", title: "tipo equivocado", resourceId: k.pdfRes })).status).toBe(400);
    const list = ok(await ess.q("a", "learning.admin.materials.list", undefined, adm), "materiales");
    expect(list.find((x: any) => x.resourceId === k.pdfRes).uses).toHaveLength(2); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("un curso en borrador no lo ve ningún alumno, ni siquiera con matrícula", async () => {
    ok(await ess.m("a", "learning.admin.grant", { userId: studentId, courseId: k.course, moduleIds: [k.mod], durationDays: 30, reason: "Prueba de visibilidad del borrador", nonce: `au${Date.now()}abcd` }, adm), "matrícula");
    const mine = await ess.q("a", "learning.my.courses", undefined, stu);
    expect(JSON.stringify(data(mine as any))).not.toContain("meditacion-sanacion-interior"); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("en un curso publicado no se añade estructura (se cambia por el editor)", async () => {
    ok(await ess.m("a", "learning.admin.setCourseStatus", { courseId: k.course, status: "published" }, adm), "publicar");
    const r = await m("addModule", { courseId: k.course, title: "Tarde" });
    expect(r.status).toBe(409);
    expect((await m("addLesson", { moduleId: k.mod, title: "Tarde" })).status).toBe(409);
    expect((await m("addBlock", { lessonId: k.lesson, kind: "text", title: "Tarde" })).status).toBe(409);
    ok(await ess.m("a", "learning.admin.setCourseStatus", { courseId: k.course, status: "draft" }, adm), "volver a borrador");
  });

  it("duplicar copia la estructura en un borrador nuevo y comparte los recursos sin duplicar ficheros", async () => {
    const objectsBefore = Number((await sql("SELECT COUNT(*) AS c FROM stored_objects"))[0].c);
    const resBefore = Number((await sql("SELECT COUNT(*) AS c FROM learning_resources"))[0].c);
    const d = ok(await m("duplicateCourse", { courseId: k.course }), "duplicar");
    expect(d.shared).toBe(2);
    const o = await outline(d.courseId);
    const src = await outline(k.course);
    expect(o.course.status).toBe("draft");
    expect(o.course.title).toContain("(copia)");
    expect(o.modules.map((x: any) => x.title)).toEqual(src.modules.map((x: any) => x.title)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(o.modules[0].lessons[0].blocks.map((x: any) => x.resourceId)).toEqual(src.modules[0].lessons[0].blocks.map((x: any) => x.resourceId)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number((await sql("SELECT COUNT(*) AS c FROM stored_objects"))[0].c)).toBe(objectsBefore);
    expect(Number((await sql("SELECT COUNT(*) AS c FROM learning_resources"))[0].c)).toBe(resBefore);
    // los ids son nuevos: la copia no comparte progreso ni matrículas con el original
    expect(o.modules[0].id).not.toBe(src.modules[0].id);
    expect(Number((await sql("SELECT COUNT(*) AS c FROM learning_enrollments WHERE course_id = ?", [d.courseId]))[0].c)).toBe(0);
  });

  it("archivar conserva matrículas y progreso; restaurar vuelve a borrador; archivado no admite estructura", async () => {
    const enr = Number((await sql("SELECT COUNT(*) AS c FROM learning_enrollments WHERE course_id = ?", [k.course]))[0].c);
    expect(ok(await m("archiveCourse", { courseId: k.course, archive: true }), "archivar").status).toBe("archived");
    expect(Number((await sql("SELECT COUNT(*) AS c FROM learning_enrollments WHERE course_id = ?", [k.course]))[0].c)).toBe(enr);
    expect((await m("addModule", { courseId: k.course, title: "x" })).status).toBe(409);
    expect(ok(await m("archiveCourse", { courseId: k.course, archive: false }), "restaurar").status).toBe("draft");
    expect(ok(await m("archiveCourse", { courseId: k.course, archive: false }), "restaurar otra vez").status).toBe("draft"); // idempotente
  });

  it("otra empresa no ve ni modifica el curso", async () => {
    expect((await ess.q("b", "learning.admin.authoring.outline", { courseId: k.course }, admB)).status).toBe(404);
    expect((await ess.m("b", "learning.admin.authoring.addModule", { courseId: k.course, title: "x" }, admB)).status).toBe(404);
  });
});
