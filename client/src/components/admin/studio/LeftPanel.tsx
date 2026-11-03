/**
 * Elephant Studio — panel izquierdo:
 *   - Añadir: biblioteca de módulos (buscador, familias, solo los que permite la licencia) y secciones prediseñadas.
 *     Se arrastran al lienzo o se añaden con un clic (detrás del bloque seleccionado).
 *   - Estructura: los bloques de la página en orden; se seleccionan, se reordenan arrastrando, se duplican y se quitan.
 *     Lo que va dentro de una sección con columnas se ve debajo de ella, columna a columna.
 *   - Sitio: las páginas de la web y los ajustes globales (menús, marca, blog, multimedia).
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Bookmark, Copy, EyeOff, FileText, GripVertical, Home, Image as ImageIcon, LayoutPanelTop, Newspaper, Palette, PanelsTopLeft, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { blockLabel, type Device, type PageBlock } from "@shared/pageBlocks";
import { MODULE_FAMILIES, SECTION_PRESETS, moduleDef, searchModules, type ModuleDef } from "@shared/studio/modules";
import { blockSummary } from "@/components/admin/pageBuilder/BlockEditors";
import { moduleIcon } from "./icons";
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
  /** Mis bloques: guardados para reutilizar (se inserta una copia) */
  savedBlocks: Array<{ id: string; name: string; block: PageBlock }>;
  onDeleteSaved: (id: string) => void;
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
        {props.tab === "add" && <Library modules={props.modules} presets={props.presets} onInsert={props.onInsert} saved={props.savedBlocks} onDeleteSaved={props.onDeleteSaved} />}
        {props.tab === "structure" && <Structure {...props} />}
        {props.tab === "site" && <Site pages={props.pages} currentSlug={props.currentSlug} onOpenPage={props.onOpenPage} onGlobalStyle={props.onGlobalStyle} onSiteChrome={props.onSiteChrome} />}
      </div>
    </div>
  );
}

function Library({
  modules, presets, onInsert, saved, onDeleteSaved,
}: {
  modules: ModuleDef[];
  presets: typeof SECTION_PRESETS;
  onInsert: (payload: string) => void;
  saved: Array<{ id: string; name: string; block: PageBlock }>;
  onDeleteSaved: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const found = useMemo(() => searchModules(modules, q), [modules, q]);
  return (
    <div className="space-y-5 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar módulos" aria-label="Buscar módulos" className="h-9 pl-8" />
      </div>
      {MODULE_FAMILIES.map((fam) => {
        const list = found.filter((m) => m.family === fam.key);
        if (!list.length) return null;
        return (
          <section key={fam.key} className="space-y-2">
            <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{fam.label}</h3>
            <div className="grid grid-cols-2 gap-2">
              {list.map((m) => {
                const Icon = moduleIcon(m.icon);
                return (
                  <button
                    key={m.type}
                    type="button"
                    draggable
                    onDragStart={(e) => startDrag(e, `module:${m.type}`)}
                    onClick={() => onInsert(`module:${m.type}`)}
                    title={`${m.description}. Arrástralo a la página o haz clic para añadirlo.`}
                    className="group flex cursor-grab flex-col items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-3 text-center transition-all hover:-translate-y-px hover:border-[#5b5bf6]/60 hover:shadow-sm active:cursor-grabbing"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-[#5b5bf6]" />
                    <span className="text-xs font-medium leading-tight">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!found.length && <p className="px-1 text-sm text-muted-foreground">Ningún módulo coincide con «{q}».</p>}
      {!q.trim() && (
        <section className="space-y-2">
          <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mis bloques</h3>
          {saved.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Guarda aquí un bloque o una sección con su diseño para reutilizarlo en cualquier página: selecciónalo y pulsa «Guardar en Mis bloques» en el panel derecho.
            </p>
          ) : (
            <div className="space-y-1.5">
              {saved.map((s) => (
                <div key={s.id} className="flex items-center gap-1 rounded-lg border border-border bg-background pr-1 transition-colors hover:border-[#5b5bf6]/60">
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => startDrag(e, `saved:${s.id}`)}
                    onClick={() => onInsert(`saved:${s.id}`)}
                    title="Arrástralo a la página o haz clic para añadir una copia"
                    className="flex min-w-0 flex-1 cursor-grab items-center gap-2.5 px-3 py-2 text-left active:cursor-grabbing"
                  >
                    <Bookmark className="h-4 w-4 shrink-0 text-[#5b5bf6]" />
                    <span className="min-w-0">
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">{blockLabel(s.block.type)}</span>
                    </span>
                  </button>
                  {confirmDelete === s.id ? (
                    <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => (onDeleteSaved(s.id), setConfirmDelete(null))}>
                      Quitar
                    </Button>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(s.id)} className="rounded p-1.5 text-muted-foreground hover:text-destructive" aria-label={`Quitar «${s.name}» de Mis bloques`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {!q.trim() && (
        <section className="space-y-2">
          <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Secciones prediseñadas</h3>
          <div className="space-y-2">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                draggable
                onDragStart={(e) => startDrag(e, `preset:${p.key}`)}
                onClick={() => onInsert(`preset:${p.key}`)}
                className="flex w-full cursor-grab items-start gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-[#5b5bf6]/60 active:cursor-grabbing"
              >
                <LayoutPanelTop className="mt-0.5 h-4 w-4 shrink-0 text-[#5b5bf6]" />
                <span>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
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
