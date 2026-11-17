/**
 * Redirecciones permanentes por empresa (tablas `site_redirects` y `site_redirect_log`, migración 0074).
 *
 * - Cada empresa tiene su propia BD: las reglas nunca se cruzan entre empresas. La caché va por empresa.
 * - La resolución nunca rompe la web: sin tabla, sin BD o con cualquier error, no redirige y la petición sigue su curso.
 * - Cada alta, cambio y baja queda en `site_redirect_log` con quién y cuándo.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { peekTenantContext } from "./_core/tenant";
import { REDIRECT_LIMITS, buildRedirectIndex, normalizeFromPath, planRenameRedirects, resolveRedirect, validateRedirect, type RedirectIndex, type RedirectRule } from "../shared/redirects";

export interface StoredRedirect extends RedirectRule {
  id: number;
  note: string | null;
  hits: number;
  lastHitAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RedirectLogRow { id: number; redirectId: number | null; action: string; fromPath: string; toPath: string | null; statusCode: number | null; actorName: string | null; createdAt: string }
export class RedirectError extends Error {}

type Row = Record<string, any>;
const TTL_MS = 15_000;
// La caché es por proceso: con varias réplicas, un cambio tarda hasta TTL_MS en verse en las demás (aceptable para redirecciones).
const cache = new Map<string, { at: number; index: RedirectIndex }>();
const warned = new Set<string>();
const tenantKey = () => peekTenantContext()?.tenantId ?? "single";
export const invalidateRedirectCache = () => { cache.delete(tenantKey()); };
/** Solo para pruebas */
export const clearRedirectCache = () => cache.clear();

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [r] = (await d.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}
async function run(q: ReturnType<typeof sql>): Promise<{ insertId: number; affected: number }> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [h] = (await d.execute(q)) as unknown as [{ insertId?: number; affectedRows?: number }];
  return { insertId: Number(h?.insertId ?? 0), affected: Number(h?.affectedRows ?? 0) };
}
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);
const toStored = (r: Row): StoredRedirect => ({
  id: Number(r.id), fromPath: String(r.from_path), toPath: String(r.to_path), statusCode: Number(r.status_code), isActive: !!Number(r.is_active),
  note: r.note ?? null, hits: Number(r.hits ?? 0), lastHitAt: iso(r.last_hit_at), createdBy: r.created_by ?? null, createdAt: iso(r.created_at) ?? "", updatedAt: iso(r.updated_at) ?? "",
});

export async function listRedirects(): Promise<StoredRedirect[]> {
  return (await rows(sql`SELECT * FROM site_redirects ORDER BY from_path ASC LIMIT ${REDIRECT_LIMITS.rules + 1}`)).map(toStored);
}

export async function listRedirectLog(limit = 100): Promise<RedirectLogRow[]> {
  const r = await rows(sql`SELECT * FROM site_redirect_log ORDER BY id DESC LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`);
  return r.map((x) => ({ id: Number(x.id), redirectId: x.redirect_id == null ? null : Number(x.redirect_id), action: String(x.action), fromPath: String(x.from_path), toPath: x.to_path ?? null, statusCode: x.status_code == null ? null : Number(x.status_code), actorName: x.actor_name ?? null, createdAt: iso(x.created_at) ?? "" }));
}

/** Rutas públicas que ya existen y que una regla taparía (páginas y fichas de producto publicadas), en minúsculas. */
export async function existingPublicPaths(): Promise<Set<string>> {
  const out = new Set<string>();
  const pages = await rows(sql`SELECT slug FROM static_pages WHERE isPublished = 1`);
  for (const p of pages) { const s = String(p.slug ?? "").toLowerCase(); if (s) { out.add(`/${s}`); out.add(`/pagina/${s}`); } }
  const products = await rows(sql`SELECT slug FROM experiences WHERE isPublished = 1`);
  for (const p of products) { const s = String(p.slug ?? "").toLowerCase(); if (s) { out.add(`/tienda/${s}`); out.add(`/experiencias/${s}`); } }
  return out;
}

