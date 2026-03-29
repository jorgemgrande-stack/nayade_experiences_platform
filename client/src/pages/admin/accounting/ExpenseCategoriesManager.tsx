import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function ExpenseCategoriesManager() {
  
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });

  const listQ = trpc.financial.categories.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.categories.create.useMutation({
    onSuccess: () => { utils.financial.categories.list.invalidate(); toast.success("Categoría creada"); setDialogOpen(false); },
  });
  const updateMut = trpc.financial.categories.update.useMutation({
    onSuccess: () => { utils.financial.categories.list.invalidate(); toast.success("Categoría actualizada"); setDialogOpen(false); },
  });
  const deleteMut = trpc.financial.categories.delete.useMutation({
    onSuccess: () => { utils.financial.categories.list.invalidate(); toast.success("Categoría eliminada"); },
  });

  const items = listQ.data ?? [];

  function openCreate() { setEditingId(null); setForm({ name: "", description: "" }); setDialogOpen(true); }
  function openEdit(item: typeof items[number]) { setEditingId(item.id); setForm({ name: item.name, description: item.description ?? "" }); setDialogOpen(true); }

  async function handleSave() {
    if (!form.name) { toast.error("El nombre es requerido"); return; }
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...form });
    } else {
      await createMut.mutateAsync(form);
    }
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/contabilidad/gastos")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><Tag className="w-6 h-6 text-orange-500" /> Categorías de Gastos</h1>
              <p className="text-sm text-muted-foreground">{items.length} categorías configuradas</p>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nueva categoría</Button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Descripción</th>
                <th className="text-center p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={3} className="text-center p-8 text-muted-foreground">No hay categorías. Crea la primera.</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="border-t hover:bg-muted/20">
                  <td className="p-3 font-medium">{item.name}</td>
                  <td className="p-3 text-muted-foreground">{item.description ?? "—"}</td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { if (confirm("¿Eliminar?")) deleteMut.mutate({ id: item.id }); }}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Editar categoría" : "Nueva categoría"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nombre *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Suministros" /></div>
            <div><Label>Descripción</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opcional" /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{editingId ? "Guardar" : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
