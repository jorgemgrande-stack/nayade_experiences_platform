/**
 * Redirecciones permanentes por empresa: reglas puras (validación, bucles, cadenas y resolución). Sin BD ni red.
 *
 * Principios:
 *  - Solo destinos INTERNOS (ruta de la propia web). Nunca otro dominio: así no hay «open redirect» ni cruce entre empresas.
 *  - Una redirección solo actúa cuando la ruta pedida NO existe (el servidor la consulta tras resolver la ruta pública y
 *    solo ante un 404): nunca puede tapar una página, un producto ni las pantallas de acceso o de pago, existan hoy o se
 *    creen mañana. Aun así, estas rutas no se aceptan como origen para no crear reglas engañosas.
 *  - Sin bucles (A→B→A) y sin cadenas (A→B→C): el destino de una regla no puede ser el origen de otra; se apunta siempre al final.
 *  - Las rutas localizadas se tratan tal cual llegan (`/de/…` es una ruta distinta de `/es/…`).
 *  - Las rutas se comparan decodificadas (`%C3%B3` = `ó`), normalizadas (NFC), en minúsculas y sin barra final.
 */
import { cleanPath, isSafeRedirectTarget } from "./i18n";

export const REDIRECT_STATUSES = [301, 302] as const;
export const REDIRECT_LIMITS = { from: 255, to: 512, note: 255, rules: 2000 } as const;

/** Rutas que ninguna regla puede tomar como origen (panel, API, ficheros, acceso, contraseñas, pago, enlaces de correo, SEO técnico). */
export const PROTECTED_PREFIXES = [
  "/api", "/cp", "/admin", "/empleado", "/partner", "/supplier", "/gestoria", "/assets", "/local-storage", "/uploads", "/.well-known", "/_support",
  "/login", "/recuperar-contrasena", "/nueva-contrasena", "/establecer-contrasena",
  "/checkout", "/reserva", "/canjear-cupon", "/verificar-bono", "/solicitar-anulacion",
  "/presupuesto/", "/propuesta/", "/comunidad/activar", "/restaurantes/reserva-ok", "/restaurantes/reserva-ko",
] as const;
export const PROTECTED_EXACT = ["/", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/404"] as const;

export interface RedirectRule { id?: number; fromPath: string; toPath: string; statusCode: number; isActive: boolean }

/** Decodifica una ruta; si está mal codificada se deja como llega. */
export function safeDecodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Ruta tal como se compara: decodificada, NFC, `/` inicial, sin barra final, sin parámetros y en minúsculas. */
export const normalizeFromPath = (raw: string): string => cleanPath(safeDecodePath(String(raw ?? "").trim().split(/[?#]/)[0] ?? "").normalize("NFC")).toLowerCase();

export function isProtectedPath(path: string): boolean {
  const p = normalizeFromPath(path);
  if ((PROTECTED_EXACT as readonly string[]).includes(p)) return true;
  return PROTECTED_PREFIXES.some((x) => { const base = x.endsWith("/") ? x.slice(0, -1) : x; return p === base || p.startsWith(`${base}/`); });
}

export type RedirectCheck = { ok: true; fromPath: string; toPath: string } | { ok: false; error: string };

/**
 * Valida una regla nueva o modificada contra las existentes. `existingPaths` son rutas públicas que YA existen (páginas,
 * productos), en minúsculas, y se avisa de ellas al crear (la regla no actuaría mientras existan). `selfId` excluye la
 * propia regla al editarla.
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
  if (/[\\\u0000-\u001F]/.test(fromPath) || fromPath.startsWith("//")) return { ok: false, error: "La ruta antigua contiene caracteres no permitidos." };
  if (!isSafeRedirectTarget(rawTo)) return { ok: false, error: "El destino debe ser una ruta de esta misma web que empiece por «/». No se permiten otros dominios." };
  if (input.statusCode !== undefined && !(REDIRECT_STATUSES as readonly number[]).includes(Number(input.statusCode))) return { ok: false, error: "El tipo de redirección debe ser 301 (permanente) o 302 (temporal)." };
  if (isProtectedPath(fromPath)) return { ok: false, error: "Esa ruta no se puede redirigir (la portada, el panel, la API, los ficheros, el acceso, el pago y los archivos técnicos están protegidos)." };
  const toKey = normalizeFromPath(rawTo);
  if (toKey === fromPath) return { ok: false, error: "El origen y el destino son la misma ruta." };
  if (opts.existingPaths?.has(fromPath)) return { ok: false, error: "Esa ruta ya existe en la web (página o producto publicado): la redirección no actuaría mientras exista. Cambia primero su dirección o despublícala." };
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

/** Índice por ruta normalizada: la resolución es una búsqueda directa, no un recorrido de todas las reglas. */
export type RedirectIndex = ReadonlyMap<string, RedirectRule>;
export function buildRedirectIndex(rules: readonly RedirectRule[]): RedirectIndex {
  const m = new Map<string, RedirectRule>();
  for (const r of rules) if (r.isActive && !m.has(normalizeFromPath(r.fromPath))) m.set(normalizeFromPath(r.fromPath), r);
  return m;
}

/** Destino con la consulta de la petición insertada ANTES de un posible `#ancla` (y solo si el destino no trae la suya). */
function withSearch(toPath: string, search: string): string {
  if (!search || search === "?" || toPath.includes("?")) return toPath;
  const q = search.startsWith("?") ? search : `?${search}`;
  const hash = toPath.indexOf("#");
  return hash === -1 ? `${toPath}${q}` : `${toPath.slice(0, hash)}${q}${toPath.slice(hash)}`;
}

/** Regla aplicable a una petición: coincidencia exacta por ruta decodificada (la consulta se conserva si el destino no trae la suya). */
export function resolveRedirect(
  rules: readonly RedirectRule[] | RedirectIndex,
  pathname: string,
  search = "",
): { to: string; status: 301 | 302; ruleId?: number } | null {
  const key = normalizeFromPath(pathname);
  if (isProtectedPath(key)) return null;
  const rule = Array.isArray(rules) ? buildRedirectIndex(rules as readonly RedirectRule[]).get(key) : (rules as RedirectIndex).get(key);
  if (!rule || !isSafeRedirectTarget(rule.toPath)) return null;
  return { to: withSearch(rule.toPath, search), status: rule.statusCode === 302 ? 302 : 301, ruleId: rule.id };
}

/**
 * Qué hay que hacer con las reglas cuando una página cambia de dirección (`oldPath` → `newPath`):
 *  - las reglas que ya apuntaban a `oldPath` pasan a apuntar a `newPath` (nunca cadenas), conservando su consulta o ancla;
 *  - una regla cuyo origen es `newPath` se elimina (ahora ahí hay una página);
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
  // El destino se escribe como llega la dirección nueva (sin pasarla a minúsculas) y solo se sustituye la parte de la ruta
  const target = cleanPath(newPath);
  const suffixOf = (toPath: string): string => { const i = toPath.search(/[?#]/); return i === -1 ? "" : toPath.slice(i); };
  const retarget = rules.filter((r) => r.id !== undefined && normalizeFromPath(r.toPath) === from && normalizeFromPath(r.fromPath) !== to).map((r) => ({ id: r.id as number, toPath: `${target}${suffixOf(r.toPath)}` }));
  const remove = rules.filter((r) => r.id !== undefined && normalizeFromPath(r.fromPath) === to).map((r) => r.id as number);
  const existing = rules.find((r) => normalizeFromPath(r.fromPath) === from);
  return { retarget, remove, upsert: { id: existing?.id, fromPath: from, toPath: target } };
}
