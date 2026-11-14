import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Idioma de la web pública de la empresa (E-1). Sin idiomas adicionales validados devuelve `multilingual = false` y
 * el idioma principal: todo se comporta como siempre. El idioma sale del prefijo de la URL (`/de/…`); sin prefijo es
 * el principal.
 */
export function useSiteLocale() {
  const [location] = useLocation();
  const q = trpc.public.getSiteLocales.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const data = q.data;
  const first = location.split("/")[1] ?? "";
  const multilingual = !!data?.multilingual;
  const isPrefixed = multilingual && first !== data!.defaultLocale && data!.locales.includes(first);
  const locale = isPrefixed ? first : data?.defaultLocale ?? "es";
  return {
    multilingual,
    locale,
    defaultLocale: data?.defaultLocale ?? "es",
    locales: data?.locales ?? ["es"],
    /** Idioma adicional de la URL actual, o undefined en el principal. */
    prefix: isPrefixed ? first : undefined,
    /** Ruta de la portada en el idioma actual. */
    home: isPrefixed ? `/${first}` : "/",
    isLoading: q.isLoading,
  };
}

/** Nombre de un idioma en su propio idioma (autónimo), para el selector. */
export function localeAutonym(code: string): string {
  try {
    const n = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return n ? n.charAt(0).toLocaleUpperCase(code) + n.slice(1) : code;
  } catch {
    return code;
  }
}
