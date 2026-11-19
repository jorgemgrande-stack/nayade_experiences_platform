/**
 * Elephant LMS: curso en borrador + matrícula técnica + vista previa de administración, con la aplicación real sobre MySQL
 * (opt-in, REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas. Sin cobros, sin correos, sin matrículas comerciales.
 *
 *  - Un curso en BORRADOR no lo abre nadie, ni con matrícula administrativa corriente ni de pago: solo la matrícula técnica
 *    («[PRUEBA TÉCNICA]», caducidad forzosa de un día) y la vista previa de administración.
 *  - La vista previa exige administrador, está limitada a la empresa en curso, no toca progreso y deja auditoría.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { TECHNICAL_PREFIX } from "../shared/learning";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const DAY = 86_400_000;

describe.skipIf(!URL_)("LMS: borrador + matrícula técnica + vista previa de administración", () => {
  let ess: EssentialApp;
  let adm = "";
  let stu = "";
  let stu2 = "";
  let admB = "";
  const u = { s1: 0, s2: 0 };
  let dir = "";
  const k = { course: 0, m1: 0, m2: 0, l1: 0, l2: 0, pdf1: 0, pdf2: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const get = (rid: number, cookie: string, base = "resource") => ess.call("a", "GET", `/api/learning/${base}/${rid}`, { cookie });

  beforeAll(async () => {
    const os = await import("node:os");
    const fsm = await import("node:fs");
    const pathm = await import("node:path");
    const crypto = await import("node:crypto");
    dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), "lms-prev-"));
    process.env.LOCAL_STORAGE_PATH = dir;
    process.env.STORAGE_OBJECTS = "on";
    for (const key of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "STORAGE_PRIVATE_DELIVERY"]) delete process.env[key];
    (await import("./_core/files/backend")).resetBackendCache();
    (await import("./_core/files/service")).setFileServiceForTests(null);

    ess = await startEssentialApp(URL_!, "lmsprev");
    adm = await ess.login("a", "admin");
    stu = await ess.login("a", "user");
    stu2 = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    u.s1 = await ess.userId("a", "user");
    u.s2 = await ess.userId("a", "agente");

    const now = Date.now();
    const ins = async (q: string, p: unknown[], find: [string, unknown[]]) => {
      await ess.sql("a", q, p);
      return Number((await ess.sql("a", find[0], find[1]))[0].id);
    };
    // Curso en BORRADOR (nunca se publica en esta suite)
    k.course = await ins("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('borrador-prev','Curso en borrador','de','draft',?,?)", [now, now], ["SELECT id FROM learning_courses WHERE slug = 'borrador-prev'", []]);
    const mk = async (pos: number) => {
      const m = await ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.course, pos, `TEIL ${pos}`, `pm${pos}`, now, now], ["SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [k.course, `pm${pos}`]]);
      const l = await ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [m, 1, `Lektion ${pos}`, `pl${pos}`, now, now], ["SELECT id FROM learning_lessons WHERE module_id = ? AND source_key = ?", [m, `pl${pos}`]]);
      await ess.sql("a", "INSERT INTO learning_resources (kind, original_name, status, created_at, updated_at) VALUES ('pdf', ?, 'pending', ?, ?)", [`prev${pos}-${now}.pdf`, now, now]);
      const rid = Number((await ess.sql("a", "SELECT id FROM learning_resources WHERE original_name = ?", [`prev${pos}-${now}.pdf`]))[0].id);
      await ess.sql("a", "INSERT INTO learning_blocks (lesson_id, position, kind, title, resource_id, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [l, 1, "pdf", `Documento ${pos}`, rid, `pb${pos}`, now, now]);
      return { m, l, rid };
    };
    const a = await mk(1);
    const b = await mk(2);
    Object.assign(k, { m1: a.m, l1: a.l, pdf1: a.rid, m2: b.m, l2: b.l, pdf2: b.rid });
    // Subida real de dos PDF distintos (administración)
    const multipart = (name: string, body: Buffer) => {
      const bd = `----prev${crypto.randomBytes(6).toString("hex")}`;
      const head = `--${bd}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`;
      const raw = Buffer.concat([Buffer.from(head), body, Buffer.from(`\r\n--${bd}--\r\n`)]).toString("latin1");
      return { raw, headers: { "content-type": `multipart/form-data; boundary=${bd}` } };
    };
    for (const [rid, n] of [[k.pdf1, 1], [k.pdf2, 2]] as const) {
      const body = Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${n}-${crypto.randomBytes(8).toString("hex")}`, "latin1");
      const r = await ess.call("a", "POST", `/api/learning/upload/${rid}`, { cookie: adm, ...multipart(`d${n}.pdf`, body) });
      expect(r.status, r.text).toBe(200);
    }
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
    if (dir) (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
  });

  it("un curso en borrador no se abre con una concesión administrativa corriente", async () => {
    ok(await ess.m("a", "learning.admin.grant", { userId: u.s2, courseId: k.course, moduleIds: [k.m1], durationDays: 30, reason: "Concesión corriente con motivo", nonce: `n${Date.now()}abcd` }, adm), "concesión corriente");
    expect(errCode(await ess.q("a", "learning.my.course", { courseId: k.course }, stu2))).toBe("NOT_FOUND"); // un borrador no existe para ellos
    expect(errCode(await ess.q("a", "learning.my.lesson", { lessonId: k.l1 }, stu2))).toBe("FORBIDDEN");
    expect(ok(await ess.q("a", "learning.my.courses", undefined, stu2), "mis cursos")).toEqual([]);
    expect((await get(k.pdf1, stu2)).status).toBe(403);
  });

  it("matrícula técnica: abre el módulo 1 del borrador, no el 2; caduca en un día; sin correo ni invitación", async () => {
    const email = String((await sql("SELECT email FROM users WHERE id = ?", [u.s1]))[0].email);
    const before = await sql("SELECT COUNT(*) AS n FROM learning_access_events");
    const g = ok(await ess.m("a", "learning.admin.grantTechnical", { email, name: "Alumno técnico", courseId: k.course, moduleIds: [k.m1], note: "prueba de integración" }, adm), "matrícula técnica");
    expect(g.created).toBe(true);
    expect(g.invitePending).toBe(false); // cuenta con contraseña: no hay invitación que enviar
    const [row] = await sql("SELECT source, grant_reason, starts_at, ends_at FROM learning_enrollments WHERE user_id = ? AND course_id = ?", [u.s1, k.course]);
    expect(row.source).toBe("admin");
    expect(String(row.grant_reason).startsWith(TECHNICAL_PREFIX)).toBe(true);
    expect(Number(row.ends_at) - Number(row.starts_at)).toBe(DAY); // caducidad forzosa de un día
    expect(Number((await sql("SELECT COUNT(*) AS n FROM learning_access_events"))[0].n)).toBeGreaterThanOrEqual(Number(before[0].n));

    const course = ok(await ess.q("a", "learning.my.course", { courseId: k.course }, stu), "curso del alumno técnico");
    expect(course.modules.map((m: any) => m.unlocked)).toEqual([true, false]);
    ok(await ess.q("a", "learning.my.lesson", { lessonId: k.l1 }, stu), "lección 1");
    expect(errCode(await ess.q("a", "learning.my.lesson", { lessonId: k.l2 }, stu))).toBe("FORBIDDEN");
    expect(ok(await ess.q("a", "learning.my.courses", undefined, stu), "mis cursos").map((c: any) => c.courseId)).toEqual([k.course]);
    // Reproducción/entrega real desde el almacén privado, solo del módulo concedido
    const r1 = await get(k.pdf1, stu);
    expect(r1.status, r1.text).toBe(200);
    expect(String(r1.headers?.["cache-control"])).toContain("no-store");
    expect(String(r1.headers?.["content-type"])).toContain("application/pdf");
    expect((await get(k.pdf2, stu)).status).toBe(403);
    expect((await get(k.pdf1, "")).status).toBe(401);
    expect((await get(k.pdf1, stu2)).status).toBe(403); // otra identidad (con concesión corriente, no técnica)
    // El curso sigue siendo privado: nadie más lo ve y el estado no cambió
    expect((await sql("SELECT status FROM learning_courses WHERE id = ?", [k.course]))[0].status).toBe("draft");
  });

  it("revocar y caducar cortan la matrícula técnica al instante", async () => {
    const [e] = await sql("SELECT id FROM learning_enrollments WHERE user_id = ? AND course_id = ?", [u.s1, k.course]);
    // Caducidad (se evalúa al leer)
    await sql("UPDATE learning_enrollments SET ends_at = ? WHERE id = ?", [Date.now() - 1000, e.id]);
    expect((await get(k.pdf1, stu)).status).toBe(403);
    expect(errCode(await ess.q("a", "learning.my.lesson", { lessonId: k.l1 }, stu))).toBe("FORBIDDEN");
    // Prórroga auditada + revocación con motivo
    ok(await ess.m("a", "learning.admin.extend", { enrollmentId: Number(e.id), newEndsAt: Date.now() + DAY, reason: "Prórroga de la prueba técnica" }, adm), "prórroga");
    expect((await get(k.pdf1, stu)).status).toBe(200);
    ok(await ess.m("a", "learning.admin.revoke", { enrollmentId: Number(e.id), reason: "Fin de la prueba técnica" }, adm), "revocación");
    expect((await get(k.pdf1, stu)).status).toBe(403);
    // Revocada: sigue en su lista (con estado «revoked»), pero sin acceso a nada
    expect(ok(await ess.q("a", "learning.my.courses", undefined, stu), "mis cursos tras revocar").map((c: any) => c.status)).toEqual(["revoked"]);
    expect(errCode(await ess.q("a", "learning.my.lesson", { lessonId: k.l1 }, stu))).toBe("FORBIDDEN");
  });

  it("vista previa: solo administradores, sin progreso, auditada y sin matrícula", async () => {
    const enrollmentsBefore = Number((await sql("SELECT COUNT(*) AS n FROM learning_enrollments"))[0].n);
    const progressBefore = Number((await sql("SELECT COUNT(*) AS n FROM learning_progress"))[0].n);
    // Sin sesión: 401; alumno: no autorizado; otro rol no admin: no autorizado
    expect((await ess.q("a", "learning.admin.previewCourse", { courseId: k.course })).status).toBe(401);
    expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.q("a", "learning.admin.previewCourse", { courseId: k.course }, stu)));
    expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.q("a", "learning.admin.previewLesson", { lessonId: k.l1 }, stu2)));
    // Administrador: todo abierto, aunque el curso esté en borrador
    const idx = ok(await ess.q("a", "learning.admin.previewCourse", { courseId: k.course }, adm), "índice de vista previa");
    expect(idx.course.status).toBe("draft");
    expect(idx.modules.map((m: any) => m.unlocked)).toEqual([true, true]);
    expect(idx.modules.flatMap((m: any) => m.lessons.map((l: any) => l.completed))).toEqual([false, false]);
    const les = ok(await ess.q("a", "learning.admin.previewLesson", { lessonId: k.l2 }, adm), "lección en vista previa");
    expect(les.blocks[0].resourceId).toBe(k.pdf2);
    // El recurso se entrega por la ruta de vista previa (admin), no por la del alumno
    expect((await get(k.pdf2, "", "preview/resource")).status).toBe(401);
    expect((await get(k.pdf2, stu, "preview/resource")).status).toBe(403);
    const p = await get(k.pdf2, adm, "preview/resource");
    expect(p.status, p.text).toBe(200);
    expect(String(p.headers?.["cache-control"])).toContain("no-store");
    expect(String(p.headers?.["content-type"])).toContain("application/pdf");
    expect((await get(999999, adm, "preview/resource")).status).toBe(404);
    expect((await get(k.pdf2, adm)).status).toBe(403); // la ruta del alumno NO se abre por ser administrador
    // Auditoría de cada acceso; ni matrículas ni progreso nuevos
    const audit = await sql("SELECT type, actor_user_id FROM learning_access_events WHERE enrollment_id = 0 AND type LIKE 'admin_preview_%'");
    expect(audit.map((r: any) => r.type).sort()).toEqual(expect.arrayContaining(["admin_preview_course", "admin_preview_lesson", "admin_preview_resource"]));
    expect(ok(await ess.q("a", "learning.admin.previewAccess", undefined, adm), "listado de auditoría").length).toBeGreaterThanOrEqual(3);
    expect(Number((await sql("SELECT COUNT(*) AS n FROM learning_enrollments"))[0].n)).toBe(enrollmentsBefore);
    expect(Number((await sql("SELECT COUNT(*) AS n FROM learning_progress"))[0].n)).toBe(progressBefore);
  });

  it("aislamiento: la administración de otra empresa no ve este curso ni sus recursos, y el alumno de A no ve nada de B", async () => {
    expect(errCode(await ess.q("b", "learning.admin.previewCourse", { courseId: k.course }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.q("b", "learning.admin.previewLesson", { lessonId: k.l1 }, admB))).toBe("NOT_FOUND");
    expect((await ess.call("b", "GET", `/api/learning/preview/resource/${k.pdf1}`, { cookie: admB })).status).toBe(404);
    expect((await ess.call("b", "GET", `/api/learning/resource/${k.pdf1}`, { cookie: admB })).status).toBe(404);
    // La sesión de A no sirve en B
    expect((await ess.call("b", "GET", `/api/learning/preview/resource/${k.pdf1}`, { cookie: adm })).status).toBe(401);
  });
});
