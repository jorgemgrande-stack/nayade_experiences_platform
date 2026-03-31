import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  Calendar, CalendarDays, ChevronLeft, ChevronRight,
  Waves, Utensils, RefreshCw, AlertTriangle, Users,
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
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function getMonthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function getMonthEnd(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
// Build the 6-week grid (Mon-Sun) that covers the full month
function buildCalendarGrid(d: Date): Date[] {
  const first = getMonthStart(d);
  const last = getMonthEnd(d);
  // Monday-based: 0=Mon … 6=Sun
  const startDow = (first.getDay() + 6) % 7; // 0=Mon
  const grid: Date[] = [];
  for (let i = -startDow; i < 42 - startDow; i++) {
    grid.push(addDays(first, i));
  }
  // Trim trailing rows that are fully outside the month if < 6 weeks needed
  while (grid.length > 35 && grid[grid.length - 7].getMonth() !== d.getMonth()) {
    grid.splice(grid.length - 7, 7);
  }
  return grid;
}

// ─── Event helpers ─────────────────────────────────────────────────────────────
function getEventDateKey(ev: any): string {
  const sd = ev.scheduledDate;
  if (typeof sd === "string" && sd.length >= 10) return sd.slice(0, 10);
  return formatDate(new Date(sd));
}

const EVENT_COLORS: Record<string, string> = {
  activity:   "bg-blue-500/20 text-blue-300 border-blue-500/40",
  restaurant: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  spa:        "bg-purple-500/20 text-purple-300 border-purple-500/40",
  hotel:      "bg-amber-500/20 text-amber-300 border-amber-500/40",
  pack:       "bg-pink-500/20 text-pink-300 border-pink-500/40",
};

function EventPill({ ev }: { ev: any }) {
  const color = EVENT_COLORS[ev.eventType] ?? EVENT_COLORS.activity;
  const icon = ev.eventType === "restaurant"
    ? <Utensils className="w-2.5 h-2.5 shrink-0" />
    : <Waves className="w-2.5 h-2.5 shrink-0" />;
  return (
    <div className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border truncate ${color}`}>
      {icon}
      <span className="truncate">{ev.activityTitle || ev.clientName}</span>
      {ev.numberOfPersons > 0 && (
        <span className="shrink-0 opacity-70">·{ev.numberOfPersons}</span>
      )}
    </div>
  );
}

// ─── Day Detail Panel ─────────────────────────────────────────────────────────
function DayDetailModal({
  date, events, onClose, onGoToActivities,
}: {
  date: Date;
  events: any[];
  onClose: () => void;
  onGoToActivities: (dateStr: string) => void;
}) {
  const label = date.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const activities = events.filter(e => e.eventType === "activity");
  const restaurants = events.filter(e => e.eventType === "restaurant");

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
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total", value: events.length, color: "text-white" },
              { label: "Actividades", value: activities.length, color: "text-blue-300" },
              { label: "Restaurante", value: restaurants.length, color: "text-emerald-300" },
            ].map(k => (
              <div key={k.label} className="bg-slate-800 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                <div className="text-slate-400 text-xs mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Alerts */}
          {activities.filter(a => !a.monitorId).length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-red-300">
                {activities.filter(a => !a.monitorId).length} actividad(es) sin monitor asignado
              </span>
            </div>
          )}

          {/* Activity list */}
          {activities.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Waves className="w-3.5 h-3.5" /> Actividades ({activities.length})
              </h4>
              <div className="space-y-2">
                {activities.map((ev: any, i: number) => (
                  <div key={i} className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm truncate">{ev.activityTitle || "Actividad"}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{ev.clientName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Users className="w-3 h-3" />{ev.numberOfPersons}
                        </span>
                        {ev.monitorName
                          ? <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">{ev.monitorName}</Badge>
                          : <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px]">Sin monitor</Badge>}
                      </div>
                    </div>
                    {ev.arrivalTime && (
                      <p className="text-xs text-slate-500 mt-1">Llegada: {ev.arrivalTime}</p>
                    )}
                    {ev.opNotes && (
                      <p className="text-xs text-slate-500 mt-0.5 italic">"{ev.opNotes}"</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Restaurant list */}
          {restaurants.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Utensils className="w-3.5 h-3.5" /> Restaurante ({restaurants.length})
              </h4>
              <div className="space-y-2">
                {restaurants.map((ev: any, i: number) => (
                  <div key={i} className="bg-slate-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm truncate">{ev.activityTitle}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{ev.clientName}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                        <Users className="w-3 h-3" />{ev.numberOfPersons}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {events.length === 0 && (
            <p className="text-center text-slate-500 py-6">No hay actividades este día</p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-slate-600 text-slate-300"
            >
              Cerrar
            </Button>
            <Button
              size="sm"
              onClick={() => { onGoToActivities(formatDate(date)); onClose(); }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
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

  const monthLabel = currentDate.toLocaleDateString("es-ES", {
    month: "long", year: "numeric",
  });

  const selectedDayEvents = selectedDay ? (eventsByDay[formatDate(selectedDay)] || []) : [];

  function goToActivities(dateStr: string) {
    // Navigate to DailyActivities with the date pre-selected via sessionStorage
    sessionStorage.setItem("activitiesDate", dateStr);
    navigate("/admin/operaciones/actividades");
  }

  return (
    <AdminLayout title="Calendario de Actividades">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Calendar className="w-6 h-6 text-blue-400" />
              Calendario de Actividades
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Vista mensual de todas las actividades del CRM
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
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
            onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-semibold text-white capitalize">{monthLabel}</h2>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-blue-500/30 border border-blue-400 inline-block" />
              Actividades
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-emerald-500/30 border border-emerald-400 inline-block" />
              Restaurante
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" />
            Cargando calendario...
          </div>
        ) : (
          <div className="bg-[#111827] rounded-xl border border-slate-800 overflow-hidden">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-slate-800">
              {DOW_LABELS.map(d => (
                <div
                  key={d}
                  className="py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7">
              {grid.map((day, idx) => {
                const key = formatDate(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isToday = key === today;
                const dayEvents = eventsByDay[key] || [];
                const actCount = dayEvents.filter(e => e.eventType === "activity").length;
                const restCount = dayEvents.filter(e => e.eventType === "restaurant").length;
                const hasNoMonitor = dayEvents.some(e => e.eventType === "activity" && !e.monitorId);
                const isLastRow = idx >= grid.length - 7;

                return (
                  <div
                    key={key}
                    onClick={() => setSelectedDay(day)}
                    className={`
                      min-h-[110px] p-2 border-b border-r border-slate-800 cursor-pointer
                      transition-colors hover:bg-slate-800/60
                      ${!isCurrentMonth ? "opacity-40" : ""}
                      ${isLastRow ? "border-b-0" : ""}
                      ${(idx + 1) % 7 === 0 ? "border-r-0" : ""}
                    `}
                  >
                    {/* Day number */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`
                          text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full
                          ${isToday ? "bg-blue-600 text-white" : "text-slate-300"}
                        `}
                      >
                        {day.getDate()}
                      </span>
                      {hasNoMonitor && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </div>

                    {/* Event pills — show up to 3, then "+N más" */}
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((ev, i) => (
                        <EventPill key={i} ev={ev} />
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] text-slate-500 pl-1">
                          +{dayEvents.length - 3} más
                        </div>
                      )}
                    </div>

                    {/* Bottom summary if there are events */}
                    {dayEvents.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
                        {actCount > 0 && (
                          <span className="flex items-center gap-0.5 text-blue-400">
                            <Waves className="w-2.5 h-2.5" />{actCount}
                          </span>
                        )}
                        {restCount > 0 && (
                          <span className="flex items-center gap-0.5 text-emerald-400">
                            <Utensils className="w-2.5 h-2.5" />{restCount}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Day Detail Modal */}
      {selectedDay && (
        <DayDetailModal
          date={selectedDay}
          events={selectedDayEvents}
          onClose={() => setSelectedDay(null)}
          onGoToActivities={goToActivities}
        />
      )}
    </AdminLayout>
  );
}
