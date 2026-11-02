/**
 * Comprobación de permisos con roles personalizados (capacidad Business `roles-custom`).
 *
 * Es una capa ADICIONAL sobre la comprobación de siempre (`checkRbacOrLegacy`, que no cambia): primero se decide como
 * hoy y solo después, si el usuario tiene un rol propio asignado cuyo rol base coincide con su rol, se aplican sus
 * diferencias (shared/customRoles.ts). Sin rol propio, el resultado es exactamente el de siempre; administración y los
 * roles que no pueden ser base (portales, usuario web) ni siquiera consultan la tabla.
 */
import { TRPCError } from "@trpc/server";
import { checkRbacOrLegacy } from "./_core/rbac";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getUserCustomRole } from "./customRolesDb";
import { decideAnyWithCustomRole, decideWithCustomRole, isCustomRoleBase, overrideApplies, type CustomRoleLicense } from "../shared/customRoles";

export const CUSTOM_ROLES_CAPABILITY = "roles-custom";

/** ¿Incluye el plan de la empresa en curso los roles personalizados? Si no puede verificarse, no. */
export async function customRolesLicensed(write = false): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(CUSTOM_ROLES_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

/** Licencia para APLICAR un rol propio: «unknown» si no puede verificarse (entonces solo se aplican restricciones). */
export async function customRolesLicense(): Promise<CustomRoleLicense> {
  try {
    return (await getCapabilityAccess().check(CUSTOM_ROLES_CAPABILITY, { write: false })).allowed ? "licensed" : "unlicensed";
  } catch {
    return "unknown";
  }
}

/** Exige la capacidad `roles-custom` (consultas: activa o solo lectura; cambios: activa). */
export async function assertCustomRolesLicensed(write: boolean): Promise<void> {
  if (!(await customRolesLicensed(write)))
    throw new TRPCError({ code: "FORBIDDEN", message: "Los roles personalizados no están incluidos en tu plan." });
}

/** Comprobación de un permiso: la de siempre y, encima, el rol propio del usuario si lo tiene. */
export async function checkPermission(userId: number, role: string, permissionKey: string, fallbackRoles: string[]): Promise<boolean> {
  const baseAllowed = await checkRbacOrLegacy(userId, role, permissionKey, fallbackRoles);
  if (!isCustomRoleBase(role)) return baseAllowed;
  const override = await getUserCustomRole(userId);
  if (!overrideApplies(override, role)) return baseAllowed;
  const license = await customRolesLicense();
  return decideWithCustomRole({ baseAllowed, key: permissionKey, fallbackRoles, override, userRole: role, license });
}

/** Como `checkPermission` cuando basta uno de varios permisos; `baseAllowed` es la decisión de siempre. */
export async function applyCustomRoleAny(userId: number, role: string, keys: string[], fallbackRoles: string[], baseAllowed: boolean): Promise<boolean> {
  if (!isCustomRoleBase(role)) return baseAllowed;
  const override = await getUserCustomRole(userId);
  if (!overrideApplies(override, role)) return baseAllowed;
  const license = await customRolesLicense();
  return decideAnyWithCustomRole({ baseAllowed, keys, fallbackRoles, override, userRole: role, license });
}
