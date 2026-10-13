/**
 * Puntos de aplicación de la licencia: Express (APIs HTTP) y tRPC (procedimientos).
 * Ambos consultan SIEMPRE a `ModuleAccess` en el servidor.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ModuleError } from "./contract";
import type { ModuleAccess } from "./entitlements";

export function requireModuleHttp(access: ModuleAccess, moduleId: string): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await access.assertModule(moduleId);
      next();
    } catch (e) {
      if (e instanceof ModuleError && e.code === "not_licensed") {
        res.status(403).json({ error: "module_not_licensed", module: moduleId });
        return;
      }
      // Cualquier otro fallo (p. ej. sin tenant) cierra
      res.status(503).json({ error: "module_check_failed" });
    }
  };
}
