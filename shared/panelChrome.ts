/**
 * Consultas del marco del panel (AdminLayout) que dependen de la capacidad `admin-panel`: los interruptores de módulos
 * (`config.listFeatureFlags`) y el feed de avisos (`notifications.feed`).
 *
 * El plan personal Life no incluye `admin-panel` (shared/personalPlans.ts). Si el marco las pedía igualmente, el 403 de
 * licencia tumbaba la petición agrupada entera, también las consultas de Life Net de la pantalla. Solo se piden si la
 * capacidad está (o en el menú de siempre, sin licencias por capacidad). Sin ellas el menú se muestra igual: los
 * interruptores sin cargar no ocultan nada y el feed queda vacío.
 */
export const PANEL_CHROME_CAPABILITY = "admin-panel";

export function panelChromeQueries(o: { isAuthenticated: boolean; role: string; can: (capabilityId: string) => boolean }): { featureFlags: boolean; notifications: boolean } {
  const licensed = o.isAuthenticated && o.can(PANEL_CHROME_CAPABILITY);
  return { featureFlags: licensed && o.role === "admin", notifications: licensed && ["admin", "agente"].includes(o.role) };
}
