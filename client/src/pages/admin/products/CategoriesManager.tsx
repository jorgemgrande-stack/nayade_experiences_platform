import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";

interface CategoryForm {
  name: string;
  slug: string;
  description: string;
  iconName: string;
  imageUrl: string;
}

const emptyForm: CategoryForm = { name: "", slug: "", description: "", iconName: "anchor", imageUrl: "" };

export default function CategoriesManager() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);

  const utils = trpc.useUtils();
  const { data: categories, isLoading } = trpc.products.getCategories.useQuery();

  const createMut = trpc.products.createCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success("Categoría creada"); setOpen(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.products.updateCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success("Categoría actualizada"); setOpen(false); setEditId(null); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.products.deleteCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success("Categoría eliminada"); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (cat: NonNullable<typeof categories>[0]) => {
    setEditId(cat.id);
    setForm({ name: cat.name, slug: cat.slug, description: cat.description ?? "", iconName: cat.iconName ?? "anchor", imageUrl: cat.imageUrl ?? "" });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.slug) { toast.error("Nombre y slug son obligatorios"); return; }
    if (editId) updateMut.mutate({ id: editId, name: form.name, description: form.description, imageUrl: form.imageUrl || undefined });
    else createMut.mutate({ name: form.name, slug: form.slug, description: form.description, iconName: form.iconName, imageUrl: form.imageUrl || undefined });
  };

  const toSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  return (
    <AdminLayout title="Categorías">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Categorías de Experiencias</h2>
          <p className="text-sm text-muted-foreground mt-1">{categories?.length ?? 0} categorías registradas</p>
        </div>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" /> Nueva Categoría
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories?.map((cat) => (
            <div key={cat.id} className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10">
                    <Tag className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{cat.name}</p>
                    <p className="text-xs text-muted-foreground">/{cat.slug}</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">{cat.isActive ? "Activa" : "Inactiva"}</Badge>
              </div>
              {cat.description && <p className="text-sm text-muted-foreground line-clamp-2">{cat.description}</p>}
              <div className="flex gap-2 mt-auto pt-2 border-t border-border">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(cat)}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                </Button>
                <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10"
                  onClick={() => { if (confirm("¿Eliminar esta categoría?")) deleteMut.mutate({ id: cat.id }); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Categoría" : "Nueva Categoría"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value, slug: editId ? f.slug : toSlug(e.target.value) }))} placeholder="Ej: Deportes Acuáticos" />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: toSlug(e.target.value) }))} placeholder="deportes-acuaticos" />
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Icono (nombre)</Label>
                <Input value={form.iconName} onChange={(e) => setForm(f => ({ ...f, iconName: e.target.value }))} placeholder="anchor" />
              </div>
              <div>
                <Label>URL Imagen</Label>
                <Input value={form.imageUrl} onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? "Guardar Cambios" : "Crear Categoría"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
