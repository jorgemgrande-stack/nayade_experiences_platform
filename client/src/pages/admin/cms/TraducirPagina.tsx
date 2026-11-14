/**
 * Web › Idiomas › traducir una página (E-1): metadatos SEO, dirección localizada y tabla de textos (original a la
 * izquierda, traducción a la derecha). «Copiar desde el original» no traduce nada. Validar publica esa traducción.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastError } from "@/components/admin/PanelStates";
import { localeAutonym } from "@/hooks/useSiteLocale";
import { listTextFields, setTextField } from "@shared/i18n";
import type { PageBlock } from "@shared/pageBlocks";

export default function TraducirPagina({ slug, locale }: { slug: string; locale: string }) {
  const utils = trpc.useUtils();
  const q = trpc.cms.pageTranslationEditor.useQuery({ slug, locale });
  const [form, setForm] = useState({ translatedSlug: "", title: "", metaTitle: "", metaDescription: "", ogImageUrl: "" });
  const [blocks, setBlocks] = useState<PageBlock[] | null>(null);
  useEffect(() => {
    const t = q.data?.translation;
    if (!q.data) return;
    setForm({ translatedSlug: t?.slug ?? "", title: t?.title ?? "", metaTitle: t?.metaTitle ?? "", metaDescription: t?.metaDescription ?? "", ogImageUrl: t?.ogImageUrl ?? "" });
    setBlocks((t?.blocks as PageBlock[] | null) ?? null);
  }, [q.data]);
  const refresh = () => { void utils.cms.pageTranslationEditor.invalidate(); void utils.cms.pageTranslations.invalidate(); };
  const onError = (e: unknown) => toastError(e);
  const save = trpc.cms.savePageTranslation.useMutation({ onSuccess: () => { refresh(); toast.success("Borrador guardado"); }, onError });
  const copy = trpc.cms.copyPageFromPrincipal.useMutation({ onSuccess: () => { refresh(); toast.success("Copiado el contenido original. Ahora tradúcelo."); }, onError });
  const validate = trpc.cms.validatePageTranslation.useMutation({ onSuccess: (_d, v) => { refresh(); toast.success(v.validated ? "Traducción validada y publicada" : "Traducción retirada de la web"); }, onError });

  const original = useMemo(() => new Map(listTextFields(q.data?.principal.blocks as PageBlock[] ?? []).map((f) => [`${f.blockId}|${f.path}`, f])), [q.data]);
  const fields = useMemo(() => (blocks ? listTextFields(blocks) : []), [blocks]);
  const pending = new Set((q.data?.untranslated ?? []).map((u) => `${u.blockId}|${u.field}`));
  const t = q.data?.translation;
  const doSave = () => save.mutate({ slug, locale, translatedSlug: form.translatedSlug || null, title: form.title, metaTitle: form.metaTitle || null, metaDescription: form.metaDescription || null, ogImageUrl: form.ogImageUrl || null, ...(blocks ? { blocks } : {}) });

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div>
          <Link href="/admin/cms/idiomas" className="text-sm text-muted-foreground hover:underline">← Idiomas</Link>
          <h1 className="mt-1 text-2xl font-bold">{q.data?.principal.title ?? slug} en {localeAutonym(locale)}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            Estado: <Badge variant={t?.status === "validated" ? "default" : "secondary"}>{t ? (t.status === "validated" ? "Validada" : "Borrador") : "Sin traducir"}</Badge>
            {t?.validatedBy && <span>por {t.validatedBy}</span>}
          </p>
        </div>
        {q.isLoading ? <p>Cargando…</p> : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label htmlFor="t-title">Título</Label><Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={256} /></div>
              <div><Label htmlFor="t-slug">Dirección (sin acentos, minúsculas y guiones)</Label><Input id="t-slug" value={form.translatedSlug} placeholder={slug} onChange={(e) => setForm({ ...form, translatedSlug: e.target.value })} maxLength={64} /></div>
              <div><Label htmlFor="t-mt">Título para buscadores</Label><Input id="t-mt" value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} maxLength={256} /></div>
              <div><Label htmlFor="t-og">Imagen para compartir (URL)</Label><Input id="t-og" value={form.ogImageUrl} onChange={(e) => setForm({ ...form, ogImageUrl: e.target.value })} maxLength={1000} /></div>
              <div className="md:col-span-2"><Label htmlFor="t-md">Descripción para buscadores</Label><Textarea id="t-md" value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} maxLength={1000} /></div>
            </div>

            {!blocks ? (
              <div className="rounded-md border p-4 text-sm">
                <p className="mb-2">Esta página aún no tiene contenido en este idioma.</p>
                <Button variant="outline" disabled={copy.isPending} onClick={() => copy.mutate({ slug, locale })}>Copiar el contenido original para traducirlo</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {pending.size ? `${pending.size} textos siguen igual que el original o vacíos.` : "No quedan textos sin traducir."}
                  {q.data?.translation && " Las imágenes, enlaces y estilos se heredan del original."}
                </p>
                {fields.map((f) => {
                  const key = `${f.blockId}|${f.path}`;
                  const orig = original.get(key)?.value ?? "";
                  const id = `f-${key}`;
                  return (
                    <div key={key} className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">{f.blockType} · {f.path}{pending.has(key) && <span className="ml-2 text-amber-700">sin traducir</span>}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm" lang="es">{orig}</p>
                      </div>
                      <div>
                        <Label htmlFor={id} className="sr-only">Traducción de {f.path}</Label>
                        {f.long
                          ? <Textarea id={id} lang={locale} value={f.value} rows={4} onChange={(e) => setBlocks(setTextField(blocks, f.blockId, f.path, e.target.value))} />
                          : <Input id={id} lang={locale} value={f.value} onChange={(e) => setBlocks(setTextField(blocks, f.blockId, f.path, e.target.value))} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={doSave} disabled={save.isPending || !form.title.trim()}>Guardar borrador</Button>
              <Button variant="outline" disabled={validate.isPending || !t || !t.blocks} onClick={() => validate.mutate({ slug, locale, validated: true })}>
                Validar y publicar esta traducción
              </Button>
              {t?.status === "validated" && <Button variant="ghost" onClick={() => validate.mutate({ slug, locale, validated: false })}>Retirar de la web</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Guarda antes de validar: se publica el último borrador guardado.</p>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
