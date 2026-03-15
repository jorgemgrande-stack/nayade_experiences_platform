import { useState } from "react";
import { Plus, Pencil, Trash2, GripVertical, Eye, EyeOff, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type SlideForm = {
  imageUrl: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaUrl: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm: SlideForm = {
  imageUrl: "",
  title: "",
  subtitle: "",
  ctaText: "",
  ctaUrl: "",
  sortOrder: 0,
  isActive: true,
};

export default function SlideshowManager() {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SlideForm>(emptyForm);

  const { data: slides, refetch } = trpc.cms.getSlideshowItems.useQuery();
  const createMutation = trpc.cms.createSlideshowItem.useMutation({
    onSuccess: () => { toast.success("Slide creado correctamente"); refetch(); setShowModal(false); setForm(emptyForm); },
    onError: () => toast.error("Error al crear el slide"),
  });
  const updateMutation = trpc.cms.updateSlideshowItem.useMutation({
    onSuccess: () => { toast.success("Slide actualizado"); refetch(); setShowModal(false); setEditingId(null); setForm(emptyForm); },
    onError: () => toast.error("Error al actualizar"),
  });
  const deleteMutation = trpc.cms.deleteSlideshowItem.useMutation({
    onSuccess: () => { toast.success("Slide eliminado"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (slide: any) => {
    setEditingId(slide.id);
    setForm({ imageUrl: slide.imageUrl, title: slide.title ?? "", subtitle: slide.subtitle ?? "", ctaText: slide.ctaText ?? "", ctaUrl: slide.ctaUrl ?? "", sortOrder: slide.sortOrder ?? 0, isActive: slide.isActive ?? true });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.imageUrl) { toast.error("La URL de imagen es obligatoria"); return; }
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <AdminLayout title="Gestión del Slideshow">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-muted-foreground text-sm">Gestiona las imágenes y contenido del slideshow de la página principal.</p>
        </div>
        <Button onClick={openCreate} className="bg-gold-gradient text-white hover:opacity-90">
          <Plus className="w-4 h-4 mr-2" />
          Nuevo Slide
        </Button>
      </div>

      {/* Slides List */}
      <div className="space-y-4">
        {(!slides || slides.length === 0) ? (
          <div className="bg-card rounded-2xl border border-border/50 p-12 text-center">
            <Image className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display font-semibold text-foreground mb-2">No hay slides configurados</h3>
            <p className="text-muted-foreground text-sm mb-4">Añade el primer slide para el slideshow de la home.</p>
            <Button onClick={openCreate} className="bg-gold-gradient text-white hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" />
              Añadir Primer Slide
            </Button>
          </div>
        ) : (
          slides.map((slide) => (
            <div key={slide.id} className="bg-card rounded-2xl border border-border/50 p-4 flex items-center gap-4">
              <GripVertical className="w-5 h-5 text-muted-foreground cursor-grab shrink-0" />
              <div className="w-24 h-16 rounded-lg overflow-hidden shrink-0 bg-muted">
                <img src={slide.imageUrl} alt={slide.title ?? ""} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-foreground truncate">{slide.title ?? "Sin título"}</h4>
                <p className="text-sm text-muted-foreground truncate">{slide.subtitle ?? "Sin subtítulo"}</p>
                <div className="flex items-center gap-2 mt-1">
                  {slide.ctaText && <Badge variant="outline" className="text-xs">{slide.ctaText}</Badge>}
                  <span className="text-xs text-muted-foreground">Orden: {slide.sortOrder}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={slide.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}>
                  {slide.isActive ? "Activo" : "Inactivo"}
                </Badge>
                <Button variant="ghost" size="icon" onClick={() => openEdit(slide)} className="w-8 h-8">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { if (confirm("¿Eliminar este slide?")) deleteMutation.mutate({ id: slide.id }); }}
                  className="w-8 h-8 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{editingId ? "Editar Slide" : "Nuevo Slide"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <Label htmlFor="imageUrl">URL de Imagen *</Label>
              <Input id="imageUrl" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." required className="mt-1" />
              {form.imageUrl && (
                <div className="mt-2 rounded-lg overflow-hidden h-32 bg-muted">
                  <img src={form.imageUrl} alt="Preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="title">Título</Label>
              <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="subtitle">Subtítulo</Label>
              <Input id="subtitle" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ctaText">Texto del Botón</Label>
                <Input id="ctaText" value={form.ctaText} onChange={(e) => setForm({ ...form, ctaText: e.target.value })} className="mt-1" placeholder="Explorar" />
              </div>
              <div>
                <Label htmlFor="ctaUrl">URL del Botón</Label>
                <Input id="ctaUrl" value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} className="mt-1" placeholder="/experiencias" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sortOrder">Orden</Label>
                <Input id="sortOrder" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} className="mt-1" />
              </div>
              <div className="flex items-end gap-3 pb-0.5">
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                <Label>{form.isActive ? "Activo" : "Inactivo"}</Label>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="flex-1 bg-gold-gradient text-white hover:opacity-90">
                {editingId ? "Guardar Cambios" : "Crear Slide"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
