/**
 * subscription.* — plan, prueba, capacidades y límites de la empresa en curso, para su panel.
 *
 * Solo lectura y solo presentación (menú por licencias y página «Suscripción»). No está en
 * TRPC_ROUTER_CAPABILITIES a propósito: una empresa en solo lectura o con la prueba vencida
 * tiene que poder ver su estado y cómo contratar.
 */
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantMode } from "../_core/tenant";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { buildSubscriptionOverview } from "../subscriptionOverview";
import { countPanelUsers, PANEL_ROLES } from "../subscriptionDb";
import { resolveSupportContact } from "../supportContact";

export const subscriptionRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    const mode = getTenantMode();
    const upgradeUrl = process.env.ELEPHANT_PRICING_URL ?? process.env.CP_TRIAL_PRICING_URL ?? null;
    if (mode !== "multi") return buildSubscriptionOverview({ mode, enforcing: false, grants: [], now: Date.now(), upgradeUrl });
    const access = getCapabilityAccess();
    let grants;
    try {
      grants = await access.list();
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar la suscripción. Inténtalo de nuevo en unos minutos." });
    }
    const usedUsers = await countPanelUsers();
    return buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants, now: Date.now(), usedUsers, upgradeUrl });
  }),
  /** Canal de ayuda (correo configurable): disponible también en solo lectura o con la prueba vencida. */
  supportContact: protectedProcedure.query(async ({ ctx }) => {
    if (!(PANEL_ROLES as readonly string[]).includes(String(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN" });
    return resolveSupportContact();
  }),
});
