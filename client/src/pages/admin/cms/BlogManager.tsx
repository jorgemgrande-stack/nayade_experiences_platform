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
import { PanelError } from "@/components/admin/PanelStates";
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
const fmt = (ms: number | null | undefined) =>
  ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms)) : "—";

const STATUS_CLASS: Record<BlogVisibleStatus, string> = {
  draft: "bg-slate-100 text-slate-800 border-slate-300",
  scheduled: "bg-amber-50 text-amber-900 border-amber-300",
  published: "bg-emerald-50 text-emerald-900 border-emerald-300",
};

function StatusBadge({ status }: { status: BlogVisibleStatus }) {
  return <Badge variant="outline" className={`text-xs ${STATUS_CLASS[status]}`}>{BLOG_STATUS_LABEL[status]}</Badge>;
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <p id={id} className="mt-1 text-xs text-red-700" role="alert">{msg}</p>;
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-xs ${value.length > max ? "text-red-700" : "text-muted-foreground"}`}>{value.length}/{max}</span>;
}

// ─── Editor ──────────────────────────────────────────────────────────────────
function PostEditor({ id, canWrite, categories, onClose }: { id: number | null; canWrite: boolean; categories: string[]; onClose: () => void }) {
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
      toast.error("Revisa los campos marcados.");
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

  if (id !== null && existing.isLoading) return <p role="status" className="p-6 text-muted-foreground">Cargando entrada…</p>;
  if (id !== null && existing.error) return <PanelError className="m-6" title="No se ha podido cargar la entrada" error={existing.error} onRetry={() => void existing.refetch()} />;

  return (
    <form onSubmit={submit} noValidate className="p-4 md:p-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}><ArrowLeft size={16} className="mr-1" aria-hidden="true" />Entradas</Button>
          <h1 className="text-xl font-bold">{id === null ? "Nueva entrada" : "Editar entrada"}</h1>
          {existing.data && <StatusBadge status={existing.data.visibleStatus} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => preview.mutate({ content: form.content })} disabled={!canWrite || preview.isPending}>
            <Eye size={14} className="mr-1" aria-hidden="true" />Vista previa
          </Button>
          <Button type="submit" size="sm" disabled={!canWrite || saving}>
            <Save size={14} className="mr-1" aria-hidden="true" />
            {saving ? "Guardando…" : status === "published" ? (scheduled ? "Programar publicación" : "Publicar") : "Guardar borrador"}
          </Button>
        </div>
      </div>

      {!canWrite && (
        <p role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Solo lectura: tu plan permite consultar el blog, pero no modificarlo.
        </p>
      )}

      <fieldset disabled={!canWrite} className="space-y-6">
        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-contenido">
          <h2 id="blog-sec-contenido" className="font-semibold">Contenido</h2>
          <div>
            <Label htmlFor="blog-title">Título <span aria-hidden="true">*</span></Label>
            <Input {...inv("title")} required value={form.title} onChange={(e) => set("title", e.target.value)} className="mt-1" />
            <FieldError id="blog-title-error" msg={errors.title} />
          </div>
          <div>
            <Label htmlFor="blog-slug">Dirección (slug) <span aria-hidden="true">*</span></Label>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/blog/</span>
              <Input {...inv("slug")} required value={form.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value); }} />
            </div>
            <p id="blog-slug-hint" className="mt-1 text-xs text-muted-foreground">Minúsculas, números y guiones. Se propone a partir del título.</p>
            <FieldError id="blog-slug-error" msg={errors.slug} />
          </div>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="blog-excerpt">Extracto</Label><Counter value={form.excerpt} max={BLOG_LIMITS.excerpt} /></div>
            <Textarea {...inv("excerpt")} rows={2} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} className="mt-1" />
            <p id="blog-excerpt-hint" className="mt-1 text-xs text-muted-foreground">Resumen que aparece en el listado del blog.</p>
            <FieldError id="blog-excerpt-error" msg={errors.excerpt} />
          </div>
          <div>
            <Label htmlFor="blog-content">Texto de la entrada</Label>
            <Textarea {...inv("content")} rows={14} value={form.content} onChange={(e) => set("content", e.target.value)} className="mt-1 font-mono text-sm" />
            <p id="blog-content-hint" className="mt-1 text-xs text-muted-foreground">
              Admite HTML básico, igual que las páginas: títulos (&lt;h2&gt;), párrafos (&lt;p&gt;), listas, negrita, enlaces e imágenes. Los scripts y estilos se eliminan al publicar.
            </p>
            <FieldError id="blog-content-error" msg={errors.content} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-imagen">
          <h2 id="blog-sec-imagen" className="font-semibold">Imagen destacada (opcional)</h2>
          <ImageUploader label="Imagen destacada" value={form.featuredImageUrl} onChange={(url) => set("featuredImageUrl", url)} />
          <FieldError id="blog-featuredImageUrl-error" msg={errors.featuredImageUrl} />
          <div>
            <Label htmlFor="blog-featuredImageAlt">Texto alternativo de la imagen</Label>
            <Input {...inv("featuredImageAlt")} value={form.featuredImageAlt} onChange={(e) => set("featuredImageAlt", e.target.value)} className="mt-1" />
            <p id="blog-featuredImageAlt-hint" className="mt-1 text-xs text-muted-foreground">Describe la imagen para quien no puede verla.</p>
            <FieldError id="blog-featuredImageAlt-error" msg={errors.featuredImageAlt} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-publicacion">
          <h2 id="blog-sec-publicacion" className="font-semibold">Publicación</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="blog-authorName">Autor</Label>
              <Input {...inv("authorName")} value={form.authorName} onChange={(e) => set("authorName", e.target.value)} className="mt-1" />
              <p id="blog-authorName-hint" className="mt-1 text-xs text-muted-foreground">Si lo dejas vacío en una entrada nueva, se usa tu nombre.</p>
              <FieldError id="blog-authorName-error" msg={errors.authorName} />
            </div>
            <div>
              <Label htmlFor="blog-category">Categoría (opcional)</Label>
              <Input {...inv("category")} list="blog-categories" value={form.category} onChange={(e) => set("category", e.target.value)} className="mt-1" />
              <datalist id="blog-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              <p id="blog-category-hint" className="mt-1 text-xs text-muted-foreground">Escribe una nueva o elige una existente.</p>
              <FieldError id="blog-category-error" msg={errors.category} />
            </div>
          </div>
          <div>
            <p id="blog-status-label" className="text-sm font-medium mb-2">Estado</p>
            <RadioGroup aria-labelledby="blog-status-label" value={status} onValueChange={(v) => setStatus(v as BlogStatus)} className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2"><RadioGroupItem value="draft" id="blog-status-draft" /><Label htmlFor="blog-status-draft">Borrador (no se ve en la web)</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="published" id="blog-status-published" /><Label htmlFor="blog-status-published">Publicada</Label></div>
            </RadioGroup>
          </div>
          <div className="max-w-xs">
            <Label htmlFor="blog-publishedAt">Fecha de publicación (opcional)</Label>
            <Input id="blog-publishedAt" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} aria-describedby="blog-publishedAt-hint" className="mt-1" />
            <p id="blog-publishedAt-hint" className="mt-1 text-xs text-muted-foreground">
              Vacía: se publica al guardar. Futura: la entrada queda programada y aparece en la web a esa hora.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background p-4 md:p-5 space-y-4" aria-labelledby="blog-sec-seo">
          <h2 id="blog-sec-seo" className="font-semibold">SEO (opcional)</h2>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="blog-metaTitle">Título SEO</Label><Counter value={form.metaTitle} max={BLOG_LIMITS.metaTitle} /></div>
            <Input {...inv("metaTitle")} value={form.metaTitle} onChange={(e) => set("metaTitle", e.target.value)} className="mt-1" />
            <p id="blog-metaTitle-hint" className="mt-1 text-xs text-muted-foreground">Si lo dejas vacío, se usa el título.</p>
            <FieldError id="blog-metaTitle-error" msg={errors.metaTitle} />
          </div>
          <div>
            <div className="flex items-center justify-between"><Label htmlFor="blog-metaDescription">Descripción SEO</Label><Counter value={form.metaDescription} max={BLOG_LIMITS.metaDescription} /></div>
            <Textarea {...inv("metaDescription")} rows={2} value={form.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} className="mt-1" />
            <p id="blog-metaDescription-hint" className="mt-1 text-xs text-muted-foreground">Si la dejas vacía, se usa el extracto.</p>
            <FieldError id="blog-metaDescription-error" msg={errors.metaDescription} />
          </div>
        </section>
      </fieldset>

      <Dialog open={previewHtml !== null} onOpenChange={(o) => !o && setPreviewHtml(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista previa</DialogTitle>
            <DialogDescription>Así se verá la entrada en la web. No se ha guardado ni publicado nada.</DialogDescription>
          </DialogHeader>
          <article>
            {form.category && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{form.category}</p>}
            <h2 className="mt-1 text-2xl font-bold">{form.title || "(Sin título)"}</h2>
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
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<{ id: number; title: string } | null>(null);
  const { canWrite } = usePanelSubscription();
  const writable = canWrite("cms-blog");
  const utils = trpc.useUtils();
  const list = trpc.blog.list.useQuery(undefined, { retry: false });
  const remove = trpc.blog.remove.useMutation({
    onSuccess: () => { toast.success("Entrada eliminada"); utils.blog.list.invalidate(); setToDelete(null); },
    onError: (e) => toastError(e),
  });
  const categories = useMemo(
    () => Array.from(new Set((list.data ?? []).map((p) => p.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, "es")),
    [list.data],
  );

  if (editing !== undefined) {
    return (
      <AdminLayout title="Blog">
        <PostEditor id={editing} canWrite={writable} categories={categories} onClose={() => setEditing(undefined)} />
      </AdminLayout>
    );
  }

  const posts = list.data ?? [];
  return (
    <AdminLayout title="Blog">
      <div className="p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Blog</h1>
            <p className="text-sm text-muted-foreground mt-1">Entradas de tu web en /blog. Solo las publicadas se ven en la web.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/blog" target="_blank" rel="noopener noreferrer"><ExternalLink size={14} className="mr-1" aria-hidden="true" />Ver el blog</a>
            </Button>
            <Button size="sm" onClick={() => setEditing(null)} disabled={!writable}><Plus size={14} className="mr-1" aria-hidden="true" />Nueva entrada</Button>
          </div>
        </div>

        {!writable && (
          <p role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Solo lectura: tu plan permite consultar el blog, pero no modificarlo.
          </p>
        )}

        {list.isLoading ? (
          <p role="status" className="py-12 text-center text-muted-foreground">Cargando entradas…</p>
        ) : list.error ? (
          <PanelError title="No se han podido cargar las entradas" error={list.error} onRetry={() => void list.refetch()} />
        ) : posts.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-xl bg-background">
            <Newspaper size={32} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Aún no hay entradas</p>
            <p className="text-sm text-muted-foreground mt-1">Escribe noticias, novedades o consejos para tus clientes.</p>
            {writable && <Button className="mt-4" size="sm" onClick={() => setEditing(null)}><Plus size={14} className="mr-1" aria-hidden="true" />Crear la primera entrada</Button>}
          </div>
        ) : (
          <div className="bg-background border border-border rounded-xl overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <caption className="sr-only">Entradas del blog</caption>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <th scope="col" className="px-4 py-3">Entrada</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3">Categoría</th>
                  <th scope="col" className="px-4 py-3">Publicación</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm">{p.title}</p>
                      <code className="text-xs text-muted-foreground">/blog/{p.slug}</code>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.visibleStatus} /></td>
                    <td className="px-4 py-3 text-sm">{p.category ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmt(p.publishedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {p.visibleStatus === "published" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <a href={`/blog/${p.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`Ver «${p.title}» en la web`}><ExternalLink size={14} aria-hidden="true" /></a>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p.id)} aria-label={`${writable ? "Editar" : "Ver"} «${p.title}»`}>
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        {writable && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700 hover:text-red-800" onClick={() => setToDelete({ id: p.id, title: p.title })} aria-label={`Eliminar «${p.title}»`}>
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
            <AlertDialogTitle>¿Eliminar la entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              «{toDelete?.title}» desaparecerá del panel y de la web. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate({ id: toDelete.id })} disabled={remove.isPending}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
