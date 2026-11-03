/**
 * Sedes en el Core (capacidad Business `multi-site`).
 *
 *  - Fuente de verdad: el registro del plano de control, por el canal del Core (`commerceClient`, token de servicio
 *    del Core y tenant de la SESIÓN). El Core no guarda otra lista de sedes: solo una caché corta en memoria.
 *  - Aquí se etiquetan por sede las cajas, sus sesiones, las ventas del TPV y los usuarios (migración 0024). NULL =
 *    sede principal, así que lo existente ya está en la principal.
 *  - Sin multiempresa o sin canal con el plano de control solo existe la sede principal (como hoy).
 *  - Essential (sin `multi-site`): una sola sede, sin filtros ni asignaciones; todo funciona exactamente igual.
 */
import { TRPCError } from "@trpc/server";
import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { userSites } from "../drizzle/schema";
import { legacyDb } from "./_core/legacyDb";
import { getTenantId, getTenantMode } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { CommerceError, commerceClientFromEnv, type CommerceClient } from "./commerceClient";
import { MULTI_SITE_CAPABILITY, PRIMARY_SITE_ID, SITE_ID_PATTERN, siteOfStored, storedSiteId, userWorksAtSite, type PanelSites, type SiteFormInput } from "../shared/sites";

/** Operaciones sobre las sedes de una empresa (el canal con el plano de control; las pruebas lo sustituyen). */
export interface SiteSource {
  list(tenantId: string): Promise<PanelSites>;
  create(tenantId: string, input: SiteFormInput & { requestedBy: string }): Promise<PanelSites>;
  update(tenantId: string, siteId: string, input: Partial<SiteFormInput> & { requestedBy: string }): Promise<PanelSites>;
  archive(tenantId: string, siteId: string, input: { requestedBy: string }): Promise<PanelSites>;
  restore(tenantId: string, siteId: string, input: { requestedBy: string }): Promise<PanelSites>;
}

let override: SiteSource | null | undefined;
/** Solo pruebas: fija la fuente de sedes (null = sin canal; undefined = la de siempre). */
export function setSiteSourceForTests(s: SiteSource | null | undefined): void {
  override = s;
  cache.clear();
}

function currentSource(): SiteSource | null {
  if (override !== undefined) return override;
  if (getTenantMode() !== "multi") return null;
  return siteSourceFromClient(commerceClientFromEnv());
}

/** Fuente de sedes sobre el canal del Core con el plano de control (null si el cliente no la ofrece). */
export function siteSourceFromClient(c: CommerceClient | null): SiteSource | null {
  if (!c?.sites || !c.createSite || !c.updateSite || !c.archiveSite || !c.restoreSite) return null;
  return {
    list: (t) => c.sites!(t),
    create: (t, i) => c.createSite!(t, i),
    update: (t, s, i) => c.updateSite!(t, s, i),
    archive: (t, s, i) => c.archiveSite!(t, s, i),
    restore: (t, s, i) => c.restoreSite!(t, s, i),
  };
}

/** ¿Hay canal para gestionar sedes? (sin él, solo la principal implícita). */
export function sitesManaged(): boolean {
  return currentSource() !== null;
}

/** Una sola sede, la principal implícita: sin canal con el plano de control. */
export function singleSite(): PanelSites {
  return {
    sites: [{ siteId: PRIMARY_SITE_ID, name: "Sede principal", status: "active", isPrimary: true, virtual: true, address: null, phone: null, email: null, createdAt: null }],
    primarySiteId: PRIMARY_SITE_ID,
    limit: 1,
    used: 1,
    canAdd: false,
  };
}

const TTL = 30_000;
const MAX_STALE = 10 * 60_000;
const cache = new Map<string, { at: number; value: PanelSites }>();

const TRPC_CODE: Record<number, TRPCError["code"]> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "BAD_REQUEST", 503: "PRECONDITION_FAILED" };
function asTrpc(e: unknown): never {
  if (e instanceof CommerceError) throw new TRPCError({ code: TRPC_CODE[e.status] ?? "INTERNAL_SERVER_ERROR", message: e.message });
  throw e;
}

/** Sedes de la empresa en curso (caché de 30 s; si el plano de control no responde, la última conocida hasta 10 min). */
export async function companySites(): Promise<PanelSites> {
  const src = currentSource();
  if (!src) return singleSite();
  const tenantId = getTenantId();
  const now = Date.now();
  const hit = cache.get(tenantId);
  if (hit && now - hit.at < TTL) return hit.value;
  try {
    const value = await src.list(tenantId);
    cache.set(tenantId, { at: now, value });
    return value;
  } catch (e) {
    if (hit && now - hit.at <= MAX_STALE) return hit.value;
    asTrpc(e);
  }
}

