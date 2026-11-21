/**
 * Elephant Learning · materiales (lote 2): subir, sustituir con seguridad y recuperar ficheros de los recursos de un curso.
 *
 * Garantías:
 *  - Subir NO cambia lo que reciben los alumnos: el fichero nuevo queda `staged` en `learning_resource_files`.
 *  - Publicar es una transacción (recurso `FOR UPDATE`): fija el fichero nuevo en `learning_resources` (mismo id, así que bloques,
 *    lecciones, progreso, matrículas y reglas no se tocan) y conserva el anterior como `replaced`, intacto en el almacén.
 *  - Recuperar vuelve a poner un fichero sustituido (la operación inversa; también conserva el que se retira).
 *  - Nunca se borra ningún objeto: lo que queda sin referencias solo lo libera la conciliación protegida.
 *  - Todo va contra la BD de la empresa en curso. Cada acción queda auditada.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { LearningError, auditAdmin } from "./learningDb";
import { mimeMatchesKind } from "../shared/learning";
import type { MaterialFile, MaterialView } from "../shared/learningMaterials";
export type { MaterialFile, MaterialView } from "../shared/learningMaterials";

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

export interface FileInput { objectId: string; sha256: string; sizeBytes: number; mimeType: string; originalName: string | null }

const mapFile = (r: Row): MaterialFile => ({
  id: n(r.id), status: r.status, objectId: String(r.stored_object_id), sha256: String(r.sha256), sizeBytes: n(r.size_bytes), mimeType: String(r.mime_type),
  originalName: r.original_name ?? null, createdAt: n(r.created_at), activatedAt: r.activated_at == null ? null : n(r.activated_at), replacedAt: r.replaced_at == null ? null : n(r.replaced_at),
});

/** Biblioteca de materiales: cada recurso con dónde se usa, su fichero pendiente y su historial. Solo lectura. */
export async function listMaterials(): Promise<MaterialView[]> {
  const d = await db();
  const res = await rows(d, sql`SELECT id, kind, status, original_name, mime_type, size_bytes, sha256, stored_object_id FROM learning_resources ORDER BY id`);
  const uses = await rows(d, sql`SELECT b.resource_id, b.title AS block_title, l.title AS lesson_title, m.title AS module_title, c.id AS course_id, c.title AS course_title
      FROM learning_blocks b JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id
      WHERE b.resource_id IS NOT NULL ORDER BY c.id, m.position, l.position, b.position`);
  const files = await rows(d, sql`SELECT * FROM learning_resource_files ORDER BY id DESC`).catch((): Row[] => []);
  const byHash = new Map<string, number[]>();
  for (let i = 0; i < res.length; i++) {
    const h = res[i].sha256 ? String(res[i].sha256) : "";
    if (h) byHash.set(h, [...(byHash.get(h) ?? []), n(res[i].id)]);
  }
  return res.map((r) => {
    const id = n(r.id);
    const mine = files.filter((f) => n(f.resource_id) === id).map(mapFile);
    return {
      resourceId: id, kind: String(r.kind), status: String(r.status), originalName: r.original_name ?? null, mimeType: r.mime_type ?? null,
      sizeBytes: r.size_bytes == null ? null : n(r.size_bytes), sha256: r.sha256 ?? null, objectId: r.stored_object_id ?? null,
      uses: uses.filter((u) => n(u.resource_id) === id).map((u) => ({ courseId: n(u.course_id), courseTitle: String(u.course_title), moduleTitle: String(u.module_title), lessonTitle: String(u.lesson_title), blockTitle: String(u.block_title) })),
      staged: mine.find((f) => f.status === "staged") ?? null,
      history: mine.filter((f) => f.status !== "staged"),
      sharedWith: r.sha256 ? (byHash.get(String(r.sha256)) ?? []).filter((x) => x !== id) : [],
    };
  });
}

/** Registra el fichero ya almacenado como pendiente de publicar. Sustituye al pendiente anterior del mismo recurso (solo la fila). */
export async function stageFile(resourceId: number, f: FileInput, actorUserId: number, now = Date.now()): Promise<{ fileId: number; duplicateOf: number[] }> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [res] = await rows(tx, sql`SELECT id, kind FROM learning_resources WHERE id = ${resourceId} FOR UPDATE`);
    if (!res) throw new LearningError("NOT_FOUND", "El recurso no existe.");
    if (!mimeMatchesKind(String(res.kind), f.mimeType)) throw new LearningError("BAD_REQUEST", `El fichero (${f.mimeType}) no corresponde a un recurso de tipo ${res.kind}.`);
    await run(tx, sql`DELETE FROM learning_resource_files WHERE resource_id = ${resourceId} AND status = 'staged'`);
    const dups = await rows(tx, sql`SELECT id FROM learning_resources WHERE sha256 = ${f.sha256} AND id <> ${resourceId}`);
    await run(tx, sql`INSERT INTO learning_resource_files (resource_id, stored_object_id, sha256, size_bytes, mime_type, original_name, status, created_by, created_at)
      VALUES (${resourceId}, ${f.objectId}, ${f.sha256}, ${f.sizeBytes}, ${f.mimeType}, ${f.originalName}, 'staged', ${actorUserId}, ${now})`);
    const [row] = await rows(tx, sql`SELECT LAST_INSERT_ID() AS id`);
    await auditAdmin(tx, actorUserId, "admin_material_staged", { resourceId, sha256: f.sha256, sizeBytes: f.sizeBytes }, now);
    return { fileId: n(row.id), duplicateOf: dups.map((x) => n(x.id)) };
  });
}

