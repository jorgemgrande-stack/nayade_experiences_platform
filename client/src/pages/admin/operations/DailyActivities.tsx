import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  Waves, User, Users, Phone, Clock, AlertTriangle, CheckCircle2,
  Calendar, ChevronLeft, ChevronRight, RefreshCw, UserCheck, CalendarDays,
  StickyNote, ArrowDownToLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
// CRITICAL: use LOCAL date parts — toISOString() shifts day by -1 in UTC+2 Spain
function formatDate(d: Date) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pendiente:  { label: "Pendiente",   color: "bg-amber-500/20 text-amber-300 border-amber-500" },
  confirmado: { label: "Confirmada",  color: "bg-blue-500/20 text-blue-300 border-blue-500" },
  paid:       { label: "Confirmada",  color: "bg-blue-500/20 text-blue-300 border-blue-500" },
  confirmed:  { label: "Confirmada",  color: "bg-blue-500/20 text-blue-300 border-blue-500" },
  en_curso:   { label: "En curso",    color: "bg-purple-500/20 text-purple-300 border-purple-500" },
  completado: { label: "Completado",  color: "bg-emerald-500/20 text-emerald-300 border-emerald-500" },
  cancelado:  { label: "Cancelado",   color: "bg-red-500/20 text-red-300 border-red-500" },
  cancelled:  { label: "Cancelada",   color: "bg-red-500/20 text-red-300 border-red-500" },
  incidencia: { label: "Incidencia",  color: "bg-orange-500/20 text-orange-300 border-orange-500" },
};

