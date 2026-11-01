/**
 * Catálogo público: la ficha y el listado sectoriales (actividades, instalación propia) o los genéricos de tienda
 * de una pyme. `/experiencias[/slug]` y `/tienda[/slug]` llevan a la dirección de la ficha que corresponde a la
 * empresa (lógica en shared/storefront.ts).
 */
import type { ComponentType } from "react";
import { Redirect, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { canonicalCatalogPath, FALLBACK_GENERIC_STOREFRONT, type Storefront } from "@shared/storefront";

export function useStorefront(): { storefront: Storefront | null; isLoading: boolean } {
  // Viaja con la identidad pública (`public.getTheme`), que ya carga toda página pública
  const q = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  if (q.isLoading) return { storefront: null, isLoading: true };
  return { storefront: q.data?.storefront ?? FALLBACK_GENERIC_STOREFRONT, isLoading: false };
}

export function CatalogRoute({ Sector, Generic }: { Sector: ComponentType; Generic: ComponentType }) {
  const [location] = useLocation();
  const { storefront, isLoading } = useStorefront();
  if (isLoading || !storefront) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  const to = canonicalCatalogPath(location, storefront.kind);
  if (to) return <Redirect to={to + (typeof window !== "undefined" ? window.location.search : "")} replace />;
  return storefront.kind === "generic" ? <Generic /> : <Sector />;
}
