import { and, count, inArray } from "drizzle-orm";
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

/**
 * Buzones de usuarios del panel de la empresa en curso entre `candidates` (en minúsculas). Para el correo de la
 * prueba gratuita (server/trialRestrictions.ts). null si la BD no responde.
 */
export async function panelUserMailboxes(candidates: string[]): Promise<Set<string> | null> {
  const list = Array.from(new Set(candidates.map((e) => e.trim().toLowerCase()).filter(Boolean))).slice(0, 200);
  if (!list.length) return new Set();
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select({ email: users.email }).from(users).where(and(inArray(users.role, [...PANEL_ROLES]), inArray(users.email, list)));
    return new Set(rows.map((r) => String(r.email ?? "").toLowerCase()).filter(Boolean));
  } catch {
    return null;
  }
}
