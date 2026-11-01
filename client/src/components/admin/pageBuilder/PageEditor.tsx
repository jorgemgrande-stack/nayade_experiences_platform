/**
 * Editor de una página de la web por bloques: contenido (añadir, ordenar, duplicar y eliminar bloques), borrador y
 * publicación, vista previa (ordenador, tableta y móvil) y ajustes (título, dirección, buscadores, menú y portada).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowUp, Columns2, Copy, Eye, FileText, Globe, Home, Image as ImageIcon, Images, LayoutTemplate,
  Mail, Minus, MousePointerClick, Monitor, Plus, Smartphone, Tablet, Trash2, ChevronDown, Upload,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { BLOCK_CATALOG, SEO_LIMITS, blockLabel, createBlock, duplicateBlock, pageSlugProblem, slugFromTitle, type BlockType, type PageBlock } from "@shared/pageBlocks";
import { isLegalPageSlug } from "@shared/tenantNav";
import { BlockEditor, blockSummary, type LinkTarget } from "./BlockEditors";
import { TOKEN_BADGE_CLASS } from "@shared/siteTokenLabels";

const ICONS: Record<BlockType, typeof FileText> = {
  hero: LayoutTemplate, text: AlignLeft, image: ImageIcon, gallery: Images, button: MousePointerClick, columns: Columns2, contact_form: Mail, separator: Minus,
};

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

const DEVICES = [
  { key: "desktop", label: "Ordenador", width: 1280, icon: Monitor },
  { key: "tablet", label: "Tableta", width: 768, icon: Tablet },
  { key: "mobile", label: "Móvil", width: 390, icon: Smartphone },
] as const;

export function PageEditor({ slug, pages, onBack, onSlugChange }: { slug: string; pages: SitePage[]; onBack: () => void; onSlugChange: (slug: string) => void }) {
  const utils = trpc.useUtils();
  const editor = trpc.cms.pageEditor.useQuery({ slug }, { refetchOnWindowFocus: false });
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [dirty, setDirtyState] = useState(false);
  // Lo que se está editando no se pisa al refrescar la página desde el servidor (menú, portada…)
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  };
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [addAt, setAddAt] = useState<"end" | "start">("end");
  const [toDelete, setToDelete] = useState<PageBlock | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [preview, setPreview] = useState<{ device: (typeof DEVICES)[number]["key"]; n: number } | null>(null);
  const [tab, setTab] = useState("contenido");

  useEffect(() => {
    if (editor.data && !dirtyRef.current) {
      setBlocks(editor.data.blocks as PageBlock[]);
      setDirty(false);
    }
  }, [editor.data]);

  const page = editor.data?.page as SitePage | undefined;
  const refresh = () => Promise.all([utils.cms.pageEditor.invalidate({ slug }), utils.cms.sitePages.invalidate()]);

  const saveDraft = trpc.cms.savePageDraft.useMutation();
  const publish = trpc.cms.publishPage.useMutation();
  const discard = trpc.cms.discardPageDraft.useMutation();

  const change = (next: PageBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };

  const targets: LinkTarget[] = useMemo(() => {
    const list = pages.map((p) => ({ label: p.isHome ? `${p.title} (portada)` : p.title, url: p.isHome ? "/" : `/${p.slug}` }));
    if (!pages.some((p) => p.slug === "contacto")) list.push({ label: "Formulario de contacto", url: "/contacto" });
    return list;
  }, [pages]);

  const doSave = async (quiet = false) => {
    try {
      await saveDraft.mutateAsync({ slug, blocks });
      setDirty(false);
      if (!quiet) toast.success("Borrador guardado. Tu web no cambia hasta que publiques.");
      await refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message || "No se ha podido guardar el borrador");
      return false;
    }
  };

  const doPublish = async () => {
    try {
      await publish.mutateAsync({ slug, blocks });
      setDirty(false);
      toast.success("Página publicada. Ya se ve en tu web.");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "No se ha podido publicar la página");
    }
  };

  const openPreview = async () => {
    if (dirty && !(await doSave(true))) return;
    setPreview((p) => ({ device: p?.device ?? "desktop", n: (p?.n ?? 0) + 1 }));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };

  const add = (type: BlockType) => {
    const b = createBlock(type);
    change(addAt === "start" ? [b, ...blocks] : [...blocks, b]);
    setOpen(b.id);
    setPicker(false);
  };

  if (editor.isLoading) return <div className="p-6 text-muted-foreground">Cargando la página…</div>;
  if (!editor.data || !page) {
    return (
      <div className="space-y-4 p-6">
        <p>No se ha encontrado la página.</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Volver a las páginas
        </Button>
      </div>
    );
  }

  const hasPending = dirty || page.hasDraft;
  const usesTokens = JSON.stringify(blocks).includes("{{");
  const publicUrl = page.isHome ? "/" : `/${page.slug}`;

  return (
    <div className="flex min-h-full flex-col">
      {/* Barra superior */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => (dirty ? setLeaving(true) : onBack())}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Páginas
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold">{page.title}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {page.isHome && <Badge variant="outline" className="gap-1"><Home className="h-3 w-3" /> Portada</Badge>}
              <Badge variant={page.isPublished ? "default" : "secondary"}>{page.isPublished ? "Publicada" : "Sin publicar"}</Badge>
              {(dirty || (page.hasDraft && page.isPublished)) && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">{dirty ? "Cambios sin guardar" : "Cambios sin publicar"}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => doSave()} disabled={!dirty || saveDraft.isPending}>
              {saveDraft.isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
            <Button variant="outline" size="sm" onClick={openPreview}>
              <Eye className="mr-1 h-4 w-4" /> Vista previa
            </Button>
            <Button size="sm" onClick={doPublish} disabled={publish.isPending || (!hasPending && page.isPublished && editor.data.source !== "converted")}>
              <Upload className="mr-1 h-4 w-4" /> {publish.isPending ? "Publicando…" : "Publicar"}
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 bg-muted/30 px-4 py-4 md:px-6">
        <TabsList className="mb-4">
          <TabsTrigger value="contenido">Contenido</TabsTrigger>
          <TabsTrigger value="ajustes">Ajustes de la página</TabsTrigger>
        </TabsList>

        <TabsContent value="contenido" className="mx-auto w-full min-w-0 max-w-3xl space-y-3">
          {editor.data.source === "converted" && (
            <p role="note" className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100">
              Hemos preparado esta página en bloques para que puedas editarla fácilmente, con todo su contenido. Tu web sigue mostrando la versión actual hasta que
              pulses «Publicar».
            </p>
          )}
          {!page.isPublished && editor.data.source !== "converted" && (
            <p role="note" className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              Esta página aún no está publicada: nadie la ve hasta que pulses «Publicar».
            </p>
          )}
          {page.hasDraft && page.isPublished && !dirty && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
              <span>Estás viendo el borrador. Tu web muestra la última versión publicada.</span>
              {(
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await discard.mutateAsync({ slug });
                    toast.success("Borrador descartado");
                    await refresh();
                  }}
                >
                  Descartar borrador
                </Button>
              )}
            </div>
          )}
          {usesTokens && (
            <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              Los distintivos como <span className={TOKEN_BADGE_CLASS}>Teléfono de tu empresa</span> o{" "}
              <span className={TOKEN_BADGE_CLASS}>Correo de tu empresa</span> se rellenan solos con los datos de tu empresa. Si falta alguno, esa línea no se
              muestra en tu web hasta que lo completes en Datos de la empresa.
            </p>
          )}

          {blocks.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-border bg-background px-6 py-12 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium">La página está vacía</p>
              <p className="mt-1 text-sm text-muted-foreground">Añade bloques para construirla: una cabecera con imagen, textos, botones…</p>
            </div>
          )}

          {blocks.map((b, i) => {
            const Icon = ICONS[b.type];
            const expanded = open === b.id;
            return (
              <div key={b.id} className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : b.id)}>
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{blockLabel(b.type)}</span>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{blockSummary(b) || "Sin texto todavía"}</span>
                    </span>
                    <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                  </button>
                  <div className="flex shrink-0 items-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Subir bloque" title="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Bajar bloque" title="Bajar" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Duplicar bloque"
                      title="Duplicar"
                      onClick={() => {
                        const c = duplicateBlock(b);
                        change([...blocks.slice(0, i + 1), c, ...blocks.slice(i + 1)]);
                        setOpen(c.id);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" aria-label="Eliminar bloque" title="Eliminar" onClick={() => setToDelete(b)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-border bg-muted/20 px-4 py-4">
                    <BlockEditor block={b} targets={targets} onChange={(nb) => change(blocks.map((x) => (x.id === b.id ? nb : x)))} />
                  </div>
                )}
              </div>
            );
          })}

          <Button variant="outline" className="w-full border-dashed bg-background" onClick={() => {
              setAddAt("end");
              setPicker(true);
            }}>
            <Plus className="mr-2 h-4 w-4" /> Añadir bloque
          </Button>
        </TabsContent>

        <TabsContent value="ajustes" className="mx-auto w-full min-w-0 max-w-3xl">
          <PageSettings page={page} pages={pages} onSaved={(s) => (s !== slug ? onSlugChange(s) : refresh())} />
        </TabsContent>
      </Tabs>

      {/* Elegir bloque */}
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Añadir bloque</DialogTitle>
            <DialogDescription>Elige qué quieres añadir. Después puedes moverlo con las flechas.</DialogDescription>
          </DialogHeader>
          {blocks.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm" role="radiogroup" aria-label="Dónde añadirlo">
              <span className="font-medium">Dónde:</span>
              {(["end", "start"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={addAt === k}
                  onClick={() => setAddAt(k)}
                  className={cn("rounded-md border px-3 py-1", addAt === k ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
                >
                  {k === "end" ? "Al final de la página" : "Al principio de la página"}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {BLOCK_CATALOG.map((c) => {
              const Icon = ICONS[c.type];
              return (
                <button key={c.type} type="button" onClick={() => add(c.type)} className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span>
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Eliminar bloque */}
      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este bloque?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará «{toDelete ? blockLabel(toDelete.type) : ""}» de la página. Tu web no cambia hasta que publiques.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (toDelete) change(blocks.filter((x) => x.id !== toDelete.id));
                setToDelete(null);
              }}
            >
              Eliminar bloque
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Salir con cambios sin guardar */}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tienes cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>Guárdalos como borrador para no perderlos, o sal sin guardar.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onBack()}>Salir sin guardar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (await doSave()) onBack();
              }}
            >
              Guardar y salir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Vista previa */}
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-3 p-3 sm:max-w-[96vw] md:p-4">
          <DialogHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pr-8">
            <div>
              <DialogTitle>Vista previa</DialogTitle>
              <DialogDescription>Así se verá «{page.title}» cuando la publiques.</DialogDescription>
            </div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tamaño de pantalla">
              {DEVICES.map((d) => (
                <Button
                  key={d.key}
                  size="sm"
                  role="radio"
                  aria-checked={preview?.device === d.key}
                  variant={preview?.device === d.key ? "default" : "outline"}
                  onClick={() => setPreview((p) => (p ? { ...p, device: d.key } : p))}
                >
                  <d.icon className="mr-1 h-4 w-4" /> {d.label}
                </Button>
              ))}
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-lg border border-border bg-muted/40">
            {preview && (
              <iframe
                key={preview.n}
                title={`Vista previa de ${page.title}`}
                src={`/admin/cms/paginas/vista-previa/${page.slug}`}
                className="mx-auto block h-full min-h-[600px] bg-white"
                style={{ width: DEVICES.find((d) => d.key === preview.device)!.width }}
              />
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)}>
              Seguir editando
            </Button>
            <Button
              onClick={async () => {
                await doPublish();
                setPreview(null);
              }}
              disabled={publish.isPending}
            >
              <Upload className="mr-1 h-4 w-4" /> Publicar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {page.isPublished && (
        <div className="border-t border-border bg-background px-4 py-3 text-sm md:px-6">
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
            <Globe className="h-4 w-4" /> Ver la página en tu web
          </a>
        </div>
      )}
    </div>
  );
}

