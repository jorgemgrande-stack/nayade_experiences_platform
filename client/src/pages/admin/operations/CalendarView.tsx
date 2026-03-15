import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Calendar, Users, Clock, MapPin, User, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const statusColors: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  confirmado: "bg-blue-100 text-blue-700 border-blue-200",
  en_curso: "bg-purple-100 text-purple-700 border-purple-200",
  completado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelado: "bg-red-100 text-red-700 border-red-200",
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday-based
}

export default function CalendarView() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);

  const { data: bookings, refetch } = trpc.bookings.getAll.useQuery({
    from: new Date(currentYear, currentMonth, 1).toISOString(),
    to: new Date(currentYear, currentMonth + 1, 0).toISOString(),
    limit: 100,
    offset: 0,
  });

  const { data: monitors } = trpc.admin.getUsers.useQuery();

  const assignMonitorMutation = trpc.bookings.updateStatus.useMutation({
      onSuccess: () => { toast.success("Estado actualizado"); refetch(); },
    onError: () => toast.error("Error al actualizar"),
  });

  const updateStatusMutation = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); refetch(); },
    onError: () => toast.error("Error al actualizar estado"),
  });

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const getBookingsForDay = (day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return (bookings ?? []).filter((b) => {
      const bDate = new Date(b.scheduledDate).toISOString().split("T")[0];
      return bDate === dateStr;
    });
  };

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <AdminLayout title="Calendario de Operaciones">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
            {/* Calendar Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-display font-bold text-lg text-foreground">
                {MONTHS[currentMonth]} {currentYear}
              </h2>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={prevMonth} className="w-8 h-8">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); }} className="text-xs">
                  Hoy
                </Button>
                <Button variant="ghost" size="icon" onClick={nextMonth} className="w-8 h-8">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 border-b border-border">
              {DAYS.map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-border/30 bg-muted/10" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dayBookings = getBookingsForDay(day);
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;

                return (
                  <div
                    key={day}
                    className={cn(
                      "min-h-[80px] border-b border-r border-border/30 p-1.5 cursor-pointer transition-colors",
                      isToday && "bg-accent/5",
                      isSelected && "bg-accent/10",
                      !isToday && !isSelected && "hover:bg-muted/30"
                    )}
                    onClick={() => setSelectedDate(dateStr)}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold mb-1",
                      isToday ? "bg-accent text-white" : "text-foreground"
                    )}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayBookings.slice(0, 2).map((b) => (
                        <div
                          key={b.id}
                          className={cn("text-xs px-1.5 py-0.5 rounded truncate border cursor-pointer", statusColors[b.status] ?? "bg-gray-100 text-gray-700")}
                          onClick={(e) => { e.stopPropagation(); setSelectedBooking(b); }}
                        >
                          {"Actividad"}
                        </div>
                      ))}
                      {dayBookings.length > 2 && (
                        <div className="text-xs text-muted-foreground px-1">+{dayBookings.length - 2} más</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar: Day Detail */}
        <div className="space-y-5">
          {/* Legend */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <h3 className="font-display font-semibold text-foreground mb-3">Estado de Actividades</h3>
            <div className="space-y-2">
              {Object.entries(statusColors).map(([status, colors]) => (
                <div key={status} className="flex items-center gap-2">
                  <div className={cn("w-3 h-3 rounded-full border", colors)} />
                  <span className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected Day Activities */}
          {selectedDate && (
            <div className="bg-card rounded-2xl border border-border/50 p-5">
              <h3 className="font-display font-semibold text-foreground mb-3">
                {new Date(selectedDate + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
              </h3>
              {getBookingsForDay(parseInt(selectedDate.split("-")[2])).length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay actividades este día.</p>
              ) : (
                <div className="space-y-3">
                  {getBookingsForDay(parseInt(selectedDate.split("-")[2])).map((b) => (
                    <div
                      key={b.id}
                      className="border border-border/50 rounded-xl p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setSelectedBooking(b)}
                    >
                      <p className="font-medium text-sm text-foreground">{"Actividad"}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        {b.scheduledDate && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(b.scheduledDate).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>}
                        {b.numberOfPersons && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{b.numberOfPersons} pers.</span>}
                      </div>
                      <Badge className={cn("mt-2 text-xs", statusColors[b.status] ?? "")}>{b.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Today's Summary */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <h3 className="font-display font-semibold text-foreground mb-3">Resumen del Mes</h3>
            <div className="space-y-2">
              {[
                { label: "Total Actividades", value: (bookings ?? []).length },
                { label: "Confirmadas", value: (bookings ?? []).filter((b) => b.status === "confirmado").length },
                { label: "En Curso", value: (bookings ?? []).filter((b) => b.status === "en_curso").length },
                { label: "Completadas", value: (bookings ?? []).filter((b) => b.status === "completado").length },
              ].map((s) => (
                <div key={s.label} className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <span className="font-semibold text-foreground">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Booking Detail Modal */}
      <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Detalle de Actividad</DialogTitle>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4 mt-2">
              <div>
                <h3 className="font-semibold text-foreground text-lg">{selectedBooking.experience?.title ?? "Actividad"}</h3>
                <Badge className={cn("mt-1", statusColors[selectedBooking.status] ?? "")}>{selectedBooking.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Fecha</p>
                  <p className="font-medium">{new Date(selectedBooking.scheduledDate).toLocaleDateString("es-ES")}</p>
                </div>
                {selectedBooking.scheduledDate && (
                  <div>
                    <p className="text-xs text-muted-foreground">Hora</p>
                    <p className="font-medium">{new Date(selectedBooking.scheduledDate).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                )}
                {selectedBooking.numberOfPersons && (
                  <div>
                    <p className="text-xs text-muted-foreground">Personas</p>
                    <p className="font-medium">{selectedBooking.numberOfPersons}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Reserva</p>
                  <p className="font-medium">{selectedBooking.bookingNumber}</p>
                </div>
              </div>

              {/* Assign Monitor */}
              <div>
                <Label className="text-xs">Asignar Monitor</Label>
                <Select
                  value={selectedBooking.monitorId ? String(selectedBooking.monitorId) : ""}
                  onValueChange={(v) => toast.info("Asignación de monitor disponible próximamente")}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar monitor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(monitors ?? []).map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Update Status */}
              <div>
                <Label className="text-xs">Actualizar Estado</Label>
                <Select
                  value={selectedBooking.status}
                  onValueChange={(v) => updateStatusMutation.mutate({ id: selectedBooking.id, status: v as any })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                    <SelectItem value="confirmado">Confirmado</SelectItem>
                    <SelectItem value="en_curso">En Curso</SelectItem>
                    <SelectItem value="completado">Completado</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full bg-gold-gradient text-white hover:opacity-90"
                onClick={() => { setShowOrderModal(true); }}
              >
                <Calendar className="w-4 h-4 mr-2" />
                Generar Orden del Día
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
