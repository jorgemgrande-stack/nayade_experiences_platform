/**
 * Elephant LMS: aplicación IDEMPOTENTE de un plan de importación (shared/learningImport.ts) sobre la BD de la empresa.
 *
 * - Cursos por `slug`, módulos y lecciones por `source_key`, bloques por (`lesson_id`, `source_key`): reimportar actualiza
 *   títulos y orden y NO duplica.
 * - Cada bloque con fichero crea UN recurso `pending` (sin fichero: nunca un marcador presentado como contenido real) y lo
 *   conserva al reimportar; si el recurso ya fue verificado (con fichero), no se toca.
 * - El curso nace en borrador: nada se abre al público ni a los alumnos hasta publicarlo expresamente.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import type { ImportPlan } from "../shared/learningImport";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;
async function rows<T = Record<string, any>>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}
async function run(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r?.affectedRows ?? 0), insertId: Number(r?.insertId ?? 0) };
}
const n = (v: unknown) => Number(v ?? 0);

export interface ImportResult {
  courseId: number;
  courseStatus: string;
  created: { course: number; modules: number; lessons: number; blocks: number; resources: number };
  updated: { modules: number; lessons: number; blocks: number };
}

export async function applyImportPlan(plan: ImportPlan): Promise<ImportResult> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const now = Date.now();
  return d.transaction(async (tx) => {
    const res: ImportResult = { courseId: 0, courseStatus: "draft", created: { course: 0, modules: 0, lessons: 0, blocks: 0, resources: 0 }, updated: { modules: 0, lessons: 0, blocks: 0 } };
    const [c0] = await rows(tx, sql`SELECT id, status FROM learning_courses WHERE slug = ${plan.course.slug} FOR UPDATE`);
    if (c0) {
      res.courseId = n(c0.id);
      res.courseStatus = String(c0.status);
      await run(tx, sql`UPDATE learning_courses SET title = ${plan.course.title}, language = ${plan.course.language}, source_note = ${plan.course.sourceNote}, updated_at = ${now} WHERE id = ${res.courseId}`);
    } else {
      res.courseId = (await run(tx, sql`INSERT INTO learning_courses (slug, title, language, status, source_note, created_at, updated_at) VALUES (${plan.course.slug}, ${plan.course.title}, ${plan.course.language}, 'draft', ${plan.course.sourceNote}, ${now}, ${now})`)).insertId;
      res.created.course = 1;
    }
    for (const m of plan.modules) {
      let [mr] = await rows(tx, sql`SELECT id FROM learning_modules WHERE course_id = ${res.courseId} AND source_key = ${m.sourceKey} FOR UPDATE`);
      if (mr) {
        await run(tx, sql`UPDATE learning_modules SET position = ${m.position}, title = ${m.title}, original_title = ${m.originalTitle}, source_url = ${m.sourceUrl}, updated_at = ${now} WHERE id = ${n(mr.id)}`);
        res.updated.modules += 1;
      } else {
        const id = (await run(tx, sql`INSERT INTO learning_modules (course_id, position, title, original_title, source_url, source_key, created_at, updated_at) VALUES (${res.courseId}, ${m.position}, ${m.title}, ${m.originalTitle}, ${m.sourceUrl}, ${m.sourceKey}, ${now}, ${now})`)).insertId;
        mr = { id };
        res.created.modules += 1;
      }
      const moduleId = n(mr.id);
      for (const l of m.lessons) {
        let [lr] = await rows(tx, sql`SELECT id FROM learning_lessons WHERE module_id = ${moduleId} AND source_key = ${l.sourceKey} FOR UPDATE`);
        if (lr) {
          await run(tx, sql`UPDATE learning_lessons SET position = ${l.position}, title = ${l.title}, original_title = ${l.title}, source_url = ${l.sourceUrl}, updated_at = ${now} WHERE id = ${n(lr.id)}`);
          res.updated.lessons += 1;
        } else {
          const id = (await run(tx, sql`INSERT INTO learning_lessons (module_id, position, title, original_title, source_url, source_key, created_at, updated_at) VALUES (${moduleId}, ${l.position}, ${l.title}, ${l.title}, ${l.sourceUrl}, ${l.sourceKey}, ${now}, ${now})`)).insertId;
          lr = { id };
          res.created.lessons += 1;
        }
        const lessonId = n(lr.id);
        for (const b of l.blocks) {
          const [br] = await rows(tx, sql`SELECT id, resource_id FROM learning_blocks WHERE lesson_id = ${lessonId} AND source_key = ${b.sourceKey} FOR UPDATE`);
          let resourceId: number | null = br?.resource_id == null ? null : n(br.resource_id);
          if (b.resource && resourceId == null) {
            resourceId = (await run(tx, sql`INSERT INTO learning_resources (kind, original_name, status, provenance, created_at, updated_at) VALUES (${b.resource.kind}, ${b.resource.originalName}, 'pending', ${b.resource.provenance}, ${now}, ${now})`)).insertId;
            res.created.resources += 1;
          }
          if (br) {
            await run(tx, sql`UPDATE learning_blocks SET position = ${b.position}, kind = ${b.kind}, title = ${b.title}, original_title = ${b.originalTitle}, body = ${b.body}, resource_id = ${resourceId}, external_url = ${b.externalUrl},
              duration_seconds = ${b.durationSeconds}, activity = ${b.activity}, updated_at = ${now} WHERE id = ${n(br.id)}`);
            res.updated.blocks += 1;
          } else {
            await run(tx, sql`INSERT INTO learning_blocks (lesson_id, position, kind, title, original_title, body, resource_id, external_url, duration_seconds, activity, source_key, created_at, updated_at)
              VALUES (${lessonId}, ${b.position}, ${b.kind}, ${b.title}, ${b.originalTitle}, ${b.body}, ${resourceId}, ${b.externalUrl}, ${b.durationSeconds}, ${b.activity}, ${b.sourceKey}, ${now}, ${now})`);
            res.created.blocks += 1;
          }
        }
      }
    }
    return res;
  });
}

/** Estado de cobertura real de un curso: bloques con y sin fichero verificado (los marcadores nunca cuentan como contenido). */
export async function courseCoverage(courseId: number) {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const list = await rows(d, sql`SELECT b.kind, r.status AS resource_status, COUNT(*) AS total
    FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id LEFT JOIN learning_resources r ON r.id = b.resource_id
    WHERE m.course_id = ${courseId} GROUP BY b.kind, r.status`);
  const out = { byKind: {} as Record<string, { total: number; verified: number; pending: number }>, files: { verified: 0, pending: 0 } };
  for (const r of list) {
    const k = String(r.kind);
    const e = (out.byKind[k] ??= { total: 0, verified: 0, pending: 0 });
    e.total += n(r.total);
    if (r.resource_status === "verified") e.verified += n(r.total);
    if (r.resource_status === "pending") e.pending += n(r.total);
  }
  for (const e of Object.values(out.byKind)) { out.files.verified += e.verified; out.files.pending += e.pending; }
  return out;
}
