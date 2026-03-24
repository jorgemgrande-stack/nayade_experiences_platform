import { useState, useRef } from "react";
import { Plus, Search, ImageIcon, X, MoreVertical, Copy, PowerOff, Power, Trash2, Pencil, ShoppingCart, GraduationCap, Building2, ChevronUp, ChevronDown } from "lucide-react";
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
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const categoryLabels: Record<string, string> = {
  dia: "Packs de Día",
  escolar: "Packs Escolares",
  empresa: "Team Building",
};

const categoryColors: Record<string, string> = {
  dia: "bg-blue-100 text-blue-700",
  escolar: "bg-green-100 text-green-700",
  empresa: "bg-purple-100 text-purple-700",
};

const categoryIcons: Record<string, React.ElementType> = {
  dia: ShoppingCart,
  escolar: GraduationCap,
  empresa: Building2,
};

type PackForm = {
  slug: string;
  category: "dia" | "escolar" | "empresa";
  title: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  image1: string;
  image2: string;
  image3: string;
  image4: string;
  basePrice: string;
  priceLabel: string;
  duration: string;
  minPersons: string;
  maxPersons: string;
  targetAudience: string;
  badge: string;
  schedule: string;
  note: string;
  hasStay: boolean;
  isOnlinePurchase: boolean;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: string;
  discountPercent: string;
  discountExpiresAt: string;
  fiscalRegime: "general" | "reav";
  productType: string;
  providerPercent: string;
  agencyMarginPercent: string;
};

const emptyForm: PackForm = {
  slug: "", category: "dia", title: "", subtitle: "", shortDescription: "",
  description: "", image1: "", image2: "", image3: "", image4: "",
  basePrice: "", priceLabel: "/persona", duration: "", minPersons: "1",
  maxPersons: "", targetAudience: "", badge: "", schedule: "", note: "",
  hasStay: false, isOnlinePurchase: true, isFeatured: false, isActive: true, sortOrder: "0",
  discountPercent: "", discountExpiresAt: "",
  fiscalRegime: "general", productType: "pack",
  providerPercent: "", agencyMarginPercent: "",
};

// ── Zona de upload de imagen ─────────────────────────────────────────────────
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

