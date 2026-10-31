/**
 * Roles de los operadores humanos del plano de control y su traducción a los ámbitos (`scopes`)
 * existentes. El backend calcula los permisos en cada petición a partir del rol ACTUAL del
 * operador: un cambio de rol surte efecto de inmediato en todas sus sesiones.
 */
import { SCOPES, type Scope } from "./auth";

export const ROLES = ["superadmin", "admin", "sales", "support", "readonly"] as const;
export type OperatorRole = (typeof ROLES)[number];

export const ROLE_LABEL: Record<OperatorRole, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  sales: "Comercial",
  support: "Soporte",
  readonly: "Solo lectura",
};

const READ: Scope[] = ["tenants:read", "billing:read", "usage:read", "crm:read", "ops:read", "tickets:read", "web:read", "subscriptions:read", "orders:read", "finance:read"];

export const ROLE_SCOPES: Record<OperatorRole, readonly Scope[]> = {
  superadmin: SCOPES,
  admin: SCOPES,
  // Comercial edita borradores de la web; publicar queda para administración
  // Comercial consulta suscripciones; operar sobre ellas queda para administración
  // Comercial prepara pedidos (cotización, contrato, aceptación, pago de prueba); aprobar sin pago y activar, administración
  // Comercial consulta lo comercial (facturación, cobros, métricas) con billing:read; la contabilidad y la gestoría
  // (finance:*) quedan para administración
  sales: ["crm:read", "crm:write", "tenants:read", "billing:read", "usage:read", "tickets:read", "web:read", "web:write", "subscriptions:read", "orders:read", "orders:write"],
  support: ["tickets:read", "tickets:write", "support:write", "tenants:read", "usage:read", "ops:read", "crm:read", "web:read"],
  readonly: READ,
};

/** Jerarquía para la gestión de operadores: solo se gestiona a quien está por debajo. */
const RANK: Record<OperatorRole, number> = { superadmin: 100, admin: 50, sales: 10, support: 10, readonly: 10 };

/**
 * ¿Puede un operador con rol `actor` gestionar (editar, desactivar, cambiar contraseña, revocar
 * sesiones) a uno con rol `target`, o asignarle ese rol? El superadministrador gestiona a todos;
 * el administrador solo a los roles inferiores (nunca a otro administrador ni a un superadministrador).
 */
export function canManageRole(actor: OperatorRole, target: OperatorRole): boolean {
  if (actor === "superadmin") return true;
  return RANK[actor] > RANK[target] && ROLE_SCOPES[actor].includes("operators:write");
}

/** Roles que `actor` puede asignar (para la interfaz; el backend vuelve a comprobarlo). */
export const assignableRoles = (actor: OperatorRole): OperatorRole[] => ROLES.filter((r) => canManageRole(actor, r));

export const isRole = (v: unknown): v is OperatorRole => typeof v === "string" && (ROLES as readonly string[]).includes(v);
