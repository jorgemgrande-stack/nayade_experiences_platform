/**
 * Roles personalizados (capacidad Business `roles-custom`): roles propios de la empresa, sus diferencias de permisos con
 * el rol base y el rol propio asignado a cada usuario.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant): una empresa nunca lee ni escribe los
 * roles de otra. Tablas de db/migrations/0022_custom_roles (fuera de drizzle/schema.ts, como la 0021). El rol de
 * siempre de cada usuario (`users.role`) no se modifica nunca desde aquí.
 */
import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { getTenantIdOrDefault } from "./_core/tenant";
import {
  CUSTOM_ROLES_MAX, diffFromBase, effectivePermissions, isCustomRoleBase, normalizeCustomRoleName,
  type CustomRoleEffect, type CustomRoleOverride,
} from "../shared/customRoles";

export const customRoles = mysqlTable("custom_roles", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 60 }).notNull(),
  baseRole: varchar("base_role", { length: 32 }).notNull(),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at", { fsp: 3 }),
  updatedAt: timestamp("updated_at", { fsp: 3 }),
});

export const customRolePermissions = mysqlTable("custom_role_permissions", {
  roleId: int("role_id").notNull(),
  permissionKey: varchar("permission_key", { length: 128 }).notNull(),
  effect: varchar("effect", { length: 8 }).notNull(),
});

export const customRoleUsers = mysqlTable("custom_role_users", {
  userId: int("user_id").primaryKey(),
  roleId: int("role_id").notNull(),
  assignedBy: int("assigned_by"),
  assignedAt: timestamp("assigned_at", { fsp: 3 }),
});

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

const errCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
};

/** Sin la migración 0022 aplicada en esta empresa: aviso claro en lugar de un error interno. */
function notReady(e: unknown): never {
  if (errCode(e) === "ER_NO_SUCH_TABLE")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Los roles personalizados aún no están preparados en tu empresa. Inténtalo de nuevo en unos minutos." });
  throw e;
}

// ── Caché corta del rol propio de cada usuario (se consulta en cada comprobación de permiso) ─────────────────────────

const OVERRIDE_TTL_MS = 5_000;
const overrideCache = new Map<string, { at: number; value: CustomRoleOverride | null }>();

/** Olvida los roles propios en caché (tras cualquier cambio de roles o asignaciones). */
export function invalidateCustomRoleCache(): void {
  overrideCache.clear();
}

/**
 * Rol propio asignado al usuario en la empresa en curso, o null. Sin las tablas (migración aún no aplicada) o con
 * cualquier error de lectura, null: el usuario se comporta exactamente como hoy con su rol de siempre.
 */
export async function getUserCustomRole(userId: number): Promise<CustomRoleOverride | null> {
  const key = `${getTenantIdOrDefault()}:${userId}`;
  const hit = overrideCache.get(key);
  if (hit && Date.now() - hit.at < OVERRIDE_TTL_MS) return hit.value;
  let value: CustomRoleOverride | null = null;
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ roleId: customRoles.id, baseRole: customRoles.baseRole })
      .from(customRoleUsers)
      .innerJoin(customRoles, eq(customRoles.id, customRoleUsers.roleId))
      .where(eq(customRoleUsers.userId, userId))
      .limit(1);
    if (row) {
      const perms = await db
        .select({ key: customRolePermissions.permissionKey, effect: customRolePermissions.effect })
        .from(customRolePermissions)
        .where(eq(customRolePermissions.roleId, row.roleId));
      value = {
        roleId: row.roleId,
        baseRole: row.baseRole,
        grants: new Set(perms.filter((x) => x.effect === "grant").map((x) => x.key)),
        revokes: new Set(perms.filter((x) => x.effect === "revoke").map((x) => x.key)),
      };
    }
  } catch {
    return null;
  }
  overrideCache.set(key, { at: Date.now(), value });
  return value;
}

// ── Gestión (solo administración, con la capacidad) ─────────────────────────────────────────────────────────────────

export interface CustomRoleView {
  id: number;
  name: string;
  baseRole: string;
  grants: string[];
  revokes: string[];
  /** Permisos de la lista que tiene el rol (base + añadidos − quitados). */
  permissions: string[];
  users: Array<{ id: number; name: string | null; email: string | null; role: string; applies: boolean }>;
}

export async function listCustomRoles(): Promise<CustomRoleView[]> {
  const db = await requireDb();
  try {
    const roles = await db.select().from(customRoles).orderBy(asc(customRoles.name));
    if (roles.length === 0) return [];
    const ids = roles.map((r) => r.id);
    const perms = await db.select().from(customRolePermissions).where(inArray(customRolePermissions.roleId, ids));
    const assigned = await db
      .select({ roleId: customRoleUsers.roleId, id: users.id, name: users.name, email: users.email, role: users.role })
      .from(customRoleUsers)
      .innerJoin(users, eq(users.id, customRoleUsers.userId))
      .where(inArray(customRoleUsers.roleId, ids));
    return roles.map((r) => {
      const mine = perms.filter((x) => x.roleId === r.id);
      const grants = mine.filter((x) => x.effect === "grant").map((x) => x.permissionKey);
      const revokes = mine.filter((x) => x.effect === "revoke").map((x) => x.permissionKey);
      return {
        id: r.id,
        name: r.name,
        baseRole: r.baseRole,
        grants,
        revokes,
        permissions: effectivePermissions(r.baseRole, grants, revokes),
        users: assigned
          .filter((u) => u.roleId === r.id)
          .map((u) => ({ id: u.id, name: u.name ?? null, email: u.email ?? null, role: String(u.role), applies: String(u.role) === r.baseRole })),
      };
    });
  } catch (e) {
    notReady(e);
  }
}

