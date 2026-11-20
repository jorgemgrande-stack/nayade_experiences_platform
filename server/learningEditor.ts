/**
 * Elephant Learning · editor de formación (lote 1): borrador, publicación y versiones de la estructura y los textos de un curso.
 *
 * Todo va contra la BD de la empresa en curso (una base de datos por empresa), igual que el resto del LMS.
 *
 * Garantías:
 *  - Editar NO cambia lo que ven los alumnos: el borrador vive en `learning_course_drafts`. Solo «publicar» toca las tablas vivas.
 *  - Los elementos conservan su `id`: el progreso, las matrículas por módulo y los accesos no se ven afectados.
 *  - Publicar es una transacción: bloquea el curso, comprueba que lo publicado no cambió desde que se abrió el borrador (huella),
 *    guarda el estado anterior como versión y aplica solo lo que cambia. No se borra ninguna fila ni ningún fichero.
 *  - Recuperar una versión la carga como borrador; se publica por el mismo camino.
 */
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { LearningError } from "./learningDb";
import {
  canonicalJson, diffTrees, normalizeTree, reconcileSnapshot, summarizeChanges, validateDraft,
  type EditorTree, type TreeChange,
} from "../shared/learningEditor";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;
async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}
async function rows<T = Record<string, any>>(exec: Exec, q: SQL): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}
async function run(exec: Exec, q: SQL) { await exec.execute(q); }
const n = (v: unknown) => Number(v ?? 0);

export const treeHash = (t: EditorTree): string => createHash("sha256").update(canonicalJson(t)).digest("hex");

interface LiveRow { tree: EditorTree; positions: { modules: Map<number, number>; lessons: Map<number, number>; blocks: Map<number, number> } }

/** Estructura publicada del curso (orden por `position`). */
async function loadLive(exec: Exec, courseId: number): Promise<LiveRow> {
  const [c] = await rows(exec, sql`SELECT id, title, description FROM learning_courses WHERE id = ${courseId}`);
  if (!c) throw new LearningError("NOT_FOUND", "El curso no existe.");
  const mods = await rows(exec, sql`SELECT id, position, title FROM learning_modules WHERE course_id = ${courseId} ORDER BY position, id`);
  const lessons = await rows(exec, sql`SELECT l.id, l.module_id, l.position, l.title FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${courseId} ORDER BY l.position, l.id`);
  const blocks = await rows(exec, sql`SELECT b.id, b.lesson_id, b.position, b.title, b.body, b.attribution FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${courseId} ORDER BY b.position, b.id`);
  const positions = { modules: new Map<number, number>(), lessons: new Map<number, number>(), blocks: new Map<number, number> };
  mods.forEach((m) => positions.modules.set(n(m.id), n(m.position)));
  lessons.forEach((l) => positions.lessons.set(n(l.id), n(l.position)));
  blocks.forEach((b) => positions.blocks.set(n(b.id), n(b.position)));
  const tree: EditorTree = {
    course: { title: String(c.title), description: c.description ?? null },
    modules: mods.map((m) => ({
      id: n(m.id), title: String(m.title),
      lessons: lessons.filter((l) => n(l.module_id) === n(m.id)).map((l) => ({
        id: n(l.id), title: String(l.title),
        blocks: blocks.filter((b) => n(b.lesson_id) === n(l.id)).map((b) => ({ id: n(b.id), title: String(b.title), body: b.body ?? null, attribution: b.attribution ?? null })),
      })),
    })),
  };
  return { tree, positions };
}

const parseTree = (text: unknown): EditorTree => JSON.parse(String(text)) as EditorTree;

export interface VersionInfo { id: number; version: number; summary: string | null; note: string | null; createdBy: number | null; createdAt: number }

export interface BlockMeta { kind: string; resourceKind: string | null; resourceStatus: string | null; durationSeconds: number | null }

