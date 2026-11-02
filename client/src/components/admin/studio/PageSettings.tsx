/**
 * Ajustes de una página de la web (inspector de Elephant Studio cuando no hay ningún bloque seleccionado): título,
 * dirección, textos para buscadores, menú, portada y visibilidad. Se guardan al momento (no forman parte del
 * borrador de los bloques).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Home } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { SEO_LIMITS, pageSlugProblem, slugFromTitle } from "@shared/pageBlocks";
import { isLegalPageSlug } from "@shared/tenantNav";

export type SitePage = {
  slug: string; title: string; isPublished: boolean; metaTitle: string | null; metaDescription: string | null; hasDraft: boolean; isHome: boolean; isLegal: boolean; inHeader: boolean; inFooter: boolean;
};

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.length;
  return (
    <span className={cn("text-xs", n > max ? "text-amber-700" : "text-muted-foreground")}>
      {n} de {max} caracteres{n > max ? " · los buscadores lo cortarán" : ""}
    </span>
  );
}

/** `beforeSave`: el editor guarda antes el borrador de los bloques (al cambiar la dirección, el borrador la sigue). */
export function PageSettings({ page, pages, onSaved, beforeSave }: { page: SitePage; pages: SitePage[]; onSaved: (slug: string) => void; beforeSave?: () => Promise<boolean> }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [metaTitle, setMetaTitle] = useState(page.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(page.metaDescription ?? "");
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  useEffect(() => {
    setTitle(page.title);
    setSlug(page.slug);
    setMetaTitle(page.metaTitle ?? "");
    setMetaDescription(page.metaDescription ?? "");
  }, [page.slug, page.title, page.metaTitle, page.metaDescription]);

  const locked = page.slug === "inicio" || isLegalPageSlug(page.slug);
  const taken = slug !== page.slug && pages.some((p) => p.slug === slug);
  const slugError = slug === page.slug ? null : taken ? "Ya tienes una página con esa dirección." : pageSlugProblem(slug);
  const origin = typeof window !== "undefined" ? window.location.host : "";
  const changed = title.trim() !== page.title || slug !== page.slug || metaTitle.trim() !== (page.metaTitle ?? "") || metaDescription.trim() !== (page.metaDescription ?? "");

  const save = trpc.cms.updatePageSettings.useMutation({
    onSuccess: (r) => {
      toast.success("Ajustes guardados");
      void utils.cms.sitePages.invalidate();
      onSaved(r.slug);
    },
    onError: (e) => toast.error(e.message),
  });
  const after = () => Promise.all([utils.cms.sitePages.invalidate(), utils.cms.pageEditor.invalidate({ slug: page.slug })]);
  const menu = trpc.cms.setPageInMenu.useMutation({ onSuccess: after, onError: (e) => toast.error(e.message) });
  const home = trpc.cms.setHomePage.useMutation({
    onSuccess: () => {
      toast.success("Es la nueva portada de tu web");
      void after();
    },
    onError: (e) => toast.error(e.message),
  });
  const published = trpc.cms.setPagePublished.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.isPublished ? "La página vuelve a verse en tu web" : "Página retirada de tu web");
      void after();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Página</h3>
        <div className="space-y-1.5">
          <Label htmlFor="ps-title">Título</Label>
          <Input id="ps-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-slug">Dirección de la página</Label>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-xs text-muted-foreground">/</span>
            <Input id="ps-slug" value={slug} disabled={locked} aria-invalid={!!slugError} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))} />
          </div>
          {locked ? (
            <p className="text-xs text-muted-foreground">La dirección de esta página no se puede cambiar.</p>
          ) : slugError ? (
            <p className="text-xs text-destructive">{slugError}</p>
          ) : (
            <button type="button" className="text-xs text-primary underline-offset-4 hover:underline" onClick={() => setSlug(slugFromTitle(title))}>
              Usar el título como dirección
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buscadores</h3>
          <p className="text-xs text-muted-foreground">Cómo aparece esta página en Google y otros buscadores.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-mt">Título para buscadores</Label>
          <Input id="ps-mt" value={metaTitle} maxLength={200} placeholder={title} onChange={(e) => setMetaTitle(e.target.value)} />
          <Counter value={metaTitle || title} max={SEO_LIMITS.title} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-md">Descripción para buscadores</Label>
          <Textarea id="ps-md" rows={3} value={metaDescription} maxLength={300} placeholder="Resume en una o dos frases qué encontrará quien visite esta página." onChange={(e) => setMetaDescription(e.target.value)} />
          <Counter value={metaDescription} max={SEO_LIMITS.description} />
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[11px] text-muted-foreground">{origin}{page.isHome ? "" : `/${slug}`}</p>
          <p className="mt-0.5 text-sm font-medium text-[#1a0dab] dark:text-sky-300">{(metaTitle || title).slice(0, 70)}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{metaDescription || "Sin descripción: los buscadores mostrarán un fragmento de la página."}</p>
        </div>
        <Button
          className="w-full"
          disabled={save.isPending || !title.trim() || !!slugError || !changed}
          onClick={async () => {
            if (beforeSave && !(await beforeSave())) return;
            save.mutate({ slug: page.slug, newSlug: slug !== page.slug ? slug : undefined, title: title.trim(), metaTitle: metaTitle.trim() || undefined, metaDescription: metaDescription.trim() || undefined });
          }}
        >
          {save.isPending ? "Guardando…" : "Guardar ajustes de la página"}
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Menú de tu web</h3>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ps-header" className="font-normal">En el menú de arriba</Label>
          <Switch id="ps-header" checked={page.inHeader} disabled={menu.isPending} onCheckedChange={(v) => menu.mutate({ slug: page.slug, zone: "header", inMenu: v })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ps-footer" className="font-normal">En el pie de página</Label>
          <Switch id="ps-footer" checked={page.inFooter} disabled={menu.isPending} onCheckedChange={(v) => menu.mutate({ slug: page.slug, zone: "footer", inMenu: v })} />
        </div>
        {!page.isPublished && <p className="text-xs text-muted-foreground">Mientras la página no esté publicada, su enlace no aparece en el menú.</p>}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Portada y visibilidad</h3>
        {page.isHome ? (
          <p className="flex items-center gap-2 text-sm">
            <Home className="h-4 w-4 text-primary" /> Es la portada de tu web.
          </p>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled={home.isPending || !page.isPublished} onClick={() => home.mutate({ slug: page.slug })}>
            <Home className="mr-1 h-4 w-4" /> Usar como portada
          </Button>
        )}
        {!page.isHome && !page.isPublished && <p className="text-xs text-muted-foreground">Publica la página para poder usarla como portada.</p>}
        {page.isPublished && !page.isHome && (
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setConfirmUnpublish(true)}>
            Retirar de la web (no se borra)
          </Button>
        )}
      </section>

      <AlertDialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Retirar «{page.title}» de tu web?</AlertDialogTitle>
            <AlertDialogDescription>Dejará de verse y de aparecer en el menú. Puedes volver a publicarla cuando quieras.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => published.mutate({ slug: page.slug, isPublished: false })}>Retirar de la web</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
