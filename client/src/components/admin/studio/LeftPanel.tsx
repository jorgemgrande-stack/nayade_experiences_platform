/**
 * Elephant Studio — panel izquierdo:
 *   - Añadir: la biblioteca en cuatro grupos plegables (plantillas completas, secciones prediseñadas por categoría,
 *     elementos y Mis diseños) con un buscador común; solo lo que permite la licencia. Se arrastra al lienzo o se añade
 *     con un clic (detrás del bloque seleccionado).
 *   - Estructura: los bloques de la página en orden; se seleccionan, se reordenan arrastrando, se duplican y se quitan.
 *     Lo que va dentro de una sección con columnas se ve debajo de ella, columna a columna.
 *   - Sitio: las páginas de la web y los ajustes globales (menús, marca, blog, multimedia).
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Copy, EyeOff, FileText, GripVertical, Home, Image as ImageIcon, Newspaper, Palette, PanelsTopLeft, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { blockLabel, createBlock, PAGE_TEMPLATES, templateBlocks, type Device, type PageBlock, type PageTemplateKey } from "@shared/pageBlocks";
import { LIBRARY_ELEMENTS, LIBRARY_SECTIONS, SECTION_PRESETS, libraryMatch, moduleDef, type ModuleDef, type SectionPreset } from "@shared/studio/modules";
import { blockSummary } from "@/components/admin/pageBuilder/BlockEditors";
import { moduleIcon } from "./icons";
import { BlockThumb } from "./BlockThumb";
import { RealPreview } from "./RealPreview";
import { DRAG_MIME } from "./protocol";
import type { SitePage } from "./PageSettings";

export type LeftTab = "add" | "structure" | "site";

function startDrag(e: React.DragEvent, payload: string) {
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.setData(DRAG_MIME, payload);
  e.dataTransfer.setData("text/plain", payload);
}

export function LeftPanel(props: {
  tab: LeftTab;
  onTab: (t: LeftTab) => void;
  modules: ModuleDef[];
  presets: typeof SECTION_PRESETS;
  onInsert: (payload: string) => void;
  /** Mis diseños: bloques guardados para reutilizar (se inserta una copia) */
  savedBlocks: Array<{ id: string; name: string; block: PageBlock }>;
  onDeleteSaved: (id: string) => void;
  /** Elegir una plantilla de página completa (el editor pregunta si sustituye o añade) */
  onTemplate: (key: PageTemplateKey) => void;
  blocks: PageBlock[];
  selectedId: string | null;
  device: Device;
  onSelect: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  pages: SitePage[];
  currentSlug: string;
  onOpenPage: (slug: string) => void;
  onGlobalStyle: () => void;
  onSiteChrome: () => void;
}) {
  const tabs: Array<{ key: LeftTab; label: string }> = [
    { key: "add", label: "Añadir" },
    { key: "structure", label: "Estructura" },
    { key: "site", label: "Sitio" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-3 gap-1 border-b border-border p-2" role="tablist" aria-label="Panel">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={props.tab === t.key}
            onClick={() => props.onTab(t.key)}
            className={cn("rounded-md px-2 py-1.5 text-xs font-semibold transition-colors", props.tab === t.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.tab === "add" && <Library modules={props.modules} presets={props.presets} onInsert={props.onInsert} onTemplate={props.onTemplate} saved={props.savedBlocks} onDeleteSaved={props.onDeleteSaved} pageEmpty={!props.blocks.length} />}
        {props.tab === "structure" && <Structure {...props} />}
        {props.tab === "site" && <Site pages={props.pages} currentSlug={props.currentSlug} onOpenPage={props.onOpenPage} onGlobalStyle={props.onGlobalStyle} onSiteChrome={props.onSiteChrome} />}
      </div>
    </div>
  );
}

/**
 * Vista previa al pasar por encima de un elemento de la biblioteca (a la derecha del panel): el resultado REAL, con
 * los colores, la tipografía y los datos de la web de la empresa.
 */
function Preview({ blocks, title, description, children }: { blocks: PageBlock[]; title: string; description?: string; children: React.ReactElement }) {
  return (
    <HoverCard openDelay={300} closeDelay={60}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12} collisionPadding={12} className="w-96 space-y-2 p-3">
        <RealPreview blocks={blocks} width={358} maxHeight={blocks.length > 1 ? 460 : 300} />
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Plantillas de página completa (las mismas que al crear una página, salvo «En blanco»). */
const FULL_TEMPLATES = PAGE_TEMPLATES.filter((t) => t.key !== "blank");

type GroupKey = "templates" | "sections" | "elements" | "saved";
const GROUPS: ReadonlyArray<{ key: GroupKey; label: string; hint: string }> = [
  { key: "templates", label: "Plantillas completas", hint: "Páginas enteras listas para adaptar" },
  { key: "sections", label: "Secciones prediseñadas", hint: "Portadas, servicios, galerías, opiniones, precios…" },
  { key: "elements", label: "Elementos", hint: "Texto, imagen, botón, vídeo, formulario…" },
  { key: "saved", label: "Mis diseños", hint: "Lo que has guardado para reutilizar" },
];
/** Qué grupos tiene plegados cada persona (solo en su navegador). */
const OPEN_KEY = "elephant-studio-biblioteca";
function readOpen(): Partial<Record<GroupKey, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

const tileClass =
  "group flex flex-col items-stretch gap-1.5 rounded-lg border border-border bg-background p-1.5 text-left transition-all hover:-translate-y-px hover:border-[#5b5bf6]/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6]";

function Group({ id, label, hint, count, open, onToggle, children }: { id: GroupKey; label: string; hint: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`biblioteca-${id}`}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5b5bf6]"
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          {!open && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{hint}</span>}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground" aria-label={`${count} disponibles`}>
          {count}
        </span>
      </button>
      {open && (
        <div id={`biblioteca-${id}`} className="space-y-4 px-3 pb-4 pt-1">
          {children}
        </div>
      )}
    </section>
  );
}

function Library({
  modules, presets, onInsert, onTemplate, saved, onDeleteSaved, pageEmpty,
}: {
  modules: ModuleDef[];
  presets: typeof SECTION_PRESETS;
  onInsert: (payload: string) => void;
  onTemplate: (key: PageTemplateKey) => void;
  saved: Array<{ id: string; name: string; block: PageBlock }>;
  onDeleteSaved: (id: string) => void;
  /** Con la página vacía, las plantillas se ofrecen desplegadas */
  pageEmpty: boolean;
}) {
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openState, setOpenState] = useState(readOpen);
  const searching = !!q.trim();
  const isOpen = (k: GroupKey) => searching || (openState[k] ?? (k === "templates" ? pageEmpty : true));
  const toggle = (k: GroupKey) => {
    const next = { ...openState, [k]: !isOpen(k) };
    setOpenState(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* sin almacenamiento: se pliega solo en esta sesión */
    }
  };
  // Bloques de ejemplo para las miniaturas (se construyen una vez; no se insertan)
  const moduleSamples = useMemo(() => new Map(modules.map((m) => [m.type, [createBlock(m.type)] as PageBlock[]])), [modules]);
  const presetSamples = useMemo(() => new Map(presets.map((p) => [p.key, p.build()])), [presets]);
  const templateSamples = useMemo(() => new Map(FULL_TEMPLATES.map((t) => [t.key, templateBlocks(t.key, t.label)])), []);

  const byType = useMemo(() => new Map(modules.map((m) => [m.type, m])), [modules]);
  const byPreset = useMemo(() => new Map(presets.map((p) => [p.key, p])), [presets]);
  const matchModule = (m: ModuleDef) => libraryMatch(q, m.label, m.description, m.keywords);
  const templates = FULL_TEMPLATES.filter((t) => libraryMatch(q, t.label, t.description, "plantilla pagina"));
  const categories = LIBRARY_SECTIONS.map((c) => ({
    ...c,
    presetList: c.presets.map((k) => byPreset.get(k)).filter((p): p is SectionPreset => !!p && libraryMatch(q, p.label, p.description, c.label)),
    moduleList: c.types.map((t) => byType.get(t)).filter((m): m is ModuleDef => !!m && (matchModule(m) || libraryMatch(q, c.label))),
  })).filter((c) => c.presetList.length + c.moduleList.length > 0);
  const elements = LIBRARY_ELEMENTS.map((t) => byType.get(t)).filter((m): m is ModuleDef => !!m && matchModule(m));
  const savedList = saved.filter((s) => libraryMatch(q, s.name, blockLabel(s.block.type)));
  const counts: Record<GroupKey, number> = {
    templates: templates.length,
    sections: categories.reduce((n, c) => n + c.presetList.length + c.moduleList.length, 0),
    elements: elements.length,
    saved: savedList.length,
  };
  const nothing = searching && Object.values(counts).every((n) => n === 0);

  const sectionTile = (key: string, label: string, blocks: PageBlock[], payload: string, description: string, sub?: string) => (
    <Preview key={key} blocks={blocks} title={label} description={`${description}. Arrástrala a la página o haz clic para añadirla.`}>
      <button type="button" draggable onDragStart={(e) => startDrag(e, payload)} onClick={() => onInsert(payload)} aria-label={`${label}: ${description}`} className={cn(tileClass, "cursor-grab active:cursor-grabbing")}>
        <BlockThumb blocks={blocks} width={106} ratio={16 / 10} />
        <span className="px-0.5 text-xs font-medium leading-tight">{label}</span>
        {sub && <span className="-mt-1 px-0.5 text-[11px] leading-tight text-muted-foreground">{sub}</span>}
      </button>
    </Preview>
  );

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border bg-background p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: foto, precios, contacto…" aria-label="Buscar en la biblioteca" className="h-9 pl-8" />
        </div>
      </div>
      {nothing && <p className="p-4 text-sm text-muted-foreground">Nada coincide con «{q}». Prueba con otra palabra, como «foto», «precio» o «contacto».</p>}
      {GROUPS.map((g) => {
        if (searching && counts[g.key] === 0) return null;
        return (
          <Group key={g.key} id={g.key} label={g.label} hint={g.hint} count={counts[g.key]} open={isOpen(g.key)} onToggle={() => toggle(g.key)}>
            {g.key === "templates" && (
              <>
                <p className="text-xs leading-relaxed text-muted-foreground">Al elegir una, decides si sustituye la página o se añade al final.</p>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((t) => (
                    <Preview key={t.key} blocks={templateSamples.get(t.key) ?? []} title={t.label} description={t.description}>
                      <button type="button" onClick={() => onTemplate(t.key)} aria-label={`Plantilla ${t.label}: ${t.description}`} className={tileClass}>
                        <BlockThumb blocks={templateSamples.get(t.key) ?? []} width={106} ratio={3 / 4} />
                        <span className="px-0.5 text-xs font-medium leading-tight">{t.label}</span>
                      </button>
                    </Preview>
                  ))}
                </div>
              </>
            )}
            {g.key === "sections" &&
              categories.map((c) => (
                <div key={c.key} className="space-y-2">
                  <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {c.presetList.map((p) => {
                      const blocks = presetSamples.get(p.key) ?? [];
                      return sectionTile(p.key, p.label, blocks, `preset:${p.key}`, p.description, blocks.length > 1 ? `${blocks.length} bloques combinados` : undefined);
                    })}
                    {c.moduleList.map((m) => sectionTile(m.type, m.label, moduleSamples.get(m.type) ?? [], `module:${m.type}`, m.description))}
                  </div>
                </div>
              ))}
            {g.key === "elements" && (
              <div className="grid grid-cols-3 gap-1.5">
                {elements.map((m) => {
                  const Icon = moduleIcon(m.icon);
                  return (
                    <Preview key={m.type} blocks={moduleSamples.get(m.type) ?? []} title={m.label} description={`${m.description}. Arrástralo a la página o haz clic para añadirlo.`}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => startDrag(e, `module:${m.type}`)}
                        onClick={() => onInsert(`module:${m.type}`)}
                        aria-label={`${m.label}: ${m.description}`}
                        className={cn(tileClass, "cursor-grab items-center gap-1 px-1 py-2 text-center active:cursor-grabbing")}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-[#5b5bf6]/10 group-hover:text-[#5b5bf6]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-[11px] font-medium leading-tight">{m.label}</span>
                      </button>
                    </Preview>
                  );
                })}
              </div>
            )}
            {g.key === "saved" &&
              (saved.length === 0 ? (
                <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  Guarda aquí un bloque o una sección con su diseño para reutilizarlo en cualquier página: selecciónalo y pulsa «Guardar en Mis diseños» en el panel derecho.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {savedList.map((s) => (
                    <div key={s.id} className="flex items-center gap-1 rounded-lg border border-border bg-background pr-1 transition-colors hover:border-[#5b5bf6]/60">
                      <Preview blocks={[s.block]} title={s.name} description={`${blockLabel(s.block.type)} con su diseño. Arrástralo a la página o haz clic para añadir una copia.`}>
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => startDrag(e, `saved:${s.id}`)}
                          onClick={() => onInsert(`saved:${s.id}`)}
                          className="flex min-w-0 flex-1 cursor-grab items-center gap-2.5 rounded-lg px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b5bf6] active:cursor-grabbing"
                        >
                          <BlockThumb blocks={[s.block]} width={56} ratio={16 / 10} />
                          <span className="min-w-0">
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{s.name}</span>
                            <span className="block text-xs text-muted-foreground">{blockLabel(s.block.type)}</span>
                          </span>
                        </button>
                      </Preview>
                      {confirmDelete === s.id ? (
                        <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => (onDeleteSaved(s.id), setConfirmDelete(null))}>
                          Quitar
                        </Button>
                      ) : (
                        <button type="button" onClick={() => setConfirmDelete(s.id)} className="rounded p-1.5 text-muted-foreground hover:text-destructive" aria-label={`Quitar «${s.name}» de Mis diseños`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </Group>
        );
      })}
    </div>
  );
}

function Structure({ blocks, selectedId, device, onSelect, onMove, onDuplicate, onDelete }: { blocks: PageBlock[]; selectedId: string | null; device: Device; onSelect: (id: string) => void; onMove: (id: string, index: number) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void }) {
  const [dragId, setDragIdState] = useState<string | null>(null);
  const [over, setOver] = useState<{ index: number } | null>(null);
  // El bloque arrastrado también en una referencia: los eventos del arrastre llegan antes de que React repinte
  const dragRef = useRef<string | null>(null);
  const setDragId = (id: string | null) => {
    dragRef.current = id;
    setDragIdState(id);
  };
  const dropIndex = (e: React.DragEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? i : i + 1;
  };
  if (!blocks.length) return <p className="p-4 text-sm text-muted-foreground">La página aún no tiene bloques. Añádelos desde «Añadir».</p>;
  return (
    <ol className="space-y-0.5 p-2" aria-label="Bloques de la página">
      {blocks.map((b, i) => {
        const Icon = moduleIcon(moduleDef(b.type)?.icon);
        const selected = b.id === selectedId;
        const hidden = !!b.style?.hideOn.includes(device);
        return (
          <li
            key={b.id}
            draggable
            onDragStart={(e) => {
              setDragId(b.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", `block:${b.id}`);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!dragRef.current) return;
              e.preventDefault();
              setOver({ index: dropIndex(e, i) });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragRef.current) onMove(dragRef.current, dropIndex(e, i));
              setDragId(null);
              setOver(null);
            }}
            className={cn("group relative", dragId === b.id && "opacity-40")}
          >
            {over?.index === i && <span className="absolute inset-x-1 -top-px h-0.5 rounded bg-[#5b5bf6]" aria-hidden />}
            {over?.index === i + 1 && i === blocks.length - 1 && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-[#5b5bf6]" aria-hidden />}
            <div className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors", selected ? "bg-[#5b5bf6]/10 text-foreground" : "hover:bg-muted")}>
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />
              <button type="button" onClick={() => onSelect(b.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-current={selected || undefined}>
                <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-[#5b5bf6]" : "text-muted-foreground")} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{blockLabel(b.type)}</span>
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">{blockSummary(b) || "Sin texto todavía"}</span>
                </span>
              </button>
              {hidden && <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Oculto en este dispositivo" />}
              <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" aria-label="Duplicar bloque" title="Duplicar" onClick={() => onDuplicate(b.id)}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive" aria-label="Eliminar bloque" title="Eliminar" onClick={() => onDelete(b.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            {b.type === "section" && <SectionRows section={b} selectedId={selectedId} device={device} onSelect={onSelect} onDuplicate={onDuplicate} onDelete={onDelete} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Contenido de una sección en la estructura: cada columna con sus módulos (se mueven arrastrándolos en el lienzo). */
function SectionRows({ section, selectedId, device, onSelect, onDuplicate, onDelete }: { section: Extract<PageBlock, { type: "section" }>; selectedId: string | null; device: Device; onSelect: (id: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className="ml-4 border-l border-border pl-2">
      {section.data.columns.map((col, ci) => (
        <div key={ci} className="py-0.5">
          <span className="block px-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Columna {ci + 1}</span>
          {!col.blocks.length && <span className="block px-1.5 py-1 text-[11px] italic text-muted-foreground">Vacía</span>}
          <ol aria-label={`Columna ${ci + 1}`}>
            {col.blocks.map((b) => {
              const Icon = moduleIcon(moduleDef(b.type)?.icon);
              const selected = b.id === selectedId;
              return (
                <li key={b.id} className="group">
                  <div className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors", selected ? "bg-[#5b5bf6]/10 text-foreground" : "hover:bg-muted")}>
                    <button type="button" onClick={() => onSelect(b.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-current={selected || undefined}>
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-[#5b5bf6]" : "text-muted-foreground")} />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium">{blockLabel(b.type)}</span>
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">{blockSummary(b) || "Sin texto todavía"}</span>
                      </span>
                    </button>
                    {b.style?.hideOn.includes(device) && <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Oculto en este dispositivo" />}
                    <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" aria-label="Duplicar bloque" title="Duplicar" onClick={() => onDuplicate(b.id)}>
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive" aria-label="Eliminar bloque" title="Eliminar" onClick={() => onDelete(b.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  {b.type === "section" && <SectionRows section={b} selectedId={selectedId} device={device} onSelect={onSelect} onDuplicate={onDuplicate} onDelete={onDelete} />}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

const GLOBAL_LINKS = [
  { href: "/admin/cms/menus", label: "Menús con submenús (CMS)", icon: Settings2 },
  { href: "/admin/cms/blog", label: "Blog", icon: Newspaper },
  { href: "/admin/cms/multimedia", label: "Multimedia", icon: ImageIcon },
] as const;

function Site({ pages, currentSlug, onOpenPage, onGlobalStyle, onSiteChrome }: { pages: SitePage[]; currentSlug: string; onOpenPage: (slug: string) => void; onGlobalStyle: () => void; onSiteChrome: () => void }) {
  const sorted = [...pages].sort((a, b) => Number(b.isHome) - Number(a.isHome) || Number(a.isLegal) - Number(b.isLegal) || a.title.localeCompare(b.title, "es"));
  return (
    <div className="space-y-5 p-3">
      <section className="space-y-1">
        <div className="flex items-center justify-between px-0.5 pb-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Páginas</h3>
          <Link href="/admin/cms/paginas?nueva=1" className="inline-flex items-center gap-1 text-xs font-medium text-[#5b5bf6] hover:underline">
            <Plus className="h-3.5 w-3.5" /> Nueva
          </Link>
        </div>
        {sorted.map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => onOpenPage(p.slug)}
            aria-current={p.slug === currentSlug || undefined}
            className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors", p.slug === currentSlug ? "bg-[#5b5bf6]/10 font-medium" : "hover:bg-muted")}
          >
            {p.isHome ? <Home className="h-3.5 w-3.5 shrink-0 text-[#5b5bf6]" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{p.title}</span>
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", !p.isPublished ? "bg-slate-300" : p.hasDraft ? "bg-amber-400" : "bg-emerald-500")}
              title={!p.isPublished ? "Sin publicar" : p.hasDraft ? "Con cambios sin publicar" : "Publicada"}
              aria-label={!p.isPublished ? "Sin publicar" : p.hasDraft ? "Con cambios sin publicar" : "Publicada"}
            />
          </button>
        ))}
        <Link href="/admin/cms/paginas" className="block px-2 pt-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
          Gestionar páginas (crear, duplicar, eliminar)
        </Link>
      </section>
      <section className="space-y-1">
        <h3 className="px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Todo el sitio</h3>
        <button type="button" onClick={onGlobalStyle} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
          <Palette className="h-3.5 w-3.5 text-[#5b5bf6]" /> Estilo global: colores, letra y bordes
        </button>
        <button type="button" onClick={onSiteChrome} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
          <PanelsTopLeft className="h-3.5 w-3.5 text-[#5b5bf6]" /> Cabecera y pie: botón, menús y estilo
        </button>
        {GLOBAL_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <l.icon className="h-3.5 w-3.5 text-muted-foreground" /> {l.label}
          </Link>
        ))}
      </section>
    </div>
  );
}
