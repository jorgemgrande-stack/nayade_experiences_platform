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
import { Plus, Pencil, Trash2, MapPin } from "lucide-react";

interface LocationForm {
  name: string;
  slug: string;
  description: string;
  address: string;
  mapUrl: string;
  imageUrl: string;
}

const emptyForm: LocationForm = { name: "", slug: "", description: "", address: "", mapUrl: "", imageUrl: "" };

export default function LocationsManager() {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<LocationForm>(emptyForm);

  const utils = trpc.useUtils();
  const { data: locations, isLoading } = trpc.products.getLocations.useQuery();

  const createMut = trpc.products.createLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success("Ubicación creada"); setOpen(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.products.updateLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success("Ubicación actualizada"); setOpen(false); setEditId(null); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.products.deleteLocation.useMutation({
    onSuccess: () => { utils.products.getLocations.invalidate(); toast.success("Ubicación eliminada"); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (loc: NonNullable<typeof locations>[0]) => {
    setEditId(loc.id);
    setForm({ name: loc.name, slug: loc.slug, description: loc.description ?? "", address: loc.address ?? "", mapUrl: "", imageUrl: loc.imageUrl ?? "" });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.slug) { toast.error("Nombre y slug son obligatorios"); return; }
    if (editId) updateMut.mutate({ id: editId, name: form.name, description: form.description, imageUrl: form.imageUrl || undefined });
    else createMut.mutate({ name: form.name, slug: form.slug, description: form.description, address: form.address || undefined, imageUrl: form.imageUrl || undefined });
  };

  const toSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  return (
    <AdminLayout title="Ubicaciones">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Ubicaciones del Complejo</h2>
          <p className="text-sm text-muted-foreground mt-1">{locations?.length ?? 0} ubicaciones registradas</p>
        </div>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" /> Nueva Ubicación
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {locations?.map((loc) => (
            <div key={loc.id} className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">{loc.name}</p>
                  <Badge variant="outline" className="text-xs">{loc.isActive ? "Activa" : "Inactiva"}</Badge>
                </div>
                {loc.address && <p className="text-sm text-muted-foreground truncate">{loc.address}</p>}
                {loc.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{loc.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => openEdit(loc)}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                </Button>
                <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10"
                  onClick={() => { if (confirm("¿Eliminar esta ubicación?")) deleteMut.mutate({ id: loc.id }); }}>
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
            <DialogTitle>{editId ? "Editar Ubicación" : "Nueva Ubicación"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value, slug: editId ? f.slug : toSlug(e.target.value) }))} placeholder="Ej: Embarcadero Principal" />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: toSlug(e.target.value) }))} placeholder="embarcadero-principal" />
            </div>
            <div>
              <Label>Dirección</Label>
              <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Los Ángeles de San Rafael, Segovia" />
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label>URL Mapa (Google Maps embed)</Label>
              <Input value={form.mapUrl} onChange={(e) => setForm(f => ({ ...f, mapUrl: e.target.value }))} placeholder="https://maps.google.com/..." />
            </div>
            <div>
              <Label>URL Imagen</Label>
              <Input value={form.imageUrl} onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? "Guardar Cambios" : "Crear Ubicación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
