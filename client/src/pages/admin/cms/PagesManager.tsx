/**
 * Web › Páginas: las páginas de la web de la empresa. Lista de páginas (crear desde una plantilla, duplicar,
 * eliminar con confirmación, elegir portada); cada página se edita en Elephant Studio (/admin/studio/<dirección>).
 * Lógica de servidor en server/pageBuilderDb.ts; modelo de bloques en shared/pageBlocks.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { CornerDownRight, Copy, FileText, Globe, Home, ListTree, MoreHorizontal, Pencil, Plus, Scale, Sparkles, Trash2 } from "lucide-react";
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
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import type { SitePage } from "@/components/admin/studio/PageSettings";
import { cn } from "@/lib/utils";
import { PAGE_TEMPLATES, SEO_LIMITS, pageSlugProblem, slugFromTitle, type PageTemplateKey } from "@shared/pageBlocks";
import { useStudioText } from "@/components/admin/studio/useStudioText";

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function PagesManager() {
  const tx = useStudioText();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const list = trpc.cms.sitePages.useQuery();
  const pages = (list.data ?? []) as SitePage[];
  const [creating, setCreating] = useState(() => readParam("nueva") === "1");
  const [toDelete, setToDelete] = useState<SitePage | null>(null);

  const edit = (slug: string) => navigate(`/admin/studio/${slug}`);

  // Enlaces del editor anterior (?editar=<dirección>): abren la página en Elephant Studio
  useEffect(() => {
    const legacy = readParam("editar");
    if (legacy && /^[a-z0-9-]{1,64}$/.test(legacy)) navigate(`/admin/studio/${legacy}`, { replace: true });
  }, [navigate]);

  const duplicate = trpc.cms.duplicateSitePage.useMutation({
    onSuccess: (r) => {
      toast.success(tx("Copia creada: «{title}». Está sin publicar.", { title: r.title }));
      void utils.cms.sitePages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const home = trpc.cms.setHomePage.useMutation({
    onSuccess: () => {
      toast.success(tx("Es la nueva portada de tu web"));
      void utils.cms.sitePages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <PanelPageHeader
          icon={<FileText />}
          title={tx("Páginas de tu web")}
          description={tx("Crea tus páginas y edítalas visualmente en Elephant Studio. Los cambios se ven en tu web cuando los publicas.")}
          actions={<>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={tx("Más opciones")}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate("/admin/cms/menus")}><ListTree className="mr-2 h-4 w-4" aria-hidden="true" />{tx("Ordenar el menú")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/admin/cms/idiomas")}><Globe className="mr-2 h-4 w-4" aria-hidden="true" />{tx("Idiomas")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/admin/cms/redirecciones")}><CornerDownRight className="mr-2 h-4 w-4" aria-hidden="true" />{tx("Redirecciones")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" asChild>
              <Link href="/admin/studio"><Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />{tx("Abrir Elephant Studio")}</Link>
            </Button>
            <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{tx("Nueva página")}</Button>
          </>}
        />

        {list.isLoading ? (
          <PanelLoading label={tx("Cargando páginas…")} />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => void list.refetch()} />
        ) : !pages.length ? (
          <PanelEmpty icon={<FileText className="h-6 w-6" />} title={tx("Todavía no tienes páginas")} description={tx("Crea la portada de tu web y las páginas que necesites: servicios, quiénes somos, contacto…")}>
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" />{" "}{tx("Crear la primera página")}</Button>
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
                    <span>{p.isHome ? tx("Portada") : `/${p.slug}`}</span>
                    <StatusBadge tone={p.isPublished ? "success" : "neutral"}>{p.isPublished ? tx("Publicada") : tx("Borrador")}</StatusBadge>
                    {p.hasDraft && p.isPublished && <StatusBadge tone="warning">{tx("Cambios sin publicar")}</StatusBadge>}
                    {p.isLegal && <StatusBadge tone="neutral">{tx("Texto legal")}</StatusBadge>}
                    {(p.inHeader || p.inFooter) && <StatusBadge tone="info">{p.inHeader ? tx("En el menú") : tx("En el pie")}</StatusBadge>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => edit(p.slug)}>
                    <Pencil className="mr-1.5 h-4 w-4" />{" "}{tx("Editar")}</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={tx("Más opciones de {title}", { title: p.title })}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {p.isPublished && (
                        <DropdownMenuItem onSelect={() => window.open(p.isHome ? "/" : `/${p.slug}`, "_blank", "noopener")}>
                          <Globe className="mr-2 h-4 w-4" />{" "}{tx("Ver en la web")}</DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => duplicate.mutate({ slug: p.slug })}>
                        <Copy className="mr-2 h-4 w-4" />{" "}{tx("Duplicar")}</DropdownMenuItem>
                      {!p.isHome && p.isPublished && (
                        <DropdownMenuItem onSelect={() => home.mutate({ slug: p.slug })}>
                          <Home className="mr-2 h-4 w-4" />{" "}{tx("Usar como portada")}</DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={p.isHome} onSelect={() => setToDelete(p)}>
                        <Trash2 className="mr-2 h-4 w-4" /> {p.isHome ? tx("Eliminar (es la portada)") : tx("Eliminar")}
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
  const tx = useStudioText();
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
  const slugError = !slug ? null : taken ? tx("Ya tienes una página con esa dirección. Elige otra.") : pageSlugProblem(slug);
  const create = trpc.cms.createSitePage.useMutation({
    onSuccess: (r) => {
      toast.success(tx("Página creada. Edítala y pulsa «Publicar» cuando esté lista."));
      onCreated(r.slug);
    },
    onError: (e) => toast.error(e.message),
  });
  const origin = typeof window !== "undefined" ? window.location.host : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tx("Nueva página")}</DialogTitle>
          <DialogDescription>{tx("Ponle un título y elige cómo empezar. Se crea sin publicar: nadie la verá hasta que la publiques.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="np-title">{tx("Título")}</Label>
            <Input
              id="np-title"
              value={title}
              maxLength={200}
              placeholder={tx("Por ejemplo: Servicios")}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugFromTitle(e.target.value));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-slug">{tx("Dirección de la página")}</Label>
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
              {slugError ?? tx("Se crea sola a partir del título. Puedes cambiarla.")}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{tx("Cómo empezar")}</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tx("Plantilla")}>
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
            <Label htmlFor="np-meta">{tx("Descripción para buscadores (opcional)")}</Label>
            <Textarea id="np-meta" rows={2} value={metaDescription} maxLength={300} onChange={(e) => setMetaDescription(e.target.value)} />
            <span className={cn("text-xs", metaDescription.length > SEO_LIMITS.description ? "text-warning" : "text-muted-foreground")}>{tx("{metaDescriptionN} de {description} caracteres", { metaDescriptionN: metaDescription.length, description: SEO_LIMITS.description })}</span>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="np-menu" checked={addToMenu} onCheckedChange={(v) => setAddToMenu(v === true)} className="mt-0.5" />
            <Label htmlFor="np-menu" className="font-normal leading-snug">{tx("Añadir al menú de la web")}<span className="block text-xs text-muted-foreground">{tx("El enlace aparecerá en el menú de arriba cuando publiques la página.")}</span>
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tx("Cancelar")}</Button>
          <Button
            disabled={!title.trim() || !slug || !!slugError || create.isPending}
            onClick={() => create.mutate({ title: title.trim(), slug, template, addToMenu, metaDescription: metaDescription.trim() || undefined })}
          >
            {create.isPending ? tx("Creando…") : tx("Crear página")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletePageDialog({ page, onClose }: { page: SitePage | null; onClose: () => void }) {
  const tx = useStudioText();
  const utils = trpc.useUtils();
  const del = trpc.cms.deleteSitePage.useMutation({
    onSuccess: () => {
      toast.success(tx("Página eliminada"));
      void utils.cms.sitePages.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <AlertDialog open={!!page} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tx("¿Eliminar «{title}»?", { title: page?.title })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{tx("Se borrará la página con todo su contenido y su enlace en el menú. No se puede deshacer.")}</p>
              {page?.isLegal && (
                <p className="rounded-md border px-3 py-2 border-warning/40 bg-warning/10 text-warning">{tx("Es un texto legal. Tu web debe informar a sus visitantes y el pie de página lo enlaza: si lo eliminas, ese enlace dejará de funcionar. Si solo quieres cambiarlo, edítalo en lugar de eliminarlo.")}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tx("Cancelar")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              if (page) del.mutate({ slug: page.slug, confirmLegal: page.isLegal || undefined });
            }}
          >
            {del.isPending ? tx("Eliminando…") : page?.isLegal ? tx("Eliminar el texto legal") : tx("Eliminar página")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
