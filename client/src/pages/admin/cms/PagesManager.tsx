import { useState, useCallback, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Save, Eye, ChevronUp, ChevronDown, Trash2,
  Type, Image, Layout, AlignLeft, Link2, Grid, ChevronRight,
  EyeOff, GripVertical, FileText, Globe, Settings
} from "lucide-react";
import ImageUploader from "@/components/ImageUploader";

// ─── Block Types ──────────────────────────────────────────────────────────────
type BlockType = "hero" | "text" | "image_text" | "cta" | "gallery" | "accordion" | "features" | "spacer";

interface Block {
  id: string;
  blockType: BlockType;
  sortOrder: number;
  isVisible: boolean;
  data: Record<string, unknown>;
}

const BLOCK_CATALOG: { type: BlockType; label: string; icon: React.ReactNode; description: string }[] = [
  { type: "hero", label: "Hero / Banner", icon: <Layout size={16} />, description: "Imagen de fondo con título y CTA" },
  { type: "text", label: "Texto enriquecido", icon: <Type size={16} />, description: "Párrafos, títulos y listas" },
  { type: "image_text", label: "Imagen + Texto", icon: <AlignLeft size={16} />, description: "Columna de imagen y texto lado a lado" },
  { type: "cta", label: "Llamada a la acción", icon: <Link2 size={16} />, description: "Botón destacado con texto" },
  { type: "gallery", label: "Galería", icon: <Grid size={16} />, description: "Grid de imágenes" },
  { type: "accordion", label: "Acordeón / FAQ", icon: <ChevronRight size={16} />, description: "Preguntas y respuestas expandibles" },
  { type: "features", label: "Características", icon: <FileText size={16} />, description: "Lista de iconos con texto" },
  { type: "spacer", label: "Separador", icon: <AlignLeft size={16} />, description: "Espacio vertical entre bloques" },
];

function defaultData(type: BlockType): Record<string, unknown> {
  switch (type) {
    case "hero": return { title: "Título principal", subtitle: "Subtítulo descriptivo", imageUrl: "", ctaText: "Reservar ahora", ctaUrl: "/reservar", overlayOpacity: 50 };
    case "text": return { title: "", body: "Escribe tu contenido aquí...", align: "left" };
    case "image_text": return { title: "Título de sección", body: "Descripción del contenido...", imageUrl: "", imagePosition: "left", ctaText: "", ctaUrl: "" };
    case "cta": return { title: "¿Listo para reservar?", subtitle: "Plazas limitadas", ctaText: "Reservar ahora", ctaUrl: "/reservar", bgColor: "orange" };
    case "gallery": return { title: "", images: [] as string[] };
    case "accordion": return { title: "Preguntas frecuentes", items: [{ question: "¿Pregunta?", answer: "Respuesta..." }] };
    case "features": return { title: "¿Por qué elegirnos?", items: [{ icon: "⭐", title: "Calidad", description: "Descripción" }] };
    case "spacer": return { height: 40 };
    default: return {};
  }
}

// ─── Block Editors ────────────────────────────────────────────────────────────
function HeroEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs mb-1 block">Título</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} placeholder="Título principal" /></div>
        <div><Label className="text-xs mb-1 block">Subtítulo</Label><Input value={data.subtitle as string || ""} onChange={e => onChange({ ...data, subtitle: e.target.value })} placeholder="Subtítulo" /></div>
      </div>
      <ImageUploader label="Imagen de fondo" value={data.imageUrl as string || ""} onChange={url => onChange({ ...data, imageUrl: url })} />
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs mb-1 block">Texto del botón</Label><Input value={data.ctaText as string || ""} onChange={e => onChange({ ...data, ctaText: e.target.value })} placeholder="Reservar" /></div>
        <div><Label className="text-xs mb-1 block">URL del botón</Label><Input value={data.ctaUrl as string || ""} onChange={e => onChange({ ...data, ctaUrl: e.target.value })} placeholder="/reservar" /></div>
        <div><Label className="text-xs mb-1 block">Opacidad overlay ({data.overlayOpacity as number || 50}%)</Label><input type="range" min={0} max={90} value={data.overlayOpacity as number || 50} onChange={e => onChange({ ...data, overlayOpacity: Number(e.target.value) })} className="w-full" /></div>
      </div>
    </div>
  );
}

function TextEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <div><Label className="text-xs mb-1 block">Título (opcional)</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} placeholder="Título de sección" /></div>
      <div><Label className="text-xs mb-1 block">Contenido</Label><Textarea rows={5} value={data.body as string || ""} onChange={e => onChange({ ...data, body: e.target.value })} placeholder="Escribe el contenido..." /></div>
      <div><Label className="text-xs mb-1 block">Alineación</Label>
        <div className="flex gap-2">
          {["left", "center", "right"].map(a => (
            <button key={a} onClick={() => onChange({ ...data, align: a })} className={`px-3 py-1 text-xs rounded border ${data.align === a ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{a}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageTextEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <div><Label className="text-xs mb-1 block">Título</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} /></div>
      <ImageUploader label="Imagen" value={data.imageUrl as string || ""} onChange={url => onChange({ ...data, imageUrl: url })} />
      <div><Label className="text-xs mb-1 block">Texto</Label><Textarea rows={4} value={data.body as string || ""} onChange={e => onChange({ ...data, body: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs mb-1 block">Posición imagen</Label>
          <div className="flex gap-2">
            {["left", "right"].map(p => (
              <button key={p} onClick={() => onChange({ ...data, imagePosition: p })} className={`px-3 py-1 text-xs rounded border ${data.imagePosition === p ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{p === "left" ? "Izquierda" : "Derecha"}</button>
            ))}
          </div>
        </div>
        <div><Label className="text-xs mb-1 block">Texto botón (opcional)</Label><Input value={data.ctaText as string || ""} onChange={e => onChange({ ...data, ctaText: e.target.value })} /></div>
        <div><Label className="text-xs mb-1 block">URL botón</Label><Input value={data.ctaUrl as string || ""} onChange={e => onChange({ ...data, ctaUrl: e.target.value })} /></div>
      </div>
    </div>
  );
}

function CtaEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs mb-1 block">Título</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} /></div>
        <div><Label className="text-xs mb-1 block">Subtítulo</Label><Input value={data.subtitle as string || ""} onChange={e => onChange({ ...data, subtitle: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs mb-1 block">Texto botón</Label><Input value={data.ctaText as string || ""} onChange={e => onChange({ ...data, ctaText: e.target.value })} /></div>
        <div><Label className="text-xs mb-1 block">URL botón</Label><Input value={data.ctaUrl as string || ""} onChange={e => onChange({ ...data, ctaUrl: e.target.value })} /></div>
        <div><Label className="text-xs mb-1 block">Color fondo</Label>
          <div className="flex gap-2">
            {["orange", "blue", "dark"].map(c => (
              <button key={c} onClick={() => onChange({ ...data, bgColor: c })} className={`px-2 py-1 text-xs rounded border ${data.bgColor === c ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{c}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccordionEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const items = (data.items as { question: string; answer: string }[]) || [];
  const updateItem = (i: number, field: "question" | "answer", value: string) => {
    const updated = items.map((it, idx) => idx === i ? { ...it, [field]: value } : it);
    onChange({ ...data, items: updated });
  };
  const addItem = () => onChange({ ...data, items: [...items, { question: "Nueva pregunta", answer: "Respuesta..." }] });
  const removeItem = (i: number) => onChange({ ...data, items: items.filter((_, idx) => idx !== i) });
  return (
    <div className="space-y-3">
      <div><Label className="text-xs mb-1 block">Título de sección</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} /></div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="border border-border rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={item.question} onChange={e => updateItem(i, "question", e.target.value)} placeholder="Pregunta" />
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)}><Trash2 size={14} className="text-destructive" /></Button>
            </div>
            <Textarea rows={2} value={item.answer} onChange={e => updateItem(i, "answer", e.target.value)} placeholder="Respuesta" />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem}><Plus size={14} className="mr-1" />Añadir pregunta</Button>
      </div>
    </div>
  );
}

function FeaturesEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const items = (data.items as { icon: string; title: string; description: string }[]) || [];
  const updateItem = (i: number, field: string, value: string) => {
    const updated = items.map((it, idx) => idx === i ? { ...it, [field]: value } : it);
    onChange({ ...data, items: updated });
  };
  const addItem = () => onChange({ ...data, items: [...items, { icon: "⭐", title: "Característica", description: "Descripción" }] });
  const removeItem = (i: number) => onChange({ ...data, items: items.filter((_, idx) => idx !== i) });
  return (
    <div className="space-y-3">
      <div><Label className="text-xs mb-1 block">Título de sección</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} /></div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 border border-border rounded p-3">
            <Input className="w-16" value={item.icon} onChange={e => updateItem(i, "icon", e.target.value)} placeholder="🌊" />
            <Input className="flex-1" value={item.title} onChange={e => updateItem(i, "title", e.target.value)} placeholder="Título" />
            <Input className="flex-1" value={item.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder="Descripción" />
            <Button variant="ghost" size="icon" onClick={() => removeItem(i)}><Trash2 size={14} className="text-destructive" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem}><Plus size={14} className="mr-1" />Añadir característica</Button>
      </div>
    </div>
  );
}

function GalleryEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const images = (data.images as string[]) || [];
  const updateImage = (i: number, value: string) => {
    const updated = images.map((img, idx) => idx === i ? value : img);
    onChange({ ...data, images: updated });
  };
  const addImage = () => onChange({ ...data, images: [...images, ""] });
  const removeImage = (i: number) => onChange({ ...data, images: images.filter((_, idx) => idx !== i) });
  return (
    <div className="space-y-3">
      <div><Label className="text-xs mb-1 block">Título (opcional)</Label><Input value={data.title as string || ""} onChange={e => onChange({ ...data, title: e.target.value })} /></div>
      <div className="space-y-3">
        {images.map((img, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1">
              <ImageUploader value={img} onChange={url => updateImage(i, url)} />
            </div>
            <Button variant="ghost" size="icon" className="mt-1" onClick={() => removeImage(i)}><Trash2 size={14} className="text-destructive" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addImage}><Plus size={14} className="mr-1" />Añadir imagen</Button>
      </div>
    </div>
  );
}

function SpacerEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div>
      <Label className="text-xs mb-1 block">Altura en px ({data.height as number || 40}px)</Label>
      <input type="range" min={10} max={200} value={data.height as number || 40} onChange={e => onChange({ ...data, height: Number(e.target.value) })} className="w-full" />
    </div>
  );
}

function BlockEditor({ block, onChange }: { block: Block; onChange: (data: Record<string, unknown>) => void }) {
  switch (block.blockType) {
    case "hero": return <HeroEditor data={block.data} onChange={onChange} />;
    case "text": return <TextEditor data={block.data} onChange={onChange} />;
    case "image_text": return <ImageTextEditor data={block.data} onChange={onChange} />;
    case "cta": return <CtaEditor data={block.data} onChange={onChange} />;
    case "accordion": return <AccordionEditor data={block.data} onChange={onChange} />;
    case "features": return <FeaturesEditor data={block.data} onChange={onChange} />;
    case "gallery": return <GalleryEditor data={block.data} onChange={onChange} />;
    case "spacer": return <SpacerEditor data={block.data} onChange={onChange} />;
    default: return <p className="text-xs text-muted-foreground">Editor no disponible para este tipo de bloque.</p>;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PagesManager() {
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const { data: pages, isLoading, refetch } = trpc.cms.getPages.useQuery();
  const { data: rawBlocks } = trpc.cms.getPageBlocks.useQuery(
    { pageSlug: editingSlug! },
    { enabled: !!editingSlug }
  );

  useEffect(() => {
    if (rawBlocks) {
      setBlocks(rawBlocks.map((b: any) => ({
        id: String(b.id),
        blockType: b.blockType as BlockType,
        sortOrder: b.sortOrder,
        isVisible: b.isVisible,
        data: (b.data as Record<string, unknown>) || {},
      })));
      setIsDirty(false);
    }
  }, [rawBlocks]);

  const saveBlocksMutation = trpc.cms.savePageBlocks.useMutation({
    onSuccess: () => { toast.success("Página guardada correctamente"); setIsDirty(false); },
    onError: (e: any) => toast.error("Error al guardar: " + e.message),
  });

  const upsertPageMutation = trpc.cms.upsertPage.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); refetch(); },
  });

  const currentPage = pages?.find((p: any) => p.slug === editingSlug);

  const addBlock = useCallback((type: BlockType) => {
    const newBlock: Block = {
      id: `new-${Date.now()}`,
      blockType: type,
      sortOrder: blocks.length,
      isVisible: true,
      data: defaultData(type),
    };
    setBlocks(prev => [...prev, newBlock]);
    setExpandedBlock(newBlock.id);
    setShowBlockPicker(false);
    setIsDirty(true);
  }, [blocks.length]);

  const updateBlock = useCallback((id: string, data: Record<string, unknown>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, data } : b));
    setIsDirty(true);
  }, []);

  const toggleVisibility = useCallback((id: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, isVisible: !b.isVisible } : b));
    setIsDirty(true);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
    setIsDirty(true);
  }, []);

  const moveBlock = useCallback((id: string, dir: "up" | "down") => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (dir === "up" && idx === 0) return prev;
      if (dir === "down" && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next.map((b, i) => ({ ...b, sortOrder: i }));
    });
    setIsDirty(true);
  }, []);

  const handleSave = () => {
    if (!editingSlug) return;
    saveBlocksMutation.mutate({
      pageSlug: editingSlug,
      blocks: blocks.map((b, i) => ({
        blockType: b.blockType,
        sortOrder: i,
        data: b.data,
        isVisible: b.isVisible,
      })),
    });
  };

  const getBlockLabel = (type: string) => BLOCK_CATALOG.find(c => c.type === type)?.label || type;
  const getBlockIcon = (type: string) => BLOCK_CATALOG.find(c => c.type === type)?.icon || <FileText size={14} />;

  // ── Editor View ──────────────────────────────────────────────────────────────
  if (editingSlug) {
    return (
      <AdminLayout>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => { setEditingSlug(null); setBlocks([]); }}>
                <ArrowLeft size={16} className="mr-1" />Páginas
              </Button>
              <div className="w-px h-5 bg-border" />
              <div>
                <h1 className="font-semibold text-sm">{currentPage?.title || editingSlug}</h1>
                <p className="text-xs text-muted-foreground">/{editingSlug}</p>
              </div>
              {isDirty && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">Sin guardar</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open(`/${editingSlug}`, "_blank")}>
                <Eye size={14} className="mr-1" />Vista previa
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveBlocksMutation.isPending || !isDirty}>
                <Save size={14} className="mr-1" />{saveBlocksMutation.isPending ? "Guardando..." : "Guardar página"}
              </Button>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            <div className="max-w-3xl mx-auto space-y-3">
              {blocks.length === 0 ? (
                <div className="text-center py-16 border-2 border-dashed border-border rounded-xl bg-background">
                  <Layout size={32} className="mx-auto mb-3 text-muted-foreground opacity-40" />
                  <p className="text-sm font-medium text-muted-foreground">Página vacía</p>
                  <p className="text-xs text-muted-foreground mt-1">Añade bloques para construir el contenido</p>
                </div>
              ) : (
                blocks.map((block, idx) => (
                  <div key={block.id} className={`bg-background border rounded-xl overflow-hidden shadow-sm ${!block.isVisible ? "opacity-50" : ""}`}>
                    {/* Block header */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => setExpandedBlock(expandedBlock === block.id ? null : block.id)}
                    >
                      <GripVertical size={14} className="text-muted-foreground" />
                      <span className="text-muted-foreground">{getBlockIcon(block.blockType)}</span>
                      <span className="text-sm font-medium flex-1">{getBlockLabel(block.blockType)}</span>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveBlock(block.id, "up")} disabled={idx === 0}><ChevronUp size={13} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveBlock(block.id, "down")} disabled={idx === blocks.length - 1}><ChevronDown size={13} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleVisibility(block.id)}>
                          {block.isVisible ? <Eye size={13} /> : <EyeOff size={13} className="text-muted-foreground" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeBlock(block.id)}><Trash2 size={13} /></Button>
                      </div>
                      <ChevronRight size={14} className={`text-muted-foreground transition-transform ${expandedBlock === block.id ? "rotate-90" : ""}`} />
                    </div>
                    {/* Block editor */}
                    {expandedBlock === block.id && (
                      <div className="px-4 pb-4 pt-1 border-t border-border bg-slate-50/50">
                        <BlockEditor block={block} onChange={(data) => updateBlock(block.id, data)} />
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Add block button */}
              <div className="relative">
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => setShowBlockPicker(!showBlockPicker)}
                >
                  <Plus size={16} className="mr-2" />Añadir bloque
                </Button>
                {showBlockPicker && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-background border border-border rounded-xl shadow-lg p-3 z-20 grid grid-cols-2 gap-2">
                    {BLOCK_CATALOG.map(b => (
                      <button
                        key={b.type}
                        onClick={() => addBlock(b.type)}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 text-left border border-transparent hover:border-border transition-colors"
                      >
                        <span className="text-primary mt-0.5">{b.icon}</span>
                        <div>
                          <p className="text-sm font-medium">{b.label}</p>
                          <p className="text-xs text-muted-foreground">{b.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ── Pages List View ──────────────────────────────────────────────────────────
  return (
    <AdminLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Páginas del Sitio</h1>
            <p className="text-sm text-muted-foreground mt-1">{pages?.length ?? 0} páginas en el sitio</p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Cargando páginas...</div>
        ) : (
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Página</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">URL</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Última edición</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(pages || []).map((page: any) => (
                  <tr key={page.id} className="border-b border-border last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-muted-foreground" />
                        <span className="font-medium text-sm">{page.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">/{page.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!page.isPublished}
                          onCheckedChange={(checked) => upsertPageMutation.mutate({ slug: page.slug, title: page.title, isPublished: checked })}
                        />
                        <Badge variant={page.isPublished ? "default" : "secondary"} className="text-xs">
                          {page.isPublished ? "Publicada" : "En Desarrollo"}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {page.updatedAt ? new Date(page.updatedAt).toLocaleDateString("es-ES") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(`/${page.slug}`, "_blank")}>
                          <Globe size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setBlocks([]); setEditingSlug(page.slug); }}>
                          <Settings size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
