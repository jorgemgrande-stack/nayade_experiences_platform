/**
 * connect.* — Elephant Connect («Amplía tu empresa») en el panel: el catálogo con el estado de cada módulo para la
 * empresa de la SESIÓN (licencias reales del registro) y si esta persona puede contratar en línea.
 *
 * Solo lectura. La compra reutiliza `subscription.purchasePreview` → `purchase` → `purchaseStatus` (idempotente por
 * clave, importes del plano de control y activación solo con el cobro verificado). No está en
 * TRPC_ROUTER_CAPABILITIES: ver qué se puede ampliar tiene que funcionar sin el módulo contratado.
 */
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantId, getTenantMode } from "../_core/tenant";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { opsLog } from "../_core/ops/log";
import { commerceClientFromEnv } from "../commerceClient";
import { PANEL_ROLES } from "../subscriptionDb";
import { buildSubscriptionOverview, safeUpgradeUrl } from "../subscriptionOverview";
import { resolveSupportContact } from "../supportContact";
import { isTrialTenant } from "../trialPayments";
import type { PanelCatalogItemView } from "../panelModules";
import { buildConnectCatalog, type ConnectItem } from "../connectMarketplace";
import type { PurchaseBlock } from "../../shared/connectMarketplace";

export interface ConnectCatalogView {
  /** false: fuera de multiempresa (la página lo explica y ofrece contacto). En multiempresa, sin canal es un error. */
  available: boolean;
  purchasesEnabled: boolean;
  /** Esta persona puede contratar en línea ahora mismo. */
  canPurchase: boolean;
  /** Por qué no (null si puede). */
  purchaseBlock: PurchaseBlock;
  plan: { key: string; name: string } | null;
  items: ConnectItem[];
  upgradeUrl: string | null;
  supportEmail: string | null;
  /** Se pueden enviar solicitudes al equipo desde el panel (soporte). */
  requestsEnabled: boolean;
}

export const connectRouter = router({
  catalog: protectedProcedure.query(async ({ ctx }): Promise<ConnectCatalogView> => {
    const role = String(ctx.user.role);
    if (!(PANEL_ROLES as readonly string[]).includes(role)) throw new TRPCError({ code: "FORBIDDEN" });
    const upgradeUrl = process.env.ELEPHANT_PRICING_URL ?? process.env.CP_TRIAL_PRICING_URL ?? null;
    const supportEmail = (await resolveSupportContact().catch(() => ({ email: null }))).email;
    const client = commerceClientFromEnv();
    const base = { upgradeUrl: safeUpgradeUrl(upgradeUrl), supportEmail };
    if (getTenantMode() !== "multi") {
      return { available: false, purchasesEnabled: false, canPurchase: false, purchaseBlock: "unavailable", plan: null, items: [], requestsEnabled: false, ...base };
    }
    // En multiempresa el catálogo existe siempre: sin canal con el plano de control es una avería (configuración del
    // Core), no un catálogo vacío. Se devuelve un error recuperable para que la página ofrezca reintentar.
    if (!client) {
      opsLog("error", "Connect", "catalog_channel_missing", { tenantId: getTenantId() });
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "El catálogo no está disponible en este momento. Inténtalo de nuevo en unos minutos." });
    }
    const access = getCapabilityAccess();
    try {
      const tenantId = getTenantId();
      const [catalog, grants] = await Promise.all([client.catalog(tenantId) as Promise<{ purchasesEnabled: boolean; items: PanelCatalogItemView[] }>, access.list(tenantId)]);
      const now = access.currentTime();
      const overview = buildSubscriptionOverview({ mode: "multi", enforcing: access.enforcing(), grants, now });
      const items = buildConnectCatalog(catalog, grants, now, overview.plan?.key ?? null);
      const purchaseBlock: PurchaseBlock = role !== "admin" ? "role" : (await isTrialTenant()) ? "trial" : !catalog.purchasesEnabled ? "closed" : null;
      return { available: true, purchasesEnabled: catalog.purchasesEnabled, canPurchase: purchaseBlock === null, purchaseBlock, plan: overview.plan, items, requestsEnabled: true, ...base };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo consultar el catálogo. Inténtalo de nuevo en unos minutos." });
    }
  }),
});
