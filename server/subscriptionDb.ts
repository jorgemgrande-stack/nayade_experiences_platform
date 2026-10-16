import { count, inArray } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";

/** Roles con acceso al panel de administración (los que cuentan para el límite de usuarios del plan), incluido solo lectura. */
export const PANEL_ROLES = ["admin", "agente", "monitor", "adminrest", "controler", "readonly"] as const;

/** Usuarios del panel de la empresa en curso; null si la BD no responde. */
export async function countPanelUsers(): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db.select({ n: count() }).from(users).where(inArray(users.role, [...PANEL_ROLES]));
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}
