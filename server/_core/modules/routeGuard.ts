/**
 * Aplicación de licencias a las rutas tRPC existentes.
 *
 * Un router sectorial (`hotel`, `spa`, `restaurants`…) solo responde si el tenant tiene el
 * módulo disponible. La comprobación va en el servidor, antes de ejecutar cualquier
 * procedimiento: ocultar una opción del menú no cuenta como aplicar una licencia.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ModuleAccess } from "./entitlements";
import { opsLog } from "../ops/log";
import { recordFailure } from "../ops/failureAlerts";
import { extensionModuleRoutes } from "./panelNavigation";

/**
 * router tRPC → módulo que lo licencia. Lo no listado pertenece al Core. Se completa con los namespaces que
 * declaran los manifiestos (`panel.api`) de los módulos con licencia propia.
 */
export const TRPC_ROUTER_MODULES: Record<string, string> = {
  hotel: "hotel",
  spa: "spa",
  restaurants: "restaurants",
};

export function procedureNames(path: string): string[] {
  const p = path.split("?")[0].replace(/^\/api\/trpc\//, "").replace(/^\//, "");
  return p ? p.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

export function moduleRouteGuard(getAccess: () => ModuleAccess, map?: Record<string, string>): RequestHandler {
  // Sin mapa explícito: el fijo más lo que declaran los manifiestos (se calcula en la primera petición, con todo registrado)
  let routes: Record<string, string> | null = map ?? null;
  return async (req: Request, res: Response, next: NextFunction) => {
    routes ??= { ...extensionModuleRoutes(), ...TRPC_ROUTER_MODULES };
    const needed = new Set<string>();
    for (const proc of procedureNames(req.url ?? "")) {
      const mod = routes[proc.split(".")[0]];
      if (mod) needed.add(mod);
    }
    if (needed.size === 0) return next();
    try {
      const access = getAccess();
      for (const m of Array.from(needed)) {
        if (!(await access.isModuleAvailable(m))) {
          opsLog("warn", "Licensing", "module_denied", { module: m });
          res.status(403).json({
            error: { json: { message: `Módulo no disponible: ${m}`, code: -32003, data: { code: "FORBIDDEN", httpStatus: 403 } } },
          });
          return;
        }
      }
      next();
    } catch {
      // Sin tenant resuelto o licencia no verificable: se cierra
      opsLog("error", "Licensing", "module_check_failed", {});
      recordFailure("licensing.check_failed");
      res.status(503).json({ error: { json: { message: "No se pudo verificar la licencia", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } } } });
    }
  };
}
