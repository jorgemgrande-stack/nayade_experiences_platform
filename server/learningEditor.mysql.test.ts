/**
 * Elephant Learning · editor de formación (lote 1), con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas sintéticas. Sin cobros, sin correos, sin ventas.
 *
 *  - Editar no cambia lo que ven los alumnos; solo publicar.
 *  - Publicar conserva ids: progreso, matrícula y accesos intactos para quien ya está cursando.
 *  - Conflicto si lo publicado cambió, versión recuperable, validación, permisos y aislamiento entre empresas.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });

describe.skipIf(!URL_)("Editor de formación: borrador, publicación y versiones", () => {
  let ess: EssentialApp;
  let adm = "";
  let stu = "";
  let admB = "";
  let studentId = 0;
  const k = { course: 0, m1: 0, m2: 0, l11: 0, l12: 0, l21: 0, b111: 0, b112: 0, b121: 0, b211: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const state = async () => ok(await ess.q("a", "learning.admin.editor.state", { courseId: k.course }, adm), "estado");
  const save = (tree: unknown, expectedUpdatedAt?: number | null) => ess.m("a", "learning.admin.editor.saveDraft", { courseId: k.course, tree, expectedUpdatedAt }, adm);
  const publish = (note?: string) => ess.m("a", "learning.admin.editor.publish", { courseId: k.course, note }, adm);
  const studentIndex = async () => ok(await ess.q("a", "learning.my.course", { courseId: k.course }, stu), "índice del alumno");
  const studentLesson = async (lessonId: number) => ok(await ess.q("a", "learning.my.lesson", { lessonId }, stu), "lección del alumno");
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lmsedit");
    adm = await ess.login("a", "admin");
    stu = await ess.login("a", "user");
    admB = await ess.login("b", "admin");
    studentId = await ess.userId("a", "user");

    const now = Date.now();
    const ins = async (q: string, p: unknown[], find: [string, unknown[]]) => {
      await sql(q, p);
      return Number((await sql(find[0], find[1]))[0].id);
    };
    k.course = await ins("INSERT INTO learning_courses (slug, title, description, language, status, created_at, updated_at) VALUES ('editor-curso','Curso editor','Descripción original','de','published',?,?)", [now, now], ["SELECT id FROM learning_courses WHERE slug = 'editor-curso'", []]);
    const mod = (pos: number) => ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [k.course, pos, `Modul ${pos}`, `em${pos}`, now, now], ["SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [k.course, `em${pos}`]]);
    const les = (m: number, pos: number, key: string) => ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [m, pos, `Lektion ${key}`, key, now, now], ["SELECT id FROM learning_lessons WHERE module_id = ? AND source_key = ?", [m, key]]);
    const blk = (l: number, pos: number, key: string, body: string | null) => ins("INSERT INTO learning_blocks (lesson_id, position, kind, title, body, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [l, pos, "text", `Block ${key}`, body, key, now, now], ["SELECT id FROM learning_blocks WHERE lesson_id = ? AND source_key = ?", [l, key]]);
    k.m1 = await mod(1);
    k.m2 = await mod(2);
    k.l11 = await les(k.m1, 1, "l11");
    k.l12 = await les(k.m1, 2, "l12");
    k.l21 = await les(k.m2, 1, "l21");
    k.b111 = await blk(k.l11, 1, "b111", "Texto original");
    k.b112 = await blk(k.l11, 2, "b112", "Segundo");
    k.b121 = await blk(k.l12, 1, "b121", null);
    k.b211 = await blk(k.l21, 1, "b211", "Del módulo 2");
    // Una persona que YA está cursando: matrícula vigente en los dos módulos y progreso guardado
    ok(await ess.m("a", "learning.admin.grant", { userId: studentId, courseId: k.course, moduleIds: [k.m1, k.m2], durationDays: 30, reason: "Alumna en curso para la prueba", nonce: `ed${Date.now()}abcd` }, adm), "matrícula");
    await sql("INSERT INTO learning_progress (user_id, lesson_id, status, last_block_id, completed_at, updated_at) VALUES (?,?,?,?,?,?)", [studentId, k.l11, "completed", k.b112, now, now]);
    await sql("INSERT INTO learning_progress (user_id, lesson_id, status, last_block_id, completed_at, updated_at) VALUES (?,?,?,?,?,?)", [studentId, k.l21, "in_progress", k.b211, null, now]);
  }, 300_000);

  afterAll(async () => { await ess?.close(); });

  it("el estado muestra la estructura publicada, sin borrador, y avisa de que hay alumnos cursando", async () => {
    const s = await state();
    expect(s.draft).toBeNull();
    expect(s.live.modules.map((m: any) => m.id)).toEqual([k.m1, k.m2]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.live.modules[0].lessons.map((l: any) => l.id)).toEqual([k.l11, k.l12]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(s.usage).toEqual({ activeEnrollments: 1, learnersWithProgress: 1 });
    expect(s.blockMeta[k.b111].kind).toBe("text");
  });

  it("guardar un borrador NO cambia lo que ve el alumno ni las tablas publicadas", async () => {
    const live = (await state()).live;
    const d = clone(live);
    d.course.title = "Curso renombrado";
    d.modules[0].title = "Modul uno";
    d.modules[0].lessons[0].blocks[0].body = "Texto nuevo";
    d.modules[0].lessons.reverse();
    ok(await save(d), "guardar borrador");
    expect((await sql("SELECT title FROM learning_courses WHERE id = ?", [k.course]))[0].title).toBe("Curso editor");
    expect((await sql("SELECT title FROM learning_modules WHERE id = ?", [k.m1]))[0].title).toBe("Modul 1");
    expect((await sql("SELECT body FROM learning_blocks WHERE id = ?", [k.b111]))[0].body).toBe("Texto original");
    const idx = await studentIndex();
    expect(idx.course.title).toBe("Curso editor");
    expect(idx.modules[0].lessons.map((l: any) => l.id)).toEqual([k.l11, k.l12]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = await state();
    expect(s.draft).not.toBeNull();
    expect(s.changes.length).toBeGreaterThanOrEqual(4);
    expect(s.draftInfo.stale).toBe(false);
  });

  it("publicar aplica títulos, textos y orden y conserva progreso, matrícula y accesos de quien ya cursa", async () => {
    const enrollBefore = await sql("SELECT id, status, ends_at FROM learning_enrollments WHERE user_id = ?", [studentId]);
    const modulesBefore = await sql("SELECT module_id FROM learning_enrollment_modules ORDER BY module_id");
    const pub = ok(await publish("Primera edición"), "publicar");
    expect(pub.published).toBe(true);
    expect(pub.version).toBe(1);

    const idx = await studentIndex();
    expect(idx.course.title).toBe("Curso renombrado");
    expect(idx.modules[0].title).toBe("Modul uno");
    expect(idx.modules[0].lessons.map((l: any) => l.id)).toEqual([k.l12, k.l11]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(idx.modules.every((m: any) => m.unlocked)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    // La lección completada sigue completada aunque haya cambiado de sitio
    expect(idx.modules[0].lessons.find((l: any) => l.id === k.l11).completed).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await studentLesson(k.l11)).blocks[0].body).toBe("Texto nuevo");

    // Progreso, última posición, matrícula y módulos concedidos: exactamente igual
    const prog = await sql("SELECT lesson_id, status, last_block_id FROM learning_progress WHERE user_id = ? ORDER BY lesson_id", [studentId]);
    expect(prog.map((p: any) => [Number(p.lesson_id), p.status, Number(p.last_block_id)])).toEqual([[k.l11, "completed", k.b112], [k.l21, "in_progress", k.b211]]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await sql("SELECT id, status, ends_at FROM learning_enrollments WHERE user_id = ?", [studentId])).toEqual(enrollBefore);
    expect(await sql("SELECT module_id FROM learning_enrollment_modules ORDER BY module_id")).toEqual(modulesBefore);

    const s = await state();
    expect(s.draft).toBeNull(); // el borrador se consume
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0].summary).toMatch(/editado/);
    expect(s.versions[0].note).toBe("Primera edición");
  });

  it("publicar sin borrador se rechaza y un borrador idéntico no genera versión", async () => {
    expect(errCode(await publish())).toBe("BAD_REQUEST");
    const live = (await state()).live;
    ok(await save(clone(live)), "borrador idéntico");
    const r = ok(await publish(), "publicar sin cambios");
    expect(r).toMatchObject({ published: false, version: null, changes: 0 });
    expect((await state()).versions).toHaveLength(1);
  });

  it("la validación rechaza elementos ajenos, títulos vacíos y estructuras distintas", async () => {
    const live = (await state()).live;
    const empty = clone(live);
    empty.modules[0].lessons[0].title = "  ";
    expect(errCode(await save(empty))).toBe("BAD_REQUEST");
    const extra = clone(live);
    extra.modules[1].lessons.push({ id: 987654, title: "Inventada", blocks: [] });
    expect(errCode(await save(extra))).toBe("BAD_REQUEST");
    const moved = clone(live);
    const [l] = moved.modules[0].lessons.splice(0, 1);
    moved.modules[1].lessons.push(l);
    expect(errCode(await save(moved))).toBe("BAD_REQUEST");
    expect((await state()).draft).toBeNull(); // ningún intento inválido deja borrador
  });

  it("si lo publicado cambia mientras se edita (p. ej. una importación), publicar se rechaza y no pisa nada", async () => {
    const live = (await state()).live;
    const d = clone(live);
    d.modules[1].title = "Modul zwei (mío)";
    ok(await save(d), "borrador");
    await sql("UPDATE learning_blocks SET body = 'Cambio externo' WHERE id = ?", [k.b211]); // cambio ajeno a la edición
    expect((await state()).draftInfo.stale).toBe(true);
    expect(errCode(await publish())).toBe("CONFLICT");
    expect((await sql("SELECT title FROM learning_modules WHERE id = ?", [k.m2]))[0].title).toBe("Modul 2");
    expect((await sql("SELECT body FROM learning_blocks WHERE id = ?", [k.b211]))[0].body).toBe("Cambio externo");
    ok(await ess.m("a", "learning.admin.editor.discardDraft", { courseId: k.course }, adm), "descartar");
    expect((await state()).draft).toBeNull();
  });

  it("dos pestañas no se pisan: guardar con una marca antigua devuelve conflicto", async () => {
    const live = (await state()).live;
    const first = ok(await save(clone(live)), "primera");
    const second = ok(await save(clone(live), first.updatedAt), "segunda con la marca correcta");
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    await new Promise((r) => setTimeout(r, 5));
    ok(await save(clone(live), second.updatedAt), "tercera");
    expect(errCode(await save(clone(live), first.updatedAt))).toBe("CONFLICT"); // marca vieja
    ok(await ess.m("a", "learning.admin.editor.discardDraft", { courseId: k.course }, adm), "descartar");
  });

  it("una versión anterior se recupera como borrador y se publica por el mismo camino, sin tocar el progreso", async () => {
    const [v1] = (await state()).versions;
    ok(await ess.m("a", "learning.admin.editor.restoreVersion", { courseId: k.course, versionId: v1.id }, adm), "recuperar versión");
    let s = await state();
    expect(s.draft.course.title).toBe("Curso editor"); // lo que había antes de la primera publicación
    expect(s.draft.modules[0].lessons.map((l: any) => l.id)).toEqual([k.l11, k.l12]); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Con un borrador con cambios hay que confirmar la sustitución
    expect(errCode(await ess.m("a", "learning.admin.editor.restoreVersion", { courseId: k.course, versionId: v1.id }, adm))).toBe("CONFLICT");
    ok(await ess.m("a", "learning.admin.editor.restoreVersion", { courseId: k.course, versionId: v1.id, replace: true }, adm), "sustituir");
    const pub = ok(await publish("Vuelta a la primera"), "publicar la recuperación");
    expect(pub.version).toBe(2);
    const idx = await studentIndex();
    expect(idx.course.title).toBe("Curso editor");
    expect(idx.modules[0].lessons.map((l: any) => l.id)).toEqual([k.l11, k.l12]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(idx.modules[0].lessons.find((l: any) => l.id === k.l11).completed).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Number((await sql("SELECT COUNT(*) AS n FROM learning_progress WHERE user_id = ?", [studentId]))[0].n)).toBe(2);
    s = await state();
    expect(s.versions.map((v: any) => v.version)).toEqual([2, 1]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("no se borra ninguna fila ni se cambia el estado del curso, las reglas ni las matrículas", async () => {
    expect(Number((await sql("SELECT COUNT(*) AS n FROM learning_blocks WHERE id IN (?,?,?,?)", [k.b111, k.b112, k.b121, k.b211]))[0].n)).toBe(4);
    expect((await sql("SELECT status FROM learning_courses WHERE id = ?", [k.course]))[0].status).toBe("published");
    expect(Number((await sql("SELECT COUNT(*) AS n FROM learning_access_rules"))[0].n)).toBe(0);
  });

  it("solo administradores: el alumno recibe 403, sin sesión 401, y otra empresa no ve este curso", async () => {
    for (const [proc, input] of [
      ["learning.admin.editor.state", { courseId: k.course }],
    ] as const) expect(errCode(await ess.q("a", proc, input, stu))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "learning.admin.editor.publish", { courseId: k.course }, stu))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "learning.admin.editor.state", { courseId: k.course }, ""))).toBe("UNAUTHORIZED");
    // Empresa B: su administrador no ve el curso de A (otra base de datos)
    expect(errCode(await ess.q("b", "learning.admin.editor.state", { courseId: k.course }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "learning.admin.editor.publish", { courseId: k.course }, admB))).toBe("NOT_FOUND");
    // La sesión de A no sirve en B
    expect(errCode(await ess.q("b", "learning.admin.editor.state", { courseId: k.course }, adm))).toBe("UNAUTHORIZED");
  });
});
