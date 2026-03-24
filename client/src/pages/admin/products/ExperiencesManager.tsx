import { useState, useRef } from "react";
import { Plus, Pencil, Trash2, Star, Eye, EyeOff, Search, ImageIcon, X, MoreVertical, Copy, PowerOff, Power, ChevronUp, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdminLayout from "@/components/AdminLayout";
import SupplierSelect from "@/components/SupplierSelect";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const difficultyColors: Record<string, string> = {
  facil: "bg-emerald-100 text-emerald-700",
  moderado: "bg-amber-100 text-amber-700",
  dificil: "bg-red-100 text-red-700",
  experto: "bg-purple-100 text-purple-700",
};

const difficultyLabels: Record<string, string> = {
  facil: "Fácil",
  moderado: "Moderado",
  dificil: "Difícil",
  experto: "Experto",
};

type ExpForm = {
  slug: string; title: string; shortDescription: string; description: string;
  categoryId: string; locationId: string;
  image1: string; image2: string; image3: string; image4: string;
  basePrice: string; duration: string; minPersons: string; maxPersons: string;
  difficulty: string; isFeatured: boolean; isActive: boolean;
  includes: string[]; excludes: string[];
  discountPercent: string; discountExpiresAt: string;
  fiscalRegime: string; productType: string;
  providerPercent: string; agencyMarginPercent: string;
  supplierId: string;
  supplierCommissionPercent: string;
  supplierCostType: string;
  settlementFrequency: string;
  isSettlable: boolean;
};

const emptyForm: ExpForm = {
  slug: "", title: "", shortDescription: "", description: "",
  categoryId: "", locationId: "",
  image1: "", image2: "", image3: "", image4: "",
  basePrice: "", duration: "", minPersons: "1", maxPersons: "",
  difficulty: "facil", isFeatured: false, isActive: true,
  includes: [], excludes: [],
  discountPercent: "", discountExpiresAt: "",
  fiscalRegime: "general", productType: "actividad",
  providerPercent: "", agencyMarginPercent: "",
  supplierId: "", supplierCommissionPercent: "",
  supplierCostType: "comision_sobre_venta", settlementFrequency: "mensual",
  isSettlable: false,
};

// ── Componente de zona de upload de imagen ──────────────────────────────────
function ImageUploadZone({
  label, value, onChange, index,
}: { label: string; value: string; onChange: (url: string) => void; index: number }) {
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

export default function ExperiencesManager() {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [cloneModal, setCloneModal] = useState<{ id: number; originalName: string } | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const { data: experiences, refetch } = trpc.products.getAll.useQuery();

  // Sincronizar orden local cuando llegan datos
  const utils = trpc.useUtils();
  const { data: categories } = trpc.products.getCategories.useQuery();
  const { data: locations } = trpc.products.getLocations.useQuery();

  const createMutation = trpc.products.create.useMutation({
    onSuccess: () => { toast.success("Experiencia creada"); refetch(); setShowModal(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message || "Error al crear la experiencia"),
  });
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => { toast.success("Experiencia actualizada"); refetch(); setShowModal(false); setEditingId(null); },
    onError: (e) => toast.error(e.message || "Error al actualizar"),
  });
  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: () => { toast.success("Experiencia desactivada"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });
  const hardDeleteMutation = trpc.products.hardDelete.useMutation({
    onSuccess: () => { toast.success("Experiencia eliminada permanentemente"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });
  const toggleActiveMutation = trpc.products.toggleActive.useMutation({
    onSuccess: (_, vars) => { toast.success(vars.isActive ? "Experiencia activada" : "Experiencia desactivada"); refetch(); },
    onError: () => toast.error("Error al cambiar estado"),
  });
  const cloneMutation = trpc.products.clone.useMutation({
    onSuccess: () => { toast.success("Experiencia clonada correctamente (inactiva, lista para editar)"); refetch(); setCloneModal(null); setCloneName(""); },
    onError: () => toast.error("Error al clonar"),
  });
  const reorderMutation = trpc.products.reorder.useMutation({
    onSuccess: () => { utils.products.getAll.invalidate(); },
    onError: () => toast.error("Error al guardar el orden"),
  });

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (exp: Record<string, unknown>) => {
    setEditingId(Number(exp.id));
    setForm({
      slug: String(exp.slug ?? ""), title: String(exp.title ?? ""),
      shortDescription: String(exp.shortDescription ?? ""),
      description: String(exp.description ?? ""),
      categoryId: String(exp.categoryId ?? ""),
      locationId: String(exp.locationId ?? ""),
      image1: String(exp.image1 ?? exp.coverImageUrl ?? ""),
      image2: String(exp.image2 ?? ""),
      image3: String(exp.image3 ?? ""),
      image4: String(exp.image4 ?? ""),
      basePrice: String(exp.basePrice ?? ""),
      duration: String(exp.duration ?? ""),
      minPersons: String(exp.minPersons ?? "1"),
      maxPersons: String(exp.maxPersons ?? ""),
      difficulty: String(exp.difficulty ?? "facil"),
      isFeatured: Boolean(exp.isFeatured),
      isActive: Boolean(exp.isActive),
      includes: Array.isArray(exp.includes) ? (exp.includes as string[]) : [],
      excludes: Array.isArray(exp.excludes) ? (exp.excludes as string[]) : [],
      discountPercent: exp.discountPercent != null ? String(exp.discountPercent) : "",
      discountExpiresAt: exp.discountExpiresAt
        ? new Date(exp.discountExpiresAt as string | number | Date).toISOString().slice(0, 10)
        : "",
      fiscalRegime: String(exp.fiscalRegime ?? "general"),
      productType: String(exp.productType ?? "actividad"),
      providerPercent: exp.providerPercent != null ? String(exp.providerPercent) : "",
      agencyMarginPercent: exp.agencyMarginPercent != null ? String(exp.agencyMarginPercent) : "",
      supplierId: exp.supplierId != null ? String(exp.supplierId) : "",
      supplierCommissionPercent: exp.supplierCommissionPercent != null ? String(exp.supplierCommissionPercent) : "",
      supplierCostType: String(exp.supplierCostType ?? "comision_sobre_venta"),
      settlementFrequency: String(exp.settlementFrequency ?? "mensual"),
      isSettlable: Boolean(exp.isSettlable),
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.basePrice || !form.categoryId || !form.locationId) {
      toast.error("Rellena los campos obligatorios"); return;
    }
    const data = {
      slug: form.slug || form.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      title: form.title,
      shortDescription: form.shortDescription || undefined,
      description: form.description || undefined,
      categoryId: parseInt(form.categoryId),
      locationId: parseInt(form.locationId),
      image1: form.image1 || undefined,
      image2: form.image2 || undefined,
      image3: form.image3 || undefined,
      image4: form.image4 || undefined,
      basePrice: form.basePrice,
      duration: form.duration || undefined,
      minPersons: form.minPersons ? parseInt(form.minPersons) : undefined,
      maxPersons: form.maxPersons ? parseInt(form.maxPersons) : undefined,
      difficulty: form.difficulty as "facil" | "moderado" | "dificil" | "experto",
      isFeatured: form.isFeatured,
      isActive: form.isActive,
      includes: form.includes.filter(s => s.trim() !== ""),
      excludes: form.excludes.filter(s => s.trim() !== ""),
      discountPercent: form.discountPercent ? form.discountPercent : undefined,
      discountExpiresAt: form.discountExpiresAt ? form.discountExpiresAt : undefined,
      fiscalRegime: form.fiscalRegime as "general" | "reav",
      productType: form.productType,
      providerPercent: form.providerPercent ? form.providerPercent : undefined,
      agencyMarginPercent: form.agencyMarginPercent ? form.agencyMarginPercent : undefined,
      supplierId: form.supplierId ? parseInt(form.supplierId) : undefined,
      supplierCommissionPercent: form.supplierCommissionPercent ? form.supplierCommissionPercent : undefined,
      supplierCostType: form.supplierCostType || undefined,
      settlementFrequency: form.settlementFrequency || undefined,
      isSettlable: form.isSettlable,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  // Mantener orden local: inicializar cuando llegan datos
  const sortedExperiences = (() => {
    const list = experiences ?? [];
    if (localOrder.length === list.length && localOrder.length > 0) {
      const map = new Map(list.map(e => [e.id, e]));
      return localOrder.map(id => map.get(id)).filter(Boolean) as typeof list;
    }
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  })();

  const filtered = sortedExperiences.filter((e) =>
    !search || e.title.toLowerCase().includes(search.toLowerCase())
  );

  const moveItem = (index: number, direction: "up" | "down") => {
    const current = localOrder.length > 0 ? localOrder : sortedExperiences.map(e => e.id);
    const newOrder = [...current];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    setLocalOrder(newOrder);
    const items = newOrder.map((id, i) => ({ id, sortOrder: i }));
    reorderMutation.mutate({ items });
  };

  return (
    <AdminLayout title="Gestión de Experiencias">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar experiencias..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
        </div>
        <Button onClick={openCreate} style={{ background: "linear-gradient(135deg,#f97316,#f59e0b)", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600 }}>
          <Plus className="w-4 h-4 mr-2" />
          Nueva Experiencia
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-16">Orden</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Experiencia</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Precio</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dificultad</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <ImageIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No hay experiencias. Crea la primera.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((exp, idx) => (
                  <tr key={exp.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-4">
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => moveItem(idx, "up")}
                          disabled={idx === 0 || reorderMutation.isPending}
                          className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Subir"
                        >
                          <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <span className="text-xs font-mono text-muted-foreground w-5 text-center">{idx + 1}</span>
                        <button
                          onClick={() => moveItem(idx, "down")}
                          disabled={idx === filtered.length - 1 || reorderMutation.isPending}
                          className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Bajar"
                        >
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-9 rounded-lg overflow-hidden bg-muted shrink-0">
                          {((exp as Record<string,unknown>).image1 || exp.coverImageUrl) ? (
                            <img src={String((exp as Record<string,unknown>).image1 ?? exp.coverImageUrl)} alt={exp.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-foreground">{exp.title}</p>
                          <p className="text-xs text-muted-foreground">{exp.slug}</p>
                        </div>
                        {exp.isFeatured && (
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-semibold text-foreground">{parseFloat(exp.basePrice).toFixed(0)}€</span>
                    </td>
                    <td className="px-4 py-4">
                      {exp.difficulty && (
                        <Badge className={cn("text-xs", difficultyColors[exp.difficulty] ?? "")}>
                          {difficultyLabels[exp.difficulty] ?? exp.difficulty}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <Badge className={exp.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}>
                        {exp.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="w-8 h-8">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => openEdit(exp)}>
                              <Pencil className="w-3.5 h-3.5 mr-2" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleActiveMutation.mutate({ id: exp.id, isActive: !exp.isActive })}>
                              {exp.isActive
                                ? <><PowerOff className="w-3.5 h-3.5 mr-2" /> Desactivar</>
                                : <><Power className="w-3.5 h-3.5 mr-2" /> Activar</>}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCloneModal({ id: exp.id, originalName: exp.title }); setCloneName(""); }}>
                              <Copy className="w-3.5 h-3.5 mr-2" /> Clonar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => { if (confirm("¿Eliminar permanentemente esta experiencia? Esta acción no se puede deshacer.")) hardDeleteMutation.mutate({ id: exp.id }); }}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Borrar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{editingId ? "Editar Experiencia" : "Nueva Experiencia"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5 mt-2">
            {/* 4 zonas de upload de imágenes */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Imágenes del carrusel (hasta 4)</Label>
              <div className="grid grid-cols-2 gap-3">
                <ImageUploadZone label="Imagen 1 (principal)" value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} index={1} />
                <ImageUploadZone label="Imagen 2" value={form.image2} onChange={(url) => setForm(f => ({ ...f, image2: url }))} index={2} />
                <ImageUploadZone label="Imagen 3" value={form.image3} onChange={(url) => setForm(f => ({ ...f, image3: url }))} index={3} />
                <ImageUploadZone label="Imagen 4" value={form.image4} onChange={(url) => setForm(f => ({ ...f, image4: url }))} index={4} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="title">Título *</Label>
                <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="slug">Slug (URL)</Label>
                <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1" placeholder="auto-generado" />
              </div>
              <div>
                <Label htmlFor="basePrice">Precio Base (€) *</Label>
                <Input id="basePrice" type="number" step="0.01" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required className="mt-1" />
              </div>
              <div>
                <Label>Categoría *</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ubicación *</Label>
                <Select value={form.locationId} onValueChange={(v) => setForm({ ...form, locationId: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {(locations ?? []).map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="duration">Duración</Label>
                <Input id="duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className="mt-1" placeholder="Ej: 1 día" />
              </div>
              <div>
                <Label>Dificultad</Label>
                <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="facil">Fácil</SelectItem>
                    <SelectItem value="moderado">Moderado</SelectItem>
                    <SelectItem value="dificil">Difícil</SelectItem>
                    <SelectItem value="experto">Experto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="minPersons">Mín. Personas</Label>
                <Input id="minPersons" type="number" value={form.minPersons} onChange={(e) => setForm({ ...form, minPersons: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="maxPersons">Máx. Personas</Label>
                <Input id="maxPersons" type="number" value={form.maxPersons} onChange={(e) => setForm({ ...form, maxPersons: e.target.value })} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="shortDescription">Descripción Corta</Label>
                <Input id="shortDescription" value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="description">Descripción Completa</Label>
                <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" rows={4} />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isFeatured} onCheckedChange={(v) => setForm({ ...form, isFeatured: v })} />
                <Label>Destacado en Home</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                <Label>Activo</Label>
              </div>

              {/* Descuento */}
              <div className="col-span-2">
                <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4">
                  <Label className="text-sm font-semibold text-amber-700 flex items-center gap-1.5 mb-3">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-xs font-bold">%</span>
                    Descuento promocional
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="discountPercent" className="text-xs text-muted-foreground">Descuento (%)</Label>
                      <div className="relative mt-1">
                        <Input
                          id="discountPercent"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={form.discountPercent}
                          onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
                          placeholder="Ej: 10"
                          className="pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="discountExpiresAt" className="text-xs text-muted-foreground">Válido hasta</Label>
                      <Input
                        id="discountExpiresAt"
                        type="date"
                        value={form.discountExpiresAt}
                        onChange={(e) => setForm({ ...form, discountExpiresAt: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  {form.discountPercent && (
                    <p className="text-xs text-amber-600 mt-2">
                      El precio con descuento se calculará automáticamente y se mostrará en la ficha pública.
                      {!form.discountExpiresAt && " Sin fecha de caducidad: el descuento estará activo indefinidamente."}
                    </p>
                  )}
                </div>
              </div>

              {/* Régimen Fiscal */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-blue-700 flex items-center gap-1.5 mb-3">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-xs">💶</span>
                  Régimen Fiscal
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Régimen</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background"
                      value={form.fiscalRegime}
                      onChange={(e) => setForm({ ...form, fiscalRegime: e.target.value })}
                    >
                      <option value="general">Régimen General (IVA)</option>
                      <option value="reav">REAV — Régimen Especial Agencias de Viaje</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Tipo de producto</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background"
                      value={form.productType}
                      onChange={(e) => setForm({ ...form, productType: e.target.value })}
                    >
                      <option value="actividad">Actividad / Experiencia</option>
                      <option value="alojamiento">Alojamiento</option>
                      <option value="restauracion">Restauración</option>
                      <option value="transporte">Transporte</option>
                      <option value="pack">Pack combinado</option>
                    </select>
                  </div>
                </div>
                {form.fiscalRegime === "reav" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Coste proveedor (% sobre PVP)</Label>
                      <Input
                        type="number" min="0" max="100" step="0.01"
                        placeholder="Ej: 70"
                        value={form.providerPercent}
                        onChange={(e) => setForm({ ...form, providerPercent: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Margen agencia (% sobre PVP)</Label>
                      <Input
                        type="number" min="0" max="100" step="0.01"
                        placeholder="Ej: 30"
                        value={form.agencyMarginPercent}
                        onChange={(e) => setForm({ ...form, agencyMarginPercent: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
                {form.fiscalRegime === "reav" && (
                  <p className="text-xs text-blue-600 mt-2 bg-blue-50 rounded-lg px-3 py-2">
                    ⚠️ Este producto tributa bajo REAV. La factura no mostrará IVA al cliente. Se generará un expediente REAV automáticamente al facturar.
                  </p>
                )}
              </div>

              {/* Proveedor y Liquidaciones */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-violet-700 flex items-center gap-1.5 mb-3">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-100 text-violet-600 text-xs">🏢</span>
                  Proveedor y Liquidaciones
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Proveedor</Label>
                    <SupplierSelect
                      value={form.supplierId}
                      onChange={(v) => setForm({ ...form, supplierId: v })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Tipo de coste</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background"
                      value={form.supplierCostType}
                      onChange={(e) => setForm({ ...form, supplierCostType: e.target.value })}
                    >
                      <option value="comision_sobre_venta">Comisión sobre venta (%)</option>
                      <option value="precio_neto">Precio neto fijo</option>
                      <option value="precio_neto_variable">Precio neto variable</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Comisión / margen (%)</Label>
                    <Input
                      type="number" min="0" max="100" step="0.01"
                      placeholder="Ej: 20"
                      value={form.supplierCommissionPercent}
                      onChange={(e) => setForm({ ...form, supplierCommissionPercent: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Frecuencia de liquidación</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background"
                      value={form.settlementFrequency}
                      onChange={(e) => setForm({ ...form, settlementFrequency: e.target.value })}
                    >
                      <option value="mensual">Mensual</option>
                      <option value="quincenal">Quincenal</option>
                      <option value="semanal">Semanal</option>
                      <option value="por_reserva">Por reserva</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <Switch
                    checked={form.isSettlable}
                    onCheckedChange={(v) => setForm({ ...form, isSettlable: v })}
                  />
                  <Label className="text-sm text-slate-600">Incluir en liquidaciones automáticas</Label>
                </div>
              </div>

              {/* Incluye */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5 mb-2">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 text-xs">✓</span>
                  Incluye
                </Label>
                <div className="space-y-2">
                  {form.includes.map((item, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={item}
                        onChange={(e) => {
                          const next = [...form.includes];
                          next[i] = e.target.value;
                          setForm(f => ({ ...f, includes: next }));
                        }}
                        placeholder={`Item ${i + 1}`}
                        className="flex-1 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setForm(f => ({ ...f, includes: f.includes.filter((_, idx) => idx !== i) }))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
                    onClick={() => setForm(f => ({ ...f, includes: [...f.includes, ""] }))}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Añadir item
                  </Button>
                </div>
              </div>

              {/* No incluye */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-red-600 flex items-center gap-1.5 mb-2">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-100 text-red-500 text-xs">✕</span>
                  No incluye
                </Label>
                <div className="space-y-2">
                  {form.excludes.map((item, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={item}
                        onChange={(e) => {
                          const next = [...form.excludes];
                          next[i] = e.target.value;
                          setForm(f => ({ ...f, excludes: next }));
                        }}
                        placeholder={`Item ${i + 1}`}
                        className="flex-1 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setForm(f => ({ ...f, excludes: f.excludes.filter((_, idx) => idx !== i) }))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                    onClick={() => setForm(f => ({ ...f, excludes: [...f.excludes, ""] }))}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Añadir item
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="flex-1" style={{ background: "linear-gradient(135deg,#f97316,#f59e0b)", color: "#fff", border: "none", fontWeight: 600 }}>
                {editingId ? "Guardar Cambios" : "Crear Experiencia"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de clonación con nombre */}
      <Dialog open={!!cloneModal} onOpenChange={(open) => { if (!open) { setCloneModal(null); setCloneName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5 text-primary" /> Clonar experiencia
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Clonando: <strong>{cloneModal?.originalName}</strong>
            </p>
            <div>
              <Label htmlFor="cloneName">Nombre de la nueva experiencia</Label>
              <Input
                id="cloneName"
                autoFocus
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cloneName.trim() && cloneModal)
                    cloneMutation.mutate({ id: cloneModal.id, newName: cloneName.trim() });
                }}
                placeholder="Ej: Donuts Ski"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                El slug y la URL se generan automáticamente desde este nombre.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setCloneModal(null); setCloneName(""); }} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={() => { if (cloneModal && cloneName.trim()) cloneMutation.mutate({ id: cloneModal.id, newName: cloneName.trim() }); }}
              disabled={!cloneName.trim() || cloneMutation.isPending}
              className="flex-1"
              style={{ background: "linear-gradient(135deg,#f97316,#f59e0b)", color: "#fff", border: "none", fontWeight: 600 }}
            >
              {cloneMutation.isPending ? "Clonando..." : "Clonar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
