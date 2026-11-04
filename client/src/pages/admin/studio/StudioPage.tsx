/**
 * Elephant Studio — el constructor visual de la web de cada empresa (Web › Elephant Studio).
 *
 * Evoluciona el constructor de páginas por bloques: mismos datos (server/pageBuilderDb.ts), mismo saneado y el
 * mismo componente para el lienzo, la vista previa y la web publicada (PageBlocksView). Cuatro zonas:
 *   - barra superior: página, estado, deshacer y rehacer, dispositivo, modo, historial, vista previa y publicar;
 *   - panel izquierdo: biblioteca de módulos y secciones, estructura de la página y navegación del sitio;
 *   - lienzo: la propia web en un marco del ancho del dispositivo, editable directamente;
 *   - inspector: contenido y diseño del bloque seleccionado, o los ajustes de la página.
 *
 * Lo que se edita se guarda solo como BORRADOR; la web cambia únicamente al pulsar «Publicar», y cada publicación
 * queda en el historial para poder recuperarla.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  ArrowLeft, BookmarkPlus, Check, ChevronDown, CircleAlert, Eye, ExternalLink, History, Keyboard, Loader2, Monitor, MoreHorizontal, PanelLeft, PanelRight, Redo2,
  LifeBuoy, Maximize2, Minimize2, SlidersHorizontal, Smartphone, Tablet, Undo2, Upload, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { AuthRequired, PanelSpinner } from "@/components/auth/AuthRequired";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { NOT_NESTABLE, PAGE_LIMITS, PAGE_TEMPLATES, blockLabel, createBlock, duplicateBlock, readBlockText, templateBlocks, writeBlockText, type BlockType, type Device, type PageBlock, type PageTemplateKey } from "@shared/pageBlocks";
import { SECTION_PRESETS, availableModules, moduleDef } from "@shared/studio/modules";
import { countBlocks, createSection, findBlock, insertBlocks, moveBlock, nestable, placeProblem, removeBlock, walk, type Place } from "@shared/studio/tree";
import { QuickInsert } from "@/components/admin/studio/QuickInsert";
import { MediaLibraryDialog } from "@/components/ImageUploader";
import { siteRelativeFileUrl } from "@shared/imageUpload";
import { SITE_TOKEN_LABELS } from "@shared/siteTokenLabels";
import type { LinkTarget } from "@/components/admin/pageBuilder/BlockEditors";
import { BlockInspector, type InspectorTab } from "@/components/admin/studio/Inspector";
import { LeftPanel, revealLibraryGroup, type LeftTab } from "@/components/admin/studio/LeftPanel";
import { GuideCard, markGuide, reopenGuide } from "@/components/admin/studio/Guide";
import { RealPreview } from "@/components/admin/studio/RealPreview";
import { PageSettings, type SitePage } from "@/components/admin/studio/PageSettings";
import { VersionsPanel } from "@/components/admin/studio/VersionsPanel";
import { SiteChromeEditor } from "@/components/admin/studio/SiteChromeEditor";
import { BrandIdentityEditor } from "@/components/brand/BrandIdentityEditor";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { moduleIcon } from "@/components/admin/studio/icons";
import { STUDIO_CANVAS_PATH, isFromCanvas, parseDragPayload, type FromCanvas, type ToCanvas } from "@/components/admin/studio/protocol";
import { useStudioDocument } from "@/components/admin/studio/useStudioDocument";

const DEVICES: ReadonlyArray<{ key: Device; label: string; width: number; icon: typeof Monitor }> = [
  { key: "desktop", label: "Ordenador", width: 1280, icon: Monitor },
  { key: "tablet", label: "Tableta", width: 768, icon: Tablet },
  { key: "mobile", label: "Móvil", width: 390, icon: Smartphone },
];
const MODE_KEY = "elephant-studio-modo";
const CLIPBOARD_KEY = "elephant-studio-portapapeles";
/** Pasos del zoom del lienzo */
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
const ACCENT = "#5b5bf6";

function readMode(): boolean {
  try {
    return window.localStorage.getItem(MODE_KEY) === "pro";
  } catch {
    return false;
  }
}

export default function StudioPage({ slug }: { slug?: string }) {
  const { loading, isAuthenticated } = useAuth();
  const [location] = useLocation();
  if (loading) return <PanelSpinner />;
  if (!isAuthenticated) return <AuthRequired returnTo={location} />;
  return <Studio routeSlug={slug ?? null} />;
}

