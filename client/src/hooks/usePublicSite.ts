import { trpc } from "@/lib/trpc";
import { LEGACY_SITE_FEATURES, publicSiteText, type PublicSiteFeatures, type PublicSiteText } from "@shared/publicSite";

/**
 * Secciones de la web pública de la empresa (según lo contratado) y sus textos. Una sola consulta en caché para el
 * menú, el carrito, el pago y las rutas. En la instalación de una sola empresa, la web de siempre (sin consultar).
 * Mientras no se sabe, `features` es null y los textos son los genéricos (nunca lo sectorial de más).
 */
export function usePublicSite(): { features: PublicSiteFeatures | null; isLoading: boolean; text: PublicSiteText } {
  // Misma consulta y caché que useTenantTheme (components/TenantTheme.tsx)
  const theme = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const neutral = !!theme.data?.neutralSite;
  const q = trpc.public.siteFeatures.useQuery(undefined, { enabled: neutral, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const features = !theme.data ? null : neutral ? (q.data ?? null) : LEGACY_SITE_FEATURES;
  return { features, isLoading: theme.isLoading || (neutral && q.isLoading), text: publicSiteText(features) };
}
