/**
 * «Idiomas» de un producto (E-1): traducción de nombre, descripciones, textos para buscadores y dirección en cada idioma
 * adicional de la web, con el texto original al lado. Guardar deja un borrador; «Validar y publicar» lo enseña en la web
 * en ese idioma; «Retirar de la web» lo devuelve a borrador. Nada se traduce solo.
 *
 * `ContentTranslationForm` no sabe de productos: recibe la lista de campos (shared/translationEditor.ts), así que otros
 * contenidos (p. ej. los nombres de las modalidades) pueden usar el mismo formulario cuando el servidor los admita.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastError } from "@/components/admin/PanelStates";
import { localeAutonym } from "@/hooks/useSiteLocale";
import { TONE_BADGE } from "@/lib/panelTones";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ENTITY_HAS_SLUG,
  TRANSLATION_FIELD_SETS,
  TRANSLATION_STATE_LABELS,
  canValidate,
  draftErrors,
  draftFromRow,
  draftPayload,
  isDraftDirty,
  pendingFieldKeys,
  translationState,
  type StoredTranslation,
  type TranslatableEntity,
  type TranslationDraft,
  type TranslationFieldDef,
  type TranslationState,
} from "@shared/translationEditor";

const STATE_TONE: Record<TranslationState, string> = {
  untranslated: TONE_BADGE.neutral,
  draft: TONE_BADGE.warning,
  validated: TONE_BADGE.success,
};

export function TranslationStateBadge({ state }: { state: TranslationState }) {
  return <Badge variant="outline" className={cn("text-[11px]", STATE_TONE[state])}>{TRANSLATION_STATE_LABELS[state]}</Badge>;
}

/** Formulario de la traducción de un contenido en un idioma, con el original al lado. */
export function ContentTranslationForm({
  entityType, entityKey, locale, defaultLocale, defs, principal, principalSlug, row, onChanged,
}: {
  entityType: TranslatableEntity;
  entityKey: string;
  locale: string;
  defaultLocale: string;
  defs: readonly TranslationFieldDef[];
  principal: Record<string, string>;
  principalSlug?: string;
  row: StoredTranslation | null;
  onChanged: () => void;
}) {
  const withSlug = ENTITY_HAS_SLUG[entityType];
  const [draft, setDraft] = useState<TranslationDraft>(() => draftFromRow(defs, row));
  const [tried, setTried] = useState(false);
  // Al cambiar de idioma o al recargar lo guardado, el formulario vuelve a lo guardado
  useEffect(() => { setDraft(draftFromRow(defs, row)); setTried(false); }, [row, locale, defs]);

  const save = trpc.cms.saveContentTranslation.useMutation({ onSuccess: () => { toast.success("Borrador guardado"); onChanged(); }, onError: (e) => toastError(e) });
  const validate = trpc.cms.validateContentTranslation.useMutation({ onSuccess: () => { toast.success("Traducción validada: ya se ve en la web en este idioma"); onChanged(); }, onError: (e) => toastError(e) });
  const unvalidate = trpc.cms.unvalidateContentTranslation.useMutation({ onSuccess: () => { toast.success("Traducción retirada de la web (queda como borrador)"); onChanged(); }, onError: (e) => toastError(e) });

  const state = translationState(row);
  const dirty = isDraftDirty(defs, draft, row, withSlug);
  const errors = draftErrors(defs, draft, withSlug);
  const pending = new Set(pendingFieldKeys(defs, principal, draft));
  const busy = save.isPending || validate.isPending || unvalidate.isPending;

  const doSave = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    const p = draftPayload(defs, draft, withSlug);
    save.mutate({ entityType, entityKey, locale, fields: p.fields, ...(withSlug ? { slug: p.slug } : {}) });
  };
  const setField = (k: string, v: string) => setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));

  const field = (d: TranslationFieldDef) => {
    const id = `tr-${locale}-${d.key}`;
    const err = tried ? errors[d.key] : undefined;
    const orig = principal[d.key] ?? "";
    return (
      <div key={d.key} className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {d.label} · original
            {pending.has(d.key) && <span className="ml-2 text-amber-700 dark:text-amber-400">sin traducir</span>}
          </p>
          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm" lang={defaultLocale}>{orig || <span className="italic text-muted-foreground">(vacío)</span>}</p>
        </div>
        <div>
          <Label htmlFor={id}>{d.label} en {localeAutonym(locale)}</Label>
          {d.long
            ? <Textarea id={id} lang={locale} rows={d.key === "description" ? 6 : 3} value={draft.fields[d.key] ?? ""} onChange={(e) => setField(d.key, e.target.value)} maxLength={d.max} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} className="mt-1" />
            : <Input id={id} lang={locale} value={draft.fields[d.key] ?? ""} onChange={(e) => setField(d.key, e.target.value)} maxLength={d.max} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} className="mt-1" />}
          {err && <p id={`${id}-err`} className="mt-1 text-xs text-destructive">{err}</p>}
        </div>
      </div>
    );
  };

  const slugId = `tr-${locale}-slug`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Estado:</span>
        <TranslationStateBadge state={state} />
        {state === "validated" && row?.validatedBy && <span className="text-xs text-muted-foreground">por {row.validatedBy}</span>}
        {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
        {pending.size > 0 && <span className="text-xs text-muted-foreground">{pending.size === 1 ? "1 campo sigue" : `${pending.size} campos siguen`} sin traducir.</span>}
      </div>
      {defs.filter((d) => !d.seo).map(field)}
      <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buscadores y dirección</p>
      {defs.filter((d) => d.seo).map(field)}
      {withSlug && (
        <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Dirección · original</p>
            <p className="mt-1 text-sm">{principalSlug || "—"}</p>
          </div>
          <div>
            <Label htmlFor={slugId}>Dirección en {localeAutonym(locale)}</Label>
            <Input id={slugId} value={draft.slug} placeholder={principalSlug} onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))} maxLength={64} aria-invalid={tried && !!errors.slug} aria-describedby={`${slugId}-hint`} className="mt-1" />
            <p id={`${slugId}-hint`} className={cn("mt-1 text-xs", tried && errors.slug ? "text-destructive" : "text-muted-foreground")}>
              {tried && errors.slug ? errors.slug : "Opcional. Minúsculas sin acentos, números y guiones; vacía, se usa la del original."}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" onClick={doSave} disabled={busy || !dirty}>Guardar borrador</Button>
        <Button type="button" variant="outline" disabled={busy || !canValidate(row, dirty)} onClick={() => validate.mutate({ entityType, entityKey, locale })}>
          Validar y publicar
        </Button>
        {state === "validated" && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => unvalidate.mutate({ entityType, entityKey, locale })}>Retirar de la web</Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Guarda antes de validar: se publica el último borrador guardado. Editar una traducción validada la devuelve a borrador hasta que la vuelvas a validar.
        El precio, las modalidades y la disponibilidad no se traducen: salen siempre del producto.
      </p>
    </div>
  );
}