export interface EditorState {
  course: { id: number; slug: string; status: string };
  live: EditorTree;
  draft: EditorTree | null;
  draftInfo: { updatedAt: number; updatedBy: number | null; stale: boolean } | null;
  changes: TreeChange[];
  versions: VersionInfo[];
  blockMeta: Record<number, BlockMeta>;
  /** Alumnos con matrícula vigente y con progreso: el editor avisa de que el curso está en uso. */
  usage: { activeEnrollments: number; learnersWithProgress: number };
}

export async function getEditorState(courseId: number): Promise<EditorState> {
  const d = await db();
  const [course] = await rows(d, sql`SELECT id, slug, status FROM learning_courses WHERE id = ${courseId}`);
  if (!course) throw new LearningError("NOT_FOUND", "El curso no existe.");
  const { tree: live } = await loadLive(d, courseId);
  const [dr] = await rows(d, sql`SELECT doc, base_hash, updated_at, updated_by FROM learning_course_drafts WHERE course_id = ${courseId}`);
  const draft = dr ? parseTree(dr.doc) : null;
  const versions = await listVersions(courseId);
  const meta = await rows(d, sql`SELECT b.id, b.kind, b.duration_seconds, r.kind AS rkind, r.status AS rstatus FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id LEFT JOIN learning_resources r ON r.id = b.resource_id WHERE m.course_id = ${courseId}`);
  const blockMeta: Record<number, BlockMeta> = {};
  meta.forEach((b) => { blockMeta[n(b.id)] = { kind: String(b.kind), resourceKind: b.rkind ?? null, resourceStatus: b.rstatus ?? null, durationSeconds: b.duration_seconds == null ? null : n(b.duration_seconds) }; });
  const [en] = await rows(d, sql`SELECT COUNT(*) AS c FROM learning_enrollments WHERE course_id = ${courseId} AND status = 'active'`);
  const [pr] = await rows(d, sql`SELECT COUNT(DISTINCT p.user_id) AS c FROM learning_progress p JOIN learning_lessons l ON l.id = p.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${courseId}`);
  return {
    course: { id: n(course.id), slug: String(course.slug), status: String(course.status) },
    live, draft,
    draftInfo: dr ? { updatedAt: n(dr.updated_at), updatedBy: dr.updated_by == null ? null : n(dr.updated_by), stale: String(dr.base_hash) !== treeHash(live) } : null,
    changes: draft ? diffTrees(live, normalizeTree(draft)) : [],
    versions, blockMeta,
    usage: { activeEnrollments: n(en?.c), learnersWithProgress: n(pr?.c) },
  };
}

export async function listVersions(courseId: number): Promise<VersionInfo[]> {
  const d = await db();
  const list = await rows(d, sql`SELECT id, version, summary, note, created_by, created_at FROM learning_course_versions WHERE course_id = ${courseId} ORDER BY version DESC LIMIT 100`);
  return list.map((v) => ({ id: n(v.id), version: n(v.version), summary: v.summary ?? null, note: v.note ?? null, createdBy: v.created_by == null ? null : n(v.created_by), createdAt: n(v.created_at) }));
}

function assertValid(live: EditorTree, draft: EditorTree) {
  const errors = validateDraft(live, draft);
  if (errors.length) throw new LearningError("BAD_REQUEST", errors.slice(0, 5).join(" "));
}

/**
 * Guarda el borrador (crea o sustituye). Rechaza lo que no sea una edición de textos/orden de lo publicado. `expectedUpdatedAt`
 * evita que dos pestañas se pisen: si el borrador cambió desde que se cargó, devuelve CONFLICT.
 */
