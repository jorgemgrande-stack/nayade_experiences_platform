/**
 * Guarda HTTP de recursos por tenant (modo multi): tasa y concurrencia.
 * Se monta DESPUÉS de ligar el contexto de tenant; sin contexto no hace nada (la resolución
 * ya habrá rechazado la petición).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Metrics, meter } from "../metering";
import { isMultiTenant, peekTenantContext } from "../tenant";
import { DEFAULT_MAX_CONCURRENT, type QuotaEngine } from "./quota";
import type { TenantConcurrencyLimiter, TenantRateLimiter } from "./limiters";

/** Métrica (cuota con periodo `minute`) que fija el máximo de peticiones simultáneas. */
export const CONCURRENT_METRIC = "http.concurrent";
const DEFAULT_PER_MINUTE = 1200;

export interface ResourceGuardOptions {
  exempt?: (path: string) => boolean;
  /** Conexiones largas (SSE): cuentan para la tasa pero no ocupan plaza de concurrencia. */
  longLived?: (path: string) => boolean;
}

export function tenantResourceGuard(
  engine: QuotaEngine,
  rate: TenantRateLimiter,
  conc: TenantConcurrencyLimiter,
  opts: ResourceGuardOptions = {},
): RequestHandler {
  const exempt = opts.exempt ?? ((p: string) => p === "/healthz" || p === "/readyz");
  const longLived = opts.longLived ?? ((p: string) => p.endsWith("/stream"));

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!isMultiTenant() || exempt(req.path)) return next();
    const tenantId = peekTenantContext()?.tenantId;
    if (!tenantId) return next();

    try {
      const perMinute = (await engine.limitPerMinute(Metrics.HTTP_REQUEST, tenantId)) ?? DEFAULT_PER_MINUTE;
      const t = rate.take(tenantId, perMinute);
      if (!t.ok) {
        meter("erm.rejected", 1, "count", { reason: "rate" });
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(t.retryAfterMs / 1000))));
        return void res.status(429).type("text/plain").send("Too many requests");
      }

      if (longLived(req.path)) return next();
      const max = (await engine.limitPerMinute(CONCURRENT_METRIC, tenantId)) ?? DEFAULT_MAX_CONCURRENT;
      const release = conc.acquire(tenantId, max);
      if (!release) {
        meter("erm.rejected", 1, "count", { reason: "concurrency" });
        res.setHeader("Retry-After", "1");
        return void res.status(429).type("text/plain").send("Too many concurrent requests");
      }
      res.once("close", release);
      res.once("finish", release);
      return next();
    } catch {
      // La medición/política no debe tumbar el servicio
      return next();
    }
  };
}
