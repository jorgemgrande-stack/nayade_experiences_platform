/**
 * ¿Tiene la base de datos de la empresa las tablas de RBAC granular?
 *
 * Las tablas `rbac_*` no están en la baseline de las empresas nuevas ni en producción, A PROPÓSITO
 * (`KNOWN_ABSENT_TABLES` en `_core/schemaCheck.ts`): crearlas sin sembrar antes todos los permisos de
 * cada rol haría que `checkRbacOrLegacy` denegase el acceso a usuarios legítimos (con las tablas
 * presentes manda RBAC, no el rol del usuario). Por eso no se crean aquí: sin ellas, la gestión de
 * roles RBAC no se ofrece y el servidor responde con un error claro en lugar de un error interno.
 * El acceso se gobierna con el rol del usuario (`users.role`), incluido «solo lectura».
 */
import { sql } from "drizzle-orm";

export const RBAC_TABLES = ["rbac_roles", "rbac_permissions", "rbac_role_permissions", "rbac_user_roles"] as const;

export const RBAC_UNAVAILABLE_MESSAGE =
  "Los roles avanzados (RBAC) no están disponibles en esta empresa. Gestiona el acceso con el rol de cada usuario (Administrador, Empleado, Solo lectura…).";

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** true solo si existen las cuatro tablas en la base de datos de la conexión (la de la empresa en curso). */
export async function rbacTablesAvailable(db: Executor): Promise<boolean> {
  const list = sql.join(RBAC_TABLES.map((t) => sql`${t}`), sql`, `);
  const result = await db.execute(sql`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN (${list})
  `);
  const rows = (result as unknown[][])[0] as Array<{ n: number | string }> | undefined;
  return Number(rows?.[0]?.n ?? 0) === RBAC_TABLES.length;
}
