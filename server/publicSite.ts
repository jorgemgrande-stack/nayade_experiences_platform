/**
 * Secciones de la web pública de la empresa en curso según lo que tiene contratado (shared/publicSite.ts).
 *
 * Mismo criterio que el panel (subscription.overview): fuera de multiempresa, o en una empresa sin licencias por
 * capacidad, la web de siempre. Solo presentación y 404 reales: cada operación sigue comprobando su licencia.
 */
import { getTenantMode } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { decide } from "./_core/capabilities/model";
import { LEGACY_SITE_FEATURES, SECTOR_SECTIONS, siteFeaturesFrom, type PublicSiteFeatures } from "../shared/publicSite";

/** Si no se pueden leer las licencias: lo básico de una pyme (nunca lo sectorial). */
const FALLBACK: PublicSiteFeatures = { licensed: true, store: true, checkout: true, quotes: true, coupons: false, hotel: false, spa: false, restaurants: false };

export async function readPublicSiteFeatures(): Promise<PublicSiteFeatures> {
  if (getTenantMode() !== "multi") return LEGACY_SITE_FEATURES;
  const access = getCapabilityAccess();
  try {
    const grants = await access.list();
    if (grants.length === 0 && !access.enforcing()) return LEGACY_SITE_FEATURES;
    const now = access.currentTime();
    const { getModuleAccess } = await import("./_core/modules/runtime");
    const modules = getModuleAccess();
    const on = new Set<string>();
    for (const s of SECTOR_SECTIONS) if (await modules.isModuleAvailable(s.module).catch(() => false)) on.add(s.module);
    return siteFeaturesFrom({ licensed: true, can: (id) => decide(grants, id, { write: false, now }).allowed, module: (id) => on.has(id) });
  } catch {
    return FALLBACK;
  }
}