async function writePermissions(db: Db, roleId: number, baseRole: string, permissions: readonly string[]) {
  const { grants, revokes } = diffFromBase(baseRole, permissions);
  await db.delete(customRolePermissions).where(eq(customRolePermissions.roleId, roleId));
  const rows = [
    ...grants.map((k) => ({ roleId, permissionKey: k, effect: "grant" as CustomRoleEffect })),
    ...revokes.map((k) => ({ roleId, permissionKey: k, effect: "revoke" as CustomRoleEffect })),
  ];
  if (rows.length) await db.insert(customRolePermissions).values(rows);
}

function cleanName(raw: string): string {
  const n = normalizeCustomRoleName(raw);
  if (!n.ok) throw new TRPCError({ code: "BAD_REQUEST", message: n.error });
  return n.name;
}

function duplicate(e: unknown): never {
  if (errCode(e) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe un rol con ese nombre." });
  notReady(e);
}

export async function createCustomRole(input: { name: string; baseRole: string; permissions: string[] }, actorId: number): Promise<{ id: number }> {
  const name = cleanName(input.name);
  if (!isCustomRoleBase(input.baseRole))
    throw new TRPCError({ code: "BAD_REQUEST", message: "El rol base no es válido. Un rol propio no puede partir de Administrador." });
  const db = await requireDb();
  try {
    const existing = await db.select({ id: customRoles.id }).from(customRoles);
    if (existing.length >= CUSTOM_ROLES_MAX) throw new TRPCError({ code: "BAD_REQUEST", message: `Se admiten como máximo ${CUSTOM_ROLES_MAX} roles propios.` });
    const [res] = await db.insert(customRoles).values({ name, baseRole: input.baseRole, createdBy: actorId });
    const id = Number((res as { insertId?: number }).insertId);
    await writePermissions(db, id, input.baseRole, input.permissions);
    invalidateCustomRoleCache();
    return { id };
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    duplicate(e);
  }
}

async function findRole(db: Db, id: number) {
  const [role] = await db.select().from(customRoles).where(eq(customRoles.id, id)).limit(1);
  if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Rol no encontrado." });
  return role;
}

/** Cambia nombre y permisos; el rol base no cambia (para eso se crea otro rol). */
export async function updateCustomRole(input: { id: number; name: string; permissions: string[] }): Promise<void> {
  const name = cleanName(input.name);
  const db = await requireDb();
  try {
    const role = await findRole(db, input.id);
    await db.update(customRoles).set({ name }).where(eq(customRoles.id, role.id));
    await writePermissions(db, role.id, role.baseRole, input.permissions);
    invalidateCustomRoleCache();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    duplicate(e);
  }
}

/** Solo se elimina un rol que no tiene usuarios asignados. */
export async function removeCustomRole(id: number): Promise<{ success: true }> {
  const db = await requireDb();
  try {
    const role = await findRole(db, id);
    const assigned = await db
      .select({ id: users.id })
      .from(customRoleUsers)
      .innerJoin(users, eq(users.id, customRoleUsers.userId))
      .where(eq(customRoleUsers.roleId, role.id))
      .limit(1);
    if (assigned.length) throw new TRPCError({ code: "CONFLICT", message: "Este rol tiene usuarios asignados: quítaselo antes de eliminarlo." });
    // Asignaciones huérfanas (usuarios ya eliminados) y permisos del rol
    await db.delete(customRoleUsers).where(eq(customRoleUsers.roleId, role.id));
    await db.delete(customRolePermissions).where(eq(customRolePermissions.roleId, role.id));
    await db.delete(customRoles).where(eq(customRoles.id, role.id));
    invalidateCustomRoleCache();
    return { success: true };
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    notReady(e);
  }
}

/**
 * Asigna (o quita, con `roleId = null`) el rol propio de un usuario. El rol de siempre del usuario debe ser el rol base
 * del rol propio: un administrador nunca recibe un rol propio (ni puede quitarse permisos a sí mismo por esta vía).
 */
export async function assignCustomRole(userId: number, roleId: number | null, actorId: number): Promise<{ success: true }> {
  const db = await requireDb();
  try {
    const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
    if (roleId === null) {
      await db.delete(customRoleUsers).where(eq(customRoleUsers.userId, userId));
      invalidateCustomRoleCache();
      return { success: true };
    }
    const role = await findRole(db, roleId);
    if (String(user.role) !== role.baseRole)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Este rol propio solo se puede asignar a usuarios con su mismo rol base." });
    await db
      .insert(customRoleUsers)
      .values({ userId, roleId: role.id, assignedBy: actorId })
      .onDuplicateKeyUpdate({ set: { roleId: role.id, assignedBy: actorId } });
    invalidateCustomRoleCache();
    return { success: true };
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    notReady(e);
  }
}
