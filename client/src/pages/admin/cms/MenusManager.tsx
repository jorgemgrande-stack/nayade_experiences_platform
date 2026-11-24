import { useState, useRef } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
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
import { toastError } from "@/lib/errorMessage";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import CmsSectionNav from "./CmsSectionNav";
import { TONE_SURFACE } from "@/lib/panelTones";

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
  const tx = useStudioText();
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
          placeholder={tx(placeholder)}
        />
        <button onClick={save} className="text-success hover:text-success"><Check className="w-4 h-4" /></button>
        <button onClick={cancel} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </span>
    );
  }
  return (
    <span
      className={`cursor-pointer hover:text-primary transition-colors group/edit ${className}`}
      onClick={start}
      title={tx("Clic para editar")}
    >
      {value}
      <Edit2 className="w-3 h-3 ml-1 inline opacity-0 group-hover/edit:opacity-60 transition-opacity" />
    </span>
  );
}

// ── URL inline edit ──────────────────────────────────────────────────────────
function InlineUrl({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const tx = useStudioText();
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
          placeholder={tx("/contacto o https://…")}
        />
        <button onClick={save} className="text-success hover:text-success"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={cancel} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }
  return (
    <span
      className="cursor-pointer text-xs text-muted-foreground hover:text-primary transition-colors group/url flex items-center gap-1"
      onClick={start}
      title={tx("Pulsa para cambiar a dónde lleva")}
    >
      <Link2 className="w-3 h-3" />
      {value ?? <span className="italic opacity-60">{tx("sin enlace")}</span>}
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
  const tx = useStudioText();
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
        placeholder={tx("Texto")}
        className="h-7 text-xs px-2 w-32"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
        placeholder="/contacto"
        className="h-7 text-xs px-2 w-36"
      />
      <button onClick={submit} className="text-success hover:text-success"><Check className="w-4 h-4" /></button>
      <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function MenusManager() {
  const tx = useStudioText();
  // Menú de arriba o enlaces del pie de página (los textos legales del pie se añaden solos)
  const [zone, setZone] = useState<"header" | "footer">("header");
  const utils = trpc.useUtils();

  const { data: allItems = [], isLoading, isError, error, refetch } = trpc.cms.getMenuItems.useQuery({ zone });

  const updateMut = trpc.cms.updateMenuItem.useMutation({
    onSuccess: () => utils.cms.getMenuItems.invalidate(),
    onError: (e) => toastError(e),
  });
  const createMut = trpc.cms.createMenuItem.useMutation({
    onSuccess: () => { utils.cms.getMenuItems.invalidate(); toast.success(tx("Ítem añadido")); },
    onError: (e) => toastError(e),
  });
  const deleteMut = trpc.cms.deleteMenuItem.useMutation({
    onSuccess: () => { utils.cms.getMenuItems.invalidate(); toast.success(tx("Ítem eliminado")); },
    onError: (e) => toastError(e),
  });
  const reorderMut = trpc.cms.reorderMenuItems.useMutation({
    onSuccess: () => utils.cms.getMenuItems.invalidate(),
    onError: (e) => toastError(e),
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
      <AdminLayout title={tx("Gestión de Menús")}>
        <PanelLoading label={tx("Cargando menú...")} />
      </AdminLayout>
    );
  }

  if (isError) {
    return (
      <AdminLayout title={tx("Gestión de Menús")}>
        <div className="px-6 py-6"><PanelError error={error} onRetry={() => void refetch()} /></div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={tx("Gestión de Menús")}>
      <div className="px-6 py-6">
      <CmsSectionNav />
      <PanelPageHeader
        icon={<Navigation />}
        title={tx("Menú de tu web")}
        description={tx("Pulsa un texto o un enlace para cambiarlo · Usa las flechas para ordenar · Los cambios se guardan solos")}
        actions={<>
          <Button
            variant="outline"
            onClick={() => utils.cms.getMenuItems.invalidate()}
            disabled={updateMut.isPending || reorderMut.isPending}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />{tx("Actualizar")}</Button>
          <Button variant="outline" asChild>
            <a href="/" target="_blank" rel="noreferrer"><Globe className="w-4 h-4 mr-1.5" aria-hidden="true" />{tx("Ver sitio")}</a>
          </Button>
        </>}
      />

      {/* Menú de arriba o pie de página */}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={tx("Qué menú")}>
        {(["header", "footer"] as const).map((z) => (
          <Button key={z} size="sm" role="tab" aria-selected={zone === z} variant={zone === z ? "default" : "outline"} onClick={() => setZone(z)}>
            {z === "header" ? tx("Menú de arriba") : tx("Pie de página")}
          </Button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2">
        <span className="flex items-center gap-1"><Edit2 className="w-3 h-3" />{" "}{tx("Clic en texto para editar")}</span>
        <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" /><ChevronDown className="w-3 h-3" />{" "}{tx("Flechas para reordenar")}</span>
        <span className="flex items-center gap-1"><Plus className="w-3 h-3" />{" "}{tx("Añadir ítem o submenú")}</span>
        <span className="flex items-center gap-1"><Trash2 className="w-3 h-3" />{" "}{tx("Eliminar (y sus submenús)")}</span>
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
                      <ChevronRight className="w-3 h-3 mr-0.5" /> {children.length}{" "}{tx("submenús")}</Badge>
                  )}
                  <Switch
                    checked={root.isActive}
                    onCheckedChange={(v) => update(root.id, { isActive: v })}
                    className="scale-75"
                  />
                  {root.url && (
                    <a href={root.url} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost" className="h-7 px-2">
                        <Eye className="w-3.5 h-3.5 mr-1" />{" "}{tx("Ver")}</Button>
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      if (await confirmAction({ destructive: true, description: tx("¿Eliminar \"{label}\" y sus {childrenN} submenús?", { label: root.label, childrenN: children.length }) }))
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
                            onClick={async () => {
                              if (await confirmAction({ destructive: true, description: tx("¿Eliminar \"{label}\"?", { label: child.label }) }))
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
                      placeholder={tx("+ Añadir submenú")}
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
          placeholder={zone === "header" ? tx("Añadir enlace al menú") : tx("Añadir enlace al pie")}
        />
      </div>

      {/* Info */}
      <div className={`mt-4 rounded-xl border p-3 text-xs text-foreground ${TONE_SURFACE.info}`}>
        <strong>{tx("Consejo:")}</strong>{" "}{tx("los cambios se guardan al momento y se ven en tu web al volver a cargarla. Las páginas sin publicar no aparecen en el menú aunque estén en esta lista. El pie de página muestra además los datos de tu empresa y los textos legales.")}</div>
      </div>
    </AdminLayout>
  );
}
