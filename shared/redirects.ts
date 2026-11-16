/**
 * Redirecciones permanentes por empresa: reglas puras (validación, bucles, cadenas y resolución). Sin BD ni red.
 *
 * Principios:
 *  - Solo destinos INTERNOS (ruta de la propia web). Nunca otro dominio: así no hay «open redirect» ni cruce entre empresas.
 *  - Ninguna regla puede tapar una ruta que ya existe (página publicada, ficha de producto) ni el panel, la API o los ficheros.
 *  - Sin bucles (A→B→A) y sin cadenas (A→B→C): el destino de una regla no puede ser el origen de otra; se apunta siempre al final.
 *  - Las rutas localizadas se tratan tal cual llegan (`/de/…` es una ruta distinta de `/es/…`).
 */
import { cleanPath, isSafeRedirectTarget } from "./i18n";

export const REDIRECT_STATUSES = [301, 302] as const;
export const REDIRECT_LIMITS = { from: 255, to: 512, note: 255, rules: 2000 } as const;

/** Rutas que ninguna regla puede tomar como origen (panel, API, ficheros, plano de control, SEO técnico). */
export const PROTECTED_PREFIXES = ["/api", "/cp", "/admin", "/empleado", "/partner", "/supplier", "/gestoria", "/assets", "/local-storage", "/uploads", "/.well-known"] as const;
export const PROTECTED_EXACT = ["/", "/sitemap.xml", "/robots.txt", "/favicon.ico"] as const;

export interface RedirectRule { id?: number; fromPath: string; toPath: string; statusCode: number; isActive: boolean }

/** Ruta tal como se compara: `/` inicial, sin barra final, sin parámetros y en minúsculas. */
export const normalizeFromPath = (raw: string): string => cleanPath(String(raw ?? "").trim()).toLowerCase();

