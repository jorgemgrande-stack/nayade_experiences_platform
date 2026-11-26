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

/**
 * Elephant Learning: la licencia de módulo `learning` se exige en el servidor SOLO con LEARNING_LICENSE_ENFORCED=1.
 * Gradual a propósito: el LMS ya funciona en Quantum sin licencia de módulo; se enciende después de que el operador
 * conceda `learning` a Quantum (si no, Quantum recibiría 403 en `learning.*`). Las rutas Express /api/learning/* pasan por
 * `learningLicenseGuard` (mismo interruptor).
 */
export const LEARNING_ENFORCE_ENV = "LEARNING_LICENSE_ENFORCED";
export const learningEnforced = (): boolean => ["1", "true", "on"].includes((process.env[LEARNING_ENFORCE_ENV] ?? "").trim().toLowerCase());

/**
 * Derechos adquiridos del alumno (solo con la licencia exigida): lo que un alumno YA matriculado sigue pudiendo hacer aunque la
 * empresa pierda la licencia `learning`: ver su aula, abrir sus lecciones y recursos, registrar su progreso y activar un derecho ya
 * concedido. Todo va acotado a SUS matrículas (la comprobación de matrícula está en el procedimiento / la ruta, no aquí).
 * Quedan fuera (exigen licencia): toda la administración (`learning.admin.*`), la vista previa, la subida y, entre las del alumno,
 * `learning.my.startExtension` (crea un pedido nuevo: es venta, no derecho adquirido).
 */
export const LEARNING_STUDENT_PROCEDURES: ReadonlySet<string> = new Set([
  "learning.my.courses",
  "learning.my.course",
  "learning.my.lesson",
  "learning.my.progress",
  "learning.my.activate",
]);
const LEARNING_STUDENT_RESOURCE_PATH = /^\/resource\/[1-9]\d{0,9}\/?$/;

export function procedureNames(path: string): string[] {
  const p = path.split("?")[0].replace(/^\/api\/trpc\//, "").replace(/^\//, "");
  return p ? p.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * Licencia `learning` en las rutas Express /api/learning/* (recursos del alumno, vista previa y subida). Mismo criterio que el
 * guardián tRPC: solo se exige con LEARNING_LICENSE_ENFORCED=1; si falta la licencia o no se puede verificar, se cierra.
 * Sin sesión o sin licencia nadie recibe nada: 403 (sin licencia) / 503 (no verificable).
 */
export function learningLicenseGuard(getAccess: () => ModuleAccess): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction) => {
    if (!learningEnforced()) return next();
    // Derecho adquirido del alumno: abrir un recurso de SU matrícula (la ruta comprueba matrícula y ventana); el resto exige licencia
    if (_req.method === "GET" && LEARNING_STUDENT_RESOURCE_PATH.test(_req.path)) return next();
    try {
      if (await getAccess().isModuleAvailable("learning")) return next();
      opsLog("warn", "Licensing", "module_denied", { module: "learning", via: "express" });
      res.setHeader("Cache-Control", "no-store");
      res.status(403).json({ error: "Módulo no disponible: learning" });
    } catch {
      opsLog("error", "Licensing", "module_check_failed", { via: "express" });
      recordFailure("licensing.check_failed");
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: "No se pudo verificar la licencia" });
    }
  };
}

export function moduleRouteGuard(getAccess: () => ModuleAccess, map?: Record<string, string>): RequestHandler {
  // Sin mapa explícito: el fijo más lo que declaran los manifiestos (se calcula en la primera petición, con todo registrado)
  let routes: Record<string, string> | null = map ?? null;
  return async (req: Request, res: Response, next: NextFunction) => {
    routes ??= { ...extensionModuleRoutes(), ...TRPC_ROUTER_MODULES };
    // Con un mapa explícito (pruebas) manda ese mapa; si no, `learning` se añade solo si la licencia está exigida
    const learning = !map && learningEnforced() ? { learning: "learning" } : null;
    const needed = new Set<string>();
    for (const proc of procedureNames(req.url ?? "")) {
      const ns = proc.split(".")[0];
      const mod = routes[ns] ?? (LEARNING_STUDENT_PROCEDURES.has(proc) ? undefined : learning?.[ns as "learning"]);
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