/** Ajustes de la página: título, dirección, buscadores, menú, portada y visibilidad. */
function PageSettings({ page, pages, onSaved }: { page: SitePage; pages: SitePage[]; onSaved: (slug: string) => void }) {
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
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-border bg-background p-4 md:p-5">
        <h2 className="font-semibold">Página</h2>
        <div className="space-y-1.5">
          <Label htmlFor="ps-title">Título</Label>
          <Input id="ps-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ps-slug">Dirección de la página</Label>
          <div className="flex items-center gap-1.5">
            <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{origin}/</span>
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

      <section className="space-y-4 rounded-xl border border-border bg-background p-4 md:p-5">
        <div>
          <h2 className="font-semibold">Buscadores</h2>
          <p className="text-sm text-muted-foreground">Cómo aparece esta página en Google y otros buscadores.</p>
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
      </section>

      <div className="flex justify-end">
        <Button
          disabled={save.isPending || !title.trim() || !!slugError}
          onClick={() => save.mutate({ slug: page.slug, newSlug: slug !== page.slug ? slug : undefined, title: title.trim(), metaTitle: metaTitle.trim() || undefined, metaDescription: metaDescription.trim() || undefined })}
        >
          {save.isPending ? "Guardando…" : "Guardar ajustes"}
        </Button>
      </div>

      <section className="space-y-4 rounded-xl border border-border bg-background p-4 md:p-5">
        <h2 className="font-semibold">Menú de tu web</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="ps-header" className="font-normal">Mostrar en el menú de arriba</Label>
          <Switch id="ps-header" checked={page.inHeader} disabled={menu.isPending} onCheckedChange={(v) => menu.mutate({ slug: page.slug, zone: "header", inMenu: v })} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="ps-footer" className="font-normal">Mostrar en el pie de página</Label>
          <Switch id="ps-footer" checked={page.inFooter} disabled={menu.isPending} onCheckedChange={(v) => menu.mutate({ slug: page.slug, zone: "footer", inMenu: v })} />
        </div>
        {!page.isPublished && <p className="text-xs text-muted-foreground">Mientras la página no esté publicada, su enlace no aparece en el menú.</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-background p-4 md:p-5">
        <h2 className="font-semibold">Portada y visibilidad</h2>
        {page.isHome ? (
          <p className="flex items-center gap-2 text-sm">
            <Home className="h-4 w-4 text-primary" /> Es la portada de tu web: se ve al entrar en {origin || "tu dirección"}.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">La portada es la página que se ve al entrar en tu web.</p>
            <Button variant="outline" size="sm" disabled={home.isPending || !page.isPublished} onClick={() => home.mutate({ slug: page.slug })}>
              <Home className="mr-1 h-4 w-4" /> Usar como portada
            </Button>
          </div>
        )}
        {!page.isHome && !page.isPublished && <p className="text-xs text-muted-foreground">Publica la página para poder usarla como portada.</p>}
        {page.isPublished && !page.isHome && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">Retirarla de la web la oculta a tus visitantes; no se borra.</p>
            <Button variant="outline" size="sm" onClick={() => setConfirmUnpublish(true)}>
              Retirar de la web
            </Button>
          </div>
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