export default function PacksManager() {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PackForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const utils = trpc.useUtils();
  const { data: packsData, refetch } = trpc.packs.getAll.useQuery({});

  const createMutation = trpc.packs.create.useMutation({
    onSuccess: () => { toast.success("Pack creado"); refetch(); setShowModal(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message || "Error al crear el pack"),
  });
  const updateMutation = trpc.packs.update.useMutation({
    onSuccess: () => { toast.success("Pack actualizado"); refetch(); setShowModal(false); setEditingId(null); },
    onError: (e) => toast.error(e.message || "Error al actualizar"),
  });
  const toggleMutation = trpc.packs.toggle.useMutation({
    onSuccess: () => { toast.success("Estado cambiado"); refetch(); },
    onError: () => toast.error("Error al cambiar estado"),
  });
  const deleteMutation = trpc.packs.delete.useMutation({
    onSuccess: () => { toast.success("Pack eliminado"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });
  const cloneMutation = trpc.packs.clone.useMutation({
    onSuccess: () => { toast.success("Pack clonado (inactivo)"); refetch(); },
    onError: () => toast.error("Error al clonar"),
  });
  const reorderMutation = trpc.packs.reorder.useMutation({
    onSuccess: () => { utils.packs.getAll.invalidate(); },
    onError: () => toast.error("Error al guardar el orden"),
  });

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (pack: Record<string, unknown>) => {
    setEditingId(Number(pack.id));
    setForm({
      slug: String(pack.slug ?? ""),
      category: (pack.category as "dia" | "escolar" | "empresa") ?? "dia",
      title: String(pack.title ?? ""),
      subtitle: String(pack.subtitle ?? ""),
      shortDescription: String(pack.shortDescription ?? ""),
      description: String(pack.description ?? ""),
      image1: String(pack.image1 ?? ""),
      image2: String(pack.image2 ?? ""),
      image3: String(pack.image3 ?? ""),
      image4: String(pack.image4 ?? ""),
      basePrice: String(pack.basePrice ?? ""),
      priceLabel: String(pack.priceLabel ?? "/persona"),
      duration: String(pack.duration ?? ""),
      minPersons: String(pack.minPersons ?? "1"),
      maxPersons: String(pack.maxPersons ?? ""),
      targetAudience: String(pack.targetAudience ?? ""),
      badge: String(pack.badge ?? ""),
      schedule: String(pack.schedule ?? ""),
      note: String(pack.note ?? ""),
      hasStay: Boolean(pack.hasStay),
      isOnlinePurchase: Boolean(pack.isOnlinePurchase),
      isFeatured: Boolean(pack.isFeatured),
      isActive: Boolean(pack.isActive),
      sortOrder: String(pack.sortOrder ?? "0"),
      discountPercent: pack.discountPercent != null ? String(pack.discountPercent) : "",
      discountExpiresAt: pack.discountExpiresAt
        ? new Date(pack.discountExpiresAt as string | number | Date).toISOString().slice(0, 10)
        : "",
      fiscalRegime: (pack.fiscalRegime === "reav" ? "reav" : "general") as "general" | "reav",
      productType: String(pack.productType ?? "pack"),
      providerPercent: pack.providerPercent != null ? String(pack.providerPercent) : "",
      agencyMarginPercent: pack.agencyMarginPercent != null ? String(pack.agencyMarginPercent) : "",
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.basePrice) {
      toast.error("El título y el precio son obligatorios"); return;
    }
    const data = {
      slug: form.slug || form.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      category: form.category,
      title: form.title,
      subtitle: form.subtitle || undefined,
      shortDescription: form.shortDescription || undefined,
      description: form.description || undefined,
      image1: form.image1 || undefined,
      image2: form.image2 || undefined,
      image3: form.image3 || undefined,
      image4: form.image4 || undefined,
      basePrice: form.basePrice,
      priceLabel: form.priceLabel || undefined,
      duration: form.duration || undefined,
      minPersons: form.minPersons ? parseInt(form.minPersons) : undefined,
      maxPersons: form.maxPersons ? parseInt(form.maxPersons) : undefined,
      targetAudience: form.targetAudience || undefined,
      badge: form.badge || undefined,
      schedule: form.schedule || undefined,
      note: form.note || undefined,
      hasStay: form.hasStay,
      isOnlinePurchase: form.isOnlinePurchase,
      isFeatured: form.isFeatured,
      isActive: form.isActive,
      sortOrder: parseInt(form.sortOrder) || 0,
      discountPercent: form.discountPercent ? form.discountPercent : undefined,
      discountExpiresAt: form.discountExpiresAt ? form.discountExpiresAt : undefined,
      fiscalRegime: form.fiscalRegime || "general",
      productType: form.productType || "pack",
      providerPercent: form.providerPercent ? parseFloat(form.providerPercent) : undefined,
      agencyMarginPercent: form.agencyMarginPercent ? parseFloat(form.agencyMarginPercent) : undefined,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const sortedPacks = (() => {
    const list = packsData ?? [];
    if (localOrder.length === list.length && localOrder.length > 0) {
      const map = new Map(list.map(p => [p.id, p]));
      return localOrder.map(id => map.get(id)).filter(Boolean) as typeof list;
    }
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  })();

  const filtered = sortedPacks.filter((p) => {
    const matchSearch = !search || p.title.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCategory === "all" || p.category === filterCategory;
    return matchSearch && matchCat;
  });

  const moveItem = (index: number, direction: "up" | "down") => {
    const current = localOrder.length > 0 ? localOrder : sortedPacks.map(p => p.id);
    const newOrder = [...current];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    setLocalOrder(newOrder);
    const items = newOrder.map((id, i) => ({ id, sortOrder: i }));
    reorderMutation.mutate({ items });
  };

  return (
    <AdminLayout title="Gestión de Packs">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar packs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-56"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              <SelectItem value="dia">Packs de Día</SelectItem>
              <SelectItem value="escolar">Packs Escolares</SelectItem>
              <SelectItem value="empresa">Team Building</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openCreate} style={{ background: "linear-gradient(135deg,#f97316,#f59e0b)", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600 }}>
          <Plus className="w-4 h-4 mr-2" />
          Nuevo Pack
        </Button>
      </div>

      {/* Tabla */}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-16">Orden</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pack</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Categoría</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Precio</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-muted-foreground">
                    {search || filterCategory !== "all" ? "No se encontraron packs con ese filtro" : "No hay packs. Crea el primero."}
                  </td>
                </tr>
              ) : filtered.map((pack, idx) => {
                const CatIcon = categoryIcons[pack.category] ?? ShoppingCart;
                return (
                  <tr key={pack.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-3">
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
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted flex-shrink-0 border border-border/40">
                          {pack.image1 ? (
                            <img src={pack.image1} alt={pack.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground">{pack.title}</span>
                            {pack.isFeatured && <span className="text-amber-500 text-xs">★ Destacado</span>}
                            {pack.isOnlinePurchase && <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-emerald-600 border-emerald-200">Online</Badge>}
                          </div>
                          <span className="text-xs text-muted-foreground">{pack.slug}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold", categoryColors[pack.category] ?? "bg-gray-100 text-gray-700")}>
                        <CatIcon className="w-3 h-3" />
                        {categoryLabels[pack.category] ?? pack.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-accent text-sm">{Number(pack.basePrice).toFixed(2)}€</span>
                      {pack.priceLabel && <span className="text-xs text-muted-foreground ml-1">{pack.priceLabel}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                        pack.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                      )}>
                        {pack.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openEdit(pack as Record<string, unknown>)}>
                            <Pencil className="w-4 h-4 mr-2 text-blue-500" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: pack.id })}>
                            {pack.isActive ? (
                              <><PowerOff className="w-4 h-4 mr-2 text-amber-500" />Desactivar</>
                            ) : (
                              <><Power className="w-4 h-4 mr-2 text-emerald-500" />Activar</>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => cloneMutation.mutate({ id: pack.id })}>
                            <Copy className="w-4 h-4 mr-2 text-violet-500" />
                            Clonar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => {
                              if (confirm(`¿Eliminar permanentemente "${pack.title}"? Esta acción no se puede deshacer.`)) {
                                deleteMutation.mutate({ id: pack.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Borrar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de creación/edición */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) { setShowModal(false); setEditingId(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Pack" : "Nuevo Pack"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5 mt-2">
            {/* Fila 1: Categoría + Título */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Categoría *</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v as "dia" | "escolar" | "empresa" }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dia">Packs de Día</SelectItem>
                    <SelectItem value="escolar">Packs Escolares</SelectItem>
                    <SelectItem value="empresa">Team Building Empresas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Título *</Label>
                <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Day Pass Náyade" required />
              </div>
            </div>

            {/* Fila 2: Subtítulo + Slug */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Subtítulo</Label>
                <Input value={form.subtitle} onChange={(e) => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="Un día completo en el lago" />
              </div>
              <div className="space-y-1.5">
                <Label>Slug (URL)</Label>
                <Input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="day-pass-nayade" />
              </div>
            </div>

            {/* Descripción corta */}
            <div className="space-y-1.5">
              <Label>Descripción corta (tarjeta)</Label>
              <Textarea value={form.shortDescription} onChange={(e) => setForm(f => ({ ...f, shortDescription: e.target.value }))} rows={2} placeholder="Acceso completo al club, zona de playa y actividades acuáticas durante todo el día." />
            </div>

            {/* Descripción larga */}
            <div className="space-y-1.5">
              <Label>Descripción completa (ficha)</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={4} placeholder="Descripción detallada del pack..." />
            </div>

            {/* Imágenes */}
            <div>
              <Label className="mb-2 block">Imágenes (arrastra o haz clic)</Label>
              <div className="grid grid-cols-4 gap-3">
                <ImageUploadZone label="Principal" value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} index={1} />
                <ImageUploadZone label="Imagen 2" value={form.image2} onChange={(url) => setForm(f => ({ ...f, image2: url }))} index={2} />
                <ImageUploadZone label="Imagen 3" value={form.image3} onChange={(url) => setForm(f => ({ ...f, image3: url }))} index={3} />
                <ImageUploadZone label="Imagen 4" value={form.image4} onChange={(url) => setForm(f => ({ ...f, image4: url }))} index={4} />
              </div>
            </div>

            {/* Precio + etiqueta */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Precio base (€) *</Label>
                <Input type="number" step="0.01" value={form.basePrice} onChange={(e) => setForm(f => ({ ...f, basePrice: e.target.value }))} placeholder="45.00" required />
              </div>
              <div className="space-y-1.5">
                <Label>Etiqueta precio</Label>
                <Input value={form.priceLabel} onChange={(e) => setForm(f => ({ ...f, priceLabel: e.target.value }))} placeholder="/persona" />
              </div>
              <div className="space-y-1.5">
                <Label>Badge (ej: Más Popular)</Label>
                <Input value={form.badge} onChange={(e) => setForm(f => ({ ...f, badge: e.target.value }))} placeholder="Más Popular" />
              </div>
            </div>

            {/* Duración + personas */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Duración</Label>
                <Input value={form.duration} onChange={(e) => setForm(f => ({ ...f, duration: e.target.value }))} placeholder="Día completo (10:00-20:00)" />
              </div>
              <div className="space-y-1.5">
                <Label>Mín. personas</Label>
                <Input type="number" value={form.minPersons} onChange={(e) => setForm(f => ({ ...f, minPersons: e.target.value }))} placeholder="2" />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. personas</Label>
                <Input type="number" value={form.maxPersons} onChange={(e) => setForm(f => ({ ...f, maxPersons: e.target.value }))} placeholder="Sin límite" />
              </div>
            </div>

            {/* Horario + público objetivo */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Horario / Nota de horario</Label>
                <Input value={form.schedule} onChange={(e) => setForm(f => ({ ...f, schedule: e.target.value }))} placeholder="Día completo (10:00-20:00)" />
              </div>
              <div className="space-y-1.5">
                <Label>Público objetivo</Label>
                <Input value={form.targetAudience} onChange={(e) => setForm(f => ({ ...f, targetAudience: e.target.value }))} placeholder="Familias, parejas y amigos" />
              </div>
            </div>

            {/* Nota */}
            <div className="space-y-1.5">
              <Label>Nota adicional</Label>
              <Input value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Reserva con 48h de antelación recomendada" />
            </div>

            {/* Switches */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Compra online</p>
                  <p className="text-xs text-muted-foreground">Muestra botón "Reservar Ahora"</p>
                </div>
                <Switch checked={form.isOnlinePurchase} onCheckedChange={(v) => setForm(f => ({ ...f, isOnlinePurchase: v }))} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Incluye estancia</p>
                  <p className="text-xs text-muted-foreground">Pack con alojamiento</p>
                </div>
                <Switch checked={form.hasStay} onCheckedChange={(v) => setForm(f => ({ ...f, hasStay: v }))} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Destacado</p>
                  <p className="text-xs text-muted-foreground">Aparece en la home</p>
                </div>
                <Switch checked={form.isFeatured} onCheckedChange={(v) => setForm(f => ({ ...f, isFeatured: v }))} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Activo</p>
                  <p className="text-xs text-muted-foreground">Visible en el sitio web</p>
                </div>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} />
              </div>
            </div>

            {/* Descuento */}
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
                      onChange={(e) => setForm(f => ({ ...f, discountPercent: e.target.value }))}
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
                    onChange={(e) => setForm(f => ({ ...f, discountExpiresAt: e.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm mt-1"
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

            {/* Régimen fiscal */}
            <div className="border border-blue-200 bg-blue-50/60 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-700 flex items-center gap-1.5 mb-3">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">€</span>
                Régimen fiscal
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Régimen IVA</label>
                  <select
                    value={form.fiscalRegime}
                    onChange={(e) => setForm(f => ({ ...f, fiscalRegime: e.target.value as "general" | "reav" }))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm mt-1"
                  >
                    <option value="general">Régimen General (IVA 21%)</option>
                    <option value="reav">REAV — Agencias de Viaje</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Tipo de producto</label>
                  <input
                    type="text"
                    value={form.productType}
                    onChange={(e) => setForm(f => ({ ...f, productType: e.target.value }))}
                    placeholder="Ej: pack_aventura"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm mt-1"
                  />
                </div>
              </div>
              {form.fiscalRegime === "reav" && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-muted-foreground">% Coste proveedor</label>
                    <div className="relative mt-1">
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={form.providerPercent}
                        onChange={(e) => setForm(f => ({ ...f, providerPercent: e.target.value }))}
                        placeholder="Ej: 70"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">% Margen agencia</label>
                    <div className="relative mt-1">
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={form.agencyMarginPercent}
                        onChange={(e) => setForm(f => ({ ...f, agencyMarginPercent: e.target.value }))}
                        placeholder="Ej: 30"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                    </div>
                  </div>
                </div>
              )}
              {form.fiscalRegime === "reav" && (
                <p className="text-xs text-blue-600 mt-2">
                  Régimen Especial de Agencias de Viaje (REAV): el IVA se aplica solo sobre el margen de la agencia, no sobre el precio total.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                style={{ background: "linear-gradient(135deg,#f97316,#f59e0b)", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600 }}
              >
                {createMutation.isPending || updateMutation.isPending ? "Guardando..." : editingId ? "Actualizar Pack" : "Crear Pack"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
