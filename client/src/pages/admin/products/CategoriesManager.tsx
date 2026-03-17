import { useState, useRef } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, ImageIcon, X, MoreVertical, Copy, PowerOff, Power } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface CategoryForm {
  name: string;
  slug: string;
  description: string;
  iconName: string;
  image1: string;
}

const emptyForm: CategoryForm = { name: "", slug: "", description: "", iconName: "anchor", image1: "" };

// ── Zona de upload de imagen para categorías ────────────────────────────────
function CatImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("La imagen no puede superar 10 MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al subir");
      onChange(data.url);
      toast.success("Imagen subida correctamente");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al subir imagen");
    } finally { setUploading(false); }
  };
  return (
    <div
      className={cn("relative border-2 border-dashed rounded-xl overflow-hidden cursor-pointer transition-all hover:border-primary/60 h-28",
        value ? "border-primary/40" : "border-border bg-muted/30")}
      onClick={() => !uploading && inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
    >
      {value ? (
        <>
          <img src={value} alt="Imagen categoría" className="w-full h-full object-cover" />
          <button type="button" className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-red-600"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}><X className="w-3.5 h-3.5" /></button>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
          {uploading ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <><ImageIcon className="w-6 h-6 opacity-40" /><span className="text-xs">Haz clic o arrastra</span></>}
        </div>
      )}
      {uploading && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

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
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success("Categoría desactivada"); },
    onError: (e) => toast.error(e.message),
  });
  const hardDeleteMut = trpc.products.hardDeleteCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success("Categoría eliminada permanentemente"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleActiveMut = trpc.products.toggleCategoryActive.useMutation({
    onSuccess: (_, vars) => { utils.products.getCategories.invalidate(); toast.success(vars.isActive ? "Categoría activada" : "Categoría desactivada"); },
    onError: (e) => toast.error(e.message),
  });
  const cloneMut = trpc.products.cloneCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success("Categoría clonada (inactiva)"); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (cat: NonNullable<typeof categories>[0]) => {
    setEditId(cat.id);
    setForm({ name: cat.name, slug: cat.slug, description: cat.description ?? "", iconName: cat.iconName ?? "anchor", image1: (cat as Record<string,unknown>).image1 as string ?? cat.imageUrl ?? "" });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.slug) { toast.error("Nombre y slug son obligatorios"); return; }
    if (editId) updateMut.mutate({ id: editId, name: form.name, description: form.description, image1: form.image1 || undefined });
    else createMut.mutate({ name: form.name, slug: form.slug, description: form.description, iconName: form.iconName, image1: form.image1 || undefined });
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="px-2">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => toggleActiveMut.mutate({ id: cat.id, isActive: !cat.isActive })}>
                      {cat.isActive
                        ? <><PowerOff className="w-3.5 h-3.5 mr-2" /> Desactivar</>
                        : <><Power className="w-3.5 h-3.5 mr-2" /> Activar</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => cloneMut.mutate({ id: cat.id })}>
                      <Copy className="w-3.5 h-3.5 mr-2" /> Clonar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600"
                      onClick={() => { if (confirm("¿Eliminar permanentemente esta categoría?")) hardDeleteMut.mutate({ id: cat.id }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Borrar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
            <div>
              <Label>Icono (nombre)</Label>
              <Input value={form.iconName} onChange={(e) => setForm(f => ({ ...f, iconName: e.target.value }))} placeholder="anchor" />
            </div>
            <div>
              <Label className="block mb-1">Imagen de la categoría</Label>
              <CatImageUpload value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} />
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