export function isProtectedPath(path: string): boolean {
  const p = normalizeFromPath(path);
  if ((PROTECTED_EXACT as readonly string[]).includes(p)) return true;
  return PROTECTED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

export type RedirectCheck = { ok: true; fromPath: string; toPath: string } | { ok: false; error: string };

/**
 * Valida una regla nueva o modificada contra las existentes. `existingPaths` son rutas públicas que YA existen (páginas,
 * productos), en minúsculas, y no se pueden tapar. `selfId` excluye la propia regla al editarla.
 */
export function validateRedirect(
  input: { fromPath: unknown; toPath: unknown; statusCode?: unknown },
  rules: readonly RedirectRule[],
  opts: { existingPaths?: ReadonlySet<string>; selfId?: number } = {},
): RedirectCheck {
  if (typeof input.fromPath !== "string" || typeof input.toPath !== "string") return { ok: false, error: "Indica la ruta antigua y la nueva." };
  const rawFrom = input.fromPath.trim();
  const rawTo = input.toPath.trim();
  if (!rawFrom.startsWith("/") || rawFrom.startsWith("//") || /[\\\s\u0000-\u001F]/.test(rawFrom)) return { ok: false, error: "La ruta antigua debe empezar por «/» y no puede tener espacios ni barras invertidas (por ejemplo /programa-antiguo)." };
  if (/[?#]/.test(rawFrom)) return { ok: false, error: "La ruta antigua no lleva parámetros ni ancla: se redirige por la ruta." };
  if (rawFrom.length > REDIRECT_LIMITS.from || rawTo.length > REDIRECT_LIMITS.to) return { ok: false, error: "Alguna ruta es demasiado larga." };
  const fromPath = normalizeFromPath(rawFrom);
  if (!isSafeRedirectTarget(rawTo)) return { ok: false, error: "El destino debe ser una ruta de esta misma web que empiece por «/». No se permiten otros dominios." };
  if (input.statusCode !== undefined && !(REDIRECT_STATUSES as readonly number[]).includes(Number(input.statusCode))) return { ok: false, error: "El tipo de redirección debe ser 301 (permanente) o 302 (temporal)." };
  if (isProtectedPath(fromPath)) return { ok: false, error: "Esa ruta no se puede redirigir (la portada, el panel, la API, los ficheros y los archivos técnicos están protegidos)." };
  const toKey = normalizeFromPath(rawTo);
  if (toKey === fromPath) return { ok: false, error: "El origen y el destino son la misma ruta." };
  if (opts.existingPaths?.has(fromPath)) return { ok: false, error: "Esa ruta ya existe en la web (página o producto publicado): una redirección la taparía. Cambia primero su dirección o despublícala." };
  const others = rules.filter((r) => r.id === undefined || r.id !== opts.selfId);
  if (opts.selfId === undefined && others.length >= REDIRECT_LIMITS.rules) return { ok: false, error: `Se ha alcanzado el máximo de ${REDIRECT_LIMITS.rules} redirecciones.` };
  if (others.some((r) => normalizeFromPath(r.fromPath) === fromPath)) return { ok: false, error: "Ya hay una redirección desde esa ruta." };
  // Bucle y cadenas: el destino no puede ser el origen de otra regla, ni el origen de esta el destino de otra
  const hitsTo = others.find((r) => normalizeFromPath(r.fromPath) === toKey);
  if (hitsTo) {
    return normalizeFromPath(hitsTo.toPath) === fromPath
      ? { ok: false, error: `Crearía un bucle: ${hitsTo.fromPath} ya redirige a ${rawFrom}.` }
      : { ok: false, error: `Crearía una cadena: ${hitsTo.fromPath} ya redirige a ${hitsTo.toPath}. Apunta directamente al destino final (${hitsTo.toPath}).` };
  }
  const pointsHere = others.find((r) => normalizeFromPath(r.toPath) === fromPath);
  if (pointsHere) return { ok: false, error: `Crearía una cadena: ${pointsHere.fromPath} ya redirige a ${rawFrom}. Cambia esa regla para que apunte directamente a ${rawTo}.` };
  return { ok: true, fromPath, toPath: rawTo };
}

/** Regla aplicable a una petición: coincidencia exacta por ruta (la consulta se conserva si el destino no trae la suya). */
export function resolveRedirect(
  rules: readonly RedirectRule[],
  pathname: string,
  search = "",
): { to: string; status: 301 | 302; ruleId?: number } | null {
  const key = normalizeFromPath(pathname);
  if (isProtectedPath(key)) return null;
  const rule = rules.find((r) => r.isActive && normalizeFromPath(r.fromPath) === key);
  if (!rule || !isSafeRedirectTarget(rule.toPath)) return null;
  const hasQuery = rule.toPath.includes("?");
  const to = !hasQuery && search && search !== "?" ? `${rule.toPath}${search.startsWith("?") ? search : `?${search}`}` : rule.toPath;
  return { to, status: rule.statusCode === 302 ? 302 : 301, ruleId: rule.id };
}

/**
 * Qué hay que hacer con las reglas cuando una página cambia de dirección (`oldPath` → `newPath`):
 *  - las reglas que ya apuntaban a `oldPath` pasan a apuntar a `newPath` (nunca cadenas);
 *  - una regla cuyo origen es `newPath` se elimina (ahora ahí hay una página y la regla la taparía);
 *  - se crea `oldPath` → `newPath`, salvo que ya exista una regla con ese origen (entonces se actualiza su destino).
 */
export function planRenameRedirects(rules: readonly RedirectRule[], oldPath: string, newPath: string): {
  retarget: { id: number; toPath: string }[];
  remove: number[];
  upsert: { id?: number; fromPath: string; toPath: string };
} | null {
  const from = normalizeFromPath(oldPath);
  const to = normalizeFromPath(newPath);
  if (from === to || isProtectedPath(from)) return null;
  const retarget = rules.filter((r) => r.id !== undefined && normalizeFromPath(r.toPath) === from && normalizeFromPath(r.fromPath) !== to).map((r) => ({ id: r.id as number, toPath: to }));
  const remove = rules.filter((r) => r.id !== undefined && normalizeFromPath(r.fromPath) === to).map((r) => r.id as number);
  // Reglas que apuntaban al origen y cuyo origen es justo el destino nuevo: ya van en `remove`
  const existing = rules.find((r) => normalizeFromPath(r.fromPath) === from);
  return { retarget, remove, upsert: { id: existing?.id, fromPath: from, toPath: to } };
}