/** Ventana «Idiomas» de un producto. Solo tiene sentido con idiomas adicionales dados de alta en Web › Idiomas. */
export function ProductTranslationsPanel({ experienceId, title, open, onOpenChange }: { experienceId: number | null; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const q = trpc.cms.productTranslationEditor.useQuery({ experienceId: experienceId ?? 0 }, { enabled: open && !!experienceId });
  const data = q.data;
  const [locale, setLocale] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.locales.length) return;
    if (!locale || !data.locales.some((l) => l.locale === locale)) setLocale(data.locales[0].locale);
  }, [data, locale]);
  const defs = TRANSLATION_FIELD_SETS.product;
  const principal = useMemo((): Record<string, string> => {
    const p = data?.principal;
    if (!p) return {};
    return { title: p.title, shortDescription: p.shortDescription, description: p.description, metaTitle: p.metaTitle, metaDescription: p.metaDescription };
  }, [data]);
  const refresh = () => { void utils.cms.productTranslationEditor.invalidate({ experienceId: experienceId ?? 0 }); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Idiomas · {title}</DialogTitle>
          <DialogDescription>
            Traduce la ficha a cada idioma de tu web. El texto original está a la izquierda. Una traducción solo se ve en la web cuando la validas.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">No se han podido cargar las traducciones. {q.error.message}</p>
        ) : !data?.principal ? (
          <p className="text-sm text-muted-foreground">Este producto ya no existe.</p>
        ) : !data.multilingual ? (
          <p className="text-sm text-muted-foreground">
            Tu web está en un solo idioma. Añade otro en <Link href="/admin/cms/idiomas" className="underline underline-offset-4">Web › Idiomas</Link> para traducir tus productos.
          </p>
        ) : (
          <div className="space-y-4">
            <div role="tablist" aria-label="Idioma de la traducción" className="flex flex-wrap gap-2">
              {data.locales.map((l) => {
                const st = translationState(data.translations[l.locale] ?? null);
                const active = l.locale === locale;
                return (
                  <button
                    key={l.locale}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setLocale(l.locale)}
                    className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", active ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted")}
                  >
                    {localeAutonym(l.locale)}
                    <TranslationStateBadge state={st} />
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
                <ContentTranslationForm
                  key={locale}
                  entityType="product"
                  entityKey={String(data.principal.id)}
                  locale={locale}
                  defaultLocale={data.defaultLocale}
                  defs={defs}
                  principal={principal}
                  principalSlug={data.principal.slug}
                  row={data.translations[locale] ?? null}
                  onChanged={refresh}
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