async function log(action: string, redirectId: number | null, r: { fromPath: string; toPath?: string | null; statusCode?: number | null }, actor: { id?: number | null; name?: string | null }) {
  await run(sql`INSERT INTO site_redirect_log (redirect_id, action, from_path, to_path, status_code, actor_id, actor_name) VALUES (${redirectId}, ${action}, ${r.fromPath}, ${r.toPath ?? null}, ${r.statusCode ?? null}, ${actor.id ?? null}, ${(actor.name ?? "").slice(0, 128) || null})`);
}

/** Dos altas a la vez con el mismo origen: el usuario ve el mensaje de siempre, no un error de SQL. */
function dupToError(e: unknown): never {
  if (/ER_DUP_ENTRY|Duplicate entry/i.test(String((e as { message?: string; cause?: { message?: string } })?.message ?? "") + String((e as { cause?: { message?: string } })?.cause?.message ?? ""))) throw new RedirectError("Ya hay una redirección desde esa ruta.");
  throw e;
}

export interface RedirectInput { fromPath: string; toPath: string; statusCode?: number; isActive?: boolean; note?: string | null }

export async function checkRedirect(input: RedirectInput, selfId?: number) {
  const all = await listRedirects();
  return validateRedirect(input, all, { existingPaths: await existingPublicPaths(), selfId });
}

export async function createRedirect(input: RedirectInput, actor: { id?: number | null; name?: string | null }): Promise<StoredRedirect> {
  const v = await checkRedirect(input);
  if (!v.ok) throw new RedirectError(v.error);
  const status = input.statusCode === 302 ? 302 : 301;
  const note = (input.note ?? "").trim().slice(0, REDIRECT_LIMITS.note) || null;
  const { insertId } = await run(sql`INSERT INTO site_redirects (from_path, to_path, status_code, is_active, note, created_by) VALUES (${v.fromPath}, ${v.toPath}, ${status}, ${input.isActive === false ? 0 : 1}, ${note}, ${(actor.name ?? "").slice(0, 128) || null})`).catch(dupToError);
  await log("create", insertId, { fromPath: v.fromPath, toPath: v.toPath, statusCode: status }, actor);
  invalidateRedirectCache();
  return (await listRedirects()).find((r) => r.id === insertId)!;
}

export async function updateRedirect(id: number, input: RedirectInput, actor: { id?: number | null; name?: string | null }): Promise<StoredRedirect> {
  const [cur] = await rows(sql`SELECT id FROM site_redirects WHERE id = ${id}`);
  if (!cur) throw new RedirectError("Esa redirección ya no existe.");
  const v = await checkRedirect(input, id);
  if (!v.ok) throw new RedirectError(v.error);
  const status = input.statusCode === 302 ? 302 : 301;
  const note = (input.note ?? "").trim().slice(0, REDIRECT_LIMITS.note) || null;
  await run(sql`UPDATE site_redirects SET from_path = ${v.fromPath}, to_path = ${v.toPath}, status_code = ${status}, is_active = ${input.isActive === false ? 0 : 1}, note = ${note} WHERE id = ${id}`).catch(dupToError);
  await log("update", id, { fromPath: v.fromPath, toPath: v.toPath, statusCode: status }, actor);
  invalidateRedirectCache();
  return (await listRedirects()).find((r) => r.id === id)!;
}

export async function deleteRedirect(id: number, actor: { id?: number | null; name?: string | null }): Promise<void> {
  const [cur] = await rows(sql`SELECT from_path, to_path, status_code FROM site_redirects WHERE id = ${id}`);
  if (!cur) throw new RedirectError("Esa redirección ya no existe.");
  await run(sql`DELETE FROM site_redirects WHERE id = ${id}`);
  await log("delete", id, { fromPath: String(cur.from_path), toPath: cur.to_path, statusCode: Number(cur.status_code) }, actor);
  invalidateRedirectCache();
}

/**
 * Una página cambia de dirección: se conserva el enlace antiguo con un 301 (y se aplanan cadenas y se retiran reglas que
 * taparían la página). Best-effort: si algo falla (p. ej. empresa aún sin migrar) no se interrumpe el cambio de dirección.
 */