function Studio({ routeSlug }: { routeSlug: string | null }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const pagesQ = trpc.cms.sitePages.useQuery(undefined, { refetchOnWindowFocus: false });
  const pages = (pagesQ.data ?? []) as SitePage[];
  const homeSlug = pages.find((p) => p.isHome)?.slug ?? null;
  const slug = routeSlug ?? homeSlug;
  const page = pages.find((p) => p.slug === slug);
  // La página se carga por su dirección (una recién creada puede no estar aún en la lista de páginas en caché)
  const doc = useStudioDocument(slug);
  const tokens = trpc.cms.studioTokens.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const subscription = usePanelSubscription();
  const subReady = subscription.mode !== "loading";
  const modules = useMemo(() => (subReady ? availableModules(subscription.can) : availableModules(() => false)), [subReady, subscription.mode, subscription.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const presets = useMemo(() => SECTION_PRESETS.filter((p) => !p.capability || (subReady && subscription.can(p.capability))), [subReady, subscription.mode, subscription.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [pro, setProState] = useState(readMode);
  const wide = typeof window !== "undefined" ? window.innerWidth >= 1100 : true;
  const [leftOpen, setLeftOpen] = useState(wide);
  const [rightOpen, setRightOpen] = useState(wide);
  const [leftTab, setLeftTab] = useState<LeftTab>("add");
  const [inspTab, setInspTab] = useState<InspectorTab>("content");
  /** Zoom del lienzo: null = ajustar al espacio disponible */
  const [zoom, setZoom] = useState<number | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [viewing, setViewing] = useState<{ id: number; label: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [pickImage, setPickImage] = useState<{ id: string; key: string } | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [addAt, setAddAt] = useState<Place | null>(null);
  // Mis diseños: bloques guardados para reutilizar en cualquier página
  const savedQ = trpc.cms.savedBlocks.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const savedBlocks = savedQ.data ?? [];
  const saveBlock = trpc.cms.saveReusableBlock.useMutation({
    onSuccess: (b) => {
      void utils.cms.savedBlocks.invalidate();
      setSaveName(null);
      toast.success(`«${b.name}» guardado en Mis diseños.`);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteSaved = trpc.cms.deleteSavedBlock.useMutation({ onSuccess: () => void utils.cms.savedBlocks.invalidate(), onError: (e) => toast.error(e.message) });
  const [templateKey, setTemplateKey] = useState<PageTemplateKey | null>(null);
  const [chromeOpen, setChromeOpen] = useState(false);
  // Al cambiar el estilo global se vuelve a cargar el lienzo para verlo aplicado
  const [canvasKey, setCanvasKey] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const publish = trpc.cms.publishPage.useMutation();
  const restore = trpc.cms.restorePageVersion.useMutation();
  const discard = trpc.cms.discardPageDraft.useMutation();
  const versionPreview = trpc.cms.pageVersionPreview.useQuery({ slug: slug ?? "", id: viewing?.id ?? 1 }, { enabled: !!viewing && !!slug });

  const setPro = (v: boolean) => {
    setProState(v);
    try {
      window.localStorage.setItem(MODE_KEY, v ? "pro" : "sencillo");
    } catch {
      /* sin almacenamiento: el modo dura lo que la sesión */
    }
  };

  // /admin/studio sin página: se abre la portada
  useEffect(() => {
    if (!routeSlug && homeSlug) navigate(`/admin/studio/${homeSlug}`, { replace: true });
  }, [routeSlug, homeSlug, navigate]);

  const blocks = doc.blocks;
  const found = selectedId ? findBlock(blocks, selectedId) : null;
  const selected = found?.block ?? null;
  const parentSection = found?.parent ? findBlock(blocks, found.parent) : null;
  useEffect(() => {
    if (selectedId && !findBlock(blocks, selectedId)) setSelectedId(null);
  }, [blocks, selectedId]);

  const targets: LinkTarget[] = useMemo(() => {
    const list = pages.map((p) => ({ label: p.isHome ? `${p.title} (portada)` : p.title, url: p.isHome ? "/" : `/${p.slug}` }));
    if (!pages.some((p) => p.slug === "contacto")) list.push({ label: "Formulario de contacto", url: "/contacto" });
    if (modules.some((m) => m.type === "products")) list.push({ label: "Tienda", url: "/tienda" });
    return list;
  }, [pages, modules]);

  // ── Operaciones sobre el documento ──
  // Modo concentrado (los dos paneles ocultos): seleccionar no vuelve a abrir el inspector; se recupera con «Opciones»
  const panelsRef = useRef({ leftOpen, rightOpen });
  panelsRef.current = { leftOpen, rightOpen };
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setInspTab("content");
      if (panelsRef.current.leftOpen || panelsRef.current.rightOpen) setRightOpen(true);
    }
  }, []);
  const focusMode = !leftOpen && !rightOpen;
  const toggleFocus = () => {
    setLeftOpen(focusMode);
    setRightOpen(focusMode);
  };
  /** Abre el inspector del bloque en una pestaña (también desde el modo concentrado) */
  const openInspector = (id: string, tab: InspectorTab) => {
    setSelectedId(id);
    setInspTab(tab);
    setRightOpen(true);
  };

  const tooMany = (adding: number) => {
    if (countBlocks(blocks) + adding <= PAGE_LIMITS.blocks) return false;
    toast.error(`Una página admite hasta ${PAGE_LIMITS.blocks} bloques (también cuentan los de dentro de las columnas).`);
    return true;
  };

  /** Posición en la página del bloque de primer nivel que contiene a `id` (él mismo si está en la página). */
  const topIndex = (id: string): number => {
    let f = findBlock(blocks, id);
    while (f?.parent) f = findBlock(blocks, f.parent);
    return f ? f.index : blocks.length - 1;
  };

  /**
   * Sitio de lo nuevo: el indicado (al soltar), o detrás del bloque seleccionado en su misma lista; si ahí no cabe
   * (un módulo de ancho completo dentro de una columna), detrás de su sección en la página.
   */
  const placeFor = (added: PageBlock[], at?: Place): Place | null => {
    if (at) {
      const problem = placeProblem(blocks, at, added);
      if (problem) {
        toast.error(problem);
        return null;
      }
      return at;
    }
    if (!found) return { parent: null, col: 0, index: blocks.length };
    const after: Place = { parent: found.parent, col: found.col, index: found.index + 1 };
    return placeProblem(blocks, after, added) ? { parent: null, col: 0, index: topIndex(found.block.id) + 1 } : after;
  };

  const insert = (payload: string, at?: Place) => {
    const p = parseDragPayload(payload);
    if (!p || viewing || !doc.loaded) return;
    let added: PageBlock[] = [];
    if (p.what === "module") {
      if (!modules.some((m) => m.type === p.value)) return toast.error("Ese módulo no está disponible en tu plan.");
      added = [p.value === "section" ? createSection() : createBlock(p.value as BlockType)];
    } else if (p.what === "preset") {
      const preset = presets.find((x) => x.key === p.value);
      if (!preset) return;
      added = preset.build();
    } else if (p.what === "saved") {
      const s = savedBlocks.find((x) => x.id === p.value);
      if (!s) return;
      // Todo lo que lleva dentro tiene que estar disponible en el plan (p. ej. productos sin tienda)
      const types = new Set<string>();
      walk([s.block], (f) => types.add(f.block.type));
      if (Array.from(types).some((t) => !modules.some((m) => m.type === t))) return toast.error("Ese bloque usa un módulo que no está disponible en tu plan.");
      added = [duplicateBlock(s.block)];
    } else return;
    if (tooMany(countBlocks(added))) return;
    const place = placeFor(added, at);
    if (!place) return;
    doc.change(insertBlocks(blocks, place, added));
    select(added[0].id);
    markGuide("start");
  };

  /** Plantilla de página completa: sustituye el contenido o se añade al final (un solo paso de deshacer). */
  const applyTemplate = (mode: "replace" | "append") => {
    const key = templateKey;
    setTemplateKey(null);
    if (!key || viewing || !doc.loaded) return;
    const added = templateBlocks(key, page?.title ?? "");
    if (mode === "append" ? tooMany(countBlocks(added)) : countBlocks(added) > PAGE_LIMITS.blocks) return;
    doc.change(mode === "append" ? [...blocks, ...added] : added);
    select(added[0]?.id ?? null);
    markGuide("start");
    toast(`Plantilla «${PAGE_TEMPLATES.find((t) => t.key === key)?.label}» ${mode === "append" ? "añadida al final" : "aplicada"}.`, { action: { label: "Deshacer", onClick: () => doc.undo() } });
  };

  /** Añade un módulo al final de una columna (desde el inspector de la sección). */
  const addToColumn = (sectionId: string, col: number, type: string) => {
    const host = findBlock(blocks, sectionId);
    if (!host || host.block.type !== "section") return;
    insert(`module:${type}`, { parent: sectionId, col, index: host.block.data.columns[col]?.blocks.length ?? 0 });
  };

  const moveTo = (id: string, place: Place) => {
    const f = findBlock(blocks, id);
    if (!f) return;
    const problem = place.parent === null ? null : placeProblem(blocks, place, [f.block]);
    if (problem) return toast.error(problem);
    const next = moveBlock(blocks, id, place);
    if (next !== blocks) doc.change(next);
  };

  const duplicate = (id: string) => {
    const f = findBlock(blocks, id);
    if (!f) return;
    const copy = duplicateBlock(f.block);
    if (tooMany(countBlocks([copy]))) return;
    doc.change(insertBlocks(blocks, { parent: f.parent, col: f.col, index: f.index + 1 }, [copy]));
    select(copy.id);
  };

  const remove = (id: string) => {
    const f = findBlock(blocks, id);
    if (!f) return;
    const host = f.parent ? findBlock(blocks, f.parent) : null;
    const siblings = host?.block.type === "section" ? host.block.data.columns[f.col].blocks : blocks;
    doc.change(removeBlock(blocks, id));
    if (selectedId === id) setSelectedId(siblings[f.index + 1]?.id ?? siblings[f.index - 1]?.id ?? f.parent ?? null);
    toast(`«${blockLabel(f.block.type)}» eliminado`, { action: { label: "Deshacer", onClick: () => doc.undo() } });
  };

  /** Pega el bloque copiado (Ctrl+C), con otro identificador, detrás del seleccionado. */
  const pasteBlock = () => {
    if (!doc.loaded || viewing) return;
    let copied: PageBlock | null = null;
    try {
      copied = JSON.parse(window.localStorage.getItem(CLIPBOARD_KEY) ?? "null");
    } catch {
      copied = null;
    }
    if (!copied || typeof copied !== "object" || !moduleDef(copied.type)) return toast.info("No hay ningún bloque copiado. Selecciona uno y pulsa Ctrl+C.");
    if (!modules.some((m) => m.type === copied!.type)) return toast.error("Ese módulo no está disponible en tu plan.");
    const copy = duplicateBlock(copied);
    if (tooMany(countBlocks([copy]))) return;
    const place = placeFor([copy]);
    if (!place) return;
    doc.change(insertBlocks(blocks, place, [copy]));
    select(copy.id);
    toast.success(`«${blockLabel(copy.type)}» pegado.`);
  };

  const setText = (id: string, key: string, value: string) => {
    doc.updateBlock(id, (b) => ({ ...b, data: writeBlockText(b.data, key, value) }) as PageBlock, `${id}:${key}`);
    markGuide("customize");
  };

  const openPage = async (target: string) => {
    if (target === slug) return;
    await doc.save();
    setSelectedId(null);
    setViewing(null);
    navigate(`/admin/studio/${target}`);
  };

  const onKey = (key: string, ctrl: boolean, shift: boolean) => {
    // Nada se edita hasta que la página está cargada (si no, la carga lo pisaría)
    if (!doc.loaded) return;
    if (ctrl && key === "z") return shift ? doc.redo() : doc.undo();
    if (ctrl && key === "y") return doc.redo();
    if (ctrl && key === ".") return toggleFocus();
    if (ctrl && key === "s") return void doc.save().then((ok) => ok && toast.success("Borrador guardado. Tu web no cambia hasta que publiques."));
    if (viewing) return;
    if (ctrl && key === "d" && selectedId) return duplicate(selectedId);
    if (ctrl && key === "c" && selected) {
      try {
        window.localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(selected));
        toast.success(`«${blockLabel(selected.type)}» copiado. Pégalo con Ctrl+V, también en otra página.`);
      } catch {
        toast.error("No se ha podido copiar el bloque en este navegador.");
      }
      return;
    }
    if (ctrl && key === "v") return pasteBlock();
    if ((key === "delete" || key === "backspace") && selectedId) return remove(selectedId);
    // Esc: de un módulo dentro de una sección, a la sección; si no, nada seleccionado
    if (key === "escape") setSelectedId(selectedId ? (findBlock(blocks, selectedId)?.parent ?? null) : null);
  };

  // ── Mensajes del lienzo (la versión más reciente de cada operación, sin cierres antiguos) ──
  const handlerRef = useRef<(m: FromCanvas) => void>(() => {});
  handlerRef.current = (m: FromCanvas) => {
    switch (m.kind) {
      case "ready":
        setCanvasReady(true);
        break;
      case "select":
        if (!viewing) select(m.id);
        break;
      case "text":
        if (!viewing) setText(m.id, m.key, m.value);
        break;
      case "pickImage":
        if (!viewing && doc.loaded) setPickImage({ id: m.id, key: m.key });
        break;
      case "action":
        if (viewing) break;
        if (m.action === "delete") remove(m.id);
        else if (m.action === "duplicate") duplicate(m.id);
        else if (m.action === "edit" || m.action === "design") openInspector(m.id, m.action === "edit" ? "content" : "design");
        else if (m.action === "save") {
          const f = findBlock(blocks, m.id);
          if (f) {
            setSelectedId(m.id);
            setSaveName(blockLabel(f.block.type));
          }
        } else {
          const f = findBlock(blocks, m.id);
          if (f) moveTo(m.id, { parent: f.parent, col: f.col, index: m.action === "up" ? f.index - 1 : f.index + 2 });
        }
        break;
      case "drop":
        insert(m.payload, { parent: m.parent ?? null, col: m.col ?? 0, index: m.index });
        break;
      case "move":
        if (!viewing) moveTo(m.id, { parent: m.parent ?? null, col: m.col ?? 0, index: m.index });
        break;
      case "addAt":
        if (!viewing && doc.loaded) setAddAt({ index: m.index, parent: m.parent ?? null, col: m.col ?? 0 });
        break;
      case "navigate": {
        const href = m.href.split(/[?#]/)[0];
        const target = href === "/" ? homeSlug : pages.find((p) => `/${p.slug}` === href)?.slug;
        if (target) void openPage(target);
        else if (href) toast.info("Ese enlace lleva a una parte de tu web que no se edita en Elephant Studio.");
        break;
      }
      case "key":
        onKey(m.key, m.ctrl, m.shift);
        break;
    }
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow || !isFromCanvas(e.data)) return;
      handlerRef.current(e.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Atajos de teclado cuando el foco está en el editor (no en un campo)
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Ctrl+S guarda también mientras se escribe en un campo (si no, el navegador abre «Guardar página como»)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        keyRef.current("s", true, e.shiftKey);
        return;
      }
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "") || t?.closest("[role=dialog]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (["delete", "backspace", "escape"].includes(k) || (ctrl && ["z", "y", "s", "d", "c", "v", "."].includes(k) && !(k === "c" && window.getSelection()?.toString()))) {
        e.preventDefault();
        keyRef.current(k, ctrl, e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // El documento al lienzo
  const shownBlocks = viewing ? ((versionPreview.data?.blocks ?? []) as PageBlock[]) : blocks;
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!canvasReady || !win || !doc.loaded) return;
    const msg: ToCanvas & { studio: 1 } = {
      studio: 1,
      kind: "state",
      blocks: shownBlocks,
      selectedId: viewing ? null : selectedId,
      device,
      tokens: (tokens.data ?? {}) as ToCanvas["tokens"],
      pageTitle: page?.title ?? "",
      readOnly: !!viewing,
    };
    win.postMessage(msg, window.location.origin);
  }, [canvasReady, doc.loaded, shownBlocks, selectedId, device, tokens.data, page?.title, viewing]);

  // Cambios sin guardar al cerrar la pestaña; al salir de Studio por el panel, se guardan
  const saveRef = useRef(doc.save);
  saveRef.current = doc.save;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!doc.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [doc.dirty]);
  useEffect(() => () => void saveRef.current(), []);

  // ── Publicación e historial ──
  const doPublish = async () => {
    if (!slug) return;
    try {
      await publish.mutateAsync({ slug, blocks });
      doc.markSaved(false);
      setConfirmPublish(false);
      markGuide("publish");
      const url = page?.isHome ? "/" : `/${slug}`;
      toast.success("Publicado. Ya se ve en tu web.", { action: { label: "Ver", onClick: () => window.open(url, "_blank", "noopener") } });
      // El editor no se recarga (ya tiene lo publicado): solo se actualiza el origen de lo que muestra
      await Promise.all([utils.cms.sitePages.invalidate(), utils.cms.pageVersions.invalidate({ slug }), utils.cms.pageEditor.invalidate({ slug })]);
    } catch (e) {
      toast.error((e as Error).message || "No se ha podido publicar la página");
    }
  };

  const doRestore = async (id: number) => {
    if (!slug) return;
    try {
      const r = await restore.mutateAsync({ slug, id });
      doc.change(r.blocks as PageBlock[]);
      doc.markSaved(true);
      setViewing(null);
      setVersionsOpen(false);
      setConfirmRestore(null);
      setSelectedId(null);
      toast.success("Versión recuperada como borrador. Publica para que se vea en tu web.");
      void utils.cms.sitePages.invalidate();
    } catch (e) {
      toast.error((e as Error).message || "No se ha podido recuperar la versión");
    }
  };

  const doDiscard = async () => {
    if (!slug) return;
    await discard.mutateAsync({ slug });
    setConfirmDiscard(false);
    setSelectedId(null);
    await doc.reload();
    void utils.cms.sitePages.invalidate();
    toast.success("Cambios descartados: vuelves a ver lo que está publicado.");
  };

  const openPreview = async () => {
    if (!slug) return;
    if (!(await doc.save())) return toast.error("Guarda el borrador antes de abrir la vista previa.");
    window.open(`/admin/cms/paginas/vista-previa/${slug}`, "_blank", "noopener");
  };

  // ── Estado de la página ──
  const source = doc.editor.data?.source;
  const pendingPublish = !!page && (doc.dirty || doc.hasDraft || !page.isPublished || source === "converted");
  const status = !page
    ? null
    : doc.status === "saving"
      ? { label: "Guardando…", tone: "muted" as const, icon: Loader2 }
      : doc.status === "error"
        ? { label: "No se ha guardado", tone: "error" as const, icon: CircleAlert }
        : doc.dirty
          ? { label: "Cambios sin guardar", tone: "muted" as const, icon: null }
          : doc.hasDraft
            ? { label: page.isPublished ? "Borrador · sin publicar" : "Borrador guardado", tone: "draft" as const, icon: null }
            : page.isPublished
              ? { label: "Publicada", tone: "ok" as const, icon: Check }
              : { label: "Sin publicar", tone: "muted" as const, icon: null };

  // Datos de la empresa ({{telefono}}…) que usa la página y aún están vacíos
  const missingTokens = useMemo(() => {
    if (!tokens.data) return [];
    const data = tokens.data as Record<string, string | null | undefined>;
    const used = new Set(Array.from(JSON.stringify(blocks).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g), (m) => m[1]));
    return Array.from(used).filter((k) => k in SITE_TOKEN_LABELS && !String(data[k] ?? "").trim()).map((k) => SITE_TOKEN_LABELS[k]);
  }, [blocks, tokens.data]);

  // ── Lienzo: el marco del ancho del dispositivo, reducido si no cabe ──
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 1000, h: 700 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setArea({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dev = DEVICES.find((d) => d.key === device)!;
  const pad = device === "desktop" ? 20 : 28;
  const fitScale = Math.min(1, Math.max(0.3, (area.w - pad * 2) / dev.width));
  const scale = zoom ?? fitScale;
  const overflowX = dev.width * scale > area.w - pad * 2 + 1;
  const stepZoom = (dir: 1 | -1) => {
    const cur = zoom ?? fitScale;
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001);
    if (next) setZoom(next);
  };
  // Franja de controles flotantes (modo concentrado y «Opciones») cuando el inspector está oculto: no tapan la página
  const floatBar = !rightOpen && !viewing;
  const frameH = Math.max(320, area.h - pad * 2 - (viewing ? 52 : 0) - (floatBar ? 40 : 0));

  if (pagesQ.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="font-semibold">No puedes abrir Elephant Studio</p>
          <p className="text-sm text-muted-foreground">{pagesQ.error.data?.code === "FORBIDDEN" ? "Tu cuenta no tiene permiso para editar la web de la empresa." : "No hemos podido cargar las páginas de tu web. Inténtalo de nuevo."}</p>
          <Button variant="outline" asChild>
            <Link href="/admin">Volver al panel</Link>
          </Button>
        </div>
      </div>
    );
  }

  const notFound = !!pagesQ.data && !pagesQ.isFetching && !!routeSlug && !page && doc.editor.data === null;
  const ModuleIcon = selected ? moduleIcon(moduleDef(selected.type)?.icon) : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">
      {/* ── Barra superior ── */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:px-3">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild title="Volver a las páginas">
          <Link href="/admin/cms/paginas" aria-label="Volver a las páginas">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="hidden shrink-0 items-center gap-2 pr-1 md:flex">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, #8b5cf6)` }} aria-hidden>
            S
          </span>
          <span className="hidden text-sm font-semibold tracking-tight xl:inline">Elephant Studio</span>
        </div>
        <span className="hidden h-6 w-px bg-border md:block" aria-hidden />
        <Button variant="ghost" size="icon" className={cn("h-9 w-9 shrink-0", leftOpen && "bg-muted")} onClick={() => setLeftOpen((v) => !v)} aria-label={leftOpen ? "Ocultar panel izquierdo" : "Mostrar panel izquierdo"} title="Panel izquierdo">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 min-w-0 max-w-[150px] gap-1.5 px-2.5 lg:max-w-[220px]">
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{page?.title ?? "Página"}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70vh] w-64 overflow-y-auto">
            <DropdownMenuLabel>Páginas de tu web</DropdownMenuLabel>
            {pages.map((p) => (
              <DropdownMenuItem key={p.slug} onSelect={() => void openPage(p.slug)} className="gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", !p.isPublished ? "bg-slate-300" : p.hasDraft ? "bg-amber-400" : "bg-emerald-500")} aria-hidden />
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{p.title}</span>
                {p.isHome && <span className="text-[11px] text-muted-foreground">Portada</span>}
                {p.slug === slug && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin/cms/paginas">Gestionar páginas</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {status && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-1 text-[11px] font-medium lg:px-2 lg:py-0.5",
              status.tone === "ok" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
              status.tone === "draft" && "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
              status.tone === "error" && "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
              status.tone === "muted" && "bg-muted text-muted-foreground",
            )}
            title={doc.error ?? (doc.savedAt ? `Borrador guardado a las ${doc.savedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : undefined)}
            role="status"
          >
            {status.icon ? <status.icon className={cn("h-3 w-3", status.icon === Loader2 && "animate-spin")} /> : <span className="h-2 w-2 rounded-full bg-current lg:hidden" aria-hidden />}
            <span className="sr-only lg:not-sr-only">{status.label}</span>
          </span>
        )}
        {doc.status === "error" && (
          <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => void doc.save().then((ok) => ok && toast.success("Borrador guardado"))} title={doc.error ?? undefined}>
            Reintentar
          </Button>
        )}

        <div className="flex flex-1 items-center justify-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={doc.undo} disabled={!doc.canUndo || !!viewing} aria-label="Deshacer" title="Deshacer (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={doc.redo} disabled={!doc.canRedo || !!viewing} aria-label="Rehacer" title="Rehacer (Ctrl+Mayús+Z)">
            <Redo2 className="h-4 w-4" />
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Dispositivo">
            {DEVICES.map((d) => (
              <button
                key={d.key}
                type="button"
                role="radio"
                aria-checked={device === d.key}
                aria-label={d.label}
                title={`${d.label} (${d.width} px)`}
                onClick={() => {
                  setDevice(d.key);
                  if (d.key === "mobile") markGuide("mobile");
                }}
                className={cn("rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6]", device === d.key ? "bg-[#5b5bf6]/20 text-foreground shadow-sm ring-1 ring-inset ring-[#5b5bf6]/50" : "text-muted-foreground hover:text-foreground")}
              >
                <d.icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div className="ml-1 hidden items-center rounded-lg bg-muted p-0.5 md:flex" role="group" aria-label="Zoom del lienzo">
            <button type="button" onClick={() => stepZoom(-1)} disabled={scale <= ZOOM_STEPS[0] + 0.001} className="rounded-md px-1.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Alejar" title="Alejar">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(null)}
              className={cn("min-w-[52px] rounded-md px-1.5 py-1 text-xs font-medium tabular-nums", zoom === null ? "bg-[#5b5bf6]/20 text-foreground shadow-sm ring-1 ring-inset ring-[#5b5bf6]/50" : "text-muted-foreground hover:text-foreground")}
              title="Ajustar al espacio disponible"
              aria-label={`Zoom ${Math.round(scale * 100)} %. Pulsa para ajustar`}
            >
              {zoom === null ? "Ajustar" : `${Math.round(scale * 100)} %`}
            </button>
            <button type="button" onClick={() => stepZoom(1)} disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001} className="rounded-md px-1.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Acercar" title="Acercar">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 md:inline-flex"
            onClick={toggleFocus}
            aria-pressed={focusMode}
            aria-label={focusMode ? "Salir del modo concentrado y mostrar los paneles (Ctrl + .)" : "Modo concentrado: ampliar el lienzo ocultando los paneles (Ctrl + .)"}
            title={focusMode ? "Mostrar los paneles (Ctrl + .)" : "Modo concentrado: solo la página (Ctrl + .)"}
          >
            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>

        <div className="hidden items-center rounded-lg bg-muted p-0.5 lg:flex" role="radiogroup" aria-label="Modo de edición">
          {[
            { v: false, label: "Sencillo" },
            { v: true, label: "Profesional" },
          ].map((m) => (
            <button
              key={m.label}
              type="button"
              role="radio"
              aria-checked={pro === m.v}
              title={m.v ? "Diseño avanzado, móvil, animaciones, anclas y opciones avanzadas de cada módulo" : "Lo esencial: textos, imágenes, botones y diseño básico"}
              onClick={() => {
                if (pro === m.v) return;
                setPro(m.v);
                toast(m.v ? "Modo profesional: diseño avanzado y pestaña «Avanzado» en el inspector." : "Modo sencillo: lo esencial para editar el contenido de tu web.");
              }}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6]", pro === m.v ? "bg-[#5b5bf6]/20 text-foreground shadow-sm ring-1 ring-inset ring-[#5b5bf6]/50" : "text-muted-foreground hover:text-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setVersionsOpen(true)} aria-label="Historial de versiones" title="Historial de versiones">
          <History className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Más opciones">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {page?.isPublished && (
              <DropdownMenuItem onSelect={() => window.open(page.isHome ? "/" : `/${page.slug}`, "_blank", "noopener")}>
                <ExternalLink className="mr-2 h-4 w-4" /> Ver la página publicada
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="lg:hidden" onSelect={() => setPro(!pro)}>
              {pro ? "Pasar al modo sencillo" : "Pasar al modo profesional"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                reopenGuide();
                setLeftOpen(true);
                setLeftTab("add");
              }}
            >
              <LifeBuoy className="mr-2 h-4 w-4" /> Ayuda: primeros pasos
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcuts(true)}>
              <Keyboard className="mr-2 h-4 w-4" /> Atajos de teclado
            </DropdownMenuItem>
            {page?.isPublished && doc.hasDraft && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDiscard(true)}>
                  Descartar los cambios sin publicar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="hidden h-9 sm:inline-flex" onClick={openPreview} disabled={!page} aria-label="Vista previa" title="Vista previa del borrador">
          <Eye className="h-4 w-4 xl:mr-1.5" /> <span className="hidden xl:inline">Vista previa</span>
        </Button>
        <Button
          size="sm"
          className="h-9 text-white hover:opacity-90"
          style={{ background: ACCENT }}
          onClick={() => setConfirmPublish(true)}
          disabled={!page || !!viewing || !pendingPublish || publish.isPending}
          title={viewing ? "Vuelve a tu borrador para publicar" : !pendingPublish ? "No hay cambios pendientes: tu web ya muestra esta versión" : "Publicar los cambios en tu web"}
        >
          <Upload className="mr-1.5 h-4 w-4" /> Publicar
        </Button>
        <Button variant="ghost" size="icon" className={cn("h-9 w-9 shrink-0", rightOpen && "bg-muted")} onClick={() => setRightOpen((v) => !v)} aria-label={rightOpen ? "Ocultar inspector" : "Mostrar inspector"} title="Inspector">
          <PanelRight className="h-4 w-4" />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ── Panel izquierdo ── */}
        {leftOpen && (
          <aside className="absolute inset-y-0 left-0 z-30 w-[272px] shrink-0 border-r border-border bg-background shadow-xl duration-200 animate-in fade-in slide-in-from-left-3 motion-reduce:animate-none lg:static lg:shadow-none" aria-label="Biblioteca y estructura">
            <LeftPanel
              tab={leftTab}
              onTab={setLeftTab}
              modules={modules}
              presets={presets}
              onInsert={(p) => insert(p)}
              savedBlocks={savedBlocks}
              onDeleteSaved={(id) => deleteSaved.mutate({ id })}
              onTemplate={(key) => setTemplateKey(key)}
              blocks={blocks}
              selectedId={selectedId}
              device={device}
              onSelect={(id) => select(id)}
              onMove={(id, index) => moveTo(id, { parent: null, col: 0, index })}
              onDuplicate={duplicate}
              onDelete={remove}
              pages={pages}
              currentSlug={slug ?? ""}
              onOpenPage={(s) => void openPage(s)}
              onGlobalStyle={() => setGlobalOpen(true)}
              onSiteChrome={() => setChromeOpen(true)}
              guide={
                !viewing && (
                  <GuideCard
                    onTemplates={() => revealLibraryGroup("templates")}
                    onBlank={() => setAddAt({ index: blocks.length, parent: null, col: 0 })}
                    onColors={() => setGlobalOpen(true)}
                    onMobile={() => {
                      setDevice("mobile");
                      markGuide("mobile");
                    }}
                  />
                )
              }
            />
          </aside>
        )}

        {/* ── Lienzo ── */}
        <main
          ref={areaRef}
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{ backgroundColor: "var(--muted)", backgroundImage: "radial-gradient(rgba(100,116,139,0.18) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
          aria-label="Lienzo"
        >
          {viewing && (
            <div className="absolute inset-x-0 top-0 z-10 flex h-[52px] items-center justify-between gap-3 border-b border-[#5b5bf6]/30 bg-[#5b5bf6]/10 px-4 text-sm backdrop-blur">
              <span className="min-w-0">
                Estás viendo la <strong>{viewing.label}</strong>. No se puede editar; recupérala para seguir trabajando con ella.
              </span>
              <span className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" className="h-8 bg-background" onClick={() => setViewing(null)}>
                  <X className="mr-1 h-3.5 w-3.5" /> Volver a mi borrador
                </Button>
                <Button size="sm" className="h-8 text-white" style={{ background: ACCENT }} onClick={() => setConfirmRestore(viewing.id)}>
                  Recuperar esta versión
                </Button>
              </span>
            </div>
          )}
          {notFound ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div className="space-y-3">
                <p className="font-semibold">No se ha encontrado la página</p>
                <Button variant="outline" asChild>
                  <Link href="/admin/studio">Abrir la portada</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className={cn("absolute inset-0 flex overflow-auto", overflowX ? "justify-start" : "justify-center")} style={{ paddingTop: pad + (viewing ? 52 : 0) + (floatBar ? 40 : 0), paddingLeft: pad, paddingRight: pad, paddingBottom: zoom ? pad : 0 }}>
              <div
                className={cn("relative shrink-0 overflow-hidden bg-white shadow-[0_8px_40px_rgba(15,23,42,0.18)]", device === "desktop" ? "rounded-lg" : "rounded-[28px] ring-8 ring-slate-900/90")}
                style={{ width: dev.width * scale, height: frameH }}
              >
                <iframe
                  key={canvasKey}
                  ref={iframeRef}
                  src={STUDIO_CANVAS_PATH}
                  title={`Lienzo de ${page?.title ?? "la página"}`}
                  className="absolute left-0 top-0 border-0 bg-white"
                  style={{ width: dev.width, height: frameH / scale, transform: `scale(${scale})`, transformOrigin: "top left" }}
                />
                {(!doc.loaded || !canvasReady) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white" role="status" aria-label="Cargando la página">
                    <Loader2 className="h-7 w-7 animate-spin" style={{ color: ACCENT }} />
                  </div>
                )}
              </div>
            </div>
          )}
          {floatBar && (
            <div className="pointer-events-none absolute inset-x-3 top-2.5 z-20 flex items-start justify-between gap-2">
              {focusMode ? (
                <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-background py-1 pl-3 pr-1 text-xs shadow-md duration-200 animate-in fade-in">
                  <span className="font-medium">Modo concentrado</span>
                  <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-xs" onClick={toggleFocus} title="Ctrl + .">
                    <Minimize2 className="mr-1 h-3.5 w-3.5" /> Mostrar los paneles
                  </Button>
                </div>
              ) : (
                <span />
              )}
              {selected && !rightOpen && (
                <Button size="sm" variant="outline" className="pointer-events-auto h-8 rounded-full bg-background shadow-md duration-200 animate-in fade-in" onClick={() => openInspector(selected.id, inspTab)}>
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" style={{ color: ACCENT }} /> Opciones de «{blockLabel(selected.type)}»
                </Button>
              )}
            </div>
          )}
          {doc.loaded && source === "converted" && !viewing && (
            <p role="note" className="absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-center text-xs text-sky-900 shadow-sm dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
              Hemos preparado esta página en bloques con todo su contenido. Tu web sigue mostrando la versión actual hasta que publiques.
            </p>
          )}
        </main>

        {/* ── Inspector ── */}
        {rightOpen && (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-[300px] shrink-0 flex-col border-l border-border bg-background shadow-xl duration-200 animate-in fade-in slide-in-from-right-3 motion-reduce:animate-none lg:static lg:shadow-none 2xl:w-[320px]" aria-label="Inspector">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              {selected && ModuleIcon ? (
                <>
                  <ModuleIcon className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
                  <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label="Dónde estás">
                    <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground hover:underline" onClick={() => setSelectedId(null)}>
                      {page?.title ?? "Página"}
                    </button>
                    <span className="text-muted-foreground">›</span>
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">{blockLabel(selected.type)}</span>
                  </nav>
                  <button
                    type="button"
                    onClick={() => setSaveName(blockLabel(selected.type))}
                    disabled={!!viewing}
                    className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    title="Guardar en Mis diseños para reutilizarlo en otras páginas"
                    aria-label="Guardar en Mis diseños"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                  </button>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {found ? found.index + 1 : 0} de {parentSection?.block.type === "section" ? (parentSection.block.data.columns[found!.col]?.blocks.length ?? 0) : blocks.length}
                  </span>
                </>
              ) : (
                <span className="text-sm font-medium">Ajustes de la página</span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {viewing ? (
                <p className="text-sm text-muted-foreground">Mientras ves una versión anterior no se puede editar.</p>
              ) : selected ? (
                <BlockInspector
                  key={selected.id}
                  block={selected}
                  update={(fn, k) => doc.updateBlock(selected.id, fn, k)}
                  targets={targets}
                  pro={pro}
                  tab={inspTab}
                  onTab={setInspTab}
                  columnModules={modules.filter((m) => nestable(m.type) && (m.type !== "section" || (found?.depth ?? 0) === 0))}
                  onAddToColumn={(col, type) => addToColumn(selected.id, col, type)}
                  onSelectBlock={select}
                  inside={parentSection && found ? { id: parentSection.block.id, col: found.col } : null}
                />
              ) : page ? (
                <div className="space-y-5">
                  <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
                    <p className="text-sm font-medium">No hay nada seleccionado</p>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                      <li><span className="font-medium text-foreground">Clic</span> en un bloque para ver sus opciones aquí.</li>
                      <li><span className="font-medium text-foreground">Doble clic</span> en un texto para escribir sobre la página.</li>
                      <li><span className="font-medium text-foreground">Arrastra</span> módulos desde la biblioteca, o pulsa «+» bajo cualquier bloque.</li>
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-[#5b5bf6] text-white hover:bg-[#4a4ae0]"
                        onClick={() => setAddAt({ parent: null, col: 0, index: blocks.length })}
                      >
                        Añadir un bloque
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setLeftOpen(true);
                          setLeftTab("site");
                        }}
                      >
                        Páginas y ajustes
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ajustes de esta página</p>
                  {missingTokens.length > 0 && (
                    <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
                      Esta página usa datos de tu empresa que aún no has rellenado ({missingTokens.join(", ").toLowerCase()}). Si falta alguno, esa línea no se
                      muestra en tu web hasta que lo completes en{" "}
                      <Link href="/admin/configuracion/sitio"className="font-medium underline underline-offset-2">
                        Datos de la empresa
                      </Link>
                      .
                    </p>
                  )}
                  <PageSettings page={page} pages={pages} beforeSave={doc.save} onSaved={(s) => (s !== slug ? navigate(`/admin/studio/${s}`) : void utils.cms.sitePages.invalidate())} />
                </div>
              ) : null}
            </div>
          </aside>
        )}
      </div>

      {slug && (
        <VersionsPanel
          slug={slug}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          viewingId={viewing?.id ?? null}
          onView={(id, label) => {
            setViewing({ id, label });
            setSelectedId(null);
            setVersionsOpen(false);
          }}
          onRestore={(id) => setConfirmRestore(id)}
          restoring={restore.isPending}
        />
      )}

      <AlertDialog open={!!templateKey} onOpenChange={(o) => !o && setTemplateKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usar la plantilla «{PAGE_TEMPLATES.find((t) => t.key === templateKey)?.label}»</AlertDialogTitle>
            <AlertDialogDescription>
              {blocks.length
                ? "Puedes sustituir lo que tiene esta página o añadir la plantilla al final. Se guarda como borrador: tu web no cambia hasta que publiques, y puedes deshacerlo."
                : "Se añade a la página como borrador: tu web no cambia hasta que publiques."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {templateKey && (
            <div className="overflow-hidden rounded-lg border border-border">
              <RealPreview blocks={templateBlocks(templateKey, page?.title ?? "")} width={462} maxHeight={300} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {blocks.length > 0 && (
              <Button variant="outline" onClick={() => applyTemplate("append")}>
                Añadir al final
              </Button>
            )}
            <AlertDialogAction onClick={() => applyTemplate("replace")}>{blocks.length ? "Sustituir la página" : "Usar la plantilla"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar «{page?.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Los cambios se verán en tu web en cuanto publiques. Guardamos esta publicación en el historial para que puedas volver a cualquier versión anterior.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              disabled={publish.isPending}
              className="text-white"
              style={{ background: ACCENT }}
              onClick={(e) => {
                e.preventDefault();
                void doPublish();
              }}
            >
              {publish.isPending ? "Publicando…" : "Publicar ahora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRestore !== null} onOpenChange={(v) => !v && setConfirmRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Recuperar esta versión?</AlertDialogTitle>
            <AlertDialogDescription>
              Sustituye a lo que tienes ahora en el editor y se guarda como borrador. Tu web no cambia hasta que publiques. Si te arrepientes, pulsa «Deshacer».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmRestore !== null) void doRestore(confirmRestore);
              }}
            >
              Recuperar como borrador
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios sin publicar?</AlertDialogTitle>
            <AlertDialogDescription>Se borra el borrador y vuelves a ver lo que está publicado en tu web. Las versiones del historial no se tocan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void doDiscard()}>
              Descartar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={globalOpen} onOpenChange={setGlobalOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Estilo global de tu web</SheetTitle>
            <SheetDescription>Colores, tipografía, bordes y logotipo de toda tu web. Cada bloque puede tener además su propio fondo en «Diseño».</SheetDescription>
          </SheetHeader>
          <p role="note" className="mx-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
            Atención: este estilo es común a todas las páginas. Al pulsar «Guardar» se aplica al momento en toda tu web publicada y en la pantalla de acceso de tu equipo; no espera a «Publicar».
          </p>
          <div className="px-4 pb-6">
            <BrandIdentityEditor
              variant="full"
              onSaved={() => {
                setCanvasReady(false);
                setCanvasKey((k) => k + 1);
                toast.success("Estilo global guardado: ya se ve en toda tu web.");
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={chromeOpen} onOpenChange={setChromeOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Cabecera y pie de tu web</SheetTitle>
            <SheetDescription>El botón destacado, los menús y el pie que se ven en todas las páginas.</SheetDescription>
          </SheetHeader>
          <p role="note" className="mx-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">
            Atención: la cabecera y el pie son comunes a todas las páginas. Los cambios se aplican al momento en tu web publicada; no esperan a «Publicar».
          </p>
          <div className="px-4">
            <SiteChromeEditor
              targets={targets}
              onChanged={() => {
                setCanvasReady(false);
                setCanvasKey((k) => k + 1);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <QuickInsert
        open={!!addAt}
        where={!addAt ? "" : addAt.parent ? `en la columna ${addAt.col + 1}` : addAt.index >= blocks.length ? "al final de la página" : "en la página"}
        modules={addAt?.parent ? modules.filter((m) => !NOT_NESTABLE.includes(m.type) && m.type !== "section") : modules}
        saved={savedBlocks}
        onClose={() => setAddAt(null)}
        onPick={(payload) => {
          const at = addAt;
          setAddAt(null);
          if (at) insert(payload, at);
        }}
      />

      <Dialog open={saveName !== null} onOpenChange={(o) => !o && setSaveName(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Guardar en Mis diseños</DialogTitle>
            <DialogDescription>Lo encontrarás en la biblioteca para añadir una copia, con su diseño, en cualquier página.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selected || !saveName?.trim()) return;
              saveBlock.mutate({ name: saveName.trim(), block: selected });
            }}
          >
            <Input value={saveName ?? ""} maxLength={60} onChange={(e) => setSaveName(e.target.value)} aria-label="Nombre del bloque" autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSaveName(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!saveName?.trim() || saveBlock.isPending}>
                {saveBlock.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <MediaLibraryDialog
        open={!!pickImage}
        current={pickImage ? (readBlockText(findBlock(blocks, pickImage.id)?.block.data, pickImage.key) ?? "") : ""}
        onClose={() => setPickImage(null)}
        onConfirm={(url) => {
          if (pickImage) setText(pickImage.id, pickImage.key, siteRelativeFileUrl(url));
          setPickImage(null);
        }}
      />

      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Atajos de teclado</DialogTitle>
            <DialogDescription>Funcionan cuando no estás escribiendo en un campo.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {[
              ["Ctrl + Z", "Deshacer"],
              ["Ctrl + Mayús + Z", "Rehacer"],
              ["Ctrl + S", "Guardar el borrador"],
              ["Ctrl + D", "Duplicar el bloque"],
              ["Ctrl + C / Ctrl + V", "Copiar y pegar un bloque (también entre páginas)"],
              ["Supr", "Eliminar el bloque"],
              ["Ctrl + .", "Modo concentrado: ocultar o mostrar los paneles"],
              ["Esc", "Quitar la selección"],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                </dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
