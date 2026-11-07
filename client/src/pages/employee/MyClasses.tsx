/**
 * MyClasses — «Mis clases y horas» del portal del empleado (Ski Net · Profesores).
 *
 * El profesor cuya ficha de la escuela está vinculada a este usuario ve sus clases de los próximos 14 días (con el
 * nombre, la edad y el nivel de sus alumnos) y sus horas del mes frente a las exigidas. Sin vínculo o sin la licencia
 * de la escuela, un aviso claro.
 */
import { CalendarDays, Clock, GraduationCap, Loader2 } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";

const hours = (m: number | null) => (m == null ? "—" : `${(m / 60).toLocaleString("es-ES", { maximumFractionDigits: 2 })} h`);
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default function MyClasses() {
  const q = trpc.skiSchool.myClasses.useQuery(undefined, { retry: false });
  const msg = String(q.error?.message ?? "");
  return (
    <EmployeeLayout>
      <div className="space-y-6">
        <header className="flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-[var(--portal-accent)]" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-slate-900">Mis clases y horas</h1>
        </header>
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-label="Cargando" />
          </div>
        ) : q.error ? (
          <div role="status" className="rounded-xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-600">
            {/^\[module_not_licensed\]/.test(msg)
              ? "La escuela no está incluida en el plan de tu sede."
              : q.error.data?.code === "NOT_FOUND"
                ? "Tu usuario no está vinculado a ningún profesor de la escuela. Pídeselo a tu empresa."
                : "No se han podido cargar tus clases. Inténtalo de nuevo."}
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              {[
                ["Programadas este mes", hours(q.data!.month.scheduled)],
                ["Impartidas este mes", hours(q.data!.month.taught)],
                ["Exigidas este mes", hours(q.data!.month.requiredMinutes)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </section>
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Próximas clases (14 días)
              </h2>
              {q.data!.upcoming.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">No tienes clases asignadas en los próximos días.</p>
              ) : (
                <ul className="space-y-2">
                  {q.data!.upcoming.map((s) => (
                    <li key={s.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
                      <p className="break-words text-sm font-medium capitalize text-slate-900">
                        {fmtDay(s.date)} · {s.startTime}–{s.endTime}
                      </p>
                      <p className="break-words text-sm text-slate-600">
                        {s.productName}
                        {s.level ? ` · nivel ${s.level}` : ""}
                        {s.meetingPoint ? ` · ${s.meetingPoint}` : ""}
                        {s.status === "completed" ? " · impartida" : ""}
                      </p>
                      {s.participants.length > 0 && (
                        <p className="break-words text-xs text-slate-500">
                          Alumnos: {s.participants.map((p) => `${p.name}${p.age != null ? ` (${p.age})` : ""}${p.level ? ` ${p.level}` : ""}`).join(", ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </EmployeeLayout>
  );
}
