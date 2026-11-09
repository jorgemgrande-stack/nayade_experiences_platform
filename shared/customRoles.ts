/**
 * Roles personalizados (capacidad Business `roles-custom`): lógica pura, sin BD ni React (la usan el servidor, el
 * panel y las pruebas).
 *
 * Un rol propio parte de un rol base de siempre (`users.role`) y solo guarda sus DIFERENCIAS con él: permisos que
 * quita y permisos que añade de la lista de abajo. Todo lo demás (menú, solo lectura, portales, comprobaciones por
 * rol) sigue siendo el del rol base. Sin rol propio asignado, nada cambia.
 *
 * Reglas de seguridad:
 *  - el rol base nunca es administración: un rol propio no puede dar más que un administrador ni gestionar usuarios,
 *    roles o configuración (esos permisos no están en la lista);
 *  - un permiso añadido solo concede acceso donde un administrador lo tiene (la comprobación incluye el rol `admin`);
 *  - sin la capacidad en el plan (p. ej. al volver a Essential) el rol propio no se aplica: el usuario tiene su rol base;
 *  - si la licencia no puede verificarse, solo se aplican las restricciones (quitar nunca da más acceso).
 */

/** Roles base de los que puede partir un rol propio (nunca `admin`). */
export const CUSTOM_ROLE_BASES = ["agente", "monitor", "adminrest", "controler", "readonly"] as const;
export type CustomRoleBase = (typeof CUSTOM_ROLE_BASES)[number];

export const CUSTOM_ROLE_NAME_MAX = 60;
export const CUSTOM_ROLES_MAX = 50;

export type CustomRoleEffect = "grant" | "revoke";

export interface CustomRolePermissionDef {
  key: string;
  label: string;
  group: string;
  /** Roles base que lo tienen hoy (el mismo criterio que la comprobación del servidor). */
  defaultRoles: readonly string[];
}

const p = (key: string, label: string, group: string, defaultRoles: string[]): CustomRolePermissionDef => ({ key, label, group, defaultRoles });

/**
 * Permisos que un rol propio puede quitar o añadir: los que el servidor comprueba por clave de permiso, con los roles
 * que los tienen hoy. Fuera de la lista (y por tanto intocables): acceso al equipo del CRM (`crm.view`) y
 * configuración y usuarios (`settings.*`, solo administración).
 */
export const CUSTOM_ROLE_PERMISSIONS: readonly CustomRolePermissionDef[] = [
  p("crm.reservations.manage", "Gestionar reservas del CRM", "Ventas", ["admin"]),
  p("discounts.view", "Ver códigos de descuento", "Ventas", ["admin", "agente"]),
  p("discounts.manage", "Gestionar códigos de descuento", "Ventas", ["admin"]),
  p("ticketing.manage", "Canjear cupones de plataformas", "Ventas", ["admin", "agente"]),
  p("tpv.access", "Entrar en el TPV", "TPV y caja", ["admin", "agente"]),
  p("tpv.sell", "Vender en el TPV", "TPV y caja", ["admin", "agente"]),
  p("tpv.open_close", "Abrir y cerrar caja del TPV", "TPV y caja", ["admin", "agente"]),
  p("tpv.backoffice", "Administración del TPV", "TPV y caja", ["admin"]),
  p("tpv.authorize", "Autorizar operaciones especiales del TPV", "TPV y caja", ["admin"]),
  p("operations.view", "Ver operaciones del día", "Operaciones", ["admin", "agente", "monitor"]),
  p("restaurants.view", "Gestionar restaurantes", "Operaciones", ["admin", "adminrest"]),
  p("accounting.daily_control", "Control diario de contabilidad", "Contabilidad", ["admin", "controler"]),
  p("accounting.reports.view", "Informes contables", "Contabilidad", ["admin"]),
  p("accounting.expenses.view", "Ver gastos", "Contabilidad", ["admin"]),
  p("accounting.expenses.manage", "Gestionar gastos", "Contabilidad", ["admin"]),
  p("accounting.cash.view", "Ver cajas", "Contabilidad", ["admin"]),
  p("accounting.cash.manage", "Gestionar cajas", "Contabilidad", ["admin"]),
  p("hr.view", "Personal (RRHH)", "Personas", ["admin"]),
  p("gestoria.view", "Ver portal de gestoría", "Personas", ["admin"]),
  p("gestoria.manage", "Gestionar gestoría", "Personas", ["admin"]),
];

