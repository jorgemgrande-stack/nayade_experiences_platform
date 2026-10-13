/**
 * Autenticación y autorización para rutas Express (fuera de tRPC).
 *
 * `authGuard` solo protege `/api/trpc`; las rutas Express propias necesitan su propio
 * control. Este módulo ofrece un middleware único y reutilizable que aplica las mismas
 * reglas que los procedimientos tRPC equivalentes:
 *   - sesión válida (cookie JWT en modo local; SDK en modo Manus),
 *   - usuario activo,
 *   - permiso RBAC con el mismo fallback a roles heredados (`checkRbacOrLegacy`).
 *
 * Nunca lanza: ante cualquier error de verificación responde 401.
 */
import type { NextFunction, Request, Response } from "express";
import { checkRbacOrLegacy } from "./rbac";
import { getUserFromRequest } from "../localAuth";
import { sdk } from "./sdk";

export type SessionUser = {
  id: number;
  role: string;
  isActive?: boolean | null;
  [key: string]: unknown;
};

/** Usuario autenticado, disponible tras pasar por `requirePermission`. */
export function getAuthUser(req: Request): SessionUser | undefined {
  return (req as Request & { authUser?: SessionUser }).authUser;
}

/** Resuelve el usuario de la sesión, o `null` si no hay sesión válida. */
export async function resolveSessionUser(req: Request): Promise<SessionUser | null> {
  try {
    const user =
      process.env.LOCAL_AUTH === "true"
        ? await getUserFromRequest(req)
        : await sdk.authenticateRequest(req as never);
    if (!user || typeof (user as SessionUser).id !== "number") return null;
    return user as unknown as SessionUser;
  } catch {
    // Cookie malformada, JWT inválido o caducado, BD no disponible…
    return null;
  }
}

function deny(res: Response, status: 401 | 403, message: string) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ ok: false, message });
}

/**
 * Exige sesión activa y el permiso RBAC indicado.
 * @param permissionKey  Clave de permiso (p. ej. "crm.view")
 * @param fallbackRoles  Roles heredados con acceso si RBAC no responde
 */
export function requirePermission(permissionKey: string, fallbackRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await resolveSessionUser(req);
    if (!user) return deny(res, 401, "No autenticado.");
    if (user.isActive === false) return deny(res, 401, "No autenticado.");

    let allowed = false;
    try {
      allowed = await checkRbacOrLegacy(user.id, String(user.role), permissionKey, fallbackRoles);
    } catch {
      allowed = fallbackRoles.includes(String(user.role));
    }
    if (!allowed) return deny(res, 403, "Acceso restringido al equipo.");

    (req as Request & { authUser?: SessionUser }).authUser = user;
    res.setHeader("Cache-Control", "no-store");
    next();
  };
}

/** Acceso del equipo comercial: mismo criterio que `staffProcedure` (permiso crm.view). */
export const requireStaff = requirePermission("crm.view", ["admin", "agente"]);