/** Cambio en las sedes de la empresa en curso por el canal (la caché se renueva con la respuesta). */
export async function changeSites(fn: (src: SiteSource, tenantId: string) => Promise<PanelSites>): Promise<PanelSites> {
  const src = currentSource();
  if (!src) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La gestión de sedes no está disponible en esta instalación" });
  const tenantId = getTenantId();
  try {
    const value = await fn(src, tenantId);
    cache.set(tenantId, { at: Date.now(), value });
    return value;
  } catch (e) {
    cache.delete(tenantId);
    asTrpc(e);
  }
}

/** ¿Incluye el plan de la empresa en curso varias sedes? Si no puede verificarse, no. */
export async function multiSiteLicensed(write = false): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(MULTI_SITE_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

/** Exige `multi-site` (consultas: activa o solo lectura; cambios: activa). */
export async function assertMultiSite(write: boolean): Promise<void> {
  if (!(await multiSiteLicensed(write))) throw new TRPCError({ code: "FORBIDDEN", message: "La gestión de varias sedes no está incluida en tu plan." });
}

/**
 * Sede ACTIVA de la empresa elegida para etiquetar un dato: devuelve el valor que se guarda (NULL si es la principal).
 * Una sede distinta de la principal exige `multi-site`.
 */
export async function resolveSiteForWrite(siteId: string | null | undefined): Promise<string | null> {
  if (!siteId) return null;
  if (!SITE_ID_PATTERN.test(siteId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Sede no válida" });
  const sites = await companySites();
  if (siteId === sites.primarySiteId) return null;
  await assertMultiSite(true);
  if (!sites.sites.some((s) => s.siteId === siteId && s.status === "active")) throw new TRPCError({ code: "BAD_REQUEST", message: "La sede no existe o está desactivada" });
  return storedSiteId(siteId, sites.primarySiteId);
}

/** Sede por la que filtrar un listado (exige `multi-site`): la principal incluye todo lo que no tiene sede. */
export async function resolveSiteFilter(siteId: string | null | undefined): Promise<{ siteId: string; isPrimary: boolean } | null> {
  if (!siteId) return null;
  if (!SITE_ID_PATTERN.test(siteId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Sede no válida" });
  await assertMultiSite(false);
  const sites = await companySites();
  if (!sites.sites.some((s) => s.siteId === siteId)) throw new TRPCError({ code: "NOT_FOUND", message: "Sede no encontrada" });
  return { siteId, isPrimary: siteId === sites.primarySiteId };
}

/** Condición SQL de un filtro por sede sobre una columna `site_id` (NULL = principal). */
export function siteCondition(column: MySqlColumn, f: { siteId: string; isPrimary: boolean }): SQL {
  return f.isPrimary ? (or(isNull(column), eq(column, f.siteId)) as SQL) : eq(column, f.siteId);
}

// ── Usuarios por sede ─────────────────────────────────────────────────────────

/** Sedes asignadas a cada usuario (sin entrada: trabaja en todas). */
export async function listUserSiteAssignments(): Promise<Record<number, string[]>> {
  const rows = await legacyDb().select({ userId: userSites.userId, siteId: userSites.siteId }).from(userSites);
  const out: Record<number, string[]> = {};
  for (const r of rows) (out[r.userId] ??= []).push(r.siteId);
  return out;
}

export async function getUserSiteIds(userId: number): Promise<string[]> {
  try {
    const rows = await legacyDb().select({ siteId: userSites.siteId }).from(userSites).where(eq(userSites.userId, userId));
    return rows.map((r) => r.siteId);
  } catch (e) {
    // Empresa sin la migración 0024: nadie tiene sedes asignadas (lo de siempre)
    if ((e as { code?: string; cause?: { code?: string } }).code === "ER_NO_SUCH_TABLE" || (e as { cause?: { code?: string } }).cause?.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

/** Sustituye las sedes de un usuario (lista vacía = todas). Ids ya validados por quien llama. */
export async function setUserSiteIds(userId: number, siteIds: string[]): Promise<void> {
  const unique = Array.from(new Set(siteIds));
  await legacyDb().transaction(async (tx) => {
    await tx.delete(userSites).where(eq(userSites.userId, userId));
    if (unique.length) await tx.insert(userSites).values(unique.map((siteId) => ({ userId, siteId, createdAt: Date.now() })));
  });
}

/**
 * Sedes en las que puede operar el usuario (`null` = todas): administración y Essential, siempre todas; con
 * `multi-site`, las asignadas al usuario (sin asignar, todas).
 */
export async function userSiteScope(user: { id: number; role: string }): Promise<string[] | null> {
  if (user.role === "admin") return null;
  if (!(await multiSiteLicensed(false))) return null;
  const assigned = await getUserSiteIds(user.id);
  return assigned.length ? assigned : null;
}

/** ¿Puede el usuario operar con un dato de esa sede (valor guardado, NULL = principal)? */
export async function userMayUseSite(user: { id: number; role: string }, stored: string | null): Promise<boolean> {
  const scope = await userSiteScope(user);
  if (!scope) return true;
  return userWorksAtSite(scope, siteOfStored(stored, stored ? "" : (await companySites()).primarySiteId));
}
