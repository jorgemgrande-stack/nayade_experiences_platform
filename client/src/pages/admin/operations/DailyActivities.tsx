import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  Waves, User, Users, Phone, Clock, AlertTriangle, CheckCircle2,
  Calendar, ChevronLeft, ChevronRight, RefreshCw, UserCheck, CalendarDays,
  StickyNote, ArrowDownToLine, XCircle, ClipboardList, Hash, ExternalLink,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function formatDate(d: Date) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Returns true if arrivalTime (HH:MM) is within the next 2 hours from now */
function isWithin2Hours(arrivalTime: string, dateStr: string): boolean {
  const [h, m] = arrivalTime.split(":").map(Number);
  const actTs = new Date(dateStr);
  actTs.setHours(h, m, 0, 0);
  const diff = actTs.getTime() - Date.now();
  return diff > 0 && diff < 2 * 60 * 60 * 1000;
}

function getCardBorder(act: any, dateStr: string): string {
  if (act.arrivalTime && isWithin2Hours(act.arrivalTime, dateStr) && !act.clientConfirmed) {
    return "border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.15)]";
  }
  if (!act.arrivalTime) return "border-amber-500/25";
  if (act.clientConfirmed) return "border-emerald-600/30";
  return "border-slate-700";
}

/** Group activities by arrivalTime. Those without time go in "Sin hora" bucket. */
function groupByTime(activities: any[]): { label: string; items: any[] }[] {
  const withTime = activities
    .filter(a => a.arrivalTime)
    .sort((a, b) => a.arrivalTime.localeCompare(b.arrivalTime));
  const withoutTime = activities.filter(a => !a.arrivalTime);

  const groups: { label: string; items: any[] }[] = [];

  // Group by exact arrivalTime slot
  const seen = new Map<string, any[]>();
  for (const act of withTime) {
    if (!seen.has(act.arrivalTime)) seen.set(act.arrivalTime, []);
    seen.get(act.arrivalTime)!.push(act);
  }
  for (const [time, items] of seen) {
    groups.push({ label: time, items });
  }

  if (withoutTime.length > 0) {
    groups.push({ label: "Sin hora asignada", items: withoutTime });
  }

  return groups;
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DailyActivities() {
  const [currentDate, setCurrentDate] = useState(() => {
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
  const [cancelTarget, setCancelTarget] = useState<{ id: number; title: string } | null>(null);

  const dateStr = formatDate(currentDate);

  const { data, isLoading, refetch } = trpc.operations.activities.getForDate.useQuery(
    { date: dateStr },
    { refetchOnWindowFocus: false }
  );

  const { data: monitorsData } = trpc.operations.monitors.list.useQuery(
    { isActive: true },
    { refetchOnWindowFocus: false }
  );

  const utils = trpc.useUtils();

  const assignMonitorMutation = trpc.operations.activities.assignMonitor.useMutation({
    onSuccess: () => utils.operations.activities.getForDate.invalidate(),
    onError: () => toast.error("Error al asignar monitor"),
  });

  const updateDetailsMutation = trpc.operations.activities.updateDetails.useMutation({
    onSuccess: () => utils.operations.activities.getForDate.invalidate(),
    onError: () => toast.error("Error al guardar hora/notas"),
  });

  const confirmArrivalMutation = trpc.operations.activities.confirmArrival.useMutation({
    onSuccess: () => {
      utils.operations.activities.getForDate.invalidate();
      toast.success("Llegada confirmada");
    },
    onError: () => toast.error("Error al confirmar llegada"),
  });

  const cancelActivityMutation = trpc.operations.activities.cancelActivity.useMutation({
    onSuccess: () => {
      utils.operations.activities.getForDate.invalidate();
      setCancelTarget(null);
      toast.success("Actividad anulada");
    },
    onError: () => toast.error("Error al anular la actividad"),
  });

  const activities = (data as any[]) || [];
  const monitors = (monitorsData as any[]) || [];

  const withMonitor = activities.filter((a) => a.monitorId);
  const withoutArrivalTime = activities.filter((a) => !a.arrivalTime);
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

    const monitorChanged = selectedMonitorId !== (selectedActivity.monitorId ? String(selectedActivity.monitorId) : "");
    const detailsChanged = arrivalTime !== (selectedActivity.arrivalTime || "") || opNotes !== (selectedActivity.opNotes || "");

    const promises: Promise<any>[] = [];

    if (monitorChanged) {
      promises.push(
        assignMonitorMutation.mutateAsync({
          reservationId: selectedActivity.id,
          monitorId: selectedMonitorId && selectedMonitorId !== "none" ? parseInt(selectedMonitorId) : null,
        })
      );
    }

    if (detailsChanged) {
      promises.push(
        updateDetailsMutation.mutateAsync({
          reservationId: selectedActivity.id,
          arrivalTime: arrivalTime || undefined,
          opNotes: opNotes || undefined,
        })
      );
    }

    if (promises.length === 0) {
      setShowAssignModal(false);
      setSelectedActivity(null);
      return;
    }

    try {
      await Promise.all(promises);
      toast.success("Actividad actualizada correctamente");
      setShowAssignModal(false);
      setSelectedActivity(null);
    } catch {
      // Errors handled in individual mutation onError
    }
  }

  const groups = groupByTime(activities);

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
              Gestión operativa · recepción · monitores
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
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(d => addDays(d, -1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs">
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCurrentDate(d => addDays(d, 1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 border border-slate-700 rounded-md px-3 h-8 bg-transparent hover:bg-slate-800 transition-colors">
            <CalendarDays className="w-4 h-4 text-blue-400 shrink-0" />
            <input
              type="date"
              value={dateStr}
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
            { label: "Total actividades",  value: activities.length,       color: "text-white",        bg: "bg-slate-800" },
            { label: "Con monitor",        value: withMonitor.length,      color: "text-emerald-300",  bg: "bg-emerald-500/10" },
            { label: "Sin hora llegada",   value: withoutArrivalTime.length, color: "text-amber-300",  bg: "bg-amber-500/10" },
            { label: "Llegada confirmada", value: confirmed.length,         color: "text-blue-300",    bg: "bg-blue-500/10" },
          ].map((k) => (
            <div key={k.label} className={`${k.bg} rounded-xl border border-slate-700 p-4`}>
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-slate-400 text-sm mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-5 flex-wrap text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-red-500/50 bg-red-500/10 inline-block" />
            Inminente sin confirmar (&lt;2h)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-amber-500/40 bg-amber-500/10 inline-block" />
            Sin hora de llegada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-emerald-600/40 bg-emerald-500/10 inline-block" />
            Llegada confirmada
          </span>
        </div>

        {/* Activities grouped by arrival time */}
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
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                {/* Time group header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border",
                    group.label === "Sin hora asignada"
                      ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                      : "border-blue-500/30 text-blue-300 bg-blue-500/10"
                  )}>
                    <Clock className="w-3 h-3" />
                    {group.label === "Sin hora asignada" ? group.label : `Llegada: ${group.label}`}
                    <span className="opacity-60">({group.items.length})</span>
                  </div>
                  <div className="flex-1 h-px bg-white/5" />
                </div>

                <div className="space-y-3">
                  {group.items.map((act: any) => {
                    const statusInfo = STATUS_LABELS[act.status] ?? STATUS_LABELS.pendiente;
                    const isSoon = act.arrivalTime && isWithin2Hours(act.arrivalTime, dateStr);
                    const borderClass = getCardBorder(act, dateStr);

                    return (
                      <div
                        key={act.id}
                        className={cn(
                          "bg-[#111827] border rounded-xl p-5 transition-colors hover:bg-slate-800/50",
                          borderClass
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">

                          {/* Left: activity info */}
                          <div className="flex items-start gap-4 flex-1 min-w-0">
                            <div className={cn(
                              "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                              act.clientConfirmed ? "bg-emerald-500/20" : "bg-blue-500/20"
                            )}>
                              {act.clientConfirmed
                                ? <CheckCheck className="w-6 h-6 text-emerald-400" />
                                : <Waves className="w-6 h-6 text-blue-400" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Title + badges */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-white text-base">
                                  {act.activityTitle || "Actividad"}
                                </h3>
                                <Badge className={`text-xs ${statusInfo.color}`}>
                                  {statusInfo.label}
                                </Badge>
                                {isSoon && !act.clientConfirmed && (
                                  <Badge className="bg-red-500/20 text-red-300 border-red-500 text-xs animate-pulse">
                                    Inminente
                                  </Badge>
                                )}
                              </div>

                              {/* Client info row */}
                              <div className="flex items-center gap-3 mt-2 text-sm text-slate-400 flex-wrap">
                                <span className="flex items-center gap-1 font-medium text-white/80">
                                  <User className="w-3.5 h-3.5 text-slate-500" />
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
                              </div>

                              {/* Localizador + CRM link + confirmación */}
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {act.merchantOrder && (
                                  <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-700/60 border border-slate-600/60 rounded px-2 py-0.5 font-mono">
                                    <Hash className="w-3 h-3 shrink-0" />
                                    {act.merchantOrder}
                                  </span>
                                )}
                                {act.clientEmail && (
                                  <Link href={`/admin/crm?search=${encodeURIComponent(act.clientEmail)}`}>
                                    <span className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded px-2 py-0.5 cursor-pointer transition-colors">
                                      <ExternalLink className="w-3 h-3 shrink-0" />
                                      Ver en CRM
                                    </span>
                                  </Link>
                                )}
                                {act.clientConfirmed ? (
                                  <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Llegada confirmada
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
                                    <AlertTriangle className="w-3 h-3" />
                                    Sin confirmar
                                  </span>
                                )}
                              </div>

                              {/* Arrival time + notes */}
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

                          {/* Right: monitor + actions */}
                          <div className="shrink-0 text-right space-y-1.5">
                            {/* Monitor badge */}
                            {act.monitorName ? (
                              <div className="flex items-center gap-2 justify-end">
                                <div className="text-right">
                                  <div className="text-sm font-medium text-white">{act.monitorName}</div>
                                  <div className="text-xs text-slate-500">Monitor</div>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                  <UserCheck className="w-4 h-4 text-emerald-400" />
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 justify-end">
                                <div className="text-right">
                                  <div className="text-xs text-slate-500">Sin monitor</div>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-slate-700/50 flex items-center justify-center">
                                  <User className="w-4 h-4 text-slate-500" />
                                </div>
                              </div>
                            )}

                            {/* Confirmar llegada (quick action) */}
                            {!act.clientConfirmed && (
                              <Button
                                size="sm"
                                onClick={() => confirmArrivalMutation.mutate({ reservationId: act.id })}
                                disabled={confirmArrivalMutation.isPending}
                                className="w-full bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs gap-1.5 h-7"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Confirmar llegada
                              </Button>
                            )}

                            {/* Detalles receptivo */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAssign(act)}
                              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700 text-xs gap-1.5 h-7"
                            >
                              <ClipboardList className="w-3.5 h-3.5" />
                              {act.monitorName ? "Editar actividad" : "Añadir detalles receptivo"}
                            </Button>

                            {/* Anular */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCancelTarget({ id: act.id, title: act.activityTitle || "Actividad" })}
                              className="w-full border-red-700/40 text-red-400 hover:bg-red-500/10 text-xs gap-1.5 h-7"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Anular
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel Activity Confirm */}
      <AlertDialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <AlertDialogContent className="bg-[#111827] border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">¿Anular actividad?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Se anulará <strong className="text-white">{cancelTarget?.title}</strong>. La reserva quedará marcada como cancelada y desaparecerá del listado y del calendario.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => cancelTarget && cancelActivityMutation.mutate({ reservationId: cancelTarget.id })}
            >
              Anular actividad
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Details / Assign Modal */}
      <Dialog open={showAssignModal} onOpenChange={setShowAssignModal}>
        <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Detalles de receptivo</DialogTitle>
          </DialogHeader>
          {selectedActivity && (
            <div className="space-y-4 mt-2">
              {/* Activity summary */}
              <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-white">{selectedActivity.activityTitle}</p>
                <p className="text-slate-400 text-sm">
                  {selectedActivity.clientName} · {selectedActivity.numberOfPersons} pax
                </p>
                {selectedActivity.merchantOrder && (
                  <p className="text-xs text-slate-500 font-mono flex items-center gap-1">
                    <Hash className="w-3 h-3" />{selectedActivity.merchantOrder}
                  </p>
                )}
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
                <label className="text-sm text-slate-400 mb-2 flex items-center gap-1">
                  <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400" />
                  Hora de llegada del cliente
                </label>
                <Input
                  type="time"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white [color-scheme:dark]"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="text-sm text-slate-400 mb-2 flex items-center gap-1">
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
                <Button variant="outline" onClick={() => setShowAssignModal(false)} className="border-slate-600 text-slate-300">
                  Cancelar
                </Button>
                <Button
                  disabled={assignMonitorMutation.isPending || updateDetailsMutation.isPending}
                  onClick={handleSave}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {assignMonitorMutation.isPending || updateDetailsMutation.isPending ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
