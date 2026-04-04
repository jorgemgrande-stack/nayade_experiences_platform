/**
 * DailyActivities — Actividades del día con estructura 2 niveles
 * Nivel 1: Tarjeta de RESERVA con datos generales + estado operativo
 * Nivel 2: Actividades de la reserva (principal + extras desplegables)
 * Solo reservas confirmadas (status=paid, statusReservation!=ANULADA)
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  Waves, User, Users, Phone, Clock, AlertTriangle, CheckCircle2,
  Calendar, ChevronLeft, ChevronRight, RefreshCw, UserCheck, CalendarDays,
  StickyNote, XCircle, ClipboardList, Hash, ExternalLink,
  CheckCheck, ChevronDown, ChevronUp, Mail,
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
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isWithin2Hours(arrivalTime: string, dateStr: string): boolean {
  const [h, m] = arrivalTime.split(":").map(Number);
  const actTs = new Date(dateStr);
  actTs.setHours(h, m, 0, 0);
  const diff = actTs.getTime() - Date.now();
  return diff > 0 && diff < 2 * 60 * 60 * 1000;
}

// ─── Tipos de estado operativo ─────────────────────────────────────────────────
type OpState = "completa" | "sin_monitor" | "sin_hora" | "incidencia" | "heredado";

function getReservationOpState(res: any): OpState {
  if (res.opStatus === "incidencia") return "incidencia";
  if (!res.monitorId) return "sin_monitor";
  if (!res.arrivalTime) return "sin_hora";
  return "completa";
}

const OP_CONFIG: Record<OpState, { label: string; dot: string; border: string; bg: string }> = {
  completa:    { label: "Operativa completa",  dot: "bg-emerald-400", border: "border-l-emerald-500", bg: "bg-emerald-500/10" },
  sin_monitor: { label: "Sin monitor",         dot: "bg-red-400",     border: "border-l-red-500",     bg: "bg-red-500/10" },
  sin_hora:    { label: "Sin hora llegada",    dot: "bg-amber-400",   border: "border-l-amber-500",   bg: "bg-amber-500/10" },
  incidencia:  { label: "Incidencia",          dot: "bg-orange-400",  border: "border-l-orange-500",  bg: "bg-orange-500/10" },
  heredado:    { label: "Datos heredados",     dot: "bg-blue-400",    border: "border-l-blue-500",    bg: "bg-blue-500/10" },
};

type FilterType = "all" | "sin_monitor" | "sin_hora" | "incidencia" | "completa";

// ─── Parsear actividades extras + herencia operativa ──────────────────────────
function parseExtras(extrasJson: string | null | undefined): any[] {
  try { return extrasJson ? JSON.parse(extrasJson) : []; } catch { return []; }
}
function parseActivitiesOp(json: string | null | undefined): Array<{ index: number; monitorId?: number | null; arrivalTime?: string; opNotes?: string }> {
  try { return json ? JSON.parse(json) : []; } catch { return []; }
}
function getActivityOp(index: number, activitiesOpJson: any[], res: any) {
  const override = activitiesOpJson.find((a: any) => a.index === index);
  return {
    monitorId:   override?.monitorId   !== undefined ? override.monitorId   : (res.monitorId   ?? null),
    arrivalTime: override?.arrivalTime !== undefined ? override.arrivalTime : (res.arrivalTime ?? null),
    opNotes:     override?.opNotes     !== undefined ? override.opNotes     : (res.opNotes     ?? null),
    isInherited: !override,
  };
}

// ─── Componente de actividad interna (sub-item) ────────────────────────────────
function ActivitySubItem({
  index, title, pax, op, monitors, onEdit,
}: {
  index: number;
  title: string;
  pax: number | string;
  op: ReturnType<typeof getActivityOp>;
  monitors: any[];
  onEdit: () => void;
}) {
  const monitorName = op.monitorId ? monitors.find(m => m.id === op.monitorId)?.fullName || `Monitor #${op.monitorId}` : null;
  return (
    <div className="flex items-start justify-between gap-3 bg-slate-900/60 rounded-lg p-3 border border-slate-700/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-white/90 truncate">{title}</p>
          <span className="text-[10px] text-slate-500">{pax} pax</span>
          {op.isInherited && (
            <Badge className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/30">Heredado</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
          <span className={cn("flex items-center gap-1", monitorName ? "text-emerald-400" : "text-red-400")}>
            <User className="w-3 h-3" />
            {monitorName || "Sin monitor"}
          </span>
          <span className={cn("flex items-center gap-1", op.arrivalTime ? "text-cyan-400" : "text-amber-400")}>
            <Clock className="w-3 h-3" />
            {op.arrivalTime || "Sin hora"}
          </span>
          {op.opNotes && (
            <span className="flex items-center gap-1 text-slate-400 italic truncate max-w-xs">
              <StickyNote className="w-3 h-3 shrink-0" />
              {op.opNotes}
            </span>
          )}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onEdit}
        className="shrink-0 border-slate-600 text-slate-400 hover:bg-slate-700 text-[10px] h-7 px-2 gap-1">
        <ClipboardList className="w-3 h-3" /> Editar
      </Button>
    </div>
  );
}

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

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [editTarget, setEditTarget] = useState<{ reservationId: number; activityIndex: number; title: string; current: ReturnType<typeof getActivityOp> } | null>(null);
  const [editMonitorId, setEditMonitorId] = useState<string>("");
  const [editArrivalTime, setEditArrivalTime] = useState<string>("");
  const [editOpNotes, setEditOpNotes] = useState<string>("");
  const [cancelTarget, setCancelTarget] = useState<{ id: number; title: string } | null>(null);
  const [opFilter, setOpFilter] = useState<FilterType>("all");

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
  const invalidate = () => utils.operations.activities.getForDate.invalidate();

  const updateDetailsMutation = trpc.operations.activities.updateDetails.useMutation({
    onSuccess: () => { invalidate(); toast.success("Datos guardados"); setEditTarget(null); },
    onError: () => toast.error("Error al guardar"),
  });

  const updateActivityOpMutation = trpc.operations.activities.updateActivityOp.useMutation({
    onSuccess: () => { invalidate(); toast.success("Actividad actualizada"); setEditTarget(null); },
    onError: () => toast.error("Error al guardar actividad"),
  });

  const confirmArrivalMutation = trpc.operations.activities.confirmArrival.useMutation({
    onSuccess: () => { invalidate(); toast.success("Llegada confirmada"); },
    onError: () => toast.error("Error al confirmar llegada"),
  });

  const cancelActivityMutation = trpc.operations.activities.cancelActivity.useMutation({
    onSuccess: () => { invalidate(); setCancelTarget(null); toast.success("Actividad anulada"); },
    onError: () => toast.error("Error al anular"),
  });

  const reservations = (data as any[]) || [];
  const monitors = (monitorsData as any[]) || [];

  // Filtros operativos
  const filtered = reservations.filter(res => {
    const state = getReservationOpState(res);
    if (opFilter === "all") return true;
    if (opFilter === "sin_monitor") return state === "sin_monitor";
    if (opFilter === "sin_hora") return state === "sin_hora";
    if (opFilter === "incidencia") return state === "incidencia";
    if (opFilter === "completa") return state === "completa";
    return true;
  });

  // KPIs
  const sinMonitor = reservations.filter(r => !r.monitorId).length;
  const sinHora = reservations.filter(r => !r.arrivalTime).length;
  const confirmados = reservations.filter(r => r.clientConfirmed).length;
  const incidencias = reservations.filter(r => r.opStatus === "incidencia").length;

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openEditReservation(res: any) {
    const op = { monitorId: res.monitorId ?? null, arrivalTime: res.arrivalTime ?? null, opNotes: res.opNotes ?? null, isInherited: false };
    setEditTarget({ reservationId: res.id, activityIndex: -1, title: `${res.clientName} — ${res.activityTitle}`, current: op });
    setEditMonitorId(res.monitorId ? String(res.monitorId) : "none");
    setEditArrivalTime(res.arrivalTime || "");
    setEditOpNotes(res.opNotes || "");
  }

  function openEditActivity(res: any, index: number, title: string) {
    const activitiesOpJson = parseActivitiesOp(res.activitiesOpJson);
    const op = getActivityOp(index, activitiesOpJson, res);
    setEditTarget({ reservationId: res.id, activityIndex: index, title, current: op });
    setEditMonitorId(op.monitorId ? String(op.monitorId) : "none");
    setEditArrivalTime(op.arrivalTime || "");
    setEditOpNotes(op.opNotes || "");
  }

  async function handleSave() {
    if (!editTarget) return;
    const monitorId = editMonitorId && editMonitorId !== "none" ? parseInt(editMonitorId) : null;

    if (editTarget.activityIndex === -1) {
      // Guardar en nivel reserva (datos generales)
      await updateDetailsMutation.mutateAsync({
        reservationId: editTarget.reservationId,
        monitorId,
        arrivalTime: editArrivalTime || undefined,
        opNotes: editOpNotes || undefined,
      });
    } else {
      // Guardar override de actividad específica
      await updateActivityOpMutation.mutateAsync({
        reservationId: editTarget.reservationId,
        activityIndex: editTarget.activityIndex,
        monitorId,
        arrivalTime: editArrivalTime || undefined,
        opNotes: editOpNotes || undefined,
      });
    }
  }

  const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
    { value: "all",         label: "Todas" },
    { value: "completa",    label: "Operativa completa" },
    { value: "sin_monitor", label: "Sin monitor" },
    { value: "sin_hora",    label: "Sin hora de llegada" },
    { value: "incidencia",  label: "Con incidencia" },
  ];

  return (
    <AdminLayout title="Actividades del Día">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Waves className="w-6 h-6 text-blue-400" />
              Actividades del Día
            </h1>
            <p className="text-slate-400 text-sm mt-1">Reservas confirmadas · gestión operativa</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Navegación de fecha */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
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
            <input type="date" value={dateStr}
              onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split("-").map(Number); setCurrentDate(new Date(y, m - 1, d)); } }}
              className="bg-transparent text-slate-300 text-sm border-none outline-none cursor-pointer [color-scheme:dark]" />
          </div>
          <h2 className="text-base font-semibold text-white capitalize">
            {currentDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </h2>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Reservas", value: reservations.length, color: "text-white", bg: "bg-slate-800" },
            { label: "Sin monitor", value: sinMonitor, color: sinMonitor > 0 ? "text-red-400" : "text-emerald-400", bg: sinMonitor > 0 ? "bg-red-500/10" : "bg-slate-800" },
            { label: "Sin hora llegada", value: sinHora, color: sinHora > 0 ? "text-amber-400" : "text-emerald-400", bg: sinHora > 0 ? "bg-amber-500/10" : "bg-slate-800" },
            { label: "Llegada confirmada", value: confirmados, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          ].map(k => (
            <div key={k.label} className={`${k.bg} rounded-xl border border-slate-700 p-4`}>
              <div className={`text-3xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-slate-400 text-sm mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Filtros operativos */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {FILTER_OPTIONS.map(opt => (
            <button key={opt.value}
              onClick={() => setOpFilter(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                opFilter === opt.value
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-transparent border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300"
              )}>
              {opt.label}
              {opt.value !== "all" && (
                <span className="ml-1.5 opacity-60">
                  ({opt.value === "sin_monitor" ? sinMonitor
                    : opt.value === "sin_hora" ? sinHora
                    : opt.value === "incidencia" ? incidencias
                    : reservations.length - sinMonitor - sinHora - incidencias})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Lista de reservas */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />Cargando reservas...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{reservations.length === 0 ? "No hay reservas confirmadas para este día" : "No hay reservas con este filtro"}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((res: any) => {
              const extras = parseExtras(res.extrasJson);
              const activitiesOpJson = parseActivitiesOp(res.activitiesOpJson);
              const opState = getReservationOpState(res);
              const cfg = OP_CONFIG[opState];
              const isExpanded = expandedIds.has(res.id);
              const totalActivities = 1 + extras.length;
              const isSoon = res.arrivalTime && isWithin2Hours(res.arrivalTime, dateStr);

              return (
                <div key={res.id} className={cn(
                  "bg-[#111827] border border-slate-800 rounded-xl overflow-hidden border-l-4",
                  cfg.border.replace("border-l-", "border-l-4 border-"),
                )}>
                  {/* ── NIVEL 1: Cabecera de reserva ── */}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      {/* Info principal */}
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className={cn("w-11 h-11 rounded-full flex items-center justify-center shrink-0",
                          res.clientConfirmed ? "bg-emerald-500/20" : "bg-blue-500/20")}>
                          {res.clientConfirmed
                            ? <CheckCheck className="w-5 h-5 text-emerald-400" />
                            : <Waves className="w-5 h-5 text-blue-400" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-white text-base">{res.clientName}</h3>
                            {res.reservationNumber && (
                              <span className="text-[10px] font-mono text-blue-400/80 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5">
                                {res.reservationNumber}
                              </span>
                            )}
                            <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border", cfg.bg, cfg.dot.replace("bg-", "border-").replace("400", "500/40"))}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                              {cfg.label}
                            </span>
                            {isSoon && !res.clientConfirmed && (
                              <Badge className="bg-red-500/20 text-red-300 border-red-500 text-[10px] animate-pulse">Inminente</Badge>
                            )}
                          </div>

                          {/* Contacto */}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-slate-400">
                            {res.clientPhone && (
                              <a href={`tel:${res.clientPhone}`} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                                <Phone className="w-3 h-3" />{res.clientPhone}
                              </a>
                            )}
                            {res.clientEmail && (
                              <span className="flex items-center gap-1 truncate max-w-xs">
                                <Mail className="w-3 h-3" />{res.clientEmail}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />{res.numberOfPersons} pax
                            </span>
                            <span className="flex items-center gap-1">
                              <Waves className="w-3 h-3" />{totalActivities} actividad{totalActivities !== 1 ? "es" : ""}
                            </span>
                          </div>

                          {/* Datos operativos generales */}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border",
                              res.monitorName ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-red-400 bg-red-500/10 border-red-500/20")}>
                              <UserCheck className="w-3 h-3" />
                              {res.monitorName || "Sin monitor"}
                            </span>
                            <span className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded border",
                              res.arrivalTime ? "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20")}>
                              <Clock className="w-3 h-3" />
                              {res.arrivalTime || "Sin hora de llegada"}
                            </span>
                            {res.clientConfirmed ? (
                              <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
                                <CheckCircle2 className="w-3 h-3" />Llegada confirmada
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
                                <AlertTriangle className="w-3 h-3" />Sin confirmar
                              </span>
                            )}
                            {res.merchantOrder && (
                              <span className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                                <Hash className="w-3 h-3" />{res.merchantOrder}
                              </span>
                            )}
                          </div>

                          {res.opNotes && (
                            <p className="text-xs text-slate-500 italic mt-1.5 flex items-center gap-1">
                              <StickyNote className="w-3 h-3 shrink-0" />"{res.opNotes}"
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Acciones lado derecho */}
                      <div className="shrink-0 flex flex-col gap-1.5 items-end">
                        {!res.clientConfirmed && (
                          <Button size="sm"
                            onClick={() => confirmArrivalMutation.mutate({ reservationId: res.id })}
                            disabled={confirmArrivalMutation.isPending}
                            className="bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs gap-1 h-7">
                            <CheckCircle2 className="w-3.5 h-3.5" />Confirmar llegada
                          </Button>
                        )}
                        <Button size="sm" variant="outline"
                          onClick={() => openEditReservation(res)}
                          className="border-slate-600 text-slate-300 hover:bg-slate-700 text-xs gap-1 h-7">
                          <ClipboardList className="w-3.5 h-3.5" />Editar operativa general
                        </Button>
                        <Link href={`/admin/crm?tab=reservas&id=${res.id}`}>
                          <span className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded px-2 py-1 cursor-pointer transition-colors">
                            <ExternalLink className="w-3 h-3" />Ver CRM
                          </span>
                        </Link>
                        <Button size="sm" variant="outline"
                          onClick={() => setCancelTarget({ id: res.id, title: res.activityTitle || "Actividad" })}
                          className="border-red-700/40 text-red-400 hover:bg-red-500/10 text-xs gap-1 h-7">
                          <XCircle className="w-3.5 h-3.5" />Anular
                        </Button>
                      </div>
                    </div>

                    {/* Botón desplegar actividades — solo si hay extras */}
                    {totalActivities > 1 && (
                      <button onClick={() => toggleExpand(res.id)}
                        className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg py-1.5 hover:bg-slate-800 transition-colors">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {isExpanded ? "Ocultar" : "Ver"} {totalActivities} actividades incluidas
                      </button>
                    )}
                  </div>

                  {/* ── NIVEL 2: Actividades de la reserva (desplegable) ── */}
                  {isExpanded && (
                    <div className="px-5 pb-5 space-y-2 border-t border-slate-800 pt-4">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-3">
                        Actividades incluidas — los datos heredados provienen de la operativa general de la reserva
                      </p>
                      {/* Actividad principal */}
                      <ActivitySubItem
                        index={0}
                        title={res.activityTitle || "Actividad principal"}
                        pax={res.numberOfPersons}
                        op={getActivityOp(0, activitiesOpJson, res)}
                        monitors={monitors}
                        onEdit={() => openEditActivity(res, 0, res.activityTitle || "Actividad principal")}
                      />
                      {/* Actividades extras */}
                      {extras.map((ex: any, i: number) => (
                        <ActivitySubItem
                          key={i}
                          index={i + 1}
                          title={ex.experienceTitle || ex.name || `Actividad ${i + 2}`}
                          pax={ex.participants || ex.pax || res.numberOfPersons}
                          op={getActivityOp(i + 1, activitiesOpJson, res)}
                          monitors={monitors}
                          onEdit={() => openEditActivity(res, i + 1, ex.experienceTitle || ex.name || `Actividad ${i + 2}`)}
                        />
                      ))}
                    </div>
                  )}
                  {/* Si solo hay 1 actividad y no expandible, mostrar siempre */}
                  {totalActivities === 1 && (
                    <div className="px-5 pb-5 border-t border-slate-800 pt-4">
                      <ActivitySubItem
                        index={0}
                        title={res.activityTitle || "Actividad principal"}
                        pax={res.numberOfPersons}
                        op={getActivityOp(0, activitiesOpJson, res)}
                        monitors={monitors}
                        onEdit={() => openEditActivity(res, 0, res.activityTitle || "Actividad principal")}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de edición operativa (reserva general o actividad específica) */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editTarget?.activityIndex === -1 ? "Editar operativa general de reserva" : "Editar actividad"}
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4 mt-2">
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="font-semibold text-white text-sm">{editTarget.title}</p>
                {editTarget.activityIndex === -1 && (
                  <p className="text-xs text-slate-400 mt-1">Los datos guardados aquí se heredarán a las actividades que no tengan valores propios.</p>
                )}
                {editTarget.activityIndex >= 0 && editTarget.current.isInherited && (
                  <p className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Actualmente heredando datos de la reserva general. Al guardar se creará un valor propio.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Monitor asignado</label>
                <Select value={editMonitorId} onValueChange={setEditMonitorId}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Seleccionar monitor..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="none" className="text-slate-400">Sin monitor</SelectItem>
                    {monitors.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)} className="text-white">{m.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />Hora de llegada del cliente
                </label>
                <Input type="time" value={editArrivalTime} onChange={(e) => setEditArrivalTime(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white [color-scheme:dark]" />
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 flex items-center gap-1">
                  <StickyNote className="w-3.5 h-3.5 text-amber-400" />Notas operativas
                </label>
                <Textarea value={editOpNotes} onChange={(e) => setEditOpNotes(e.target.value)}
                  placeholder="Notas internas para el equipo..." rows={3}
                  className="bg-slate-800 border-slate-600 text-white resize-none" />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditTarget(null)} className="border-slate-600 text-slate-300">Cancelar</Button>
                <Button
                  disabled={updateDetailsMutation.isPending || updateActivityOpMutation.isPending}
                  onClick={handleSave}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
                  {updateDetailsMutation.isPending || updateActivityOpMutation.isPending ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal confirmación anulación */}
      <AlertDialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <AlertDialogContent className="bg-[#111827] border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">¿Anular reserva?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Se anulará <strong className="text-white">{cancelTarget?.title}</strong>. La reserva quedará cancelada y desaparecerá del calendario y de la vista de actividades.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => cancelTarget && cancelActivityMutation.mutate({ reservationId: cancelTarget.id })}>
              Anular reserva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
