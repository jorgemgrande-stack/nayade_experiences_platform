import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  CalendarDays, ChevronLeft, ChevronRight, Users, User,
  AlertTriangle, CheckCircle2, Waves, Utensils, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

type ViewMode = "day" | "week" | "timeline";
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

// CRITICAL: use LOCAL date parts — toISOString() converts to UTC and shifts day by -1 in UTC+2 Spain
function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function getWeekStart(d: Date) {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  return r;
}
// scheduledDate from MySQL DATE column comes as "YYYY-MM-DD" string.
// Append T00:00:00 to parse as LOCAL time (not UTC midnight which shifts the day in UTC+2).
function parseEventDate(sd: any): Date {
  if (!sd) return new Date();
  if (typeof sd === "number") return new Date(sd);
  // "2026-03-29" or "2026-03-29T..." — ensure local parse
  const s = String(sd);
  if (s.length === 10) return new Date(s + "T09:00:00"); // default 09:00 local for date-only
  return new Date(s);
}
function getEventHour(sd: any) {
  const d = parseEventDate(sd);
  return d.getHours() + d.getMinutes() / 60;
}
function formatTime(sd: any) {
  return parseEventDate(sd).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function formatDayLabel(d: Date) {
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

function EventCard({ ev, compact = false }: { ev: any; compact?: boolean }) {
  const isActivity = ev.eventType === "activity";
  const colorClass = isActivity
    ? "border-l-blue-400 bg-blue-500/10"
    : "border-l-emerald-400 bg-emerald-500/10";
  return (
    <div className={`border-l-2 rounded-r px-2 py-1 text-xs ${colorClass} mb-1`}>
      <div className="flex items-center gap-1 font-semibold text-white truncate">
        {isActivity
          ? <Waves className="w-3 h-3 text-blue-400 shrink-0" />
          : <Utensils className="w-3 h-3 text-emerald-400 shrink-0" />}
        <span className="truncate">{ev.activityTitle || ev.clientName}</span>
      </div>
      {!compact && (
        <div className="flex items-center gap-1 text-slate-300 mt-0.5 flex-wrap">
          <User className="w-3 h-3" />
          <span className="truncate">{ev.clientName}</span>
          <Users className="w-3 h-3 ml-1" />
          <span>{ev.numberOfPersons}</span>
          {ev.clientConfirmed
            ? <span className="text-emerald-400 flex items-center gap-0.5 ml-1"><CheckCircle2 className="w-3 h-3" />OK</span>
            : <span className="text-amber-400 flex items-center gap-0.5 ml-1"><AlertTriangle className="w-3 h-3" />Sin confirmar</span>}
          {isActivity && !ev.monitorId && (
            <span className="text-red-400 flex items-center gap-0.5">
              <AlertTriangle className="w-3 h-3" />Sin monitor
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);

  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const fromDate = viewMode === "week" ? formatDate(weekStart) : formatDate(currentDate);
  const toDate = viewMode === "week" ? formatDate(addDays(weekStart, 6)) : formatDate(currentDate);

  const { data, isLoading, refetch } = trpc.operations.calendar.getEvents.useQuery(
    { from: fromDate + "T00:00:00", to: toDate + "T23:59:59" },
    { refetchOnWindowFocus: false }
  );

  const allEvents = useMemo(() => {
    const acts = (data?.activities || []).map((e: any) => ({ ...e, eventType: "activity" }));
    const rests = (data?.restaurants || []).map((e: any) => ({ ...e, eventType: "restaurant" }));
    return [...acts, ...rests].sort(
      (a: any, b: any) => parseEventDate(a.scheduledDate).getTime() - parseEventDate(b.scheduledDate).getTime()
    );
  }, [data]);

  function navigate(dir: number) {
    if (viewMode === "week") setCurrentDate(d => addDays(d, dir * 7));
    else setCurrentDate(d => addDays(d, dir));
  }

  const todayLabel =
    viewMode === "week"
      ? `${formatDayLabel(weekStart)} — ${formatDayLabel(addDays(weekStart, 6))}`
      : currentDate.toLocaleDateString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });

  const eventsByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    weekDays.forEach(d => { map[formatDate(d)] = []; });
    allEvents.forEach((ev: any) => {
      // Use the raw date string directly if it's YYYY-MM-DD, otherwise parse safely
      const sd = ev.scheduledDate;
      const key = typeof sd === "string" && sd.length >= 10 ? sd.slice(0, 10) : formatDate(parseEventDate(sd));
      if (map[key]) map[key].push(ev);
    });
    return map;
  }, [allEvents, weekDays]);

  return (
    <AdminLayout title="Calendario Operativo">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Calendar className="w-6 h-6 text-blue-400" />
              Calendario Operativo
            </h1>
            <p className="text-slate-400 text-sm mt-1">Vista unificada de todas las reservas</p>
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
            <div className="flex rounded-lg border border-slate-700 overflow-hidden">
              {(["day", "week", "timeline"] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === v
                      ? "bg-blue-600 text-white"
                      : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {v === "day" ? "Día" : v === "week" ? "Semana" : "Timeline"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(-1)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentDate(new Date())}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs px-3"
            >
              Hoy
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(1)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 w-8 h-8"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            {/* Date Picker */}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-700 text-slate-300 hover:bg-slate-800 gap-2 ml-1"
                >
                  <CalendarDays className="w-4 h-4 text-blue-400" />
                  Ir a fecha
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-[#111827] border-slate-700" align="start">
                <Calendar
                  mode="single"
                  selected={currentDate}
                  onSelect={(date) => {
                    if (date) {
                      setCurrentDate(date);
                      setCalendarOpen(false);
                    }
                  }}
                  initialFocus
                  className="text-white"
                />
              </PopoverContent>
            </Popover>
          </div>
          <h2 className="text-lg font-semibold text-white capitalize">{todayLabel}</h2>
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
            Cargando eventos...
          </div>
        ) : (
          <>
            {/* DAY VIEW */}
            {viewMode === "day" && (
              <div className="bg-[#111827] rounded-xl border border-slate-800 overflow-hidden">
                <div className="grid" style={{ gridTemplateColumns: "60px 1fr" }}>
                  {HOURS.map(h => {
                    const evs = allEvents.filter(
                      (ev: any) => Math.floor(getEventHour(ev.scheduledDate)) === h
                    );
                    return (
                      <div key={h} className="contents">
                        <div className="border-b border-slate-800 border-r border-slate-700 px-2 py-3 text-xs text-slate-500 text-right">
                          {String(h).padStart(2, "0")}:00
                        </div>
                        <div className="border-b border-slate-800 px-3 py-2 min-h-[60px]">
                          {evs.length > 0 && (
                            <div className="space-y-1">
                              {evs.map((ev: any, i: number) => (
                                <div key={i} className="flex items-start gap-2">
                                  <span className="text-xs text-slate-500 w-12 shrink-0 mt-1">
                                    {formatTime(ev.scheduledDate)}
                                  </span>
                                  <div className="flex-1">
                                    <EventCard ev={ev} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {allEvents.length === 0 && (
                  <div className="text-center py-16 text-slate-500">
                    <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No hay reservas para este día</p>
                  </div>
                )}
              </div>
            )}

            {/* WEEK VIEW */}
            {viewMode === "week" && (
              <div className="bg-[#111827] rounded-xl border border-slate-800 overflow-x-auto">
                <div
                  className="grid min-w-[900px]"
                  style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}
                >
                  <div className="border-b border-slate-700 border-r border-slate-700 p-2" />
                  {weekDays.map((d, i) => {
                    const isToday = formatDate(d) === formatDate(new Date());
                    return (
                      <div
                        key={i}
                        className={`border-b border-slate-700 border-r border-slate-800 p-2 text-center text-xs font-medium ${
                          isToday ? "text-blue-400 bg-blue-500/10" : "text-slate-400"
                        }`}
                      >
                        {formatDayLabel(d)}
                        <div className="text-slate-500 font-normal mt-0.5">
                          {(eventsByDay[formatDate(d)] || []).length} ev.
                        </div>
                      </div>
                    );
                  })}
                  {HOURS.map(h => (
                    <div key={h} className="contents">
                      <div className="border-b border-slate-800 border-r border-slate-700 px-1 py-2 text-xs text-slate-600 text-right">
                        {String(h).padStart(2, "0")}:00
                      </div>
                      {weekDays.map((d, di) => {
                        const evs = (eventsByDay[formatDate(d)] || []).filter(
                          (ev: any) => Math.floor(getEventHour(ev.scheduledDate)) === h
                        );
                        return (
                          <div
                            key={di}
                            className="border-b border-slate-800 border-r border-slate-800 p-1 min-h-[50px]"
                          >
                            {evs.map((ev: any, i: number) => (
                              <EventCard key={i} ev={ev} compact />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TIMELINE VIEW */}
            {viewMode === "timeline" && (
              <div className="bg-[#111827] rounded-xl border border-slate-800 overflow-hidden">
                {allEvents.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No hay reservas para este día</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {allEvents.map((ev: any, i: number) => {
                      const isActivity = ev.eventType === "activity";
                      const soon =
                        ev.scheduledDate &&
                        parseEventDate(ev.scheduledDate).getTime() - Date.now() < 2 * 60 * 60 * 1000 &&
                        parseEventDate(ev.scheduledDate).getTime() > Date.now();
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-4 px-6 py-4 hover:bg-slate-800/50 transition-colors ${
                            soon ? "bg-amber-500/5" : ""
                          }`}
                        >
                          <div className="w-16 shrink-0 text-center">
                            <div className="text-lg font-bold text-white">
                              {formatTime(ev.scheduledDate)}
                            </div>
                            <div
                              className={`text-xs mt-0.5 ${
                                isActivity ? "text-blue-400" : "text-emerald-400"
                              }`}
                            >
                              {isActivity ? "Actividad" : "Rest."}
                            </div>
                          </div>
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                              isActivity ? "bg-blue-500/20" : "bg-emerald-500/20"
                            }`}
                          >
                            {isActivity ? (
                              <Waves className="w-5 h-5 text-blue-400" />
                            ) : (
                              <Utensils className="w-5 h-5 text-emerald-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-white truncate">
                              {ev.activityTitle}
                            </div>
                            <div className="flex items-center gap-3 text-sm text-slate-400 mt-0.5">
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" />
                                {ev.clientName}
                              </span>
                              {ev.clientPhone && (
                                <a
                                  href={`tel:${ev.clientPhone}`}
                                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                                >
                                  📞 {ev.clientPhone}
                                </a>
                              )}
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {ev.numberOfPersons} pax
                              </span>
                            </div>
                          </div>
                          <div className="w-32 shrink-0 text-sm">
                            {ev.monitorName ? (
                              <span className="text-slate-300 flex items-center gap-1">
                                <User className="w-3 h-3 text-slate-500" />
                                {ev.monitorName}
                              </span>
                            ) : isActivity ? (
                              <span className="text-red-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Sin monitor
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {soon && (
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500 text-xs">
                                Próximo
                              </Badge>
                            )}
                            {ev.clientConfirmed ? (
                              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500 text-xs">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Confirmado
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500 text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Sin confirmar
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
