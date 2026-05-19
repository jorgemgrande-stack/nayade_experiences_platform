/**
 * MyTimeClock — Pantalla de fichaje del Portal del Empleado (Fase 4 RRHH).
 *
 * Estado abierto/cerrado controlado por hr.timeClock.myCurrent. Botón
 * grande de entrada/salida + historial de los últimos 30 fichajes.
 *
 * Esta fase guarda solo fecha y hora del lado servidor. La estructura
 * permite ampliar a IP/dispositivo/geo en el futuro sin migración.
 */
import { useState, useEffect } from "react";
import { Loader2, Clock, Play, Square, CheckCircle2, AlertCircle, Calendar } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" });
}
function fmtDurationMin(min: number | null) {
  if (min === null || min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  closed: "Completo",
  incomplete: "Incompleto",
  edited: "Editado",
  cancelled: "Cancelado",
};
const STATUS_CLASS: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  closed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  incomplete: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  edited: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  cancelled: "bg-white/10 text-white/40 border-white/20",
};

export default function MyTimeClock() {
  const utils = trpc.useUtils();
  const { data: current, isLoading: loadingCurrent } = trpc.hr.timeClock.myCurrent.useQuery();
  const { data: history, isLoading: loadingHistory } = trpc.hr.timeClock.myList.useQuery({ limit: 30 });

  // Reloj en vivo
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const clockIn = trpc.hr.timeClock.clockIn.useMutation({
    onSuccess: (data) => {
      toast.success(data.alreadyOpen ? "Ya tenías un fichaje abierto" : "Entrada registrada");
      utils.hr.timeClock.myCurrent.invalidate();
      utils.hr.timeClock.myList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const clockOut = trpc.hr.timeClock.clockOut.useMutation({
    onSuccess: (data) => {
      toast.success(`Salida registrada — ${fmtDurationMin(data.durationMinutes)}`);
      utils.hr.timeClock.myCurrent.invalidate();
      utils.hr.timeClock.myList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const isOpen = !!current;
  const openSinceMs = isOpen && current ? now.getTime() - new Date(current.clockInAt).getTime() : 0;
  const openMinutes = Math.max(0, Math.floor(openSinceMs / (1000 * 60)));

  return (
    <EmployeeLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-400" />
            Fichar entrada / salida
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Registra tu hora de entrada y salida. Solo se guardan fecha y hora.
          </p>
        </div>

        {/* Reloj + estado actual */}
        <div className={cn(
          "rounded-2xl border p-6 sm:p-8 transition-colors",
          isOpen
            ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-transparent"
            : "border-white/[0.08] bg-white/[0.02]",
        )}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                {isOpen ? "Trabajando desde" : "Hora actual"}
              </p>
              <p className="text-5xl font-black tabular-nums tracking-tight text-white">
                {now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
              <p className="text-xs text-white/40 mt-1">
                {now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
              {isOpen && current && (
                <div className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Entrada a las <strong>{fmtTime(current.clockInAt)}</strong>
                  <span className="text-white/40">·</span>
                  <span>{fmtDurationMin(openMinutes)} acumulados</span>
                </div>
              )}
            </div>

            {!loadingCurrent && (
              isOpen ? (
                <button
                  onClick={() => clockOut.mutate()}
                  disabled={clockOut.isPending}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-colors disabled:opacity-50"
                >
                  {clockOut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Square className="w-5 h-5" />}
                  Fichar salida
                </button>
              ) : (
                <button
                  onClick={() => clockIn.mutate()}
                  disabled={clockIn.isPending}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold transition-colors disabled:opacity-50"
                >
                  {clockIn.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                  Fichar entrada
                </button>
              )
            )}
          </div>
        </div>

        {/* Historial */}
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" /> Mis últimos fichajes
          </h2>

          {loadingHistory && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
            </div>
          )}

          {!loadingHistory && (!history || history.length === 0) && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-white/30" />
              Todavía no tienes fichajes registrados.
            </div>
          )}

          {!loadingHistory && history && history.length > 0 && (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04] border-b border-white/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-white/50">
                    <th className="px-4 py-3">Día</th>
                    <th className="px-4 py-3">Entrada</th>
                    <th className="px-4 py-3">Salida</th>
                    <th className="px-4 py-3">Duración</th>
                    <th className="px-4 py-3 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => (
                    <tr key={r.id} className="border-b border-white/[0.05] hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-white/90 capitalize">{fmtDate(r.clockInAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-white/80">{fmtTime(r.clockInAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-white/80">{fmtTime(r.clockOutAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-orange-300 font-semibold">{fmtDurationMin(r.durationMinutes)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border",
                          STATUS_CLASS[r.status] ?? "bg-white/10 text-white/40 border-white/20",
                        )}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </EmployeeLayout>
  );
}
