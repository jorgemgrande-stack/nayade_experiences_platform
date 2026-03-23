import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, CalendarDays, Users, CheckCircle, XCircle, Clock, PlayCircle, CreditCard, ArrowUpDown, Banknote, HelpCircle, ExternalLink } from "lucide-react";
import { Link } from "wouter";

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pendiente:  { label: "Pendiente",  color: "bg-amber-100 text-amber-700",  icon: <Clock className="w-3 h-3" /> },
  confirmado: { label: "Confirmado", color: "bg-blue-100 text-blue-700",    icon: <CheckCircle className="w-3 h-3" /> },
  en_curso:   { label: "En Curso",   color: "bg-green-100 text-green-700",  icon: <PlayCircle className="w-3 h-3" /> },
  completado: { label: "Completado", color: "bg-gray-100 text-gray-700",    icon: <CheckCircle className="w-3 h-3" /> },
  cancelado:  { label: "Cancelado",  color: "bg-red-100 text-red-700",      icon: <XCircle className="w-3 h-3" /> },
};

const sourceConfig: Record<string, { label: string; color: string; icon: React.ReactNode; crmTab: string }> = {
  redsys:         { label: "Tarjeta (Redsys)",  color: "bg-violet-100 text-violet-700", icon: <CreditCard className="w-3 h-3" />,  crmTab: "reservations" },
  transferencia:  { label: "Transferencia",     color: "bg-sky-100 text-sky-700",       icon: <ArrowUpDown className="w-3 h-3" />, crmTab: "reservations" },
  efectivo:       { label: "Efectivo",          color: "bg-emerald-100 text-emerald-700", icon: <Banknote className="w-3 h-3" />,  crmTab: "reservations" },
  otro:           { label: "Otro",              color: "bg-gray-100 text-gray-600",     icon: <HelpCircle className="w-3 h-3" />, crmTab: "reservations" },
};

export default function BookingsList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const utils = trpc.useUtils();

  const { data: bookings, isLoading } = trpc.bookings.getAll.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
    offset: 0,
  });

  const updateStatus = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => { utils.bookings.getAll.invalidate(); toast.success("Estado actualizado"); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = bookings?.filter(b =>
    b.clientName.toLowerCase().includes(search.toLowerCase()) ||
    b.clientEmail.toLowerCase().includes(search.toLowerCase()) ||
    b.bookingNumber.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <AdminLayout title="Actividades">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Actividades programadas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {filtered.length} actividad{filtered.length !== 1 ? "es" : ""} — generadas automáticamente al confirmar el pago
          </p>
        </div>
      </div>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar actividad..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="confirmado">Confirmado</SelectItem>
            <SelectItem value="en_curso">En Curso</SelectItem>
            <SelectItem value="completado">Completado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CalendarDays className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay actividades programadas</p>
          <p className="text-sm text-muted-foreground mt-1">
            Las actividades se crean automáticamente cuando se confirma un pago (Redsys, transferencia o efectivo)
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nº Actividad</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Personas</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Origen</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((b) => {
                const st = statusConfig[b.status] ?? statusConfig.pendiente;
                const src = sourceConfig[(b as any).sourceChannel ?? ""] ?? null;
                const crmLink = (b as any).reservationId
                  ? `/admin/crm?tab=reservations`
                  : (b as any).quoteId
                    ? `/admin/crm?tab=quotes`
                    : null;
                return (
                  <tr key={b.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-sm font-medium text-foreground">{b.bookingNumber}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-foreground">{b.clientName}</p>
                      <p className="text-xs text-muted-foreground">{b.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-sm text-foreground">
                        <CalendarDays className="w-3.5 h-3.5 text-primary" />
                        {new Date(b.scheduledDate).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-sm text-foreground">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        {b.numberOfPersons}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-foreground">
                      €{parseFloat(b.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5">
                      {src ? (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${src.color}`}>
                          {src.icon} {src.label}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Manual</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1 justify-end items-center">
                        {crmLink && (
                          <Link href={crmLink}>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1">
                              <ExternalLink className="w-3 h-3" /> CRM
                            </Button>
                          </Link>
                        )}
                        {b.status === "pendiente" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => updateStatus.mutate({ id: b.id, status: "confirmado" })}>
                            Confirmar
                          </Button>
                        )}
                        {b.status === "confirmado" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
                            onClick={() => updateStatus.mutate({ id: b.id, status: "completado" })}>
                            Completar
                          </Button>
                        )}
                        {(b.status === "pendiente" || b.status === "confirmado") && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => { if (confirm("¿Cancelar esta actividad?")) updateStatus.mutate({ id: b.id, status: "cancelado" }); }}>
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
