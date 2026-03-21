import { useState, useRef } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Navigation, ExternalLink, Eye, Plus, Trash2, Edit2, Check, X,
  ChevronUp, ChevronDown, ChevronRight, GripVertical, Link2, Globe,
  Loader2, RefreshCw,
} from "lucide-react";

type MenuItem = {
  id: number;
  label: string;
  url: string | null;
  parentId: number | null;
  target: "_self" | "_blank";
  sortOrder: number;
  isActive: boolean;
  menuZone: "header" | "footer";
};

// ── Inline editable field ────────────────────────────────────────────────────
function InlineEdit({
  value,
  onSave,
  placeholder = "Texto...",
  className = "",
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => { setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); };
  const cancel = () => setEditing(false);
  const save = () => { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); };

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className={`h-7 text-sm px-2 w-40 ${className}`}
          placeholder={placeholder}
        />
        <button onClick={save} className="text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
        <button onClick={cancel} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </span>
    );
  }
  return (
    <span
      className={`cursor-pointer hover:text-primary transition-colors group/edit ${className}`}
      onClick={start}
      title="Clic para editar"
    >
      {value}
      <Edit2 className="w-3 h-3 ml-1 inline opacity-0 group-hover/edit:opacity-60 transition-opacity" />
    </span>
  );
}

// ── URL inline edit ──────────────────────────────────────────────────────────
function InlineUrl({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => { setDraft(value ?? ""); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); };
  const cancel = () => setEditing(false);
  const save = () => { onSave(draft.trim() || null); setEditing(false); };

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className="h-6 text-xs px-2 w-48"
          placeholder="/ruta o https://..."
        />
        <button onClick={save} className="text-green-600 hover:text-green-700"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancel} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }
  return (
    <span
      className="cursor-pointer text-xs text-muted-foreground hover:text-primary transition-colors group/url flex items-center gap-1"
      onClick={start}
      title="Clic para editar URL"
    >
      <Link2 className="w-3 h-3" />
      {value ?? <span className="italic opacity-60">sin URL</span>}
      <Edit2 className="w-2.5 h-2.5 opacity-0 group-hover/url:opacity-60 transition-opacity" />
    </span>
  );
}

