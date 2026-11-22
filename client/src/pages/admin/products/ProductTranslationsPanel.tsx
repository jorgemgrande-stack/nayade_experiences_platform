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
import { useI18n } from "@/i18n/I18nProvider";
import {
  ENTITY_HAS_SLUG,
  TRANSLATION_FIELD_SETS,
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
  const { t } = useI18n();
  return <Badge variant="outline" className={cn("text-xs", STATE_TONE[state])}>{t(`productsTranslations.state.${state}`)}</Badge>;
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
  const { t, locale: uiLocale } = useI18n();
  const withSlug = ENTITY_HAS_SLUG[entityType];
  /** Etiqueta del campo en el idioma de la interfaz (si el tipo no está en el diccionario, la del módulo compartido). */
  const labelOf = (d: TranslationFieldDef) => {
    const key = `productsTranslations.fields.${entityType}.${d.key}`;
    const txt = t(key);
    return txt === key ? d.label : txt;
  };
  const [draft, setDraft] = useState<TranslationDraft>(() => draftFromRow(defs, row));
  const [tried, setTried] = useState(false);
  // Al cambiar de idioma o al recargar lo guardado, el formulario vuelve a lo guardado
  useEffect(() => { setDraft(draftFromRow(defs, row)); setTried(false); }, [row, locale, defs]);

  const save = trpc.cms.saveContentTranslation.useMutation({ onSuccess: () => { toast.success(t("productsTranslations.form.savedDraft")); onChanged(); }, onError: (e) => toastError(e) });
  const validate = trpc.cms.validateContentTranslation.useMutation({ onSuccess: () => { toast.success(t("productsTranslations.form.validated")); onChanged(); }, onError: (e) => toastError(e) });
  const unvalidate = trpc.cms.unvalidateContentTranslation.useMutation({ onSuccess: () => { toast.success(t("productsTranslations.form.unvalidated")); onChanged(); }, onError: (e) => toastError(e) });

  const state = translationState(row);
  const dirty = isDraftDirty(defs, draft, row, withSlug);
  const errors = draftErrors(defs, draft, withSlug);
  const pending = new Set(pendingFieldKeys(defs, principal, draft));
  const busy = save.isPending || validate.isPending || unvalidate.isPending;
  /** Los errores de validación vienen del módulo compartido en español: se muestran en el idioma de la interfaz. */
  const errText = (k: string, raw: string) => {
    if (k === "slug") return t("productsTranslations.errors.slugRule");
    const d = defs.find((x) => x.key === k);
    if (raw.startsWith("Admite hasta") && d) return t("productsTranslations.errors.maxChars", { max: d.max });
    if (d) return t("productsTranslations.errors.writeFirst", { label: uiLocale === "es" ? labelOf(d).toLowerCase() : labelOf(d) });
    return raw;
  };

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
            {t("productsTranslations.form.original", { label: labelOf(d) })}
            {pending.has(d.key) && <span className="ml-2 text-warning">{t("productsTranslations.form.untranslatedField")}</span>}
          </p>
          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm" lang={defaultLocale}>{orig || <span className="italic text-muted-foreground">{t("productsTranslations.form.empty")}</span>}</p>
        </div>
        <div>
          <Label htmlFor={id}>{t("productsTranslations.form.fieldIn", { label: labelOf(d), language: localeAutonym(locale) })}</Label>
          {d.long
            ? <Textarea id={id} lang={locale} rows={d.key === "description" ? 6 : 3} value={draft.fields[d.key] ?? ""} onChange={(e) => setField(d.key, e.target.value)} maxLength={d.max} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} className="mt-1" />
            : <Input id={id} lang={locale} value={draft.fields[d.key] ?? ""} onChange={(e) => setField(d.key, e.target.value)} maxLength={d.max} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} className="mt-1" />}
          {err && <p id={`${id}-err`} className="mt-1 text-xs text-destructive">{errText(d.key, err)}</p>}
        </div>
      </div>
    );
  };

  const slugId = `tr-${locale}-slug`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("productsTranslations.form.status")}</span>
        <TranslationStateBadge state={state} />
        {state === "validated" && row?.validatedBy && <span className="text-xs text-muted-foreground">{t("productsTranslations.form.validatedBy", { name: row.validatedBy })}</span>}
        {dirty && <span className="text-xs text-warning">{t("productsTranslations.form.unsaved")}</span>}
        {pending.size > 0 && <span className="text-xs text-muted-foreground">{pending.size === 1 ? t("productsTranslations.form.pendingOne") : t("productsTranslations.form.pendingMany", { n: pending.size })}</span>}
      </div>
      {defs.filter((d) => !d.seo).map(field)}
      <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productsTranslations.form.seoAndAddress")}</p>
      {defs.filter((d) => d.seo).map(field)}
      {withSlug && (
        <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t("productsTranslations.form.addressOriginal")}</p>
            <p className="mt-1 text-sm">{principalSlug || "—"}</p>
          </div>
          <div>
            <Label htmlFor={slugId}>{t("productsTranslations.form.addressIn", { language: localeAutonym(locale) })}</Label>
            <Input id={slugId} value={draft.slug} placeholder={principalSlug} onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))} maxLength={64} aria-invalid={tried && !!errors.slug} aria-describedby={`${slugId}-hint`} className="mt-1" />
            <p id={`${slugId}-hint`} className={cn("mt-1 text-xs", tried && errors.slug ? "text-destructive" : "text-muted-foreground")}>
              {tried && errors.slug ? errText("slug", errors.slug) : t("productsTranslations.form.addressHint")}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" onClick={doSave} disabled={busy || !dirty}>{t("productsTranslations.form.saveDraft")}</Button>
        <Button type="button" variant="outline" disabled={busy || !canValidate(row, dirty)} onClick={() => validate.mutate({ entityType, entityKey, locale })}>
          {t("productsTranslations.form.validate")}
        </Button>
        {state === "validated" && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => unvalidate.mutate({ entityType, entityKey, locale })}>{t("productsTranslations.form.withdraw")}</Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("productsTranslations.form.footnote")}
      </p>
    </div>
  );
}

