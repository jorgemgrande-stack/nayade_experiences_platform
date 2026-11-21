/**
 * Elephant Learning · creación de formaciones (lote 3): cursos, módulos, lecciones y bloques nuevos, duplicado y archivado.
 *
 * Garantías:
 *  - Un curso nuevo nace en BORRADOR (privado: nadie lo ve, ni con matrícula de pago). Solo en borrador se añade estructura:
 *    en un curso publicado cambiaría lo que ven los alumnos al instante, así que ahí se edita por el editor (borrador/publicar).
 *  - Nada se borra ni se sobrescribe: crear solo inserta filas nuevas al final de su padre.
 *  - Un bloque de vídeo/audio/PDF apunta a un recurso de la biblioteca: se reutiliza el existente (sin duplicar el fichero) o se
 *    crea uno pendiente, al que se sube el fichero por el flujo de materiales.
 *  - Duplicar un curso copia la estructura y comparte los recursos (mismo objeto del almacén, cero bytes nuevos).
 *  - Archivar/restaurar solo cambia el estado del curso: conserva matrículas, progreso y ficheros.
 *  - Todo va contra la BD de la empresa en curso y queda auditado.
 */
import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { LearningError, auditAdmin } from "./learningDb";
import { LIMITS } from "../shared/learningEditor";
import { BLOCK_KINDS, RESOURCE_KINDS, slugify, type BlockKind } from "../shared/learningAuthoring";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}
async function rows(exec: Exec, q: SQL): Promise<Row[]> {
  const [r] = (await exec.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}
async function run(exec: Exec, q: SQL) { await exec.execute(q); }
const n = (v: unknown) => Number(v ?? 0);
const key = () => `n-${randomBytes(6).toString("hex")}`;

const clean = (s: string, max: number, what: string): string => {
  const t = s.trim();
  if (!t) throw new LearningError("BAD_REQUEST", `${what}: el título no puede estar vacío.`);
  if (t.length > max) throw new LearningError("BAD_REQUEST", `${what}: el título supera ${max} caracteres.`);
  return t;
};

/** El curso debe existir y estar en borrador para añadirle estructura (se bloquea la fila: dos altas a la vez no chocan en posición). */
async function draftCourse(tx: Exec, courseId: number): Promise<Row> {
  const [c] = await rows(tx, sql`SELECT id, status FROM learning_courses WHERE id = ${courseId} FOR UPDATE`);
  if (!c) throw new LearningError("NOT_FOUND", "El curso no existe.");
  if (c.status !== "draft") throw new LearningError("CONFLICT", c.status === "archived" ? "El curso está archivado: restáuralo para editarlo." : "Solo se puede añadir estructura a un curso en borrador. Para cambiar uno publicado usa el editor (borrador y publicar).");
  return c;
}

export interface NewCourse { title: string; description?: string | null; language?: string }

export async function createCourse(input: NewCourse, actorUserId: number, now = Date.now()): Promise<{ courseId: number; slug: string }> {
  const title = clean(input.title, LIMITS.courseTitle, "Curso");
  const description = input.description?.trim() ? input.description.trim().slice(0, LIMITS.courseDescription) : null;
  const language = (input.language ?? "de").trim().toLowerCase().slice(0, 8) || "de";
  const d = await db();
  return d.transaction(async (tx) => {
    const base = slugify(title);
    let slug = base;
    for (let i = 2; (await rows(tx, sql`SELECT 1 AS x FROM learning_courses WHERE slug = ${slug}`)).length; i++) slug = `${base.slice(0, 70)}-${i}`;
    await run(tx, sql`INSERT INTO learning_courses (slug, title, description, language, status, created_at, updated_at) VALUES (${slug}, ${title}, ${description}, ${language}, 'draft', ${now}, ${now})`);
    const [r] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
    await auditAdmin(tx, actorUserId, "admin_course_created", { courseId: n(r.id), slug }, now);
    return { courseId: n(r.id), slug };
  });
}

export async function addModule(courseId: number, titleIn: string, actorUserId: number, now = Date.now()): Promise<{ moduleId: number }> {
  const title = clean(titleIn, LIMITS.title, "Módulo");
  const d = await db();
  return d.transaction(async (tx) => {
    await draftCourse(tx, courseId);
    const [p] = await rows(tx, sql`SELECT COALESCE(MAX(position), 0) AS p FROM learning_modules WHERE course_id = ${courseId}`);
    await run(tx, sql`INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (${courseId}, ${n(p.p) + 1}, ${title}, ${key()}, ${now}, ${now})`);
    const [r] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
    await auditAdmin(tx, actorUserId, "admin_module_created", { courseId, moduleId: n(r.id) }, now);
    return { moduleId: n(r.id) };
  });
}

export async function addLesson(moduleId: number, titleIn: string, actorUserId: number, now = Date.now()): Promise<{ lessonId: number }> {
  const title = clean(titleIn, LIMITS.title, "Lección");
  const d = await db();
  return d.transaction(async (tx) => {
    const [m] = await rows(tx, sql`SELECT id, course_id FROM learning_modules WHERE id = ${moduleId}`);
    if (!m) throw new LearningError("NOT_FOUND", "El módulo no existe.");
    await draftCourse(tx, n(m.course_id));
    const [p] = await rows(tx, sql`SELECT COALESCE(MAX(position), 0) AS p FROM learning_lessons WHERE module_id = ${moduleId}`);
    await run(tx, sql`INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (${moduleId}, ${n(p.p) + 1}, ${title}, ${key()}, ${now}, ${now})`);
    const [r] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
    await auditAdmin(tx, actorUserId, "admin_lesson_created", { moduleId, lessonId: n(r.id) }, now);
    return { lessonId: n(r.id) };
  });
}

export interface NewBlock { kind: BlockKind; title: string; body?: string | null; externalUrl?: string | null; attribution?: string | null; resourceId?: number | null }

export async function addBlock(lessonId: number, input: NewBlock, actorUserId: number, now = Date.now()): Promise<{ blockId: number; resourceId: number | null; resourceCreated: boolean }> {
  if (!BLOCK_KINDS.includes(input.kind)) throw new LearningError("BAD_REQUEST", "Tipo de bloque no válido.");
  const title = clean(input.title, LIMITS.title, "Bloque");
  const body = input.body?.trim() ? input.body : null;
  if ((body ?? "").length > LIMITS.body) throw new LearningError("BAD_REQUEST", `El texto supera ${LIMITS.body} caracteres.`);
  let url: string | null = null;
  if (input.kind === "external_link") {
    url = (input.externalUrl ?? "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 600) throw new LearningError("BAD_REQUEST", "El enlace debe empezar por https:// y no superar 600 caracteres.");
  }
  const d = await db();
  return d.transaction(async (tx) => {
    const [l] = await rows(tx, sql`SELECT l.id, m.course_id FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE l.id = ${lessonId}`);
    if (!l) throw new LearningError("NOT_FOUND", "La lección no existe.");
    await draftCourse(tx, n(l.course_id));
    let resourceId: number | null = null;
    let created = false;
    if (RESOURCE_KINDS.includes(input.kind as never)) {
      if (input.resourceId) {
        const [res] = await rows(tx, sql`SELECT id, kind FROM learning_resources WHERE id = ${input.resourceId}`);
        if (!res) throw new LearningError("NOT_FOUND", "El material elegido no existe.");
        if (res.kind !== input.kind) throw new LearningError("BAD_REQUEST", `El material elegido es de tipo ${res.kind}, no ${input.kind}.`);
        resourceId = n(res.id);
      } else {
        await run(tx, sql`INSERT INTO learning_resources (kind, original_name, status, created_at, updated_at) VALUES (${input.kind}, ${title.slice(0, 300)}, 'pending', ${now}, ${now})`);
        const [r] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
        resourceId = n(r.id);
        created = true;
      }
    }
    const [p] = await rows(tx, sql`SELECT COALESCE(MAX(position), 0) AS p FROM learning_blocks WHERE lesson_id = ${lessonId}`);
    await run(tx, sql`INSERT INTO learning_blocks (lesson_id, position, kind, title, body, resource_id, external_url, attribution, source_key, created_at, updated_at)
      VALUES (${lessonId}, ${n(p.p) + 1}, ${input.kind}, ${title}, ${body}, ${resourceId}, ${url}, ${input.attribution?.trim() ? input.attribution.trim().slice(0, LIMITS.attribution) : null}, ${key()}, ${now}, ${now})`);
    const [r] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
    await auditAdmin(tx, actorUserId, "admin_block_created", { lessonId, blockId: n(r.id), kind: input.kind, resourceId, resourceCreated: created }, now);
    return { blockId: n(r.id), resourceId, resourceCreated: created };
  });
}

/** Copia la estructura de un curso a uno nuevo en borrador. Los bloques con fichero comparten el recurso: no se duplica ningún objeto. */
export async function duplicateCourse(courseId: number, actorUserId: number, now = Date.now()): Promise<{ courseId: number; slug: string; shared: number }> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [c] = await rows(tx, sql`SELECT id, title, description, language FROM learning_courses WHERE id = ${courseId} FOR UPDATE`);
    if (!c) throw new LearningError("NOT_FOUND", "El curso no existe.");
    const base = slugify(`${c.title} copia`);
    let slug = base;
    for (let i = 2; (await rows(tx, sql`SELECT 1 AS x FROM learning_courses WHERE slug = ${slug}`)).length; i++) slug = `${base.slice(0, 70)}-${i}`;
    const title = `${String(c.title).slice(0, LIMITS.courseTitle - 9)} (copia)`;
    await run(tx, sql`INSERT INTO learning_courses (slug, title, description, language, status, source_note, created_at, updated_at) VALUES (${slug}, ${title}, ${c.description ?? null}, ${c.language}, 'draft', ${`Copia del curso n.º ${courseId}`}, ${now}, ${now})`);
    const [nc] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
    const newCourse = n(nc.id);
    let shared = 0;
    const mods = await rows(tx, sql`SELECT id, position, title FROM learning_modules WHERE course_id = ${courseId} ORDER BY position`);
    for (let mi = 0; mi < mods.length; mi++) {
      await run(tx, sql`INSERT INTO learning_modules (course_id, position, title, source_key, created_at, updated_at) VALUES (${newCourse}, ${mods[mi].position}, ${mods[mi].title}, ${key()}, ${now}, ${now})`);
      const [nm] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
      const lessons = await rows(tx, sql`SELECT id, position, title FROM learning_lessons WHERE module_id = ${n(mods[mi].id)} ORDER BY position`);
      for (let li = 0; li < lessons.length; li++) {
        await run(tx, sql`INSERT INTO learning_lessons (module_id, position, title, source_key, created_at, updated_at) VALUES (${n(nm.id)}, ${lessons[li].position}, ${lessons[li].title}, ${key()}, ${now}, ${now})`);
        const [nl] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
        const blocks = await rows(tx, sql`SELECT position, kind, title, body, resource_id, external_url, duration_seconds, activity, attribution FROM learning_blocks WHERE lesson_id = ${n(lessons[li].id)} ORDER BY position`);
        for (let bi = 0; bi < blocks.length; bi++) {
          const b = blocks[bi];
          if (b.resource_id) shared++;
          await run(tx, sql`INSERT INTO learning_blocks (lesson_id, position, kind, title, body, resource_id, external_url, duration_seconds, activity, attribution, source_key, created_at, updated_at)
            VALUES (${n(nl.id)}, ${b.position}, ${b.kind}, ${b.title}, ${b.body ?? null}, ${b.resource_id ?? null}, ${b.external_url ?? null}, ${b.duration_seconds ?? null}, ${b.activity ?? null}, ${b.attribution ?? null}, ${key()}, ${now}, ${now})`);
        }
      }
    }
    await auditAdmin(tx, actorUserId, "admin_course_duplicated", { from: courseId, to: newCourse, sharedResources: shared }, now);
    return { courseId: newCourse, slug, shared };
  });
}

