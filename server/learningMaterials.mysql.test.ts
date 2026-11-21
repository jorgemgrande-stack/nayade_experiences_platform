/**
 * Elephant Learning · materiales (lote 2), con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas. Sin cobros, sin correos, sin ventas.
 *
 *  - Subir deja el fichero pendiente: los alumnos siguen recibiendo el vigente.
 *  - Publicar sustituye conservando id, progreso, matrícula y el fichero anterior; recuperar vuelve al anterior.
 *  - Validación (tipo, cuota), permisos y aislamiento entre empresas.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });

const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${marker}`, "latin1");
const multipart = (name: string, type: string, body: Buffer) => {
  const b = `----mat${crypto.randomBytes(6).toString("hex")}`;
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`;
  const raw = Buffer.concat([Buffer.from(head), body, Buffer.from(`\r\n--${b}--\r\n`)]).toString("latin1");
  return { raw, headers: { "content-type": `multipart/form-data; boundary=${b}` } };
};

describe.skipIf(!URL_)("Materiales: subir, sustituir y recuperar sin tocar lo de los alumnos", () => {
  let ess: EssentialApp;
  let adm = "";
  let stu = "";
  let admB = "";
  let studentId = 0;
  const k = { course: 0, mod: 0, lesson: 0, block: 0, res: 0, vid: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const stage = (rid: number, cookie: string, name: string, type: string, body: Buffer, co: "a" | "b" = "a") => ess.call(co, "POST", `/api/learning/materials/${rid}/stage`, { cookie, ...multipart(name, type, body) });
  const studentGet = () => ess.call("a", "GET", `/api/learning/resource/${k.res}`, { cookie: stu });
  const list = async () => ok(await ess.q("a", "learning.admin.materials.list", undefined, adm), "lista");
  const mine = async () => (await list()).find((x: any) => x.resourceId === k.res); // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsmat");
    await ess.grantQuotaException("a", "learning_storage_gb", 25);
    adm = await ess.login("a", "admin");
    stu = await ess.login("a", "user");
    admB = await ess.login("b", "admin");
    studentId = await ess.userId("a", "user");
    const now = Date.now();
    const ins = async (q: string, p: unknown[], find: [string, unknown[]]) => { await sql(q, p); return Number((await sql(find[0], find[1]))[0].id); };
    k.course = await ins("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('mat-curso','Curso materiales','de','published',?,?)", [now, now], ["SELECT id FROM learning_courses WHERE slug = 'mat-curso'", []]);
    k.mod = await ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.course, 1, "Modul 1", "mm1", now, now], ["SELECT id FROM learning_modules WHERE source_key = 'mm1'", []]);
    k.lesson = await ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.mod, 1, "Lektion 1", "ml1", now, now], ["SELECT id FROM learning_lessons WHERE source_key = 'ml1'", []]);
    k.res = await ins("INSERT INTO learning_resources (kind, original_name, status, created_at, updated_at) VALUES ('pdf','guia.pdf','pending',?,?)", [now, now], ["SELECT id FROM learning_resources WHERE original_name = 'guia.pdf'", []]);
    k.vid = await ins("INSERT INTO learning_resources (kind, original_name, status, created_at, updated_at) VALUES ('video','clase.mp4','pending',?,?)", [now, now], ["SELECT id FROM learning_resources WHERE original_name = 'clase.mp4'", []]);
    k.block = await ins("INSERT INTO learning_blocks (lesson_id, position, kind, title, resource_id, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [k.lesson, 1, "pdf", "Guía", k.res, "mb1", now, now], ["SELECT id FROM learning_blocks WHERE source_key = 'mb1'", []]);
    // Fichero inicial por la vía de siempre (importación) y una persona cursando con progreso
    const first = multipart("guia.pdf", "application/pdf", pdf("ORIGINAL"));
    expect((await ess.call("a", "POST", `/api/learning/upload/${k.res}`, { cookie: adm, ...first })).status).toBe(200);
    ok(await ess.m("a", "learning.admin.grant", { userId: studentId, courseId: k.course, moduleIds: [k.mod], durationDays: 30, reason: "Alumna en curso para la prueba", nonce: `mt${Date.now()}abcd` }, adm), "matrícula");
    await sql("INSERT INTO learning_progress (user_id, lesson_id, status, last_block_id, completed_at, updated_at) VALUES (?,?,?,?,?,?)", [studentId, k.lesson, "in_progress", k.block, null, now]);
  }, 300_000);

  afterAll(async () => { await ess?.close(); });

  it("el alumno recibe el fichero vigente", async () => {
    const r = await studentGet();
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain("ORIGINAL");
  });

  it("subir deja el fichero pendiente y NO cambia lo que reciben los alumnos", async () => {
    const r = await stage(k.res, adm, "guia-v2.pdf", "application/pdf", pdf("NUEVO"));
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ ok: true, contentType: "application/pdf" });
    expect((await studentGet()).text).toContain("ORIGINAL");
    const m = await mine();
    expect(m.staged).toMatchObject({ status: "staged", originalName: "guia-v2.pdf" });
    expect(m.uses[0]).toMatchObject({ courseTitle: "Curso materiales", lessonTitle: "Lektion 1" });
    expect(m.originalName).toBe("guia.pdf");
  });

  it("vista previa del pendiente: solo administración, auditada", async () => {
    const fileId = (await mine()).staged.id;
    const url = `/api/learning/preview/file/${fileId}`;
    expect((await ess.call("a", "GET", url, { cookie: "" })).status).toBe(401);
    expect((await ess.call("a", "GET", url, { cookie: stu })).status).toBe(403);
    const r = await ess.call("a", "GET", url, { cookie: adm });
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain("NUEVO");
    expect(Number((await sql("SELECT COUNT(*) AS c FROM learning_access_events WHERE enrollment_id = 0 AND type = 'admin_preview_resource'"))[0].c)).toBeGreaterThan(0);
  });

  it("publicar sustituye conservando id, bloque, progreso y matrícula; el anterior queda guardado", async () => {
    const before = { progress: await sql("SELECT status, last_block_id FROM learning_progress WHERE user_id = ?", [studentId]), enr: await sql("SELECT id, status FROM learning_enrollments WHERE user_id = ?", [studentId]) };
    const fileId = (await mine()).staged.id;
    expect((await ess.m("a", "learning.admin.materials.publish", { resourceId: k.res, fileId }, stu)).status).toBe(403);
    ok(await ess.m("a", "learning.admin.materials.publish", { resourceId: k.res, fileId }, adm), "publicar");
    expect((await studentGet()).text).toContain("NUEVO");
    const m = await mine();
    expect(m.staged).toBeNull();
    expect(m.resourceId).toBe(k.res);
    expect(m.history.map((h: any) => h.status).sort()).toEqual(["active", "replaced"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number((await sql("SELECT resource_id AS r FROM learning_blocks WHERE id = ?", [k.block]))[0].r)).toBe(k.res);
    expect(await sql("SELECT status, last_block_id FROM learning_progress WHERE user_id = ?", [studentId])).toEqual(before.progress);
    expect(await sql("SELECT id, status FROM learning_enrollments WHERE user_id = ?", [studentId])).toEqual(before.enr);
    // el objeto anterior sigue en el almacén y referenciado
    const oldObj = m.history.find((h: any) => h.status === "replaced").objectId; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number((await sql("SELECT COUNT(*) AS c FROM stored_objects WHERE object_id = ? AND status = 'active'", [oldObj]))[0].c)).toBe(1);
  });

  it("publicar dos veces es idempotente", async () => {
    const m = await mine();
    const active = (await sql("SELECT id FROM learning_resource_files WHERE resource_id = ? AND status = 'active'", [k.res]))[0].id;
    const r = ok(await ess.m("a", "learning.admin.materials.publish", { resourceId: k.res, fileId: active }, adm), "repetir");
    expect(r.changed).toBe(false);
    expect((await mine()).history.length).toBe(m.history.length);
  });

  it("recuperar el anterior vuelve a servirlo y conserva el que se retira", async () => {
    const old = (await mine()).history.find((h: any) => h.status === "replaced"); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(await ess.m("a", "learning.admin.materials.restore", { resourceId: k.res, fileId: old.id }, adm), "recuperar");
    expect((await studentGet()).text).toContain("ORIGINAL");
    const h = (await mine()).history;
    expect(h.map((x: any) => x.status).sort()).toEqual(["active", "replaced"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("descartar un pendiente quita solo la fila", async () => {
    expect((await stage(k.res, adm, "otra.pdf", "application/pdf", pdf("OTRA"))).status).toBe(200);
    expect((await mine()).staged).not.toBeNull();
    expect(ok(await ess.m("a", "learning.admin.materials.discard", { resourceId: k.res }, adm), "descartar").discarded).toBe(true);
    expect((await mine()).staged).toBeNull();
    expect((await studentGet()).text).toContain("ORIGINAL");
  });

  it("valida tipo y permisos: un PDF no sirve para un vídeo; alumno 403; sin sesión 401; recurso inexistente 404", async () => {
    const r = await stage(k.vid, adm, "x.pdf", "application/pdf", pdf("X"));
    expect(r.status).toBe(400);
    expect(r.json.problem ?? r.json.error).toBeTruthy();
    expect((await stage(k.res, stu, "x.pdf", "application/pdf", pdf("X"))).status).toBe(403);
    expect((await stage(k.res, "", "x.pdf", "application/pdf", pdf("X"))).status).toBe(401);
    expect((await stage(999999, adm, "x.pdf", "application/pdf", pdf("X"))).status).toBe(404);
    expect((await mine()).staged).toBeNull();
  });

  it("sin cuota de formación concedida no se sube nada (otra empresa) y no ve los recursos de la primera", async () => {
    const r = await stage(k.res, admB, "x.pdf", "application/pdf", pdf("B"), "b");
    expect([404, 409]).toContain(r.status);
    const lb = ok(await ess.q("b", "learning.admin.materials.list", undefined, admB), "lista B");
    expect(lb.find((x: any) => x.resourceId === k.res && x.originalName === "guia.pdf")).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
