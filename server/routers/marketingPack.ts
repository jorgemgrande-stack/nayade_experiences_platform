/**
 * marketingPack.ts — «Marketing · Puesta en marcha y resumen» del Paquete Marketing (solo lectura, solo administración).
 *
 * Licencia: basta CUALQUIERA de las cuatro capacidades del paquete (`ads-manager`, `email-campaigns`, `seo-control`,
 * `geo-control`). El guardián de rutas (TRPC_ROUTER_CAPABILITIES) asocia un namespace a UNA sola capacidad, así que este
 * namespace no está en esa tabla a propósito: la comprobación la hace server/marketingPack.ts, bloque a bloque con la
 * capacidad de cada módulo (sin ninguna, 403). La lógica está en server/marketingPack.ts y shared/marketingPack.ts.
 */
import { adminProcedure, router } from "../_core/trpc";
import { defaultMarketingPackDeps, getMarketingPackSummary } from "../marketingPack";

export const marketingPackRouter = router({
  summary: adminProcedure.query(async () => getMarketingPackSummary(await defaultMarketingPackDeps())),
});
