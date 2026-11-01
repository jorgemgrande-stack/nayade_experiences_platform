/**
 * Licencia por capacidad en rutas REST (subidas de archivos y similares), con la misma decisión que el guardián de
 * tRPC: GET/HEAD se permiten en solo lectura; el resto exige la capacidad activa. Falla cerrado si no puede
 * comprobarse. En modo `single` (o sin CAPABILITY_ENFORCEMENT) la decisión es siempre «permitido».
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getCapabilityAccess, type CapabilityAccess } from "./access";
import { opsLog } from "../ops/log";

export function requireCapability(capability: string, getAccess: () => CapabilityAccess = getCapabilityAccess): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const write = req.method !== "GET" && req.method !== "HEAD";
    try {
      const d = await getAccess().check(capability, { write });
      if (!d.allowed) {
        opsLog("warn", "Licensing", "capability_denied", { capability, status: d.status, write });
        const error = d.status === "read_only" || d.status === "expired" ? "Esta función está en solo lectura: no se pueden hacer cambios." : "Esta función no está incluida en tu plan.";
        res.status(403).json({ error, capability, status: d.status });
        return;
      }
      next();
    } catch {
      opsLog("error", "Licensing", "capability_check_failed", { write });
      res.status(503).json({ error: "No se pudo verificar la licencia. Inténtalo de nuevo en unos minutos." });
    }
  };
}
