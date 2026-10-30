/**
 * Permisos de las finanzas corporativas (fase 1). Añadir ámbitos nuevos toca ficheros críticos del plano de control,
 * así que en la fase 1 se usan los existentes, centralizados AQUÍ (una constante por capacidad) para cambiarlos después
 * en una PR protegida aparte (p. ej. `finance:read`, `finance:write`, `finance:close`):
 *
 *  | Capacidad                                             | Fase 1                                                   |
 *  |-------------------------------------------------------|----------------------------------------------------------|
 *  | Consulta financiera y exportaciones                   | billing:read                                             |
 *  | Gastos, proveedores, bancos, caja… (fase 1B)          | billing:write                                            |
 *  | Contabilizar, revertir, asientos manuales             | billing:write + sesión de operador (solo personas)       |
 *  | Cerrar/reabrir periodos y ejercicios, configuración   | billing:write + sesión de operador + rol admin|superadmin |
 *
 * El CRM oculta lo que no se puede, pero el servidor lo exige siempre.
 */
import type { RequestHandler } from "express";
import { getAuth, requireOperatorSession, requireScope, type Scope } from "../controlPlane/auth";

export const FINANCE_READ: Scope = "billing:read";
export const FINANCE_WRITE: Scope = "billing:write";
/** Roles de operador que pueden cerrar y reabrir periodos y ejercicios y tocar la configuración contable. */
export const FINANCE_ADMIN_ROLES: readonly string[] = ["admin", "superadmin"];

/** Rol del operador de la sesión (solo sesiones de operador humano; nunca tokens de servicio). */
export function operatorRoleOf(req: Parameters<RequestHandler>[0]): string | null {
  return getAuth(req)?.operator?.operator.role ?? null;
}

function requireFinanceAdminRole(): RequestHandler {
  return (req, res, next) => {
    const role = operatorRoleOf(req);
    if (!role || !FINANCE_ADMIN_ROLES.includes(role)) {
      res.status(403).json({ error: "forbidden_role", message: "Solo la administración puede cerrar o reabrir periodos y cambiar la configuración contable" });
      return;
    }
    next();
  };
}

/** Consulta financiera y exportaciones. */
export const canRead: RequestHandler[] = [requireScope(FINANCE_READ)];
/** Operaciones de gestión (fase 1B: gastos, proveedores, bancos, caja). */
export const canOperate: RequestHandler[] = [requireScope(FINANCE_WRITE)];
/** Contabilizar, revertir, asientos manuales: solo personas. */
export const canPost: RequestHandler[] = [requireScope(FINANCE_WRITE), requireOperatorSession()];
/** Cierres, reaperturas y configuración contable: solo administración con sesión de operador. */
export const canClose: RequestHandler[] = [requireScope(FINANCE_WRITE), requireOperatorSession(), requireFinanceAdminRole()];
