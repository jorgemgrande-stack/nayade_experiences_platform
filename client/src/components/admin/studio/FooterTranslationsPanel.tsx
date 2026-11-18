/**
 * «Idiomas del pie»: el texto del pie y el texto de cada columna y enlace del menú «pie» en cada idioma adicional de la
 * web, con el original al lado. Mismo formulario y mismas reglas que las demás traducciones: guardar deja un borrador,
 * «Validar y publicar» lo enseña en el pie de ese idioma y «Retirar de la web» lo devuelve a borrador.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { localeAutonym } from "@/hooks/useSiteLocale";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TRANSLATION_FIELD_SETS, translationState } from "@shared/translationEditor";
import { ContentTranslationForm, TranslationStateBadge } from "@/pages/admin/products/ProductTranslationsPanel";

export function FooterTranslationsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Idiomas del pie</Button>
      <FooterTranslationsPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

export function FooterTranslationsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const q = trpc.cms.footerTranslationEditor.useQuery(undefined, { enabled: open });
  const data = q.data;
  const [locale, setLocale] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.locales.length) return;
    if (!locale || !data.locales.some((l) => l.locale === locale)) setLocale(data.locales[0].locale);
  }, [data, locale]);
  const refresh = () => { void utils.cms.footerTranslationEditor.invalidate(); void utils.public.getFooterText.invalidate(); void utils.public.getMenuItems.invalidate(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Idiomas del pie</DialogTitle>
          <DialogDescription>
            Traduce el texto del pie, los títulos de columna y los enlaces. Las direcciones se adaptan solas al idioma. Una traducción solo se ve en la web cuando la validas.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">No se han podido cargar las traducciones. {q.error.message}</p>
        ) : !data?.multilingual ? (
          <p className="text-sm text-muted-foreground">
            Tu web está en un solo idioma. Añade otro en <Link href="/admin/cms/idiomas" className="underline underline-offset-4">Web › Idiomas</Link> para traducir el pie.
          </p>
        ) : (
          <div className="space-y-4">
            <div role="tablist" aria-label="Idioma de la traducción" className="flex flex-wrap gap-2">
              {data.locales.map((l) => (
                <button key={l.locale} type="button" role="tab" aria-selected={l.locale === locale} onClick={() => setLocale(l.locale)} className={cn("rounded-md border px-3 py-1.5 text-sm", l.locale === locale ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted")}>
                  {localeAutonym(l.locale)}
                </button>
              ))}
            </div>
            {locale && (
              <>
                {data.locales.find((l) => l.locale === locale)?.status !== "validated" && (
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    El idioma {localeAutonym(locale)} aún no está publicado en tu web: puedes ir traduciendo y se verá cuando valides el idioma en Web › Idiomas.
                  </p>
                )}
                <details className="rounded-md border border-border p-3" open>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    Texto del pie <TranslationStateBadge state={translationState(data.text.translations[locale] ?? null)} />
                  </summary>
                  <div className="mt-3">
                    <ContentTranslationForm
                      key={`setting-${locale}`}
                      entityType="setting"
                      entityKey={data.text.key}
                      locale={locale}
                      defaultLocale={data.defaultLocale}
                      defs={TRANSLATION_FIELD_SETS.setting}
                      principal={data.text.principal}
                      row={data.text.translations[locale] ?? null}
                      onChanged={refresh}
                    />
                  </div>
                </details>
                {data.items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay enlaces en el menú del pie.</p>}
                {data.items.map((it) => (
                  <details key={it.id} className={cn("rounded-md border border-border p-3", it.parentId && "ml-6")}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      {it.principal.label || `#${it.id}`}
                      <span className="text-xs text-muted-foreground">{it.hasUrl ? (it.parentId ? "enlace" : "enlace inferior") : "título de columna"}</span>
                      {!it.isActive && <span className="text-xs text-muted-foreground">(oculto)</span>}
                      <TranslationStateBadge state={translationState(it.translations[locale] ?? null)} />
                    </summary>
                    <div className="mt-3">
                      <ContentTranslationForm
                        key={`menu_item-${it.id}-${locale}`}
                        entityType="menu_item"
                        entityKey={String(it.id)}
                        locale={locale}
                        defaultLocale={data.defaultLocale}
                        defs={TRANSLATION_FIELD_SETS.menu_item}
                        principal={it.principal}
                        row={it.translations[locale] ?? null}
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
