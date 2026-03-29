import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Play, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

const RECURRENCE_LABELS: Record<string, string> = {
  monthly: "Mensual",
  weekly: "Semanal",
  yearly: "Anual",
};

type RecForm = {
  concept: string; amount: string; categoryId: string; costCenterId: string;
  supplierId: string; recurrenceType: string; nextExecutionDate: string;
};
const emptyForm: RecForm = {
  concept: "", amount: "", categoryId: "", costCenterId: "",
  supplierId: "", recurrenceType: "monthly",
  nextExecutionDate: new Date().toISOString().slice(0, 10),
};

export default function RecurringExpensesManager() {
  
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RecForm>(emptyForm);

  const listQ = trpc.financial.recurring.list.useQuery();
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();
  const suppliersQ = trpc.financial.suppliers.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.recurring.create.useMutation({
    onSuccess: () => { utils.financial.recurring.list.invalidate(); toast.success("Gasto recurrente creado"); setDialogOpen(false); },
  });
  const updateMut = trpc.financial.recurring.update.useMutation({
    onSuccess: () => { utils.financial.recurring.list.invalidate(); toast.success("Actualizado"); setDialogOpen(false); },
  });
  const deleteMut = trpc.financial.recurring.delete.useMutation({
    onSuccess: () => { utils.financial.recurring.list.invalidate(); toast.success("Eliminado"); },
  });
  const triggerMut = trpc.financial.recurring.trigger.useMutation({
    onSuccess: (data) => {
      utils.financial.recurring.list.invalidate();
      utils.financial.expenses.list.invalidate();
      toast.success("Gasto generado: Próxima ejecución: ${data.nextExecutionDate}");
    },
  });

  const items = listQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];

  function openCreate() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }
  function openEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setForm({
      concept: item.concept, amount: item.amount, categoryId: String(item.categoryId),
      costCenterId: String(item.costCenterId), supplierId: item.supplierId ? String(item.supplierId) : "",
      recurrenceType: item.recurrenceType, nextExecutionDate: item.nextExecutionDate,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.concept || !form.amount || !form.categoryId || !form.costCenterId) {
      toast.error("Rellena los campos requeridos"); return;
    }
    const payload = {
      concept: form.concept, amount: form.amount, categoryId: Number(form.categoryId),
      costCenterId: Number(form.costCenterId), supplierId: form.supplierId ? Number(form.supplierId) : null,
      recurrenceType: form.recurrenceType as "monthly" | "weekly" | "yearly",
      nextExecutionDate: form.nextExecutionDate,
    };
    if (editingId) await updateMut.mutateAsync({ id: editingId, ...payload });
    else await createMut.mutateAsync(payload);
  }

  function getCategoryName(id: number) { return categories.find((c) => c.id === id)?.name ?? `Cat. ${id}`; }
  function getCostCenterName(id: number) { return costCenters.find((c) => c.id === id)?.name ?? `CC ${id}`; }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/contabilidad/gastos")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="w-6 h-6 text-purple-500" /> Gastos Recurrentes</h1>
              <p className="text-sm text-muted-foreground">{items.length} gastos programados</p>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuevo recurrente</Button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Concepto</th>
                  <th className="text-left p-3 font-medium">Categoría</th>
                  <th className="text-left p-3 font-medium">Periodicidad</th>
                  <th className="text-right p-3 font-medium">Importe</th>
                  <th className="text-left p-3 font-medium">Próxima ejecución</th>
                  <th className="text-center p-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">No hay gastos recurrentes configurados.</td></tr>
                ) : items.map((item) => {
                  const isOverdue = item.nextExecutionDate < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={item.id} className="border-t hover:bg-muted/20">
                      <td className="p-3 font-medium">{item.concept}</td>
                      <td className="p-3 text-muted-foreground">{getCategoryName(item.categoryId)}</td>
                      <td className="p-3">{RECURRENCE_LABELS[item.recurrenceType]}</td>
                      <td className="p-3 text-right font-medium">{parseFloat(item.amount).toFixed(2)} €</td>
                      <td className={`p-3 ${isOverdue ? "text-red-600 font-medium" : ""}`}>
                        {item.nextExecutionDate} {isOverdue && "⚠️"}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="ghost" title="Generar gasto ahora" onClick={() => { if (confirm("¿Generar el gasto ahora y avanzar la fecha?")) triggerMut.mutate({ id: item.id }); }}>
                            <Play className="w-3 h-3 text-green-600" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { if (confirm("¿Eliminar?")) deleteMut.mutate({ id: item.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Editar recurrente" : "Nuevo gasto recurrente"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Concepto *</Label><Input value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Importe (€) *</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div>
                <Label>Periodicidad</Label>
                <Select value={form.recurrenceType} onValueChange={(v) => setForm({ ...form, recurrenceType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensual</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoría *</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Centro de coste *</Label>
                <Select value={form.costCenterId} onValueChange={(v) => setForm({ ...form, costCenterId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>{costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Proveedor</Label>
              <Select value={form.supplierId || "none"} onValueChange={(v) => setForm({ ...form, supplierId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proveedor</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Próxima ejecución *</Label><Input type="date" value={form.nextExecutionDate} onChange={(e) => setForm({ ...form, nextExecutionDate: e.target.value })} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{editingId ? "Guardar" : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
