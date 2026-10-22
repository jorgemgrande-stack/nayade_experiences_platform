/**
 * Marca de la empresa en curso para el panel (nombre, logotipo y web), desde sus ajustes públicos.
 * Sin ajustes, valores neutros: el panel nunca muestra la marca de otra empresa.
 */
import { trpc } from "@/lib/trpc";

export interface PanelBrand {
  /** Nombre comercial, o null si la empresa aún no lo ha configurado. */
  name: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
}

export function usePanelBrand(): PanelBrand {
  const { data } = trpc.config.getPublicSettings.useQuery(undefined, { staleTime: 300_000 });
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return { name: clean(data?.brand_name), logoUrl: clean(data?.brand_logo_url), websiteUrl: clean(data?.brand_website_url) };
}

/** Web para mostrar en un ticket o documento: sin «https://» ni barra final. */
export const displayWebsite = (url: string | null) => (url ? url.replace(/^https?:\/\//i, "").replace(/\/+$/, "") : null);