/** Ventana «Idiomas» de un producto. Solo tiene sentido con idiomas adicionales dados de alta en Web › Idiomas. */
export function ProductTranslationsPanel({ experienceId, title, open, onOpenChange }: { experienceId: number | null; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
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
    return { title: p.title, shortDescription: p.shortDescription, description: p.description, metaTitle: p.metaTitle, metaDescription: p.metaDescription, duration: p.duration, requirements: p.requirements, includes: p.includes, excludes: p.excludes, requestCtaLabel: p.requestCtaLabel };
  }, [data]);
  const refresh = () => { void utils.cms.productTranslationEditor.invalidate({ experienceId: experienceId ?? 0 }); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{t("productsTranslations.product.title", { title })}</DialogTitle>
          <DialogDescription>
            {t("productsTranslations.product.description")}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("productsTranslations.product.loading")}</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">{t("productsTranslations.product.loadError", { error: q.error.message })}</p>
        ) : !data?.principal ? (
          <p className="text-sm text-muted-foreground">{t("productsTranslations.product.gone")}</p>
        ) : !data.multilingual ? (
          <p className="text-sm text-muted-foreground">
            {t("productsTranslations.product.singleBefore")}<Link href="/admin/cms/idiomas" className="underline underline-offset-4">{t("productsTranslations.product.languagesLink")}</Link>{t("productsTranslations.product.singleAfter")}
          </p>
        ) : (
          <div className="space-y-4">
            <div role="tablist" aria-label={t("productsTranslations.product.languageTab")} className="flex flex-wrap gap-2">
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
                    {t("productsTranslations.product.notPublished", { language: localeAutonym(locale) })}
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
                {/* Opciones y convocatorias del producto: sus nombres y notas en el mismo idioma */}
                {[
                  { type: "variant" as const, title: t("productsTranslations.product.options"), items: data.variants, label: (i: { principal: Record<string, string> }) => i.principal.name },
                  { type: "edition" as const, title: t("productsTranslations.product.editions"), items: data.editions, label: (i: { principal: Record<string, string> }) => i.principal.label },
                ].map((g) =>
                  g.items.length ? (
                    <section key={g.type} className="space-y-3 border-t border-border pt-4">
                      <h3 className="text-sm font-semibold">{g.title}</h3>
                      {g.items.map((it) => (
                        <details key={it.id} className="rounded-md border border-border p-3">
                          <summary className="flex cursor-pointer items-center gap-2 text-sm">
                            {g.label(it) || `#${it.id}`} <TranslationStateBadge state={translationState(it.translations[locale] ?? null)} />
                          </summary>
                          <div className="mt-3">
                            <ContentTranslationForm
                              key={`${g.type}-${it.id}-${locale}`}
                              entityType={g.type}
                              entityKey={String(it.id)}
                              locale={locale}
                              defaultLocale={data.defaultLocale}
                              defs={TRANSLATION_FIELD_SETS[g.type]}
                              principal={it.principal}

                              row={it.translations[locale] ?? null}
                              onChanged={refresh}
                            />
                          </div>
                        </details>
                      ))}
                    </section>
                  ) : null,
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