export async function saveDraft(courseId: number, tree: EditorTree, actorUserId: number, expectedUpdatedAt: number | null = null, now = Date.now()): Promise<{ updatedAt: number }> {
  const d = await db();
  return d.transaction(async (tx) => {
    await run(tx, sql`SELECT id FROM learning_courses WHERE id = ${courseId} FOR UPDATE`);
    const { tree: live } = await loadLive(tx, courseId);
    const draft = normalizeTree(tree);
    assertValid(live, draft);
    const [cur] = await rows(tx, sql`SELECT base_hash, updated_at FROM learning_course_drafts WHERE course_id = ${courseId} FOR UPDATE`);
    if (cur && expectedUpdatedAt != null && n(cur.updated_at) !== expectedUpdatedAt) throw new LearningError("CONFLICT", "El borrador ha cambiado en otra ventana. Recarga el editor para no perder cambios.");
    if (!cur && expectedUpdatedAt != null) throw new LearningError("CONFLICT", "El borrador ya no existe. Recarga el editor.");
    const doc = JSON.stringify(draft);
    if (cur) await run(tx, sql`UPDATE learning_course_drafts SET doc = ${doc}, updated_by = ${actorUserId}, updated_at = ${now} WHERE course_id = ${courseId}`);
    else await run(tx, sql`INSERT INTO learning_course_drafts (course_id, doc, base_hash, created_by, created_at, updated_by, updated_at) VALUES (${courseId}, ${doc}, ${treeHash(live)}, ${actorUserId}, ${now}, ${actorUserId}, ${now})`);
    return { updatedAt: now };
  });
}

/** Descarta el borrador. Lo publicado y las versiones no se tocan. */
export async function discardDraft(courseId: number): Promise<{ discarded: boolean }> {
  const d = await db();
  const [cur] = await rows(d, sql`SELECT course_id FROM learning_course_drafts WHERE course_id = ${courseId}`);
  if (!cur) return { discarded: false };
  await run(d, sql`DELETE FROM learning_course_drafts WHERE course_id = ${courseId}`);
  return { discarded: true };
}

export interface PublishResult { published: boolean; version: number | null; changes: number; summary: string }

/** Aplica el borrador a lo publicado (transacción única). Guarda antes el estado anterior como versión recuperable. */
export async function publishDraft(courseId: number, actorUserId: number, note: string | null = null, now = Date.now()): Promise<PublishResult> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [c0] = await rows(tx, sql`SELECT id FROM learning_courses WHERE id = ${courseId} FOR UPDATE`);
    if (!c0) throw new LearningError("NOT_FOUND", "El curso no existe.");
    const [dr] = await rows(tx, sql`SELECT doc, base_hash FROM learning_course_drafts WHERE course_id = ${courseId} FOR UPDATE`);
    if (!dr) throw new LearningError("BAD_REQUEST", "No hay ningún borrador que publicar.");
    const { tree: live, positions } = await loadLive(tx, courseId);
    if (String(dr.base_hash) !== treeHash(live)) throw new LearningError("CONFLICT", "Lo publicado ha cambiado desde que se abrió el borrador (por ejemplo, por una importación). Descarta el borrador y vuelve a empezar para no pisar esos cambios.");
    const draft = normalizeTree(parseTree(dr.doc));
    assertValid(live, draft);
    const changes = diffTrees(live, draft);
    if (!changes.length) {
      await run(tx, sql`DELETE FROM learning_course_drafts WHERE course_id = ${courseId}`);
      return { published: false, version: null, changes: 0, summary: "Sin cambios" };
    }
    const [mx] = await rows(tx, sql`SELECT COALESCE(MAX(version), 0) AS v FROM learning_course_versions WHERE course_id = ${courseId}`);
    const version = n(mx?.v) + 1;
    const summary = summarizeChanges(changes);
    await run(tx, sql`INSERT INTO learning_course_versions (course_id, version, snapshot, state_hash, summary, note, created_by, created_at) VALUES (${courseId}, ${version}, ${canonicalJson(live)}, ${treeHash(live)}, ${summary}, ${note ? note.slice(0, 300) : null}, ${actorUserId}, ${now})`);

    if (live.course.title !== draft.course.title || (live.course.description ?? null) !== (draft.course.description ?? null)) {
      await run(tx, sql`UPDATE learning_courses SET title = ${draft.course.title}, description = ${draft.course.description}, updated_at = ${now} WHERE id = ${courseId}`);
    }
    for (let mi = 0; mi < draft.modules.length; mi++) {
      const m = draft.modules[mi];
      const lm = live.modules.find((x) => x.id === m.id)!;
      if (lm.title !== m.title || positions.modules.get(m.id) !== mi + 1) await run(tx, sql`UPDATE learning_modules SET title = ${m.title}, position = ${mi + 1}, updated_at = ${now} WHERE id = ${m.id} AND course_id = ${courseId}`);
      for (let li = 0; li < m.lessons.length; li++) {
        const l = m.lessons[li];
        const ll = lm.lessons.find((x) => x.id === l.id)!;
        if (ll.title !== l.title || positions.lessons.get(l.id) !== li + 1) await run(tx, sql`UPDATE learning_lessons SET title = ${l.title}, position = ${li + 1}, updated_at = ${now} WHERE id = ${l.id} AND module_id = ${m.id}`);
        for (let bi = 0; bi < l.blocks.length; bi++) {
          const b = l.blocks[bi];
          const lb = ll.blocks.find((x) => x.id === b.id)!;
          if (lb.title !== b.title || (lb.body ?? null) !== (b.body ?? null) || (lb.attribution ?? null) !== (b.attribution ?? null) || positions.blocks.get(b.id) !== bi + 1) {
            await run(tx, sql`UPDATE learning_blocks SET title = ${b.title}, body = ${b.body}, attribution = ${b.attribution}, position = ${bi + 1}, updated_at = ${now} WHERE id = ${b.id} AND lesson_id = ${l.id}`);
          }
        }
      }
    }
    await run(tx, sql`DELETE FROM learning_course_drafts WHERE course_id = ${courseId}`);
    return { published: true, version, changes: changes.length, summary };
  });
}

