/**
 * Web › Páginas: el constructor de la web de la empresa. Lista de páginas (crear desde una plantilla, duplicar,
 * eliminar con confirmación, elegir portada) y editor por bloques con borrador, vista previa y publicación.
 * Lógica de servidor en server/pageBuilderDb.ts; modelo de bloques en shared/pageBlocks.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Copy, FileText, Globe, Home, ListTree, MoreHorizontal, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { PageEditor, type SitePage } from "@/components/admin/pageBuilder/PageEditor";
import { cn } from "@/lib/utils";
import { PAGE_TEMPLATES, SEO_LIMITS, pageSlugProblem, slugFromTitle, type PageTemplateKey } from "@shared/pageBlocks";

const EDIT_PARAM = "editar";

function readEditParam(): string | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(EDIT_PARAM);
  return v && /^[a-z0-9-]{1,64}$/.test(v) ? v : null;
}

function writeEditParam(slug: string | null) {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set(EDIT_PARAM, slug);
  else url.searchParams.delete(EDIT_PARAM);
  window.history.replaceState(window.history.state, "", url.pathname + url.search);
}

export default function PagesManager() {
  const utils = trpc.useUtils();
  const list = trpc.cms.sitePages.useQuery();
  const pages = (list.data ?? []) as SitePage[];
  const [editing, setEditing] = useState<string | null>(readEditParam);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SitePage | null>(null);

  const edit = (slug: string | null) => {
    setEditing(slug);
    writeEditParam(slug);
  };

  const duplicate = trpc.cms.duplicateSitePage.useMutation({
    onSuccess: (r) => {
      toast.success(`Copia creada: «${r.title}». Está sin publicar.`);
      void utils.cms.sitePages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const home = trpc.cms.setHomePage.useMutation({
    onSuccess: () => {
      toast.success("Es la nueva portada de tu web");
      void utils.cms.sitePages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (editing) {
    return (
      <AdminLayout>
        <PageEditor slug={editing} pages={pages} onBack={() => edit(null)} onSlugChange={(s) => edit(s)} />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Páginas de tu web</h1>
            <p className="mt-1 text-sm text-muted-foreground">Crea y edita las páginas de tu web con bloques. Los cambios se ven en tu web cuando los publicas.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/cms/menus">
                <ListTree className="mr-1.5 h-4 w-4" /> Ordenar el menú
              </Link>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Nueva página
            </Button>
          </div>
        </div>

        {list.isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Cargando páginas…</div>
        ) : !pages.length ? (
          <PanelEmpty icon={<FileText className="h-6 w-6" />} title="Todavía no tienes páginas" description="Crea la portada de tu web y las páginas que necesites: servicios, quiénes somos, contacto…">
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Crear la primera página
            </Button>
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
            {pages.map((p) => (
              <li key={p.slug} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.isHome ? <Home className="h-4 w-4 text-primary" aria-hidden /> : p.isLegal ? <Scale className="h-4 w-4 text-muted-foreground" aria-hidden /> : <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />}
                    <button type="button" className="overflow-hidden text-ellipsis whitespace-nowrap text-left font-medium hover:underline" onClick={() => edit(p.slug)}>
                      {p.title}
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{p.isHome ? "Portada" : `/${p.slug}`}</span>
                    <Badge variant={p.isPublished ? "default" : "secondary"} className="text-[11px]">
                      {p.isPublished ? "Publicada" : "Sin publicar"}
                    </Badge>
                    {p.hasDraft && p.isPublished && <Badge variant="outline" className="text-[11px] border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">Cambios sin publicar</Badge>}
                    {p.isLegal && <Badge variant="outline" className="text-[11px]">Texto legal</Badge>}
                    {(p.inHeader || p.inFooter) && <Badge variant="outline" className="text-[11px]">{p.inHeader ? "En el menú" : "En el pie"}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => edit(p.slug)}>
                    <Pencil className="mr-1.5 h-4 w-4" /> Editar
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Más opciones de ${p.title}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {p.isPublished && (
                        <DropdownMenuItem onSelect={() => window.open(p.isHome ? "/" : `/${p.slug}`, "_blank", "noopener")}>
                          <Globe className="mr-2 h-4 w-4" /> Ver en la web
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => duplicate.mutate({ slug: p.slug })}>
                        <Copy className="mr-2 h-4 w-4" /> Duplicar
                      </DropdownMenuItem>
                      {!p.isHome && p.isPublished && (
                        <DropdownMenuItem onSelect={() => home.mutate({ slug: p.slug })}>
                          <Home className="mr-2 h-4 w-4" /> Usar como portada
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={p.isHome} onSelect={() => setToDelete(p)}>
                        <Trash2 className="mr-2 h-4 w-4" /> {p.isHome ? "Eliminar (es la portada)" : "Eliminar"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreatePageDialog
        open={creating}
        pages={pages}
        onClose={() => setCreating(false)}
        onCreated={(slug) => {
          setCreating(false);
          void utils.cms.sitePages.invalidate();
          edit(slug);
        }}
      />
      <DeletePageDialog page={toDelete} onClose={() => setToDelete(null)} />
    </AdminLayout>
  );
}

function CreatePageDialog({ open, pages, onClose, onCreated }: { open: boolean; pages: SitePage[]; onClose: () => void; onCreated: (slug: string) => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState<PageTemplateKey>("blank");
  const [addToMenu, setAddToMenu] = useState(true);
  const [metaDescription, setMetaDescription] = useState("");
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSlug("");
    setSlugTouched(false);
    setTemplate("blank");
    setAddToMenu(true);
    setMetaDescription("");
  }, [open]);

  const taken = useMemo(() => pages.some((p) => p.slug === slug), [pages, slug]);
  const slugError = !slug ? null : taken ? "Ya tienes una página con esa dirección. Elige otra." : pageSlugProblem(slug);
  const create = trpc.cms.createSitePage.useMutation({
    onSuccess: (r) => {
      toast.success("Página creada. Edítala y pulsa «Publicar» cuando esté lista.");
      onCreated(r.slug);
    },
    onError: (e) => toast.error(e.message),
  });
  const origin = typeof window !== "undefined" ? window.location.host : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva página</DialogTitle>
          <DialogDescription>Ponle un título y elige cómo empezar. Se crea sin publicar: nadie la verá hasta que la publiques.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="np-title">Título</Label>
            <Input
              id="np-title"
              value={title}
              maxLength={200}
              placeholder="Por ejemplo: Servicios"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugFromTitle(e.target.value));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-slug">Dirección de la página</Label>
            <div className="flex items-center gap-1.5">
              <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{origin}/</span>
              <Input
                id="np-slug"
                value={slug}
                aria-invalid={!!slugError}
                aria-describedby="np-slug-hint"
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                }}
              />
            </div>
            <p id="np-slug-hint" className={cn("text-xs", slugError ? "text-destructive" : "text-muted-foreground")}>
              {slugError ?? "Se crea sola a partir del título. Puedes cambiarla."}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Cómo empezar</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Plantilla">
              {PAGE_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={template === t.key}
                  onClick={() => setTemplate(t.key)}
                  className={cn("rounded-lg border p-3 text-left transition-colors", template === t.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted")}
                >
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="np-meta">Descripción para buscadores (opcional)</Label>
            <Textarea id="np-meta" rows={2} value={metaDescription} maxLength={300} onChange={(e) => setMetaDescription(e.target.value)} />
            <span className={cn("text-xs", metaDescription.length > SEO_LIMITS.description ? "text-amber-700" : "text-muted-foreground")}>
              {metaDescription.length} de {SEO_LIMITS.description} caracteres
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="np-menu" checked={addToMenu} onCheckedChange={(v) => setAddToMenu(v === true)} className="mt-0.5" />
            <Label htmlFor="np-menu" className="font-normal leading-snug">
              Añadir al menú de la web
              <span className="block text-xs text-muted-foreground">El enlace aparecerá en el menú de arriba cuando publiques la página.</span>
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!title.trim() || !slug || !!slugError || create.isPending}
            onClick={() => create.mutate({ title: title.trim(), slug, template, addToMenu, metaDescription: metaDescription.trim() || undefined })}
          >
            {create.isPending ? "Creando…" : "Crear página"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletePageDialog({ page, onClose }: { page: SitePage | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const del = trpc.cms.deleteSitePage.useMutation({
    onSuccess: () => {
      toast.success("Página eliminada");
      void utils.cms.sitePages.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <AlertDialog open={!!page} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar «{page?.title}»?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>Se borrará la página con todo su contenido y su enlace en el menú. No se puede deshacer.</p>
              {page?.isLegal && (
                <p className="rounded-md border px-3 py-2 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                  Es un texto legal. Tu web debe informar a sus visitantes y el pie de página lo enlaza: si lo eliminas, ese enlace dejará de funcionar. Si solo
                  quieres cambiarlo, edítalo en lugar de eliminarlo.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              if (page) del.mutate({ slug: page.slug, confirmLegal: page.isLegal || undefined });
            }}
          >
            {del.isPending ? "Eliminando…" : page?.isLegal ? "Eliminar el texto legal" : "Eliminar página"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
