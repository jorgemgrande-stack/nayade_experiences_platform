/**
 * Nombres visibles de los roles del panel (lista de usuarios, cabecera del panel e invitaciones por correo): una
 * sola fuente para que el mismo rol no aparezca con nombres distintos.
 */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: "Administrador",
  agente: "Comercial",
  monitor: "Monitor",
  adminrest: "Responsable de restaurante",
  // Solo ve el control diario de contabilidad (permiso accounting.daily_control)
  controler: "Control de gestión",
  readonly: "Solo lectura",
  user: "Usuario",
  commercial_agent: "Comercial",
  sales_cashier: "Comercial + caja",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
