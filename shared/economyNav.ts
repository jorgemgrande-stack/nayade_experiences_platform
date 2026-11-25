/**
 * Estructura de navegación de Economía y contabilidad (lógica pura, sin React: la usan el cliente y las pruebas).
 *
 * Cuatro grupos (Hoy · Movimientos · TPV · Resultados) con las pantallas que YA existen, con sus rutas de siempre. La
 * visibilidad no inventa reglas: reutiliza las del menú lateral (`routeAccess` de `adminNav`, que mira las capacidades
 * del plan por ruta) y los roles del menú (administración; el rol «controler» solo ve el Control diario). Es solo
 * presentación: la autorización real se hace en el servidor en cada operación.
 */
import { TASK_NAV, routeAccess } from "./adminNav";
import type { PanelRoute } from "./panelExtensions";

export type EconomyGroupId = "today" | "movements" | "pos" | "results";

export const ECONOMY_GROUPS: readonly EconomyGroupId[] = ["today", "movements", "pos", "results"];

export type EconomyScreenId =
  | "summary" | "daily"
  | "transactions" | "expenses" | "recurring" | "suppliers" | "categories" | "costCenters" | "cash" | "bank"
  | "pos" | "batches" | "conciliation"
  | "profitLoss" | "reports" | "general" | "financeSync";

export interface EconomyScreen {
  id: EconomyScreenId;
  /** Ruta existente de la pantalla (no cambia). */
  href: string;
  group: EconomyGroupId;
  /** Subpantalla de otra (Recurrentes, Proveedores… cuelgan de Gastos). */
  parent?: EconomyScreenId;
}

const C = "/admin/contabilidad";

export const ECONOMY_SCREENS: readonly EconomyScreen[] = [
  { id: "summary", href: `${C}/dashboard`, group: "today" },
  { id: "daily", href: `${C}/control-diario`, group: "today" },
  { id: "transactions", href: `${C}/transacciones`, group: "movements" },
  { id: "expenses", href: `${C}/gastos`, group: "movements" },
  { id: "recurring", href: `${C}/gastos/recurrentes`, group: "movements", parent: "expenses" },
  { id: "suppliers", href: `${C}/gastos/proveedores`, group: "movements", parent: "expenses" },
  { id: "categories", href: `${C}/gastos/categorias`, group: "movements", parent: "expenses" },
  { id: "costCenters", href: `${C}/gastos/centros-coste`, group: "movements", parent: "expenses" },
  { id: "cash", href: `${C}/caja`, group: "movements" },
  { id: "bank", href: `${C}/movimientos-bancarios`, group: "movements" },
  { id: "pos", href: `${C}/operaciones-tpv`, group: "pos" },
  { id: "batches", href: `${C}/remesas-tpv`, group: "pos" },
  { id: "conciliation", href: `${C}/conciliacion-tpv`, group: "pos" },
  { id: "profitLoss", href: `${C}/cuenta-resultados`, group: "results" },
  { id: "reports", href: `${C}/informes`, group: "results" },
  { id: "general", href: `${C}/general`, group: "results" },
  { id: "financeSync", href: `${C}/finance-sync`, group: "results" },
];

export const economyScreen = (id: EconomyScreenId): EconomyScreen => ECONOMY_SCREENS.find((s) => s.id === id)!;

export interface EconomyNavContext {
  /** Rol del usuario (`user.role`). */
  role: string;
  /** Modo del menú: por capacidades (empresas con plan) o el de siempre. */
  mode: "tasks" | "legacy";
  /** Estado de una capacidad (el mismo que usa el menú lateral). */
  capabilityState: (capabilityId: string) => "active" | "read_only" | null;
  extensionRoutes?: readonly PanelRoute[];
}

/** Capacidades con las que el menú lateral (TASK_NAV) habilita esta ruta; vacío si el menú no la lista. */
function menuCapabilities(href: string): string[] {
  const caps = new Set<string>();
  for (const section of TASK_NAV) {
    for (const item of section.items) {
      if (item.href === href) item.capabilities?.forEach((c) => caps.add(c));
      for (const ch of item.children ?? []) if (ch.href === href) (ch.capabilities ?? item.capabilities)?.forEach((c) => caps.add(c));
    }
  }
  return Array.from(caps);
}

/** ¿Ve esta persona la pantalla en el menú lateral? Misma decisión que el menú: rol + capacidades de la ruta. */
export function economyScreenVisible(screen: EconomyScreen, ctx: EconomyNavContext): boolean {
  const role = ctx.role === "readonly" ? "agente" : ctx.role;
  const rolesAllowed = screen.id === "daily" ? ["admin", "controler"] : ["admin"];
  if (!rolesAllowed.includes(role)) return false;
  if (role === "controler") return true;
  if (ctx.mode !== "tasks") return true;
  // Con el menú por capacidades: las mismas del ítem del menú si está listado; si no (Control diario, Caja), las de la ruta.
  const listed = menuCapabilities(screen.href);
  if (listed.length) return listed.some((c) => ctx.capabilityState(c) !== null);
  return routeAccess(screen.href, ctx.capabilityState, ctx.extensionRoutes) !== "not_included";
}

export function visibleEconomyScreens(ctx: EconomyNavContext): EconomyScreen[] {
  return ECONOMY_SCREENS.filter((s) => economyScreenVisible(s, ctx));
}

/** Pantallas principales visibles de un grupo (las subpantallas cuelgan de su pantalla y no se repiten). */
export function groupScreens(group: EconomyGroupId, visible: readonly EconomyScreen[]): EconomyScreen[] {
  return visible.filter((s) => s.group === group && !s.parent);
}

/** Subpantallas visibles de una pantalla, con ella misma la primera (Gastos · Recurrentes · Proveedores…). */
export function subScreens(parentId: EconomyScreenId, visible: readonly EconomyScreen[]): EconomyScreen[] {
  return visible.filter((s) => s.id === parentId || s.parent === parentId);
}