const CATALOG = new Map(CUSTOM_ROLE_PERMISSIONS.map((d) => [d.key, d]));

export function isCustomRolePermission(key: string): boolean {
  return CATALOG.has(key);
}

export function isCustomRoleBase(role: string): role is CustomRoleBase {
  return (CUSTOM_ROLE_BASES as readonly string[]).includes(role);
}

/** Permisos de la lista que el rol base tiene hoy. */
export function basePermissions(base: string): string[] {
  return CUSTOM_ROLE_PERMISSIONS.filter((d) => d.defaultRoles.includes(base)).map((d) => d.key);
}

/** Diferencias con el rol base de un conjunto de permisos marcados (lo que se guarda). */
export function diffFromBase(base: string, wanted: readonly string[]): { grants: string[]; revokes: string[] } {
  const want = new Set(wanted.filter(isCustomRolePermission));
  const has = new Set(basePermissions(base));
  return {
    grants: CUSTOM_ROLE_PERMISSIONS.map((d) => d.key).filter((k) => want.has(k) && !has.has(k)),
    revokes: CUSTOM_ROLE_PERMISSIONS.map((d) => d.key).filter((k) => has.has(k) && !want.has(k)),
  };
}

/** Permisos de la lista que tiene un rol propio (base + añadidos − quitados). */
export function effectivePermissions(base: string, grants: readonly string[], revokes: readonly string[]): string[] {
  const out = new Set(basePermissions(base));
  for (const k of grants) if (isCustomRolePermission(k)) out.add(k);
  for (const k of revokes) out.delete(k);
  return CUSTOM_ROLE_PERMISSIONS.map((d) => d.key).filter((k) => out.has(k));
}

/** Nombre limpio o mensaje de error. */
export function normalizeCustomRoleName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Indica un nombre para el rol." };
  if (name.length > CUSTOM_ROLE_NAME_MAX) return { ok: false, error: `El nombre admite como máximo ${CUSTOM_ROLE_NAME_MAX} caracteres.` };
  return { ok: true, name };
}

/** Estado de la licencia `roles-custom` para aplicar un rol propio. */
export type CustomRoleLicense = "licensed" | "unlicensed" | "unknown";

/** Rol propio de un usuario tal como lo aplica la comprobación de permisos. */
export interface CustomRoleOverride {
  roleId: number;
  baseRole: string;
  grants: ReadonlySet<string>;
  revokes: ReadonlySet<string>;
}

/**
 * ¿Se aplica el rol propio a este usuario? Solo si su rol de siempre coincide con el rol base (si alguien cambia el rol
 * del usuario, el rol propio deja de aplicarse sin tocar nada más) y el rol base es válido.
 */
export function overrideApplies(override: CustomRoleOverride | null | undefined, userRole: string): override is CustomRoleOverride {
  return !!override && override.baseRole === userRole && isCustomRoleBase(userRole);
}

/**
 * Decisión final de UNA comprobación de permiso con rol propio.
 *  - `baseAllowed`: lo que decide hoy la comprobación de siempre (sin rol propio);
 *  - `license`: con la capacidad se aplica entero; sin ella, no se aplica; sin poder verificarla, solo lo que quita.
 */
export function decideWithCustomRole(o: {
  baseAllowed: boolean;
  key: string;
  fallbackRoles: readonly string[];
  override: CustomRoleOverride | null | undefined;
  userRole: string;
  license: CustomRoleLicense;
}): boolean {
  if (!overrideApplies(o.override, o.userRole) || o.license === "unlicensed") return o.baseAllowed;
  if (o.override.revokes.has(o.key)) return false;
  if (o.license === "licensed" && o.override.grants.has(o.key) && isCustomRolePermission(o.key) && o.fallbackRoles.includes("admin")) return true;
  return o.baseAllowed;
}

/** Como `decideWithCustomRole` cuando basta uno de varios permisos. */
export function decideAnyWithCustomRole(o: {
  baseAllowed: boolean;
  keys: readonly string[];
  fallbackRoles: readonly string[];
  override: CustomRoleOverride | null | undefined;
  userRole: string;
  license: CustomRoleLicense;
}): boolean {
  if (!overrideApplies(o.override, o.userRole) || o.license === "unlicensed" || o.keys.length === 0) return o.baseAllowed;
  const per = o.keys.map((key) => decideWithCustomRole({ ...o, key, baseAllowed: o.baseAllowed }));
  if (o.keys.every((k) => o.override!.revokes.has(k))) return false;
  return per.some(Boolean);
}