// ── Add item row ─────────────────────────────────────────────────────────────
function AddItemRow({
  onAdd,
  placeholder = "Nuevo ítem...",
  compact = false,
}: {
  onAdd: (label: string, url: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const submit = () => {
    if (!label.trim()) return;
    onAdd(label.trim(), url.trim());
    setLabel(""); setUrl(""); setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors ${compact ? "mt-1 ml-1" : "mt-2"}`}
      >
        <Plus className="w-3.5 h-3.5" /> {placeholder}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${compact ? "mt-1 ml-1" : "mt-2"}`}>
      <Input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
        placeholder="Etiqueta"
        className="h-7 text-xs px-2 w-32"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
        placeholder="/ruta"
        className="h-7 text-xs px-2 w-36"
      />
      <button onClick={submit} className="text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
      <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function MenusManager() {
  const [zone] = useState<"header" | "footer">("header");
  const utils = trpc.useUtils();

  const { data: allItems = [], isLoading } = trpc.cms.getMenuItems.useQuery({ zone });

  const updateMut = trpc.cms.updateMenuItem.useMutation({
    onSuccess: () => utils.cms.getMenuItems.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const createMut = trpc.cms.createMenuItem.useMutation({
    onSuccess: () => { utils.cms.getMenuItems.invalidate(); toast.success("Ítem añadido"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.cms.deleteMenuItem.useMutation({
    onSuccess: () => { utils.cms.getMenuItems.invalidate(); toast.success("Ítem eliminado"); },
    onError: (e) => toast.error(e.message),
  });
  const reorderMut = trpc.cms.reorderMenuItems.useMutation({
    onSuccess: () => utils.cms.getMenuItems.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  // Build tree
  const roots = allItems.filter((i) => i.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (parentId: number) =>
    allItems.filter((i) => i.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);

  const update = (id: number, data: Partial<MenuItem>) => updateMut.mutate({ id, ...data });

  const moveRoot = (item: MenuItem, dir: -1 | 1) => {
    const sorted = [...roots];
    const idx = sorted.findIndex((r) => r.id === item.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const reordered = sorted.map((r, i) => {
      if (i === idx) return { id: r.id, sortOrder: sorted[swapIdx].sortOrder };
      if (i === swapIdx) return { id: r.id, sortOrder: sorted[idx].sortOrder };
      return { id: r.id, sortOrder: r.sortOrder };
    });
    reorderMut.mutate({ items: reordered });
  };

  const moveChild = (child: MenuItem, dir: -1 | 1) => {
    if (!child.parentId) return;
    const siblings = childrenOf(child.parentId);
    const idx = siblings.findIndex((s) => s.id === child.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const reordered = siblings.map((s, i) => {
      if (i === idx) return { id: s.id, sortOrder: siblings[swapIdx].sortOrder };
      if (i === swapIdx) return { id: s.id, sortOrder: siblings[idx].sortOrder };
      return { id: s.id, sortOrder: s.sortOrder };
    });
    reorderMut.mutate({ items: reordered });
  };

  const addRoot = (label: string, url: string) =>
    createMut.mutate({ label, url: url || null, menuZone: zone, sortOrder: (roots.at(-1)?.sortOrder ?? 0) + 10 });

  const addChild = (parentId: number, label: string, url: string) => {
    const siblings = childrenOf(parentId);
    createMut.mutate({ label, url: url || null, parentId, menuZone: zone, sortOrder: (siblings.at(-1)?.sortOrder ?? 0) + 10 });
  };

  if (isLoading) {
    return (
      <AdminLayout title="Gestión de Menús">
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando menú...
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Gestión de Menús">
      <div className="px-6 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-orange-500/15 border border-orange-500/25">
            <Navigation className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-none">Estructura del Menú de Navegación</h1>
            <p className="text-xs text-white/40 mt-1">
              Edita etiquetas y URLs haciendo clic sobre ellas · Usa las flechas para reordenar · Los cambios se guardan automáticamente
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => utils.cms.getMenuItems.invalidate()}
            disabled={updateMut.isPending || reorderMut.isPending}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Actualizar
          </Button>
          <a href="/" target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline">
              <Globe className="w-3.5 h-3.5 mr-1.5" /> Ver sitio
            </Button>
          </a>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2">
        <span className="flex items-center gap-1"><Edit2 className="w-3 h-3" /> Clic en texto para editar</span>
        <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" /><ChevronDown className="w-3 h-3" /> Flechas para reordenar</span>
        <span className="flex items-center gap-1"><Plus className="w-3 h-3" /> Añadir ítem o submenú</span>
        <span className="flex items-center gap-1"><Trash2 className="w-3 h-3" /> Eliminar (y sus submenús)</span>
      </div>

      {/* Menu tree */}
      <div className="grid gap-3">
        {roots.map((root, rootIdx) => {
          const children = childrenOf(root.id);
          return (
            <div
              key={root.id}
              className={`bg-card border rounded-xl overflow-hidden transition-opacity ${!root.isActive ? "opacity-50" : ""}`}
            >
              {/* Root row */}
              <div className="px-4 py-3 flex items-center gap-3 bg-muted/20 border-b">
                {/* Reorder arrows */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => moveRoot(root, -1)}
                    disabled={rootIdx === 0 || reorderMut.isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveRoot(root, 1)}
                    disabled={rootIdx === roots.length - 1 || reorderMut.isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                <Navigation className="w-4 h-4 text-primary shrink-0" />

                {/* Label */}
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <InlineEdit
                    value={root.label}
                    onSave={(v) => update(root.id, { label: v })}
                    className="font-semibold text-sm"
                  />
                  <InlineUrl
                    value={root.url}
                    onSave={(v) => update(root.id, { url: v })}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {children.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      <ChevronRight className="w-3 h-3 mr-0.5" /> {children.length} submenús
                    </Badge>
                  )}
                  <Switch
                    checked={root.isActive}
                    onCheckedChange={(v) => update(root.id, { isActive: v })}
                    className="scale-75"
                  />
                  {root.url && (
                    <a href={root.url} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost" className="h-7 px-2">
                        <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                      </Button>
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm(`¿Eliminar "${root.label}" y sus ${children.length} submenús?`))
                        deleteMut.mutate({ id: root.id });
                    }}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Children */}
              {(children.length > 0 || true) && (
                <div className="px-4 py-3">
                  <div className="flex flex-wrap gap-2 items-center">
                    {children.map((child, childIdx) => (
                      <div
                        key={child.id}
                        className={`group flex items-center gap-1 bg-muted/50 border rounded-lg px-2.5 py-1.5 text-sm transition-all ${!child.isActive ? "opacity-40" : ""}`}
                      >
                        {/* Reorder */}
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => moveChild(child, -1)}
                            disabled={childIdx === 0 || reorderMut.isPending}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => moveChild(child, 1)}
                            disabled={childIdx === children.length - 1 || reorderMut.isPending}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>

                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />

                        <div className="flex flex-col gap-0.5">
                          <InlineEdit
                            value={child.label}
                            onSave={(v) => update(child.id, { label: v })}
                            className="text-xs font-medium"
                          />
                          <InlineUrl
                            value={child.url}
                            onSave={(v) => update(child.id, { url: v })}
                          />
                        </div>

                        {/* Child actions (visible on hover) */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                          <Switch
                            checked={child.isActive}
                            onCheckedChange={(v) => update(child.id, { isActive: v })}
                            className="scale-[0.6]"
                          />
                          <button
                            onClick={() => {
                              if (confirm(`¿Eliminar "${child.label}"?`))
                                deleteMut.mutate({ id: child.id });
                            }}
                            className="text-destructive/60 hover:text-destructive transition-colors"
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Add submenu */}
                    <AddItemRow
                      onAdd={(label, url) => addChild(root.id, label, url)}
                      placeholder="+ Añadir submenú"
                      compact
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add root item */}
      <div className="mt-4 p-4 border-2 border-dashed border-border rounded-xl">
        <AddItemRow
          onAdd={addRoot}
          placeholder="Añadir ítem de menú principal"
        />
      </div>

      {/* Info */}
      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
        <strong>Tip:</strong> Los cambios se persisten en la base de datos en tiempo real. El menú de navegación del sitio público se actualiza automáticamente al recargar la página.
      </div>
      </div>
    </AdminLayout>
  );
}
