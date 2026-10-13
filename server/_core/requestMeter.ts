/**
 * Middleware de medición de peticiones HTTP: recuento, duración y bytes servidos, agrupados
 * por familia de ruta (baja cardinalidad). Con el destino nulo por defecto no tiene efecto.
 */
import type { NextFunction, Request, Response } from "express";
import { Metrics, meter } from "./metering";

/** Agrupa la ruta en una familia estable: nunca la ruta completa ni parámetros. */
export function routeGroup(url: string): string {
  const path = url.split("?")[0];
  if (path.startsWith("/api/trpc")) return "trpc";
  if (path.startsWith("/api/ghl")) return "ghl";
  if (path.startsWith("/api/redsys") || path.startsWith("/reserva")) return "redsys";
  if (path.startsWith("/api/upload")) return "upload";
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/local-storage")) return "files";
  return "web";
}

function statusClass(code: number): string {
  return `${Math.floor(code / 100)}xx`;
}

export function requestMeter(req: Request, res: Response, next: NextFunction): void {
  const t0 = Date.now();
  res.once("finish", () => {
    const group = routeGroup(req.originalUrl || req.url || "");
    meter(Metrics.HTTP_REQUEST, 1, "count", {
      group,
      method: req.method,
      status: statusClass(res.statusCode),
    });
    meter(Metrics.HTTP_REQUEST_MS, Date.now() - t0, "ms", { group });
    const len = Number(res.getHeader("content-length"));
    if (Number.isFinite(len) && len > 0) meter(Metrics.HTTP_RESPONSE_BYTES, len, "byte", { group });
  });
  next();
}
