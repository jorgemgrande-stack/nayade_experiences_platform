import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Plus, Search, Pencil, Trash2, RefreshCw, Phone, Mail,
  Building2, FileText, ChevronRight, UserCheck, UserPlus, ArrowRight,
  MapPin, CreditCard, Calendar, Globe, Tag
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ClientRow = {
  id: number;
  leadId: number | null;
  source: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  nif: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  birthDate: string | null;
  notes: string | null;
  isConverted: boolean;
  totalBookings: number;
  totalSpent: string | null;
  lastBookingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── EXPAND DATA MODAL (cuando se convierte en reserva) ─────────────────────

function ExpandDataModal({
  client,
  onClose,
}: {
  client: ClientRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    nif: client.nif ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    postalCode: client.postalCode ?? "",
    country: client.country ?? "ES",
    birthDate: client.birthDate ?? "",
    notes: client.notes ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const expand = trpc.crm.clients.expand.useMutation({
    onSuccess: () => {
      toast.success("Datos del cliente ampliados. ¡Cliente convertido!");
      utils.crm.clients.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-lg bg-[#0d1526] border-white/10 text-white">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-green-400" />
          Ampliar datos del cliente
        </DialogTitle>
      </DialogHeader>

      {/* Info del cliente */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 mb-2">
        <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-300 font-bold text-sm">
          {client.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-white font-medium text-sm">{client.name}</div>
          <div className="text-white/40 text-xs">{client.email}</div>
        </div>
        <div className="ml-auto">
          <span className="px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/25 text-orange-300 text-xs">
            Convirtiendo a cliente
          </span>
        </div>
      </div>

      <p className="text-white/40 text-xs mb-3">
        Estos datos se guardarán en el perfil del cliente para futuras reservas y facturas.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <CreditCard className="w-3 h-3" /> NIF / CIF
            </Label>
            <Input value={form.nif} onChange={(e) => set("nif", e.target.value)}
              placeholder="12345678A"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Fecha de nacimiento
            </Label>
            <Input type="date" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)}
              className="bg-white/5 border-white/10 text-white mt-1 text-sm" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Dirección
            </Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)}
              placeholder="Calle, número, piso..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Ciudad</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)}
              placeholder="Madrid"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Código postal</Label>
            <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)}
              placeholder="28001"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <Globe className="w-3 h-3" /> País
            </Label>
            <Input value={form.country} onChange={(e) => set("country", e.target.value)}
              placeholder="ES"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs flex items-center gap-1">
              <Tag className="w-3 h-3" /> Notas internas
            </Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Observaciones..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-1 text-sm" />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cancelar
        </Button>
        <Button size="sm" onClick={() => expand.mutate({ id: client.id, ...form })}
          disabled={expand.isPending}
          className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white">
          {expand.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <UserCheck className="w-4 h-4 mr-1" />}
          Guardar y convertir
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── CLIENT FORM MODAL (crear / editar) ─────────────────────────────────────

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
    city: client?.city ?? "",
    postalCode: client?.postalCode ?? "",
    country: client?.country ?? "ES",
    birthDate: client?.birthDate ?? "",
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
          <div>
            <Label className="text-white/60 text-xs">Ciudad</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Código postal</Label>
            <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)}
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

// ─── SOURCE BADGE ─────────────────────────────────────────────────────────────

function SourceBadge({ source, leadId }: { source: string; leadId: number | null }) {
  if (source === "lead" && leadId) {
    return (
      <Link href={`/admin/crm?lead=${leadId}`}>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px] cursor-pointer hover:bg-blue-500/20 transition-colors">
          <ArrowRight className="w-2.5 h-2.5" /> Lead #{leadId}
        </span>
      </Link>
    );
  }
  if (source === "manual") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/30 text-[10px]">
        Manual
      </span>
    );
  }
  return null;
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ClientsManager() {
  const [search, setSearch] = useState("");
  const [editClient, setEditClient] = useState<ClientRow | null | undefined>(undefined);
  const [expandClient, setExpandClient] = useState<ClientRow | null>(null);
  const [deleteClientId, setDeleteClientId] = useState<number | null>(null);

  const searchInput = useMemo(() => ({ q: search, limit: 50 }), [search]);
  const { data: clientsData, isLoading } = trpc.crm.clients.list.useQuery(
    { search, limit: 50 }
  );
  const clientsList = clientsData?.items as ClientRow[] | undefined;
  const utils = trpc.useUtils();

  const convertedCount = clientsList?.filter((c) => c.isConverted).length ?? 0;
  const fromLeadCount = clientsList?.filter((c) => c.source === "lead").length ?? 0;

  const deleteClient = trpc.crm.clients.delete.useMutation({
    onSuccess: () => { toast.success("Cliente eliminado"); utils.crm.clients.list.invalidate(); setDeleteClientId(null); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout>
      <div className="min-h-screen bg-[#080e1c] text-white px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/25">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-white/30 text-xs mb-0.5">
                <Link href="/admin/crm" className="hover:text-white/60 transition-colors">CRM</Link>
                <ChevronRight className="w-3 h-3" />
                <span>Clientes</span>
              </div>
              <h1 className="text-xl font-bold text-white leading-none">Gestión de Clientes</h1>
              <p className="text-xs text-white/40 mt-0.5">Los clientes se crean automáticamente al recibir un lead</p>
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
        <div className="grid grid-cols-4 gap-4 mb-6">
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
          <div className="rounded-xl p-4 bg-green-500/5 border border-green-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                <UserCheck className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-green-400">{convertedCount}</div>
                <div className="text-white/40 text-xs">Convertidos</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl p-4 bg-orange-500/5 border border-orange-500/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <UserPlus className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-400">{fromLeadCount}</div>
                <div className="text-white/40 text-xs">Desde lead</div>
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
                  {clientsList?.filter((c) => c.company).length ?? 0}
                </div>
                <div className="text-white/40 text-xs">Con empresa</div>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
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
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="text-left px-4 py-3 text-white/40 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Contacto</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Empresa</th>
                <th className="text-left px-4 py-3 text-white/40 font-medium">Estado</th>
                <th className="text-right px-4 py-3 text-white/40 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-12 text-white/30">Cargando...</td></tr>
              ) : !clientsList || clientsList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 rounded-full bg-white/5">
                        <Users className="w-8 h-8 text-white/20" />
                      </div>
                      <p className="text-white/30 text-sm">No hay clientes todavía</p>
                      <p className="text-white/20 text-xs">Se crearán automáticamente al recibir leads</p>
                    </div>
                  </td>
                </tr>
              ) : clientsList.map((client) => (
                <tr key={client.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-300 font-bold text-sm flex-shrink-0">
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{client.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <SourceBadge source={client.source} leadId={client.leadId} />
                          {client.nif && (
                            <span className="text-white/25 text-[10px]">NIF: {client.nif}</span>
                          )}
                        </div>
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
                      {client.city && (
                        <div className="flex items-center gap-1.5 text-white/40 text-xs">
                          <MapPin className="w-3 h-3" /> {client.city}
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
                    {client.isConverted ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-xs">
                        <UserCheck className="w-3 h-3" /> Cliente
                      </span>
                    ) : (
                      <button
                        onClick={() => setExpandClient(client)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-300 text-xs hover:bg-orange-500/20 transition-colors cursor-pointer"
                        title="Ampliar datos para convertir en cliente"
                      >
                        <UserPlus className="w-3 h-3" /> Lead
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {!client.isConverted && (
                        <Button size="sm" variant="ghost"
                          className="text-green-400 hover:text-green-300 h-7 px-2"
                          onClick={() => setExpandClient(client)}
                          title="Ampliar datos del cliente">
                          <UserCheck className="w-3.5 h-3.5" />
                        </Button>
                      )}
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

      {/* Expand Data Modal */}
      <Dialog open={expandClient !== null} onOpenChange={(o) => !o && setExpandClient(null)}>
        {expandClient && (
          <ExpandDataModal client={expandClient} onClose={() => setExpandClient(null)} />
        )}
      </Dialog>

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
