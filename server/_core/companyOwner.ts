/**
 * Propietario de la empresa y salvaguardas de la gestión de usuarios.
 *
 * Roles del producto → roles existentes (sin roles comerciales nuevos):
 *  - Propietario de empresa: un `admin` cuyo email coincide con el ajuste `company_owner_email`
 *    (lo siembra el aprovisionamiento con el email de alta; ajuste sensible, no editable desde el
 *    panel). Solo él puede cambiar su propia cuenta (rol, estado, contraseña, borrado).
 *  - Administrador: `admin`.  - Empleado: `agente` (equipo).  - Solo lectura: `readonly`.
 *
 * Además, ningún administrador puede dejar la empresa sin administradores activos.
 * En instalación única sin el ajuste (Náyade hoy) no hay propietario: solo rige la regla del
 * último administrador.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { systemSettings, users } from "../../drizzle/schema";

export const OWNER_SETTING_KEY = "company_owner_email";

type Actor = { id: number; email?: string | null };
export type UserAdminAction = "change_role" | "toggle_active" | "set_password" | "delete";

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

/** Email del propietario (minúsculas) o `null` si la empresa no tiene propietario registrado. */
export async function getCompanyOwnerEmail(): Promise<string | null> {
  const d = await db();
  // Lectura directa (sin caché): es una decisión de autorización
  const [row] = await d.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, OWNER_SETTING_KEY)).limit(1);
  const v = row?.value?.trim().toLowerCase();
  return v ? v : null;
}

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/**
 * Comprueba, ANTES de ejecutar la acción, que el administrador `actor` puede hacerla sobre
 * `targetUserId`. `newRole` y `nextActive` describen el estado resultante cuando aplica.
 */
export async function assertUserAdminAllowed(
  actor: Actor,
  targetUserId: number,
  action: UserAdminAction,
  opts: { newRole?: string } = {},
): Promise<void> {
  const d = await db();
  const [target] = await d
    .select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado" });

  const owner = await getCompanyOwnerEmail();
  const targetIsOwner = !!owner && norm(target.email) === owner;
  const actorIsOwner = !!owner && norm(actor.email) === owner;

  if (targetIsOwner) {
    if (!actorIsOwner) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Solo el propietario de la empresa puede modificar su propia cuenta." });
    }
    // El propietario siempre es administrador activo de su empresa
    if (action === "delete" || action === "toggle_active" || (action === "change_role" && opts.newRole !== "admin")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "El propietario de la empresa no puede dejar de ser administrador activo." });
    }
    return;
  }

  // ¿Quita un administrador activo? Entonces debe quedar al menos otro.
  const removesActiveAdmin =
    target.role === "admin" &&
    target.isActive !== false &&
    (action === "delete" || action === "toggle_active" || (action === "change_role" && opts.newRole !== "admin"));
  if (removesActiveAdmin) {
    const [row] = await d
      .select({ n: sql<number>`COUNT(*)` })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
    if (Number(row?.n ?? 0) <= 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "La empresa debe conservar al menos un administrador activo." });
    }
  }
}