export async function redirectOnRename(oldPath: string, newPath: string, actor: { id?: number | null; name?: string | null }, opts: { published?: boolean } = {}): Promise<void> {
  try {
    // Una página sin publicar no existe para el público: un 301 hacia ella sería un 301 hacia un 404
    if (opts.published === false) return;
    const all = await listRedirects();
    const plan = planRenameRedirects(all, oldPath, newPath);
    if (!plan) return;
    for (const id of plan.remove) {
      const cur = all.find((r) => r.id === id);
      await run(sql`DELETE FROM site_redirects WHERE id = ${id}`);
      if (cur) await log("delete", id, { fromPath: cur.fromPath, toPath: cur.toPath, statusCode: cur.statusCode }, actor);
    }
    for (const t of plan.retarget) {
      const cur = all.find((r) => r.id === t.id);
      await run(sql`UPDATE site_redirects SET to_path = ${t.toPath} WHERE id = ${t.id}`);
      if (cur) await log("update", t.id, { fromPath: cur.fromPath, toPath: t.toPath, statusCode: cur.statusCode }, actor);
    }
    if (!plan.upsert.id && all.length - plan.remove.length >= REDIRECT_LIMITS.rules) { invalidateRedirectCache(); return; }
    if (plan.upsert.id) {
      await run(sql`UPDATE site_redirects SET to_path = ${plan.upsert.toPath}, status_code = 301, is_active = 1 WHERE id = ${plan.upsert.id}`);
      await log("update", plan.upsert.id, { fromPath: plan.upsert.fromPath, toPath: plan.upsert.toPath, statusCode: 301 }, actor);
    } else {
      const { insertId } = await run(sql`INSERT INTO site_redirects (from_path, to_path, status_code, is_active, note, created_by) VALUES (${plan.upsert.fromPath}, ${plan.upsert.toPath}, 301, 1, ${"Cambio de dirección de la página"}, ${(actor.name ?? "").slice(0, 128) || null})`);
      await log("create", insertId, { fromPath: plan.upsert.fromPath, toPath: plan.upsert.toPath, statusCode: 301 }, actor);
    }
    invalidateRedirectCache();
  } catch (e) {
    console.warn("[redirects] no se pudo registrar la redirección del cambio de dirección:", (e as Error).message);
  }
}

async function activeIndex(): Promise<RedirectIndex> {
  const key = tenantKey();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.index;
  const index = buildRedirectIndex((await listRedirects()).filter((r) => r.isActive).map((r) => ({ id: r.id, fromPath: r.fromPath, toPath: r.toPath, statusCode: r.statusCode, isActive: true })));
  cache.set(key, { at: Date.now(), index });
  return index;
}

// Contadores de uso agrupados: como mucho una escritura cada 30 s por empresa (los rastreadores no saturan la BD)
const pendingHits = new Map<string, Map<number, number>>();
const lastFlush = new Map<string, number>();
function countHit(id: number) {
  const key = tenantKey();
  const m = pendingHits.get(key) ?? new Map<number, number>();
  m.set(id, (m.get(id) ?? 0) + 1);
  pendingHits.set(key, m);
  const now = Date.now();
  if (now - (lastFlush.get(key) ?? 0) < 30_000) return;
  lastFlush.set(key, now);
  pendingHits.delete(key);
  m.forEach((n, rid) => { void run(sql`UPDATE site_redirects SET hits = hits + ${n}, last_hit_at = NOW() WHERE id = ${rid}`).catch(() => {}); });
}

/**
 * Redirección aplicable a una petición pública de la empresa en curso, o `null`. El servidor solo la consulta cuando la ruta
 * NO existe (404). Nunca lanza: ante cualquier fallo (tabla aún sin migrar incluida) no redirige y la web se sirve como siempre.
 */
export async function resolveTenantRedirect(pathname: string, search = ""): Promise<{ to: string; status: 301 | 302 } | null> {
  try {
    const index = await activeIndex();
    if (!index.size) return null;
    const hit = resolveRedirect(index, pathname, search);
    if (!hit) return null;
    if (hit.ruleId) countHit(hit.ruleId);
    return { to: hit.to, status: hit.status };
  } catch (e) {
    // Sin tabla (empresa aún sin migrar) o BD no disponible: la web sigue como siempre. Se recuerda un rato para no consultar en cada visita.
    const key = tenantKey();
    cache.set(key, { at: Date.now(), index: new Map() });
    if (!warned.has(key)) { warned.add(key); console.warn("[redirects] sin redirecciones para esta empresa (¿falta la migración 0074?):", (e as Error).message); }
    return null;
  }
}

export { normalizeFromPath };
