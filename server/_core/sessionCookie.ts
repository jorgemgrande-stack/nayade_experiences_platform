/**
 * Cookie de sesión de los usuarios de la aplicación (LOCAL_AUTH, JWT propio).
 *
 * En multiempresa todas las empresas comparten el dominio padre (`<empresa>.app.bigelephant.es`), que no está en
 * la Public Suffix List: una página de una empresa podría fijar una cookie `Domain=app.bigelephant.es` que el
 * navegador enviaría a todas las demás (inyección o fijación de sesión). Con el prefijo `__Host-` el navegador
 * exige `Secure`, `Path=/` y que NO lleve `Domain`, de modo que solo la puede fijar el propio host.
 *
 *  - HTTPS: se escribe `__Host-nayade_session` y se borra la antigua `nayade_session`.
 *  - Lectura en multiempresa por HTTPS: SOLO `__Host-` (la antigua podría venir de otra empresa).
 *  - Lectura con una sola empresa o sin HTTPS (desarrollo): también la antigua, para que la transición no
 *    cierre sesiones; la siguiente vez que se inicia sesión ya queda la nueva.
 */
import type { CookieOptions, Request, Response } from "express";
import { isMultiTenant } from "./tenant";

export const SESSION_COOKIE_LEGACY = "nayade_session";
export const SESSION_COOKIE_HOST = "__Host-nayade_session";

/** Cookies de la petición (tolera valores mal codificados: no deben tumbar la petición). */
export function parseCookieHeader(raw: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (raw ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

/** La cookie sin prefijo se acepta salvo en multiempresa por HTTPS. */
export const legacySessionCookieAllowed = (req: Request) => !req.secure || !isMultiTenant();

/** Token de sesión de la petición, o `undefined`. */
export function readSessionToken(req: Request, cookies: Record<string, string> = parseCookieHeader(req.headers.cookie)): string | undefined {
  return cookies[SESSION_COOKIE_HOST] || (legacySessionCookieAllowed(req) ? cookies[SESSION_COOKIE_LEGACY] || undefined : undefined);
}

/** Emite la cookie de sesión (y por HTTPS borra la antigua). */
export function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const base: CookieOptions = { httpOnly: true, sameSite: "lax", path: "/", maxAge: maxAgeMs };
  if (req.secure) {
    res.cookie(SESSION_COOKIE_HOST, token, { ...base, secure: true });
    res.clearCookie(SESSION_COOKIE_LEGACY, { path: "/" });
  } else {
    // Sin HTTPS (desarrollo o proxy sin X-Forwarded-Proto): comportamiento anterior
    res.cookie(SESSION_COOKIE_LEGACY, token, { ...base, secure: process.env.NODE_ENV === "production" });
  }
}

/** Cierra la sesión: borra las dos variantes. */
export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE_HOST, { path: "/", secure: true, httpOnly: true, sameSite: "lax" });
  res.clearCookie(SESSION_COOKIE_LEGACY, { path: "/" });
}
