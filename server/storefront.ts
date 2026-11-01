/**
 * Ficha pública de producto de la empresa en curso (ver shared/storefront.ts): sectorial sin licencias por
 * capacidad y genérica en una pyme. Solo presentación: no autoriza nada.
 */
import { getTenantMode } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { buildSubscriptionOverview } from "./subscriptionOverview";
import { FALLBACK_GENERIC_STOREFRONT, resolveStorefront, type Storefront } from "../shared/storefront";

export async function getStorefront(): Promise<Storefront> {
  const mode = getTenantMode();
  if (mode !== "multi") return resolveStorefront({ mode, licensing: "legacy", can: () => true });
  try {
    const access = getCapabilityAccess();
    const o = buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants: await access.list(), now: access.currentTime() });
    const visible = new Set(o.visible);
    return resolveStorefront({ mode, licensing: o.licensing, can: (id) => visible.has(id) });
  } catch {
    // Sin poder leer las licencias: la ficha genérica, que no promete nada que la empresa no haya configurado
    return FALLBACK_GENERIC_STOREFRONT;
  }
}
