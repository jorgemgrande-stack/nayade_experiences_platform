import { useState } from "react";
import { Plus, Pencil, Trash2, Star, Eye, EyeOff, Search, Package } from "lucide-react";
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
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  locationId: string;
  coverImageUrl: string;
  basePrice: string;
  duration: string;
  minPersons: string;
  maxPersons: string;
  difficulty: string;
  isFeatured: boolean;
  isActive: boolean;
};

const emptyForm: ExpForm = {
  slug: "", title: "", shortDescription: "", description: "",
  categoryId: "", locationId: "", coverImageUrl: "",
  basePrice: "", duration: "", minPersons: "1", maxPersons: "",
  difficulty: "facil", isFeatured: false, isActive: true,
};

export default function ExperiencesManager() {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExpForm>(emptyForm);
  const [search, setSearch] = useState("");

  const { data: experiences, refetch } = trpc.products.getAll.useQuery();
  const { data: categories } = trpc.products.getCategories.useQuery();
  const { data: locations } = trpc.products.getLocations.useQuery();

  const createMutation = trpc.products.create.useMutation({
    onSuccess: () => { toast.success("Experiencia creada"); refetch(); setShowModal(false); setForm(emptyForm); },
    onError: () => toast.error("Error al crear la experiencia"),
  });
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => { toast.success("Experiencia actualizada"); refetch(); setShowModal(false); setEditingId(null); },
    onError: () => toast.error("Error al actualizar"),
  });
  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: () => { toast.success("Experiencia desactivada"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (exp: any) => {
    setEditingId(exp.id);
    setForm({
      slug: exp.slug, title: exp.title, shortDescription: exp.shortDescription ?? "",
      description: exp.description ?? "", categoryId: String(exp.categoryId),
      locationId: String(exp.locationId), coverImageUrl: exp.coverImageUrl ?? "",
      basePrice: exp.basePrice, duration: exp.duration ?? "",
      minPersons: String(exp.minPersons ?? 1), maxPersons: String(exp.maxPersons ?? ""),
      difficulty: exp.difficulty ?? "facil", isFeatured: exp.isFeatured ?? false,
      isActive: exp.isActive ?? true,
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
      coverImageUrl: form.coverImageUrl || undefined,
      basePrice: form.basePrice,
      duration: form.duration || undefined,
      minPersons: form.minPersons ? parseInt(form.minPersons) : undefined,
      maxPersons: form.maxPersons ? parseInt(form.maxPersons) : undefined,
      difficulty: form.difficulty as any,
      isFeatured: form.isFeatured,
      isActive: form.isActive,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filtered = (experiences ?? []).filter((e) =>
    !search || e.title.toLowerCase().includes(search.toLowerCase())
  );

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
        <Button onClick={openCreate} className="bg-gold-gradient text-white hover:opacity-90">
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
                  <td colSpan={5} className="text-center py-12">
                    <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No hay experiencias. Crea la primera.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((exp) => (
                  <tr key={exp.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-9 rounded-lg overflow-hidden bg-muted shrink-0">
                          {exp.coverImageUrl ? (
                            <img src={exp.coverImageUrl} alt={exp.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="w-4 h-4 text-muted-foreground" />
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
                        <Button variant="ghost" size="icon" onClick={() => openEdit(exp)} className="w-8 h-8">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { if (confirm("¿Desactivar esta experiencia?")) deleteMutation.mutate({ id: exp.id }); }}
                          className="w-8 h-8 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
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
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
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
                <Label htmlFor="coverImageUrl">URL Imagen Principal</Label>
                <Input id="coverImageUrl" value={form.coverImageUrl} onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })} className="mt-1" placeholder="https://..." />
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
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="flex-1 bg-gold-gradient text-white hover:opacity-90">
                {editingId ? "Guardar Cambios" : "Crear Experiencia"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
