/**
 * RBAC helpers — Phase 3.
 *
 * Regla de prioridad:
 *   1. Si el usuario tiene entradas en rbac_user_roles → usar esos roles y sus permisos.
 *   2. Si no tiene entradas → fallback a users.role (legacy) para derivar permisos.
 *   3. Cualquier error → retornar vacío sin romper el flujo.
 *
 * IMPORTANTE: estos helpers son de lectura / auditoría. No se usan en middleware
 * de routers en esta fase. Los accesos siguen controlados por users.role vía
 * adminProcedure / staffProcedure / adminrestProcedure.
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
 */
export async function getUserPermissions(
  userId: number,
  legacyRole?: string,
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  try {
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
  } catch {
    return [];
  }
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
