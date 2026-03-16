import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Euro } from "lucide-react";

export default function VariantsManager() {
  const [selectedExp, setSelectedExp] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ experienceId: 0, name: "", price: "", minPersons: "1", maxPersons: "", sku: "" });

  const utils = trpc.useUtils();
  const { data: experiences } = trpc.products.getAll.useQuery();

  // Filter experiences for display
  const filtered = selectedExp === "all" ? experiences : experiences?.filter(e => String(e.id) === selectedExp);

  const openCreate = (expId?: number) => {
    setEditId(null);
    setForm({ experienceId: expId ?? 0, name: "", price: "", minPersons: "1", maxPersons: "", sku: "" });
    setOpen(true);
  };

  return (
    <AdminLayout title="Variantes de Precio">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Variantes y Precios</h2>
          <p className="text-sm text-muted-foreground mt-1">Gestiona las variantes de precio de cada experiencia</p>
        </div>
        <div className="flex gap-3">
          <Select value={selectedExp} onValueChange={setSelectedExp}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Filtrar por experiencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las experiencias</SelectItem>
              {experiences?.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => openCreate()} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> Nueva Variante
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {filtered?.map((exp) => (
          <div key={exp.id} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <Tag className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">{exp.title}</span>
                <Badge variant="outline" className="text-xs">{exp.difficulty ?? "facil"}</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => openCreate(exp.id)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Añadir Variante
              </Button>
            </div>
            {false ? (
              <div className="divide-y divide-border">
                {[].map((v: { id: number; name: string; price: string; minPersons?: number; maxPersons?: number; sku?: string; isActive?: boolean }) => (
                  <div key={v.id} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1">
                      <p className="font-medium text-foreground text-sm">{v.name}</p>
                      {(v.minPersons || v.maxPersons) && (
                        <p className="text-xs text-muted-foreground">{v.minPersons ?? 1}–{v.maxPersons ?? "∞"} personas</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-primary font-bold">
                      <Euro className="w-3.5 h-3.5" />
                      <span>{parseFloat(v.price).toFixed(2)}</span>
                    </div>
                    {v.sku && <Badge variant="secondary" className="text-xs font-mono">{v.sku}</Badge>}
                    <Badge variant={v.isActive ? "default" : "secondary"} className="text-xs">{v.isActive ? "Activa" : "Inactiva"}</Badge>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditId(v.id); setForm({ experienceId: exp.id, name: v.name, price: v.price, minPersons: String(v.minPersons ?? 1), maxPersons: String(v.maxPersons ?? ""), sku: v.sku ?? "" }); setOpen(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                Precio base: <strong className="text-primary">€{parseFloat(exp.basePrice).toFixed(2)}</strong> · <button className="text-primary underline" onClick={() => openCreate(exp.id)}>Añadir variante de precio</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Variante" : "Nueva Variante de Precio"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editId && (
              <div>
                <Label>Experiencia *</Label>
                <Select value={String(form.experienceId)} onValueChange={(v) => setForm(f => ({ ...f, experienceId: parseInt(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar experiencia" /></SelectTrigger>
                  <SelectContent>
                    {experiences?.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Nombre de la variante *</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Adulto, Niño, Grupo 10 pax" />
            </div>
            <div>
              <Label>Precio (€) *</Label>
              <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} placeholder="25.00" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mín. personas</Label>
                <Input type="number" value={form.minPersons} onChange={(e) => setForm(f => ({ ...f, minPersons: e.target.value }))} />
              </div>
              <div>
                <Label>Máx. personas</Label>
                <Input type="number" value={form.maxPersons} onChange={(e) => setForm(f => ({ ...f, maxPersons: e.target.value }))} placeholder="Sin límite" />
              </div>
            </div>
            <div>
              <Label>SKU / Código</Label>
              <Input value={form.sku} onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="NAY-BLOB-ADU" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => { toast.info("Funcionalidad de variantes disponible próximamente"); setOpen(false); }}>
              {editId ? "Guardar Cambios" : "Crear Variante"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