/**
 * Carga una versión anterior como borrador (no publica nada). Si ya hay un borrador con cambios hay que confirmar que se sustituye
 * (`replace`). Lo creado después de esa versión se conserva con sus textos actuales.
 */
export async function restoreVersion(courseId: number, versionId: number, actorUserId: number, replace: boolean, now = Date.now()): Promise<{ changes: number }> {
  const d = await db();
  return d.transaction(async (tx) => {
    await run(tx, sql`SELECT id FROM learning_courses WHERE id = ${courseId} FOR UPDATE`);
    const [v] = await rows(tx, sql`SELECT snapshot FROM learning_course_versions WHERE id = ${versionId} AND course_id = ${courseId}`);
    if (!v) throw new LearningError("NOT_FOUND", "La versión no existe.");
    const { tree: live } = await loadLive(tx, courseId);
    const draft = normalizeTree(reconcileSnapshot(live, parseTree(v.snapshot)));
    assertValid(live, draft);
    const [cur] = await rows(tx, sql`SELECT doc, base_hash FROM learning_course_drafts WHERE course_id = ${courseId} FOR UPDATE`);
    if (cur && !replace) {
      const hasChanges = diffTrees(live, normalizeTree(parseTree(cur.doc))).length > 0;
      if (hasChanges) throw new LearningError("CONFLICT", "Ya hay un borrador con cambios sin publicar. Confirma que quieres sustituirlo por esta versión.");
    }
    const doc = JSON.stringify(draft);
    if (cur) await run(tx, sql`UPDATE learning_course_drafts SET doc = ${doc}, base_hash = ${treeHash(live)}, updated_by = ${actorUserId}, updated_at = ${now} WHERE course_id = ${courseId}`);
    else await run(tx, sql`INSERT INTO learning_course_drafts (course_id, doc, base_hash, created_by, created_at, updated_by, updated_at) VALUES (${courseId}, ${doc}, ${treeHash(live)}, ${actorUserId}, ${now}, ${actorUserId}, ${now})`);
    return { changes: diffTrees(live, draft).length };
  });
}
