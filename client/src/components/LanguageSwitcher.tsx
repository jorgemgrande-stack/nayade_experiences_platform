import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { localeAutonym, useSiteLocale } from "@/hooks/useSiteLocale";

/**
 * Selector de idioma de la cabecera (E-1). Solo se muestra si la empresa tiene al menos otro idioma validado Y la página
 * actual existe en él. Son enlaces reales (`<a href>`, `hreflang`, `lang`), accesibles por teclado, con el nombre del
 * idioma escrito en ese idioma (nada de banderas). Con un solo idioma, no pinta nada.
 */
export default function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { multilingual, locale } = useSiteLocale();
  const [location] = useLocation();
  const q = trpc.public.getPageAlternates.useQuery({ path: location }, { enabled: multilingual, staleTime: 60_000, retry: false });
  const alternates = q.data?.alternates ?? [];
  if (!multilingual || alternates.length < 2) return null;
  return (
    <nav aria-label="Idioma / Language" className={className}>
      <ul className="flex items-center gap-1 text-sm font-display">
        {alternates.map((a) => {
          const current = a.hreflang === locale;
          return (
            <li key={a.hreflang}>
              <a
                href={a.href}
                lang={a.hreflang}
                hrefLang={a.hreflang}
                aria-current={current ? "true" : undefined}
                className={`px-2 py-1 rounded-md hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${current ? "font-semibold text-primary" : "text-foreground"}`}
              >
                {localeAutonym(a.hreflang)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
