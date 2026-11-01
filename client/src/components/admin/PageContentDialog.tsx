/**
 * Contenido de una página de la web de la empresa (título, dirección, texto y si está publicada). El texto admite HTML
 * sencillo (párrafos, títulos, listas, enlaces, imágenes); el servidor lo sanea al guardar y al servirlo.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isLegalPageSlug } from "@shared/tenantNav";

export interface EditablePage {
  slug: string;
  title: string;
  content?: string | null;
  isPublished?: boolean | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** Dirección a partir del título: minúsculas, sin tildes y con guiones. */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function PageContentDialog({ page, open, onClose, onSaved }: { page: EditablePage | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const isNew = !page;
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [content, setContent] = useState("");
  const [isPublished, setIsPublished] = useState(true);
  const [metaDescription, setMetaDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(page?.title ?? "");
    setSlug(page?.slug ?? "");
    setSlugTouched(!!page);
    setContent(page?.content ?? "");
    setIsPublished(page ? !!page.isPublished : true);
    setMetaDescription(page?.metaDescription ?? "");
  }, [open, page]);

  const save = trpc.cms.savePageContent.useMutation({
    onSuccess: () => {
      toast.success(isNew ? "Página creada" : "Página guardada");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message || "No se ha podido guardar la página"),
  });

  const slugValid = SLUG_RE.test(slug);
  const legal = isLegalPageSlug(slug);
  const canSave = title.trim().length > 0 && slugValid && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nueva página" : `Editar «${page?.title}»`}</DialogTitle>
          <DialogDescription>El texto admite formato HTML sencillo: párrafos, títulos, listas, enlaces e imágenes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="page-title">Título</Label>
              <Input
                id="page-title"
                value={title}
                maxLength={200}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (isNew && !slugTouched) {
                    const next = slugFromTitle(e.target.value);
                    setSlug(next);
                    if (isLegalPageSlug(next)) setIsPublished(false);
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="page-slug">Dirección</Label>
              <Input
                id="page-slug"
                value={slug}
                disabled={!isNew}
                aria-invalid={!slugValid && slug.length > 0}
                aria-describedby="page-slug-hint"
                onChange={(e) => {
                  setSlugTouched(true);
                  const next = e.target.value.toLowerCase();
                  setSlug(next);
                  if (isLegalPageSlug(next)) setIsPublished(false);
                }}
              />
              <p id="page-slug-hint" className="text-xs text-muted-foreground">
                {isNew ? "Minúsculas, números y guiones. La página «inicio» es la portada de tu web." : `Se ve en /${slug}`}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="page-content">Texto de la página</Label>
            <Textarea id="page-content" rows={14} className="font-mono text-xs" value={content} maxLength={200_000} onChange={(e) => setContent(e.target.value)} placeholder="<h1>Bienvenido</h1>&#10;<p>Cuéntales a tus clientes quién eres y qué ofreces.</p>" />
            {content.includes("{{") && (
              <p className="text-xs text-muted-foreground">
                Los datos entre dobles llaves, como {"{{nif}}"} o {"{{telefono}}"}, se rellenan solos con los datos de tu empresa. Si falta alguno, esa línea no
                se muestra en tu web hasta que lo completes en Datos de la empresa.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="page-meta">Descripción para buscadores (opcional)</Label>
            <Input id="page-meta" value={metaDescription} maxLength={300} onChange={(e) => setMetaDescription(e.target.value)} />
          </div>
          {legal && (
            <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Texto legal: revísalo con tu asesor y adáptalo a tu empresa. Mientras esté en borrador no aparece en tu web ni en su menú.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Switch id="page-published" checked={isPublished} onCheckedChange={setIsPublished} />
            <Label htmlFor="page-published">Publicada (visible en tu web)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!canSave}
            onClick={() =>
              save.mutate({ slug, title: title.trim(), content, isPublished, metaDescription: metaDescription.trim() || undefined, metaTitle: title.trim() })
            }
          >
            {save.isPending ? "Guardando…" : isNew ? "Crear página" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
