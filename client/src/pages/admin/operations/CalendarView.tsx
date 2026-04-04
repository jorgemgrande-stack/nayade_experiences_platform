/**
 * CalendarView — Calendario operativo de reservas confirmadas
 * Muestra SOLO reservas con status=paid y statusReservation!=ANULADA
 * Entidad principal: RESERVA (no actividad suelta, no presupuesto)
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  Calendar, CalendarDays, ChevronLeft, ChevronRight,
  Waves, Utensils, RefreshCw, AlertTriangle, Users,
  Phone, Mail, Clock, CheckCircle, XCircle, User,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Date helpers ─────────────────────────────────────────────────────────────
function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function getMonthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getMonthEnd(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function buildCalendarGrid(d: Date): Date[] {
  const first = getMonthStart(d);
  const startDow = (first.getDay() + 6) % 7;
  const grid: Date[] = [];
  for (let i = -startDow; i < 42 - startDow; i++) grid.push(addDays(first, i));
  while (grid.length > 35 && grid[grid.length - 7].getMonth() !== d.getMonth()) {
    grid.splice(grid.length - 7, 7);
  }
  return grid;
}
function getEventDateKey(ev: any): string {
  const sd = ev.scheduledDate;
  if (typeof sd === "string" && sd.length >= 10) return sd.slice(0, 10);
  return formatDate(new Date(sd));
}

// ─── Helpers operativos ───────────────────────────────────────────────────────
function getOpStatus(ev: any): "completa" | "sin_monitor" | "sin_hora" | "incidencia" {
  if (ev.opStatus === "incidencia") return "incidencia";
  if (!ev.monitorId) return "sin_monitor";
  if (!ev.arrivalTime) return "sin_hora";
  return "completa";
}

const OP_STATUS_CONFIG = {
  completa:    { dot: "bg-emerald-400", label: "Operativa completa",   border: "border-l-emerald-500" },
  sin_monitor: { dot: "bg-red-400",     label: "Sin monitor",          border: "border-l-red-500" },
  sin_hora:    { dot: "bg-amber-400",   label: "Sin hora de llegada",  border: "border-l-amber-500" },
  incidencia:  { dot: "bg-orange-400",  label: "Incidencia",           border: "border-l-orange-500" },
};

// ─── Pill de reserva en la celda ──────────────────────────────────────────────
function ReservationPill({ ev, onClick }: { ev: any; onClick: () => void }) {
  const opStatus = ev.eventType === "activity" ? getOpStatus(ev) : "completa";
  const cfg = OP_STATUS_CONFIG[opStatus];

  if (ev.eventType === "restaurant") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border truncate
          bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25 transition-colors text-left"
      >
        <Utensils className="w-2.5 h-2.5 shrink-0" />
        <span className="truncate">{ev.clientName}</span>
        <span className="shrink-0 opacity-70 ml-auto">·{ev.numberOfPersons}</span>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border-l-2 border border-slate-700 truncate
        bg-slate-800/80 hover:bg-slate-700/80 transition-colors text-left ${cfg.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      <span className="truncate text-white/90">{ev.clientName}</span>
      <span className="shrink-0 text-slate-400 ml-auto">·{ev.numberOfPersons}</span>
    </button>
  );
}

// ─── Modal de resumen operativo de reserva ────────────────────────────────────
function ReservationModal({
  ev, onClose, onGoToActivities,
}: {
  ev: any;
  onClose: () => void;
  onGoToActivities: (dateStr: string) => void;
}) {
  const [, navigate] = useLocation();
  const opStatus = ev.eventType === "activity" ? getOpStatus(ev) : "completa";
  const cfg = OP_STATUS_CONFIG[opStatus];

  // Parsear actividades del extras_json
  let extras: any[] = [];
  try { extras = ev.extrasJson ? JSON.parse(ev.extrasJson) : []; } catch { extras = []; }

  // Actividades internas con herencia de datos operativos
  const activitiesOpJson: Array<{ index: number; monitorId?: number | null; arrivalTime?: string; opNotes?: string }> = (() => {
    try { return ev.activitiesOpJson ? JSON.parse(ev.activitiesOpJson) : []; } catch { return []; }
  })();

  function getActivityOp(index: number) {
    const override = activitiesOpJson.find(a => a.index === index);
    return {
      monitorId:   override?.monitorId   ?? ev.monitorId   ?? null,
      arrivalTime: override?.arrivalTime ?? ev.arrivalTime ?? null,
      opNotes:     override?.opNotes     ?? ev.opNotes     ?? null,
      isInherited: !override,
    };
  }

  const totalActivities = 1 + extras.length; // actividad principal + extras
  const scheduledDate = ev.scheduledDate || "";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <CalendarDays className="w-5 h-5 text-blue-400" />
            Resumen operativo de reserva
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Estado operativo */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border-l-4 ${cfg.border.replace("border-l-", "border-l-4 border-")}`}>
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            <span className="text-sm text-slate-300">{cfg.label}</span>
          </div>

          {/* Cabecera: datos del cliente y reserva */}
          <div className="bg-slate-800/60 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-white text-base">{ev.clientName}</p>
                {ev.reservationNumber && (
                  <p className="text-blue-400 text-xs font-mono mt-0.5">{ev.reservationNumber}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-[10px]">
                  {ev.channel || "—"}
                </Badge>
                {ev.statusReservation && (
                  <Badge className="bg-slate-600/50 text-slate-300 text-[10px]">
                    {ev.statusReservation}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {ev.clientPhone && (
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Phone className="w-3 h-3" />
                  <a href={`tel:${ev.clientPhone}`} className="hover:text-white transition-colors">{ev.clientPhone}</a>
                </div>
              )}
              {ev.clientEmail && (
                <div className="flex items-center gap-1.5 text-slate-400 truncate">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate">{ev.clientEmail}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-slate-400">
                <CalendarDays className="w-3 h-3" />
                <span>Actividad: {scheduledDate}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Users className="w-3 h-3" />
                <span>{ev.numberOfPersons} pax · {totalActivities} actividad{totalActivities !== 1 ? "es" : ""}</span>
              </div>
            </div>
          </div>

          {/* Resumen operativo general */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Monitor", value: ev.monitorName || "Sin asignar", icon: <User className="w-3 h-3" />, ok: !!ev.monitorId },
              { label: "Hora llegada", value: ev.arrivalTime || "No asignada", icon: <Clock className="w-3 h-3" />, ok: !!ev.arrivalTime },
              { label: "Estado", value: ev.opStatus || "pendiente", icon: <CheckCircle className="w-3 h-3" />, ok: ev.opStatus === "confirmado" || ev.opStatus === "completado" },
            ].map(item => (
              <div key={item.label} className="bg-slate-800 rounded-lg p-3 text-center">
                <div className={`flex items-center justify-center gap-1 text-[10px] mb-1 ${item.ok ? "text-emerald-400" : "text-amber-400"}`}>
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                <p className="text-white text-xs font-medium truncate">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Notas operativas generales */}
          {ev.opNotes && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs text-amber-300 font-medium mb-1">Notas operativas</p>
              <p className="text-xs text-slate-300 italic">"{ev.opNotes}"</p>
            </div>
          )}

          {/* Actividades de la reserva */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Actividades incluidas ({totalActivities})
            </h4>
            <div className="space-y-2">
              {/* Actividad principal */}
              {(() => {
                const op = getActivityOp(0);
                return (
                  <div className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{ev.activityTitle || "Actividad principal"}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{ev.numberOfPersons} pax</p>
                      </div>
                      {op.isInherited && <Badge className="text-[9px] bg-slate-600/50 text-slate-400 border-slate-600">Heredado</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {op.monitorId ? (ev.monitorName || `Monitor #${op.monitorId}`) : <span className="text-red-400">Sin monitor</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {op.arrivalTime || <span className="text-amber-400">Sin hora</span>}
                      </span>
                    </div>
                    {op.opNotes && <p className="text-[10px] text-slate-500 italic mt-1">"{op.opNotes}"</p>}
                  </div>
                );
              })()}
              {/* Actividades extras */}
              {extras.map((ex: any, i: number) => {
                const op = getActivityOp(i + 1);
                return (
                  <div key={i} className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {ex.experienceTitle || ex.name || `Actividad ${i + 2}`}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{ex.participants || ex.pax || "—"} pax</p>
                      </div>
                      {op.isInherited && <Badge className="text-[9px] bg-slate-600/50 text-slate-400 border-slate-600">Heredado</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {op.monitorId ? (ev.monitorName || `Monitor #${op.monitorId}`) : <span className="text-red-400">Sin monitor</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {op.arrivalTime || <span className="text-amber-400">Sin hora</span>}
                      </span>
                    </div>
                    {op.opNotes && <p className="text-[10px] text-slate-500 italic mt-1">"{op.opNotes}"</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2 pt-2 border-t border-slate-700">
            <Button variant="outline" size="sm" onClick={onClose} className="border-slate-600 text-slate-300">
              Cerrar
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => navigate(`/admin/crm?tab=reservas&id=${ev.id}`)}
              className="border-blue-600/50 text-blue-400 hover:bg-blue-600/10 gap-1">
              <ExternalLink className="w-3.5 h-3.5" /> Ver reserva CRM
            </Button>
            <Button size="sm"
              onClick={() => { onGoToActivities(scheduledDate); onClose(); }}
              className="bg-blue-600 hover:bg-blue-700 text-white ml-auto gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> Ver actividades del día
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal de resumen de día (al hacer click en la celda) ─────────────────────
function DayDetailModal({
  date, events, onClose, onGoToActivities, onSelectReservation,
}: {
  date: Date;
  events: any[];
  onClose: () => void;
  onGoToActivities: (dateStr: string) => void;
  onSelectReservation: (ev: any) => void;
}) {
  const label = date.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const activities = events.filter(e => e.eventType === "activity");
  const restaurants = events.filter(e => e.eventType === "restaurant");
  const sinMonitor = activities.filter(a => !a.monitorId).length;
  const sinHora = activities.filter(a => !a.arrivalTime).length;
  const totalPax = events.reduce((s, e) => s + (e.numberOfPersons || 0), 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white capitalize flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-400" />
            {label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Reservas", value: events.length, color: "text-white" },
              { label: "Pax total", value: totalPax, color: "text-blue-300" },
              { label: "Sin monitor", value: sinMonitor, color: sinMonitor > 0 ? "text-red-400" : "text-emerald-400" },
              { label: "Sin hora", value: sinHora, color: sinHora > 0 ? "text-amber-400" : "text-emerald-400" },
            ].map(k => (
              <div key={k.label} className="bg-slate-800 rounded-lg p-3 text-center">
                <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
                <div className="text-slate-400 text-[10px] mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Alertas */}
          {sinMonitor > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-red-300">{sinMonitor} reserva{sinMonitor > 1 ? "s" : ""} sin monitor asignado</span>
            </div>
          )}
          {sinHora > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-amber-300">{sinHora} reserva{sinHora > 1 ? "s" : ""} sin hora de llegada</span>
            </div>
          )}

          {/* Listado de reservas de actividad */}
          {activities.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Waves className="w-3.5 h-3.5" /> Reservas confirmadas ({activities.length})
              </h4>
              <div className="space-y-1.5">
                {activities.map((ev: any, i: number) => {
                  const opStatus = getOpStatus(ev);
                  const cfg = OP_STATUS_CONFIG[opStatus];
                  return (
                    <button key={i} onClick={() => { onSelectReservation(ev); onClose(); }}
                      className={`w-full bg-slate-800 rounded-lg p-3 text-left hover:bg-slate-700/80 transition-colors border-l-2 ${cfg.border.replace("border-l-", "border-l-2 border-")}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white text-sm truncate">{ev.clientName}</p>
                          <p className="text-slate-400 text-xs mt-0.5 truncate">{ev.activityTitle}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <Users className="w-3 h-3" />{ev.numberOfPersons}
                          </span>
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} title={cfg.label} />
                        </div>
                      </div>
                      {ev.reservationNumber && (
                        <p className="text-[10px] font-mono text-blue-400/70 mt-1">{ev.reservationNumber}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Restaurantes */}
          {restaurants.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Utensils className="w-3.5 h-3.5" /> Restaurante ({restaurants.length})
              </h4>
              <div className="space-y-1.5">
                {restaurants.map((ev: any, i: number) => (
                  <button key={i} onClick={() => { onSelectReservation(ev); onClose(); }}
                    className="w-full bg-slate-800 rounded-lg p-3 text-left hover:bg-slate-700/80 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm truncate">{ev.activityTitle}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{ev.clientName}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                        <Users className="w-3 h-3" />{ev.numberOfPersons}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {events.length === 0 && (
            <p className="text-center text-slate-500 py-6">No hay reservas confirmadas este día</p>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-slate-700">
            <Button variant="outline" size="sm" onClick={onClose} className="border-slate-600 text-slate-300">
              Cerrar
            </Button>
            <Button size="sm"
              onClick={() => { onGoToActivities(formatDate(date)); onClose(); }}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              Ir a Actividades del Día
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function CalendarView() {
  const [, navigate] = useLocation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);

  const monthStart = useMemo(() => getMonthStart(currentDate), [currentDate]);
  const monthEnd = useMemo(() => getMonthEnd(currentDate), [currentDate]);
  const grid = useMemo(() => buildCalendarGrid(currentDate), [currentDate]);

  const fromDate = formatDate(grid[0]);
  const toDate = formatDate(grid[grid.length - 1]);

  const { data, isLoading, refetch } = trpc.operations.calendar.getEvents.useQuery(
    { from: fromDate + "T00:00:00", to: toDate + "T23:59:59" },
    { refetchOnWindowFocus: false }
  );

  const eventsByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    const acts = (data?.activities || []).map((e: any) => ({ ...e, eventType: "activity" }));
    const rests = (data?.restaurants || []).map((e: any) => ({ ...e, eventType: "restaurant" }));
    [...acts, ...rests].forEach(ev => {
      const key = getEventDateKey(ev);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    });
    return map;
  }, [data]);

  const today = formatDate(new Date());
  const DOW_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  const monthLabel = currentDate.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const selectedDayEvents = selectedDay ? (eventsByDay[formatDate(selectedDay)] || []) : [];

  function goToActivities(dateStr: string) {
    sessionStorage.setItem("activitiesDate", dateStr);
    navigate("/admin/operaciones/actividades");
  }

  // Totales del mes
  const allEvents = Object.values(eventsByDay).flat();
  const monthActivities = allEvents.filter(e => e.eventType === "activity");
  const monthPax = monthActivities.reduce((s, e) => s + (e.numberOfPersons || 0), 0);
  const sinMonitorTotal = monthActivities.filter(e => !e.monitorId).length;

  return (
    <AdminLayout title="Calendario de Actividades">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Calendar className="w-6 h-6 text-blue-400" />
              Calendario de Reservas
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Solo reservas confirmadas · haz clic en una reserva para ver el detalle operativo
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Resumen del mes */}
        {!isLoading && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: "Reservas este mes", value: monthActivities.length, color: "text-blue-300" },
              { label: "Pax total", value: monthPax, color: "text-white" },
              { label: "Sin monitor", value: sinMonitorTotal, color: sinMonitorTotal > 0 ? "text-red-400" : "text-emerald-400" },
              { label: "Restaurante", value: allEvents.filter(e => e.eventType === "restaurant").length, color: "text-emerald-300" },
            ].map(k => (
              <div key={k.label} className="bg-[#111827] rounded-lg p-3 border border-slate-800">
                <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                <div className="text-slate-400 text-xs mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Month Navigation */}
        <div className="flex items-center gap-3 mb-4">
          <Button variant="outline" size="icon"
            onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs">
            Hoy
          </Button>
          <Button variant="outline" size="icon"
            onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-semibold text-white capitalize">{monthLabel}</h2>
          <div className="ml-auto flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Operativa completa</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Sin hora llegada</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Sin monitor</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />Incidencia</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" />Cargando...
          </div>
        ) : (
          <div className="bg-[#111827] rounded-xl border border-slate-800 overflow-hidden">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-slate-800">
              {DOW_LABELS.map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7">
              {grid.map((day, idx) => {
                const key = formatDate(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isToday = key === today;
                const dayEvents = eventsByDay[key] || [];
                const acts = dayEvents.filter(e => e.eventType === "activity");
                const hasAlert = acts.some(e => !e.monitorId || e.opStatus === "incidencia");
                const isLastRow = idx >= grid.length - 7;

                return (
                  <div
                    key={key}
                    onClick={() => dayEvents.length > 0 && setSelectedDay(day)}
                    className={`
                      min-h-[110px] p-1.5 border-b border-r border-slate-800
                      ${dayEvents.length > 0 ? "cursor-pointer hover:bg-slate-800/40 transition-colors" : ""}
                      ${!isCurrentMonth ? "opacity-35" : ""}
                      ${isLastRow ? "border-b-0" : ""}
                      ${(idx + 1) % 7 === 0 ? "border-r-0" : ""}
                    `}
                  >
                    {/* Day number */}
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-semibold w-6 h-6 flex items-center justify-center rounded-full
                        ${isToday ? "bg-blue-600 text-white" : "text-slate-300"}`}>
                        {day.getDate()}
                      </span>
                      {hasAlert && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                    </div>

                    {/* Reservation pills — click individual */}
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((ev, i) => (
                        <ReservationPill key={i} ev={ev} onClick={() => setSelectedReservation(ev)} />
                      ))}
                      {dayEvents.length > 3 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedDay(day); }}
                          className="text-[10px] text-slate-500 pl-1 hover:text-slate-300 transition-colors w-full text-left"
                        >
                          +{dayEvents.length - 3} más...
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal de resumen del día */}
      {selectedDay && !selectedReservation && (
        <DayDetailModal
          date={selectedDay}
          events={selectedDayEvents}
          onClose={() => setSelectedDay(null)}
          onGoToActivities={goToActivities}
          onSelectReservation={(ev) => { setSelectedReservation(ev); setSelectedDay(null); }}
        />
      )}

      {/* Modal de reserva individual */}
      {selectedReservation && (
        <ReservationModal
          ev={selectedReservation}
          onClose={() => setSelectedReservation(null)}
          onGoToActivities={goToActivities}
        />
      )}
    </AdminLayout>
  );
}
