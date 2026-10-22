/**
 * Contexto de tenant por petición (solo modo `multi`).
 *
 * Dos pasos, porque AsyncLocalStorage no atraviesa de forma fiable los callbacks de eventos
 * de streams (lectura del cuerpo):
 *  1. `resolveTenantMiddleware` (antes de leer el cuerpo): resuelve el host en el registro y
 *     rechaza lo que no sea servible, sin tocar ninguna base de datos.
 *  2. `bindTenantMiddleware` (después de los parsers): entra en el contexto del tenant con
 *     el resultado del paso 1.
 *
 * Reglas:
 *  - El tenant sale SOLO del `Host` de la petición resuelto en el registro. Cabeceras como
 *    `X-Tenant-Id`, `X-Forwarded-Host`, parámetros o cuerpo se ignoran por completo.
 *  - Dominio desconocido → 404 genérico; sin BD por defecto.
 *  - Tenant no servible → 410/503 según el ciclo de vida; registro caído → 503 (falla cerrado).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Metrics, meter } from "../metering";
import { DbCapacityError, leaseTenantDatabase } from "../dbRegistry";
import { runWithTenant } from "../tenant";
import type { ResolvedTenant, TenantResolver } from "./resolver";

/** Tenant resuelto por el registro para cada petición (nunca por entrada del cliente). */
const resolved = new WeakMap<Request, ResolvedTenant>();

export function getResolvedTenant(req: Request): ResolvedTenant | undefined {
  return resolved.get(req);
}

export interface TenantMiddlewareOptions {
  /** Rutas que no necesitan tenant (sondas de salud). */
  exempt?: (path: string) => boolean;
  /** Destino de los avisos operativos (sin datos sensibles). */
  log?: (line: string) => void;
}

const DEFAULT_EXEMPT = new Set(["/healthz", "/readyz"]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Rutas del panel y de la API: siguen disponibles cuando la web pública no se sirve (suspendido). */
export function isOperatorPath(p: string): boolean {
  return p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/");
}

/** Inicio/cierre de sesión: única escritura permitida a un tenant sin escrituras de negocio. */
/**
 * Procedimientos permitidos aunque la empresa no admita escrituras (suspendida o en solo lectura tras la baja):
 * exportar sus datos es lo que se garantiza durante ese periodo (solo la persona propietaria; lo comprueba el
 * propio procedimiento).
 */
const READ_ONLY_ALLOWED = new Set(["dataExport.request", "dataExport.link"]);

export function isSessionPath(p: string): boolean {
  if (p.startsWith("/api/auth")) return true;
  if (!p.startsWith("/api/trpc/")) return false;
  const procs = decodeURIComponent(p.slice("/api/trpc/".length)).split(",");
  return procs.length > 0 && procs.every((x) => x.startsWith("auth.") || READ_ONLY_ALLOWED.has(x));
}

function send(res: Response, status: number, retryAfter?: number): void {
  if (retryAfter) res.setHeader("Retry-After", String(retryAfter));
  res.status(status).type("text/plain").send(status === 404 ? "Not found" : status === 410 ? "Gone" : "Service unavailable");
}

export function resolveTenantMiddleware(resolver: TenantResolver, opts: TenantMiddlewareOptions = {}): RequestHandler {
  const exempt = opts.exempt ?? ((p: string) => DEFAULT_EXEMPT.has(p));
  const log = opts.log ?? ((l: string) => console.warn(l));
  return async (req: Request, res: Response, next: NextFunction) => {
    if (exempt(req.path)) return next();
    try {
      const out = await resolver.resolveHost(req.headers.host);
      switch (out.kind) {
        case "resolved":
        {
          const pol = out.tenant.policy;
          // Suspendido: sin web pública (solo panel/API); sin escrituras de negocio salvo sesión
          if (!pol.publicWeb && !isOperatorPath(req.path)) return send(res, pol.blockedStatus ?? 503, 30);
          if (!pol.writes && !SAFE_METHODS.has(req.method) && !isSessionPath(req.path)) return send(res, 403);
          resolved.set(req, out.tenant);
          return next();
        }
        case "unknown_domain":
          meter(Metrics.TENANT_SHADOW, 1, "count", { verdict: "unknown_domain", enforced: true });
          return send(res, 404);
        case "blocked":
          return send(res, out.status, out.status === 503 ? 30 : undefined);
        case "unavailable":
          log(JSON.stringify({ ctx: "TenantResolution", event: "registry_unavailable" }));
          return send(res, 503, 5);
      }
    } catch {
      // Cualquier fallo inesperado cierra (nunca se continúa sin tenant)
      return send(res, 503, 5);
    }
  };
}

export function bindTenantMiddleware(opts: Pick<TenantMiddlewareOptions, "exempt"> = {}): RequestHandler {
  const exempt = opts.exempt ?? ((p: string) => DEFAULT_EXEMPT.has(p));
  return (req: Request, res: Response, next: NextFunction) => {
    if (exempt(req.path)) return next();
    const t = resolved.get(req);
    if (!t) return send(res, 503, 5); // no se resolvió: jamás se sigue sin tenant
    runWithTenant(t.tenantId, () => {
      // Precarga y arrienda el pool del tenant: el acceso heredado síncrono (legacyDb) lo
      // encuentra en el contexto, y la expulsión LRU no lo cierra mientras la petición siga viva.
      // Si no se puede precargar, la petición sigue SIN arriendo: cualquier acceso heredado
      // lanzará (falla cerrado) y las rutas que no usan BD (estáticos, panel) no se rompen.
      leaseTenantDatabase().then(
        (lease) => {
          res.once("finish", lease.release);
          res.once("close", lease.release);
          next();
        },
        (err) => {
          // Presupuesto de conexiones agotado: 503 con Retry-After, nunca por encima del límite
          if (err instanceof DbCapacityError) {
            console.warn(JSON.stringify({ ctx: "TenantBinding", event: "db_capacity_exhausted" }));
            return send(res, 503, err.retryAfterSeconds);
          }
          console.warn(JSON.stringify({ ctx: "TenantBinding", event: "db_lease_failed" }));
          next();
        },
      );
    });
  };
}

/** Atajo: ambos pasos en el orden correcto, para montar con parsers entre medias. */
export function tenantMiddlewares(resolver: TenantResolver, opts: TenantMiddlewareOptions = {}) {
  return { resolve: resolveTenantMiddleware(resolver, opts), bind: bindTenantMiddleware(opts) };
}
