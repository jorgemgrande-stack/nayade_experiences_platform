import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Plus, Search, Pencil, Trash2, RefreshCw, Phone, Mail,
  Building2, FileText, ChevronRight
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ClientRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  nif: string | null;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── CLIENT FORM MODAL ───────────────────────────────────────────────────────

function ClientFormModal({
  client,
  onClose,
}: {
  client?: ClientRow | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!client;

  const [form, setForm] = useState({
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    company: client?.company ?? "",
    nif: client?.nif ?? "",
    address: client?.address ?? "",
    notes: client?.notes ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const create = trpc.crm.clients.create.useMutation({
    onSuccess: () => { toast.success("Cliente creado"); utils.crm.clients.list.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.crm.clients.update.useMutation({
    onSuccess: () => { toast.success("Cliente actualizado"); utils.crm.clients.list.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.name || !form.email) { toast.error("Nombre y email son obligatorios"); return; }
    if (isEdit && client) {
      update.mutate({ id: client.id, ...form });
    } else {
      create.mutate(form);
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <DialogContent className="max-w-lg bg-[#0d1526] border-white/10 text-white">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-400" />
          {isEdit ? "Editar cliente" : "Nuevo cliente"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Nombre completo *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Teléfono</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Empresa</Label>
            <Input value={form.company} onChange={(e) => set("company", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">NIF / CIF</Label>
            <Input value={form.nif} onChange={(e) => set("nif", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Dirección</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Notas internas</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Observaciones sobre el cliente..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cancelar
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending}
          className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white">
          {isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Users className="w-4 h-4 mr-1" />}
          {isEdit ? "Guardar cambios" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ClientsManager() {
  const [search, setSearch] = useState("");
  const [editClient, setEditClient] = useState<ClientRow | null | undefined>(undefined);
  const [deleteClientId, setDeleteClientId] = useState<number | null>(null);

  const searchInput = useMemo(() => ({ q: search, limit: 50 }), [search]);
  const { data: clientsData, isLoading } = trpc.crm.clients.list.useQuery(searchInput);
  const clients = clientsData?.items as ClientRow[] | undefined;
  const utils = trpc.useUtils();

  const deleteClient = trpc.crm.clients.delete.useMutation({
    onSuccess: () => { toast.success("Cliente eliminado"); utils.crm.clients.list.invalidate(); setDeleteClientId(null); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Users className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-white/40 text-xs mb-0.5">
                <Link href="/admin/crm" className="hover:text-white/60 transition-colors">CRM</Link>
                <ChevronRight className="w-3 h-3" />
                <span>Clientes</span>
              </div>
              <h1 className="text-2xl font-bold text-white">Gestión de Clientes</h1>
            </div>
          </div>
          <Button
            onClick={() => setEditClient(null)}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white"
          >
            <Plus className="w-4 h-4 mr-2" /> Nuevo cliente
          </Button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-4 bg-blue-500/5 border border-blue-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-400">{clientsData?.total ?? 0}</div>
                <div className="text-white/40 text-xs">Total clientes</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-purple-500/5 border border-purple-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <Building2 className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-400">
                  {clients?.filter((c) => c.company).length ?? 0}
                </div>
                <div className="text-white/40 text-xs">Con empresa</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-orange-500/5 border border-orange-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <FileText className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-400">0</div>
                <div className="text-white/40 text-xs">Con presupuestos</div>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o empresa..."
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/3">
                <th className="text-left px-4 py-3 text-white/40 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Contacto</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Empresa</th>
                <th className="text-right px-4 py-3 text-white/40 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="text-center py-12 text-white/30">Cargando...</td></tr>
              ) : !clients || clients.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 rounded-full bg-white/5">
                        <Users className="w-8 h-8 text-white/20" />
                      </div>
                      <p className="text-white/30 text-sm">No hay clientes todavía</p>
                      <Button size="sm" onClick={() => setEditClient(null)}
                        className="bg-blue-600 hover:bg-blue-700 text-white mt-1">
                        <Plus className="w-3.5 h-3.5 mr-1" /> Crear primer cliente
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : clients.map((client) => (
                <tr key={client.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-semibold text-sm">
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{client.name}</div>
                        {client.nif && <div className="text-white/30 text-xs">NIF: {client.nif}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-white/60 text-xs">
                        <Mail className="w-3 h-3" /> {client.email}
                      </div>
                      {client.phone && (
                        <div className="flex items-center gap-1.5 text-white/60 text-xs">
                          <Phone className="w-3 h-3" /> {client.phone}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {client.company ? (
                      <div className="flex items-center gap-1.5 text-white/70 text-sm">
                        <Building2 className="w-3.5 h-3.5 text-white/30" /> {client.company}
                      </div>
                    ) : <span className="text-white/20 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost"
                        className="text-blue-400 hover:text-blue-300 h-7 px-2"
                        onClick={() => setEditClient(client)}
                        title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost"
                        className="text-red-400/60 hover:text-red-400 h-7 px-2"
                        onClick={() => setDeleteClientId(client.id)}
                        title="Eliminar">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      <Dialog open={editClient !== undefined} onOpenChange={(o) => !o && setEditClient(undefined)}>
        {editClient !== undefined && (
          <ClientFormModal client={editClient} onClose={() => setEditClient(undefined)} />
        )}
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteClientId !== null} onOpenChange={(o) => !o && setDeleteClientId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" /> Eliminar cliente
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/60 text-sm">
            ¿Seguro que quieres eliminar este cliente? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteClientId(null)}
              className="border-white/15 text-white/60">Cancelar</Button>
            <Button size="sm"
              onClick={() => deleteClientId && deleteClient.mutate({ id: deleteClientId })}
              disabled={deleteClient.isPending}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deleteClient.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
