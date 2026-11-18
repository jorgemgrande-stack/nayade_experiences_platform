/**
 * «Idiomas» de las categorías de la tienda: el nombre de cada categoría en cada idioma adicional de la web, con el
 * original al lado. Mismo formulario y mismas reglas que el «Idiomas» de un producto: guardar deja un borrador,
 * «Validar y publicar» lo enseña en el catálogo de ese idioma y «Retirar de la web» lo devuelve a borrador.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { localeAutonym } from "@/hooks/useSiteLocale";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TRANSLATION_FIELD_SETS, translationState } from "@shared/translationEditor";
import { ContentTranslationForm, TranslationStateBadge } from "./ProductTranslationsPanel";

export function CategoryTranslationsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const q = trpc.cms.categoryTranslationEditor.useQuery(undefined, { enabled: open });
  const data = q.data;
  const [locale, setLocale] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.locales.length) return;
    if (!locale || !data.locales.some((l) => l.locale === locale)) setLocale(data.locales[0].locale);
  }, [data, locale]);
  const refresh = () => { void utils.cms.categoryTranslationEditor.invalidate(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Idiomas · Categorías</DialogTitle>
          <DialogDescription>
            Traduce el nombre de cada categoría a los idiomas de tu web. Se ve en los filtros del catálogo cuando validas la traducción.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">No se han podido cargar las traducciones. {q.error.message}</p>
        ) : !data?.multilingual ? (
          <p className="text-sm text-muted-foreground">
            Tu web está en un solo idioma. Añade otro en <Link href="/admin/cms/idiomas" className="underline underline-offset-4">Web › Idiomas</Link> para traducir tus categorías.
          </p>
        ) : !data.categories.length ? (
          <p className="text-sm text-muted-foreground">Todavía no hay categorías.</p>
        ) : (
          <div className="space-y-4">
            <div role="tablist" aria-label="Idioma de la traducción" className="flex flex-wrap gap-2">
              {data.locales.map((l) => {
                const active = l.locale === locale;
                return (
                  <button
                    key={l.locale}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setLocale(l.locale)}
                    className={cn("rounded-md border px-3 py-1.5 text-sm", active ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted")}
                  >
                    {localeAutonym(l.locale)}
                  </button>
                );
              })}
            </div>
            {locale && (
              <>
                {data.locales.find((l) => l.locale === locale)?.status !== "validated" && (
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    El idioma {localeAutonym(locale)} aún no está publicado en tu web: puedes ir traduciendo y se verá cuando valides el idioma en Web › Idiomas.
                  </p>
                )}
                {data.categories.map((c) => (
                  <details key={c.id} className="rounded-md border border-border p-3" open={data.categories.length === 1}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      {c.principal.name || `#${c.id}`}
                      {!c.isActive && <span className="text-xs text-muted-foreground">(inactiva)</span>}
                      <TranslationStateBadge state={translationState(c.translations[locale] ?? null)} />
                    </summary>
                    <div className="mt-3">
                      <ContentTranslationForm
                        key={`category-${c.id}-${locale}`}
                        entityType="category"
                        entityKey={String(c.id)}
                        locale={locale}
                        defaultLocale={data.defaultLocale}
                        defs={TRANSLATION_FIELD_SETS.category}
                        principal={c.principal}
                        row={c.translations[locale] ?? null}
                        onChanged={refresh}
                      />
                    </div>
                  </details>
                ))}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
