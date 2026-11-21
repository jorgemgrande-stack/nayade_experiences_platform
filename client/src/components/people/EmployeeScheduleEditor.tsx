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
import { useI18n } from "@/i18n/I18nProvider";
import { scheduleErrors, weeklyScheduledHours, WEEKDAY_LABELS, type ScheduleSlot } from "@shared/peopleOnboarding";

/** Lunes primero, como en un calendario laboral. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Errores de scheduleErrors (shared/peopleOnboarding, en español) -> texto del idioma de la interfaz. */
function translateScheduleError(msg: string, t: (key: string, p?: Record<string, string | number>) => string, days: readonly string[]): string {
  if (msg === "Como máximo 4 tramos por día.") return t("peopleShared.schedule.err.maxSlots");
  if (msg === "Día de la semana no válido.") return t("peopleShared.schedule.err.invalidDay");
  const m = /^(.+?): (.+)$/.exec(msg);
  const idx = m ? WEEKDAY_LABELS.indexOf(m[1] as (typeof WEEKDAY_LABELS)[number]) : -1;
  if (!m || idx < 0) return msg;
  const day = days[idx];
  if (m[2] === "las horas deben tener el formato HH:MM.") return t("peopleShared.schedule.err.format", { day });
  if (m[2] === "la hora de salida debe ser posterior a la de entrada.") return t("peopleShared.schedule.err.order", { day });
  if (m[2] === "como máximo 4 tramos.") return t("peopleShared.schedule.err.maxDay", { day });
  if (m[2] === "hay tramos que se solapan.") return t("peopleShared.schedule.err.overlap", { day });
  return msg;
}

export default function EmployeeScheduleEditor({ employeeId }: { employeeId: number }) {
  const { t, format } = useI18n();
  // Domingo primero, como WEEKDAY_LABELS
  const dayNames = [t("peopleShared.schedule.weekday.sun"), t("peopleShared.schedule.weekday.mon"), t("peopleShared.schedule.weekday.tue"), t("peopleShared.schedule.weekday.wed"), t("peopleShared.schedule.weekday.thu"), t("peopleShared.schedule.weekday.fri"), t("peopleShared.schedule.weekday.sat")];
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.hr.schedule.listForEmployee.useQuery({ employeeId });
  // Borrador local solo mientras se edita; si no, el horario guardado
  const [draft, setDraft] = useState<ScheduleSlot[] | null>(null);
  const saved: ScheduleSlot[] = (data ?? []).map((r) => ({ weekday: r.weekday, startTime: r.startTime, endTime: r.endTime }));
  const slots = draft ?? saved;
  const dirty = draft !== null;
  const edit = (fn: (s: ScheduleSlot[]) => ScheduleSlot[]) => setDraft(fn(slots));

  const save = trpc.hr.schedule.setWeek.useMutation({
    onSuccess: () => {
      toast.success(t("peopleShared.schedule.saved"));
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
        {t("peopleShared.schedule.intro")}
      </p>

      {slots.length === 0 && !dirty && (
        <div className="rounded-xl border border-dashed border-foreground/[0.15] p-5 text-sm text-foreground/60 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <span>{t("peopleShared.schedule.none")}</span>
          <Button type="button" variant="outline" size="sm" onClick={fillWorkweek}>{t("peopleShared.schedule.fill")}</Button>
        </div>
      )}

      <div className="rounded-xl border border-foreground/[0.08] divide-y divide-foreground/[0.06]">
        {WEEK_ORDER.map((weekday) => {
          const rows = slots.map((s, i) => ({ s, i })).filter((r) => r.s.weekday === weekday);
          return (
            <div key={weekday} className="flex flex-col sm:flex-row sm:items-start gap-2 px-4 py-3">
              <div className="w-28 shrink-0 text-sm font-medium pt-2">{dayNames[weekday]}</div>
              <div className="flex-1 space-y-2">
                {rows.length === 0 && <div className="text-xs text-foreground/40 pt-2.5">{t("peopleShared.schedule.free")}</div>}
                {rows.map(({ s, i }) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="time" aria-label={t("peopleShared.schedule.entry", { day: dayNames[weekday] })} value={s.startTime} onChange={(e) => update(i, { startTime: e.target.value })} className="w-32" />
                    <span className="text-foreground/40 text-sm">{t("peopleShared.schedule.to")}</span>
                    <Input type="time" aria-label={t("peopleShared.schedule.exit", { day: dayNames[weekday] })} value={s.endTime} onChange={(e) => update(i, { endTime: e.target.value })} className="w-32" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label={t("peopleShared.schedule.removeSlot")}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => add(weekday)} className="self-start">
                <Plus className="w-4 h-4 mr-1" /> {t("peopleShared.schedule.addSlot")}
              </Button>
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <ul className="text-sm text-red-500 space-y-1" role="alert">
          {errors.map((e) => <li key={e}>{translateScheduleError(e, t, dayNames)}</li>)}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground/60">{hours !== null ? t("peopleShared.schedule.hoursWeek", { hours: format.number(hours, { maximumFractionDigits: 2 }) }) : ""}</span>
        <Button type="button" onClick={() => save.mutate({ employeeId, slots })} disabled={!dirty || errors.length > 0 || save.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
          <Save className="w-4 h-4 mr-1.5" />
          {save.isPending ? t("peopleShared.schedule.saving") : t("peopleShared.schedule.save")}
        </Button>
      </div>
    </div>
  );
}