/** Descarta el pendiente (solo la fila; el objeto queda sin referencias y solo lo libera la conciliación protegida). */
export async function discardStaged(resourceId: number, actorUserId: number, now = Date.now()): Promise<{ discarded: boolean }> {
  const d = await db();
  return d.transaction(async (tx) => {
    const [res] = await rows(tx, sql`SELECT id FROM learning_resources WHERE id = ${resourceId} FOR UPDATE`);
    if (!res) throw new LearningError("NOT_FOUND", "El recurso no existe.");
    const [s] = await rows(tx, sql`SELECT id FROM learning_resource_files WHERE resource_id = ${resourceId} AND status = 'staged'`);
    if (!s) return { discarded: false };
    await run(tx, sql`DELETE FROM learning_resource_files WHERE id = ${n(s.id)}`);
    await auditAdmin(tx, actorUserId, "admin_material_discarded", { resourceId, fileId: n(s.id) }, now);
    return { discarded: true };
  });
}

/** Pone en `learning_resources` el fichero indicado y guarda el vigente como `replaced`. El destino es una fila staged o replaced. */
async function swapIn(tx: Exec, resourceId: number, fileId: number, expectStatus: "staged" | "replaced", actorUserId: number, audit: string, now: number): Promise<{ changed: boolean }> {
  const [res] = await rows(tx, sql`SELECT id, kind, status, stored_object_id, sha256, size_bytes, mime_type, original_name FROM learning_resources WHERE id = ${resourceId} FOR UPDATE`);
  if (!res) throw new LearningError("NOT_FOUND", "El recurso no existe.");
  const [t] = await rows(tx, sql`SELECT * FROM learning_resource_files WHERE id = ${fileId} AND resource_id = ${resourceId} FOR UPDATE`);
  if (!t) throw new LearningError("NOT_FOUND", "El fichero no existe para este recurso.");
  if (t.status === "active") return { changed: false };
  if (t.status !== expectStatus) throw new LearningError("CONFLICT", "El fichero ya no está en el estado esperado; recarga la pantalla.");
  if (!mimeMatchesKind(String(res.kind), String(t.mime_type))) throw new LearningError("BAD_REQUEST", "El tipo del fichero no corresponde al recurso.");
  if (res.stored_object_id) {
    const [cur] = await rows(tx, sql`SELECT id FROM learning_resource_files WHERE resource_id = ${resourceId} AND status = 'active' AND stored_object_id = ${String(res.stored_object_id)} LIMIT 1`);
    if (cur) await run(tx, sql`UPDATE learning_resource_files SET status = 'replaced', replaced_at = ${now} WHERE id = ${n(cur.id)}`);
    else await run(tx, sql`INSERT INTO learning_resource_files (resource_id, stored_object_id, sha256, size_bytes, mime_type, original_name, status, created_by, created_at, activated_at, replaced_at)
      VALUES (${resourceId}, ${String(res.stored_object_id)}, ${String(res.sha256 ?? "")}, ${n(res.size_bytes)}, ${String(res.mime_type ?? "application/octet-stream")}, ${res.original_name ?? null}, 'replaced', ${actorUserId}, ${now}, ${now}, ${now})`);
  }
  await run(tx, sql`UPDATE learning_resources SET stored_object_id = ${String(t.stored_object_id)}, sha256 = ${String(t.sha256)}, size_bytes = ${n(t.size_bytes)}, mime_type = ${String(t.mime_type)}, status = 'verified',
    original_name = ${t.original_name ?? res.original_name ?? null}, updated_at = ${now} WHERE id = ${resourceId}`);
  await run(tx, sql`UPDATE learning_resource_files SET status = 'active', activated_at = ${now}, replaced_at = NULL WHERE id = ${fileId}`);
  await auditAdmin(tx, actorUserId, audit, { resourceId, fileId, from: res.stored_object_id ?? null, to: String(t.stored_object_id) }, now);
  return { changed: true };
}

/** Publica el fichero pendiente: lo ven los alumnos desde ahora; el anterior se conserva. Idempotente. */
export async function publishStaged(resourceId: number, fileId: number, actorUserId: number, now = Date.now()) {
  const d = await db();
  return d.transaction((tx) => swapIn(tx, resourceId, fileId, "staged", actorUserId, "admin_material_published", now));
}

/** Recupera un fichero sustituido (el vigente pasa a «sustituido»). Idempotente. */
export async function restoreFile(resourceId: number, fileId: number, actorUserId: number, now = Date.now()) {
  const d = await db();
  return d.transaction((tx) => swapIn(tx, resourceId, fileId, "replaced", actorUserId, "admin_material_restored", now));
}

/** Objeto de un fichero pendiente o sustituido, para la vista previa de administración. */
export async function previewFile(fileId: number): Promise<{ objectId: string; kind: string; originalName: string | null } | null> {
  const d = await db();
  const [r] = await rows(d, sql`SELECT f.stored_object_id, f.original_name, r.kind FROM learning_resource_files f JOIN learning_resources r ON r.id = f.resource_id WHERE f.id = ${fileId}`);
  return r ? { objectId: String(r.stored_object_id), kind: String(r.kind), originalName: r.original_name ?? null } : null;
}
