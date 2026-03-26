/**
 * LegoPacksManager — Backoffice de Lego Packs (v3)
 * Modal con 4 pestañas: General | Imágenes | Líneas | Configuración
 * El constructor de líneas está integrado dentro del modal de edición.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Plus, Search, Pencil, Trash2, Eye, EyeOff, Layers,
  X, Save, CheckSquare, Square, Image as ImageIcon, ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Image Upload Zone ─────────────────────────────────────────────────────────
function ImageUploadZone({ label, value, onChange, index }: {
  label: string; value: string; onChange: (url: string) => void; index: number;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("La imagen no puede superar 10 MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al subir");
      onChange(data.url);
      toast.success(`Imagen ${index} subida correctamente`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al subir imagen");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div
        className={cn(
          "relative border-2 border-dashed rounded-xl overflow-hidden cursor-pointer transition-all",
          "hover:border-primary/60 hover:bg-primary/5",
          value ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30",
          "h-28"
        )}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="w-full h-full object-cover" />
            <button
              type="button"
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
            {uploading ? (
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <ImageIcon className="w-6 h-6 opacity-40" />
                <span className="text-xs">Haz clic o arrastra</span>
              </>
            )}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type PackForm = {
  slug: string; title: string; subtitle: string; shortDescription: string; description: string;
  coverImageUrl: string; image1: string; image2: string; image3: string; image4: string;
  badge: string; priceLabel: string; targetAudience: string;
  availabilityMode: "strict" | "flexible";
  discountPercent: string; discountExpiresAt: string;
  isActive: boolean; isPublished: boolean; isFeatured: boolean; isPresentialSale: boolean; isOnlineSale: boolean;
  sortOrder: string; metaTitle: string; metaDescription: string;
};

const emptyForm: PackForm = {
  slug: "", title: "", subtitle: "", shortDescription: "", description: "",
  coverImageUrl: "", image1: "", image2: "", image3: "", image4: "",
  badge: "", priceLabel: "desde X€/persona", targetAudience: "",
  availabilityMode: "strict", discountPercent: "", discountExpiresAt: "",
  isActive: true, isPublished: false, isFeatured: false, isPresentialSale: true, isOnlineSale: false,
  sortOrder: "0", metaTitle: "", metaDescription: "",
};

type LineForm = {
  sourceType: "experience" | "pack"; sourceId: string; internalName: string; groupLabel: string;
  isActive: boolean; isRequired: boolean; isOptional: boolean; isClientEditable: boolean;
  isClientVisible: boolean; defaultQuantity: string; isQuantityEditable: boolean;
  discountType: "percent" | "fixed"; discountValue: string; frontendNote: string;
};

const emptyLineForm: LineForm = {
  sourceType: "experience", sourceId: "", internalName: "", groupLabel: "",
  isActive: true, isRequired: true, isOptional: false, isClientEditable: false, isClientVisible: true,
  defaultQuantity: "1", isQuantityEditable: false, discountType: "percent", discountValue: "0", frontendNote: "",
};

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LegoPacksManager() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PackForm>(emptyForm);
  const [activeTab, setActiveTab] = useState("general");

  // Line builder state (inside modal)
  const [showLineForm, setShowLineForm] = useState(false);
  const [editLineId, setEditLineId] = useState<number | null>(null);
  const [lineForm, setLineForm] = useState<LineForm>(emptyLineForm);
  const [productSearch, setProductSearch] = useState("");

  // Queries
  const { data: packs = [], refetch } = trpc.legoPacks.list.useQuery({});
  const { data: editingPack, refetch: refetchEditingPack } = trpc.legoPacks.get.useQuery(
    { id: editId! },
    { enabled: editId !== null }
  );
  const { data: pricing, refetch: refetchPricing } = trpc.legoPacks.calculatePrice.useQuery(
    { legoPackId: editId! },
    { enabled: editId !== null }
  );

  // Catalog for line builder
  const { data: experiences = [] } = trpc.products.getAll.useQuery();
  const { data: packProductsData } = trpc.packs.getAll.useQuery({ limit: 200, offset: 0 });
  const packProducts = (packProductsData as any)?.items ?? packProductsData ?? [];

  // Mutations
  const createMutation = trpc.legoPacks.create.useMutation({
    onSuccess: (created) => {
      toast.success("Lego Pack creado. Ahora puedes añadir líneas en la pestaña «Líneas».");
      refetch();
      // After creating, switch to edit mode so lines tab works
      setEditId(created.id);
      setActiveTab("lines");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.legoPacks.update.useMutation({
    onSuccess: () => { toast.success("Lego Pack actualizado"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.legoPacks.delete.useMutation({
    onSuccess: () => { toast.success("Lego Pack eliminado"); refetch(); setShowForm(false); setEditId(null); },
    onError: (e) => toast.error(e.message),
  });
  const togglePublishedMutation = trpc.legoPacks.togglePublished.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e.message),
  });
  const addLineMutation = trpc.legoPacks.addLine.useMutation({
    onSuccess: () => {
      toast.success("Línea añadida");
      refetchEditingPack(); refetchPricing();
      setShowLineForm(false); setLineForm(emptyLineForm); setProductSearch("");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateLineMutation = trpc.legoPacks.updateLine.useMutation({
    onSuccess: () => {
      toast.success("Línea actualizada");
      refetchEditingPack(); refetchPricing();
      setShowLineForm(false); setEditLineId(null); setProductSearch("");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteLineMutation = trpc.legoPacks.deleteLine.useMutation({
    onSuccess: () => { refetchEditingPack(); refetchPricing(); },
    onError: (e) => toast.error(e.message),
  });
  const toggleLineActiveMutation = trpc.legoPacks.updateLine.useMutation({
    onSuccess: () => { refetchEditingPack(); refetchPricing(); },
    onError: (e) => toast.error(e.message),
  });

  // Filtered packs list
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return packs.filter((p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [packs, search]);

  // Catalog options for line builder
  const catalogOptions = useMemo(() => {
    const q = productSearch.toLowerCase();
    const exps = (experiences as any[]).map((e: any) => ({ id: e.id, title: e.title, type: "experience" as const, price: e.basePrice }));
    const pkgs = (packProducts as any[]).map((p: any) => ({ id: p.id, title: p.title, type: "pack" as const, price: p.basePrice }));
    const all = lineForm.sourceType === "experience" ? exps : pkgs;
    if (!q) return all.slice(0, 30);
    return all.filter((o) => o.title.toLowerCase().includes(q)).slice(0, 30);
  }, [experiences, packProducts, lineForm.sourceType, productSearch]);

  // Sync form when editingPack loads
  useEffect(() => {
    if (editingPack && editId) {
      // Only sync non-line fields (lines are managed separately)
    }
  }, [editingPack, editId]);

  // Helpers
  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setActiveTab("general");
    setShowForm(true);
  };

  const openEdit = (p: typeof packs[0], tab = "general") => {
    setEditId(p.id);
    setForm({
      slug: p.slug, title: p.title, subtitle: p.subtitle ?? "", shortDescription: p.shortDescription ?? "",
      description: p.description ?? "", coverImageUrl: p.coverImageUrl ?? "",
      image1: p.image1 ?? "", image2: p.image2 ?? "", image3: p.image3 ?? "", image4: p.image4 ?? "",
      badge: p.badge ?? "", priceLabel: p.priceLabel ?? "", targetAudience: p.targetAudience ?? "",
      availabilityMode: p.availabilityMode as "strict" | "flexible",
      discountPercent: (p as any).discountPercent != null ? String((p as any).discountPercent) : "",
      discountExpiresAt: (p as any).discountExpiresAt
        ? new Date((p as any).discountExpiresAt as string | number | Date).toISOString().slice(0, 10)
        : "",
      isActive: p.isActive, isPublished: p.isPublished, isFeatured: p.isFeatured,
      isPresentialSale: p.isPresentialSale, isOnlineSale: p.isOnlineSale,
      sortOrder: String(p.sortOrder), metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "",
    });
    setActiveTab(tab);
    setShowForm(true);
  };

  const handleSave = () => {
    const payload = {
      ...form,
      sortOrder: parseInt(form.sortOrder) || 0,
      discountPercent: form.discountPercent || null,
      discountExpiresAt: form.discountExpiresAt || null,
    };
    if (editId) updateMutation.mutate({ id: editId, ...payload });
    else createMutation.mutate(payload);
  };

  const openAddLine = () => {
    setEditLineId(null);
    setLineForm(emptyLineForm);
    setProductSearch("");
    setShowLineForm(true);
  };

  const openEditLine = (line: NonNullable<typeof editingPack>["lines"][0]) => {
    setEditLineId(line.id);
    setLineForm({
      sourceType: line.sourceType as "experience" | "pack",
      sourceId: String(line.sourceId),
      internalName: line.internalName ?? "",
      groupLabel: line.groupLabel ?? "",
      isActive: line.isActive,
      isRequired: line.isRequired,
      isOptional: line.isOptional,
      isClientEditable: line.isClientEditable,
      isClientVisible: line.isClientVisible,
      defaultQuantity: String(line.defaultQuantity),
      isQuantityEditable: line.isQuantityEditable,
      discountType: line.discountType as "percent" | "fixed",
      discountValue: String(line.discountValue),
      frontendNote: line.frontendNote ?? "",
    });
    setProductSearch("");
    setShowLineForm(true);
  };

  const handleSaveLine = () => {
    if (!editId) return;
    const payload = {
      legoPackId: editId,
      sourceType: lineForm.sourceType,
      sourceId: parseInt(lineForm.sourceId),
      internalName: lineForm.internalName || null,
      groupLabel: lineForm.groupLabel || null,
      isActive: lineForm.isActive,
      isRequired: lineForm.isRequired,
      isOptional: lineForm.isOptional,
      isClientEditable: lineForm.isClientEditable,
      isClientVisible: lineForm.isClientVisible,
      defaultQuantity: parseInt(lineForm.defaultQuantity) || 1,
      isQuantityEditable: lineForm.isQuantityEditable,
      discountType: lineForm.discountType,
      discountValue: parseFloat(lineForm.discountValue) || 0,
      frontendNote: lineForm.frontendNote || null,
    };
    if (editLineId) updateLineMutation.mutate({ id: editLineId, ...payload });
    else addLineMutation.mutate(payload);
  };

  const toggleLineActive = (line: NonNullable<typeof editingPack>["lines"][0]) => {
    toggleLineActiveMutation.mutate({
      id: line.id,
      legoPackId: editId!,
      sourceType: line.sourceType as "experience" | "pack",
      sourceId: line.sourceId,
      isActive: !line.isActive,
    });
  };

  const lines = editingPack?.lines ?? [];

  return (
    <AdminLayout title="Lego Packs">
      {/* ── Pack list ── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar Lego Pack..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo Lego Pack
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Layers className="w-16 h-16 opacity-20" />
            <p className="text-lg font-medium">No hay Lego Packs creados</p>
            <p className="text-sm">Crea tu primer Lego Pack para componer experiencias personalizadas.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-4 flex flex-col gap-3 hover:border-accent/50 transition-all">
                {p.coverImageUrl && (
                  <div className="h-32 rounded-lg overflow-hidden bg-muted">
                    <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{p.slug}</div>
                  </div>
                  <Badge variant={p.isPublished ? "default" : "secondary"} className="text-xs flex-shrink-0">
                    {p.isPublished ? "Publicado" : "Borrador"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    <ListChecks className="w-3 h-3 mr-1" />
                    {(p as any).lineCount ?? 0} líneas
                  </Badge>
                  {(p as any).discountPercent && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                      -{(p as any).discountPercent}%
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1 mt-auto">
                  <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => openEdit(p, "general")}>
                    <Pencil className="w-3 h-3 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => openEdit(p, "lines")}>
                    <ListChecks className="w-3 h-3 mr-1" /> Líneas
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0 text-xs"
                    title={p.isPublished ? "Ocultar" : "Publicar"}
                    onClick={() => togglePublishedMutation.mutate({ id: p.id, isPublished: !p.isPublished })}
                  >
                    {p.isPublished ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => { if (confirm("¿Eliminar este Lego Pack?")) deleteMutation.mutate({ id: p.id }); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ Pack form dialog (4 tabs: General | Imágenes | Líneas | Configuración) ══ */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? `Editar: ${form.title || "Lego Pack"}` : "Nuevo Lego Pack"}</DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="media">Imágenes</TabsTrigger>
              <TabsTrigger value="lines" disabled={!editId}>
                Líneas {editId && lines.length > 0 && <Badge className="ml-1.5 text-xs h-4 px-1">{lines.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="config">Configuración</TabsTrigger>
            </TabsList>

            {/* ── General ── */}
            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Título *</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => {
                      const title = e.target.value;
                      const autoSlug = title.toLowerCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                        .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
                      setForm({ ...form, title, slug: editId ? form.slug : autoSlug });
                    }}
                    placeholder="Day Pass Náyade"
                  />
                </div>
                <div>
                  <Label>Slug *</Label>
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="day-pass-nayade" />
                  <p className="text-xs text-muted-foreground mt-1">Auto-generado desde el título</p>
                </div>
              </div>
              <div>
                <Label>Subtítulo</Label>
                <Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
              </div>
              <div>
                <Label>Descripción corta</Label>
                <Textarea rows={2} value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
              </div>
              <div>
                <Label>Descripción completa</Label>
                <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Badge / Etiqueta</Label>
                  <Input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="¡Más vendido!" />
                </div>
                <div>
                  <Label>Etiqueta de precio</Label>
                  <Input value={form.priceLabel} onChange={(e) => setForm({ ...form, priceLabel: e.target.value })} placeholder="desde 45€/persona" />
                </div>
              </div>
              <div>
                <Label>Público objetivo</Label>
                <Input value={form.targetAudience} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })} placeholder="Familias y amigos" />
              </div>

              {/* Descuento promocional */}
              <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-700 flex items-center gap-1.5 mb-3">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-xs font-bold">%</span>
                  Descuento promocional
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Descuento (%)</label>
                    <div className="relative mt-1">
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={form.discountPercent}
                        onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
                        placeholder="Ej: 10"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Válido hasta</label>
                    <input
                      type="date"
                      value={form.discountExpiresAt}
                      onChange={(e) => setForm({ ...form, discountExpiresAt: e.target.value })}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm mt-1"
                    />
                  </div>
                </div>
                {form.discountPercent && (
                  <p className="text-xs text-amber-600 mt-2">
                    El precio con descuento se calculará automáticamente.
                    {!form.discountExpiresAt && " Sin fecha de caducidad: activo indefinidamente."}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancelar</Button>
                <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" />
                  {editId ? "Guardar cambios" : "Crear Lego Pack"}
                </Button>
              </div>
            </TabsContent>

            {/* ── Imágenes ── */}
            <TabsContent value="media" className="space-y-4 mt-4">
              <p className="text-xs text-muted-foreground">Haz clic en cada zona para subir una imagen, o arrástrala directamente. Formatos: JPG, PNG, WEBP. Máx. 10 MB.</p>
              <div>
                <p className="text-sm font-medium mb-2">Imagen de portada</p>
                <ImageUploadZone label="Portada" value={form.coverImageUrl} onChange={(url) => setForm(f => ({ ...f, coverImageUrl: url }))} index={0} />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Galería de imágenes</p>
                <div className="grid grid-cols-2 gap-3">
                  <ImageUploadZone label="Imagen 1" value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} index={1} />
                  <ImageUploadZone label="Imagen 2" value={form.image2} onChange={(url) => setForm(f => ({ ...f, image2: url }))} index={2} />
                  <ImageUploadZone label="Imagen 3" value={form.image3} onChange={(url) => setForm(f => ({ ...f, image3: url }))} index={3} />
                  <ImageUploadZone label="Imagen 4" value={form.image4} onChange={(url) => setForm(f => ({ ...f, image4: url }))} index={4} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cerrar</Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Guardar cambios
                </Button>
              </div>
            </TabsContent>

            {/* ── Líneas ── */}
            <TabsContent value="lines" className="mt-4">
              {!editId ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Guarda el pack primero para poder añadir líneas.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Price summary */}
                  {pricing && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border bg-card p-3">
                        <div className="text-xs text-muted-foreground">Precio base total</div>
                        <div className="text-lg font-bold">{(pricing as any).totalOriginal?.toFixed(2)} €</div>
                      </div>
                      <div className="rounded-lg border bg-card p-3">
                        <div className="text-xs text-muted-foreground">Descuento total</div>
                        <div className="text-lg font-bold text-orange-500">-{(pricing as any).totalDiscount?.toFixed(2)} €</div>
                      </div>
                      <div className="rounded-lg border bg-accent/10 border-accent/30 p-3">
                        <div className="text-xs text-muted-foreground">Precio final pack</div>
                        <div className="text-lg font-bold text-accent">{(pricing as any).totalFinal?.toFixed(2)} €</div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{lines.length} líneas configuradas</p>
                    <Button size="sm" onClick={openAddLine}>
                      <Plus className="w-4 h-4 mr-1" /> Añadir línea
                    </Button>
                  </div>

                  {/* Lines table */}
                  <div className="rounded-lg border bg-card overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium w-8">Act.</th>
                          <th className="text-left px-3 py-2 font-medium">Producto</th>
                          <th className="text-left px-3 py-2 font-medium">Grupo</th>
                          <th className="text-left px-3 py-2 font-medium">Qty</th>
                          <th className="text-left px-3 py-2 font-medium">Dto.</th>
                          <th className="text-left px-3 py-2 font-medium">Precio</th>
                          <th className="text-left px-3 py-2 font-medium">Flags</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center py-10 text-muted-foreground">
                              Sin líneas. Pulsa «Añadir línea» para componer este pack.
                            </td>
                          </tr>
                        )}
                        {lines.map((line) => {
                          const pricingLine = (pricing as any)?.lines?.find((l: any) => l.lineId === line.id);
                          return (
                            <tr key={line.id} className={cn("border-t hover:bg-muted/30 transition-colors", !line.isActive && "opacity-50 bg-muted/20")}>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleLineActive(line)}
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title={line.isActive ? "Desactivar línea" : "Activar línea"}
                                >
                                  {line.isActive
                                    ? <CheckSquare className="w-4 h-4 text-green-600" />
                                    : <Square className="w-4 h-4" />
                                  }
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium">{pricingLine?.sourceName ?? `ID ${line.sourceId}`}</div>
                                <div className="text-xs text-muted-foreground">{line.internalName || line.sourceType}</div>
                              </td>
                              <td className="px-3 py-2">
                                {line.groupLabel
                                  ? <Badge variant="outline" className="text-xs">{line.groupLabel}</Badge>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-3 py-2">{line.defaultQuantity}</td>
                              <td className="px-3 py-2">
                                {parseFloat(String(line.discountValue)) > 0
                                  ? <span className="text-orange-500 font-medium">{line.discountType === "percent" ? `${line.discountValue}%` : `${line.discountValue}€`}</span>
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {pricingLine ? `${pricingLine.finalPrice.toFixed(2)} €` : "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex gap-1 flex-wrap">
                                  {line.isRequired && <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200">Req</Badge>}
                                  {line.isOptional && <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">Opt</Badge>}
                                  {!line.isClientVisible && <Badge variant="outline" className="text-xs bg-gray-50 text-gray-500 border-gray-200">Oculto</Badge>}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditLine(line)}>
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                    onClick={() => { if (confirm("¿Eliminar esta línea?")) deleteLineMutation.mutate({ id: line.id }); }}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pricing detail */}
                  {pricing && (pricing as any).lines?.length > 0 && (
                    <div className="rounded-lg border bg-card p-4">
                      <h3 className="font-semibold mb-3 text-sm">Desglose de precios por línea</h3>
                      <div className="space-y-2">
                        {(pricing as any).lines.map((l: any) => (
                          <div key={l.lineId} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{l.groupLabel ? `[${l.groupLabel}]` : ""}</span>
                              <span>{l.sourceName}</span>
                              {l.isOptional && <Badge variant="outline" className="text-xs">opcional</Badge>}
                            </div>
                            <div className="flex items-center gap-3 text-right">
                              {l.discountAmount > 0 && (
                                <span className="text-muted-foreground line-through text-xs">{l.basePrice.toFixed(2)} €</span>
                              )}
                              <span className="font-medium">{l.finalPrice.toFixed(2)} €</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── Configuración ── */}
            <TabsContent value="config" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Modo disponibilidad</Label>
                  <Select value={form.availabilityMode} onValueChange={(v) => setForm({ ...form, availabilityMode: v as "strict" | "flexible" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict">Estricto (todas las líneas deben estar disponibles)</SelectItem>
                      <SelectItem value="flexible">Flexible (permite líneas no disponibles)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Orden</Label>
                  <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(["isActive", "isPublished", "isFeatured", "isPresentialSale", "isOnlineSale"] as const).map((key) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="cursor-pointer">{
                      key === "isActive" ? "Activo" :
                      key === "isPublished" ? "Publicado" :
                      key === "isFeatured" ? "Destacado" :
                      key === "isPresentialSale" ? "Venta presencial (TPV)" :
                      "Venta online"
                    }</Label>
                    <Switch checked={form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: v })} />
                  </div>
                ))}
              </div>
              <div>
                <Label>Meta título (SEO)</Label>
                <Input value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} />
              </div>
              <div>
                <Label>Meta descripción (SEO)</Label>
                <Textarea rows={2} value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancelar</Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Guardar cambios
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ══ Line form dialog ══ */}
      <Dialog open={showLineForm} onOpenChange={(v) => { if (!v) { setShowLineForm(false); setEditLineId(null); setProductSearch(""); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editLineId ? "Editar línea" : "Añadir línea al pack"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Tipo de producto */}
            <div>
              <Label>Tipo de producto</Label>
              <div className="flex gap-2 mt-1">
                {(["experience", "pack"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setLineForm({ ...lineForm, sourceType: type, sourceId: "" })}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all",
                      lineForm.sourceType === type
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border hover:border-accent/50"
                    )}
                  >
                    {type === "experience" ? "🌊 Experiencia" : "⭐ Pack simple"}
                  </button>
                ))}
              </div>
            </div>

            {/* Buscador de productos del catálogo */}
            <div>
              <Label>Buscar producto del catálogo *</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder={`Buscar ${lineForm.sourceType === "experience" ? "experiencia" : "pack"}...`}
                  className="pl-9"
                />
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto border rounded-lg divide-y bg-background">
                {catalogOptions.length === 0 && (
                  <div className="text-center text-muted-foreground py-4 text-sm">
                    {productSearch ? "Sin resultados" : `Escribe para buscar ${lineForm.sourceType === "experience" ? "experiencias" : "packs"}...`}
                  </div>
                )}
                {catalogOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setLineForm({ ...lineForm, sourceId: String(opt.id), internalName: lineForm.internalName || opt.title });
                      setProductSearch(opt.title);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between",
                      lineForm.sourceId === String(opt.id) && "bg-accent/10 text-accent font-medium"
                    )}
                  >
                    <span>{opt.title}</span>
                    <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                      {opt.price ? `${parseFloat(opt.price as string).toFixed(2)} €` : ""}
                    </span>
                  </button>
                ))}
              </div>
              {lineForm.sourceId && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckSquare className="w-3 h-3" />
                  Producto seleccionado (ID {lineForm.sourceId})
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nombre interno</Label>
                <Input value={lineForm.internalName} onChange={(e) => setLineForm({ ...lineForm, internalName: e.target.value })} placeholder="ej: Alojamiento 2 noches" />
              </div>
              <div>
                <Label>Etiqueta de grupo</Label>
                <Input value={lineForm.groupLabel} onChange={(e) => setLineForm({ ...lineForm, groupLabel: e.target.value })} placeholder="ej: alojamiento, actividad, spa" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Cantidad por defecto</Label>
                <Input type="number" min={1} value={lineForm.defaultQuantity} onChange={(e) => setLineForm({ ...lineForm, defaultQuantity: e.target.value })} />
              </div>
              <div>
                <Label>Tipo de descuento</Label>
                <Select value={lineForm.discountType} onValueChange={(v) => setLineForm({ ...lineForm, discountType: v as "percent" | "fixed" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Porcentaje (%)</SelectItem>
                    <SelectItem value="fixed">Importe fijo (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Valor de descuento</Label>
              <Input type="number" min={0} step="0.01" value={lineForm.discountValue} onChange={(e) => setLineForm({ ...lineForm, discountValue: e.target.value })} />
            </div>
            <div>
              <Label>Nota para el cliente (frontend)</Label>
              <Textarea rows={2} value={lineForm.frontendNote} onChange={(e) => setLineForm({ ...lineForm, frontendNote: e.target.value })} placeholder="Texto informativo visible al cliente..." />
            </div>

            {/* Flags */}
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "isActive" as const, label: "Línea activa" },
                { key: "isRequired" as const, label: "Obligatoria (no se puede quitar)" },
                { key: "isOptional" as const, label: "Opcional (cliente puede quitar)" },
                { key: "isClientEditable" as const, label: "Cliente puede editar" },
                { key: "isClientVisible" as const, label: "Visible para el cliente" },
                { key: "isQuantityEditable" as const, label: "Cantidad editable" },
              ]).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between rounded-lg border p-2">
                  <Label className="text-xs cursor-pointer">{label}</Label>
                  <Switch checked={lineForm[key]} onCheckedChange={(v) => setLineForm({ ...lineForm, [key]: v })} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => { setShowLineForm(false); setEditLineId(null); setProductSearch(""); }}>Cancelar</Button>
            <Button onClick={handleSaveLine} disabled={addLineMutation.isPending || updateLineMutation.isPending || !lineForm.sourceId}>
              <Save className="w-4 h-4 mr-2" />
              {editLineId ? "Guardar cambios" : "Añadir línea"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