/** Archivar conserva todo (matrículas, progreso, ficheros); un curso archivado no abre a nadie. Restaurar lo devuelve a borrador. */
export async function archiveCourse(courseId: number, archive: boolean, actorUserId: number, now = Date.now()): Promise<{ status: string }> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [c] = await rows(tx, sql`SELECT id, status FROM learning_courses WHERE id = ${courseId} FOR UPDATE`);
    if (!c) throw new LearningError("NOT_FOUND", "El curso no existe.");
    const next = archive ? "archived" : "draft";
    if (c.status === next) return { status: next };
    if (!archive && c.status !== "archived") return { status: String(c.status) };
    await run(tx, sql`UPDATE learning_courses SET status = ${next}, updated_at = ${now} WHERE id = ${courseId}`);
    await auditAdmin(tx, actorUserId, archive ? "admin_course_archived" : "admin_course_restored", { courseId, from: c.status }, now);
    return { status: next };
  });
}

/** Estructura completa de un curso con ids, para el constructor (solo lectura). */
export async function courseOutline(courseId: number) {
  const d = await db();
  const [c] = await rows(d, sql`SELECT id, slug, title, description, language, status FROM learning_courses WHERE id = ${courseId}`);
  if (!c) throw new LearningError("NOT_FOUND", "El curso no existe.");
  const mods = await rows(d, sql`SELECT id, title FROM learning_modules WHERE course_id = ${courseId} ORDER BY position`);
  const lessons = await rows(d, sql`SELECT l.id, l.module_id, l.title FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${courseId} ORDER BY l.position`);
  const blocks = await rows(d, sql`SELECT b.id, b.lesson_id, b.kind, b.title, b.resource_id, b.external_url FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${courseId} ORDER BY b.position`);
  return {
    course: { id: n(c.id), slug: String(c.slug), title: String(c.title), description: c.description ?? null, language: String(c.language), status: String(c.status) as "draft" | "published" | "archived" },
    modules: mods.map((m) => ({
      id: n(m.id), title: String(m.title),
      lessons: lessons.filter((l) => n(l.module_id) === n(m.id)).map((l) => ({
        id: n(l.id), title: String(l.title),
        blocks: blocks.filter((b) => n(b.lesson_id) === n(l.id)).map((b) => ({ id: n(b.id), kind: String(b.kind), title: String(b.title), resourceId: b.resource_id == null ? null : n(b.resource_id), externalUrl: b.external_url ?? null })),
      })),
    })),
  };
}
