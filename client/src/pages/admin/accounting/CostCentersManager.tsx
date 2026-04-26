import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Layers, ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function CostCentersManager() {
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", active: true });

  const listQ = trpc.financial.costCenters.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.costCenters.create.useMutation({
    onSuccess: () => { utils.financial.costCenters.list.invalidate(); toast.success("Centro de coste creado"); setDialogOpen(false); },
    onError: () => toast.error("Error al crear el centro de coste"),
  });
  const updateMut = trpc.financial.costCenters.update.useMutation({
    onSuccess: () => { utils.financial.costCenters.list.invalidate(); toast.success("Centro de coste actualizado"); setDialogOpen(false); },
    onError: () => toast.error("Error al actualizar"),
  });
  const deleteMut = trpc.financial.costCenters.delete.useMutation({
    onSuccess: () => { utils.financial.costCenters.list.invalidate(); toast.success("Centro de coste eliminado"); },
    onError: () => toast.error("No se puede eliminar si tiene gastos asociados"),
  });

  const items = listQ.data ?? [];
  const activeCount = items.filter((i) => i.active !== false).length;

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", description: "", active: true });
    setDialogOpen(true);
  }

  function openEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setForm({ name: item.name, description: item.description ?? "", active: item.active !== false });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("El nombre es requerido"); return; }
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...form });
    } else {
      await createMut.mutateAsync({ name: form.name, description: form.description || undefined });
    }
  }

  function handleToggleActive(item: typeof items[number]) {
    updateMut.mutate({ id: item.id, name: item.name, active: item.active === false });
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
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Layers className="w-6 h-6 text-orange-500" /> Centros de Coste
              </h1>
              <p className="text-sm text-muted-foreground">{activeCount} activos · {items.length} en total</p>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuevo centro</Button>
        </div>

        {/* Info banner */}
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-200">
          <p className="font-medium mb-1">¿Qué es un Centro de Coste?</p>
          <p>Permite imputar cada gasto a un área interna del negocio (Actividades, Restauración, Marketing…) para analizar el coste real de cada departamento en el informe de Cuenta de Resultados.</p>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Descripción</th>
                <th className="text-center p-3 font-medium">Estado</th>
                <th className="text-center p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                <tr><td colSpan={4} className="text-center p-8 text-muted-foreground">Cargando...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="text-center p-8 text-muted-foreground">No hay centros de coste. Crea el primero.</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className={`border-t hover:bg-muted/20 ${item.active === false ? "opacity-50" : ""}`}>
                  <td className="p-3 font-medium">{item.name}</td>
                  <td className="p-3 text-muted-foreground">{item.description ?? "—"}</td>
                  <td className="p-3 text-center">
                    {item.active !== false
                      ? <Badge variant="outline" className="text-emerald-600 border-emerald-300">Activo</Badge>
                      : <Badge variant="outline" className="text-slate-400 border-slate-300">Inactivo</Badge>
                    }
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(item)} title="Editar">
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className={item.active !== false ? "text-amber-500 hover:text-amber-700" : "text-emerald-500 hover:text-emerald-700"}
                        onClick={() => handleToggleActive(item)}
                        title={item.active !== false ? "Desactivar" : "Activar"}
                      >
                        {item.active !== false ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => { if (confirm(`¿Eliminar "${item.name}"? Esta acción no se puede deshacer.`)) deleteMut.mutate({ id: item.id }); }}
                        title="Eliminar"
                      >
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
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar centro de coste" : "Nuevo centro de coste"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Actividades acuáticas"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Opcional — describe qué gastos agrupa"
              />
            </div>
            {editingId && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4"
                />
                <Label htmlFor="active" className="cursor-pointer">Centro activo (aparece en el selector de gastos)</Label>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? "Guardar cambios" : "Crear centro"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
