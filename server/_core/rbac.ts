/**
 * RBAC helpers — Phase 4.
 *
 * Regla de prioridad:
 *   1. Si el usuario tiene entradas en rbac_user_roles → usar SOLO esos permisos.
 *   2. Si no tiene entradas → fallback a users.role (legacy) para derivar permisos.
 *   3. Cualquier error → fallback a roles legacy sin romper el flujo.
 *
 * Estos helpers son usados activamente en adminProcedure / staffProcedure /
 * adminrestProcedure y en permissionProcedure / anyPermissionProcedure.
 */

import { getDb } from "../db";

export type RbacRoleInfo = {
  id: number;
  key: string;
  name: string;
  isLegacy: boolean;
};

/** Roles RBAC asignados al usuario en rbac_user_roles. */
export async function getUserRoles(userId: number): Promise<RbacRoleInfo[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT rr.id, rr.\`key\`, rr.name, rr.is_legacy AS isLegacy
      FROM rbac_user_roles ur
      JOIN rbac_roles rr ON rr.id = ur.role_id
      WHERE ur.user_id = ${userId} AND rr.is_active = 1
      ORDER BY rr.sort_order
    `);
    return (result as any[][])[0] as RbacRoleInfo[];
  } catch {
    return [];
  }
}

/**
 * Permisos efectivos del usuario.
 * Prioriza roles RBAC; si no tiene, usa legacyRole como fallback.
 * Lanza si la BD no está disponible para que checkRbacOrLegacy pueda
 * hacer el fallback correcto al rol legacy.
 */
export async function getUserPermissions(
  userId: number,
  legacyRole?: string,
): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("RBAC: DB connection unavailable");

  const { sql } = await import("drizzle-orm");

  const cntResult = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM rbac_user_roles WHERE user_id = ${userId}
  `);
  const hasRbacRoles = Number((cntResult as any[][])[0]?.[0]?.cnt ?? 0) > 0;

  if (hasRbacRoles) {
    const permsResult = await db.execute(sql`
      SELECT DISTINCT p.\`key\`
      FROM rbac_user_roles ur
      JOIN rbac_role_permissions rrp ON rrp.role_id = ur.role_id
      JOIN rbac_permissions p ON p.id = rrp.permission_id
      WHERE ur.user_id = ${userId}
      ORDER BY p.\`key\`
    `);
    return ((permsResult as any[][])[0] as Array<{ key: string }>).map(r => r.key);
  }

  if (legacyRole) {
    const permsResult = await db.execute(sql`
      SELECT DISTINCT p.\`key\`
      FROM rbac_roles rr
      JOIN rbac_role_permissions rrp ON rrp.role_id = rr.id
      JOIN rbac_permissions p ON p.id = rrp.permission_id
      WHERE rr.\`key\` = ${legacyRole} AND rr.is_active = 1
      ORDER BY p.\`key\`
    `);
    return ((permsResult as any[][])[0] as Array<{ key: string }>).map(r => r.key);
  }

  return [];
}

/**
 * Comprueba si un usuario tiene un permiso concreto.
 * Listo para usarse en requirePermission cuando se active la fase siguiente.
 */
export async function hasPermission(
  userId: number,
  permissionKey: string,
  legacyRole?: string,
): Promise<boolean> {
  const perms = await getUserPermissions(userId, legacyRole);
  return perms.includes(permissionKey);
}

/**
 * Comprobación RBAC con fallback al sistema legacy de roles.
 *
 * Algoritmo:
 *  1. Llama a getUserPermissions (RBAC-first: si tiene roles RBAC los usa exclusivamente;
 *     si no tiene roles RBAC usa el rol legacy para derivar permisos).
 *  2. Si el permiso está en la lista → acceso concedido.
 *  3. Si getUserPermissions falla → fallback a fallbackAllowedRoles (rol legacy).
 *
 * Nunca lanza: siempre devuelve boolean.
 */
export async function checkRbacOrLegacy(
  userId: number,
  legacyRole: string,
  permissionKey: string,
  fallbackAllowedRoles: string[],
): Promise<boolean> {
  // Si la BD no está disponible, el fallback legacy es la única fuente de verdad.
  const db = await getDb();
  if (!db) return fallbackAllowedRoles.includes(legacyRole);
  try {
    const perms = await getUserPermissions(userId, legacyRole);
    return perms.includes(permissionKey);
  } catch {
    return fallbackAllowedRoles.includes(legacyRole);
  }
}
