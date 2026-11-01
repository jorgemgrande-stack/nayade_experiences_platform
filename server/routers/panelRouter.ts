/**
 * panel.* — navegación dinámica del panel para la empresa en curso.
 *
 * `navigation`: aportaciones de las extensiones (módulos Net, extras Connect, SDK) que la empresa tiene contratadas
 * (activas o en solo lectura), compatibles con esta versión del Core y permitidas al rol del usuario, más las rutas
 * de todas las extensiones para que el guardián del panel bloquee las no contratadas. Licencias de la SESIÓN (tenant
 * del servidor), nunca del navegador. Solo presentación: no está en TRPC_ROUTER_CAPABILITIES a propósito (una
 * empresa en solo lectura ve igualmente su menú); cada operación se autoriza en el servidor.
 */
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantMode } from "../_core/tenant";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getModuleAccess } from "../_core/modules/runtime";
import { CORE_VERSION } from "../../shared/version";
import { capabilityStateFrom } from "../../shared/adminNav";
import { panelExtensionSources, resolvePanelNavigation } from "../_core/modules/panelNavigation";
import { buildSubscriptionOverview } from "../subscriptionOverview";
import { PANEL_ROLES } from "../subscriptionDb";
import { checkRbacOrLegacy } from "../_core/rbac";

export const panelRouter = router({
  navigation: protectedProcedure.query(async ({ ctx }) => {
    const role = String(ctx.user.role);
    if (!(PANEL_ROLES as readonly string[]).includes(role)) throw new TRPCError({ code: "FORBIDDEN" });
    const mode = getTenantMode();
    let capabilityState: (id: string) => "active" | "read_only" | null = () => "active";
    if (mode === "multi") {
      const access = getCapabilityAccess();
      let grants;
      try {
        grants = await access.list();
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar tu menú. Inténtalo de nuevo en unos minutos." });
      }
      // El mismo cálculo que `subscription.overview` (menú y guardián coinciden)
      capabilityState = capabilityStateFrom(buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants, now: access.currentTime() }));
    }
    const modules = getModuleAccess();
    return resolvePanelNavigation(panelExtensionSources(), {
      coreVersion: CORE_VERSION,
      role,
      capabilityState,
      moduleAvailable: (id) => modules.isModuleAvailable(id).catch(() => false),
      hasPermission: (key) => checkRbacOrLegacy(ctx.user.id, role, key, ["admin"]),
    });
  }),
});
