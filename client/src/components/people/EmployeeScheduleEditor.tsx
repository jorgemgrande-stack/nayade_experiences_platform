/**
 * Horario semanal de un empleado (Personal): uno o varios tramos por día. Se usa para comparar las horas fichadas con
 * las previstas. La validación es la misma que en el servidor (shared/peopleOnboarding).
 */
import { useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { scheduleErrors, weeklyScheduledHours, WEEKDAY_LABELS, type ScheduleSlot } from "@shared/peopleOnboarding";

/** Lunes primero, como en un calendario laboral. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function EmployeeScheduleEditor({ employeeId }: { employeeId: number }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.hr.schedule.listForEmployee.useQuery({ employeeId });
  // Borrador local solo mientras se edita; si no, el horario guardado
  const [draft, setDraft] = useState<ScheduleSlot[] | null>(null);
  const saved: ScheduleSlot[] = (data ?? []).map((t) => ({ weekday: t.weekday, startTime: t.startTime, endTime: t.endTime }));
  const slots = draft ?? saved;
  const dirty = draft !== null;
  const edit = (fn: (s: ScheduleSlot[]) => ScheduleSlot[]) => setDraft(fn(slots));

  const save = trpc.hr.schedule.setWeek.useMutation({
    onSuccess: () => {
      toast.success("Horario guardado");
      setDraft(null);
      utils.hr.schedule.listForEmployee.invalidate({ employeeId });
      utils.hr.onboarding.status.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (i: number, patch: Partial<ScheduleSlot>) => edit((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => edit((s) => s.filter((_, j) => j !== i));
  const add = (weekday: number) => edit((s) => [...s, { weekday, startTime: "09:00", endTime: "14:00" }]);
  const fillWorkweek = () => setDraft([1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>;
  }

  const errors = scheduleErrors(slots);
  const hours = errors.length || slots.length === 0 ? null : weeklyScheduledHours(slots);

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-foreground/60">
        Horario previsto de cada semana. Se usa para comparar las horas fichadas con las previstas. Puedes añadir varios tramos en un mismo día (jornada partida).
      </p>

      {slots.length === 0 && !dirty && (
        <div className="rounded-xl border border-dashed border-foreground/[0.15] p-5 text-sm text-foreground/60 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <span>Este empleado todavía no tiene horario.</span>
          <Button type="button" variant="outline" size="sm" onClick={fillWorkweek}>Rellenar de lunes a viernes, 9:00 a 17:00</Button>
        </div>
      )}

      <div className="rounded-xl border border-foreground/[0.08] divide-y divide-foreground/[0.06]">
        {WEEK_ORDER.map((weekday) => {
          const rows = slots.map((s, i) => ({ s, i })).filter((r) => r.s.weekday === weekday);
          return (
            <div key={weekday} className="flex flex-col sm:flex-row sm:items-start gap-2 px-4 py-3">
              <div className="w-28 shrink-0 text-sm font-medium pt-2">{WEEKDAY_LABELS[weekday]}</div>
              <div className="flex-1 space-y-2">
                {rows.length === 0 && <div className="text-xs text-foreground/40 pt-2.5">Libre</div>}
                {rows.map(({ s, i }) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="time" aria-label={`${WEEKDAY_LABELS[weekday]}: entrada`} value={s.startTime} onChange={(e) => update(i, { startTime: e.target.value })} className="w-32" />
                    <span className="text-foreground/40 text-sm">a</span>
                    <Input type="time" aria-label={`${WEEKDAY_LABELS[weekday]}: salida`} value={s.endTime} onChange={(e) => update(i, { endTime: e.target.value })} className="w-32" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Quitar tramo">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => add(weekday)} className="self-start">
                <Plus className="w-4 h-4 mr-1" /> Tramo
              </Button>
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <ul className="text-sm text-red-500 space-y-1" role="alert">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground/60">{hours !== null ? `${hours.toLocaleString("es-ES", { maximumFractionDigits: 2 })} h a la semana` : ""}</span>
        <Button type="button" onClick={() => save.mutate({ employeeId, slots })} disabled={!dirty || errors.length > 0 || save.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
          <Save className="w-4 h-4 mr-1.5" />
          {save.isPending ? "Guardando…" : "Guardar horario"}
        </Button>
      </div>
    </div>
  );
}
