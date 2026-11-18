import { trpc } from "@/lib/trpc";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import { legalKindOfUrl } from "@shared/tenantNav";

/**
 * Enlace a un texto legal de la empresa en el idioma de la página (18/11/2026): el que la empresa enlaza en su menú de
 * pie (`/datenschutz`, `/es/politica-de-privacidad`…). Sin él, la ruta de serie (`/privacidad`…), como hasta ahora.
 * Misma consulta y caché que el pie de la web.
 */
const DEFAULT_LEGAL_PATH = { aviso: "/aviso-legal", privacidad: "/privacidad", cookies: "/cookies" } as const;

export function useLegalHref(kind: "aviso" | "privacidad" | "cookies"): string {
  const prefix = useSiteLocale().prefix;
  const menu = trpc.public.getMenuItems.useQuery({ zone: "footer", ...(prefix ? { locale: prefix } : {}) }, { staleTime: 5 * 60_000, retry: false });
  const own = (menu.data ?? []).find((m) => m.isActive && !!m.url && legalKindOfUrl(m.url) === kind);
  return own?.url ?? DEFAULT_LEGAL_PATH[kind];
}
