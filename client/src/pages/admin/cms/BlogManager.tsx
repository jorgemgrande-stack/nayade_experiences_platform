/**
 * Panel › Web › Blog: entradas del blog de la empresa (capacidad `cms-blog`).
 * Listado con estados, editor con validación, vista previa saneada y publicación (inmediata o
 * programada). En solo lectura se consulta pero no se modifica (el servidor también lo rechaza).
 */
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import ImageUploader from "@/components/ImageUploader";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge as ToneBadge, type Tone } from "@/components/admin/PanelUi";
import { TONE_SURFACE } from "@/lib/panelTones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ArrowLeft, Eye, ExternalLink, Pencil, Plus, Save, Trash2, Newspaper } from "lucide-react";
import {
  BLOG_LIMITS, BLOG_STATUS_LABEL, slugify, validateBlogDraft,
  type BlogDraft, type BlogDraftErrors, type BlogStatus, type BlogVisibleStatus,
} from "@shared/blog";
import { toastError } from "@/lib/errorMessage";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { useI18n } from "@/i18n/I18nProvider";

const EMPTY: BlogDraft = {
  title: "", slug: "", excerpt: "", content: "", featuredImageUrl: "", featuredImageAlt: "",
  authorName: "", category: "", metaTitle: "", metaDescription: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
/** ms → valor de <input type="datetime-local"> en hora local. */
function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const STATUS_TONE: Record<BlogVisibleStatus, Tone> = { draft: "neutral", scheduled: "warning", published: "success" };

function StatusBadge({ status }: { status: BlogVisibleStatus }) {
  return <ToneBadge tone={STATUS_TONE[status]}>{BLOG_STATUS_LABEL[status]}</ToneBadge>;
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <p id={id} className="mt-1 text-xs text-danger" role="alert">{msg}</p>;
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-xs ${value.length > max ? "text-danger" : "text-muted-foreground"}`}>{value.length}/{max}</span>;
}

// ─── Editor ──────────────────────────────────────────────────────────────────
function PostEditor({ id, canWrite, categories, onClose }: { id: number | null; canWrite: boolean; categories: string[]; onClose: () => void }) {
  const tx = useStudioText();
  const utils = trpc.useUtils();
  const existing = trpc.blog.get.useQuery({ id: id ?? 0 }, { enabled: id !== null, retry: false });
  const [form, setForm] = useState<BlogDraft>(EMPTY);
  const [status, setStatus] = useState<BlogStatus>("draft");
  const [publishAt, setPublishAt] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<BlogDraftErrors>({});
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setForm({
      title: p.title, slug: p.slug, excerpt: p.excerpt ?? "", content: p.content ?? "",
      featuredImageUrl: p.featuredImageUrl ?? "", featuredImageAlt: p.featuredImageAlt ?? "",
      authorName: p.authorName ?? "", category: p.category ?? "",
      metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "",
    });
    setStatus(p.status);
    setPublishAt(toLocalInput(p.publishedAt));
    setSlugTouched(true);
  }, [existing.data]);

  const set = (k: keyof BlogDraft, v: string) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "title" && !slugTouched) next.slug = slugify(v);
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const onSaved = (verb: string) => {
    toast.success(verb);
    utils.blog.list.invalidate();
    if (id !== null) utils.blog.get.invalidate({ id });
    onClose();
  };
  const onError = (e: { message: string }) => toastError(e);
  const create = trpc.blog.create.useMutation({ onSuccess: () => onSaved("Entrada creada"), onError });
  const update = trpc.blog.update.useMutation({ onSuccess: () => onSaved("Entrada guardada"), onError });
  const preview = trpc.blog.preview.useMutation({ onSuccess: (r) => setPreviewHtml(r.html), onError });
  const saving = create.isPending || update.isPending;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const errs = validateBlogDraft(form);
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`blog-${first}`)?.focus();
      toast.error(tx("Revisa los campos marcados."));
      return;
    }
    const payload = {
      ...form,
      title: form.title.trim(),
      slug: form.slug.trim(),
      status,
      publishedAt: fromLocalInput(publishAt),
    };
    if (id === null) create.mutate(payload);
    else update.mutate({ id, ...payload });
  };

  const scheduled = status === "published" && (fromLocalInput(publishAt) ?? 0) > Date.now();
  const inv = (k: keyof BlogDraft) => ({
    id: `blog-${k}`,
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": [errors[k] ? `blog-${k}-error` : null, `blog-${k}-hint`].filter(Boolean).join(" ") || undefined,
  });

  if (id !== null && existing.isLoading) return <p role="status" className="p-6 text-muted-foreground">{tx("Cargando entrada…")}</p>;
  if (id !== null && existing.error) return <PanelError className="m-6" title={tx("No se ha podido cargar la entrada")} error={existing.error} onRetry={() => void existing.refetch()} />;

  return (
    <form onSubmit={submit} noValidate className="p-4 md:p-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}><ArrowLeft size={16} className="mr-1" aria-hidden="true" />{tx("Entradas")}</Button>
          <h1 className="text-xl font-bold">{id === null ? tx("Nueva entrada") : tx("Editar entrada")}</h1>
          {existing.data && <StatusBadge status={existing.data.visibleStatus} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => preview.mutate({ content: form.content })} disabled={!canWrite || preview.isPending}>
            <Eye size={14} className="mr-1" aria-hidden="true" />{tx("Vista previa")}</Button>
          <Button type="submit" size="sm" disabled={!canWrite || saving}>
            <Save size={14} className="mr-1" aria-hidden="true" />
            {saving ? tx("Guardando…") : status === "published" ? (scheduled ? tx("Programar publicación") : tx("Publicar")) : tx("Guardar borrador")}
          </Button>
        </div>
      </div>

      {!canWrite && (
        <p role="status" className={`mb-4 rounded-md border px-3 py-2 text-sm text-foreground ${TONE_SURFACE.warning}`}>{tx("Solo lectura: tu plan permite consultar el blog, pero no modificarlo.")}</p>
      )}

      <fieldset disabled={!canWrite} className="space-y-6">
        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-contenido">
          <h2 id="blog-sec-contenido" className="font-semibold">{tx("Contenido")}</h2>
          <div>
            <Label htmlFor="blog-title">{tx("Título")}{" "}<span aria-hidden="true">*</span></Label>
            <Input {...inv("title")} required value={form.title} onChange={(e) => set("title", e.target.value)} className="mt-1" />
            <FieldError id="blog-title-error" msg={errors.title} />
          </div>
          <div>
            <Label htmlFor="blog-slug">{tx("Dirección (slug)")}{" "}<span aria-hidden="true">*</span></Label>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/blog/</span>
              <Input {...inv("slug")} required value={form.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value); }} />
            </div>
            <p id="blog-slug-hint" className="mt-1 text-xs text-muted-foreground">{tx("Minúsculas, números y guiones. Se propone a partir del título.")}</p>
            <FieldError id="blog-slug-error" msg={errors.slug} />
          </div>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="blog-excerpt">{tx("Extracto")}</Label><Counter value={form.excerpt} max={BLOG_LIMITS.excerpt} /></div>
            <Textarea {...inv("excerpt")} rows={2} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} className="mt-1" />
            <p id="blog-excerpt-hint" className="mt-1 text-xs text-muted-foreground">{tx("Resumen que aparece en el listado del blog.")}</p>
            <FieldError id="blog-excerpt-error" msg={errors.excerpt} />
          </div>
          <div>
            <Label htmlFor="blog-content">{tx("Texto de la entrada")}</Label>
            <Textarea {...inv("content")} rows={14} value={form.content} onChange={(e) => set("content", e.target.value)} className="mt-1 font-mono text-sm" />
            <p id="blog-content-hint" className="mt-1 text-xs text-muted-foreground">{tx("Admite HTML básico, igual que las páginas: títulos (<h2>), párrafos (<p>), listas, negrita, enlaces e imágenes. Los scripts y estilos se eliminan al publicar.")}</p>
            <FieldError id="blog-content-error" msg={errors.content} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-imagen">
          <h2 id="blog-sec-imagen" className="font-semibold">{tx("Imagen destacada (opcional)")}</h2>
          <ImageUploader label={tx("Imagen destacada")} value={form.featuredImageUrl} onChange={(url) => set("featuredImageUrl", url)} />
          <FieldError id="blog-featuredImageUrl-error" msg={errors.featuredImageUrl} />
          <div>
            <Label htmlFor="blog-featuredImageAlt">{tx("Texto alternativo de la imagen")}</Label>
            <Input {...inv("featuredImageAlt")} value={form.featuredImageAlt} onChange={(e) => set("featuredImageAlt", e.target.value)} className="mt-1" />
            <p id="blog-featuredImageAlt-hint" className="mt-1 text-xs text-muted-foreground">{tx("Describe la imagen para quien no puede verla.")}</p>
            <FieldError id="blog-featuredImageAlt-error" msg={errors.featuredImageAlt} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-publicacion">
          <h2 id="blog-sec-publicacion" className="font-semibold">{tx("Publicación")}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="blog-authorName">{tx("Autor")}</Label>
              <Input {...inv("authorName")} value={form.authorName} onChange={(e) => set("authorName", e.target.value)} className="mt-1" />
              <p id="blog-authorName-hint" className="mt-1 text-xs text-muted-foreground">{tx("Si lo dejas vacío en una entrada nueva, se usa tu nombre.")}</p>
              <FieldError id="blog-authorName-error" msg={errors.authorName} />
            </div>
            <div>
              <Label htmlFor="blog-category">{tx("Categoría (opcional)")}</Label>
              <Input {...inv("category")} list="blog-categories" value={form.category} onChange={(e) => set("category", e.target.value)} className="mt-1" />
              <datalist id="blog-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              <p id="blog-category-hint" className="mt-1 text-xs text-muted-foreground">{tx("Escribe una nueva o elige una existente.")}</p>
              <FieldError id="blog-category-error" msg={errors.category} />
            </div>
          </div>
          <div>
            <p id="blog-status-label" className="text-sm font-medium mb-2">{tx("Estado")}</p>
            <RadioGroup aria-labelledby="blog-status-label" value={status} onValueChange={(v) => setStatus(v as BlogStatus)} className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2"><RadioGroupItem value="draft" id="blog-status-draft" /><Label htmlFor="blog-status-draft">{tx("Borrador (no se ve en la web)")}</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="published" id="blog-status-published" /><Label htmlFor="blog-status-published">{tx("Publicada")}</Label></div>
            </RadioGroup>
          </div>
          <div className="max-w-xs">
            <Label htmlFor="blog-publishedAt">{tx("Fecha de publicación (opcional)")}</Label>
            <Input id="blog-publishedAt" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} aria-describedby="blog-publishedAt-hint" className="mt-1" />
            <p id="blog-publishedAt-hint" className="mt-1 text-xs text-muted-foreground">{tx("Vacía: se publica al guardar. Futura: la entrada queda programada y aparece en la web a esa hora.")}</p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-seo">
          <h2 id="blog-sec-seo" className="font-semibold">{tx("SEO (opcional)")}</h2>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="blog-metaTitle">{tx("Título SEO")}</Label><Counter value={form.metaTitle} max={BLOG_LIMITS.metaTitle} /></div>
            <Input {...inv("metaTitle")} value={form.metaTitle} onChange={(e) => set("metaTitle", e.target.value)} className="mt-1" />
            <p id="blog-metaTitle-hint" className="mt-1 text-xs text-muted-foreground">{tx("Si lo dejas vacío, se usa el título.")}</p>
            <FieldError id="blog-metaTitle-error" msg={errors.metaTitle} />
          </div>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="blog-metaDescription">{tx("Descripción SEO")}</Label><Counter value={form.metaDescription} max={BLOG_LIMITS.metaDescription} /></div>
            <Textarea {...inv("metaDescription")} rows={2} value={form.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} className="mt-1" />
            <p id="blog-metaDescription-hint" className="mt-1 text-xs text-muted-foreground">{tx("Si la dejas vacía, se usa el extracto.")}</p>
            <FieldError id="blog-metaDescription-error" msg={errors.metaDescription} />
          </div>
        </section>
      </fieldset>

      <Dialog open={previewHtml !== null} onOpenChange={(o) => !o && setPreviewHtml(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tx("Vista previa")}</DialogTitle>
            <DialogDescription>{tx("Así se verá la entrada en la web. No se ha guardado ni publicado nada.")}</DialogDescription>
          </DialogHeader>
          <article>
            {form.category && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{form.category}</p>}
            <h2 className="mt-1 text-2xl font-bold">{form.title || tx("(Sin título)")}</h2>
            {form.excerpt && <p className="mt-2 text-muted-foreground">{form.excerpt}</p>}
            {form.featuredImageUrl && <img src={form.featuredImageUrl} alt={form.featuredImageAlt} className="mt-4 w-full rounded-xl object-cover aspect-[16/9]" />}
            {/* HTML saneado en servidor (blog.preview) */}
            <div className="prose max-w-none mt-4" dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }} />
          </article>
        </DialogContent>
      </Dialog>
    </form>
  );
}

// ─── Listado ─────────────────────────────────────────────────────────────────
export default function BlogManager() {
  const tx = useStudioText();
  const { format } = useI18n();
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<{ id: number; title: string } | null>(null);
  const { canWrite } = usePanelSubscription();
  const writable = canWrite("cms-blog");
  const utils = trpc.useUtils();
  const list = trpc.blog.list.useQuery(undefined, { retry: false });
  const remove = trpc.blog.remove.useMutation({
    onSuccess: () => { toast.success(tx("Entrada eliminada")); utils.blog.list.invalidate(); setToDelete(null); },
    onError: (e) => toastError(e),
  });
  const categories = useMemo(
    () => Array.from(new Set((list.data ?? []).map((p) => p.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, "es")),
    [list.data],
  );

  if (editing !== undefined) {
    return (
      <AdminLayout title={tx("Blog")}>
        <PostEditor id={editing} canWrite={writable} categories={categories} onClose={() => setEditing(undefined)} />
      </AdminLayout>
    );
  }

  const posts = list.data ?? [];
  return (
    <AdminLayout title={tx("Blog")}>
      <div className="p-4 md:p-6">
        <PanelPageHeader
          icon={<Newspaper />}
          title={tx("Blog")}
          description={tx("Entradas de tu web en /blog. Solo las publicadas se ven en la web.")}
          actions={<>
            <Button variant="outline" asChild>
              <a href="/blog" target="_blank" rel="noopener noreferrer"><ExternalLink size={14} className="mr-1.5" aria-hidden="true" />{tx("Ver el blog")}</a>
            </Button>
            <Button onClick={() => setEditing(null)} disabled={!writable}><Plus size={14} className="mr-1.5" aria-hidden="true" />{tx("Nueva entrada")}</Button>
          </>}
        />

        {!writable && (
          <p role="status" className={`mb-4 rounded-md border px-3 py-2 text-sm text-foreground ${TONE_SURFACE.warning}`}>{tx("Solo lectura: tu plan permite consultar el blog, pero no modificarlo.")}</p>
        )}

        {list.isLoading ? (
          <PanelLoading label={tx("Cargando entradas…")} />
        ) : list.error ? (
          <PanelError title={tx("No se han podido cargar las entradas")} error={list.error} onRetry={() => void list.refetch()} />
        ) : posts.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-xl bg-background">
            <Newspaper size={32} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{tx("Aún no hay entradas")}</p>
            <p className="text-sm text-muted-foreground mt-1">{tx("Escribe noticias, novedades o consejos para tus clientes.")}</p>
            {writable && <Button className="mt-4" size="sm" onClick={() => setEditing(null)}><Plus size={14} className="mr-1" aria-hidden="true" />{tx("Crear la primera entrada")}</Button>}
          </div>
        ) : (
          <div className="bg-background border border-border rounded-xl overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <caption className="sr-only">{tx("Entradas del blog")}</caption>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <th scope="col" className="px-4 py-3">{tx("Entrada")}</th>
                  <th scope="col" className="px-4 py-3">{tx("Estado")}</th>
                  <th scope="col" className="px-4 py-3">{tx("Categoría")}</th>
                  <th scope="col" className="px-4 py-3">{tx("Publicación")}</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">{tx("Acciones")}</span></th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm">{p.title}</p>
                      <code className="text-xs text-muted-foreground">{tx("/blog/{slug}", { slug: p.slug })}</code>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.visibleStatus} /></td>
                    <td className="px-4 py-3 text-sm">{p.category ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{p.publishedAt ? format.dateTime(p.publishedAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {p.visibleStatus === "published" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer" aria-label={tx("Ver «{title}» en la web", { title: p.title })}><ExternalLink size={14} aria-hidden="true" /></a>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p.id)} aria-label={`${writable ? tx("Editar") : tx("Ver")} «${p.title}»`}>
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        {writable && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-danger hover:text-danger" onClick={() => setToDelete({ id: p.id, title: p.title })} aria-label={tx("Eliminar «{title}»", { title: p.title })}>
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tx("¿Eliminar la entrada?")}</AlertDialogTitle>
            <AlertDialogDescription>{tx("«{title}» desaparecerá del panel y de la web. Esta acción no se puede deshacer.", { title: toDelete?.title })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tx("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate({ id: toDelete.id })} disabled={remove.isPending}>{tx("Eliminar")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
