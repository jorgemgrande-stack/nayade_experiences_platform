/**
 * Defensa CSRF para peticiones autenticadas con cookie.
 *
 * La cookie de sesión es SameSite=Lax: otro SITIO no puede enviarla en un POST. Pero las empresas
 * comparten dominio de plataforma (`<empresa>.elephantsource.es`) y, para el navegador, dos
 * subdominios son el MISMO sitio: Lax no basta entre empresas. Por eso, en métodos que modifican,
 * si el navegador declara un origen (`Origin`, o en su defecto `Referer`) distinto del host de la
 * petición, la sesión no se usa.
 *
 * Sin `Origin` ni `Referer` (clientes no navegador, webhooks) no se bloquea: esos clientes no
 * llevan la cookie de un usuario de forma involuntaria.
 */
import type { IncomingHttpHeaders } from "http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type ReqLike = { method?: string; headers: IncomingHttpHeaders };

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function requestHost(req: ReqLike): string | null {
  const fwd = req.headers["x-forwarded-host"];
  const raw = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || req.headers.host;
  return raw ? raw.toLowerCase() : null;
}

/** ¿Es una petición que modifica y que el navegador declara de otro origen? */
export function isCrossOriginUnsafe(req: ReqLike): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return false;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const declared = typeof origin === "string" && origin ? origin : typeof referer === "string" && referer ? referer : null;
  if (!declared) return false;
  if (declared === "null") return true; // origen opaco (iframe con sandbox, data:, file:)
  const from = hostOf(declared);
  const to = requestHost(req);
  if (!from || !to) return true;
  return from !== to;
}
