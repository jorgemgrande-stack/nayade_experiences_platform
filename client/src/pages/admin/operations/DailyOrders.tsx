import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CalendarDays, Plus, Users, Clock, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";

function formatDate(d: Date) {
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export default function DailyOrders() {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const dateStr = selectedDate.toISOString().split("T")[0];

  const { data: bookings, isLoading } = trpc.bookings.getAll.useQuery({
    from: dateStr,
    to: dateStr,
    limit: 50,
    offset: 0,
  });

  const todayBookings = bookings?.filter(b => {
    const bDate = new Date(b.scheduledDate).toISOString().split("T")[0];
    return bDate === dateStr && b.status !== "cancelado";
  }) ?? [];

  const totalPersons = todayBookings.reduce((sum, b) => sum + b.numberOfPersons, 0);
  const totalRevenue = todayBookings.reduce((sum, b) => sum + parseFloat(b.totalAmount), 0);

  return (
    <AdminLayout title="Órdenes del Día">
      {/* Selector de fecha */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground capitalize">{formatDate(selectedDate)}</h2>
          <p className="text-sm text-muted-foreground mt-1">{todayBookings.length} actividades programadas</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setSelectedDate(d => addDays(d, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={() => setSelectedDate(d => addDays(d, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Resumen del día */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actividades</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{todayBookings.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Participantes</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalPersons}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-primary font-bold text-sm">€</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Facturación</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalRevenue.toFixed(2)}€</p>
        </div>
      </div>

      {/* Lista de actividades del día */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : todayBookings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card border border-border rounded-xl">
          <CalendarDays className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">Sin actividades este día</p>
          <p className="text-sm text-muted-foreground mt-1">No hay reservas confirmadas para esta fecha</p>
        </div>
      ) : (
        <div className="space-y-3">
          {todayBookings
            .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())
            .map((booking) => (
              <div key={booking.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                        <Clock className="w-4 h-4" />
                        {new Date(booking.scheduledDate).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <Badge variant={booking.status === "confirmado" ? "default" : "secondary"} className="text-xs capitalize">
                        {booking.status}
                      </Badge>
                    </div>
                    <p className="font-semibold text-foreground">{booking.clientName}</p>
                    <p className="text-sm text-muted-foreground">{booking.clientEmail} · {booking.clientPhone ?? "Sin teléfono"}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {booking.numberOfPersons} personas</span>
                      <span className="font-semibold text-foreground">€{parseFloat(booking.totalAmount).toFixed(2)}</span>
                    </div>
                    {booking.notes && (
                      <p className="mt-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">{booking.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => toast.info("Asignación de monitores — próximamente")}>
                      <Plus className="w-3 h-3 mr-1" /> Asignar Monitor
                    </Button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </AdminLayout>
  );
}
