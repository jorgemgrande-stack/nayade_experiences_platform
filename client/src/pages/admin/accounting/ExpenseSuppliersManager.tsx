import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { toast } from "sonner";
import { Plus, Pencil, Trash2, Building2, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

type SupplierForm = {
  name: string; fiscalName: string; vatNumber: string;
  address: string; email: string; phone: string; iban: string;
};
const emptyForm: SupplierForm = { name: "", fiscalName: "", vatNumber: "", address: "", email: "", phone: "", iban: "" };

export default function ExpenseSuppliersManager() {
  
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);

  const listQ = trpc.financial.suppliers.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.suppliers.create.useMutation({
    onSuccess: () => { utils.financial.suppliers.list.invalidate(); toast.success("Proveedor creado"); setDialogOpen(false); },
  });
  const updateMut = trpc.financial.suppliers.update.useMutation({
    onSuccess: () => { utils.financial.suppliers.list.invalidate(); toast.success("Proveedor actualizado"); setDialogOpen(false); },
  });
  const deleteMut = trpc.financial.suppliers.delete.useMutation({
    onSuccess: () => { utils.financial.suppliers.list.invalidate(); toast.success("Proveedor eliminado"); },
  });

  const items = listQ.data ?? [];

  function openCreate() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }
  function openEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setForm({
      name: item.name, fiscalName: item.fiscalName ?? "", vatNumber: item.vatNumber ?? "",
      address: item.address ?? "", email: item.email ?? "", phone: item.phone ?? "", iban: item.iban ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name) { toast.error("El nombre es requerido"); return; }
    const payload = { ...form, email: form.email || undefined };
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...payload });
    } else {
      await createMut.mutateAsync(payload);
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
              <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="w-6 h-6 text-blue-500" /> Proveedores de Gastos</h1>
              <p className="text-sm text-muted-foreground">{items.length} proveedores</p>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuevo proveedor</Button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Nombre</th>
                  <th className="text-left p-3 font-medium">Razón social</th>
                  <th className="text-left p-3 font-medium">NIF/CIF</th>
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Teléfono</th>
                  <th className="text-center p-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">No hay proveedores. Crea el primero.</td></tr>
                ) : items.map((item) => (
                  <tr key={item.id} className="border-t hover:bg-muted/20">
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3 text-muted-foreground">{item.fiscalName ?? "—"}</td>
                    <td className="p-3">{item.vatNumber ?? "—"}</td>
                    <td className="p-3">{item.email ?? "—"}</td>
                    <td className="p-3">{item.phone ?? "—"}</td>
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre comercial *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Razón social</Label><Input value={form.fiscalName} onChange={(e) => setForm({ ...form, fiscalName: e.target.value })} /></div>
              <div><Label>NIF/CIF</Label><Input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} /></div>
            </div>
            <div><Label>Dirección</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><Label>IBAN</Label><Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="ES00 0000 0000 00 0000000000" /></div>
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