export default function DailyActivities() {
  const [currentDate, setCurrentDate] = useState(() => {
    // Support navigation from CalendarView via sessionStorage
    const stored = sessionStorage.getItem("activitiesDate");
    if (stored) {
      sessionStorage.removeItem("activitiesDate");
      const [y, m, d] = stored.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  });

  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string>("");
  const [arrivalTime, setArrivalTime] = useState<string>("");
  const [opNotes, setOpNotes] = useState<string>("");

  const dateStr = formatDate(currentDate);

  const { data, isLoading, refetch } = trpc.operations.activities.getForDate.useQuery(
    { date: dateStr },
    { refetchOnWindowFocus: false }
  );

  const { data: monitorsData } = trpc.operations.monitors.list.useQuery(
    { isActive: true },
    { refetchOnWindowFocus: false }
  );

  const assignMonitorMutation = trpc.operations.activities.assignMonitor.useMutation({
    onSuccess: () => {
      toast.success("Actividad actualizada correctamente");
      setShowAssignModal(false);
      setSelectedActivity(null);
      refetch();
    },
    onError: () => toast.error("Error al actualizar la actividad"),
  });

  // Also use dailyOrders.updateOperational to save arrivalTime and opNotes
  const updateOperationalMutation = trpc.operations.dailyOrders.updateOperational.useMutation({
    onSuccess: () => {
      // Silently succeed — assignMonitor handles the toast
    },
    onError: () => toast.error("Error al guardar hora/notas"),
  });

  const activities = (data as any[]) || [];
  const monitors = (monitorsData as any[]) || [];

  const withMonitor = activities.filter((a) => a.monitorId);
  const withoutMonitor = activities.filter((a) => !a.monitorId);
  const confirmed = activities.filter((a) => a.clientConfirmed);

  function openAssign(act: any) {
    setSelectedActivity(act);
    setSelectedMonitorId(act.monitorId ? String(act.monitorId) : "");
    setArrivalTime(act.arrivalTime || "");
    setOpNotes(act.opNotes || "");
    setShowAssignModal(true);
  }

  async function handleSave() {
    if (!selectedActivity) return;

    // 1. Assign monitor (existing procedure)
    assignMonitorMutation.mutate({
      reservationId: selectedActivity.id,
      monitorId: selectedMonitorId ? parseInt(selectedMonitorId) : null,
    });

    // 2. Save arrivalTime and opNotes via updateOperational
    if (arrivalTime !== (selectedActivity.arrivalTime || "") || opNotes !== (selectedActivity.opNotes || "")) {
      updateOperationalMutation.mutate({
        reservationId: selectedActivity.id,
        reservationType: "activity",
        arrivalTime: arrivalTime || undefined,
        opNotes: opNotes || undefined,
      });
    }
  }

  return (
    <AdminLayout title="Actividades del Día">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Waves className="w-6 h-6 text-blue-400" />
              Actividades del Día
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Gestión operativa · asignación de monitores · hora de llegada
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Date Navigation */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDate(d => addDays(d, -1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs"
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDate(d => addDays(d, 1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 border border-slate-700 rounded-md px-3 h-8 bg-transparent hover:bg-slate-800 transition-colors">
            <CalendarDays className="w-4 h-4 text-blue-400 shrink-0" />
            <input
              type="date"
              value={formatDate(currentDate)}
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split("-").map(Number);
                  setCurrentDate(new Date(y, m - 1, d));
                }
              }}
              className="bg-transparent text-slate-300 text-sm border-none outline-none cursor-pointer [color-scheme:dark]"
            />
          </div>
          <h2 className="text-lg font-semibold text-white capitalize">
            {currentDate.toLocaleDateString("es-ES", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </h2>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total actividades", value: activities.length, color: "text-white", bg: "bg-slate-800" },
            { label: "Con monitor", value: withMonitor.length, color: "text-emerald-300", bg: "bg-emerald-500/10" },
            { label: "Sin monitor", value: withoutMonitor.length, color: "text-red-300", bg: "bg-red-500/10" },
            { label: "Confirmadas", value: confirmed.length, color: "text-blue-300", bg: "bg-blue-500/10" },
          ].map((k) => (
            <div key={k.label} className={`${k.bg} rounded-xl border border-slate-700 p-4`}>
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-slate-400 text-sm mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {withoutMonitor.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="text-red-300 font-semibold">
                {withoutMonitor.length} actividad{withoutMonitor.length > 1 ? "es" : ""} sin monitor asignado
              </p>
              <p className="text-red-400/70 text-sm">
                Asigna monitores antes del inicio de las actividades.
              </p>
            </div>
          </div>
        )}

        {/* Activities List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Cargando actividades...
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay actividades programadas para este día</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((act: any) => {
              const statusInfo = STATUS_LABELS[act.status] ?? STATUS_LABELS.pendiente;
              const isSoon =
                act.scheduledDate &&
                act.scheduledDate - Date.now() < 2 * 60 * 60 * 1000 &&
                act.scheduledDate > Date.now();

              return (
                <div
                  key={act.id}
                  className={`bg-[#111827] border rounded-xl p-5 transition-colors hover:bg-slate-800/50 ${
                    !act.monitorId ? "border-red-500/30" : "border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                        <Waves className="w-6 h-6 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-white text-lg">
                            {act.activityTitle || "Actividad"}
                          </h3>
                          <Badge className={`text-xs ${statusInfo.color}`}>
                            {statusInfo.label}
                          </Badge>
                          {isSoon && (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500 text-xs">
                              Próxima
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-sm text-slate-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {act.scheduledDate ? formatTime(act.scheduledDate) : "—"}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            {act.clientName}
                          </span>
                          {act.clientPhone && (
                            <a
                              href={`tel:${act.clientPhone}`}
                              className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              {act.clientPhone}
                            </a>
                          )}
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {act.numberOfPersons} pax
                          </span>
                          {act.clientConfirmed ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirmado
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Sin confirmar
                            </span>
                          )}
                        </div>
                        {/* Arrival time + notes badges */}
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {act.arrivalTime && (
                            <span className="flex items-center gap-1 text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-0.5">
                              <ArrowDownToLine className="w-3 h-3" />
                              Llegada: {act.arrivalTime}
                            </span>
                          )}
                          {act.opNotes && (
                            <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-700/50 border border-slate-600 rounded px-2 py-0.5 max-w-xs truncate">
                              <StickyNote className="w-3 h-3 shrink-0" />
                              {act.opNotes}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Monitor section */}
                    <div className="shrink-0 text-right">
                      {act.monitorName ? (
                        <div className="flex items-center gap-2 justify-end">
                          <div className="text-right">
                            <div className="text-sm font-medium text-white">{act.monitorName}</div>
                            <div className="text-xs text-slate-500">Monitor asignado</div>
                          </div>
                          <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <UserCheck className="w-4 h-4 text-emerald-400" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          <div className="text-right">
                            <div className="text-sm font-medium text-red-400">Sin monitor</div>
                            <div className="text-xs text-slate-500">Asignar urgente</div>
                          </div>
                          <div className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                          </div>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAssign(act)}
                        className="mt-2 border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                      >
                        {act.monitorName ? "Editar actividad" : "Asignar monitor"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Assign / Edit Modal */}
      <Dialog open={showAssignModal} onOpenChange={setShowAssignModal}>
        <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Editar actividad</DialogTitle>
          </DialogHeader>
          {selectedActivity && (
            <div className="space-y-4 mt-2">
              {/* Activity summary */}
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="font-semibold text-white">{selectedActivity.activityTitle}</p>
                <p className="text-slate-400 text-sm mt-1">
                  {selectedActivity.scheduledDate ? formatTime(selectedActivity.scheduledDate) : "—"} ·{" "}
                  {selectedActivity.clientName} · {selectedActivity.numberOfPersons} pax
                </p>
              </div>

              {/* Monitor selector */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Monitor asignado</label>
                <Select value={selectedMonitorId} onValueChange={setSelectedMonitorId}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Seleccionar monitor..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="none" className="text-slate-400">Sin monitor</SelectItem>
                    {monitors.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)} className="text-white">
                        {m.fullName}
                        {m.specialty && (
                          <span className="text-slate-400 ml-2 text-xs">· {m.specialty}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Arrival time */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block flex items-center gap-1">
                  <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400" />
                  Hora de llegada del cliente
                </label>
                <Input
                  type="time"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white [color-scheme:dark]"
                  placeholder="HH:MM"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block flex items-center gap-1">
                  <StickyNote className="w-3.5 h-3.5 text-amber-400" />
                  Notas de la actividad
                </label>
                <Textarea
                  value={opNotes}
                  onChange={(e) => setOpNotes(e.target.value)}
                  placeholder="Notas internas para el equipo operativo..."
                  className="bg-slate-800 border-slate-600 text-white resize-none"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowAssignModal(false)}
                  className="border-slate-600 text-slate-300"
                >
                  Cancelar
                </Button>
                <Button
                  disabled={assignMonitorMutation.isPending || updateOperationalMutation.isPending}
                  onClick={handleSave}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {assignMonitorMutation.isPending ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
