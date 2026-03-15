import { useState } from "react";
import { Users, Mail, Phone, Calendar, MessageSquare, ArrowRight, Filter, Search, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const statusColors: Record<string, string> = {
  nuevo: "bg-blue-100 text-blue-700",
  contactado: "bg-purple-100 text-purple-700",
  en_proceso: "bg-amber-100 text-amber-700",
  convertido: "bg-emerald-100 text-emerald-700",
  perdido: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  en_proceso: "En Proceso",
  convertido: "Convertido",
  perdido: "Perdido",
};

export default function LeadsManager() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<any>(null);

  const { data: leads, refetch } = trpc.leads.getAll.useQuery({ limit: 50, offset: 0 });
  const updateStatusMutation = trpc.leads.updateStatus.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); refetch(); },
    onError: () => toast.error("Error al actualizar"),
  });

  const filtered = (leads ?? []).filter((lead) => {
    const matchSearch = !search || lead.name.toLowerCase().includes(search.toLowerCase()) || lead.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || lead.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: (leads ?? []).length,
    nuevo: (leads ?? []).filter((l) => l.status === "nuevo").length,
    en_proceso: (leads ?? []).filter((l) => l.status === "en_proceso").length,
    convertido: (leads ?? []).filter((l) => l.status === "convertido").length,
  };

  return (
    <AdminLayout title="Gestión de Leads">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Leads", value: stats.total, color: "text-foreground" },
          { label: "Nuevos", value: stats.nuevo, color: "text-blue-600" },
          { label: "En Proceso", value: stats.en_proceso, color: "text-amber-600" },
          { label: "Convertidos", value: stats.convertido, color: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="bg-card rounded-xl border border-border/50 p-4 text-center">
            <div className={cn("text-2xl font-display font-bold", s.color)}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre o email..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="nuevo">Nuevo</SelectItem>
            <SelectItem value="contactado">Contactado</SelectItem>
            <SelectItem value="en_proceso">En Proceso</SelectItem>
            <SelectItem value="convertido">Convertido</SelectItem>
            <SelectItem value="perdido">Perdido</SelectItem>
          </SelectContent>
        </Select>
        <Button asChild className="bg-gold-gradient text-white hover:opacity-90">
          <Link href="/admin/presupuestos/nuevo">
            <FileText className="w-4 h-4 mr-2" />
            Nuevo Presupuesto
          </Link>
        </Button>
      </div>

      {/* Leads Table */}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contacto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Interés</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No hay leads {statusFilter !== "all" ? "con este estado" : "registrados"}.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((lead) => (
                  <tr key={lead.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelectedLead(lead)}>
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-medium text-sm text-foreground">{lead.name}</p>
                        {lead.company && <p className="text-xs text-muted-foreground">{lead.company}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="w-3 h-3" />
                          <span className="truncate max-w-[160px]">{lead.email}</span>
                        </div>
                        {lead.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Phone className="w-3 h-3" />
                            {lead.phone}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-xs text-muted-foreground">
                        {lead.numberOfPersons && <span>{lead.numberOfPersons} pers.</span>}
                        {lead.budget && <span className="ml-2 text-accent font-medium">{lead.budget}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge className={cn("text-xs", statusColors[lead.status] ?? "bg-gray-100 text-gray-700")}>
                        {statusLabels[lead.status] ?? lead.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={lead.status}
                          onValueChange={(v) => updateStatusMutation.mutate({ id: lead.id, status: v as any })}
                        >
                          <SelectTrigger className="w-32 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="nuevo">Nuevo</SelectItem>
                            <SelectItem value="contactado">Contactado</SelectItem>
                            <SelectItem value="en_proceso">En Proceso</SelectItem>
                            <SelectItem value="convertido">Convertido</SelectItem>
                            <SelectItem value="perdido">Perdido</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="w-7 h-7">
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead Detail Modal */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Detalle del Lead</DialogTitle>
          </DialogHeader>
          {selectedLead && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Nombre</p>
                  <p className="font-medium text-foreground">{selectedLead.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-medium text-foreground">{selectedLead.email}</p>
                </div>
                {selectedLead.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground">Teléfono</p>
                    <p className="font-medium text-foreground">{selectedLead.phone}</p>
                  </div>
                )}
                {selectedLead.company && (
                  <div>
                    <p className="text-xs text-muted-foreground">Empresa</p>
                    <p className="font-medium text-foreground">{selectedLead.company}</p>
                  </div>
                )}
                {selectedLead.numberOfPersons && (
                  <div>
                    <p className="text-xs text-muted-foreground">Personas</p>
                    <p className="font-medium text-foreground">{selectedLead.numberOfPersons}</p>
                  </div>
                )}
                {selectedLead.budget && (
                  <div>
                    <p className="text-xs text-muted-foreground">Presupuesto</p>
                    <p className="font-medium text-accent">{selectedLead.budget}</p>
                  </div>
                )}
                {selectedLead.preferredDate && (
                  <div>
                    <p className="text-xs text-muted-foreground">Fecha Preferida</p>
                    <p className="font-medium text-foreground">{new Date(selectedLead.preferredDate).toLocaleDateString("es-ES")}</p>
                  </div>
                )}
              </div>
              {selectedLead.message && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Mensaje</p>
                  <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground whitespace-pre-line">{selectedLead.message}</div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setSelectedLead(null)}>Cerrar</Button>
                <Button asChild className="flex-1 bg-gold-gradient text-white hover:opacity-90">
                  <Link href="/admin/presupuestos/nuevo">
                    <FileText className="w-4 h-4 mr-2" />
                    Crear Presupuesto
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
