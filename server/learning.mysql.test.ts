/**
 * Elephant LMS (entrega 1) con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas.
 * Casos A–P y R–T del encargo que corresponden a matrículas, autorización, aislamiento y caducidad. Sin cobros reales:
 * el pago «verificado» es una referencia de prueba; nunca hay pasarela.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });
const DAY = 86_400_000;

describe.skipIf(!URL_)("LMS: matrículas, autorización por módulo, pago confirmado, caducidad y aislamiento", () => {
  let ess: EssentialApp;
  let adm = "";
  let stu = ""; // alumno 1 (rol user)
  let stu2 = ""; // otra identidad (agente)
  let admB = "";
  let stuB = "";
  const u = { s1: 0, s2: 0, sB: 0 };
  const c = { course: 0, m1: 0, m2: 0, m3: 0, l1: 0, l2: 0, l3: 0, b1: 0, courseB: 0, exp: 0 };
  const sql = (q: string, p: unknown[] = []) => ess.sql("a", q, p);
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  const grantPaid = (userId: number, variantId: number | null, opId: number, ref = "TRF-TEST-1") =>
    ess.m("a", "learning.admin.grantFromPayment", { userId, experienceId: c.exp, variantId, operation: { kind: "enrollment", id: opId }, payment: { reference: ref, amountCents: 33300 } }, adm);
  const myCourse = () => ess.q("a", "learning.my.course", { courseId: c.course }, stu);
  const lesson = (id: number, cookie = stu) => ess.q("a", "learning.my.lesson", { lessonId: id }, cookie);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lms");
    adm = await ess.login("a", "admin");
    stu = await ess.login("a", "user");
    stu2 = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    stuB = await ess.login("b", "user");
    u.s1 = await ess.userId("a", "user");
    u.s2 = await ess.userId("a", "agente");
    u.sB = await ess.userId("b", "user");
    const now = Date.now();
    // El pool de la prueba no conserva LAST_INSERT_ID entre consultas: cada fila se relee por su clave natural
    const ins = async (q: string, p: unknown[], find: [string, unknown[]]) => {
      await ess.sql("a", q, p);
      return Number((await ess.sql("a", find[0], find[1]))[0].id);
    };
    c.exp = 777;
    c.course = await ins("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('reconnect-test','RECONNECT','de','published',?,?)", [now, now], ["SELECT id FROM learning_courses WHERE slug = 'reconnect-test'", []]);
    for (const k of [1, 2, 3] as const) {
      const m = await ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [c.course, k, `TEIL ${k}`, `m${k}`, now, now], ["SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [c.course, `m${k}`]]);
      (c as any)[`m${k}`] = m;
      const l = await ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [m, 1, `Lektion ${k}`, `l${k}`, now, now], ["SELECT id FROM learning_lessons WHERE module_id = ? AND source_key = ?", [m, `l${k}`]]);
      (c as any)[`l${k}`] = l;
    }
    c.b1 = await ins("INSERT INTO learning_blocks (lesson_id, position, kind, title, body, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [c.l1, 1, "text", "Einführung", "Texto de prueba", "b1", now, now], ["SELECT id FROM learning_blocks WHERE lesson_id = ? AND source_key = 'b1'", [c.l1]]);
    // Reglas de catálogo: variante 13 = + MÓDULO 1; 9 y 11 = tres módulos; la 8 (LIVE) no tiene regla
    const rule = async (variant: number, mods: number[]) => {
      const r = ok(await ess.m("a", "learning.admin.saveRule", { experienceId: c.exp, variantId: variant, courseId: c.course, moduleIds: mods, durationDays: 90, startMode: "on_grant", fixedStart: null, active: true }, adm), `regla ${variant}`);
      return r.id as number;
    };
    await rule(13, [c.m1]);
    await rule(9, [c.m1, c.m2, c.m3]);
    await rule(11, [c.m1, c.m2, c.m3]);
    // Curso de la empresa B (para comprobar que nada se cruza)
    await ess.sql("b", "INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('curso-b','Curso B','de','published',?,?)", [now, now]);
    c.courseB = Number((await ess.sql("b", "SELECT id FROM learning_courses LIMIT 1"))[0].id);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("A y D. sin sesión o sin matrícula: acceso denegado", async () => {
    expect((await ess.q("a", "learning.my.course", { courseId: c.course })).status).toBe(401);
    expect((await ess.q("a", "learning.my.courses")).status).toBe(401);
    expect(errCode(await myCourse())).toBe("FORBIDDEN");
    expect(errCode(await lesson(c.l1))).toBe("FORBIDDEN");
    expect(ok(await ess.q("a", "learning.my.courses", undefined, stu), "mis cursos")).toEqual([]);
  });

  it("B y M. solicitud/presupuesto/pago sin confirmar no conceden: falta referencia, importe o verificador", async () => {
    for (const payment of [{ reference: "", amountCents: 33300 }, { reference: "TRF", amountCents: 0 }]) {
      const r = await ess.m("a", "learning.admin.grantFromPayment", { userId: u.s1, experienceId: c.exp, variantId: 9, operation: { kind: "quote", id: 1 }, payment }, adm);
      expect(errCode(r)).toBe("PRECONDITION_FAILED");
    }
    expect(await sql("SELECT id FROM learning_enrollments WHERE user_id = ?", [u.s1])).toEqual([]);
  });

  it("variante sin regla (LIVE) no crea matrícula aunque el pago sea válido", async () => {
    const r = ok(await grantPaid(u.s1, 8, 100), "LIVE");
    expect(r.rules).toBe(0);
    expect(r.granted).toEqual([]);
    expect(await sql("SELECT id FROM learning_enrollments WHERE user_id = ?", [u.s1])).toEqual([]);
  });

  it("C, E y L. + MÓDULO 1: pago confirmado crea la matrícula; abre solo el módulo 1; repetir el pago no duplica (ni en paralelo)", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => grantPaid(u.s1, 13, 200)));
    for (const r of results) expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(results.filter((r) => data(r).granted[0].created).length).toBe(1);
    const rowsN = await sql("SELECT id, status, source, payment_ref, variant_id FROM learning_enrollments WHERE user_id = ?", [u.s1]);
    expect(rowsN).toHaveLength(1);
    expect(rowsN[0]).toMatchObject({ status: "active", source: "payment", payment_ref: "TRF-TEST-1", variant_id: 13 });
    const outline = ok(await myCourse(), "índice");
    expect(outline.modules.map((m: any) => m.unlocked)).toEqual([true, false, false]);
    expect(ok(await lesson(c.l1), "lección 1").blocks[0]).toMatchObject({ kind: "text", body: "Texto de prueba" });
    expect(errCode(await lesson(c.l2))).toBe("FORBIDDEN");
    expect(errCode(await lesson(c.l3))).toBe("FORBIDDEN");
    const ev = await sql("SELECT type FROM learning_access_events WHERE enrollment_id = ?", [rowsN[0].id]);
    expect(ev.map((e) => e.type)).toEqual(["granted"]);
  });

  it("H. otra identidad no puede usar la matrícula de un alumno", async () => {
    expect(errCode(await ess.q("a", "learning.my.course", { courseId: c.course }, stu2))).toBe("FORBIDDEN");
    expect(errCode(await lesson(c.l1, stu2))).toBe("FORBIDDEN");
  });

  it("F y G. ONLINE e INTENSIV abren los tres módulos (mismas reglas, sin condiciones rígidas en el código)", async () => {
    const r = ok(await grantPaid(u.s2, 9, 300, "TRF-TEST-2"), "ONLINE");
    expect(r.granted[0].enrollment.moduleIds).toEqual([c.m1, c.m2, c.m3]);
    for (const l of [c.l1, c.l2, c.l3]) ok(await lesson(l, stu2), `lección ${l}`);
    const r2 = ok(await grantPaid(u.s2, 11, 301, "TRF-TEST-3"), "INTENSIV");
    expect(r2.granted[0].enrollment.moduleIds).toEqual([c.m1, c.m2, c.m3]);
  });

  it("P. el progreso es individual y solo cuenta con acceso", async () => {
    ok(await ess.m("a", "learning.my.progress", { lessonId: c.l1, completed: true }, stu), "completar");
    expect(errCode(await ess.m("a", "learning.my.progress", { lessonId: c.l2, completed: true }, stu))).toBe("FORBIDDEN");
    const mine = ok(await ess.q("a", "learning.my.courses", undefined, stu), "mis cursos");
    expect(mine[0]).toMatchObject({ totalLessons: 1, completedLessons: 1, percent: 100, status: "active" });
    expect(await sql("SELECT user_id FROM learning_progress WHERE lesson_id = ?", [c.l1])).toEqual([{ user_id: u.s1 }]);
    ok(await ess.m("a", "learning.my.progress", { lessonId: c.l1 }, stu), "abrir de nuevo no descompleta");
    expect((await sql("SELECT status FROM learning_progress WHERE user_id = ? AND lesson_id = ?", [u.s1, c.l1]))[0].status).toBe("completed");
  });

  it("J, K y T. caduca al llegar a su fin (se evalúa al leer); la prórroga auditada la restaura; el progreso se conserva", async () => {
    const [e] = await sql("SELECT id FROM learning_enrollments WHERE user_id = ?", [u.s1]);
    await sql("UPDATE learning_enrollments SET ends_at = ? WHERE id = ?", [Date.now() - 1000, e.id]);
    expect(errCode(await lesson(c.l1))).toBe("FORBIDDEN"); // aunque la tarea aún no haya corrido
    const mine = ok(await ess.q("a", "learning.my.courses", undefined, stu), "mis cursos caducado");
    expect(mine[0]).toMatchObject({ status: "expired", completedLessons: 1, percent: 100 });
    expect(errCode(await ess.m("a", "learning.admin.extend", { enrollmentId: e.id, newEndsAt: Date.now() + 30 * DAY, reason: "ok" }, adm))).toBe("BAD_REQUEST"); // motivo demasiado corto
    ok(await ess.m("a", "learning.admin.extend", { enrollmentId: e.id, newEndsAt: Date.now() + 30 * DAY, reason: "Prórroga acordada con Indira" }, adm), "prórroga");
    ok(await lesson(c.l1), "acceso restaurado");
    const ev = await sql("SELECT type, detail FROM learning_access_events WHERE enrollment_id = ? ORDER BY id", [e.id]);
    expect(ev.map((x) => x.type)).toEqual(["granted", "extended"]);
  });

  it("N. revocar (con motivo) corta el acceso y deja historial; reactivar exige motivo", async () => {
    const [e] = await sql("SELECT id FROM learning_enrollments WHERE user_id = ?", [u.s1]);
    expect(errCode(await ess.m("a", "learning.admin.revoke", { enrollmentId: e.id, reason: "x" }, adm))).toBe("BAD_REQUEST");
    ok(await ess.m("a", "learning.admin.revoke", { enrollmentId: e.id, reason: "Devolución del importe" }, adm), "revocar");
    expect(errCode(await lesson(c.l1))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "learning.admin.extend", { enrollmentId: e.id, newEndsAt: Date.now() + DAY, reason: "Intento sobre revocada" }, adm))).toBe("CONFLICT");
    ok(await ess.m("a", "learning.admin.reactivate", { enrollmentId: e.id, reason: "Reembolso anulado, vuelve el acceso" }, adm), "reactivar");
    ok(await lesson(c.l1), "reactivada");
    expect((await sql("SELECT type FROM learning_access_events WHERE enrollment_id = ? ORDER BY id", [e.id])).map((x) => x.type)).toEqual(["granted", "extended", "revoked", "reactivated"]);
  });

  it("ampliación: añadir módulos a la misma matrícula (misma cuenta, historial y progreso)", async () => {
    expect(errCode(await lesson(c.l2))).toBe("FORBIDDEN");
    const [e] = await sql("SELECT id FROM learning_enrollments WHERE user_id = ?", [u.s1]);
    ok(await ess.m("a", "learning.admin.addModules", { enrollmentId: e.id, moduleIds: [c.m2, c.m3], reason: "Ampliación a ONLINE pagada (333 € − 199 €)", paymentRef: "TRF-TEST-AMP" }, adm), "ampliar");
    ok(await lesson(c.l2), "módulo 2");
    ok(await lesson(c.l3), "módulo 3");
    expect(ok(await ess.q("a", "learning.my.courses", undefined, stu), "mis cursos")[0].completedLessons).toBe(1);
  });

  it("R. la demostración dura 60 minutos, es individual y un disparador da una sola", async () => {
    const t = `taller-${Date.now().toString(36)}`;
    const g = ok(await ess.m("a", "learning.admin.grantDemo", { userId: u.s2, courseId: c.course, moduleIds: [c.m1], trigger: t }, adm), "demo");
    // s2 ya tiene ONLINE: la demostración es otra matrícula con fin a +60 min
    const e = g.enrollment;
    expect(e.source).toBe("demo");
    expect(e.endsAt - e.startsAt).toBe(60 * 60_000);
    const again = ok(await ess.m("a", "learning.admin.grantDemo", { userId: u.s2, courseId: c.course, moduleIds: [c.m1], trigger: t }, adm), "demo repetida");
    expect(again.created).toBe(false);
    expect(again.enrollment.id).toBe(e.id);
  });

  it("I y S. aislamiento entre empresas: la empresa B no ve ni usa nada de A", async () => {
    const cross = await ess.q("b", "learning.my.course", { courseId: c.course }, stuB); // los ids pueden coincidir entre empresas: aun así, sin matrícula en B no hay nada
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(errCode(cross));
    expect(JSON.stringify(cross.json)).not.toContain("RECONNECT");
    expect(ok(await ess.q("b", "learning.admin.enrollments", undefined, admB), "matrículas B")).toEqual([]);
    expect(ok(await ess.q("b", "learning.admin.rules", undefined, admB), "reglas B")).toEqual([]);
    expect(await ess.sql("b", "SELECT id FROM learning_enrollments")).toEqual([]);
    // la cookie de un alumno de A no vale en B
    expect([401, 403]).toContain((await ess.q("b", "learning.my.courses", undefined, stu)).status);
  });

  it("O. las respuestas del aula no incluyen URLs de recursos ni rutas de almacenamiento", async () => {
    const body = JSON.stringify((await lesson(c.l1)).json);
    expect(body).not.toMatch(/https?:\/\/|stored_object|storage|\/files\//i);
  });

  it("Q. importar inventarios de Articulate crea el curso en borrador con recursos pendientes y reimportar no duplica", async () => {
    const lessonInv = (o: number) => ({ orden: o, titulo: `LEKTION ${o}`, url: "https://share.articulate.com/x#/${o}", bloques: [
      { orden: 1, tipo: "texto", titulo: "Einführung", descripcion: "Texto" },
      { orden: 2, tipo: "video", titulo: "Video ${o}", duracion: "01:30" },
      { orden: 3, tipo: "pdf", titulo: "Text ${o}", archivo: "t${o}.pdf", tamano: "10 KB" },
    ] });
    const inventories = [1, 2].map((m) => ({ modulo: m, titulo: `TEIL ${m}`, url: "https://share.articulate.com/x", secciones: [{ orden: 1, titulo: `TEIL ${m} – X`, lecciones: [lessonInv(1), lessonInv(2)] }], recuento: { lecciones: 2, videos: 2, pdf_descargables: 2 } }));
    const input = { inventories, courseSlug: "importado-test", courseTitle: "Importado" };
    const dry = ok(await ess.m("a", "learning.admin.importInventory", { ...input, dryRun: true }, adm), "dry run");
    expect(dry.report.counts).toMatchObject({ modules: 2, lessons: 4, videos: 4, pdfs: 4 });
    expect(await sql("SELECT id FROM learning_courses WHERE slug = 'importado-test'")).toEqual([]);
    const first = ok(await ess.m("a", "learning.admin.importInventory", input, adm), "importar");
    expect(first.result.created).toEqual({ course: 1, modules: 2, lessons: 4, blocks: 12, resources: 8 });
    expect(first.result.courseStatus).toBe("draft");
    const snapshot = async () => ({
      modules: (await sql("SELECT COUNT(*) AS c FROM learning_modules m JOIN learning_courses c ON c.id = m.course_id WHERE c.slug = 'importado-test'"))[0].c,
      blocks: (await sql("SELECT COUNT(*) AS c FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id WHERE c.slug = 'importado-test'"))[0].c,
      resources: (await sql("SELECT COUNT(*) AS c FROM learning_resources WHERE provenance LIKE 'Articulate https://share.articulate.com/x%'"))[0].c,
    });
    const before = await snapshot();
    const again = ok(await ess.m("a", "learning.admin.importInventory", input, adm), "reimportar");
    expect(again.result.created).toEqual({ course: 0, modules: 0, lessons: 0, blocks: 0, resources: 0 });
    expect(await snapshot()).toEqual(before);
    // sin ficheros: todo pendiente, nada verificado, y el borrador no lo ve ningún alumno
    expect(again.coverage.files).toEqual({ verified: 0, pending: 8 });
    expect(await sql("SELECT status FROM learning_resources WHERE status <> 'pending' AND provenance LIKE 'Articulate https://share.articulate.com/x%'")).toEqual([]);
    const importedId = Number((await sql("SELECT id FROM learning_courses WHERE slug = 'importado-test'"))[0].id);
    expect(errCode(await ess.q("a", "learning.my.course", { courseId: importedId }, stu))).toBe("NOT_FOUND");
    // inventario no válido: rechazado sin tocar nada
    const bad = await ess.m("a", "learning.admin.importInventory", { ...input, courseSlug: "malo-test", inventories: [{ modulo: 1 }] }, adm);
    expect(errCode(bad)).toBe("BAD_REQUEST");
    expect(await sql("SELECT id FROM learning_courses WHERE slug = 'malo-test'")).toEqual([]);
  });

  it("recursos: la administración sube, solo se sirven con matrícula del módulo, sin caché ni URL pública, y quedan en el historial", async () => {
    const os = await import("node:os");
    const fsm = await import("node:fs");
    const pathm = await import("node:path");
    const crypto = await import("node:crypto");
    const dir = fsm.mkdtempSync(pathm.join(os.tmpdir(), "lms-store-"));
    process.env.LOCAL_STORAGE_PATH = dir;
    process.env.STORAGE_OBJECTS = "on";
    for (const k of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "STORAGE_PRIVATE_DELIVERY"]) delete process.env[k];
    (await import("./_core/files/backend")).resetBackendCache();
    (await import("./_core/files/service")).setFileServiceForTests(null);

    const now = Date.now();
    const ins = async (q: string, p: unknown[], find: [string, unknown[]]) => {
      await ess.sql("a", q, p);
      return Number((await ess.sql("a", find[0], find[1]))[0].id);
    };
    const course = await ins("INSERT INTO learning_courses (slug, title, language, status, created_at, updated_at) VALUES ('recursos-test','Recursos','de','published',?,?)", [now, now], ["SELECT id FROM learning_courses WHERE slug = 'recursos-test'", []]);
    const mk = async (k: number) => {
      const m = await ins("INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [course, k, `R${k}`, `m${k}`, now, now], ["SELECT id FROM learning_modules WHERE course_id = ? AND source_key = ?", [course, `m${k}`]]);
      const l = await ins("INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?)", [m, 1, `L${k}`, `l${k}`, now, now], ["SELECT id FROM learning_lessons WHERE module_id = ? AND source_key = ?", [m, `l${k}`]]);
      const mkRes = async (kind: string, name: string) => {
        await ess.sql("a", "INSERT INTO learning_resources (kind, original_name, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)", [kind, name, now, now]);
        const rid = Number((await ess.sql("a", "SELECT id FROM learning_resources WHERE original_name = ? ORDER BY id DESC LIMIT 1", [name]))[0].id);
        await ess.sql("a", "INSERT INTO learning_blocks (lesson_id, position, kind, title, resource_id, source_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [l, kind === "pdf" ? 1 : 2, kind, name, rid, `b-${kind}-${k}`, now, now]);
        return rid;
      };
      return { m, pdf: await mkRes("pdf", `doc${k}-${now}.pdf`), video: await mkRes("video", `vid${k}-${now}.mp4`) };
    };
    const X1 = await mk(1);
    const X2 = await mk(2);
    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n" + crypto.randomBytes(8).toString("hex"), "latin1");
    const multipart = (name: string, type: string, body: Buffer) => {
      const b = `----lms${crypto.randomBytes(6).toString("hex")}`;
      const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`;
      const tail = `\r\n--${b}--\r\n`;
      const raw = Buffer.concat([Buffer.from(head), body, Buffer.from(tail)]).toString("latin1");
      return { raw, headers: { "content-type": `multipart/form-data; boundary=${b}` } };
    };
    const up = (rid: number, cookie: string, name = "doc.pdf", type = "application/pdf", body = pdfBytes) => ess.call("a", "POST", `/api/learning/upload/${rid}`, { cookie, ...multipart(name, type, body) });

    // Subida: solo admin; el tipo se comprueba por el contenido y debe corresponder al recurso
    expect((await up(X1.pdf, stu)).status).toBe(403);
    expect((await up(X1.pdf, "")).status).toBe(401);
    expect((await up(X1.video, adm)).status).toBe(400); // un PDF no es un vídeo
    const ok1 = await up(X1.pdf, adm);
    expect(ok1.status, ok1.text).toBe(200);
    expect(ok1.json).toMatchObject({ ok: true, contentType: "application/pdf", duplicateOf: [] });
    const dup = await up(X2.pdf, adm); // mismo contenido en otro recurso: se avisa, no se bloquea
    expect(dup.status, dup.text).toBe(200);
    expect(dup.json.duplicateOf).toEqual([{ resourceId: X1.pdf, originalName: expect.stringContaining("doc1-") }]);
    expect((await sql("SELECT status FROM learning_resources WHERE id = ?", [X1.pdf]))[0].status).toBe("verified");
    expect((await sql("SELECT status FROM learning_resources WHERE id = ?", [X1.video]))[0].status).toBe("pending");

    // Entrega: matrícula del módulo 1 solamente
    ok(await ess.m("a", "learning.admin.grant", { userId: u.s1, courseId: course, moduleIds: [X1.m], durationDays: 30, reason: "Prueba de recursos con motivo", nonce: `n${now}abcd` }, adm), "matrícula");
    const get = (rid: number, cookie: string, q = "") => ess.call("a", "GET", `/api/learning/resource/${rid}${q}`, { cookie });
    expect((await get(X1.pdf, "")).status).toBe(401);
    const r1 = await get(X1.pdf, stu);
    expect(r1.status, r1.text).toBe(200);
    expect(String(r1.headers?.["cache-control"])).toContain("no-store");
    expect(String(r1.headers?.["content-type"])).toContain("application/pdf");
    expect(String(r1.headers?.["x-robots-tag"])).toContain("noindex");
    expect(String(r1.headers?.["content-disposition"])).toContain("inline");
    expect(String((await get(X1.pdf, stu, "?download=1")).headers?.["content-disposition"])).toContain("attachment");
    expect((await get(X2.pdf, stu)).status).toBe(403); // módulo 2 no concedido, aunque tenga fichero
    expect((await get(X1.video, stu)).status).toBe(404); // sin fichero verificado: nada que servir
    expect((await get(X1.pdf, stu2)).status).toBe(403); // otra identidad sin matrícula de este curso
    expect((await get(999999, stu)).status).toBe(404);
    // Registro de accesos y ausencia de rutas públicas
    const opened = await sql("SELECT detail FROM learning_access_events WHERE type = 'resource_opened' AND JSON_EXTRACT(detail, '$.resourceId') = ?", [X1.pdf]);
    expect(opened.length).toBeGreaterThanOrEqual(2);
    const [obj] = await sql("SELECT stored_object_id FROM learning_resources WHERE id = ?", [X1.pdf]);
    expect((await ess.call("a", "GET", `/files/${obj.stored_object_id}/x.pdf`)).status).toBe(404); // privado: no hay URL pública
    expect((await ess.call("a", "GET", `/api/files/${obj.stored_object_id}`, { cookie: stu })).status).toBe(403); // ni por la ruta genérica de ficheros
    expect((await ess.call("a", "GET", `/api/files/${obj.stored_object_id}`)).status).toBe(401);
    // Caducidad: la matrícula vencida corta la entrega al instante
    await sql("UPDATE learning_enrollments SET ends_at = ? WHERE user_id = ? AND course_id = ?", [Date.now() - 1000, u.s1, course]);
    expect((await get(X1.pdf, stu)).status).toBe(403);
    fsm.rmSync(dir, { recursive: true, force: true });
  });
});
